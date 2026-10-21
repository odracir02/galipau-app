import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import { generarInstalacion, listar } from "./generar-instalacion.mjs";
import { verificarProyecto, TABLAS, FUNCIONES } from "./verificar.mjs";
import { analizarDespliegue, comprobarDespliegue } from "./verificar-despliegue.mjs";

describe("SQL de instalación en un solo archivo", () => {
  it("incluye todas las migraciones en orden, dentro de una transacción, y se aplica en una base de datos vacía", async () => {
    const { archivos, sql } = generarInstalacion();
    expect(archivos).toEqual(listar());
    expect(sql.startsWith("-- Galipau App")).toBe(true);
    expect(sql).toMatch(/\nbegin;\n/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    const db = await PGlite.create();
    await db.exec(fs.readFileSync(new URL("../../supabase/pruebas/entorno-supabase.sql", import.meta.url), "utf8"));
    await db.exec(sql);
    const { rows } = await db.query("select count(*)::int n from pg_tables where schemaname = 'public'");
    expect(rows[0].n).toBe(15);
    await db.close();
  });

  it("solo las migraciones nuevas para un proyecto existente", () => {
    const { archivos } = generarInstalacion({ desde: "20261017090000" });
    expect(archivos[0]).toBe("20261017090000_presupuestos_ciclo_vida.sql");
    expect(() => generarInstalacion({ desde: "29990101000000" })).toThrow(/No hay migraciones/);
  });
});

describe("verificación externa de un proyecto (como visitante anónimo)", () => {
  const respuesta = (status, cuerpo) => ({ status, ok: status < 300, text: async () => JSON.stringify(cuerpo), json: async () => cuerpo });
  const fetchFalso = ({ tablaAbierta = null, funcionAbierta = null, registro = false } = {}) => {
    const llamadas = [];
    const fn = async (url, opciones = {}) => {
      llamadas.push({ url, metodo: opciones.method ?? "GET" });
      if (url.endsWith("/auth/v1/settings")) return respuesta(200, { disable_signup: !registro });
      const rpc = /\/rpc\/(\w+)$/.exec(url)?.[1];
      if (rpc) return rpc === funcionAbierta ? respuesta(200, 1) : respuesta(401, { code: "42501" });
      const tabla = /\/rest\/v1\/(\w+)\?/.exec(url)[1];
      if (tabla === tablaAbierta) return respuesta(200, [{ id: 1 }]);
      return tabla === "v_catalogo_plano" ? respuesta(200, []) : respuesta(401, { code: "42501" });
    };
    fn.llamadas = llamadas;
    return fn;
  };
  const base = { url: "https://ejemplo.supabase.co/", clave: "sb_publishable_ficticia" };

  it("todo cerrado: correcto (y no escribe nada)", async () => {
    const f = fetchFalso();
    const r = await verificarProyecto({ ...base, fetch: f });
    expect(r.ok).toBe(true);
    expect(r.resultados).toHaveLength(TABLAS.length + Object.keys(FUNCIONES).length + 1);
    expect(f.llamadas.filter((l) => l.metodo !== "GET").every((l) => l.url.includes("/rpc/"))).toBe(true);
    expect(f.llamadas[0].url).toBe("https://ejemplo.supabase.co/rest/v1/clientes?select=*&limit=1");
  });

  it.each([
    [{ tablaAbierta: "presupuestos" }, "tabla presupuestos"],
    [{ funcionAbierta: "siguiente_numero_presupuesto" }, "función siguiente_numero_presupuesto"],
    [{ registro: true }, "registro público"],
  ])("detecta %j", async (fallo, prueba) => {
    const r = await verificarProyecto({ ...base, fetch: fetchFalso(fallo) });
    expect(r.ok).toBe(false);
    expect(r.resultados.find((x) => !x.ok).prueba).toBe(prueba);
  });

  it("una clave equivocada no cuenta como acceso denegado", async () => {
    const f = async () => ({ status: 401, ok: false, text: async () => JSON.stringify({ message: "Invalid API key" }), json: async () => ({}) });
    await expect(verificarProyecto({ ...base, fetch: f })).rejects.toThrow(/no es válida/);
  });

  it("rechaza una clave secreta", async () => {
    await expect(verificarProyecto({ ...base, clave: "sb_secret_abc", fetch: fetchFalso() })).rejects.toThrow(/SECRETA/);
  });
});

describe("verificación de un despliegue web (a qué Supabase apunta)", () => {
  const sitio = (ficheros) => async (url) => ({ text: async () => ficheros[new URL(url).pathname] ?? "" });
  const REF_A = "aaaaaaaaaaaaaaaaaaaa";
  const REF_B = "bbbbbbbbbbbbbbbbbbbb";

  it("encuentra el proyecto en el script principal y en los fragmentos que importa", async () => {
    const f = sitio({
      "/": '<html><script type="module" src="/assets/index-1.js"></script></html>',
      "/assets/index-1.js": 'import("./assets/cliente-2.js")',
      "/assets/cliente-2.js": `const u="https://${REF_A}.supabase.co"`,
    });
    const a = await analizarDespliegue("https://web.example/", { fetch: f });
    expect(a.refs).toEqual([REF_A]);
    expect(comprobarDespliegue(a, REF_A)).toEqual([]);
  });

  it("detecta una web que apunta al proyecto equivocado o a los dos", async () => {
    const mezcla = sitio({ "/": '<script src="/assets/i.js"></script>', "/assets/i.js": `"https://${REF_A}.supabase.co";"https://${REF_B}.supabase.co"` });
    const a = await analizarDespliegue("https://web.example", { fetch: mezcla });
    expect(comprobarDespliegue(a, REF_A)).toEqual([`Apunta a otro proyecto de Supabase: ${REF_B}.`]);
    expect(comprobarDespliegue({ refs: [REF_B] }, REF_A)).toHaveLength(2);
    await expect(analizarDespliegue("https://web.example", { fetch: sitio({ "/": "<html></html>" }) })).rejects.toThrow(/No se encuentra/);
  });
});
