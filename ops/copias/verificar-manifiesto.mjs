// Compares the manifest of the source database with the manifest of the
// restored copy. Exits with code 1 if anything differs, so the backup job fails.
// Usage: node verificar-manifiesto.mjs <source.json> <restored.json>

import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const compararManifiestos = (origen, restaurado) => {
  const diferencias = [];
  const tablas = new Set([...Object.keys(origen), ...Object.keys(restaurado)]);
  for (const tabla of [...tablas].sort()) {
    const a = origen[tabla];
    const b = restaurado[tabla];
    if (!a) diferencias.push(`${tabla}: only in the restored copy`);
    else if (!b) diferencias.push(`${tabla}: missing from the restored copy`);
    else if (a.filas !== b.filas) diferencias.push(`${tabla}: ${a.filas} rows in source, ${b.filas} restored`);
    else if (a.md5 !== b.md5) diferencias.push(`${tabla}: same row count but different content`);
  }
  return diferencias;
};

export const leerManifiesto = (ruta) => {
  const texto = fs.readFileSync(ruta, "utf8").trim();
  const ultimaLinea = texto.split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  const manifiesto = JSON.parse(ultimaLinea);
  if (!manifiesto || typeof manifiesto !== "object" || Object.keys(manifiesto).length === 0) {
    throw new Error(`Empty or invalid manifest: ${ruta}`);
  }
  return manifiesto;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [rutaOrigen, rutaRestaurado] = process.argv.slice(2);
  try {
    const origen = leerManifiesto(rutaOrigen);
    const restaurado = leerManifiesto(rutaRestaurado);
    const diferencias = compararManifiestos(origen, restaurado);
    const total = Object.values(origen).reduce((n, t) => n + Number(t.filas), 0);
    if (diferencias.length > 0) {
      console.error("::error::Backup verification FAILED:");
      diferencias.forEach((d) => console.error(`  - ${d}`));
      process.exit(1);
    }
    console.log(`Backup verified: ${Object.keys(origen).length} tables, ${total} rows, identical after restore.`);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
