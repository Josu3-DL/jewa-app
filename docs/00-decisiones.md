# Decisiones

Registro de decisiones. Formato: **ID – decisión – motivo – estado**.
Estados: ✅ tomada · 🟡 propuesta (se asume si no hay objeción) · ❓ abierta (bloquea o cambia trabajo).

## Tomadas / propuestas

| ID | Decisión | Motivo | Estado |
|---|---|---|---|
| D-01 | El documento de requerimientos es la referencia funcional. El alcance de la v1 se recorta según `01-requerimientos.md`. | Un solo desarrollador, 3 días. | ✅ |
| D-02 | Los estilos de la interfaz salen de `design/styles.css` sin cambiar el aspecto. Las pantallas nuevas usan los mismos componentes. | Indicación del cliente. | ✅ |
| D-03 | Pila: Node 24 + Express + EJS + `node:sqlite`. | Sin dependencias nativas, despliegue de un solo proceso, respaldo = copiar archivo. | 🟡 |
| D-04 | Contraseñas con `scrypt` de `node:crypto`. | Evita la dependencia nativa de `bcrypt`/`argon2`. | 🟡 |
| D-05 | Dinero como enteros en centavos. | Evita errores de redondeo con `float`. | 🟡 |
| D-06 | Un solo rol por usuario: Administrador, Veterinario, Recepcionista. El "Encargado de inventario" lo cubre el Administrador. | RF-03 define 3 roles. | 🟡 |
| D-07 | Grooming = tipo de cita con servicios y precio, no un módulo aparte con datos propios. | Evita duplicar agenda y cobros. | 🟡 |
| D-08 | "Facturación" del diseño = **Ventas y cobros** con recibo interno imprimible. No es factura fiscal. | La factura electrónica está fuera de alcance (sección 1.4). | 🟡 |
| D-09 | Recordatorios: lista diaria de pendientes + botón que abre `wa.me` con el mensaje prellenado. Sin API de WhatsApp Business. | Costo, aprobación de plantillas de Meta y plazo. | 🟡 |
| D-10 | Correo automático (SMTP) pospuesto. | Requiere proceso programado, SMTP y manejo de rebotes. | 🟡 |
| D-11 | PDF = vista imprimible con CSS `@media print`. Excel = CSV. | Sin librerías extra. | 🟡 |
| D-12 | Zona horaria `America/Managua` (UTC−6, sin horario de verano). Fechas en BD en ISO UTC. | Evita errores en agenda y recordatorios. | 🟡 |
| D-13 | Sin multisucursal en la v1. | Contradice el alcance y complica el modelo. | 🟡 |
| D-14 | Nada de borrado físico de datos clínicos, ventas ni inventario. Solo anulación con motivo. | RF-19, RN-03. | ✅ |
| D-15 | Inventario por **lotes** con vencimiento y salida FEFO (primero en vencer, primero en salir). | RN-04 y RF-28 no funcionan solo por producto. | 🟡 |
| D-16 | Catálogo de medicamentos y productos de inventario unificados (`productos.es_medicamento`). | RF-21 y RF-26 duplicaban datos. | 🟡 |
| D-17 | `Expediente` se fusiona con `Mascota`; el número de expediente es un campo (`EXP-000123`). | RF-13: relación 1:1, sin valor como entidad aparte. | 🟡 |
| D-18 | Se permite una consulta sin cita previa (urgencia, sin cita). | El CU-05 exigía cita; no es realista. | 🟡 |
| D-19 | Los recursos externos del diseño (foto de Unsplash) se reemplazan por un recurso local o se quitan. | Dependencia externa y licencia. | 🟡 |
| D-20 | Disponibilidad: "mejor esfuerzo" + respaldo diario, no 99 %. | Un solo desarrollador y un solo servidor. | 🟡 |
| D-22 | Nombre de marca: **JEWA** (configurable en Ajustes). | Respuesta del cliente (resuelve Q-01). | ✅ |
| D-23 | Moneda: **córdoba (C$)**. Importes en centavos; formato `C$ 1,234.50`. IVA como porcentaje en Ajustes, 0 por defecto. | Respuesta del cliente (resuelve Q-02). | ✅ |
| D-24 | Despliegue en **una PC de la clínica**, accesible por la red local desde la misma PC, tablet y teléfono. El servidor escucha en `0.0.0.0` y no se expone a internet. | Respuesta del cliente (resuelve Q-03). | ✅ |
| D-25 | En la LAN se usa HTTP; la cookie `Secure` se controla con `COOKIE_SECURE` (falso en LAN). Riesgo aceptado: tráfico sin cifrar dentro de una Wi-Fi protegida. HTTPS interno queda para la v2. | Un certificado propio en cada tablet/teléfono es impráctico. | 🟡 |
| D-26 | La PC es el único servidor: respaldo diario a una **unidad externa** (USB/disco), no al mismo disco. | Si la PC falla, sin copia externa se pierde todo. | 🟡 |
| D-27 | Interfaz diseñada para PC, tablet (768 px) y teléfono (400 px) con controles táctiles ≥ 44 px. | Requisito del cliente. | ✅ |
| D-28 | **Librerías antes que código propio:** para todo lo que no sea lógica de la clínica se busca una librería mantenida (sin módulos nativos). Ver `CLAUDE.md` y la tabla de `docs/02-arquitectura.md`. | Menos código que mantener, más fácil de entender para otros desarrolladores. Pedido del cliente el 2026-11-02. | ✅ |
| D-29 | Se adoptan `csrf-sync` (CSRF), `express-rate-limit` (freno de login por IP), `zod` + `libphonenumber-js` (validación y teléfonos), `helmet` y `express-session`. Se mantiene propio: el almacén de sesiones en `node:sqlite` (no hay paquete con uso real), el hash `scrypt` de `node:crypto` y el ejecutor de migraciones. | Ver razones en `docs/02-arquitectura.md`. | ✅ |
| D-30 | Los usuarios no cambian su propia contraseña en la v1: la restablece el administrador (RF-02). Desactivar a un usuario o restablecerle la contraseña **cierra sus sesiones abiertas**; un cambio de rol rige desde su siguiente petición. Nadie puede desactivarse ni cambiarse el rol a sí mismo, y siempre queda un administrador activo. | RF-02 y RN-09; evita que un administrador se deje fuera. Si el cliente quiere "cambiar mi contraseña", es un issue nuevo. | 🟡 |
| D-21 | La agenda pertenece a un "responsable" (usuario con `atiende_citas = 1`), no solo a veterinarios. Sirve para el groomer. | El documento no define quién atiende grooming. | 🟡 |

## Abiertas (necesitan respuesta)

| ID | Pregunta | Opciones | Valor por defecto si no hay respuesta |
|---|---|---|---|
| ~~Q-01~~ | ~~Nombre de marca~~ → **JEWA** (D-22) | | resuelta |
| ~~Q-02~~ | ~~Moneda~~ → **C$** (D-23). Pendiente: ¿se cobra IVA (15 %)? | Sí / No | Sin IVA (0 %) |
| ~~Q-03~~ | ~~Despliegue~~ → **PC de la clínica** (D-24) | | resuelta |
| Q-09 | ¿La PC queda encendida todo el horario de la clínica? ¿Hay UPS? ¿Hay una unidad externa para respaldos? | — | Se asume que sí y se documenta como requisito |
| Q-10 | ¿Los dispositivos usarán el Wi-Fi de la clínica y el router permite reservar una IP para la PC? | — | Se asume que sí |
| Q-04 | ¿Los veterinarios tienen número de colegiado que deba salir en la receta? | Sí / No | Campo opcional |
| Q-05 | Horario laboral y duración estándar de cita. | — | L–V 8:00–17:00, S 8:00–12:00, 30 min |
| Q-06 | ¿Se necesitan pagos parciales o crédito a clientes? | Sí / No | No: pago completo al cobrar |
| Q-07 | ¿Cuántos usuarios simultáneos y cuántos veterinarios? | — | 5 usuarios, 2 veterinarios |
| Q-08 | ¿Hay datos existentes (Excel) para importar? | Sí / No | No, carga manual |

> Si en el chat no se responde una pregunta, se asume el valor por defecto y se anota aquí.

### Confirmación del 2026-11-02
El cliente autorizó empezar el Día 1 con estos valores. Se revisan si algo cambia:

| Pregunta | Valor adoptado |
|---|---|
| IVA | 0 % (configurable en Ajustes) |
| Q-04 Colegiado en receta | Campo opcional |
| Q-05 Horario y cita | L–V 8:00–17:00, S 8:00–12:00, 30 min |
| Q-06 Pagos parciales o crédito | No: pago completo al cobrar |
| Q-07 Usuarios | 5 simultáneos, 2 veterinarios |
| Q-08 Importación | No: carga manual |
| Q-09 PC encendida, UPS, unidad externa | Sí: PC siempre encendida en horario y unidad externa disponible |
| Q-10 IP fija y Wi-Fi | Sí: IP reservada en el router |
