'use strict';
const { z, texto, opcional, dinero, numero, casilla, parseForm } = require('../utils/validation');
const { patron, paginar } = require('../utils/busqueda');
const { transaction } = require('../db/connection');
const audit = require('./audit');

// Productos y stock simple (alcance académico, D-41): cada producto tiene un lote único interno
// ("UNICO"), sin vencimientos ni FEFO. El stock de un producto es la suma de sus lotes y solo cambia
// junto con un movimiento (en la misma transacción), así queda un registro de cada cambio.
// Convención de movimientos: entrada manual = tipo 'entrada' (ref 'compra'); ajuste hacia arriba =
// 'entrada' (ref 'ajuste'); ajuste hacia abajo = 'salida' (ref 'ajuste'). La cantidad siempre es positiva.

const CATEGORIAS = ['Medicamento', 'Vacuna', 'Alimento', 'Higiene', 'Accesorio', 'Insumo', 'Otro'].map((c) => ({ valor: c, texto: c }));
const LOTE_UNICO = 'UNICO';
const MAX_STOCK = 100000;

const entero = (min, max, msg = 'Debe ser un número entero.') => numero(z.number({ error: msg }).int('Usa un número entero.').min(min, `Mínimo ${min}.`).max(max, `Máximo ${max}.`));

const codigo = () => texto({ min: 2, max: 20 }).transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9._-]+$/, 'Usa letras, números, punto, guion o guion bajo (sin espacios).'));

const productoSchema = z.object({
    codigo: codigo(),
    nombre: texto({ max: 100 }),
    categoria: z.enum(CATEGORIAS.map((c) => c.valor), { error: 'Elige una categoría.' }),
    es_medicamento: casilla(),
    presentacion: opcional(texto({ max: 60 })),
    unidad: texto({ max: 20 }),
    precio: dinero(),
    stock_minimo: entero(0, MAX_STOCK),
});
const altaSchema = productoSchema.extend({ stock_inicial: opcional(entero(0, MAX_STOCK)) });
const entradaSchema = z.object({ cantidad: entero(1, MAX_STOCK), nota: opcional(texto({ max: 200 })) });
const ajusteSchema = z.object({
    sentido: z.enum(['sumar', 'restar'], { error: 'Elige si suma o resta.' }),
    cantidad: entero(1, MAX_STOCK),
    motivo: texto({ min: 5, max: 200 }),
});

const noEncontrado = { ok: false, notFound: true };

// El SQL es siempre literal (sin ${}); el stock es la suma de los lotes del producto.
function getProducto(db, id) {
    return db.prepare(`
        SELECT p.id, p.codigo, p.nombre, p.categoria, p.es_medicamento, p.presentacion, p.unidad, p.precio, p.stock_minimo, p.activo,
               (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) AS stock
        FROM productos p WHERE p.id = ?`).get(id) || null;
}

/** Productos con su stock. `q` busca por código, nombre o categoría; `bajo` solo los que están en o bajo su mínimo. */
function listProductos(db, { q = '', bajo = false, inactivos = false, pagina = 1 } = {}) {
    const p = patron(q);
    const f = [inactivos ? 1 : 0, p, p, p, p, bajo ? 1 : 0];
    const total = db.prepare(`
        SELECT COUNT(*) AS n FROM productos p
        WHERE (p.activo = 1 OR ? = 1)
          AND (? IS NULL OR p.nombre LIKE ? ESCAPE '!' OR p.codigo LIKE ? ESCAPE '!' OR p.categoria LIKE ? ESCAPE '!')
          AND (? = 0 OR (p.stock_minimo > 0 AND (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) <= p.stock_minimo))`).get(...f).n;
    const pag = paginar(total, pagina);
    const filas = db.prepare(`
        SELECT p.id, p.codigo, p.nombre, p.categoria, p.es_medicamento, p.presentacion, p.unidad, p.precio, p.stock_minimo, p.activo,
               (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) AS stock
        FROM productos p
        WHERE (p.activo = 1 OR ? = 1)
          AND (? IS NULL OR p.nombre LIKE ? ESCAPE '!' OR p.codigo LIKE ? ESCAPE '!' OR p.categoria LIKE ? ESCAPE '!')
          AND (? = 0 OR (p.stock_minimo > 0 AND (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) <= p.stock_minimo))
        ORDER BY p.nombre COLLATE NOCASE, p.id LIMIT ? OFFSET ?`).all(...f, pag.porPagina, pag.offset);
    return { filas, total, ...pag };
}

/** Productos activos en o bajo su mínimo (solo los que tienen un mínimo definido). Los usan Farmacia, el panel y los reportes. */
const productosBajoMinimo = (db) => db.prepare(`
    SELECT p.id, p.codigo, p.nombre, p.stock_minimo,
           (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) AS stock
    FROM productos p
    WHERE p.activo = 1 AND p.stock_minimo > 0
      AND (SELECT COALESCE(SUM(l.cantidad_actual), 0) FROM lotes l WHERE l.producto_id = p.id) <= p.stock_minimo
    ORDER BY p.nombre COLLATE NOCASE`).all();

/** Id del lote único del producto; lo crea si no existe. */
function loteUnico(db, productoId) {
    const l = db.prepare('SELECT id FROM lotes WHERE producto_id = ? ORDER BY id LIMIT 1').get(productoId);
    if (l) return l.id;
    return Number(db.prepare('INSERT INTO lotes (producto_id, codigo_lote, cantidad_actual) VALUES (?, ?, 0)').run(productoId, LOTE_UNICO).lastInsertRowid);
}

const codigoEnUso = (db, valor, exceptoId = 0) => Boolean(db.prepare('SELECT 1 FROM productos WHERE codigo = ? AND id <> ?').get(valor, exceptoId));

/** Aplica un cambio de stock al lote y deja el movimiento (llamar dentro de una transacción). */
function moverStock(db, { productoId, tipo, cantidad, motivo, refTipo, actorId, ahora }) {
    const loteId = loteUnico(db, productoId);
    const delta = tipo === 'entrada' ? cantidad : -cantidad;
    db.prepare('UPDATE lotes SET cantidad_actual = cantidad_actual + ? WHERE id = ?').run(delta, loteId);
    const r = db.prepare(`INSERT INTO movimientos (producto_id, lote_id, tipo, cantidad, motivo, ref_tipo, usuario_id, fecha)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(productoId, loteId, tipo, cantidad, motivo, refTipo, actorId, ahora.toISOString());
    return Number(r.lastInsertRowid);
}

function createProducto(db, input, { actorId, ip = null, ahora = new Date() }) {
    const f = parseForm(altaSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    const v = f.values;
    return transaction(db, () => {
        if (codigoEnUso(db, v.codigo)) return { ok: false, errors: { codigo: 'Ya existe un producto con ese código.' } };
        const r = db.prepare(`INSERT INTO productos (codigo, nombre, categoria, es_medicamento, presentacion, unidad, precio, stock_minimo)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(v.codigo, v.nombre, v.categoria, v.es_medicamento ? 1 : 0, v.presentacion ?? null, v.unidad, v.precio, v.stock_minimo);
        const id = Number(r.lastInsertRowid);
        loteUnico(db, id);
        audit.log(db, { usuarioId: actorId, accion: 'producto_creado', entidad: 'producto', entidadId: id, detalle: { codigo: v.codigo, nombre: v.nombre }, ip });
        if (v.stock_inicial) moverStock(db, { productoId: id, tipo: 'entrada', cantidad: v.stock_inicial, motivo: 'Stock inicial', refTipo: 'compra', actorId, ahora });
        return { ok: true, id };
    });
}

function updateProducto(db, id, input, { actorId, ip = null }) {
    const actual = getProducto(db, id);
    if (!actual) return noEncontrado;
    const f = parseForm(productoSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    const v = f.values;
    if (codigoEnUso(db, v.codigo, id)) return { ok: false, errors: { codigo: 'Ya existe un producto con ese código.' } };
    const nuevo = { ...v, presentacion: v.presentacion ?? null, es_medicamento: v.es_medicamento ? 1 : 0 };
    const cambios = [];
    const dif = (campo, antes, despues) => { if ((antes ?? null) !== (despues ?? null)) cambios.push(`${campo}: ${antes ?? '—'} → ${despues ?? '—'}`); };
    dif('código', actual.codigo, nuevo.codigo); dif('nombre', actual.nombre, nuevo.nombre); dif('categoría', actual.categoria, nuevo.categoria);
    dif('medicamento', actual.es_medicamento ? 'sí' : 'no', nuevo.es_medicamento ? 'sí' : 'no'); dif('presentación', actual.presentacion, nuevo.presentacion);
    dif('unidad', actual.unidad, nuevo.unidad); dif('precio (centavos)', actual.precio, nuevo.precio); dif('stock mínimo', actual.stock_minimo, nuevo.stock_minimo);
    if (!cambios.length) return { ok: true, sinCambios: true };
    db.prepare(`UPDATE productos SET codigo = ?, nombre = ?, categoria = ?, es_medicamento = ?, presentacion = ?, unidad = ?, precio = ?, stock_minimo = ?
                WHERE id = ?`).run(nuevo.codigo, nuevo.nombre, nuevo.categoria, nuevo.es_medicamento, nuevo.presentacion, nuevo.unidad, nuevo.precio, nuevo.stock_minimo, id);
    audit.log(db, { usuarioId: actorId, accion: 'producto_editado', entidad: 'producto', entidadId: id, detalle: { cambios }, ip });
    return { ok: true };
}

/** Desactiva o reactiva (los productos no se borran: tienen movimientos, ventas y vacunas asociadas). */
function setActivo(db, id, activo, { actorId, ip = null }) {
    const actual = getProducto(db, id);
    if (!actual) return noEncontrado;
    if (Boolean(actual.activo) === activo) return { ok: true, sinCambios: true };
    db.prepare('UPDATE productos SET activo = ? WHERE id = ?').run(activo ? 1 : 0, id);
    audit.log(db, { usuarioId: actorId, accion: activo ? 'producto_activado' : 'producto_desactivado', entidad: 'producto', entidadId: id, detalle: { nombre: actual.nombre }, ip });
    return { ok: true };
}

/** Entrada manual de stock (reposición). */
function entradaStock(db, id, input, { actorId, ip = null, ahora = new Date() }) {
    const f = parseForm(entradaSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    return transaction(db, () => {
        const p = getProducto(db, id);
        if (!p) return noEncontrado;
        if (!p.activo) return { ok: false, error: 'El producto está desactivado: reactívalo para registrar entradas.' };
        if (p.stock + f.values.cantidad > MAX_STOCK) return { ok: false, errors: { cantidad: `El stock no puede pasar de ${MAX_STOCK}.` } };
        const motivo = f.values.nota ? `Entrada de stock: ${f.values.nota}` : 'Entrada de stock';
        const movId = moverStock(db, { productoId: id, tipo: 'entrada', cantidad: f.values.cantidad, motivo, refTipo: 'compra', actorId, ahora });
        audit.log(db, { usuarioId: actorId, accion: 'stock_entrada', entidad: 'producto', entidadId: id, detalle: { cantidad: f.values.cantidad, movimiento: movId }, ip });
        return { ok: true, stock: p.stock + f.values.cantidad };
    });
}

/** Ajuste manual con motivo (conteo físico, merma). Nunca deja el stock en negativo. */
function ajustarStock(db, id, input, { actorId, ip = null, ahora = new Date() }) {
    const f = parseForm(ajusteSchema, input);
    if (!f.ok) return { ok: false, errors: f.errors };
    const v = f.values;
    return transaction(db, () => {
        const p = getProducto(db, id);
        if (!p) return noEncontrado;
        if (v.sentido === 'restar' && v.cantidad > p.stock) return { ok: false, errors: { cantidad: `No se puede restar ${v.cantidad}: solo hay ${p.stock}.` } };
        if (v.sentido === 'sumar' && p.stock + v.cantidad > MAX_STOCK) return { ok: false, errors: { cantidad: `El stock no puede pasar de ${MAX_STOCK}.` } };
        const movId = moverStock(db, { productoId: id, tipo: v.sentido === 'sumar' ? 'entrada' : 'salida', cantidad: v.cantidad, motivo: `Ajuste: ${v.motivo}`, refTipo: 'ajuste', actorId, ahora });
        audit.log(db, { usuarioId: actorId, accion: 'stock_ajuste', entidad: 'producto', entidadId: id, detalle: { sentido: v.sentido, cantidad: v.cantidad, motivo: v.motivo, movimiento: movId }, ip });
        return { ok: true, stock: v.sentido === 'sumar' ? p.stock + v.cantidad : p.stock - v.cantidad };
    });
}

/** Movimientos de un producto, el más reciente primero, paginados. */
function listMovimientos(db, productoId, pagina = 1) {
    const total = db.prepare('SELECT COUNT(*) AS n FROM movimientos WHERE producto_id = ?').get(productoId).n;
    const pag = paginar(total, pagina);
    const filas = db.prepare(`
        SELECT m.id, m.tipo, m.cantidad, m.motivo, m.ref_tipo, m.fecha, u.nombre AS usuario_nombre
        FROM movimientos m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.producto_id = ? ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(productoId, pag.porPagina, pag.offset)
        .map((m) => ({ ...m, signo: m.tipo === 'entrada' || m.tipo === 'reversa' ? '+' : '−' }));
    return { filas, total, ...pag };
}

const paraFormulario = (p) => ({
    codigo: p.codigo, nombre: p.nombre, categoria: p.categoria, es_medicamento: Boolean(p.es_medicamento), presentacion: p.presentacion || '',
    unidad: p.unidad, precio: `${Math.trunc(p.precio / 100)}.${String(p.precio % 100).padStart(2, '0')}`, stock_minimo: String(p.stock_minimo),
});

module.exports = {
    CATEGORIAS, LOTE_UNICO, getProducto, listProductos, productosBajoMinimo, loteUnico,
    createProducto, updateProducto, setActivo, entradaStock, ajustarStock, listMovimientos, paraFormulario,
};
