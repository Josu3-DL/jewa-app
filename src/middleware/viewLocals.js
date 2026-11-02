'use strict';
const { navFor } = require('../modules');
const { ROLE_LABELS } = require('../roles');
const { getSetting } = require('../services/settings');
const { formatLongDate, yearInZone, initials } = require('../utils/dates');

/** Variables comunes a todas las vistas (menú por rol, fecha de Managua, nombre de la clínica). */
function viewLocals({ config, db, now }) {
    return (req, res, next) => {
        const date = now();
        const user = req.user || null;
        res.locals.clinicName = getSetting(db, 'nombre_clinica', 'JEWA');
        res.locals.todayLabel = formatLongDate(date);
        res.locals.currentYear = yearInZone(date);
        res.locals.appVersion = config.version;
        res.locals.nav = user ? navFor(user.rol) : { main: [], footer: [] };
        res.locals.initials = user ? initials(user.nombre) : '';
        res.locals.roleLabel = user ? ROLE_LABELS[user.rol] || user.rol : '';
        res.locals.active = null;
        next();
    };
}

module.exports = { viewLocals };
