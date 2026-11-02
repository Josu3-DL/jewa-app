'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { buildConfig } = require('../src/config');
const { navFor, canAccess, homeCardsFor, MODULES } = require('../src/modules');
const { formatLongDate, yearInZone, initials } = require('../src/utils/dates');
const { testDb, testConfig } = require('./helpers');

const ROOT = path.join(__dirname, '..');
// 2026-11-02 03:00 UTC = domingo 1 de noviembre, 21:00 en Managua (UTC-6)
const NOW = new Date('2026-11-02T03:00:00Z');

function appAs(role, extra = {}) {
    const config = testConfig({ DEV_ROLE: role });
    return createApp({ db: extra.db || testDb(), config, now: () => NOW, ...extra.options });
}
const html = (app, url) => request(app).get(url).set('Accept', 'text/html');
const navLabels = (text) => [...text.matchAll(/class="nav-link[^"]*"[^>]*><span>(\d+)<\/span> ([^<]+)</g)].map((m) => ({ n: m[1], label: m[2].trim() }));

test('styles.css es idéntico al diseño original (mismos estilos, D-02)', () => {
    const design = fs.readFileSync(path.join(ROOT, 'design', 'styles.css'));
    const served = fs.readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'));
    assert.ok(design.equals(served), 'public/css/styles.css difiere de design/styles.css; las adiciones van en app.css');
});

test('app.css define menú plegable, controles de 44 px y estados de cita nuevos', () => {
    const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'app.css'), 'utf8');
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /min-height: 44px/);
    for (const cls of ['.status-done', '.status-cancelled', '.status-noshow', '.table-scroll']) assert.ok(css.includes(cls), `falta ${cls}`);
});

test('menú por rol: el administrador ve todo, numerado del 01 al 10 en la página real', async () => {
    const res = await html(appAs('admin'), '/');
    const items = navLabels(res.text);
    assert.deepEqual(items.map((l) => l.label), ['Inicio', 'Citas', 'Mascotas', 'Clientes', 'Historial clínico', 'Farmacia', 'Ventas', 'Recordatorios', 'Reportes', 'Ajustes']);
    assert.deepEqual(items.map((l) => l.n), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
});

test('menú por rol: la recepcionista ve 7 opciones numeradas del 01 al 07 en la página real', async () => {
    const items = navLabels((await html(appAs('recepcion'), '/')).text);
    assert.deepEqual(items.map((l) => l.n), ['01', '02', '03', '04', '05', '06', '07']);
    assert.ok(!items.some((l) => ['Historial clínico', 'Reportes', 'Ajustes'].includes(l.label)));
});

test('menú por rol: la recepcionista no ve historial clínico, reportes ni ajustes', () => {
    const all = (r) => [...navFor(r).main, ...navFor(r).footer].map((m) => m.key);
    assert.deepEqual(all('recepcion'), ['inicio', 'citas', 'mascotas', 'clientes', 'farmacia', 'ventas', 'recordatorios']);
    assert.deepEqual(all('veterinario'), ['inicio', 'citas', 'mascotas', 'clientes', 'historial', 'farmacia', 'ventas', 'recordatorios', 'reportes']);
});

test('la numeración del menú es consecutiva y sin repetidos para cada rol', () => {
    for (const role of ['admin', 'veterinario', 'recepcion']) {
        const nums = [...navFor(role).main, ...navFor(role).footer].map((m) => m.number);
        assert.deepEqual(nums, nums.map((_, i) => String(i + 1).padStart(2, '0')));
    }
});

test('canAccess rechaza roles y módulos desconocidos', () => {
    assert.equal(canAccess('admin', 'citas'), true);
    assert.equal(canAccess('recepcion', 'historial'), false);
    assert.equal(canAccess(undefined, 'citas'), false);
    assert.equal(canAccess('admin', 'inexistente'), false);
});

test('las tarjetas de inicio respetan el rol', () => {
    assert.equal(homeCardsFor('admin').length, 5);
    assert.ok(homeCardsFor('recepcion').every((c) => canAccess('recepcion', c.module)));
});

test('GET / con sesión simulada muestra el layout completo', async () => {
    const res = await html(appAs('admin'), '/');
    assert.equal(res.status, 200);
    assert.match(res.text, /<meta name="viewport" content="width=device-width, initial-scale=1.0">/);
    assert.match(res.text, /href="\/css\/styles\.css"/);
    assert.match(res.text, /href="\/css\/app\.css"/);
    assert.match(res.text, /<title>Inicio \| JEWA<\/title>/);
    assert.match(res.text, /class="sidebar"/);
    assert.match(res.text, /data-sidebar-toggle/);
    assert.match(res.text, /Saltar al contenido/);
    assert.match(res.text, /Gestionar citas/);
});

test('el elemento activo del menú lo marca el servidor', async () => {
    const res = await html(appAs('admin'), '/citas');
    assert.equal(res.status, 200);
    const active = [...res.text.matchAll(/class="nav-link is-active"[^>]*aria-current="page"><span>\d+<\/span> ([^<]+)</g)].map((m) => m[1].trim());
    assert.deepEqual(active, ['Citas']);
});

test('la fecha se genera en el servidor con la zona de Managua', async () => {
    const res = await html(appAs('admin'), '/');
    assert.match(res.text, /Domingo, 1 de noviembre de 2026/);
    assert.equal(formatLongDate(new Date('2026-11-02T05:59:00Z')), 'Domingo, 1 de noviembre de 2026');
    assert.equal(formatLongDate(new Date('2026-11-02T06:00:00Z')), 'Lunes, 2 de noviembre de 2026');
    assert.equal(yearInZone(new Date('2027-01-01T05:00:00Z')), 2026);
});

test('usuario y rol reales en la barra superior; iniciales en el avatar', async () => {
    const options = { resolveUser: () => ({ id: 7, nombre: 'Laura Mendez', usuario: 'laura', rol: 'veterinario' }) };
    const res = await html(appAs('veterinario', { options }), '/');
    assert.match(res.text, /<strong>Laura Mendez<\/strong><span>Veterinario<\/span>/);
    assert.match(res.text, /class="avatar"[^>]*>LM</);
    assert.match(res.text, /action="\/logout"/, 'un usuario real puede cerrar sesión');
    assert.deepEqual(['Ana', 'Laura Mendez', '  juan  carlos  perez ', ''].map(initials), ['AN', 'LM', 'JP', '?']);
});

test('el usuario simulado no muestra "Cerrar sesión"', async () => {
    const res = await html(appAs('admin'), '/');
    assert.doesNotMatch(res.text, /action="\/logout"/);
});

test('el nombre del usuario y de la clínica se escapan (XSS)', async () => {
    const db = testDb();
    db.prepare("INSERT INTO config (clave, valor) VALUES ('nombre_clinica', '<img src=x onerror=alert(1)>')").run();
    const options = { resolveUser: () => ({ id: 1, nombre: '<script>alert(1)</script>', usuario: 'x', rol: 'admin' }) };
    const res = await html(appAs('admin', { db, options }), '/');
    assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(res.text, /<img src=x/);
    assert.match(res.text, /&lt;script&gt;/);
});

test('el nombre de la clínica sale de Ajustes (config) y por defecto es JEWA', async () => {
    const db = testDb();
    assert.match((await html(appAs('admin', { db }), '/')).text, /<h1>JEWA<\/h1>/);
    db.prepare("INSERT INTO config (clave, valor) VALUES ('nombre_clinica', 'Veterinaria Sur')").run();
    assert.match((await html(appAs('admin', { db }), '/')).text, /<h1>Veterinaria Sur<\/h1>/);
});

test('sin usuario (sin DEV_ROLE) todos los módulos responden 403', async () => {
    const app = createApp({ db: testDb(), config: testConfig(), now: () => NOW });
    for (const url of ['/', '/citas', '/historial', '/ajustes']) {
        const res = await html(app, url);
        assert.equal(res.status, 403, url);
        assert.match(res.text, /Acceso denegado/);
    }
});

test('T-03 (parcial): la recepcionista recibe 403 en historial, reportes y ajustes', async () => {
    const app = appAs('recepcion');
    for (const url of ['/historial', '/reportes', '/ajustes']) assert.equal((await html(app, url)).status, 403, url);
    assert.equal((await html(app, '/citas')).status, 200);
});

test('el veterinario entra a historial y reportes pero no a ajustes', async () => {
    const app = appAs('veterinario');
    assert.equal((await html(app, '/historial')).status, 200);
    assert.equal((await html(app, '/reportes')).status, 200);
    assert.equal((await html(app, '/ajustes')).status, 403);
});

test('todos los módulos del menú tienen ruta para el rol que los ve', async () => {
    for (const role of ['admin', 'veterinario', 'recepcion']) {
        const app = appAs(role);
        for (const m of MODULES.filter((x) => canAccess(role, x.key))) {
            const res = await html(app, m.path);
            assert.equal(res.status, 200, `${role} ${m.path}`);
        }
    }
});

test('el menú no muestra enlaces a módulos prohibidos', async () => {
    const res = await html(appAs('recepcion'), '/');
    assert.doesNotMatch(res.text, /href="\/historial"/);
    assert.doesNotMatch(res.text, /href="\/reportes"/);
    assert.doesNotMatch(res.text, /href="\/ajustes"/);
    assert.match(res.text, /href="\/clientes"/);
});

test('ninguna página carga recursos externos (sin Unsplash ni CDN)', async () => {
    const res = await html(appAs('admin'), '/');
    assert.doesNotMatch(res.text, /(?:src|href)=["']https?:\/\//i);
    assert.doesNotMatch(res.text, /unsplash/i);
    const img = await request(appAs('admin')).get('/img/hero.svg');
    assert.equal(img.status, 200);
    assert.match(img.headers['content-type'], /svg/);
});

test('los activos estáticos y el JS del menú se sirven', async () => {
    const app = appAs('admin');
    for (const url of ['/css/styles.css', '/css/app.css', '/js/app.js']) assert.equal((await request(app).get(url)).status, 200, url);
});

test('DEV_ROLE: se rechaza en producción y si el rol es inválido', () => {
    const prod = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) };
    assert.throws(() => buildConfig({ ...prod, DEV_ROLE: 'admin' }), /DEV_ROLE/);
    assert.throws(() => buildConfig({ DEV_ROLE: 'dios' }), /DEV_ROLE inválido/);
    assert.equal(buildConfig({ DEV_ROLE: 'recepcion' }).devRole, 'recepcion');
    assert.equal(buildConfig({}).devRole, null);
});

test('la versión de la app sale de package.json', () => {
    assert.equal(buildConfig({}).version, require('../package.json').version);
});
