'use strict';

/** Lee un ajuste de la tabla config; devuelve fallback si no existe. */
function getSetting(db, key, fallback = null) {
    const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(key);
    return row ? row.valor : fallback;
}

module.exports = { getSetting };
