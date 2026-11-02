'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../src/services/settings');
const servicios = require('../src/services/servicios');
const { formatMoney, parseMoney, calcularImpuesto, MONEDAS } = require('../src/utils/money');
const { z, dinero, verTelefono } = require('../src/utils/validation');
const { testDb, seedBasics } = require('./helpers');

// ───────── Dinero (D-05: siempre enteros en centavos)
test('formatMoney: "C$ 1,234.50" con miles y dos decimales, también negativos y otras monedas', () => {
    assert.equal(formatMoney(123450), 'C$ 1,234.50');
    assert.equal(formatMoney(0), 'C$ 0.00');
    assert.equal(formatMoney(5), 'C$ 0.05');
    assert.equal(formatMoney(100), 'C$ 1.00');
    assert.equal(formatMoney(99), 'C$ 0.99');
    assert.equal(formatMoney(100000000), 'C$ 1,000,000.00');
    assert.equal(formatMoney(-500), '-C$ 5.00');
    assert.equal(formatMoney(150000, 'USD'), '$ 1,500.00');
    assert.equal(formatMoney(150000, 'XXX'), 'C$ 1,500.00', 'moneda desconocida → córdoba');
    assert.deepEqual(Object.keys(MONEDAS), ['NIO', 'USD']);
});

test('formatMoney rechaza lo que no sea un entero (nada de floats)', () => {
    for (const malo of [12.5, '100', null, undefined, NaN, Infinity]) assert.throws(() => formatMoney(malo), TypeError, String(malo));
});

test('parseMoney: texto de formulario → centavos exactos, sin pasar por float', () => {
    const casos = { '150': 15000, '150.5': 15050, '150.50': 15050, '150,50': 15050, '0': 0, '0.05': 5, '0,5': 50, ' 12 ': 1200, '1.00': 100, '99999999.99': 9999999999 };
    for (const [texto, esperado] of Object.entries(casos)) assert.equal(parseMoney(texto), esperado, texto);
    assert.equal(parseMoney('1.005'), null, '3 decimales no se redondean: se rechazan');
    assert.equal(parseMoney('19.99') + parseMoney('0.01'), 2000, 'sin errores de coma flotante (19.99 + 0.01)');
    for (const malo of ['', 'abc', '-5', '1,234.50', '1.234,50', '12.', '.5', '1e3', '100000000000', '100000000.00', null, undefined]) assert.equal(parseMoney(malo), null, String(malo));
});

test('calcularImpuesto: porcentaje de hasta 2 decimales con redondeo al centavo', () => {
    assert.equal(calcularImpuesto(10000, 15), 1500);
    assert.equal(calcularImpuesto(1999, 15), 300, '299.85 → 300');
    assert.equal(calcularImpuesto(1999, 0), 0);
    assert.equal(calcularImpuesto(10000, 7.5), 750);
    assert.equal(calcularImpuesto(333, 15), 50, '49.95 → 50');
    assert.equal(calcularImpuesto(0, 15), 0);
    assert.equal(calcularImpuesto(10000, 100), 10000);
});

test('dinero() de validación: convierte a centavos y explica el error', () => {
    assert.equal(z.object({ p: dinero() }).parse({ p: '150.50' }).p, 15050);
    const malo = z.object({ p: dinero() }).safeParse({ p: '1,234.50' });
    assert.match(malo.error.issues[0].message, /Monto no válido/);
    assert.equal(z.object({ p: dinero() }).safeParse({ p: '' }).error.issues[0].message, 'Este campo es obligatorio.');
});

test('verTelefono: 50588887777 → "8888 7777"; vacío y desconocido se respetan', () => {
    assert.equal(verTelefono('50588887777'), '8888 7777');
    assert.equal(verTelefono(''), '');
    assert.equal(verTelefono(undefined), '');
});

// ───────── Ajustes de la clínica
const FORM = () => ({
    nombre: 'JEWA Veterinaria', telefono: '8888 7777', direccion: 'Managua, frente al parque', moneda: 'NIO', iva: '15', duracionCitaMin: '45',
    lunes_abierto: 'on', lunes_abre: '08:00', lunes_cierra: '17:00',
    martes_abierto: 'on', martes_abre: '08:00', martes_cierra: '17:00',
    sabado_abierto: 'on', sabado_abre: '08:00', sabado_cierra: '12:00',
});

test('sin guardar nada, los ajustes salen con los valores por defecto (Q-05, D-23)', () => {
    const s = settings.getSettings(testDb());
    assert.equal(s.nombre, 'JEWA');
    assert.equal(s.moneda, 'NIO');
    assert.equal(s.iva, 0);
    assert.equal(s.duracionCitaMin, 30);
    assert.equal(s.telefono, '');
    assert.deepEqual(s.horario.lunes, { abre: '08:00', cierra: '17:00' });
    assert.deepEqual(s.horario.sabado, { abre: '08:00', cierra: '12:00' });
    assert.equal(s.horario.domingo, null, 'domingo cerrado');
    assert.equal(testDb().prepare('SELECT COUNT(*) AS n FROM config').get().n, 0, 'no se siembra nada en config');
});

test('saveSettings: guarda tipado, normaliza el teléfono y deja la bitácora con cambios legibles', () => {
    const db = testDb();
    const { usuarioId } = seedBasics(db);
    const r = settings.saveSettings(db, FORM(), { actorId: usuarioId, ip: '10.0.0.3' });
    assert.equal(r.ok, true);
    const s = settings.getSettings(db);
    assert.equal(s.nombre, 'JEWA Veterinaria');
    assert.equal(s.telefono, '50588887777');
    assert.equal(s.iva, 15);
    assert.equal(s.duracionCitaMin, 45);
    assert.deepEqual(s.horario.martes, { abre: '08:00', cierra: '17:00' });
    assert.equal(s.horario.miercoles, null, 'los días sin marcar quedan cerrados');
    assert.equal(settings.getSetting(db, 'nombre_clinica'), 'JEWA Veterinaria');

    const log = db.prepare("SELECT * FROM bitacora WHERE accion = 'ajustes_editados'").get();
    assert.equal(log.usuario_id, usuarioId);
    assert.equal(log.entidad, 'config');
    assert.equal(log.ip, '10.0.0.3');
    const cambios = JSON.parse(log.detalle).cambios;
    assert.ok(cambios.includes('nombre: JEWA → JEWA Veterinaria'));
    assert.ok(cambios.includes('IVA: 0 → 15'));
    assert.ok(cambios.includes('horario modificado'));
});

test('saveSettings: guardar lo mismo no escribe bitácora; el formulario de edición recupera lo guardado', () => {
    const db = testDb();
    settings.saveSettings(db, FORM(), {});
    const n = db.prepare('SELECT COUNT(*) AS n FROM bitacora').get().n;
    assert.deepEqual(settings.saveSettings(db, FORM(), {}), { ok: true, sinCambios: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bitacora').get().n, n);
    const v = settings.paraFormulario(settings.getSettings(db));
    assert.equal(v.telefono, '8888 7777', 'el teléfono vuelve en formato nacional');
    assert.equal(v.iva, '15');
    assert.equal(v.martes_abierto, true);
    assert.equal(v.miercoles_abierto, false);
    assert.equal(v.sabado_cierra, '12:00');
    // Reenviar el formulario tal como se muestra no cambia nada
    const reenvio = { ...v, lunes_abierto: 'on', martes_abierto: 'on', sabado_abierto: 'on' };
    assert.equal(settings.saveSettings(db, reenvio, {}).ok, true);
});

test('saveSettings valida cada campo con mensajes en español', () => {
    const db = testDb();
    const err = (cambios) => settings.saveSettings(db, { ...FORM(), ...cambios }, {}).errors || {};
    assert.equal(err({ nombre: '' }).nombre, 'Este campo es obligatorio.');
    assert.match(err({ telefono: '1234' }).telefono, /Teléfono no válido/);
    assert.equal(err({ moneda: 'EUR' }).moneda, 'Moneda no válida.');
    assert.match(err({ iva: '-1' }).iva, /no puede ser negativo/);
    assert.match(err({ iva: '101' }).iva, /no puede superar 100/);
    assert.match(err({ iva: 'quince' }).iva, /Debe ser un número/);
    assert.match(err({ duracionCitaMin: '2' }).duracionCitaMin, /Mínimo 5/);
    assert.match(err({ duracionCitaMin: '500' }).duracionCitaMin, /Máximo 240/);
    assert.match(err({ duracionCitaMin: '30.5' }).duracionCitaMin, /enteros/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM config').get().n, 0, 'con errores no se guarda nada');
    assert.equal(err({ iva: '7,5' }).iva, undefined, 'acepta coma decimal (este sí es válido y guarda)');
    assert.equal(settings.getSettings(db).iva, 7.5);
});

test('el horario exige horas válidas y cierre posterior a la apertura, solo en los días abiertos', () => {
    const db = testDb();
    const err = (cambios) => settings.saveSettings(db, { ...FORM(), ...cambios }, {}).errors || {};
    assert.equal(err({ lunes_cierra: '07:00' }).lunes_cierra, 'Debe ser posterior a la apertura.');
    assert.equal(err({ lunes_cierra: '08:00' }).lunes_cierra, 'Debe ser posterior a la apertura.', 'igual a la apertura tampoco');
    assert.equal(err({ lunes_abre: '' }).lunes_abre, 'Indica la hora de apertura.');
    assert.equal(err({ lunes_cierra: '' }).lunes_cierra, 'Indica la hora de cierre.');
    assert.equal(err({ lunes_abre: '25:99' }).lunes_abre, 'Hora no válida (HH:MM).');
    assert.equal(err({ lunes_abre: '8:00' }).lunes_abre, 'Hora no válida (HH:MM).');
    assert.deepEqual(err({ miercoles_abre: '20:00', miercoles_cierra: '08:00' }), {}, 'un día cerrado no se valida');
    assert.equal(err({ miercoles_abierto: 'on', miercoles_abre: '', miercoles_cierra: '' }).miercoles_abre, 'Indica la hora de apertura.');
});

test('un horario o ajustes dañados en la base no rompen la app: se usan los valores por defecto', () => {
    const db = testDb();
    db.prepare("INSERT INTO config (clave, valor) VALUES ('horario', '{no es json'), ('moneda', 'EUR'), ('iva_porcentaje', 'abc'), ('duracion_cita_min', '')").run();
    const s = settings.getSettings(db);
    assert.deepEqual(s.horario.lunes, { abre: '08:00', cierra: '17:00' });
    assert.equal(s.moneda, 'NIO');
    assert.equal(s.iva, 0);
    assert.equal(s.duracionCitaMin, 30);
});

// ───────── Datos iniciales (migración 002)
test('migración 002: servicios base con precio 0 y plantillas de recordatorio por defecto', () => {
    const db = testDb();
    const base = db.prepare('SELECT nombre, tipo, precio, duracion_min, activo FROM servicios ORDER BY id').all().map((r) => ({ ...r }));
    assert.deepEqual(base.map((s) => s.nombre), ['Consulta general', 'Vacunación', 'Seguimiento', 'Baño', 'Corte']);
    assert.deepEqual(base.map((s) => s.tipo), ['consulta', 'vacuna', 'seguimiento', 'grooming', 'grooming']);
    assert.ok(base.every((s) => s.precio === 0 && s.activo === 1 && s.duracion_min >= 15), 'no se inventan precios');
    const pl = db.prepare('SELECT tipo, texto FROM plantillas ORDER BY id').all();
    assert.deepEqual(pl.map((p) => p.tipo), ['cita', 'vacuna', 'tratamiento']);
    for (const p of pl) assert.ok(p.texto.includes('{mascota}') && p.texto.includes('{clinica}'), p.tipo);
    assert.match(pl[0].texto, /\{fecha\}.*\{hora\}/);
    assert.throws(() => db.prepare("INSERT INTO servicios (nombre, tipo) VALUES ('CONSULTA GENERAL', 'consulta')").run(), /UNIQUE/, 'el nombre es único sin distinguir mayúsculas');
});

// ───────── Servicios
const SERV = (extra = {}) => ({ nombre: 'Radiografía', tipo: 'otro', precio: '350.50', duracion: '40', ...extra });

test('createServicio: guarda el precio en centavos y deja la bitácora', () => {
    const db = testDb();
    const { usuarioId } = seedBasics(db);
    const r = servicios.createServicio(db, SERV(), { actorId: usuarioId, ip: '10.0.0.4' });
    assert.equal(r.ok, true);
    const s = servicios.getServicio(db, r.id);
    assert.deepEqual({ nombre: s.nombre, tipo: s.tipo, precio: s.precio, duracion_min: s.duracion_min, activo: s.activo }, { nombre: 'Radiografía', tipo: 'otro', precio: 35050, duracion_min: 40, activo: 1 });
    const log = db.prepare("SELECT * FROM bitacora WHERE accion = 'servicio_creado'").get();
    assert.equal(log.entidad, 'servicio');
    assert.equal(log.entidad_id, r.id);
    assert.equal(log.usuario_id, usuarioId);
});

test('createServicio/updateServicio validan y no permiten nombres repetidos', () => {
    const db = testDb();
    const err = (extra) => servicios.createServicio(db, SERV(extra), {}).errors || {};
    assert.equal(err({ nombre: '' }).nombre, 'Este campo es obligatorio.');
    assert.equal(err({ nombre: 'consulta GENERAL' }).nombre, 'Ya existe un servicio con ese nombre.');
    assert.equal(err({ tipo: 'magia' }).tipo, 'Tipo no válido.');
    assert.match(err({ precio: '1,234.50' }).precio, /Monto no válido/);
    assert.match(err({ precio: '-3' }).precio, /Monto no válido/);
    assert.equal(err({ precio: '' }).precio, 'Este campo es obligatorio.');
    assert.match(err({ duracion: '3' }).duracion, /Mínimo 5/);
    assert.match(err({ duracion: '999' }).duracion, /Máximo 480/);
    assert.match(err({ duracion: 'x' }).duracion, /número de minutos/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM servicios').get().n, 5, 'ninguno de los inválidos se guardó');
    const baño = db.prepare("SELECT id FROM servicios WHERE nombre = 'Baño'").get().id;
    assert.equal(servicios.updateServicio(db, baño, SERV({ nombre: 'Corte' }), {}).errors.nombre, 'Ya existe un servicio con ese nombre.');
    assert.equal(servicios.updateServicio(db, baño, SERV({ nombre: 'BAÑO' }), {}).ok, true, 'puede conservar su propio nombre (aunque cambie la capitalización)');
});

test('updateServicio: cambios en la bitácora con el precio formateado; sin cambios no escribe; inexistente → notFound', () => {
    const db = testDb();
    const { usuarioId } = seedBasics(db);
    const id = db.prepare("SELECT id FROM servicios WHERE nombre = 'Consulta general'").get().id;
    const r = servicios.updateServicio(db, id, { nombre: 'Consulta general', tipo: 'consulta', precio: '250', duracion: '30' }, { actorId: usuarioId });
    assert.equal(r.ok, true);
    assert.equal(servicios.getServicio(db, id).precio, 25000);
    const cambios = JSON.parse(db.prepare("SELECT detalle FROM bitacora WHERE accion = 'servicio_editado'").get().detalle).cambios;
    assert.deepEqual(cambios, ['precio: C$ 0.00 → C$ 250.00']);
    assert.deepEqual(servicios.updateServicio(db, id, { nombre: 'Consulta general', tipo: 'consulta', precio: '250.00', duracion: '30' }, {}), { ok: true, sinCambios: true });
    assert.equal(servicios.updateServicio(db, 9999, SERV(), {}).notFound, true);
    assert.equal(servicios.setActivo(db, 9999, false, {}).notFound, true);
});

test('el precio en la bitácora usa la moneda configurada', () => {
    const db = testDb();
    settings.saveSettings(db, { ...FORM(), moneda: 'USD' }, {});
    const id = db.prepare("SELECT id FROM servicios WHERE nombre = 'Baño'").get().id;
    servicios.updateServicio(db, id, { nombre: 'Baño', tipo: 'grooming', precio: '12.5', duracion: '45' }, {});
    const cambios = JSON.parse(db.prepare("SELECT detalle FROM bitacora WHERE accion = 'servicio_editado'").get().detalle).cambios;
    assert.deepEqual(cambios, ['precio: $ 0.00 → $ 12.50']);
});

test('desactivar un servicio NO afecta a las citas existentes y se puede revertir', () => {
    const db = testDb();
    const { usuarioId, mascotaId } = seedBasics(db);
    const servicioId = db.prepare("SELECT id FROM servicios WHERE nombre = 'Vacunación'").get().id;
    db.prepare("INSERT INTO citas (mascota_id, veterinario_id, servicio_id, inicio, fin) VALUES (?, ?, ?, '2026-11-03T15:00:00Z', '2026-11-03T15:15:00Z')").run(mascotaId, usuarioId, servicioId);

    assert.equal(servicios.setActivo(db, servicioId, false, { actorId: usuarioId }).ok, true);
    const cita = db.prepare('SELECT c.servicio_id, s.nombre, s.activo FROM citas c JOIN servicios s ON s.id = c.servicio_id').get();
    assert.equal(cita.servicio_id, servicioId, 'la cita conserva su servicio');
    assert.equal(cita.nombre, 'Vacunación');
    assert.equal(cita.activo, 0);
    assert.equal(servicios.listServicios(db).filter((s) => s.activo).length, 4);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'servicio_desactivado'").get().n, 1);

    assert.deepEqual(servicios.setActivo(db, servicioId, false, {}), { ok: true, sinCambios: true });
    assert.equal(servicios.setActivo(db, servicioId, true, { actorId: usuarioId }).ok, true);
    assert.equal(servicios.getServicio(db, servicioId).activo, 1);
    assert.throws(() => db.prepare('DELETE FROM servicios WHERE id = ?').run(servicioId), /FOREIGN KEY/, 'con citas asociadas la base impide borrarlo');
});

test('listServicios: activos primero, luego por tipo y nombre', () => {
    const db = testDb();
    const id = db.prepare("SELECT id FROM servicios WHERE nombre = 'Baño'").get().id;
    servicios.setActivo(db, id, false, {});
    const lista = servicios.listServicios(db);
    assert.equal(lista[lista.length - 1].nombre, 'Baño', 'el inactivo va al final');
    assert.deepEqual(lista.slice(0, 4).map((s) => s.tipo), ['consulta', 'grooming', 'seguimiento', 'vacuna']);
});
