# Lista de issues

> Generado por `node scripts/issues.mjs md`. Editar `scripts/issues.mjs`, no este archivo.

Total: 23 issues.

## Día 1 – Base y recepción (7)

| ID | Título | Etiquetas | Referencias |
|---|---|---|---|
| ISS-01 | Base técnica: proyecto, scripts, migraciones y esquema | tipo:tecnico, prio:alta, v1 | docs/02-arquitectura.md · docs/03-modelo-datos.md |
| ISS-02 | Plantilla común responsiva (PC, tablet y teléfono) | tipo:ui, prio:alta, v1 | docs/04-diseno-ui.md · design/styles.css |
| ISS-03 | Autenticación y seguridad web | tipo:funcional, tipo:seguridad, prio:alta, v1 | RF-01 · RNF-04 · CU-01 |
| ISS-04 | Usuarios, roles y bitácora de auditoría | tipo:funcional, tipo:seguridad, prio:alta, v1 | RF-02 · RF-03 · RF-04 · RNF-11 · CU-02 |
| ISS-05 | Ajustes, datos iniciales y catálogo de servicios | tipo:funcional, prio:alta, v1 | RF-41 · RF-42 · H-02 · Q-05 |
| ISS-06 | Clientes y mascotas | tipo:funcional, prio:alta, v1 | RF-05 · RF-06 · RF-07 · RF-08 · RF-13 · RN-01 |
| ISS-07 | Citas, agenda y grooming | tipo:funcional, prio:alta, v1 | RF-09 · RF-10 · RF-11 · RF-12 · RF-44 · RN-07 · D-07 · D-21 |

### ISS-01 – Base técnica: proyecto, scripts, migraciones y esquema

Etiquetas: tipo:tecnico, prio:alta, v1  
Referencias: docs/02-arquitectura.md · docs/03-modelo-datos.md

- [ ] Carpetas `src/`, `public/`, `test/`, `scripts/` según arquitectura
- [ ] `package.json` con `start`, `test`, `migrate`, `seed:admin`, `backup`; sin la dependencia `sqlite3`
- [ ] `.env.example` sin valores reales; `config.js` valida variables obligatorias (incluye `HOST`, `PORT`, `COOKIE_SECURE`)
- [ ] Migraciones SQL numeradas, aplicadas en orden e idempotentes (repetir `migrate` no falla)
- [ ] `foreign_keys=ON`, WAL y `busy_timeout` activos en cada conexión
- [ ] Todas las tablas del modelo con `CHECK` y claves foráneas; índices en cédula, teléfono, nombre, expediente y `citas(responsable, inicio)`
- [ ] Ruta `/salud` responde 200 si la BD abre
- [ ] Manejo central de errores (403, 404, 500) sin trazas al usuario

### ISS-02 – Plantilla común responsiva (PC, tablet y teléfono)

Etiquetas: tipo:ui, prio:alta, v1  
Referencias: docs/04-diseno-ui.md · design/styles.css

- [ ] `styles.css` copiado sin cambiar el aspecto; `layout.ejs` con barra lateral, barra superior y pie como partials
- [ ] Menú coherente y numeración correcta; elemento activo marcado por el servidor; filtrado por rol
- [ ] Usuario y rol reales en la barra superior; fecha generada en servidor (zona Managua)
- [ ] Estilos nuevos `status-done`, `status-cancelled`, `status-noshow` con la paleta existente
- [ ] Imagen externa de Unsplash reemplazada por recurso local
- [ ] Responsivo en tres anchos: PC (1366 px), tablet (768 px) y teléfono (400 px), sin desbordamiento horizontal
- [ ] Controles táctiles de al menos 44 px; campos con tipo de teclado correcto (`tel`, `number`, `date`)
- [ ] Tablas dentro de contenedores con desplazamiento propio; en teléfono las listas se apilan
- [ ] Página de inicio provisional para poder navegar (el panel real es ISS-17)

### ISS-03 – Autenticación y seguridad web

Etiquetas: tipo:funcional, tipo:seguridad, prio:alta, v1  
Referencias: RF-01 · RNF-04 · CU-01

- [ ] Pantalla de login con los componentes del diseño, usable en teléfono
- [ ] Contraseña con scrypt + sal; mensaje de error genérico; bloqueo de 15 min tras 5 intentos (T-01)
- [ ] Sesión con cookie `HttpOnly`, `SameSite=Lax`; `Secure` según `COOKIE_SECURE` (en LAN con HTTP va en falso); expira a los 30 min sin actividad
- [ ] Cerrar sesión invalida la sesión en servidor; rutas protegidas redirigen a login (T-02)
- [ ] Token CSRF en todo POST; sin token → 403 (T-04)
- [ ] `helmet` con CSP restrictiva
- [ ] Utilidades de validación (texto, número, fecha, teléfono) con mensajes en español
- [ ] Revisión: ningún `<%-` con datos de usuario ni SQL concatenado; prueba T-21

### ISS-04 – Usuarios, roles y bitácora de auditoría

Etiquetas: tipo:funcional, tipo:seguridad, prio:alta, v1  
Referencias: RF-02 · RF-03 · RF-04 · RNF-11 · CU-02

- [ ] Crear, editar, desactivar usuarios y restablecer contraseña (solo admin); no se desactiva al último administrador
- [ ] Roles admin, veterinario, recepción con la matriz de `02-arquitectura.md`; `requireRole` en cada router (T-03)
- [ ] Campos `colegiado` y `atiende_citas`
- [ ] `npm run seed:admin` pide credenciales por consola; no hay credenciales en el repositorio
- [ ] `audit.log(usuario, acción, entidad, id, detalle)` usado por todos los módulos; tabla solo de inserción
- [ ] Pantalla de bitácora para el admin con filtros por usuario, fecha y entidad
- [ ] No se registran contraseñas ni datos sensibles innecesarios

### ISS-05 – Ajustes, datos iniciales y catálogo de servicios

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-41 · RF-42 · H-02 · Q-05

- [ ] Ajustes (solo admin): nombre (JEWA), teléfono, dirección, moneda C$, % de IVA (0 por defecto), horario laboral, duración estándar de cita
- [ ] Formato de dinero `C$ 1,234.50` desde `utils/money.js`
- [ ] CRUD de servicios con tipo (consulta, vacuna, grooming, seguimiento, otro), precio y duración; desactivar no afecta citas ni ventas históricas
- [ ] Seed: servicios base y plantillas de recordatorio por defecto
- [ ] El nombre de la clínica se lee de la configuración en layout, recibos y recetas

### ISS-06 – Clientes y mascotas

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-05 · RF-06 · RF-07 · RF-08 · RF-13 · RN-01

- [ ] Propietarios: crear/editar/desactivar; teléfono normalizado a 505XXXXXXXX; cédula única y opcional
- [ ] Campo de consentimiento de notificaciones (por defecto aceptado), con cambios registrados en bitácora
- [ ] No se desactiva un propietario con mascotas activas (T-16)
- [ ] Mascotas: propietario seleccionado (no texto libre) y número `EXP-000123` automático; estado activa/fallecida/inactiva; edad calculada
- [ ] Foto como archivo (máx. 2 MB, jpg/png/webp), sin base64
- [ ] Transferencia a otro propietario con historial de propietarios
- [ ] Búsqueda por nombre, cédula, teléfono o expediente, con paginación de 25
- [ ] Ficha de la mascota con datos y accesos a historial, vacunas, peso y citas; el propietario muestra sus mascotas

### ISS-07 – Citas, agenda y grooming

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-09 · RF-10 · RF-11 · RF-12 · RF-44 · RN-07 · D-07 · D-21

- [ ] Formulario con mascota, responsable, servicio, fecha, hora y motivo; fin = inicio + duración del servicio
- [ ] Estados: programada, confirmada, en espera, atendida, no asistió, cancelada; cambios en bitácora
- [ ] Rechaza traslape del mismo responsable; una cita cancelada libera el horario (T-05, T-06, T-07)
- [ ] Advierte fuera del horario laboral o en fecha pasada (T-22)
- [ ] Vista de día y de semana con filtro por responsable; en teléfono la semana se muestra como lista
- [ ] Listas de próximas citas y de pendientes de confirmación; acciones rápidas de cambio de estado
- [ ] Grooming es un tipo de servicio: filtro "Grooming" y responsable con `atiende_citas` (no necesita ser veterinario)

## Día 2 – Clínico, inventario y ventas (7)

| ID | Título | Etiquetas | Referencias |
|---|---|---|---|
| ISS-08 | Consulta e historial clínico | tipo:funcional, prio:alta, v1 | RF-14 · RF-15 · RF-16 · RF-17 · RF-19 · RN-02 · RN-03 · CU-05 · CU-08 · D-18 |
| ISS-09 | Adjuntos del expediente | tipo:funcional, tipo:seguridad, prio:media, v1 | RF-18 |
| ISS-10 | Tratamientos, vacunas y documentos imprimibles | tipo:funcional, prio:alta, v1 | RF-20 · RF-22 · RF-23 · RF-24 · RN-02 · RN-05 · CU-06 · CU-07 |
| ISS-11 | Productos y stock simple con alertas | tipo:funcional, prio:alta, v1 | RF-21 · RF-26 · RF-27 · D-16 · D-41 |
| ISS-12 | Descuento automático de inventario y reversas | tipo:funcional, prio:alta, v1 | RF-25 · RN-04 · RN-08 |
| ISS-13 | Proveedores y registro de compras | tipo:funcional, prio:media, v1 | RF-29 · RF-30 (simplificado) |
| ISS-14 | Ventas y cobros con recibo imprimible | tipo:funcional, prio:alta, v1 | RF-43 · RN-08 · RN-09 · D-41 |

### ISS-08 – Consulta e historial clínico

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-14 · RF-15 · RF-16 · RF-17 · RF-19 · RN-02 · RN-03 · CU-05 · CU-08 · D-18

> Los insumos usados en la consulta ya no se registran ni descuentan (D-41/D-38): el stock se descuenta solo en la venta (ISS-14).

- [ ] Solo el veterinario crea consultas (T-03)
- [ ] Motivo, anamnesis, examen físico, diagnóstico, observaciones, peso, temperatura, FC y FR, con validación de rangos
- [ ] Desde una cita (precarga datos y la pasa a atendida) o sin cita (urgencia)
- [ ] Historial cronológico de la mascota con filtros
- [ ] No existe ruta ni botón de borrado; "Anular" exige motivo y queda registrado quién, cuándo y por qué (T-12, T-13)
- [ ] La consulta anulada se muestra marcada y conserva su contenido
- [ ] Gráfica de evolución del peso con Chart.js local; mensaje claro con menos de 2 mediciones; ignora consultas anuladas
- [ ] Formulario usable en tablet y teléfono

### ISS-09 – Adjuntos del expediente

Etiquetas: tipo:funcional, tipo:seguridad, prio:media, v1  
Referencias: RF-18

- [ ] jpg, png, webp y pdf; máximo 5 MB; nombre generado
- [ ] Guardados fuera de `public/` y servidos por ruta autenticada con control de rol
- [ ] Rechaza otros tipos y tamaños (T-19)
- [ ] En teléfono permite elegir foto de la galería o tomarla con la cámara
- [ ] Incluidos en el respaldo

### ISS-10 – Tratamientos, vacunas y documentos imprimibles

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-20 · RF-22 · RF-23 · RF-24 · RN-02 · RN-05 · CU-06 · CU-07

> Alcance académico (D-41): un solo imprimible obligatorio (el carné); la receta comparte la hoja y se incluyó.

- [ ] Tratamientos en una consulta: medicamento del catálogo o texto, dosis, frecuencia, duración e indicaciones
- [ ] Vacunas: producto, lote (único, asignado solo), fecha, próxima dosis y veterinario; próxima dosis obligatoria (T-14)
- [ ] Registrar una vacuna NO descuenta stock (el producto se cobra en la venta)
- [ ] Carné de vacunación imprimible por mascota
- [ ] Receta imprimible (opcional) con datos de la clínica, mascota, propietario y veterinario (y colegiado si existe)
- [ ] Impresión limpia con `@media print`, sin barra lateral ni botones

### ISS-11 – Productos y stock simple con alertas

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-21 · RF-26 · RF-27 · D-16 · D-41

> Alcance académico (D-41): sin lotes con vencimiento, FEFO ni kárdex detallado.

- [ ] CRUD de productos (solo admin): código, categoría, es_medicamento, presentación, unidad, precio, stock mínimo; desactivar en lugar de borrar
- [ ] Cada producto tiene un lote único interno (`UNICO`) creado automáticamente; sin vencimientos ni FEFO
- [ ] Entrada manual de stock con nota y ajuste con motivo (solo admin); lista simple de movimientos por producto
- [ ] Stock nunca negativo (T-09, se completa al vender en ISS-14)
- [ ] Alerta de stock bajo el mínimo, visible en Farmacia (y en Inicio vía ISS-17)
- [ ] Las 4 vacunas base de la migración 003 aparecen en el catálogo

### ISS-12 – Descuento automático de inventario y reversas

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-25 · RN-04 · RN-08

> Alcance académico (D-41): cerrado como "no planificado"; absorbido por ISS-14.

- [ ] NO SE IMPLEMENTA POR SEPARADO: el descuento de stock y la reversa al anular se hacen en ISS-14 (ventas)

### ISS-13 – Proveedores y registro de compras

Etiquetas: tipo:funcional, prio:media, v1  
Referencias: RF-29 · RF-30 (simplificado)

> Alcance académico (D-41): cerrado como "no planificado".

- [ ] NO SE IMPLEMENTA: la entrada de stock es manual, con nota, dentro de ISS-11

### ISS-14 – Ventas y cobros con recibo imprimible

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-43 · RN-08 · RN-09 · D-41

> Alcance académico (D-41): absorbe el descuento de inventario (ISS-12); sin vencidos ni FEFO.

- [ ] Carrito con productos y servicios; descuento; método efectivo, tarjeta o transferencia; pago completo (sin pagos parciales)
- [ ] Descuenta stock en transacción y rechaza vender sin existencias (T-09)
- [ ] Número de venta `V-000123` y recibo imprimible en córdobas (reutiliza las hojas de ISS-10)
- [ ] Anular venta (solo admin) con motivo y devolución del stock (T-15)
- [ ] Importes en centavos enteros (T-18); IVA según Ajustes
- [ ] Venta asociada a un propietario o de mostrador
- [ ] Usable en tablet y teléfono

## Día 3 – Cierre (6)

| ID | Título | Etiquetas | Referencias |
|---|---|---|---|
| ISS-15 | Recordatorios y consentimiento | tipo:funcional, prio:alta, v1 | RF-31 · RF-32 · RF-33 · RF-34 · RF-35 · RN-06 · D-09 · Ley 787 |
| ISS-16 | Reportes y exportación | tipo:funcional, prio:alta, v1 | RF-36 · RF-40 (simplificado) · D-41 |
| ISS-17 | Panel de inicio con datos reales | tipo:funcional, tipo:ui, prio:media, v1 | RF-45 · U-02 · D-41 |
| ISS-18 | Respaldo y restauración | tipo:tecnico, prio:alta, v1 | RNF-06 · RF-46 · docs/07-despliegue-operacion.md · D-41 |
| ISS-19 | Pruebas y revisión de seguridad final | tipo:pruebas, tipo:seguridad, prio:alta, v1 | docs/06-pruebas.md · RNF-04 · RNF-05 |
| ISS-20 | Instalación: README de 5 pasos | tipo:tecnico, tipo:docs, prio:media, v1 | docs/07-despliegue-operacion.md · D-41 |

### ISS-15 – Recordatorios y consentimiento

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-31 · RF-32 · RF-33 · RF-34 · RF-35 · RN-06 · D-09 · Ley 787

> Alcance académico (D-41): sin plantillas editables, sin historial de envíos, sin exportación de la ficha del titular ni aviso de privacidad en Ajustes.

- [ ] Lista diaria: citas de las próximas 24 h y vacunas próximas o vencidas (por próxima dosis)
- [ ] Mensaje prellenado; botón "WhatsApp" abre `wa.me/505XXXXXXXX?text=...`; "Marcar enviado" guarda estado y usuario
- [ ] Excluye a clientes sin consentimiento (T-17)

### ISS-16 – Reportes y exportación

Etiquetas: tipo:funcional, prio:alta, v1  
Referencias: RF-36 · RF-40 (simplificado) · D-41

> Alcance académico (D-41): solo 3 reportes.

- [ ] Reporte de ventas por día
- [ ] Reporte de citas por período, responsable y estado
- [ ] Reporte de stock bajo el mínimo
- [ ] Filtros por fecha y permisos por rol
- [ ] Exportar a CSV (UTF-8 con BOM) con protección contra inyección de fórmulas

### ISS-17 – Panel de inicio con datos reales

Etiquetas: tipo:funcional, tipo:ui, prio:media, v1  
Referencias: RF-45 · U-02 · D-41

> Alcance académico (D-41): sin gráfico de visitas, sin pacientes recientes y sin aviso de respaldo.

- [ ] Tarjetas: citas de hoy, pacientes activos y ventas del día (esta última solo para admin)
- [ ] Próximas citas reales
- [ ] Alertas de stock bajo y de vacunas por vencer
- [ ] Se ve bien en PC, tablet y teléfono

### ISS-18 – Respaldo y restauración

Etiquetas: tipo:tecnico, prio:alta, v1  
Referencias: RNF-06 · RF-46 · docs/07-despliegue-operacion.md · D-41

> Alcance académico (D-41): sin programación automática, sin retención y sin borradores en `localStorage`.

- [ ] `npm run backup` con `backup()` de `node:sqlite` y copia de `uploads/`, a una carpeta o unidad configurable
- [ ] Procedimiento de restauración **probado** sobre una base limpia

### ISS-19 – Pruebas y revisión de seguridad final

Etiquetas: tipo:pruebas, tipo:seguridad, prio:alta, v1  
Referencias: docs/06-pruebas.md · RNF-04 · RNF-05

> Alcance académico (D-41): T-08, T-10, T-11 y T-20 ya no aplican.

- [ ] Casos de `06-pruebas.md` aplicables (ver nota D-41) con `node:test` y `supertest`; `npm test` pasa limpio
- [ ] Flujo completo: propietario y mascota → cita → consulta → vacuna → venta → recibo
- [ ] Lista manual en Edge/Chrome; PC, tablet y teléfono; impresión
- [ ] Lista de seguridad de `06-pruebas.md` completa; `git ls-files` sin `.env`, `.db`, `uploads/`, `backups/`
- [ ] Enlaces directos a pantallas ajenas devuelven 403; `npm audit` revisado

### ISS-20 – Instalación: README de 5 pasos

Etiquetas: tipo:tecnico, tipo:docs, prio:media, v1  
Referencias: docs/07-despliegue-operacion.md · D-41

> Alcance académico (D-41): sin servicio de Windows, runbook ni manual por rol.

- [ ] README con 5 pasos: requisitos, instalar, configurar `.env`, crear el administrador, arrancar y entrar desde otro dispositivo
- [ ] Aviso de no exponer el servidor a internet

## v2 – Pospuesto (3)

| ID | Título | Etiquetas | Referencias |
|---|---|---|---|
| ISS-21 | Mensajería automática: API de WhatsApp Business y correo SMTP | tipo:funcional, prio:media, v2 | RF-31 · D-09 · D-10 |
| ISS-22 | Compras y finanzas avanzadas | tipo:funcional, prio:baja, v2 | RF-30 · H-21 · Sección 1.4 |
| ISS-23 | Plataforma: HTTPS en red local, multisucursal, portal de clientes y PDF/Excel | tipo:funcional, prio:baja, v2 | RNF-09 · RF-40 · Sección 1.4 · D-13 |

### ISS-21 – Mensajería automática: API de WhatsApp Business y correo SMTP

Etiquetas: tipo:funcional, prio:media, v2  
Referencias: RF-31 · D-09 · D-10

> Alcance académico (D-41): fuera de alcance (v2); cerrado como "no planificado".

- [ ] Evaluar proveedor de WhatsApp Business: costo, verificación y plantillas aprobadas
- [ ] SMTP configurable con tarea programada y manejo de rebotes
- [ ] Envío automático con estado de entrega

### ISS-22 – Compras y finanzas avanzadas

Etiquetas: tipo:funcional, prio:baja, v2  
Referencias: RF-30 · H-21 · Sección 1.4

> Alcance académico (D-41): fuera de alcance (v2); cerrado como "no planificado".

- [ ] Órdenes de compra con recepción en dos pasos y recepción parcial
- [ ] Cierre de caja diario por método de pago, pagos parciales y crédito a clientes
- [ ] Factura fiscal electrónica: investigar requisitos legales vigentes e integrar con el proveedor autorizado

### ISS-23 – Plataforma: HTTPS en red local, multisucursal, portal de clientes y PDF/Excel

Etiquetas: tipo:funcional, prio:baja, v2  
Referencias: RNF-09 · RF-40 · Sección 1.4 · D-13

> Alcance académico (D-41): fuera de alcance (v2); cerrado como "no planificado".

- [ ] HTTPS en la LAN con certificado propio instalado en los dispositivos
- [ ] Soporte multisucursal con permisos por sucursal
- [ ] Portal de autoservicio para propietarios (citas y vacunas de sus mascotas)
- [ ] Generación de PDF en servidor y exportación `.xlsx`
