// Cross-cutting HTTP middleware: security headers, same-origin check for
// state-changing requests, maintenance mode and loopback-only operations.

import { ErrorApi } from "./errores.js";

export const cabecerasSeguridad = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
  next();
};

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

// Blocks cross-site requests (CSRF): browsers always send Origin on
// state-changing fetches; it must match the host the app is served from.
export const mismoOrigen = (req, res, next) => {
  if (METODOS_SEGUROS.has(req.method)) return next();
  const origen = req.headers.origin;
  if (origen) {
    let hostOrigen;
    try {
      hostOrigen = new URL(origen).host;
    } catch {
      hostOrigen = null;
    }
    if (hostOrigen !== req.headers.host) return next(new ErrorApi(403, "Origen de la petición no permitido."));
  }
  if (req.headers["content-length"] && req.headers["content-length"] !== "0" && !req.is("application/json")) {
    return next(new ErrorApi(415, "Las peticiones deben enviarse en formato JSON.", { codigo: "tipo_no_soportado" }));
  }
  next();
};

export const modoMantenimiento = (bd) => (req, res, next) => {
  // baseUrl + path: inside a mounted router req.path excludes the mount prefix
  if (bd.enMantenimiento && `${req.baseUrl}${req.path}` !== "/api/salud") {
    return next(new ErrorApi(503, "La base de datos se está restaurando. Inténtalo en unos segundos."));
  }
  next();
};

const DIRECCIONES_LOCALES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export const esPeticionLocal = (req) => DIRECCIONES_LOCALES.has(req.socket?.remoteAddress);

// Sensitive operations (initial password, restore, backup destination) are only
// allowed from the PC itself, never from another device on the network.
export const soloDesdeEstePc = (req, res, next) => {
  if (!esPeticionLocal(req)) return next(new ErrorApi(403, "Esta operación solo se puede realizar desde el propio PC."));
  next();
};

export const leerCookies = (req) => {
  const cookies = {};
  for (const parte of (req.headers.cookie ?? "").split(";")) {
    const i = parte.indexOf("=");
    if (i > 0) cookies[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return cookies;
};
