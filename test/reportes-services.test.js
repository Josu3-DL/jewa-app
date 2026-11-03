'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb } = require('./helpers');
const reportes = require('../src/services/reportes');
const ventas = require('../src/services/ventas');
const productos = require('../src/services/productos');
const citas = require('../src/services/citas');
const propietarios = require('../src/services/propietarios');
const mascotas = require('../src/services/mascotas');

const AHORA = new Date('2026-11-02T15:00:00Z'); // lunes 9:00 AM en Managua
const ctx = { ahora: AHORA, ip: '127.0.0.1' };

function base() {
    const db = testDb();
    const admin = Number(db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES ('Ana', 'ana', 'x', 'admin')").run().lastInsertRowid);
    const vet = Number(db.prepare("INSERT INTO usuarios (nombre, usuario, password_hash, rol, atiende_citas) VALUES ('Vet Uno', 'vet1', 'x', 'veterinario', 1)").run().lastInsertRowid);
    const cc = { actorId: admin, ...ctx };
    const gasas = productos.createProducto(db, { codigo: 'GAS-1', nombre: 'Gasas', categoria: 'Insumo', unidad: 'unidad', precio: '10', stock_minimo: '0', stock_inicial: '100' }, cc).id;
    const servicio = db.prepare("SELECT id FROM servicios WHERE nombre = 'Baño'").get().id;
    db.prepare('UPDATE servicios SET precio = 25000 WHERE id = ?').run(servicio);
    const dueno = propietarios.createPropietario(db, { nombre: 'Laura Mendoza', telefono: '8888 7777', acepta_notificaciones: 'on' }, cc).id;
    const m = mascotas.createMascota(db, { propietario: String(dueno), nombre: 'Firulais', especie: 'Perro', sexo: 'macho' }, cc).id;
    return { db, admin, vet, gasas, servicio, m, cc };
}
const vender = (d, fecha, items, metodo = 'efectivo', extra = {}) => ventas.crearVenta(d.db, { items, metodo, ...extra }, { actorId: d.admin, ahora: new Date(fecha) });
const it = (tipo, id, cantidad) => ({ tipo, id, cantidad });

test('ventas por día: agrupa por día de Managua, separa por método y no suma las anuladas', () => {
    const d = base();
    vender(d, '2026-10-30T15:00:00Z', [it('servicio', d.servicio, 1)], 'efectivo');                 // 30/oct 9 AM
    vender(d, '2026-10-30T16:00:00Z', [it('producto', d.gasas, 3)], 'tarjeta');                     // 30/oct
    vender(d, '2026-10-31T03:00:00Z', [it('servicio', d.servicio, 2)], 'transferencia');            // 30/oct 9 PM (UTC ya es 31)
    const anulada = vender(d, '2026-10-30T17:00:00Z', [it('servicio', d.servicio, 1)], 'efectivo');
    ventas.anularVenta(d.db, anulada.id, { motivo: 'Error de digitación' }, { actorId: d.admin, ahora: AHORA });
    vender(d, '2026-11-01T15:00:00Z', [it('servicio', d.servicio, 1)], 'efectivo', { descuento: 5000 });
    const r = reportes.ventasPorDia(d.db, { desde: '2026-10-30', hasta: '2026-11-02' });
    assert.deepEqual(r.filas.map((f) => f.dia), ['2026-10-30', '2026-11-01']);
    const [a, b] = r.filas;
    assert.deepEqual([a.ventas, a.anuladas, a.total, a.efectivo, a.tarjeta, a.transferencia], [3, 1, 25000 + 3000 + 50000, 25000, 3000, 50000]);
    assert.deepEqual([b.ventas, b.subtotal, b.descuento, b.total], [1, 25000, 5000, 20000]);
    assert.deepEqual([r.totales.ventas, r.totales.anuladas, r.totales.total, r.totales.descuento], [4, 1, 98000, 5000]);
    assert.deepEqual(reportes.ventasPorDia(d.db, { desde: '2026-10-31', hasta: '2026-10-31' }).filas, [], 'la venta de las 9 PM del 30 no es del 31');
    assert.deepEqual(reportes.ventasPorDia(d.db, { desde: '2026-12-01', hasta: '2026-12-31' }).totales.total, 0);
});

test('citas: por período, responsable y estado, con el conteo por estado', () => {
    const d = base();
    const cita = (fecha, hora, extra = {}) => citas.crearCita(d.db, { mascota: String(d.m), responsable: String(d.vet), fecha, hora, confirmar: 'on', ...extra }, ctx).id;
    const a = cita('2026-11-03', '09:00');
    const b = cita('2026-11-03', '10:00');
    cita('2026-11-04', '09:00');
    cita('2026-12-01', '09:00');
    citas.cambiarEstado(d.db, a, 'cancelada', ctx);
    citas.cambiarEstado(d.db, b, 'confirmada', ctx);
    const todas = reportes.citasReporte(d.db, { desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(todas.total, 3);
    assert.deepEqual(todas.porEstado, { programada: 1, confirmada: 1, en_espera: 0, atendida: 0, no_asistio: 0, cancelada: 1 });
    assert.deepEqual(reportes.citasReporte(d.db, { desde: '2026-11-01', hasta: '2026-11-30', estado: 'cancelada' }).filas.map((c) => c.id), [a]);
    assert.equal(reportes.citasReporte(d.db, { desde: '2026-11-01', hasta: '2026-11-30', responsable: d.vet + 99 }).total, 0);
    assert.equal(reportes.citasReporte(d.db, { desde: '2026-11-03', hasta: '2026-11-03', responsable: d.vet }).total, 2);
});

test('stock bajo: productos en o bajo el mínimo con lo que falta', () => {
    const d = base();
    productos.createProducto(d.db, { codigo: 'BAJO', nombre: 'Gasas finas', categoria: 'Insumo', unidad: 'u', precio: '5', stock_minimo: '10', stock_inicial: '4' }, d.cc);
    productos.createProducto(d.db, { codigo: 'OK', nombre: 'Guantes', categoria: 'Insumo', unidad: 'u', precio: '5', stock_minimo: '10', stock_inicial: '50' }, d.cc);
    const r = reportes.stockBajo(d.db);
    assert.deepEqual(r.map((p) => [p.codigo, p.stock, p.stock_minimo, p.faltante]), [['BAJO', 4, 10, 6]]);
});

test('filtros: por defecto del 1.º del mes a hoy; fechas inválidas, al revés o muy largas vuelven al rango por defecto con aviso', () => {
    assert.deepEqual(reportes.leerFiltros({}, AHORA), { desde: '2026-11-01', hasta: '2026-11-02', responsable: undefined, estado: undefined, pagina: undefined, error: null });
    const ok = reportes.leerFiltros({ desde: '2026-10-01', hasta: '2026-10-31', estado: 'atendida', responsable: '3', pagina: '2' }, AHORA);
    assert.deepEqual([ok.desde, ok.hasta, ok.estado, ok.responsable, ok.pagina, ok.error], ['2026-10-01', '2026-10-31', 'atendida', 3, 2, null]);
    assert.match(reportes.leerFiltros({ desde: 'mal' }, AHORA).error, /Fecha no válida/);
    assert.match(reportes.leerFiltros({ desde: '2026-02-30' }, AHORA).error, /Fecha no válida/);
    assert.match(reportes.leerFiltros({ desde: '2026-11-05', hasta: '2026-11-01' }, AHORA).error, /posterior/);
    const largo = reportes.leerFiltros({ desde: '2020-01-01', hasta: '2026-11-01' }, AHORA);
    assert.match(largo.error, /no puede pasar de 366 días/);
    assert.equal(largo.desde, '2026-11-01');
    assert.equal(reportes.leerFiltros({ estado: 'inventado', responsable: "1; DROP TABLE" }, AHORA).estado, undefined);
});

test('CSV: BOM UTF-8, líneas CRLF, encabezados en español, comillas y comas bien escapadas, tildes intactas', () => {
    const csv = reportes.aCsv([{ clave: 'a', titulo: 'Día' }, { clave: 'b', titulo: 'Nota' }], [{ a: 'x', b: 'con "comillas", coma\ny salto' }, { a: 'ñandú', b: 'ok' }]);
    assert.equal(csv.charCodeAt(0), 0xFEFF, 'empieza con el BOM');
    assert.equal(csv, '﻿Día,Nota\r\nx,"con ""comillas"", coma\ny salto"\r\nñandú,ok\r\n');
});

test('CSV: protección contra inyección de fórmulas (= + - @ tab retorno) sin dañar el texto normal ni los números', () => {
    for (const peligroso of ['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\t=x', '\r=x']) assert.equal(reportes.protegerCelda(peligroso), `'${peligroso}`, JSON.stringify(peligroso));
    for (const seguro of ['Laura Mendoza', 'Perro-Gato', '12.50', 'a=b', '']) assert.equal(reportes.protegerCelda(seguro), seguro, seguro);
    assert.equal(reportes.protegerCelda(42), 42);
    const csv = reportes.aCsv([{ clave: 'n', titulo: 'Nombre' }, { clave: 'v', titulo: 'Valor' }], [{ n: '=HYPERLINK("http://x")', v: 5 }, { n: '@admin', v: 0 }]);
    assert.doesNotMatch(csv, /\r\n=|\r\n@/, 'ninguna celda empieza con un carácter de fórmula');
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)",5/);
});

test('CSV de ventas: importes en decimal sin símbolo, fila TOTAL y anuladas contadas aparte', () => {
    const d = base();
    vender(d, '2026-11-01T15:00:00Z', [it('producto', d.gasas, 3)], 'tarjeta');
    vender(d, '2026-11-01T16:00:00Z', [it('servicio', d.servicio, 1)], 'efectivo', { descuento: 1000 });
    const csv = reportes.csvVentas(d.db, { desde: '2026-11-01', hasta: '2026-11-02' });
    assert.equal(csv, '﻿Día,Ventas,Anuladas,Subtotal,Descuento,IVA,Total,Efectivo,Tarjeta,Transferencia\r\n'
        + '2026-11-01,2,0,280.00,10.00,0.00,270.00,240.00,30.00,0.00\r\n'
        + 'TOTAL,2,0,280.00,10.00,0.00,270.00,240.00,30.00,0.00\r\n');
    assert.equal(reportes.dinero2(5), '0.05');
    assert.equal(reportes.dinero2(123456), '1234.56');
});

test('CSV de citas y de stock: columnas y valores legibles; texto con = queda protegido', () => {
    const d = base();
    d.db.prepare("UPDATE mascotas SET nombre = '=EVIL()' WHERE id = ?").run(d.m);
    citas.crearCita(d.db, { mascota: String(d.m), responsable: String(d.vet), fecha: '2026-11-03', hora: '14:30', motivo: 'Vacuna, refuerzo', confirmar: 'on' }, ctx);
    const csv = reportes.csvCitas(d.db, { desde: '2026-11-03', hasta: '2026-11-03' });
    const [enc, fila] = csv.replace('﻿', '').split('\r\n');
    assert.equal(enc, 'Fecha,Hora,Mascota,Expediente,Propietario,Servicio,Responsable,Estado,Motivo');
    assert.equal(fila, "03/11/2026,2:30 PM,'=EVIL(),EXP-000001,Laura Mendoza,,Vet Uno,Programada,\"Vacuna, refuerzo\"");
    productos.createProducto(d.db, { codigo: 'BAJO', nombre: 'Gasas finas', categoria: 'Insumo', unidad: 'u', precio: '5', stock_minimo: '10', stock_inicial: '4' }, d.cc);
    assert.equal(reportes.csvStock(d.db), '﻿Código,Producto,Stock,Mínimo,Faltan\r\nBAJO,Gasas finas,4,10,6\r\n');
});
