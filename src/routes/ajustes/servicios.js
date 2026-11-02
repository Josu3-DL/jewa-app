'use strict';
const express = require('express');
const { HttpError } = require('../../middleware/errors');
const servicios = require('../../services/servicios');
const { getSettings } = require('../../services/settings');
const { formatMoney } = require('../../utils/money');
const { idParam, contexto, texto } = require('./comun');

const CAMPOS = ['nombre', 'tipo', 'precio', 'duracion'];
const valoresDe = (body) => Object.fromEntries(CAMPOS.map((c) => [c, texto(body[c])]));

// Montado en /ajustes/servicios.
function serviciosRoutes({ db }) {
    const router = express.Router();

    /** Servicio listo para la vista: tipo legible, precio con formato y aviso si no tiene precio. */
    const vista = (s, moneda) => ({
        ...s,
        tipoTexto: servicios.TIPO_TEXTO[s.tipo] || s.tipo,
        precioTexto: formatMoney(s.precio, moneda),
        sinPrecio: s.activo === 1 && s.precio === 0,
        estado: s.activo ? { clase: 'status-confirmed', texto: 'Activo' } : { clase: 'status-waiting', texto: 'Inactivo' },
    });
    const dePrecio = (centavos) => `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;

    const renderLista = (req, res, status, { errors = {}, values = {} } = {}) => {
        const moneda = getSettings(db).moneda;
        const lista = servicios.listServicios(db).map((s) => vista(s, moneda));
        res.status(status).render('ajustes/servicios', {
            title: 'Servicios', active: 'ajustes', tab: 'servicios',
            servicios: lista, sinPrecio: lista.filter((s) => s.sinPrecio).length,
            tipos: servicios.TIPOS, errors, values: { tipo: 'consulta', duracion: '30', ...values },
        });
    };

    router.get('/', (req, res) => renderLista(req, res, 200));

    router.post('/', (req, res) => {
        const body = req.body || {};
        const result = servicios.createServicio(db, body, contexto(req));
        if (!result.ok) return renderLista(req, res, 400, { errors: result.errors, values: valoresDe(body) });
        req.flash('ok', `Servicio "${texto(body.nombre).trim()}" creado.`);
        return res.redirect('/ajustes/servicios');
    });

    const renderEditar = (req, res, status, id, { errors = {}, values = null } = {}) => {
        const s = servicios.getServicio(db, id);
        if (!s) throw new HttpError(404);
        res.status(status).render('ajustes/servicio-editar', {
            title: `Editar ${s.nombre}`, active: 'ajustes', tab: 'servicios',
            s: vista(s, getSettings(db).moneda), tipos: servicios.TIPOS, errors,
            values: values || { nombre: s.nombre, tipo: s.tipo, precio: dePrecio(s.precio), duracion: String(s.duracion_min) },
        });
    };

    router.get('/:id/editar', (req, res) => renderEditar(req, res, 200, idParam(req)));

    router.post('/:id', (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const result = servicios.updateServicio(db, id, body, contexto(req));
        if (result.notFound) throw new HttpError(404);
        if (result.errors) return renderEditar(req, res, 400, id, { errors: result.errors, values: valoresDe(body) });
        req.flash('ok', result.sinCambios ? 'No había cambios que guardar.' : 'Servicio guardado.');
        return res.redirect(`/ajustes/servicios/${id}/editar`);
    });

    router.post('/:id/estado', (req, res) => {
        const id = idParam(req);
        const accion = req.body && req.body.accion;
        if (accion !== 'activar' && accion !== 'desactivar') throw new HttpError(400, 'Acción no válida.');
        const result = servicios.setActivo(db, id, accion === 'activar', contexto(req));
        if (result.notFound) throw new HttpError(404);
        req.flash('ok', result.sinCambios ? 'No había cambios que guardar.' : accion === 'activar' ? 'Servicio reactivado.' : 'Servicio desactivado. Las citas y ventas anteriores no cambian.');
        return res.redirect(`/ajustes/servicios/${id}/editar`);
    });

    return router;
}

module.exports = { serviciosRoutes };
