# JEWA – Sistema de gestión para clínica veterinaria

Sistema web para centralizar la gestión administrativa y clínica de una clínica veterinaria: clientes y mascotas, citas, expediente clínico, vacunas, farmacia/inventario, ventas y cobros, recordatorios y reportes.

> Estado: v1 completa (alcance académico, D-41). Ver [`docs/05-plan-y-roadmap.md`](docs/05-plan-y-roadmap.md).

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
| [`docs/09-guia-del-proyecto.md`](docs/09-guia-del-proyecto.md) | Guía del proyecto: estructura, funciones, flujo y qué archivos leer |
| [`docs/ISSUES.md`](docs/ISSUES.md) | Lista de issues (generada desde `scripts/issues.mjs`) |

## Cómo se usa

El sistema corre en **una PC de la clínica** (Windows) y se accede por la red Wi-Fi local desde esa PC, tablets y teléfonos (`http://<IP-de-la-PC>:3000`). La interfaz es responsiva. Moneda: córdoba (C$). No se expone a internet.

## Instalación en 5 pasos

> **No expongas el servidor a internet.** JEWA usa HTTP sin cifrar y está pensado solo para la red Wi-Fi privada de la clínica: no reenvíes el puerto en el router ni lo publiques en ningún servicio en la nube. Más detalles en [`docs/07-despliegue-operacion.md`](docs/07-despliegue-operacion.md).

**1. Requisitos.** Node.js 24 o superior (usa el módulo integrado `node:sqlite`, no compila nada) y un navegador actual (Chrome, Firefox o Edge). Comprueba con `node -v`. La PC debe estar encendida en horario de atención; para los respaldos conviene una unidad externa.

**2. Instalar.** En la carpeta del proyecto:

```bash
npm ci
npm run migrate     # crea la base de datos y aplica las migraciones
```

**3. Configurar `.env`.** Copia `.env.example` a `.env` y completa al menos `SESSION_SECRET` (32 caracteres o más, aleatorio):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Valores habituales en la red local: `HOST=0.0.0.0`, `PORT=3000`, `COOKIE_SECURE=false` (HTTP), `NODE_ENV=production`. Si quieres los respaldos en una unidad externa, ajusta `BACKUP_DIR` (por ejemplo `E:/respaldos-jewa`). El archivo `.env` nunca se sube a git.

**4. Crear el administrador.**

```bash
npm run seed:admin
```

Pide usuario, nombre y contraseña (mínimo 8 caracteres; no se muestra al escribirla). Ese usuario configura después los ajustes de la clínica, los servicios y las cuentas del personal desde **Ajustes**.

**5. Arrancar y entrar desde otro dispositivo.**

```bash
npm start
```

En la PC abre `http://localhost:3000`. Para tablets y teléfonos conectados al mismo Wi-Fi, averigua la IP de la PC (`ipconfig` en Windows, `ip a` en Linux) y abre `http://<IP-de-la-PC>:3000`. Si no abre, permite el puerto 3000 en el firewall solo para la red **privada**. Conviene reservar esa IP en el router para que no cambie.

### Después de instalar
- `npm test` ejecuta las pruebas automatizadas.
- `npm run backup` crea un respaldo (se puede usar con el sistema en marcha); `npm run restore` lista y restaura respaldos. Ver [`docs/07-despliegue-operacion.md`](docs/07-despliegue-operacion.md).

## Carpetas

- `design/` – diseño de referencia (HTML y `styles.css`). **No se ejecuta**, solo se consulta.
- `docs/` – documentación del proyecto.
- `scripts/` – utilidades (generación de issues, respaldo).

## Privacidad

El repositorio es público. **Nunca** subir bases de datos, copias de seguridad, archivos `.env` ni datos reales de clientes o pacientes.
