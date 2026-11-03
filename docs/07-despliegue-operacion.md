# Despliegue y operación

Decisión D-24: el sistema corre en **una PC de la clínica** (Windows) y se usa desde esa PC, tablets y teléfonos conectados a la misma red Wi-Fi. No se expone a internet.

## Requisitos de la PC
- Windows 10/11, Node.js 24 o superior, 4 GB de RAM, disco con espacio para BD, fotos y adjuntos.
- **Siempre encendida en horario de la clínica** y con la suspensión desactivada (`powercfg /change standby-timeout-ac 0`).
- UPS recomendado: un corte de energía en pleno guardado es el mayor riesgo de corrupción.
- **Unidad externa** (USB o disco) para respaldos (D-26).
- Antivirus activo; excluir la carpeta de datos del análisis en tiempo real si causa bloqueos.
- Cuenta de Windows sin privilegios de administrador para ejecutar el servicio, si es posible.

## Red local
1. Reservar una **IP fija** para la PC en el router (reserva DHCP por MAC), por ejemplo `192.168.1.50`.
2. El servidor escucha en `HOST=0.0.0.0`, puerto `3000`.
3. Firewall de Windows: regla de entrada solo para el puerto 3000 y solo en perfil **Privado**.
4. El router **no** debe reenviar puertos hacia internet.
5. Wi-Fi de la clínica con WPA2/WPA3 y contraseña propia (no la red de invitados). Quienes no sean personal no deben conectarse a esa red.
6. En tablets y teléfonos se guarda como marcador `http://192.168.1.50:3000` (opcional: acceso directo en la pantalla de inicio).

> HTTP en la LAN significa que el tráfico no va cifrado. El riesgo se acepta (D-25) porque la red es privada y protegida. HTTPS interno es un issue de la v2 (ISS-23).

## Instalación (primer arranque)
1. Instalar Node 24 y clonar o copiar el proyecto a `C:\JEWA\app`.
2. Crear `C:\JEWA\data` (BD) y `C:\JEWA\uploads`. Crear `.env` desde `.env.example` con un `SESSION_SECRET` aleatorio y `COOKIE_SECURE=false`.
3. `npm ci` · `npm run migrate` · `npm run seed:admin` (pide usuario y contraseña por consola).
4. Entrar a Ajustes: nombre JEWA, moneda C$, horario, duración de cita y servicios.
5. Registrar el servicio para que arranque con Windows: **NSSM** (`nssm install JEWA "C:\Program Files\nodejs\node.exe" src\server.js`, directorio de trabajo `C:\JEWA\app`, reinicio automático) o, si no se usa NSSM, tarea del **Programador de tareas** "Al iniciar el sistema" con reintentos.
6. Probar desde la PC, una tablet y un teléfono.

## Respaldo (RNF-06, D-26, D-48)
- `npm run backup` crea una carpeta nueva `jewa-AAAAMMDD-HHMMSS` dentro de `BACKUP_DIR` con: `clinic.db` (copia consistente con `backup()` de `node:sqlite`, **se puede ejecutar con el sistema en uso**), `uploads/` (fotos y adjuntos) y `respaldo.json` (fecha, versión, tablas, tamaño, integridad).
- La copia se **verifica** (revisión de integridad de SQLite) antes de darse por buena; si algo falla, la carpeta se borra y el comando termina con un mensaje claro (por ejemplo, "¿Está conectada la unidad de respaldo?") y código de salida 1.
- Destino recomendado: una **unidad externa** (`BACKUP_DIR=E:/respaldos-jewa` en `.env`). Un solo disco en el mismo local no protege contra robo, incendio o falla de la PC: copia la carpeta de respaldos a otro lugar de vez en cuando.
- Alcance académico (D-41): **se ejecuta a mano** (sin tarea programada ni retención; se borran a mano los respaldos viejos).

## Restauración (probada en `test/respaldo.test.js`)
1. **Detener el sistema** (cerrar la ventana donde corre `npm start` o detener el servicio). En Windows, con el sistema encendido el archivo está en uso y el comando se detiene con un aviso.
2. `npm run restore` lista los respaldos disponibles.
3. `npm run restore -- <carpeta>` **solo explica** qué haría (no cambia nada).
4. `npm run restore -- <carpeta> --confirmar` restaura: primero comprueba que el respaldo esté sano (si está dañado, no toca nada) y guarda lo actual como `clinic.db.antes-de-restaurar-<fecha>` y `uploads.antes-de-restaurar-<fecha>`, de modo que una restauración equivocada se puede deshacer.
5. Iniciar el sistema y comprobar: inicio de sesión, un expediente y las ventas del día.

## Si la PC falla o se cambia
1. Instalar Node y el proyecto en la nueva PC (pasos de instalación).
2. Restaurar el último respaldo y `uploads/`.
3. Asignar la misma IP reservada o actualizar los marcadores de tablets y teléfonos.

## Actualización de la aplicación
1. Respaldo manual.
2. `git pull` · `npm ci` · `npm run migrate` (idempotente).
3. Reiniciar el servicio. Si falla, volver al commit anterior y restaurar el respaldo.
4. Hacerlo fuera del horario de atención.

## Monitoreo mínimo
- Ruta `/salud` (sin datos sensibles) responde 200 si la BD abre.
- Registro de errores en archivo con rotación.
- Banner de respaldo atrasado en Inicio.
- Espacio libre en disco visible en Ajustes (aviso por debajo del 10 %).

## Runbook (problemas frecuentes)
| Síntoma | Causa probable | Acción |
|---|---|---|
| Tablet o teléfono no abre la página | PC apagada, otra red Wi-Fi o IP cambió | Encender la PC; conectar al Wi-Fi de la clínica; revisar la IP reservada. |
| Funciona en la PC pero no en otros equipos | Firewall bloquea el puerto o perfil de red "Público" | Regla de entrada para el puerto 3000 en perfil Privado. |
| Windows se reinició y el sistema no responde | El servicio no arrancó | Revisar NSSM/tarea programada; iniciar el servicio. |
| "Base de datos bloqueada" | Dos procesos usando la BD | Dejar un solo servicio activo; revisar `busy_timeout`. |
| Usuario bloqueado | 5 intentos fallidos | Esperar 15 min o restablecer desde Usuarios. |
| Stock no coincide | Ajuste manual sin movimiento | Revisar kárdex; corregir con un ajuste con motivo. |
| Respaldo falló | Unidad externa desconectada o llena | Conectarla y ejecutar `npm run backup`. |
| Sin espacio en disco | `uploads/` o respaldos | Aplicar retención; mover respaldos. |
| Hora de citas corrida | Hora/zona de la PC mal configurada | Zona `America/Managua`; sincronizar hora de Windows. |
