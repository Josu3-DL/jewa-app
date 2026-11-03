'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const citas = require('../src/services/citas');
const consultas = require('../src/services/consultas');
const vacunas = require('../src/services/vacunas');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z'); // lunes 9:00 AM en Managua

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    await mk('ana', 'Ana Pérez', 'admin');
    const vet = await mk('vet1', 'María López', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const ctx = { ahora: NOW };
    const laura = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const pedro = propietarios.createPropietario(db, { nombre: 'Pedro Sin Aviso', telefono: '8555 4444' }, ctx).id;
    const mk2 = (dueno, nombre) => mascotas.createMascota(db, { propietario: String(dueno), nombre, especie: 'Perro', sexo: 'macho' }, ctx).id;
    return { db, app, vet, laura, pedro, firulais: mk2(laura, 'Firulais'), rocky: mk2(pedro, 'Rocky') };
}
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const cita = (d, mascota, hora = '08:30') => citas.crearCita(d.db, { mascota: String(mascota), responsable: String(d.vet), fecha: '2026-11-03', hora, confirmar: 'on' }, { ahora: NOW }).id;
const vacuna = (d, mascota, proxima) => {
    const c = consultas.crearConsulta(d.db, { motivo: 'Vacunación', diagnostico: 'Sano' }, { actorId: d.vet, ahora: NOW, mascotaId: mascota }).id;
    const prod = d.db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-001'").get().id;
    return vacunas.registrarVacuna(d.db, c, { producto: String(prod), fecha: '2025-11-05', proxima_dosis: proxima }, { actorId: d.vet, ahora: NOW }).id;
};

test('acceso: sin sesión → login; los tres roles ven la lista; marcar sin token → 403', async () => {
    const d = await setup();
    assert.equal((await request(d.app).get('/recordatorios').set('Accept', 'text/html')).status, 302);
    for (const u of ['ana', 'vet1', 'rec1']) assert.equal((await getHtml(await loginAs(d.app, u, CLAVE), '/recordatorios')).status, 200, u);
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    assert.equal((await rec.post('/recordatorios/enviado').type('form').send({ tipo: 'cita', id: '1' })).status, 403);
    assert.doesNotMatch((await getHtml(rec, '/recordatorios')).text, /Próximamente|en construcción/i);
});

test('lista: cita y vacuna con mensaje prellenado, enlace de WhatsApp seguro y conteo de pendientes', async () => {
    const d = await setup();
    cita(d, d.firulais);
    vacuna(d, d.firulais, '2026-10-20');
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    const html = (await getHtml(rec, '/recordatorios')).text;
    assert.match(html, /2 pendientes por enviar/);
    assert.match(html, /Cita: 03\/11\/2026 a las 8:30 AM · Tel\. 8888 7777/);
    assert.match(html, /Hola Laura Mendoza, le recordamos la cita de Firulais en JEWA/);
    assert.match(html, /Vacuna antirrábica: próxima dosis 20\/10\/2026/);
    assert.match(html, /Vencida/);
    const links = [...html.matchAll(/href="(https:\/\/wa\.me\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    assert.equal(links.length, 2);
    for (const l of links) assert.match(l, /^https:\/\/wa\.me\/50588887777\?text=[A-Za-z0-9%._~()*!'-]+$/, 'solo texto codificado');
    assert.match(html, /target="_blank" rel="noopener noreferrer"/);
    assert.match(html, /href="\/mascotas\/\d+">Firulais/);
});

test('T-17 en pantalla: el cliente sin consentimiento no aparece y se avisa cuántos se omitieron', async () => {
    const d = await setup();
    cita(d, d.rocky);
    vacuna(d, d.rocky, '2026-10-20');
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    const html = (await getHtml(rec, '/recordatorios')).text;
    assert.doesNotMatch(html, /Pedro Sin Aviso|Rocky|8555 4444|wa\.me/);
    assert.match(html, /2 recordatorios no se muestran porque el cliente no aceptó recibir avisos/);
    assert.match(html, /0 pendientes por enviar/);
    assert.match(html, /No hay citas en las próximas 24 horas/);
    // el POST tampoco deja marcarlos
    const id = d.db.prepare('SELECT id FROM citas').get().id;
    const r = await post(rec, '/recordatorios', '/recordatorios/enviado', { tipo: 'cita', id: String(id) });
    assert.match((await getHtml(rec, r.headers.location)).text, /ya no está en la lista/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM notificaciones').get().n, 0);
});

test('marcar enviado: queda guardado con quién lo envió, deja de ofrecer los botones y no se duplica', async () => {
    const d = await setup();
    const id = cita(d, d.firulais);
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    const r = await post(rec, '/recordatorios', '/recordatorios/enviado', { tipo: 'cita', id: String(id) });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/recordatorios');
    const html = (await getHtml(rec, '/recordatorios')).text;
    assert.match(html, /Recordatorio marcado como enviado/);
    assert.match(html, /0 pendientes por enviar/);
    assert.match(html, /Enviado por Rosa Díaz, 02\/11\/2026 09:00/);
    assert.doesNotMatch(html, /wa\.me/, 'ya enviado: sin botón de WhatsApp');
    const fila = d.db.prepare('SELECT estado, canal, enviada_por FROM notificaciones').get();
    assert.deepEqual([fila.estado, fila.canal], ['enviada_manual', 'whatsapp']);
    const otra = await post(rec, '/recordatorios', '/recordatorios/enviado', { tipo: 'cita', id: String(id) });
    assert.match((await getHtml(rec, otra.headers.location)).text, /ya estaba marcado como enviado/);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM notificaciones').get().n, 1);
    assert.match((await getHtml(await loginAs(d.app, 'ana', CLAVE), '/ajustes/bitacora?entidad=recordatorio')).text, /Recordatorio marcado como enviado/);
});

test('entradas inválidas al marcar (tipo, id, texto hostil) no rompen nada', async () => {
    const d = await setup();
    const rec = await loginAs(d.app, 'rec1', CLAVE);
    for (const body of [{}, { tipo: 'correo', id: '1' }, { tipo: 'cita', id: 'abc' }, { tipo: "cita'; DROP TABLE citas;--", id: '1' }, { tipo: 'vacuna', id: '-5' }]) {
        const r = await post(rec, '/recordatorios', '/recordatorios/enviado', body);
        assert.equal(r.status, 302, JSON.stringify(body));
        assert.match((await getHtml(rec, r.headers.location)).text, /no válido|ya no está en la lista/);
    }
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM notificaciones').get().n, 0);
});

test('XSS: nombres de cliente y mascota se escapan en la lista y en el mensaje', async () => {
    const d = await setup();
    d.db.prepare("UPDATE propietarios SET nombre = '<img src=x onerror=alert(1)>' WHERE id = ?").run(d.laura);
    d.db.prepare("UPDATE mascotas SET nombre = '<script>alert(2)</script>' WHERE id = ?").run(d.firulais);
    cita(d, d.firulais);
    const html = (await getHtml(await loginAs(d.app, 'rec1', CLAVE), '/recordatorios')).text;
    assert.doesNotMatch(html, /<img src=x|<script>alert\(2\)/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
