'use strict';
const { z, texto, parseForm } = require('../utils/validation');
const { calcularImpuesto, formatMoney } = require('../utils/money');
const { paginar } = require('../utils/busqueda');
const { managuaDayRange } = require('../utils/dates');
const { transaction } = require('../db/connection');
const { getSettings } = require('./settings');
const { moverStock } = require('./productos');
const audit = require('./audit');

// Ventas y cobros (RF-43). Alcance académico (D-41): pago completo (sin parciales), sin vencimientos ni FEFO.
// Es el ÚNICO lugar donde se descuenta stock: la venta de productos baja el stock en la misma transacción que
// crea la venta, y anularla lo devuelve con movimientos de reversa (RN-03, RN-08). Importes en centavos enteros.
// Los precios y el stock se leen SIEMPRE de la base de datos al cobrar; nada de lo que manda el navegador se cree.

const METODOS = [{ valor: 'efectivo', texto: 'Efectivo' }, { valor: 'tarjeta', texto: 'Tarjeta' }, { valor: 'transferencia', texto: 'Transferencia' }];
const METODO_TEXTO = Object.fromEntries(METODOS.map((m) => [m.valor, m.texto]));
const MAX_LINEAS = 50;
const MAX_CANTIDAD = 999;

const anularSchema = z.object({ motivo: texto({ min: 5, max: 300 }) });
const noEncontrado = { ok: false, notFound: true };

const numeroVenta = (n) => `V-${String(n).padStart(6, '0')}`;

/**
 * Convierte el carrito [{ tipo, id, cantidad }] en líneas con precio y stock reales y calcula los totales.
 * Devuelve { lineas, subtotal, descuento, impuesto, total, errores } (errores = mensajes que impiden cobrar).
 * `descuento` está en centavos y no puede superar el subtotal.
 */
function resolverCarrito(db, items, { descuento = 0 } = {}) {
    const ajustes = getSettings(db);
    const errores = [];
    const lineas = [];
    const pedidoPorProducto = new Map();
    for (const it of items) {
        if (!Number.isInteger(it.cantidad) || it.cantidad < 1 || it.cantidad > MAX_CANTIDAD) { errores.push('Hay una cantidad no válida en el carrito.'); continue; }
        if (it.tipo === 'producto') {
            const p = db.prepare(`SELECT p.id, p.nombre, p.precio, p.activo, p.unidad,
                (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) AS stock
                FROM productos p WHERE p.id = ?`).get(it.id);
            if (!p || !p.activo) { errores.push('Un producto del carrito ya no está disponible.'); continue; }
            if (p.precio <= 0) { errores.push(`"${p.nombre}" no tiene precio definido: ponle precio en Farmacia antes de venderlo.`); continue; }
            const pedido = (pedidoPorProducto.get(p.id) || 0) + it.cantidad;
            pedidoPorProducto.set(p.id, pedido);
            if (pedido > p.stock) errores.push(`No hay existencias suficientes de "${p.nombre}": hay ${p.stock} y se piden ${pedido}.`);
            lineas.push({ tipo: 'producto', id: p.id, descripcion: p.nombre, cantidad: it.cantidad, precio: p.precio, importe: p.precio * it.cantidad, stock: p.stock, unidad: p.unidad });
        } else if (it.tipo === 'servicio') {
            const s = db.prepare('SELECT id, nombre, precio, activo FROM servicios WHERE id = ?').get(it.id);
            if (!s || !s.activo) { errores.push('Un servicio del carrito ya no está disponible.'); continue; }
            if (s.precio <= 0) { errores.push(`El servicio "${s.nombre}" no tiene precio definido: ponle precio en Ajustes → Servicios.`); continue; }
            lineas.push({ tipo: 'servicio', id: s.id, descripcion: s.nombre, cantidad: it.cantidad, precio: s.precio, importe: s.precio * it.cantidad });
        } else {
            errores.push('Hay un artículo no válido en el carrito.');
        }
    }
    const subtotal = lineas.reduce((a, l) => a + l.importe, 0);
    if (descuento > subtotal) errores.push(`El descuento (${formatMoney(descuento, ajustes.moneda)}) no puede superar el subtotal (${formatMoney(subtotal, ajustes.moneda)}).`);
    const base = Math.max(0, subtotal - Math.min(descuento, subtotal));
    const impuesto = calcularImpuesto(base, ajustes.iva);
    return { lineas, subtotal, descuento: Math.min(descuento, subtotal), impuesto, total: base + impuesto, iva: ajustes.iva, moneda: ajustes.moneda, errores: [...new Set(errores)] };
}

/** Cobra la venta: crea la venta y sus líneas, descuenta el stock de los productos y deja bitácora, todo o nada. */
function crearVenta(db, { items, propietarioId = null, descuento = 0, metodo }, { actorId, ip = null, ahora = new Date() }) {
    if (!METODO_TEXTO[metodo]) return { ok: false, errores: ['Elige el método de pago.'] };
    if (!Array.isArray(items) || !items.length) return { ok: false, errores: ['El carrito está vacío.'] };
    if (items.length > MAX_LINEAS) return { ok: false, errores: [`El carrito no puede tener más de ${MAX_LINEAS} líneas.`] };
    return transaction(db, () => {
        if (propietarioId && !db.prepare('SELECT 1 FROM propietarios WHERE id = ? AND activo = 1').get(propietarioId)) return { ok: false, errores: ['El cliente elegido no existe o está desactivado.'] };
        const c = resolverCarrito(db, items, { descuento });
        if (c.errores.length) return { ok: false, errores: c.errores };
        const numero = numeroVenta(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM ventas').get().n);
        const r = db.prepare(`INSERT INTO ventas (numero, propietario_id, fecha, subtotal, descuento, impuesto, total, metodo_pago, usuario_id)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(numero, propietarioId, ahora.toISOString(), c.subtotal, c.descuento, c.impuesto, c.total, metodo, actorId);
        const id = Number(r.lastInsertRowid);
        const linea = db.prepare(`INSERT INTO venta_detalle (venta_id, item_tipo, item_id, descripcion, cantidad, precio_unitario, lote_id)
                                  VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const l of c.lineas) {
            let loteId = null;
            if (l.tipo === 'producto') {
                const mov = moverStock(db, { productoId: l.id, tipo: 'salida', cantidad: l.cantidad, motivo: `Venta ${numero}`, refTipo: 'venta', refId: id, actorId, ahora });
                loteId = db.prepare('SELECT lote_id FROM movimientos WHERE id = ?').get(mov).lote_id;
            }
            linea.run(id, l.tipo, l.id, l.descripcion, l.cantidad, l.precio, loteId);
        }
        audit.log(db, { usuarioId: actorId, accion: 'venta_creada', entidad: 'venta', entidadId: id, detalle: { numero, total: c.total, metodo }, ip });
        return { ok: true, id, numero, total: c.total };
    });
}

/** Anula una venta (no se borra): motivo obligatorio y devuelve el stock con reversas. Solo el administrador (la ruta lo exige). */
function anularVenta(db, id, input, { actorId, ip = null, ahora = new Date() }) {
    const f = parseForm(anularSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    return transaction(db, () => {
        const v = db.prepare('SELECT id, numero, estado FROM ventas WHERE id = ?').get(id);
        if (!v) return noEncontrado;
        if (v.estado === 'anulada') return { ok: false, error: 'Esta venta ya está anulada.' };
        db.prepare("UPDATE ventas SET estado = 'anulada', anulada_motivo = ?, anulada_por = ? WHERE id = ?").run(f.values.motivo, actorId, id);
        const lineas = db.prepare("SELECT item_id, cantidad FROM venta_detalle WHERE venta_id = ? AND item_tipo = 'producto'").all(id);
        for (const l of lineas) {
            moverStock(db, { productoId: l.item_id, tipo: 'reversa', cantidad: l.cantidad, motivo: `Anulación de ${v.numero}`, refTipo: 'venta', refId: id, actorId, ahora });
        }
        audit.log(db, { usuarioId: actorId, accion: 'venta_anulada', entidad: 'venta', entidadId: id, detalle: { numero: v.numero, motivo: f.values.motivo, productos_devueltos: lineas.length }, ip });
        return { ok: true, numero: v.numero };
    });
}

function getVenta(db, id) {
    const v = db.prepare(`
        SELECT v.id, v.numero, v.propietario_id, v.fecha, v.subtotal, v.descuento, v.impuesto, v.total, v.metodo_pago, v.estado,
               v.anulada_motivo, v.anulada_por, v.usuario_id, p.nombre AS propietario_nombre, u.nombre AS usuario_nombre, a.nombre AS anulada_por_nombre
        FROM ventas v LEFT JOIN propietarios p ON p.id = v.propietario_id JOIN usuarios u ON u.id = v.usuario_id LEFT JOIN usuarios a ON a.id = v.anulada_por
        WHERE v.id = ?`).get(id);
    if (!v) return null;
    const lineas = db.prepare(`SELECT id, item_tipo, item_id, descripcion, cantidad, precio_unitario, cantidad * precio_unitario AS importe
                               FROM venta_detalle WHERE venta_id = ? ORDER BY id`).all(id);
    return { ...v, metodoTexto: METODO_TEXTO[v.metodo_pago], lineas };
}

const filtrosSchema = z.object({
    desde: z.iso.date().optional(), hasta: z.iso.date().optional(), estado: z.enum(['pagada', 'anulada']).optional(),
    pagina: z.coerce.number().int().min(1).optional(),
});

/** Lee los filtros de la URL ignorando lo inválido. */
function leerFiltros(query) {
    const f = {};
    for (const campo of Object.keys(filtrosSchema.shape)) {
        const r = filtrosSchema.shape[campo].safeParse(query[campo] === '' ? undefined : query[campo]);
        if (r.success && r.data !== undefined) f[campo] = r.data;
    }
    return f;
}

/** Ventas, la más reciente primero (fechas en hora de Managua). */
function listarVentas(db, { desde, hasta, estado, pagina = 1 } = {}) {
    const d = desde ? managuaDayRange(desde).from : null;
    const h = hasta ? managuaDayRange(hasta).to : null;
    const f = [d, d, h, h, estado ?? null, estado ?? null];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ventas v WHERE (? IS NULL OR v.fecha >= ?) AND (? IS NULL OR v.fecha < ?) AND (? IS NULL OR v.estado = ?)`).get(...f).n;
    const sumas = db.prepare(`SELECT COALESCE(SUM(v.total), 0) AS s FROM ventas v WHERE v.estado = 'pagada' AND (? IS NULL OR v.fecha >= ?) AND (? IS NULL OR v.fecha < ?) AND (? IS NULL OR v.estado = ?)`).get(...f).s;
    const pag = paginar(total, pagina);
    const filas = db.prepare(`
        SELECT v.id, v.numero, v.fecha, v.total, v.metodo_pago, v.estado, p.nombre AS propietario_nombre, u.nombre AS usuario_nombre
        FROM ventas v LEFT JOIN propietarios p ON p.id = v.propietario_id JOIN usuarios u ON u.id = v.usuario_id
        WHERE (? IS NULL OR v.fecha >= ?) AND (? IS NULL OR v.fecha < ?) AND (? IS NULL OR v.estado = ?)
        ORDER BY v.id DESC LIMIT ? OFFSET ?`).all(...f, pag.porPagina, pag.offset).map((v) => ({ ...v, metodoTexto: METODO_TEXTO[v.metodo_pago] }));
    return { filas, total, totalPagado: sumas, ...pag };
}

/** Productos y servicios que se pueden agregar al carrito (activos y con precio). Los productos sin existencias no se ofrecen. */
function catalogoVenta(db) {
    const servicios = db.prepare('SELECT id, nombre, precio FROM servicios WHERE activo = 1 AND precio > 0 ORDER BY nombre COLLATE NOCASE').all();
    const productos = db.prepare(`SELECT p.id, p.nombre, p.precio, p.unidad,
        (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) AS stock
        FROM productos p WHERE p.activo = 1 AND p.precio > 0
        AND (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) > 0
        ORDER BY p.nombre COLLATE NOCASE`).all();
    return { servicios, productos };
}

module.exports = { METODOS, METODO_TEXTO, MAX_LINEAS, MAX_CANTIDAD, resolverCarrito, crearVenta, anularVenta, getVenta, listarVentas, leerFiltros, catalogoVenta };
