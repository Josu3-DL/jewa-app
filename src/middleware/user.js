'use strict';
const { HttpError } = require('./errors');
const { canAccess } = require('../modules');
const { findActiveUser } = require('../services/auth');
const { MAX_SESSION_HOURS } = require('./session');

/**
 * Resuelve el usuario de la sesión en cada petición (así un usuario desactivado o con
 * otro rol pierde el acceso de inmediato) y lo expone en req.user y res.locals.user.
 * `resolveUser` permite inyectar otro origen en pruebas.
 */
function attachUser({ db, now = () => new Date(), resolveUser }) {
    return (req, res, next) => {
        let user = null;
        if (resolveUser) {
            user = resolveUser(req) || null;
        } else if (req.session && req.session.userId) {
            const age = now().getTime() - (req.session.loginAt || 0);
            user = age > MAX_SESSION_HOURS * 3600 * 1000 ? null : findActiveUser(db, req.session.userId);
            if (!user) {
                delete req.session.userId;
                delete req.session.loginAt;
            }
        }
        req.user = user;
        res.locals.user = user;
        next();
    };
}

const wantsHtml = (req) => req.method === 'GET' && req.accepts(['html', 'json']) === 'html';

/** Redirige a /login las páginas y responde 401 en el resto de casos. */
function requireAuth(req, res, next) {
    if (req.user) return next();
    if (wantsHtml(req)) {
        const target = req.originalUrl;
        const safe = isSafeNext(target) && target !== '/';
        return res.redirect(safe ? `/login?next=${encodeURIComponent(target)}` : '/login');
    }
    return next(new HttpError(401, 'Inicia sesión para continuar.'));
}

/** Exige sesión y que el rol tenga acceso al módulo (ver src/modules.js). */
function requireModule(key) {
    return (req, res, next) => {
        if (!req.user) return requireAuth(req, res, next);
        if (!canAccess(req.user.rol, key)) return next(new HttpError(403));
        return next();
    };
}

/** Solo rutas internas: evita redirecciones abiertas (//otro.sitio, /\otro.sitio, https://...). */
function isSafeNext(value) {
    return typeof value === 'string'
        && value.length <= 200
        && /^\/(?![/\\])/.test(value)
        && !/[\u0000-\u001F]/.test(value)
        && !value.startsWith('/login')
        && !value.startsWith('/logout');
}

module.exports = { attachUser, requireAuth, requireModule, isSafeNext };
