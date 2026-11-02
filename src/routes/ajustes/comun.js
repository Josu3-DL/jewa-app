'use strict';
const { z } = require('../../utils/validation');
const { HttpError } = require('../../middleware/errors');

const idSchema = z.coerce.number().int().positive();

/** Identificador de la URL (`/:id`); si no es un entero positivo, 404. */
function idParam(req) {
    const r = idSchema.safeParse(req.params.id);
    if (!r.success) throw new HttpError(404);
    return r.data;
}

/** Quién hace la acción y desde dónde, para la bitácora. */
const contexto = (req) => ({ actorId: req.user.id, ip: req.ip });

/** Texto de un campo del cuerpo (o vacío): se usa para devolver lo escrito al formulario. */
const texto = (v) => (typeof v === 'string' ? v : '');

module.exports = { idParam, contexto, texto };
