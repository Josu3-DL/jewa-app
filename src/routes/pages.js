'use strict';
const express = require('express');
const { homeCardsFor, canAccess } = require('../modules');
const { requireModule } = require('../middleware/user');
const { panel } = require('../services/panel');
const { fechaCorta } = require('../utils/dates');

// Inicio: panel con datos reales. Todos los demás módulos ya tienen su propia ruta real.
function pageRoutes({ db, now }) {
    const router = express.Router();

    router.get('/', requireModule('inicio'), (req, res) => {
        const rol = req.user.rol;
        const p = panel(db, now(), rol);
        res.render('inicio', {
            title: 'Inicio', active: 'inicio', cards: homeCardsFor(rol), p,
            proximas: p.proximasCitas.map((c) => ({ ...c, fechaTexto: fechaCorta(c.fecha) })),
            puede: { citas: canAccess(rol, 'citas'), farmacia: canAccess(rol, 'farmacia'), recordatorios: canAccess(rol, 'recordatorios'), ventas: canAccess(rol, 'ventas') },
        });
    });

    return router;
}

module.exports = { pageRoutes };
