// Emergency helper, run on the OWNER'S computer: decrypts a downloaded backup
// (.age file or the .zip GitHub gives you) into a folder you choose, so its
// files can be used for a restore. Delete that folder when you are done: it
// contains your data unencrypted.
//
// Usage:
//   node ops/copias/descifrar.mjs --clave <key.txt> --copia <backup .age or .zip> --destino <new folder>

import fs from "node:fs";
import path from "node:path";
import { descifrar } from "./herramientas.mjs";

const argumento = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const clave = argumento("clave");
const copia = argumento("copia");
const destino = argumento("destino");
if (!clave || !copia || !destino) {
  console.log("Usage: node ops/copias/descifrar.mjs --clave <key.txt> --copia <backup> --destino <new folder>");
  process.exit(1);
}
if (fs.existsSync(destino) && fs.readdirSync(destino).length > 0) {
  console.error(`The destination folder must be new or empty: ${destino}`);
  process.exit(1);
}
fs.mkdirSync(destino, { recursive: true });
try {
  const { salida } = descifrar(copia, clave, destino, "copia");
  console.log(`Decrypted into ${salida}:`);
  for (const f of fs.readdirSync(salida)) console.log(`  ${f}`);
  console.log("Remember to delete this folder when you no longer need it.");
} catch (error) {
  console.error(`Could not decrypt: ${error.message}`);
  for (const f of fs.readdirSync(destino)) fs.rmSync(path.join(destino, f), { recursive: true, force: true });
  process.exit(1);
}
