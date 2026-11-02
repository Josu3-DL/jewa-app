# Diseño de interfaz

Fuente: carpeta `design/` (copiada de `prueba 1`). **Se reutilizan los mismos estilos** (`styles.css`), el mismo layout y los mismos componentes. No se rediseña la estética.

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
