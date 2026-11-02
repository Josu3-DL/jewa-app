'use strict';

const TITLES = {
    403: 'Acceso denegado',
    404: 'Página no encontrada',
    500: 'Algo salió mal',
};
const MESSAGES = {
    403: 'No tienes permiso para ver esta página.',
    404: 'La página que buscas no existe o fue movida.',
    500: 'Ocurrió un error inesperado. Intenta de nuevo; si continúa, avisa al administrador.',
};

class HttpError extends Error {
    constructor(status, message) {
        super(message || MESSAGES[status] || 'Error');
        this.status = status;
        this.expose = true;
    }
}

function wantsJson(req) {
    return req.path.startsWith('/api/') || (req.accepts(['html', 'json']) === 'json');
}

function render(res, req, status, message) {
    res.status(status);
    if (wantsJson(req)) return res.json({ error: message });
    return res.render('error', { status, title: TITLES[status] || 'Error', message });
}

function notFound(req, res) {
    render(res, req, 404, MESSAGES[404]);
}

// Nunca muestra trazas al usuario: se registran solo en el servidor.
function errorHandler(config) {
    // eslint-disable-next-line no-unused-vars
    return (error, req, res, next) => {
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
        if (status >= 500) console.error(error);
        const message = status < 500 && error.expose ? error.message : MESSAGES[status] || MESSAGES[500];
        render(res, req, status, message);
    };
}

module.exports = { HttpError, notFound, errorHandler };
