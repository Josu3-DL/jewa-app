# CLAUDE.md – guía para trabajar en este repositorio

Proyecto: JEWA, sistema web para clínica veterinaria. Un solo desarrollador (analista, programador y tester).

## Fuentes de verdad
1. Requerimientos: `docs/01-requerimientos.md` (deriva del documento *Análisis de Requerimientos y Estudio de Factibilidad*).
2. Decisiones: `docs/00-decisiones.md`. Si algo se decide, se anota ahí.
3. Datos: `docs/03-modelo-datos.md`. Cambiar el esquema = nueva migración + actualizar este archivo.
4. Estilos: `design/styles.css` (se reutiliza tal cual; ver `docs/04-diseno-ui.md`).

## Pila
Node.js 24, Express, EJS (render en servidor), `node:sqlite` (sin dependencias nativas), CSS de `design/`, JS de navegador mínimo (sin framework). Pruebas con `node:test` y `supertest`.

## Librerías antes que código propio
Antes de implementar cualquier funcionalidad que no sea lógica propia de la clínica (autenticación, CSRF, validación, límites de intentos, subida de archivos, CSV/PDF, registros/logs, fechas, planificación de tareas…), **buscar primero si existe una librería mantenida** y usarla. Escribir a mano solo lo que sea del dominio veterinario o cuando no exista una opción razonable.
- Verificar: última publicación reciente, uso real (descargas), compatibilidad con Express 5 y Node 24, y que **no exija módulos nativos** (la PC de la clínica no debe compilar nada).
- Registrar la decisión (qué se adoptó, qué se descartó y por qué) en `docs/00-decisiones.md` y la tabla de `docs/02-arquitectura.md`.
- Si se escribe algo propio aunque exista una librería, dejar la razón en un comentario breve.

## Convenciones
- Idioma: interfaz, mensajes y documentación en **español**; código (variables, funciones) en inglés o español, pero consistente por módulo.
- Capas: `routes/` (HTTP) → `services/` (reglas de negocio) → `db/` (SQL). Las rutas no contienen SQL; los servicios no conocen `req/res`.
- Dinero en **enteros (centavos)**, nunca `float`. Fechas en ISO UTC en BD; mostrar en zona `America/Managua`.
- Todo SQL con parámetros (`?`). Toda salida escapada (EJS `<%= %>`, nunca `<%- %>` con datos de usuario).
- Operaciones que tocan inventario o varias tablas van en **transacción**.
- Nada de borrado físico en datos clínicos, ventas ni movimientos de inventario: se anulan con motivo (RF-19, RN-03).
- Toda acción crítica llama a `audit.log(...)` (bitácora central).
- Cada ruta POST valida rol, token CSRF y entrada. El CSRF ya lo exige un middleware global: todo `<form method="post">` lleva `<input type="hidden" name="_csrf" value="<%= csrfToken() %>">`. La entrada se valida con **Zod** (`z.object({...})` y los ayudantes `texto`, `opcional`, `telefono`, `correo`, `fecha`, `numero` de `src/utils/validation.js`) usando `parseForm(esquema, req.body)`, que devuelve `{ ok, values, errors }` con un mensaje en español por campo; nunca se confía en `req.body` sin validar. Para listas (p. ej. el carrito de ventas) y reglas entre campos (p. ej. fin > inicio) se usan `z.array` y `.refine` directamente.
- Toda ruta nueva queda protegida por defecto (`requireAuth` global); el permiso por rol se declara con `requireModule('clave')` y la clave se agrega en `src/modules.js`.
- Sin scripts ni estilos en línea en las vistas (la CSP los bloquea): todo en `public/css` y `public/js`.

## Reglas de seguridad no negociables
- Contraseñas con `scrypt` (`node:crypto`) y sal; nunca en logs.
- Sesión con cookie `HttpOnly`, `SameSite=Lax`, `Secure` según `COOKIE_SECURE` (en la LAN con HTTP va en falso, D-25); cierre por inactividad.
- El servidor corre en una PC de la clínica y se accede por la red local desde PC, tablet y teléfono: toda pantalla nueva debe funcionar a 1366, 768 y 400 px. Moneda: córdoba (C$). Marca: JEWA.
- No subir `.db`, `.env`, `uploads/`, `backups/` (ver `.gitignore`). El repositorio es público.
- No usar datos reales en pruebas ni en capturas.

## Flujo de trabajo
- Una rama por issue (`feat/ISS-12-citas`), PR pequeño que cierre el issue (`Closes #N`).
- Antes de cerrar un issue: criterios de aceptación cumplidos + prueba automatizada o checklist manual en `docs/06-pruebas.md`.
- Commits en español, imperativo, concisos.

## Comandos
`npm start` · `npm test` · `npm run migrate` · `npm run seed:admin` · `npm run backup`
Generar issues: `node scripts/issues.mjs md` (actualiza `docs/ISSUES.md`) y `node scripts/issues.mjs create --dry` / `create`.
