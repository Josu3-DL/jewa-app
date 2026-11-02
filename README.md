# JEWA – Sistema de gestión para clínica veterinaria

Sistema web para centralizar la gestión administrativa y clínica de una clínica veterinaria: clientes y mascotas, citas, expediente clínico, vacunas, farmacia/inventario, ventas y cobros, recordatorios y reportes.

> Estado: en desarrollo (v1 en 3 días). Ver [`docs/05-plan-y-roadmap.md`](docs/05-plan-y-roadmap.md).

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/00-decisiones.md`](docs/00-decisiones.md) | Decisiones tomadas y preguntas abiertas |
| [`docs/01-requerimientos.md`](docs/01-requerimientos.md) | RF/RNF/RN del documento de referencia y su estado en la v1 |
| [`docs/02-arquitectura.md`](docs/02-arquitectura.md) | Pila, capas, estructura de carpetas, seguridad |
| [`docs/03-modelo-datos.md`](docs/03-modelo-datos.md) | Tablas, relaciones y reglas de integridad |
| [`docs/04-diseno-ui.md`](docs/04-diseno-ui.md) | Estilos (de `design/`), componentes y mapa de pantallas |
| [`docs/05-plan-y-roadmap.md`](docs/05-plan-y-roadmap.md) | Plan de 3 días y definición de terminado |
| [`docs/06-pruebas.md`](docs/06-pruebas.md) | Estrategia de pruebas y casos clave |
| [`docs/07-despliegue-operacion.md`](docs/07-despliegue-operacion.md) | Despliegue, respaldo y recuperación |
| [`docs/08-huecos-y-riesgos.md`](docs/08-huecos-y-riesgos.md) | Registro de huecos y riesgos |
| [`docs/ISSUES.md`](docs/ISSUES.md) | Lista de issues (generada desde `scripts/issues.mjs`) |

## Cómo se usa

El sistema corre en **una PC de la clínica** (Windows) y se accede por la red Wi-Fi local desde esa PC, tablets y teléfonos (`http://<IP-de-la-PC>:3000`). La interfaz es responsiva. Moneda: córdoba (C$). No se expone a internet.

## Requisitos

- Node.js 24 o superior (usa el módulo integrado `node:sqlite`).
- Navegador actual (Chrome, Firefox o Edge).
- PC siempre encendida en horario de atención y una unidad externa para respaldos (ver `docs/07-despliegue-operacion.md`).

## Uso (cuando exista el código)

```bash
npm install
npm run migrate     # crea/actualiza la base de datos
npm run seed:admin  # crea el primer administrador
npm start           # http://localhost:3000
npm test
```

## Carpetas

- `design/` – diseño de referencia (HTML y `styles.css`). **No se ejecuta**, solo se consulta.
- `docs/` – documentación del proyecto.
- `scripts/` – utilidades (generación de issues, respaldo).

## Privacidad

El repositorio es público. **Nunca** subir bases de datos, copias de seguridad, archivos `.env` ni datos reales de clientes o pacientes.
