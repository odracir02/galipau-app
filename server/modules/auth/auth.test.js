import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BaseDatos } from "../../db/baseDatos.js";
import { migrar } from "../../db/migrar.js";
import { hashContrasena, verificarContrasena, necesitaActualizar } from "./contrasena.js";
import { crearServicioAuth, DURACION_SESION_MS, INTENTOS_LIBRES } from "./servicio.js";

describe("hash de contraseñas (scrypt)", () => {
  it("no guarda la contraseña y verifica correctamente", async () => {
    const hash = await hashContrasena("Serigrafía 2026!");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain("Serigrafía");
    expect(await verificarContrasena("Serigrafía 2026!", hash)).toBe(true);
    expect(await verificarContrasena("serigrafía 2026!", hash)).toBe(false);
  });

  it("usa sal aleatoria: dos hashes de la misma contraseña son distintos", async () => {
    expect(await hashContrasena("igual-igual")).not.toBe(await hashContrasena("igual-igual"));
  });

  it("rechaza formatos desconocidos y detecta parámetros antiguos", async () => {
    expect(await verificarContrasena("x", "texto-plano")).toBe(false);
    expect(await verificarContrasena("x", null)).toBe(false);
    expect(necesitaActualizar("scrypt$16384$8$1$a$b")).toBe(true);
    expect(necesitaActualizar(await hashContrasena("abcdefgh"))).toBe(false);
  });
});

describe("servicio de autenticación", () => {
  let bd, auth, reloj;
  const avanzar = (ms) => (reloj += ms);

  beforeEach(async () => {
    bd = new BaseDatos(":memory:");
    bd.abrir();
    await migrar(bd);
    reloj = Date.parse("2026-10-15T10:00:00Z");
    auth = crearServicioAuth(bd, { ahora: () => reloj });
  });
  afterEach(() => bd.cerrar());

  it("se configura una sola vez y devuelve una sesión válida", async () => {
    expect(auth.estaConfigurado()).toBe(false);
    const { token } = await auth.configurar("primera-clave");
    expect(auth.estaConfigurado()).toBe(true);
    expect(auth.validarSesion(token)).toBe(true);
    await expect(auth.configurar("otra-clave-x")).rejects.toMatchObject({ estado: 409 });
  });

  it("exige una longitud mínima", async () => {
    await expect(auth.configurar("corta")).rejects.toMatchObject({ estado: 400, campo: "contrasena" });
  });

  it("el token solo se guarda como hash", async () => {
    const { token } = await auth.configurar("primera-clave");
    const filas = bd.conexion.prepare("select token_hash from sesiones").all();
    expect(filas).toHaveLength(1);
    expect(filas[0].token_hash).not.toBe(token);
    expect(filas[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("inicia sesión con la contraseña correcta y rechaza la incorrecta", async () => {
    await auth.configurar("primera-clave");
    await expect(auth.iniciarSesion("mala", "ip1")).rejects.toMatchObject({ estado: 401 });
    const { token } = await auth.iniciarSesion("primera-clave", "ip1");
    expect(auth.validarSesion(token)).toBe(true);
  });

  it("bloquea tras varios fallos, con espera creciente, y desbloquea con el tiempo", async () => {
    await auth.configurar("primera-clave");
    for (let i = 1; i < INTENTOS_LIBRES; i++) await expect(auth.iniciarSesion("mala", "ip1")).rejects.toMatchObject({ estado: 401 });
    await expect(auth.iniciarSesion("mala", "ip1")).rejects.toMatchObject({ estado: 429 });
    // even the right password is refused while locked
    await expect(auth.iniciarSesion("primera-clave", "ip1")).rejects.toMatchObject({ estado: 429 });
    // another address is not affected
    await expect(auth.iniciarSesion("primera-clave", "ip2")).resolves.toHaveProperty("token");
    avanzar(31_000);
    await expect(auth.iniciarSesion("mala", "ip1")).rejects.toMatchObject({ estado: 429 }); // 2nd lock: 60 s
    avanzar(61_000);
    await expect(auth.iniciarSesion("primera-clave", "ip1")).resolves.toHaveProperty("token");
  });

  it("las sesiones caducan y se pueden cerrar", async () => {
    const { token } = await auth.configurar("primera-clave");
    auth.cerrarSesion(token);
    expect(auth.validarSesion(token)).toBe(false);
    const nueva = await auth.iniciarSesion("primera-clave", "ip");
    avanzar(DURACION_SESION_MS + 1);
    expect(auth.validarSesion(nueva.token)).toBe(false);
    expect(auth.validarSesion("")).toBe(false);
    expect(auth.validarSesion(undefined)).toBe(false);
  });

  it("cambiar la contraseña cierra las demás sesiones", async () => {
    const actual = await auth.configurar("primera-clave");
    const otra = await auth.iniciarSesion("primera-clave", "movil");
    await expect(auth.cambiarContrasena("mala", "nueva-clave-1", actual.token)).rejects.toMatchObject({ estado: 400 });
    await auth.cambiarContrasena("primera-clave", "nueva-clave-1", actual.token);
    expect(auth.validarSesion(actual.token)).toBe(true);
    expect(auth.validarSesion(otra.token)).toBe(false);
    await expect(auth.iniciarSesion("primera-clave", "x")).rejects.toMatchObject({ estado: 401 });
    await expect(auth.iniciarSesion("nueva-clave-1", "x")).resolves.toHaveProperty("token");
  });

  it("restablecer elimina contraseña y sesiones", async () => {
    const { token } = await auth.configurar("primera-clave");
    auth.restablecer();
    expect(auth.estaConfigurado()).toBe(false);
    expect(auth.validarSesion(token)).toBe(false);
  });
});
