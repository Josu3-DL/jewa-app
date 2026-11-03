'use strict';
const express = require('express');
const { HttpError } = require('../middleware/errors');
const { requireModule } = require('../middleware/user');
const { subida } = require('../middleware/upload');
const { isRequestValid } = require('../middleware/csrf');
const adjuntos = require('../services/adjuntos');
const archivos = require('../services/archivos');
const { idParam, texto } = require('./ajustes/comun');

const entero = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

// /adjuntos: archivos clínicos. Ver y descargar: administrador y veterinario (los que acceden al historial);
// subir: solo el veterinario (acto clínico, RN-02). No hay borrado (RN-03).
function adjuntosRoutes({ db, config, now }) {
    const router = express.Router();
    router.use('/adjuntos', requireModule('historial'));
    const dir = `${config.uploadDir}/adjuntos`;
    const subir = subida({ campo: 'archivo', maxBytes: adjuntos.MAX_BYTES, isRequestValid });

    router.post('/adjuntos', subir, async (req, res) => {
        if (req.user.rol !== 'veterinario') throw new HttpError(403, 'Solo el veterinario adjunta archivos clínicos.');
        const body = req.body || {};
        const mascotaId = entero(body.mascota);
        const consultaId = entero(body.consulta);
        if (!mascotaId) throw new HttpError(400, 'Falta la mascota.');
        const volver = consultaId ? `/historial/${consultaId}` : `/historial?mascota=${mascotaId}`;
        if (req.errorArchivo) { req.flash('error', req.errorArchivo); return res.redirect(volver); }
        const r = await adjuntos.subirAdjunto(db, dir, { mascotaId, consultaId, archivo: req.file }, { actorId: req.user.id, ip: req.ip, ahora: now() });
        if (r.notFound) throw new HttpError(404);
        if (r.ok) req.flash('ok', 'Archivo adjuntado.'); else req.flash('error', r.error);
        return res.redirect(volver);
    });

    // Descarga con sesión y rol: nunca se expone la carpeta de archivos. El nombre real del archivo en disco
    // viene de la base de datos (un UUID generado por el servidor), no de la URL.
    router.get('/adjuntos/:id', (req, res) => {
        const a = adjuntos.getAdjunto(db, idParam(req));
        const ruta = a && archivos.rutaArchivo(dir, a.archivo);
        if (!ruta) throw new HttpError(404);
        res.set('Content-Type', a.tipo_mime);
        res.set('Cache-Control', 'private, no-store');
        // Imágenes en la página; PDF como descarga (el visor del navegador choca con la CSP estricta)
        if (a.tipo_mime === 'application/pdf' || texto(req.query.descargar) === '1') res.attachment(a.nombre_original);
        res.sendFile(ruta, (error) => { if (error && !res.headersSent) res.status(404).end(); });
    });

    return router;
}

module.exports = { adjuntosRoutes };
