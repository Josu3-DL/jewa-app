'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { z } = require('../utils/validation');

// scrypt de node:crypto: aceptado por OWASP y sin dependencias nativas. Las alternativas
// habituales (argon2, bcrypt) requieren módulos nativos que habría que compilar o descargar
// en la PC de la clínica; bcryptjs es puro JS pero mucho más lento.
const scrypt = promisify(crypto.scrypt);

// Formato almacenado: scrypt$N$r$p$salt(hex)$hash(hex). Los parámetros viajan en el hash
// para poder endurecerlos más adelante sin invalidar las contraseñas existentes.
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64, saltBytes: 16 };

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

/** Política de contraseñas nuevas (usuarios, restablecimientos). */
const passwordSchema = z
    .string({ error: 'Este campo es obligatorio.' })
    .min(8, 'La contraseña debe tener al menos 8 caracteres.')
    .max(200, 'La contraseña no puede superar 200 caracteres.')
    .refine((valor) => valor.trim() !== '', 'La contraseña no puede estar vacía.');

module.exports = { hashPassword, verifyPassword, passwordSchema };
