'use strict';
const multer = require('multer');
const { HttpError } = require('./errors');

// Rutas que reciben archivos (multipart). Se agregan aquí al crear una nueva subida.
// Un formulario multipart entre sitios es una petición "simple" del navegador, así que el CSRF
// global solo se salta en estas rutas y las verifica `subida()` justo después de leer el cuerpo
// (el token viaja dentro del propio formulario, que solo multer sabe leer).
const RUTAS_MULTIPART = [
    /^\/mascotas$/,
    /^\/mascotas\/\d+\/foto$/,
];

const esRutaMultipart = (req) => Boolean(req.is('multipart/form-data')) && RUTAS_MULTIPART.some((r) => r.test(req.path));

/**
 * Lee un formulario multipart con un archivo opcional (en memoria, con tope de tamaño) y comprueba
 * el token CSRF. Deja `req.body`, `req.file` y, si el archivo excede el tope, `req.errorArchivo`.
 * Librería: multer (mantenida, usa busboy; sin módulos nativos).
 */
function subida({ campo, maxBytes, isRequestValid }) {
    const lector = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: maxBytes, files: 1, fields: 30, fieldSize: 100 * 1024 },
    }).single(campo);

    return (req, res, next) => {
        lector(req, res, (error) => {
            if (error) {
                if (error.code === 'LIMIT_FILE_SIZE') {
                    req.errorArchivo = `El archivo pesa más de ${Math.round(maxBytes / (1024 * 1024))} MB.`;
                    req.body = req.body || {};
                } else {
                    return next(new HttpError(400, 'No se pudo leer el formulario. Inténtalo de nuevo.'));
                }
            }
            if (!isRequestValid(req)) {
                return next(Object.assign(new HttpError(403, 'El formulario expiró o no es válido. Recarga la página e inténtalo de nuevo.'), { code: 'EBADCSRFTOKEN' }));
            }
            return next();
        });
    };
}

module.exports = { subida, esRutaMultipart, RUTAS_MULTIPART };
