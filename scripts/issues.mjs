// Fuente única de los issues del proyecto.
//   node scripts/issues.mjs md             -> genera docs/ISSUES.md
//   node scripts/issues.mjs create --dry   -> muestra lo que se crearía en GitHub
//   node scripts/issues.mjs create         -> crea etiquetas, hitos e issues (omite los que ya existen)
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Josu3-DL/jewa-app';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MILESTONES = {
  d1: 'Día 1 – Base y recepción',
  d2: 'Día 2 – Clínico, inventario y ventas',
  d3: 'Día 3 – Cierre',
  v2: 'v2 – Pospuesto',
};

const LABELS = {
  'tipo:funcional': ['1d76db', 'Requerimiento funcional'],
  'tipo:tecnico': ['5319e7', 'Trabajo técnico / infraestructura'],
  'tipo:ui': ['c5def5', 'Interfaz'],
  'tipo:pruebas': ['fbca04', 'Pruebas'],
  'tipo:docs': ['0e8a16', 'Documentación'],
  'tipo:seguridad': ['b60205', 'Seguridad'],
  'tipo:decision': ['d4c5f9', 'Decisión pendiente'],
  'prio:alta': ['d93f0b', 'Prioridad alta'],
  'prio:media': ['fbca04', 'Prioridad media'],
  'prio:baja': ['c2e0c6', 'Prioridad baja'],
  'v1': ['0052cc', 'Incluido en la v1'],
  'v2': ['bfd4f2', 'Pospuesto a la v2'],
};

// [n, hito, etiquetas, título, refs, criterios[]]
const I = [];
const add = (n, ms, labels, title, refs, criteria, nota = '') => I.push({ n, ms, labels, title, refs, criteria, nota });

// ───────── Día 1
add(1, 'd1', ['tipo:tecnico', 'prio:alta', 'v1'], 'Base técnica: proyecto, scripts, migraciones y esquema', 'docs/02-arquitectura.md · docs/03-modelo-datos.md', [
  'Carpetas `src/`, `public/`, `test/`, `scripts/` según arquitectura',
  '`package.json` con `start`, `test`, `migrate`, `seed:admin`, `backup`; sin la dependencia `sqlite3`',
  '`.env.example` sin valores reales; `config.js` valida variables obligatorias (incluye `HOST`, `PORT`, `COOKIE_SECURE`)',
  'Migraciones SQL numeradas, aplicadas en orden e idempotentes (repetir `migrate` no falla)',
  '`foreign_keys=ON`, WAL y `busy_timeout` activos en cada conexión',
  'Todas las tablas del modelo con `CHECK` y claves foráneas; índices en cédula, teléfono, nombre, expediente y `citas(responsable, inicio)`',
  'Ruta `/salud` responde 200 si la BD abre',
  'Manejo central de errores (403, 404, 500) sin trazas al usuario',
]);
add(2, 'd1', ['tipo:ui', 'prio:alta', 'v1'], 'Plantilla común responsiva (PC, tablet y teléfono)', 'docs/04-diseno-ui.md · design/styles.css', [
  '`styles.css` copiado sin cambiar el aspecto; `layout.ejs` con barra lateral, barra superior y pie como partials',
  'Menú coherente y numeración correcta; elemento activo marcado por el servidor; filtrado por rol',
  'Usuario y rol reales en la barra superior; fecha generada en servidor (zona Managua)',
  'Estilos nuevos `status-done`, `status-cancelled`, `status-noshow` con la paleta existente',
  'Imagen externa de Unsplash reemplazada por recurso local',
  'Responsivo en tres anchos: PC (1366 px), tablet (768 px) y teléfono (400 px), sin desbordamiento horizontal',
  'Controles táctiles de al menos 44 px; campos con tipo de teclado correcto (`tel`, `number`, `date`)',
  'Tablas dentro de contenedores con desplazamiento propio; en teléfono las listas se apilan',
  'Página de inicio provisional para poder navegar (el panel real es ISS-17)',
]);
add(3, 'd1', ['tipo:funcional', 'tipo:seguridad', 'prio:alta', 'v1'], 'Autenticación y seguridad web', 'RF-01 · RNF-04 · CU-01', [
  'Pantalla de login con los componentes del diseño, usable en teléfono',
  'Contraseña con scrypt + sal; mensaje de error genérico; bloqueo de 15 min tras 5 intentos (T-01)',
  'Sesión con cookie `HttpOnly`, `SameSite=Lax`; `Secure` según `COOKIE_SECURE` (en LAN con HTTP va en falso); expira a los 30 min sin actividad',
  'Cerrar sesión invalida la sesión en servidor; rutas protegidas redirigen a login (T-02)',
  'Token CSRF en todo POST; sin token → 403 (T-04)',
  '`helmet` con CSP restrictiva',
  'Utilidades de validación (texto, número, fecha, teléfono) con mensajes en español',
  'Revisión: ningún `<%-` con datos de usuario ni SQL concatenado; prueba T-21',
]);
add(4, 'd1', ['tipo:funcional', 'tipo:seguridad', 'prio:alta', 'v1'], 'Usuarios, roles y bitácora de auditoría', 'RF-02 · RF-03 · RF-04 · RNF-11 · CU-02', [
  'Crear, editar, desactivar usuarios y restablecer contraseña (solo admin); no se desactiva al último administrador',
  'Roles admin, veterinario, recepción con la matriz de `02-arquitectura.md`; `requireRole` en cada router (T-03)',
  'Campos `colegiado` y `atiende_citas`',
  '`npm run seed:admin` pide credenciales por consola; no hay credenciales en el repositorio',
  '`audit.log(usuario, acción, entidad, id, detalle)` usado por todos los módulos; tabla solo de inserción',
  'Pantalla de bitácora para el admin con filtros por usuario, fecha y entidad',
  'No se registran contraseñas ni datos sensibles innecesarios',
]);
add(5, 'd1', ['tipo:funcional', 'prio:alta', 'v1'], 'Ajustes, datos iniciales y catálogo de servicios', 'RF-41 · RF-42 · H-02 · Q-05', [
  'Ajustes (solo admin): nombre (JEWA), teléfono, dirección, moneda C$, % de IVA (0 por defecto), horario laboral, duración estándar de cita',
  'Formato de dinero `C$ 1,234.50` desde `utils/money.js`',
  'CRUD de servicios con tipo (consulta, vacuna, grooming, seguimiento, otro), precio y duración; desactivar no afecta citas ni ventas históricas',
  'Seed: servicios base y plantillas de recordatorio por defecto',
  'El nombre de la clínica se lee de la configuración en layout, recibos y recetas',
]);
add(6, 'd1', ['tipo:funcional', 'prio:alta', 'v1'], 'Clientes y mascotas', 'RF-05 · RF-06 · RF-07 · RF-08 · RF-13 · RN-01', [
  'Propietarios: crear/editar/desactivar; teléfono normalizado a 505XXXXXXXX; cédula única y opcional',
  'Campo de consentimiento de notificaciones (por defecto aceptado), con cambios registrados en bitácora',
  'No se desactiva un propietario con mascotas activas (T-16)',
  'Mascotas: propietario seleccionado (no texto libre) y número `EXP-000123` automático; estado activa/fallecida/inactiva; edad calculada',
  'Foto como archivo (máx. 2 MB, jpg/png/webp), sin base64',
  'Transferencia a otro propietario con historial de propietarios',
  'Búsqueda por nombre, cédula, teléfono o expediente, con paginación de 25',
  'Ficha de la mascota con datos y accesos a historial, vacunas, peso y citas; el propietario muestra sus mascotas',
]);
add(7, 'd1', ['tipo:funcional', 'prio:alta', 'v1'], 'Citas, agenda y grooming', 'RF-09 · RF-10 · RF-11 · RF-12 · RF-44 · RN-07 · D-07 · D-21', [
  'Formulario con mascota, responsable, servicio, fecha, hora y motivo; fin = inicio + duración del servicio',
  'Estados: programada, confirmada, en espera, atendida, no asistió, cancelada; cambios en bitácora',
  'Rechaza traslape del mismo responsable; una cita cancelada libera el horario (T-05, T-06, T-07)',
  'Advierte fuera del horario laboral o en fecha pasada (T-22)',
  'Vista de día y de semana con filtro por responsable; en teléfono la semana se muestra como lista',
  'Listas de próximas citas y de pendientes de confirmación; acciones rápidas de cambio de estado',
  'Grooming es un tipo de servicio: filtro "Grooming" y responsable con `atiende_citas` (no necesita ser veterinario)',
]);

// ───────── Día 2
add(8, 'd2', ['tipo:funcional', 'prio:alta', 'v1'], 'Consulta e historial clínico', 'RF-14 · RF-15 · RF-16 · RF-17 · RF-19 · RN-02 · RN-03 · CU-05 · CU-08 · D-18', [
  'Solo el veterinario crea consultas (T-03)',
  'Motivo, anamnesis, examen físico, diagnóstico, observaciones, peso, temperatura, FC y FR, con validación de rangos',
  'Desde una cita (precarga datos y la pasa a atendida) o sin cita (urgencia)',
  'Historial cronológico de la mascota con filtros',
  'No existe ruta ni botón de borrado; "Anular" exige motivo y queda registrado quién, cuándo y por qué (T-12, T-13)',
  'La consulta anulada se muestra marcada y conserva su contenido',
  'Gráfica de evolución del peso con Chart.js local; mensaje claro con menos de 2 mediciones; ignora consultas anuladas',
  'Formulario usable en tablet y teléfono',
], 'Los insumos usados en la consulta ya no se registran ni descuentan (D-41/D-38): el stock se descuenta solo en la venta (ISS-14).');
add(9, 'd2', ['tipo:funcional', 'tipo:seguridad', 'prio:media', 'v1'], 'Adjuntos del expediente', 'RF-18', [
  'jpg, png, webp y pdf; máximo 5 MB; nombre generado',
  'Guardados fuera de `public/` y servidos por ruta autenticada con control de rol',
  'Rechaza otros tipos y tamaños (T-19)',
  'En teléfono permite elegir foto de la galería o tomarla con la cámara',
  'Incluidos en el respaldo',
]);
add(10, 'd2', ['tipo:funcional', 'prio:alta', 'v1'], 'Tratamientos, vacunas y documentos imprimibles', 'RF-20 · RF-22 · RF-23 · RF-24 · RN-02 · RN-05 · CU-06 · CU-07', [
  'Tratamientos en una consulta: medicamento del catálogo o texto, dosis, frecuencia, duración e indicaciones',
  'Vacunas: producto, lote (único, asignado solo), fecha, próxima dosis y veterinario; próxima dosis obligatoria (T-14)',
  'Registrar una vacuna NO descuenta stock (el producto se cobra en la venta)',
  'Carné de vacunación imprimible por mascota',
  'Receta imprimible (opcional) con datos de la clínica, mascota, propietario y veterinario (y colegiado si existe)',
  'Impresión limpia con `@media print`, sin barra lateral ni botones',
], 'Alcance académico (D-41): un solo imprimible obligatorio (el carné); la receta comparte la hoja y se incluyó.');
add(11, 'd2', ['tipo:funcional', 'prio:alta', 'v1'], 'Productos y stock simple con alertas', 'RF-21 · RF-26 · RF-27 · D-16 · D-41', [
  'CRUD de productos (solo admin): código, categoría, es_medicamento, presentación, unidad, precio, stock mínimo; desactivar en lugar de borrar',
  'Cada producto tiene un lote único interno (`UNICO`) creado automáticamente; sin vencimientos ni FEFO',
  'Entrada manual de stock con nota y ajuste con motivo (solo admin); lista simple de movimientos por producto',
  'Stock nunca negativo (T-09, se completa al vender en ISS-14)',
  'Alerta de stock bajo el mínimo, visible en Farmacia (y en Inicio vía ISS-17)',
  'Las 4 vacunas base de la migración 003 aparecen en el catálogo',
], 'Alcance académico (D-41): sin lotes con vencimiento, FEFO ni kárdex detallado.');
add(12, 'd2', ['tipo:funcional', 'prio:alta', 'v1'], 'Descuento automático de inventario y reversas', 'RF-25 · RN-04 · RN-08', [
  'NO SE IMPLEMENTA POR SEPARADO: el descuento de stock y la reversa al anular se hacen en ISS-14 (ventas)',
], 'Alcance académico (D-41): cerrado como "no planificado"; absorbido por ISS-14.');
add(13, 'd2', ['tipo:funcional', 'prio:media', 'v1'], 'Proveedores y registro de compras', 'RF-29 · RF-30 (simplificado)', [
  'NO SE IMPLEMENTA: la entrada de stock es manual, con nota, dentro de ISS-11',
], 'Alcance académico (D-41): cerrado como "no planificado".');
add(14, 'd2', ['tipo:funcional', 'prio:alta', 'v1'], 'Ventas y cobros con recibo imprimible', 'RF-43 · RN-08 · RN-09 · D-41', [
  'Carrito con productos y servicios; descuento; método efectivo, tarjeta o transferencia; pago completo (sin pagos parciales)',
  'Descuenta stock en transacción y rechaza vender sin existencias (T-09)',
  'Número de venta `V-000123` y recibo imprimible en córdobas (reutiliza las hojas de ISS-10)',
  'Anular venta (solo admin) con motivo y devolución del stock (T-15)',
  'Importes en centavos enteros (T-18); IVA según Ajustes',
  'Venta asociada a un propietario o de mostrador',
  'Usable en tablet y teléfono',
], 'Alcance académico (D-41): absorbe el descuento de inventario (ISS-12); sin vencidos ni FEFO.');

// ───────── Día 3
add(15, 'd3', ['tipo:funcional', 'prio:alta', 'v1'], 'Recordatorios y consentimiento', 'RF-31 · RF-32 · RF-33 · RF-34 · RF-35 · RN-06 · D-09 · Ley 787', [
  'Lista diaria: citas de las próximas 24 h y vacunas próximas o vencidas (por próxima dosis)',
  'Mensaje prellenado; botón "WhatsApp" abre `wa.me/505XXXXXXXX?text=...`; "Marcar enviado" guarda estado y usuario',
  'Excluye a clientes sin consentimiento (T-17)',
], 'Alcance académico (D-41): sin plantillas editables, sin historial de envíos, sin exportación de la ficha del titular ni aviso de privacidad en Ajustes.');
add(16, 'd3', ['tipo:funcional', 'prio:alta', 'v1'], 'Reportes y exportación', 'RF-36 · RF-40 (simplificado) · D-41', [
  'Reporte de ventas por día',
  'Reporte de citas por período, responsable y estado',
  'Reporte de stock bajo el mínimo',
  'Filtros por fecha y permisos por rol',
  'Exportar a CSV (UTF-8 con BOM) con protección contra inyección de fórmulas',
], 'Alcance académico (D-41): solo 3 reportes.');
add(17, 'd3', ['tipo:funcional', 'tipo:ui', 'prio:media', 'v1'], 'Panel de inicio con datos reales', 'RF-45 · U-02 · D-41', [
  'Tarjetas: citas de hoy, pacientes activos y ventas del día (esta última solo para admin)',
  'Próximas citas reales',
  'Alertas de stock bajo y de vacunas por vencer',
  'Se ve bien en PC, tablet y teléfono',
], 'Alcance académico (D-41): sin gráfico de visitas, sin pacientes recientes y sin aviso de respaldo.');
add(18, 'd3', ['tipo:tecnico', 'prio:alta', 'v1'], 'Respaldo y restauración', 'RNF-06 · RF-46 · docs/07-despliegue-operacion.md · D-41', [
  '`npm run backup` con `backup()` de `node:sqlite` y copia de `uploads/`, a una carpeta o unidad configurable',
  'Procedimiento de restauración **probado** sobre una base limpia',
], 'Alcance académico (D-41): sin programación automática, sin retención y sin borradores en `localStorage`.');
add(19, 'd3', ['tipo:pruebas', 'tipo:seguridad', 'prio:alta', 'v1'], 'Pruebas y revisión de seguridad final', 'docs/06-pruebas.md · RNF-04 · RNF-05', [
  'Casos de `06-pruebas.md` aplicables (ver nota D-41) con `node:test` y `supertest`; `npm test` pasa limpio',
  'Flujo completo: propietario y mascota → cita → consulta → vacuna → venta → recibo',
  'Lista manual en Edge/Chrome; PC, tablet y teléfono; impresión',
  'Lista de seguridad de `06-pruebas.md` completa; `git ls-files` sin `.env`, `.db`, `uploads/`, `backups/`',
  'Enlaces directos a pantallas ajenas devuelven 403; `npm audit` revisado',
], 'Alcance académico (D-41): T-08, T-10, T-11 y T-20 ya no aplican.');
add(20, 'd3', ['tipo:tecnico', 'tipo:docs', 'prio:media', 'v1'], 'Instalación: README de 5 pasos', 'docs/07-despliegue-operacion.md · D-41', [
  'README con 5 pasos: requisitos, instalar, configurar `.env`, crear el administrador, arrancar y entrar desde otro dispositivo',
  'Aviso de no exponer el servidor a internet',
], 'Alcance académico (D-41): sin servicio de Windows, runbook ni manual por rol.');

// ───────── v2
add(21, 'v2', ['tipo:funcional', 'prio:media', 'v2'], 'Mensajería automática: API de WhatsApp Business y correo SMTP', 'RF-31 · D-09 · D-10', [
  'Evaluar proveedor de WhatsApp Business: costo, verificación y plantillas aprobadas',
  'SMTP configurable con tarea programada y manejo de rebotes',
  'Envío automático con estado de entrega',
], 'Alcance académico (D-41): fuera de alcance (v2); cerrado como "no planificado".');
add(22, 'v2', ['tipo:funcional', 'prio:baja', 'v2'], 'Compras y finanzas avanzadas', 'RF-30 · H-21 · Sección 1.4', [
  'Órdenes de compra con recepción en dos pasos y recepción parcial',
  'Cierre de caja diario por método de pago, pagos parciales y crédito a clientes',
  'Factura fiscal electrónica: investigar requisitos legales vigentes e integrar con el proveedor autorizado',
], 'Alcance académico (D-41): fuera de alcance (v2); cerrado como "no planificado".');
add(23, 'v2', ['tipo:funcional', 'prio:baja', 'v2'], 'Plataforma: HTTPS en red local, multisucursal, portal de clientes y PDF/Excel', 'RNF-09 · RF-40 · Sección 1.4 · D-13', [
  'HTTPS en la LAN con certificado propio instalado en los dispositivos',
  'Soporte multisucursal con permisos por sucursal',
  'Portal de autoservicio para propietarios (citas y vacunas de sus mascotas)',
  'Generación de PDF en servidor y exportación `.xlsx`',
], 'Alcance académico (D-41): fuera de alcance (v2); cerrado como "no planificado".');

const id = (n) => `ISS-${String(n).padStart(2, '0')}`;
const fullTitle = (i) => `[${id(i.n)}] ${i.title}`;
const body = (i) => [
  `**Hito:** ${MILESTONES[i.ms]}`,
  `**Referencias:** ${i.refs}`,
  '',
  ...(i.nota ? ['> ' + i.nota, ''] : []),
  '## Criterios de aceptación',
  ...i.criteria.map((c) => `- [ ] ${c}`),
  '',
  '## Definición de terminado',
  'Ver `docs/05-plan-y-roadmap.md` (permisos por rol, validación, bitácora, prueba y documentación).',
].join('\n');

const gh = (args, input) => execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

const cmd = process.argv[2];
const dry = process.argv.includes('--dry');

if (cmd === 'md') {
  const out = ['# Lista de issues', '', '> Generado por `node scripts/issues.mjs md`. Editar `scripts/issues.mjs`, no este archivo.', '', `Total: ${I.length} issues.`, ''];
  for (const [key, name] of Object.entries(MILESTONES)) {
    const list = I.filter((i) => i.ms === key);
    out.push(`## ${name} (${list.length})`, '', '| ID | Título | Etiquetas | Referencias |', '|---|---|---|---|');
    for (const i of list) out.push(`| ${id(i.n)} | ${i.title} | ${i.labels.join(', ')} | ${i.refs} |`);
    out.push('');
    for (const i of list) {
      out.push(`### ${id(i.n)} – ${i.title}`, '', `Etiquetas: ${i.labels.join(', ')}  `, `Referencias: ${i.refs}`, '', ...(i.nota ? ['> ' + i.nota, ''] : []), ...i.criteria.map((c) => `- [ ] ${c}`), '');
    }
  }
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'ISSUES.md'), out.join('\n'), 'utf8');
  console.log(`docs/ISSUES.md generado (${I.length} issues).`);
} else if (cmd === 'update') {
  // Reescribe título y cuerpo de los issues ya creados (los de la lista con n >= desde) con los criterios actuales.
  const desde = Number(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 1);
  const existing = JSON.parse(gh(['issue', 'list', '-R', REPO, '--state', 'all', '--limit', '500', '--json', 'number,title']));
  for (const i of I.filter((x) => x.n >= desde)) {
    const hit = existing.find((e) => e.title.startsWith(`[${id(i.n)}]`));
    if (!hit) { console.log(`no existe: ${id(i.n)}`); continue; }
    if (dry) { console.log(`(simulación) #${hit.number} ${fullTitle(i)}`); continue; }
    gh(['issue', 'edit', String(hit.number), '-R', REPO, '-t', fullTitle(i), '-F', '-'], body(i));
    console.log(`actualizado #${hit.number} ${fullTitle(i)}`);
  }
} else if (cmd === 'create') {
  if (dry) {
    for (const i of I) console.log(`${fullTitle(i)}  [${MILESTONES[i.ms]}]  {${i.labels.join(', ')}}`);
    console.log(`\n${I.length} issues, ${Object.keys(MILESTONES).length} hitos, ${Object.keys(LABELS).length} etiquetas (simulación).`);
  } else {
    for (const [name, [color, desc]] of Object.entries(LABELS)) gh(['label', 'create', name, '-R', REPO, '--color', color, '--description', desc, '--force']);
    const existingMs = JSON.parse(gh(['api', `repos/${REPO}/milestones?state=all&per_page=100`])).map((m) => m.title);
    for (const title of Object.values(MILESTONES)) if (!existingMs.includes(title)) gh(['api', `repos/${REPO}/milestones`, '-f', `title=${title}`]);
    const existing = new Set(JSON.parse(gh(['issue', 'list', '-R', REPO, '--state', 'all', '--limit', '500', '--json', 'title'])).map((x) => x.title));
    let created = 0;
    for (const i of I) {
      if (existing.has(fullTitle(i))) { console.log(`omitido (ya existe): ${fullTitle(i)}`); continue; }
      const args = ['issue', 'create', '-R', REPO, '-t', fullTitle(i), '-F', '-', '-m', MILESTONES[i.ms]];
      for (const l of i.labels) args.push('-l', l);
      console.log(gh(args, body(i)).trim());
      created++;
    }
    console.log(`Creados: ${created}`);
  }
} else {
  console.log('Uso: node scripts/issues.mjs md | create [--dry] | update [desde] [--dry]');
}
