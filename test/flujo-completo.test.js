'use strict';
// ISS-19: flujo de punta a punta por HTTP (formularios reales con CSRF) y tres roles distintos.
// propietario y mascota → cita → consulta → vacuna → venta → recibo
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const productos = require('../src/services/productos');
const { testDb, testConfig, csrfIn, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z'); // lunes 09:00 en Managua

async function post(agent, desde, url, body = {}) {
    const page = await getHtml(agent, desde);
    return agent.post(url).type('form').send({ _csrf: csrfIn(page.text), ...body });
}
const idDe = (res, re) => Number(re.exec(res.headers.location)[1]);

test('flujo completo: recepción registra y agenda, el veterinario atiende y vacuna, recepción cobra y el recibo sale', async () => {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    const admin = await mk('ana', 'Ana Pérez', 'admin');
    const vetId = await mk('vet1', 'María López', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const vacuna = db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-001'").get().id;
    productos.updateProducto(db, vacuna, { codigo: 'VAC-001', nombre: 'Vacuna antirrábica', categoria: 'Vacuna', unidad: 'dosis', precio: '15', stock_minimo: '0' }, { actorId: admin, ahora: NOW });
    const servicio = db.prepare("SELECT id FROM servicios WHERE nombre = 'Consulta general'").get().id;
    db.prepare('UPDATE servicios SET precio = 30000 WHERE id = ?').run(servicio);

    const rec = await loginAs(app, 'rec1', CLAVE);
    const vet = await loginAs(app, 'vet1', CLAVE);

    // 1. propietario y mascota
    const cli = await post(rec, '/clientes', '/clientes', { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' });
    assert.equal(cli.status, 302);
    const clienteId = idDe(cli, /\/clientes\/(\d+)/);
    const page = await getHtml(rec, `/mascotas/nueva?propietario=${clienteId}`);
    const masc = rec.post('/mascotas').field('_csrf', csrfIn(page.text));
    for (const [k, v] of Object.entries({ propietario: String(clienteId), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' })) masc.field(k, v);
    const mres = await masc;
    assert.equal(mres.status, 302);
    const mascotaId = idDe(mres, /\/mascotas\/(\d+)/);

    // 2. cita
    const cita = await post(rec, `/citas/nueva?mascota=${mascotaId}`, '/citas', { mascota: String(mascotaId), responsable: String(vetId), servicio: String(servicio), fecha: '2026-11-03', hora: '09:00', motivo: 'Revisión anual' });
    assert.equal(cita.status, 302);
    const citaId = db.prepare('SELECT MAX(id) AS id FROM citas').get().id;

    // 3. consulta desde la cita (la cita pasa a atendida)
    const cons = await post(vet, `/historial/nueva?cita=${citaId}`, '/historial', { cita: String(citaId), mascota: String(mascotaId), motivo: 'Revisión anual', diagnostico: 'Sano', peso_kg: '12.5' });
    assert.equal(cons.status, 302);
    const consultaId = idDe(cons, /\/historial\/(\d+)/);
    assert.equal(db.prepare('SELECT estado FROM citas WHERE id = ?').get(citaId).estado, 'atendida');

    // 4. vacuna con próxima dosis
    const vac = await post(vet, `/historial/${consultaId}`, `/historial/${consultaId}/vacunas`, { producto: String(vacuna), fecha: '2026-11-02', proxima_dosis: '2027-11-02' });
    assert.equal(vac.status, 302);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vacunas_aplicadas').get().n, 1);
    assert.match((await getHtml(vet, `/historial/carne/${mascotaId}`)).text, /Vacuna antirrábica/);

    // 5. venta (servicio + vacuna) con cliente, descuenta stock
    productos.entradaStock(db, vacuna, { cantidad: '5', nota: 'Compra de prueba' }, { actorId: admin, ahora: NOW });
    const antes = productos.getProducto(db, vacuna).stock;
    await post(rec, '/ventas/nueva', '/ventas/carrito/agregar', { item: `servicio:${servicio}`, cantidad: '1' });
    await post(rec, '/ventas/nueva', '/ventas/carrito/agregar', { item: `producto:${vacuna}`, cantidad: '1' });
    await post(rec, '/ventas/nueva', '/ventas/carrito/cliente', { propietario: String(clienteId) });
    const venta = await post(rec, '/ventas/nueva', '/ventas/cobrar', { metodo: 'efectivo' });
    assert.equal(venta.status, 302);
    const ventaId = idDe(venta, /\/ventas\/(\d+)/);
    assert.equal(productos.getProducto(db, vacuna).stock, antes - 1);

    // 6. recibo imprimible en córdobas con el total exacto (30,000 + 1,500 centavos)
    const recibo = await getHtml(rec, `/ventas/${ventaId}/recibo`);
    assert.equal(recibo.status, 200);
    assert.match(recibo.text, /C\$ 315\.00/);
    assert.match(recibo.text, /Laura Mendoza/);
    assert.match(recibo.text, /V-000001/);

    // La bitácora recoge las acciones críticas del flujo
    const acciones = db.prepare('SELECT DISTINCT entidad FROM bitacora').all().map((r) => r.entidad);
    for (const e of ['propietario', 'mascota', 'cita', 'consulta', 'vacuna', 'venta']) assert.ok(acciones.includes(e), `la bitácora debe registrar ${e}: ${acciones}`);
});
