'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
// Librería: file-type lee los primeros bytes (firma real del archivo); la extensión o el
// Content-Type que manda el navegador no se creen. (ESM; Node 24 lo carga con require.)
const { fileTypeFromBuffer } = require('file-type');

// Tipos de imagen permitidos → extensión con la que se guardan.
const IMAGENES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Adjuntos clínicos: las mismas imágenes y PDF.
const ADJUNTOS = { ...IMAGENES, 'application/pdf': 'pdf' };
const MIME_POR_EXTENSION = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/** Comprueba que el contenido sea realmente jpg, png o webp. Devuelve { ok, ext } o { ok:false, error }. */
async function validarImagen(buffer) {
    const tipo = buffer && buffer.length ? await fileTypeFromBuffer(buffer) : null;
    if (!tipo || !IMAGENES[tipo.mime]) return { ok: false, error: 'La foto debe ser una imagen JPG, PNG o WebP.' };
    return { ok: true, ext: IMAGENES[tipo.mime] };
}

/** Comprueba que el contenido sea realmente jpg, png, webp o pdf. Devuelve { ok, ext, mime } o { ok:false, error }. */
async function validarAdjunto(buffer) {
    const tipo = buffer && buffer.length ? await fileTypeFromBuffer(buffer) : null;
    if (!tipo || !ADJUNTOS[tipo.mime]) return { ok: false, error: 'Solo se aceptan archivos JPG, PNG, WebP o PDF.' };
    return { ok: true, ext: ADJUNTOS[tipo.mime], mime: tipo.mime };
}

/** Guarda la imagen con nombre generado (UUID) dentro de `dir` (fuera de public/). Devuelve el nombre. */
async function guardarArchivo(dir, buffer, ext) {
    await fs.mkdir(dir, { recursive: true });
    const nombre = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(dir, nombre), buffer, { flag: 'wx' });
    return nombre;
}

/** Borra un archivo guardado; si ya no existe no es un error. */
async function borrarArchivo(dir, nombre) {
    if (!nombre || nombre !== path.basename(nombre)) return;
    await fs.rm(path.join(dir, nombre), { force: true });
}

/** Ruta absoluta de un archivo guardado (solo nombres sin carpetas) o null. */
function rutaArchivo(dir, nombre) {
    if (!nombre || nombre !== path.basename(nombre)) return null;
    return path.join(dir, nombre);
}

const mimeDe = (nombre) => MIME_POR_EXTENSION[path.extname(nombre).slice(1).toLowerCase()] || 'application/octet-stream';

module.exports = { validarImagen, validarAdjunto, guardarArchivo, borrarArchivo, rutaArchivo, mimeDe };
