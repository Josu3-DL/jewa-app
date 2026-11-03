'use strict';
const path = require('node:path');
const archivos = require('./archivos');
const audit = require('./audit');

// Adjuntos clínicos (RF-18): radiografías, análisis, fotos de lesiones, PDF. Se guardan fuera de
// public/ con nombre generado (UUID) y se sirven por una ruta con sesión y rol. Como el resto de los
// datos clínicos no se borran (RN-03): no hay ruta de eliminación.

const MAX_BYTES = 5 * 1024 * 1024;

/** Nombre del archivo tal como lo mandó el usuario, sin carpetas ni caracteres de control, para mostrarlo. */
function limpiarNombre(nombre) {
    const base = path.posix.basename(String(nombre || '').replace(/\\/g, '/'));
    // eslint-disable-next-line no-control-regex
    const limpio = base.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 120);
    return limpio || 'archivo';
}

/** "1.2 MB", "340 KB". */
function tamanoTexto(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getAdjunto(db, id) {
    return db.prepare(`SELECT id, mascota_id, consulta_id, nombre_original, archivo, tipo_mime, tamano, subido_por, subido_en
                       FROM adjuntos WHERE id = ?`).get(id) || null;
}

/** Adjuntos de una mascota (todos) o de una consulta, el más reciente primero. */
function listarAdjuntos(db, { mascotaId = null, consultaId = null } = {}) {
    return db.prepare(`
        SELECT a.id, a.mascota_id, a.consulta_id, a.nombre_original, a.tipo_mime, a.tamano, a.subido_en, u.nombre AS subido_por_nombre
        FROM adjuntos a JOIN usuarios u ON u.id = a.subido_por
        WHERE (? IS NULL OR a.mascota_id = ?) AND (? IS NULL OR a.consulta_id = ?)
        ORDER BY a.id DESC`).all(mascotaId, mascotaId, consultaId, consultaId)
        .map((a) => ({ ...a, tamanoTexto: tamanoTexto(a.tamano), esImagen: a.tipo_mime.startsWith('image/') }));
}

/**
 * Valida y guarda un archivo adjunto. `archivo` es { buffer, originalname }. Comprueba el tipo real
 * (no la extensión) y el tamaño, que la mascota exista y que la consulta (si hay) sea de esa mascota.
 */
async function subirAdjunto(db, dir, { mascotaId, consultaId = null, archivo }, { actorId, ip = null, ahora = new Date() }) {
    if (!archivo || !archivo.buffer || !archivo.buffer.length) return { ok: false, error: 'Elige un archivo para adjuntar.' };
    if (archivo.buffer.length > MAX_BYTES) return { ok: false, error: `El archivo pesa más de ${MAX_BYTES / (1024 * 1024)} MB.` };
    if (!db.prepare('SELECT 1 FROM mascotas WHERE id = ?').get(mascotaId)) return { ok: false, notFound: true };
    if (consultaId && !db.prepare('SELECT 1 FROM consultas WHERE id = ? AND mascota_id = ?').get(consultaId, mascotaId)) {
        return { ok: false, error: 'La consulta no corresponde a esta mascota.' };
    }
    const tipo = await archivos.validarAdjunto(archivo.buffer);
    if (!tipo.ok) return tipo;

    const nombre = await archivos.guardarArchivo(dir, archivo.buffer, tipo.ext);
    try {
        const original = limpiarNombre(archivo.originalname);
        const r = db.prepare(`INSERT INTO adjuntos (mascota_id, consulta_id, nombre_original, archivo, tipo_mime, tamano, subido_por, subido_en)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(mascotaId, consultaId, original, nombre, tipo.mime, archivo.buffer.length, actorId, ahora.toISOString());
        const id = Number(r.lastInsertRowid);
        audit.log(db, { usuarioId: actorId, accion: 'adjunto_subido', entidad: 'adjunto', entidadId: id, detalle: { mascota_id: mascotaId, consulta_id: consultaId, nombre: original, tamano: archivo.buffer.length }, ip });
        return { ok: true, id };
    } catch (error) {
        await archivos.borrarArchivo(dir, nombre); // sin fila no debe quedar el archivo huérfano
        throw error;
    }
}

module.exports = { MAX_BYTES, limpiarNombre, tamanoTexto, getAdjunto, listarAdjuntos, subirAdjunto };
