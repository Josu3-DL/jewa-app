'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb } = require('./helpers');
const productos = require('../src/services/productos');

const AHORA = new Date('2026-11-02T15:00:00Z');
function base() {
    const db = testDb();
    const admin = Number(db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('Ana', 'ana', 'x', 'admin')").run().lastInsertRowid);
    return { db, ctx: { actorId: admin, ip: '127.0.0.1', ahora: AHORA } };
}
const P = (extra = {}) => ({ codigo: 'amx-250', nombre: 'Amoxicilina 250 mg', categoria: 'Medicamento', es_medicamento: 'on', presentacion: 'Caja x 20', unidad: 'caja', precio: '150.50', stock_minimo: '5', ...extra });
const bit = (db, a) => db.prepare('SELECT * FROM bitacora WHERE accion = ?').all(a);

test('crear producto: código en mayúsculas, precio en centavos, lote único y stock inicial con movimiento', () => {
    const { db, ctx } = base();
    const r = productos.createProducto(db, P({ stock_inicial: '12' }), ctx);
    assert.equal(r.ok, true);
    const p = productos.getProducto(db, r.id);
    assert.deepEqual([p.codigo, p.precio, p.stock, p.stock_minimo, p.es_medicamento, p.activo], ['AMX-250', 15050, 12, 5, 1, 1]);
    assert.deepEqual(db.prepare('SELECT codigo_lote, vence, cantidad_actual FROM lotes WHERE producto_id = ?').all(r.id).map((l) => ({ ...l })), [{ codigo_lote: 'UNICO', vence: null, cantidad_actual: 12 }]);
    const [m] = productos.listMovimientos(db, r.id).filas;
    assert.deepEqual([m.tipo, m.cantidad, m.motivo, m.ref_tipo, m.signo], ['entrada', 12, 'Stock inicial', 'compra', '+']);
    assert.equal(bit(db, 'producto_creado').length, 1);
    const sin = productos.createProducto(db, P({ codigo: 'otro-1', stock_inicial: '' }), ctx);
    assert.equal(productos.getProducto(db, sin.id).stock, 0);
    assert.equal(productos.listMovimientos(db, sin.id).total, 0, 'sin stock inicial no hay movimiento');
});

test('crear producto: validación por campo, código único (sin distinguir mayúsculas) y nada queda a medias', () => {
    const { db, ctx } = base();
    const mal = productos.createProducto(db, { codigo: 'a b', nombre: '', categoria: 'Zzz', unidad: '', precio: '-5', stock_minimo: '1.5', stock_inicial: '-1' }, ctx);
    assert.equal(mal.ok, false);
    for (const c of ['codigo', 'nombre', 'categoria', 'unidad', 'precio', 'stock_minimo', 'stock_inicial']) assert.ok(mal.errors[c], c);
    assert.equal(productos.createProducto(db, P(), ctx).ok, true);
    const dup = productos.createProducto(db, P({ nombre: 'Otro' , codigo: 'AMX-250' }), ctx);
    assert.match(dup.errors.codigo, /Ya existe/);
    assert.match(productos.createProducto(db, P({ codigo: 'amx-250' }), ctx).errors.codigo, /Ya existe/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM productos WHERE codigo LIKE 'AMX%'").get().n, 1);
});

test('editar producto: cambios en bitácora, sin cambios no registra, código único; el stock no se toca', () => {
    const { db, ctx } = base();
    const id = productos.createProducto(db, P({ stock_inicial: '7' }), ctx).id;
    assert.equal(productos.updateProducto(db, id, P(), ctx).sinCambios, true);
    assert.equal(productos.updateProducto(db, id, P({ nombre: 'Amoxicilina 500 mg', precio: '99,90', stock_minimo: '10' }), ctx).ok, true);
    const p = productos.getProducto(db, id);
    assert.deepEqual([p.nombre, p.precio, p.stock_minimo, p.stock], ['Amoxicilina 500 mg', 9990, 10, 7]);
    assert.match(bit(db, 'producto_editado')[0].detalle, /nombre: Amoxicilina 250 mg → Amoxicilina 500 mg/);
    const otro = productos.createProducto(db, P({ codigo: 'OTRO-2' }), ctx).id;
    assert.match(productos.updateProducto(db, otro, P({ codigo: 'amx-250' }), ctx).errors.codigo, /Ya existe/);
    assert.equal(productos.updateProducto(db, 9999, P(), ctx).notFound, true);
    assert.equal(productos.paraFormulario(productos.getProducto(db, id)).precio, '99.90');
});

test('desactivar/reactivar: no se borra (tiene movimientos); un producto desactivado no recibe entradas', () => {
    const { db, ctx } = base();
    const id = productos.createProducto(db, P({ stock_inicial: '3' }), ctx).id;
    assert.equal(productos.setActivo(db, id, false, ctx).ok, true);
    assert.match(productos.entradaStock(db, id, { cantidad: '2' }, ctx).error, /desactivado/);
    assert.equal(productos.setActivo(db, id, false, ctx).sinCambios, true);
    assert.equal(productos.setActivo(db, id, true, ctx).ok, true);
    assert.equal(productos.entradaStock(db, id, { cantidad: '2' }, ctx).ok, true);
    assert.equal(productos.setActivo(db, 9999, true, ctx).notFound, true);
    assert.throws(() => db.prepare('DELETE FROM movimientos').run(), 'los movimientos no se borran');
});

test('entrada de stock: suma al lote, deja movimiento con nota y valida la cantidad', () => {
    const { db, ctx } = base();
    const id = productos.createProducto(db, P(), ctx).id;
    const r = productos.entradaStock(db, id, { cantidad: '20', nota: 'Pedido de la semana' }, ctx);
    assert.deepEqual([r.ok, r.stock], [true, 20]);
    const [m] = productos.listMovimientos(db, id).filas;
    assert.deepEqual([m.tipo, m.cantidad, m.ref_tipo, m.motivo, m.usuario_nombre], ['entrada', 20, 'compra', 'Entrada de stock: Pedido de la semana', 'Ana']);
    for (const c of ['0', '-3', 'abc', '1.5', '', '100001']) assert.ok(productos.entradaStock(db, id, { cantidad: c }, ctx).errors.cantidad, c);
    assert.equal(productos.getProducto(db, id).stock, 20, 'las entradas inválidas no cambian nada');
    assert.equal(productos.entradaStock(db, 9999, { cantidad: '1' }, ctx).notFound, true);
    assert.equal(bit(db, 'stock_entrada').length, 1);
});

test('ajuste: motivo obligatorio, suma o resta con movimiento y el stock nunca queda negativo', () => {
    const { db, ctx } = base();
    const id = productos.createProducto(db, P({ stock_inicial: '10' }), ctx).id;
    assert.ok(productos.ajustarStock(db, id, { sentido: 'restar', cantidad: '2', motivo: '' }, ctx).errors.motivo);
    assert.ok(productos.ajustarStock(db, id, { sentido: 'restar', cantidad: '2', motivo: 'ok' }, ctx).errors.motivo, 'mínimo 5 caracteres');
    assert.ok(productos.ajustarStock(db, id, { sentido: 'mover', cantidad: '2', motivo: 'Conteo físico' }, ctx).errors.sentido);
    assert.equal(productos.ajustarStock(db, id, { sentido: 'restar', cantidad: '4', motivo: 'Conteo físico: faltan 4' }, ctx).stock, 6);
    assert.equal(productos.ajustarStock(db, id, { sentido: 'sumar', cantidad: '1', motivo: 'Apareció una caja' }, ctx).stock, 7);
    const sobrante = productos.ajustarStock(db, id, { sentido: 'restar', cantidad: '8', motivo: 'Merma grande' }, ctx);
    assert.match(sobrante.errors.cantidad, /solo hay 7/);
    assert.equal(productos.getProducto(db, id).stock, 7);
    const movs = productos.listMovimientos(db, id).filas;
    assert.deepEqual(movs.map((m) => [m.tipo, m.cantidad, m.ref_tipo, m.signo]), [['entrada', 1, 'ajuste', '+'], ['salida', 4, 'ajuste', '−'], ['entrada', 10, 'compra', '+']]);
    assert.match(movs[1].motivo, /^Ajuste: Conteo físico: faltan 4$/);
    assert.equal(bit(db, 'stock_ajuste').length, 2);
    assert.throws(() => db.prepare('UPDATE movimientos SET cantidad = 1').run(), 'el kárdex no se modifica');
});

test('el stock es la suma de los lotes y coincide con los movimientos', () => {
    const { db, ctx } = base();
    const id = productos.createProducto(db, P({ stock_inicial: '5' }), ctx).id;
    productos.entradaStock(db, id, { cantidad: '10' }, ctx);
    productos.ajustarStock(db, id, { sentido: 'restar', cantidad: '3', motivo: 'Producto dañado' }, ctx);
    const neto = db.prepare("SELECT SUM(CASE WHEN tipo IN ('entrada','reversa') THEN cantidad ELSE -cantidad END) AS n FROM movimientos WHERE producto_id = ?").get(id).n;
    assert.equal(neto, 12);
    assert.equal(productos.getProducto(db, id).stock, 12);
    db.prepare("INSERT INTO lotes (producto_id, codigo_lote, cantidad_actual) VALUES (?, 'L2', 4)").run(id);
    assert.equal(productos.getProducto(db, id).stock, 16, 'suma de todos los lotes');
});

test('bajo stock: solo cuenta productos activos con mínimo definido y stock en o bajo el mínimo', () => {
    const { db, ctx } = base();
    const mk = (codigo, minimo, stock, extra = {}) => productos.createProducto(db, P({ codigo, nombre: `Prod ${codigo}`, stock_minimo: String(minimo), stock_inicial: String(stock), ...extra }), ctx).id;
    const bajo = mk('BAJO', 5, 2);
    mk('IGUAL', 5, 5);
    mk('SOBRA', 5, 6);
    mk('SINMIN', 0, 0);
    const inactivo = mk('INACT', 5, 1);
    productos.setActivo(db, inactivo, false, ctx);
    assert.deepEqual(productos.productosBajoMinimo(db).map((p) => p.codigo), ['BAJO', 'IGUAL']);
    assert.equal(productos.listProductos(db, { bajo: true }).total, 2);
    assert.equal(productos.listProductos(db, { bajo: true, inactivos: true }).total, 3);
    productos.entradaStock(db, bajo, { cantidad: '10' }, ctx);
    assert.deepEqual(productos.productosBajoMinimo(db).map((p) => p.codigo), ['IGUAL'], 'al reponer sale de la alerta');
    // las 4 vacunas de la migración 003 no generan alerta (mínimo 0)
    assert.ok(productos.productosBajoMinimo(db).every((p) => !p.codigo.startsWith('VAC')));
});

test('listado: búsqueda por código, nombre y categoría, paginación de 25 y texto hostil sin error', () => {
    const { db, ctx } = base();
    for (let i = 1; i <= 30; i += 1) productos.createProducto(db, P({ codigo: `P-${String(i).padStart(2, '0')}`, nombre: `Producto ${String(i).padStart(2, '0')}`, categoria: i % 2 ? 'Alimento' : 'Higiene' }), ctx);
    const todos = productos.listProductos(db, { pagina: 1 });
    assert.deepEqual([todos.filas.length, todos.total, todos.paginas], [25, 34, 2], '30 + 4 vacunas base');
    assert.equal(productos.listProductos(db, { pagina: 2 }).filas.length, 9);
    assert.equal(productos.listProductos(db, { q: 'p-07' }).filas[0].nombre, 'Producto 07');
    assert.equal(productos.listProductos(db, { q: 'higiene' }).total, 15);
    assert.equal(productos.listProductos(db, { q: 'antirr' }).filas[0].codigo, 'VAC-001');
    for (const q of ["'; DROP TABLE productos; --", '%', '_', '<script>']) assert.equal(productos.listProductos(db, { q }).total, 0, q);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM productos').get().n, 34);
});

test('un producto de categoría Vacuna aparece en el catálogo de vacunas (ISS-10)', () => {
    const { db, ctx } = base();
    productos.createProducto(db, P({ codigo: 'VAC-9', nombre: 'Vacuna leptospirosis', categoria: 'Vacuna', es_medicamento: '' }), ctx);
    const vacunas = require('../src/services/vacunas');
    const cat = vacunas.catalogoVacunas(db);
    assert.equal(cat.length, 5);
    assert.ok(cat.find((v) => v.nombre === 'Vacuna leptospirosis').lotes.length === 1, 'tiene su lote único');
});
