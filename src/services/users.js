'use strict';
const { hashPassword, passwordSchema } = require('./passwords');
const { ROLES } = require('../roles');
const { z, texto, opcional, casilla, parseForm } = require('../utils/validation');
const audit = require('./audit');

// ───────── Esquemas
const nombre = texto({ max: 100 });
const rol = z.enum(ROLES, { error: 'Rol no válido.' });
const colegiado = opcional(texto({ max: 50 }));
const repetir = z.string({ error: 'Repite la contraseña.' });
const coinciden = (d) => d.password2 === undefined || d.password2 === d.password;
const MSG_NO_COINCIDEN = { message: 'Las contraseñas no coinciden.', path: ['password2'] };

const crearSchema = z.object({
    nombre,
    usuario: texto({ min: 3, max: 50 }).regex(/^[A-Za-z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo.'),
    rol,
    colegiado,
    atiende_citas: z.preprocess((v) => (v === undefined ? undefined : v === 'on' || v === '1' || v === true), z.boolean().optional()),
    password: passwordSchema,
    password2: repetir.optional(), // opcional para el script seed:admin; los formularios siempre lo envían
}).refine(coinciden, MSG_NO_COINCIDEN);

const editarSchema = z.object({ nombre, rol, colegiado, atiende_citas: casilla() });
const restablecerSchema = z.object({ password: passwordSchema, password2: repetir }).refine(coinciden, MSG_NO_COINCIDEN);

const noEncontrado = { ok: false, notFound: true };

// ───────── Consultas
function listUsers(db) {
    return db.prepare(`SELECT id, nombre, usuario, rol, colegiado, atiende_citas, activo, intentos_fallidos, bloqueado_hasta, creado_en
                       FROM usuarios ORDER BY activo DESC, nombre COLLATE NOCASE`).all();
}

function getUser(db, id) {
    return db.prepare(`SELECT id, nombre, usuario, rol, colegiado, atiende_citas, activo, intentos_fallidos, bloqueado_hasta, creado_en
                       FROM usuarios WHERE id = ?`).get(id) || null;
}

function countUsers(db, rolFiltro = null) {
    return rolFiltro
        ? db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE rol = ?').get(rolFiltro).n
        : db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
}

/** Administradores activos, sin contar a `exceptId`. */
function countActiveAdmins(db, exceptId = 0) {
    return db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id <> ?").get(exceptId).n;
}

/** Cierra todas las sesiones abiertas de un usuario (al desactivarlo o cambiarle la contraseña). */
function destroyUserSessions(db, userId) {
    return db.prepare("DELETE FROM sesiones WHERE json_extract(datos, '$.userId') = ?").run(userId).changes;
}

// ───────── Altas y cambios
/**
 * Crea un usuario. Devuelve { ok, id } o { ok: false, errors }.
 * Sin `atiende_citas` explícito, los veterinarios atienden citas por defecto.
 */
async function createUser(db, input, { actorId = null, ip = null } = {}) {
    const { ok, values, errors } = parseForm(crearSchema, input);
    if (!ok) return { ok: false, errors };
    if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(values.usuario)) {
        return { ok: false, errors: { usuario: 'Ya existe un usuario con ese nombre.' } };
    }
    const atiende = values.atiende_citas === undefined ? values.rol === 'veterinario' : values.atiende_citas;
    const hash = await hashPassword(values.password);
    const result = db.prepare(`INSERT INTO usuarios (nombre, usuario, password_hash, rol, colegiado, atiende_citas)
                               VALUES (?, ?, ?, ?, ?, ?)`)
        .run(values.nombre, values.usuario, hash, values.rol, values.rol === 'veterinario' ? values.colegiado ?? null : null, atiende ? 1 : 0);
    const id = Number(result.lastInsertRowid);
    audit.log(db, { usuarioId: actorId, accion: 'usuario_creado', entidad: 'usuario', entidadId: id, detalle: { usuario: values.usuario, rol: values.rol }, ip });
    return { ok: true, id };
}

/** Edita nombre, rol, colegiado y "atiende citas". El nombre de usuario (login) no cambia. */
function updateUser(db, id, input, { actorId = null, ip = null } = {}) {
    const actual = getUser(db, id);
    if (!actual) return noEncontrado;
    const { ok, values, errors } = parseForm(editarSchema, input);
    if (!ok) return { ok: false, errors };

    if (values.rol !== actual.rol) {
        if (id === actorId) return { ok: false, errors: { rol: 'No puedes cambiar tu propio rol.' } };
        if (actual.rol === 'admin' && actual.activo && countActiveAdmins(db, id) === 0) {
            return { ok: false, errors: { rol: 'Debe quedar al menos un administrador activo.' } };
        }
    }
    const nuevo = { ...values, colegiado: values.rol === 'veterinario' ? values.colegiado ?? null : null };
    const cambios = [];
    if (nuevo.nombre !== actual.nombre) cambios.push(`nombre: ${actual.nombre} → ${nuevo.nombre}`);
    if (nuevo.rol !== actual.rol) cambios.push(`rol: ${actual.rol} → ${nuevo.rol}`);
    if ((nuevo.colegiado || null) !== (actual.colegiado || null)) cambios.push('colegiado modificado');
    if (Number(nuevo.atiende_citas) !== actual.atiende_citas) cambios.push(`atiende citas: ${actual.atiende_citas ? 'sí' : 'no'} → ${nuevo.atiende_citas ? 'sí' : 'no'}`);
    if (!cambios.length) return { ok: true, sinCambios: true };

    db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, colegiado = ?, atiende_citas = ? WHERE id = ?')
        .run(nuevo.nombre, nuevo.rol, nuevo.colegiado, nuevo.atiende_citas ? 1 : 0, id);
    // Un cambio de rol se aplica en la siguiente petición (attachUser relee al usuario); no hace falta cerrar sesiones.
    audit.log(db, { usuarioId: actorId, accion: 'usuario_editado', entidad: 'usuario', entidadId: id, detalle: { cambios }, ip });
    return { ok: true };
}

/** Desactiva o reactiva un usuario. Nunca al último administrador activo ni a uno mismo. */
function setActive(db, id, activo, { actorId = null, ip = null } = {}) {
    const actual = getUser(db, id);
    if (!actual) return noEncontrado;
    if (Boolean(actual.activo) === activo) return { ok: true, sinCambios: true };
    if (!activo) {
        if (id === actorId) return { ok: false, message: 'No puedes desactivarte a ti mismo.' };
        if (actual.rol === 'admin' && countActiveAdmins(db, id) === 0) {
            return { ok: false, message: 'No se puede desactivar al último administrador activo.' };
        }
    }
    db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(activo ? 1 : 0, id);
    if (!activo) destroyUserSessions(db, id);
    audit.log(db, { usuarioId: actorId, accion: activo ? 'usuario_activado' : 'usuario_desactivado', entidad: 'usuario', entidadId: id, detalle: { usuario: actual.usuario }, ip });
    return { ok: true };
}

/** Restablece la contraseña, quita cualquier bloqueo y cierra las sesiones abiertas de ese usuario. */
async function resetPassword(db, id, input, { actorId = null, ip = null } = {}) {
    const actual = getUser(db, id);
    if (!actual) return noEncontrado;
    const { ok, values, errors } = parseForm(restablecerSchema, input);
    if (!ok) return { ok: false, errors };
    const hash = await hashPassword(values.password);
    db.prepare('UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?').run(hash, id);
    destroyUserSessions(db, id);
    audit.log(db, { usuarioId: actorId, accion: 'contrasena_restablecida', entidad: 'usuario', entidadId: id, detalle: { usuario: actual.usuario }, ip });
    return { ok: true };
}

/** Quita el bloqueo por intentos fallidos sin cambiar la contraseña. */
function unlockUser(db, id, { actorId = null, ip = null } = {}) {
    const actual = getUser(db, id);
    if (!actual) return noEncontrado;
    db.prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?').run(id);
    audit.log(db, { usuarioId: actorId, accion: 'usuario_desbloqueado', entidad: 'usuario', entidadId: id, detalle: { usuario: actual.usuario }, ip });
    return { ok: true };
}

module.exports = { createUser, updateUser, setActive, resetPassword, unlockUser, listUsers, getUser, countUsers, countActiveAdmins, destroyUserSessions };
