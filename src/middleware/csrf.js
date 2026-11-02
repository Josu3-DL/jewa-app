'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('./errors');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MESSAGE = 'El formulario expiró o no es válido. Recarga la página e inténtalo de nuevo.';

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Protección CSRF con token por sesión.
 * - Las vistas llaman `csrfToken()` (se crea la sesión solo si hace falta).
 * - Todo método no seguro debe traer `_csrf` en el cuerpo o la cabecera `X-CSRF-Token`.
 * - Si llega `Origin`, debe coincidir con el host de la petición.
 */
function csrf() {
    return (req, res, next) => {
        const ensure = () => {
            if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
            return req.session.csrf;
        };
        req.csrfToken = ensure;
        res.locals.csrfToken = ensure;

        if (SAFE_METHODS.has(req.method)) return next();

        const origin = req.headers.origin;
        if (origin !== undefined) {
            let host = null;
            try { host = new URL(origin).host; } catch { /* origen inválido */ }
            if (!host || host !== req.headers.host) return next(new HttpError(403, MESSAGE));
        }

        const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
        const expected = req.session && req.session.csrf;
        if (!expected || !sent || !safeEqual(sent, expected)) return next(new HttpError(403, MESSAGE));
        return next();
    };
}

module.exports = { csrf, SAFE_METHODS };
