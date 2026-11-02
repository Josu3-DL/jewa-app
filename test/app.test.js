'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../src/app');
const { HttpError, notFound, errorHandler } = require('../src/middleware/errors');
const { testDb, testConfig } = require('./helpers');

const USER = () => ({ id: 1, nombre: 'Prueba', usuario: 'prueba', rol: 'admin' });
const makeApp = () => createApp({ db: testDb(), config: testConfig(), resolveUser: USER });

async function silenceErrors(fn) {
    const original = console.error;
    console.error = () => {};
    try {
        return await fn();
    } finally {
        console.error = original;
    }
}

function appWithRoutes(routes) {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '..', 'src', 'views'));
    routes(app);
    app.use(notFound);
    app.use(errorHandler(testConfig()));
    return app;
}

test('/salud responde 200 sin datos sensibles', async () => {
    const res = await request(makeApp()).get('/salud');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { estado: 'ok' });
});

test('/salud responde 503 si la BD no está disponible', async () => {
    const db = testDb();
    db.close();
    const app = createApp({ db, config: testConfig(), resolveUser: USER });
    const res = await silenceErrors(() => request(app).get('/salud'));
    assert.equal(res.status, 503);
});

test('404 en HTML con mensaje en español', async () => {
    const res = await request(makeApp()).get('/no-existe').set('Accept', 'text/html');
    assert.equal(res.status, 404);
    assert.match(res.text, /Página no encontrada/);
});

test('404 en JSON para clientes de API', async () => {
    const res = await request(makeApp()).get('/api/no-existe').set('Accept', 'application/json');
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
});

test('los estilos se sirven desde /css', async () => {
    const res = await request(makeApp()).get('/css/styles.css');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /css/);
});

test('no revela la tecnología del servidor', async () => {
    const res = await request(makeApp()).get('/salud');
    assert.equal(res.headers['x-powered-by'], undefined);
});

test('un error inesperado devuelve 500 sin trazas ni detalles', async () => {
    const app = appWithRoutes((a) => a.get('/boom', () => { throw new Error('detalle secreto en C:/datos'); }));
    const res = await silenceErrors(() => request(app).get('/boom').set('Accept', 'text/html'));
    assert.equal(res.status, 500);
    assert.doesNotMatch(res.text, /detalle secreto|C:\/datos/);
    assert.match(res.text, /Algo salió mal/);
});

test('HttpError 403 muestra "Acceso denegado"', async () => {
    const app = appWithRoutes((a) => a.get('/privado', () => { throw new HttpError(403); }));
    const res = await request(app).get('/privado').set('Accept', 'text/html');
    assert.equal(res.status, 403);
    assert.match(res.text, /Acceso denegado/);
});

test('el mensaje del error se escapa (XSS)', async () => {
    const app = appWithRoutes((a) => a.get('/x', () => { throw new HttpError(400, '<script>alert(1)</script>'); }));
    const res = await request(app).get('/x').set('Accept', 'text/html');
    assert.equal(res.status, 400);
    assert.doesNotMatch(res.text, /<script>alert/);
});
