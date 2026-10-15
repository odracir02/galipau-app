// Test helpers: isolated temporary data folders and a running HTTP server.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cargarConfig } from "../config.js";
import { iniciarServicios, crearLogger } from "../arranque.js";

export const carpetaTemporal = () => fs.mkdtempSync(path.join(os.tmpdir(), "galipau-test-"));

export const configPrueba = (carpeta = carpetaTemporal(), extra = {}) =>
  cargarConfig({ GALIPAU_DATA_DIR: carpeta, GALIPAU_PORT: "4999", ...extra }, { modo: "desarrollo" });

export const levantarServidor = async ({ config = configPrueba(), programarCopias = false } = {}) => {
  const servicios = await iniciarServicios(config, { logger: crearLogger({ silencioso: true }), programarCopias });
  const servidor = servicios.app.listen(0, "127.0.0.1");
  await new Promise((r) => servidor.once("listening", r));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let cookie = null;

  const pedir = async (ruta, { metodo = "GET", cuerpo, cabeceras = {}, sinCookie = false } = {}) => {
    const respuesta = await fetch(base + ruta, {
      method: metodo,
      headers: {
        ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie && !sinCookie ? { cookie } : {}),
        ...cabeceras,
      },
      body: cuerpo === undefined ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    });
    const setCookie = respuesta.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const texto = await respuesta.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { estado: respuesta.status, json, cabeceras: respuesta.headers, texto };
  };

  const iniciarSesion = async (contrasena = "contraseña-de-prueba") => {
    if (!servicios.auth.estaConfigurado()) await pedir("/api/auth/configurar", { metodo: "POST", cuerpo: { contrasena } });
    else await pedir("/api/auth/login", { metodo: "POST", cuerpo: { contrasena } });
  };

  let detenido = false;
  const cerrarSinBorrar = async () => {
    if (detenido) return;
    detenido = true;
    await new Promise((r) => servidor.close(r));
    await servicios.cerrar();
  };
  const cerrar = async () => {
    await cerrarSinBorrar();
    fs.rmSync(config.carpetaDatos, { recursive: true, force: true });
  };

  return { ...servicios, config, base, pedir, iniciarSesion, cerrar, cerrarSinBorrar, olvidarCookie: () => (cookie = null) };
};
