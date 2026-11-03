'use strict';
const path = require('node:path');
const express = require('express');
const healthRoutes = require('./routes/health');
const pageRoutes = require('./routes/pages');
const { authRoutes } = require('./routes/auth');
const { ajustesRoutes } = require('./routes/ajustes');
const { clientesRoutes } = require('./routes/clientes');
const { mascotasRoutes } = require('./routes/mascotas');
const { citasRoutes } = require('./routes/citas');
const { historialRoutes } = require('./routes/historial');
const { adjuntosRoutes } = require('./routes/adjuntos');
const { farmaciaRoutes } = require('./routes/farmacia');
const { ventasRoutes } = require('./routes/ventas');
const { flash } = require('./middleware/flash');
const { security } = require('./middleware/security');
const { createSession } = require('./middleware/session');
const { attachUser, requireAuth } = require('./middleware/user');
const { viewLocals } = require('./middleware/viewLocals');
const { csrf } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errors');

/**
 * Construye la aplicación Express. Recibe la BD y la configuración para poder
 * probarla con una base en memoria. `now` y `resolveUser` se pueden inyectar en pruebas.
 *
 * Orden: cabeceras de seguridad → estáticos y /salud (públicos, sin sesión) → cuerpo →
 * sesión → usuario → variables de vista → CSRF → login/logout → TODO lo demás exige sesión.
 */
function createApp({ db, config, now = () => new Date(), resolveUser } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.locals.config = config;
    app.locals.db = db;

    app.use(security(config));

    app.use('/css', express.static(path.join(config.root, 'public', 'css')));
    app.use('/js', express.static(path.join(config.root, 'public', 'js')));
    app.use('/img', express.static(path.join(config.root, 'public', 'img')));
    // Chart.js viene del paquete npm (sin CDN): se sirve el archivo ya empaquetado
    app.get('/vendor/chart.umd.min.js', (req, res) => res.sendFile(path.join(config.root, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js')));
    app.use('/vendor', express.static(path.join(config.root, 'public', 'vendor')));
    app.use(healthRoutes);

    app.use(express.urlencoded({ extended: false, limit: '100kb' }));
    app.use(createSession({ db, config }).middleware);
    app.use(attachUser({ db, now, resolveUser }));
    app.use(viewLocals({ config, db, now }));
    app.use(csrf());
    app.use(flash());

    app.use(authRoutes({ db, now }));
    app.use(requireAuth);
    app.use(ajustesRoutes({ db, now }));
    app.use(clientesRoutes({ db, now }));
    app.use(mascotasRoutes({ db, config, now }));
    app.use(citasRoutes({ db, now }));
    app.use(historialRoutes({ db, now }));
    app.use(adjuntosRoutes({ db, config, now }));
    app.use(farmaciaRoutes({ db, now }));
    app.use(ventasRoutes({ db, now }));
    app.use(pageRoutes);

    app.use(notFound);
    app.use(errorHandler(config));
    return app;
}

module.exports = { createApp };
