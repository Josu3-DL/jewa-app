'use strict';
const { z, texto, opcional, fecha, casilla, parseForm } = require('../utils/validation');
const { patron, patronTelefono, paginar } = require('../utils/busqueda');
const { todayInZone, edadTexto } = require('../utils/dates');
const { transaction } = require('../db/connection');
const audit = require('./audit');

// Mascotas (pacientes). El expediente se fusiona con la mascota (D-17): EXP-000123 automático.
// Nunca se borran. Cambiar de dueño deja historial en mascota_propietarios_hist.

const ESPECIES = ['Perro', 'Gato', 'Ave', 'Conejo', 'Roedor', 'Reptil', 'Otra'].map((e) => ({ valor: e, texto: e }));
const SEXOS = [{ valor: 'macho', texto: 'Macho' }, { valor: 'hembra', texto: 'Hembra' }, { valor: 'desconocido', texto: 'Desconocido' }];
const ESTADOS = [{ valor: 'activa', texto: 'Activa' }, { valor: 'fallecida', texto: 'Fallecida' }, { valor: 'inactiva', texto: 'Inactiva' }];
const ESTADO_TEXTO = Object.fromEntries(ESTADOS.map((e) => [e.valor, e.texto]));
const FOTO_MAX_BYTES = 2 * 1024 * 1024;

const valores = (lista) => lista.map((x) => x.valor);

/** Esquema de los datos de la mascota; `hoy` (AAAA-MM-DD) impide fechas de nacimiento futuras. */
const mascotaSchema = (hoy) => z.object({
    nombre: texto({ max: 60 }),
    especie: z.enum(valores(ESPECIES), { error: 'Elige una especie.' }),
    raza: opcional(texto({ max: 60 })),
    sexo: z.enum(valores(SEXOS), { error: 'Sexo no válido.' }),
    fecha_nacimiento: opcional(fecha().refine((f) => f <= hoy, 'La fecha de nacimiento no puede ser futura.')),
    color: opcional(texto({ max: 40 })),
    esterilizado: casilla(),
});
const estadoSchema = z.object({ estado: z.enum(valores(ESTADOS), { error: 'Estado no válido.' }) });
const propietarioSchema = z.object({ propietario: z.coerce.number({ error: 'Elige un propietario.' }).int().positive({ error: 'Elige un propietario.' }) });

const noEncontrado = { ok: false, notFound: true };
// Nota: el SQL de este archivo es siempre literal (sin ${}); por eso las columnas se repiten en cada consulta.
function getMascota(db, id) {
    return db.prepare(`
        SELECT m.id, m.numero_expediente, m.propietario_id, m.nombre, m.especie, m.raza, m.sexo, m.fecha_nacimiento,
               m.color, m.esterilizado, m.foto, m.estado, m.creado_en,
               p.nombre AS propietario_nombre, p.telefono AS propietario_telefono, p.activo AS propietario_activo
        FROM mascotas m JOIN propietarios p ON p.id = m.propietario_id WHERE m.id = ?`).get(id) || null;
}

/** Edad calculada a hoy (hora de Managua). */
const edadDe = (m, ahora = new Date()) => edadTexto(m.fecha_nacimiento, todayInZone(ahora));

const paraFormulario = (m) => ({
    nombre: m.nombre, especie: m.especie, raza: m.raza || '', sexo: m.sexo,
    fecha_nacimiento: m.fecha_nacimiento || '', color: m.color || '', esterilizado: Boolean(m.esterilizado), estado: m.estado,
});

/** Busca por nombre, expediente, o nombre/cédula/teléfono del dueño. `estado`: activa (por defecto), fallecida, inactiva o todos. */
function listMascotas(db, { q = '', estado = 'activa', propietarioId = null, pagina = 1 } = {}) {
    const p = patron(q);
    const tel = patronTelefono(q);
    const est = valores(ESTADOS).includes(estado) ? estado : null;
    const filtro = [est, est, propietarioId, propietarioId, p, p, p, p, p, tel];
    const total = db.prepare(`
        SELECT COUNT(*) AS n FROM mascotas m JOIN propietarios p ON p.id = m.propietario_id
        WHERE (? IS NULL OR m.estado = ?) AND (? IS NULL OR m.propietario_id = ?)
          AND (? IS NULL OR m.nombre LIKE ? ESCAPE '!' OR m.numero_expediente LIKE ? ESCAPE '!'
               OR p.nombre LIKE ? ESCAPE '!' OR p.cedula LIKE ? ESCAPE '!' OR p.telefono LIKE ?)`).get(...filtro).n;
    const pag = paginar(total, pagina);
    const filas = db.prepare(`
        SELECT m.id, m.numero_expediente, m.propietario_id, m.nombre, m.especie, m.raza, m.sexo, m.fecha_nacimiento,
               m.color, m.esterilizado, m.foto, m.estado, m.creado_en,
               p.nombre AS propietario_nombre, p.telefono AS propietario_telefono, p.activo AS propietario_activo
        FROM mascotas m JOIN propietarios p ON p.id = m.propietario_id
        WHERE (? IS NULL OR m.estado = ?) AND (? IS NULL OR m.propietario_id = ?)
          AND (? IS NULL OR m.nombre LIKE ? ESCAPE '!' OR m.numero_expediente LIKE ? ESCAPE '!'
               OR p.nombre LIKE ? ESCAPE '!' OR p.cedula LIKE ? ESCAPE '!' OR p.telefono LIKE ?)
        ORDER BY m.nombre COLLATE NOCASE, m.id LIMIT ? OFFSET ?`).all(...filtro, pag.porPagina, pag.offset);
    return { filas, total, ...pag };
}

/** Todas las mascotas de un cliente (ficha del cliente). */
const mascotasDe = (db, propietarioId) => db.prepare(`
    SELECT m.id, m.numero_expediente, m.propietario_id, m.nombre, m.especie, m.raza, m.sexo, m.fecha_nacimiento,
           m.color, m.esterilizado, m.foto, m.estado, m.creado_en,
           p.nombre AS propietario_nombre, p.telefono AS propietario_telefono, p.activo AS propietario_activo
    FROM mascotas m JOIN propietarios p ON p.id = m.propietario_id
    WHERE m.propietario_id = ? ORDER BY (m.estado = 'activa') DESC, m.nombre COLLATE NOCASE`).all(propietarioId);

/** Dueños que ha tenido la mascota, el actual primero. */
const historialPropietarios = (db, mascotaId) => db.prepare(`
    SELECT h.id, h.propietario_id, p.nombre, h.desde, h.hasta
    FROM mascota_propietarios_hist h JOIN propietarios p ON p.id = h.propietario_id
    WHERE h.mascota_id = ? ORDER BY h.id DESC`).all(mascotaId);

const expediente = (n) => `EXP-${String(n).padStart(6, '0')}`;

/** Crea la mascota con su número de expediente y su primer registro de propietario, en una transacción (regla 7). */
function createMascota(db, input, { actorId = null, ip = null, ahora = new Date() } = {}) {
    const dueno = parseForm(propietarioSchema, input);
    const datos = parseForm(mascotaSchema(todayInZone(ahora)), input);
    if (!dueno.ok || !datos.ok) return { ok: false, errors: { ...datos.errors, ...(dueno.ok ? {} : { propietario: dueno.errors.propietario }) } };
    const propietarioId = dueno.values.propietario;
    const v = datos.values;

    return transaction(db, () => {
        const p = db.prepare('SELECT id, activo FROM propietarios WHERE id = ?').get(propietarioId);
        if (!p) return { ok: false, errors: { propietario: 'El propietario no existe.' } };
        if (!p.activo) return { ok: false, errors: { propietario: 'El propietario está desactivado. Reactívalo antes de agregarle mascotas.' } };
        const numero = expediente(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM mascotas').get().n);
        const r = db.prepare(`INSERT INTO mascotas (numero_expediente, propietario_id, nombre, especie, raza, sexo, fecha_nacimiento, color, esterilizado)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(numero, propietarioId, v.nombre, v.especie, v.raza ?? null, v.sexo, v.fecha_nacimiento ?? null, v.color ?? null, v.esterilizado ? 1 : 0);
        const id = Number(r.lastInsertRowid);
        db.prepare('INSERT INTO mascota_propietarios_hist (mascota_id, propietario_id, desde) VALUES (?, ?, ?)').run(id, propietarioId, ahora.toISOString());
        audit.log(db, { usuarioId: actorId, accion: 'mascota_creada', entidad: 'mascota', entidadId: id, detalle: { expediente: numero, nombre: v.nombre, propietario_id: propietarioId }, ip });
        return { ok: true, id, expediente: numero };
    });
}

function updateMascota(db, id, input, { actorId = null, ip = null, ahora = new Date() } = {}) {
    const actual = getMascota(db, id);
    if (!actual) return noEncontrado;
    const datos = parseForm(mascotaSchema(todayInZone(ahora)), input);
    const est = parseForm(estadoSchema, input);
    if (!datos.ok || !est.ok) return { ok: false, errors: { ...datos.errors, ...est.errors } };
    const v = datos.values;
    const nuevo = { ...v, estado: est.values.estado, raza: v.raza ?? null, fecha_nacimiento: v.fecha_nacimiento ?? null, color: v.color ?? null, esterilizado: v.esterilizado ? 1 : 0 };

    const cambios = [];
    const dif = (campo, antes, despues) => { if ((antes ?? null) !== (despues ?? null)) cambios.push(`${campo}: ${antes ?? '—'} → ${despues ?? '—'}`); };
    dif('nombre', actual.nombre, nuevo.nombre);
    dif('especie', actual.especie, nuevo.especie);
    dif('raza', actual.raza, nuevo.raza);
    dif('sexo', actual.sexo, nuevo.sexo);
    dif('nacimiento', actual.fecha_nacimiento, nuevo.fecha_nacimiento);
    dif('color', actual.color, nuevo.color);
    dif('esterilizado', actual.esterilizado ? 'sí' : 'no', nuevo.esterilizado ? 'sí' : 'no');
    dif('estado', actual.estado, nuevo.estado);
    if (!cambios.length) return { ok: true, sinCambios: true };

    db.prepare(`UPDATE mascotas SET nombre = ?, especie = ?, raza = ?, sexo = ?, fecha_nacimiento = ?, color = ?, esterilizado = ?, estado = ?
                WHERE id = ?`).run(nuevo.nombre, nuevo.especie, nuevo.raza, nuevo.sexo, nuevo.fecha_nacimiento, nuevo.color, nuevo.esterilizado, nuevo.estado, id);
    audit.log(db, { usuarioId: actorId, accion: 'mascota_editada', entidad: 'mascota', entidadId: id, detalle: { cambios }, ip });
    return { ok: true };
}

/** Pasa la mascota a otro propietario activo y deja el historial de dueños. */
function transferirMascota(db, id, nuevoPropietarioId, { actorId = null, ip = null, ahora = new Date() } = {}) {
    const actual = getMascota(db, id);
    if (!actual) return noEncontrado;
    return transaction(db, () => {
        const nuevo = db.prepare('SELECT id, nombre, activo FROM propietarios WHERE id = ?').get(nuevoPropietarioId);
        if (!nuevo) return { ok: false, error: 'El propietario elegido no existe.' };
        if (!nuevo.activo) return { ok: false, error: 'El propietario elegido está desactivado.' };
        if (nuevo.id === actual.propietario_id) return { ok: false, error: 'La mascota ya pertenece a ese propietario.' };
        const iso = ahora.toISOString();
        db.prepare('UPDATE mascota_propietarios_hist SET hasta = ? WHERE mascota_id = ? AND hasta IS NULL').run(iso, id);
        db.prepare('INSERT INTO mascota_propietarios_hist (mascota_id, propietario_id, desde) VALUES (?, ?, ?)').run(id, nuevo.id, iso);
        db.prepare('UPDATE mascotas SET propietario_id = ? WHERE id = ?').run(nuevo.id, id);
        audit.log(db, {
            usuarioId: actorId, accion: 'mascota_transferida', entidad: 'mascota', entidadId: id,
            detalle: { de: actual.propietario_nombre, a: nuevo.nombre }, ip,
        });
        return { ok: true, propietario: nuevo.nombre };
    });
}

/** Guarda el nombre del archivo de la foto (o null para quitarla). Devuelve el nombre anterior para borrarlo. */
function setFoto(db, id, nombreArchivo, { actorId = null, ip = null } = {}) {
    const actual = getMascota(db, id);
    if (!actual) return noEncontrado;
    db.prepare('UPDATE mascotas SET foto = ? WHERE id = ?').run(nombreArchivo, id);
    audit.log(db, { usuarioId: actorId, accion: nombreArchivo ? 'mascota_foto_cambiada' : 'mascota_foto_quitada', entidad: 'mascota', entidadId: id, ip });
    return { ok: true, anterior: actual.foto };
}

module.exports = {
    ESPECIES, SEXOS, ESTADOS, ESTADO_TEXTO, FOTO_MAX_BYTES,
    getMascota, listMascotas, mascotasDe, historialPropietarios, edadDe, paraFormulario,
    createMascota, updateMascota, transferirMascota, setFoto,
};
