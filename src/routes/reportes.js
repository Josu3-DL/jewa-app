'use strict';
const express = require('express');
const { HttpError } = require('../middleware/errors');
const { requireModule } = require('../middleware/user');
const reportes = require('../services/reportes');
const citasSvc = require('../services/citas');
const audit = require('../services/audit');
const { fechaDMY, todayInZone } = require('../utils/dates');
const { pager } = require('../utils/pagination');
const { paginar } = require('../utils/busqueda');

// /reportes: 3 reportes con exportación a CSV (D-41). Administrador: todos. Veterinario: solo los clínicos
// (citas y stock); las ventas son información de ingresos y solo las ve el administrador. Recepción no entra.
function reportesRoutes({ db, now }) {
    const router = express.Router();
    router.use('/reportes', requireModule('reportes'));
    const soloAdmin = (req, res, next) => (req.user.rol === 'admin' ? next() : next(new HttpError(403, 'Los reportes de ventas son solo para el administrador.')));

    /** Responde un CSV como descarga (con BOM) y deja constancia en la bitácora (se exportan datos del negocio). */
    const enviarCsv = (req, res, nombre, contenido, detalle) => {
        audit.logReq(db, req, { accion: 'reporte_exportado', entidad: 'reporte', detalle });
        res.set('Cache-Control', 'private, no-store');
        res.attachment(`jewa-${nombre}-${todayInZone(now())}.csv`);
        res.type('text/csv; charset=utf-8');
        res.send(contenido);
    };

    router.get('/reportes', (req, res) => {
        res.render('reportes/indice', { title: 'Reportes', active: 'reportes', esAdmin: req.user.rol === 'admin' });
    });

    // ───── Ventas por día (solo administrador)
    router.get('/reportes/ventas', soloAdmin, (req, res) => {
        const f = reportes.leerFiltros(req.query, now());
        const r = reportes.ventasPorDia(db, f);
        res.render('reportes/ventas', {
            title: 'Reporte de ventas', active: 'reportes', f, error: f.error,
            filas: r.filas.map((x) => ({ ...x, diaTexto: fechaDMY(x.dia) })), totales: r.totales,
            csv: `/reportes/ventas.csv?desde=${f.desde}&hasta=${f.hasta}`,
        });
    });
    router.get('/reportes/ventas.csv', soloAdmin, (req, res) => {
        const f = reportes.leerFiltros(req.query, now());
        enviarCsv(req, res, 'ventas', reportes.csvVentas(db, f), { reporte: 'ventas', desde: f.desde, hasta: f.hasta });
    });

    // ───── Citas
    router.get('/reportes/citas', (req, res) => {
        const f = reportes.leerFiltros(req.query, now());
        const r = reportes.citasReporte(db, f);
        const pag = paginar(r.total, f.pagina);
        const qs = new URLSearchParams({ desde: f.desde, hasta: f.hasta, ...(f.responsable ? { responsable: f.responsable } : {}), ...(f.estado ? { estado: f.estado } : {}) }).toString();
        res.render('reportes/citas', {
            title: 'Reporte de citas', active: 'reportes', f, error: f.error, total: r.total,
            filas: r.filas.slice(pag.offset, pag.offset + pag.porPagina).map((c) => ({ ...c, fechaTexto: fechaDMY(c.fecha) })),
            resumen: citasSvc.ESTADOS.map((e) => ({ ...e, cantidad: r.porEstado[e.valor] })),
            responsables: citasSvc.responsables(db).map((x) => ({ valor: x.id, texto: x.nombre })),
            estados: citasSvc.ESTADOS.map((e) => ({ valor: e.valor, texto: e.texto })),
            csv: `/reportes/citas.csv?${qs}`,
            pager: pager({ pagina: pag.pagina, paginas: pag.paginas, total: r.total, ruta: '/reportes/citas', filtros: { desde: f.desde, hasta: f.hasta, responsable: f.responsable, estado: f.estado } }),
        });
    });
    router.get('/reportes/citas.csv', (req, res) => {
        const f = reportes.leerFiltros(req.query, now());
        enviarCsv(req, res, 'citas', reportes.csvCitas(db, f), { reporte: 'citas', desde: f.desde, hasta: f.hasta, responsable: f.responsable ?? null, estado: f.estado ?? null });
    });

    // ───── Stock bajo el mínimo
    router.get('/reportes/stock', (req, res) => {
        res.render('reportes/stock', { title: 'Reporte de stock bajo', active: 'reportes', filas: reportes.stockBajo(db), csv: '/reportes/stock.csv' });
    });
    router.get('/reportes/stock.csv', (req, res) => {
        enviarCsv(req, res, 'stock-bajo', reportes.csvStock(db), { reporte: 'stock' });
    });

    return router;
}

module.exports = { reportesRoutes };
