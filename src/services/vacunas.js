'use strict';
const { z, texto, fecha, parseForm } = require('../utils/validation');
const { todayInZone } = require('../utils/dates');
const { transaction } = require('../db/connection');
const audit = require('./audit');

// Vacunas aplicadas (RF-22…RF-24). Producto, lote y próxima dosis son obligatorios (T-14).
// Alcance académico (D-41): se guarda el lote (único por producto) pero NO se descuenta stock aquí;
// el descuento ocurre en la venta. Las vacunas no se borran: se anulan con motivo (RN-03).

const id = (msg) => z.coerce.number({ error: msg }).int({ error: msg }).positive({ error: msg });

const vacunaSchema = (hoy) => z.object({
    producto: id('Elige la vacuna.'),
    lote: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), id('Lote no válido.').optional()),
    fecha: fecha().refine((f) => f <= hoy, 'La fecha de aplicación no puede ser futura.'),
    proxima_dosis: fecha({ error: 'La próxima dosis es obligatoria.' }),
}).refine((v) => v.proxima_dosis > v.fecha, { message: 'La próxima dosis debe ser posterior a la aplicación.', path: ['proxima_dosis'] });

const anularSchema = z.object({ motivo: texto({ min: 5, max: 300 }) });

/** Vacunas disponibles (productos activos de categoría "Vacuna") con sus lotes. */
function catalogoVacunas(db) {
    const productos = db.prepare("SELECT id, nombre FROM productos WHERE activo = 1 AND categoria = 'Vacuna' ORDER BY nombre COLLATE NOCASE").all();
    const lote = db.prepare('SELECT id, codigo_lote FROM lotes WHERE producto_id = ? ORDER BY id');
    return productos.map((p) => ({ ...p, lotes: lote.all(p.id) }));
}

/** Vacunas aplicadas de una mascota o de una consulta (las anuladas solo si se piden). */
function listarVacunas(db, { mascotaId = null, consultaId = null, anuladas = true } = {}) {
    return db.prepare(`
        SELECT v.id, v.mascota_id, v.consulta_id, v.fecha, v.proxima_dosis, v.estado, v.anulada_motivo, v.veterinario_id,
               p.nombre AS vacuna, l.codigo_lote AS lote, u.nombre AS veterinario_nombre
        FROM vacunas_aplicadas v JOIN productos p ON p.id = v.producto_id JOIN lotes l ON l.id = v.lote_id JOIN usuarios u ON u.id = v.veterinario_id
        WHERE (? IS NULL OR v.mascota_id = ?) AND (? IS NULL OR v.consulta_id = ?) AND (? = 1 OR v.estado = 'vigente')
        ORDER BY v.fecha, v.id`).all(mascotaId, mascotaId, consultaId, consultaId, anuladas ? 1 : 0);
}

/** Registra una vacuna dentro de una consulta vigente (la mascota sale de la consulta). */
function registrarVacuna(db, consultaId, input, { actorId, ip = null, ahora = new Date() }) {
    const hoy = todayInZone(ahora);
    const f = parseForm(vacunaSchema(hoy), input);
    if (!f.ok) return { ok: false, errors: f.errors };
    const v = f.values;
    return transaction(db, () => {
        const c = db.prepare('SELECT mascota_id, estado FROM consultas WHERE id = ?').get(consultaId);
        if (!c) return { ok: false, notFound: true };
        if (c.estado !== 'vigente') return { ok: false, error: 'La consulta está anulada: no se le pueden registrar vacunas.' };
        const p = db.prepare("SELECT id FROM productos WHERE id = ? AND activo = 1 AND categoria = 'Vacuna'").get(v.producto);
        if (!p) return { ok: false, errors: { producto: 'La vacuna no existe o está desactivada.' } };
        const lotes = db.prepare('SELECT id FROM lotes WHERE producto_id = ? ORDER BY id').all(p.id);
        let loteId = v.lote;
        if (loteId === undefined) {
            if (lotes.length !== 1) return { ok: false, errors: { lote: 'Elige el lote de la vacuna.' } };
            loteId = lotes[0].id; // con lote único se usa solo
        } else if (!lotes.some((l) => l.id === loteId)) {
            return { ok: false, errors: { lote: 'Ese lote no corresponde a la vacuna.' } };
        }
        const r = db.prepare(`INSERT INTO vacunas_aplicadas (mascota_id, consulta_id, producto_id, lote_id, fecha, proxima_dosis, veterinario_id)
                              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(c.mascota_id, consultaId, p.id, loteId, v.fecha, v.proxima_dosis, actorId);
        const nuevo = Number(r.lastInsertRowid);
        audit.log(db, { usuarioId: actorId, accion: 'vacuna_aplicada', entidad: 'vacuna', entidadId: nuevo, detalle: { mascota_id: c.mascota_id, consulta_id: consultaId, proxima_dosis: v.proxima_dosis }, ip });
        return { ok: true, id: nuevo };
    });
}

/** Anula una vacuna (no se borra). El veterinario que la registró o un administrador. */
function anularVacuna(db, vacunaId, input, { actor, ip = null }) {
    const f = parseForm(anularSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    return transaction(db, () => {
        const v = db.prepare('SELECT id, consulta_id, estado, veterinario_id FROM vacunas_aplicadas WHERE id = ?').get(vacunaId);
        if (!v) return { ok: false, notFound: true };
        if (actor.rol !== 'admin' && v.veterinario_id !== actor.id) return { ok: false, forbidden: true };
        if (v.estado === 'anulada') return { ok: false, error: 'Esta vacuna ya está anulada.' };
        db.prepare("UPDATE vacunas_aplicadas SET estado = 'anulada', anulada_motivo = ? WHERE id = ?").run(f.values.motivo, vacunaId);
        audit.log(db, { usuarioId: actor.id, accion: 'vacuna_anulada', entidad: 'vacuna', entidadId: vacunaId, detalle: { motivo: f.values.motivo }, ip });
        return { ok: true, consultaId: v.consulta_id };
    });
}

module.exports = { catalogoVacunas, listarVacunas, registrarVacuna, anularVacuna };
