'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// Formato almacenado: scrypt$N$r$p$salt(hex)$hash(hex). Los parámetros viajan en el hash
// para poder endurecerlos más adelante sin invalidar las contraseñas existentes.
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64, saltBytes: 16 };

const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

async function hashPassword(password) {
    const salt = crypto.randomBytes(PARAMS.saltBytes);
    const derived = await scrypt(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p });
    return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('hex'), derived.toString('hex')].join('$');
}

async function verifyPassword(password, stored) {
    try {
        const [algo, N, r, p, saltHex, hashHex] = String(stored).split('$');
        if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
        const expected = Buffer.from(hashHex, 'hex');
        const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
        return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
    } catch {
        return false;
    }
}

/** Devuelve un mensaje de error en español o null si la contraseña es aceptable. */
function passwordPolicyError(password) {
    if (typeof password !== 'string' || password.length < MIN_LENGTH) return `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`;
    if (password.length > MAX_LENGTH) return `La contraseña no puede superar ${MAX_LENGTH} caracteres.`;
    if (password.trim() === '') return 'La contraseña no puede estar vacía.';
    return null;
}

module.exports = { hashPassword, verifyPassword, passwordPolicyError, MIN_LENGTH, MAX_LENGTH };
