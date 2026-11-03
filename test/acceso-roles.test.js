'use strict';
// ISS-19: enlaces directos a pantallas ajenas (matriz rol × pantalla). Sin sesión → login; con rol equivocado → 403.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const { testDb, testConfig, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');
const TODOS = ['ana', 'vet1', 'rec1'];
const ROL = { ana: 'admin', vet1: 'veterinario', rec1: 'recepcion' };

// Pantalla (GET) → usuarios que pueden verla. Los demás deben recibir 403.
const MATRIZ = {
    '/': TODOS, '/citas': TODOS, '/citas/nueva': TODOS, '/citas/1': TODOS,
    '/clientes': TODOS, '/clientes/1': TODOS, '/mascotas': TODOS, '/mascotas/nueva': TODOS, '/mascotas/1': TODOS,
    '/farmacia': TODOS, '/farmacia/1': TODOS, '/ventas': TODOS, '/ventas/nueva': TODOS, '/ventas/1': TODOS, '/ventas/1/recibo': TODOS,
    '/recordatorios': TODOS,
    '/historial': ['ana', 'vet1'], '/historial/1': ['ana', 'vet1'], '/historial/1/receta': ['ana', 'vet1'], '/historial/carne/1': ['ana', 'vet1'], '/adjuntos/1': ['ana', 'vet1'],
    '/historial/nueva': ['vet1'],
    '/reportes': ['ana', 'vet1'], '/reportes/citas': ['ana', 'vet1'], '/reportes/citas.csv': ['ana', 'vet1'], '/reportes/stock': ['ana', 'vet1'], '/reportes/stock.csv': ['ana', 'vet1'],
    '/reportes/ventas': ['ana'], '/reportes/ventas.csv': ['ana'],
    '/ajustes': ['ana'], '/ajustes/usuarios': ['ana'], '/ajustes/usuarios/1/editar': ['ana'], '/ajustes/servicios': ['ana'], '/ajustes/servicios/1/editar': ['ana'], '/ajustes/bitacora': ['ana'],
};

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    for (const [usuario, rol] of [['ana', 'admin'], ['vet1', 'veterinario'], ['rec1', 'recepcion']]) {
        await users.createUser(db, { usuario, nombre: `Usuario ${usuario}`, rol, password: CLAVE, password2: CLAVE });
    }
    return { db, app };
}

test('sin sesión, toda pantalla de la matriz lleva al login', async () => {
    const { app } = await setup();
    for (const url of Object.keys(MATRIZ)) {
        const res = await request(app).get(url).set('Accept', 'text/html');
        assert.equal(res.status, 302, url);
        assert.match(res.headers.location, /^\/login/, url);
    }
});

test('enlace directo a una pantalla ajena → 403; con el rol correcto nunca 403 ni login', async () => {
    const { app } = await setup();
    for (const u of TODOS) {
        const agent = await loginAs(app, u, CLAVE);
        for (const [url, permitidos] of Object.entries(MATRIZ)) {
            const res = await getHtml(agent, url);
            if (permitidos.includes(u)) assert.ok(![302, 401, 403].includes(res.status) || (res.status === 302 && !/login/.test(res.headers.location)), `${ROL[u]} debe poder abrir ${url} (dio ${res.status})`);
            else assert.equal(res.status, 403, `${ROL[u]} no debe abrir ${url}`);
        }
    }
});

test('el 403 es genérico: no filtra rutas, SQL ni trazas', async () => {
    const { app } = await setup();
    const rec = await loginAs(app, 'rec1', CLAVE);
    const res = await getHtml(rec, '/ajustes/usuarios');
    assert.equal(res.status, 403);
    assert.doesNotMatch(res.text, /at \w+ \(|node_modules|SELECT |Error:/);
});
