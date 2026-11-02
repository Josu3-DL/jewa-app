'use strict';
// Validación de entradas con mensajes en español.
// Cada regla recibe el valor crudo y devuelve { value } o { error }.
// Uso:
//   const { ok, values, errors } = validate(req.body, {
//       nombre: v.text({ label: 'Nombre', required: true, max: 100 }),
//       telefono: v.phone({ label: 'Teléfono', required: true }),
//   });

const isPlain = (raw) => raw === undefined || raw === null || typeof raw === 'string' || typeof raw === 'number';
const blank = (raw) => raw === undefined || raw === null || String(raw).trim() === '';
const invalid = (label) => ({ error: `El campo ${label} no es válido.` });
const required = (label) => ({ error: `El campo ${label} es obligatorio.` });

function text({ label = 'texto', required: req = false, min = 0, max = 255, trim = true } = {}) {
    return (raw) => {
        if (!isPlain(raw)) return invalid(label);
        let value = raw === undefined || raw === null ? '' : String(raw);
        if (trim) value = value.trim();
        if (value === '') return req ? required(label) : { value: '' };
        // Sin caracteres de control (salvo salto de línea y tabulación)
        if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return invalid(label);
        if (value.length < min) return { error: `El campo ${label} debe tener al menos ${min} caracteres.` };
        if (value.length > max) return { error: `El campo ${label} no puede superar ${max} caracteres.` };
        return { value };
    };
}

function number({ label = 'número', required: req = false, min = -Infinity, max = Infinity, integer = false, decimals = 2 } = {}) {
    return (raw) => {
        if (!isPlain(raw)) return invalid(label);
        if (blank(raw)) return req ? required(label) : { value: null };
        const str = String(raw).trim().replace(',', '.');
        if (!/^-?\d+(\.\d+)?$/.test(str)) return { error: `El campo ${label} debe ser un número.` };
        const value = Number(str);
        if (integer && !Number.isInteger(value)) return { error: `El campo ${label} debe ser un número entero.` };
        if (!integer && (str.split('.')[1] || '').length > decimals) return { error: `El campo ${label} admite máximo ${decimals} decimales.` };
        if (value < min) return { error: `El campo ${label} no puede ser menor que ${min}.` };
        if (value > max) return { error: `El campo ${label} no puede ser mayor que ${max}.` };
        return { value };
    };
}

function date({ label = 'fecha', required: req = false } = {}) {
    return (raw) => {
        if (!isPlain(raw)) return invalid(label);
        if (blank(raw)) return req ? required(label) : { value: null };
        const str = String(raw).trim();
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
        if (!m) return { error: `El campo ${label} debe tener el formato AAAA-MM-DD.` };
        const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
        const check = new Date(Date.UTC(y, mo - 1, d));
        if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
            return { error: `El campo ${label} no es una fecha real.` };
        }
        return { value: str };
    };
}

/** Teléfono de Nicaragua: 8 dígitos que empiezan en 2, 5, 7 u 8. Se guarda como 505XXXXXXXX. */
function phone({ label = 'teléfono', required: req = false } = {}) {
    return (raw) => {
        if (!isPlain(raw)) return invalid(label);
        if (blank(raw)) return req ? required(label) : { value: '' };
        let digits = String(raw).replace(/[\s\-().]/g, '');
        if (!/^\+?\d+$/.test(digits)) return { error: `El campo ${label} solo admite números, espacios y guiones.` };
        digits = digits.replace(/^\+/, '');
        if (digits.startsWith('505') && digits.length === 11) digits = digits.slice(3);
        if (!/^[2578]\d{7}$/.test(digits)) return { error: `El campo ${label} debe tener 8 dígitos (ej. 8888 7777).` };
        return { value: `505${digits}` };
    };
}

function email({ label = 'correo', required: req = false } = {}) {
    return (raw) => {
        if (!isPlain(raw)) return invalid(label);
        if (blank(raw)) return req ? required(label) : { value: '' };
        const value = String(raw).trim().toLowerCase();
        if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: `El campo ${label} no es un correo válido.` };
        return { value };
    };
}

function choice(allowed, { label = 'opción', required: req = false } = {}) {
    return (raw) => {
        if (!isPlain(raw)) return invalid(label);
        if (blank(raw)) return req ? required(label) : { value: null };
        const value = String(raw).trim();
        return allowed.includes(value) ? { value } : { error: `El campo ${label} tiene un valor no permitido.` };
    };
}

/** Aplica el esquema a la entrada. Ignora campos no declarados. */
function validate(input, schema) {
    const source = input && typeof input === 'object' ? input : {};
    const values = {};
    const errors = {};
    for (const [key, rule] of Object.entries(schema)) {
        const result = rule(Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined);
        if (result.error) errors[key] = result.error;
        else values[key] = result.value;
    }
    return { ok: Object.keys(errors).length === 0, values, errors };
}

const v = { text, number, date, phone, email, choice };

module.exports = { v, validate };
