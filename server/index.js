// Production entry point: `npm start` (after `npm run build`).
// Listens on 127.0.0.1 by default; set GALIPAU_HOST=0.0.0.0 to allow other
// devices on the local network (Windows firewall: private networks only).

import os from "node:os";
import { cargarConfig, esAccesoRed } from "./config.js";
import { iniciarServicios, crearLogger } from "./arranque.js";

const logger = crearLogger();
const config = cargarConfig(process.env, { modo: process.env.NODE_ENV === "development" ? "desarrollo" : "produccion" });

const direccionesRed = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);

let servicios;
try {
  servicios = await iniciarServicios(config, { logger, servirWeb: true });
} catch (error) {
  logger.error("Galipau App could not start:", error.message);
  process.exit(1);
}

const servidor = servicios.app.listen(config.puerto, config.host);

servidor.on("listening", () => {
  logger.info(`Galipau App running at http://localhost:${config.puerto}`);
  logger.info(`Data folder: ${config.carpetaDatos}`);
  logger.info(`Backups folder: ${config.carpetaCopias}`);
  if (esAccesoRed(config)) {
    logger.warn("Local network access is ENABLED. Other devices can reach the app at:");
    direccionesRed().forEach((ip) => logger.warn(`  http://${ip}:${config.puerto}`));
  }
});

servidor.on("error", async (error) => {
  if (error.code === "EADDRINUSE") {
    logger.error(`Port ${config.puerto} is already in use. Is Galipau App already running? Open http://localhost:${config.puerto}`);
  } else {
    logger.error("Server error:", error.message);
  }
  await servicios.cerrar();
  process.exit(1);
});

let cerrando = false;
const apagar = async (senal) => {
  if (cerrando) return;
  cerrando = true;
  logger.info(`Shutting down (${senal})…`);
  const forzar = setTimeout(() => process.exit(1), 10_000).unref();
  servidor.close();
  servidor.closeAllConnections?.();
  await servicios.cerrar();
  clearTimeout(forzar);
  logger.info("Database closed. Bye.");
  process.exit(0);
};

for (const senal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(senal, () => apagar(senal));
