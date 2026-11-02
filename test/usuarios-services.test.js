'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const users = require('../src/services/users');
const audit = require('../src/services/audit');
const { authenticate } = require('../src/services/auth');
const { SqliteStore } = require('../src/middleware/session');
const { formatDateTime, managuaDayRange } = require('../src/utils/dates');
const { pager } = require('../src/utils/pagination');
const { testDb } = require('./helpers');

const OK = { password: 'clave-larga-1', password2: 'clave-larga-1' };
const T0 = new Date('2026-11-02T15:00:00Z');

async function setup() {
    const db = testDb();
    const admin = await users.createUser(db, { usuario: 'ana', nombre: 'Ana Pérez', rol: 'admin', ...OK });
    return { db, adminId: admin.id };
}
const rows = (db, accion) => db.prepare('SELECT * FROM bitacora WHERE accion = ? ORDER BY id').all(accion);
const row = (db, id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);

// ───────── Alta
test('createUser: colegiado solo se guarda para veterinarios; atiende citas por defecto según el rol', async () => {
    const { db } = await setup();
    const vet = await users.createUser(db, { usuario: 'vet1', nombre: 'María López', rol: 'veterinario', colegiado: 'COL-123', ...OK });
    const rec = await users.createUser(db, { usuario: 'rec1', nombre: 'Rosa Díaz', rol: 'recepcion', colegiado: 'COL-999', ...OK });
    assert.equal(row(db, vet.id).colegiado, 'COL-123');
    assert.equal(row(db, vet.id).atiende_citas, 1);
    assert.equal(row(db, rec.id).colegiado, null, 'un recepcionista no guarda colegiado');
    assert.equal(row(db, rec.id).atiende_citas, 0);
    const groomer = await users.createUser(db, { usuario: 'gro1', nombre: 'Luis Mora', rol: 'recepcion', atiende_citas: true, ...OK });
    assert.equal(row(db, groomer.id).atiende_citas, 1, 'un groomer puede atender citas sin ser veterinario (D-21)');
});

test('createUser: las contraseñas deben coincidir y cumplir la política', async () => {
    const { db } = await setup();
    const mal = await users.createUser(db, { usuario: 'user1', nombre: 'X', rol: 'admin', password: 'clave-larga-1', password2: 'otra-clave-1' });
    assert.deepEqual(mal.errors, { password2: 'Las contraseñas no coinciden.' });
    const corta = await users.createUser(db, { usuario: 'user2', nombre: 'X', rol: 'admin', password: 'corta', password2: 'corta' });
    assert.match(corta.errors.password, /al menos 8/);
    assert.equal((await users.createUser(db, { usuario: 'user3', nombre: 'X', rol: 'admin', password: 'clave-larga-1' })).ok, true, 'sin password2 (seed:admin) es válido');
});

// ───────── Edición
test('updateUser: guarda cambios y los deja en bitácora en texto legible, sin tocar la contraseña', async () => {
    const { db, adminId } = await setup();
    const vet = await users.createUser(db, { usuario: 'vet1', nombre: 'María López', rol: 'veterinario', ...OK });
    const antes = row(db, vet.id).password_hash;
    const r = users.updateUser(db, vet.id, { nombre: 'María J. López', rol: 'veterinario', colegiado: 'COL-77', atiende_citas: false }, { actorId: adminId, ip: '10.0.0.9' });
    assert.equal(r.ok, true);
    const u = row(db, vet.id);
    assert.equal(u.nombre, 'María J. López');
    assert.equal(u.colegiado, 'COL-77');
    assert.equal(u.atiende_citas, 0);
    assert.equal(u.password_hash, antes);
    const log = rows(db, 'usuario_editado')[0];
    assert.equal(log.usuario_id, adminId);
    assert.equal(log.entidad_id, vet.id);
    assert.equal(log.ip, '10.0.0.9');
    const cambios = JSON.parse(log.detalle).cambios;
    assert.ok(cambios.includes('nombre: María López → María J. López'));
    assert.ok(cambios.includes('atiende citas: sí → no'));
    assert.ok(cambios.includes('colegiado modificado'));
});

test('updateUser: sin cambios no escribe bitácora; usuario inexistente → notFound; datos inválidos → errores', async () => {
    const { db, adminId } = await setup();
    const same = users.updateUser(db, adminId, { nombre: 'Ana Pérez', rol: 'admin', atiende_citas: false }, { actorId: 999 });
    assert.deepEqual(same, { ok: true, sinCambios: true });
    assert.equal(rows(db, 'usuario_editado').length, 0);
    assert.equal(users.updateUser(db, 12345, { nombre: 'X', rol: 'admin' }).notFound, true);
    const bad = users.updateUser(db, adminId, { nombre: '', rol: 'dios' });
    assert.ok(bad.errors.nombre && bad.errors.rol);
});

test('updateUser: no puedes cambiar tu propio rol ni quitar al último administrador', async () => {
    const { db, adminId } = await setup();
    const yo = users.updateUser(db, adminId, { nombre: 'Ana Pérez', rol: 'recepcion' }, { actorId: adminId });
    assert.equal(yo.errors.rol, 'No puedes cambiar tu propio rol.');
    const otro = await users.createUser(db, { usuario: 'bea', nombre: 'Bea', rol: 'admin', ...OK });
    // Con dos administradores, uno puede bajar de rango al otro
    assert.equal(users.updateUser(db, otro.id, { nombre: 'Bea', rol: 'recepcion' }, { actorId: adminId }).ok, true);
    // Ahora Ana vuelve a ser la única: otro admin inexistente no puede degradarla
    const ultimo = users.updateUser(db, adminId, { nombre: 'Ana Pérez', rol: 'veterinario' }, { actorId: otro.id });
    assert.equal(ultimo.errors.rol, 'Debe quedar al menos un administrador activo.');
    assert.equal(row(db, adminId).rol, 'admin');
});

// ───────── Activar / desactivar
test('setActive: no se desactiva al último administrador ni a uno mismo', async () => {
    const { db, adminId } = await setup();
    assert.equal(users.setActive(db, adminId, false, { actorId: adminId }).message, 'No puedes desactivarte a ti mismo.');
    const rec = await users.createUser(db, { usuario: 'rec1', nombre: 'Rosa', rol: 'recepcion', ...OK });
    const ultimo = users.setActive(db, adminId, false, { actorId: rec.id });
    assert.equal(ultimo.message, 'No se puede desactivar al último administrador activo.');
    assert.equal(row(db, adminId).activo, 1);
    const otro = await users.createUser(db, { usuario: 'bea', nombre: 'Bea', rol: 'admin', ...OK });
    assert.equal(users.setActive(db, otro.id, false, { actorId: adminId }).ok, true);
    assert.equal(users.setActive(db, 999, false, {}).notFound, true);
});

test('setActive: desactivar cierra sus sesiones, impide el login y se puede revertir', async () => {
    const { db, adminId } = await setup();
    const rec = await users.createUser(db, { usuario: 'rec1', nombre: 'Rosa', rol: 'recepcion', ...OK });
    const store = new SqliteStore(db);
    const exp = new Date(Date.now() + 60000).toISOString();
    await new Promise((r) => store.set('s-rec', { cookie: { expires: exp }, userId: rec.id }, r));
    await new Promise((r) => store.set('s-admin', { cookie: { expires: exp }, userId: adminId }, r));

    assert.equal(users.setActive(db, rec.id, false, { actorId: adminId }).ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sesiones WHERE sid = 's-rec'").get().n, 0, 'sus sesiones se cierran');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sesiones WHERE sid = 's-admin'").get().n, 1, 'las ajenas no se tocan');
    assert.equal((await authenticate(db, { usuario: 'rec1', password: OK.password, now: T0 })).ok, false);
    assert.equal(rows(db, 'usuario_desactivado').length, 1);

    assert.equal(users.setActive(db, rec.id, true, { actorId: adminId }).ok, true);
    assert.equal((await authenticate(db, { usuario: 'rec1', password: OK.password, now: T0 })).ok, true);
    assert.equal(rows(db, 'usuario_activado').length, 1);
    assert.deepEqual(users.setActive(db, rec.id, true, { actorId: adminId }), { ok: true, sinCambios: true });
});

// ───────── Contraseña y bloqueo
test('resetPassword: la nueva sirve, la vieja no, se quita el bloqueo y se cierran sesiones', async () => {
    const { db, adminId } = await setup();
    const rec = await users.createUser(db, { usuario: 'rec1', nombre: 'Rosa', rol: 'recepcion', ...OK });
    for (let i = 0; i < 5; i++) await authenticate(db, { usuario: 'rec1', password: 'mal', now: T0 });
    assert.ok(row(db, rec.id).bloqueado_hasta, 'quedó bloqueada');
    const store = new SqliteStore(db);
    await new Promise((r) => store.set('s-rec', { cookie: { expires: new Date(Date.now() + 60000).toISOString() }, userId: rec.id }, r));

    const r = await users.resetPassword(db, rec.id, { password: 'nueva-clave-9', password2: 'nueva-clave-9' }, { actorId: adminId });
    assert.equal(r.ok, true);
    assert.equal(row(db, rec.id).bloqueado_hasta, null);
    assert.equal(row(db, rec.id).intentos_fallidos, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sesiones WHERE sid = 's-rec'").get().n, 0);
    assert.equal((await authenticate(db, { usuario: 'rec1', password: OK.password, now: T0 })).ok, false, 'la vieja ya no sirve');
    assert.equal((await authenticate(db, { usuario: 'rec1', password: 'nueva-clave-9', now: T0 })).ok, true);
});

test('resetPassword: valida y nunca deja la contraseña en la bitácora', async () => {
    const { db, adminId } = await setup();
    assert.match((await users.resetPassword(db, adminId, { password: 'corta', password2: 'corta' })).errors.password, /al menos 8/);
    assert.equal((await users.resetPassword(db, adminId, { password: 'nueva-clave-9', password2: 'distinta-9' })).errors.password2, 'Las contraseñas no coinciden.');
    assert.equal((await users.resetPassword(db, adminId, { password: 'nueva-clave-9' })).errors.password2, 'Repite la contraseña.');
    assert.equal((await users.resetPassword(db, 999, { password: 'nueva-clave-9', password2: 'nueva-clave-9' })).notFound, true);
    await users.resetPassword(db, adminId, { password: 'secreto-super-9', password2: 'secreto-super-9' }, { actorId: adminId });
    const todo = JSON.stringify(db.prepare('SELECT * FROM bitacora').all());
    assert.ok(!todo.includes('secreto-super-9') && !todo.includes('scrypt$'));
    assert.equal(rows(db, 'contrasena_restablecida').length, 1);
});

test('unlockUser: quita el bloqueo sin cambiar la contraseña', async () => {
    const { db, adminId } = await setup();
    const rec = await users.createUser(db, { usuario: 'rec1', nombre: 'Rosa', rol: 'recepcion', ...OK });
    for (let i = 0; i < 5; i++) await authenticate(db, { usuario: 'rec1', password: 'mal', now: T0 });
    assert.equal((await authenticate(db, { usuario: 'rec1', password: OK.password, now: T0 })).reason, 'bloqueado');
    assert.equal(users.unlockUser(db, rec.id, { actorId: adminId }).ok, true);
    assert.equal((await authenticate(db, { usuario: 'rec1', password: OK.password, now: T0 })).ok, true);
    assert.equal(rows(db, 'usuario_desbloqueado').length, 1);
    assert.equal(users.unlockUser(db, 999).notFound, true);
});

// ───────── Bitácora: limpieza, filtros y presentación
test('audit.log omite contraseñas, hashes y tokens a cualquier profundidad', () => {
    const db = testDb();
    audit.log(db, {
        accion: 'prueba', entidad: 'usuario',
        detalle: { usuario: 'ana', password: 'p1', Contraseña: 'p2', anidado: { password_hash: 'h', token: 't', ok: 'visible' }, lista: [{ secret: 's', dato: 'bien' }], csrfToken: 'x' },
    });
    const d = JSON.parse(db.prepare('SELECT detalle FROM bitacora').get().detalle);
    assert.deepEqual(d, { usuario: 'ana', password: '[omitido]', Contraseña: '[omitido]', anidado: { password_hash: '[omitido]', token: '[omitido]', ok: 'visible' }, lista: [{ secret: '[omitido]', dato: 'bien' }], csrfToken: '[omitido]' });
    audit.log(db, { accion: 'sin_detalle', entidad: 'usuario' });
    assert.equal(db.prepare("SELECT detalle FROM bitacora WHERE accion = 'sin_detalle'").get().detalle, null);
});

function llenarBitacora(db, adminId) {
    const ins = db.prepare('INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle, ip, fecha) VALUES (?,?,?,?,?,?,?)');
    ins.run(adminId, 'login', 'usuario', adminId, null, '10.0.0.1', '2026-11-01T05:59:59.000Z'); // 31 oct, 23:59:59 en Managua
    ins.run(adminId, 'login', 'usuario', adminId, null, '10.0.0.1', '2026-11-01T06:00:00.000Z'); // 1 nov, 00:00:00
    ins.run(null, 'login_fallido', 'usuario', null, '{"intento":2}', '10.0.0.2', '2026-11-02T05:59:59.000Z'); // 1 nov, 23:59:59
    ins.run(adminId, 'cita_creada', 'cita', 7, null, null, '2026-11-02T06:00:00.000Z'); // 2 nov, 00:00:00
}

test('consultar: filtra por usuario, entidad y por día completo en hora de Managua', async () => {
    const { db, adminId } = await setup();
    const base = audit.consultar(db).total;
    llenarBitacora(db, adminId);
    assert.equal(audit.consultar(db).total, base + 4);
    assert.equal(audit.consultar(db, { entidad: 'cita' }).total, 1);
    assert.equal(audit.consultar(db, { usuario: adminId, entidad: 'cita' }).filas[0].accion, 'cita_creada');
    assert.equal(audit.consultar(db, { usuario: adminId, entidad: 'usuario', desde: '2026-11-01', hasta: '2026-11-01' }).filas.filter((f) => f.accion === 'login').length, 1, 'el 1 de nov en Managua incluye 00:00:00 y excluye 23:59:59 del 31 oct');
    const dia1 = audit.consultar(db, { desde: '2026-11-01', hasta: '2026-11-01' }).filas.map((f) => f.accion).sort();
    assert.deepEqual(dia1, ['login', 'login_fallido'], 'el día 1 va de 00:00:00 a 23:59:59 hora de Managua');
    assert.equal(audit.consultar(db, { desde: '2026-11-02' }).filas.some((f) => f.accion === 'cita_creada'), true);
    assert.equal(audit.consultar(db, { hasta: '2026-10-31' }).filas.filter((f) => f.accion === 'login' && f.fecha.startsWith('2026-11-01T05')).length, 1);
});

test('consultar: entradas hostiles no rompen la consulta (SQL con parámetros) y sin sesión aparece "Sistema"', async () => {
    const { db, adminId } = await setup();
    llenarBitacora(db, adminId);
    const hostil = audit.consultar(db, { entidad: "usuario'; DROP TABLE bitacora; --" });
    assert.equal(hostil.total, 0);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM bitacora').get().n >= 4, 'la tabla sigue intacta');
    const sinSesion = audit.consultar(db, { entidad: 'usuario' }).filas.find((f) => f.accion === 'login_fallido');
    assert.equal(sinSesion.usuario_nombre, null);
});

test('consultar: pagina de 50 en 50 y ajusta páginas fuera de rango', async () => {
    const { db, adminId } = await setup();
    const ins = db.prepare("INSERT INTO bitacora (usuario_id, accion, entidad, fecha) VALUES (?, 'login', 'usuario', '2026-11-02T10:00:00.000Z')");
    for (let i = 0; i < 120; i++) ins.run(adminId);
    const total = audit.consultar(db).total;
    const p1 = audit.consultar(db, { pagina: 1 });
    assert.equal(p1.filas.length, 50);
    assert.equal(p1.paginas, Math.ceil(total / 50));
    assert.equal(audit.consultar(db, { pagina: 2 }).filas.length, 50);
    assert.equal(audit.consultar(db, { pagina: 999 }).pagina, p1.paginas, 'una página fuera de rango se ajusta a la última');
    assert.ok(audit.consultar(db, { pagina: 1 }).filas[0].id > audit.consultar(db, { pagina: 2 }).filas[0].id, 'lo más reciente primero');
});

test('leerFiltros: conserva los válidos e informa los inválidos sin romper', () => {
    const ok = audit.leerFiltros({ usuario: '3', entidad: 'usuario', desde: '2026-11-01', hasta: '2026-11-30', pagina: '2' });
    assert.deepEqual(ok, { filtros: { usuario: 3, entidad: 'usuario', desde: '2026-11-01', hasta: '2026-11-30', pagina: 2 }, errores: {} });
    const mixto = audit.leerFiltros({ usuario: 'abc', desde: '2026-02-30', hasta: '2026-11-30', entidad: '' });
    assert.equal(mixto.filtros.hasta, '2026-11-30');
    assert.equal(mixto.filtros.usuario, undefined);
    assert.equal(mixto.filtros.desde, undefined);
    assert.ok(mixto.errores.usuario && mixto.errores.desde);
    assert.deepEqual(audit.leerFiltros({}).filtros, {});
    assert.ok(audit.leerFiltros({ usuario: ['1', '2'] }).errores.usuario);
});

test('detalleATexto, etiquetas y fechas legibles', () => {
    assert.equal(audit.detalleATexto('{"intento":2}'), 'intento: 2');
    assert.equal(audit.detalleATexto('{"cambios":["rol: a → b","nombre: x → y"]}'), 'cambios: rol: a → b; nombre: x → y');
    assert.equal(audit.detalleATexto('{"a":{"b":1}}'), 'a: b: 1');
    assert.equal(audit.detalleATexto(null), '');
    assert.equal(audit.detalleATexto('no es json'), '');
    assert.equal(audit.etiquetaAccion('login'), 'Inicio de sesión');
    assert.equal(audit.etiquetaAccion('algo_nuevo'), 'algo_nuevo');
    assert.equal(audit.etiquetaEntidad('usuario'), 'Usuario');
    assert.equal(formatDateTime('2026-11-02T15:05:00Z'), '02/11/2026 09:05');
    assert.equal(formatDateTime('2026-11-02T05:59:00Z'), '01/11/2026 23:59');
    assert.equal(formatDateTime('basura'), '');
    assert.deepEqual(managuaDayRange('2026-11-02'), { from: '2026-11-02T06:00:00.000Z', to: '2026-11-03T06:00:00.000Z' });
    assert.deepEqual(managuaDayRange('2026-12-31'), { from: '2026-12-31T06:00:00.000Z', to: '2027-01-01T06:00:00.000Z' });
});

test('pager: enlaces anterior/siguiente que conservan los filtros y omiten los vacíos', () => {
    const p = pager({ pagina: 2, paginas: 3, total: 120, ruta: '/ajustes/bitacora', filtros: { usuario: 4, entidad: 'usuario', desde: undefined, hasta: '' } });
    assert.equal(p.prev, '/ajustes/bitacora?usuario=4&entidad=usuario');
    assert.equal(p.next, '/ajustes/bitacora?usuario=4&entidad=usuario&pagina=3');
    const primera = pager({ pagina: 1, paginas: 1, total: 3, ruta: '/x', filtros: {} });
    assert.equal(primera.prev, null);
    assert.equal(primera.next, null);
});
