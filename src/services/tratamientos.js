'use strict';
const { z, texto, opcional, numero, parseForm } = require('../utils/validation');
const { transaction } = require('../db/connection');
const audit = require('./audit');

// Tratamientos indicados en una consulta (RF-20). Como el resto de lo clínico no se borran (RN-03):
// si se indicó algo por error, se anula la consulta completa y se registra una nueva.

const tratamientoSchema = z.object({
    medicamento: opcional(z.coerce.number({ error: 'Medicamento no válido.' }).int().positive()),
    medicamento_texto: opcional(texto({ max: 120 })),
    dosis: texto({ max: 120 }),
    frecuencia: texto({ max: 120 }),
    duracion_dias: opcional(numero(z.number({ error: 'Debe ser un número de días.' }).int('Usa días enteros.').min(1, 'Mínimo 1 día.').max(365, 'Máximo 365 días.'))),
    indicaciones: opcional(texto({ max: 500 })),
}).refine((v) => v.medicamento !== undefined || v.medicamento_texto !== undefined,
    { message: 'Elige un medicamento del catálogo o escribe su nombre.', path: ['medicamento_texto'] });

/** Medicamentos del catálogo de farmacia (productos activos marcados como medicamento). */
const medicamentos = (db) => db.prepare(`SELECT id, nombre, presentacion FROM productos
    WHERE activo = 1 AND es_medicamento = 1 ORDER BY nombre COLLATE NOCASE`).all();

/** Tratamientos de una consulta, en el orden en que se indicaron. */
const listarTratamientos = (db, consultaId) => db.prepare(`
    SELECT t.id, t.consulta_id, t.producto_id, t.medicamento_texto, t.dosis, t.frecuencia, t.duracion_dias, t.indicaciones,
           COALESCE(p.nombre, t.medicamento_texto) AS medicamento
    FROM tratamientos t LEFT JOIN productos p ON p.id = t.producto_id
    WHERE t.consulta_id = ? ORDER BY t.id`).all(consultaId);

function agregarTratamiento(db, consultaId, input, { actorId, ip = null }) {
    const f = parseForm(tratamientoSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    const v = f.values;
    return transaction(db, () => {
        const c = db.prepare('SELECT estado FROM consultas WHERE id = ?').get(consultaId);
        if (!c) return { ok: false, notFound: true };
        if (c.estado !== 'vigente') return { ok: false, error: 'La consulta está anulada: no se le pueden agregar tratamientos.' };
        if (v.medicamento !== undefined && !db.prepare('SELECT 1 FROM productos WHERE id = ? AND activo = 1 AND es_medicamento = 1').get(v.medicamento)) {
            return { ok: false, errors: { medicamento: 'El medicamento no existe o está desactivado.' } };
        }
        const r = db.prepare(`INSERT INTO tratamientos (consulta_id, producto_id, medicamento_texto, dosis, frecuencia, duracion_dias, indicaciones)
                              VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(consultaId, v.medicamento ?? null, v.medicamento_texto ?? null, v.dosis, v.frecuencia, v.duracion_dias ?? null, v.indicaciones ?? null);
        const id = Number(r.lastInsertRowid);
        audit.log(db, { usuarioId: actorId, accion: 'tratamiento_agregado', entidad: 'tratamiento', entidadId: id, detalle: { consulta_id: consultaId, medicamento: v.medicamento_texto ?? `#${v.medicamento}` }, ip });
        return { ok: true, id };
    });
}

module.exports = { medicamentos, listarTratamientos, agregarTratamiento };
