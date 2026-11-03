# Diseño de interfaz

Fuente: carpeta `design/` (copiada de `prueba 1`). **Se reutilizan los mismos estilos** (`styles.css`), el mismo layout y los mismos componentes. No se rediseña la estética.

## Cómo está implementado (ISS-02)
- `public/css/styles.css` es **idéntico** a `design/styles.css` (una prueba automática lo verifica). No se edita.
- Todo lo nuevo va en `public/css/app.css`, que se carga después: menú plegable, controles de 44 px, estados de cita, tablas con desplazamiento, mensajes, impresión y accesibilidad (foco visible, "Saltar al contenido").
- Plantilla EJS en `src/views/partials/`: `layout-start.ejs` (cabecera, barra lateral y barra superior) y `layout-end.ejs` (pie). Cada página la envuelve así:
  ```ejs
  <%- include('partials/layout-start', { title: 'Citas', active: 'citas' }) %>
  ...contenido...
  <%- include('partials/layout-end') %>
  ```
  `<%-` se usa **solo** para `include`, nunca con datos de usuario.
- El menú, los permisos por módulo y los accesos de la página de inicio salen de un solo archivo: `src/modules.js`. Para agregar un módulo se agrega una fila allí.
- Menú plegable en ≤ 900 px (tablet y teléfono) con `public/js/app.js`: botón "Menú", fondo oscurecido, se cierra al tocar fuera, al elegir una opción o con Escape.
- Controles táctiles de al menos 44 px en pantallas táctiles o ≤ 900 px; en campos de formulario 16 px de letra para evitar el zoom automático de iOS.
- Imagen de inicio local (`public/img/hero.svg`), sin recursos externos.
- **Piezas reutilizables para formularios y listas** (`src/views/partials/`): `field.ejs` (campo con etiqueta, ayuda y mensaje de error), `select.ejs` (lista desplegable), `flash.ejs` (aviso de una sola vez, ya incluido en el layout), `pagination.ejs` (Anterior/Siguiente que conservan los filtros) y `ajustes-tabs.ejs` (pestañas). Clases nuevas en `app.css`: `tabs`, `check-row`, `filter-bar`, `pagination`, `button-danger`, `field-hint`, `stack`. Las vistas de Ajustes (`src/views/ajustes/`) son el ejemplo a seguir: alta + lista (`management-grid`), edición con varios formularios, y listado con filtros y tabla (`table-scroll`).
- **Dinero en las vistas:** usar `<%= dinero(centavos) %>` (viene de `viewLocals`, con la moneda de Ajustes → "C$ 1,234.50"); nunca formatear a mano. Los montos se escriben en formularios con `dinero()` de `validation.js` ("150", "150.50", "150,50") y se guardan como centavos enteros.
- Ajustes tiene 4 pestañas: Clínica (`/ajustes`), Servicios, Usuarios y Bitácora. El horario usa `type="time"` con una fila por día (en teléfono se reacomoda a dos columnas). Un nombre de clínica de más de 12 caracteres activa la clase `brand-largo` en el menú lateral para que no se desborde.
- Acciones destructivas (desactivar) son botones `button-danger` dentro de su propio formulario POST con CSRF, y explican la consecuencia en el texto de ayuda.
- El inicio de sesión (`/login`) y las páginas de error son páginas sin barra lateral, con las mismas clases del diseño (`data-form`, `button`, `alert`). Sin estilos ni scripts en línea: la CSP los bloquearía.

## Tokens (de `styles.css`)
| Token | Valor | Uso |
|---|---|---|
| `--ink` | `#243746` | Texto principal |
| `--muted` | `#71808b` | Texto secundario |
| `--paper` | `#f5f8fa` | Fondo de página |
| `--surface` | `#ffffff` | Tarjetas |
| `--sidebar` | `#294b63` | Barra lateral |
| `--sidebar-muted` | `#b3c6d3` | Texto de barra lateral |
| `--accent` / `--accent-dark` | `#5c829d` / `#3e647e` | Botones y enlaces |
| `--teal` | `#648aa3` | Acentos |
| `--line` | `#dce5eb` | Bordes |
| `--shadow` | `0 16px 40px rgba(50,78,97,.08)` | Tarjetas |

Tipografía: Arial/Helvetica. Puntos de corte: `900px` y `640px`.

## Componentes existentes (reutilizar)
`app-shell`, `sidebar`, `brand`, `nav-link`, `topbar`, `menu-toggle`, `avatar`, `user-details`, `welcome-row` (+ `eyebrow`, `h1`, `intro`), `button`, `panel` / `panel-heading`, `appointment` (+ `status-*`), `pet-avatar`, `stat-card`, `management-grid` con `data-form` + `data-list-panel`, `record` / `record-actions`, `empty-state`, `home-menu-card`, `quick-action`, `site-footer`.

Estados de cita en CSS: `status-confirmed`, `status-waiting`, `status-new`. **Faltan**: `status-done`, `status-cancelled`, `status-noshow` (agregar con la misma paleta).

## Cambios obligatorios al pasar de `design/` a plantillas
1. Barra lateral, barra superior y pie → `views/partials/` (hoy están copiados en 9 archivos).
2. Menú coherente: Inicio, Citas, Mascotas, Clientes, Historial clínico, Farmacia, Ventas, Reportes, Recordatorios, Ajustes. Numeración correcta y sin duplicados. El elemento activo lo marca el servidor.
3. Menú filtrado por rol (ver matriz en `02-arquitectura.md`).
4. "Facturación" pasa a "Ventas". "Grooming" desaparece del menú (es tipo de cita; se accede por Citas con filtro).
5. Usuario real en la barra superior (nombre y rol de la sesión), botón "Cerrar sesión".
6. Fecha del encabezado generada en el servidor (hoy es texto fijo).
7. Datos del Inicio reales; el gráfico circular se calcula (`conic-gradient` generado con los datos).
8. Se elimina el botón "Eliminar" en registros clínicos, ventas e inventario; se reemplaza por "Anular" (pide motivo) o "Desactivar".
9. Se reemplaza la imagen de Unsplash del Inicio por un recurso local (D-19).
10. Los `<label>` del diseño se mantienen; se agregan mensajes de validación bajo cada campo.

## Pantallas

### Existen en `design/` (adaptar)
| Pantalla | Archivo | Falta |
|---|---|---|
| Inicio | `theme1.html` | Datos reales, alertas de stock/vencimiento, recordatorios del día. |
| Citas | `citas.html` | Formulario, vista día/semana, filtro por responsable, cambio de estado. |
| Mascotas | `mascotas.html` | Búsqueda, edición, ficha. |
| Clientes | `clientes.html` | Búsqueda, edición, consentimiento, mascotas del cliente. |
| Historial clínico | `historial.html` | Consulta completa, signos vitales, tratamientos, vacunas, gráfica, adjuntos, anulación. |
| Farmacia | `farmacia.html` | Lotes, vencimientos, kárdex, entradas, proveedores. |
| Facturación → Ventas | `facturacion.html` (vacía) | Todo: carrito, métodos de pago, recibo. |
| Grooming | `grooming.html` | Se funde con Citas. |

### Nuevas (se diseñan con los mismos componentes)
| Pantalla | Estilo base |
|---|---|
| Inicio de sesión | `data-form` centrado sobre `--paper`, sin barra lateral. |
| Ficha de mascota (datos + historial + vacunas + peso + adjuntos) | `panel` + `management-grid`. |
| Nueva consulta | `data-form` ancho con secciones en `panel`. |
| Receta imprimible / carné de vacunación / recibo | Hoja con `@media print`, sin barra lateral. |
| Agenda semanal | Cuadrícula con `appointment` compactos. |
| Recordatorios | Lista de `record` con botón "WhatsApp" y "Marcar enviado". |
| Reportes | Filtros + tabla + botón "Exportar CSV". |
| Usuarios, Ajustes, Bitácora | `management-grid`. |
| Errores 403 / 404 / 500 | `panel` centrado. |

## Responsivo: PC, tablet y teléfono (D-27)
El sistema se usa principalmente en PC, pero también desde tablet y teléfono por Wi-Fi. `styles.css` ya trae puntos de corte en 900 px y 640 px; hay que **probarlos** en cada pantalla nueva.

| Dispositivo | Ancho de prueba | Comportamiento |
|---|---|---|
| PC | 1366 px | Barra lateral fija, listas y formularios en dos columnas (`management-grid`). |
| Tablet | 768 px | Barra lateral oculta con botón "Menú"; formularios en una columna; tarjetas en 2 columnas. |
| Teléfono | 400 px | Todo en una columna; agenda semanal como lista por día; tablas en contenedor con desplazamiento propio. |

Reglas:
- Controles táctiles de al menos 44×44 px; separación suficiente entre botones de acción (Anular, Confirmar, WhatsApp).
- Teclado correcto: `type="tel"` para teléfono, `inputmode="decimal"` para dinero y signos vitales, `type="date"`/`time`.
- Nada de acciones que dependan de pasar el cursor (hover).
- Subida de fotos y adjuntos desde la galería o la cámara (`accept="image/*"`).
- La receta, el carné y el recibo se imprimen desde la PC; en tablet/teléfono se pueden ver pero no es el flujo principal.
- Sin desbordamiento horizontal de la página (solo tablas y bloques de código, cada uno con su propio contenedor).

## Reglas de interfaz
- Español; fechas `dd/mm/aaaa`, hora 12 h con AM/PM (como el diseño).
- Toda acción destructiva pide confirmación en la propia página (no `confirm()`).
- Los formularios largos guardan borrador en `localStorage` (RNF-10).
- Listas con paginación de 25 y buscador arriba.
- Estados vacíos con `empty-state`; errores con mensaje claro y qué hacer.
- Accesibilidad: `label` asociado a cada campo, foco visible, contraste del diseño original, `aria-*` ya presentes en el menú.
- Impresión: `@media print` oculta barra lateral, barra superior y botones.
- **Clientes y mascotas (ISS-06):** `/clientes` (búsqueda + alta + lista paginada de 25), `/clientes/:id` (ficha con edición, mascotas y desactivar), `/mascotas` (búsqueda por mascota, expediente o datos del dueño, filtro de estado), `/mascotas/nueva` (primero se elige el propietario; sin texto libre), `/mascotas/:id` (ficha: foto, edad, accesos, historial de propietarios, edición) y `/mascotas/:id/transferir`. Piezas nuevas: `partials/cliente-campos.ejs` y `mascota-campos.ejs` (campos compartidos alta/edición). Los enlaces dentro de frases usan `text-link` para cumplir los 44 px táctiles.
- **Citas (ISS-07):** `/citas` (día o semana, filtro por responsable y "solo grooming", navegación anterior/hoy/siguiente, acciones rápidas de estado y listas "Pendientes de confirmar" y "Próximas"), `/citas/nueva` (se elige primero la mascota), `/citas/:id` (reprogramar, cambiar estado, enlaces al paciente y al dueño). Piezas: `partials/cita-fila.ejs` y `cita-campos.ejs`. Los avisos de horario muestran una casilla "Guardar de todos modos".
- **Historial clínico (ISS-08):** `/historial` (general con búsqueda, o por mascota con filtros de texto, fechas y estado, y la gráfica de peso), `/historial/nueva` (desde una cita `?cita=ID` o sin cita `?mascota=ID`), `/historial/:id` (detalle, con banner de anulada y formulario de anulación). Piezas: `partials/textarea.ejs`, `consulta-fila.ejs`; el selector de mascotas (`citas/elegir-mascota.ejs`) ahora se parametriza con `destino`, `titulo` y `boton`. `layout-end` acepta `scripts` (lista de archivos de `/js` o `/vendor` por página, sin scripts en línea).
- **Adjuntos (ISS-09):** panel `partials/adjuntos-panel.ejs` en el historial de la mascota y en el detalle de cada consulta (lista, descarga y formulario de subida solo para veterinarios).
- **Tratamientos, vacunas y hojas imprimibles (ISS-10):** paneles `partials/tratamientos-vacunas.ejs` dentro del detalle de la consulta y resumen de vacunas en el historial de la mascota. Hojas sin barra lateral (`partials/hoja-start.ejs` / `hoja-end.ejs`, vistas en `views/hojas/`): `/historial/:id/receta` y `/historial/carne/:id`. En `@media print` solo se imprime la hoja (la barra con "Volver" e "Imprimir" lleva `no-print`). El recibo (ISS-14) reutilizará estas hojas.
- **Farmacia (ISS-11):** `/farmacia` (alerta de bajo stock, búsqueda, filtros "solo bajo stock" e "incluir inactivos", alta para el administrador y lista paginada de 25) y `/farmacia/:id` (existencias, edición, entrada, ajuste, estado e historial de movimientos). Pieza: `partials/producto-campos.ejs`. Los precios se muestran con `dinero()`.
- **Ventas (ISS-14):** `/ventas` (lista con filtros por fecha y estado, total cobrado y paginación), `/ventas/nueva` (carrito: agregar servicio o producto, buscar y elegir cliente, descuento, método de pago y cobrar), `/ventas/:id` (detalle y anulación para el administrador) y `/ventas/:id/recibo` (hoja imprimible, con "ANULADO" si corresponde). El resumen de totales usa la clase `totales`.
- **Recordatorios (ISS-15):** `/recordatorios` con dos secciones (citas de las próximas 24 h y vacunas próximas o vencidas), cada aviso con su mensaje prellenado, botón "WhatsApp" (abre `wa.me`) y "Marcar enviado"; aviso de cuántos se omitieron por falta de consentimiento. Pieza: `partials/recordatorio-fila.ejs`.
- **Reportes (ISS-16):** `/reportes` (tarjetas según el rol), `/reportes/ventas`, `/reportes/citas` y `/reportes/stock`, cada uno con filtros, tabla (con desplazamiento propio en pantallas angostas) y botón "Exportar CSV" que conserva los filtros.
- **Inicio (ISS-17):** bajo la bienvenida, `stats-grid` con 3 o 4 tarjetas según el rol, y `dashboard-grid` con "Próximas citas" y las alertas de stock bajo y vacunas por vencer. Se quitó el aviso "Panel en construcción" y la vista `placeholder.ejs`.
