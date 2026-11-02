'use strict';
const express = require('express');
const { HttpError } = require('../middleware/errors');
const { requireModule } = require('../middleware/user');
const propietarios = require('../services/propietarios');
const mascotas = require('../services/mascotas');
const { pager } = require('../utils/pagination');
const { verTelefono } = require('../utils/validation');
const { idParam, texto } = require('./ajustes/comun');

const CAMPOS = ['nombre', 'cedula', 'telefono', 'correo', 'direccion'];
/** Lo escrito en el formulario, para devolverlo si hay errores. */
const valoresDe = (body) => ({
    ...Object.fromEntries(CAMPOS.map((c) => [c, texto(body[c])])),
    acepta_notificaciones: body.acepta_notificaciones === 'on',
});

// /clientes: propietarios de las mascotas. Los tres roles pueden verlos y editarlos (matriz de permisos).
function clientesRoutes({ db, now }) {
    const router = express.Router();
    router.use('/clientes', requireModule('clientes'));
    const ctx = (req) => ({ actorId: req.user.id, ip: req.ip, ahora: now() });

    const vistaCliente = (p) => ({
        ...p,
        telefonoTexto: verTelefono(p.telefono),
        estado: p.activo ? { clase: 'status-confirmed', texto: 'Activo' } : { clase: 'status-waiting', texto: 'Inactivo' },
    });

    const renderLista = (req, res, status, { errors = {}, values = null } = {}) => {
        const q = texto(req.query.q).trim().slice(0, 100);
        const inactivos = req.query.inactivos === '1';
        const datos = propietarios.listPropietarios(db, { q, inactivos, pagina: req.query.pagina });
        res.status(status).render('clientes/lista', {
            title: 'Clientes', active: 'clientes',
            filas: datos.filas.map(vistaCliente), total: datos.total, q, inactivos,
            errors, values: values || { acepta_notificaciones: true },
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/clientes', filtros: { q, inactivos: inactivos ? '1' : '' } }),
        });
    };

    router.get('/clientes', (req, res) => renderLista(req, res, 200));

    router.post('/clientes', (req, res) => {
        const body = req.body || {};
        const result = propietarios.createPropietario(db, body, ctx(req));
        if (!result.ok) return renderLista(req, res, 400, { errors: result.errors, values: valoresDe(body) });
        req.flash('ok', `Cliente "${texto(body.nombre).trim()}" creado. Ya puedes agregarle sus mascotas.`);
        return res.redirect(`/clientes/${result.id}`);
    });

    const renderFicha = (req, res, status, id, { errors = {}, values = null } = {}) => {
        const p = propietarios.getPropietario(db, id);
        if (!p) throw new HttpError(404);
        const lista = mascotas.mascotasDe(db, id).map((m) => ({
            ...m, estadoTexto: mascotas.ESTADO_TEXTO[m.estado], edad: mascotas.edadDe(m, now()),
        }));
        res.status(status).render('clientes/ficha', {
            title: p.nombre, active: 'clientes', c: vistaCliente(p), mascotas: lista,
            activas: lista.filter((m) => m.estado === 'activa').length,
            errors, values: values || propietarios.paraFormulario(p),
        });
    };

    router.get('/clientes/:id', (req, res) => renderFicha(req, res, 200, idParam(req)));

    router.post('/clientes/:id', (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const result = propietarios.updatePropietario(db, id, body, ctx(req));
        if (result.notFound) throw new HttpError(404);
        if (result.errors) return renderFicha(req, res, 400, id, { errors: result.errors, values: valoresDe(body) });
        req.flash('ok', result.sinCambios ? 'No había cambios que guardar.' : 'Cliente guardado.');
        return res.redirect(`/clientes/${id}`);
    });

    router.post('/clientes/:id/estado', (req, res) => {
        const id = idParam(req);
        const accion = req.body && req.body.accion;
        if (accion !== 'activar' && accion !== 'desactivar') throw new HttpError(400, 'Acción no válida.');
        const result = propietarios.setActivo(db, id, accion === 'activar', ctx(req));
        if (result.notFound) throw new HttpError(404);
        if (!result.ok) req.flash('error', result.error);
        else req.flash('ok', result.sinCambios ? 'No había cambios que guardar.' : accion === 'activar' ? 'Cliente reactivado.' : 'Cliente desactivado. Su historial se conserva.');
        return res.redirect(`/clientes/${id}`);
    });

    return router;
}

module.exports = { clientesRoutes };
