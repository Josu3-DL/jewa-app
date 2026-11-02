'use strict';
const express = require('express');
const { HttpError } = require('../middleware/errors');
const { requireModule } = require('../middleware/user');
const { subida } = require('../middleware/upload');
const { isRequestValid } = require('../middleware/csrf');
const { canAccess } = require('../modules');
const propietarios = require('../services/propietarios');
const mascotas = require('../services/mascotas');
const archivos = require('../services/archivos');
const { formatDateTime } = require('../utils/dates');
const { pager } = require('../utils/pagination');
const { verTelefono } = require('../utils/validation');
const { idParam, texto } = require('./ajustes/comun');

const CAMPOS = ['nombre', 'especie', 'raza', 'sexo', 'fecha_nacimiento', 'color', 'estado'];
const valoresDe = (body) => ({
    ...Object.fromEntries(CAMPOS.map((c) => [c, texto(body[c])])),
    esterilizado: body.esterilizado === 'on',
});
const ESTADOS_FILTRO = [{ valor: 'todos', texto: 'Todos' }, ...mascotas.ESTADOS];
const enteroOpcional = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

// /mascotas: pacientes. Las fotos se guardan como archivo en UPLOAD_DIR (fuera de public/) y se sirven por una ruta con sesión.
function mascotasRoutes({ db, config, now }) {
    const router = express.Router();
    router.use('/mascotas', requireModule('mascotas'));
    const ctx = (req) => ({ actorId: req.user.id, ip: req.ip, ahora: now() });
    const dirFotos = `${config.uploadDir}/fotos`;
    const subirFoto = subida({ campo: 'foto', maxBytes: mascotas.FOTO_MAX_BYTES, isRequestValid });

    const vista = (m) => ({
        ...m,
        edad: mascotas.edadDe(m, now()),
        estadoTexto: mascotas.ESTADO_TEXTO[m.estado] || m.estado,
        estadoClase: m.estado === 'activa' ? 'status-confirmed' : 'status-waiting',
        telefonoTexto: verTelefono(m.propietario_telefono),
        inicial: m.nombre.charAt(0).toUpperCase(),
    });

    // ───── Lista y búsqueda
    router.get('/mascotas', (req, res) => {
        const q = texto(req.query.q).trim().slice(0, 100);
        const estado = ESTADOS_FILTRO.some((e) => e.valor === req.query.estado) ? req.query.estado : 'activa';
        const datos = mascotas.listMascotas(db, { q, estado, pagina: req.query.pagina });
        res.render('mascotas/lista', {
            title: 'Mascotas', active: 'mascotas', filas: datos.filas.map(vista), total: datos.total, q, estado, estados: ESTADOS_FILTRO,
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/mascotas', filtros: { q, estado: estado === 'activa' ? '' : estado } }),
        });
    });

    // ───── Alta: primero se elige el propietario (de una lista, no texto libre)
    const elegirPropietario = (req, res, { ruta, titulo, intro, excluirId = null, accion = null, mascota = null }) => {
        const q = texto(req.query.q).trim().slice(0, 100);
        const datos = propietarios.listPropietarios(db, { q, pagina: req.query.pagina });
        const filas = datos.filas.filter((p) => p.id !== excluirId).map((p) => ({ ...p, telefonoTexto: verTelefono(p.telefono) }));
        res.render('mascotas/elegir-propietario', {
            title: titulo, active: 'mascotas', titulo, intro, q, ruta, filas, total: datos.total, accion, mascota,
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta, filtros: { q } }),
        });
    };

    const renderNueva = (req, res, status, propietario, { errors = {}, values = null } = {}) => res.status(status).render('mascotas/nueva', {
        title: 'Nueva mascota', active: 'mascotas',
        propietario: { ...propietario, telefonoTexto: verTelefono(propietario.telefono) },
        especies: mascotas.ESPECIES, sexos: mascotas.SEXOS, errors,
        values: { especie: 'Perro', sexo: 'desconocido', ...(values || {}) },
    });

    router.get('/mascotas/nueva', (req, res) => {
        const id = enteroOpcional(req.query.propietario);
        const p = id ? propietarios.getPropietario(db, id) : null;
        if (p && p.activo) return renderNueva(req, res, 200, p);
        return elegirPropietario(req, res, {
            ruta: '/mascotas/nueva', titulo: 'Nueva mascota',
            intro: 'Primero elige al propietario. Si todavía no está registrado, créalo en Clientes.',
        });
    });

    router.post('/mascotas', subirFoto, async (req, res) => {
        const body = req.body || {};
        const p = propietarios.getPropietario(db, enteroOpcional(body.propietario) || 0);
        if (!p || !p.activo) throw new HttpError(400, 'Elige un propietario activo.');

        let ext = null;
        let errorFoto = req.errorArchivo || null;
        if (!errorFoto && req.file) {
            const v = await archivos.validarImagen(req.file.buffer);
            if (v.ok) ext = v.ext; else errorFoto = v.error;
        }
        if (errorFoto) return renderNueva(req, res, 400, p, { errors: { foto: errorFoto }, values: valoresDe(body) });

        const result = mascotas.createMascota(db, body, ctx(req));
        if (!result.ok) return renderNueva(req, res, 400, p, { errors: result.errors, values: valoresDe(body) });

        let aviso = '';
        if (ext) {
            try {
                const nombre = await archivos.guardarArchivo(dirFotos, req.file.buffer, ext);
                mascotas.setFoto(db, result.id, nombre, ctx(req));
            } catch (error) {
                console.error(error);
                aviso = ' No se pudo guardar la foto: súbela de nuevo desde la ficha.';
            }
        }
        req.flash(aviso ? 'error' : 'ok', `Mascota "${texto(body.nombre).trim()}" creada con el expediente ${result.expediente}.${aviso}`);
        return res.redirect(`/mascotas/${result.id}`);
    });

    // ───── Ficha y edición
    const renderFicha = (req, res, status, id, { errors = {}, values = null } = {}) => {
        const m = mascotas.getMascota(db, id);
        if (!m) throw new HttpError(404);
        const rol = req.user.rol;
        res.status(status).render('mascotas/ficha', {
            title: m.nombre, active: 'mascotas', m: vista(m),
            historial: mascotas.historialPropietarios(db, id).map((h) => ({ ...h, desde: formatDateTime(h.desde), hasta: h.hasta ? formatDateTime(h.hasta) : null })),
            especies: mascotas.ESPECIES, sexos: mascotas.SEXOS, estados: mascotas.ESTADOS, errors,
            values: values || mascotas.paraFormulario(m),
            puedeHistorial: canAccess(rol, 'historial'), puedeCitas: canAccess(rol, 'citas'),
        });
    };

    router.get('/mascotas/:id', (req, res) => renderFicha(req, res, 200, idParam(req)));

    router.post('/mascotas/:id', (req, res) => {
        const id = idParam(req);
        const body = req.body || {};
        const result = mascotas.updateMascota(db, id, body, ctx(req));
        if (result.notFound) throw new HttpError(404);
        if (result.errors) return renderFicha(req, res, 400, id, { errors: result.errors, values: valoresDe(body) });
        req.flash('ok', result.sinCambios ? 'No había cambios que guardar.' : 'Mascota guardada.');
        return res.redirect(`/mascotas/${id}`);
    });

    // ───── Foto: archivo propio, servido solo con sesión iniciada
    router.get('/mascotas/:id/foto', (req, res) => {
        const m = mascotas.getMascota(db, idParam(req));
        const ruta = m && archivos.rutaArchivo(dirFotos, m.foto);
        if (!ruta) throw new HttpError(404);
        res.set('Content-Type', archivos.mimeDe(m.foto));
        res.set('Cache-Control', 'private, max-age=300');
        res.sendFile(ruta, (error) => { if (error && !res.headersSent) res.status(404).end(); });
    });

    router.post('/mascotas/:id/foto', subirFoto, async (req, res) => {
        const id = idParam(req);
        if (!mascotas.getMascota(db, id)) throw new HttpError(404);
        const volver = () => res.redirect(`/mascotas/${id}`);
        if (req.errorArchivo) { req.flash('error', req.errorArchivo); return volver(); }
        if (!req.file) { req.flash('error', 'Elige una foto para subir.'); return volver(); }
        const v = await archivos.validarImagen(req.file.buffer);
        if (!v.ok) { req.flash('error', v.error); return volver(); }
        const nombre = await archivos.guardarArchivo(dirFotos, req.file.buffer, v.ext);
        const r = mascotas.setFoto(db, id, nombre, ctx(req));
        await archivos.borrarArchivo(dirFotos, r.anterior);
        req.flash('ok', 'Foto guardada.');
        return volver();
    });

    router.post('/mascotas/:id/foto/quitar', async (req, res) => {
        const id = idParam(req);
        const r = mascotas.setFoto(db, id, null, ctx(req));
        if (r.notFound) throw new HttpError(404);
        await archivos.borrarArchivo(dirFotos, r.anterior);
        req.flash('ok', 'Foto quitada.');
        return res.redirect(`/mascotas/${id}`);
    });

    // ───── Transferencia a otro propietario
    router.get('/mascotas/:id/transferir', (req, res) => {
        const id = idParam(req);
        const m = mascotas.getMascota(db, id);
        if (!m) throw new HttpError(404);
        return elegirPropietario(req, res, {
            ruta: `/mascotas/${id}/transferir`, titulo: `Transferir a ${m.nombre}`,
            intro: `Hoy pertenece a ${m.propietario_nombre}. Elige al nuevo propietario; el historial de dueños se conserva.`,
            excluirId: m.propietario_id, accion: `/mascotas/${id}/transferir`, mascota: vista(m),
        });
    });

    router.post('/mascotas/:id/transferir', (req, res) => {
        const id = idParam(req);
        const nuevo = enteroOpcional(req.body && req.body.propietario);
        const result = nuevo ? mascotas.transferirMascota(db, id, nuevo, ctx(req)) : { ok: false, error: 'Elige un propietario.' };
        if (result.notFound) throw new HttpError(404);
        if (!result.ok) {
            req.flash('error', result.error);
            return res.redirect(`/mascotas/${id}/transferir`);
        }
        req.flash('ok', `Mascota transferida a ${result.propietario}.`);
        return res.redirect(`/mascotas/${id}`);
    });

    return router;
}

module.exports = { mascotasRoutes };
