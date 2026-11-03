'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb } = require('./helpers');
const consultas = require('../src/services/consultas');
const citas = require('../src/services/citas');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');

const AHORA = new Date('2026-11-02T15:00:00Z');
const ctx = { ahora: AHORA, ip: '127.0.0.1' };

function base() {
    const db = testDb();
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const mk = (n) => mascotas.createMascota(db, { propietario: String(dueno), nombre: n, especie: 'Perro', sexo: 'macho' }, ctx).id;
    const ins = db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol, atiende_citas) VALUES (?, ?, 'x', ?, 1)");
    const vet = Number(ins.run('Vet Uno', 'vet1', 'veterinario').lastInsertRowid);
    const vet2 = Number(ins.run('Vet Dos', 'vet2', 'veterinario').lastInsertRowid);
    const admin = Number(ins.run('Admin', 'adm', 'admin').lastInsertRowid);
    return { db, m1: mk('Firulais'), m2: mk('Rocky'), vet, vet2, admin };
}
const FORM = (extra = {}) => ({ motivo: 'Decaimiento', diagnostico: 'Gastroenteritis leve', peso_kg: '12.5', temperatura_c: '38,7', frecuencia_cardiaca: '90', frecuencia_respiratoria: '24', ...extra });
const nueva = (d, extra, opc = {}) => consultas.crearConsulta(d.db, FORM(extra), { actorId: d.vet, ...ctx, mascotaId: d.m1, ...opc });
const bit = (db, a) => db.prepare('SELECT * FROM bitacora WHERE accion = ?').all(a);

test('crear consulta sin cita (urgencia): guarda los datos, acepta coma decimal y deja bitácora', () => {
    const d = base();
    const r = nueva(d);
    assert.equal(r.ok, true);
    const c = consultas.getConsulta(d.db, r.id);
    assert.deepEqual([c.estado, c.cita_id, c.veterinario_nombre, c.mascota_nombre, c.peso_kg, c.temperatura_c, c.frecuencia_cardiaca, c.fecha],
        ['vigente', null, 'Vet Uno', 'Firulais', 12.5, 38.7, 90, '2026-11-02T15:00:00.000Z']);
    assert.equal(bit(d.db, 'consulta_creada').length, 1);
});

test('validación: motivo y diagnóstico obligatorios; signos vitales opcionales pero dentro de rango', () => {
    const d = base();
    const minimo = nueva(d, { peso_kg: '', temperatura_c: '', frecuencia_cardiaca: '', frecuencia_respiratoria: '' });
    assert.equal(minimo.ok, true, 'sin signos vitales se puede guardar');
    assert.equal(consultas.getConsulta(d.db, minimo.id).peso_kg, null);
    const mal = nueva(d, { motivo: '', diagnostico: '', peso_kg: '0', temperatura_c: '50', frecuencia_cardiaca: '10', frecuencia_respiratoria: '300' });
    assert.equal(mal.ok, false);
    for (const campo of ['motivo', 'diagnostico', 'peso_kg', 'temperatura_c', 'frecuencia_cardiaca', 'frecuencia_respiratoria']) assert.ok(mal.errors[campo], campo);
    assert.ok(nueva(d, { peso_kg: 'abc' }).errors.peso_kg);
    assert.ok(nueva(d, { frecuencia_cardiaca: '90.5' }).errors.frecuencia_cardiaca, 'entero');
    assert.ok(nueva(d, { motivo: 'x'.repeat(301) }).errors.motivo);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM consultas').get().n, 1);
    assert.equal(nueva(d, {}, { mascotaId: 999 }).ok, false);
});

test('desde una cita: precarga el vínculo y la pasa a atendida en la misma operación', () => {
    const d = base();
    const cita = citas.crearCita(d.db, { mascota: String(d.m1), responsable: String(d.vet), fecha: '2026-11-03', hora: '09:00' }, ctx).id;
    const r = nueva(d, {}, { citaId: cita });
    assert.equal(r.ok, true);
    assert.equal(consultas.getConsulta(d.db, r.id).cita_id, cita);
    assert.equal(citas.getCita(d.db, cita).estado, 'atendida');
    assert.equal(bit(d.db, 'cita_estado').length, 1);
    assert.match(nueva(d, {}, { citaId: cita }).error, /ya no está activa/);
});

test('desde una cita: debe ser de la misma mascota, estar activa y no repetirse; un error no deja la cita atendida', () => {
    const d = base();
    const cita = citas.crearCita(d.db, { mascota: String(d.m2), responsable: String(d.vet), fecha: '2026-11-03', hora: '09:00' }, ctx).id;
    assert.match(nueva(d, {}, { citaId: cita }).error, /no corresponde/);
    assert.match(nueva(d, {}, { citaId: 999 }).error, /no corresponde/);
    citas.cambiarEstado(d.db, cita, 'cancelada', ctx);
    assert.match(nueva(d, {}, { mascotaId: d.m2, citaId: cita }).error, /ya no está activa/);
    const otra = citas.crearCita(d.db, { mascota: String(d.m2), responsable: String(d.vet), fecha: '2026-11-03', hora: '11:00' }, ctx).id;
    assert.equal(nueva(d, { diagnostico: '' }, { mascotaId: d.m2, citaId: otra }).ok, false);
    assert.equal(citas.getCita(d.db, otra).estado, 'programada', 'validación fallida: la cita no cambia');
    assert.equal(nueva(d, {}, { mascotaId: d.m2, citaId: otra }).ok, true);
});

test('T-12 anular: motivo obligatorio, queda quién/cuándo/por qué, conserva el contenido y es definitiva', () => {
    const d = base();
    const id = nueva(d).id;
    assert.ok(consultas.anularConsulta(d.db, id, { motivo: '' }, { actor: { id: d.vet, rol: 'veterinario' }, ...ctx }).errors.motivo);
    assert.ok(consultas.anularConsulta(d.db, id, { motivo: 'no' }, { actor: { id: d.vet, rol: 'veterinario' }, ...ctx }).errors.motivo, 'mínimo 5 caracteres');
    assert.equal(consultas.getConsulta(d.db, id).estado, 'vigente');

    const later = new Date('2026-11-03T12:00:00Z');
    assert.equal(consultas.anularConsulta(d.db, id, { motivo: 'Registrada en la mascota equivocada' }, { actor: { id: d.vet, rol: 'veterinario' }, ip: '1.1.1.1', ahora: later }).ok, true);
    const c = consultas.getConsulta(d.db, id);
    assert.deepEqual([c.estado, c.anulada_motivo, c.anulada_por_nombre, c.anulada_en, c.diagnostico, c.peso_kg],
        ['anulada', 'Registrada en la mascota equivocada', 'Vet Uno', later.toISOString(), 'Gastroenteritis leve', 12.5]);
    assert.match(bit(d.db, 'consulta_anulada')[0].detalle, /equivocada/);
    assert.match(consultas.anularConsulta(d.db, id, { motivo: 'Otra vez más' }, { actor: { id: d.vet, rol: 'veterinario' }, ...ctx }).error, /ya está anulada/);
    assert.throws(() => d.db.prepare("UPDATE consultas SET estado = 'vigente' WHERE id = ?").run(id), 'la BD impide reactivarla');
});

test('anular: el veterinario solo las suyas, el administrador cualquiera; inexistente → no encontrada', () => {
    const d = base();
    const id = nueva(d).id;
    const otro = consultas.anularConsulta(d.db, id, { motivo: 'No es mía, pero intento' }, { actor: { id: d.vet2, rol: 'veterinario' }, ...ctx });
    assert.equal(otro.forbidden, true);
    assert.equal(consultas.getConsulta(d.db, id).estado, 'vigente');
    assert.equal(consultas.anularConsulta(d.db, id, { motivo: 'Corrección del administrador' }, { actor: { id: d.admin, rol: 'admin' }, ...ctx }).ok, true);
    assert.equal(consultas.anularConsulta(d.db, 999, { motivo: 'Cualquier motivo' }, { actor: { id: d.admin, rol: 'admin' }, ...ctx }).notFound, true);
});

test('T-13 no se puede borrar una consulta (la BD lo rechaza)', () => {
    const d = base();
    const id = nueva(d).id;
    assert.throws(() => d.db.prepare('DELETE FROM consultas WHERE id = ?').run(id));
    assert.equal(consultas.getConsulta(d.db, id).estado, 'vigente');
});

test('historial: más reciente primero, filtros por texto, fechas (hora de Managua) y estado; anuladas marcadas', () => {
    const d = base();
    const mk = (fecha, extra, mascotaId = d.m1) => consultas.crearConsulta(d.db, FORM(extra), { actorId: d.vet, ahora: new Date(fecha), mascotaId }).id;
    const a = mk('2026-10-01T15:00:00Z', { diagnostico: 'Otitis' });
    const b = mk('2026-10-15T15:00:00Z', { diagnostico: 'Dermatitis' });
    const c = mk('2026-10-16T03:00:00Z', { diagnostico: 'Parásitos' }); // 21:00 del 15 en Managua
    mk('2026-10-20T15:00:00Z', { diagnostico: 'Control' }, d.m2);
    consultas.anularConsulta(d.db, a, { motivo: 'Error de captura' }, { actor: { id: d.vet, rol: 'veterinario' }, ...ctx });

    const ids = (f) => consultas.listarConsultas(d.db, { mascotaId: d.m1, ...f }).filas.map((x) => x.id);
    assert.deepEqual(ids({}), [c, b, a], 'cronológico inverso, con la anulada incluida');
    assert.deepEqual(ids({ estado: 'vigente' }), [c, b]);
    assert.deepEqual(ids({ estado: 'anulada' }), [a]);
    assert.deepEqual(ids({ q: 'dermat' }), [b]);
    assert.deepEqual(ids({ desde: '2026-10-15', hasta: '2026-10-15' }), [c, b], 'el día completo en hora de Managua');
    assert.deepEqual(ids({ desde: '2026-10-16' }), [], 'la de las 9 PM del 15 no es del 16');
    assert.equal(consultas.listarConsultas(d.db, { q: 'rocky' }).total, 1, 'sin mascota: busca por nombre de mascota');
    assert.equal(consultas.listarConsultas(d.db, {}).total, 4);
    assert.equal(consultas.listarConsultas(d.db, { q: "'; DROP TABLE consultas; --" }).total, 0);
    assert.deepEqual(consultas.leerFiltros({ desde: 'mal', estado: 'x', q: 'a', pagina: '2' }), { q: 'a', pagina: 2 });
});

test('peso: la gráfica usa solo consultas vigentes con peso, en orden cronológico', () => {
    const d = base();
    const mk = (fecha, peso) => consultas.crearConsulta(d.db, FORM({ peso_kg: peso }), { actorId: d.vet, ahora: new Date(fecha), mascotaId: d.m1 }).id;
    mk('2026-09-01T15:00:00Z', '10');
    const mal = mk('2026-09-15T15:00:00Z', '99');
    mk('2026-10-01T15:00:00Z', '');
    mk('2026-10-10T15:00:00Z', '11,5');
    consultas.anularConsulta(d.db, mal, { motivo: 'Peso mal digitado' }, { actor: { id: d.vet, rol: 'veterinario' }, ...ctx });
    assert.deepEqual(consultas.pesosDe(d.db, d.m1), [{ fecha: '2026-09-01', peso: 10 }, { fecha: '2026-10-10', peso: 11.5 }]);
    assert.deepEqual(consultas.pesosDe(d.db, d.m2), []);
});
