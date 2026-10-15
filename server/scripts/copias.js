// Backup maintenance from the command line, with the app STOPPED
// (e.g. when the database cannot be opened by the app).
// Usage:
//   npm run copias -- listar
//   npm run copias -- crear
//   npm run copias -- verificar <file>
//   npm run copias -- restaurar <file>
// Add --dev to use the development database.

import { cargarConfig } from "../config.js";
import { iniciarServicios, crearLogger } from "../arranque.js";
import { verificarArchivo } from "../modules/copias/servicio.js";

const argumentos = process.argv.slice(2).filter((a) => a !== "--dev");
const [orden, archivo] = argumentos;
const config = cargarConfig(process.env, { modo: process.argv.includes("--dev") ? "desarrollo" : "produccion" });
const logger = crearLogger();

const servicios = await iniciarServicios(config, { logger, programarCopias: false });
try {
  switch (orden) {
    case "listar":
      console.log(`Backups in ${servicios.copias.carpetaLocal}:`);
      for (const c of servicios.copias.listar()) console.log(`  ${c.archivo}  ${(c.tamanoBytes / 1024).toFixed(0)} KB`);
      break;
    case "crear":
      console.log(await servicios.copias.crear("manual"));
      break;
    case "verificar":
      console.log(verificarArchivo(servicios.copias.rutaDe(archivo)));
      break;
    case "restaurar":
      console.log(await servicios.copias.restaurar(archivo));
      break;
    default:
      console.log("Usage: npm run copias -- listar | crear | verificar <file> | restaurar <file> [--dev]");
      process.exitCode = 1;
  }
} catch (error) {
  logger.error(error.message);
  process.exitCode = 1;
} finally {
  await servicios.cerrar();
}
