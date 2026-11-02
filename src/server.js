'use strict';
const { loadConfig } = require('./config');
const { openDb } = require('./db/connection');
const { migrate } = require('./db/migrate');
const { createApp } = require('./app');

const config = loadConfig();
const db = openDb(config.dbPath);
const applied = migrate(db);
if (applied.length) console.log(`Migraciones aplicadas: ${applied.join(', ')}`);

const app = createApp({ db, config });
const server = app.listen(config.port, config.host, () => {
    console.log(`JEWA escuchando en http://${config.host}:${config.port} (${config.nodeEnv})`);
});

function shutdown() {
    server.close(() => {
        db.close();
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
