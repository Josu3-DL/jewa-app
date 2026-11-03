# Estrategia de pruebas

Un solo desarrollador es también el tester: por eso las pruebas se automatizan donde sea barato y el resto va en listas de verificación repetibles.

## Niveles
| Nivel | Qué cubre | Herramienta | Cuándo |
|---|---|---|---|
| Unitarias | Funciones puras: traslape de citas, FEFO, dinero, fechas, validadores | `node:test` | Al escribir cada servicio |
| Integración (API) | Rutas + BD en memoria (`:memory:`): permisos, validación, transacciones | `node:test` + `supertest` | Cierre de cada día |
| Flujo completo | CU-03, 04, 05, 07, 09 de punta a punta | Script de prueba contra BD temporal | Cierre del Día 2 y Día 3 |
| Manual | Interfaz, impresión, responsivo, navegadores | Lista de este documento | Día 3 |
| Seguridad | OWASP básico (lista abajo) | Manual + pruebas de API | Día 3 |

Reglas: cada prueba usa una BD nueva con migraciones aplicadas; datos de prueba **ficticios**; ninguna prueba depende del reloj real (se inyecta la fecha).

## Casos críticos (deben tener prueba automatizada)
| ID | Caso | Resultado esperado |
|---|---|---|
| T-01 | Login con credenciales correctas / incorrectas | Entra / mensaje genérico; al 5.º fallo, bloqueo 15 min |
| T-02 | Ruta protegida sin sesión | Redirige a login |
| T-03 | Recepcionista intenta crear consulta | 403 |
| T-04 | POST sin token CSRF | 403 |
| T-05 | Dos citas del mismo responsable que se traslapan | Rechaza la segunda |
| T-06 | Cita cancelada y nueva en el mismo horario | Permite |
| T-07 | Cita en el borde exacto (fin = inicio de otra) | Permite |
| T-08 | Consulta con descuento de insumo | Stock del lote baja; hay movimiento `salida` |
| T-09 | Salida con stock insuficiente | Rechaza; stock sin cambio (transacción) |
| T-10 | Producto vencido | No se puede vender ni usar; no aparece como disponible |
| T-11 | FEFO con dos lotes | Sale primero el que vence antes |
| T-12 | Anular consulta | Estado `anulada`, motivo obligatorio, stock devuelto (`reversa`) |
| T-13 | Intento de borrar consulta / venta / movimiento | No existe ruta; la BD lo rechaza |
| T-14 | Vacuna sin lote o sin próxima dosis | Rechaza |
| T-15 | Anular venta | Estado `anulada`, stock devuelto, solo admin |
| T-16 | Desactivar propietario con mascotas activas | Rechaza (RN-01) |
| T-17 | Cliente con `acepta_notificaciones = 0` | No aparece en recordatorios (RN-06) |
| T-18 | Montos | 3 × 1,99 = 5,97 exacto (centavos) |
| T-19 | Subida de archivo `.exe` o > 5 MB | Rechaza |
| T-20 | Concurrencia: dos ventas simultáneas del último producto | Solo una se completa |
| T-21 | Búsqueda con `'; DROP TABLE` y `<script>` | Sin error y escapado |
| T-22 | Horario fuera del laboral / fecha pasada | Advierte o rechaza según Ajustes |

> **Alcance académico (D-41):** T-08 (consulta con descuento), T-10 (vencidos), T-11 (FEFO) y T-20 (concurrencia de ventas) dejan de aplicar o se reducen; T-09 y T-15 se prueban en ISS-14 (venta sin stock y anulación que devuelve stock); T-12 cubre solo la anulación de la consulta.

## Cobertura automatizada (se actualiza con cada issue)
| Caso | Estado | Dónde |
|---|---|---|
| T-01 Login correcto/incorrecto y bloqueo a los 5 fallos | ✅ ISS-03 | `test/auth-services.test.js`, `test/security.test.js` |
| T-02 Ruta protegida sin sesión → login; cerrar sesión invalida en servidor | ✅ ISS-03 | `test/security.test.js`, `test/layout.test.js` |
| T-03 Recepcionista sin acceso a módulos clínicos (403) | ✅ ISS-02/03 (módulos) y ISS-04 (todas las pantallas y acciones de Ajustes, con GET y POST reales); se amplía con cada módulo | `test/layout.test.js`, `test/security.test.js`, `test/ajustes.test.js` |
| Usuarios: alta, edición, desactivar (no al último administrador ni a uno mismo), restablecer contraseña y desbloquear; las sesiones del usuario se cierran al desactivarlo o restablecerle la clave | ✅ ISS-04 | `test/usuarios-services.test.js`, `test/ajustes.test.js` |
| T-18 Montos exactos en centavos (19.99 + 0.01 = 20.00; sin floats; formato "C$ 1,234.50"; IVA redondeado al centavo) | ✅ ISS-05 (utilidad de dinero; se aplica en ventas con ISS-14) | `test/clinica-servicios-services.test.js` |
| Ajustes de la clínica: validación por campo y por día (todos los errores a la vez), valores por defecto, el nombre cambia en menú, título, login y páginas de error (con escape), moneda aplicada a los precios | ✅ ISS-05 | `test/clinica-servicios-services.test.js`, `test/ajustes-clinica.test.js` |
| Servicios: alta, edición, desactivar sin afectar citas existentes, nombre único, precios sin inventar (base en 0 con aviso), T-03 en todas sus pantallas y acciones | ✅ ISS-05 | `test/clinica-servicios-services.test.js`, `test/ajustes-clinica.test.js` |
| Bitácora: sin contraseñas ni hashes a ninguna profundidad; filtros por usuario, entidad y día en hora de Managua; paginación; texto escapado | ✅ ISS-04 | `test/usuarios-services.test.js`, `test/ajustes.test.js` |
| T-05/T-06/T-07 Traslape de citas, cita cancelada que libera el horario y borde exacto (servicio y HTTP) | ✅ ISS-07 | `test/citas-services.test.js`, `test/citas.test.js` |
| T-22 Advertencia por fecha pasada, día cerrado u hora fuera de horario (se guarda solo al confirmar) | ✅ ISS-07 | `test/citas-services.test.js`, `test/citas.test.js` |
| Citas: estados y transiciones con bitácora, reprogramación, agenda día/semana en hora de Managua, filtros por responsable/grooming/mascota, sin redirección abierta en "volver" | ✅ ISS-07 | `test/citas-services.test.js`, `test/citas.test.js` |
| T-03 (clínico) Recepción 403 en historial; el administrador ve pero no crea consultas | ✅ ISS-08 | `test/historial.test.js` |
| T-12 Anular consulta: motivo obligatorio, quién/cuándo/por qué, contenido conservado, definitiva; el veterinario solo las suyas | ✅ ISS-08 (la devolución de stock se prueba en ISS-12) | `test/consultas-services.test.js`, `test/historial.test.js` |
| T-13 Sin borrado de consultas (BD y rutas) | ✅ ISS-01 / ISS-08 | `test/db.test.js`, `test/consultas-services.test.js`, `test/historial.test.js` |
| Consulta: validación de rangos, desde cita (pasa a atendida) y sin cita, historial con filtros, gráfica de peso sin anuladas y con mensaje si hay < 2 mediciones | ✅ ISS-08 | `test/consultas-services.test.js`, `test/historial.test.js` |
| T-19 (adjuntos) `.exe` disfrazado, texto, SVG, > 5 MB o vacío → rechaza y no deja archivos; descarga solo con sesión y rol; sin borrado; nombres hostiles limpios y escapados | ✅ ISS-09 | `test/adjuntos.test.js` |
| Bitácora: toda acción y entidad registrada en el código tiene etiqueta en español (revisión estática) | ✅ ISS-09 | `test/auditoria-etiquetas.test.js` |
| T-14 Vacuna sin próxima dosis (o sin vacuna) → rechaza; con lote único; sin mover stock | ✅ ISS-10 | `test/vacunas-tratamientos-services.test.js`, `test/clinico-hojas.test.js` |
| Tratamientos y vacunas: solo el veterinario (administrador y recepción 403), no en consultas anuladas, sin borrado, anular vacuna con motivo; receta y carné imprimibles sin barra lateral | ✅ ISS-10 | `test/vacunas-tratamientos-services.test.js`, `test/clinico-hojas.test.js` |
| Farmacia: alta con código único y stock inicial, edición con bitácora, entrada y ajuste con movimiento, stock nunca negativo (T-09 base), bajo stock, desactivar sin borrar, búsqueda y paginación, T-03 (solo administrador escribe) | ✅ ISS-11 | `test/productos-services.test.js`, `test/farmacia.test.js` |
| T-09 Venta sin existencias → rechaza, nada se descuenta y no queda venta (también con el stock cambiado después de armar el carrito y con todo-o-nada entre líneas) | ✅ ISS-14 | `test/ventas-services.test.js`, `test/ventas.test.js` |
| T-15 Anular venta: solo administrador, motivo obligatorio, devuelve el stock con reversas, definitiva y sin doble devolución | ✅ ISS-14 | `test/ventas-services.test.js`, `test/ventas.test.js` |
| T-18 (ventas) 3 × C$ 1.99 = C$ 5.97, IVA redondeado al centavo y calculado tras el descuento; precios del navegador ignorados; no se vende sin precio | ✅ ISS-14 | `test/ventas-services.test.js`, `test/ventas.test.js` |
| Ventas: T-13 sin borrado, recibo imprimible, filtros y paginación, XSS escapado | ✅ ISS-14 | `test/ventas-services.test.js`, `test/ventas.test.js` |
| T-04 POST sin token CSRF → 403 (también en formularios multipart y sin saltarse la regla en otras rutas) | ✅ ISS-03 / ISS-06 | `test/security.test.js`, `test/clientes-mascotas.test.js` |
| T-16 Desactivar cliente con mascotas activas → rechaza (servicio y HTTP) | ✅ ISS-06 | `test/clientes-mascotas-services.test.js`, `test/clientes-mascotas.test.js` |
| T-19 Foto `.exe` disfrazado, PDF o > 2 MB → rechaza y no crea nada; foto fuera de `public/`, con nombre UUID y servida solo con sesión | ✅ ISS-06 (se amplía a adjuntos en ISS-09) | `test/clientes-mascotas.test.js` |
| Clientes/mascotas: teléfono 505XXXXXXXX, cédula única y opcional, consentimiento en bitácora, expediente EXP-000001…, edad, transferencia con historial, búsqueda (nombre, cédula, teléfono, expediente, dueño), paginación de 25, T-21 en buscadores | ✅ ISS-06 | `test/clientes-mascotas-services.test.js`, `test/clientes-mascotas.test.js` |
| T-13 Sin borrado de consultas, ventas, movimientos ni bitácora | ✅ ISS-01 (triggers de BD) | `test/db.test.js` |
| T-21 Inyección SQL y XSS en entradas | ✅ login (ISS-03); se amplía en búsquedas | `test/security.test.js` |
| Revisión estática: sin SQL concatenado, sin `<%-` con datos | ✅ ISS-03 (corre en cada `npm test`) | `test/security.test.js` |

Además se verificó a mano en Edge (teléfono 400 px y PC 1366 px): login, error de credenciales, redirección con `next`, cierre de sesión desde el menú plegable y ausencia de violaciones de la CSP.

## Lista de verificación manual (Día 3)
**Navegadores:** Chrome, Firefox, Edge (actuales).
**Pantallas:** 1366×768, tablet 768 px, móvil 400 px: el menú se abre y nada desborda horizontalmente.
**Dispositivos reales:** al menos una tablet y un teléfono conectados por Wi-Fi a la PC (`http://<IP>:3000`): iniciar sesión, crear cita, registrar consulta y cobrar; botones tocables sin error; teclado numérico en teléfono y dinero.
**Red:** apagar el Wi-Fi del teléfono a mitad de un formulario → se conserva el borrador y el mensaje es claro; PC reiniciada → el servicio vuelve solo.
**Impresión:** receta, carné y recibo salen en una hoja, sin barra lateral.
**Flujos con cada rol:** administrador, veterinario, recepcionista (CU-01 a CU-11).
**Mensajes:** todos los errores son claros y en español; no hay textos en inglés ni trazas.
**Datos vacíos:** cada lista muestra `empty-state`.
**Corte de conexión:** al enviar un formulario sin red, el borrador se conserva (RNF-10).
**Respaldo:** ejecutar respaldo, borrar la BD de prueba, restaurar y comprobar que los datos están.

## Seguridad (revisión final)
- [ ] Contraseñas con scrypt y sal; no aparecen en logs ni bitácora.
- [ ] Todas las rutas con `requireAuth` y rol; probar enlaces directos a pantallas ajenas.
- [ ] CSRF en todos los POST.
- [ ] Sin concatenación de SQL (revisar con búsqueda de `${` dentro de consultas).
- [ ] Sin `<%-` con datos de usuario.
- [ ] Cookies `HttpOnly` y `SameSite`; `Secure` según `COOKIE_SECURE`; sesión expira por inactividad.
- [ ] El puerto no está reenviado en el router; el firewall solo lo permite en red privada.
- [ ] Archivos subidos fuera de `public/` y servidos por ruta autenticada.
- [ ] Cabeceras de seguridad (`helmet`, CSP).
- [ ] `.env`, `.db`, `uploads/`, `backups/` no están en git (`git ls-files`).
- [ ] Mensajes de error genéricos hacia el usuario.
- [ ] Ley 787: solo se piden los datos necesarios; el consentimiento queda registrado.

## Criterio de aceptación global
Todos los casos T-01 a T-22 pasan, la lista manual está completa y no hay defectos abiertos de severidad alta.
