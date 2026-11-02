'use strict';
// Validación de formularios con Zod (mensajes en español) + libphonenumber-js para teléfonos.
// Los esquemas se declaran donde se usan; aquí solo hay piezas reutilizables y parseForm().
//
//   const schema = z.object({
//       nombre: texto({ max: 100 }),
//       telefono: telefono(),
//       correo: opcional(correo()),
//   });
//   const { ok, values, errors } = parseForm(schema, req.body);
const { z } = require('zod');
const { parsePhoneNumberFromString } = require('libphonenumber-js/min');
const { parseMoney } = require('./money');

z.config(z.locales.es()); // el resto de mensajes de Zod salen en español

const OBLIGATORIO = 'Este campo es obligatorio.';
// Mensaje de Zod: "obligatorio" si no llegó nada (o llegó vacío); si llegó algo incorrecto, el mensaje `invalido`.
const requerido = (invalido = 'Valor no válido.') => (issue) => (issue.input === undefined || issue.input === '' ? OBLIGATORIO : invalido);

// Los formularios HTML mandan '' en los campos vacíos: se tratan como ausentes.
const vacioAUndefined = (valor) => (typeof valor === 'string' && valor.trim() === '' ? undefined : valor);

/** Campo opcional: '' o ausente → undefined; si viene, debe cumplir el esquema. */
const opcional = (esquema) => z.preprocess(vacioAUndefined, esquema.optional());

/** Texto obligatorio, recortado, sin caracteres de control (se permiten saltos de línea y tabulaciones). */
const texto = ({ min = 1, max = 255 } = {}) => z
    .string({ error: requerido() })
    .trim()
    .min(1, OBLIGATORIO)
    .min(min, `Mínimo ${min} caracteres.`)
    .max(max, `Máximo ${max} caracteres.`)
    // eslint-disable-next-line no-control-regex
    .refine((valor) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(valor), 'Contiene caracteres no válidos.');

/** Teléfono de Nicaragua. Acepta 8888 7777, +505 8888-7777, (505) 88887777… y devuelve 505XXXXXXXX. */
const telefono = () => z.string({ error: requerido() }).trim().min(1, OBLIGATORIO).transform((valor, ctx) => {
    const tel = parsePhoneNumberFromString(valor, 'NI');
    if (!tel || !tel.isValid() || tel.country !== 'NI') {
        ctx.issues.push({ code: 'custom', message: 'Teléfono no válido (ej. 8888 7777).', input: valor });
        return z.NEVER;
    }
    return tel.number.replace('+', '');
});

/** Teléfono guardado (505XXXXXXXX) → como se escribe en un formulario ("8888 7777"). */
const verTelefono = (valor) => {
    const tel = valor ? parsePhoneNumberFromString(`+${valor}`) : null;
    return tel ? tel.formatNational() : (valor || '');
};

/** Monto en córdobas/dólares escrito en un formulario ("150", "150.5", "150,50") → centavos enteros. */
const dinero = () => z.string({ error: requerido() }).trim().min(1, OBLIGATORIO).transform((valor, ctx) => {
    const centavos = parseMoney(valor);
    if (centavos === null) {
        ctx.issues.push({ code: 'custom', message: 'Monto no válido: usa números con hasta 2 decimales (ej. 150.50).', input: valor });
        return z.NEVER;
    }
    return centavos;
});

const correo = () => z.email({ error: 'Correo no válido.' }).toLowerCase();

/** Fecha AAAA-MM-DD real (rechaza 2026-02-30). */
const fecha = () => z.iso.date({ error: requerido('Fecha no válida.') });
// (usar opcional(fecha()) cuando la fecha no es obligatoria)

/** Número desde texto de formulario; acepta coma decimal ("12,5"). Encadenar .min()/.max()/.int() según haga falta. */
const numero = (base = z.number({ error: requerido('Debe ser un número.') })) => z.preprocess(
    (valor) => (typeof valor === 'string' ? (valor.trim() === '' ? undefined : Number(valor.trim().replace(',', '.'))) : valor),
    base,
);

/** Casilla de verificación HTML: marcada envía "on" (o "1"); desmarcada no envía nada → false. */
const casilla = () => z.preprocess((valor) => valor === 'on' || valor === '1' || valor === 'true' || valor === true, z.boolean());

/**
 * Valida la entrada contra un esquema y devuelve { ok, values, errors }.
 * `errors` tiene un mensaje por campo (el primero), listo para mostrarlo bajo el campo.
 * Los campos no declarados en el esquema se descartan.
 */
function parseForm(esquema, entrada) {
    const resultado = esquema.safeParse(entrada && typeof entrada === 'object' ? entrada : {});
    if (resultado.success) return { ok: true, values: resultado.data, errors: {} };
    const errors = {};
    for (const problema of resultado.error.issues) {
        const campo = problema.path.join('.') || '_';
        if (!(campo in errors)) errors[campo] = problema.message;
    }
    return { ok: false, values: {}, errors };
}

module.exports = { z, texto, opcional, telefono, verTelefono, dinero, correo, fecha, numero, casilla, parseForm };
