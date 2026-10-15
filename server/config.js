// Runtime configuration, read from environment variables (optionally from a
// local, git-ignored .env file loaded with `node --env-file-if-exists`).

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ_PROYECTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const HOST_LOCAL = "127.0.0.1";

// Default data folder for real use: %LOCALAPPDATA%\GalipauApp on Windows.
// It must never be inside a synced folder (OneDrive) or the repository.
export const carpetaDatosPorDefecto = (entorno = process.env) => {
  if (entorno.LOCALAPPDATA) return path.join(entorno.LOCALAPPDATA, "GalipauApp");
  return path.join(os.homedir(), ".local", "share", "GalipauApp");
};

const entero = (valor, porDefecto, nombre) => {
  if (valor === undefined || valor === "") return porDefecto;
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid value for ${nombre}: ${valor}`);
  return n;
};

export const cargarConfig = (entorno = process.env, opciones = {}) => {
  const modo = opciones.modo ?? (entorno.NODE_ENV === "production" ? "produccion" : "desarrollo");
  const enProduccion = modo === "produccion";

  const carpetaDatos = path.resolve(
    entorno.GALIPAU_DATA_DIR ||
      (enProduccion ? carpetaDatosPorDefecto(entorno) : path.join(RAIZ_PROYECTO, "data", "dev"))
  );

  return Object.freeze({
    modo,
    enProduccion,
    host: entorno.GALIPAU_HOST || HOST_LOCAL,
    puerto: entero(entorno.GALIPAU_PORT, 4173, "GALIPAU_PORT"),
    carpetaDatos,
    rutaBaseDatos: path.join(carpetaDatos, "galipau.db"),
    carpetaCopias: path.resolve(entorno.GALIPAU_BACKUP_DIR || path.join(carpetaDatos, "copias")),
    // Hours between automatic backups
    horasEntreCopias: entero(entorno.GALIPAU_BACKUP_HOURS, 24, "GALIPAU_BACKUP_HOURS"),
    carpetaWeb: path.join(RAIZ_PROYECTO, "dist"),
    // Suggested off-site destination when OneDrive is installed (never assumed)
    oneDriveDetectado: entorno.OneDrive || entorno.OneDriveConsumer || null,
  });
};

export const esAccesoRed = (config) => config.host !== HOST_LOCAL && config.host !== "localhost";
