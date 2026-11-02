'use strict';
const { MONEDAS, MONEDA_POR_DEFECTO } = require('../utils/money');
const { z, texto, opcional, telefono, numero, casilla, parseForm, verTelefono } = require('../utils/validation');
const audit = require('./audit');

// Ajustes de la clínica en la tabla `config` (clave/valor). Los valores por defecto viven aquí,
// no en la base de datos: una instalación nueva funciona sin sembrar nada.
const DIAS = [
    ['lunes', 'Lunes'], ['martes', 'Martes'], ['miercoles', 'Miércoles'], ['jueves', 'Jueves'],
    ['viernes', 'Viernes'], ['sabado', 'Sábado'], ['domingo', 'Domingo'],
];
const HORARIO_POR_DEFECTO = {
    lunes: { abre: '08:00', cierra: '17:00' }, martes: { abre: '08:00', cierra: '17:00' },
    miercoles: { abre: '08:00', cierra: '17:00' }, jueves: { abre: '08:00', cierra: '17:00' },
    viernes: { abre: '08:00', cierra: '17:00' }, sabado: { abre: '08:00', cierra: '12:00' },
    domingo: null, // cerrado
};
const DEFECTOS = {
    nombre_clinica: 'JEWA', telefono: '', direccion: '', moneda: MONEDA_POR_DEFECTO,
    iva_porcentaje: '0', duracion_cita_min: '30', horario: JSON.stringify(HORARIO_POR_DEFECTO),
};

function leerTodo(db) {
    return Object.fromEntries(db.prepare('SELECT clave, valor FROM config').all().map((r) => [r.clave, r.valor]));
}

/** Un ajuste suelto (lo usa, por ejemplo, el nombre de la clínica en cada vista). */
function getSetting(db, key, fallback = null) {
    const row = db.prepare('SELECT valor FROM config WHERE clave = ?').get(key);
    return row ? row.valor : fallback;
}

function parseHorario(json) {
    try {
        const h = JSON.parse(json);
        return Object.fromEntries(DIAS.map(([d]) => [d, h && h[d] && h[d].abre && h[d].cierra ? { abre: h[d].abre, cierra: h[d].cierra } : null]));
    } catch {
        return { ...HORARIO_POR_DEFECTO };
    }
}

/** Todos los ajustes ya tipados (con los valores por defecto donde falte algo). */
function getSettings(db) {
    const v = { ...DEFECTOS, ...leerTodo(db) };
    return {
        nombre: v.nombre_clinica,
        telefono: v.telefono,
        direccion: v.direccion,
        moneda: MONEDAS[v.moneda] ? v.moneda : MONEDA_POR_DEFECTO,
        iva: Number(v.iva_porcentaje) || 0,
        duracionCitaMin: Number(v.duracion_cita_min) || 30,
        horario: parseHorario(v.horario),
    };
}

// ───────── Validación del formulario
// Los datos generales y cada día del horario se validan por separado: así todos los errores
// salen a la vez (Zod omite las reglas entre campos si otro campo falló antes).
const generalSchema = z.object({
    nombre: texto({ max: 100 }),
    telefono: opcional(telefono()),
    direccion: opcional(texto({ max: 200 })),
    moneda: z.enum(Object.keys(MONEDAS), { error: 'Moneda no válida.' }),
    iva: numero(z.number({ error: 'Debe ser un número (ej. 15 o 0).' }).min(0, 'El IVA no puede ser negativo.').max(100, 'El IVA no puede superar 100 %.')),
    duracionCitaMin: numero(z.number({ error: 'Debe ser un número de minutos.' }).int('Usa minutos enteros.').min(5, 'Mínimo 5 minutos.').max(240, 'Máximo 240 minutos.')),
});

const HORA = z.iso.time({ precision: -1 });
const diaSchema = z.object({
    abierto: casilla(),
    abre: opcional(z.string()),
    cierra: opcional(z.string()),
}).superRefine((d, ctx) => {
    if (!d.abierto) return; // un día cerrado no se valida
    const a = HORA.safeParse(d.abre ?? '');
    const c = HORA.safeParse(d.cierra ?? '');
    if (!a.success) ctx.addIssue({ code: 'custom', path: ['abre'], message: d.abre ? 'Hora no válida (HH:MM).' : 'Indica la hora de apertura.' });
    if (!c.success) ctx.addIssue({ code: 'custom', path: ['cierra'], message: d.cierra ? 'Hora no válida (HH:MM).' : 'Indica la hora de cierre.' });
    if (a.success && c.success && d.cierra <= d.abre) ctx.addIssue({ code: 'custom', path: ['cierra'], message: 'Debe ser posterior a la apertura.' });
});

/** Valida el formulario completo. Devuelve { ok, values, horario, errors } con errores por nombre de campo. */
function validarFormulario(input) {
    const body = input && typeof input === 'object' ? input : {};
    const general = parseForm(generalSchema, body);
    const errors = { ...general.errors };
    const horario = {};
    for (const [dia] of DIAS) {
        const r = parseForm(diaSchema, { abierto: body[`${dia}_abierto`], abre: body[`${dia}_abre`], cierra: body[`${dia}_cierra`] });
        for (const [campo, mensaje] of Object.entries(r.errors)) errors[`${dia}_${campo}`] = mensaje;
        if (r.ok) horario[dia] = r.values.abierto ? { abre: r.values.abre, cierra: r.values.cierra } : null;
    }
    return { ok: Object.keys(errors).length === 0, values: general.values, horario, errors };
}

/** Valores validados → forma almacenable en `config`. */
function aAlmacenado(values, horario) {
    return {
        nombre_clinica: values.nombre,
        telefono: values.telefono || '',
        direccion: values.direccion || '',
        moneda: values.moneda,
        iva_porcentaje: String(values.iva),
        duracion_cita_min: String(values.duracionCitaMin),
        horario: JSON.stringify(horario),
    };
}

const ETIQUETAS = { nombre_clinica: 'nombre', telefono: 'teléfono', direccion: 'dirección', moneda: 'moneda', iva_porcentaje: 'IVA', duracion_cita_min: 'duración de cita', horario: 'horario' };

/** Guarda los ajustes. Devuelve { ok } o { ok: false, errors }. */
function saveSettings(db, input, { actorId = null, ip = null } = {}) {
    const { ok, values, horario, errors } = validarFormulario(input);
    if (!ok) return { ok: false, errors };
    const nuevo = aAlmacenado(values, horario);
    const actual = { ...DEFECTOS, ...leerTodo(db) };
    const cambios = [];
    for (const [clave, valor] of Object.entries(nuevo)) {
        if (valor === actual[clave]) continue;
        cambios.push(clave === 'horario' ? 'horario modificado' : `${ETIQUETAS[clave]}: ${actual[clave] || '(vacío)'} → ${valor || '(vacío)'}`);
        db.prepare('INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, valor);
    }
    if (!cambios.length) return { ok: true, sinCambios: true };
    audit.log(db, { usuarioId: actorId, accion: 'ajustes_editados', entidad: 'config', detalle: { cambios }, ip });
    return { ok: true };
}

/** Valores para rellenar el formulario (texto tal como se escribe: teléfono nacional, IVA sin ceros). */
function paraFormulario(s) {
    const v = {
        nombre: s.nombre, telefono: verTelefono(s.telefono), direccion: s.direccion, moneda: s.moneda,
        iva: String(s.iva), duracionCitaMin: String(s.duracionCitaMin),
    };
    for (const [d] of DIAS) {
        v[`${d}_abierto`] = Boolean(s.horario[d]);
        v[`${d}_abre`] = s.horario[d] ? s.horario[d].abre : '08:00';
        v[`${d}_cierra`] = s.horario[d] ? s.horario[d].cierra : '17:00';
    }
    return v;
}

module.exports = { getSetting, getSettings, saveSettings, paraFormulario, DIAS, DEFECTOS, HORARIO_POR_DEFECTO };
