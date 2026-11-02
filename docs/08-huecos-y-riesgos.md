# Registro de huecos y riesgos

Estados: 🔴 bloquea o cambia trabajo · 🟠 hay que decidir antes del módulo · 🟢 resuelto con una suposición documentada.
Los huecos con decisión propuesta están en `00-decisiones.md`.

## A. Huecos del documento de requerimientos

| # | Hueco | Impacto | Resolución | Estado |
|---|---|---|---|---|
| H-01 | 1.4 dice "módulos descritos en el contexto", que no existe | Alcance ambiguo | `01-requerimientos.md` fija el alcance | 🟢 |
| H-02 | No existe entidad **Servicio** (consulta, baño, vacuna con precio y duración) | Sin ella no hay cobro, duración de cita ni grooming | RF-42, tabla `servicios` | 🟢 |
| H-03 | "Cobros básicos" (recepcionista) sin requerimiento | No se sabe cómo se cobra | RF-43 Ventas y cobros | 🟢 |
| H-04 | Duración de cita, horario laboral y festivos no definidos | RF-10 no se puede implementar | Config en Ajustes (Q-05) | 🟠 |
| H-05 | Inventario por producto, pero RN-04 exige vencimiento | Imposible por producto | Lotes y FEFO (D-15) | 🟢 |
| H-06 | RF-25 descuenta "automáticamente" sin definir unidad (frasco vs dosis) | Stock incorrecto | Unidad mínima por producto; se descuenta en esa unidad | 🟢 |
| H-07 | Anular una consulta no dice qué pasa con el inventario descontado | Stock desfasado | Reversa automática (RN-08) | 🟢 |
| H-08 | Consulta exige cita (CU-05), pero hay urgencias | Bloquea la atención | Consulta sin cita (D-18) | 🟢 |
| H-09 | Quién atiende grooming no está definido | Agenda de grooming sin dueño | Responsable con `atiende_citas` (D-21) | 🟢 |
| H-10 | Catálogo de medicamentos y productos duplican datos | Inconsistencias | Unificados (D-16) | 🟢 |
| H-11 | Expediente 1:1 con mascota sin valor propio | Complejidad inútil | Fusionado (D-17) | 🟢 |
| H-12 | Actores "Encargado de inventario" y "Cliente" sin rol | Permisos ambiguos | Admin cubre inventario; cliente no accede (D-06) | 🟢 |
| H-13 | Estados de mascota (fallecida, inactiva) y de propietario con mascotas | Reglas RN-01 en conflicto con desactivar | Estado de mascota; regla en RN-01 | 🟢 |
| H-14 | Moneda, IVA, decimales y redondeo | Cobros erróneos | Centavos enteros; moneda C$ (D-23); IVA en Ajustes, 0 % por defecto | 🟢 |
| H-15 | Formato de número de expediente y de cédula | Búsqueda y duplicados | `EXP-000123`; cédula opcional y única | 🟢 |
| H-16 | Receta sin datos legales del veterinario (colegiado) | Receta incompleta | Campo opcional `colegiado` (Q-04) | 🟠 |
| H-17 | Transferencia de mascota sin historial de propietarios | Se pierde trazabilidad | Tabla `mascota_propietarios_hist` | 🟢 |
| H-18 | Primer administrador y política de contraseñas no definidos | No se puede iniciar | `seed:admin`; mínimo 8 caracteres | 🟢 |
| H-19 | Recordatorios necesitan **cuándo** se generan y quién los envía | RF-31 ambiguo | Lista del día generada al abrir; envío manual con `wa.me` | 🟢 |
| H-20 | Consentimiento (RF-35): ¿valor por defecto? ¿cómo se registra? | Ley 787 | Por defecto aceptado, editable, con fecha y usuario en bitácora | 🟢 |
| H-21 | Pagos: ¿parciales, crédito, cierre de caja? | Contabilidad | Fuera de v1 (ISS-22); pago completo | 🟢 |
| H-22 | Derechos del titular (acceso/rectificación/supresión de datos) | Ley 787 | Exportar ficha por solicitud; supresión = anonimizar sin tocar clínico | 🟠 |
| H-23 | Retención de datos clínicos | Cumplimiento | Conservar mientras la clínica opere; definir con el cliente | 🟠 |
| H-24 | Teléfono: formato para `wa.me` (+505, 8 dígitos) | Mensajes no abren | Normalizar a `505XXXXXXXX` | 🟢 |
| H-25 | Cronograma del documento (semestre) contradice el plazo de 3 días | Expectativas | `05-plan-y-roadmap.md` reemplaza al cronograma | 🟢 |
| H-26 | Costos del documento suponen 3 personas × 4 meses | No aplica | Documento académico; no afecta el desarrollo | 🟢 |
| H-27 | Importación desde Excel (migración, sección 8.2) sin requerimiento | Carga inicial manual lenta | No en v1 (Q-08); se evalúa si hay datos | 🟠 |
| H-28 | RNF-10 "no perder datos de formularios" sin definición técnica | Promesa vaga | Borrador en `localStorage` + mensajes (ISS-18) | 🟢 |

## B. Huecos del diseño (`design/`)

| # | Hueco | Resolución |
|---|---|---|
| U-01 | Nombre "Robles" vs "JEWA" | Resuelto: JEWA (D-22), configurable |
| U-02 | Datos del Inicio y usuarios son fijos ("Willy Garcia", "Laura Mendez") | Datos reales y sesión |
| U-03 | Menú inconsistente (Inicio/Resumen, numeración duplicada, Farmacia ausente en algunas páginas) | Un solo partial de menú |
| U-04 | Barra lateral copiada en 9 archivos | `views/partials/` |
| U-05 | `facturacion.html` vacía | RF-43 |
| U-06 | No hay pantalla de login, usuarios, ajustes, reportes, recordatorios, receta, carné, recibo | Diseñar con componentes existentes (`04-diseno-ui.md`) |
| U-07 | No hay edición, búsqueda, paginación ni detalle (solo crear/eliminar) | Agregar en cada módulo |
| U-08 | No hay estados de error, carga ni validación | Mensajes bajo cada campo; página de error |
| U-09 | "Eliminar" en registros clínicos viola RF-19 | "Anular" con motivo |
| U-10 | Tutor, mascota y paciente son texto libre | Selectores con FK |
| U-11 | Imágenes de productos en base64 | Archivos en disco |
| U-12 | Foto del Inicio viene de Unsplash (externa) | Recurso local o quitar (D-19) |
| U-13 | Faltan estilos de estado: atendida, cancelada, no asistió | Agregar `status-*` |
| U-14 | Formato de fecha `es-MX` en `script.js` | `es-NI` y zona Managua |
| U-15 | Sin impresión | `@media print` |
| U-16 | Confirmación de cliente con `mailto:` | Se elimina; recordatorios por `wa.me` |
| U-17 | Ingresos del mes visibles a cualquier usuario | Solo administrador |

## C. Riesgos técnicos y de proyecto

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | Alcance excede 3 días | Alta | Alto | Orden de recorte en `05-plan-y-roadmap.md`; v2 explícito |
| R-02 | Stock negativo o inconsistente por concurrencia | Media | Alto | Transacciones, `CHECK`, prueba T-20 |
| R-03 | Pérdida de datos (único servidor) | Baja | Muy alto | Respaldo diario + copia externa + restauración probada |
| R-04 | Filtración de datos personales (repositorio público) | Media | Alto | `.gitignore`, sin datos reales, revisión antes de cada push |
| R-05 | `node:sqlite` aún marcado experimental | Baja | Medio | Capa `db/` aislada; migrar a `better-sqlite3` cambia un archivo |
| R-06 | Cortes de energía o de Wi-Fi en la clínica | Alta | Medio | UPS para la PC; borradores locales en el navegador; mensajes claros |
| R-13 | **La PC es un punto único de falla** (apagada, dañada, robada): sin ella nadie usa el sistema | Media | Muy alto | Sin suspensión y arranque automático; respaldo diario a unidad externa; copia mensual fuera del local; procedimiento de cambio de PC documentado |
| R-14 | Tráfico sin cifrar (HTTP) dentro de la Wi-Fi | Media | Medio | Wi-Fi WPA2/WPA3 propia, sin red de invitados, sin reenvío de puertos; HTTPS interno en v2 |
| R-15 | La IP de la PC cambia y los dispositivos dejan de conectar | Media | Medio | Reserva de IP en el router; marcador en cada dispositivo; runbook |
| R-16 | Windows se reinicia por actualizaciones y el servicio no vuelve | Media | Medio | Servicio con reinicio automático; probar reinicio completo antes de entregar |
| R-17 | Interfaz difícil de usar en teléfono (formularios largos, botones pequeños) | Media | Medio | Reglas de `04-diseno-ui.md` y pruebas en dispositivos reales (ISS-19) |
| R-07 | Un solo desarrollador/tester: sesgo en pruebas | Media | Medio | Casos T-01 a T-22 escritos antes de programar cada módulo |
| R-08 | El personal rechaza el sistema | Media | Alto | Capacitación breve, manual, uso paralelo (sección 8.2 del documento) |
| R-09 | Cumplimiento legal (Ley 787, registros veterinarios) | Media | Medio | Consentimiento, mínimos datos; consultar con un profesional |
| R-10 | Cambios de requerimientos a mitad de la semana | Media | Medio | Registro en `00-decisiones.md`; lo nuevo va a v2 |
| R-11 | Dependencia de CDN (Chart.js) | Baja | Bajo | Archivo local en `public/vendor/` |
| R-12 | Zona horaria y fechas | Media | Medio | UTC en BD, Managua en pantalla, pruebas con reloj inyectado |

## D. Qué haría si el tiempo no alcanza
1. Mantener intactos: seguridad, clientes, mascotas, citas, consulta, inventario con lotes, ventas, respaldo.
2. Recortar primero: adjuntos, gráfica de peso, carné, reportes de RF-37/38, plantillas editables.
3. Nunca recortar: anulación en lugar de borrado, transacciones de inventario, bitácora, respaldo.
