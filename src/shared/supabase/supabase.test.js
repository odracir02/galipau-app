import { describe, it, expect } from "vitest";
import { leerConfigSupabase, esClaveSecreta, ErrorConfiguracion } from "./config";
import { traducirErrorSupabase } from "./errores";
import { leerTodo } from "./paginar";

const jwt = (carga) => `xxx.${btoa(JSON.stringify(carga)).replace(/=+$/, "")}.firma`;

describe("configuración de Supabase", () => {
  const URL_OK = "https://abcdefgh.supabase.co";

  it("acepta la URL HTTPS y la clave pública (publishable o anon)", () => {
    expect(leerConfigSupabase({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_123" })).toEqual({ url: URL_OK, clave: "sb_publishable_123" });
    const anon = jwt({ role: "anon", ref: "abcdefgh" });
    expect(leerConfigSupabase({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: anon }).clave).toBe(anon);
  });

  it("rechaza claves secretas en la interfaz", () => {
    expect(esClaveSecreta("sb_secret_abc")).toBe(true);
    expect(esClaveSecreta(jwt({ role: "service_role" }))).toBe(true);
    expect(esClaveSecreta(jwt({ role: "anon" }))).toBe(false);
    expect(esClaveSecreta("sb_publishable_abc")).toBe(false);
    expect(() => leerConfigSupabase({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" })).toThrow(/clave SECRETA/);
    expect(() => leerConfigSupabase({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: jwt({ role: "service_role" }) })).toThrow(ErrorConfiguracion);
  });

  it("exige configuración completa y HTTPS", () => {
    expect(() => leerConfigSupabase({})).toThrow(/Falta la configuración/);
    expect(() => leerConfigSupabase({ VITE_SUPABASE_URL: "no-url", VITE_SUPABASE_PUBLISHABLE_KEY: "k" })).toThrow(/no es una URL/);
    expect(() => leerConfigSupabase({ VITE_SUPABASE_URL: "http://x.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "k" })).toThrow(/HTTPS/);
    expect(leerConfigSupabase({ VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_PUBLISHABLE_KEY: "k" }).url).toBe("http://127.0.0.1:54321");
  });
});

describe("traducción de errores", () => {
  it.each([
    [{ code: "23505", message: 'duplicate key value violates unique constraint "clientes_nif_key"' }, 409, "Ya existe un cliente con ese NIF."],
    [{ code: "23503", message: "fk" }, 409, /relacionados/],
    [{ code: "23001", message: "restrict" }, 409, /relacionados/],
    [{ code: "23514", message: "check" }, 400, /integridad/],
    [{ code: "22P02", message: "invalid input syntax for type integer" }, 400, /integridad/],
    [{ code: "42501", message: "new row violates row-level security policy" }, 403, /permiso/],
    [{ code: "PGRST301", message: "JWT expired" }, 401, /sesión/],
    [{ name: "TypeError", message: "Failed to fetch" }, 0, /pausa/],
  ])("%j → %i", (error, estado, mensaje) => {
    const e = traducirErrorSupabase(error, { clientes_nif_key: "Ya existe un cliente con ese NIF." });
    expect(e.estado).toBe(estado);
    if (mensaje instanceof RegExp) expect(e.message).toMatch(mensaje);
    else expect(e.message).toBe(mensaje);
  });
});

describe("lectura paginada (límite de 1.000 filas de la API)", () => {
  it("lee todas las páginas hasta una incompleta", async () => {
    const datos = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const pedidas = [];
    const filas = await leerTodo(async (desde, hasta) => {
      pedidas.push([desde, hasta]);
      return { data: datos.slice(desde, hasta + 1), error: null };
    });
    expect(filas).toHaveLength(2500);
    expect(pedidas).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("propaga errores traducidos", async () => {
    await expect(leerTodo(async () => ({ data: null, error: { code: "42501", message: "rls" } }))).rejects.toMatchObject({ estado: 403 });
  });
});
