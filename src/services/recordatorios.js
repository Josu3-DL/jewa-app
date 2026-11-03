'use strict';
const { getSettings } = require('./settings');
const { verTelefono } = require('../utils/validation');
const { utcToManagua, hora12, fechaDMY, todayInZone, sumarDias } = require('../utils/dates');
const { transaction } = require('../db/connection');
const audit = require('./audit');

// Recordatorios (RF-31…RF-35, D-09). Sin API de mensajería: la clínica ve una lista diaria y abre WhatsApp con el
// mensaje ya escrito (enlace wa.me); después marca "enviado". Alcance académico (D-41): citas de las próximas 24 h y
// vacunas con próxima dosis cercana o vencida; sin plantillas editables. Los clientes que no aceptaron recibir
// avisos NUNCA aparecen (RN-06, T-17); solo se cuenta cuántos se omitieron.

const HORAS_CITA = 24;
const DIAS_VACUNA = 15;       // próxima dosis dentro de los próximos 15 días…
const DIAS_VENCIDA_MAX = 365; // …o vencida hasta hace un año

const PLANTILLAS_BASE = {
    cita: 'Hola {propietario}, le recordamos la cita de {mascota} en {clinica} el {fecha} a las {hora}. Si no puede asistir, avísenos por favor.',
    vacuna: 'Hola {propietario}, la vacuna de {mascota} ({vacuna}) está programada para el {fecha}. Escríbanos para agendar su cita en {clinica}.',
};

const iso = (d) => d.toISOString().replace('.000Z', 'Z');

/** Rellena {variables} de la plantilla; las que no se conocen quedan vacías. */
const rellenar = (texto, vars) => texto.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : vars[k]));

function plantilla(db, tipo) {
    const p = db.prepare('SELECT texto FROM plantillas WHERE tipo = ?').get(tipo);
    return p ? p.texto : PLANTILLAS_BASE[tipo];
}

/** Enlace a WhatsApp con el mensaje prellenado. El teléfono (505XXXXXXXX) solo lleva dígitos. */
const enlaceWhatsapp = (telefono, mensaje) => `https://wa.me/${String(telefono).replace(/\D/g, '')}?text=${encodeURIComponent(mensaje)}`;

/**
 * Recordatorios del momento: citas de las próximas 24 h y vacunas próximas o vencidas, cada uno con su mensaje,
 * su enlace de WhatsApp y, si ya se marcó, quién lo envió. Devuelve { citas, vacunas, omitidos }.
 */
function recordatorios(db, ahora = new Date()) {
    const clinica = getSettings(db).nombre;
    const hoy = todayInZone(ahora);
    const hasta = new Date(ahora.getTime() + HORAS_CITA * 3600000);
    let omitidos = 0;

    const armar = (fila, tipo, vars, fechaClave, refId) => {
        const mensaje = rellenar(plantilla(db, tipo), { propietario: fila.propietario_nombre, mascota: fila.mascota_nombre, clinica, ...vars });
        return {
            tipo, id: refId, fechaClave, mensaje,
            mascota: fila.mascota_nombre, mascotaId: fila.mascota_id, propietario: fila.propietario_nombre, propietarioId: fila.propietario_id,
            telefono: verTelefono(fila.telefono), whatsapp: enlaceWhatsapp(fila.telefono, mensaje),
            enviado: fila.enviada_en ? { por: fila.enviada_por_nombre, en: fila.enviada_en } : null,
            ...vars,
        };
    };

    const citasFilas = db.prepare(`
        SELECT c.id, c.inicio, m.id AS mascota_id, m.nombre AS mascota_nombre, p.id AS propietario_id, p.nombre AS propietario_nombre,
               p.telefono, p.acepta_notificaciones, n.enviada_en, u.nombre AS enviada_por_nombre
        FROM citas c JOIN mascotas m ON m.id = c.mascota_id JOIN propietarios p ON p.id = m.propietario_id
        LEFT JOIN notificaciones n ON n.tipo = 'cita' AND n.ref_tipo = 'cita' AND n.ref_id = c.id AND n.estado = 'enviada_manual'
             AND n.generada_para = c.inicio
        LEFT JOIN usuarios u ON u.id = n.enviada_por
        WHERE c.estado IN ('programada', 'confirmada') AND c.inicio >= ? AND c.inicio < ?
          AND m.estado = 'activa' AND p.activo = 1
        ORDER BY c.inicio, c.id`).all(iso(ahora), iso(hasta));
    const citas = [];
    for (const f of citasFilas) {
        if (!f.acepta_notificaciones) { omitidos += 1; continue; }
        const local = utcToManagua(f.inicio);
        // la clave de "ya enviado" es el horario exacto de la cita: si se reprograma, corresponde un aviso nuevo
        citas.push(armar(f, 'cita', { fecha: fechaDMY(local.fecha), hora: hora12(local.hora) }, f.inicio, f.id));
    }

    const vacunasFilas = db.prepare(`
        SELECT v.id, v.proxima_dosis, pr.nombre AS vacuna, m.id AS mascota_id, m.nombre AS mascota_nombre, p.id AS propietario_id,
               p.nombre AS propietario_nombre, p.telefono, p.acepta_notificaciones, n.enviada_en, u.nombre AS enviada_por_nombre
        FROM vacunas_aplicadas v JOIN productos pr ON pr.id = v.producto_id
        JOIN mascotas m ON m.id = v.mascota_id JOIN propietarios p ON p.id = m.propietario_id
        LEFT JOIN notificaciones n ON n.tipo = 'vacuna' AND n.ref_tipo = 'vacuna' AND n.ref_id = v.id AND n.estado = 'enviada_manual'
             AND n.generada_para = v.proxima_dosis
        LEFT JOIN usuarios u ON u.id = n.enviada_por
        WHERE v.estado = 'vigente' AND v.proxima_dosis <= ? AND v.proxima_dosis >= ?
          AND m.estado = 'activa' AND p.activo = 1
          AND NOT EXISTS (SELECT 1 FROM vacunas_aplicadas v2 WHERE v2.mascota_id = v.mascota_id AND v2.producto_id = v.producto_id
                          AND v2.estado = 'vigente' AND v2.fecha > v.fecha)
        ORDER BY v.proxima_dosis, v.id`).all(sumarDias(hoy, DIAS_VACUNA), sumarDias(hoy, -DIAS_VENCIDA_MAX));
    const vacunas = [];
    for (const f of vacunasFilas) {
        if (!f.acepta_notificaciones) { omitidos += 1; continue; }
        const r = armar(f, 'vacuna', { fecha: fechaDMY(f.proxima_dosis), vacuna: f.vacuna }, f.proxima_dosis, f.id);
        r.vencida = f.proxima_dosis < hoy;
        vacunas.push(r);
    }
    return { citas, vacunas, omitidos };
}

/**
 * Marca un recordatorio como enviado (por WhatsApp, a mano). Se vuelve a derivar del estado actual: solo se puede
 * marcar lo que realmente está en la lista, no enviado todavía y con consentimiento.
 */
function marcarEnviado(db, { tipo, id }, { actorId, ip = null, ahora = new Date() }) {
    if (tipo !== 'cita' && tipo !== 'vacuna') return { ok: false, error: 'Tipo de recordatorio no válido.' };
    return transaction(db, () => {
        const lista = recordatorios(db, ahora);
        const r = (tipo === 'cita' ? lista.citas : lista.vacunas).find((x) => x.id === id);
        if (!r) return { ok: false, error: 'Ese recordatorio ya no está en la lista (cambió la cita o la vacuna, o el cliente no acepta avisos).' };
        if (r.enviado) return { ok: false, error: 'Ese recordatorio ya estaba marcado como enviado.' };
        db.prepare(`INSERT INTO notificaciones (tipo, propietario_id, mascota_id, ref_tipo, ref_id, canal, mensaje, estado, generada_para, enviada_en, enviada_por)
                    VALUES (?, ?, ?, ?, ?, 'whatsapp', ?, 'enviada_manual', ?, ?, ?)`)
            .run(tipo, r.propietarioId, r.mascotaId, tipo, id, r.mensaje, r.fechaClave, iso(ahora), actorId);
        audit.log(db, { usuarioId: actorId, accion: 'recordatorio_enviado', entidad: 'recordatorio', entidadId: id, detalle: { tipo, mascota: r.mascota, propietario: r.propietario }, ip });
        return { ok: true };
    });
}

module.exports = { HORAS_CITA, DIAS_VACUNA, DIAS_VENCIDA_MAX, rellenar, enlaceWhatsapp, recordatorios, marcarEnviado };
