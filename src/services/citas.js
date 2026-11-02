'use strict';
const { z, opcional, texto, fecha, casilla, parseForm } = require('../utils/validation');
const { managuaToUtc, utcToManagua, hora12, diaSemana } = require('../utils/dates');
const { transaction } = require('../db/connection');
const { getSettings, DIAS } = require('./settings');
const audit = require('./audit');

// Citas (RF-09…RF-12). El "responsable" es cualquier usuario activo con atiende_citas = 1 (D-21):
// así un groomer tiene agenda sin ser veterinario. Grooming es un tipo de servicio (D-07).
// Las citas nunca se borran: se cancelan, y una cita cancelada o "no asistió" libera el horario.

const ESTADOS = [
    { valor: 'programada', texto: 'Programada', clase: 'status-new' },
    { valor: 'confirmada', texto: 'Confirmada', clase: 'status-confirmed' },
    { valor: 'en_espera', texto: 'En espera', clase: 'status-waiting' },
    { valor: 'atendida', texto: 'Atendida', clase: 'status-done' },
    { valor: 'no_asistio', texto: 'No asistió', clase: 'status-noshow' },
    { valor: 'cancelada', texto: 'Cancelada', clase: 'status-cancelled' },
];
const ESTADO = Object.fromEntries(ESTADOS.map((e) => [e.valor, e]));
const ACTIVOS = ['programada', 'confirmada', 'en_espera'];
// Atendida, no asistió y cancelada son finales: si hace falta otra cita, se crea una nueva.
const TRANSICIONES = {
    programada: ['confirmada', 'en_espera', 'atendida', 'no_asistio', 'cancelada'],
    confirmada: ['en_espera', 'atendida', 'no_asistio', 'cancelada'],
    en_espera: ['atendida', 'no_asistio', 'cancelada'],
    atendida: [], no_asistio: [], cancelada: [],
};
const ACCION_TEXTO = { confirmada: 'Confirmar', en_espera: 'Llegó', atendida: 'Atendida', no_asistio: 'No asistió', cancelada: 'Cancelar' };

const id = (mensaje) => z.coerce.number({ error: mensaje }).int({ error: mensaje }).positive({ error: mensaje });
const HORA = z.string({ error: 'Elige la hora.' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no válida (ej. 09:30).');

const citaSchema = z.object({
    responsable: id('Elige al responsable.'),
    servicio: opcional(id('Servicio no válido.')),
    fecha: fecha(),
    hora: HORA,
    motivo: opcional(texto({ max: 200 })),
    notas: opcional(texto({ max: 500 })),
    confirmar: casilla(),
});
const mascotaSchema = z.object({ mascota: id('Elige una mascota.') });

const noEncontrado = { ok: false, notFound: true };

/** Usuarios que pueden tener agenda. */
const responsables = (db) => db.prepare(`SELECT id, nombre, rol FROM usuarios
    WHERE activo = 1 AND atiende_citas = 1 ORDER BY nombre COLLATE NOCASE`).all();

/** Servicios que se pueden agendar (activos). */
const serviciosActivos = (db) => db.prepare(`SELECT id, nombre, tipo, duracion_min FROM servicios
    WHERE activo = 1 ORDER BY tipo, nombre COLLATE NOCASE`).all();

/** Cita lista para la vista: hora local, estado legible y acciones rápidas permitidas. */
function decorar(c) {
    const ini = utcToManagua(c.inicio);
    const fin = utcToManagua(c.fin);
    const est = ESTADO[c.estado];
    return {
        ...c,
        fecha: ini.fecha, hora: ini.hora, finHora: fin.hora,
        horaTexto: hora12(ini.hora), finTexto: hora12(fin.hora),
        estadoTexto: est.texto, estadoClase: est.clase,
        acciones: TRANSICIONES[c.estado].map((valor) => ({ valor, texto: ACCION_TEXTO[valor] })),
        editable: TRANSICIONES[c.estado].length > 0,
    };
}

function getCita(db, citaId) {
    const c = db.prepare(`
        SELECT c.id, c.mascota_id, c.veterinario_id AS responsable_id, c.servicio_id, c.inicio, c.fin, c.estado, c.motivo, c.notas,
               m.nombre AS mascota_nombre, m.numero_expediente, m.especie, m.propietario_id,
               p.nombre AS propietario_nombre, p.telefono AS propietario_telefono,
               u.nombre AS responsable_nombre, s.nombre AS servicio_nombre, s.tipo AS servicio_tipo
        FROM citas c
        JOIN mascotas m ON m.id = c.mascota_id
        JOIN propietarios p ON p.id = m.propietario_id
        JOIN usuarios u ON u.id = c.veterinario_id
        LEFT JOIN servicios s ON s.id = c.servicio_id
        WHERE c.id = ?`).get(citaId);
    return c ? decorar(c) : null;
}

/** Citas entre dos instantes UTC [desde, hasta), con filtros opcionales (SQL fijo, todo por parámetros). */
function listarCitas(db, { desde, hasta, responsableId = null, tipo = null, mascotaId = null, estados = null } = {}) {
    // `estados` se compara como texto "|a|b|" para no armar el SQL por partes
    const lista = estados ? `|${estados.join('|')}|` : null;
    return db.prepare(`
        SELECT c.id, c.mascota_id, c.veterinario_id AS responsable_id, c.servicio_id, c.inicio, c.fin, c.estado, c.motivo, c.notas,
               m.nombre AS mascota_nombre, m.numero_expediente, m.especie, m.propietario_id,
               p.nombre AS propietario_nombre, p.telefono AS propietario_telefono,
               u.nombre AS responsable_nombre, s.nombre AS servicio_nombre, s.tipo AS servicio_tipo
        FROM citas c
        JOIN mascotas m ON m.id = c.mascota_id
        JOIN propietarios p ON p.id = m.propietario_id
        JOIN usuarios u ON u.id = c.veterinario_id
        LEFT JOIN servicios s ON s.id = c.servicio_id
        WHERE c.inicio >= ? AND c.inicio < ?
          AND (? IS NULL OR c.veterinario_id = ?)
          AND (? IS NULL OR s.tipo = ?)
          AND (? IS NULL OR c.mascota_id = ?)
          AND (? IS NULL OR instr(?, '|' || c.estado || '|') > 0)
        ORDER BY c.inicio, c.id`).all(desde, hasta, responsableId, responsableId, tipo, tipo, mascotaId, mascotaId, lista, lista).map(decorar);
}

/** Próximas citas activas (desde ahora). `soloEstado` limita a un estado (p. ej. pendientes de confirmar). */
function proximasCitas(db, ahora, { responsableId = null, tipo = null, soloEstado = null, limite = 8 } = {}) {
    const lejos = '9999-12-31T00:00:00Z';
    const filas = listarCitas(db, {
        desde: ahora.toISOString(), hasta: lejos, responsableId, tipo,
        estados: soloEstado ? [soloEstado] : ACTIVOS,
    });
    return filas.slice(0, limite);
}

/** Avisos (no bloquean; hay que confirmarlos): fecha pasada, día cerrado u hora fuera del horario (T-22). */
function advertencias(db, { fecha: dia, hora, finHora, finFecha, inicioUtc }, ahora) {
    const avisos = [];
    if (new Date(inicioUtc) < ahora) avisos.push('La fecha y hora elegidas ya pasaron.');
    const [clave, nombreDia] = DIAS[diaSemana(dia)];
    const tramo = getSettings(db).horario[clave];
    if (!tramo) {
        const plural = nombreDia.toLowerCase().replace(/([^s])$/, '$1s'); // lunes, martes… ya son plurales
        avisos.push(`La clínica está cerrada los ${plural}.`);
    }
    else if (hora < tramo.abre || finFecha !== dia || finHora > tramo.cierra) {
        avisos.push(`La cita queda fuera del horario laboral (${hora12(tramo.abre)} – ${hora12(tramo.cierra)}).`);
    }
    return avisos;
}

/** Cita activa del mismo responsable que se traslapa con [inicio, fin) (T-05/T-06/T-07: el borde exacto no cuenta). */
const traslape = (db, responsableId, inicio, fin, exceptoId = 0) => db.prepare(`
    SELECT id, inicio, fin FROM citas
    WHERE veterinario_id = ? AND estado NOT IN ('cancelada', 'no_asistio')
      AND inicio < ? AND fin > ? AND id <> ?
    ORDER BY inicio LIMIT 1`).get(responsableId, fin, inicio, exceptoId);

/** Valida y calcula todo lo de la cita (sin guardar). Devuelve { errors } o { datos } o { advertencias }. */
function preparar(db, input, { ahora, exceptoId = 0, mascotaId }) {
    const f = parseForm(citaSchema, input);
    if (!f.ok) return { errors: f.errors };
    const v = f.values;
    const errors = {};

    const resp = db.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1 AND atiende_citas = 1').get(v.responsable);
    if (!resp) errors.responsable = 'Ese usuario no atiende citas o está desactivado.';
    let servicio = null;
    if (v.servicio !== undefined) {
        servicio = db.prepare('SELECT id, duracion_min FROM servicios WHERE id = ? AND activo = 1').get(v.servicio);
        if (!servicio) errors.servicio = 'El servicio no existe o está desactivado.';
    }
    const m = db.prepare("SELECT id FROM mascotas WHERE id = ? AND estado = 'activa'").get(mascotaId);
    if (!m) errors.mascota = 'La mascota no existe o no está activa.';
    if (Object.keys(errors).length) return { errors };

    const duracion = servicio ? servicio.duracion_min : getSettings(db).duracionCitaMin;
    const inicio = managuaToUtc(v.fecha, v.hora);
    const fin = new Date(new Date(inicio).getTime() + duracion * 60000).toISOString().replace('.000Z', 'Z');
    const choque = traslape(db, v.responsable, inicio, fin, exceptoId);
    if (choque) {
        const a = utcToManagua(choque.inicio);
        const b = utcToManagua(choque.fin);
        return { errors: { hora: `Ese responsable ya tiene una cita de ${hora12(a.hora)} a ${hora12(b.hora)}. Elige otra hora o responsable.` } };
    }
    const finLocal = utcToManagua(fin);
    const avisos = advertencias(db, { fecha: v.fecha, hora: v.hora, finHora: finLocal.hora, finFecha: finLocal.fecha, inicioUtc: inicio }, ahora);
    if (avisos.length && !v.confirmar) return { advertencias: avisos };
    return { datos: { ...v, servicioId: servicio ? servicio.id : null, inicio, fin, duracion } };
}

function crearCita(db, input, { actorId = null, ip = null, ahora = new Date() } = {}) {
    const dueno = parseForm(mascotaSchema, input);
    if (!dueno.ok) return { ok: false, errors: dueno.errors };
    return transaction(db, () => {
        const r = preparar(db, input, { ahora, mascotaId: dueno.values.mascota });
        if (r.errors) return { ok: false, errors: r.errors };
        if (r.advertencias) return { ok: false, advertencias: r.advertencias };
        const d = r.datos;
        const res = db.prepare(`INSERT INTO citas (mascota_id, veterinario_id, servicio_id, inicio, fin, motivo, notas, creado_por)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(dueno.values.mascota, d.responsable, d.servicioId, d.inicio, d.fin, d.motivo ?? null, d.notas ?? null, actorId);
        const nuevoId = Number(res.lastInsertRowid);
        audit.log(db, { usuarioId: actorId, accion: 'cita_creada', entidad: 'cita', entidadId: nuevoId, detalle: { mascota_id: dueno.values.mascota, inicio: d.inicio, responsable_id: d.responsable }, ip });
        return { ok: true, id: nuevoId };
    });
}

/** Reprograma o corrige una cita que todavía no terminó. La mascota no cambia. */
function actualizarCita(db, citaId, input, { actorId = null, ip = null, ahora = new Date() } = {}) {
    return transaction(db, () => {
        const actual = getCita(db, citaId);
        if (!actual) return noEncontrado;
        if (!actual.editable) return { ok: false, error: 'Esta cita ya terminó (atendida, cancelada o no asistió) y no se puede modificar.' };
        const r = preparar(db, input, { ahora, exceptoId: citaId, mascotaId: actual.mascota_id });
        if (r.errors) return { ok: false, errors: r.errors };
        if (r.advertencias) return { ok: false, advertencias: r.advertencias };
        const d = r.datos;
        const cambios = [];
        if (d.inicio !== actual.inicio) cambios.push(`horario: ${actual.fecha} ${actual.hora} → ${utcToManagua(d.inicio).fecha} ${utcToManagua(d.inicio).hora}`);
        if (d.responsable !== actual.responsable_id) cambios.push(`responsable: ${actual.responsable_nombre} → #${d.responsable}`);
        if (d.servicioId !== actual.servicio_id) cambios.push(`servicio: ${actual.servicio_nombre || '—'} → #${d.servicioId ?? '—'}`);
        if ((d.motivo ?? null) !== (actual.motivo ?? null)) cambios.push('motivo modificado');
        if ((d.notas ?? null) !== (actual.notas ?? null)) cambios.push('notas modificadas');
        if (!cambios.length) return { ok: true, sinCambios: true };
        db.prepare('UPDATE citas SET veterinario_id = ?, servicio_id = ?, inicio = ?, fin = ?, motivo = ?, notas = ? WHERE id = ?')
            .run(d.responsable, d.servicioId, d.inicio, d.fin, d.motivo ?? null, d.notas ?? null, citaId);
        audit.log(db, { usuarioId: actorId, accion: 'cita_editada', entidad: 'cita', entidadId: citaId, detalle: { cambios }, ip });
        return { ok: true };
    });
}

function cambiarEstado(db, citaId, nuevo, { actorId = null, ip = null } = {}) {
    return transaction(db, () => {
        const actual = getCita(db, citaId);
        if (!actual) return noEncontrado;
        if (!ESTADO[nuevo]) return { ok: false, error: 'Estado no válido.' };
        if (!TRANSICIONES[actual.estado].includes(nuevo)) {
            return { ok: false, error: `Una cita ${actual.estadoTexto.toLowerCase()} no puede pasar a ${ESTADO[nuevo].texto.toLowerCase()}.` };
        }
        db.prepare('UPDATE citas SET estado = ? WHERE id = ?').run(nuevo, citaId);
        audit.log(db, { usuarioId: actorId, accion: 'cita_estado', entidad: 'cita', entidadId: citaId, detalle: { de: actual.estado, a: nuevo }, ip });
        return { ok: true, estadoTexto: ESTADO[nuevo].texto };
    });
}

/** Valores del formulario a partir de una cita guardada. */
const paraFormulario = (c) => ({
    responsable: String(c.responsable_id), servicio: c.servicio_id ? String(c.servicio_id) : '',
    fecha: c.fecha, hora: c.hora, motivo: c.motivo || '', notas: c.notas || '',
});

module.exports = {
    ESTADOS, ESTADO, ACTIVOS, TRANSICIONES,
    responsables, serviciosActivos, getCita, listarCitas, proximasCitas,
    crearCita, actualizarCita, cambiarEstado, paraFormulario,
};
