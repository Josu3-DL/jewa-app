'use strict';
// Librería: csv-stringify (mantenida, sin módulos nativos) para escapar comillas, comas y saltos de línea,
// y para anteponer el BOM UTF-8 que Excel necesita para leer bien las tildes.
const { stringify } = require('csv-stringify/sync');
const { z, fecha } = require('../utils/validation');
const { managuaDayRange, todayInZone, hora12, fechaDMY } = require('../utils/dates');
const { listarCitas, ESTADOS } = require('./citas');
const { productosBajoMinimo } = require('./productos');

// Reportes (RF-36, RF-40; alcance académico D-41): ventas por día, citas y stock bajo el mínimo, con exportación a CSV.
// Solo consultan: no modifican nada.

const MAX_DIAS = 366;
const MAX_FILAS_CSV = 10000;

const filtrosSchema = z.object({
    responsable: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().optional()),
    estado: z.preprocess((v) => (v === '' ? undefined : v), z.enum(ESTADOS.map((e) => e.valor)).optional()),
    pagina: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).optional()),
});

/**
 * Lee y valida los filtros de la URL. Sin fechas: del primer día del mes a hoy. Si las fechas son inválidas, están al revés
 * o el rango es demasiado largo, vuelve al rango por defecto y explica por qué en `error`.
 */
function leerFiltros(query, ahora = new Date()) {
    const q = query || {};
    const hoy = todayInZone(ahora);
    const porDefecto = { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    const opc = (campo) => { const r = filtrosSchema.shape[campo].safeParse(q[campo]); return r.success ? r.data : undefined; };
    const extra = { responsable: opc('responsable'), estado: opc('estado'), pagina: opc('pagina') };
    const d = fecha().safeParse(q.desde === undefined || q.desde === '' ? porDefecto.desde : q.desde);
    const h = fecha().safeParse(q.hasta === undefined || q.hasta === '' ? porDefecto.hasta : q.hasta);
    const volver = (error) => ({ ...porDefecto, ...extra, error: `${error} Se muestra el rango por defecto.` });
    if (!d.success || !h.success) return volver('Fecha no válida.');
    if (d.data > h.data) return volver('La fecha "desde" no puede ser posterior a "hasta".');
    if ((Date.parse(h.data) - Date.parse(d.data)) / 86400000 > MAX_DIAS) return volver(`El rango no puede pasar de ${MAX_DIAS} días.`);
    return { desde: d.data, hasta: h.data, ...extra, error: null };
}

const dinero2 = (centavos) => `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;

/** Ventas por día (hora de Managua): cantidad, anuladas, subtotal, descuento, IVA, total y total por método de pago. Las anuladas no suman. */
function ventasPorDia(db, { desde, hasta }) {
    const r = { desde: managuaDayRange(desde).from, hasta: managuaDayRange(hasta).to };
    const filas = db.prepare(`
        SELECT date(fecha, '-6 hours') AS dia,
               SUM(CASE WHEN estado = 'pagada' THEN 1 ELSE 0 END) AS ventas,
               SUM(CASE WHEN estado = 'anulada' THEN 1 ELSE 0 END) AS anuladas,
               COALESCE(SUM(CASE WHEN estado = 'pagada' THEN subtotal END), 0) AS subtotal,
               COALESCE(SUM(CASE WHEN estado = 'pagada' THEN descuento END), 0) AS descuento,
               COALESCE(SUM(CASE WHEN estado = 'pagada' THEN impuesto END), 0) AS impuesto,
               COALESCE(SUM(CASE WHEN estado = 'pagada' THEN total END), 0) AS total,
               COALESCE(SUM(CASE WHEN estado = 'pagada' AND metodo_pago = 'efectivo' THEN total END), 0) AS efectivo,
               COALESCE(SUM(CASE WHEN estado = 'pagada' AND metodo_pago = 'tarjeta' THEN total END), 0) AS tarjeta,
               COALESCE(SUM(CASE WHEN estado = 'pagada' AND metodo_pago = 'transferencia' THEN total END), 0) AS transferencia
        FROM ventas WHERE fecha >= ? AND fecha < ?
        GROUP BY dia ORDER BY dia`).all(r.desde, r.hasta).map((f) => ({ ...f }));
    const totales = filas.reduce((a, f) => {
        for (const k of ['ventas', 'anuladas', 'subtotal', 'descuento', 'impuesto', 'total', 'efectivo', 'tarjeta', 'transferencia']) a[k] += f[k];
        return a;
    }, { ventas: 0, anuladas: 0, subtotal: 0, descuento: 0, impuesto: 0, total: 0, efectivo: 0, tarjeta: 0, transferencia: 0 });
    return { filas, totales };
}

/** Citas del período con filtros opcionales por responsable y estado, más el conteo por estado. */
function citasReporte(db, { desde, hasta, responsable = null, estado = null }) {
    const lista = listarCitas(db, {
        desde: managuaDayRange(desde).from, hasta: managuaDayRange(hasta).to,
        responsableId: responsable, estados: estado ? [estado] : null,
    }).slice(0, MAX_FILAS_CSV);
    const porEstado = Object.fromEntries(ESTADOS.map((e) => [e.valor, 0]));
    for (const c of lista) porEstado[c.estado] += 1;
    return { filas: lista, total: lista.length, porEstado };
}

/** Productos activos en o bajo su mínimo, con lo que falta para llegar al mínimo. */
const stockBajo = (db) => productosBajoMinimo(db).map((p) => ({ ...p, faltante: Math.max(0, p.stock_minimo - p.stock) }));

/** Protege contra la inyección de fórmulas: Excel interpreta como fórmula el texto que empieza con = + - @ (o tab/retorno). */
const protegerCelda = (valor) => (typeof valor === 'string' && /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor);

/** Arma el CSV (UTF-8 con BOM, líneas CRLF). `columnas`: [{ clave, titulo }]. */
function aCsv(columnas, filas) {
    return stringify(
        filas.map((f) => columnas.map((c) => f[c.clave])),
        { header: true, columns: columnas.map((c) => c.titulo), bom: true, record_delimiter: 'windows', cast: { string: protegerCelda } },
    );
}

const COLUMNAS_VENTAS = [
    { clave: 'dia', titulo: 'Día' }, { clave: 'ventas', titulo: 'Ventas' }, { clave: 'anuladas', titulo: 'Anuladas' },
    { clave: 'subtotal', titulo: 'Subtotal' }, { clave: 'descuento', titulo: 'Descuento' }, { clave: 'impuesto', titulo: 'IVA' }, { clave: 'total', titulo: 'Total' },
    { clave: 'efectivo', titulo: 'Efectivo' }, { clave: 'tarjeta', titulo: 'Tarjeta' }, { clave: 'transferencia', titulo: 'Transferencia' },
];
const COLUMNAS_CITAS = [
    { clave: 'fecha', titulo: 'Fecha' }, { clave: 'hora', titulo: 'Hora' }, { clave: 'mascota_nombre', titulo: 'Mascota' }, { clave: 'numero_expediente', titulo: 'Expediente' },
    { clave: 'propietario_nombre', titulo: 'Propietario' }, { clave: 'servicio', titulo: 'Servicio' }, { clave: 'responsable_nombre', titulo: 'Responsable' },
    { clave: 'estadoTexto', titulo: 'Estado' }, { clave: 'motivo', titulo: 'Motivo' },
];
const COLUMNAS_STOCK = [
    { clave: 'codigo', titulo: 'Código' }, { clave: 'nombre', titulo: 'Producto' }, { clave: 'stock', titulo: 'Stock' },
    { clave: 'stock_minimo', titulo: 'Mínimo' }, { clave: 'faltante', titulo: 'Faltan' },
];

/** CSV de ventas por día con los importes en decimal ("1234.50"), sin símbolo de moneda, para poder sumarlos en Excel. */
function csvVentas(db, filtros) {
    const { filas, totales } = ventasPorDia(db, filtros);
    const conv = (f) => ({ ...f, subtotal: dinero2(f.subtotal), descuento: dinero2(f.descuento), impuesto: dinero2(f.impuesto), total: dinero2(f.total), efectivo: dinero2(f.efectivo), tarjeta: dinero2(f.tarjeta), transferencia: dinero2(f.transferencia) });
    return aCsv(COLUMNAS_VENTAS, [...filas.map(conv), conv({ dia: 'TOTAL', ...totales })]);
}

function csvCitas(db, filtros) {
    const { filas } = citasReporte(db, filtros);
    return aCsv(COLUMNAS_CITAS, filas.map((c) => ({ ...c, fecha: fechaDMY(c.fecha), hora: hora12(c.hora), servicio: c.servicio_nombre || '', motivo: c.motivo || '' })));
}

const csvStock = (db) => aCsv(COLUMNAS_STOCK, stockBajo(db));

module.exports = {
    MAX_DIAS, MAX_FILAS_CSV, leerFiltros, ventasPorDia, citasReporte, stockBajo, protegerCelda, aCsv, csvVentas, csvCitas, csvStock, dinero2,
};
