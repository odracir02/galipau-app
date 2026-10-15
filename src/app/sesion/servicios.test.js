// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { crearSesionSupabase, MENSAJE_SIN_ACCESO } from "./servicios";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";

const PROPIETARIO = { id: "uid-propietario", email: "propietario@example.com", password: "clave-buena" };
const OTRO = { id: "uid-otro", email: "otro@example.com", password: "otra-clave" };

const crear = (opciones = {}) => {
  const cliente = crearClienteFalso({ usuarios: [PROPIETARIO, OTRO], propietario: PROPIETARIO.id, ...opciones });
  return { cliente, servicio: crearSesionSupabase(async () => cliente) };
};

describe("sesión con Supabase", () => {
  it("sin sesión: no autenticado", async () => {
    const { servicio } = crear();
    expect(await servicio.estado()).toEqual({ configurado: true, autenticado: false });
  });

  it("el propietario inicia sesión y queda autenticado", async () => {
    const { servicio } = crear();
    await servicio.iniciarSesion({ email: ` ${PROPIETARIO.email} `, contrasena: PROPIETARIO.password });
    expect(await servicio.estado()).toEqual({ configurado: true, autenticado: true, email: PROPIETARIO.email });
  });

  it("otra cuenta válida es expulsada (cierre de sesión) aunque la contraseña sea correcta", async () => {
    const { servicio, cliente } = crear();
    await servicio.iniciarSesion({ email: OTRO.email, contrasena: OTRO.password });
    expect(await servicio.estado()).toEqual({ configurado: true, autenticado: false, aviso: MENSAJE_SIN_ACCESO });
    expect(cliente.sesion).toBeNull();
  });

  it("credenciales incorrectas y límite de intentos", async () => {
    const { servicio } = crear();
    await expect(servicio.iniciarSesion({ email: PROPIETARIO.email, contrasena: "mala" })).rejects.toMatchObject({ estado: 401, message: "Email o contraseña incorrectos." });
    const limitado = crear({ fallos: { login: { status: 429, message: "rate limit" } } }).servicio;
    await expect(limitado.iniciarSesion({ email: "x", contrasena: "y" })).rejects.toMatchObject({ estado: 429 });
  });

  it("si Supabase no responde (p. ej. proyecto en pausa) da un mensaje claro", async () => {
    const { servicio } = crear({ sesionInicial: { user: PROPIETARIO }, fallos: { rpc: { name: "TypeError", message: "Failed to fetch" } } });
    await expect(servicio.estado()).rejects.toMatchObject({ message: expect.stringMatching(/pausa/) });
  });

  it("cerrar sesión y aviso de cambios de sesión", async () => {
    const { servicio, cliente } = crear({ sesionInicial: { user: PROPIETARIO } });
    const cb = vi.fn();
    const quitar = servicio.suscribir(cb);
    await new Promise((r) => setTimeout(r, 0));
    await servicio.cerrarSesion();
    expect(cliente.sesion).toBeNull();
    expect(cb).toHaveBeenCalled();
    quitar();
  });

  it("no permite crear la contraseña desde la app", async () => {
    const { servicio } = crear();
    await expect(servicio.configurar("x")).rejects.toMatchObject({ estado: 400 });
  });
});
