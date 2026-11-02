'use strict';
const { z, texto, dinero, numero, parseForm } = require('../utils/validation');
const { formatMoney } = require('../utils/money');
const { getSettings } = require('./settings');
const audit = require('./audit');

// Catálogo de servicios (consulta, vacuna, grooming…). Nunca se borran: se desactivan, así las
// citas y ventas históricas conservan su servicio (RN-03).
const TIPOS = [
    { valor: 'consulta', texto: 'Consulta' },
    { valor: 'vacuna', texto: 'Vacunación' },
    { valor: 'grooming', texto: 'Grooming' },
    { valor: 'seguimiento', texto: 'Seguimiento' },
    { valor: 'otro', texto: 'Otro' },
];
const TIPO_TEXTO = Object.fromEntries(TIPOS.map((t) => [t.valor, t.texto]));

const servicioSchema = z.object({
    nombre: texto({ max: 100 }),
    tipo: z.enum(TIPOS.map((t) => t.valor), { error: 'Tipo no válido.' }),
    precio: dinero(),
    duracion: numero(z.number({ error: 'Debe ser un número de minutos.' }).int('Usa minutos enteros.').min(5, 'Mínimo 5 minutos.').max(480, 'Máximo 480 minutos.')),
});

const noEncontrado = { ok: false, notFound: true };

function listServicios(db) {
    return db.prepare(`SELECT id, nombre, tipo, precio, duracion_min, activo FROM servicios
                       ORDER BY activo DESC, tipo, nombre COLLATE NOCASE`).all();
}

function getServicio(db, id) {
    return db.prepare('SELECT id, nombre, tipo, precio, duracion_min, activo FROM servicios WHERE id = ?').get(id) || null;
}

const nombreEnUso = (db, nombre, exceptId = 0) => Boolean(
    db.prepare('SELECT 1 FROM servicios WHERE nombre = ? COLLATE NOCASE AND id <> ?').get(nombre, exceptId));

function createServicio(db, input, { actorId = null, ip = null } = {}) {
    const { ok, values, errors } = parseForm(servicioSchema, input);
    if (!ok) return { ok: false, errors };
    if (nombreEnUso(db, values.nombre)) return { ok: false, errors: { nombre: 'Ya existe un servicio con ese nombre.' } };
    const r = db.prepare('INSERT INTO servicios (nombre, tipo, precio, duracion_min) VALUES (?, ?, ?, ?)')
        .run(values.nombre, values.tipo, values.precio, values.duracion);
    const id = Number(r.lastInsertRowid);
    audit.log(db, { usuarioId: actorId, accion: 'servicio_creado', entidad: 'servicio', entidadId: id, detalle: { nombre: values.nombre, tipo: values.tipo }, ip });
    return { ok: true, id };
}

function updateServicio(db, id, input, { actorId = null, ip = null } = {}) {
    const actual = getServicio(db, id);
    if (!actual) return noEncontrado;
    const { ok, values, errors } = parseForm(servicioSchema, input);
    if (!ok) return { ok: false, errors };
    if (nombreEnUso(db, values.nombre, id)) return { ok: false, errors: { nombre: 'Ya existe un servicio con ese nombre.' } };

    const moneda = getSettings(db).moneda;
    const cambios = [];
    if (values.nombre !== actual.nombre) cambios.push(`nombre: ${actual.nombre} → ${values.nombre}`);
    if (values.tipo !== actual.tipo) cambios.push(`tipo: ${TIPO_TEXTO[actual.tipo]} → ${TIPO_TEXTO[values.tipo]}`);
    if (values.precio !== actual.precio) cambios.push(`precio: ${formatMoney(actual.precio, moneda)} → ${formatMoney(values.precio, moneda)}`);
    if (values.duracion !== actual.duracion_min) cambios.push(`duración: ${actual.duracion_min} → ${values.duracion} min`);
    if (!cambios.length) return { ok: true, sinCambios: true };

    db.prepare('UPDATE servicios SET nombre = ?, tipo = ?, precio = ?, duracion_min = ? WHERE id = ?')
        .run(values.nombre, values.tipo, values.precio, values.duracion, id);
    audit.log(db, { usuarioId: actorId, accion: 'servicio_editado', entidad: 'servicio', entidadId: id, detalle: { cambios }, ip });
    return { ok: true };
}

/** Desactiva o reactiva. Las citas y ventas que ya usan el servicio no cambian. */
function setActivo(db, id, activo, { actorId = null, ip = null } = {}) {
    const actual = getServicio(db, id);
    if (!actual) return noEncontrado;
    if (Boolean(actual.activo) === activo) return { ok: true, sinCambios: true };
    db.prepare('UPDATE servicios SET activo = ? WHERE id = ?').run(activo ? 1 : 0, id);
    audit.log(db, { usuarioId: actorId, accion: activo ? 'servicio_activado' : 'servicio_desactivado', entidad: 'servicio', entidadId: id, detalle: { nombre: actual.nombre }, ip });
    return { ok: true };
}

module.exports = { TIPOS, TIPO_TEXTO, listServicios, getServicio, createServicio, updateServicio, setActivo };
