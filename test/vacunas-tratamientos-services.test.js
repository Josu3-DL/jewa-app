'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb } = require('./helpers');
const consultas = require('../src/services/consultas');
const tratamientos = require('../src/services/tratamientos');
const vacunas = require('../src/services/vacunas');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const { fechaDMY } = require('../src/utils/dates');

const AHORA = new Date('2026-11-02T15:00:00Z'); // 2 de noviembre de 2026 en Managua
const ctx = { ahora: AHORA, ip: '127.0.0.1' };

function base() {
    const db = testDb();
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const m = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' }, ctx).id;
    const vet = Number(db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('Vet Uno', 'vet1', 'x', 'veterinario')").run().lastInsertRowid);
    const vet2 = Number(db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('Vet Dos', 'vet2', 'x', 'veterinario')").run().lastInsertRowid);
    const admin = Number(db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('Admin', 'adm', 'x', 'admin')").run().lastInsertRowid);
    const consulta = consultas.crearConsulta(db, { motivo: 'Control', diagnostico: 'Sano' }, { actorId: vet, ...ctx, mascotaId: m }).id;
    const rabia = db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-001'").get().id;
    return { db, m, vet, vet2, admin, consulta, rabia };
}
const bit = (db, a) => db.prepare('SELECT * FROM bitacora WHERE accion = ?').all(a);
const VAC = (d, extra = {}) => ({ producto: String(d.rabia), fecha: '2026-11-02', proxima_dosis: '2027-11-02', ...extra });
const TRAT = (extra = {}) => ({ medicamento_texto: 'Amoxicilina 250 mg', dosis: '1 tableta', frecuencia: 'Cada 12 horas', duracion_dias: '7', ...extra });

test('migración 003: 4 vacunas base como productos, cada una con un lote único, precio 0 y sin stock movido', () => {
    const d = base();
    const cat = vacunas.catalogoVacunas(d.db);
    assert.equal(cat.length, 4);
    assert.ok(cat.every((v) => v.lotes.length === 1 && v.lotes[0].codigo_lote === 'UNICO'));
    assert.equal(d.db.prepare("SELECT SUM(precio) AS s FROM productos WHERE categoria = 'Vacuna'").get().s, 0);
});

test('tratamientos: medicamento por texto o del catálogo, con dosis y frecuencia obligatorias', () => {
    const d = base();
    const r = tratamientos.agregarTratamiento(d.db, d.consulta, TRAT({ indicaciones: 'Con comida' }), { actorId: d.vet, ip: 'x' });
    assert.equal(r.ok, true);
    const [t] = tratamientos.listarTratamientos(d.db, d.consulta);
    assert.deepEqual([t.medicamento, t.dosis, t.frecuencia, t.duracion_dias, t.indicaciones], ['Amoxicilina 250 mg', '1 tableta', 'Cada 12 horas', 7, 'Con comida']);

    const mal = tratamientos.agregarTratamiento(d.db, d.consulta, { dosis: '', frecuencia: '', duracion_dias: '999' }, { actorId: d.vet });
    assert.equal(mal.ok, false);
    for (const campo of ['medicamento_texto', 'dosis', 'frecuencia', 'duracion_dias']) assert.ok(mal.errors[campo], campo);
    assert.match(mal.errors.medicamento_texto, /catálogo o escribe/);

    const pid = Number(d.db.prepare("INSERT INTO productos (codigo, nombre, categoria, es_medicamento) VALUES ('MED-1', 'Meloxicam', 'Antiinflamatorio', 1)").run().lastInsertRowid);
    assert.equal(tratamientos.medicamentos(d.db).length, 1);
    assert.equal(tratamientos.agregarTratamiento(d.db, d.consulta, TRAT({ medicamento_texto: '', medicamento: String(pid) }), { actorId: d.vet }).ok, true);
    assert.equal(tratamientos.listarTratamientos(d.db, d.consulta)[1].medicamento, 'Meloxicam');
    assert.ok(tratamientos.agregarTratamiento(d.db, d.consulta, TRAT({ medicamento_texto: '', medicamento: '999' }), { actorId: d.vet }).errors.medicamento);
    assert.equal(bit(d.db, 'tratamiento_agregado').length, 2);
    assert.equal(tratamientos.agregarTratamiento(d.db, 999, TRAT(), { actorId: d.vet }).notFound, true);
});

test('tratamientos: no se agregan a una consulta anulada ni se pueden borrar (T-13)', () => {
    const d = base();
    const id = tratamientos.agregarTratamiento(d.db, d.consulta, TRAT(), { actorId: d.vet }).id;
    assert.throws(() => d.db.prepare('DELETE FROM tratamientos WHERE id = ?').run(id));
    consultas.anularConsulta(d.db, d.consulta, { motivo: 'Mascota equivocada' }, { actor: { id: d.vet, rol: 'veterinario' }, ...ctx });
    assert.match(tratamientos.agregarTratamiento(d.db, d.consulta, TRAT(), { actorId: d.vet }).error, /anulada/);
    assert.equal(tratamientos.listarTratamientos(d.db, d.consulta).length, 1, 'lo ya indicado se conserva');
});

test('T-14 vacuna: producto y próxima dosis obligatorios; usa el lote único y NO mueve stock', () => {
    const d = base();
    const antes = d.db.prepare('SELECT SUM(cantidad_actual) AS s FROM lotes').get().s;
    const sinProxima = vacunas.registrarVacuna(d.db, d.consulta, VAC(d, { proxima_dosis: '' }), { actorId: d.vet, ...ctx });
    assert.equal(sinProxima.ok, false);
    assert.match(sinProxima.errors.proxima_dosis, /obligatori/);
    assert.ok(vacunas.registrarVacuna(d.db, d.consulta, VAC(d, { producto: '' }), { actorId: d.vet, ...ctx }).errors.producto);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM vacunas_aplicadas').get().n, 0);

    const r = vacunas.registrarVacuna(d.db, d.consulta, VAC(d), { actorId: d.vet, ...ctx });
    assert.equal(r.ok, true);
    const [v] = vacunas.listarVacunas(d.db, { mascotaId: d.m });
    assert.deepEqual([v.vacuna, v.lote, v.fecha, v.proxima_dosis, v.estado, v.veterinario_nombre, v.consulta_id], ['Vacuna antirrábica', 'UNICO', '2026-11-02', '2027-11-02', 'vigente', 'Vet Uno', d.consulta]);
    assert.equal(d.db.prepare('SELECT SUM(cantidad_actual) AS s FROM lotes').get().s, antes, 'el stock no cambia');
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM movimientos').get().n, 0);
    assert.equal(bit(d.db, 'vacuna_aplicada').length, 1);
});

test('vacuna: fechas válidas (no futura, próxima posterior), vacuna y lote correctos', () => {
    const d = base();
    const ok = (extra) => vacunas.registrarVacuna(d.db, d.consulta, VAC(d, extra), { actorId: d.vet, ...ctx });
    assert.match(ok({ fecha: '2026-11-03' }).errors.fecha, /futura/);
    assert.match(ok({ proxima_dosis: '2026-11-02' }).errors.proxima_dosis, /posterior/);
    assert.match(ok({ proxima_dosis: '2026-02-30' }).errors.proxima_dosis, /no válida|Fecha/i);
    assert.ok(ok({ producto: '999' }).errors.producto);
    d.db.prepare("INSERT INTO productos (codigo, nombre, categoria) VALUES ('PRO-1', 'Shampoo', 'Higiene')").run();
    const shampoo = d.db.prepare("SELECT id FROM productos WHERE codigo = 'PRO-1'").get().id;
    assert.ok(ok({ producto: String(shampoo) }).errors.producto, 'solo productos de categoría Vacuna');
    const loteOtra = d.db.prepare("SELECT l.id FROM lotes l JOIN productos p ON p.id = l.producto_id WHERE p.codigo = 'VAC-002'").get().id;
    assert.ok(ok({ lote: String(loteOtra) }).errors.lote, 'el lote debe ser de esa vacuna');
    const propio = d.db.prepare('SELECT id FROM lotes WHERE producto_id = ?').get(d.rabia).id;
    assert.equal(ok({ lote: String(propio) }).ok, true, 'lote explícito válido');
    d.db.prepare("INSERT INTO lotes (producto_id, codigo_lote) VALUES (?, 'L2')").run(d.rabia);
    assert.match(ok({}).errors.lote, /Elige el lote/, 'con varios lotes hay que elegir');
    assert.equal(vacunas.registrarVacuna(d.db, 999, VAC(d), { actorId: d.vet, ...ctx }).notFound, true);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM vacunas_aplicadas').get().n, 1);
});

test('vacuna: no se registra en una consulta anulada; anular exige motivo, es del autor o del administrador y no se borra', () => {
    const d = base();
    const id = vacunas.registrarVacuna(d.db, d.consulta, VAC(d), { actorId: d.vet, ...ctx }).id;
    assert.throws(() => d.db.prepare('DELETE FROM vacunas_aplicadas WHERE id = ?').run(id));
    assert.ok(vacunas.anularVacuna(d.db, id, { motivo: '' }, { actor: { id: d.vet, rol: 'veterinario' } }).errors.motivo);
    assert.equal(vacunas.anularVacuna(d.db, id, { motivo: 'Otro veterinario' }, { actor: { id: d.vet2, rol: 'veterinario' } }).forbidden, true);
    assert.equal(vacunas.anularVacuna(d.db, id, { motivo: 'Registrada por error' }, { actor: { id: d.vet, rol: 'veterinario' } }).ok, true);
    const [v] = vacunas.listarVacunas(d.db, { mascotaId: d.m });
    assert.deepEqual([v.estado, v.anulada_motivo], ['anulada', 'Registrada por error']);
    assert.equal(vacunas.listarVacunas(d.db, { mascotaId: d.m, anuladas: false }).length, 0);
    assert.match(vacunas.anularVacuna(d.db, id, { motivo: 'Una vez más' }, { actor: { id: d.admin, rol: 'admin' } }).error, /ya está anulada/);
    assert.equal(vacunas.anularVacuna(d.db, 999, { motivo: 'Cualquiera' }, { actor: { id: d.admin, rol: 'admin' } }).notFound, true);
    consultas.anularConsulta(d.db, d.consulta, { motivo: 'Mascota equivocada' }, { actor: { id: d.vet, rol: 'veterinario' }, ...ctx });
    assert.match(vacunas.registrarVacuna(d.db, d.consulta, VAC(d), { actorId: d.vet, ...ctx }).error, /anulada/);
    assert.equal(bit(d.db, 'vacuna_anulada').length, 1);
});

test('fechaDMY: AAAA-MM-DD a dd/mm/aaaa', () => {
    assert.equal(fechaDMY('2026-11-02'), '02/11/2026');
    assert.equal(fechaDMY(''), '');
    assert.equal(fechaDMY(null), '');
});
