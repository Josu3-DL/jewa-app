'use strict';
const express = require('express');
const { ROLES, ROLE_LABELS } = require('../../roles');
const { HttpError } = require('../../middleware/errors');
const users = require('../../services/users');
const { initials, formatDateTime } = require('../../utils/dates');
const { idParam, contexto, texto } = require('./comun');

/** Usuario listo para la vista (rol legible, iniciales, estado). */
function vista(u, now) {
    const bloqueado = Boolean(u.bloqueado_hasta && new Date(u.bloqueado_hasta) > now);
    return {
        ...u,
        initials: initials(u.nombre),
        rolLabel: ROLE_LABELS[u.rol] || u.rol,
        bloqueado,
        estado: !u.activo ? { clase: 'status-waiting', texto: 'Inactivo' } : bloqueado ? { clase: 'status-cancelled', texto: 'Bloqueado' } : { clase: 'status-confirmed', texto: 'Activo' },
    };
}

// Montado en /ajustes/usuarios (el acceso solo para administradores lo exige routes/ajustes/index.js).
function usuariosRoutes({ db, now }) {
    const router = express.Router();
    const roles = ROLES.map((valor) => ({ valor, texto: ROLE_LABELS[valor] }));

    const renderLista = (req, res, status, { errors = {}, values = {} } = {}) => {
        res.status(status).render('ajustes/usuarios', {
            title: 'Usuarios', active: 'ajustes', tab: 'usuarios',
            usuarios: users.listUsers(db).map((u) => vista(u, now())), roles, errors, values,
        });
    };

    router.get('/', (req, res) => renderLista(req, res, 200));

    router.post('/', async (req, res) => {
        const body = req.body || {};
        const result = await users.createUser(db, {
            nombre: body.nombre, usuario: body.usuario, rol: body.rol, colegiado: body.colegiado,
            atiende_citas: body.atiende_citas === 'on', password: body.password, password2: body.password2,
        }, contexto(req));
        if (!result.ok) {
            return renderLista(req, res, 400, {
                errors: result.errors,
                // Nunca se devuelven las contraseñas al formulario
                values: { nombre: texto(body.nombre), usuario: texto(body.usuario), rol: texto(body.rol), colegiado: texto(body.colegiado), atiende_citas: body.atiende_citas === 'on' },
            });
        }
        req.flash('ok', `Usuario "${texto(body.usuario).trim()}" creado.`);
        return res.redirect('/ajustes/usuarios');
    });

    const renderEditar = (req, res, status, id, { errDatos = {}, errPass = {}, values = null } = {}) => {
        const u = users.getUser(db, id);
        if (!u) throw new HttpError(404);
        res.status(status).render('ajustes/usuario-editar', {
            title: `Editar a ${u.nombre}`, active: 'ajustes', tab: 'usuarios',
            u: vista(u, now()), roles, errDatos, errPass, esYo: u.id === req.user.id,
            creado: formatDateTime(u.creado_en),
            bloqueadoHasta: u.bloqueado_hasta ? formatDateTime(u.bloqueado_hasta) : '',
            values: values || { nombre: u.nombre, rol: u.rol, colegiado: u.colegiado || '', atiende_citas: Boolean(u.atiende_citas) },
        });
    };

    router.get('/:id/editar', (req, res) => renderEditar(req, res, 200, idParam(req)));

    /** Respuesta común de las acciones sobre un usuario. */
    const responder = (req, res, id, result, mensajeOk) => {
        if (result.notFound) throw new HttpError(404);
        if (result.ok) req.flash('ok', result.sinCambios ? 'No había cambios que guardar.' : mensajeOk);
        else req.flash('error', result.message || 'No se pudo completar la acción.');
        return res.redirect(`/ajustes/usuarios/${id}/editar`);
    };

    router.post('/:id', (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const result = users.updateUser(db, id, { nombre: body.nombre, rol: body.rol, colegiado: body.colegiado, atiende_citas: body.atiende_citas === 'on' }, contexto(req));
        if (result.errors) {
            return renderEditar(req, res, 400, id, {
                errDatos: result.errors,
                values: { nombre: texto(body.nombre), rol: texto(body.rol), colegiado: texto(body.colegiado), atiende_citas: body.atiende_citas === 'on' },
            });
        }
        return responder(req, res, id, result, 'Datos guardados.');
    });

    router.post('/:id/contrasena', async (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const result = await users.resetPassword(db, id, { password: body.password, password2: body.password2 }, contexto(req));
        if (result.errors) return renderEditar(req, res, 400, id, { errPass: result.errors });
        return responder(req, res, id, result, 'Contraseña restablecida. Se cerraron las sesiones abiertas de ese usuario.');
    });

    router.post('/:id/estado', (req, res) => {
        const id = idParam(req);
        const accion = req.body && req.body.accion;
        if (accion !== 'activar' && accion !== 'desactivar') throw new HttpError(400, 'Acción no válida.');
        const result = users.setActive(db, id, accion === 'activar', contexto(req));
        return responder(req, res, id, result, accion === 'activar' ? 'Usuario reactivado.' : 'Usuario desactivado. Se cerraron sus sesiones.');
    });

    router.post('/:id/desbloquear', (req, res) => {
        const id = idParam(req);
        return responder(req, res, id, users.unlockUser(db, id, contexto(req)), 'Cuenta desbloqueada.');
    });

    return router;
}

module.exports = { usuariosRoutes };
