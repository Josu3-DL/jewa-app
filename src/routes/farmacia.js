'use strict';
const express = require('express');
const { HttpError } = require('../middleware/errors');
const { requireModule } = require('../middleware/user');
const productos = require('../services/productos');
const { formatDateTime } = require('../utils/dates');
const { pager } = require('../utils/pagination');
const { idParam, texto } = require('./ajustes/comun');

const CAMPOS = ['codigo', 'nombre', 'categoria', 'presentacion', 'unidad', 'precio', 'stock_minimo', 'stock_inicial'];
const valoresDe = (body) => ({ ...Object.fromEntries(CAMPOS.map((c) => [c, texto(body[c])])), es_medicamento: body.es_medicamento === 'on' });
const TIPO_TEXTO = { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', reversa: 'Reversa' };

// /farmacia: productos y stock simple (D-41). Ver: los tres roles. Crear/editar, entradas y ajustes: solo el administrador.
function farmaciaRoutes({ db, now }) {
    const router = express.Router();
    router.use('/farmacia', requireModule('farmacia'));
    const soloAdmin = (req, res, next) => (req.user.rol === 'admin' ? next() : next(new HttpError(403, 'Solo el administrador modifica productos y stock.')));
    const ctx = (req) => ({ actorId: req.user.id, ip: req.ip, ahora: now() });

    const vista = (p) => ({
        ...p, bajo: p.activo === 1 && p.stock_minimo > 0 && p.stock <= p.stock_minimo, sinExistencias: p.stock === 0,
        precioTexto: p.precio, // se formatea en la vista con dinero()
    });

    // ───── Lista
    const lista = (req, res, status, { errors = {}, values = null } = {}) => {
        const q = texto(req.query.q).trim().slice(0, 100);
        const bajo = req.query.bajo === '1';
        const inactivos = req.query.inactivos === '1';
        const datos = productos.listProductos(db, { q, bajo, inactivos, pagina: req.query.pagina });
        res.status(status).render('farmacia/lista', {
            title: 'Farmacia', active: 'farmacia', filas: datos.filas.map(vista), total: datos.total, q, bajo, inactivos,
            alertas: productos.productosBajoMinimo(db), categorias: productos.CATEGORIAS, errors,
            values: values || { categoria: 'Medicamento', unidad: 'unidad', precio: '0', stock_minimo: '0', stock_inicial: '', es_medicamento: false },
            esAdmin: req.user.rol === 'admin',
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/farmacia', filtros: { q, bajo: bajo ? '1' : '', inactivos: inactivos ? '1' : '' } }),
        });
    };

    router.get('/farmacia', (req, res) => lista(req, res, 200));

    router.post('/farmacia', soloAdmin, (req, res) => {
        const body = req.body || {};
        const r = productos.createProducto(db, body, ctx(req));
        if (!r.ok) return lista(req, res, 400, { errors: r.errors, values: valoresDe(body) });
        req.flash('ok', `Producto "${texto(body.nombre).trim()}" creado.`);
        return res.redirect(`/farmacia/${r.id}`);
    });

    // ───── Ficha del producto
    const ficha = (req, res, status, id, extra = {}) => {
        const p = productos.getProducto(db, id);
        if (!p) throw new HttpError(404);
        const mov = productos.listMovimientos(db, id, req.query.pagina);
        res.status(status).render('farmacia/ficha', {
            title: p.nombre, active: 'farmacia', p: vista(p), categorias: productos.CATEGORIAS, esAdmin: req.user.rol === 'admin',
            movimientos: mov.filas.map((m) => ({ ...m, fechaTexto: formatDateTime(m.fecha), tipoTexto: TIPO_TEXTO[m.tipo] || m.tipo })), totalMov: mov.total,
            pager: pager({ pagina: mov.pagina, paginas: mov.paginas, total: mov.total, ruta: `/farmacia/${id}`, filtros: {} }),
            errors: {}, values: productos.paraFormulario(p), errE: {}, valE: {}, errA: {}, valA: { sentido: 'sumar' }, ...extra,
        });
    };

    router.get('/farmacia/:id', (req, res) => ficha(req, res, 200, idParam(req)));

    router.post('/farmacia/:id', soloAdmin, (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const r = productos.updateProducto(db, id, body, ctx(req));
        if (r.notFound) throw new HttpError(404);
        if (r.errors) return ficha(req, res, 400, id, { errors: r.errors, values: valoresDe(body) });
        req.flash('ok', r.sinCambios ? 'No había cambios que guardar.' : 'Producto guardado.');
        return res.redirect(`/farmacia/${id}`);
    });

    router.post('/farmacia/:id/estado', soloAdmin, (req, res) => {
        const id = idParam(req);
        const accion = req.body && req.body.accion;
        if (accion !== 'activar' && accion !== 'desactivar') throw new HttpError(400, 'Acción no válida.');
        const r = productos.setActivo(db, id, accion === 'activar', ctx(req));
        if (r.notFound) throw new HttpError(404);
        req.flash('ok', r.sinCambios ? 'No había cambios que guardar.' : accion === 'activar' ? 'Producto reactivado.' : 'Producto desactivado. Su historial se conserva.');
        return res.redirect(`/farmacia/${id}`);
    });

    router.post('/farmacia/:id/entrada', soloAdmin, (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const r = productos.entradaStock(db, id, body, ctx(req));
        if (r.notFound) throw new HttpError(404);
        if (r.errors) return ficha(req, res, 400, id, { errE: r.errors, valE: { cantidad: texto(body.cantidad), nota: texto(body.nota) } });
        if (r.error) req.flash('error', r.error); else req.flash('ok', `Entrada registrada. Stock actual: ${r.stock}.`);
        return res.redirect(`/farmacia/${id}`);
    });

    router.post('/farmacia/:id/ajuste', soloAdmin, (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const r = productos.ajustarStock(db, id, body, ctx(req));
        if (r.notFound) throw new HttpError(404);
        if (r.errors) return ficha(req, res, 400, id, { errA: r.errors, valA: { sentido: texto(body.sentido) || 'sumar', cantidad: texto(body.cantidad), motivo: texto(body.motivo) } });
        req.flash('ok', `Ajuste registrado. Stock actual: ${r.stock}.`);
        return res.redirect(`/farmacia/${id}`);
    });

    return router;
}

module.exports = { farmaciaRoutes };
