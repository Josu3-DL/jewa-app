'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createUser } = require('../src/services/users');
const { buildConfig } = require('../src/config');
const { testDb, testConfig } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const csrfIn = (html) => (/name="_csrf" value="([0-9a-f]{64})"/.exec(html) || [])[1];
const sidOf = (res) => ((res.headers['set-cookie'] || []).map((c) => /jewa\.sid=([^;]+)/.exec(c)).find(Boolean) || [])[1];

async function setup({ config = {}, withUser = true } = {}) {
    const db = testDb();
    let clock = new Date('2026-11-02T15:00:00Z');
    const app = createApp({ db, config: testConfig(config), now: () => clock });
    if (withUser) await createUser(db, { usuario: 'ana', nombre: 'Ana Pérez', rol: 'admin', password: 'secreto123' });
    return { db, app, setClock: (d) => { clock = d; }, advance: (ms) => { clock = new Date(clock.getTime() + ms); } };
}

async function login(agent, { usuario = 'ana', password = 'secreto123', next } = {}) {
    const page = await agent.get('/login');
    return agent.post('/login').type('form').send({ _csrf: csrfIn(page.text), usuario, password, ...(next ? { next } : {}) });
}

// ───────── Login
test('GET /login muestra el formulario con token CSRF y sin recursos externos', async () => {
    const { app } = await setup();
    const res = await request(app).get('/login').set('Accept', 'text/html');
    assert.equal(res.status, 200);
    assert.match(res.text, /<form class="data-form auth-card" method="post" action="\/login"/);
    assert.ok(csrfIn(res.text), 'el formulario lleva token');
    assert.match(res.text, /autocomplete="username"/);
    assert.match(res.text, /autocomplete="current-password"/);
    assert.match(res.text, /name="viewport"/);
    assert.doesNotMatch(res.text, /(?:src|href)=["']https?:\/\//i);
});

test('la cookie de sesión es HttpOnly, SameSite=Lax y expira a los 30 minutos', async () => {
    const { app } = await setup();
    const res = await request(app).get('/login');
    const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('jewa.sid='));
    assert.ok(cookie, 'se crea la cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /;\s*Secure/i, 'COOKIE_SECURE=false en la LAN (D-25)');
    const minutes = (new Date(/Expires=([^;]+)/i.exec(cookie)[1]).getTime() - Date.now()) / 60000;
    assert.ok(minutes > 28 && minutes < 31, `expira en ${minutes.toFixed(1)} min`);
});

test('SESSION_MINUTES cambia la expiración y se valida', async () => {
    const { app } = await setup({ config: { SESSION_MINUTES: '10' } });
    const cookie = (await request(app).get('/login')).headers['set-cookie'].find((c) => c.startsWith('jewa.sid='));
    const minutes = (new Date(/Expires=([^;]+)/i.exec(cookie)[1]).getTime() - Date.now()) / 60000;
    assert.ok(minutes > 8 && minutes < 11);
    assert.throws(() => buildConfig({ SESSION_MINUTES: '1' }), /SESSION_MINUTES/);
    assert.throws(() => buildConfig({ SESSION_MINUTES: 'x' }), /SESSION_MINUTES/);
    assert.equal(buildConfig({}).sessionMinutes, 30);
});

test('los estáticos y /salud no crean sesión', async () => {
    const { app } = await setup();
    for (const url of ['/salud', '/css/styles.css', '/js/app.js', '/img/hero.svg']) {
        const res = await request(app).get(url);
        assert.equal(res.headers['set-cookie'], undefined, url);
    }
});

test('login correcto: redirige a /, rota la sesión y muestra al usuario', async () => {
    const { app, db } = await setup();
    const agent = request.agent(app);
    const before = await agent.get('/login');
    const preSid = sidOf(before);
    const res = await agent.post('/login').type('form').send({ _csrf: csrfIn(before.text), usuario: 'ana', password: 'secreto123' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
    const postSid = sidOf(res);
    assert.ok(postSid && postSid !== preSid, 'la sesión cambia al autenticar (anti fijación)');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sesiones WHERE sid = ?').get(decodeURIComponent(preSid).slice(2).split('.')[0]).n, 0, 'la sesión anterior se destruye');
    const home = await agent.get('/').set('Accept', 'text/html');
    assert.equal(home.status, 200);
    assert.match(home.text, /<strong>Ana Pérez<\/strong><span>Administrador<\/span>/);
});

test('GET /login con sesión activa redirige a /', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    await login(agent);
    const res = await agent.get('/login');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
});

test('T-01: error genérico igual para contraseña mala y usuario inexistente (sin enumerar usuarios)', async () => {
    const { app } = await setup();
    const a = await login(request.agent(app), { password: 'incorrecta' });
    const b = await login(request.agent(app), { usuario: 'fantasma', password: 'incorrecta' });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    const msg = (r) => /<p class="alert alert-error" role="alert">([^<]+)</.exec(r.text)[1];
    assert.equal(msg(a), 'Usuario o contraseña incorrectos.');
    assert.equal(msg(a), msg(b));
    assert.doesNotMatch(a.text, /secreto123|incorrecta/);
});

test('T-01: el 5.º fallo bloquea y la 6.ª petición con la clave correcta responde 429 con los minutos', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    for (let i = 0; i < 4; i++) assert.equal((await login(agent, { password: 'mal' })).status, 401);
    const fifth = await login(agent, { password: 'mal' });
    assert.equal(fifth.status, 429);
    assert.match(fifth.text, /Cuenta bloqueada temporalmente.*15 minutos/);
    const right = await login(agent);
    assert.equal(right.status, 429, 'bloqueada aunque la clave sea correcta');
});

test('pasado el bloqueo se puede entrar de nuevo', async () => {
    const { app, advance } = await setup();
    const agent = request.agent(app);
    for (let i = 0; i < 5; i++) await login(agent, { password: 'mal' });
    advance(16 * 60000);
    const res = await login(agent);
    assert.equal(res.status, 302);
});

test('campos vacíos o demasiado largos se rechazan con mensajes por campo (400)', async () => {
    const { app } = await setup();
    const empty = await login(request.agent(app), { usuario: '', password: '' });
    assert.equal(empty.status, 400);
    assert.match(empty.text, /El campo Usuario es obligatorio\./);
    assert.match(empty.text, /Ingresa tu contraseña\./);
    const long = await login(request.agent(app), { usuario: 'ana', password: 'x'.repeat(201) });
    assert.equal(long.status, 400);
});

// ───────── next / redirecciones abiertas
test('el redireccionamiento tras el login solo admite rutas internas', async () => {
    const { app } = await setup();
    for (const [next, expected] of [
        ['/citas', '/citas'],
        ['/citas?tipo=grooming', '/citas?tipo=grooming'],
        ['//evil.com', '/'],
        ['/\\evil.com', '/'],
        ['https://evil.com', '/'],
        ['javascript:alert(1)', '/'],
        ['/login', '/'],
        ['/logout', '/'],
        ['citas', '/'],
        ['/' + 'a'.repeat(300), '/'],
    ]) {
        const res = await login(request.agent(app), { next });
        assert.equal(res.status, 302, next);
        assert.equal(res.headers.location, expected, `next=${next}`);
    }
});

test('una página protegida sin sesión lleva a /login?next= y vuelve a ella tras entrar', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const redirect = await agent.get('/citas').set('Accept', 'text/html');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, '/login?next=%2Fcitas');
    const form = await agent.get(redirect.headers.location);
    assert.match(form.text, /<input type="hidden" name="next" value="\/citas">/);
    const res = await agent.post('/login').type('form').send({ _csrf: csrfIn(form.text), usuario: 'ana', password: 'secreto123', next: '/citas' });
    assert.equal(res.headers.location, '/citas');
});

// ───────── CSRF (T-04)
test('T-04: POST /login sin token, con token falso o con token ajeno → 403', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    await agent.get('/login');
    const none = await agent.post('/login').type('form').send({ usuario: 'ana', password: 'secreto123' });
    assert.equal(none.status, 403);
    assert.match(none.text, /expiró o no es válido/);
    const fake = await agent.post('/login').type('form').send({ _csrf: 'a'.repeat(64), usuario: 'ana', password: 'secreto123' });
    assert.equal(fake.status, 403);
    const other = request.agent(app);
    const foreign = csrfIn((await other.get('/login')).text);
    const stolen = await agent.post('/login').type('form').send({ _csrf: foreign, usuario: 'ana', password: 'secreto123' });
    assert.equal(stolen.status, 403, 'el token de otra sesión no sirve');
});

test('T-04: sin sesión previa un POST directo es rechazado', async () => {
    const { app } = await setup();
    const res = await request(app).post('/login').type('form').send({ usuario: 'ana', password: 'secreto123' });
    assert.equal(res.status, 403);
});

test('el token también se acepta en la cabecera X-CSRF-Token', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const token = csrfIn((await agent.get('/login')).text);
    const res = await agent.post('/login').set('X-CSRF-Token', token).type('form').send({ usuario: 'ana', password: 'secreto123' });
    assert.equal(res.status, 302);
});

test('si llega Origin debe coincidir con el host (defensa adicional)', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const token = csrfIn((await agent.get('/login')).text);
    const send = (origin) => agent.post('/login').set('Host', '192.168.1.50:3000').set('Origin', origin).type('form').send({ _csrf: token, usuario: 'ana', password: 'secreto123' });
    assert.equal((await send('http://evil.example')).status, 403);
    assert.equal((await send('null')).status, 403);
    assert.equal((await send('http://192.168.1.50:3000')).status, 302);
});

test('un POST a cualquier ruta autenticada sin token también da 403', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    await login(agent);
    assert.equal((await agent.post('/citas').type('form').send({})).status, 403);
    assert.equal((await agent.post('/logout').type('form').send({})).status, 403);
});

// ───────── Cierre de sesión (T-02)
test('T-02: cerrar sesión invalida la sesión en el servidor, no solo la cookie', async () => {
    const { app, db } = await setup();
    const agent = request.agent(app);
    await login(agent);
    const home = await agent.get('/').set('Accept', 'text/html');
    const cookie = agent.jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false })
        .find((c) => c.name === 'jewa.sid');
    const raw = decodeURIComponent(cookie.value);
    const sid = raw.slice(2).split('.')[0];
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sesiones WHERE sid = ?').get(sid).n, 1);

    const out = await agent.post('/logout').type('form').send({ _csrf: csrfIn(home.text) });
    assert.equal(out.status, 302);
    assert.equal(out.headers.location, '/login');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sesiones WHERE sid = ?').get(sid).n, 0, 'la fila de sesión desaparece');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'logout'").get().n, 1);

    // Reutilizar la cookie anterior ya no sirve
    const replay = await request(app).get('/').set('Cookie', `jewa.sid=${cookie.value}`).set('Accept', 'text/html');
    assert.equal(replay.status, 302);
    assert.equal(replay.headers.location, '/login');
});

test('una cookie de sesión inventada no concede acceso ni se reutiliza (fijación)', async () => {
    const { app } = await setup();
    const forged = 'jewa.sid=s%3Aatacante123.firmafalsa';
    const res = await request(app).get('/login').set('Cookie', forged);
    assert.equal(res.status, 200);
    const issued = sidOf(res);
    assert.ok(issued && !issued.includes('atacante123'), 'el servidor emite su propio identificador');
});

// ───────── Expiración y estado del usuario
test('la sesión expira por inactividad (fila vencida en el servidor)', async () => {
    const { app, db } = await setup();
    const agent = request.agent(app);
    await login(agent);
    assert.equal((await agent.get('/').set('Accept', 'text/html')).status, 200);
    db.prepare("UPDATE sesiones SET expira_en = '2000-01-01T00:00:00.000Z'").run();
    const res = await agent.get('/').set('Accept', 'text/html');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
});

test('tope absoluto: tras 12 horas hay que volver a entrar aunque haya actividad', async () => {
    const { app, advance } = await setup();
    const agent = request.agent(app);
    await login(agent);
    advance(11 * 3600 * 1000);
    assert.equal((await agent.get('/').set('Accept', 'text/html')).status, 200);
    advance(2 * 3600 * 1000);
    const res = await agent.get('/').set('Accept', 'text/html');
    assert.equal(res.status, 302);
});

test('un usuario desactivado pierde el acceso de inmediato', async () => {
    const { app, db } = await setup();
    const agent = request.agent(app);
    await login(agent);
    db.prepare("UPDATE usuarios SET activo = 0 WHERE usuario = 'ana'").run();
    const res = await agent.get('/').set('Accept', 'text/html');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
});

test('un cambio de rol se aplica en la siguiente petición', async () => {
    const { app, db } = await setup();
    const agent = request.agent(app);
    await login(agent);
    assert.equal((await agent.get('/historial').set('Accept', 'text/html')).status, 200);
    assert.equal((await agent.get('/ajustes').set('Accept', 'text/html')).status, 200);
    db.prepare("UPDATE usuarios SET rol = 'recepcion' WHERE usuario = 'ana'").run();
    assert.equal((await agent.get('/historial').set('Accept', 'text/html')).status, 403, 'recepción no ve el historial clínico');
    assert.equal((await agent.get('/ajustes').set('Accept', 'text/html')).status, 403);
    assert.equal((await agent.get('/citas').set('Accept', 'text/html')).status, 200);
});

// ───────── Cabeceras (helmet + CSP)
test('CSP restrictiva y cabeceras de seguridad (sin upgrade-insecure-requests en la LAN)', async () => {
    const { app } = await setup();
    const res = await request(app).get('/login');
    const csp = res.headers['content-security-policy'];
    assert.ok(csp, 'hay CSP');
    for (const part of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'", "base-uri 'self'"]) {
        assert.ok(csp.includes(part), `falta ${part}`);
    }
    assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
    assert.ok(!csp.includes('upgrade-insecure-requests'), 'rompería el acceso por HTTP en la red local');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'same-origin');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['strict-transport-security'], undefined, 'HSTS solo con HTTPS');
    assert.ok(res.headers['x-frame-options'] || csp.includes('frame-ancestors'));
});

test('con COOKIE_SECURE=true se envía HSTS', async () => {
    const { app } = await setup({ config: { COOKIE_SECURE: 'true' } });
    const res = await request(app).get('/salud');
    assert.match(res.headers['strict-transport-security'], /max-age=15552000/);
});

test('las cabeceras también están en estáticos, /salud y páginas de error', async () => {
    const { app } = await setup();
    for (const url of ['/salud', '/css/app.css', '/no-existe']) {
        const res = await request(app).get(url).set('Accept', 'text/html');
        assert.ok(res.headers['content-security-policy'], url);
        assert.equal(res.headers['x-content-type-options'], 'nosniff', url);
    }
});

test('ninguna página usa scripts ni estilos en línea (compatible con la CSP)', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const pages = [(await agent.get('/login')).text, (await agent.get('/no-existe').set('Accept', 'text/html')).text];
    await login(agent);
    for (const url of ['/', '/citas', '/ajustes']) pages.push((await agent.get(url).set('Accept', 'text/html')).text);
    pages.push((await agent.get('/historial').set('Accept', 'text/html')).text); // 403
    for (const html of pages) {
        assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'script en línea');
        assert.doesNotMatch(html, /\sstyle\s*=/i, 'atributo style en línea');
        assert.doesNotMatch(html, /<style[\s>]/i, 'bloque style');
        assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'manejador de evento en línea');
    }
});

// ───────── Inyección (T-21)
test('T-21: SQL e HTML en el login no producen errores ni se reflejan sin escapar', async () => {
    const { app, db } = await setup();
    for (const usuario of ["' OR '1'='1", "ana'--", "'; DROP TABLE usuarios; --", '<script>alert(1)</script>', '" onmouseover="alert(1)']) {
        const res = await login(request.agent(app), { usuario, password: "' OR '1'='1" });
        assert.ok([401, 400].includes(res.status), `${usuario} → ${res.status}`);
        assert.doesNotMatch(res.text, /<script>alert\(1\)<\/script>/);
        assert.doesNotMatch(res.text, /value="[^"]*" onmouseover=/);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n, 1, 'la tabla sigue intacta');
});

test('T-21: el nombre tecleado se devuelve escapado en el formulario', async () => {
    const { app } = await setup();
    const res = await login(request.agent(app), { usuario: '<b>"x"</b>', password: 'mal-mal-mal' });
    assert.match(res.text, /value="&lt;b&gt;&#34;x&#34;&lt;\/b&gt;"/);
});

test('un cuerpo demasiado grande se rechaza (413) y no se ejecuta nada', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const token = csrfIn((await agent.get('/login')).text);
    const res = await agent.post('/login').type('form').send({ _csrf: token, usuario: 'ana', password: 'x', relleno: 'y'.repeat(200 * 1024) });
    assert.equal(res.status, 413);
});

test('parámetros repetidos o anidados no rompen el login', async () => {
    const { app } = await setup();
    const agent = request.agent(app);
    const token = csrfIn((await agent.get('/login')).text);
    const res = await agent.post('/login').type('form').send(`_csrf=${token}&usuario=ana&usuario=otro&password[a]=b`);
    assert.equal(res.status, 400);
});

// ───────── Revisión estática del código
function walk(dir, ext, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, ext, out);
        else if (e.name.endsWith(ext)) out.push(full);
    }
    return out;
}

test('revisión: ningún SQL se arma concatenando o interpolando valores', () => {
    const offenders = [];
    for (const file of walk(path.join(ROOT, 'src'), '.js')) {
        const code = fs.readFileSync(file, 'utf8');
        const rel = path.relative(ROOT, file);
        if (/\.(?:prepare|exec)\(\s*`[^`]*\$\{/.test(code)) offenders.push(`${rel}: plantilla con \${} en SQL`);
        if (/\.(?:prepare|exec)\(\s*(['"])(?:(?!\1).)*\1\s*\+/.test(code)) offenders.push(`${rel}: SQL concatenado con +`);
    }
    assert.deepEqual(offenders, []);
});

test('revisión: en las vistas <%- solo se usa para include (nunca con datos de usuario)', () => {
    const offenders = [];
    for (const file of walk(path.join(ROOT, 'src', 'views'), '.ejs')) {
        const code = fs.readFileSync(file, 'utf8');
        for (const m of code.matchAll(/<%-\s*([^%]*)%>/g)) {
            if (!/^include\(/.test(m[1].trim())) offenders.push(`${path.relative(ROOT, file)}: <%- ${m[1].trim()}`);
        }
    }
    assert.deepEqual(offenders, []);
});

test('revisión: las rutas que escriben datos no están fuera de la protección CSRF', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');
    const iCsrf = app.indexOf('app.use(csrf())');
    const iAuth = app.indexOf('app.use(authRoutes(');
    const iPages = app.indexOf('app.use(pageRoutes)');
    assert.ok(iCsrf > 0 && iCsrf < iAuth && iAuth < iPages, 'csrf() debe montarse antes de cualquier ruta');
    assert.ok(app.indexOf('app.use(requireAuth)') > iAuth && app.indexOf('app.use(requireAuth)') < iPages, 'requireAuth va después del login y antes de las páginas');
});

test('el icono de la pestaña es local y está enlazado en login, páginas y errores', async () => {
    const { app } = await setup();
    const res = await request(app).get('/img/favicon.svg');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /svg/);
    const agent = request.agent(app);
    const pages = [(await agent.get('/login')).text];
    await login(agent);
    pages.push((await agent.get('/').set('Accept', 'text/html')).text);
    pages.push((await agent.get('/no-existe').set('Accept', 'text/html')).text);
    for (const html of pages) assert.match(html, /<link rel="icon" href="\/img\/favicon\.svg"/);
});
