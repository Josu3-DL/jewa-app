'use strict';
const express = require('express');
const { requireModule } = require('../middleware/user');
const recordatorios = require('../services/recordatorios');
const { formatDateTime } = require('../utils/dates');
const { texto } = require('./ajustes/comun');

// /recordatorios: lista diaria de avisos pendientes (citas de las próximas 24 h y vacunas próximas o vencidas).
// Los tres roles la usan. No se envía nada solo: se abre WhatsApp con el mensaje escrito y luego se marca "enviado" (D-09).
function recordatoriosRoutes({ db, now }) {
    const router = express.Router();
    router.use('/recordatorios', requireModule('recordatorios'));

    router.get('/recordatorios', (req, res) => {
        const r = recordatorios.recordatorios(db, now());
        const marca = (x) => ({ ...x, enviadoTexto: x.enviado ? `${x.enviado.por}, ${formatDateTime(x.enviado.en)}` : '' });
        const citas = r.citas.map(marca);
        const vacunas = r.vacunas.map(marca);
        res.render('recordatorios/lista', {
            title: 'Recordatorios', active: 'recordatorios', citas, vacunas, omitidos: r.omitidos,
            pendientes: [...citas, ...vacunas].filter((x) => !x.enviado).length,
            horas: recordatorios.HORAS_CITA, dias: recordatorios.DIAS_VACUNA,
        });
    });

    router.post('/recordatorios/enviado', (req, res) => {
        const tipo = texto(req.body && req.body.tipo);
        const id = Number.parseInt(texto(req.body && req.body.id), 10);
        const r = recordatorios.marcarEnviado(db, { tipo, id }, { actorId: req.user.id, ip: req.ip, ahora: now() });
        if (r.ok) req.flash('ok', 'Recordatorio marcado como enviado.'); else req.flash('error', r.error);
        return res.redirect('/recordatorios');
    });

    return router;
}

module.exports = { recordatoriosRoutes };
