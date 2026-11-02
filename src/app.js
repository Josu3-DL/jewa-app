'use strict';
const path = require('node:path');
const express = require('express');
const healthRoutes = require('./routes/health');
const pageRoutes = require('./routes/pages');
const { attachUser } = require('./middleware/user');
const { viewLocals } = require('./middleware/viewLocals');
const { notFound, errorHandler } = require('./middleware/errors');

/**
 * Construye la aplicación Express. Recibe la BD y la configuración para poder
 * probarla con una base en memoria. `now` y `resolveUser` se pueden inyectar en pruebas.
 */
function createApp({ db, config, now = () => new Date(), resolveUser } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.locals.config = config;
    app.locals.db = db;

    app.use('/css', express.static(path.join(config.root, 'public', 'css')));
    app.use('/js', express.static(path.join(config.root, 'public', 'js')));
    app.use('/img', express.static(path.join(config.root, 'public', 'img')));
    app.use('/vendor', express.static(path.join(config.root, 'public', 'vendor')));

    app.use(healthRoutes);

    app.use(attachUser(config, resolveUser));
    app.use(viewLocals({ config, db, now }));
    app.use(pageRoutes);

    app.use(notFound);
    app.use(errorHandler(config));
    return app;
}

module.exports = { createApp };
