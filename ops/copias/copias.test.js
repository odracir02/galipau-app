import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearBd, comoPropietario } from "../../supabase/pruebas/bd.js";
import { compararManifiestos, leerManifiesto } from "./verificar-manifiesto.mjs";
import { descargarTodo, verificarCarpeta, listarObjetos, rutaSegura, subirCarpeta, MANIFIESTO } from "./copiar-storage.mjs";

const SQL_MANIFIESTO = fs.readFileSync(new URL("./manifiesto.sql", import.meta.url), "utf8");
const manifiestoDe = async (db) => {
  const resultados = await db.exec(SQL_MANIFIESTO);
  const valor = resultados.at(-1).rows[0];
  return Object.values(valor)[0];
};

const temporales = [];
const carpeta = () => {
  const c = fs.mkdtempSync(path.join(os.tmpdir(), "galipau-copia-"));
  temporales.push(c);
  return c;
};
afterEach(() => {
  while (temporales.length) fs.rmSync(temporales.pop(), { recursive: true, force: true });
});

describe("manifiesto de la base de datos", () => {
  const cargarDatos = async (db) => {
    await db.exec(fs.readFileSync(new URL("../../supabase/datos-ficticios.sql", import.meta.url), "utf8"));
    await comoPropietario(db, (tx) =>
      tx.query("insert into public.presupuestos (numero, cliente_nombre, motor, entrada, total_cent, fecha_emision) values ('P-2026-0001', 'C', 'legacy', '{\"a\": [1, 2]}', 3618, '2026-10-15')")
    );
  };

  it("incluye todas las tablas con número de filas y huella", async () => {
    const db = await crearBd();
    await cargarDatos(db);
    const m = await manifiestoDe(db);
    expect(Object.keys(m).sort()).toEqual(["clientes", "configuracion", "contadores", "modelos", "presupuestos", "propietario", "proveedores", "registro_copias", "variantes"]);
    expect(m.variantes.filas).toBe(36);
    expect(m.presupuestos.md5).toMatch(/^[0-9a-f]{32}$/);
    await db.close();
  });

  it("dos bases de datos con los mismos datos dan el mismo manifiesto (simula origen y copia restaurada)", async () => {
    const a = await crearBd();
    const b = await crearBd();
    await cargarDatos(a);
    await cargarDatos(b);
    // timestamps differ between the two databases: align them as a restore would
    for (const db of [a, b]) {
      // like pg_restore loading data: user triggers (actualizado_en) do not fire
      await db.exec("set session_replication_role = replica");
      await db.exec("update public.clientes set creado_en = '2026-10-15T00:00:00Z', actualizado_en = '2026-10-15T00:00:00Z'");
      await db.exec("update public.proveedores set creado_en = '2026-10-15T00:00:00Z', actualizado_en = '2026-10-15T00:00:00Z'");
      await db.exec("update public.presupuestos set creado_en = '2026-10-15T00:00:00Z', actualizado_en = '2026-10-15T00:00:00Z'");
      await db.exec("update public.configuracion set actualizado_en = '2026-10-15T00:00:00Z'");
      await db.exec("update public.propietario set creado_en = '2026-10-15T00:00:00Z'");
      await db.exec("set session_replication_role = origin");
    }
    expect(compararManifiestos(await manifiestoDe(a), await manifiestoDe(b))).toEqual([]);

    // A single changed value is detected
    await b.exec("update public.variantes set coste_cent = coste_cent + 1 where id = 1");
    expect(compararManifiestos(await manifiestoDe(a), await manifiestoDe(b))).toEqual(["variantes: same row count but different content"]);
    // A missing row is detected
    await b.exec("delete from public.presupuestos");
    expect(compararManifiestos(await manifiestoDe(a), await manifiestoDe(b))).toContain("presupuestos: 1 rows in source, 0 restored");
    await a.close();
    await b.close();
  });

  it("detecta tablas ausentes o sobrantes", () => {
    expect(compararManifiestos({ a: { filas: 1, md5: "x" } }, {})).toEqual(["a: missing from the restored copy"]);
    expect(compararManifiestos({}, { b: { filas: 0, md5: "y" } })).toEqual(["b: only in the restored copy"]);
  });

  it("lee el manifiesto de la salida de psql y rechaza uno vacío", () => {
    const dir = carpeta();
    fs.writeFileSync(path.join(dir, "m.json"), 'SET\n{"clientes": {"filas": 2, "md5": "abc"}}\n');
    expect(leerManifiesto(path.join(dir, "m.json"))).toEqual({ clientes: { filas: 2, md5: "abc" } });
    fs.writeFileSync(path.join(dir, "vacio.json"), "{}\n");
    expect(() => leerManifiesto(path.join(dir, "vacio.json"))).toThrow(/Empty/);
  });
});

// Fake of supabase-js storage with folders and files
const crearStorageFalso = (archivos) => ({
  from: () => ({
    list: async (prefijo, { limit, offset }) => {
      const base = prefijo ? `${prefijo}/` : "";
      const hijos = new Map();
      for (const ruta of Object.keys(archivos).filter((r) => r.startsWith(base))) {
        const [nombre, ...resto] = ruta.slice(base.length).split("/");
        hijos.set(nombre, resto.length ? { name: nombre, id: null } : { name: nombre, id: "id-" + ruta, metadata: { size: archivos[ruta].length } });
      }
      return { data: [...hijos.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit), error: null };
    },
    download: async (ruta) => (ruta in archivos ? { data: new Blob([archivos[ruta]]), error: null } : { data: null, error: { message: "not found" } }),
    upload: async (ruta, contenido, { upsert }) => {
      if (ruta in archivos && !upsert) return { data: null, error: { message: "The resource already exists" } };
      archivos[ruta] = Buffer.from(contenido).toString();
      return { data: { path: ruta }, error: null };
    },
  }),
});

describe("copia de archivos de Storage", () => {
  const ARCHIVOS = { "logo.png": "PNGDATA", "clientes/1/diseno.pdf": "PDF-1", "clientes/2/diseno.pdf": "PDF-2" };

  it("lista recursivamente, descarga y genera un manifiesto con SHA-256", async () => {
    const storage = crearStorageFalso(ARCHIVOS);
    expect((await listarObjetos(storage)).map((o) => o.ruta).sort()).toEqual(Object.keys(ARCHIVOS).sort());
    const dir = carpeta();
    const m = await descargarTodo(storage, dir, { ahora: new Date("2026-10-15T00:00:00Z") });
    expect(m.total).toBe(3);
    expect(m.archivos.find((a) => a.ruta === "logo.png").sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(path.join(dir, "archivos", "clientes", "2", "diseno.pdf"), "utf8")).toBe("PDF-2");
    expect(verificarCarpeta(dir).errores).toEqual([]);
  });

  it("la verificación detecta archivos alterados o perdidos", async () => {
    const dir = carpeta();
    await descargarTodo(crearStorageFalso(ARCHIVOS), dir);
    fs.writeFileSync(path.join(dir, "archivos", "logo.png"), "PNGDATX");
    fs.rmSync(path.join(dir, "archivos", "clientes", "1", "diseno.pdf"));
    expect(verificarCarpeta(dir).errores.sort()).toEqual(["clientes/1/diseno.pdf: missing", "logo.png: checksum mismatch"]);
  });

  it("rechaza nombres de objeto que saldrían de la carpeta de destino", async () => {
    expect(rutaSegura("a/b.png")).toBe(true);
    for (const malo of ["../x", "a/../../x", "/abs", "a\\b", "", "a//b"]) expect(rutaSegura(malo)).toBe(false);
    const dir = carpeta();
    await expect(descargarTodo(crearStorageFalso({ "a/../../fuera.txt": "x" }), dir)).rejects.toThrow(/Unsafe/);
    expect(fs.existsSync(path.join(dir, MANIFIESTO))).toBe(false);
  });

  it("un bucket vacío produce un manifiesto válido con 0 archivos", async () => {
    const dir = carpeta();
    const m = await descargarTodo(crearStorageFalso({}), dir);
    expect(m.total).toBe(0);
    expect(verificarCarpeta(dir).errores).toEqual([]);
  });

  it("recuperación de archivos: vuelve a subir una copia verificada a un bucket vacío sin sobrescribir nada", async () => {
    const dir = carpeta();
    await descargarTodo(crearStorageFalso({ ...ARCHIVOS }), dir);
    const vacio = {};
    expect(await subirCarpeta(crearStorageFalso(vacio), dir)).toEqual({ subidos: 3, existentes: 0 });
    expect(vacio).toEqual(ARCHIVOS);
    const conUno = { "logo.png": "VERSION-NUEVA" };
    expect(await subirCarpeta(crearStorageFalso(conUno), dir)).toEqual({ subidos: 2, existentes: 1 });
    expect(conUno["logo.png"]).toBe("VERSION-NUEVA");
  });

  it("no sube una carpeta que no coincide con su manifiesto", async () => {
    const dir = carpeta();
    await descargarTodo(crearStorageFalso({ ...ARCHIVOS }), dir);
    fs.writeFileSync(path.join(dir, "archivos", "logo.png"), "alterado");
    await expect(subirCarpeta(crearStorageFalso({}), dir)).rejects.toThrow(/does not match/);
  });
});
