// Forgotten password: removes the stored password and all sessions so a new
// one can be created from this PC on the next visit. Requires access to the PC.
// Business data is not touched. Stop the app before running it.
// Usage: npm run contrasena:restablecer  (add --dev for the development database)

import readline from "node:readline/promises";
import { cargarConfig } from "../config.js";
import { iniciarServicios, crearLogger } from "../arranque.js";

const config = cargarConfig(process.env, { modo: process.argv.includes("--dev") ? "desarrollo" : "produccion" });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const respuesta = await rl.question(`Reset the Galipau App password for ${config.rutaBaseDatos}? Type YES to continue: `);
rl.close();
if (respuesta.trim() !== "YES") {
  console.log("Cancelled.");
  process.exit(0);
}

const servicios = await iniciarServicios(config, { logger: crearLogger(), programarCopias: false });
servicios.auth.restablecer();
await servicios.cerrar();
console.log("Password removed. Open Galipau App on this PC to create a new one.");
