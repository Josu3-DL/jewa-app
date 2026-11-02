'use strict';
const { csrfSync } = require('csrf-sync');
const { esRutaMultipart } = require('./upload');

const MESSAGE = 'El formulario expiró o no es válido. Recarga la página e inténtalo de nuevo.';

// csrf-sync: patrón "synchronizer token" guardado en la sesión de express-session.
// Los métodos GET/HEAD/OPTIONS no se validan; el resto exige el token en el cuerpo (`_csrf`)
// o en la cabecera `X-CSRF-Token`.
const { csrfSynchronisedProtection, isRequestValid } = csrfSync({
    getTokenFromRequest: (req) => (req.body && req.body._csrf) || req.headers['x-csrf-token'],
    errorConfig: { statusCode: 403, message: MESSAGE, code: 'EBADCSRFTOKEN' },
    // Solo las rutas de subida de archivos, que verifican el token ellas mismas (middleware/upload.js)
    skipCsrfProtection: esRutaMultipart,
});

/**
 * Middleware CSRF (se monta como `app.use(csrf())`). Las vistas llaman `csrfToken()`:
 * la sesión solo se crea cuando alguien realmente pide un token.
 */
function csrf() {
    return [
        csrfSynchronisedProtection,
        (req, res, next) => {
            res.locals.csrfToken = () => req.csrfToken();
            next();
        },
    ];
}

module.exports = { csrf, isRequestValid };
