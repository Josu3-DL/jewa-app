'use strict';
const express = require('express');
const { HttpError } = require('../middleware/errors');
const { requireModule } = require('../middleware/user');
const ventas = require('../services/ventas');
const propietarios = require('../services/propietarios');
const { getSettings } = require('../services/settings');
const { formatDateTime } = require('../utils/dates');
const { parseMoney } = require('../utils/money');
const { pager } = require('../utils/pagination');
const { verTelefono } = require('../utils/validation');
const { idParam, texto } = require('./ajustes/comun');

const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

// /ventas: carrito, cobro, recibo y anulación. Registrar: los tres roles. Anular: solo el administrador.
// El carrito vive en la sesión del usuario ({ items, propietario, descuento }); al cobrar, los precios y el stock
// se leen de la base de datos: nada de lo guardado en el carrito se toma como cierto.
function ventasRoutes({ db, now }) {
    const router = express.Router();
    router.use('/ventas', requireModule('ventas'));
    const soloAdmin = (req, res, next) => (req.user.rol === 'admin' ? next() : next(new HttpError(403, 'Solo el administrador anula ventas.')));
    const ctx = (req) => ({ actorId: req.user.id, ip: req.ip, ahora: now() });
    const carrito = (req) => {
        if (!req.session.carrito) req.session.carrito = { items: [], propietario: null, descuento: 0 };
        return req.session.carrito;
    };
    const centavosATexto = (c) => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}`;

    // ───── Lista de ventas
    router.get('/ventas', (req, res) => {
        const f = ventas.leerFiltros(req.query);
        const datos = ventas.listarVentas(db, f);
        res.render('ventas/lista', {
            title: 'Ventas', active: 'ventas', filas: datos.filas.map((v) => ({ ...v, fechaTexto: formatDateTime(v.fecha) })), total: datos.total, totalPagado: datos.totalPagado,
            f: { desde: f.desde || '', hasta: f.hasta || '', estado: f.estado || '' }, estados: [{ valor: 'pagada', texto: 'Pagadas' }, { valor: 'anulada', texto: 'Anuladas' }],
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/ventas', filtros: { desde: f.desde, hasta: f.hasta, estado: f.estado } }),
        });
    });

    // ───── Carrito
    const nueva = (req, res, status, { errores = [] } = {}) => {
        const c = carrito(req);
        const resumen = ventas.resolverCarrito(db, c.items, { descuento: c.descuento });
        const filas = c.items.map((it, indice) => ({ ...ventas.resolverCarrito(db, [it]).lineas[0], indice, cantidad: it.cantidad })).filter((l) => l.descripcion);
        const cliente = c.propietario ? propietarios.getPropietario(db, c.propietario) : null;
        const q = texto(req.query.q).trim().slice(0, 100);
        const resultados = q ? propietarios.listPropietarios(db, { q }).filas.slice(0, 8).map((p) => ({ ...p, telefonoTexto: verTelefono(p.telefono) })) : [];
        res.status(status).render('ventas/nueva', {
            title: 'Nueva venta', active: 'ventas', filas, resumen, errores: errores.length ? errores : resumen.errores,
            catalogo: ventas.catalogoVenta(db), metodos: ventas.METODOS, cliente, q, resultados, descuentoTexto: c.descuento ? centavosATexto(c.descuento) : '',
        });
    };

    router.get('/ventas/nueva', (req, res) => nueva(req, res, 200));

    router.post('/ventas/carrito/agregar', (req, res) => {
        const [tipo, idTxt] = texto(req.body && req.body.item).split(':');
        const id = entero(idTxt);
        const cantidad = Number.parseInt(texto(req.body && req.body.cantidad) || '1', 10);
        const c = carrito(req);
        if ((tipo !== 'producto' && tipo !== 'servicio') || !id) { req.flash('error', 'Elige un artículo de la lista.'); return res.redirect('/ventas/nueva'); }
        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > ventas.MAX_CANTIDAD) { req.flash('error', `La cantidad debe estar entre 1 y ${ventas.MAX_CANTIDAD}.`); return res.redirect('/ventas/nueva'); }
        if (c.items.length >= ventas.MAX_LINEAS && !c.items.some((i) => i.tipo === tipo && i.id === id)) { req.flash('error', `El carrito no puede tener más de ${ventas.MAX_LINEAS} líneas.`); return res.redirect('/ventas/nueva'); }
        const existente = c.items.find((i) => i.tipo === tipo && i.id === id);
        const prueba = existente ? c.items.map((i) => (i === existente ? { ...i, cantidad: i.cantidad + cantidad } : i)) : [...c.items, { tipo, id, cantidad }];
        const r = ventas.resolverCarrito(db, prueba, { descuento: 0 });
        const nuevoErr = r.errores.filter((e) => !ventas.resolverCarrito(db, c.items, { descuento: 0 }).errores.includes(e));
        if (nuevoErr.length) { req.flash('error', nuevoErr[0]); return res.redirect('/ventas/nueva'); }
        if (existente) existente.cantidad += cantidad; else c.items.push({ tipo, id, cantidad });
        return res.redirect('/ventas/nueva');
    });

    router.post('/ventas/carrito/quitar', (req, res) => {
        const c = carrito(req);
        const i = Number.parseInt(texto(req.body && req.body.indice), 10);
        if (Number.isInteger(i) && i >= 0 && i < c.items.length) c.items.splice(i, 1);
        return res.redirect('/ventas/nueva');
    });

    router.post('/ventas/carrito/vaciar', (req, res) => {
        req.session.carrito = { items: [], propietario: null, descuento: 0 };
        return res.redirect('/ventas/nueva');
    });

    router.post('/ventas/carrito/cliente', (req, res) => {
        const c = carrito(req);
        const id = entero(req.body && req.body.propietario);
        if (!id) { c.propietario = null; return res.redirect('/ventas/nueva'); }
        const p = propietarios.getPropietario(db, id);
        if (!p || !p.activo) { req.flash('error', 'El cliente no existe o está desactivado.'); return res.redirect('/ventas/nueva'); }
        c.propietario = id;
        return res.redirect('/ventas/nueva');
    });

    router.post('/ventas/carrito/descuento', (req, res) => {
        const c = carrito(req);
        const t = texto(req.body && req.body.descuento).trim();
        const centavos = t === '' ? 0 : parseMoney(t);
        if (centavos === null) { req.flash('error', 'Descuento no válido: usa números con hasta 2 decimales (ej. 15.50).'); return res.redirect('/ventas/nueva'); }
        c.descuento = centavos;
        return res.redirect('/ventas/nueva');
    });

    router.post('/ventas/cobrar', (req, res) => {
        const c = carrito(req);
        const r = ventas.crearVenta(db, { items: c.items, propietarioId: c.propietario, descuento: c.descuento, metodo: texto(req.body && req.body.metodo) }, ctx(req));
        if (!r.ok) return nueva(req, res, 400, { errores: r.errores });
        req.session.carrito = { items: [], propietario: null, descuento: 0 };
        req.flash('ok', `Venta ${r.numero} cobrada.`);
        return res.redirect(`/ventas/${r.id}`);
    });

    // ───── Detalle, recibo y anulación
    const detalle = (req, res, status, id, { errors = {}, motivo = '' } = {}) => {
        const v = ventas.getVenta(db, id);
        if (!v) throw new HttpError(404);
        res.status(status).render('ventas/detalle', {
            title: v.numero, active: 'ventas', v: { ...v, fechaTexto: formatDateTime(v.fecha) }, puedeAnular: req.user.rol === 'admin' && v.estado === 'pagada', errors, motivo,
        });
    };

    router.get('/ventas/:id', (req, res) => detalle(req, res, 200, idParam(req)));

    router.post('/ventas/:id/anular', soloAdmin, (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const r = ventas.anularVenta(db, id, body, ctx(req));
        if (r.notFound) throw new HttpError(404);
        if (r.errors) return detalle(req, res, 400, id, { errors: r.errors, motivo: texto(body.motivo) });
        if (r.error) req.flash('error', r.error); else req.flash('ok', `Venta ${r.numero} anulada. El stock de sus productos se devolvió.`);
        return res.redirect(`/ventas/${id}`);
    });

    router.get('/ventas/:id/recibo', (req, res) => {
        const id = idParam(req);
        const v = ventas.getVenta(db, id);
        if (!v) throw new HttpError(404);
        const a = getSettings(db);
        res.render('hojas/recibo', {
            title: `Recibo ${v.numero}`, volver: `/ventas/${id}`, v: { ...v, fechaTexto: formatDateTime(v.fecha) }, iva: a.iva,
            clinica: { nombre: a.nombre, telefono: verTelefono(a.telefono), direccion: a.direccion },
        });
    });

    return router;
}

module.exports = { ventasRoutes };
