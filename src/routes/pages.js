'use strict';
const express = require('express');
const { MODULES, homeCardsFor } = require('../modules');
const { requireModule } = require('../middleware/user');

const router = express.Router();

router.get('/', requireModule('inicio'), (req, res) => {
    res.render('inicio', { title: 'Inicio', active: 'inicio', cards: homeCardsFor(req.user.rol) });
});

// Módulos aún no implementados: página provisional con el mismo diseño y control de acceso.
// Cada issue reemplaza su ruta por la real.
// (Ajustes, Clientes y Mascotas ya tienen sus rutas reales.)
const IMPLEMENTADOS = ['inicio', 'ajustes', 'clientes', 'mascotas', 'citas', 'historial', 'farmacia', 'ventas', 'recordatorios'];
for (const mod of MODULES.filter((m) => !IMPLEMENTADOS.includes(m.key))) {
    router.get(mod.path, requireModule(mod.key), (req, res) => {
        res.render('placeholder', { title: mod.label, active: mod.key, mod });
    });
}

module.exports = router;
