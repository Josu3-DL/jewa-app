'use strict';
// Restauración de un respaldo. DETÉN EL SISTEMA ANTES de ejecutarlo.
//   npm run restore                          → lista los respaldos disponibles
//   npm run restore -- <carpeta>             → explica qué haría (no cambia nada)
//   npm run restore -- <carpeta> --confirmar → restaura
// Antes de reemplazar, lo actual se guarda como "...antes-de-restaurar-<fecha>" para poder deshacer.
const path = require('node:path');
const { loadConfig } = require('../src/config');
const { restaurarRespaldo, listarRespaldos, ErrorRespaldo, verificarBase } = require('../src/services/respaldo');

(async () => {
    const config = loadConfig();
    const args = process.argv.slice(2);
    const confirmar = args.includes('--confirmar');
    const pedida = args.find((a) => !a.startsWith('--'));

    if (!pedida) {
        const lista = listarRespaldos(config.backupDir);
        console.log(`Respaldos en ${config.backupDir}:`);
        if (!lista.length) console.log('  (ninguno)');
        for (const r of lista) console.log(`  ${r.nombre}${r.creado_en ? `  (${r.creado_en}, ${r.archivos_subidos ?? '?'} archivos)` : ''}`);
        console.log('\nPara restaurar: npm run restore -- <nombre-de-la-carpeta> --confirmar');
        return;
    }
    // Acepta el nombre de la carpeta (dentro de BACKUP_DIR) o una ruta completa
    const carpeta = path.isAbsolute(pedida) ? pedida : path.join(config.backupDir, pedida);
    try {
        verificarBase(path.join(carpeta, 'clinic.db'));
        if (!confirmar) {
            console.log(`Se restauraría el respaldo "${carpeta}":`);
            console.log(`  - la base ${config.dbPath} se reemplazaría (la actual se guarda aparte);`);
            console.log(`  - la carpeta ${config.uploadDir} se reemplazaría (la actual se guarda aparte).`);
            console.log('Asegúrate de que el sistema esté detenido y vuelve a ejecutar agregando --confirmar.');
            process.exitCode = 1;
            return;
        }
        const r = await restaurarRespaldo({ carpeta, dbPath: config.dbPath, uploadDir: config.uploadDir });
        console.log('Restauración terminada.');
        console.log(`  Base restaurada: ${r.tablas} tablas. Archivos subidos: ${r.archivos_subidos}.`);
        if (r.base_anterior) console.log(`  Base anterior guardada en: ${r.base_anterior}`);
        if (r.uploads_anterior) console.log(`  Archivos anteriores guardados en: ${r.uploads_anterior}`);
        console.log('Inicia el sistema y comprueba: inicio de sesión, un expediente y las ventas del día.');
    } catch (error) {
        console.error(error instanceof ErrorRespaldo ? `ERROR: ${error.message}` : error);
        process.exit(1);
    }
})();
