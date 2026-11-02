'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');
// PNG real de 1×1 píxel (imagen ficticia)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function setup() {
    const db = testDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewa-fotos-'));
    const config = testConfig({ UPLOAD_DIR: dir });
    const app = createApp({ db, config, now: () => NOW });
    const mk = (usuario, nombre, rol) => users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE });
    await mk('ana', 'Ana Pérez', 'admin');
    await mk('vet1', 'María López', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    return { db, app, dir, limpiar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const CLI = (extra = {}) => ({ nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on', ...extra });
const MASC = (propietario, extra = {}) => ({ propietario: String(propietario), nombre: 'Firulais', especie: 'Perro', sexo: 'macho', ...extra });

async function crearCliente(agent, extra) {
    const res = await post(agent, '/clientes', '/clientes', CLI(extra));
    assert.equal(res.status, 302, 'cliente creado');
    return Number(/\/clientes\/(\d+)/.exec(res.headers.location)[1]);
}
/** Crea una mascota por el formulario multipart real (con o sin foto). */
async function crearMascota(agent, propietario, { foto, tipo = 'image/png', nombreArchivo = 'foto.png', extra = {} } = {}) {
    const page = await getHtml(agent, `/mascotas/nueva?propietario=${propietario}`);
    const req = agent.post('/mascotas').field('_csrf', csrfIn(page.text));
    for (const [k, v] of Object.entries(MASC(propietario, extra))) req.field(k, v);
    if (foto) req.attach('foto', foto, { filename: nombreArchivo, contentType: tipo });
    return req;
}

// ───────── Acceso (T-02, T-03)
test('clientes y mascotas: sin sesión → login; los tres roles pueden entrar', async () => {
    const { app, limpiar } = await setup();
    try {
        for (const url of ['/clientes', '/mascotas', '/mascotas/nueva', '/clientes/1', '/mascotas/1', '/mascotas/1/foto']) {
            const res = await request(app).get(url).set('Accept', 'text/html');
            assert.equal(res.status, 302, url);
            assert.match(res.headers.location, /^\/login/);
        }
        for (const [usuario, nombre] of [['ana', 'admin'], ['vet1', 'vet'], ['rec1', 'recepción']]) {
            const agent = await loginAs(app, usuario, CLAVE);
            assert.equal((await getHtml(agent, '/clientes')).status, 200, `${nombre} ve clientes`);
            assert.equal((await getHtml(agent, '/mascotas')).status, 200, `${nombre} ve mascotas`);
        }
    } finally { limpiar(); }
});

test('POST sin token CSRF → 403 en clientes, mascotas, estado y transferencia', async () => {
    const { app, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        for (const url of ['/clientes', '/clientes/1', '/clientes/1/estado', '/mascotas/1', '/mascotas/1/foto/quitar', '/mascotas/1/transferir']) {
            assert.equal((await agent.post(url).type('form').send({ nombre: 'x' })).status, 403, url);
        }
    } finally { limpiar(); }
});

// ───────── Clientes
test('cliente: se crea, aparece en la lista y en su ficha; errores se muestran bajo el campo con lo escrito', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const mal = await post(agent, '/clientes', '/clientes', CLI({ nombre: 'Ana <b>', telefono: '12', correo: 'no' }));
        assert.equal(mal.status, 400);
        assert.match(mal.text, /Teléfono no válido/);
        assert.match(mal.text, /Correo no válido/);
        assert.match(mal.text, /value="Ana &lt;b&gt;"/, 'conserva lo escrito, escapado');
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM propietarios').get().n, 0);

        const id = await crearCliente(agent, { cedula: '001-010101-0001A' });
        const ficha = await getHtml(agent, `/clientes/${id}`);
        assert.match(ficha.text, /Cliente &quot;Laura Mendoza&quot; creado|Laura Mendoza/);
        assert.match(ficha.text, /8888 7777/);
        assert.match(ficha.text, /Agregar mascota/);
        const lista = await getHtml(agent, '/clientes?q=laura');
        assert.match(lista.text, /Laura Mendoza/);
        assert.match(lista.text, /0 mascotas/);
        assert.match((await getHtml(agent, '/clientes?q=nadie')).text, /Ningún cliente coincide/);
    } finally { limpiar(); }
});

test('cliente: cédula repetida se rechaza; consentimiento cambia y queda en bitácora', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent, { cedula: '001-010101-0001A' });
        const dup = await post(agent, '/clientes', '/clientes', CLI({ nombre: 'Otra Persona', cedula: '001-010101-0001A' }));
        assert.equal(dup.status, 400);
        assert.match(dup.text, /Ya existe un cliente con esa cédula/);

        const r = await post(agent, `/clientes/${id}`, `/clientes/${id}`, { nombre: 'Laura Mendoza', telefono: '8888 7777', cedula: '001-010101-0001A' });
        assert.equal(r.status, 302);
        assert.equal(db.prepare('SELECT acepta_notificaciones AS a FROM propietarios WHERE id = ?').get(id).a, 0);
        const fila = db.prepare("SELECT * FROM bitacora WHERE accion = 'consentimiento_cambiado'").get();
        assert.equal(fila.entidad_id, id);
        assert.match((await getHtml(agent, `/clientes/${id}`)).text, /No quiere recordatorios/);
    } finally { limpiar(); }
});

test('T-16 por HTTP: desactivar con mascotas activas muestra el motivo y no cambia nada', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent);
        assert.equal((await crearMascota(agent, id)).status, 302);
        const r = await post(agent, `/clientes/${id}`, `/clientes/${id}/estado`, { accion: 'desactivar' });
        assert.equal(r.status, 302);
        const ficha = await getHtml(agent, `/clientes/${id}`);
        assert.match(ficha.text, /No se puede desactivar: tiene 1 mascota activa/);
        assert.equal(db.prepare('SELECT activo FROM propietarios WHERE id = ?').get(id).activo, 1);
        assert.equal((await post(agent, `/clientes/${id}`, `/clientes/${id}/estado`, { accion: 'borrar' })).status, 400);
    } finally { limpiar(); }
});

test('rutas con id inválido o inexistente → 404', async () => {
    const { app, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        for (const url of ['/clientes/abc', '/clientes/999', '/mascotas/abc', '/mascotas/999', '/mascotas/999/foto', '/mascotas/999/transferir']) {
            assert.equal((await getHtml(agent, url)).status, 404, url);
        }
    } finally { limpiar(); }
});

// ───────── Mascotas
test('mascota: primero se elige al propietario; el formulario lo trae fijo; se crea con expediente', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent);
        const elegir = await getHtml(agent, '/mascotas/nueva');
        assert.match(elegir.text, /Elige al propietario|Primero elige/);
        assert.match(elegir.text, new RegExp(`href="/mascotas/nueva\\?propietario=${id}"`));
        assert.doesNotMatch(elegir.text, /name="propietario"/, 'sin texto libre de propietario');

        const form = await getHtml(agent, `/mascotas/nueva?propietario=${id}`);
        assert.match(form.text, /name="propietario" value="\d+"/);
        assert.match(form.text, /enctype="multipart\/form-data"/);
        assert.match(form.text, /accept="image\/jpeg,image\/png,image\/webp"/);

        const res = await crearMascota(agent, id, { extra: { fecha_nacimiento: '2024-08-02', raza: 'Criollo' } });
        assert.equal(res.status, 302);
        const m = db.prepare('SELECT * FROM mascotas').get();
        assert.equal(m.numero_expediente, 'EXP-000001');
        const ficha = await getHtml(agent, res.headers.location);
        assert.match(ficha.text, /EXPEDIENTE EXP-000001/);
        assert.match(ficha.text, /2 años 3 meses/, 'edad calculada con la fecha inyectada');
        assert.match(ficha.text, /Laura Mendoza/);
        assert.match(ficha.text, /href="\/mascotas\/\d+\/transferir"/);
        assert.doesNotMatch(ficha.text, /\/historial\?mascota/, 'recepción no ve el historial clínico');
        assert.match(ficha.text, /\/citas\?mascota=/);
        const clienteFicha = await getHtml(agent, `/clientes/${id}`);
        assert.match(clienteFicha.text, /Firulais/);
        assert.match(clienteFicha.text, /EXP-000001/);
    } finally { limpiar(); }
});

test('mascota: el veterinario ve el acceso al historial; los errores no crean nada', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const vet = await loginAs(app, 'vet1', CLAVE);
        const id = await crearCliente(vet);
        const mal = await crearMascota(vet, id, { extra: { nombre: '', especie: 'Dragón', fecha_nacimiento: '2030-01-01' } });
        assert.equal(mal.status, 400);
        assert.match(mal.text, /Este campo es obligatorio/);
        assert.match(mal.text, /futura/);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mascotas').get().n, 0);
        const ok = await crearMascota(vet, id);
        assert.match((await getHtml(vet, ok.headers.location)).text, /href="\/historial\?mascota=\d+"/);
    } finally { limpiar(); }
});

test('mascota: propietario inactivo o inexistente → 400', async () => {
    const { app, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent);
        await post(agent, `/clientes/${id}`, `/clientes/${id}/estado`, { accion: 'desactivar' }); // sin mascotas, se permite
        assert.equal((await crearMascota(agent, id)).status, 400, 'propietario inactivo');
        assert.equal((await crearMascota(agent, 9999)).status, 400, 'propietario inexistente');
        // y el formulario de alta no ofrece al inactivo
        assert.doesNotMatch((await getHtml(agent, '/mascotas/nueva')).text, /Laura Mendoza/);
        assert.match((await getHtml(agent, `/mascotas/nueva?propietario=${id}`)).text, /Elige al propietario|Primero elige/);
    } finally { limpiar(); }
});

test('foto: se guarda como archivo (no base64), se sirve con sesión y se puede cambiar y quitar', async () => {
    const { app, db, dir, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent);
        const res = await crearMascota(agent, id, { foto: PNG });
        assert.equal(res.status, 302);
        const m = db.prepare('SELECT * FROM mascotas').get();
        assert.match(m.foto, /^[0-9a-f-]{36}\.png$/, 'nombre generado, sin base64 ni nombre original');
        assert.ok(fs.existsSync(path.join(dir, 'fotos', m.foto)));
        assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'fotos')), 'fuera de public/');

        const img = await agent.get(`/mascotas/${m.id}/foto`).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
        assert.equal(img.status, 200);
        assert.equal(img.headers['content-type'], 'image/png');
        assert.deepEqual(img.body, PNG);
        assert.match((await getHtml(agent, `/mascotas/${m.id}`)).text, new RegExp(`<img class="pet-photo" src="/mascotas/${m.id}/foto"`));
        assert.ok([302, 401].includes((await request(app).get(`/mascotas/${m.id}/foto`)).status), 'sin sesión no se ve');

        // cambiar: el archivo anterior se borra
        const page = await getHtml(agent, `/mascotas/${m.id}`);
        const cambio = await agent.post(`/mascotas/${m.id}/foto`).field('_csrf', csrfIn(page.text)).attach('foto', PNG, { filename: 'otra.png', contentType: 'image/png' });
        assert.equal(cambio.status, 302);
        const nueva = db.prepare('SELECT foto FROM mascotas').get().foto;
        assert.notEqual(nueva, m.foto);
        assert.ok(!fs.existsSync(path.join(dir, 'fotos', m.foto)), 'la foto anterior se borró');
        assert.ok(fs.existsSync(path.join(dir, 'fotos', nueva)));

        // quitar
        assert.equal((await post(agent, `/mascotas/${m.id}`, `/mascotas/${m.id}/foto/quitar`)).status, 302);
        assert.equal(db.prepare('SELECT foto FROM mascotas').get().foto, null);
        assert.equal(fs.readdirSync(path.join(dir, 'fotos')).length, 0);
        assert.equal((await getHtml(agent, `/mascotas/${m.id}/foto`)).status, 404);
    } finally { limpiar(); }
});

test('T-19 foto: rechaza un .exe disfrazado de imagen, un PDF y un archivo de más de 2 MB (y no crea la mascota)', async () => {
    const { app, db, dir, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent);
        const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
        const falso = await crearMascota(agent, id, { foto: exe, nombreArchivo: 'virus.png', tipo: 'image/png' });
        assert.equal(falso.status, 400);
        assert.match(falso.text, /JPG, PNG o WebP/);

        const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
        assert.equal((await crearMascota(agent, id, { foto: pdf, nombreArchivo: 'x.png', tipo: 'image/png' })).status, 400);

        const grande = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 10)]);
        const pesada = await crearMascota(agent, id, { foto: grande });
        assert.equal(pesada.status, 400);
        assert.match(pesada.text, /pesa más de 2 MB/);

        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mascotas').get().n, 0);
        assert.ok(!fs.existsSync(path.join(dir, 'fotos')) || fs.readdirSync(path.join(dir, 'fotos')).length === 0, 'no quedó ningún archivo');

        // desde la ficha: aviso y la foto no cambia
        const ok = await crearMascota(agent, id);
        const mid = Number(/\/mascotas\/(\d+)/.exec(ok.headers.location)[1]);
        const page = await getHtml(agent, `/mascotas/${mid}`);
        const subida = await agent.post(`/mascotas/${mid}/foto`).field('_csrf', csrfIn(page.text)).attach('foto', exe, { filename: 'a.jpg', contentType: 'image/jpeg' });
        assert.equal(subida.status, 302);
        assert.match((await getHtml(agent, `/mascotas/${mid}`)).text, /JPG, PNG o WebP/);
        assert.equal(db.prepare('SELECT foto FROM mascotas WHERE id = ?').get(mid).foto, null);
    } finally { limpiar(); }
});

test('T-04 multipart: sin token (o con token falso) → 403 en las subidas; y un multipart a otra ruta no se salta el CSRF', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent);
        const ok = await crearMascota(agent, id);
        const mid = Number(/\/mascotas\/(\d+)/.exec(ok.headers.location)[1]);

        const sin = agent.post('/mascotas');
        for (const [k, v] of Object.entries(MASC(id, { nombre: 'Intruso' }))) sin.field(k, v);
        assert.equal((await sin).status, 403);
        const falso = agent.post('/mascotas').field('_csrf', 'x'.repeat(120)).field('propietario', String(id)).field('nombre', 'Intruso');
        assert.equal((await falso).status, 403);
        assert.equal((await agent.post(`/mascotas/${mid}/foto`).attach('foto', PNG, { filename: 'a.png', contentType: 'image/png' })).status, 403);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mascotas WHERE nombre = 'Intruso'").get().n, 0);

        // Rutas que no están en la lista de subidas: el multipart sigue exigiendo el token
        const otra = await agent.post(`/mascotas/${mid}/foto/quitar`).field('x', '1');
        assert.equal(otra.status, 403);
        const servicio = await agent.post('/ajustes/servicios/1/estado').field('accion', 'desactivar');
        assert.equal(servicio.status, 403);
        const sinSesion = await request(app).post('/mascotas').field('nombre', 'x');
        assert.ok([401, 403].includes(sinSesion.status));
    } finally { limpiar(); }
});

test('mascota: editar datos y estado desde la ficha; cambios en bitácora', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent);
        const ok = await crearMascota(agent, id);
        const url = ok.headers.location;
        const mal = await post(agent, url, url, { nombre: '', especie: 'Perro', sexo: 'macho', estado: 'activa' });
        assert.equal(mal.status, 400);
        assert.match(mal.text, /Este campo es obligatorio/);

        const r = await post(agent, url, url, { nombre: 'Firu', especie: 'Perro', sexo: 'macho', estado: 'fallecida', esterilizado: 'on' });
        assert.equal(r.status, 302);
        const m = db.prepare('SELECT * FROM mascotas').get();
        assert.deepEqual([m.nombre, m.estado, m.esterilizado], ['Firu', 'fallecida', 1]);
        assert.ok(db.prepare("SELECT 1 FROM bitacora WHERE accion = 'mascota_editada'").get());
        assert.match((await getHtml(agent, '/mascotas')).text, /Ninguna mascota coincide|Todavía no hay mascotas/, 'por defecto solo activas');
        assert.match((await getHtml(agent, '/mascotas?estado=todos')).text, /Firu/);
        assert.match((await getHtml(agent, '/mascotas?estado=fallecida')).text, /Fallecida/);
    } finally { limpiar(); }
});

test('transferencia por HTTP: se elige al nuevo dueño de una lista y el historial lo muestra', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const a = await crearCliente(agent);
        const b = await crearCliente(agent, { nombre: 'Carlos Ruiz', telefono: '8555 4444' });
        const ok = await crearMascota(agent, a);
        const mid = Number(/\/mascotas\/(\d+)/.exec(ok.headers.location)[1]);

        const elegir = await getHtml(agent, `/mascotas/${mid}/transferir`);
        assert.match(elegir.text, /Carlos Ruiz/);
        assert.doesNotMatch(elegir.text, /Laura Mendoza<\/strong>/, 'el dueño actual no aparece como opción');
        assert.match((await getHtml(agent, `/mascotas/${mid}/transferir?q=8555`)).text, /Carlos Ruiz/);

        const r = await post(agent, `/mascotas/${mid}/transferir`, `/mascotas/${mid}/transferir`, { propietario: String(b) });
        assert.equal(r.status, 302);
        assert.equal(r.headers.location, `/mascotas/${mid}`);
        assert.equal(db.prepare('SELECT propietario_id AS p FROM mascotas WHERE id = ?').get(mid).p, b);
        const ficha = await getHtml(agent, `/mascotas/${mid}`);
        assert.match(ficha.text, /Mascota transferida a Carlos Ruiz/);
        assert.match(ficha.text, /Laura Mendoza/, 'el dueño anterior queda en el historial');
        assert.match(ficha.text, /actual/);

        const mismo = await post(agent, `/mascotas/${mid}`, `/mascotas/${mid}/transferir`, { propietario: String(b) });
        assert.equal(mismo.status, 302);
        assert.match((await getHtml(agent, `/mascotas/${mid}/transferir`)).text, /ya pertenece/);
        const vacio = await post(agent, `/mascotas/${mid}`, `/mascotas/${mid}/transferir`, {});
        assert.equal(vacio.status, 302);
    } finally { limpiar(); }
});

test('T-21 búsqueda por HTTP: SQL y HTML en el buscador salen escapados y sin error', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const id = await crearCliente(agent, { nombre: '<script>alert(1)</script> Díaz' });
        await crearMascota(agent, id, { extra: { nombre: '<img src=x onerror=alert(1)>' } });
        for (const url of ['/clientes', '/mascotas?estado=todos']) {
            const html = (await getHtml(agent, url)).text;
            assert.doesNotMatch(html, /<script>alert\(1\)/);
            assert.doesNotMatch(html, /<img src=x/);
            assert.match(html, /&lt;/);
        }
        for (const q of ["'; DROP TABLE mascotas; --", '%', '<script>', '"><svg onload=alert(1)>']) {
            for (const base of ['/clientes?q=', '/mascotas?q=', '/mascotas/nueva?q=']) {
                const res = await getHtml(agent, base + encodeURIComponent(q));
                assert.equal(res.status, 200, `${base}${q}`);
                assert.doesNotMatch(res.text, /<svg onload/);
            }
        }
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mascotas').get().n, 1);
    } finally { limpiar(); }
});

test('paginación en pantalla: 30 clientes → página 2 con 5 y enlaces que conservan la búsqueda', async () => {
    const { app, db, limpiar } = await setup();
    try {
        const agent = await loginAs(app, 'rec1', CLAVE);
        const ins = db.prepare('INSERT INTO propietarios (nombre, telefono) VALUES (?, ?)');
        for (let i = 1; i <= 30; i += 1) ins.run(`Cliente ${String(i).padStart(2, '0')}`, `505881${String(10000 + i)}`);
        const p1 = (await getHtml(agent, '/clientes?q=Cliente')).text;
        assert.match(p1, /Página 1 de 2 · 30 registros/);
        assert.equal((p1.match(/class="record"/g) || []).length, 25);
        assert.match(p1, /href="\/clientes\?q=Cliente&amp;pagina=2"/);
        const p2 = (await getHtml(agent, '/clientes?q=Cliente&pagina=2')).text;
        assert.equal((p2.match(/class="record"/g) || []).length, 5);
    } finally { limpiar(); }
});
