'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConfig } = require('../src/config');

test('valores por defecto en desarrollo', () => {
    const c = buildConfig({});
    assert.equal(c.port, 3000);
    assert.equal(c.host, '0.0.0.0');
    assert.equal(c.cookieSecure, false);
    assert.equal(c.isProduction, false);
});

test('producción exige SESSION_SECRET de al menos 32 caracteres', () => {
    assert.throws(() => buildConfig({ NODE_ENV: 'production' }), /SESSION_SECRET/);
    assert.throws(() => buildConfig({ NODE_ENV: 'production', SESSION_SECRET: 'corto' }), /SESSION_SECRET/);
    const ok = buildConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) });
    assert.equal(ok.isProduction, true);
});

test('PORT inválido lanza error', () => {
    assert.throws(() => buildConfig({ PORT: 'abc' }), /PORT/);
    assert.throws(() => buildConfig({ PORT: '70000' }), /PORT/);
});

test('COOKIE_SECURE se interpreta como booleano', () => {
    assert.equal(buildConfig({ COOKIE_SECURE: 'true' }).cookieSecure, true);
    assert.equal(buildConfig({ COOKIE_SECURE: 'false' }).cookieSecure, false);
    assert.equal(buildConfig({ COOKIE_SECURE: '' }).cookieSecure, false);
});

test('DB_PATH :memory: se respeta', () => {
    assert.equal(buildConfig({ DB_PATH: ':memory:' }).dbPath, ':memory:');
});
