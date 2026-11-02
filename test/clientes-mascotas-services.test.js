'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb } = require('./helpers');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const { edadTexto } = require('../src/utils/dates');
const { patron, patronTelefono, paginar } = require('../src/utils/busqueda');

const NOW = new Date('2026-11-02T15:00:00Z');
const ctx = { actorId: null, ip: '127.0.0.1', ahora: NOW };
const CLI = (extra = {}) => ({ nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on', ...extra });
const MASC = (propietario, extra = {}) => ({ propietario: String(propietario), nombre: 'Firulais', especie: 'Perro', sexo: 'macho', ...extra });
const nuevoCliente = (db, extra) => propietarios.createPropietario(db, CLI(extra), ctx).id;
const bitacora = (db, accion) => db.prepare('SELECT * FROM bitacora WHERE accion = ?').all(accion);

// ───────── Clientes
test('crear cliente: teléfono normalizado a 505XXXXXXXX, cédula opcional y consentimiento por defecto', () => {
    const db = testDb();
    const r = propietarios.createPropietario(db, CLI({ telefono: '+505 8888-7777', cedula: ' 001-010101-0001a ' }), ctx);
    assert.equal(r.ok, true);
    const p = propietarios.getPropietario(db, r.id);
    assert.equal(p.telefono, '50588887777');
    assert.equal(p.cedula, '001-010101-0001A');
    assert.equal(p.acepta_notificaciones, 1);
    assert.equal(propietarios.createPropietario(db, CLI({ nombre: 'Sin Cédula' }), ctx).ok, true, 'la cédula es opcional');
    assert.equal(bitacora(db, 'propietario_creado').length, 2);
});

test('crear cliente: validación por campo y cédula única', () => {
    const db = testDb();
    const mal = propietarios.createPropietario(db, { nombre: 'A', telefono: '123', correo: 'x', cedula: '!!', acepta_notificaciones: 'on' }, ctx);
    assert.equal(mal.ok, false);
    for (const campo of ['nombre', 'telefono', 'correo', 'cedula']) assert.ok(mal.errors[campo], `error en ${campo}`);
    assert.equal(propietarios.createPropietario(db, CLI({ cedula: '001-010101-0001A' }), ctx).ok, true);
    const dup = propietarios.createPropietario(db, CLI({ nombre: 'Otro Cliente', cedula: '001-010101-0001a' }), ctx);
    assert.equal(dup.ok, false);
    assert.match(dup.errors.cedula, /Ya existe/);
});

test('editar cliente: el cambio de consentimiento queda en bitácora aparte (y sin cambios no registra nada)', () => {
    const db = testDb();
    const id = nuevoCliente(db);
    assert.equal(propietarios.updatePropietario(db, id, CLI(), ctx).sinCambios, true);
    assert.equal(bitacora(db, 'consentimiento_cambiado').length, 0);

    const sinConsentimiento = { nombre: 'Laura Mendoza', telefono: '8888 7777' }; // casilla desmarcada: no se envía
    assert.equal(propietarios.updatePropietario(db, id, sinConsentimiento, ctx).ok, true);
    assert.equal(propietarios.getPropietario(db, id).acepta_notificaciones, 0);
    const [fila] = bitacora(db, 'consentimiento_cambiado');
    assert.match(fila.detalle, /sí → no/);
    assert.equal(bitacora(db, 'propietario_editado').length, 0, 'solo cambió el consentimiento');

    propietarios.updatePropietario(db, id, CLI({ nombre: 'Laura M. Mendoza' }), ctx);
    assert.equal(bitacora(db, 'consentimiento_cambiado').length, 2, 'volver a aceptar también se registra');
    assert.match(bitacora(db, 'propietario_editado')[0].detalle, /Laura Mendoza → Laura M\. Mendoza/);
});

test('T-16: no se desactiva un cliente con mascotas activas; sí cuando ya no las tiene; se puede reactivar', () => {
    const db = testDb();
    const id = nuevoCliente(db);
    const m = mascotas.createMascota(db, MASC(id), ctx);
    const rechazo = propietarios.setActivo(db, id, false, ctx);
    assert.equal(rechazo.ok, false);
    assert.match(rechazo.error, /1 mascota activa/);
    assert.equal(propietarios.getPropietario(db, id).activo, 1);

    mascotas.updateMascota(db, m.id, { nombre: 'Firulais', especie: 'Perro', sexo: 'macho', estado: 'fallecida' }, ctx);
    assert.equal(propietarios.setActivo(db, id, false, ctx).ok, true);
    assert.equal(propietarios.getPropietario(db, id).activo, 0);
    assert.equal(propietarios.setActivo(db, id, true, ctx).ok, true);
    assert.equal(propietarios.getPropietario(db, id).activo, 1);
    assert.equal(propietarios.setActivo(db, 999, false, ctx).notFound, true);
});

// ───────── Mascotas
test('crear mascota: expediente EXP-000001, EXP-000002…, estado activa y primer registro de propietario', () => {
    const db = testDb();
    const id = nuevoCliente(db);
    const a = mascotas.createMascota(db, MASC(id), ctx);
    const b = mascotas.createMascota(db, MASC(id, { nombre: 'Michi', especie: 'Gato' }), ctx);
    assert.equal(a.expediente, 'EXP-000001');
    assert.equal(b.expediente, 'EXP-000002');
    const m = mascotas.getMascota(db, a.id);
    assert.equal(m.estado, 'activa');
    assert.equal(m.propietario_nombre, 'Laura Mendoza');
    const hist = mascotas.historialPropietarios(db, a.id);
    assert.equal(hist.length, 1);
    assert.equal(hist[0].hasta, null);
    assert.equal(bitacora(db, 'mascota_creada').length, 2);
});

test('crear mascota: validación (nombre, especie, sexo, nacimiento futuro) y propietario existente y activo', () => {
    const db = testDb();
    const id = nuevoCliente(db);
    const mal = mascotas.createMascota(db, { propietario: String(id), nombre: '', especie: 'Dragón', sexo: 'x', fecha_nacimiento: '2026-11-03' }, ctx);
    assert.equal(mal.ok, false);
    for (const campo of ['nombre', 'especie', 'sexo', 'fecha_nacimiento']) assert.ok(mal.errors[campo], `error en ${campo}`);
    assert.match(mal.errors.fecha_nacimiento, /futura/);
    assert.equal(mascotas.createMascota(db, MASC(id, { fecha_nacimiento: '2026-11-02' }), ctx).ok, true, 'hoy es válido');
    assert.ok(mascotas.createMascota(db, MASC(9999), ctx).errors.propietario, 'propietario inexistente');
    assert.ok(mascotas.createMascota(db, { ...MASC(id), propietario: '' }, ctx).errors.propietario, 'sin elegir propietario');

    const idInactivo = nuevoCliente(db, { nombre: 'Inactivo Uno', telefono: '8777 6666' });
    propietarios.setActivo(db, idInactivo, false, ctx);
    assert.match(mascotas.createMascota(db, MASC(idInactivo), ctx).errors.propietario, /desactivado/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mascotas').get().n, 1, 'los rechazos no dejan filas ni expedientes gastados');
});

test('edad calculada: años y meses, meses, días y casos límite', () => {
    assert.equal(edadTexto('2024-08-02', '2026-11-02'), '2 años 3 meses');
    assert.equal(edadTexto('2025-11-02', '2026-11-02'), '1 año');
    assert.equal(edadTexto('2026-06-15', '2026-11-02'), '4 meses');
    assert.equal(edadTexto('2026-10-02', '2026-11-02'), '1 mes');
    assert.equal(edadTexto('2026-10-20', '2026-11-02'), '13 días');
    assert.equal(edadTexto('2026-11-01', '2026-11-02'), '1 día');
    assert.equal(edadTexto('2024-11-30', '2026-11-02'), '1 año 11 meses', 'el día del mes aún no llegó');
    assert.equal(edadTexto(null, '2026-11-02'), '');
    assert.equal(edadTexto('2026-12-01', '2026-11-02'), '');
});

test('editar mascota: estado activa/fallecida/inactiva y cambios en bitácora', () => {
    const db = testDb();
    const id = nuevoCliente(db);
    const { id: mid } = mascotas.createMascota(db, MASC(id), ctx);
    const base = { nombre: 'Firulais', especie: 'Perro', sexo: 'macho', estado: 'activa' };
    assert.equal(mascotas.updateMascota(db, mid, base, ctx).sinCambios, true);
    assert.equal(mascotas.updateMascota(db, mid, { ...base, nombre: 'Firu', raza: 'Criollo', esterilizado: 'on', estado: 'inactiva' }, ctx).ok, true);
    const m = mascotas.getMascota(db, mid);
    assert.deepEqual([m.nombre, m.raza, m.esterilizado, m.estado], ['Firu', 'Criollo', 1, 'inactiva']);
    assert.match(bitacora(db, 'mascota_editada')[0].detalle, /estado: activa → inactiva/);
    assert.ok(mascotas.updateMascota(db, mid, { ...base, estado: 'perdida' }, ctx).errors.estado);
    assert.equal(mascotas.updateMascota(db, 999, base, ctx).notFound, true);
});

test('transferir mascota: cambia el dueño y deja el historial; no a inactivos, inexistentes ni al mismo', () => {
    const db = testDb();
    const a = nuevoCliente(db);
    const b = nuevoCliente(db, { nombre: 'Carlos Ruiz', telefono: '8555 4444' });
    const { id } = mascotas.createMascota(db, MASC(a), ctx);
    const despues = new Date('2026-11-05T15:00:00Z');

    assert.match(mascotas.transferirMascota(db, id, a, ctx).error, /ya pertenece/);
    assert.match(mascotas.transferirMascota(db, id, 9999, ctx).error, /no existe/);
    propietarios.setActivo(db, b, false, ctx);
    assert.match(mascotas.transferirMascota(db, id, b, ctx).error, /desactivado/);
    propietarios.setActivo(db, b, true, ctx);

    const r = mascotas.transferirMascota(db, id, b, { ...ctx, ahora: despues });
    assert.equal(r.ok, true);
    assert.equal(mascotas.getMascota(db, id).propietario_id, b);
    const hist = mascotas.historialPropietarios(db, id);
    assert.deepEqual(hist.map((h) => [h.nombre, h.hasta]), [['Carlos Ruiz', null], ['Laura Mendoza', despues.toISOString()]]);
    assert.match(bitacora(db, 'mascota_transferida')[0].detalle, /"de":"Laura Mendoza","a":"Carlos Ruiz"/);
    assert.equal(mascotas.transferirMascota(db, 999, b, ctx).notFound, true);
});

test('foto: se guarda el nombre del archivo y se devuelve el anterior para borrarlo; null la quita', () => {
    const db = testDb();
    const { id } = mascotas.createMascota(db, MASC(nuevoCliente(db)), ctx);
    assert.equal(mascotas.setFoto(db, id, 'a.png', ctx).anterior, null);
    assert.equal(mascotas.setFoto(db, id, 'b.png', ctx).anterior, 'a.png');
    assert.equal(mascotas.setFoto(db, id, null, ctx).anterior, 'b.png');
    assert.equal(mascotas.getMascota(db, id).foto, null);
    assert.equal(bitacora(db, 'mascota_foto_cambiada').length, 2);
    assert.equal(bitacora(db, 'mascota_foto_quitada').length, 1);
});

// ───────── Búsqueda
test('búsqueda de clientes: por nombre, cédula y teléfono (con o sin espacios); inactivos solo si se piden', () => {
    const db = testDb();
    const a = nuevoCliente(db, { cedula: '001-010101-0001A' });
    nuevoCliente(db, { nombre: 'Carlos Ruiz', telefono: '8555 4444' });
    const q = (texto, extra) => propietarios.listPropietarios(db, { q: texto, ...extra }).filas.map((f) => f.nombre);
    assert.deepEqual(q('laura'), ['Laura Mendoza']);
    assert.deepEqual(q('010101'), ['Laura Mendoza']);
    assert.deepEqual(q('8888 7777'), ['Laura Mendoza']);
    assert.deepEqual(q('8555'), ['Carlos Ruiz']);
    assert.deepEqual(q('+505 8555-4444'), ['Carlos Ruiz']);
    assert.deepEqual(q(''), ['Carlos Ruiz', 'Laura Mendoza']);
    assert.deepEqual(q('zzz'), []);
    propietarios.setActivo(db, a, false, ctx);
    assert.deepEqual(q(''), ['Carlos Ruiz']);
    assert.deepEqual(q('', { inactivos: true }), ['Carlos Ruiz', 'Laura Mendoza']);
});

test('búsqueda de mascotas: por nombre, expediente, dueño, cédula y teléfono; filtra por estado', () => {
    const db = testDb();
    const a = nuevoCliente(db, { cedula: '001-010101-0001A' });
    const b = nuevoCliente(db, { nombre: 'Carlos Ruiz', telefono: '8555 4444' });
    mascotas.createMascota(db, MASC(a), ctx);
    mascotas.createMascota(db, MASC(b, { nombre: 'Michi', especie: 'Gato' }), ctx);
    const { id } = mascotas.createMascota(db, MASC(b, { nombre: 'Rocky' }), ctx);
    mascotas.updateMascota(db, id, { nombre: 'Rocky', especie: 'Perro', sexo: 'macho', estado: 'fallecida' }, ctx);
    const q = (texto, extra) => mascotas.listMascotas(db, { q: texto, ...extra }).filas.map((f) => f.nombre);
    assert.deepEqual(q('firu'), ['Firulais']);
    assert.deepEqual(q('EXP-000002'), ['Michi']);
    assert.deepEqual(q('ruiz'), ['Michi'], 'por defecto solo activas');
    assert.deepEqual(q('ruiz', { estado: 'todos' }), ['Michi', 'Rocky']);
    assert.deepEqual(q('', { estado: 'fallecida' }), ['Rocky']);
    assert.deepEqual(q('001-010101'), ['Firulais']);
    assert.deepEqual(q('8555 4444'), ['Michi']);
    assert.deepEqual(mascotas.listMascotas(db, { propietarioId: b, estado: 'todos' }).filas.map((f) => f.nombre), ['Michi', 'Rocky']);
});

test('T-21 búsqueda: comodines y texto malicioso se tratan como texto, sin error', () => {
    const db = testDb();
    nuevoCliente(db);
    mascotas.createMascota(db, MASC(1), ctx);
    for (const malo of ["'; DROP TABLE propietarios; --", '<script>alert(1)</script>', '%', '_', '!', '\\']) {
        assert.equal(propietarios.listPropietarios(db, { q: malo }).total, 0, `clientes: ${malo}`);
        assert.equal(mascotas.listMascotas(db, { q: malo, estado: 'todos' }).total, 0, `mascotas: ${malo}`);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM propietarios').get().n, 1, 'la tabla sigue intacta');
});

test('paginación de 25: 60 clientes → 3 páginas y la página se ajusta al rango', () => {
    const db = testDb();
    for (let i = 1; i <= 60; i += 1) {
        propietarios.createPropietario(db, CLI({ nombre: `Cliente ${String(i).padStart(2, '0')}`, telefono: `8${String(1000000 + i)}` }), ctx);
    }
    const p1 = propietarios.listPropietarios(db, { pagina: 1 });
    assert.deepEqual([p1.filas.length, p1.total, p1.paginas], [25, 60, 3]);
    assert.equal(propietarios.listPropietarios(db, { pagina: '3' }).filas.length, 10);
    assert.equal(propietarios.listPropietarios(db, { pagina: 99 }).pagina, 3);
    assert.equal(propietarios.listPropietarios(db, { pagina: 'abc' }).pagina, 1);
    assert.equal(propietarios.listPropietarios(db, { pagina: 2 }).filas[0].nombre, 'Cliente 26');
});

test('ayudantes de búsqueda: patrones y paginar', () => {
    assert.equal(patron('  ana  '), '%ana%');
    assert.equal(patron('50%_!'), '%50!%!_!!%');
    assert.equal(patron('   '), null);
    assert.equal(patronTelefono('8888 7777'), '%88887777%');
    assert.equal(patronTelefono('ab12'), null);
    assert.deepEqual(paginar(0, 1), { pagina: 1, paginas: 1, offset: 0, porPagina: 25 });
    assert.equal(paginar(51, 3).offset, 50);
});
