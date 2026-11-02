'use strict';
const express = require('express');
const { v, validate } = require('../utils/validation');
const { authenticate } = require('../services/auth');
const audit = require('../services/audit');
const { isSafeNext } = require('../middleware/user');
const { COOKIE_NAME } = require('../middleware/session');

const GENERIC_ERROR = 'Usuario o contraseña incorrectos.';

const passwordRule = (raw) => (typeof raw === 'string' && raw.length > 0 && raw.length <= 200
    ? { value: raw }
    : { error: 'Ingresa tu contraseña.' });

const loginSchema = {
    usuario: v.text({ label: 'Usuario', required: true, max: 50 }),
    password: passwordRule,
};

const run = (session, method) => new Promise((resolve, reject) => {
    session[method]((error) => (error ? reject(error) : resolve()));
});

function authRoutes({ db, now }) {
    const router = express.Router();

    const renderLogin = (req, res, status, { message = null, errors = {}, values = {} } = {}) => {
        const next = isSafeNext(req.body && req.body.next) ? req.body.next : (isSafeNext(req.query.next) ? req.query.next : '');
        res.status(status).render('login', { title: 'Iniciar sesión', message, errors, values, next });
    };

    router.get('/login', (req, res) => {
        if (req.user) return res.redirect('/');
        return renderLogin(req, res, 200);
    });

    router.post('/login', async (req, res) => {
        const { ok, values, errors } = validate(req.body, loginSchema);
        if (!ok) return renderLogin(req, res, 400, { errors, values: { usuario: values.usuario || '' } });

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
