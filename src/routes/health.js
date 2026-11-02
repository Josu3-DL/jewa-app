'use strict';
const express = require('express');

const router = express.Router();

// Responde 200 si la base de datos abre; no expone datos sensibles.
router.get('/salud', (req, res) => {
    try {
        req.app.locals.db.prepare('SELECT 1').get();
        res.json({ estado: 'ok' });
    } catch (error) {
        console.error('Fallo en /salud:', error);
        res.status(503).json({ estado: 'error' });
    }
});

module.exports = router;
