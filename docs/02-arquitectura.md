# Arquitectura

## Pila
| Capa | Tecnología | Motivo |
|---|---|---|
| Servidor | Node.js 24 + Express | Conocido, un solo proceso. |
| Vistas | EJS (render en servidor) | Reutiliza el HTML de `design/` casi sin cambios. |
| Datos | `node:sqlite` (modo WAL) | Sin compilación nativa; respaldo = `backup()`. |
| Estilos | `design/styles.css` → `public/css/styles.css` | Indicación del cliente. |
| JS del navegador | Vanilla, mínimo | Menú móvil, borradores de formulario, gráfica de peso. |
| Gráficas | Chart.js (archivo local en `public/vendor/`) | Sin CDN en producción. |
| Pruebas | `node:test` + `supertest` | Sin framework pesado. |

### Librerías: adoptadas, descartadas y pendientes de evaluar
Regla (D-28): antes de escribir algo genérico, se busca una librería mantenida y sin módulos nativos.

| Necesidad | Decisión | Motivo |
|---|---|---|
| Servidor web | `express` 5 + `ejs` | Estándar y conocido. |
| Sesiones | `express-session` + almacén **propio** en SQLite (~60 líneas, `src/middleware/session.js`) | Los almacenes conocidos usan `sqlite3` (módulo nativo); el único paquete para `node:sqlite` que se encontró tiene ~14 descargas al mes: no se confía un componente de seguridad a eso. |
| CSRF | `csrf-sync` | Es el reemplazo mantenido de `csurf` para tokens guardados en la sesión. |
| Límite de intentos | `express-rate-limit` (por IP) + bloqueo por cuenta propio (regla de negocio) | Evita probar claves contra muchas cuentas desde un equipo. |
| Cabeceras / CSP | `helmet` | Estándar. |
| Validación | `zod` (+ `z.locales.es()`) y `libphonenumber-js` para teléfonos | Esquemas declarativos; resuelven listas (carrito de ventas) y reglas entre campos (fin > inicio) sin código propio. |
| Hash de contraseñas | `scrypt` de `node:crypto` | Aceptado por OWASP; argon2/bcrypt requieren módulos nativos. |
| Base de datos | `node:sqlite` + SQL propio detrás de `services/` | **Drizzle** soporta `node:sqlite`, pero el esquema ya vive en SQL con triggers y `CHECK` que Drizzle no expresa; se reconsidera si las consultas con filtros dinámicos se vuelven repetitivas. |
| Migraciones | ejecutor propio (~30 líneas) | Aplica archivos `.sql` en orden; las herramientas del mercado exigen un ORM o un driver distinto. |
| Avisos tras guardar ("flash") | middleware propio (`src/middleware/flash.js`, ~10 líneas) | `connect-flash` y derivados son de la época de Express 3/4 y no declaran compatibilidad con Express 5. |
| Paginación | ayudante propio (`src/utils/pagination.js`, ~10 líneas) | `express-paginate` y sus bifurcaciones no muestran mantenimiento claro ni soporte de Express 5. |
| Filtros opcionales en consultas | SQL fijo con `(? IS NULL OR campo = ?)` | Sin armar SQL por partes: la revisión estática de `npm test` lo exige. Si más módulos necesitan filtros dinámicos complejos se reevalúa un generador de consultas (ver Drizzle arriba). |
| Dinero | utilidad propia (`src/utils/money.js`, ~30 líneas): formato, lectura de texto y porcentaje con enteros | `Intl` da "C$1,234.50" (sin espacio) y "USD 1,234.50", y el cliente pide "C$ 1,234.50"; Dinero.js no mostró un estado estable claro. `Intl` solo se usa para agrupar miles. |
| Subida de archivos | `multer` 2 (memoria + tope de tamaño) y `file-type` (tipo real por firma) | Mantenidos, sin módulos nativos. CSRF de multipart: ver D-35. |
| Pruebas | `node:test` + `supertest` | Sin framework adicional. |

Pendientes de evaluar **antes** de implementarlos (no están verificados todavía): CSV (`csv-stringify`, ISS-16), registro de eventos con rotación (`pino`, ISS-20), planificación del respaldo (Programador de tareas de Windows frente a `node-cron`, ISS-18).

## Estructura de carpetas
```
src/
  app.js              # configura Express (middlewares, rutas)
  server.js           # arranca el servidor
  config.js           # lee .env
  db/
    connection.js     # abre SQLite, PRAGMA foreign_keys=ON, WAL
    migrate.js        # aplica migrations/*.sql en orden
    migrations/       # 001_init.sql, 002_...
  middleware/         # auth, roles, csrf, errores, flash
  routes/             # un archivo por módulo (HTTP)
  services/           # reglas de negocio y SQL (sin req/res)
  views/              # layout.ejs + partials + una carpeta por módulo
  utils/              # fechas (Managua), dinero, validación
public/
  css/styles.css      # copia de design/styles.css
  js/                 # app.js, drafts.js, weight-chart.js
  vendor/             # chart.min.js
uploads/              # adjuntos y fotos (fuera de git)
data/                 # clinic.db (fuera de git)
backups/              # respaldos (fuera de git)
test/
scripts/
```

## Flujo de una petición
`ruta → middleware (sesión, rol, CSRF) → validación → servicio → SQL → vista (EJS) o redirect con mensaje flash`.

Patrón post/redirect/get en todos los formularios (evita reenvíos al recargar).

## Permisos por rol

| Módulo / acción | Admin | Veterinario | Recepcionista |
|---|:-:|:-:|:-:|
| Inicio | ✅ (con ingresos) | ✅ (sin ingresos) | ✅ (sin ingresos) |
| Citas (ver / crear / reprogramar / cancelar) | ✅ | ✅ | ✅ |
| Clientes y mascotas | ✅ | ver y editar | ✅ |
| Historial clínico: ver | ✅ | ✅ | ❌ |
| Historial clínico: crear consulta, tratamiento, vacuna | ❌ | ✅ | ❌ |
| Anular consulta | ✅ | ✅ (propias) | ❌ |
| Farmacia: ver stock | ✅ | ✅ | ✅ |
| Farmacia: crear/editar producto, entradas, ajustes | ✅ | ❌ | ❌ |
| Proveedores y compras | ✅ | ❌ | ❌ |
| Ventas y cobros: registrar | ✅ | ✅ | ✅ |
| Ventas: anular | ✅ | ❌ | ❌ |
| Recordatorios: ver y marcar enviado | ✅ | ✅ | ✅ |
| Reportes | ✅ | solo clínicos | ❌ |
| Usuarios, ajustes, bitácora | ✅ | ❌ | ❌ |

> El administrador **no** registra actos clínicos (RN-02). Si el dueño también es veterinario, tendrá dos usuarios.

## Seguridad
- **Contraseñas**: `crypto.scrypt` con sal aleatoria; formato `scrypt$N$salt$hash`. Mínimo 8 caracteres.
- **Sesión**: cookie `HttpOnly`, `SameSite=Lax`; `Secure` según `COOKIE_SECURE` (falso mientras se use HTTP en la LAN, D-25); almacén en SQLite; expira a los 30 min de inactividad.
- **Red local**: el servidor escucha en `HOST=0.0.0.0`; solo se abre el puerto en el firewall de Windows para la red privada; el router no reenvía puertos hacia internet. Recomendar Wi-Fi con WPA2/WPA3 y contraseña propia (no la red de invitados).
- **Bloqueo**: 5 intentos fallidos → bloqueo de 15 min; se registra en bitácora.
- **CSRF**: token por sesión en cada formulario POST; se rechaza si falta o no coincide.
- **XSS**: escape por defecto de EJS; prohibido `<%-` con datos de usuario; cabeceras con `helmet` y CSP restrictiva.
- **SQL**: siempre parámetros `?`.
- **Subidas**: lista blanca de tipos (jpg, png, webp, pdf), tamaño máximo, nombre generado (UUID), fuera de `public/`, servidas por una ruta autenticada.
- **Errores**: nunca mostrar trazas al usuario; registrar en servidor.
- **Rutas**: `requireAuth` y `requireRole(...)` en cada router; la ausencia de permiso devuelve 403.

## Transacciones e integridad
- `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`.
- Salida de inventario, venta, consulta con descuento y anulación se ejecutan en `BEGIN IMMEDIATE ... COMMIT`.
- El stock de un lote nunca queda negativo (`CHECK (cantidad_actual >= 0)`).
- El stock mostrado de un producto = suma de sus lotes; los movimientos son el registro auditable.

## Fechas y dinero
- BD: ISO 8601 UTC (`2026-11-02T15:00:00Z`).
- Presentación: `America/Managua`, locale `es-NI`.
- Dinero: enteros en centavos; formateo en `utils/money.js` según la moneda de Ajustes.

## Configuración (`.env`, no se versiona)
```
HOST=0.0.0.0
PORT=3000
SESSION_SECRET=<cadena larga aleatoria>
COOKIE_SECURE=false        # true solo si algún día se usa HTTPS
DB_PATH=./data/clinic.db
UPLOAD_DIR=./uploads
BACKUP_DIR=E:/respaldos-jewa   # unidad externa
NODE_ENV=production
```
Se entrega `.env.example` sin valores reales.
