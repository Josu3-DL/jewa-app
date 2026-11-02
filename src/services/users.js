'use strict';
const { hashPassword, passwordPolicyError } = require('./passwords');
const { ROLES } = require('../roles');
const { v, validate } = require('../utils/validation');
const audit = require('./audit');

const userSchema = {
    nombre: v.text({ label: 'Nombre', required: true, max: 100 }),
    usuario: v.text({ label: 'Usuario', required: true, min: 3, max: 50 }),
    rol: v.choice(ROLES, { label: 'Rol', required: true }),
};

/**
 * Crea un usuario. Devuelve { ok, id } o { ok: false, errors }.
 * (El CRUD completo de usuarios llega con ISS-04; esto permite crear el primer administrador.)
 */
async function createUser(db, input, { actorId = null, ip = null } = {}) {
    const { ok, values, errors } = validate(input, userSchema);
    if (ok && !/^[A-Za-z0-9._-]+$/.test(values.usuario)) errors.usuario = 'El usuario solo admite letras, números, punto, guion y guion bajo.';
    const passError = passwordPolicyError(input && input.password);
    if (passError) errors.password = passError;
    if (Object.keys(errors).length) return { ok: false, errors };

    if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(values.usuario)) {
        return { ok: false, errors: { usuario: 'Ya existe un usuario con ese nombre.' } };
    }
    const hash = await hashPassword(input.password);
    const result = db.prepare('INSERT INTO usuarios (nombre, usuario, password_hash, rol, atiende_citas) VALUES (?, ?, ?, ?, ?)')
        .run(values.nombre, values.usuario, hash, values.rol, values.rol === 'veterinario' ? 1 : 0);
    const id = Number(result.lastInsertRowid);
    audit.log(db, { usuarioId: actorId, accion: 'usuario_creado', entidad: 'usuario', entidadId: id, detalle: { usuario: values.usuario, rol: values.rol }, ip });
    return { ok: true, id };
}

function countUsers(db, rol = null) {
    return rol
        ? db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE rol = ?').get(rol).n
        : db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
}

module.exports = { createUser, countUsers };
