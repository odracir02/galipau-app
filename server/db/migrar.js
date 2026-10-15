// Versioned SQL migrations. Files are named NNNN_description.sql and applied in
// order; the schema version is stored in PRAGMA user_version. Each migration
// runs in its own transaction: if it fails, nothing from it is applied.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CARPETA_MIGRACIONES = path.join(path.dirname(fileURLToPath(import.meta.url)), "migraciones");

const PATRON = /^(\d{4})_[a-z0-9_]+\.sql$/;

export const listarMigraciones = (carpeta = CARPETA_MIGRACIONES) => {
  const migraciones = fs
    .readdirSync(carpeta)
    .filter((f) => PATRON.test(f))
    .sort()
    .map((archivo) => ({ version: Number(PATRON.exec(archivo)[1]), archivo, ruta: path.join(carpeta, archivo) }));

  migraciones.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migration numbering gap or duplicate at ${m.archivo}`);
  });
  return migraciones;
};

export const ultimaVersion = (carpeta = CARPETA_MIGRACIONES) => listarMigraciones(carpeta).length;

/**
 * Applies pending migrations.
 * @param {import("./baseDatos.js").BaseDatos} bd
 * @param {{ carpeta?: string, antesDeMigrar?: (pendientes) => Promise<void> | void, logger?: Console }} opciones
 */
export const migrar = async (bd, { carpeta, antesDeMigrar, logger } = {}) => {
  const migraciones = listarMigraciones(carpeta ?? CARPETA_MIGRACIONES);
  const actual = bd.versionEsquema();

  if (actual > migraciones.length) {
    throw new Error(
      `The database schema (v${actual}) is newer than this version of the application (v${migraciones.length}). ` +
        "Update the application before opening this database."
    );
  }

  const pendientes = migraciones.filter((m) => m.version > actual);
  if (pendientes.length === 0) return { desde: actual, hasta: actual, aplicadas: [] };

  // Back up existing data before changing the schema
  if (actual > 0 && antesDeMigrar) await antesDeMigrar(pendientes);

  const db = bd.conexion;
  for (const m of pendientes) {
    const sql = fs.readFileSync(m.ruta, "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${m.version}`);
    })();
    logger?.info?.(`Migration applied: ${m.archivo}`);
  }

  const problemas = db.pragma("foreign_key_check");
  if (problemas.length > 0) throw new Error(`Foreign key violations after migrating: ${JSON.stringify(problemas)}`);

  return { desde: actual, hasta: migraciones.length, aplicadas: pendientes.map((m) => m.archivo) };
};
