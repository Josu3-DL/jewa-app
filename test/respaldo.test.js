'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const respaldo = require('../src/services/respaldo');

const ROOT = path.join(__dirname, '..');
const AHORA = new Date('2026-11-02T15:00:00Z'); // 9:00:00 AM en Managua

/** Un "local" ficticio: base con datos, archivos subidos (con subcarpetas) y carpeta de respaldos. */
function local(nombre = 'a') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jewa-resp-${nombre}-`));
    const rutas = { dir, dbPath: path.join(dir, 'data', 'clinic.db'), uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'respaldos') };
    return { ...rutas, limpiar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function sembrar(l, { clientes = ['Laura Mendoza'] } = {}) {
    const db = openDb(l.dbPath);
    migrate(db);
    for (const [i, nombre] of clientes.entries()) db.prepare('INSERT INTO propietarios (nombre, telefono) VALUES (?, ?)').run(nombre, `5058888${7000 + i}`);
    fs.mkdirSync(path.join(l.uploadDir, 'fotos'), { recursive: true });
    fs.mkdirSync(path.join(l.uploadDir, 'adjuntos'), { recursive: true });
    fs.writeFileSync(path.join(l.uploadDir, 'fotos', 'foto1.png'), Buffer.from([1, 2, 3, 4]));
    fs.writeFileSync(path.join(l.uploadDir, 'adjuntos', 'examen.pdf'), 'contenido del pdf');
    return db;
}
const nombres = (dbPath) => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try { return db.prepare('SELECT nombre FROM propietarios ORDER BY id').all().map((r) => r.nombre); } finally { db.close(); }
};

test('respaldo: carpeta con la base, los archivos subidos y el manifiesto; la copia pasa la revisión de integridad', async () => {
    const l = local();
    try {
        const db = sembrar(l); db.close();
        const r = await respaldo.crearRespaldo({ ...l, ahora: AHORA });
        assert.equal(path.basename(r.carpeta), 'jewa-20261102-090000', 'nombre con la fecha y hora de Managua');
        assert.ok(fs.existsSync(path.join(r.carpeta, 'clinic.db')));
        assert.deepEqual(fs.readdirSync(r.carpeta).sort(), ['clinic.db', 'respaldo.json', 'uploads'], 'sin archivos auxiliares (-wal / -shm) dentro del respaldo');
        assert.equal(fs.readFileSync(path.join(r.carpeta, 'uploads', 'adjuntos', 'examen.pdf'), 'utf8'), 'contenido del pdf');
        assert.deepEqual([...fs.readFileSync(path.join(r.carpeta, 'uploads', 'fotos', 'foto1.png'))], [1, 2, 3, 4]);
        assert.deepEqual(nombres(path.join(r.carpeta, 'clinic.db')), ['Laura Mendoza']);
        const m = JSON.parse(fs.readFileSync(path.join(r.carpeta, 'respaldo.json'), 'utf8'));
        assert.deepEqual([m.integridad, m.archivos_subidos, m.creado_en], ['ok', 2, '2026-11-02T15:00:00.000Z']);
        assert.ok(m.tablas > 20 && m.bytes_base > 0 && m.version_app);
        assert.deepEqual(respaldo.listarRespaldos(l.backupDir).map((x) => x.nombre), ['jewa-20261102-090000']);
        assert.equal(respaldo.listarRespaldos(path.join(l.dir, 'no-existe')).length, 0);
    } finally { l.limpiar(); }
});

test('respaldo con el sistema en uso: incluye lo escrito recientemente (WAL) aunque la conexión siga abierta', async () => {
    const l = local();
    const db = sembrar(l);
    try {
        db.prepare('INSERT INTO propietarios (nombre, telefono) VALUES (?, ?)').run('Cliente reciente', '50588880000'); // aún sin checkpoint
        assert.ok(fs.existsSync(`${l.dbPath}-wal`), 'la base está en modo WAL');
        const r = await respaldo.crearRespaldo({ ...l, ahora: AHORA });
        assert.deepEqual(nombres(path.join(r.carpeta, 'clinic.db')), ['Laura Mendoza', 'Cliente reciente']);
        db.prepare('INSERT INTO propietarios (nombre, telefono) VALUES (?, ?)').run('Después del respaldo', '50588881111');
        assert.deepEqual(nombres(path.join(r.carpeta, 'clinic.db')), ['Laura Mendoza', 'Cliente reciente'], 'la copia no cambia después');
    } finally { db.close(); l.limpiar(); }
});

test('dos respaldos en el mismo segundo no se pisan; sin carpeta de archivos también funciona', async () => {
    const l = local();
    try {
        const db = sembrar(l); db.close();
        fs.rmSync(l.uploadDir, { recursive: true });
        const a = await respaldo.crearRespaldo({ ...l, ahora: AHORA });
        const b = await respaldo.crearRespaldo({ ...l, ahora: AHORA });
        assert.notEqual(a.carpeta, b.carpeta);
        assert.equal(path.basename(b.carpeta), 'jewa-20261102-090000-2');
        assert.equal(a.archivos_subidos, 0);
        assert.ok(!fs.existsSync(path.join(a.carpeta, 'uploads')));
        assert.equal(respaldo.listarRespaldos(l.backupDir).length, 2);
    } finally { l.limpiar(); }
});

test('errores claros: sin base de datos o con la unidad de respaldo no disponible; no queda un respaldo a medias', async () => {
    const l = local();
    try {
        await assert.rejects(respaldo.crearRespaldo({ ...l, ahora: AHORA }), /No existe la base de datos/);
        const db = sembrar(l); db.close();
        fs.writeFileSync(l.backupDir, 'soy un archivo, no una carpeta'); // simula una unidad que no está
        await assert.rejects(respaldo.crearRespaldo({ ...l, ahora: AHORA }), /No se pudo escribir en .*conectada la unidad/);
        fs.rmSync(l.backupDir);
        fs.writeFileSync(l.dbPath, 'esto no es una base de datos sqlite');
        await assert.rejects(respaldo.crearRespaldo({ ...l, ahora: AHORA }), respaldo.ErrorRespaldo);
        assert.deepEqual(fs.existsSync(l.backupDir) ? fs.readdirSync(l.backupDir) : [], [], 'el intento fallido se borró');
    } finally { l.limpiar(); }
});

test('RESTAURACIÓN sobre una base limpia: recupera datos y archivos en una PC nueva', async () => {
    const origen = local('origen');
    const nuevo = local('nuevo');
    try {
        const db = sembrar(origen, { clientes: ['Laura Mendoza', 'Pedro Ruiz'] }); db.close();
        const r = await respaldo.crearRespaldo({ ...origen, ahora: AHORA });
        // la "PC nueva" no tiene nada: ni base ni uploads
        assert.ok(!fs.existsSync(nuevo.dbPath) && !fs.existsSync(nuevo.uploadDir));
        const res = await respaldo.restaurarRespaldo({ carpeta: r.carpeta, dbPath: nuevo.dbPath, uploadDir: nuevo.uploadDir, ahora: AHORA });
        assert.deepEqual([res.base_anterior, res.uploads_anterior, res.archivos_subidos], [null, null, 2]);
        assert.deepEqual(nombres(nuevo.dbPath), ['Laura Mendoza', 'Pedro Ruiz']);
        assert.equal(fs.readFileSync(path.join(nuevo.uploadDir, 'adjuntos', 'examen.pdf'), 'utf8'), 'contenido del pdf');
        // y la base restaurada funciona con la aplicación: se abre, tiene el esquema completo y acepta datos nuevos
        const abierta = openDb(nuevo.dbPath);
        assert.equal(migrate(abierta).length, 0, 'ya tiene todas las migraciones aplicadas');
        abierta.prepare('INSERT INTO propietarios (nombre, telefono) VALUES (?, ?)').run('Nuevo tras restaurar', '50588882222');
        assert.equal(abierta.prepare('SELECT COUNT(*) AS n FROM propietarios').get().n, 3);
        abierta.close();
    } finally { origen.limpiar(); nuevo.limpiar(); }
});

test('restaurar sobre datos existentes: lo actual se guarda aparte (se puede deshacer) y se borran los -wal viejos', async () => {
    const l = local();
    try {
        const db = sembrar(l, { clientes: ['Cliente del respaldo'] }); db.close();
        const r = await respaldo.crearRespaldo({ ...l, ahora: AHORA });
        // el sistema siguió usándose: datos nuevos y un archivo nuevo; luego se detuvo (conexión cerrada)
        const viva = openDb(l.dbPath);
        viva.prepare('INSERT INTO propietarios (nombre, telefono) VALUES (?, ?)').run('Cliente posterior', '50588883333');
        viva.close();
        fs.writeFileSync(path.join(l.uploadDir, 'fotos', 'posterior.png'), 'x');
        // restos de un apagado brusco: archivos -wal y -shm que no corresponden a la base restaurada
        fs.writeFileSync(`${l.dbPath}-wal`, 'restos viejos del wal');
        fs.writeFileSync(`${l.dbPath}-shm`, 'restos viejos del shm');
        const mas = new Date('2026-11-05T15:00:00Z');
        const res = await respaldo.restaurarRespaldo({ carpeta: r.carpeta, dbPath: l.dbPath, uploadDir: l.uploadDir, ahora: mas });
        for (const sufijo of ['-wal', '-shm']) {
            if (fs.existsSync(`${l.dbPath}${sufijo}`)) assert.ok(!fs.readFileSync(`${l.dbPath}${sufijo}`, 'latin1').includes('restos viejos'), `los restos viejos de ${sufijo} ya no están`);
        }
        assert.deepEqual(nombres(l.dbPath), ['Cliente del respaldo']);
        assert.ok(!fs.existsSync(path.join(l.uploadDir, 'fotos', 'posterior.png')));
        assert.deepEqual(nombres(res.base_anterior), ['Cliente del respaldo', 'Cliente posterior'], 'la base anterior quedó guardada completa');
        assert.ok(fs.existsSync(path.join(res.uploads_anterior, 'fotos', 'posterior.png')));
        assert.match(path.basename(res.base_anterior), /^clinic\.db\.antes-de-restaurar-20261105-090000$/);
    } finally { l.limpiar(); }
});

test('restaurar con el sistema encendido: en Windows el archivo está en uso y se avisa de detenerlo (sin perder nada)', async () => {
    if (process.platform !== 'win32') return; // en otros sistemas el archivo en uso se puede reemplazar
    const l = local();
    const db = sembrar(l);
    try {
        const r = await respaldo.crearRespaldo({ ...l, ahora: AHORA });
        await assert.rejects(respaldo.restaurarRespaldo({ carpeta: r.carpeta, dbPath: l.dbPath, uploadDir: l.uploadDir, ahora: AHORA }), /Detén el sistema/);
    } finally { db.close(); l.limpiar(); }
});

test('restaurar un respaldo inválido o dañado se rechaza SIN tocar lo actual', async () => {
    const l = local();
    try {
        const db = sembrar(l); db.close();
        const vacia = path.join(l.dir, 'carpeta-vacia'); fs.mkdirSync(vacia);
        await assert.rejects(respaldo.restaurarRespaldo({ carpeta: vacia, dbPath: l.dbPath, uploadDir: l.uploadDir }), /no es un respaldo de JEWA/);
        const danada = path.join(l.dir, 'danada'); fs.mkdirSync(danada);
        fs.writeFileSync(path.join(danada, 'clinic.db'), 'basura que no es sqlite');
        await assert.rejects(respaldo.restaurarRespaldo({ carpeta: danada, dbPath: l.dbPath, uploadDir: l.uploadDir }), /no es una base de datos válida|integridad/);
        assert.deepEqual(nombres(l.dbPath), ['Laura Mendoza'], 'la base actual sigue igual');
        assert.ok(fs.existsSync(path.join(l.uploadDir, 'fotos', 'foto1.png')));
        assert.deepEqual(fs.readdirSync(l.dir).filter((x) => x.includes('antes-de-restaurar')), []);
    } finally { l.limpiar(); }
});

test('scripts de punta a punta: npm run backup y npm run restore (lista, simulación y --confirmar)', () => {
    const origen = local('e2e-o');
    const nuevo = local('e2e-n');
    try {
        const db = sembrar(origen); db.close();
        const env = (l) => ({ ...process.env, NODE_ENV: 'test', DB_PATH: l.dbPath, UPLOAD_DIR: l.uploadDir, BACKUP_DIR: l.backupDir });
        const correr = (script, args, l) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'scripts', script), ...args], { env: env(l), encoding: 'utf8' });

        const b = correr('backup.js', [], origen);
        assert.equal(b.status, 0, b.stderr);
        assert.match(b.stdout, /Respaldo creado correctamente/);
        assert.match(b.stdout, /Archivos subidos: 2/);
        assert.match(b.stdout, /otra unidad o lugar/);
        const nombre = fs.readdirSync(origen.backupDir)[0];

        // la unidad no está: error claro y código de salida distinto de cero
        const roto = correr('backup.js', [], { ...origen, backupDir: path.join(origen.dir, 'data', 'clinic.db', 'x') });
        assert.equal(roto.status, 1);
        assert.match(roto.stderr, /ERROR: No se pudo escribir/);

        const lista = correr('restore.js', [], { ...nuevo, backupDir: origen.backupDir });
        assert.equal(lista.status, 0);
        assert.match(lista.stdout, new RegExp(nombre));
        const simula = correr('restore.js', [nombre], { ...nuevo, backupDir: origen.backupDir });
        assert.equal(simula.status, 1, 'sin --confirmar no cambia nada');
        assert.match(simula.stdout, /agregando --confirmar/);
        assert.ok(!fs.existsSync(nuevo.dbPath));

        const real = correr('restore.js', [nombre, '--confirmar'], { ...nuevo, backupDir: origen.backupDir });
        assert.equal(real.status, 0, real.stderr);
        assert.match(real.stdout, /Restauración terminada/);
        assert.deepEqual(nombres(nuevo.dbPath), ['Laura Mendoza']);
        assert.ok(fs.existsSync(path.join(nuevo.uploadDir, 'fotos', 'foto1.png')));
        const mal = correr('restore.js', ['no-existe', '--confirmar'], { ...nuevo, backupDir: origen.backupDir });
        assert.equal(mal.status, 1);
        assert.match(mal.stderr, /ERROR/);
    } finally { origen.limpiar(); nuevo.limpiar(); }
});
