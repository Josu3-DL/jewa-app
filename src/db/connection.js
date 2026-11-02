'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Abre la base de datos con los PRAGMA obligatorios del proyecto:
 * claves foráneas activas, WAL (salvo en memoria) y espera ante bloqueos.
 */
function openDb(dbPath) {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
    return db;
}

/** Ejecuta fn dentro de una transacción inmediata; revierte si lanza. */
function transaction(db, fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

module.exports = { openDb, transaction };
