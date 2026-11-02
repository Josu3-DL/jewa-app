# Plan y roadmap

Un desarrollador. 3 días. Los issues están en `docs/ISSUES.md` (23 en total) y se agrupan en hitos.

## Hitos
| Hito | Objetivo | Issues |
|---|---|---|
| **Día 1 – Base y recepción** | Proyecto, BD, plantilla responsiva, login, usuarios, ajustes, clientes, mascotas, citas | ISS-01 a ISS-07 |
| **Día 2 – Clínico, inventario y ventas** | Consultas, adjuntos, vacunas, recetas, inventario con lotes, compras, ventas | ISS-08 a ISS-14 |
| **Día 3 – Cierre** | Recordatorios, reportes, panel de inicio, respaldo, pruebas, instalación | ISS-15 a ISS-20 |
| **v2 – Pospuesto** | Lo recortado (ver `01-requerimientos.md`) | ISS-21 a ISS-23 |

## Orden de trabajo por día

### Día 1
1. Base técnica y plantilla responsiva (ISS-01, ISS-02).
2. Autenticación y seguridad; usuarios, roles y bitácora (ISS-03, ISS-04).
3. Ajustes, servicios y datos iniciales (ISS-05).
4. Clientes y mascotas; citas, agenda y grooming (ISS-06, ISS-07).
5. **Cierre del día:** pruebas automatizadas de lo hecho y arranque probado desde la tablet o el teléfono.

### Día 2
1. Consulta e historial con anulación y gráfica de peso (ISS-08).
2. Tratamientos, vacunas y documentos imprimibles (ISS-10); adjuntos (ISS-09).
3. Productos, lotes y alertas; descuento automático (ISS-11, ISS-12).
4. Proveedores y compras; ventas y cobros (ISS-13, ISS-14).
5. **Cierre del día:** prueba del flujo completo (cita → consulta → descuento → cobro).

### Día 3
1. Recordatorios y consentimiento (ISS-15).
2. Reportes y exportación (ISS-16); panel de inicio (ISS-17).
3. Respaldo, restauración y tolerancia a fallos (ISS-18).
4. Pruebas y revisión de seguridad; instalación en la PC y manual (ISS-19, ISS-20).
5. **Cierre:** lista de verificación de salida completa.

## Definición de terminado (por issue)
- [ ] Criterios de aceptación cumplidos.
- [ ] Probado en PC y en un ancho de teléfono (400 px).
- [ ] Permisos por rol probados (el rol sin acceso recibe 403).
- [ ] Validación de entrada y mensajes de error en español.
- [ ] Acción crítica registrada en bitácora.
- [ ] Prueba automatizada o caso manual en `06-pruebas.md`.
- [ ] Sin datos reales ni secretos en el commit.
- [ ] Documentación afectada actualizada.

## Lista de verificación de salida (v1)
- [ ] Un administrador, un veterinario y una recepcionista pueden completar sus casos de uso sin ayuda.
- [ ] Flujo completo: registrar propietario y mascota → cita → consulta → vacuna → descuento de stock → cobro → recibo.
- [ ] Anular una consulta y una venta devuelve el stock.
- [ ] No se puede vender un producto vencido ni sin existencias.
- [ ] No se pueden crear dos citas traslapadas para el mismo responsable.
- [ ] Una tablet y un teléfono reales, conectados por Wi-Fi, usan el sistema sin desbordes ni controles pequeños.
- [ ] El servidor arranca solo al encender la PC y sigue activo sin suspensión.
- [ ] Respaldo automático a unidad externa ejecutado y **restauración probada** en una base limpia.
- [ ] Revisión de seguridad hecha (`docs/06-pruebas.md`, sección Seguridad).
- [ ] Manual de usuario y runbook entregados.

## Riesgos del plan
Ver `08-huecos-y-riesgos.md`. Si el Día 2 se atrasa, el orden de recorte es: adjuntos (ISS-09) → carné imprimible y gráfica de peso (dentro de ISS-10 e ISS-08) → reportes menos críticos (RF-37, RF-38, dentro de ISS-16).
