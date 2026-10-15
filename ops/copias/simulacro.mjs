// Restore drill, run on the OWNER'S computer (the only place where the private
// age key exists). Decrypts downloaded backups into a private temporary folder,
// restores the database into an isolated in-process PostgreSQL, verifies it
// against the manifest taken at backup time, verifies the Storage files
// against their checksums, and finally deletes every decrypted file.
// Nothing is written to Supabase or any real database.
//
// Requirements: Node 22+, the app dependencies (npm install) and `age`
// (Windows: winget install FiloSottile.age).
//
// Usage:
//   node ops/copias/simulacro.mjs --clave <key.txt> --base <db backup .age or .zip> [--archivos <files backup .age or .zip>]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compararManifiestos, leerManifiesto } from "./verificar-manifiesto.mjs";
import { restaurarConEsquema, restaurarSobreMigraciones, calcularManifiesto, comprobarIntegridad } from "./restauracion.mjs";
import { verificarCarpeta } from "./copiar-storage.mjs";
import { descifrar } from "./herramientas.mjs";

const argumento = (nombre) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const linea = (ok, texto) => console.log(`${ok ? "✔" : "✘"} ${texto}`);

const clave = argumento("clave");
const base = argumento("base");
const archivos = argumento("archivos");
if (!clave || !base) {
  console.log("Usage: node ops/copias/simulacro.mjs --clave <key.txt> --base <db backup> [--archivos <files backup>]");
  process.exit(1);
}

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), "galipau-simulacro-"));
let fallos = 0;
const comprobar = (ok, texto) => {
  if (!ok) fallos++;
  linea(ok, texto);
};

try {
  console.log("\n— Base de datos");
  const { salida, cifrado } = descifrar(base, clave, temporal, "base");
  comprobar(true, `Copia cifrada con age y descifrada con la clave del propietario (${path.basename(cifrado)})`);
  const esquema = fs.readFileSync(path.join(salida, "esquema.sql"), "utf8");
  const datos = fs.readFileSync(path.join(salida, "datos.sql"), "utf8");
  const manifiesto = leerManifiesto(path.join(salida, "manifiesto.json"));
  const info = JSON.parse(fs.readFileSync(path.join(salida, "info.json"), "utf8"));
  const filas = Object.values(manifiesto).reduce((n, t) => n + Number(t.filas), 0);
  console.log(`  Copia del ${info.creadaEn}: ${Object.keys(manifiesto).length} tablas, ${filas} filas (PostgreSQL ${info.versionServidor})`);

  const a = await restaurarConEsquema({ esquema, datos });
  const difA = compararManifiestos(manifiesto, await calcularManifiesto(a));
  comprobar(difA.length === 0, `Restauración A (estructura de la copia): ${difA.length === 0 ? "datos idénticos al origen" : difA.join("; ")}`);
  const integridad = await comprobarIntegridad(a);
  comprobar(integridad.tablasSinRls.length === 0, `Seguridad por filas activa en todas las tablas${integridad.tablasSinRls.length ? ` (faltan: ${integridad.tablasSinRls.join(", ")})` : ""}`);
  comprobar(Object.values(integridad.huerfanos).every((n) => n === 0), `Relaciones íntegras ${JSON.stringify(integridad.huerfanos)}`);
  comprobar(integridad.restriccionesActivas, `Restricciones activas (${integridad.restriccionesValidadas} validadas; un importe negativo es rechazado)`);
  console.log(`  Importes: coste de variantes ${integridad.importes.costeVariantesCent / 100} €, total presupuestos ${integridad.importes.totalPresupuestosCent / 100} €`);
  await a.close();

  const b = await restaurarSobreMigraciones({ datos });
  const difB = compararManifiestos(manifiesto, await calcularManifiesto(b));
  comprobar(difB.length === 0, `Restauración B (migraciones actuales + datos, vía de emergencia): ${difB.length === 0 ? "datos idénticos al origen" : difB.join("; ")}`);
  await b.close();

  if (archivos) {
    console.log("\n— Archivos (Storage)");
    const { salida: carpetaArchivos } = descifrar(archivos, clave, temporal, "archivos");
    const { manifiesto: m, errores } = verificarCarpeta(carpetaArchivos);
    comprobar(errores.length === 0, `${m.total} archivos recuperados (${m.bytes} bytes), sumas SHA-256 ${errores.length ? `con errores: ${errores.join("; ")}` : "correctas"}`);
  }
} catch (error) {
  comprobar(false, error.message);
} finally {
  fs.rmSync(temporal, { recursive: true, force: true });
  linea(!fs.existsSync(temporal), "Archivos descifrados eliminados del equipo");
}

console.log(fallos === 0 ? "\nSIMULACRO SUPERADO: la copia se puede recuperar." : `\nSIMULACRO FALLIDO (${fallos} comprobaciones).`);
process.exit(fallos === 0 ? 0 : 1);
