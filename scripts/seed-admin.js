'use strict';
// Crea el primer administrador. La contraseña se pide por consola (no se muestra) y
// nunca se guarda en el repositorio. Para automatizar: ADMIN_USER, ADMIN_NAME y ADMIN_PASSWORD.
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { loadConfig } = require('../src/config');
const { openDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { createUser, countUsers } = require('../src/services/users');

async function main() {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    migrate(db);

    if (countUsers(db, 'admin') > 0) {
        console.error('Ya existe un administrador. Los demás usuarios se gestionan desde Ajustes.');
        process.exitCode = 1;
        return;
    }

    let usuario = process.env.ADMIN_USER;
    let nombre = process.env.ADMIN_NAME;
    let password = process.env.ADMIN_PASSWORD;

    if (!password) {
        // Cola de líneas: funciona al teclear y también si la entrada llega de golpe (tubería).
        let muted = false;
        const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
        const rl = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
        const queued = [];
        const waiting = [];
        let closed = false;
        rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queued.push(line)));
        rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(''); });
        const ask = (question, hidden = false) => new Promise((resolve) => {
            process.stdout.write(question);
            muted = hidden;
            const done = (answer) => {
                muted = false;
                if (hidden) console.log();
                resolve(answer);
            };
            if (queued.length) done(queued.shift());
            else if (closed) done('');
            else waiting.push(done);
        });
        usuario = (await ask('Usuario [admin]: ')).trim() || 'admin';
        nombre = (await ask('Nombre completo: ')).trim() || 'Administrador';
        password = await ask('Contraseña (mínimo 8 caracteres): ', true);
        const again = await ask('Repite la contraseña: ', true);
        rl.close();
        if (password !== again) {
            console.error('Las contraseñas no coinciden.');
            process.exitCode = 1;
            return;
        }
    }

    const result = await createUser(db, { usuario: usuario || 'admin', nombre: nombre || 'Administrador', rol: 'admin', password });
    if (!result.ok) {
        for (const message of Object.values(result.errors)) console.error(`- ${message}`);
        process.exitCode = 1;
        return;
    }
    console.log(`Administrador "${usuario || 'admin'}" creado. Ya puedes iniciar sesión.`);
    db.close();
}

main().catch((error) => {
    console.error('No se pudo crear el administrador:', error.message);
    process.exit(1);
});
