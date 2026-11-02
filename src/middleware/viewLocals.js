'use strict';
const { navFor } = require('../modules');
const { ROLE_LABELS } = require('../roles');
const { getSettings } = require('../services/settings');
const { formatMoney } = require('../utils/money');
const { formatLongDate, yearInZone, initials } = require('../utils/dates');

/**
 * Variables comunes a todas las vistas: menú por rol, fecha de Managua, nombre de la clínica (de Ajustes)
 * y `dinero(centavos)` para mostrar importes con la moneda configurada ("C$ 1,234.50").
 */
function viewLocals({ config, db, now }) {
    return (req, res, next) => {
        const date = now();
        const user = req.user || null;
        const ajustes = getSettings(db);
        res.locals.clinicName = ajustes.nombre;
        res.locals.dinero = (centavos) => formatMoney(centavos, ajustes.moneda);
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
