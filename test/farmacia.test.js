'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const productos = require('../src/services/productos');
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
    return { db, app, admin, ctx: { actorId: admin, ahora: NOW } };
}
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const P = (extra = {}) => ({ codigo: 'amx-250', nombre: 'Amoxicilina 250 mg', categoria: 'Medicamento', es_medicamento: 'on', presentacion: 'Caja x 20', unidad: 'caja', precio: '150.50', stock_minimo: '5', stock_inicial: '8', ...extra });
const crear = (agent, extra) => post(agent, '/farmacia', '/farmacia', P(extra));
const idDe = (db, codigo) => db.prepare('SELECT id FROM productos WHERE codigo = ?').get(codigo).id;

test('acceso: sin sesión → login; los tres roles ven Farmacia; solo el administrador ve los formularios', async () => {
    const d = await setup();
    for (const url of ['/farmacia', '/farmacia/1']) assert.equal((await request(d.app).get(url).set('Accept', 'text/html')).status, 302, url);
    const admin = await loginAs(d.app, 'ana', CLAVE);
    assert.match((await getHtml(admin, '/farmacia')).text, /Nuevo producto/);
    for (const u of ['vet1', 'rec1']) {
        const agent = await loginAs(d.app, u, CLAVE);
        const res = await getHtml(agent, '/farmacia');
        assert.equal(res.status, 200, u);
        assert.match(res.text, /Vacuna antirrábica/);
        assert.doesNotMatch(res.text, /Nuevo producto/, `${u} no ve el alta`);
        const ficha = await getHtml(agent, '/farmacia/1');
        assert.equal(ficha.status, 200);
        assert.doesNotMatch(ficha.text, /Entrada de stock|Ajuste de stock|Guardar cambios/);
        assert.match(ficha.text, /Existencias/);
    }
});

test('T-03 (farmacia): vet y recepción reciben 403 en todas las acciones de escritura; sin token → 403', async () => {
    const d = await setup();
    const id = productos.createProducto(d.db, P(), d.ctx).id;
    for (const u of ['vet1', 'rec1']) {
        const agent = await loginAs(d.app, u, CLAVE);
        for (const [url, body] of [['/farmacia', P({ codigo: 'x-1' })], [`/farmacia/${id}`, P()], [`/farmacia/${id}/estado`, { accion: 'desactivar' }], [`/farmacia/${id}/entrada`, { cantidad: '5' }], [`/farmacia/${id}/ajuste`, { sentido: 'sumar', cantidad: '5', motivo: 'Intento ajeno' }]]) {
            assert.equal((await post(agent, '/farmacia', url, body)).status, 403, `${u} ${url}`);
        }
    }
    const admin = await loginAs(d.app, 'ana', CLAVE);
    for (const url of ['/farmacia', `/farmacia/${id}/entrada`, `/farmacia/${id}/ajuste`, `/farmacia/${id}/estado`]) assert.equal((await admin.post(url).type('form').send({})).status, 403, `sin token ${url}`);
    assert.equal(productos.getProducto(d.db, id).stock, 8, 'nada cambió');
});

test('crear producto por formulario: aparece con stock y precio en córdobas; los errores quedan bajo el campo', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const mal = await crear(admin, { codigo: 'a b', nombre: '', precio: 'abc' });
    assert.equal(mal.status, 400);
    assert.match(mal.text, /Usa letras, números/);
    assert.match(mal.text, /Este campo es obligatorio/);
    assert.match(mal.text, /Monto no válido/);
    assert.equal(d.db.prepare("SELECT COUNT(*) AS n FROM productos WHERE codigo LIKE 'A%'").get().n, 0);

    const ok = await crear(admin);
    assert.equal(ok.status, 302);
    const ficha = (await getHtml(admin, ok.headers.location)).text;
    assert.match(ficha, /Producto (&#34;|&quot;)Amoxicilina 250 mg(&#34;|&quot;) creado/);
    assert.match(ficha, /C\$ 150\.50/);
    assert.match(ficha, /<strong>8<\/strong> caja/);
    assert.match(ficha, /Stock inicial/);
    assert.match((await getHtml(admin, '/farmacia?q=amoxi')).text, /AMX-250 · Medicamento · C\$ 150\.50 · Stock: <b>8<\/b> caja \(mín\. 5\)/);
    assert.match((await crear(admin)).text, /Ya existe un producto con ese código/);
});

test('editar y desactivar: el producto desactivado sale de la lista por defecto y no recibe entradas', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const id = productos.createProducto(d.db, P(), d.ctx).id;
    const url = `/farmacia/${id}`;
    const r = await post(admin, url, url, P({ nombre: 'Amoxicilina 500 mg', precio: '99,90' }));
    assert.equal(r.status, 302);
    assert.match((await getHtml(admin, url)).text, /Producto guardado/);
    assert.match((await getHtml(admin, url)).text, /C\$ 99\.90/);
    assert.equal((await post(admin, url, `${url}/estado`, { accion: 'desactivar' })).status, 302);
    assert.doesNotMatch((await getHtml(admin, '/farmacia?q=amoxi')).text, /Amoxicilina 500/);
    assert.match((await getHtml(admin, '/farmacia?q=amoxi&inactivos=1')).text, /Inactivo/);
    const sinEntrada = (await getHtml(admin, url)).text;
    assert.doesNotMatch(sinEntrada, /Registrar entrada/);
    await post(admin, url, `${url}/entrada`, { cantidad: '3' });
    assert.match((await getHtml(admin, url)).text, /está desactivado/);
    assert.equal(productos.getProducto(d.db, id).stock, 8);
    assert.equal((await post(admin, url, `${url}/estado`, { accion: 'borrar' })).status, 400);
    for (const [m, u] of [['delete', url], ['post', `${url}/borrar`]]) assert.ok([403, 404].includes((await admin[m](u)).status), `${m} ${u}`);
});

test('entrada y ajuste por formulario: actualizan el stock, validan y quedan en el historial', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const id = productos.createProducto(d.db, P(), d.ctx).id;
    const url = `/farmacia/${id}`;
    const malE = await post(admin, url, `${url}/entrada`, { cantidad: '0' });
    assert.equal(malE.status, 400);
    assert.match(malE.text, /Mínimo 1/);
    const okE = await post(admin, url, `${url}/entrada`, { cantidad: '10', nota: 'Pedido de noviembre' });
    assert.equal(okE.status, 302);
    assert.match((await getHtml(admin, url)).text, /Entrada registrada\. Stock actual: 18/);

    const sin = await post(admin, url, `${url}/ajuste`, { sentido: 'restar', cantidad: '2', motivo: '' });
    assert.equal(sin.status, 400);
    assert.match(sin.text, /Este campo es obligatorio/);
    const demasiado = await post(admin, url, `${url}/ajuste`, { sentido: 'restar', cantidad: '99', motivo: 'Merma enorme' });
    assert.match(demasiado.text, /solo hay 18/);
    assert.match(demasiado.text, /value="99"/, 'conserva lo escrito');
    assert.equal((await post(admin, url, `${url}/ajuste`, { sentido: 'restar', cantidad: '3', motivo: 'Conteo físico' })).status, 302);
    const ficha = (await getHtml(admin, url)).text;
    assert.match(ficha, /Ajuste registrado\. Stock actual: 15/);
    assert.match(ficha, /<strong>15<\/strong> caja/);
    assert.match(ficha, /3 movimientos/);
    assert.match(ficha, /Entrada de stock: Pedido de noviembre/);
    assert.match(ficha, /Ajuste: Conteo físico/);
    assert.match(ficha, /−3/);
    assert.equal(productos.getProducto(d.db, id).stock, 15);
});

test('alerta de bajo stock: aviso en Farmacia, filtro "solo bajo stock" y desaparece al reponer', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const bajo = productos.createProducto(d.db, P({ codigo: 'BAJO-1', nombre: 'Gasas', stock_minimo: '10', stock_inicial: '3' }), d.ctx).id;
    productos.createProducto(d.db, P({ codigo: 'OK-1', nombre: 'Guantes', stock_minimo: '10', stock_inicial: '50' }), d.ctx);
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    const html = (await getHtml(rec, '/farmacia')).text;
    assert.match(html, /1 producto en o bajo el stock mínimo:<\/strong> Gasas \(3\)/);
    assert.match(html, /Bajo stock/);
    const solo = (await getHtml(rec, '/farmacia?bajo=1')).text;
    assert.match(solo, /Gasas/);
    assert.doesNotMatch(solo, /Guantes/);
    await post(admin, `/farmacia/${bajo}`, `/farmacia/${bajo}/entrada`, { cantidad: '20' });
    assert.doesNotMatch((await getHtml(rec, '/farmacia')).text, /en o bajo el stock mínimo/);
    assert.match((await getHtml(rec, '/farmacia?bajo=1')).text, /Ningún producto coincide/);
});

test('búsqueda y paginación: texto hostil escapado, 25 por página, ids inválidos 404', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const ins = d.db.prepare("INSERT INTO productos (codigo, nombre, categoria) VALUES (?, ?, 'Otro')");
    for (let i = 1; i <= 30; i += 1) ins.run(`T-${i}`, `Insumo ${String(i).padStart(2, '0')}`);
    const p1 = (await getHtml(admin, '/farmacia?q=Insumo')).text;
    assert.match(p1, /Página 1 de 2 · 30 registros/);
    assert.equal((p1.match(/class="record"/g) || []).length, 25);
    assert.match(p1, /href="\/farmacia\?q=Insumo&amp;pagina=2"/);
    for (const q of ["'; DROP TABLE productos; --", '<script>alert(1)</script>', '%']) {
        const res = await getHtml(admin, `/farmacia?q=${encodeURIComponent(q)}`);
        assert.equal(res.status, 200, q);
        assert.doesNotMatch(res.text, /<script>alert\(1\)/);
    }
    const xss = productos.createProducto(d.db, P({ codigo: 'XSS-1', nombre: '<img src=x onerror=alert(1)>' }), d.ctx).id;
    const html = (await getHtml(admin, `/farmacia/${xss}`)).text;
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    for (const url of ['/farmacia/abc', '/farmacia/9999']) assert.equal((await getHtml(admin, url)).status, 404, url);
});

test('el módulo Farmacia ya no es un marcador de posición y la bitácora tiene sus acciones en español', async () => {
    const d = await setup();
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const id = productos.createProducto(d.db, P(), d.ctx).id;
    await post(admin, '/farmacia', `/farmacia/${id}/entrada`, { cantidad: '2' });
    assert.doesNotMatch((await getHtml(admin, '/farmacia')).text, /Próximamente|en construcción/i);
    const bit = (await getHtml(admin, '/ajustes/bitacora?entidad=producto')).text;
    assert.match(bit, /Producto creado/);
    assert.match(bit, /Entrada de stock/);
});
