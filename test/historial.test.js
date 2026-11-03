'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const citas = require('../src/services/citas');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    await mk('ana', 'Ana Pérez', 'admin');
    const vet = await mk('vet1', 'María López', 'veterinario');
    await mk('vet2', 'Pedro Gómez', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const ctx = { ahora: NOW };
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const m1 = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' }, ctx).id;
    return { db, app, vet, m1 };
}
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const FORM = (d, extra = {}) => ({ mascota: String(d.m1), motivo: 'Decaimiento', diagnostico: 'Gastroenteritis', peso_kg: '12.5', ...extra });
const crear = (agent, d, extra) => post(agent, `/historial/nueva?mascota=${d.m1}`, '/historial', FORM(d, extra));
const ultima = (db) => db.prepare('SELECT MAX(id) AS id FROM consultas').get().id;

test('T-03 acceso: recepción no entra al historial; el administrador lo ve pero NO crea consultas (RN-02); sin sesión → login', async () => {
    const d = await setup();
    assert.equal((await request(d.app).get('/historial').set('Accept', 'text/html')).status, 302);
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    for (const url of ['/historial', '/historial/nueva', '/historial/1']) assert.equal((await getHtml(rec, url)).status, 403, url);
    assert.equal((await post(rec, '/', '/historial', FORM(d))).status, 403);

    const admin = await loginAs(d.app, 'ana', CLAVE);
    assert.equal((await getHtml(admin, '/historial')).status, 200);
    assert.equal((await getHtml(admin, '/historial/nueva')).status, 403);
    assert.equal((await post(admin, '/historial', '/historial', FORM(d))).status, 403);
    assert.doesNotMatch((await getHtml(admin, `/historial?mascota=${d.m1}`)).text, /\+ Nueva consulta/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM consultas').get().n, 0);

    const vet = await loginAs(d.app, 'vet1', CLAVE);
    assert.match((await getHtml(vet, `/historial?mascota=${d.m1}`)).text, /\+ Nueva consulta/);
});

test('POST sin token CSRF → 403', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    for (const url of ['/historial', '/historial/1/anular']) assert.equal((await vet.post(url).type('form').send({ motivo: 'x' })).status, 403, url);
});

test('consulta sin cita: se elige la mascota, se llena el formulario y aparece en el historial', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const elegir = await getHtml(vet, '/historial/nueva');
    assert.match(elegir.text, new RegExp(`href="/historial/nueva\\?mascota=${d.m1}"`));
    const form = await getHtml(vet, `/historial/nueva?mascota=${d.m1}`);
    assert.match(form.text, /CONSULTA SIN CITA \(URGENCIA\)/);
    assert.match(form.text, /<textarea id="f-anamnesis"/);
    assert.match(form.text, /name="peso_kg"[^>]*inputmode="decimal"/);

    const r = await crear(vet, d, { anamnesis: 'Vómitos desde ayer', temperatura_c: '39,1' });
    assert.equal(r.status, 302);
    const det = await getHtml(vet, r.headers.location);
    assert.match(det.text, /Consulta registrada\./);
    assert.match(det.text, /Gastroenteritis/);
    assert.match(det.text, /Vómitos desde ayer/);
    assert.match(det.text, /12\.5 kg/);
    assert.match(det.text, /39\.1 °C/);
    assert.match(det.text, /María López/);
    const hist = await getHtml(vet, `/historial?mascota=${d.m1}`);
    assert.match(hist.text, /Gastroenteritis/);
    assert.match(hist.text, /Vigente/);
});

test('errores de validación: se muestran bajo cada campo, conservan lo escrito y no guardan nada', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const r = await crear(vet, d, { motivo: '', diagnostico: '', peso_kg: '500', temperatura_c: '60', frecuencia_cardiaca: '5', anamnesis: 'Texto <b>conservado</b>' });
    assert.equal(r.status, 400);
    assert.match(r.text, /Este campo es obligatorio/);
    assert.match(r.text, /Máximo 200/);
    assert.match(r.text, /Máximo 45/);
    assert.match(r.text, /Mínimo 20/);
    assert.match(r.text, /Texto &lt;b&gt;conservado&lt;\/b&gt;/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM consultas').get().n, 0);
    assert.equal((await post(vet, '/historial/nueva', '/historial', FORM(d, { mascota: '999' }))).status, 400);
});

test('desde una cita: precarga el motivo, guarda la consulta y la cita pasa a atendida', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const cita = citas.crearCita(d.db, { mascota: String(d.m1), responsable: String(d.vet), fecha: '2026-11-03', hora: '09:00', motivo: 'Vacuna anual' }, { ahora: NOW }).id;
    const detCita = await getHtml(vet, `/citas/${cita}`);
    assert.match(detCita.text, new RegExp(`href="/historial/nueva\\?cita=${cita}"`));

    const form = await getHtml(vet, `/historial/nueva?cita=${cita}`);
    assert.match(form.text, /CONSULTA DESDE CITA/);
    assert.match(form.text, /name="motivo" type="text" value="Vacuna anual"/);
    assert.match(form.text, new RegExp(`name="cita" value="${cita}"`));

    const r = await post(vet, `/historial/nueva?cita=${cita}`, '/historial', FORM(d, { cita: String(cita), motivo: 'Vacuna anual' }));
    assert.equal(r.status, 302);
    assert.match((await getHtml(vet, r.headers.location)).text, /La cita quedó atendida/);
    assert.equal(citas.getCita(d.db, cita).estado, 'atendida');
    // ya no se puede iniciar otra consulta desde esa cita
    const otra = await getHtml(vet, `/historial/nueva?cita=${cita}`);
    assert.equal(otra.status, 302);
    assert.match((await getHtml(vet, otra.headers.location)).text, /ya no está activa|Cita terminada/);
    assert.equal((await getHtml(vet, '/historial/nueva?cita=999')).status, 404);
});

test('T-12 anular: motivo obligatorio, marcada como anulada con quién/cuándo/por qué y contenido conservado', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    await crear(vet, d, { diagnostico: 'Diagnóstico equivocado' });
    const id = ultima(d.db);
    const det = await getHtml(vet, `/historial/${id}`);
    assert.match(det.text, new RegExp(`action="/historial/${id}/anular"`));
    assert.doesNotMatch(det.text, /Eliminar|Borrar/, 'sin botón de borrado');

    const sinMotivo = await post(vet, `/historial/${id}`, `/historial/${id}/anular`, { motivo: '' });
    assert.equal(sinMotivo.status, 400);
    assert.match(sinMotivo.text, /Este campo es obligatorio/);
    assert.equal(d.db.prepare('SELECT estado FROM consultas WHERE id = ?').get(id).estado, 'vigente');

    const ok = await post(vet, `/historial/${id}`, `/historial/${id}/anular`, { motivo: 'Mascota equivocada' });
    assert.equal(ok.status, 302);
    const anulada = (await getHtml(vet, `/historial/${id}`)).text;
    assert.match(anulada, /Consulta anulada<\/strong> por María López/);
    assert.match(anulada, /Motivo: Mascota equivocada/);
    assert.match(anulada, /Diagnóstico equivocado/, 'conserva el contenido');
    assert.doesNotMatch(anulada, /Anular consulta<\/h3>/, 'ya no ofrece anular');
    assert.match((await getHtml(vet, `/historial?mascota=${d.m1}`)).text, /Anulada/);
    assert.ok(d.db.prepare("SELECT 1 FROM bitacora WHERE accion = 'consulta_anulada'").get());
});

test('anular: otro veterinario recibe 403; el administrador sí puede; T-13 sin rutas de borrado', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    await crear(vet, d);
    const id = ultima(d.db);
    const otro = await loginAs(d.app, 'vet2', CLAVE);
    assert.doesNotMatch((await getHtml(otro, `/historial/${id}`)).text, /Anular consulta<\/h3>/);
    assert.equal((await post(otro, `/historial/${id}`, `/historial/${id}/anular`, { motivo: 'No es mía' })).status, 403);
    const admin = await loginAs(d.app, 'ana', CLAVE);
    assert.match((await getHtml(admin, `/historial/${id}`)).text, /Anular consulta<\/h3>/);
    assert.equal((await post(admin, `/historial/${id}`, `/historial/${id}/anular`, { motivo: 'Corrección administrativa' })).status, 302);
    for (const [metodo, url] of [['delete', `/historial/${id}`], ['post', `/historial/${id}/borrar`], ['post', `/historial/${id}/eliminar`]]) {
        assert.ok([403, 404].includes((await vet[metodo](url)).status), `${metodo} ${url}`);
    }
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM consultas').get().n, 1);
    assert.equal((await post(vet, '/historial', '/historial/999/anular', { motivo: 'Cualquier cosa' })).status, 404);
});

test('historial: filtros por texto, fechas y estado; búsqueda general por mascota; entradas hostiles sin error', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    await crear(vet, d, { diagnostico: 'Otitis' });
    await crear(vet, d, { diagnostico: 'Dermatitis' });
    const hist = (q) => getHtml(vet, `/historial?mascota=${d.m1}${q}`).then((r) => r.text);
    assert.match(await hist('&q=otitis'), /Otitis/);
    assert.doesNotMatch(await hist('&q=otitis'), /Dermatitis/);
    assert.match(await hist('&q=zzz'), /No hay consultas con esos filtros/);
    assert.match(await hist('&desde=2026-11-02&hasta=2026-11-02'), /Dermatitis/);
    assert.match(await hist('&desde=2026-11-03'), /No hay consultas/);
    assert.match(await hist('&estado=anulada'), /No hay consultas/);
    assert.match((await getHtml(vet, '/historial?q=firulais')).text, /Firulais \(EXP-000001\)/);
    for (const q of ["'; DROP TABLE consultas; --", '<script>alert(1)</script>', '%', 'desde=mal']) {
        const r = await getHtml(vet, `/historial?q=${encodeURIComponent(q)}&desde=mal&estado=x&pagina=-4`);
        assert.equal(r.status, 200, q);
        assert.doesNotMatch(r.text, /<script>alert\(1\)/);
    }
    assert.equal((await getHtml(vet, '/historial?mascota=999')).status, 404);
    assert.equal((await getHtml(vet, '/historial/abc')).status, 404);
});

test('gráfica de peso: con menos de 2 mediciones muestra el mensaje; con 2 o más, el canvas y Chart.js local; ignora anuladas', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const vacio = (await getHtml(vet, `/historial?mascota=${d.m1}`)).text;
    assert.match(vacio, /Se necesitan al menos 2 mediciones de peso/);
    assert.doesNotMatch(vacio, /<canvas/);

    await crear(vet, d, { peso_kg: '10' });
    assert.match((await getHtml(vet, `/historial?mascota=${d.m1}`)).text, /hay 1: 10 kg/);
    await crear(vet, d, { peso_kg: '99' });
    const mal = ultima(d.db);
    await crear(vet, d, { peso_kg: '11,5' });
    const con = (await getHtml(vet, `/historial?mascota=${d.m1}`)).text;
    assert.match(con, /<canvas id="grafica-peso"/);
    assert.match(con, /src="\/vendor\/chart\.umd\.min\.js"/);
    assert.match(con, /src="\/js\/weight-chart\.js"/);
    assert.match(con, /data-pesos="\[\{&#34;fecha&#34;:&#34;2026-11-02&#34;,&#34;peso&#34;:10\}/);

    await post(vet, `/historial/${mal}`, `/historial/${mal}/anular`, { motivo: 'Peso mal digitado' });
    const sin = (await getHtml(vet, `/historial?mascota=${d.m1}`)).text;
    assert.doesNotMatch(sin, /&#34;peso&#34;:99/, 'la anulada no entra en la gráfica');
    assert.match(sin, /Último peso: <strong>11\.5 kg/);

    const lib = await request(d.app).get('/vendor/chart.umd.min.js');
    assert.equal(lib.status, 200);
    assert.match(lib.headers['content-type'], /javascript/);
});

test('el selector de citas sigue funcionando tras parametrizarlo', async () => {
    const d = await setup();
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    const r = await getHtml(rec, '/citas/nueva');
    assert.match(r.text, /<h1>Nueva cita<\/h1>/);
    assert.match(r.text, new RegExp(`href="/citas/nueva\\?mascota=${d.m1}"`));
    assert.match(r.text, />Agendar</);
});
