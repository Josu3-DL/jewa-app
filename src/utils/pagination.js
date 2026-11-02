'use strict';

/**
 * Datos de paginación para la vista, con los enlaces ya armados (conservan los filtros de la URL).
 * Propio porque son ~10 líneas; los paquetes revisados (express-paginate y bifurcaciones) no
 * tienen mantenimiento claro ni compatibilidad declarada con Express 5.
 */
function pager({ pagina, paginas, total, ruta, filtros = {} }) {
    const href = (p) => {
        const q = new URLSearchParams();
        for (const [k, v] of Object.entries(filtros)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
        if (p > 1) q.set('pagina', String(p));
        const texto = q.toString();
        return texto ? `${ruta}?${texto}` : ruta;
    };
    return {
        pagina, paginas, total,
        prev: pagina > 1 ? href(pagina - 1) : null,
        next: pagina < paginas ? href(pagina + 1) : null,
    };
}

module.exports = { pager };
