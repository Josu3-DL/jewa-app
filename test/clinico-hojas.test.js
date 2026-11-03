'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const consultas = require('../src/services/consultas');
const { saveSettings } = require('../src/services/settings');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol, extra = {}) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE, ...extra })).id;
    await mk('ana', 'Ana Pérez', 'admin');
    const vet = await mk('vet1', 'María López', 'veterinario', { colegiado: 'CMV-1234' });
    await mk('vet2', 'Pedro Gómez', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const ctx = { ahora: NOW };
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const m = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' }, ctx).id;
    const consulta = consultas.crearConsulta(db, { motivo: 'Control', diagnostico: 'Otitis leve' }, { actorId: vet, ahora: NOW, mascotaId: m }).id;
    const rabia = db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-001'").get().id;
    return { db, app, vet, m, consulta, rabia };
}
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const TRAT = (extra = {}) => ({ medicamento_texto: 'Amoxicilina 250 mg', dosis: '1 tableta', frecuencia: 'Cada 12 horas', duracion_dias: '7', ...extra });
const VAC = (d, extra = {}) => ({ producto: String(d.rabia), fecha: '2026-11-02', proxima_dosis: '2027-11-02', ...extra });

test('permisos: solo el veterinario agrega tratamientos y vacunas; administrador y recepción 403; sin token 403', async () => {
    const d = await setup();
    for (const u of ['ana', 'rec1']) {
        const agent = await loginAs(d.app, u, CLAVE);
        for (const url of [`/historial/${d.consulta}/tratamientos`, `/historial/${d.consulta}/vacunas`]) {
            assert.equal((await post(agent, '/', url, TRAT())).status, 403, `${u} ${url}`);
        }
    }
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    assert.equal((await vet.post(`/historial/${d.consulta}/tratamientos`).type('form').send(TRAT())).status, 403, 'sin token');
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM tratamientos').get().n, 0);
    const admin = await loginAs(d.app, 'ana', CLAVE);
    const det = (await getHtml(admin, `/historial/${d.consulta}`)).text;
    assert.doesNotMatch(det, /Agregar tratamiento|Registrar vacuna/, 'el administrador no ve los formularios clínicos');
});

test('tratamiento por formulario: se agrega, se lista y los errores se muestran bajo el campo', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const url = `/historial/${d.consulta}`;
    const mal = await post(vet, url, `${url}/tratamientos`, { medicamento_texto: '', dosis: '', frecuencia: '', duracion_dias: '0' });
    assert.equal(mal.status, 400);
    assert.match(mal.text, /Elige un medicamento del catálogo o escribe su nombre/);
    assert.match(mal.text, /Mínimo 1 día/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM tratamientos').get().n, 0);

    const ok = await post(vet, url, `${url}/tratamientos`, TRAT({ indicaciones: 'Con comida' }));
    assert.equal(ok.status, 302);
    const det = (await getHtml(vet, url)).text;
    assert.match(det, /Tratamiento agregado/);
    assert.match(det, /Tratamientos \(1\)/);
    assert.match(det, /Amoxicilina 250 mg/);
    assert.match(det, /Imprimir receta/);
});

test('T-14 vacuna por formulario: sin próxima dosis se rechaza; con datos válidos aparece en la consulta y en el historial', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const url = `/historial/${d.consulta}`;
    const mal = await post(vet, url, `${url}/vacunas`, VAC(d, { proxima_dosis: '' }));
    assert.equal(mal.status, 400);
    assert.match(mal.text, /Este campo es obligatorio/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM vacunas_aplicadas').get().n, 0);
    assert.match((await post(vet, url, `${url}/vacunas`, VAC(d, { fecha: '2026-12-01' }))).text, /no puede ser futura/);

    const ok = await post(vet, url, `${url}/vacunas`, VAC(d));
    assert.equal(ok.status, 302);
    const det = (await getHtml(vet, url)).text;
    assert.match(det, /Vacuna registrada/);
    assert.match(det, /Vacuna antirrábica · Lote UNICO/);
    assert.match(det, /Próxima dosis: 02\/11\/2027/);
    assert.match(det, /Vacunas \(1\)/);
    const hist = (await getHtml(vet, `/historial?mascota=${d.m}`)).text;
    assert.match(hist, /Vacuna antirrábica/);
    assert.match(hist, new RegExp(`href="/historial/carne/${d.m}"`));
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n, 0, 'no se mueve stock');
});

test('anular vacuna: motivo obligatorio, solo el autor o el administrador, y queda marcada', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const url = `/historial/${d.consulta}`;
    await post(vet, url, `${url}/vacunas`, VAC(d));
    const vid = d.db.prepare('SELECT id FROM vacunas_aplicadas').get().id;

    const otro = await loginAs(d.app, 'vet2', CLAVE);
    assert.equal((await post(otro, url, `/historial/vacunas/${vid}/anular`, { motivo: 'No es mía', consulta: String(d.consulta) })).status, 403);
    assert.doesNotMatch((await getHtml(otro, url)).text, /Anular vacuna/);

    const sin = await post(vet, url, `/historial/vacunas/${vid}/anular`, { motivo: '', consulta: String(d.consulta) });
    assert.equal(sin.status, 302);
    assert.match((await getHtml(vet, sin.headers.location)).text, /Para anular la vacuna: Este campo es obligatorio/);
    assert.equal(d.db.prepare('SELECT estado FROM vacunas_aplicadas').get().estado, 'vigente');

    const ok = await post(vet, url, `/historial/vacunas/${vid}/anular`, { motivo: 'Registrada por error', consulta: String(d.consulta) });
    assert.equal(ok.headers.location, url);
    const det = (await getHtml(vet, url)).text;
    assert.match(det, /Anulada: Registrada por error/);
    assert.equal((await post(vet, url, '/historial/vacunas/999/anular', { motivo: 'Cualquier cosa' })).status, 404);
    // la anulada no sale en el carné
    const carne = (await getHtml(vet, `/historial/carne/${d.m}`)).text;
    assert.match(carne, /todavía no tiene vacunas registradas/);
});

test('consulta anulada: ya no ofrece formularios y rechaza tratamientos y vacunas', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const url = `/historial/${d.consulta}`;
    await post(vet, url, `${url}/anular`, { motivo: 'Mascota equivocada' });
    const det = (await getHtml(vet, url)).text;
    assert.doesNotMatch(det, /Agregar tratamiento|Registrar vacuna/);
    const r = await post(vet, url, `${url}/tratamientos`, TRAT());
    assert.equal(r.status, 302);
    assert.match((await getHtml(vet, url)).text, /La consulta está anulada/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM tratamientos').get().n, 0);
});

test('receta imprimible: hoja sin barra lateral con clínica, paciente, propietario, veterinario y colegiado', async () => {
    const d = await setup();
    saveSettings(d.db, { nombre: 'Clínica Huellitas', telefono: '8888 7777', direccion: 'Managua, Altamira', moneda: 'NIO', iva: '0', duracionCitaMin: '30', lunes_abierto: 'on', lunes_abre: '08:00', lunes_cierra: '17:00' }, {});
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const url = `/historial/${d.consulta}`;
    const sin = await getHtml(vet, `${url}/receta`);
    assert.equal(sin.status, 302, 'sin tratamientos no hay receta');
    assert.match((await getHtml(vet, url)).text, /no tiene tratamientos/);

    await post(vet, url, `${url}/tratamientos`, TRAT({ indicaciones: 'Con comida' }));
    const res = await getHtml(vet, `${url}/receta`);
    assert.equal(res.status, 200);
    for (const texto of [/Clínica Huellitas/, /Managua, Altamira/, /Receta médica veterinaria/, /Firulais/, /Laura Mendoza/, /Otitis leve/, /Amoxicilina 250 mg/, /Cada 12 horas/, /7 días/, /Con comida/, /María López/, /Colegiado CMV-1234/, /02\/11\/2026/]) {
        assert.match(res.text, texto);
    }
    assert.doesNotMatch(res.text, /class="sidebar"|class="topbar"/, 'sin barra lateral ni superior');
    assert.match(res.text, /<button class="button" type="button" data-print>/);
    assert.match(res.text, /class="hoja-barra no-print"/, 'los botones no se imprimen');
    assert.equal((await getHtml(vet, '/historial/999/receta')).status, 404);
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    assert.equal((await getHtml(rec, `${url}/receta`)).status, 403);
    const admin = await loginAs(d.app, 'ana', CLAVE);
    assert.equal((await getHtml(admin, `${url}/receta`)).status, 200, 'el administrador puede verla');
});

test('carné de vacunación: lista las vacunas vigentes con lote y próxima dosis; recepción 403; sin sesión → login', async () => {
    const d = await setup();
    const vet = await loginAs(d.app, 'vet1', CLAVE);
    const url = `/historial/${d.consulta}`;
    await post(vet, url, `${url}/vacunas`, VAC(d));
    await post(vet, url, `${url}/vacunas`, VAC(d, { producto: String(d.db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-003'").get().id), proxima_dosis: '2027-01-15' }));
    const res = await getHtml(vet, `/historial/carne/${d.m}`);
    assert.equal(res.status, 200);
    for (const t of [/Carné de vacunación/, /Firulais/, /Exp\. EXP-000001/, /Laura Mendoza/, /Vacuna antirrábica/, /Vacuna triple felina/, /UNICO/, /02\/11\/2027/, /15\/01\/2027/, /María López/]) assert.match(res.text, t);
    assert.doesNotMatch(res.text, /class="sidebar"/);
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    assert.equal((await getHtml(rec, `/historial/carne/${d.m}`)).status, 403);
    assert.equal((await request(d.app).get(`/historial/carne/${d.m}`).set('Accept', 'text/html')).status, 302);
    assert.equal((await getHtml(vet, '/historial/carne/999')).status, 404);
});

test('el botón Imprimir funciona sin scripts en línea (app.js)', async () => {
    const d = await setup();
    const js = await request(d.app).get('/js/app.js');
    assert.match(js.text, /\[data-print\]/);
    assert.match(js.text, /window\.print\(\)/);
});
