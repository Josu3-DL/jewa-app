'use strict';

/**
 * Registra una acción en la bitácora (tabla solo de inserción).
 * Nunca recibir contraseñas ni datos sensibles innecesarios en `detalle`.
 */
function log(db, { usuarioId = null, accion, entidad, entidadId = null, detalle = null, ip = null, fecha = new Date() }) {
    const payload = detalle === null || detalle === undefined ? null : JSON.stringify(detalle);
    db.prepare(`INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle, ip, fecha)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(usuarioId, accion, entidad, entidadId, payload, ip, fecha.toISOString());
}

module.exports = { log };
