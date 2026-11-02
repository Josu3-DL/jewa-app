'use strict';

// Ayudantes para los buscadores. El SQL queda fijo (`LIKE ? ESCAPE '!'`) y el texto del usuario
// viaja siempre como parámetro: aquí solo se neutralizan los comodines de LIKE.

/** "ana_%" → patrón `%ana!_!%%` para `LIKE ? ESCAPE '!'`; vacío → null (sin filtro). */
function patron(texto) {
    const t = String(texto || '').trim().slice(0, 100);
    if (!t) return null;
    return `%${t.replace(/[!%_]/g, (c) => `!${c}`)}%`;
}

/** Patrón de teléfono: solo los dígitos escritos ("8888 7777" → %88887777%); menos de 3 dígitos → null. */
function patronTelefono(texto) {
    const d = String(texto || '').replace(/\D/g, '');
    return d.length >= 3 ? `%${d}%` : null;
}

const POR_PAGINA = 25;

/** Página pedida (texto de la URL) ajustada al rango real. */
function paginar(total, paginaPedida, porPagina = POR_PAGINA) {
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const n = Number.parseInt(paginaPedida, 10);
    const pagina = Math.min(Math.max(Number.isInteger(n) ? n : 1, 1), paginas);
    return { pagina, paginas, offset: (pagina - 1) * porPagina, porPagina };
}

module.exports = { patron, patronTelefono, paginar, POR_PAGINA };
