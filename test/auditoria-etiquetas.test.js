'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const audit = require('../src/services/audit');

const SRC = path.join(__dirname, '..', 'src');
function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out); else if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
}

// Cada acción y entidad que el código manda a la bitácora debe tener su texto en español;
// si falta, la pantalla de Bitácora mostraría el código interno ("cita_estado").
test('bitácora: toda acción y entidad registrada en el código tiene etiqueta legible', () => {
    const faltan = [];
    for (const file of walk(SRC)) {
        const code = fs.readFileSync(file, 'utf8');
        for (const m of code.matchAll(/accion:\s*([^,}\n]+)/g)) {
            for (const c of m[1].matchAll(/'([a-z_]+)'/g)) {
                if (audit.etiquetaAccion(c[1]) === c[1]) faltan.push(`${path.relative(SRC, file)}: acción ${c[1]}`);
            }
        }
        for (const m of code.matchAll(/entidad:\s*'([a-z_]+)'/g)) {
            if (audit.etiquetaEntidad(m[1]) === m[1]) faltan.push(`${path.relative(SRC, file)}: entidad ${m[1]}`);
        }
    }
    assert.deepEqual([...new Set(faltan)], []);
});
