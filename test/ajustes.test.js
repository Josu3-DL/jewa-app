'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z');

async function setup() {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    const ids = { admin: await mk('ana', 'Ana Pérez', 'admin'), vet: await mk('vet1', 'María López', 'veterinario'), rec: await mk('rec1', 'Rosa Díaz', 'recepcion') };
    return { db, app, ids };
}

/** GET de una página con formulario (para el token) y luego POST con ese token. */
async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const formNuevo = (extra = {}) => ({ nombre: 'Luis Mora', usuario: 'luis', rol: 'recepcion', colegiado: '', password: CLAVE, password2: CLAVE, ...extra });
const userRow = (db, id) => db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
const audits = (db, accion) => db.prepare('SELECT * FROM bitacora WHERE accion = ? ORDER BY id').all(accion);

// ───────── Pantallas
test('Usuarios: el administrador ve la lista, el formulario de alta y las pestañas', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await getHtml(admin, '/ajustes/usuarios');
    assert.equal(res.status, 200);
    assert.match(res.text, /<h1>Usuarios<\/h1>/);
    assert.match(res.text, /Nuevo usuario/);
    for (const nombre of ['Ana Pérez', 'María López', 'Rosa Díaz']) assert.ok(res.text.includes(nombre), nombre);
    assert.match(res.text, /<a class="tab is-active" href="\/ajustes\/usuarios" aria-current="page">Usuarios<\/a>/);
    assert.match(res.text, /<a class="nav-link is-active" href="\/ajustes" aria-current="page"><span>10<\/span> Ajustes<\/a>/);
    assert.match(res.text, /<option value="veterinario">Veterinario<\/option>/);
    assert.match(res.text, /Activo/);
    const clinica = await getHtml(admin, '/ajustes');
    assert.equal(clinica.status, 200);
    assert.match(clinica.text, /Datos de la clínica/);
    assert.match(clinica.text, /href="\/ajustes\/bitacora"/);
});

test('crear usuario: redirige, avisa una sola vez, queda en la lista y en la bitácora, y puede entrar', async () => {
    const { app, db } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await post(admin, '/ajustes/usuarios', '/ajustes/usuarios', formNuevo({ nombre: 'María Vet', usuario: 'mvet', rol: 'veterinario', colegiado: 'COL-55', atiende_citas: 'on' }));
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/ajustes/usuarios');

    const lista = await getHtml(admin, '/ajustes/usuarios');
    assert.match(lista.text, /<p class="alert alert-ok" role="status">Usuario &#34;mvet&#34; creado\.<\/p>/);
    assert.ok(lista.text.includes('María Vet'));
    assert.match(lista.text, /mvet · Veterinario · Col\. COL-55 · Atiende citas/);
    const otra = await getHtml(admin, '/ajustes/usuarios');
    assert.doesNotMatch(otra.text, /alert-ok/, 'el aviso se muestra una sola vez');

    const log = audits(db, 'usuario_creado').pop();
    assert.equal(log.usuario_id, 1);
    assert.equal(JSON.parse(log.detalle).usuario, 'mvet');
    const nuevo = await loginAs(app, 'mvet', CLAVE);
    assert.equal((await getHtml(nuevo, '/')).status, 200);
});

test('crear usuario: errores por campo (400), conserva lo escrito y NUNCA devuelve las contraseñas', async () => {
    const { app, db } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const antes = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;

    const vacio = await post(admin, '/ajustes/usuarios', '/ajustes/usuarios', { nombre: '', usuario: '', rol: 'recepcion', password: '', password2: '' });
    assert.equal(vacio.status, 400);
    assert.match(vacio.text, /id="f-nombre-err">Este campo es obligatorio\./);
    assert.match(vacio.text, /id="f-usuario-err">Este campo es obligatorio\./);

    const mal = await post(admin, '/ajustes/usuarios', '/ajustes/usuarios', formNuevo({ nombre: 'Luis Mora', usuario: 'luis!', password: 'secreta-xyz-1', password2: 'otra-xyz-22' }));
    assert.equal(mal.status, 400);
    assert.match(mal.text, /Solo letras, números, punto, guion y guion bajo\./);
    assert.match(mal.text, /Las contraseñas no coinciden\./);
    assert.match(mal.text, /value="Luis Mora"/, 'conserva el nombre');
    assert.doesNotMatch(mal.text, /secreta-xyz-1|otra-xyz-22/, 'no devuelve las contraseñas');

    const corta = await post(admin, '/ajustes/usuarios', '/ajustes/usuarios', formNuevo({ password: 'corta', password2: 'corta' }));
    assert.match(corta.text, /al menos 8 caracteres/);

    const dup = await post(admin, '/ajustes/usuarios', '/ajustes/usuarios', formNuevo({ usuario: 'ANA' }));
    assert.equal(dup.status, 400);
    assert.match(dup.text, /Ya existe un usuario con ese nombre\./);

    const rolMalo = await post(admin, '/ajustes/usuarios', '/ajustes/usuarios', formNuevo({ rol: 'dios' }));
    assert.match(rolMalo.text, /Rol no válido\./);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n, antes, 'no se creó ninguno');
});

test('XSS: nombres con HTML se muestran escapados en la lista, el aviso y la edición', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    await post(admin, '/ajustes/usuarios', '/ajustes/usuarios', formNuevo({ nombre: '<script>alert(1)</script>', usuario: 'hacker' }));
    const lista = await getHtml(admin, '/ajustes/usuarios');
    assert.doesNotMatch(lista.text, /<script>alert\(1\)<\/script>/);
    assert.match(lista.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const id = /href="\/ajustes\/usuarios\/(\d+)\/editar" aria-label="Editar a &lt;script/.exec(lista.text)[1];
    const edit = await getHtml(admin, `/ajustes/usuarios/${id}/editar`);
    assert.doesNotMatch(edit.text, /<script>alert\(1\)<\/script>/);
});

// ───────── Edición
test('editar: guarda datos, avisa y deja la bitácora; el rol propio no se puede cambiar', async () => {
    const { app, db, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const url = `/ajustes/usuarios/${ids.vet}/editar`;
    const form = await getHtml(admin, url);
    assert.equal(form.status, 200);
    assert.match(form.text, /value="María López"/);
    assert.match(form.text, /<option value="veterinario" selected>/);

    const res = await post(admin, url, `/ajustes/usuarios/${ids.vet}`, { nombre: 'María J. López', rol: 'veterinario', colegiado: 'COL-9', atiende_citas: 'on' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, url);
    assert.match((await getHtml(admin, url)).text, /Datos guardados\./);
    assert.equal(userRow(db, ids.vet).nombre, 'María J. López');
    assert.equal(userRow(db, ids.vet).colegiado, 'COL-9');
    assert.ok(audits(db, 'usuario_editado').length >= 1);

    const sinCambios = await post(admin, url, `/ajustes/usuarios/${ids.vet}`, { nombre: 'María J. López', rol: 'veterinario', colegiado: 'COL-9', atiende_citas: 'on' });
    assert.match((await getHtml(admin, sinCambios.headers.location)).text, /No había cambios que guardar\./);

    const propio = await post(admin, `/ajustes/usuarios/${ids.admin}/editar`, `/ajustes/usuarios/${ids.admin}`, { nombre: 'Ana Pérez', rol: 'recepcion' });
    assert.equal(propio.status, 400);
    assert.match(propio.text, /No puedes cambiar tu propio rol\./);
    assert.equal(userRow(db, ids.admin).rol, 'admin');
    const yo = await getHtml(admin, `/ajustes/usuarios/${ids.admin}/editar`);
    assert.match(yo.text, /<button class="button button-danger" type="submit" disabled>Desactivar usuario<\/button>/, 'no puede desactivarse a sí mismo');
});

test('editar: datos inválidos devuelven 400 en el formulario correcto', async () => {
    const { app, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await post(admin, `/ajustes/usuarios/${ids.rec}/editar`, `/ajustes/usuarios/${ids.rec}`, { nombre: '', rol: 'dios' });
    assert.equal(res.status, 400);
    assert.match(res.text, /id="f-nombre-err">Este campo es obligatorio\./);
    assert.match(res.text, /Rol no válido\./);
});

// ───────── Estado, contraseña y bloqueo (con sesiones reales)
test('desactivar: el usuario pierde su sesión al instante, no puede entrar y puede reactivarse', async () => {
    const { app, db, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const rec = await loginAs(app, 'rec1', CLAVE);
    assert.equal((await getHtml(rec, '/citas')).status, 200);

    const res = await post(admin, `/ajustes/usuarios/${ids.rec}/editar`, `/ajustes/usuarios/${ids.rec}/estado`, { accion: 'desactivar' });
    assert.equal(res.status, 302);
    assert.match((await getHtml(admin, res.headers.location)).text, /Usuario desactivado\./);
    const caido = await getHtml(rec, '/citas');
    assert.equal(caido.status, 302);
    assert.match(caido.headers.location, /^\/login/);
    const intento = await request(app).get('/login').then(async (p) => request.agent(app).post('/login').type('form').send({ _csrf: csrfIn(p.text), usuario: 'rec1', password: CLAVE }));
    assert.notEqual(intento.status, 302, 'un usuario desactivado no puede entrar');
    assert.equal(userRow(db, ids.rec).activo, 0);

    const lista = await getHtml(admin, '/ajustes/usuarios');
    assert.match(lista.text, /status-waiting">Inactivo</);
    await post(admin, `/ajustes/usuarios/${ids.rec}/editar`, `/ajustes/usuarios/${ids.rec}/estado`, { accion: 'activar' });
    assert.equal(userRow(db, ids.rec).activo, 1);
    assert.equal((await getHtml(await loginAs(app, 'rec1', CLAVE), '/citas')).status, 200);
});

test('desactivar: el último administrador y uno mismo están protegidos (aviso en rojo)', async () => {
    const { app, db, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await post(admin, `/ajustes/usuarios/${ids.admin}/editar`, `/ajustes/usuarios/${ids.admin}/estado`, { accion: 'desactivar' });
    assert.match((await getHtml(admin, res.headers.location)).text, /<p class="alert alert-error" role="alert">No puedes desactivarte a ti mismo\./);
    assert.equal(userRow(db, ids.admin).activo, 1);

    // Con dos administradores, uno sí puede desactivar al otro (siempre queda uno activo).
    // La regla "último administrador" sobre un tercero no es alcanzable por HTTP (solo administradores usan estas
    // rutas); queda cubierta en test/usuarios-services.test.js.
    const bea = (await users.createUser(db, { usuario: 'bea', nombre: 'Bea Ruiz', rol: 'admin', password: CLAVE, password2: CLAVE })).id;
    const sesionBea = await loginAs(app, 'bea', CLAVE);
    const res2 = await post(admin, `/ajustes/usuarios/${bea}/editar`, `/ajustes/usuarios/${bea}/estado`, { accion: 'desactivar' });
    assert.match((await getHtml(admin, res2.headers.location)).text, /Usuario desactivado\./);
    assert.equal((await getHtml(sesionBea, '/ajustes/usuarios')).status, 302, 'la sesión de Bea se cerró');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol='admin' AND activo=1").get().n, 1, 'queda un administrador activo');
});

test('restablecer contraseña: cierra la sesión del usuario, la vieja deja de servir y la nueva funciona', async () => {
    const { app, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const rec = await loginAs(app, 'rec1', CLAVE);
    const url = `/ajustes/usuarios/${ids.rec}/editar`;

    const mal = await post(admin, url, `/ajustes/usuarios/${ids.rec}/contrasena`, { password: 'nueva-clave-9', password2: 'distinta-clave' });
    assert.equal(mal.status, 400);
    assert.match(mal.text, /Las contraseñas no coinciden\./);
    assert.equal((await getHtml(rec, '/citas')).status, 200, 'un intento fallido no cierra la sesión');

    const ok = await post(admin, url, `/ajustes/usuarios/${ids.rec}/contrasena`, { password: 'nueva-clave-9', password2: 'nueva-clave-9' });
    assert.equal(ok.status, 302);
    assert.match((await getHtml(admin, url)).text, /Contraseña restablecida\./);
    const cerrada = await getHtml(rec, '/citas');
    assert.equal(cerrada.status, 302, 'su sesión abierta se cerró');
    await assert.rejects(() => loginAs(app, 'rec1', CLAVE), /No se pudo iniciar sesión/);
    assert.equal((await getHtml(await loginAs(app, 'rec1', 'nueva-clave-9'), '/citas')).status, 200);
});

test('desbloquear: tras 5 fallos la cuenta aparece bloqueada y el administrador puede liberarla', async () => {
    const { app, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    for (let i = 0; i < 5; i++) await assert.rejects(() => loginAs(app, 'rec1', 'mal-mal-mal'));
    const url = `/ajustes/usuarios/${ids.rec}/editar`;
    const pantalla = await getHtml(admin, url);
    assert.match(pantalla.text, /Bloqueada por intentos fallidos hasta el 02\/11\/2026 09:15\./);
    assert.match(pantalla.text, /Desbloquear cuenta/);
    assert.match((await getHtml(admin, '/ajustes/usuarios')).text, /status-cancelled">Bloqueado</);

    await post(admin, url, `/ajustes/usuarios/${ids.rec}/desbloquear`);
    assert.match((await getHtml(admin, url)).text, /Cuenta desbloqueada\./);
    assert.doesNotMatch((await getHtml(admin, url)).text, /Desbloquear cuenta/);
    assert.equal((await getHtml(await loginAs(app, 'rec1', CLAVE), '/citas')).status, 200);
});

// ───────── Permisos (T-03) y protección
test('T-03: veterinario y recepcionista reciben 403 en TODAS las pantallas y acciones de Ajustes', async () => {
    const { app, db, ids } = await setup();
    const antes = JSON.stringify(db.prepare('SELECT * FROM usuarios').all());
    const accionesAuditadas = () => db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion <> 'login'").get().n;
    const nAudit = accionesAuditadas();
    for (const [usuario, clave] of [['vet1', CLAVE], ['rec1', CLAVE]]) {
        const agent = await loginAs(app, usuario, clave);
        for (const url of ['/ajustes', '/ajustes/usuarios', `/ajustes/usuarios/${ids.admin}/editar`, '/ajustes/bitacora']) {
            assert.equal((await getHtml(agent, url)).status, 403, `${usuario} GET ${url}`);
        }
        const token = csrfIn((await getHtml(agent, '/citas')).text); // token válido de su propia sesión
        const acciones = [
            ['/ajustes/usuarios', formNuevo({ usuario: `h${usuario}` })],
            [`/ajustes/usuarios/${ids.admin}`, { nombre: 'Hackeado', rol: 'admin' }],
            [`/ajustes/usuarios/${ids.admin}/contrasena`, { password: 'hackeada-123', password2: 'hackeada-123' }],
            [`/ajustes/usuarios/${ids.admin}/estado`, { accion: 'desactivar' }],
            [`/ajustes/usuarios/${ids.admin}/desbloquear`, {}],
        ];
        for (const [url, body] of acciones) {
            const res = await agent.post(url).type('form').send({ _csrf: token, ...body });
            assert.equal(res.status, 403, `${usuario} POST ${url}`);
        }
    }
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM usuarios').all()), antes, 'no cambió ningún usuario');
    assert.equal(accionesAuditadas(), nAudit, 'los intentos rechazados no dejan acciones nuevas en la bitácora (solo los inicios de sesión)');
});

test('sin sesión: las pantallas redirigen a /login y las acciones exigen CSRF', async () => {
    const { app, db, ids } = await setup();
    for (const url of ['/ajustes', '/ajustes/usuarios', '/ajustes/bitacora']) {
        const res = await request(app).get(url).set('Accept', 'text/html');
        assert.equal(res.status, 302, url);
        assert.match(res.headers.location, /^\/login/);
    }
    const res = await request(app).post(`/ajustes/usuarios/${ids.rec}/estado`).type('form').send({ accion: 'desactivar' });
    assert.equal(res.status, 403);
    assert.equal(userRow(db, ids.rec).activo, 1);
});

test('el administrador sin token CSRF no puede ejecutar acciones (403)', async () => {
    const { app, db, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const res = await admin.post(`/ajustes/usuarios/${ids.rec}/estado`).type('form').send({ accion: 'desactivar' });
    assert.equal(res.status, 403);
    assert.match(res.text, /expiró o no es válido/);
    assert.equal(userRow(db, ids.rec).activo, 1);
});

test('identificadores inválidos o inexistentes dan 404 y acciones desconocidas 400', async () => {
    const { app } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    for (const id of ['abc', '0', '-3', '99999', '1.5']) {
        assert.equal((await getHtml(admin, `/ajustes/usuarios/${id}/editar`)).status, 404, `editar ${id}`);
    }
    assert.equal((await post(admin, '/ajustes/usuarios', '/ajustes/usuarios/99999', { nombre: 'X', rol: 'admin' })).status, 404);
    assert.equal((await post(admin, '/ajustes/usuarios', '/ajustes/usuarios/99999/estado', { accion: 'desactivar' })).status, 404);
    assert.equal((await post(admin, '/ajustes/usuarios', '/ajustes/usuarios/1/estado', { accion: 'borrar' })).status, 400);
    assert.equal((await post(admin, '/ajustes/usuarios', '/ajustes/usuarios/1/estado', {})).status, 400);
});

// ───────── Bitácora
test('bitácora: lista lo ocurrido con usuario, acción en español, entidad y hora de Managua', async () => {
    const { app, db, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    await post(admin, '/ajustes/usuarios', '/ajustes/usuarios', formNuevo({ usuario: 'luis', password: 'secreta-bita-1', password2: 'secreta-bita-1' }));
    db.prepare("INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle, ip, fecha) VALUES (?, 'login_fallido', 'usuario', NULL, '{\"intento\":2}', '10.0.0.7', '2026-11-02T15:05:00.000Z')").run(ids.rec);
    const res = await getHtml(admin, '/ajustes/bitacora');
    assert.equal(res.status, 200);
    assert.match(res.text, /<h1>Bitácora<\/h1>/);
    assert.match(res.text, /<a class="tab is-active" href="\/ajustes\/bitacora" aria-current="page">Bitácora<\/a>/);
    assert.match(res.text, /Inicio de sesión/);
    assert.match(res.text, /Usuario creado/);
    assert.match(res.text, /Rosa Díaz \(rec1\)/);
    assert.match(res.text, /02\/11\/2026 09:05/, 'fecha en hora de Managua');
    assert.match(res.text, /intento: 2/);
    assert.match(res.text, /class="table-scroll"/);
    assert.doesNotMatch(res.text, /secreta-bita-1|scrypt\$/, 'ni contraseñas ni hashes');
});

test('bitácora: filtros por usuario, entidad y fechas (y selección recordada en el formulario)', async () => {
    const { app, db, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const ins = db.prepare('INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, fecha) VALUES (?,?,?,?,?)');
    ins.run(ids.rec, 'cita_creada', 'cita', 41, '2026-10-30T15:00:00.000Z');
    ins.run(ids.vet, 'consulta_creada', 'consulta', 52, '2026-11-02T15:00:00.000Z');

    const porEntidad = await getHtml(admin, '/ajustes/bitacora?entidad=cita');
    assert.match(porEntidad.text, /cita_creada/);
    assert.doesNotMatch(porEntidad.text, /consulta_creada/);
    assert.match(porEntidad.text, /<option value="cita" selected>Cita<\/option>/);

    const porUsuario = await getHtml(admin, `/ajustes/bitacora?usuario=${ids.vet}`);
    assert.match(porUsuario.text, /consulta_creada/);
    assert.doesNotMatch(porUsuario.text, /cita_creada/);
    assert.match(porUsuario.text, new RegExp(`<option value="${ids.vet}" selected>`));

    const porFecha = await getHtml(admin, '/ajustes/bitacora?desde=2026-11-02&hasta=2026-11-02');
    assert.match(porFecha.text, /consulta_creada/);
    assert.doesNotMatch(porFecha.text, /cita_creada/);
    assert.match(porFecha.text, /name="desde" type="date" value="2026-11-02"/);

    const vacio = await getHtml(admin, '/ajustes/bitacora?desde=2099-01-01');
    assert.match(vacio.text, /No hay registros con esos filtros\./);
});

test('bitácora: filtros inválidos no rompen la pantalla; entradas hostiles quedan escapadas', async () => {
    const { app, db, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    db.prepare("INSERT INTO bitacora (usuario_id, accion, entidad, detalle, fecha) VALUES (?, 'x', 'usuario', ?, '2026-11-02T15:00:00.000Z')")
        .run(ids.rec, JSON.stringify({ nota: '<img src=x onerror=alert(1)>' }));
    const mala = await getHtml(admin, '/ajustes/bitacora?desde=2026-02-30&usuario=abc&pagina=-5');
    assert.equal(mala.status, 200);
    assert.match(mala.text, /id="f-desde-err">Fecha no válida\./);
    const hostil = await getHtml(admin, `/ajustes/bitacora?${new URLSearchParams({ entidad: "usuario'; DROP TABLE bitacora; --" })}`);
    assert.equal(hostil.status, 200);
    assert.match(hostil.text, /No hay registros con esos filtros\./);
    const normal = await getHtml(admin, '/ajustes/bitacora');
    assert.doesNotMatch(normal.text, /<img src=x/);
    assert.match(normal.text, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM bitacora').get().n > 0);
});

test('bitácora: pagina de 50 en 50 y los enlaces conservan los filtros', async () => {
    const { app, db, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const ins = db.prepare("INSERT INTO bitacora (usuario_id, accion, entidad, fecha) VALUES (?, 'login', 'usuario', '2026-11-02T10:00:00.000Z')");
    for (let i = 0; i < 120; i++) ins.run(ids.rec);
    const p1 = await getHtml(admin, '/ajustes/bitacora?entidad=usuario');
    assert.match(p1.text, /Página 1 de 3/);
    assert.match(p1.text, /href="\/ajustes\/bitacora\?entidad=usuario&amp;pagina=2"/);
    assert.equal((p1.text.match(/<td class="nowrap">/g) || []).length / 2, 50, '50 filas por página (cada fila tiene 2 celdas nowrap)');
    const p3 = await getHtml(admin, '/ajustes/bitacora?entidad=usuario&pagina=3');
    assert.match(p3.text, /Página 3 de 3/);
    assert.match(p3.text, /href="\/ajustes\/bitacora\?entidad=usuario&amp;pagina=2"/, 'anterior');
    assert.match(p3.text, /pagination-off">Siguiente/);
    assert.match((await getHtml(admin, '/ajustes/bitacora?pagina=9999')).text, /Página 3 de 3|Página 4 de 4|Página \d+ de \d+/);
});

test('las pantallas nuevas no usan scripts, estilos ni eventos en línea (compatibles con la CSP)', async () => {
    const { app, ids } = await setup();
    const admin = await loginAs(app, 'ana', CLAVE);
    const pantallas = ['/ajustes', '/ajustes/usuarios', `/ajustes/usuarios/${ids.rec}/editar`, '/ajustes/bitacora'];
    for (const url of pantallas) {
        const html = (await getHtml(admin, url)).text;
        assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `script en línea en ${url}`);
        assert.doesNotMatch(html, /\sstyle\s*=/i, `style en línea en ${url}`);
        assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `evento en línea en ${url}`);
        assert.match(html, /name="viewport"/);
        assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i, `recurso externo en ${url}`);
    }
});
