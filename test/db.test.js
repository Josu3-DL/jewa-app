'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb, transaction } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { testDb, seedBasics } = require('./helpers');

const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const consulta = "INSERT INTO consultas (mascota_id, veterinario_id, fecha, motivo, diagnostico) VALUES (?,?,?,?,?)";

test('migrate crea el esquema completo', () => {
    const db = testDb();
    const t = tables(db);
    for (const name of ['usuarios', 'sesiones', 'bitacora', 'propietarios', 'mascotas', 'servicios', 'citas', 'consultas',
        'tratamientos', 'vacunas_aplicadas', 'consumos', 'adjuntos', 'productos', 'lotes', 'movimientos', 'proveedores',
        'compras', 'compra_detalle', 'ventas', 'venta_detalle', 'plantillas', 'notificaciones', 'config', 'mascota_propietarios_hist']) {
        assert.ok(t.includes(name), `falta la tabla ${name}`);
    }
});

test('migrate es idempotente', () => {
    const db = openDb(':memory:');
    const todas = fs.readdirSync(path.join(__dirname, '..', 'src', 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    assert.ok(todas.length >= 2 && todas[0] === '001_init.sql');
    assert.deepEqual(migrate(db), todas, 'la primera vez aplica todas, en orden');
    assert.deepEqual(migrate(db), [], 'la segunda no aplica nada');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM servicios').get().n, 5, 'los datos iniciales no se duplican');
});

test('una migración fallida se revierte por completo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewa-mig-'));
    fs.writeFileSync(path.join(dir, '001_mala.sql'), 'CREATE TABLE a (id INTEGER); CREATE TABLE a (id INTEGER);');
    const db = openDb(':memory:');
    assert.throws(() => migrate(db, dir));
    assert.ok(!tables(db).includes('a'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('claves foráneas activas', () => {
    const db = testDb();
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.throws(() => db.prepare("INSERT INTO mascotas (numero_expediente, propietario_id, nombre, especie) VALUES ('EXP-9', 999, 'X', 'Perro')").run(), /FOREIGN KEY/);
});

test('cédula única y rol válido', () => {
    const db = testDb();
    seedBasics(db);
    assert.throws(() => db.prepare("INSERT INTO propietarios (nombre, cedula, telefono) VALUES ('Otro','001-010101-0001A','1')").run(), /UNIQUE/);
    assert.throws(() => db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('X','x','h','dios')").run(), /CHECK/);
});

test('usuario es único sin distinguir mayúsculas', () => {
    const db = testDb();
    db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('A','Ana','h','admin')").run();
    assert.throws(() => db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('B','ana','h','admin')").run(), /UNIQUE/);
});

test('la cita debe terminar después de empezar', () => {
    const db = testDb();
    const { usuarioId, mascotaId } = seedBasics(db);
    const ins = db.prepare('INSERT INTO citas (mascota_id, veterinario_id, inicio, fin) VALUES (?,?,?,?)');
    assert.throws(() => ins.run(mascotaId, usuarioId, '2026-11-03T15:00:00Z', '2026-11-03T14:00:00Z'), /CHECK/);
    ins.run(mascotaId, usuarioId, '2026-11-03T15:00:00Z', '2026-11-03T15:30:00Z');
});

test('el stock de un lote nunca es negativo', () => {
    const db = testDb();
    db.prepare("INSERT INTO productos (codigo, nombre, categoria) VALUES ('P1','Vacuna','Vacunas')").run();
    db.prepare("INSERT INTO lotes (producto_id, codigo_lote, cantidad_actual) VALUES (1,'L1',5)").run();
    assert.throws(() => db.prepare('UPDATE lotes SET cantidad_actual = -1 WHERE id = 1').run(), /CHECK/);
});

test('T-13: no se puede borrar consultas, ventas, movimientos ni bitácora', () => {
    const db = testDb();
    const { usuarioId, mascotaId } = seedBasics(db);
    db.prepare(consulta).run(mascotaId, usuarioId, '2026-11-03T15:00:00Z', 'Control', 'Sano');
    db.prepare("INSERT INTO productos (codigo, nombre, categoria) VALUES ('P1','X','Otro')").run();
    db.prepare("INSERT INTO lotes (producto_id, codigo_lote, cantidad_actual) VALUES (1,'L1',5)").run();
    db.prepare("INSERT INTO movimientos (producto_id, lote_id, tipo, cantidad, motivo, usuario_id) VALUES (1,1,'entrada',5,'Compra',?)").run(usuarioId);
    db.prepare("INSERT INTO ventas (numero, fecha, subtotal, total, metodo_pago, usuario_id) VALUES ('V-000001','2026-11-03T15:00:00Z',100,100,'efectivo',?)").run(usuarioId);
    db.prepare("INSERT INTO bitacora (usuario_id, accion, entidad) VALUES (?, 'crear', 'prueba')").run(usuarioId);

    for (const table of ['consultas', 'movimientos', 'ventas', 'bitacora']) {
        assert.throws(() => db.prepare(`DELETE FROM ${table}`).run(), /no se eliminan|no admite/, `se pudo borrar ${table}`);
    }
    assert.throws(() => db.prepare("UPDATE bitacora SET accion = 'x'").run(), /no admite/);
    assert.throws(() => db.prepare('UPDATE movimientos SET cantidad = 1').run(), /no se modifican/);
});

test('anular una consulta exige motivo y es definitivo', () => {
    const db = testDb();
    const { usuarioId, mascotaId } = seedBasics(db);
    db.prepare(consulta).run(mascotaId, usuarioId, '2026-11-03T15:00:00Z', 'Control', 'Sano');
    assert.throws(() => db.prepare("UPDATE consultas SET estado='anulada' WHERE id=1").run(), /CHECK/);
    db.prepare("UPDATE consultas SET estado='anulada', anulada_motivo='Error de registro', anulada_por=?, anulada_en='2026-11-03T16:00:00Z' WHERE id=1").run(usuarioId);
    assert.throws(() => db.prepare("UPDATE consultas SET estado='vigente' WHERE id=1").run(), /reactivarse|CHECK/);
});

test('transaction revierte todo si algo falla', () => {
    const db = testDb();
    const p = Number(db.prepare("INSERT INTO productos (codigo, nombre, categoria) VALUES ('P1','X','Otro')").run().lastInsertRowid);
    const lote = Number(db.prepare("INSERT INTO lotes (producto_id, codigo_lote, cantidad_actual) VALUES (?,'L1',3)").run(p).lastInsertRowid);
    assert.throws(() => transaction(db, () => {
        db.prepare('UPDATE lotes SET cantidad_actual = cantidad_actual - 2 WHERE id = ?').run(lote);
        db.prepare('UPDATE lotes SET cantidad_actual = cantidad_actual - 2 WHERE id = ?').run(lote); // queda -1: viola CHECK
    }), /CHECK/);
    assert.equal(db.prepare('SELECT cantidad_actual AS n FROM lotes WHERE id = ?').get(lote).n, 3);
});

test('openDb crea la carpeta, activa WAL y cierra bien', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jewa-db-'));
    const file = path.join(dir, 'sub', 'clinic.db');
    const db = openDb(file);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    db.close();
    assert.ok(fs.existsSync(file));
    fs.rmSync(dir, { recursive: true, force: true });
});
