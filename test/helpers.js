'use strict';
const request = require('supertest');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { buildConfig } = require('../src/config');

/** BD en memoria con todas las migraciones aplicadas. */
function testDb() {
    const db = openDb(':memory:');
    migrate(db);
    return db;
}

function testConfig(extra = {}) {
    return buildConfig({ NODE_ENV: 'test', DB_PATH: ':memory:', ...extra });
}

/** Datos mínimos ficticios para probar relaciones. */
function seedBasics(db) {
    const u = db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol, atiende_citas) VALUES ('Vet Prueba','vet','x','veterinario',1)").run();
    const p = db.prepare("INSERT INTO propietarios (nombre, cedula, telefono) VALUES ('Cliente Prueba','001-010101-0001A','50588887777')").run();
    const m = db.prepare("INSERT INTO mascotas (numero_expediente, propietario_id, nombre, especie) VALUES ('EXP-000001',?,'Firulais','Perro')").run(p.lastInsertRowid);
    return { usuarioId: Number(u.lastInsertRowid), propietarioId: Number(p.lastInsertRowid), mascotaId: Number(m.lastInsertRowid) };
}

/** Token CSRF que aparece en el primer formulario de una página HTML. */
const csrfIn = (html) => (/name="_csrf" value="([A-Za-z0-9_-]{100,})"/.exec(html) || [])[1];

/** Inicia sesión de verdad (formulario + CSRF) y devuelve el agente con su cookie. */
async function loginAs(app, usuario, password) {
    const agent = request.agent(app);
    const page = await agent.get('/login');
    const res = await agent.post('/login').type('form').send({ _csrf: csrfIn(page.text), usuario, password });
    if (res.status !== 302) throw new Error(`No se pudo iniciar sesión como ${usuario}: ${res.status}`);
    return agent;
}

/** GET de una página HTML (con el token CSRF ya dentro) para usarla en el siguiente POST. */
const getHtml = (agent, url) => agent.get(url).set('Accept', 'text/html');

module.exports = { testDb, testConfig, seedBasics, csrfIn, loginAs, getHtml };
