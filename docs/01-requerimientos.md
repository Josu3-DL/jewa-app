# Requerimientos y estado en la v1

Fuente: *Análisis de Requerimientos y Estudio de Factibilidad – Sistema Web para la Clínica Veterinaria "JEWA"* (UDEM, octubre de 2026).
Este archivo **no reemplaza** el documento: lo traduce a un alcance ejecutable en 3 días.

Leyenda de estado: ✅ Incluido · ✂️ Simplificado · ⏸ Pospuesto (v2) · ➕ Agregado (no está en el documento)

## Funcionales

### Seguridad y usuarios
| ID | Resumen | Prior. | Estado | Nota |
|---|---|---|---|---|
| RF-01 | Iniciar/cerrar sesión | A | ✅ | Bloqueo tras 5 intentos fallidos; cierre por inactividad. |
| RF-02 | Gestionar usuarios y restablecer contraseña | A | ✅ | Restablecimiento solo por el administrador (no hay correo automático). |
| RF-03 | Roles y permisos por módulo | A | ✅ | Matriz en `02-arquitectura.md`. |
| RF-04 | Bitácora de acciones críticas | M | ✅ | Función central `audit.log`. |

### Clientes y mascotas
| ID | Resumen | Prior. | Estado | Nota |
|---|---|---|---|---|
| RF-05 | Propietarios | A | ✅ | Desactivar, no borrar. |
| RF-06 | Mascotas con foto | A | ✅ | Foto como archivo (máx. 2 MB), no base64. |
| RF-07 | Varias mascotas por propietario / transferir | M | ✅ | Se guarda historial de propietarios. |
| RF-08 | Búsqueda por nombre, cédula, teléfono, expediente | A | ✅ | |

### Citas
| ID | Resumen | Prior. | Estado | Nota |
|---|---|---|---|---|
| RF-09 | Programar, reprogramar, cancelar, atendida, no asistida | A | ✅ | Máquina de estados en `03-modelo-datos.md`. |
| RF-10 | Sin traslape por veterinario | A | ✅ | Requiere duración de cita. |
| RF-11 | Agenda por día, semana y veterinario | A | ✅ | |
| RF-12 | Próximas y pendientes de confirmación | M | ✅ | |

### Expediente clínico
| ID | Resumen | Prior. | Estado | Nota |
|---|---|---|---|---|
| RF-13 | Expediente automático al registrar mascota | A | ✅ | Fusionado con mascota (D-17). |
| RF-14 | Registrar consultas | A | ✅ | Con o sin cita (D-18). |
| RF-15 | Peso y signos vitales | A | ✅ | |
| RF-16 | Historial cronológico | A | ✅ | |
| RF-17 | Gráfica de peso | M | ✅ | Chart.js local; requiere ≥ 2 mediciones. |
| RF-18 | Adjuntos | M | ✂️ | Imagen/PDF, máx. 5 MB, en disco. |
| RF-19 | Sin eliminación; anulación justificada | A | ✅ | Revierte inventario (D-14). |

### Tratamientos, medicamentos, vacunas
| ID | Resumen | Prior. | Estado | Nota |
|---|---|---|---|---|
| RF-20 | Tratamientos | A | ✅ | |
| RF-21 | Catálogo de medicamentos | A | ✂️ | Unificado con productos (D-16). |
| RF-22 | Receta en PDF | M | ✂️ | Vista imprimible. |
| RF-23 | Vacunas aplicadas | A | ✅ | Lote y próxima dosis obligatorios. |
| RF-24 | Carné de vacunación | M | ✂️ | Vista imprimible. |
| RF-25 | Descontar inventario en consulta | A | ✅ | Transacción, FEFO. |

### Inventario, compras, proveedores
| ID | Resumen | Prior. | Estado | Nota |
|---|---|---|---|---|
| RF-26 | Productos | A | ✅ | |
| RF-27 | Entradas/salidas y kárdex | A | ✅ | Por lote. |
| RF-28 | Alertas de stock mínimo y vencimiento | A | ✅ | En el Inicio y en Farmacia. |
| RF-29 | Proveedores | M | ✅ | |
| RF-30 | Órdenes de compra y recepción | M | ✂️ | Solo "registrar compra/entrada" con proveedor. Orden y recepción en dos pasos → v2. |

### Notificaciones
| ID | Resumen | Prior. | Estado | Nota |
|---|---|---|---|---|
| RF-31 | Recordatorio de cita por correo y WhatsApp | A | ✂️ | Lista de pendientes + `wa.me` (D-09). Correo → v2. |
| RF-32 | Recordatorio de vacunación | A | ✂️ | Igual. |
| RF-33 | Recordatorio de tratamiento | M | ✂️ | Igual. |
| RF-34 | Plantillas e historial de envíos | M | ✂️ | Plantillas editables; el historial registra "enviado manualmente". |
| RF-35 | Consentimiento | M | ✅ | Campo en propietario. |

### Reportes
| ID | Resumen | Prior. | Estado | Nota |
|---|---|---|---|---|
| RF-36 | Citas | A | ✅ | |
| RF-37 | Consultas y diagnósticos frecuentes | M | ✅ | |
| RF-38 | Vacunas aplicadas y pendientes | M | ✅ | |
| RF-39 | Inventario, movimientos, vencimientos, compras | A | ✅ | |
| RF-40 | Exportar PDF y Excel | M | ✂️ | CSV + impresión. |

### Agregados (no están en el documento)
| ID | Resumen | Origen | Estado |
|---|---|---|---|
| RF-41 | Ajustes de clínica (nombre, moneda, horario, duración de cita, teléfono) | Hueco | ➕ |
| RF-42 | Catálogo de servicios con precio y duración (consulta, vacuna, grooming…) | Hueco | ➕ |
| RF-43 | Ventas y cobros con recibo imprimible, métodos de pago y anulación | Diseño (Facturación) + "cobros básicos" | ➕ |
| RF-44 | Grooming como tipo de cita | Diseño | ➕ |
| RF-45 | Panel de inicio con datos reales (citas de hoy, pacientes, recordatorios, ingresos) | Diseño | ➕ |
| RF-46 | Respaldo diario automático y restauración documentada | RNF-06 | ➕ |

## No funcionales

| ID | Estado | Ajuste para la v1 |
|---|---|---|
| RNF-01 Usabilidad | ✅ | Interfaz en español; mensajes de error claros. |
| RNF-02 Rendimiento < 3 s | ✅ | Índices en búsquedas; paginación de 25 registros. |
| RNF-03 99 % | ✂️ | "Mejor esfuerzo" + respaldo (D-20). |
| RNF-04 Seguridad | ✅ | scrypt, consultas parametrizadas, escape XSS, CSRF, timeout. **HTTPS no se implementa en la v1**: el sistema corre en la LAN de la clínica con HTTP (D-25); HTTPS interno → v2 (ISS-23). |
| RNF-05 Confidencialidad | ✅ | Autorización por rol en cada ruta. |
| RNF-06 Respaldo | ✅ | `node:sqlite` `backup()` diario + prueba de restauración. |
| RNF-07 Compatibilidad | ✅ | Chrome, Firefox, Edge; responsivo (ya en `styles.css`). |
| RNF-08 Mantenibilidad | ✅ | Capas rutas → servicios → BD. |
| RNF-09 Escalabilidad / sucursales | ⏸ | Sin sucursales (D-13). |
| RNF-10 Tolerancia a conectividad | ✂️ | Borrador del formulario en `localStorage` + mensajes claros. |
| RNF-11 Auditoría | ✅ | Misma bitácora de RF-04. |

## Reglas de negocio

| ID | Regla | Cómo se hace cumplir |
|---|---|---|
| RN-01 | Toda mascota tiene propietario activo | FK `NOT NULL`; no se desactiva un propietario con mascotas activas sin transferirlas. |
| RN-02 | Solo el veterinario registra diagnósticos, tratamientos y vacunas | Permiso por rol en rutas y servicios. |
| RN-03 | Expedientes no se eliminan | Sin `DELETE`; anulación con motivo. |
| RN-04 | Sin salida de producto vencido ni sin existencias | Validación en transacción por lote. |
| RN-05 | Vacuna con lote y próxima dosis | Campos obligatorios. |
| RN-06 | Sin notificaciones a quien las rechazó | Se excluyen de la lista de pendientes. |
| RN-07 | Cita cancelada libera el horario | El chequeo de traslape ignora citas canceladas. |
| RN-08 ➕ | Una venta anulada devuelve el stock | Movimiento de reversa. |
| RN-09 ➕ | Solo el administrador anula ventas y ajusta inventario | Permiso por rol. |
