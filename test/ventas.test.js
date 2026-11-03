'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const productos = require('../src/services/productos');
const propietarios = require('../src/services/propietarios');
const { saveSettings } = require('../src/services/settings');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    const admin = await mk('ana', 'Ana Pérez', 'admin');
    await mk('vet1', 'María López', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const ctx = { actorId: admin, ahora: NOW };
    const gasas = productos.createProducto(db, { codigo: 'GAS-1', nombre: 'Gasas', categoria: 'Insumo', unidad: 'unidad', precio: '1.99', stock_minimo: '0', stock_inicial: '10' }, ctx).id;
    const shampoo = productos.createProducto(db, { codigo: 'SHA-1', nombre: 'Shampoo', categoria: 'Higiene', unidad: 'frasco', precio: '120', stock_minimo: '0', stock_inicial: '3' }, ctx).id;
    const servicio = db.prepare("SELECT id FROM servicios WHERE nombre = 'Baño'").get().id;
    db.prepare('UPDATE servicios SET precio = 25000 WHERE id = ?').run(servicio);
    const cliente = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    return { db, app, gasas, shampoo, servicio, cliente };
}
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const agregar = (agent, item, cantidad = '1') => post(agent, '/ventas/nueva', '/ventas/carrito/agregar', { item, cantidad });
const cobrar = (agent, metodo = 'efectivo') => post(agent, '/ventas/nueva', '/ventas/cobrar', { metodo });
const stock = (db, id) => productos.getProducto(db, id).stock;

test('acceso: sin sesión → login; los tres roles venden; solo el administrador anula (403 al resto); sin token 403', async () => {
    const d = await setup();
    for (const url of ['/ventas', '/ventas/nueva', '/ventas/1', '/ventas/1/recibo']) assert.equal((await request(d.app).get(url).set('Accept', 'text/html')).status, 302, url);
    for (const u of ['ana', 'vet1', 'rec1']) {
        const agent = await loginAs(d.app, u, CLAVE);
        assert.equal((await getHtml(agent, '/ventas')).status, 200, u);
        assert.equal((await getHtml(agent, '/ventas/nueva')).status, 200, u);
    }
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    await agregar(rec, `servicio:${d.servicio}`);
    const v = await cobrar(rec);
    assert.equal(v.status, 302, 'recepción puede cobrar');
    const id = d.db.prepare('SELECT id FROM ventas').get().id;
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    for (const agent of [rec, vet]) assert.equal((await post(agent, `/ventas/${id}`, `/ventas/${id}/anular`, { motivo: 'Intento ajeno' })).status, 403);
    assert.equal(d.db.prepare('SELECT estado FROM ventas WHERE id = ?').get(id).estado, 'pagada');
    for (const url of ['/ventas/cobrar', '/ventas/carrito/agregar', `/ventas/${id}/anular`]) assert.equal((await rec.post(url).type('form').send({})).status, 403, `sin token ${url}`);
    assert.doesNotMatch((await getHtml(rec, `/ventas/${id}`)).text, /Anular venta/);
});

test('carrito por formulario: agrega servicios y productos, suma cantidades, calcula totales y permite quitar y vaciar', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    const vacio = (await getHtml(agent, '/ventas/nueva')).text;
    assert.match(vacio, /El carrito está vacío/);
    assert.match(vacio, /Baño · C\$ 250\.00/);
    assert.match(vacio, /Gasas · C\$ 1\.99 · hay 10/);
    assert.doesNotMatch(vacio, /Vacuna antirrábica/, 'sin precio no se ofrece');

    await agregar(agent, `producto:${d.gasas}`, '3');
    await agregar(agent, `producto:${d.gasas}`, '2');
    await agregar(agent, `servicio:${d.servicio}`);
    const html = (await getHtml(agent, '/ventas/nueva')).text;
    assert.match(html, /Carrito \(2\)/);
    assert.match(html, /<td>5<\/td>/, 'las gasas se suman en una línea');
    assert.match(html, /Subtotal<\/dt><dd>C\$ 259\.95/);
    assert.match(html, /Cobrar C\$ 259\.95/);

    await post(agent, '/ventas/nueva', '/ventas/carrito/quitar', { indice: '0' });
    assert.match((await getHtml(agent, '/ventas/nueva')).text, /Carrito \(1\)/);
    await post(agent, '/ventas/nueva', '/ventas/carrito/vaciar');
    assert.match((await getHtml(agent, '/ventas/nueva')).text, /El carrito está vacío/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 0);
});

test('agregar al carrito valida: artículo, cantidad y existencias; el carrito no cambia si hay error', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    for (const [item, cantidad, patron] of [['', '1', /Elige un artículo/], ['otro:1', '1', /Elige un artículo/], [`servicio:${d.servicio}`, '0', /entre 1 y 999/], [`servicio:${d.servicio}`, 'abc', /entre 1 y 999/], [`servicio:${d.servicio}`, '1000', /entre 1 y 999/], [`producto:${d.shampoo}`, '4', /hay 3 y se piden 4/], ['producto:9999', '1', /ya no está disponible/]]) {
        const r = await agregar(agent, item, cantidad);
        assert.equal(r.status, 302, item);
        assert.match((await getHtml(agent, '/ventas/nueva')).text, patron, `${item} x ${cantidad}`);
    }
    assert.match((await getHtml(agent, '/ventas/nueva')).text, /El carrito está vacío/);
    await agregar(agent, `producto:${d.shampoo}`, '2');
    await agregar(agent, `producto:${d.shampoo}`, '2');
    const html = (await getHtml(agent, '/ventas/nueva')).text;
    assert.match(html, /se piden 4/, 'sumando también se controla el stock');
    assert.match(html, /<td>2<\/td>/, 'sigue con 2');
});

test('cobrar: crea la venta, descuenta el stock, muestra el detalle y vacía el carrito', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await agregar(agent, `producto:${d.gasas}`, '3');
    await agregar(agent, `servicio:${d.servicio}`);
    const r = await cobrar(agent, 'tarjeta');
    assert.equal(r.status, 302);
    const det = (await getHtml(agent, r.headers.location)).text;
    assert.match(det, /Venta V-000001 cobrada/);
    assert.match(det, /Tarjeta/);
    assert.match(det, /Venta de mostrador/);
    assert.match(det, /Atendió: Rosa Díaz/);
    assert.match(det, /Total<\/dt><dd class="total-final">C\$ 255\.97/);
    assert.equal(stock(d.db, d.gasas), 7);
    assert.match((await getHtml(agent, '/ventas/nueva')).text, /El carrito está vacío/);
    assert.match((await getHtml(agent, '/ventas')).text, /V-000001/);
    assert.equal((await cobrar(agent)).status, 400, 'carrito vacío no se cobra');
    assert.match((await cobrar(agent)).text, /El carrito está vacío/);
});

test('T-09 por HTTP: si el stock cambió después de armar el carrito, se rechaza y no se descuenta nada', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await agregar(agent, `producto:${d.shampoo}`, '3');
    await agregar(agent, `producto:${d.gasas}`, '2');
    productos.ajustarStock(d.db, d.shampoo, { sentido: 'restar', cantidad: '2', motivo: 'Se rompieron dos frascos' }, { actorId: 1, ahora: NOW });
    const r = await cobrar(agent);
    assert.equal(r.status, 400);
    assert.match(r.text, /hay 1 y se piden 3/);
    assert.match(r.text, /disabled/, 'el botón de cobrar queda deshabilitado');
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 0);
    assert.deepEqual([stock(d.db, d.shampoo), stock(d.db, d.gasas)], [1, 10]);
});

test('el navegador no manda precios: un precio inventado en el formulario se ignora', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await post(agent, '/ventas/nueva', '/ventas/carrito/agregar', { item: `producto:${d.shampoo}`, cantidad: '1', precio: '0.01', total: '0.01' });
    const page = await getHtml(agent, '/ventas/nueva');
    const r = await agent.post('/ventas/cobrar').type('form').send({ _csrf: csrfIn(page.text), metodo: 'efectivo', precio: '1', total: '1', subtotal: '1', items: '[]' });
    assert.equal(r.status, 302);
    assert.equal(d.db.prepare('SELECT total FROM ventas').get().total, 12000);
    assert.equal(d.db.prepare('SELECT precio_unitario FROM venta_detalle').get().precio_unitario, 12000);
});

test('descuento, IVA y cliente: se aplican en el carrito y quedan en la venta', async () => {
    const d = await setup();
    saveSettings(d.db, { nombre: 'JEWA', telefono: '', direccion: '', moneda: 'NIO', iva: '15', duracionCitaMin: '30', lunes_abierto: 'on', lunes_abre: '08:00', lunes_cierra: '17:00' }, {});
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await agregar(agent, `servicio:${d.servicio}`);
    const mal = await post(agent, '/ventas/nueva', '/ventas/carrito/descuento', { descuento: 'abc' });
    assert.match((await getHtml(agent, mal.headers.location)).text, /Descuento no válido/);
    await post(agent, '/ventas/nueva', '/ventas/carrito/descuento', { descuento: '50' });
    let html = (await getHtml(agent, '/ventas/nueva')).text;
    assert.match(html, /Descuento<\/dt><dd>− C\$ 50\.00/);
    assert.match(html, /IVA \(15 %\)<\/dt><dd>C\$ 30\.00/);
    assert.match(html, /Total a cobrar<\/dt><dd class="total-final">C\$ 230\.00/);
    await post(agent, '/ventas/nueva', '/ventas/carrito/descuento', { descuento: '999' });
    html = (await getHtml(agent, '/ventas/nueva')).text;
    assert.match(html, /no puede superar el subtotal/);
    await post(agent, '/ventas/nueva', '/ventas/carrito/descuento', { descuento: '' });

    const buscar = (await getHtml(agent, '/ventas/nueva?q=laura')).text;
    assert.match(buscar, /Laura Mendoza/);
    await post(agent, '/ventas/nueva', '/ventas/carrito/cliente', { propietario: String(d.cliente) });
    assert.match((await getHtml(agent, '/ventas/nueva')).text, /Venta a nombre de Laura Mendoza/);
    const r = await cobrar(agent, 'transferencia');
    const det = (await getHtml(agent, r.headers.location)).text;
    assert.match(det, /Cliente: Laura Mendoza/);
    assert.match(det, /IVA<\/dt><dd>C\$ 37\.50/);
    assert.match(det, /Total<\/dt><dd class="total-final">C\$ 287\.50/);
    assert.equal((await post(agent, '/ventas/nueva', '/ventas/carrito/cliente', { propietario: '9999' })).status, 302);
});

test('T-15 anular por formulario: motivo obligatorio, devuelve el stock, queda marcada y el recibo dice ANULADO', async () => {
    const d = await setup();
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    await agregar(rec, `producto:${d.shampoo}`, '2');
    const r = await cobrar(rec);
    const id = d.db.prepare('SELECT id FROM ventas').get().id;
    assert.equal(stock(d.db, d.shampoo), 1);

    const admin = await loginAs(d.app, 'ana', CLAVE);
    const url = `/ventas/${id}`;
    assert.match((await getHtml(admin, url)).text, /Anular venta/);
    const sin = await post(admin, url, `${url}/anular`, { motivo: '' });
    assert.equal(sin.status, 400);
    assert.match(sin.text, /Este campo es obligatorio/);
    assert.equal(stock(d.db, d.shampoo), 1);

    const ok = await post(admin, url, `${url}/anular`, { motivo: 'Cliente devolvió el producto' });
    assert.equal(ok.status, 302);
    const det = (await getHtml(admin, url)).text;
    assert.match(det, /Venta V-000001 anulada/);
    assert.match(det, /Venta anulada<\/strong> por Ana Pérez\. Motivo: Cliente devolvió el producto/);
    assert.doesNotMatch(det, /Anular venta<\/h3>/);
    assert.equal(stock(d.db, d.shampoo), 3);
    assert.match((await getHtml(admin, `${url}/recibo`)).text, /ANULADO/);
    assert.match((await getHtml(admin, '/ventas?estado=anulada')).text, /V-000001/);
    assert.match((await getHtml(admin, '/ventas?estado=pagada')).text, /No hay ventas con esos filtros/);
    assert.equal((await post(admin, url, `${url}/anular`, { motivo: 'Otra vez' })).status, 302, 'la segunda vez avisa sin duplicar');
    assert.equal(stock(d.db, d.shampoo), 3);
    for (const [m, u] of [['delete', url], ['post', `${url}/borrar`]]) assert.ok([403, 404].includes((await admin[m](u)).status), `${m} ${u}`);
    assert.equal((await post(admin, url, '/ventas/999/anular', { motivo: 'No existe' })).status, 404);
});

test('recibo imprimible: hoja sin barra lateral con la clínica, líneas, descuento, total y método de pago', async () => {
    const d = await setup();
    saveSettings(d.db, { nombre: 'Clínica Huellitas', telefono: '8888 7777', direccion: 'Managua', moneda: 'NIO', iva: '0', duracionCitaMin: '30', lunes_abierto: 'on', lunes_abre: '08:00', lunes_cierra: '17:00' }, {});
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await agregar(agent, `producto:${d.gasas}`, '3');
    await post(agent, '/ventas/nueva', '/ventas/carrito/descuento', { descuento: '0.97' });
    await cobrar(agent, 'efectivo');
    const id = d.db.prepare('SELECT id FROM ventas').get().id;
    const res = await getHtml(agent, `/ventas/${id}/recibo`);
    assert.equal(res.status, 200);
    for (const t of [/Clínica Huellitas/, /Recibo de pago V-000001/, /Gasas/, /C\$ 1\.99/, /C\$ 5\.97/, /− C\$ 0\.97/, /Total pagado<\/dt><dd class="total-final">C\$ 5\.00/, /Efectivo/, /Rosa Díaz/, /no es una factura fiscal/]) assert.match(res.text, t);
    assert.doesNotMatch(res.text, /class="sidebar"|class="topbar"/);
    assert.match(res.text, /data-print/);
    assert.equal((await getHtml(agent, '/ventas/999/recibo')).status, 404);
    assert.equal((await getHtml(agent, '/ventas/abc')).status, 404);
});

test('listado: filtros por fecha y estado, total cobrado sin anuladas y paginación de 25', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const ins = d.db.prepare("INSERT INTO ventas (numero, fecha, subtotal, total, metodo_pago, usuario_id) VALUES (?, ?, 100, 100, 'efectivo', 1)");
    for (let i = 1; i <= 30; i += 1) ins.run(`V-9${String(i).padStart(5, '0')}`, '2026-10-15T15:00:00Z');
    const p1 = (await getHtml(admin, '/ventas?desde=2026-10-15&hasta=2026-10-15')).text;
    assert.match(p1, /30 ventas · Cobrado: C\$ 30\.00/);
    assert.match(p1, /Página 1 de 2/);
    assert.equal((p1.match(/<tr>/g) || []).length - 1 >= 25, true);
    assert.match(p1, /href="\/ventas\?desde=2026-10-15&amp;hasta=2026-10-15&amp;pagina=2"/);
    assert.match((await getHtml(admin, '/ventas?desde=2026-10-16')).text, /No hay ventas con esos filtros/);
    for (const q of ['desde=mal&hasta=x&estado=zzz&pagina=-3', "estado='; DROP TABLE ventas; --"]) assert.equal((await getHtml(admin, `/ventas?${q}`)).status, 200, q);
});

test('XSS: nombres de producto y de cliente se escapan en carrito, detalle y recibo', async () => {
    const d = await setup();
    const malo = productos.createProducto(d.db, { codigo: 'XSS-1', nombre: '<img src=x onerror=alert(1)>', categoria: 'Otro', unidad: 'u', precio: '10', stock_minimo: '0', stock_inicial: '5' }, { actorId: 1, ahora: NOW }).id;
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await agregar(agent, `producto:${malo}`);
    const carrito = (await getHtml(agent, '/ventas/nueva')).text;
    assert.doesNotMatch(carrito, /<img src=x/);
    assert.match(carrito, /&lt;img src=x onerror=alert\(1\)&gt;/);
    await cobrar(agent);
    const id = d.db.prepare('SELECT id FROM ventas').get().id;
    for (const url of [`/ventas/${id}`, `/ventas/${id}/recibo`]) assert.doesNotMatch((await getHtml(agent, url)).text, /<img src=x/, url);
});

test('Ventas ya no es marcador de posición y la bitácora tiene sus acciones en español', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    await agregar(admin, `servicio:${d.servicio}`);
    await cobrar(admin);
    assert.doesNotMatch((await getHtml(admin, '/ventas')).text, /Próximamente|en construcción/i);
    assert.match((await getHtml(admin, '/ajustes/bitacora?entidad=venta')).text, /Venta registrada/);
});
