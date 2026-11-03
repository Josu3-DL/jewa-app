'use strict';
// Respaldo: copia la base y los archivos subidos a una carpeta nueva dentro de BACKUP_DIR.
//   npm run backup
// Se puede ejecutar con el sistema en uso. Detalles en docs/07-despliegue-operacion.md.
const { loadConfig } = require('../src/config');
const { crearRespaldo, listarRespaldos, ErrorRespaldo } = require('../src/services/respaldo');

(async () => {
    const config = loadConfig();
    try {
        const r = await crearRespaldo({ dbPath: config.dbPath, uploadDir: config.uploadDir, backupDir: config.backupDir });
        console.log('Respaldo creado correctamente.');
        console.log(`  Carpeta:          ${r.carpeta}`);
        console.log(`  Base de datos:    ${(r.bytes_base / 1024).toFixed(0)} KB (revisión de integridad: ${r.integridad})`);
        console.log(`  Archivos subidos: ${r.archivos_subidos}`);
        console.log(`  Respaldos guardados en ${config.backupDir}: ${listarRespaldos(config.backupDir).length}`);
        console.log('Recuerda copiar la carpeta de respaldos a otra unidad o lugar: un solo disco no protege contra una falla de la PC.');
    } catch (error) {
        console.error(error instanceof ErrorRespaldo ? `ERROR: ${error.message}` : error);
        process.exit(1);
    }
})();
