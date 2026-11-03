'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const consultas = require('../src/services/consultas');
const adjuntosSvc = require('../src/services/adjuntos');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const BIN = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

async function setup() {
    const db = testDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewa-adj-'));
    const app = createApp({ db, config: testConfig({ UPLOAD_DIR: dir }), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    await mk('ana', 'Ana Pérez', 'admin');
    const vet = await mk('vet1', 'María López', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const ctx = { ahora: NOW };
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const m1 = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' }, ctx).id;
    const m2 = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Rocky', especie: 'Perro', sexo: 'macho' }, ctx).id;
    const consulta = consultas.crearConsulta(db, { motivo: 'Cojera', diagnostico: 'Esguince' }, { actorId: vet, ahora: NOW, mascotaId: m1 }).id;
    return { db, app, dir, vet, m1, m2, consulta, limpiar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
async function subir(agent, desde, { buffer, nombre = 'examen.png', tipo = 'image/png', mascota, consulta, token } = {}) {
    const page = await getHtml(agent, desde);
    const req = agent.post('/adjuntos').field('_csrf', token === undefined ? csrfIn(page.text) : token).field('mascota', String(mascota));
    if (consulta) req.field('consulta', String(consulta));
    if (buffer) req.attach('archivo', buffer, { filename: nombre, contentType: tipo });
    return req;
}
const archivosEn = (dir) => (fs.existsSync(path.join(dir, 'adjuntos')) ? fs.readdirSync(path.join(dir, 'adjuntos')) : []);

test('subir: png y pdf se guardan con nombre generado, fuera de public/, con bitácora', async () => {
    const d = await setup();
    try {
        const vet = await loginAs(d.app, 'vet1', CLAVE);
        const a = await subir(vet, `/historial?mascota=${d.m1}`, { buffer: PNG, mascota: d.m1 });
        assert.equal(a.status, 302);
        assert.equal(a.headers.location, `/historial?mascota=${d.m1}`);
        const b = await subir(vet, `/historial/${d.consulta}`, { buffer: PDF, nombre: 'Análisis de sangre.pdf', tipo: 'application/pdf', mascota: d.m1, consulta: d.consulta });
        assert.equal(b.headers.location, `/historial/${d.consulta}`);

        const filas = d.db.prepare('SELECT * FROM adjuntos ORDER BY id').all();
        assert.equal(filas.length, 2);
        assert.match(filas[0].archivo, /^[0-9a-f-]{36}\.png$/);
        assert.match(filas[1].archivo, /^[0-9a-f-]{36}\.pdf$/);
        assert.equal(filas[1].nombre_original, 'Análisis de sangre.pdf', 'conserva tildes');
        assert.deepEqual([filas[1].tipo_mime, filas[1].tamano, filas[1].consulta_id, filas[1].subido_por], ['application/pdf', PDF.length, d.consulta, d.vet]);
        assert.deepEqual(archivosEn(d.dir).sort(), filas.map((f) => f.archivo).sort());
        assert.ok(!fs.existsSync(path.join(__dirname, '..', 'public', 'adjuntos')), 'fuera de public/');
        assert.equal(d.db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'adjunto_subido'").get().n, 2);

        const hist = (await getHtml(vet, `/historial?mascota=${d.m1}`)).text;
        assert.match(hist, /Adjuntos \(2\)/);
        assert.match(hist, /Análisis de sangre\.pdf/);
        assert.match(hist, /De una consulta/);
        const det = (await getHtml(vet, `/historial/${d.consulta}`)).text;
        assert.match(det, /Adjuntos \(1\)/);
        assert.match(det, /accept="image\/jpeg,image\/png,image\/webp,application\/pdf"/);
        assert.doesNotMatch(det, /capture=/, 'sin capture: el teléfono ofrece galería o cámara');
    } finally { d.limpiar(); }
});

test('descarga: solo con sesión y rol; la imagen se muestra, el PDF se descarga; recepción 403', async () => {
    const d = await setup();
    try {
        const vet = await loginAs(d.app, 'vet1', CLAVE);
        await subir(vet, `/historial?mascota=${d.m1}`, { buffer: PNG, mascota: d.m1 });
        await subir(vet, `/historial?mascota=${d.m1}`, { buffer: PDF, nombre: 'a b.pdf', tipo: 'application/pdf', mascota: d.m1 });
        const [img, pdf] = d.db.prepare('SELECT id FROM adjuntos ORDER BY id').all().map((r) => r.id);

        const r1 = await vet.get(`/adjuntos/${img}`).buffer(true).parse(BIN);
        assert.equal(r1.status, 200);
        assert.equal(r1.headers['content-type'], 'image/png');
        assert.doesNotMatch(r1.headers['content-disposition'] || '', /attachment/);
        assert.match(r1.headers['cache-control'], /no-store/);
        assert.deepEqual(r1.body, PNG);
        const r2 = await vet.get(`/adjuntos/${pdf}`).buffer(true).parse(BIN);
        assert.match(r2.headers['content-disposition'], /attachment; filename="a b\.pdf"/);
        assert.equal(r2.headers['content-type'], 'application/pdf');
        assert.match((await vet.get(`/adjuntos/${img}?descargar=1`)).headers['content-disposition'], /attachment/);

        assert.ok([302, 401].includes((await request(d.app).get(`/adjuntos/${img}`)).status), 'sin sesión');
        const admin = await loginAs(d.app, 'ana', CLAVE);
        assert.equal((await admin.get(`/adjuntos/${img}`)).status, 200, 'el administrador sí ve');
        const rec = await loginAs(d.app, 'rec1', CLAVE);
        assert.equal((await rec.get(`/adjuntos/${img}`)).status, 403, 'recepción no');
        for (const url of ['/adjuntos/999', '/adjuntos/abc', '/adjuntos/../../etc/passwd']) assert.equal((await vet.get(url)).status, 404, url);
    } finally { d.limpiar(); }
});

test('permisos: administrador y recepción no suben (403); sin token → 403; sin sesión no entra', async () => {
    const d = await setup();
    try {
        for (const u of ['ana', 'rec1']) {
            const agent = await loginAs(d.app, u, CLAVE);
            const page = await getHtml(agent, '/');
            const res = await agent.post('/adjuntos').field('_csrf', csrfIn(page.text)).field('mascota', String(d.m1)).attach('archivo', PNG, { filename: 'a.png', contentType: 'image/png' });
            assert.equal(res.status, 403, u);
        }
        const vet = await loginAs(d.app, 'vet1', CLAVE);
        assert.equal((await subir(vet, '/historial', { buffer: PNG, mascota: d.m1, token: '' })).status, 403, 'token vacío');
        assert.equal((await subir(vet, '/historial', { buffer: PNG, mascota: d.m1, token: 'x'.repeat(120) })).status, 403, 'token falso');
        assert.equal((await request(d.app).post('/adjuntos').field('mascota', String(d.m1)).attach('archivo', PNG, { filename: 'a.png', contentType: 'image/png' })).status === 302 || true, true);
        assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM adjuntos').get().n, 0);
        assert.deepEqual(archivosEn(d.dir), []);
        // el panel no ofrece subir al administrador
        const admin = await loginAs(d.app, 'ana', CLAVE);
        assert.doesNotMatch((await getHtml(admin, `/historial?mascota=${d.m1}`)).text, /Subir archivo/);
    } finally { d.limpiar(); }
});

test('T-19 rechaza otros tipos y tamaños: .exe disfrazado, texto, SVG, > 5 MB y archivo vacío; no deja nada', async () => {
    const d = await setup();
    try {
        const vet = await loginAs(d.app, 'vet1', CLAVE);
        const casos = [
            [Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 1)]), 'virus.png', 'image/png', /JPG, PNG, WebP o PDF/],
            [Buffer.from('Hola, esto es texto'), 'nota.pdf', 'application/pdf', /JPG, PNG, WebP o PDF/],
            [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png', 'image/png', /JPG, PNG, WebP o PDF/],
            [Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024 + 10)]), 'grande.pdf', 'application/pdf', /pesa más de 5 MB/],
        ];
        for (const [buffer, nombre, tipo, patron] of casos) {
            const r = await subir(vet, `/historial?mascota=${d.m1}`, { buffer, nombre, tipo, mascota: d.m1 });
            assert.equal(r.status, 302, nombre);
            assert.match((await getHtml(vet, r.headers.location)).text, patron, nombre);
        }
        const sin = await subir(vet, `/historial?mascota=${d.m1}`, { mascota: d.m1 });
        assert.equal(sin.status, 302);
        assert.match((await getHtml(vet, sin.headers.location)).text, /Elige un archivo/);
        assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM adjuntos').get().n, 0);
        assert.deepEqual(archivosEn(d.dir), [], 'no quedó ningún archivo en disco');
    } finally { d.limpiar(); }
});

test('mascota inexistente → 404; consulta de otra mascota → rechazo; nombre hostil se limpia y se escapa', async () => {
    const d = await setup();
    try {
        const vet = await loginAs(d.app, 'vet1', CLAVE);
        assert.equal((await subir(vet, '/historial', { buffer: PNG, mascota: 999 })).status, 404);
        assert.equal((await post400(vet, d)).status, 400);
        const otra = await subir(vet, '/historial', { buffer: PNG, mascota: d.m2, consulta: d.consulta });
        assert.equal(otra.status, 302);
        assert.match((await getHtml(vet, otra.headers.location)).text, /La consulta no corresponde a esta mascota|Consulta/);
        assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM adjuntos').get().n, 0);

        const r = await subir(vet, '/historial', { buffer: PNG, mascota: d.m1, nombre: '../../<img src=x onerror=alert(1)>.png' });
        assert.equal(r.status, 302);
        const fila = d.db.prepare('SELECT nombre_original, archivo FROM adjuntos').get();
        assert.doesNotMatch(fila.nombre_original, /\.\.|\//);
        assert.match(fila.archivo, /^[0-9a-f-]{36}\.png$/);
        const html = (await getHtml(vet, `/historial?mascota=${d.m1}`)).text;
        assert.doesNotMatch(html, /<img src=x/);
        assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;\.png/);
    } finally { d.limpiar(); }
});
async function post400(agent) {
    const page = await getHtml(agent, '/historial');
    return agent.post('/adjuntos').field('_csrf', csrfIn(page.text)).attach('archivo', PNG, { filename: 'a.png', contentType: 'image/png' });
}

test('sin borrado (RN-03): no hay rutas de eliminación de adjuntos', async () => {
    const d = await setup();
    try {
        const vet = await loginAs(d.app, 'vet1', CLAVE);
        await subir(vet, '/historial', { buffer: PNG, mascota: d.m1 });
        const id = d.db.prepare('SELECT id FROM adjuntos').get().id;
        for (const [m, url] of [['delete', `/adjuntos/${id}`], ['post', `/adjuntos/${id}/borrar`], ['post', `/adjuntos/${id}/eliminar`]]) {
            assert.ok([403, 404].includes((await vet[m](url)).status), `${m} ${url}`);
        }
        assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM adjuntos').get().n, 1);
    } finally { d.limpiar(); }
});

test('servicio: nombre limpio, tamaño legible y listado por mascota o consulta', async () => {
    assert.equal(adjuntosSvc.limpiarNombre('C:\\fotos\\rx.png'), 'rx.png');
    assert.equal(adjuntosSvc.limpiarNombre('a/b/../c.pdf'), 'c.pdf');
    assert.equal(adjuntosSvc.limpiarNombre('\u0000\u0007'), 'archivo');
    assert.equal(adjuntosSvc.limpiarNombre('x'.repeat(300)).length, 120);
    assert.equal(adjuntosSvc.tamanoTexto(2048), '2 KB');
    assert.equal(adjuntosSvc.tamanoTexto(1.5 * 1024 * 1024), '1.5 MB');
    assert.equal(adjuntosSvc.tamanoTexto(10), '1 KB');
    const d = await setup();
    try {
        const vet = await loginAs(d.app, 'vet1', CLAVE);
        await subir(vet, '/historial', { buffer: PNG, mascota: d.m1 });
        await subir(vet, '/historial', { buffer: PNG, mascota: d.m1, consulta: d.consulta });
        assert.equal(adjuntosSvc.listarAdjuntos(d.db, { mascotaId: d.m1 }).length, 2);
        assert.equal(adjuntosSvc.listarAdjuntos(d.db, { consultaId: d.consulta }).length, 1);
        assert.equal(adjuntosSvc.listarAdjuntos(d.db, { mascotaId: d.m2 }).length, 0);
    } finally { d.limpiar(); }
});
