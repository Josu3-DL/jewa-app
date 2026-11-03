'use strict';
const express = require('express');
const { HttpError } = require('../middleware/errors');
const { requireModule } = require('../middleware/user');
const consultas = require('../services/consultas');
const citas = require('../services/citas');
const mascotas = require('../services/mascotas');
const adjuntosSvc = require('../services/adjuntos');
const tratamientosSvc = require('../services/tratamientos');
const vacunasSvc = require('../services/vacunas');
const { getSettings } = require('../services/settings');
const { formatDateTime, todayInZone, fechaDMY } = require('../utils/dates');
const { pager } = require('../utils/pagination');
const { verTelefono } = require('../utils/validation');
const { idParam, texto } = require('./ajustes/comun');

const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const CAMPOS = ['motivo', 'anamnesis', 'examen_fisico', 'diagnostico', 'observaciones', 'peso_kg', 'temperatura_c', 'frecuencia_cardiaca', 'frecuencia_respiratoria'];
const valoresDe = (body) => Object.fromEntries(CAMPOS.map((c) => [c, texto(body[c])]));
const CAMPOS_T = ['medicamento', 'medicamento_texto', 'dosis', 'frecuencia', 'duracion_dias', 'indicaciones'];
const CAMPOS_V = ['producto', 'lote', 'fecha', 'proxima_dosis'];
const valoresDeT = (body) => Object.fromEntries(CAMPOS_T.map((c) => [c, texto(body[c])]));
const valoresDeV = (body) => Object.fromEntries(CAMPOS_V.map((c) => [c, texto(body[c])]));
const ESTADOS = [{ valor: 'vigente', texto: 'Vigentes' }, { valor: 'anulada', texto: 'Anuladas' }];

// /historial: historial clínico (admin y veterinario). Solo el veterinario registra consultas (RN-02);
// anular lo puede el administrador o el veterinario autor. No existe ninguna ruta de borrado (RN-03).
function historialRoutes({ db, now }) {
    const router = express.Router();
    router.use('/historial', requireModule('historial'));
    const ctx = (req) => ({ actorId: req.user.id, ip: req.ip, ahora: now() });
    const soloVeterinario = (req, res, next) => (req.user.rol === 'veterinario' ? next() : next(new HttpError(403, 'Solo el veterinario registra consultas.')));

    const fila = (c) => ({
        ...c, fechaTexto: formatDateTime(c.fecha), anulada: c.estado === 'anulada',
        resumen: [c.peso_kg != null ? `${c.peso_kg} kg` : null, c.temperatura_c != null ? `${c.temperatura_c} °C` : null].filter(Boolean).join(' · '),
    });

    // ───── Historial (de una mascota o general)
    router.get('/historial', (req, res) => {
        const mid = entero(req.query.mascota);
        const m = mid ? mascotas.getMascota(db, mid) : null;
        if (mid && !m) throw new HttpError(404);
        const filtros = consultas.leerFiltros(req.query);
        const datos = consultas.listarConsultas(db, { mascotaId: mid, ...filtros });
        const pesos = m ? consultas.pesosDe(db, m.id) : [];
        const f = { q: filtros.q || '', desde: filtros.desde || '', hasta: filtros.hasta || '', estado: filtros.estado || '' };
        res.render('historial/lista', {
            title: m ? `Historial de ${m.nombre}` : 'Historial clínico', active: 'historial',
            m: m ? { ...m, edad: mascotas.edadDe(m, now()), telefonoTexto: verTelefono(m.propietario_telefono) } : null,
            filas: datos.filas.map(fila), total: datos.total, f, estados: ESTADOS, pesos,
            adjuntos: m ? adjuntosSvc.listarAdjuntos(db, { mascotaId: m.id }) : [],
            vacunas: m ? vacunasSvc.listarVacunas(db, { mascotaId: m.id, anuladas: false }).map((v) => ({ ...v, fechaTexto: fechaDMY(v.fecha), proximaTexto: fechaDMY(v.proxima_dosis) })) : [],
            puedeCrear: req.user.rol === 'veterinario', scripts: pesos.length >= 2 ? ['/vendor/chart.umd.min.js', '/js/weight-chart.js'] : [],
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/historial', filtros: { mascota: mid, ...f } }),
        });
    });

    // ───── Nueva consulta (solo veterinario): desde una cita o sin cita (urgencia, D-18)
    const formulario = (req, res, status, m, cita, { errors = {}, values = null } = {}) => res.status(status).render('historial/nueva', {
        title: 'Nueva consulta', active: 'historial', cita,
        m: { ...m, edad: mascotas.edadDe(m, now()), telefonoTexto: verTelefono(m.propietario_telefono) },
        errors, values: values || { motivo: cita && cita.motivo ? cita.motivo : '' },
    });

    router.get('/historial/nueva', soloVeterinario, (req, res) => {
        const cid = entero(req.query.cita);
        if (cid) {
            const cita = citas.getCita(db, cid);
            if (!cita) throw new HttpError(404);
            if (!citas.ACTIVOS.includes(cita.estado)) { req.flash('error', 'Esa cita ya no está activa.'); return res.redirect(`/citas/${cid}`); }
            return formulario(req, res, 200, mascotas.getMascota(db, cita.mascota_id), cita);
        }
        const mid = entero(req.query.mascota);
        const m = mid ? mascotas.getMascota(db, mid) : null;
        if (m) return formulario(req, res, 200, m, null);
        const q = texto(req.query.q).trim().slice(0, 100);
        const datos = mascotas.listMascotas(db, { q, estado: 'activa', pagina: req.query.pagina });
        return res.render('citas/elegir-mascota', {
            title: 'Nueva consulta', active: 'historial', q, fecha: '', total: datos.total,
            destino: '/historial/nueva', titulo: 'Nueva consulta', boton: 'Iniciar consulta', volverA: '/historial',
            intro: 'Elige la mascota para una consulta sin cita (urgencia). Si viene de una cita, inicia la consulta desde la agenda.',
            filas: datos.filas.map((x) => ({ ...x, telefonoTexto: verTelefono(x.propietario_telefono) })),
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/historial/nueva', filtros: { q } }),
        });
    });

    router.post('/historial', soloVeterinario, (req, res) => {
        const body = req.body || {};
        const m = mascotas.getMascota(db, entero(body.mascota) || 0);
        if (!m) throw new HttpError(400, 'Elige una mascota.');
        const cid = entero(body.cita);
        const r = consultas.crearConsulta(db, body, { ...ctx(req), mascotaId: m.id, citaId: cid });
        if (r.ok) { req.flash('ok', cid ? 'Consulta registrada. La cita quedó atendida.' : 'Consulta registrada.'); return res.redirect(`/historial/${r.id}`); }
        if (r.error) { req.flash('error', r.error); return res.redirect(cid ? `/citas/${cid}` : `/historial?mascota=${m.id}`); }
        return formulario(req, res, 400, m, cid ? citas.getCita(db, cid) : null, { errors: r.errors, values: valoresDe(body) });
    });

    // ───── Detalle y anulación
    const detalle = (req, res, status, id, { errors = {}, motivo = '', errT = {}, valT = {}, errV = {}, valV = null } = {}) => {
        const c = consultas.getConsulta(db, id);
        if (!c) throw new HttpError(404);
        res.status(status).render('historial/detalle', {
            title: `Consulta de ${c.mascota_nombre}`, active: 'historial',
            c: { ...fila(c), anuladaEn: c.anulada_en ? formatDateTime(c.anulada_en) : '' },
            puedeAnular: c.estado === 'vigente' && (req.user.rol === 'admin' || c.veterinario_id === req.user.id),
            errors, motivo, errT, valT, errV,
            valV: valV || { fecha: todayInZone(now()), proxima_dosis: '' },
            tratamientos: tratamientosSvc.listarTratamientos(db, id), medicamentos: tratamientosSvc.medicamentos(db),
            vacunas: vacunasSvc.listarVacunas(db, { consultaId: id }).map((v) => ({ ...v, fechaTexto: fechaDMY(v.fecha), proximaTexto: fechaDMY(v.proxima_dosis), puedeAnular: v.estado === 'vigente' && (req.user.rol === 'admin' || v.veterinario_id === req.user.id) })),
            catalogoVacunas: vacunasSvc.catalogoVacunas(db), puedeClinico: req.user.rol === 'veterinario' && c.estado === 'vigente',
            adjuntos: adjuntosSvc.listarAdjuntos(db, { consultaId: id }), puedeSubir: req.user.rol === 'veterinario',
        });
    };

    router.get('/historial/:id', (req, res) => detalle(req, res, 200, idParam(req)));

    router.post('/historial/:id/anular', (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const r = consultas.anularConsulta(db, id, body, { actor: { id: req.user.id, rol: req.user.rol }, ip: req.ip, ahora: now() });
        if (r.notFound) throw new HttpError(404);
        if (r.forbidden) throw new HttpError(403, 'Solo puedes anular tus propias consultas.');
        if (r.errors) return detalle(req, res, 400, id, { errors: r.errors, motivo: texto(body.motivo) });
        if (r.error) req.flash('error', r.error); else req.flash('ok', 'Consulta anulada. Se conserva en el historial marcada como anulada.');
        return res.redirect(`/historial/${id}`);
    });

    // ───── Tratamientos y vacunas dentro de la consulta (solo veterinario)
    router.post('/historial/:id/tratamientos', soloVeterinario, (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const r = tratamientosSvc.agregarTratamiento(db, id, body, { actorId: req.user.id, ip: req.ip });
        if (r.notFound) throw new HttpError(404);
        if (r.errors) return detalle(req, res, 400, id, { errT: r.errors, valT: valoresDeT(body) });
        if (r.error) req.flash('error', r.error); else req.flash('ok', 'Tratamiento agregado.');
        return res.redirect(`/historial/${id}`);
    });

    router.post('/historial/:id/vacunas', soloVeterinario, (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const r = vacunasSvc.registrarVacuna(db, id, body, { actorId: req.user.id, ip: req.ip, ahora: now() });
        if (r.notFound) throw new HttpError(404);
        if (r.errors) return detalle(req, res, 400, id, { errV: r.errors, valV: valoresDeV(body) });
        if (r.error) req.flash('error', r.error); else req.flash('ok', 'Vacuna registrada.');
        return res.redirect(`/historial/${id}`);
    });

    router.post('/historial/vacunas/:vid/anular', (req, res) => {
        const r = vacunasSvc.anularVacuna(db, idParam(req, 'vid'), req.body || {}, { actor: { id: req.user.id, rol: req.user.rol }, ip: req.ip });
        if (r.notFound) throw new HttpError(404);
        if (r.forbidden) throw new HttpError(403, 'Solo puedes anular tus propias vacunas.');
        if (r.errors) { req.flash('error', `Para anular la vacuna: ${r.errors.motivo}`); return res.redirect(`/historial/${entero(req.body && req.body.consulta) || ''}`); }
        if (r.error) req.flash('error', r.error); else req.flash('ok', 'Vacuna anulada. Se conserva en el historial marcada como anulada.');
        return res.redirect(`/historial/${r.consultaId}`);
    });

    // ───── Hojas imprimibles (sin barra lateral): receta de una consulta y carné de vacunación de una mascota
    const hoja = (req, res, vista, datos) => res.render(vista, {
        clinica: { nombre: getSettings(db).nombre, telefono: verTelefono(getSettings(db).telefono), direccion: getSettings(db).direccion },
        hoy: fechaDMY(todayInZone(now())), ...datos,
    });

    router.get('/historial/:id/receta', (req, res) => {
        const id = idParam(req);
        const c = consultas.getConsulta(db, id);
        if (!c) throw new HttpError(404);
        const trat = tratamientosSvc.listarTratamientos(db, id);
        if (!trat.length) { req.flash('error', 'Esta consulta no tiene tratamientos: no hay receta que imprimir.'); return res.redirect(`/historial/${id}`); }
        const vet = db.prepare('SELECT nombre, colegiado FROM usuarios WHERE id = ?').get(c.veterinario_id);
        return hoja(req, res, 'hojas/receta', { title: `Receta de ${c.mascota_nombre}`, c: { ...fila(c), fechaCorta: fechaDMY(c.fecha.slice(0, 10)) }, tratamientos: trat, vet, volver: `/historial/${id}` });
    });

    router.get('/historial/carne/:id', (req, res) => {
        const m = mascotas.getMascota(db, idParam(req));
        if (!m) throw new HttpError(404);
        const vacs = vacunasSvc.listarVacunas(db, { mascotaId: m.id, anuladas: false }).map((v) => ({ ...v, fechaTexto: fechaDMY(v.fecha), proximaTexto: fechaDMY(v.proxima_dosis) }));
        return hoja(req, res, 'hojas/carne', { title: `Carné de ${m.nombre}`, m: { ...m, edad: mascotas.edadDe(m, now()), telefonoTexto: verTelefono(m.propietario_telefono) }, vacunas: vacs, volver: `/historial?mascota=${m.id}` });
    });

    return router;
}

module.exports = { historialRoutes };
