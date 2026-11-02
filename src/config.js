'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROLES } = require('./roles');
const { version } = require('../package.json');

const ROOT = path.resolve(__dirname, '..');

function toBool(value, fallback) {
    if (value === undefined || value === '') return fallback;
    return ['1', 'true', 'si', 'sí', 'yes'].includes(String(value).trim().toLowerCase());
}

/**
 * Construye la configuración a partir de un objeto de variables de entorno.
 * Es una función pura para poder probarla sin tocar process.env.
 */
function buildConfig(env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const port = Number(env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`PORT inválido: "${env.PORT}"`);
    }

    const secret = env.SESSION_SECRET || '';
    if (nodeEnv === 'production' && secret.length < 32) {
        throw new Error('SESSION_SECRET es obligatorio en producción y debe tener al menos 32 caracteres.');
    }

    // Solo desarrollo: simula un usuario con ese rol mientras no hay login (ISS-03).
    const devRole = (env.DEV_ROLE || '').trim();
    if (devRole) {
        if (nodeEnv === 'production') throw new Error('DEV_ROLE no está permitido en producción.');
        if (!ROLES.includes(devRole)) throw new Error(`DEV_ROLE inválido: "${devRole}". Use: ${ROLES.join(', ')}`);
    }

    const resolve = (value, fallback) => path.resolve(ROOT, value || fallback);

    return {
        nodeEnv,
        isProduction: nodeEnv === 'production',
        host: env.HOST || '0.0.0.0',
        port,
        sessionSecret: secret || 'solo-desarrollo-no-usar-en-produccion',
        cookieSecure: toBool(env.COOKIE_SECURE, false),
        dbPath: env.DB_PATH === ':memory:' ? ':memory:' : resolve(env.DB_PATH, './data/clinic.db'),
        uploadDir: resolve(env.UPLOAD_DIR, './uploads'),
        backupDir: resolve(env.BACKUP_DIR, './backups'),
        devRole: devRole || null,
        version,
        root: ROOT,
    };
}

/** Carga .env (si existe) en process.env sin pisar variables ya definidas. */
function loadEnvFile() {
    const file = path.join(ROOT, '.env');
    if (fs.existsSync(file)) process.loadEnvFile(file);
}

function loadConfig() {
    loadEnvFile();
    return buildConfig(process.env);
}

module.exports = { buildConfig, loadConfig, ROOT };
