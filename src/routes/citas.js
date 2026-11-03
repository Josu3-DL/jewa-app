'use strict';
const express = require('express');
const { HttpError } = require('../middleware/errors');
const { requireModule } = require('../middleware/user');
const citas = require('../services/citas');
const mascotas = require('../services/mascotas');
const { getSettings } = require('../services/settings');
const { managuaToUtc, todayInZone, sumarDias, diaSemana, fechaCorta } = require('../utils/dates');
const { pager } = require('../utils/pagination');
const { verTelefono } = require('../utils/validation');
const { idParam, texto } = require('./ajustes/comun');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (f) => FECHA.test(f) && !Number.isNaN(Date.parse(`${f}T00:00:00Z`)) && new Date(`${f}T00:00:00Z`).toISOString().slice(0, 10) === f;
const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const CAMPOS = ['responsable', 'servicio', 'fecha', 'hora', 'motivo', 'notas'];
const valoresDe = (body) => ({ ...Object.fromEntries(CAMPOS.map((c) => [c, texto(body[c])])), confirmar: body.confirmar === 'on' });

// /citas: agenda por día o semana, alta, reprogramación y cambio de estado. Los tres roles pueden usarla.
function citasRoutes({ db, now }) {
    const router = express.Router();
    router.use('/citas', requireModule('citas'));
    const ctx = (req) => ({ actorId: req.user.id, ip: req.ip, ahora: now() });
    const hoy = () => todayInZone(now());
    const rango = (primero, ultimo) => ({ desde: managuaToUtc(primero, '00:00'), hasta: managuaToUtc(sumarDias(ultimo, 1), '00:00') });

    /** Enlace a /citas conservando los filtros (los vacíos se omiten). */
    const enlace = (f, cambios = {}) => {
        const q = new URLSearchParams();
        const todo = { ...f, ...cambios };
        if (todo.vista === 'semana') q.set('vista', 'semana');
        if (todo.fecha && todo.fecha !== hoy()) q.set('fecha', todo.fecha);
        if (todo.responsable) q.set('responsable', String(todo.responsable));
        if (todo.tipo) q.set('tipo', todo.tipo);
        if (todo.mascota) q.set('mascota', String(todo.mascota));
        const s = q.toString();
        return s ? `/citas?${s}` : '/citas';
    };

    // ───── Agenda
    router.get('/citas', (req, res) => {
        const f = {
            vista: req.query.vista === 'semana' ? 'semana' : 'dia',
            fecha: fechaValida(texto(req.query.fecha)) ? req.query.fecha : hoy(),
            responsable: entero(req.query.responsable),
            tipo: req.query.tipo === 'grooming' ? 'grooming' : null,
            mascota: entero(req.query.mascota),
        };
        const primero = f.vista === 'semana' ? sumarDias(f.fecha, -diaSemana(f.fecha)) : f.fecha;
        const ultimo = f.vista === 'semana' ? sumarDias(primero, 6) : f.fecha;
        const filtros = { responsableId: f.responsable, tipo: f.tipo, mascotaId: f.mascota };
        const lista = citas.listarCitas(db, { ...rango(primero, ultimo), ...filtros });

        const dias = [];
        for (let d = primero; d <= ultimo; d = sumarDias(d, 1)) {
            dias.push({ fecha: d, etiqueta: fechaCorta(d), esHoy: d === hoy(), citas: lista.filter((c) => c.fecha === d), enlace: enlace(f, { vista: 'dia', fecha: d }) });
        }
        const paso = f.vista === 'semana' ? 7 : 1;
        const volver = enlace(f);
        const responsable = f.responsable ? citas.responsables(db).find((r) => r.id === f.responsable) : null;
        res.render('citas/agenda', {
            title: 'Citas', active: 'citas', f, dias, todayIso: hoy(), total: lista.length, volver,
            rotulo: f.vista === 'semana' ? `Semana del ${fechaCorta(primero)} al ${fechaCorta(ultimo)}` : fechaCorta(f.fecha),
            enlaces: {
                anterior: enlace(f, { fecha: sumarDias(f.fecha, -paso) }), siguiente: enlace(f, { fecha: sumarDias(f.fecha, paso) }), hoy: enlace(f, { fecha: hoy() }),
                dia: enlace(f, { vista: 'dia' }), semana: enlace(f, { vista: 'semana' }),
                grooming: enlace(f, { tipo: f.tipo ? null : 'grooming' }),
            },
            responsables: citas.responsables(db).map((r) => ({ valor: r.id, texto: r.nombre })),
            responsableNombre: responsable ? responsable.nombre : null,
            proximas: citas.proximasCitas(db, now(), { responsableId: f.responsable, tipo: f.tipo }),
            pendientes: citas.proximasCitas(db, now(), { responsableId: f.responsable, tipo: f.tipo, soloEstado: 'programada' }),
            mascotaFiltro: f.mascota ? (mascotas.getMascota(db, f.mascota) || {}).nombre : null,
        });
    });

    // ───── Cambio rápido de estado (desde la agenda o el detalle)
    router.post('/citas/:id/estado', (req, res) => {
        const citaId = idParam(req);
        const r = citas.cambiarEstado(db, citaId, texto(req.body && req.body.estado), ctx(req));
        if (r.notFound) throw new HttpError(404);
        if (r.ok) req.flash('ok', `Cita marcada como ${r.estadoTexto.toLowerCase()}.`); else req.flash('error', r.error);
        const volver = texto(req.body && req.body.volver);
        return res.redirect(/^\/citas(\?[\w=&%.-]*)?$/.test(volver) ? volver : `/citas/${citaId}`);
    });

    // ───── Alta: primero se elige la mascota
    const formulario = (req, res, status, mascota, { errors = {}, values = null, avisos = [] } = {}) => {
        const resps = citas.responsables(db);
        const f = fechaValida(texto(req.query.fecha)) ? req.query.fecha : hoy();
        res.status(status).render('citas/nueva', {
            title: 'Nueva cita', active: 'citas', mascota: { ...mascota, telefonoTexto: verTelefono(mascota.propietario_telefono) },
            responsables: resps.map((r) => ({ valor: r.id, texto: r.nombre })), servicios: citas.serviciosActivos(db).map((s) => ({ valor: s.id, texto: `${s.nombre} (${s.duracion_min} min)` })),
            duracion: getSettings(db).duracionCitaMin, errors, avisos,
            values: values || { responsable: resps[0] ? String(resps[0].id) : '', servicio: '', fecha: f, hora: '09:00', motivo: '', notas: '' },
        });
    };

    router.get('/citas/nueva', (req, res) => {
        const mid = entero(req.query.mascota);
        const m = mid ? mascotas.getMascota(db, mid) : null;
        if (m && m.estado === 'activa') return formulario(req, res, 200, m);
        const q = texto(req.query.q).trim().slice(0, 100);
        const datos = mascotas.listMascotas(db, { q, estado: 'activa', pagina: req.query.pagina });
        const fecha = fechaValida(texto(req.query.fecha)) ? req.query.fecha : '';
        return res.render('citas/elegir-mascota', {
            title: 'Nueva cita', active: 'citas', q, fecha, total: datos.total,
            destino: '/citas/nueva', titulo: 'Nueva cita', boton: 'Agendar', volverA: '/citas',
            intro: 'Primero elige la mascota. Si todavía no está registrada, créala en Mascotas.',
            filas: datos.filas.map((x) => ({ ...x, telefonoTexto: verTelefono(x.propietario_telefono) })),
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/citas/nueva', filtros: { q, fecha } }),
        });
    });

    router.post('/citas', (req, res) => {
        const body = req.body || {};
        const m = mascotas.getMascota(db, entero(body.mascota) || 0);
        if (!m || m.estado !== 'activa') throw new HttpError(400, 'Elige una mascota activa.');
        const r = citas.crearCita(db, body, ctx(req));
        if (r.ok) { req.flash('ok', 'Cita creada.'); return res.redirect(`/citas?fecha=${encodeURIComponent(texto(body.fecha))}`); }
        return formulario(req, res, 400, m, { errors: r.errors || {}, avisos: r.advertencias || [], values: valoresDe(body) });
    });

    // ───── Detalle y reprogramación
    const detalle = (req, res, status, citaId, { errors = {}, values = null, avisos = [] } = {}) => {
        const c = citas.getCita(db, citaId);
        if (!c) throw new HttpError(404);
        const resps = citas.responsables(db);
        // el responsable actual siempre se ofrece aunque ya no atienda citas
        if (!resps.some((r) => r.id === c.responsable_id)) resps.push({ id: c.responsable_id, nombre: c.responsable_nombre });
        res.status(status).render('citas/detalle', {
            title: `Cita de ${c.mascota_nombre}`, active: 'citas', c: { ...c, telefonoTexto: verTelefono(c.propietario_telefono) },
            responsables: resps.map((r) => ({ valor: r.id, texto: r.nombre })),
            servicios: citas.serviciosActivos(db).map((s) => ({ valor: s.id, texto: `${s.nombre} (${s.duracion_min} min)` })),
            duracion: getSettings(db).duracionCitaMin, errors, avisos, values: values || citas.paraFormulario(c),
            puedeConsulta: req.user.rol === 'veterinario' && citas.ACTIVOS.includes(c.estado),
            volver: `/citas/${citaId}`,
        });
    };

    router.get('/citas/:id', (req, res) => detalle(req, res, 200, idParam(req)));

    router.post('/citas/:id', (req, res) => {
        const citaId = idParam(req);
        const body = req.body || {};
        const r = citas.actualizarCita(db, citaId, body, ctx(req));
        if (r.notFound) throw new HttpError(404);
        if (r.error) { req.flash('error', r.error); return res.redirect(`/citas/${citaId}`); }
        if (!r.ok) return detalle(req, res, 400, citaId, { errors: r.errors || {}, avisos: r.advertencias || [], values: valoresDe(body) });
        req.flash('ok', r.sinCambios ? 'No había cambios que guardar.' : 'Cita guardada.');
        return res.redirect(`/citas/${citaId}`);
    });

    return router;
}

module.exports = { citasRoutes };
