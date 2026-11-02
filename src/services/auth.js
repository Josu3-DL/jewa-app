'use strict';
const { verifyPassword, hashPassword } = require('./passwords');
const audit = require('./audit');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Hash de relleno: se verifica contra él cuando el usuario no existe para que
// la respuesta tarde lo mismo y no revele qué usuarios existen.
let dummyHash = null;
async function getDummyHash() {
    if (!dummyHash) dummyHash = await hashPassword('relleno-para-igualar-tiempos');
    return dummyHash;
}

const minutesLeft = (until, now) => Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60000));

/**
 * Valida usuario y contraseña.
 * Devuelve { ok: true, user } o { ok: false, reason: 'credenciales' | 'bloqueado', minutes? }.
 * Bloquea la cuenta LOCK_MINUTES minutos tras MAX_FAILED_ATTEMPTS fallos seguidos.
 */
async function authenticate(db, { usuario, password, ip = null, now = new Date() }) {
    const row = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);

    if (!row) {
        await verifyPassword(password, await getDummyHash());
        audit.log(db, { accion: 'login_fallido', entidad: 'usuario', detalle: { motivo: 'usuario_desconocido' }, ip, fecha: now });
        return { ok: false, reason: 'credenciales' };
    }

    if (row.bloqueado_hasta && new Date(row.bloqueado_hasta) > now) {
        audit.log(db, { usuarioId: row.id, accion: 'login_bloqueado', entidad: 'usuario', entidadId: row.id, ip, fecha: now });
        return { ok: false, reason: 'bloqueado', minutes: minutesLeft(new Date(row.bloqueado_hasta), now) };
    }

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid || !row.activo) {
        if (!row.activo) {
            audit.log(db, { usuarioId: row.id, accion: 'login_fallido', entidad: 'usuario', entidadId: row.id, detalle: { motivo: 'usuario_inactivo' }, ip, fecha: now });
            return { ok: false, reason: 'credenciales' };
        }
        const attempts = row.intentos_fallidos + 1;
        if (attempts >= MAX_FAILED_ATTEMPTS) {
            const until = new Date(now.getTime() + LOCK_MINUTES * 60000);
            db.prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = ? WHERE id = ?').run(until.toISOString(), row.id);
            audit.log(db, { usuarioId: row.id, accion: 'cuenta_bloqueada', entidad: 'usuario', entidadId: row.id, detalle: { minutos: LOCK_MINUTES }, ip, fecha: now });
            return { ok: false, reason: 'bloqueado', minutes: LOCK_MINUTES };
        }
        db.prepare('UPDATE usuarios SET intentos_fallidos = ? WHERE id = ?').run(attempts, row.id);
        audit.log(db, { usuarioId: row.id, accion: 'login_fallido', entidad: 'usuario', entidadId: row.id, detalle: { intento: attempts }, ip, fecha: now });
        return { ok: false, reason: 'credenciales' };
    }

    db.prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?').run(row.id);
    audit.log(db, { usuarioId: row.id, accion: 'login', entidad: 'usuario', entidadId: row.id, ip, fecha: now });
    return { ok: true, user: publicUser(row) };
}

/** Campos del usuario que pueden vivir en req.user (nunca el hash). */
function publicUser(row) {
    return { id: row.id, nombre: row.nombre, usuario: row.usuario, rol: row.rol, colegiado: row.colegiado, atiende_citas: row.atiende_citas };
}

/** Carga un usuario activo por id, o null. Se usa en cada petición con sesión. */
function findActiveUser(db, id) {
    const row = db.prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1').get(id);
    return row ? publicUser(row) : null;
}

module.exports = { authenticate, findActiveUser, publicUser, MAX_FAILED_ATTEMPTS, LOCK_MINUTES };
