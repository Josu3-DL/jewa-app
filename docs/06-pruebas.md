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
