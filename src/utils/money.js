'use strict';
// Dinero: SIEMPRE enteros en centavos (D-05); nunca float. Formato "C$ 1,234.50".
// Propio y pequeño: Intl da "C$1,234.50" (sin espacio) y "USD 1,234.50" para el dólar, que no es lo que
// pide el cliente, y Dinero.js no mostró un estado estable claro; aquí solo se agrupan miles con Intl.

const MONEDAS = {
    NIO: { simbolo: 'C$', nombre: 'Córdoba (C$)' },
    USD: { simbolo: '$', nombre: 'Dólar ($)' },
};
const MONEDA_POR_DEFECTO = 'NIO';
const MAX_CENTAVOS = 9_999_999_999; // C$ 99,999,999.99

const miles = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 123456 → "C$ 1,234.56"; negativos como "-C$ 5.00". */
function formatMoney(centavos, moneda = MONEDA_POR_DEFECTO) {
    if (!Number.isSafeInteger(centavos)) throw new TypeError('formatMoney espera un entero en centavos');
    const simbolo = (MONEDAS[moneda] || MONEDAS[MONEDA_POR_DEFECTO]).simbolo;
    const abs = Math.abs(centavos);
    const enteros = miles.format(Math.trunc(abs / 100));
    const cents = String(abs % 100).padStart(2, '0');
    return `${centavos < 0 ? '-' : ''}${simbolo} ${enteros}.${cents}`;
}

/**
 * Texto de formulario → centavos, sin pasar por float: "150" → 15000, "150.5" → 15050, "150,50" → 15050.
 * Devuelve null si no es un monto válido (miles con separador, 3 decimales, negativos, etc.).
 */
function parseMoney(texto) {
    const m = /^(\d{1,10})(?:[.,](\d{1,2}))?$/.exec(String(texto ?? '').trim());
    if (!m) return null;
    const centavos = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
    return centavos <= MAX_CENTAVOS ? centavos : null;
}

/** Impuesto sobre un subtotal en centavos con un porcentaje de hasta 2 decimales; redondea al centavo. */
function calcularImpuesto(subtotalCentavos, porcentaje) {
    const puntosBase = Math.round(porcentaje * 100); // 15 % → 1500
    return Math.round((subtotalCentavos * puntosBase) / 10000);
}

module.exports = { MONEDAS, MONEDA_POR_DEFECTO, MAX_CENTAVOS, formatMoney, parseMoney, calcularImpuesto };
