'use strict';
const { z, texto, opcional, telefono, correo, casilla, verTelefono, parseForm } = require('../utils/validation');
const { patron, patronTelefono, paginar } = require('../utils/busqueda');
const audit = require('./audit');

// Clientes (propietarios de mascotas). Nunca se borran: se desactivan, y solo si no tienen
// mascotas activas (RN-01). El consentimiento de notificaciones queda registrado en bitácora.

const cedula = () => z.string().trim()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().regex(/^[0-9A-Z-]{5,20}$/, 'Cédula no válida: usa letras, números y guiones (ej. 001-010101-0001A).'));

const propietarioSchema = z.object({
    nombre: texto({ min: 3, max: 100 }),
    cedula: opcional(cedula()),
    telefono: telefono(),
    correo: opcional(correo()),
    direccion: opcional(texto({ max: 200 })),
    acepta_notificaciones: casilla(),
});

const noEncontrado = { ok: false, notFound: true };

function getPropietario(db, id) {
    return db.prepare(`SELECT id, nombre, cedula, telefono, correo, direccion, acepta_notificaciones, activo, creado_en
                       FROM propietarios WHERE id = ?`).get(id) || null;
}

/** Valores del formulario de edición a partir de lo guardado. */
const paraFormulario = (p) => ({
    nombre: p.nombre, cedula: p.cedula || '', telefono: verTelefono(p.telefono),
    correo: p.correo || '', direccion: p.direccion || '', acepta_notificaciones: Boolean(p.acepta_notificaciones),
});

/** Busca por nombre, cédula o teléfono. Por defecto solo activos. Paginado de 25. */
function listPropietarios(db, { q = '', inactivos = false, pagina = 1 } = {}) {
    const p = patron(q);
    const tel = patronTelefono(q);
    const filtro = [inactivos ? 1 : 0, p, p, p, tel];
    // SQL fijo (sin armar texto): el filtro viaja como parámetros
    const total = db.prepare(`
        SELECT COUNT(*) AS n FROM propietarios
        WHERE (activo = 1 OR ? = 1)
          AND (? IS NULL OR nombre LIKE ? ESCAPE '!' OR cedula LIKE ? ESCAPE '!' OR telefono LIKE ?)`).get(...filtro).n;
    const pag = paginar(total, pagina);
    const filas = db.prepare(`
        SELECT id, nombre, cedula, telefono, correo, direccion, acepta_notificaciones, activo, creado_en,
               (SELECT COUNT(*) FROM mascotas m WHERE m.propietario_id = propietarios.id AND m.estado = 'activa') AS mascotas_activas
        FROM propietarios
        WHERE (activo = 1 OR ? = 1)
          AND (? IS NULL OR nombre LIKE ? ESCAPE '!' OR cedula LIKE ? ESCAPE '!' OR telefono LIKE ?)
        ORDER BY nombre COLLATE NOCASE, id LIMIT ? OFFSET ?`).all(...filtro, pag.porPagina, pag.offset);
    return { filas, total, ...pag };
}

const cedulaEnUso = (db, valor, exceptId = 0) => Boolean(
    valor && db.prepare('SELECT 1 FROM propietarios WHERE cedula = ? AND id <> ?').get(valor, exceptId));

function createPropietario(db, input, { actorId = null, ip = null } = {}) {
    const { ok, values: v, errors } = parseForm(propietarioSchema, input);
    if (!ok) return { ok: false, errors };
    if (cedulaEnUso(db, v.cedula)) return { ok: false, errors: { cedula: 'Ya existe un cliente con esa cédula.' } };
    const r = db.prepare(`INSERT INTO propietarios (nombre, cedula, telefono, correo, direccion, acepta_notificaciones)
                          VALUES (?, ?, ?, ?, ?, ?)`)
        .run(v.nombre, v.cedula ?? null, v.telefono, v.correo ?? null, v.direccion ?? null, v.acepta_notificaciones ? 1 : 0);
    const id = Number(r.lastInsertRowid);
    audit.log(db, { usuarioId: actorId, accion: 'propietario_creado', entidad: 'propietario', entidadId: id, detalle: { nombre: v.nombre, acepta_notificaciones: v.acepta_notificaciones }, ip });
    return { ok: true, id };
}

function updatePropietario(db, id, input, { actorId = null, ip = null } = {}) {
    const actual = getPropietario(db, id);
    if (!actual) return noEncontrado;
    const { ok, values: v, errors } = parseForm(propietarioSchema, input);
    if (!ok) return { ok: false, errors };
    if (cedulaEnUso(db, v.cedula, id)) return { ok: false, errors: { cedula: 'Ya existe un cliente con esa cédula.' } };

    const nuevo = {
        nombre: v.nombre, cedula: v.cedula ?? null, telefono: v.telefono,
        correo: v.correo ?? null, direccion: v.direccion ?? null, acepta: v.acepta_notificaciones ? 1 : 0,
    };
    const cambios = [];
    const dif = (campo, antes, despues) => { if ((antes ?? null) !== (despues ?? null)) cambios.push(`${campo}: ${antes ?? '—'} → ${despues ?? '—'}`); };
    dif('nombre', actual.nombre, nuevo.nombre);
    dif('cédula', actual.cedula, nuevo.cedula);
    dif('teléfono', actual.telefono, nuevo.telefono);
    dif('correo', actual.correo, nuevo.correo);
    dif('dirección', actual.direccion, nuevo.direccion);
    const cambioConsentimiento = actual.acepta_notificaciones !== nuevo.acepta;
    if (!cambios.length && !cambioConsentimiento) return { ok: true, sinCambios: true };

    db.prepare(`UPDATE propietarios SET nombre = ?, cedula = ?, telefono = ?, correo = ?, direccion = ?, acepta_notificaciones = ?
                WHERE id = ?`).run(nuevo.nombre, nuevo.cedula, nuevo.telefono, nuevo.correo, nuevo.direccion, nuevo.acepta, id);
    if (cambios.length) audit.log(db, { usuarioId: actorId, accion: 'propietario_editado', entidad: 'propietario', entidadId: id, detalle: { cambios }, ip });
    if (cambioConsentimiento) {
        audit.log(db, {
            usuarioId: actorId, accion: 'consentimiento_cambiado', entidad: 'propietario', entidadId: id,
            detalle: { acepta_notificaciones: `${actual.acepta_notificaciones ? 'sí' : 'no'} → ${nuevo.acepta ? 'sí' : 'no'}` }, ip,
        });
    }
    return { ok: true };
}

/** Mascotas activas de un cliente (RN-01 impide desactivarlo mientras las tenga). */
const contarMascotasActivas = (db, id) => db.prepare(
    "SELECT COUNT(*) AS n FROM mascotas WHERE propietario_id = ? AND estado = 'activa'").get(id).n;

function setActivo(db, id, activo, { actorId = null, ip = null } = {}) {
    const actual = getPropietario(db, id);
    if (!actual) return noEncontrado;
    if (Boolean(actual.activo) === activo) return { ok: true, sinCambios: true };
    if (!activo) {
        const n = contarMascotasActivas(db, id);
        if (n > 0) {
            return { ok: false, error: `No se puede desactivar: tiene ${n} mascota${n === 1 ? '' : 's'} activa${n === 1 ? '' : 's'}. Transfiérelas a otro cliente o márcalas como inactivas o fallecidas.` };
        }
    }
    db.prepare('UPDATE propietarios SET activo = ? WHERE id = ?').run(activo ? 1 : 0, id);
    audit.log(db, { usuarioId: actorId, accion: activo ? 'propietario_activado' : 'propietario_desactivado', entidad: 'propietario', entidadId: id, detalle: { nombre: actual.nombre }, ip });
    return { ok: true };
}

module.exports = { getPropietario, listPropietarios, createPropietario, updatePropietario, setActivo, contarMascotasActivas, paraFormulario };
