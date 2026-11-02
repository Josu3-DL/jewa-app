'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, passwordPolicyError } = require('../src/services/passwords');
const { authenticate, MAX_FAILED_ATTEMPTS, LOCK_MINUTES } = require('../src/services/auth');
const { createUser, countUsers } = require('../src/services/users');
const { SqliteStore } = require('../src/middleware/session');
const { v, validate } = require('../src/utils/validation');
const { testDb } = require('./helpers');

const T0 = new Date('2026-11-02T15:00:00Z');
const plusMin = (m) => new Date(T0.getTime() + m * 60000);

async function dbWithUser(extra = {}) {
    const db = testDb();
    const r = await createUser(db, { usuario: 'ana', nombre: 'Ana Pérez', rol: 'admin', password: 'secreto123', ...extra });
    assert.ok(r.ok, JSON.stringify(r));
    return db;
}
const user = (db) => db.prepare("SELECT * FROM usuarios WHERE usuario = 'ana'").get();
const audits = (db, accion) => db.prepare('SELECT * FROM bitacora WHERE accion = ?').all(accion);

// ───────── Contraseñas
test('hash con scrypt, sal aleatoria y formato con parámetros', async () => {
    const a = await hashPassword('secreto123');
    const b = await hashPassword('secreto123');
    assert.match(a, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.notEqual(a, b, 'la misma contraseña debe producir hashes distintos (sal)');
    assert.ok(!a.includes('secreto123'));
});

test('verifyPassword acepta la correcta y rechaza la incorrecta o un hash dañado', async () => {
    const h = await hashPassword('secreto123');
    assert.equal(await verifyPassword('secreto123', h), true);
    assert.equal(await verifyPassword('Secreto123', h), false);
    assert.equal(await verifyPassword('', h), false);
    for (const bad of ['', 'basura', 'md5$1$2$3$aa$bb', 'scrypt$a$b$c$zz$yy', null, undefined]) {
        assert.equal(await verifyPassword('secreto123', bad), false, String(bad));
    }
});

test('política de contraseña: mínimo 8 y máximo 200', () => {
    assert.match(passwordPolicyError('corta'), /al menos 8/);
    assert.match(passwordPolicyError('x'.repeat(201)), /superar 200/);
    assert.match(passwordPolicyError('        '), /vacía/);
    assert.equal(passwordPolicyError('12345678'), null);
    assert.ok(passwordPolicyError(undefined));
});

// ───────── Servicio de autenticación (T-01)
test('login correcto devuelve el usuario sin el hash y deja rastro en bitácora', async () => {
    const db = await dbWithUser();
    const r = await authenticate(db, { usuario: 'ana', password: 'secreto123', ip: '10.0.0.5', now: T0 });
    assert.equal(r.ok, true);
    assert.equal(r.user.usuario, 'ana');
    assert.equal(r.user.password_hash, undefined);
    assert.equal(audits(db, 'login').length, 1);
    assert.equal(audits(db, 'login')[0].ip, '10.0.0.5');
});

test('el usuario no distingue mayúsculas', async () => {
    const db = await dbWithUser();
    assert.equal((await authenticate(db, { usuario: 'ANA', password: 'secreto123', now: T0 })).ok, true);
});

test('T-01: contraseña incorrecta y usuario desconocido dan el mismo resultado genérico', async () => {
    const db = await dbWithUser();
    const bad = await authenticate(db, { usuario: 'ana', password: 'otra-cosa', now: T0 });
    const ghost = await authenticate(db, { usuario: 'nadie', password: 'otra-cosa', now: T0 });
    assert.deepEqual(bad, { ok: false, reason: 'credenciales' });
    assert.deepEqual(ghost, { ok: false, reason: 'credenciales' });
});

test('T-01: al 5.º fallo la cuenta se bloquea 15 minutos, incluso con la contraseña correcta', async () => {
    const db = await dbWithUser();
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
        assert.equal((await authenticate(db, { usuario: 'ana', password: 'mal', now: T0 })).reason, 'credenciales');
    }
    const fifth = await authenticate(db, { usuario: 'ana', password: 'mal', now: T0 });
    assert.deepEqual(fifth, { ok: false, reason: 'bloqueado', minutes: LOCK_MINUTES });
    assert.equal(audits(db, 'cuenta_bloqueada').length, 1);

    const during = await authenticate(db, { usuario: 'ana', password: 'secreto123', now: plusMin(14) });
    assert.equal(during.ok, false);
    assert.equal(during.reason, 'bloqueado');
    assert.equal(during.minutes, 1);

    const after = await authenticate(db, { usuario: 'ana', password: 'secreto123', now: plusMin(15) });
    assert.equal(after.ok, true, 'pasados los 15 minutos puede entrar');
    assert.equal(user(db).bloqueado_hasta, null);
});

test('un login correcto reinicia el contador de fallos', async () => {
    const db = await dbWithUser();
    for (let i = 0; i < 3; i++) await authenticate(db, { usuario: 'ana', password: 'mal', now: T0 });
    assert.equal(user(db).intentos_fallidos, 3);
    await authenticate(db, { usuario: 'ana', password: 'secreto123', now: T0 });
    assert.equal(user(db).intentos_fallidos, 0);
    // 4 fallos más no bloquean porque el contador volvió a cero
    for (let i = 0; i < 4; i++) await authenticate(db, { usuario: 'ana', password: 'mal', now: T0 });
    assert.equal((await authenticate(db, { usuario: 'ana', password: 'secreto123', now: T0 })).ok, true);
});

test('un usuario desactivado no puede entrar aunque la contraseña sea correcta', async () => {
    const db = await dbWithUser();
    db.prepare("UPDATE usuarios SET activo = 0 WHERE usuario = 'ana'").run();
    assert.deepEqual(await authenticate(db, { usuario: 'ana', password: 'secreto123', now: T0 }), { ok: false, reason: 'credenciales' });
});

test('la bitácora de login no guarda contraseñas ni el usuario tecleado si no existe', async () => {
    const db = await dbWithUser();
    await authenticate(db, { usuario: 'nadie', password: 'contraseña-secreta-xyz', now: T0 });
    await authenticate(db, { usuario: 'ana', password: 'contraseña-secreta-xyz', now: T0 });
    const dump = JSON.stringify(db.prepare('SELECT * FROM bitacora').all());
    assert.ok(!dump.includes('contraseña-secreta-xyz'));
    assert.ok(!dump.includes('nadie'));
});

// ───────── Usuarios (alta mínima para el primer administrador)
test('createUser valida, guarda hash y registra en bitácora sin el hash', async () => {
    const db = testDb();
    const r = await createUser(db, { usuario: 'maria', nombre: 'María López', rol: 'veterinario', password: 'clave-larga-1' });
    assert.equal(r.ok, true);
    const row = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(r.id);
    assert.match(row.password_hash, /^scrypt\$/);
    assert.equal(row.atiende_citas, 1, 'un veterinario atiende citas');
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM bitacora').all()).includes('scrypt'));
    assert.equal(countUsers(db), 1);
    assert.equal(countUsers(db, 'admin'), 0);
});

test('createUser rechaza datos inválidos con mensajes en español', async () => {
    const db = testDb();
    const bad = await createUser(db, { usuario: 'a b', nombre: '', rol: 'dios', password: 'corta' });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.nombre && bad.errors.rol && bad.errors.password);
    assert.match((await createUser(db, { usuario: 'a b!', nombre: 'X', rol: 'admin', password: 'clave-larga-1' })).errors.usuario, /letras, números/);
    await createUser(db, { usuario: 'ana', nombre: 'Ana', rol: 'admin', password: 'clave-larga-1' });
    assert.match((await createUser(db, { usuario: 'ANA', nombre: 'Otra', rol: 'admin', password: 'clave-larga-1' })).errors.usuario, /Ya existe/);
});

// ───────── Almacén de sesiones
const call = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (e, r) => (e ? reject(e) : resolve(r))));

test('SqliteStore guarda, lee, renueva y destruye sesiones', async () => {
    const db = testDb();
    const store = new SqliteStore(db);
    const data = { cookie: { expires: new Date(Date.now() + 60000).toISOString() }, userId: 7 };
    await call(store.set.bind(store), 'sid1', data);
    assert.equal((await call(store.get.bind(store), 'sid1')).userId, 7);
    await call(store.touch.bind(store), 'sid1', { ...data, userId: 8 });
    assert.equal((await call(store.get.bind(store), 'sid1')).userId, 8);
    await call(store.destroy.bind(store), 'sid1');
    assert.equal(await call(store.get.bind(store), 'sid1'), null);
});

test('SqliteStore descarta las sesiones vencidas', async () => {
    const db = testDb();
    const store = new SqliteStore(db);
    await call(store.set.bind(store), 'viejo', { cookie: { expires: new Date(Date.now() - 1000).toISOString() } });
    await call(store.set.bind(store), 'vivo', { cookie: { expires: new Date(Date.now() + 60000).toISOString() } });
    assert.equal(await call(store.get.bind(store), 'viejo'), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sesiones WHERE sid = 'viejo'").get().n, 0);
    await call(store.set.bind(store), 'otro-viejo', { cookie: { expires: new Date(Date.now() - 5000).toISOString() } });
    assert.equal(store.purgeExpired(), 1);
    assert.ok(await call(store.get.bind(store), 'vivo'));
});

// ───────── Validación
const run = (rule, raw) => rule(raw);

test('text: obligatorio, recorta, longitudes y caracteres de control', () => {
    const rule = v.text({ label: 'Nombre', required: true, min: 2, max: 5 });
    assert.deepEqual(run(rule, '  Ana '), { value: 'Ana' });
    assert.equal(run(rule, '   ').error, 'El campo Nombre es obligatorio.');
    assert.equal(run(rule, undefined).error, 'El campo Nombre es obligatorio.');
    assert.match(run(rule, 'A').error, /al menos 2/);
    assert.match(run(rule, 'abcdefg').error, /no puede superar 5/);
    assert.match(run(rule, 'ab\u0000c').error, /no es válido/);
    assert.match(run(rule, ['a', 'b']).error, /no es válido/);
    assert.match(run(rule, { x: 1 }).error, /no es válido/);
    assert.deepEqual(run(v.text({ label: 'Notas' }), ''), { value: '' });
    assert.deepEqual(run(v.text({ label: 'Notas', max: 50 }), 'línea 1\nlínea 2'), { value: 'línea 1\nlínea 2' });
});

test('number: coma decimal, rangos, enteros y decimales máximos', () => {
    const peso = v.number({ label: 'Peso', required: true, min: 0.1, max: 200 });
    assert.deepEqual(run(peso, '12,5'), { value: 12.5 });
    assert.deepEqual(run(peso, ' 7 '), { value: 7 });
    assert.match(run(peso, 'abc').error, /debe ser un número/);
    assert.match(run(peso, '1e3').error, /debe ser un número/);
    assert.match(run(peso, '0').error, /menor que 0.1/);
    assert.match(run(peso, '201').error, /mayor que 200/);
    assert.match(run(peso, '1.234').error, /máximo 2 decimales/);
    assert.match(run(peso, '').error, /obligatorio/);
    assert.match(run(v.number({ label: 'Cantidad', integer: true }), '2.5').error, /entero/);
    assert.deepEqual(run(v.number({ label: 'Cantidad' }), ''), { value: null });
});

test('date: formato AAAA-MM-DD y fecha real', () => {
    const d = v.date({ label: 'Fecha', required: true });
    assert.deepEqual(run(d, '2026-11-02'), { value: '2026-11-02' });
    assert.deepEqual(run(d, '2028-02-29'), { value: '2028-02-29' }, 'año bisiesto');
    assert.match(run(d, '2026-02-30').error, /no es una fecha real/);
    assert.match(run(d, '2027-02-29').error, /no es una fecha real/);
    assert.match(run(d, '2026-13-01').error, /no es una fecha real/);
    assert.match(run(d, '02/11/2026').error, /AAAA-MM-DD/);
    assert.match(run(d, '').error, /obligatorio/);
    assert.deepEqual(run(v.date({ label: 'Nacimiento' }), ''), { value: null });
});

test('phone: normaliza a 505XXXXXXXX y rechaza lo que no es de Nicaragua', () => {
    const p = v.phone({ label: 'Teléfono', required: true });
    for (const ok of ['88887777', '8888 7777', '8888-7777', '+505 8888-7777', '505 88887777', '(505) 8888 7777']) {
        assert.deepEqual(run(p, ok), { value: '50588887777' }, ok);
    }
    assert.deepEqual(run(p, '22701234'), { value: '50522701234' }, 'fijo que empieza en 2');
    for (const bad of ['1234', '98887777', '888877778', 'abcdefgh', '8888 777a']) assert.ok(run(p, bad).error, bad);
    assert.match(run(p, '').error, /obligatorio/);
    assert.deepEqual(run(v.phone({ label: 'Teléfono' }), ''), { value: '' });
});

test('email y choice', () => {
    const e = v.email({ label: 'Correo' });
    assert.deepEqual(run(e, ' Ana@Correo.COM '), { value: 'ana@correo.com' });
    assert.deepEqual(run(e, ''), { value: '' });
    for (const bad of ['ana', 'ana@', 'ana@x', 'a b@c.com']) assert.ok(run(e, bad).error, bad);
    const c = v.choice(['macho', 'hembra'], { label: 'Sexo', required: true });
    assert.deepEqual(run(c, 'macho'), { value: 'macho' });
    assert.match(run(c, 'otro').error, /no permitido/);
    assert.match(run(c, '').error, /obligatorio/);
});

test('validate junta errores, ignora campos no declarados y no cae con prototipos', () => {
    const schema = { nombre: v.text({ label: 'Nombre', required: true }), edad: v.number({ label: 'Edad', integer: true }) };
    const bad = validate({ nombre: '', edad: 'x', admin: true, __proto__: { nombre: 'Heredado' } }, schema);
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors).sort(), ['edad', 'nombre']);
    const good = validate({ nombre: ' Luna ', edad: '3', rol: 'admin' }, schema);
    assert.deepEqual(good, { ok: true, values: { nombre: 'Luna', edad: 3 }, errors: {} });
    assert.equal(validate(null, schema).ok, false);
});
