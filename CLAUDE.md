# CLAUDE.md – guía para trabajar en este repositorio

Proyecto: JEWA, sistema web para clínica veterinaria. Un solo desarrollador (analista, programador y tester).

## Fuentes de verdad
1. Requerimientos: `docs/01-requerimientos.md` (deriva del documento *Análisis de Requerimientos y Estudio de Factibilidad*).
2. Decisiones: `docs/00-decisiones.md`. Si algo se decide, se anota ahí.
3. Datos: `docs/03-modelo-datos.md`. Cambiar el esquema = nueva migración + actualizar este archivo.
4. Estilos: `design/styles.css` (se reutiliza tal cual; ver `docs/04-diseno-ui.md`).

## Pila
Node.js 24, Express, EJS (render en servidor), `node:sqlite` (sin dependencias nativas), CSS de `design/`, JS de navegador mínimo (sin framework). Pruebas con `node:test` y `supertest`.

## Convenciones
- Idioma: interfaz, mensajes y documentación en **español**; código (variables, funciones) en inglés o español, pero consistente por módulo.
- Capas: `routes/` (HTTP) → `services/` (reglas de negocio) → `db/` (SQL). Las rutas no contienen SQL; los servicios no conocen `req/res`.
- Dinero en **enteros (centavos)**, nunca `float`. Fechas en ISO UTC en BD; mostrar en zona `America/Managua`.
- Todo SQL con parámetros (`?`). Toda salida escapada (EJS `<%= %>`, nunca `<%- %>` con datos de usuario).
- Operaciones que tocan inventario o varias tablas van en **transacción**.
- Nada de borrado físico en datos clínicos, ventas ni movimientos de inventario: se anulan con motivo (RF-19, RN-03).
- Toda acción crítica llama a `audit.log(...)` (bitácora central).
- Cada ruta POST valida rol, token CSRF y entrada.

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
