'use strict';
const fs = require('node:fs');
const path = require('node:path');
// `backup()` de node:sqlite copia la base de forma consistente aunque el sistema esté en uso (incluye lo pendiente del WAL).
const { DatabaseSync, backup } = require('node:sqlite');
const { utcToManagua } = require('../utils/dates');
const { version } = require('../../package.json');

// Respaldo y restauración (RNF-06, D-26). Alcance académico (D-41): un respaldo = una carpeta con la base y los
// archivos subidos; sin programación automática ni retención. Se usa desde scripts/backup.js y scripts/restore.js.

const NOMBRE_BD = 'clinic.db';
const NOMBRE_UPLOADS = 'uploads';
const MANIFIESTO = 'respaldo.json';

class ErrorRespaldo extends Error {}

/** AAAAMMDD-HHMMSS en hora de Managua. */
function sello(ahora) {
    const { fecha, hora } = utcToManagua(ahora);
    return `${fecha.replace(/-/g, '')}-${hora.replace(':', '')}${String(ahora.getUTCSeconds()).padStart(2, '0')}`;
}

/** Comprueba que un archivo sea una base SQLite sana; devuelve cuántas tablas tiene. */
function verificarBase(archivo) {
    let db;
    try {
        db = new DatabaseSync(archivo, { readOnly: true });
        const r = db.prepare('PRAGMA integrity_check').get();
        if (Object.values(r)[0] !== 'ok') throw new ErrorRespaldo('la base no pasa la revisión de integridad');
        return db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
    } catch (error) {
        if (error instanceof ErrorRespaldo) throw error;
        throw new ErrorRespaldo(`el archivo no es una base de datos válida (${error.message})`);
    } finally {
        if (db) db.close();
    }
}

const contarArchivos = (dir) => {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).length;
};

/** Copia la base abierta con backup() (consistente aunque haya otro proceso escribiendo). */
async function copiarBase(origen, destino) {
    const db = new DatabaseSync(origen);
    try {
        db.exec('PRAGMA busy_timeout = 5000');
        await backup(db, destino);
    } finally {
        db.close();
    }
}

/**
 * Crea una carpeta de respaldo `jewa-AAAAMMDD-HHMMSS` dentro de `backupDir` con `clinic.db`, `uploads/` y `respaldo.json`.
 * Verifica la copia antes de darla por buena. Lanza ErrorRespaldo con un mensaje claro si algo falla.
 */
async function crearRespaldo({ dbPath, uploadDir, backupDir, ahora = new Date() }) {
    if (!fs.existsSync(dbPath)) throw new ErrorRespaldo(`No existe la base de datos (${dbPath}). Revisa DB_PATH en el archivo .env.`);
    let carpeta = path.join(backupDir, `jewa-${sello(ahora)}`);
    try {
        fs.mkdirSync(backupDir, { recursive: true });
        for (let n = 2; fs.existsSync(carpeta); n += 1) carpeta = path.join(backupDir, `jewa-${sello(ahora)}-${n}`);
        fs.mkdirSync(carpeta);
    } catch (error) {
        throw new ErrorRespaldo(`No se pudo escribir en "${backupDir}": ${error.message}. ¿Está conectada la unidad de respaldo?`);
    }
    try {
        await copiarBase(dbPath, path.join(carpeta, NOMBRE_BD));
        const tablas = verificarBase(path.join(carpeta, NOMBRE_BD));
        // al revisarla, SQLite deja archivos auxiliares junto a la copia; la copia ya está completa sin ellos
        for (const sufijo of ['-wal', '-shm']) fs.rmSync(path.join(carpeta, `${NOMBRE_BD}${sufijo}`), { force: true });
        if (fs.existsSync(uploadDir)) fs.cpSync(uploadDir, path.join(carpeta, NOMBRE_UPLOADS), { recursive: true });
        const manifiesto = {
            creado_en: ahora.toISOString(), version_app: version, tablas,
            bytes_base: fs.statSync(path.join(carpeta, NOMBRE_BD)).size,
            archivos_subidos: contarArchivos(path.join(carpeta, NOMBRE_UPLOADS)), integridad: 'ok',
        };
        fs.writeFileSync(path.join(carpeta, MANIFIESTO), `${JSON.stringify(manifiesto, null, 2)}\n`);
        return { carpeta, ...manifiesto };
    } catch (error) {
        fs.rmSync(carpeta, { recursive: true, force: true }); // un respaldo a medias es peor que ninguno
        throw error instanceof ErrorRespaldo ? error : new ErrorRespaldo(`El respaldo falló: ${error.message}`);
    }
}

/** Respaldos que hay en `backupDir`, el más reciente primero. */
function listarRespaldos(backupDir) {
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(backupDir, e.name, NOMBRE_BD)))
        .map((e) => {
            let manifiesto = {};
            try { manifiesto = JSON.parse(fs.readFileSync(path.join(backupDir, e.name, MANIFIESTO), 'utf8')); } catch { /* sin manifiesto */ }
            return { nombre: e.name, carpeta: path.join(backupDir, e.name), ...manifiesto };
        })
        .sort((a, b) => b.nombre.localeCompare(a.nombre));
}

/**
 * Restaura un respaldo. ANTES de tocar nada comprueba que el respaldo esté sano y guarda lo actual como
 * `.antes-de-restaurar-<sello>` (base y carpeta de archivos), así una restauración equivocada se puede deshacer.
 * El sistema debe estar detenido: se borran los archivos -wal y -shm de la base.
 */
async function restaurarRespaldo({ carpeta, dbPath, uploadDir, ahora = new Date() }) {
    const origenBd = path.join(carpeta, NOMBRE_BD);
    if (!fs.existsSync(origenBd)) throw new ErrorRespaldo(`"${carpeta}" no es un respaldo de JEWA (no contiene ${NOMBRE_BD}).`);
    verificarBase(origenBd); // si está dañado, se detiene aquí sin tocar lo actual

    const marca = `antes-de-restaurar-${sello(ahora)}`;
    const resultado = { base_anterior: null, uploads_anterior: null };
    if (fs.existsSync(dbPath)) {
        resultado.base_anterior = `${dbPath}.${marca}`;
        await copiarBase(dbPath, resultado.base_anterior);
    }
    let tablas;
    try {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        for (const sufijo of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${sufijo}`, { force: true });
        fs.copyFileSync(origenBd, dbPath);
        tablas = verificarBase(dbPath);

        if (fs.existsSync(uploadDir)) {
            resultado.uploads_anterior = `${uploadDir}.${marca}`;
            fs.renameSync(uploadDir, resultado.uploads_anterior);
        }
        const origenUploads = path.join(carpeta, NOMBRE_UPLOADS);
        if (fs.existsSync(origenUploads)) fs.cpSync(origenUploads, uploadDir, { recursive: true });
        else fs.mkdirSync(uploadDir, { recursive: true });
    } catch (error) {
        if (['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) {
            throw new ErrorRespaldo(`No se pudo reemplazar la base o los archivos porque están en uso. Detén el sistema y vuelve a intentarlo. Lo anterior se guardó en "${resultado.base_anterior || dbPath}" (${error.code}).`);
        }
        throw error;
    }
    return { ...resultado, tablas, archivos_subidos: contarArchivos(uploadDir) };
}

module.exports = { ErrorRespaldo, crearRespaldo, listarRespaldos, restaurarRespaldo, verificarBase, sello };
