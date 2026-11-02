'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
// Lunes 2 de noviembre de 2026, 09:00 en Managua
const NOW = new Date('2026-11-02T15:00:00Z');

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol, atiende) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE, ...(atiende === undefined ? {} : { atiende_citas: atiende }) })).id;
    await mk('ana', 'Ana Pérez', 'admin');
    const vet = await mk('vet1', 'María López', 'veterinario');
    const groomer = await mk('gro', 'Gabriel Groomer', 'recepcion', true);
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const ctx = { ahora: NOW };
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const m = (nombre) => mascotas.createMascota(db, { propietario: String(dueno), nombre, especie: 'Perro', sexo: 'macho' }, ctx).id;
    const servicio = (n) => db.prepare('SELECT id FROM servicios WHERE nombre = ?').get(n).id;
    return { db, app, vet, groomer, m1: m('Firulais'), m2: m('Rocky'), consulta: servicio('Consulta general'), bano: servicio('Baño') };
}
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const FORM = (d, extra = {}) => ({ mascota: String(d.m1), responsable: String(d.vet), servicio: String(d.consulta), fecha: '2026-11-03', hora: '09:00', motivo: 'Revisión', ...extra });
const crear = (agent, d, extra) => post(agent, `/citas/nueva?mascota=${d.m1}`, '/citas', FORM(d, extra));
const idCita = (db) => db.prepare('SELECT MAX(id) AS id FROM citas').get().id;

test('citas: sin sesión → login; los tres roles ven la agenda; POST sin token → 403', async () => {
    const d = await setup();
    for (const url of ['/citas', '/citas/nueva', '/citas/1']) {
        const res = await request(d.app).get(url).set('Accept', 'text/html');
        assert.equal(res.status, 302, url);
    }
    for (const u of ['ana', 'vet1', 'rec1']) {
        const agent = await loginAs(d.app, u, CLAVE);
        assert.equal((await getHtml(agent, '/citas')).status, 200, u);
    }
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    for (const url of ['/citas', '/citas/1', '/citas/1/estado']) assert.equal((await agent.post(url).type('form').send({})).status, 403, url);
});

test('crear cita por formulario: elegir mascota → formulario con responsables que atienden → cita en la agenda del día', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    const elegir = await getHtml(agent, '/citas/nueva');
    assert.match(elegir.text, new RegExp(`href="/citas/nueva\\?mascota=${d.m1}"`));
    assert.match((await getHtml(agent, '/citas/nueva?q=rocky')).text, /Rocky/);

    const form = await getHtml(agent, `/citas/nueva?mascota=${d.m1}&fecha=2026-11-03`);
    assert.match(form.text, /value="2026-11-03"/);
    assert.match(form.text, /Gabriel Groomer/, 'el groomer con atiende_citas aparece como responsable');
    assert.doesNotMatch(form.text, /Rosa Díaz<\/option>/, 'recepción sin agenda no');
    assert.doesNotMatch(form.text, /Ana Pérez<\/option>/);

    const res = await crear(agent, d);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/citas?fecha=2026-11-03');
    const agenda = await getHtml(agent, res.headers.location);
    assert.match(agenda.text, /Cita creada\./);
    assert.match(agenda.text, /9:00 AM/);
    assert.match(agenda.text, /Firulais/);
    assert.match(agenda.text, /Programada/);
    assert.match(agenda.text, /Pendientes de confirmar/);
});

test('T-05/T-07 por HTTP: el traslape se rechaza con mensaje y el borde exacto se permite', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await crear(agent, d);
    const choque = await crear(agent, d, { hora: '09:15', mascota: String(d.m2) });
    assert.equal(choque.status, 400);
    assert.match(choque.text, /ya tiene una cita de 9:00 AM a 9:30 AM/);
    assert.match(choque.text, /value="09:15"/, 'conserva lo escrito');
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM citas').get().n, 1);
    assert.equal((await crear(agent, d, { hora: '09:30' })).status, 302);
});

test('T-22 por HTTP: fecha pasada y fuera de horario muestran el aviso y se guardan solo al confirmar', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    const aviso = await crear(agent, d, { fecha: '2026-11-02', hora: '07:00' });
    assert.equal(aviso.status, 400);
    assert.match(aviso.text, /ya pasaron/);
    assert.match(aviso.text, /fuera del horario laboral/);
    assert.match(aviso.text, /name="confirmar"/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM citas').get().n, 0);
    assert.equal((await crear(agent, d, { fecha: '2026-11-02', hora: '07:00', confirmar: 'on' })).status, 302);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM citas').get().n, 1);
});

test('T-06 por HTTP: cancelar con el botón libera el horario y deja bitácora', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await crear(agent, d);
    const id = idCita(d.db);
    const agenda = await getHtml(agent, '/citas?fecha=2026-11-03');
    assert.match(agenda.text, new RegExp(`action="/citas/${id}/estado"`));
    assert.match(agenda.text, />Confirmar</);
    assert.match(agenda.text, />Cancelar</);

    const r = await post(agent, '/citas?fecha=2026-11-03', `/citas/${id}/estado`, { estado: 'cancelada', volver: '/citas?fecha=2026-11-03' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/citas?fecha=2026-11-03');
    assert.match((await getHtml(agent, r.headers.location)).text, /Cita marcada como cancelada/);
    assert.ok(d.db.prepare("SELECT 1 FROM bitacora WHERE accion = 'cita_estado'").get());
    assert.equal((await crear(agent, d)).status, 302, 'el horario quedó libre');
    // una cita final ya no ofrece acciones ni se puede cambiar
    const otra = await post(agent, '/citas', `/citas/${id}/estado`, { estado: 'confirmada' });
    assert.equal(otra.status, 302);
    assert.match((await getHtml(agent, otra.headers.location)).text, /no puede pasar a confirmada/);
});

test('el regreso tras cambiar el estado solo acepta rutas internas de /citas (sin redirección abierta)', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await crear(agent, d);
    const id = idCita(d.db);
    for (const volver of ['//evil.example', 'https://evil.example', '/ajustes', '/citas/../ajustes']) {
        const r = await post(agent, '/citas', `/citas/${id}/estado`, { estado: 'confirmada', volver });
        assert.equal(r.headers.location, `/citas/${id}`, volver);
    }
    assert.equal((await post(agent, '/citas', '/citas/999/estado', { estado: 'confirmada' })).status, 404);
});

test('agenda: vista de día y de semana, filtro por responsable y grooming; el día usa la hora de Managua', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await crear(agent, d, { hora: '09:00' });
    await crear(agent, d, { responsable: String(d.groomer), servicio: String(d.bano), hora: '10:00', mascota: String(d.m2) });
    await crear(agent, d, { fecha: '2026-11-05', hora: '14:00', motivo: 'Jueves' });
    await crear(agent, d, { hora: '20:30', confirmar: 'on', motivo: 'Noche' }); // 20:30 Managua = 02:30 UTC del día 4

    const agendaDe = async (url) => (await getHtml(agent, url)).text.split('Pendientes de confirmar')[0]; // solo la agenda, sin las listas de abajo
    const dia = await agendaDe('/citas?fecha=2026-11-03');
    assert.equal((dia.match(/class="record cita"/g) || []).length >= 3, true);
    assert.match(dia, /Noche/, 'la cita de las 8:30 PM pertenece al día 3');
    assert.doesNotMatch(dia, /Jueves/);

    const semana = (await getHtml(agent, '/citas?vista=semana&fecha=2026-11-04')).text;
    assert.match(semana, /Semana del lun, 2 nov al dom, 8 nov/);
    assert.match(semana, /class="semana"/);
    assert.equal((semana.match(/class="agenda-dia/g) || []).length, 7);
    assert.match(semana, /Firulais/);

    const soloGroomer = await agendaDe(`/citas?fecha=2026-11-03&responsable=${d.groomer}`);
    assert.match(soloGroomer, /Rocky/);
    assert.doesNotMatch(soloGroomer, /Noche/);
    const grooming = await agendaDe('/citas?fecha=2026-11-03&tipo=grooming');
    assert.match(grooming, /Rocky/);
    assert.match(grooming, /GROOMING/);
    assert.doesNotMatch(grooming, /Revisión<\/span>.*Noche/s);
    const porMascota = (await getHtml(agent, `/citas?fecha=2026-11-03&mascota=${d.m2}`)).text;
    assert.match(porMascota, /Mostrando solo las citas de <strong>Rocky/);
    // fecha inválida cae en hoy sin romper
    assert.equal((await getHtml(agent, '/citas?fecha=basura&vista=xx&responsable=abc')).status, 200);
});

test('listas: próximas y pendientes de confirmar (la confirmada sale de pendientes)', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    await crear(agent, d);
    const id = idCita(d.db);
    const antes = (await getHtml(agent, '/citas')).text;
    assert.doesNotMatch(antes, /No hay citas pendientes de confirmar/);
    await post(agent, '/citas', `/citas/${id}/estado`, { estado: 'confirmada' });
    const despues = (await getHtml(agent, '/citas')).text;
    assert.match(despues, /No hay citas pendientes de confirmar/);
    assert.doesNotMatch(despues, /No hay citas próximas/);
});

test('detalle: reprogramar, aviso de traslape, cita final no editable, 404 y XSS escapado', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'vet1', CLAVE);
    await crear(agent, d, { motivo: '<script>alert(1)</script>' });
    const id = idCita(d.db);
    const det = await getHtml(agent, `/citas/${id}`);
    assert.equal(det.status, 200);
    assert.doesNotMatch(det.text, /<script>alert\(1\)/);
    assert.match(det.text, /&lt;script&gt;/);
    assert.match(det.text, /Reprogramar o corregir/);

    const mover = await post(agent, `/citas/${id}`, `/citas/${id}`, FORM(d, { hora: '11:00', motivo: 'Revisión' }));
    assert.equal(mover.status, 302);
    assert.match((await getHtml(agent, `/citas/${id}`)).text, /11:00 AM – 11:30 AM/);
    await crear(agent, d, { hora: '14:00', mascota: String(d.m2) });
    const choque = await post(agent, `/citas/${id}`, `/citas/${id}`, FORM(d, { hora: '14:00' }));
    assert.equal(choque.status, 400);
    assert.match(choque.text, /ya tiene una cita de 2:00 PM/);

    await post(agent, `/citas/${id}`, `/citas/${id}/estado`, { estado: 'atendida' });
    const final = await getHtml(agent, `/citas/${id}`);
    assert.match(final.text, /Cita terminada/);
    assert.doesNotMatch(final.text, /Reprogramar o corregir/);
    const intento = await post(agent, `/citas/${id}`, `/citas/${id}`, FORM(d, { hora: '15:00' }));
    assert.equal(intento.status, 302);
    assert.match((await getHtml(agent, `/citas/${id}`)).text, /ya terminó/);
    for (const url of ['/citas/abc', '/citas/999']) assert.equal((await getHtml(agent, url)).status, 404, url);
});

test('POST /citas con mascota inválida → 400 y la ficha de la mascota enlaza a sus citas', async () => {
    const d = await setup();
    const agent = await loginAs(d.app, 'rec1', CLAVE);
    assert.equal((await post(agent, '/citas/nueva', '/citas', FORM(d, { mascota: '999' }))).status, 400);
    assert.equal((await post(agent, '/citas/nueva', '/citas', FORM(d, { mascota: '' }))).status, 400);
    const ficha = await getHtml(agent, `/mascotas/${d.m1}`);
    assert.match(ficha.text, new RegExp(`href="/citas\\?mascota=${d.m1}"`));
});
