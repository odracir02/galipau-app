// Builds one SQL file with the database migrations, to paste into the
// Supabase SQL Editor in a single run (all or nothing: one transaction).
//
//   node ops/produccion/generar-instalacion.mjs                         all migrations (new project)
//   node ops/produccion/generar-instalacion.mjs --desde 20261017090000   only from that one (existing project)
//
// The file is written to privado/ (git-ignored). It contains only the schema
// from supabase/migrations: no data and no secrets.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRACIONES = path.join(RAIZ, "supabase", "migrations");

export const listar = (carpeta = MIGRACIONES) =>
  fs.readdirSync(carpeta).filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort();

export const generarInstalacion = ({ desde = null, hasta = null, carpeta = MIGRACIONES } = {}) => {
  const archivos = listar(carpeta).filter((f) => (!desde || f.slice(0, 14) >= desde) && (!hasta || f.slice(0, 14) <= hasta));
  if (archivos.length === 0) throw new Error(desde ? `No hay migraciones desde ${desde}.` : "No hay migraciones.");
  const partes = archivos.map((f) => `-- ===== ${f} =====\n${fs.readFileSync(path.join(carpeta, f), "utf8").trim()}\n`);
  return {
    archivos,
    sql: `-- Galipau App: database migrations (${archivos.length}). Generated file, do not edit.\n-- Runs in one transaction: if anything fails, nothing is applied.\nbegin;\n\n${partes.join("\n")}\ncommit;\n`,
  };
};

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const i = process.argv.indexOf("--desde");
  const desde = i > 0 ? process.argv[i + 1] : null;
  if (desde !== null && !/^\d{14}$/.test(desde ?? "")) {
    console.error("Uso: --desde AAAAMMDDhhmmss (14 cifras, el prefijo de la migración).");
    process.exit(1);
  }
  const { archivos, sql } = generarInstalacion({ desde });
  const destino = path.join(RAIZ, "privado", desde ? `migraciones-desde-${desde}.sql` : "instalacion-completa.sql");
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, sql, "utf8");
  console.log(`Migraciones incluidas:\n${archivos.map((a) => `  - ${a}`).join("\n")}\nArchivo: ${destino}`);
}
