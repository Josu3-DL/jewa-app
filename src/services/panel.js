'use strict';
const { managuaDayRange, todayInZone, fechaDMY } = require('../utils/dates');
const { proximasCitas } = require('./citas');
const { productosBajoMinimo } = require('./productos');
const { vacunasPorVencer } = require('./vacunas');
const { recordatorios } = require('./recordatorios');

// Datos del panel de inicio (RF-45, alcance D-41): contadores del día, próximas citas y alertas.
// Solo lee. El total de ventas es información de ingresos y únicamente se calcula para el administrador.

const LIMITE_LISTAS = 5;

/** Cuenta las citas de hoy que siguen vigentes (sin canceladas ni "no asistió") y cuántas faltan por atender. */
function citasDeHoy(db, ahora) {
    const r = managuaDayRange(todayInZone(ahora));
    const f = db.prepare(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(CASE WHEN estado IN ('programada', 'confirmada', 'en_espera') THEN 1 ELSE 0 END), 0) AS por_atender
        FROM citas WHERE inicio >= ? AND inicio < ? AND estado NOT IN ('cancelada', 'no_asistio')`).get(r.from, r.to);
    return { total: f.total, porAtender: f.por_atender };
}

/** Ventas pagadas de hoy: cantidad y total en centavos (las anuladas no cuentan). */
function ventasDeHoy(db, ahora) {
    const r = managuaDayRange(todayInZone(ahora));
    const f = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM ventas WHERE estado = 'pagada' AND fecha >= ? AND fecha < ?").get(r.from, r.to);
    return { cantidad: f.n, total: f.total };
}

/** Todo lo que muestra el inicio, según el rol. */
function panel(db, ahora, rol) {
    const pacientes = db.prepare("SELECT COUNT(*) AS n FROM mascotas WHERE estado = 'activa'").get().n;
    const avisos = recordatorios(db, ahora);
    const porEnviar = [...avisos.citas, ...avisos.vacunas].filter((x) => !x.enviado).length;
    const stock = productosBajoMinimo(db);
    const vacunas = vacunasPorVencer(db, ahora);
    return {
        citasHoy: citasDeHoy(db, ahora),
        pacientes,
        ventasHoy: rol === 'admin' ? ventasDeHoy(db, ahora) : null,
        recordatorios: porEnviar,
        proximasCitas: proximasCitas(db, ahora, { limite: LIMITE_LISTAS }),
        stockBajo: { total: stock.length, lista: stock.slice(0, LIMITE_LISTAS) },
        vacunas: { total: vacunas.length, lista: vacunas.slice(0, LIMITE_LISTAS).map((v) => ({ ...v, proximaTexto: fechaDMY(v.proxima_dosis) })) },
    };
}

module.exports = { LIMITE_LISTAS, citasDeHoy, ventasDeHoy, panel };
