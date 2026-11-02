'use strict';
const express = require('express');
const users = require('../../services/users');
const audit = require('../../services/audit');
const { formatDateTime } = require('../../utils/dates');
const { pager } = require('../../utils/pagination');

// Montado en /ajustes/bitacora.
function bitacoraRoutes({ db }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        const { filtros, errores } = audit.leerFiltros(req.query);
        const datos = audit.consultar(db, filtros);
        const filas = datos.filas.map((f) => ({
            id: f.id,
            fecha: formatDateTime(f.fecha),
            usuario: f.usuario_nombre ? `${f.usuario_nombre} (${f.usuario_login})` : 'Sistema / sin sesión',
            accion: audit.etiquetaAccion(f.accion),
            entidad: `${audit.etiquetaEntidad(f.entidad)}${f.entidad_id ? ` #${f.entidad_id}` : ''}`,
            detalle: audit.detalleATexto(f.detalle),
            ip: f.ip || '',
        }));
        res.render('ajustes/bitacora', {
            title: 'Bitácora', active: 'ajustes', tab: 'bitacora',
            filas, total: datos.total, errores, filtros,
            usuarios: users.listUsers(db),
            entidades: audit.entidadesRegistradas(db).map((valor) => ({ valor, texto: audit.etiquetaEntidad(valor) })),
            pager: pager({ pagina: datos.pagina, paginas: datos.paginas, total: datos.total, ruta: '/ajustes/bitacora', filtros: { usuario: filtros.usuario, entidad: filtros.entidad, desde: filtros.desde, hasta: filtros.hasta } }),
        });
    });

    return router;
}

module.exports = { bitacoraRoutes };
