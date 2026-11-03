'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb } = require('./helpers');
const recordatorios = require('../src/services/recordatorios');
const citas = require('../src/services/citas');
const consultas = require('../src/services/consultas');
const vacunas = require('../src/services/vacunas');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');

// Lunes 2 de noviembre de 2026, 09:00 en Managua (15:00 UTC)
const AHORA = new Date('2026-11-02T15:00:00Z');
const ctx = { ahora: AHORA, ip: '127.0.0.1' };

function base() {
    const db = testDb();
    const mkCli = (nombre, tel, acepta = 'on') => propietarios.createPropietario(db, { nombre, telefono: tel, ...(acepta ? { acepta_notificaciones: acepta } : {}) }, ctx).id;
    const laura = mkCli('Laura Mendoza', '8888 7777');
    const sinConsent = mkCli('Pedro Sin Aviso', '8555 4444', '');
    const mk = (dueno, nombre) => mascotas.createMascota(db, { propietario: String(dueno), nombre, especie: 'Perro', sexo: 'macho' }, ctx).id;
    const vet = Number(db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol, atiende_citas) VALUES ('Vet Uno', 'vet1', 'x', 'veterinario', 1)").run().lastInsertRowid);
    const rabia = db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-001'").get().id;
    const dhpp = db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-002'").get().id;
    return { db, laura, sinConsent, firulais: mk(laura, 'Firulais'), rocky: mk(sinConsent, 'Rocky'), vet, rabia, dhpp };
}
const cita = (d, mascota, fecha, hora, extra = {}) => citas.crearCita(d.db, { mascota: String(mascota), responsable: String(d.vet), fecha, hora, confirmar: 'on', ...extra }, ctx).id;
const vacuna = (d, mascota, producto, fecha, proxima) => {
    const c = consultas.crearConsulta(d.db, { motivo: 'Vacunación', diagnostico: 'Sano' }, { actorId: d.vet, ahora: AHORA, mascotaId: mascota }).id;
    return vacunas.registrarVacuna(d.db, c, { producto: String(producto), fecha, proxima_dosis: proxima }, { actorId: d.vet, ahora: AHORA }).id;
};

test('plantilla y enlace de WhatsApp: variables rellenas, desconocidas vacías y texto codificado', () => {
    assert.equal(recordatorios.rellenar('Hola {propietario}, {mascota}{x}.', { propietario: 'Ana', mascota: 'Rex' }), 'Hola Ana, Rex.');
    const url = recordatorios.enlaceWhatsapp('50588887777', 'Hola & adiós? ñ <b>');
    assert.equal(url, 'https://wa.me/50588887777?text=Hola%20%26%20adi%C3%B3s%3F%20%C3%B1%20%3Cb%3E');
    assert.equal(recordatorios.enlaceWhatsapp('+505 8888-7777', 'x'), 'https://wa.me/50588887777?text=x', 'solo dígitos en el número');
});

test('citas: solo las de las próximas 24 h, activas, de mascotas activas; con mensaje prellenado y teléfono', () => {
    const d = base();
    const dentro = cita(d, d.firulais, '2026-11-03', '08:30');            // mañana 8:30 AM (23.5 h)
    cita(d, d.firulais, '2026-11-03', '10:00');                            // mañana 10 AM: pasa de 24 h
    cita(d, d.firulais, '2026-11-02', '07:00');                            // hoy 7 AM: ya pasó
    const cancelada = cita(d, d.firulais, '2026-11-03', '07:00');
    citas.cambiarEstado(d.db, cancelada, 'cancelada', ctx);
    const r = recordatorios.recordatorios(d.db, AHORA);
    assert.deepEqual(r.citas.map((c) => c.id), [dentro]);
    const c = r.citas[0];
    assert.equal(c.mensaje, 'Hola Laura Mendoza, le recordamos la cita de Firulais en JEWA el 03/11/2026 a las 8:30 AM. Si no puede asistir, avísenos por favor.');
    assert.equal(c.telefono, '8888 7777');
    assert.match(c.whatsapp, /^https:\/\/wa\.me\/50588887777\?text=Hola%20Laura/);
    assert.equal(c.enviado, null);
    mascotas.updateMascota(d.db, d.firulais, { nombre: 'Firulais', especie: 'Perro', sexo: 'macho', estado: 'inactiva' }, ctx);
    assert.equal(recordatorios.recordatorios(d.db, AHORA).citas.length, 0, 'mascota inactiva: sin aviso');
});

test('T-17 sin consentimiento: no aparece ningún recordatorio (cita ni vacuna) y solo se cuenta el omitido', () => {
    const d = base();
    cita(d, d.rocky, '2026-11-03', '08:30');
    vacuna(d, d.rocky, d.rabia, '2025-11-01', '2026-11-05');
    cita(d, d.firulais, '2026-11-03', '08:00');
    const r = recordatorios.recordatorios(d.db, AHORA);
    assert.deepEqual([r.citas.length, r.vacunas.length, r.omitidos], [1, 0, 2]);
    assert.ok(!JSON.stringify(r).includes('Pedro Sin Aviso') && !JSON.stringify(r).includes('Rocky'));
    assert.equal(recordatorios.marcarEnviado(d.db, { tipo: 'cita', id: 1 }, { actorId: d.vet, ahora: AHORA }).ok, false, 'tampoco se puede marcar');
    // al volver a aceptar, aparecen
    propietarios.updatePropietario(d.db, d.sinConsent, { nombre: 'Pedro Sin Aviso', telefono: '8555 4444', acepta_notificaciones: 'on' }, ctx);
    const r2 = recordatorios.recordatorios(d.db, AHORA);
    assert.deepEqual([r2.citas.length, r2.vacunas.length, r2.omitidos], [2, 1, 0]);
});

test('vacunas: próximas (≤ 15 días) y vencidas (≤ 1 año); lejanas, muy antiguas, anuladas y repetidas no', () => {
    const d = base();
    const proxima = vacuna(d, d.firulais, d.rabia, '2025-11-12', '2026-11-12');  // en 10 días
    const hoy = vacuna(d, d.firulais, d.dhpp, '2025-11-02', '2026-11-02');       // vence hoy
    const vencida = vacuna(d, d.firulais, d.rabia + 2, '2025-05-02', '2026-06-01'); // triple felina vencida hace 5 meses
    vacuna(d, d.firulais, d.rabia + 3, '2025-11-30', '2026-11-30');              // en 28 días: aún no
    vacuna(d, d.firulais, d.rabia + 3, '2024-06-01', '2025-06-01');              // vencida hace > 1 año… pero reemplazada abajo
    const r = recordatorios.recordatorios(d.db, AHORA);
    assert.deepEqual(r.vacunas.map((v) => v.id).sort((a, b) => a - b), [proxima, hoy, vencida].sort((a, b) => a - b));
    const porId = Object.fromEntries(r.vacunas.map((v) => [v.id, v]));
    assert.equal(porId[vencida].vencida, true);
    assert.equal(porId[hoy].vencida, false);
    assert.equal(porId[proxima].mensaje, 'Hola Laura Mendoza, la vacuna de Firulais (Vacuna antirrábica) está programada para el 12/11/2026. Escríbanos para agendar su cita en JEWA.');
    assert.deepEqual(r.vacunas.map((v) => v.fecha), ['01/06/2026', '02/11/2026', '12/11/2026'], 'orden por próxima dosis');

    // anulada: no cuenta
    d.db.prepare("UPDATE vacunas_aplicadas SET estado = 'anulada', anulada_motivo = 'error' WHERE id = ?").run(proxima);
    assert.ok(!recordatorios.recordatorios(d.db, AHORA).vacunas.some((v) => v.id === proxima));
});

test('vacuna ya refrescada: si hay una aplicación posterior del mismo producto, la anterior ya no genera aviso', () => {
    const d = base();
    const vieja = vacuna(d, d.firulais, d.rabia, '2025-10-01', '2026-10-01'); // vencida
    assert.deepEqual(recordatorios.recordatorios(d.db, AHORA).vacunas.map((v) => v.id), [vieja]);
    vacuna(d, d.firulais, d.rabia, '2026-10-20', '2027-10-20');                // se revacunó: próxima dosis lejana
    assert.deepEqual(recordatorios.recordatorios(d.db, AHORA).vacunas, [], 'ni la vieja ni la nueva');
    vacuna(d, d.firulais, d.dhpp, '2026-09-01', '2026-11-10');                 // otro producto: independiente
    assert.equal(recordatorios.recordatorios(d.db, AHORA).vacunas.length, 1);
});

test('marcar enviado: guarda mensaje, quién y cuándo; no se repite; desaparece de pendientes pero queda como enviado', () => {
    const d = base();
    const c = cita(d, d.firulais, '2026-11-03', '08:30');
    const v = vacuna(d, d.firulais, d.rabia, '2025-11-03', '2026-11-05');
    const later = new Date('2026-11-02T16:30:00Z');
    assert.equal(recordatorios.marcarEnviado(d.db, { tipo: 'cita', id: c }, { actorId: d.vet, ip: '1.1.1.1', ahora: later }).ok, true);
    const fila = d.db.prepare('SELECT * FROM notificaciones').get();
    assert.deepEqual([fila.tipo, fila.ref_tipo, fila.ref_id, fila.canal, fila.estado, fila.enviada_por, fila.enviada_en, fila.generada_para, fila.propietario_id, fila.mascota_id],
        ['cita', 'cita', c, 'whatsapp', 'enviada_manual', d.vet, '2026-11-02T16:30:00Z', '2026-11-03T14:30:00Z', d.laura, d.firulais]);
    assert.match(fila.mensaje, /cita de Firulais/);
    const r = recordatorios.recordatorios(d.db, later);
    assert.deepEqual([r.citas[0].enviado.por, r.vacunas[0].enviado], ['Vet Uno', null]);
    assert.match(recordatorios.marcarEnviado(d.db, { tipo: 'cita', id: c }, { actorId: d.vet, ahora: later }).error, /ya estaba marcado/);
    assert.equal(recordatorios.marcarEnviado(d.db, { tipo: 'vacuna', id: v }, { actorId: d.vet, ahora: later }).ok, true);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM notificaciones').get().n, 2);
    assert.equal(d.db.prepare("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'recordatorio_enviado'").get().n, 2);
});

test('marcar enviado: solo lo que está en la lista y tipos válidos; una cita reprogramada genera un aviso nuevo', () => {
    const d = base();
    const c = cita(d, d.firulais, '2026-11-03', '08:30');
    assert.match(recordatorios.marcarEnviado(d.db, { tipo: 'cita', id: 9999 }, { actorId: d.vet, ahora: AHORA }).error, /ya no está en la lista/);
    assert.match(recordatorios.marcarEnviado(d.db, { tipo: 'correo', id: c }, { actorId: d.vet, ahora: AHORA }).error, /Tipo/);
    assert.match(recordatorios.marcarEnviado(d.db, { tipo: 'vacuna', id: c }, { actorId: d.vet, ahora: AHORA }).error, /ya no está en la lista/, 'id de cita usado como vacuna');
    recordatorios.marcarEnviado(d.db, { tipo: 'cita', id: c }, { actorId: d.vet, ahora: AHORA });
    citas.actualizarCita(d.db, c, { mascota: String(d.firulais), responsable: String(d.vet), fecha: '2026-11-03', hora: '08:45', confirmar: 'on' }, ctx);
    const r = recordatorios.recordatorios(d.db, AHORA);
    assert.equal(r.citas[0].enviado, null, 'cambió la hora: hay que avisar de nuevo');
    assert.match(r.citas[0].mensaje, /a las 8:45 AM/);
    assert.equal(recordatorios.marcarEnviado(d.db, { tipo: 'cita', id: c }, { actorId: d.vet, ahora: AHORA }).ok, true);
    assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM notificaciones').get().n, 2);
});
