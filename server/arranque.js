// Composition root: opens the database, migrates (backing up first), wires the
// services and returns the Express app plus a controlled shutdown function.

import fs from "node:fs";
import { BaseDatos } from "./db/baseDatos.js";
import { migrar } from "./db/migrar.js";
import { crearServicioAuth } from "./modules/auth/servicio.js";
import { crearServicioCopias } from "./modules/copias/servicio.js";
import { crearApp } from "./app.js";

export const crearLogger = ({ silencioso = false } = {}) => {
  const sello = () => new Date().toISOString();
  const nada = () => {};
  return {
    info: silencioso ? nada : (...a) => console.log(sello(), "[info]", ...a),
    warn: silencioso ? nada : (...a) => console.warn(sello(), "[warn]", ...a),
    error: (...a) => console.error(sello(), "[error]", ...a),
  };
};

/**
 * @param {ReturnType<import("./config.js").cargarConfig>} config
 * @param {{ logger?, servirWeb?: boolean, programarCopias?: boolean, carpetaMigraciones?: string }} opciones
 */
export const iniciarServicios = async (
  config,
  { logger = crearLogger(), servirWeb = false, programarCopias = true, carpetaMigraciones } = {}
) => {
  fs.mkdirSync(config.carpetaDatos, { recursive: true });
  const bd = new BaseDatos(config.rutaBaseDatos);
  bd.abrir();

  const copias = crearServicioCopias({ bd, config, logger });
  try {
    const resultado = await migrar(bd, { carpeta: carpetaMigraciones, logger, antesDeMigrar: () => copias.crear("migracion") });
    if (resultado.aplicadas.length) logger.info(`Database schema: v${resultado.desde} → v${resultado.hasta}`);
  } catch (error) {
    bd.cerrar();
    throw error;
  }

  const auth = crearServicioAuth(bd);
  const app = crearApp({ config, bd, auth, copias, logger, servirWeb });
  if (programarCopias) copias.programar();

  let cerrado = false;
  const cerrar = async () => {
    if (cerrado) return;
    cerrado = true;
    copias.detener();
    await copias.esperar().catch(() => {});
    bd.cerrar();
  };

  return { app, bd, auth, copias, cerrar };
};
