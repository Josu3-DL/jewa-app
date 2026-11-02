'use strict';
const express = require('express');
const { MONEDAS } = require('../../utils/money');
const settings = require('../../services/settings');
const { contexto, texto } = require('./comun');

const CAMPOS_TEXTO = ['nombre', 'telefono', 'direccion', 'moneda', 'iva', 'duracionCitaMin'];

// Montado en /ajustes (la primera pestaña: datos de la clínica, moneda, IVA, horario y duración de cita).
function clinicaRoutes({ db }) {
    const router = express.Router();
    const monedas = Object.entries(MONEDAS).map(([valor, m]) => ({ valor, texto: m.nombre }));

    const render = (req, res, status, { errors = {}, values = null } = {}) => {
        res.status(status).render('ajustes/clinica', {
            title: 'Ajustes', active: 'ajustes', tab: 'clinica',
            dias: settings.DIAS, monedas, errors,
            values: values || settings.paraFormulario(settings.getSettings(db)),
        });
    };

    router.get('/', (req, res) => render(req, res, 200));

    router.post('/', (req, res) => {
        const body = req.body || {};
        const result = settings.saveSettings(db, body, contexto(req));
        if (!result.ok) {
            // Se devuelve lo escrito para no perder el trabajo
            const values = Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, texto(body[c])]));
            for (const [dia] of settings.DIAS) {
                values[`${dia}_abierto`] = body[`${dia}_abierto`] === 'on';
                values[`${dia}_abre`] = texto(body[`${dia}_abre`]);
                values[`${dia}_cierra`] = texto(body[`${dia}_cierra`]);
            }
            return render(req, res, 400, { errors: result.errors, values });
        }
        req.flash('ok', result.sinCambios ? 'No había cambios que guardar.' : 'Ajustes guardados.');
        return res.redirect('/ajustes');
    });

    return router;
}

module.exports = { clinicaRoutes };
