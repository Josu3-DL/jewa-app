'use strict';
const { HttpError } = require('./errors');
const { canAccess } = require('../modules');

/**
 * Resuelve el usuario actual y lo expone en req.user y res.locals.user.
 * Hasta ISS-03 (sesiones) el único usuario posible es el simulado de DEV_ROLE,
 * que config.js prohíbe en producción. Sin usuario, todo módulo responde 403.
 * `resolveUser` permite inyectar otro origen (pruebas, y luego la sesión).
 */
function attachUser(config, resolveUser) {
    const resolve = resolveUser || (() => (config.devRole
        ? { id: 0, nombre: 'Usuario de prueba', usuario: 'dev', rol: config.devRole, simulated: true }
        : null));
    return (req, res, next) => {
        req.user = resolve(req) || null;
        res.locals.user = req.user;
        next();
    };
}

/** Exige que el rol del usuario tenga acceso al módulo (ver src/modules.js). */
function requireModule(key) {
    return (req, res, next) => {
        if (!req.user || !canAccess(req.user.rol, key)) return next(new HttpError(403));
        return next();
    };
}

module.exports = { attachUser, requireModule };
