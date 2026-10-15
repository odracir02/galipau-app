import { Router } from "express";
import { ErrorApi } from "../../http/errores.js";
import { esPeticionLocal, leerCookies, soloDesdeEstePc } from "../../http/middleware.js";
import { DURACION_SESION_MS } from "./servicio.js";

export const COOKIE_SESION = "galipau_sesion";

const fijarCookie = (res, token) =>
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_SESION}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(DURACION_SESION_MS / 1000)}`
  );

const borrarCookie = (res) => res.setHeader("Set-Cookie", `${COOKIE_SESION}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);

export const tokenDe = (req) => leerCookies(req)[COOKIE_SESION];

// Protects every private route: requires a valid session cookie
export const requiereSesion = (auth) => (req, res, next) => {
  if (!auth.validarSesion(tokenDe(req))) return next(new ErrorApi(401, "Inicia sesión para continuar."));
  next();
};

export const rutasAuth = ({ auth, config }) => {
  const r = Router();

  r.get("/estado", (req, res) => {
    res.json({
      configurado: auth.estaConfigurado(),
      autenticado: auth.validarSesion(tokenDe(req)),
      accesoLocal: esPeticionLocal(req),
      modo: config.modo,
    });
  });

  // First run: the password can only be created from the PC itself
  r.post("/configurar", soloDesdeEstePc, async (req, res) => {
    const { token } = await auth.configurar(req.body?.contrasena);
    fijarCookie(res, token);
    res.status(201).json({ ok: true });
  });

  r.post("/login", async (req, res) => {
    const { token } = await auth.iniciarSesion(req.body?.contrasena, req.socket.remoteAddress ?? "desconocido");
    fijarCookie(res, token);
    res.json({ ok: true });
  });

  r.post("/logout", (req, res) => {
    auth.cerrarSesion(tokenDe(req));
    borrarCookie(res);
    res.json({ ok: true });
  });

  r.post("/cambiar-contrasena", requiereSesion(auth), async (req, res) => {
    await auth.cambiarContrasena(req.body?.actual, req.body?.nueva, tokenDe(req));
    res.json({ ok: true });
  });

  return r;
};
