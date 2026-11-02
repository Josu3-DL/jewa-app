'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { openDb, transaction } = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Aplica en orden las migraciones *.sql pendientes. Es idempotente:
 * volver a ejecutarla no hace nada si ya están aplicadas.
 * Devuelve los nombres de las migraciones aplicadas en esta llamada.
 */
function migrate(db, dir = MIGRATIONS_DIR) {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        aplicada_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`);
    const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const applied = [];
    for (const file of files) {
        if (done.has(file)) continue;
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        transaction(db, () => {
            db.exec(sql);
            db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
        });
        applied.push(file);
    }
    return applied;
}

module.exports = { migrate };

if (require.main === module) {
    const { loadConfig } = require('../config');
    const config = loadConfig();
    const db = openDb(config.dbPath);
    const applied = migrate(db);
    console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'La base de datos ya está al día.');
    db.close();
}
