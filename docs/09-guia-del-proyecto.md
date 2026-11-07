# Guía del proyecto JEWA

Resumen de **qué es JEWA, cómo está organizado, qué hace y por dónde empezar a leer** el proyecto: estructura, funcionalidades, flujo de trabajo y archivos esenciales.

---

## 1. Qué es JEWA

JEWA es un **sistema web para una clínica veterinaria**. Reemplaza el cuaderno, las hojas de cálculo y los papeles sueltos por un solo lugar donde la clínica:

- registra a los **clientes** (dueños) y a sus **mascotas**;
- agenda **citas** (consulta, vacunas, grooming…);
- guarda el **historial clínico** de cada mascota (consultas, tratamientos, vacunas, archivos);
- controla el **inventario** de productos y medicamentos;
- cobra **ventas** e imprime recibos;
- avisa a los clientes de **citas y vacunas próximas** por WhatsApp;
- muestra **reportes** y un **panel de inicio** con lo importante del día.

**Dónde corre:** en **una sola PC de la clínica**. Desde esa PC, y desde tablets y teléfonos conectados al mismo Wi-Fi, se entra con el navegador a `http://<IP-de-la-PC>:3000`. **No está en internet** y no debe ponerse en internet.

**Moneda y marca:** córdobas (C$) y nombre JEWA (ambos se pueden cambiar en *Ajustes*).

> Es un **proyecto académico**: se hizo el flujo completo de una clínica, pero se recortaron a propósito funciones avanzadas (ver sección 10).

---

## 2. Arquitectura general

El sistema tiene tres partes:

| Parte | Función | En JEWA |
|---|---|---|
| **Cliente** | Muestra las pantallas y recoge lo que se escribe | El **navegador** (HTML renderizado por el servidor) |
| **Servidor** | Valida, aplica permisos y reglas del negocio | Un programa **Node.js con Express** |
| **Datos** | Guarda la información | La **base de datos** (archivo `clinic.db`) y la carpeta `uploads/` (fotos y PDF) |

Cada vez que alguien hace clic en "Guardar", el navegador envía el formulario al servidor; el servidor **valida** los datos, comprueba **permisos**, los guarda en la base de datos y devuelve una pantalla nueva. Todo el servidor es **un solo programa** que se enciende con `npm start`.

---

## 3. Tecnologías usadas (y para qué sirve cada una)

| Tecnología | Para qué sirve |
|---|---|
| **Node.js 24** | El motor que ejecuta el programa |
| **Express 5** | Recibe las peticiones y las reparte a la parte correcta del código |
| **EJS** | Plantillas: mezclan HTML con datos para armar cada pantalla |
| **SQLite** (módulo `node:sqlite`) | Base de datos en un solo archivo; no necesita instalar nada más |
| **CSS de `design/`** | El diseño visual (se reutilizó el diseño original sin cambiarlo) |
| **Zod** | Revisa que lo que se escribe en los formularios sea válido |
| **helmet, csrf-sync, express-session, express-rate-limit** | Seguridad: cabeceras seguras, protección de formularios, sesiones y límite de intentos |
| **multer + file-type** | Subir fotos y archivos, comprobando que de verdad sean imágenes o PDF |
| **csv-stringify** | Exportar reportes a CSV (se abre en Excel) |
| **Chart.js** | La gráfica de peso de cada mascota |
| **node:test + supertest** | Las pruebas automáticas (hay 360) |

Regla del proyecto: **antes de escribir algo genérico a mano, se busca una librería mantenida** (decisión D-28).

---

## 4. Estructura de carpetas

```
jewa-app/
├── README.md              ← cómo instalar y arrancar (5 pasos)
├── package.json           ← lista de librerías y comandos (npm start, npm test…)
├── .env.example           ← modelo de configuración (se copia a .env, que NO se sube a git)
├── CLAUDE.md              ← reglas de trabajo del proyecto
│
├── src/                   ← EL PROGRAMA
│   ├── server.js          ← enciende el servidor
│   ├── app.js             ← arma el servidor: orden de seguridad y lista de rutas
│   ├── config.js          ← lee la configuración (.env)
│   ├── modules.js         ← menú, módulos y qué rol ve cuál
│   ├── roles.js           ← nombres de los 3 roles
│   ├── routes/            ← "la puerta": recibe cada petición web (una por módulo)
│   ├── services/          ← "el cerebro": reglas del negocio y consultas a la base
│   ├── views/             ← las pantallas (plantillas EJS), una carpeta por módulo
│   │   └── partials/      ← piezas repetidas (menú, campos de formulario, paginación…)
│   ├── middleware/        ← filtros previos: sesión, login, permisos, seguridad, errores
│   ├── utils/             ← ayudas: dinero, fechas, validación, búsqueda, paginación
│   └── db/
│       ├── connection.js  ← abre la base de datos
│       ├── migrate.js     ← aplica los cambios de estructura en orden
│       └── migrations/    ← 001_init.sql (todas las tablas) y 002–004 (datos base y reglas)
│
├── public/                ← lo que el navegador descarga: css/, js/ (menú y gráfica), img/
├── design/                ← diseño de referencia en HTML (solo para consultar, no se ejecuta)
├── scripts/               ← herramientas: crear administrador, respaldo, restauración
├── test/                  ← las pruebas automáticas
├── docs/                  ← la documentación (esta guía es la 09)
│
├── data/                  ← (se crea sola) la base de datos clinic.db  ← NO se sube a git
├── uploads/               ← (se crea sola) fotos y adjuntos             ← NO se sube a git
└── backups/               ← (se crea sola) respaldos                    ← NO se sube a git
```

**Regla de capas:** cada módulo se reparte siempre igual.

> `routes/` (recibe y responde) → `services/` (decide y guarda) → base de datos. Las pantallas viven en `views/`.

Así, para saber **cómo funciona "ventas"**, se miran `src/routes/ventas.js`, `src/services/ventas.js` y `src/views/ventas/`.

---

## 5. Quién puede hacer qué (roles)

El sistema tiene **3 roles**. Cada persona tiene un usuario y contraseña, y entra solo a lo que su rol permite.

| Módulo | Administrador | Veterinario | Recepcionista |
|---|:-:|:-:|:-:|
| Inicio (panel) | ✅ con ventas del día | ✅ sin ingresos | ✅ sin ingresos |
| Clientes y mascotas | ✅ | ✅ | ✅ |
| Citas | ✅ | ✅ | ✅ |
| Historial clínico (ver) | ✅ | ✅ | ❌ |
| Registrar consulta, tratamiento, vacuna, adjuntos | ❌ | ✅ | ❌ |
| Anular una consulta | ✅ cualquiera | ✅ solo las suyas | ❌ |
| Farmacia (ver stock) | ✅ | ✅ | ✅ |
| Crear/editar productos, entradas y ajustes de stock | ✅ | ❌ | ❌ |
| Ventas (cobrar) | ✅ | ✅ | ✅ |
| Anular una venta | ✅ | ❌ | ❌ |
| Recordatorios | ✅ | ✅ | ✅ |
| Reportes | ✅ todos | citas y stock | ❌ |
| Ajustes (clínica, servicios, usuarios, bitácora) | ✅ | ❌ | ❌ |

> El administrador **no registra actos clínicos** a propósito: si el dueño también es veterinario, tiene dos usuarios (uno por rol).

---

## 6. Qué hace cada módulo

| Módulo | Dirección | Qué permite |
|---|---|---|
| **Inicio** | `/` | Citas de hoy, pacientes activos, recordatorios por enviar, ventas de hoy (solo admin), próximas citas y alertas de stock bajo y vacunas por vencer |
| **Clientes** | `/clientes` | Alta y edición de dueños; teléfono, cédula (única), si aceptan recibir avisos; sus mascotas. No se desactiva un cliente con mascotas activas |
| **Mascotas** | `/mascotas` | Ficha con número de expediente automático (EXP-000123), foto, edad calculada, estado (activa/fallecida/inactiva) y cambio de dueño con historial |
| **Citas** | `/citas` | Agenda por día o semana, responsable, servicio, estados (programada → confirmada → en espera → atendida / cancelada / no asistió). No permite dos citas que se pisen para la misma persona |
| **Historial clínico** | `/historial` | Consultas (desde una cita o de urgencia), signos vitales, **tratamientos**, **vacunas** (con próxima dosis), adjuntos (foto/PDF), gráfica de peso, **receta** y **carné de vacunación** imprimibles. Las consultas **no se borran: se anulan con motivo** |
| **Farmacia** | `/farmacia` | Productos y existencias, stock mínimo, entradas manuales, ajustes con motivo, historial de movimientos y alerta de bajo stock |
| **Ventas** | `/ventas` | Carrito con servicios y productos, descuento, método de pago, recibo imprimible. Al cobrar **descuenta el stock**; al anular **lo devuelve** |
| **Recordatorios** | `/recordatorios` | Lista de citas de las próximas 24 h y vacunas próximas o vencidas, con mensaje listo y botón de WhatsApp. **Nada se envía solo**: el personal lo manda y lo marca como enviado. No aparecen clientes que no aceptaron avisos |
| **Reportes** | `/reportes` | Ventas por día, citas y stock bajo, con exportación a CSV |
| **Ajustes** | `/ajustes` | Datos de la clínica (nombre, moneda, IVA, horario), catálogo de servicios y precios, usuarios y roles, y la **bitácora** (quién hizo qué y cuándo) |

---

## 7. El flujo de trabajo del día a día

```
 CLIENTE ─▶ MASCOTA ─▶ CITA ─▶ CONSULTA ─▶ TRATAMIENTO / VACUNA ─▶ VENTA ─▶ RECIBO
 (Recepción) (Recepción) (Recepción) (Veterinario) (Veterinario)        (cualquiera)
                                          │                │
                                          ▼                ▼
                                   Adjuntos, peso    Próxima dosis ─▶ RECORDATORIOS ─▶ WhatsApp
```

1. **Recepción** registra al cliente (con su consentimiento para avisos) y a su mascota.
2. **Recepción** agenda la cita; el sistema avisa si se cruza con otra o cae fuera de horario.
3. El día de la cita, el **veterinario** abre la cita y pulsa **"Iniciar consulta"**: la cita pasa a *atendida* al guardar. También puede registrar una consulta de urgencia sin cita.
4. En la consulta, el veterinario anota **tratamientos** (se imprime la receta) y **vacunas** (obligan a indicar la próxima dosis; se imprime el carné), y puede subir fotos o PDF.
5. **Cualquier usuario** cobra en *Ventas*: arma el carrito, elige el método de pago y cobra. El stock baja solo y se imprime el recibo.
6. Cuando se acerca una cita o una vacuna, **Recordatorios** la muestra; se abre WhatsApp con el mensaje ya escrito, se envía y se marca como enviado.
7. El **administrador** revisa el panel, los reportes y mantiene productos, precios y usuarios; una vez al tiempo hace un **respaldo**.

**Flujo del inventario:** el administrador crea el producto (con stock inicial o con una entrada) → cada venta lo descuenta → si baja del mínimo aparece la alerta en Farmacia y en el Inicio → el administrador repone con una *entrada* o corrige con un *ajuste* (siempre con motivo).

---

## 8. Cómo viaja una petición (ejemplo: "crear una cita")

Recorrido de una petición completa:

1. El usuario envía el formulario de **/citas/nueva**.
2. `src/app.js` pasa la petición por los filtros de seguridad (sesión iniciada, token del formulario, permisos).
3. `src/routes/citas.js` la recibe y llama al servicio.
4. `src/services/citas.js` **valida** los datos, revisa que no se cruce con otra cita, avisa si es fuera de horario, **guarda en la base de datos** y deja una anotación en la bitácora.
5. La ruta redirige a la agenda y `src/views/citas/agenda.ejs` dibuja la pantalla con el aviso "Cita creada".

Todos los módulos siguen el mismo patrón, así que entender uno ayuda a entender todos.

---

## 9. Reglas importantes que el sistema cumple siempre

- **Nada clínico, de ventas ni de inventario se borra**: se *anula con motivo* y queda quién, cuándo y por qué. La propia base de datos lo impide.
- **El dinero se guarda en centavos enteros** (nunca con decimales flotantes) para evitar errores de redondeo.
- **Las fechas se guardan en hora universal (UTC)** y se muestran en hora de **Managua**.
- **Seguridad:** contraseñas cifradas (scrypt), bloqueo tras 5 intentos fallidos, sesión que se cierra a los 30 minutos sin uso, protección en todos los formularios, archivos subidos fuera de la carpeta pública y revisados por su contenido real.
- **Consentimiento:** si un cliente no aceptó recibir avisos, no aparece en Recordatorios.
- **Bitácora:** las acciones importantes quedan registradas (visible para el administrador en *Ajustes → Bitácora*).
- **Usable en PC, tablet y teléfono.**
- **Datos reales nunca en el repositorio:** `.env`, la base de datos, `uploads/` y `backups/` no se suben a git (el repositorio es público).

---

## 10. Qué NO incluye (alcance académico, decisión D-41)

Se dejó fuera a propósito: proveedores y compras, lotes con fecha de vencimiento (FEFO), pagos parciales o crédito, factura fiscal electrónica, envío automático de WhatsApp o correo, respaldos programados, HTTPS, varias sucursales y portal para clientes. También: plantillas de mensajes editables, gráfico de visitas en el inicio y aviso de respaldo atrasado. Quedan anotados como "no se implementa" en los issues.

---

## 11. Qué archivos revisar para entender el proyecto (en este orden)

| # | Archivo | Qué aprendes |
|---|---|---|
| 1 | `README.md` | Qué es y cómo se instala en 5 pasos |
| 2 | `docs/01-requerimientos.md` | Qué debía hacer el sistema (requerimientos originales) |
| 3 | `docs/00-decisiones.md` | **Por qué** se hizo cada cosa y qué se descartó (lista numerada D-01…D-48) |
| 4 | `docs/02-arquitectura.md` | La arquitectura: tecnologías, capas, seguridad, permisos |
| 5 | `docs/03-modelo-datos.md` | Qué datos se guardan: tablas y relaciones |
| 6 | `src/modules.js` | **El mapa del sistema**: módulos, rutas y qué rol ve cada uno |
| 7 | `src/app.js` | Cómo se arma el servidor y en qué orden actúan los filtros de seguridad |
| 8 | `src/db/migrations/001_init.sql` | Todas las tablas y las reglas de integridad (incluye lo que impide borrar) |
| 9 | `src/routes/citas.js` + `src/services/citas.js` + `src/views/citas/` | Un módulo completo de principio a fin (el mejor ejemplo para aprender el patrón) |
| 10 | `src/services/ventas.js` | La lógica más delicada: cobrar, descontar stock en una sola operación y anular |
| 11 | `src/middleware/user.js` | Cómo se revisan sesión y permisos en cada petición |
| 12 | `docs/06-pruebas.md` y la carpeta `test/` | Qué se probó (360 pruebas) y cómo; `test/flujo-completo.test.js` recorre el flujo entero |
| 13 | `docs/07-despliegue-operacion.md` | Instalación en la PC, respaldo y recuperación |

Si solo hay tiempo para **tres**: `docs/00-decisiones.md`, `src/modules.js` y `src/services/ventas.js`.

---

## 12. "Quiero cambiar…" → "miro…"

| Quiero… | Miro… |
|---|---|
| Cambiar un texto o el aspecto de una pantalla | `src/views/<módulo>/` y `public/css/app.css` (el diseño base `styles.css` no se toca) |
| Agregar un campo a un formulario | La vista `src/views/partials/<...>-campos.ejs`, su servicio en `src/services/` y, si se guarda, una **migración nueva** en `src/db/migrations/` |
| Cambiar quién ve un módulo | `src/modules.js` (menú y permisos) y el `requireModule` de su ruta |
| Cambiar una regla del negocio (por ejemplo, cuántas horas antes avisa un recordatorio) | El servicio del módulo en `src/services/` (las constantes están arriba del archivo) |
| Cambiar nombre, moneda, IVA, horario o precios | En el sistema: **Ajustes** (no hace falta tocar código) |
| Ver quién hizo algo | **Ajustes → Bitácora** |
| Agregar un módulo nuevo | Copiar el patrón de uno existente: ruta + servicio + vistas + una fila en `src/modules.js` + pruebas |

---

## 13. Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm ci` | Instala las librerías |
| `npm run migrate` | Crea o actualiza la base de datos |
| `npm run seed:admin` | Crea el primer usuario administrador |
| `npm start` | Enciende el sistema (entrar en `http://localhost:3000`) |
| `npm test` | Ejecuta las 360 pruebas automáticas |
| `npm run backup` | Crea un respaldo (base + archivos subidos) en `backups/` |
| `npm run restore` | Lista los respaldos; `-- <carpeta> --confirmar` restaura (con el sistema detenido) |

**Importante:** el respaldo se hace a mano. Conviene copiar la carpeta `backups/` a otra unidad o lugar.

---

## 14. Glosario rápido

- **Migración:** archivo que cambia la estructura de la base de datos de forma ordenada y repetible.
- **Ruta:** una dirección web del sistema (por ejemplo, `/citas`).
- **Servicio:** el código que aplica las reglas del negocio y guarda en la base de datos.
- **Vista / plantilla:** el archivo que dibuja una pantalla.
- **Sesión:** lo que mantiene a un usuario "dentro" después de iniciar sesión.
- **CSRF:** ataque en el que una página falsa envía formularios en nombre del usuario; el sistema lo bloquea con un token oculto en cada formulario.
- **Bitácora:** registro de quién hizo qué y cuándo.
- **Anular:** marcar algo como inválido con un motivo, conservándolo, en lugar de borrarlo.
- **UTC:** hora universal; así se guardan las fechas, y se muestran en hora de Managua.
