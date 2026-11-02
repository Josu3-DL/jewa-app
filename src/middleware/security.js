'use strict';
const helmet = require('helmet');

/**
 * Cabeceras de seguridad. CSP restrictiva: solo recursos propios, sin scripts ni
 * estilos en línea (todo vive en /css y /js).
 * - upgrade-insecure-requests se desactiva: el sistema corre por HTTP en la red local (D-25)
 *   y el navegador intentaría cargar todo por HTTPS.
 * - HSTS solo se envía si COOKIE_SECURE=true (es decir, si algún día se usa HTTPS).
 */
function security(config) {
    return helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives: {
                'default-src': ["'self'"],
                'script-src': ["'self'"],
                'style-src': ["'self'"],
                'img-src': ["'self'", 'data:'],
                'font-src': ["'self'"],
                'connect-src': ["'self'"],
                'object-src': ["'none'"],
                'frame-ancestors': ["'none'"],
                'form-action': ["'self'"],
                'base-uri': ["'self'"],
            },
        },
        strictTransportSecurity: config.cookieSecure ? { maxAge: 15552000 } : false,
        referrerPolicy: { policy: 'same-origin' },
        // Sin HTTPS estas cabeceras solo generan avisos en el navegador
        crossOriginOpenerPolicy: config.cookieSecure ? { policy: 'same-origin' } : false,
        originAgentCluster: config.cookieSecure,
    });
}

module.exports = { security };
