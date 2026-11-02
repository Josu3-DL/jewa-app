'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb } = require('./helpers');
const citas = require('../src/services/citas');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const { managuaToUtc, utcToManagua, hora12, sumarDias, diaSemana } = require('../src/utils/dates');

// Lunes 2 de noviembre de 2026, 09:00 en Managua
const AHORA = new Date('2026-11-02T15:00:00Z');
const ctx = { actorId: null, ip: '127.0.0.1', ahora: AHORA };

function base() {
    const db = testDb();
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const m1 = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' }, ctx).id;
    const m2 = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Michi', especie: 'Gato', sexo: 'hembra' }, ctx).id;
    const ins = db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol, atiende_citas) VALUES (?, ?, 'x', ?, ?)");
    const vet = Number(ins.run('Vet Uno', 'vet1', 'veterinario', 1).lastInsertRowid);
    const groomer = Number(ins.run('Groomer', 'gro', 'recepcion', 1).lastInsertRowid);
    const recep = Number(ins.run('Recepción', 'rec', 'recepcion', 0).lastInsertRowid);
    const servicio = (nombre) => db.prepare('SELECT id FROM servicios WHERE nombre = ?').get(nombre).id;
    return { db, m1, m2, vet, groomer, recep, consulta: servicio('Consulta general'), bano: servicio('Baño') };
}
const FORM = (d, extra = {}) => ({ mascota: String(d.m1), responsable: String(d.vet), servicio: String(d.consulta), fecha: '2026-11-03', hora: '09:00', motivo: 'Revisión', ...extra });
const bitacora = (db, accion) => db.prepare('SELECT * FROM bitacora WHERE accion = ?').all(accion);

test('fechas: Managua ↔ UTC, 12 horas, días de la semana', () => {
    assert.equal(managuaToUtc('2026-11-03', '09:00'), '2026-11-03T15:00:00Z');
    assert.equal(managuaToUtc('2026-11-03', '20:30'), '2026-11-04T02:30:00Z', 'pasa de día en UTC');
    assert.deepEqual(utcToManagua('2026-11-04T02:30:00Z'), { fecha: '2026-11-03', hora: '20:30' });
    assert.deepEqual([hora12('00:05'), hora12('09:30'), hora12('12:00'), hora12('17:45')], ['12:05 AM', '9:30 AM', '12:00 PM', '5:45 PM']);
    assert.equal(sumarDias('2026-12-30', 3), '2027-01-02');
    assert.equal(diaSemana('2026-11-02'), 0, 'lunes');
    assert.equal(diaSemana('2026-11-08'), 6, 'domingo');
});

test('crear cita: fin = inicio + duración del servicio; sin servicio usa la duración de Ajustes (30 min)', () => {
    const d = base();
    const r = citas.crearCita(d.db, FORM(d), ctx);
    assert.equal(r.ok, true);
    const c = citas.getCita(d.db, r.id);
    assert.deepEqual([c.inicio, c.fin, c.estado, c.horaTexto, c.finTexto], ['2026-11-03T15:00:00Z', '2026-11-03T15:30:00Z', 'programada', '9:00 AM', '9:30 AM']);
    const b = citas.crearCita(d.db, FORM(d, { servicio: String(d.bano), hora: '10:00', mascota: String(d.m2) }), ctx);
    assert.equal(citas.getCita(d.db, b.id).finTexto, '10:45 AM', 'Baño dura 45 min');
    const s = citas.crearCita(d.db, FORM(d, { servicio: '', hora: '11:00' }), ctx);
    assert.equal(citas.getCita(d.db, s.id).finTexto, '11:30 AM');
    assert.equal(bitacora(d.db, 'cita_creada').length, 3);
});

test('crear cita: validación de campos, mascota, responsable y servicio', () => {
    const d = base();
    const mal = citas.crearCita(d.db, { mascota: String(d.m1), responsable: '', fecha: '2026-02-30', hora: '25:00' }, ctx);
    assert.equal(mal.ok, false);
    for (const campo of ['responsable', 'fecha', 'hora']) assert.ok(mal.errors[campo], campo);
    assert.ok(citas.crearCita(d.db, { ...FORM(d), mascota: '' }, ctx).errors.mascota);
    assert.ok(citas.crearCita(d.db, FORM(d, { mascota: '999' }), ctx).errors.mascota, 'mascota inexistente');
    assert.ok(citas.crearCita(d.db, FORM(d, { responsable: String(d.recep) }), ctx).errors.responsable, 'no atiende citas');
    assert.ok(citas.crearCita(d.db, FORM(d, { responsable: '999' }), ctx).errors.responsable);
    assert.ok(citas.crearCita(d.db, FORM(d, { servicio: '999' }), ctx).errors.servicio);
    d.db.prepare('UPDATE servicios SET activo = 0 WHERE id = ?').run(d.consulta);
    assert.ok(citas.crearCita(d.db, FORM(d), ctx).errors.servicio, 'servicio desactivado');
    mascotas.updateMascota(d.db, d.m1, { nombre: 'Firulais', especie: 'Perro', sexo: 'macho', estado: 'fallecida' }, ctx);
    assert.ok(citas.crearCita(d.db, FORM(d, { servicio: '' }), ctx).errors.mascota, 'mascota fallecida');
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM citas').get().n, 0);
});

test('T-05 traslape: el mismo responsable no puede tener dos citas a la vez', () => {
    const d = base();
    assert.equal(citas.crearCita(d.db, FORM(d), ctx).ok, true); // 9:00–9:30
    for (const hora of ['09:00', '09:15']) {
        const r = citas.crearCita(d.db, FORM(d, { hora, mascota: String(d.m2) }), ctx);
        assert.equal(r.ok, false, hora);
        assert.match(r.errors.hora, /ya tiene una cita de 9:00 AM a 9:30 AM/);
    }
    const largo = citas.crearCita(d.db, FORM(d, { hora: '08:45', servicio: String(d.bano) }), ctx); // 8:45–9:30
    assert.equal(largo.ok, false, 'una cita larga que empieza antes también choca');
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM citas').get().n, 1);
});

test('T-07 borde exacto y otro responsable: sí se permite', () => {
    const d = base();
    citas.crearCita(d.db, FORM(d), ctx); // 9:00–9:30
    assert.equal(citas.crearCita(d.db, FORM(d, { hora: '09:30' }), ctx).ok, true, 'empieza justo cuando termina la otra');
    assert.equal(citas.crearCita(d.db, FORM(d, { hora: '08:30' }), ctx).ok, true, 'termina justo cuando empieza la otra');
    assert.equal(citas.crearCita(d.db, FORM(d, { responsable: String(d.groomer), hora: '09:00' }), ctx).ok, true, 'otro responsable, misma hora');
});

test('T-06 una cita cancelada (o "no asistió") libera el horario', () => {
    const d = base();
    const a = citas.crearCita(d.db, FORM(d), ctx).id;
    assert.equal(citas.crearCita(d.db, FORM(d), ctx).ok, false);
    assert.equal(citas.cambiarEstado(d.db, a, 'cancelada', ctx).ok, true);
    const b = citas.crearCita(d.db, FORM(d), ctx);
    assert.equal(b.ok, true, 'se puede reservar el mismo horario');
    assert.equal(citas.cambiarEstado(d.db, b.id, 'no_asistio', ctx).ok, true);
    assert.equal(citas.crearCita(d.db, FORM(d), ctx).ok, true);
});

test('T-22 advertencias: pasado, fuera de horario y día cerrado piden confirmación; confirmada se guarda', () => {
    const d = base();
    const casos = [
        [{ fecha: '2026-11-02', hora: '08:00' }, /ya pasaron/],
        [{ hora: '07:00' }, /fuera del horario laboral \(8:00 AM – 5:00 PM\)/],
        [{ hora: '16:45' }, /fuera del horario laboral/], // termina 17:15
        [{ fecha: '2026-11-08', hora: '10:00' }, /cerrada los domingos/],
        [{ fecha: '2026-11-07', hora: '11:45' }, /fuera del horario laboral \(8:00 AM – 12:00 PM\)/], // sábado cierra 12:00
    ];
    for (const [extra, patron] of casos) {
        const r = citas.crearCita(d.db, FORM(d, extra), ctx);
        assert.equal(r.ok, false);
        assert.ok(r.advertencias && r.advertencias.some((a) => patron.test(a)), JSON.stringify(extra));
    }
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM citas').get().n, 0, 'sin confirmar no se guarda nada');
    assert.equal(citas.crearCita(d.db, FORM(d, { hora: '07:00', confirmar: 'on' }), ctx).ok, true);
    assert.equal(citas.crearCita(d.db, FORM(d, { hora: '14:00' }), ctx).ok, true, 'en horario no pide confirmar');
    // el traslape se rechaza aunque se confirme
    assert.equal(citas.crearCita(d.db, FORM(d, { hora: '07:00', confirmar: 'on' }), ctx).ok, false);
});

test('estados: transiciones permitidas, finales sin salida y bitácora', () => {
    const d = base();
    const id = citas.crearCita(d.db, FORM(d), ctx).id;
    assert.equal(citas.cambiarEstado(d.db, id, 'confirmada', ctx).ok, true);
    assert.equal(citas.cambiarEstado(d.db, id, 'programada', ctx).ok, false, 'no se vuelve atrás');
    assert.equal(citas.cambiarEstado(d.db, id, 'en_espera', ctx).ok, true);
    assert.equal(citas.cambiarEstado(d.db, id, 'atendida', ctx).ok, true);
    const final = citas.cambiarEstado(d.db, id, 'cancelada', ctx);
    assert.equal(final.ok, false);
    assert.match(final.error, /atendida no puede pasar a cancelada/);
    assert.equal(citas.cambiarEstado(d.db, id, 'inventado', ctx).ok, false);
    assert.equal(citas.cambiarEstado(d.db, 999, 'confirmada', ctx).notFound, true);
    assert.equal(bitacora(d.db, 'cita_estado').length, 3);
    assert.match(bitacora(d.db, 'cita_estado')[0].detalle, /"de":"programada","a":"confirmada"/);
    assert.deepEqual(citas.getCita(d.db, id).acciones, [], 'una cita final no ofrece acciones');
});

test('reprogramar: cambia hora/responsable, ignora su propio horario, valida traslape y rechaza citas terminadas', () => {
    const d = base();
    const a = citas.crearCita(d.db, FORM(d), ctx).id;               // 9:00–9:30
    const b = citas.crearCita(d.db, FORM(d, { hora: '10:00' }), ctx).id; // 10:00–10:30
    const igual = citas.actualizarCita(d.db, a, FORM(d), ctx);
    assert.equal(igual.sinCambios, true, 'guardar sin cambios no choca consigo misma');
    assert.equal(citas.actualizarCita(d.db, a, FORM(d, { hora: '09:15' }), ctx).ok, true, 'se corre dentro de su propio horario');
    assert.equal(citas.actualizarCita(d.db, a, FORM(d, { hora: '10:15' }), ctx).ok, false, 'choca con la otra');
    assert.equal(citas.actualizarCita(d.db, b, FORM(d, { responsable: String(d.groomer), hora: '10:00' }), ctx).ok, true);
    assert.equal(citas.getCita(d.db, b).responsable_nombre, 'Groomer');
    assert.match(bitacora(d.db, 'cita_editada')[0].detalle, /horario: 2026-11-03 09:00 → 2026-11-03 09:15/);
    citas.cambiarEstado(d.db, a, 'cancelada', ctx);
    assert.match(citas.actualizarCita(d.db, a, FORM(d, { hora: '11:00' }), ctx).error, /ya terminó/);
    assert.equal(citas.actualizarCita(d.db, 999, FORM(d), ctx).notFound, true);
});

test('grooming: el responsable puede ser alguien que no es veterinario y se filtra por tipo', () => {
    const d = base();
    citas.crearCita(d.db, FORM(d), ctx);
    const g = citas.crearCita(d.db, FORM(d, { responsable: String(d.groomer), servicio: String(d.bano), hora: '10:00', mascota: String(d.m2) }), ctx);
    assert.equal(g.ok, true);
    assert.deepEqual(citas.responsables(d.db).map((r) => r.nombre), ['Groomer', 'Vet Uno'], 'recepción sin agenda no aparece');
    const rango = { desde: '2026-11-03T06:00:00Z', hasta: '2026-11-04T06:00:00Z' };
    assert.equal(citas.listarCitas(d.db, rango).length, 2);
    const solo = citas.listarCitas(d.db, { ...rango, tipo: 'grooming' });
    assert.deepEqual(solo.map((c) => c.servicio_nombre), ['Baño']);
    assert.equal(citas.listarCitas(d.db, { ...rango, responsableId: d.vet }).length, 1);
    assert.equal(citas.listarCitas(d.db, { ...rango, mascotaId: d.m2 }).length, 1);
});

test('listas: rango día/semana por hora de Managua, próximas y pendientes de confirmar', () => {
    const d = base();
    const a = citas.crearCita(d.db, FORM(d, { fecha: '2026-11-02', hora: '16:00' }), ctx).id; // hoy 4 PM (futuro)
    const b = citas.crearCita(d.db, FORM(d, { fecha: '2026-11-03', hora: '09:00' }), ctx).id;
    citas.crearCita(d.db, FORM(d, { fecha: '2026-11-03', hora: '20:30', confirmar: 'on' }), ctx); // 20:30 Managua = 02:30 UTC del 4
    const dia = citas.listarCitas(d.db, { desde: managuaToUtc('2026-11-03', '00:00'), hasta: managuaToUtc('2026-11-04', '00:00') });
    assert.equal(dia.length, 2, 'la cita de las 8:30 PM sigue siendo del 3 aunque en UTC sea del 4');
    citas.cambiarEstado(d.db, b, 'confirmada', ctx);
    const pend = citas.proximasCitas(d.db, AHORA, { soloEstado: 'programada' });
    assert.deepEqual(pend.map((c) => c.id).includes(b), false, 'la confirmada ya no está pendiente');
    assert.equal(pend.some((c) => c.id === a), true);
    citas.cambiarEstado(d.db, a, 'cancelada', ctx);
    assert.equal(citas.proximasCitas(d.db, AHORA).some((c) => c.id === a), false, 'canceladas fuera de próximas');
    assert.equal(citas.proximasCitas(d.db, AHORA, { limite: 1 }).length, 1);
});
