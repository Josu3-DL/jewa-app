'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const productos = require('../src/services/productos');
const ventas = require('../src/services/ventas');
const citas = require('../src/services/citas');
const consultas = require('../src/services/consultas');
const vacunas = require('../src/services/vacunas');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');
const panel = require('../src/services/panel');
const { testDb, testConfig, loginAs, getHtml } = require('./helpers');

const CLAVE = 'clave-larga-1';
const NOW = new Date('2026-11-02T15:00:00Z'); // lunes 9:00 AM en Managua

async function setup({ datos = true } = {}) {
    const db = testDb();
    const app = createApp({ db, config: testConfig(), now: () => NOW });
    const mk = async (usuario, nombre, rol) => (await users.createUser(db, { usuario, nombre, rol, password: CLAVE, password2: CLAVE })).id;
    const admin = await mk('ana', 'Ana Pérez', 'admin');
    const vet = await mk('vet1', 'María López', 'veterinario');
    await mk('rec1', 'Rosa Díaz', 'recepcion');
    const ctx = { actorId: admin, ahora: NOW };
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, ctx).id;
    const m1 = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' }, ctx).id;
    const m2 = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Michi', especie: 'Gato', sexo: 'hembra' }, ctx).id;
    const d = { db, app, admin, vet, m1, m2, ctx };
    if (datos) {
        const cita = (mascota, fecha, hora) => citas.crearCita(db, { mascota: String(mascota), responsable: String(vet), fecha, hora, confirmar: 'on' }, { ahora: NOW }).id;
        d.hoy1 = cita(m1, '2026-11-02', '10:00');
        d.hoy2 = cita(m2, '2026-11-02', '11:00');
        d.hoy3 = cita(m1, '2026-11-02', '14:00');
        d.manana = cita(m2, '2026-11-03', '09:00');
        citas.cambiarEstado(db, d.hoy3, 'cancelada', { actorId: admin });
        citas.cambiarEstado(db, d.hoy2, 'atendida', { actorId: admin });
    }
    return d;
}
const texto = async (agent, url) => (await getHtml(agent, url)).text;

test('contadores: citas de hoy (sin canceladas) con las que faltan por atender, y pacientes activos', async () => {
    const d = await setup();
    assert.deepEqual(panel.citasDeHoy(d.db, NOW), { total: 2, porAtender: 1 });
    mascotas.updateMascota(d.db, d.m2, { nombre: 'Michi', especie: 'Gato', sexo: 'hembra', estado: 'fallecida' }, d.ctx);
    const p = panel.panel(d.db, NOW, 'veterinario');
    assert.equal(p.pacientes, 1, 'una mascota fallecida ya no cuenta');
    assert.equal(p.ventasHoy, null, 'sin ingresos para quien no es administrador');
    assert.deepEqual(panel.citasDeHoy(d.db, new Date('2026-11-03T04:00:00Z')), { total: 2, porAtender: 1 }, 'a las 10 PM del lunes en Managua sigue siendo lunes');
});

test('ventas de hoy: solo administrador, solo pagadas y por día de Managua', async () => {
    const d = await setup();
    const p = productos.createProducto(d.db, { codigo: 'GAS', nombre: 'Gasas', categoria: 'Insumo', unidad: 'u', precio: '10', stock_minimo: '0', stock_inicial: '50' }, d.ctx).id;
    const vender = (fecha, cantidad) => ventas.crearVenta(d.db, { items: [{ tipo: 'producto', id: p, cantidad }], metodo: 'efectivo' }, { actorId: d.admin, ahora: new Date(fecha) });
    vender('2026-11-02T14:00:00Z', 2);                       // hoy 8 AM → C$ 20
    const anulada = vender('2026-11-02T15:30:00Z', 5);
    ventas.anularVenta(d.db, anulada.id, { motivo: 'Error de digitación' }, { actorId: d.admin, ahora: NOW });
    vender('2026-11-02T05:00:00Z', 9);                       // 11 PM del domingo en Managua: no es de hoy
    vender('2026-11-03T05:59:00Z', 1);                       // 11:59 PM de hoy → sí
    assert.deepEqual(panel.ventasDeHoy(d.db, NOW), { cantidad: 2, total: 3000 });
    assert.deepEqual(panel.panel(d.db, NOW, 'admin').ventasHoy, { cantidad: 2, total: 3000 });
    assert.equal(panel.panel(d.db, NOW, 'recepcion').ventasHoy, null);
});

test('alertas: stock bajo y vacunas por vencer (próximas y vencidas, sin las ya refrescadas)', async () => {
    const d = await setup({ datos: false });
    productos.createProducto(d.db, { codigo: 'BAJO', nombre: 'Jeringas', categoria: 'Insumo', unidad: 'u', precio: '5', stock_minimo: '10', stock_inicial: '3' }, d.ctx);
    const rabia = d.db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-001'").get().id;
    const dhpp = d.db.prepare("SELECT id FROM productos WHERE codigo = 'VAC-002'").get().id;
    const vac = (mascota, producto, fecha, proxima) => {
        const c = consultas.crearConsulta(d.db, { motivo: 'Vacunación', diagnostico: 'Sano' }, { actorId: d.vet, ahora: NOW, mascotaId: mascota }).id;
        return vacunas.registrarVacuna(d.db, c, { producto: String(producto), fecha, proxima_dosis: proxima }, { actorId: d.vet, ahora: NOW }).id;
    };
    vac(d.m1, rabia, '2025-11-08', '2026-11-08');   // en 6 días
    vac(d.m2, dhpp, '2025-10-01', '2026-10-01');    // vencida
    vac(d.m1, dhpp, '2026-01-01', '2027-01-01');    // lejana: no
    const vieja = vac(d.m2, rabia, '2025-10-20', '2026-10-20');
    vac(d.m2, rabia, '2026-10-28', '2027-10-28');   // la refresca: la vieja ya no cuenta
    const p = panel.panel(d.db, NOW, 'recepcion');
    assert.equal(p.stockBajo.total, 1);
    assert.deepEqual(p.stockBajo.lista.map((x) => [x.nombre, x.stock, x.stock_minimo]), [['Jeringas', 3, 10]]);
    assert.deepEqual(p.vacunas.lista.map((v) => [v.mascota_nombre, v.vencida]), [['Michi', true], ['Firulais', false]]);
    assert.ok(!p.vacunas.lista.some((v) => v.id === vieja));
    assert.equal(p.vacunas.lista[1].proximaTexto, '08/11/2026');
    // la alerta del panel no depende del consentimiento (es interna)
    d.db.prepare('UPDATE propietarios SET acepta_notificaciones = 0').run();
    assert.equal(panel.panel(d.db, NOW, 'recepcion').vacunas.total, 2);
    assert.equal(panel.panel(d.db, NOW, 'recepcion').recordatorios, 0, 'pero los recordatorios por enviar sí lo respetan');
});

test('las listas del panel muestran máximo 5 y cuentan el total', async () => {
    const d = await setup({ datos: false });
    for (let i = 1; i <= 8; i += 1) productos.createProducto(d.db, { codigo: `B-${i}`, nombre: `Producto ${i}`, categoria: 'Insumo', unidad: 'u', precio: '1', stock_minimo: '5', stock_inicial: '1' }, d.ctx);
    const p = panel.panel(d.db, NOW, 'admin');
    assert.deepEqual([p.stockBajo.total, p.stockBajo.lista.length], [8, 5]);
    const html = await texto(await loginAs(d.app, 'ana', CLAVE), '/');
    assert.match(html, /Stock bajo \(8\)/);
    assert.match(html, /y 3 más/);
});

test('inicio: administrador ve las 4 tarjetas con datos reales; ya no dice "panel en construcción"', async () => {
    const d = await setup();
    const html = await texto(await loginAs(d.app, 'ana', CLAVE), '/');
    assert.doesNotMatch(html, /Panel en construcción|ISS-17/);
    assert.match(html, /<p>Citas de hoy<\/p><strong>2<\/strong><span class="trend">1 por atender<\/span>/);
    assert.match(html, /<p>Pacientes activos<\/p><strong>2<\/strong>/);
    assert.match(html, /<p>Ventas de hoy<\/p><strong>C\$ 0\.00<\/strong><span class="trend trend-neutral">0 ventas<\/span>/);
    assert.match(html, /<p>Recordatorios por enviar<\/p>/);
});

test('inicio: veterinario y recepción NO ven ventas ni ingresos (3 tarjetas)', async () => {
    const d = await setup();
    for (const u of ['vet1', 'rec1']) {
        const html = await texto(await loginAs(d.app, u, CLAVE), '/');
        assert.doesNotMatch(html, /Ventas de hoy/, u);
        assert.equal((html.match(/class="stat-card/g) || []).length, 3, u);
    }
});

test('próximas citas: reales y ordenadas, sin las atendidas ni canceladas, con enlace según el rol', async () => {
    const d = await setup();
    const html = await texto(await loginAs(d.app, 'vet1', CLAVE), '/');
    assert.match(html, /Próximas citas/);
    assert.match(html, /10:00 AM/);
    assert.match(html, /href="\/citas\/\d+">Firulais<\/a> · Laura Mendoza/);
    assert.match(html, /9:00 AM/, 'la de mañana también');
    assert.ok(html.indexOf('10:00 AM') < html.indexOf('9:00 AM'), 'ordenadas por fecha y hora');
    assert.doesNotMatch(html, /2:00 PM/, 'la cancelada no aparece');
    assert.equal((html.match(/class="record"/g) || []).length, 2, 'la atendida tampoco');
    const vacio = await setup({ datos: false });
    assert.match(await texto(await loginAs(vacio.app, 'rec1', CLAVE), '/'), /No hay citas próximas/);
});

test('las alertas del inicio enlazan solo a lo que el rol puede abrir y los textos hostiles se escapan', async () => {
    const d = await setup({ datos: false });
    d.db.prepare("UPDATE mascotas SET nombre = '<img src=x onerror=alert(1)>' WHERE id = ?").run(d.m1);
    productos.createProducto(d.db, { codigo: 'XX', nombre: '<script>alert(2)</script>', categoria: 'Insumo', unidad: 'u', precio: '1', stock_minimo: '5', stock_inicial: '1' }, d.ctx);
    citas.crearCita(d.db, { mascota: String(d.m1), responsable: String(d.vet), fecha: '2026-11-02', hora: '16:00', confirmar: 'on' }, { ahora: NOW });
    const rec = await texto(await loginAs(d.app, 'rec1', CLAVE), '/');
    assert.doesNotMatch(rec, /<img src=x|<script>alert\(2\)/);
    assert.match(rec, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(rec, /href="\/farmacia\?bajo=1"/);
    assert.match(rec, /href="\/recordatorios"/);
    assert.equal((await request(d.app).get('/').set('Accept', 'text/html')).status, 302, 'sin sesión sigue pidiendo login');
});
