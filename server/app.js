// Express application factory. Used by the production server (server/index.js),
// by the Vite development plugin and by the tests.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { cabecerasSeguridad, mismoOrigen, modoMantenimiento } from "./http/middleware.js";
import { crearManejadorErrores, manejadorNoEncontrado } from "./http/errores.js";
import { rutasAuth, requiereSesion } from "./modules/auth/rutas.js";
import { rutasClientes } from "./modules/clientes/rutas.js";
import { rutasCatalogo } from "./modules/catalogo/rutas.js";
import { rutasCopias } from "./modules/copias/rutas.js";

export const VERSION_API = 1;

/**
 * @param {{ config, bd, auth, copias, logger, servirWeb?: boolean }} contexto
 */
export const crearApp = ({ config, bd, auth, copias, logger, servirWeb = false }) => {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);

  app.use(cabecerasSeguridad);

  const api = express.Router();
  api.use(express.json({ limit: "1mb" }));
  api.use(mismoOrigen);
  api.use(modoMantenimiento(bd));

  // Public
  api.get("/salud", (req, res) => res.json({ ok: true, version: VERSION_API, mantenimiento: bd.enMantenimiento }));
  api.use("/auth", rutasAuth({ auth, config }));

  // Private: everything below requires a session
  api.use(requiereSesion(auth));
  api.use("/clientes", rutasClientes({ bd }));
  api.use("/catalogo", rutasCatalogo({ bd }));
  api.use("/copias", rutasCopias({ copias }));

  api.use(manejadorNoEncontrado);
  api.use(crearManejadorErrores(logger));
  app.use("/api", api);

  // Production: serve the built React app and fall back to index.html (SPA routes)
  if (servirWeb) {
    const indice = path.join(config.carpetaWeb, "index.html");
    app.use(express.static(config.carpetaWeb, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || !req.accepts("html")) return next();
      if (!fs.existsSync(indice)) return res.status(503).send("La interfaz no está compilada. Ejecuta: npm run build");
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(indice);
    });
  }

  return app;
};
