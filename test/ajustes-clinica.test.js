'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    await mk('ana', 'Ana Pérez', 'admin');
    await mk('vet1', 'María López', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    return { db, app };
}
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const FORM = (extra = {}) => ({
    nombre: 'JEWA Veterinaria', telefono: '8888 7777', direccion: 'Managua', moneda: 'NIO', iva: '15', duracionCitaMin: '45',
    lunes_abierto: 'on', lunes_abre: '08:00', lunes_cierra: '17:00',
    sabado_abierto: 'on', sabado_abre: '08:00', sabado_cierra: '12:00', ...extra,
});
const SERV = (extra = {}) => ({ nombre: 'Radiografía', tipo: 'otro', precio: '350.50', duracion: '40', ...extra });
const idDe = (db, nombre) => db.prepare('SELECT id FROM servicios WHERE nombre = ?').get(nombre).id;

// ───────── Clínica
test('Clínica: muestra los valores por defecto (nombre, moneda, IVA 0, 30 min, L–V 8–17, S 8–12, domingo cerrado)', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await getHtml(admin, '/ajustes');
    assert.equal(res.status, 200);
    assert.match(res.text, /<h1>Clínica<\/h1>/);
    assert.match(res.text, /<a class="tab is-active" href="\/ajustes" aria-current="page">Clínica<\/a>/);
    assert.match(res.text, /href="\/ajustes\/servicios"/);
    assert.match(res.text, /name="nombre" type="text" value="JEWA"/);
    assert.match(res.text, /<option value="NIO" selected>Córdoba \(C\$\)<\/option>/);
    assert.match(res.text, /name="iva" type="text" value="0"/);
    assert.match(res.text, /name="duracionCitaMin" type="text" value="30"/);
    assert.match(res.text, /name="lunes_abierto" checked/);
    assert.match(res.text, /name="sabado_cierra" type="time" value="12:00"/);
    assert.doesNotMatch(res.text, /name="domingo_abierto" checked/);
    assert.equal((res.text.match(/type="time"/g) || []).length, 14, 'dos horas por cada día de la semana');
    assert.match(res.text, /inputmode="decimal"/);
});

test('Clínica: guardar redirige con aviso y el nuevo nombre aparece en menú, título, login y páginas de error', async () => {
    const { app, db } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await post(admin, '/ajustes', '/ajustes', FORM());
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/ajustes');

    const pantalla = await getHtml(admin, '/ajustes');
    assert.match(pantalla.text, /<p class="alert alert-ok" role="status">Ajustes guardados\.<\/p>/);
    assert.match(pantalla.text, /<title>Clínica \| JEWA Veterinaria<\/title>|<title>Ajustes \| JEWA Veterinaria<\/title>/);
    assert.match(pantalla.text, /<span>JEWA Veterinaria<\/span>/, 'marca del menú lateral');
    assert.match(pantalla.text, /name="telefono" type="tel" value="8888 7777"/, 'el teléfono vuelve en formato nacional');
    assert.match(pantalla.text, /name="iva" type="text" value="15"/);
    assert.match(pantalla.text, /name="duracionCitaMin" type="text" value="45"/);
    assert.match(pantalla.text, /<footer class="site-footer"><span>JEWA Veterinaria<\/span>/);

    const inicio = await getHtml(admin, '/');
    assert.match(inicio.text, /<h1>JEWA Veterinaria<\/h1>/);
    const noExiste = await getHtml(admin, '/no-existe');
    assert.match(noExiste.text, /<title>Página no encontrada \| JEWA Veterinaria<\/title>/);
    const login = await request(app).get('/login');
    assert.match(login.text, /<title>Iniciar sesión \| JEWA Veterinaria<\/title>/);
    assert.match(login.text, /<span>JEWA Veterinaria<\/span>/);

    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'ajustes_editados'").get().n, 1);
    const sinCambios = await post(admin, '/ajustes', '/ajustes', FORM());
    assert.match((await getHtml(admin, sinCambios.headers.location)).text, /No había cambios que guardar\./);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'ajustes_editados'").get().n, 1, 'sin cambios no hay bitácora');
});

test('Clínica: el nombre se escapa (XSS) en todas partes', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    await post(admin, '/ajustes', '/ajustes', FORM({ nombre: '<img src=x onerror=alert(1)>Vet' }));
    for (const html of [(await getHtml(admin, '/ajustes')).text, (await getHtml(admin, '/')).text, (await getHtml(admin, '/no-existe')).text, (await request(app).get('/login')).text]) {
        assert.doesNotMatch(html, /<img src=x/);
        assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;Vet/);
    }
});

test('Clínica: errores por campo (400), conserva lo escrito y no guarda nada', async () => {
    const { app, db } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await post(admin, '/ajustes', '/ajustes', FORM({
        nombre: '', telefono: '1234', iva: '150', duracionCitaMin: '2', moneda: 'EUR',
        lunes_cierra: '07:00', martes_abierto: 'on', martes_abre: '', martes_cierra: '', direccion: 'Calle conservada',
    }));
    assert.equal(res.status, 400);
    assert.match(res.text, /id="f-nombre-err">Este campo es obligatorio\./);
    assert.match(res.text, /Teléfono no válido/);
    assert.match(res.text, /El IVA no puede superar 100 %\./);
    assert.match(res.text, /Mínimo 5 minutos\./);
    assert.match(res.text, /Moneda no válida\./);
    assert.match(res.text, /Debe ser posterior a la apertura\./);
    assert.match(res.text, /Indica la hora de apertura\./);
    assert.match(res.text, /value="Calle conservada"/, 'conserva lo escrito');
    assert.match(res.text, /name="lunes_cierra" type="time" value="07:00" aria-invalid="true"/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM config').get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'ajustes_editados'").get().n, 0);
});

test('Clínica: cerrar un día y reabrirlo con otras horas', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    await post(admin, '/ajustes', '/ajustes', FORM({ lunes_abierto: undefined, miercoles_abierto: 'on', miercoles_abre: '09:30', miercoles_cierra: '13:45' }));
    const res = await getHtml(admin, '/ajustes');
    assert.doesNotMatch(res.text, /name="lunes_abierto" checked/, 'lunes quedó cerrado');
    assert.match(res.text, /name="miercoles_abierto" checked/);
    assert.match(res.text, /name="miercoles_abre" type="time" value="09:30"/);
    assert.match(res.text, /name="miercoles_cierra" type="time" value="13:45"/);
});

// ───────── Servicios
test('Servicios: lista los 5 servicios base con precio C$ 0.00 y avisa que no tienen precio', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await getHtml(admin, '/ajustes/servicios');
    assert.equal(res.status, 200);
    assert.match(res.text, /<h1>Servicios<\/h1>/);
    assert.match(res.text, /<a class="tab is-active" href="\/ajustes\/servicios" aria-current="page">Servicios<\/a>/);
    for (const nombre of ['Consulta general', 'Vacunación', 'Seguimiento', 'Baño', 'Corte']) assert.ok(res.text.includes(nombre), nombre);
    assert.match(res.text, /Consulta · 30 min · C\$ 0\.00 · <b class="sin-precio">Sin precio<\/b>/);
    assert.match(res.text, /<strong>5 servicios sin precio\.<\/strong>/);
    assert.match(res.text, /se venderían gratis/);
    assert.match(res.text, /<option value="grooming">Grooming<\/option>/);
    assert.match(res.text, /name="duracion" type="text" value="30"/);
});

test('Servicios: crear → aviso, precio formateado "C$ 350.50", sin el aviso de precio para ese servicio y en la bitácora', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await post(admin, '/ajustes/servicios', '/ajustes/servicios', SERV());
    assert.equal(res.status, 302);
    const lista = await getHtml(admin, '/ajustes/servicios');
    assert.match(lista.text, /<p class="alert alert-ok" role="status">Servicio &#34;Radiografía&#34; creado\.<\/p>/);
    assert.match(lista.text, /Otro · 40 min · C\$ 350\.50<\/span>/);
    assert.match(lista.text, /<strong>5 servicios sin precio\.<\/strong>/, 'los 5 base siguen sin precio; el nuevo sí lo tiene');
    assert.match((await getHtml(admin, '/ajustes/bitacora')).text, /Servicio creado/);
});

test('Servicios: errores por campo (400), conserva lo escrito y rechaza nombres repetidos', async () => {
    const { app, db } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await post(admin, '/ajustes/servicios', '/ajustes/servicios', SERV({ nombre: '', precio: '1,234.50', duracion: '3', tipo: 'magia' }));
    assert.equal(res.status, 400);
    assert.match(res.text, /id="f-nombre-err">Este campo es obligatorio\./);
    assert.match(res.text, /Monto no válido/);
    assert.match(res.text, /Mínimo 5 minutos\./);
    assert.match(res.text, /Tipo no válido\./);
    assert.match(res.text, /name="precio" type="text" value="1,234.50"/, 'conserva lo escrito');
    const dup = await post(admin, '/ajustes/servicios', '/ajustes/servicios', SERV({ nombre: 'consulta GENERAL' }));
    assert.equal(dup.status, 400);
    assert.match(dup.text, /Ya existe un servicio con ese nombre\./);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM servicios').get().n, 5);
});

test('Servicios: editar el precio quita el aviso y deja el cambio legible en la bitácora', async () => {
    const { app, db } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const id = idDe(db, 'Consulta general');
    const form = await getHtml(admin, `/ajustes/servicios/${id}/editar`);
    assert.equal(form.status, 200);
    assert.match(form.text, /name="precio" type="text" value="0\.00"/);
    assert.match(form.text, /<option value="consulta" selected>Consulta<\/option>/);

    const res = await post(admin, `/ajustes/servicios/${id}/editar`, `/ajustes/servicios/${id}`, { nombre: 'Consulta general', tipo: 'consulta', precio: '250', duracion: '30' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, `/ajustes/servicios/${id}/editar`);
    const despues = await getHtml(admin, res.headers.location);
    assert.match(despues.text, /Servicio guardado\./);
    assert.match(despues.text, /Consulta · 30 min · C\$ 250\.00/);
    assert.match(despues.text, /name="precio" type="text" value="250\.00"/);
    assert.match((await getHtml(admin, '/ajustes/servicios')).text, /<strong>4 servicios sin precio\.<\/strong>/);
    assert.match((await getHtml(admin, '/ajustes/bitacora')).text, /precio: C\$ 0\.00 → C\$ 250\.00/);

    const mal = await post(admin, `/ajustes/servicios/${id}/editar`, `/ajustes/servicios/${id}`, { nombre: '', tipo: 'consulta', precio: 'abc', duracion: '30' });
    assert.equal(mal.status, 400);
    assert.match(mal.text, /Monto no válido/);
});

test('Servicios: desactivar y reactivar con aviso; las citas existentes conservan su servicio', async () => {
    const { app, db } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const id = idDe(db, 'Vacunación');
    const vet = db.prepare("SELECT id FROM usuarios WHERE usuario = 'vet1'").get().id;
    const p = db.prepare("INSERT INTO propietarios (nombre, telefono) VALUES ('Cliente', '50588887777')").run();
    const m = db.prepare("INSERT INTO mascotas (numero_expediente, propietario_id, nombre, especie) VALUES ('EXP-000001', ?, 'Luna', 'Perro')").run(p.lastInsertRowid);
    db.prepare("INSERT INTO citas (mascota_id, veterinario_id, servicio_id, inicio, fin) VALUES (?, ?, ?, '2026-11-03T15:00:00Z', '2026-11-03T15:15:00Z')").run(m.lastInsertRowid, vet, id);

    const off = await post(admin, `/ajustes/servicios/${id}/editar`, `/ajustes/servicios/${id}/estado`, { accion: 'desactivar' });
    assert.match((await getHtml(admin, off.headers.location)).text, /Servicio desactivado\. Las citas y ventas anteriores no cambian\./);
    assert.match((await getHtml(admin, '/ajustes/servicios')).text, /status-waiting">Inactivo</);
    assert.equal(db.prepare('SELECT servicio_id FROM citas').get().servicio_id, id, 'la cita conserva su servicio');
    assert.equal(db.prepare('SELECT activo FROM servicios WHERE id = ?').get(id).activo, 0);

    const on = await post(admin, `/ajustes/servicios/${id}/editar`, `/ajustes/servicios/${id}/estado`, { accion: 'activar' });
    assert.match((await getHtml(admin, on.headers.location)).text, /Servicio reactivado\./);
    assert.equal(db.prepare('SELECT activo FROM servicios WHERE id = ?').get(id).activo, 1);
});

test('la moneda de Ajustes se aplica a los precios de toda la pantalla', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    await post(admin, '/ajustes/servicios', '/ajustes/servicios', SERV({ precio: '1500' }));
    assert.match((await getHtml(admin, '/ajustes/servicios')).text, /C\$ 1,500\.00/);
    await post(admin, '/ajustes', '/ajustes', FORM({ moneda: 'USD' }));
    const usd = (await getHtml(admin, '/ajustes/servicios')).text;
    assert.match(usd, /\$ 1,500\.00/);
    assert.doesNotMatch(usd, /C\$ 1,500/);
});

test('Servicios: ids inválidos o inexistentes → 404; acciones desconocidas → 400; XSS escapado', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    for (const id of ['abc', '0', '-1', '99999']) assert.equal((await getHtml(admin, `/ajustes/servicios/${id}/editar`)).status, 404, id);
    assert.equal((await post(admin, '/ajustes/servicios', '/ajustes/servicios/99999', SERV())).status, 404);
    assert.equal((await post(admin, '/ajustes/servicios', '/ajustes/servicios/99999/estado', { accion: 'desactivar' })).status, 404);
    assert.equal((await post(admin, '/ajustes/servicios', '/ajustes/servicios/1/estado', { accion: 'borrar' })).status, 400);
    await post(admin, '/ajustes/servicios', '/ajustes/servicios', SERV({ nombre: '<script>alert(1)</script>' }));
    const lista = (await getHtml(admin, '/ajustes/servicios')).text;
    assert.doesNotMatch(lista, /<script>alert\(1\)<\/script>/);
    assert.match(lista, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

// ───────── Permisos y protección
test('T-03: veterinario y recepcionista reciben 403 en Clínica y Servicios (GET y POST) y no cambian nada', async () => {
    const { app, db } = await setup();
    const antes = JSON.stringify([db.prepare('SELECT * FROM servicios').all(), db.prepare('SELECT * FROM config').all()]);
    const id = idDe(db, 'Corte');
    for (const usuario of ['vet1', 'rec1']) {
        const agent = await loginAs(app, usuario, CLAVE);
        for (const url of ['/ajustes', '/ajustes/servicios', `/ajustes/servicios/${id}/editar`]) {
            assert.equal((await getHtml(agent, url)).status, 403, `${usuario} GET ${url}`);
        }
        const token = csrfIn((await getHtml(agent, '/citas')).text);
        for (const [url, body] of [['/ajustes', FORM({ nombre: 'Hackeada' })], ['/ajustes/servicios', SERV()], [`/ajustes/servicios/${id}`, SERV({ nombre: 'Corte', precio: '0' })], [`/ajustes/servicios/${id}/estado`, { accion: 'desactivar' }]]) {
            assert.equal((await agent.post(url).type('form').send({ _csrf: token, ...body })).status, 403, `${usuario} POST ${url}`);
        }
    }
    assert.equal(JSON.stringify([db.prepare('SELECT * FROM servicios').all(), db.prepare('SELECT * FROM config').all()]), antes);
});

test('sin sesión redirige a /login y sin token CSRF el administrador recibe 403', async () => {
    const { app, db } = await setup();
    for (const url of ['/ajustes', '/ajustes/servicios']) {
        const res = await request(app).get(url).set('Accept', 'text/html');
        assert.equal(res.status, 302);
        assert.match(res.headers.location, /^\/login/);
    }
    const admin = await loginAs(app, 'ana', CLAVE);
    assert.equal((await admin.post('/ajustes').type('form').send(FORM())).status, 403);
    assert.equal((await admin.post('/ajustes/servicios').type('form').send(SERV())).status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM config').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM servicios').get().n, 5);
});

test('las pantallas nuevas no usan scripts, estilos ni eventos en línea y no cargan recursos externos', async () => {
    const { app, db } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    for (const url of ['/ajustes', '/ajustes/servicios', `/ajustes/servicios/${idDe(db, 'Baño')}/editar`]) {
        const html = (await getHtml(admin, url)).text;
        assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `script en línea en ${url}`);
        assert.doesNotMatch(html, /\sstyle\s*=/i, `style en línea en ${url}`);
        assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `evento en línea en ${url}`);
        assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i, `recurso externo en ${url}`);
        assert.match(html, /name="viewport"/);
    }
});
