'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const productos = require('../src/services/productos');
const ventas = require('../src/services/ventas');
const citas = require('../src/services/citas');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const { testDb, testConfig, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    const admin = await mk('ana', 'Ana Pérez', 'admin');
    const vet = await mk('vet1', 'María López', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const ctx = { actorId: admin, ahora: NOW };
    const gasas = productos.createProducto(db, { codigo: 'GAS-1', nombre: 'Gasas', categoria: 'Insumo', unidad: 'u', precio: '10', stock_minimo: '20', stock_inicial: '12' }, ctx).id;
    const servicio = db.prepare("SELECT id FROM servicios WHERE nombre = 'Baño'").get().id;
    db.prepare('UPDATE servicios SET precio = 25000 WHERE id = ?').run(servicio);
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const m = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' }, ctx).id;
    ventas.crearVenta(db, { items: [{ tipo: 'servicio', id: servicio, cantidad: 2 }], metodo: 'efectivo' }, { actorId: admin, ahora: new Date('2026-11-01T15:00:00Z') });
    citas.crearCita(db, { mascota: String(m), responsable: String(vet), fecha: '2026-11-03', hora: '09:00', confirmar: 'on' }, { ahora: NOW });
    return { db, app, vet, m };
}
const texto = (res) => res.text;

test('permisos: sin sesión → login; recepción 403 en todo; veterinario ve citas y stock pero NO ventas; administrador todo', async () => {
    const d = await setup();
    for (const url of ['/reportes', '/reportes/ventas.csv']) assert.equal((await request(d.app).get(url).set('Accept', 'text/html')).status, 302, url);
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    for (const url of ['/reportes', '/reportes/ventas', '/reportes/citas', '/reportes/stock', '/reportes/ventas.csv', '/reportes/citas.csv', '/reportes/stock.csv']) assert.equal((await getHtml(rec, url)).status, 403, `rec ${url}`);
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    for (const url of ['/reportes', '/reportes/citas', '/reportes/stock', '/reportes/citas.csv', '/reportes/stock.csv']) assert.equal((await getHtml(vet, url)).status, 200, `vet ${url}`);
    for (const url of ['/reportes/ventas', '/reportes/ventas.csv']) assert.equal((await getHtml(vet, url)).status, 403, `vet ${url}`);
    const indiceVet = (await getHtml(vet, '/reportes')).text;
    assert.doesNotMatch(indiceVet, /Ventas por día/);
    assert.match(indiceVet, /solo para el administrador/);
    const admin = await loginAs(d.app, 'ana', CLAVE);
    for (const url of ['/reportes', '/reportes/ventas', '/reportes/citas', '/reportes/stock', '/reportes/ventas.csv']) assert.equal((await getHtml(admin, url)).status, 200, `admin ${url}`);
    assert.match((await getHtml(admin, '/reportes')).text, /Ventas por día/);
});

test('reporte de ventas en pantalla: totales del período, fila total y botón de exportar con los mismos filtros', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const html = texto(await getHtml(admin, '/reportes/ventas?desde=2026-11-01&hasta=2026-11-02'));
    assert.match(html, /C\$ 500\.00 · 1 venta/);
    assert.match(html, /<td class="nowrap">01\/11\/2026<\/td><td>1<\/td><td>0<\/td>/);
    assert.match(html, /href="\/reportes\/ventas\.csv\?desde=2026-11-01&amp;hasta=2026-11-02"/);
    assert.match(texto(await getHtml(admin, '/reportes/ventas?desde=2026-12-01&hasta=2026-12-31')), /No hay ventas en este período/);
    const malo = texto(await getHtml(admin, '/reportes/ventas?desde=mal&hasta=x'));
    assert.match(malo, /Fecha no válida\. Se muestra el rango por defecto/);
    assert.match(texto(await getHtml(admin, '/reportes/ventas?desde=2026-11-09&hasta=2026-11-01')), /no puede ser posterior/);
    assert.match(texto(await getHtml(admin, '/reportes/ventas?desde=2000-01-01&hasta=2026-11-01')), /no puede pasar de 366 días/);
});

test('CSV de ventas: descarga con BOM, tipo y nombre correctos, importes decimales y fila TOTAL', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const res = await admin.get('/reportes/ventas.csv?desde=2026-11-01&hasta=2026-11-02').buffer(true).parse((r, cb) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/csv; charset=utf-8/);
    assert.match(res.headers['content-disposition'], /attachment; filename="?jewa-ventas-2026-11-02\.csv"?/);
    assert.match(res.headers['cache-control'], /no-store/);
    assert.deepEqual([...res.body.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM UTF-8');
    assert.equal(res.body.toString('utf8'), '﻿Día,Ventas,Anuladas,Subtotal,Descuento,IVA,Total,Efectivo,Tarjeta,Transferencia\r\n'
        + '2026-11-01,1,0,500.00,0.00,0.00,500.00,500.00,0.00,0.00\r\n'
        + 'TOTAL,1,0,500.00,0.00,0.00,500.00,500.00,0.00,0.00\r\n');
    assert.equal(d.db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'reporte_exportado'").get().n, 1);
    assert.match((await getHtml(admin, '/ajustes/bitacora?entidad=reporte')).text, /Reporte exportado a CSV/);
});

test('reporte de citas: filtros por responsable y estado, resumen por estado, paginación y CSV con los mismos filtros', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const html = texto(await getHtml(vet, '/reportes/citas?desde=2026-11-01&hasta=2026-11-30'));
    assert.match(html, /1 cita\./);
    assert.match(html, /Programada: 1/);
    assert.match(html, /Cancelada: 0/);
    assert.match(html, /03\/11\/2026<\/td><td class="nowrap">9:00 AM/);
    assert.match(html, /Firulais/);
    assert.match(texto(await getHtml(vet, '/reportes/citas?desde=2026-11-01&hasta=2026-11-30&estado=cancelada')), /No hay citas con esos filtros/);
    assert.match(texto(await getHtml(vet, `/reportes/citas?desde=2026-11-01&hasta=2026-11-30&responsable=${d.vet}`)), /Firulais/);
    assert.match(html, /href="\/reportes\/citas\.csv\?desde=2026-11-01&amp;hasta=2026-11-30"/);

    const csv = await vet.get('/reportes/citas.csv?desde=2026-11-01&hasta=2026-11-30&estado=programada');
    assert.equal(csv.status, 200);
    assert.match(csv.text, /^﻿Fecha,Hora,Mascota,Expediente,Propietario,Servicio,Responsable,Estado,Motivo\r\n03\/11\/2026,9:00 AM,Firulais,EXP-000001,Laura Mendoza,,María López,Programada,\r\n$/);
    const vacio = await vet.get('/reportes/citas.csv?desde=2026-11-01&hasta=2026-11-30&estado=cancelada');
    assert.equal(vacio.text.trim().split('\r\n').length, 1, 'solo el encabezado');
});

test('paginación del reporte de citas: 25 por página y los enlaces conservan los filtros', async () => {
    const d = await setup();
    const ins = d.db.prepare("INSERT INTO citas (mascota_id, veterinario_id, inicio, fin) VALUES (?, ?, ?, ?)");
    for (let i = 0; i < 30; i += 1) {
        const ini = new Date(Date.UTC(2026, 10, 10, 14, i * 10)).toISOString().replace('.000Z', 'Z');
        const fin = new Date(Date.UTC(2026, 10, 10, 14, i * 10 + 5)).toISOString().replace('.000Z', 'Z');
        ins.run(d.m, d.vet, ini, fin);
    }
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const p1 = texto(await getHtml(vet, '/reportes/citas?desde=2026-11-10&hasta=2026-11-10'));
    assert.match(p1, /Página 1 de 2 · 30 registros/);
    assert.equal((p1.match(/<tr>/g) || []).length - 1, 25);
    assert.match(p1, /href="\/reportes\/citas\?desde=2026-11-10&amp;hasta=2026-11-10&amp;pagina=2"/);
    const p2 = texto(await getHtml(vet, '/reportes/citas?desde=2026-11-10&hasta=2026-11-10&pagina=2'));
    assert.equal((p2.match(/<tr>/g) || []).length - 1, 5);
    const csv = await vet.get('/reportes/citas.csv?desde=2026-11-10&hasta=2026-11-10');
    assert.equal(csv.text.trim().split('\r\n').length, 31, 'el CSV trae todas, no solo la página');
});

test('stock bajo: pantalla y CSV con lo que falta; el vacío se explica', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const html = texto(await getHtml(vet, '/reportes/stock'));
    assert.match(html, /1 producto/);
    assert.match(html, /GAS-1<\/td><td><a [^>]*>Gasas<\/a><\/td><td><strong>12<\/strong><\/td><td>20<\/td><td>8<\/td>/);
    assert.equal((await vet.get('/reportes/stock.csv')).text, '﻿Código,Producto,Stock,Mínimo,Faltan\r\nGAS-1,Gasas,12,20,8\r\n');
    productos.entradaStock(d.db, d.db.prepare("SELECT id FROM productos WHERE codigo = 'GAS-1'").get().id, { cantidad: '50' }, { actorId: 1, ahora: NOW });
    assert.match(texto(await getHtml(vet, '/reportes/stock')), /Ningún producto está bajo su mínimo/);
});

test('inyección de fórmulas en el CSV: nombres que empiezan con = + - @ salen protegidos; XSS escapado en pantalla', async () => {
    const d = await setup();
    d.db.prepare("UPDATE mascotas SET nombre = '=HYPERLINK(\"http://malo\")' WHERE id = ?").run(d.m);
    d.db.prepare("UPDATE propietarios SET nombre = '@SUM(1+1)' WHERE id = 1").run();
    productos.createProducto(d.db, { codigo: 'XSS-1', nombre: '<img src=x onerror=alert(1)>', categoria: 'Otro', unidad: 'u', precio: '1', stock_minimo: '5', stock_inicial: '1' }, { actorId: 1, ahora: NOW });
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const csv = (await vet.get('/reportes/citas.csv?desde=2026-11-03&hasta=2026-11-03')).text;
    assert.doesNotMatch(csv, /(^|,|\r\n)=HYPERLINK/, 'la celda no empieza con =');
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/malo""\)"/);
    assert.match(csv, /,'@SUM\(1\+1\),/);
    const html = texto(await getHtml(vet, '/reportes/stock'));
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('Reportes ya no es marcador de posición', async () => {
    const d = await setup();
    assert.doesNotMatch(texto(await getHtml(await loginAs(d.app, 'ana', CLAVE), '/reportes')), /Próximamente|en construcción/i);
});
