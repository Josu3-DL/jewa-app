'use strict';

// Avisos de una sola vez ("Usuario creado.") que sobreviven a la redirección POST → GET.
// Se escribió propio: connect-flash y derivados son de la época de Express 3/4 y no declaran
// compatibilidad con Express 5; son ~10 líneas sobre la sesión.
//   req.flash('ok' | 'error', 'texto')   → en el POST, antes de redirigir
//   res.locals.flash = { tipo, texto }   → disponible en la siguiente vista
function flash() {
    return (req, res, next) => {
        res.locals.flash = req.session.flash || null;
        if (req.session.flash) delete req.session.flash;
        req.flash = (tipo, texto) => { req.session.flash = { tipo, texto }; };
        next();
    };
}

module.exports = { flash };
