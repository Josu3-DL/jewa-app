'use strict';

const ZONE = 'America/Managua';

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Lunes, 2 de noviembre de 2026" en la zona de Managua (UTC-6, sin horario de verano). */
function formatLongDate(date, zone = ZONE) {
    const text = new Intl.DateTimeFormat('es-NI', {
        timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(date);
    return capitalize(text);
}

/** Año calendario en la zona de Managua. */
function yearInZone(date, zone = ZONE) {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric' }).format(date));
}

/** Iniciales para el avatar: "Laura Mendez" -> "LM". */
function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
    return letters.toUpperCase();
}

module.exports = { ZONE, formatLongDate, yearInZone, initials };
