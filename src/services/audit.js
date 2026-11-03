'use strict';
const { z, fecha, opcional, parseForm } = require('../utils/validation');
const { managuaDayRange } = require('../utils/dates');

// Claves que nunca deben llegar a la bitácora, a cualquier profundidad (RNF-04, "no se registran contraseñas").
const SENSIBLE = /pass|contrase|clave|hash|token|secret/i;

function limpiar(valor) {
    if (Array.isArray(valor)) return valor.map(limpiar);
    if (valor && typeof valor === 'object') {
        return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, SENSIBLE.test(k) ? '[omitido]' : limpiar(v)]));
    }
    return valor;
}

/**
 * Registra una acción en la bitácora (tabla solo de inserción).
 * `detalle` se limpia: cualquier clave que parezca una contraseña, hash o token se omite.
 */
function log(db, { usuarioId = null, accion, entidad, entidadId = null, detalle = null, ip = null, fecha = new Date() }) {
    const payload = detalle === null || detalle === undefined ? null : JSON.stringify(limpiar(detalle));
    db.prepare(`INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle, ip, fecha)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(usuarioId, accion, entidad, entidadId, payload, ip, fecha.toISOString());
}

/** Atajo para las rutas: toma usuario e IP de la petición. */
function logReq(db, req, campos) {
    log(db, { usuarioId: req.user ? req.user.id : null, ip: req.ip, ...campos });
}

const ACCIONES = {
    login: 'Inicio de sesión',
    logout: 'Cierre de sesión',
    login_fallido: 'Intento fallido de inicio de sesión',
    login_bloqueado: 'Intento con la cuenta bloqueada',
    cuenta_bloqueada: 'Cuenta bloqueada por intentos fallidos',
    usuario_creado: 'Usuario creado',
    usuario_editado: 'Usuario editado',
    usuario_desactivado: 'Usuario desactivado',
    usuario_activado: 'Usuario reactivado',
    usuario_desbloqueado: 'Cuenta desbloqueada',
    contrasena_restablecida: 'Contraseña restablecida',
    ajustes_editados: 'Ajustes de la clínica editados',
    servicio_creado: 'Servicio creado',
    servicio_editado: 'Servicio editado',
    servicio_desactivado: 'Servicio desactivado',
    servicio_activado: 'Servicio reactivado',
    propietario_creado: 'Cliente creado',
    propietario_editado: 'Cliente editado',
    propietario_desactivado: 'Cliente desactivado',
    propietario_activado: 'Cliente reactivado',
    consentimiento_cambiado: 'Consentimiento de notificaciones cambiado',
    mascota_creada: 'Mascota creada',
    mascota_editada: 'Mascota editada',
    mascota_transferida: 'Mascota transferida a otro propietario',
    mascota_foto_cambiada: 'Foto de mascota cambiada',
    mascota_foto_quitada: 'Foto de mascota quitada',
};
const ENTIDADES = { usuario: 'Usuario', servicio: 'Servicio', config: 'Ajustes', propietario: 'Cliente', mascota: 'Mascota', cita: 'Cita', consulta: 'Consulta' };

const etiquetaAccion = (codigo) => ACCIONES[codigo] || codigo;
const etiquetaEntidad = (codigo) => ENTIDADES[codigo] || codigo;

/** Texto legible del detalle JSON: "intento: 2", "cambios: rol: a → b; nombre: x → y". */
function detalleATexto(json) {
    if (!json) return '';
    let datos;
    try { datos = JSON.parse(json); } catch { return ''; }
    const plano = (v) => (Array.isArray(v) ? v.map(plano).join('; ') : v && typeof v === 'object'
        ? Object.entries(v).map(([k, x]) => `${k}: ${plano(x)}`).join(', ')
        : String(v));
    return plano(datos);
}

// ───────── Consulta con filtros (usuario, entidad, rango de fechas en hora de Managua)
const POR_PAGINA = 50;

const filtrosSchema = z.object({
    usuario: opcional(z.coerce.number().int().positive()),
    entidad: opcional(z.string().trim().max(50)),
    desde: opcional(fecha()),
    hasta: opcional(fecha()),
    pagina: opcional(z.coerce.number().int().min(1)),
});

/** Lee y valida los filtros de la URL; los inválidos se ignoran en lugar de romper la pantalla. */
function leerFiltros(query) {
    const todo = parseForm(filtrosSchema, query);
    if (todo.ok) return { filtros: todo.values, errores: {} };
    // Se conservan los campos válidos y se reportan los demás
    const filtros = {};
    for (const campo of Object.keys(filtrosSchema.shape)) {
        if (!todo.errors[campo]) {
            const r = filtrosSchema.shape[campo].safeParse(query[campo]);
            if (r.success) filtros[campo] = r.data;
        }
    }
    return { filtros, errores: todo.errors };
}

function consultar(db, { usuario, entidad, desde, hasta, pagina = 1 } = {}) {
    // SQL fijo: cada filtro opcional es `(? IS NULL OR campo = ?)`; todos los valores viajan como parámetros.
    const filtro = [
        usuario ?? null, usuario ?? null,
        entidad ?? null, entidad ?? null,
        desde ? managuaDayRange(desde).from : null, desde ? managuaDayRange(desde).from : null,
        hasta ? managuaDayRange(hasta).to : null, hasta ? managuaDayRange(hasta).to : null,
    ];
    const total = db.prepare(`
        SELECT COUNT(*) AS n FROM bitacora b
        WHERE (? IS NULL OR b.usuario_id = ?) AND (? IS NULL OR b.entidad = ?)
          AND (? IS NULL OR b.fecha >= ?) AND (? IS NULL OR b.fecha < ?)`).get(...filtro).n;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const actual = Math.min(Math.max(1, pagina), paginas);
    const filas = db.prepare(`
        SELECT b.id, b.fecha, b.accion, b.entidad, b.entidad_id, b.detalle, b.ip, b.usuario_id,
               u.nombre AS usuario_nombre, u.usuario AS usuario_login
        FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
        WHERE (? IS NULL OR b.usuario_id = ?) AND (? IS NULL OR b.entidad = ?)
          AND (? IS NULL OR b.fecha >= ?) AND (? IS NULL OR b.fecha < ?)
        ORDER BY b.id DESC LIMIT ? OFFSET ?`).all(...filtro, POR_PAGINA, (actual - 1) * POR_PAGINA);

    return { filas, total, pagina: actual, paginas, porPagina: POR_PAGINA };
}

function entidadesRegistradas(db) {
    return db.prepare('SELECT DISTINCT entidad FROM bitacora ORDER BY entidad').all().map((r) => r.entidad);
}

module.exports = { log, logReq, consultar, leerFiltros, entidadesRegistradas, etiquetaAccion, etiquetaEntidad, detalleATexto, POR_PAGINA };
