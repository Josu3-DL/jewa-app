'use strict';

const ZONE = 'America/Managua';
// Managua está en UTC-6 todo el año (sin horario de verano).
const OFFSET_HOURS = 6;

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Lunes, 2 de noviembre de 2026" en la zona de Managua. */
function formatLongDate(date, zone = ZONE) {
    const text = new Intl.DateTimeFormat('es-NI', {
        timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(date);
    return capitalize(text);
}

/** "02/11/2026 09:05" en la zona de Managua (acepta Date o texto ISO). */
function formatDateTime(value, zone = ZONE) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]));
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** Año calendario en la zona de Managua. */
function yearInZone(date, zone = ZONE) {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }).format(date));
}

/**
 * Rango UTC [from, to) que cubre el día AAAA-MM-DD en hora de Managua.
 * Sirve para filtrar columnas guardadas en UTC por "día" tal como lo ve la clínica.
 */
function managuaDayRange(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, d, OFFSET_HOURS));
    const to = new Date(Date.UTC(y, m - 1, d + 1, OFFSET_HOURS));
    return { from: from.toISOString(), to: to.toISOString() };
}

/** Hoy como AAAA-MM-DD en la zona de Managua. */
function todayInZone(date, zone = ZONE) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Edad legible entre dos fechas AAAA-MM-DD: "2 años 3 meses", "5 meses", "12 días". Vacío si no hay fecha. */
function edadTexto(nacimiento, hoy) {
    if (!nacimiento) return '';
    const [ya, ma, da] = nacimiento.split('-').map(Number);
    const [yb, mb, db] = hoy.split('-').map(Number);
    if (!ya || !yb) return '';
    let meses = (yb - ya) * 12 + (mb - ma) - (db < da ? 1 : 0);
    if (meses < 0) return '';
    if (meses < 1) {
        const dias = Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
        return `${dias} ${dias === 1 ? 'día' : 'días'}`;
    }
    const anios = Math.floor(meses / 12);
    meses %= 12;
    const a = anios ? `${anios} ${anios === 1 ? 'año' : 'años'}` : '';
    const m = meses ? `${meses} ${meses === 1 ? 'mes' : 'meses'}` : '';
    return [a, m].filter(Boolean).join(' ');
}

/** Iniciales para el avatar: "Laura Mendez" -> "LM". */
function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
    return letters.toUpperCase();
}

module.exports = { ZONE, formatLongDate, formatDateTime, yearInZone, managuaDayRange, todayInZone, edadTexto, initials };
