'use strict';
const path = require('node:path');
const express = require('express');
const healthRoutes = require('./routes/health');
const { notFound, errorHandler } = require('./middleware/errors');

/**
 * Construye la aplicación Express. Recibe la BD y la configuración para poder
 * probarla con una base en memoria.
 */
function createApp({ db, config }) {
    const app = express();
    app.disable('x-powered-by');
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.locals.config = config;
    app.locals.db = db;

    app.use('/css', express.static(path.join(config.root, 'public', 'css')));
    app.use('/js', express.static(path.join(config.root, 'public', 'js')));
    app.use('/vendor', express.static(path.join(config.root, 'public', 'vendor')));

    app.use(healthRoutes);

    app.use(notFound);
    app.use(errorHandler(config));
    return app;
}

module.exports = { createApp };
