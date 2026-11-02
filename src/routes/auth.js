'use strict';
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z, texto, parseForm } = require('../utils/validation');
const { authenticate } = require('../services/auth');
const audit = require('../services/audit');
const { isSafeNext } = require('../middleware/user');
const { COOKIE_NAME } = require('../middleware/session');

const GENERIC_ERROR = 'Usuario o contraseña incorrectos.';

const loginSchema = z.object({
    usuario: texto({ max: 50 }),
    // Sin recortar espacios: la contraseña se compara tal cual
    password: z.string({ error: 'Ingresa tu contraseña.' }).min(1, 'Ingresa tu contraseña.').max(200, 'Máximo 200 caracteres.'),
});

const run = (session, method) => new Promise((resolve, reject) => {
    session[method]((error) => (error ? reject(error) : resolve()));
});

function authRoutes({ db, now }) {
    const router = express.Router();

    const renderLogin = (req, res, status, { message = null, errors = {}, values = {} } = {}) => {
        const next = isSafeNext(req.body && req.body.next) ? req.body.next : (isSafeNext(req.query.next) ? req.query.next : '');
        res.status(status).render('login', { title: 'Iniciar sesión', message, errors, values, next });
    };

    // Freno por IP (además del bloqueo por cuenta): evita probar contraseñas contra muchas cuentas
    // desde un mismo equipo. Solo cuenta los intentos fallidos.
    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        skipSuccessfulRequests: true,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (req, res) => renderLogin(req, res, 429, { message: 'Demasiados intentos desde este equipo. Espera unos minutos e inténtalo de nuevo.' }),
    });

    router.get('/login', (req, res) => {
        if (req.user) return res.redirect('/');
        return renderLogin(req, res, 200);
    });

    router.post('/login', loginLimiter, async (req, res) => {
        const { ok, values, errors } = parseForm(loginSchema, req.body);
        if (!ok) return renderLogin(req, res, 400, { errors, values: { usuario: (req.body && typeof req.body.usuario === 'string' ? req.body.usuario : '') } });

        const result = await authenticate(db, { usuario: values.usuario, password: values.password, ip: req.ip, now: now() });
        if (!result.ok) {
            const message = result.reason === 'bloqueado'
                ? `Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en ${result.minutes} minuto${result.minutes === 1 ? '' : 's'}.`
                : GENERIC_ERROR;
            return renderLogin(req, res, result.reason === 'bloqueado' ? 429 : 401, { message, values: { usuario: values.usuario } });
        }

        // Nueva sesión tras autenticar: evita la fijación de sesión.
        await run(req.session, 'regenerate');
        req.session.userId = result.user.id;
        req.session.loginAt = now().getTime();
        await run(req.session, 'save');
        const target = isSafeNext(req.body.next) ? req.body.next : '/';
        return res.redirect(target);
    });

    router.post('/logout', async (req, res) => {
        if (req.user) audit.log(db, { usuarioId: req.user.id, accion: 'logout', entidad: 'usuario', entidadId: req.user.id, ip: req.ip, fecha: now() });
        await run(req.session, 'destroy');
        res.clearCookie(COOKIE_NAME);
        res.redirect('/login');
    });

    return router;
}

module.exports = { authRoutes };
