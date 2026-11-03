'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb } = require('./helpers');
const ventas = require('../src/services/ventas');
const productos = require('../src/services/productos');
const propietarios = require('../src/services/propietarios');
const { saveSettings } = require('../src/services/settings');

const AHORA = new Date('2026-11-02T15:00:00Z');
function base() {
    const db = testDb();
    const admin = Number(db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('Ana', 'ana', 'x', 'admin')").run().lastInsertRowid);
    const ctx = { actorId: admin, ip: '127.0.0.1', ahora: AHORA };
    const P = (codigo, nombre, precio, stock) => productos.createProducto(db, { codigo, nombre, categoria: 'Insumo', unidad: 'unidad', precio, stock_minimo: '0', stock_inicial: String(stock) }, ctx).id;
    const gasas = P('GAS-1', 'Gasas', '1.99', 10);
    const shampoo = P('SHA-1', 'Shampoo', '120', 3);
    const servicio = db.prepare("SELECT id FROM servicios WHERE nombre = 'Baño'").get().id;
    db.prepare('UPDATE servicios SET precio = 25000 WHERE id = ?').run(servicio); // C$ 250.00
    return { db, ctx, admin, gasas, shampoo, servicio };
}
const it = (tipo, id, cantidad) => ({ tipo, id, cantidad });
const stock = (db, id) => productos.getProducto(db, id).stock;

test('T-18 importes exactos: 3 × C$ 1.99 = C$ 5.97 y el IVA se redondea al centavo', () => {
    const d = base();
    const c = ventas.resolverCarrito(d.db, [it('producto', d.gasas, 3)]);
    assert.deepEqual([c.subtotal, c.impuesto, c.total, c.errores.length], [597, 0, 597, 0]);
    saveSettings(d.db, { nombre: 'JEWA', telefono: '', direccion: '', moneda: 'NIO', iva: '15', duracionCitaMin: '30', lunes_abierto: 'on', lunes_abre: '08:00', lunes_cierra: '17:00' }, {});
    const c2 = ventas.resolverCarrito(d.db, [it('producto', d.gasas, 3)]);
    assert.deepEqual([c2.subtotal, c2.impuesto, c2.total], [597, 90, 687], '15 % de 5.97 = 0.8955 → 0.90');
    const c3 = ventas.resolverCarrito(d.db, [it('producto', d.gasas, 3)], { descuento: 97 });
    assert.deepEqual([c3.descuento, c3.impuesto, c3.total], [97, 75, 575], 'el IVA se calcula sobre lo que queda tras el descuento');
});

test('vender: crea V-000001, descuenta el stock con movimientos de salida y guarda precios como estaban', () => {
    const d = base();
    const r = ventas.crearVenta(d.db, { items: [it('producto', d.gasas, 4), it('servicio', d.servicio, 1)], metodo: 'efectivo' }, d.ctx);
    assert.deepEqual([r.ok, r.numero, r.total], [true, 'V-000001', 4 * 199 + 25000]);
    assert.equal(stock(d.db, d.gasas), 6);
    const [m] = productos.listMovimientos(d.db, d.gasas).filas;
    assert.deepEqual([m.tipo, m.cantidad, m.ref_tipo, m.motivo, m.signo], ['salida', 4, 'venta', 'Venta V-000001', '−']);
    assert.equal(d.db.prepare("SELECT ref_id FROM movimientos WHERE ref_tipo = 'venta'").get().ref_id, r.id);
    const v = ventas.getVenta(d.db, r.id);
    assert.deepEqual(v.lineas.map((l) => [l.descripcion, l.cantidad, l.precio_unitario, l.importe]), [['Gasas', 4, 199, 796], ['Baño', 1, 25000, 25000]]);
    assert.deepEqual([v.estado, v.metodoTexto, v.propietario_id, v.subtotal], ['pagada', 'Efectivo', null, 25796]);
    assert.ok(v.lineas[0].lote_id === undefined && d.db.prepare('SELECT lote_id FROM venta_detalle WHERE id = ?').get(v.lineas[0].id).lote_id, 'el producto guarda su lote');
    assert.equal(d.db.prepare('SELECT lote_id FROM venta_detalle WHERE id = ?').get(v.lineas[1].id).lote_id, null, 'el servicio no mueve stock');
    assert.equal(ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, 2)], metodo: 'tarjeta' }, d.ctx).numero, 'V-000002');
    assert.equal(d.db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'venta_creada'").get().n, 2);
});

test('T-09 sin existencias: se rechaza todo, el stock no cambia y no queda venta ni movimiento', () => {
    const d = base();
    const antes = d.db.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n;
    const r = ventas.crearVenta(d.db, { items: [it('producto', d.shampoo, 4)], metodo: 'efectivo' }, d.ctx);
    assert.equal(r.ok, false);
    assert.match(r.errores[0], /hay 3 y se piden 4/);
    assert.equal(stock(d.db, d.shampoo), 3);
    // el mismo producto repartido en dos líneas también cuenta junto
    assert.match(ventas.crearVenta(d.db, { items: [it('producto', d.shampoo, 2), it('producto', d.shampoo, 2)], metodo: 'efectivo' }, d.ctx).errores[0], /se piden 4/);
    // una línea buena y otra mala: nada se guarda (todo o nada)
    const mix = ventas.crearVenta(d.db, { items: [it('producto', d.gasas, 2), it('producto', d.shampoo, 9)], metodo: 'efectivo' }, d.ctx);
    assert.equal(mix.ok, false);
    assert.equal(stock(d.db, d.gasas), 10, 'las gasas tampoco se descontaron');
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 0);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n, antes);
    assert.equal(ventas.crearVenta(d.db, { items: [it('producto', d.shampoo, 3)], metodo: 'efectivo' }, d.ctx).ok, true, 'justo lo que hay sí se puede');
    assert.equal(stock(d.db, d.shampoo), 0);
    assert.equal(ventas.crearVenta(d.db, { items: [it('producto', d.shampoo, 1)], metodo: 'efectivo' }, d.ctx).ok, false, 'ya no queda');
});

test('no se vende lo que no tiene precio, está desactivado o no existe; ni cantidades locas', () => {
    const d = base();
    const vac = d.db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-001'").get().id;
    assert.match(ventas.crearVenta(d.db, { items: [it('producto', vac, 1)], metodo: 'efectivo' }, d.ctx).errores[0], /no tiene precio definido/);
    const sinPrecio = d.db.prepare("SELECT id FROM servicios WHERE nombre = 'Corte'").get().id;
    assert.match(ventas.crearVenta(d.db, { items: [it('servicio', sinPrecio, 1)], metodo: 'efectivo' }, d.ctx).errores[0], /no tiene precio definido/);
    productos.setActivo(d.db, d.gasas, false, d.ctx);
    assert.match(ventas.crearVenta(d.db, { items: [it('producto', d.gasas, 1)], metodo: 'efectivo' }, d.ctx).errores[0], /ya no está disponible/);
    assert.match(ventas.crearVenta(d.db, { items: [it('servicio', 9999, 1)], metodo: 'efectivo' }, d.ctx).errores[0], /ya no está disponible/);
    for (const cantidad of [0, -2, 1.5, 1000, '3', NaN]) assert.match(ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, cantidad)], metodo: 'efectivo' }, d.ctx).errores[0], /cantidad no válida/, String(cantidad));
    assert.match(ventas.crearVenta(d.db, { items: [{ tipo: 'otro', id: 1, cantidad: 1 }], metodo: 'efectivo' }, d.ctx).errores[0], /no válido/);
    assert.match(ventas.crearVenta(d.db, { items: [], metodo: 'efectivo' }, d.ctx).errores[0], /vacío/);
    assert.match(ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, 1)], metodo: 'cheque' }, d.ctx).errores[0], /método de pago/);
    assert.match(ventas.crearVenta(d.db, { items: Array.from({ length: 51 }, () => it('servicio', d.servicio, 1)), metodo: 'efectivo' }, d.ctx).errores[0], /más de 50/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 0);
});

test('descuento: no puede superar el subtotal; con descuento total el cobro es C$ 0.00; con cliente o de mostrador', () => {
    const d = base();
    assert.match(ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, 1)], descuento: 25001, metodo: 'efectivo' }, d.ctx).errores[0], /no puede superar el subtotal/);
    const r = ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, 1)], descuento: 5000, metodo: 'transferencia' }, d.ctx);
    assert.equal(ventas.getVenta(d.db, r.id).total, 20000);
    assert.equal(ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, 1)], descuento: 25000, metodo: 'efectivo' }, d.ctx).total, 0);
    const cli = propietarios.createPropietario(d.db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, d.ctx).id;
    const conCliente = ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, 1)], propietarioId: cli, metodo: 'efectivo' }, d.ctx);
    assert.equal(ventas.getVenta(d.db, conCliente.id).propietario_nombre, 'Laura Mendoza');
    propietarios.setActivo(d.db, cli, false, d.ctx);
    assert.match(ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, 1)], propietarioId: cli, metodo: 'efectivo' }, d.ctx).errores[0], /no existe o está desactivado/);
    assert.match(ventas.crearVenta(d.db, { items: [it('servicio', d.servicio, 1)], propietarioId: 9999, metodo: 'efectivo' }, d.ctx).errores[0], /no existe/);
});

test('T-15 anular: motivo obligatorio, queda marcada, devuelve el stock con reversas y es definitiva', () => {
    const d = base();
    const r = ventas.crearVenta(d.db, { items: [it('producto', d.gasas, 4), it('producto', d.shampoo, 2), it('servicio', d.servicio, 1)], metodo: 'efectivo' }, d.ctx);
    assert.deepEqual([stock(d.db, d.gasas), stock(d.db, d.shampoo)], [6, 1]);
    assert.ok(ventas.anularVenta(d.db, r.id, { motivo: '' }, d.ctx).errors.motivo);
    assert.ok(ventas.anularVenta(d.db, r.id, { motivo: 'no' }, d.ctx).errors.motivo);
    assert.equal(ventas.getVenta(d.db, r.id).estado, 'pagada');
    assert.equal(ventas.anularVenta(d.db, r.id, { motivo: 'Cliente se arrepintió' }, d.ctx).ok, true);
    assert.deepEqual([stock(d.db, d.gasas), stock(d.db, d.shampoo)], [10, 3], 'stock devuelto');
    const rev = d.db.prepare("SELECT tipo, cantidad, ref_tipo, ref_id, motivo FROM movimientos WHERE tipo = 'reversa' ORDER BY id").all().map((m) => ({ ...m }));
    assert.deepEqual(rev, [
        { tipo: 'reversa', cantidad: 4, ref_tipo: 'venta', ref_id: r.id, motivo: 'Anulación de V-000001' },
        { tipo: 'reversa', cantidad: 2, ref_tipo: 'venta', ref_id: r.id, motivo: 'Anulación de V-000001' },
    ]);
    const v = ventas.getVenta(d.db, r.id);
    assert.deepEqual([v.estado, v.anulada_motivo, v.anulada_por_nombre, v.lineas.length], ['anulada', 'Cliente se arrepintió', 'Ana', 3], 'conserva sus líneas');
    assert.match(ventas.anularVenta(d.db, r.id, { motivo: 'Una vez más' }, d.ctx).error, /ya está anulada/);
    assert.equal(stock(d.db, d.gasas), 10, 'no se devuelve dos veces');
    assert.equal(ventas.anularVenta(d.db, 999, { motivo: 'Cualquier cosa' }, d.ctx).notFound, true);
    assert.throws(() => d.db.prepare("UPDATE ventas SET estado = 'pagada', anulada_motivo = NULL WHERE id = ?").run(r.id), 'la BD no deja reabrirla sin motivo');
    assert.equal(d.db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'venta_anulada'").get().n, 1);
});

test('T-13 las ventas y sus líneas no se borran; los movimientos tampoco', () => {
    const d = base();
    const r = ventas.crearVenta(d.db, { items: [it('producto', d.gasas, 1)], metodo: 'efectivo' }, d.ctx);
    assert.throws(() => d.db.prepare('DELETE FROM ventas WHERE id = ?').run(r.id));
    assert.throws(() => d.db.prepare('DELETE FROM venta_detalle').run());
    assert.throws(() => d.db.prepare('DELETE FROM movimientos').run());
    assert.equal(ventas.getVenta(d.db, r.id).lineas.length, 1);
});

test('después de una venta anulada se puede volver a vender el stock devuelto', () => {
    const d = base();
    const r = ventas.crearVenta(d.db, { items: [it('producto', d.shampoo, 3)], metodo: 'efectivo' }, d.ctx);
    assert.equal(ventas.crearVenta(d.db, { items: [it('producto', d.shampoo, 1)], metodo: 'efectivo' }, d.ctx).ok, false);
    ventas.anularVenta(d.db, r.id, { motivo: 'Error de digitación' }, d.ctx);
    assert.equal(ventas.crearVenta(d.db, { items: [it('producto', d.shampoo, 3)], metodo: 'efectivo' }, d.ctx).ok, true);
    assert.equal(stock(d.db, d.shampoo), 0);
});

test('listado: más reciente primero, filtros por día (Managua) y estado, total cobrado sin anuladas', () => {
    const d = base();
    const mk = (fecha, items) => ventas.crearVenta(d.db, { items, metodo: 'efectivo' }, { ...d.ctx, ahora: new Date(fecha) });
    const a = mk('2026-10-30T15:00:00Z', [it('servicio', d.servicio, 1)]);
    const b = mk('2026-10-31T15:00:00Z', [it('servicio', d.servicio, 2)]);
    const c = mk('2026-11-01T03:00:00Z', [it('servicio', d.servicio, 1)]); // 21:00 del 31 en Managua
    ventas.anularVenta(d.db, a.id, { motivo: 'Venta de prueba' }, d.ctx);
    assert.deepEqual(ventas.listarVentas(d.db, {}).filas.map((v) => v.id), [c.id, b.id, a.id]);
    const dia = ventas.listarVentas(d.db, { desde: '2026-10-31', hasta: '2026-10-31' });
    assert.deepEqual(dia.filas.map((v) => v.id), [c.id, b.id], 'la de las 9 PM sigue siendo del 31');
    assert.equal(dia.totalPagado, 50000 + 25000);
    assert.deepEqual(ventas.listarVentas(d.db, { estado: 'anulada' }).filas.map((v) => v.id), [a.id]);
    assert.equal(ventas.listarVentas(d.db, {}).totalPagado, 75000, 'la anulada no suma');
    assert.deepEqual(ventas.leerFiltros({ desde: 'mal', estado: 'x', hasta: '2026-11-02', pagina: '2' }), { hasta: '2026-11-02', pagina: 2 });
    assert.equal(ventas.leerFiltros({ desde: '', estado: '' }).desde, undefined);
});

test('catálogo de venta: servicios y productos activos con precio; los productos sin existencias no se ofrecen', () => {
    const d = base();
    const cat = ventas.catalogoVenta(d.db);
    assert.deepEqual(cat.servicios.map((s) => s.nombre), ['Baño']);
    assert.deepEqual(cat.productos.map((p) => p.nombre), ['Gasas', 'Shampoo']);
    ventas.crearVenta(d.db, { items: [it('producto', d.shampoo, 3)], metodo: 'efectivo' }, d.ctx);
    assert.deepEqual(ventas.catalogoVenta(d.db).productos.map((p) => p.nombre), ['Gasas']);
});
