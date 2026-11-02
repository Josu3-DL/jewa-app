'use strict';
const express = require('express');
const { z } = require('../utils/validation');
const { ROLES, ROLE_LABELS } = require('../roles');
const { requireModule } = require('../middleware/user');
const { HttpError } = require('../middleware/errors');
const users = require('../services/users');
const audit = require('../services/audit');
const { initials, formatDateTime } = require('../utils/dates');
const { pager } = require('../utils/pagination');

const idSchema = z.coerce.number().int().positive();
const texto = (v) => (typeof v === 'string' ? v : '');

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

function ajustesRoutes({ db, now }) {
    const router = express.Router();
    // Todo /ajustes es solo para administradores (T-03).
    router.use('/ajustes', requireModule('ajustes'));

    const ctx = (req) => ({ actorId: req.user.id, ip: req.ip });
    const userId = (req) => {
        const r = idSchema.safeParse(req.params.id);
        if (!r.success) throw new HttpError(404);
        return r.data;
    };
    const roles = ROLES.map((valor) => ({ valor, texto: ROLE_LABELS[valor] }));

    router.get('/ajustes', (req, res) => {
        res.render('ajustes/clinica', { title: 'Ajustes', active: 'ajustes', tab: 'clinica' });
    });

    // ───────── Usuarios
    const renderUsuarios = (req, res, status, { errors = {}, values = {} } = {}) => {
        res.status(status).render('ajustes/usuarios', {
            title: 'Usuarios', active: 'ajustes', tab: 'usuarios',
            usuarios: users.listUsers(db).map((u) => vista(u, now())), roles, errors, values,
        });
    };

    router.get('/ajustes/usuarios', (req, res) => renderUsuarios(req, res, 200));

    router.post('/ajustes/usuarios', async (req, res) => {
        const body = req.body || {};
        const result = await users.createUser(db, {
            nombre: body.nombre, usuario: body.usuario, rol: body.rol, colegiado: body.colegiado,
            atiende_citas: body.atiende_citas === 'on', password: body.password, password2: body.password2,
        }, ctx(req));
        if (!result.ok) {
            return renderUsuarios(req, res, 400, {
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

    router.get('/ajustes/usuarios/:id/editar', (req, res) => renderEditar(req, res, 200, userId(req)));

    /** Respuesta común de las acciones sobre un usuario. */
    const responder = (req, res, id, result, mensajeOk) => {
        if (result.notFound) throw new HttpError(404);
        if (result.ok) req.flash('ok', result.sinCambios ? 'No había cambios que guardar.' : mensajeOk);
        else req.flash('error', result.message || 'No se pudo completar la acción.');
        return res.redirect(`/ajustes/usuarios/${id}/editar`);
    };

    router.post('/ajustes/usuarios/:id', (req, res) => {
        const id = userId(req);
        const body = req.body || {};
        const result = users.updateUser(db, id, { nombre: body.nombre, rol: body.rol, colegiado: body.colegiado, atiende_citas: body.atiende_citas === 'on' }, ctx(req));
        if (result.errors) {
            return renderEditar(req, res, 400, id, {
                errDatos: result.errors,
                values: { nombre: texto(body.nombre), rol: texto(body.rol), colegiado: texto(body.colegiado), atiende_citas: body.atiende_citas === 'on' },
            });
        }
        return responder(req, res, id, result, 'Datos guardados.');
    });

    router.post('/ajustes/usuarios/:id/contrasena', async (req, res) => {
        const id = userId(req);
        const body = req.body || {};
        const result = await users.resetPassword(db, id, { password: body.password, password2: body.password2 }, ctx(req));
        if (result.errors) return renderEditar(req, res, 400, id, { errPass: result.errors });
        return responder(req, res, id, result, 'Contraseña restablecida. Se cerraron las sesiones abiertas de ese usuario.');
    });

    router.post('/ajustes/usuarios/:id/estado', (req, res) => {
        const id = userId(req);
        const accion = req.body && req.body.accion;
        if (accion !== 'activar' && accion !== 'desactivar') throw new HttpError(400, 'Acción no válida.');
        const result = users.setActive(db, id, accion === 'activar', ctx(req));
        return responder(req, res, id, result, accion === 'activar' ? 'Usuario reactivado.' : 'Usuario desactivado. Se cerraron sus sesiones.');
    });

    router.post('/ajustes/usuarios/:id/desbloquear', (req, res) => {
        const id = userId(req);
        return responder(req, res, id, users.unlockUser(db, id, ctx(req)), 'Cuenta desbloqueada.');
    });

    // ───────── Bitácora
    router.get('/ajustes/bitacora', (req, res) => {
        const { filtros, errores } = audit.leerFiltros(req.query);
        const datos = audit.consultar(db, filtros);
        const filas = datos.filas.map((f) => ({
            id: f.id,
            fecha: formatDateTime(f.fecha),
            usuario: f.usuario_nombre ? `${f.usuario_nombre} (${f.usuario_login})` : 'Sistema / sin sesión',
            accion: audit.etiquetaAccion(f.accion),
            entidad: `${audit.etiquetaEntidad(f.entidad)}${f.entidad_id ? ` #${f.entidad_id}` : ''}`,
            detalle: audit.detalleATexto(f.detalle),
            ip: f.ip || '',
        }));
        res.render('ajustes/bitacora', {
            title: 'Bitácora', active: 'ajustes', tab: 'bitacora',
            filas, total: datos.total, errores, filtros,
            usuarios: users.listUsers(db),
            entidades: audit.entidadesRegistradas(db).map((valor) => ({ valor, texto: audit.etiquetaEntidad(valor) })),
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/ajustes/bitacora', filtros: { usuario: filtros.usuario, entidad: filtros.entidad, desde: filtros.desde, hasta: filtros.hasta } }),
        });
    });

    return router;
}

module.exports = { ajustesRoutes };
