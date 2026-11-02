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
// (Ajustes ya tiene sus rutas reales en routes/ajustes.js.)
for (const mod of MODULES.filter((m) => m.key !== 'inicio' && m.key !== 'ajustes')) {
    router.get(mod.path, requireModule(mod.key), (req, res) => {
        res.render('placeholder', { title: mod.label, active: mod.key, mod });
    });
}

module.exports = router;
