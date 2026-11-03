'use strict';
const { z, texto, opcional, numero, parseForm } = require('../utils/validation');
const { patron, paginar } = require('../utils/busqueda');
const { managuaDayRange, utcToManagua } = require('../utils/dates');
const { transaction } = require('../db/connection');
const { ACTIVOS } = require('./citas');
const audit = require('./audit');

// Consultas clínicas (RF-14…RF-19). Solo las crea un veterinario (RN-02). Nunca se borran:
// se anulan con motivo, y la anulada conserva su contenido (RN-03; la BD lo impone con triggers).
// Los insumos usados y su descuento de inventario se agregan en ISS-12; tratamientos y vacunas en ISS-10.

const num = (min, max, entero = false) => {
    let base = z.number({ error: 'Debe ser un número.' });
    if (entero) base = base.int('Usa un número entero.');
    return opcional(numero(base.min(min, `Mínimo ${min}.`).max(max, `Máximo ${max}.`)));
};

const consultaSchema = z.object({
    motivo: texto({ max: 300 }),
    anamnesis: opcional(texto({ max: 2000 })),
    examen_fisico: opcional(texto({ max: 2000 })),
    diagnostico: texto({ max: 1000 }),
    observaciones: opcional(texto({ max: 2000 })),
    peso_kg: num(0.05, 200),
    temperatura_c: num(30, 45),
    frecuencia_cardiaca: num(20, 400, true),
    frecuencia_respiratoria: num(5, 200, true),
});
const anularSchema = z.object({ motivo: texto({ min: 5, max: 300 }) });

const noEncontrado = { ok: false, notFound: true };

// El SQL de este archivo es siempre literal (sin ${}); por eso las columnas se repiten.
function getConsulta(db, id) {
    return db.prepare(`
        SELECT c.id, c.mascota_id, c.cita_id, c.veterinario_id, c.fecha, c.motivo, c.anamnesis, c.examen_fisico, c.diagnostico,
           c.observaciones, c.peso_kg, c.temperatura_c, c.frecuencia_cardiaca, c.frecuencia_respiratoria,
           c.estado, c.anulada_motivo, c.anulada_por, c.anulada_en,
           m.nombre AS mascota_nombre, m.numero_expediente, m.especie, m.propietario_id,
           p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre, a.nombre AS anulada_por_nombre
        FROM consultas c JOIN mascotas m ON m.id = c.mascota_id JOIN propietarios p ON p.id = m.propietario_id
        JOIN usuarios u ON u.id = c.veterinario_id LEFT JOIN usuarios a ON a.id = c.anulada_por
        WHERE c.id = ?`).get(id) || null;
}

const filtrosSchema = z.object({
    q: opcional(z.string().trim().max(100)),
    desde: opcional(z.iso.date()),
    hasta: opcional(z.iso.date()),
    estado: opcional(z.enum(['vigente', 'anulada'])),
    pagina: opcional(z.coerce.number().int().min(1)),
});

/** Lee los filtros de la URL; los inválidos se ignoran en lugar de romper la pantalla. */
function leerFiltros(query) {
    const filtros = {};
    for (const campo of Object.keys(filtrosSchema.shape)) {
        const r = filtrosSchema.shape[campo].safeParse(query[campo]);
        if (r.success && r.data !== undefined) filtros[campo] = r.data;
    }
    return filtros;
}

/** Consultas más recientes primero. Sin `estado` se muestran todas (las anuladas van marcadas). */
function listarConsultas(db, { mascotaId = null, q, desde, hasta, estado, pagina = 1 } = {}) {
    const p = patron(q);
    const d = desde ? managuaDayRange(desde).from : null;
    const h = hasta ? managuaDayRange(hasta).to : null;
    const f = [mascotaId, mascotaId, p, p, p, p, p, d, d, h, h, estado ?? null, estado ?? null];
    const total = db.prepare(`
        SELECT COUNT(*) AS n FROM consultas c JOIN mascotas m ON m.id = c.mascota_id
        WHERE (? IS NULL OR c.mascota_id = ?)
          AND (? IS NULL OR c.diagnostico LIKE ? ESCAPE '!' OR c.motivo LIKE ? ESCAPE '!' OR m.nombre LIKE ? ESCAPE '!' OR m.numero_expediente LIKE ? ESCAPE '!')
          AND (? IS NULL OR c.fecha >= ?) AND (? IS NULL OR c.fecha < ?) AND (? IS NULL OR c.estado = ?)`).get(...f).n;
    const pag = paginar(total, pagina);
    const filas = db.prepare(`
        SELECT c.id, c.mascota_id, c.cita_id, c.veterinario_id, c.fecha, c.motivo, c.anamnesis, c.examen_fisico, c.diagnostico,
           c.observaciones, c.peso_kg, c.temperatura_c, c.frecuencia_cardiaca, c.frecuencia_respiratoria,
           c.estado, c.anulada_motivo, c.anulada_por, c.anulada_en,
           m.nombre AS mascota_nombre, m.numero_expediente, m.especie, m.propietario_id,
           p.nombre AS propietario_nombre, u.nombre AS veterinario_nombre, a.nombre AS anulada_por_nombre
        FROM consultas c JOIN mascotas m ON m.id = c.mascota_id JOIN propietarios p ON p.id = m.propietario_id
        JOIN usuarios u ON u.id = c.veterinario_id LEFT JOIN usuarios a ON a.id = c.anulada_por
        WHERE (? IS NULL OR c.mascota_id = ?)
          AND (? IS NULL OR c.diagnostico LIKE ? ESCAPE '!' OR c.motivo LIKE ? ESCAPE '!' OR m.nombre LIKE ? ESCAPE '!' OR m.numero_expediente LIKE ? ESCAPE '!')
          AND (? IS NULL OR c.fecha >= ?) AND (? IS NULL OR c.fecha < ?) AND (? IS NULL OR c.estado = ?)
        ORDER BY c.fecha DESC, c.id DESC LIMIT ? OFFSET ?`).all(...f, pag.porPagina, pag.offset);
    return { filas, total, ...pag };
}

/** Mediciones de peso para la gráfica: solo consultas vigentes con peso, de la más antigua a la más reciente. */
function pesosDe(db, mascotaId) {
    return db.prepare(`SELECT fecha, peso_kg FROM consultas
        WHERE mascota_id = ? AND estado = 'vigente' AND peso_kg IS NOT NULL ORDER BY fecha, id`).all(mascotaId)
        .map((r) => ({ fecha: utcToManagua(r.fecha).fecha, peso: r.peso_kg }));
}

/**
 * Registra una consulta. Con `citaId` se parte de una cita (debe ser de la misma mascota y seguir activa)
 * y la cita pasa a "atendida" en la misma transacción. Sin cita es una consulta de urgencia (D-18).
 */
function crearConsulta(db, input, { actorId, ip = null, ahora = new Date(), mascotaId, citaId = null }) {
    const f = parseForm(consultaSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    const v = f.values;
    return transaction(db, () => {
        if (!db.prepare('SELECT 1 FROM mascotas WHERE id = ?').get(mascotaId)) return { ok: false, error: 'La mascota no existe.' };
        if (citaId) {
            const cita = db.prepare('SELECT mascota_id, estado FROM citas WHERE id = ?').get(citaId);
            if (!cita || cita.mascota_id !== mascotaId) return { ok: false, error: 'La cita no corresponde a esta mascota.' };
            if (!ACTIVOS.includes(cita.estado)) return { ok: false, error: 'Esa cita ya no está activa (atendida, cancelada o no asistió).' };
            if (db.prepare("SELECT 1 FROM consultas WHERE cita_id = ? AND estado = 'vigente'").get(citaId)) return { ok: false, error: 'Esa cita ya tiene una consulta registrada.' };
        }
        const r = db.prepare(`INSERT INTO consultas (mascota_id, cita_id, veterinario_id, fecha, motivo, anamnesis, examen_fisico, diagnostico,
                                                     observaciones, peso_kg, temperatura_c, frecuencia_cardiaca, frecuencia_respiratoria)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(mascotaId, citaId, actorId, ahora.toISOString(), v.motivo, v.anamnesis ?? null, v.examen_fisico ?? null, v.diagnostico,
                v.observaciones ?? null, v.peso_kg ?? null, v.temperatura_c ?? null, v.frecuencia_cardiaca ?? null, v.frecuencia_respiratoria ?? null);
        const id = Number(r.lastInsertRowid);
        audit.log(db, { usuarioId: actorId, accion: 'consulta_creada', entidad: 'consulta', entidadId: id, detalle: { mascota_id: mascotaId, cita_id: citaId }, ip });
        if (citaId) {
            db.prepare("UPDATE citas SET estado = 'atendida' WHERE id = ?").run(citaId);
            audit.log(db, { usuarioId: actorId, accion: 'cita_estado', entidad: 'cita', entidadId: citaId, detalle: { a: 'atendida', por: 'consulta' }, ip });
        }
        return { ok: true, id };
    });
}

/**
 * Anula una consulta (no se borra): motivo obligatorio y queda quién, cuándo y por qué.
 * El administrador puede anular cualquiera; el veterinario, solo las suyas. La anulación es definitiva.
 */
function anularConsulta(db, id, input, { actor, ip = null, ahora = new Date() }) {
    const f = parseForm(anularSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    return transaction(db, () => {
        const c = getConsulta(db, id);
        if (!c) return noEncontrado;
        if (actor.rol !== 'admin' && c.veterinario_id !== actor.id) return { ok: false, forbidden: true };
        if (c.estado === 'anulada') return { ok: false, error: 'Esta consulta ya está anulada.' };
        db.prepare("UPDATE consultas SET estado = 'anulada', anulada_motivo = ?, anulada_por = ?, anulada_en = ? WHERE id = ?")
            .run(f.values.motivo, actor.id, ahora.toISOString(), id);
        audit.log(db, { usuarioId: actor.id, accion: 'consulta_anulada', entidad: 'consulta', entidadId: id, detalle: { motivo: f.values.motivo }, ip });
        return { ok: true };
    });
}

module.exports = { getConsulta, listarConsultas, leerFiltros, pesosDe, crearConsulta, anularConsulta };
