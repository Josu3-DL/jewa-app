'use strict';
const express = require('express');
const { requireModule } = require('../../middleware/user');
const { clinicaRoutes } = require('./clinica');
const { serviciosRoutes } = require('./servicios');
const { usuariosRoutes } = require('./usuarios');
const { bitacoraRoutes } = require('./bitacora');

/**
 * Todo /ajustes es solo para administradores (T-03). Pestañas:
 * Clínica (/ajustes) · Servicios · Usuarios · Bitácora.
 */
function ajustesRoutes({ db, now }) {
    const router = express.Router();
    router.use('/ajustes', requireModule('ajustes'));
    router.use('/ajustes/servicios', serviciosRoutes({ db, now }));
    router.use('/ajustes/usuarios', usuariosRoutes({ db, now }));
    router.use('/ajustes/bitacora', bitacoraRoutes({ db, now }));
    router.use('/ajustes', clinicaRoutes({ db, now }));
    return router;
}

module.exports = { ajustesRoutes };
