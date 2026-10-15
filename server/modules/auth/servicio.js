// Single-owner authentication: one password, server-side sessions and
// brute-force protection. No users or roles by design.

import { randomBytes, createHash } from "node:crypto";
import { ErrorApi } from "../../http/errores.js";
import { hashContrasena, verificarContrasena, necesitaActualizar, MIN_LONGITUD, MAX_LONGITUD } from "./contrasena.js";

export const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000;
export const INTENTOS_LIBRES = 5;
const BLOQUEO_INICIAL_MS = 30 * 1000;
const BLOQUEO_MAXIMO_MS = 15 * 60 * 1000;

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

export const validarNuevaContrasena = (contrasena) => {
  if (typeof contrasena !== "string" || contrasena.length < MIN_LONGITUD) {
    throw new ErrorApi(400, `La contraseña debe tener al menos ${MIN_LONGITUD} caracteres.`, { campo: "contrasena" });
  }
  if (contrasena.length > MAX_LONGITUD) {
    throw new ErrorApi(400, `La contraseña no puede superar ${MAX_LONGITUD} caracteres.`, { campo: "contrasena" });
  }
};

export const crearServicioAuth = (bd, { ahora = () => Date.now() } = {}) => {
  // Failed attempts per client address (in memory: resets on restart)
  const intentos = new Map();

  const iso = (ms) => new Date(ms).toISOString();
  const db = () => bd.conexion;
  const hashGuardado = () => db().prepare("select hash_contrasena from propietario where id = 1").get()?.hash_contrasena;

  const comprobarBloqueo = (clave) => {
    const registro = intentos.get(clave);
    if (registro?.bloqueadoHasta > ahora()) {
      const segundos = Math.ceil((registro.bloqueadoHasta - ahora()) / 1000);
      throw new ErrorApi(429, `Demasiados intentos fallidos. Espera ${segundos} s antes de volver a intentarlo.`);
    }
  };

  const registrarFallo = (clave) => {
    const registro = intentos.get(clave) ?? { fallos: 0, bloqueadoHasta: 0 };
    registro.fallos += 1;
    if (registro.fallos >= INTENTOS_LIBRES) {
      const exceso = registro.fallos - INTENTOS_LIBRES;
      registro.bloqueadoHasta = ahora() + Math.min(BLOQUEO_INICIAL_MS * 2 ** exceso, BLOQUEO_MAXIMO_MS);
    }
    intentos.set(clave, registro);
  };

  const crearSesion = () => {
    const token = randomBytes(32).toString("base64url");
    const t = ahora();
    db().prepare("delete from sesiones where caduca_en <= ?").run(iso(t));
    db()
      .prepare("insert into sesiones (token_hash, creada_en, caduca_en, ultimo_uso) values (?, ?, ?, ?)")
      .run(hashToken(token), iso(t), iso(t + DURACION_SESION_MS), iso(t));
    return { token, caducaEn: iso(t + DURACION_SESION_MS) };
  };

  return {
    estaConfigurado: () => Boolean(hashGuardado()),

    async configurar(contrasena) {
      validarNuevaContrasena(contrasena);
      const hash = await hashContrasena(contrasena);
      // The insert fails if a password already exists (single row with id = 1)
      const resultado = db()
        .prepare("insert into propietario (id, hash_contrasena, actualizado_en) values (1, ?, ?) on conflict (id) do nothing")
        .run(hash, iso(ahora()));
      if (resultado.changes === 0) throw new ErrorApi(409, "La contraseña ya está configurada.");
      return crearSesion();
    },

    async iniciarSesion(contrasena, claveCliente) {
      comprobarBloqueo(claveCliente);
      const hash = hashGuardado();
      if (!hash) throw new ErrorApi(409, "Todavía no se ha configurado la contraseña.", { codigo: "sin_configurar" });
      const valida = typeof contrasena === "string" && contrasena.length <= MAX_LONGITUD && (await verificarContrasena(contrasena, hash));
      if (!valida) {
        registrarFallo(claveCliente);
        comprobarBloqueo(claveCliente);
        throw new ErrorApi(401, "Contraseña incorrecta.", { codigo: "credenciales_invalidas" });
      }
      intentos.delete(claveCliente);
      if (necesitaActualizar(hash)) {
        db().prepare("update propietario set hash_contrasena = ?, actualizado_en = ? where id = 1").run(await hashContrasena(contrasena), iso(ahora()));
      }
      return crearSesion();
    },

    validarSesion(token) {
      if (typeof token !== "string" || token.length === 0) return false;
      const t = ahora();
      const fila = db().prepare("select caduca_en from sesiones where token_hash = ?").get(hashToken(token));
      if (!fila || fila.caduca_en <= iso(t)) return false;
      db().prepare("update sesiones set ultimo_uso = ? where token_hash = ?").run(iso(t), hashToken(token));
      return true;
    },

    cerrarSesion(token) {
      if (typeof token === "string") db().prepare("delete from sesiones where token_hash = ?").run(hashToken(token));
    },

    // Changing the password closes every other session
    async cambiarContrasena(actual, nueva, tokenActual) {
      const hash = hashGuardado();
      if (!hash || !(await verificarContrasena(String(actual ?? ""), hash))) {
        throw new ErrorApi(400, "La contraseña actual no es correcta.", { campo: "actual" });
      }
      validarNuevaContrasena(nueva);
      const nuevoHash = await hashContrasena(nueva);
      bd.transaccion(() => {
        db().prepare("update propietario set hash_contrasena = ?, actualizado_en = ? where id = 1").run(nuevoHash, iso(ahora()));
        db().prepare("delete from sesiones where token_hash <> ?").run(hashToken(String(tokenActual ?? "")));
      });
    },

    // Used by the local reset script when the password has been forgotten
    restablecer() {
      bd.transaccion(() => {
        db().prepare("delete from propietario").run();
        db().prepare("delete from sesiones").run();
      });
    },
  };
};
