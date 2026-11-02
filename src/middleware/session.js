'use strict';
const session = require('express-session');

const COOKIE_NAME = 'jewa.sid';
// Tope absoluto de una sesión aunque haya actividad continua.
const MAX_SESSION_HOURS = 12;

/** Almacén de sesiones en la tabla `sesiones` de SQLite (sin dependencias nativas). */
class SqliteStore extends session.Store {
    constructor(db, { now = () => new Date() } = {}) {
        super();
        this.db = db;
        this.now = now;
    }

    get(sid, callback) {
        try {
            const row = this.db.prepare('SELECT datos, expira_en FROM sesiones WHERE sid = ?').get(sid);
            if (!row) return callback(null, null);
            if (new Date(row.expira_en) <= this.now()) {
                this.db.prepare('DELETE FROM sesiones WHERE sid = ?').run(sid);
                return callback(null, null);
            }
            return callback(null, JSON.parse(row.datos));
        } catch (error) {
            return callback(error);
        }
    }

    set(sid, data, callback) {
        try {
            const expires = data.cookie && data.cookie.expires ? new Date(data.cookie.expires) : new Date(this.now().getTime() + 30 * 60000);
            this.db.prepare(`INSERT INTO sesiones (sid, datos, expira_en) VALUES (?, ?, ?)
                             ON CONFLICT(sid) DO UPDATE SET datos = excluded.datos, expira_en = excluded.expira_en`)
                .run(sid, JSON.stringify(data), expires.toISOString());
            return callback && callback(null);
        } catch (error) {
            return callback && callback(error);
        }
    }

    touch(sid, data, callback) {
        return this.set(sid, data, callback);
    }

    destroy(sid, callback) {
        try {
            this.db.prepare('DELETE FROM sesiones WHERE sid = ?').run(sid);
            return callback && callback(null);
        } catch (error) {
            return callback && callback(error);
        }
    }

    /** Borra las sesiones vencidas. */
    purgeExpired() {
        return this.db.prepare('DELETE FROM sesiones WHERE expira_en <= ?').run(this.now().toISOString()).changes;
    }
}

function createSession({ db, config }) {
    // El almacén usa el reloj real, igual que express-session al calcular la expiración de la cookie.
    const store = new SqliteStore(db);
    try { store.purgeExpired(); } catch { /* la BD puede no estar disponible al arrancar; /salud lo reporta */ }
    const timer = setInterval(() => { try { store.purgeExpired(); } catch { /* la BD pudo cerrarse */ } }, 60 * 60 * 1000);
    timer.unref();
    const middleware = session({
        name: COOKIE_NAME,
        secret: config.sessionSecret,
        store,
        resave: false,
        saveUninitialized: false,
        rolling: true, // cada petición renueva el plazo: expira por inactividad
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: config.cookieSecure,
            maxAge: config.sessionMinutes * 60 * 1000,
        },
    });
    return { middleware, store };
}

module.exports = { createSession, SqliteStore, COOKIE_NAME, MAX_SESSION_HOURS };
