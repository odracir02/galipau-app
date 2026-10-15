import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { levantarServidor, carpetaTemporal } from "../../pruebas/entorno.js";
import { nombreCopia, leerNombreCopia, seleccionarParaBorrar, verificarArchivo } from "./servicio.js";

let s;
const extras = [];
beforeEach(async () => {
  s = await levantarServidor();
  await s.iniciarSesion();
});
afterEach(async () => {
  await s.cerrar();
  while (extras.length) fs.rmSync(extras.pop(), { recursive: true, force: true });
});

const crearCliente = (nombre) => s.pedir("/api/clientes", { metodo: "POST", cuerpo: { nombre } });
const nombresClientes = async () => (await s.pedir("/api/clientes")).json.map((c) => c.nombre);

describe("nombres y rotación", () => {
  it("el nombre codifica fecha y motivo", () => {
    const fecha = new Date(2026, 9, 15, 9, 5, 7, 42);
    const nombre = nombreCopia(fecha, "manual");
    expect(nombre).toBe("galipau-20261015-090507-042-manual.db");
    expect(leerNombreCopia(nombre)).toEqual({ nombre, fecha, motivo: "manual" });
    expect(leerNombreCopia("../../etc/passwd")).toBeNull();
  });

  it("conserva las 30 más recientes y la más reciente de cada uno de los últimos 12 meses", () => {
    const nombres = [];
    for (let d = 0; d < 400; d++) nombres.push(nombreCopia(new Date(2026, 0, 1 + d, 12), "automatica"));
    const borrar = new Set(seleccionarParaBorrar(nombres));
    const conservar = nombres.filter((n) => !borrar.has(n));
    expect(conservar.length).toBeLessThanOrEqual(30 + 12);
    expect(conservar).toContain(nombres.at(-1));
    const meses = new Set(conservar.map((n) => n.slice(8, 14)));
    expect(meses.size).toBeGreaterThanOrEqual(12);
    expect(seleccionarParaBorrar(["otro-archivo.txt"])).toEqual([]);
  });
});

describe("crear y verificar copias", () => {
  it("crea una copia consistente mientras la app está en uso y la verifica", async () => {
    await crearCliente("Antes de la copia");
    const copia = s.copias.crear("manual");
    await crearCliente("Durante la copia"); // writes while the backup runs
    const r = await copia;
    expect(r).toMatchObject({ motivo: "manual", integridadOk: true, versionEsquema: 1 });
    const ruta = path.join(s.config.carpetaCopias, r.archivo);
    expect(verificarArchivo(ruta)).toEqual({ ok: true, versionEsquema: 1 });
    // single self-contained file (no WAL)
    expect(fs.existsSync(`${ruta}-wal`)).toBe(false);
    expect(fs.readdirSync(s.config.carpetaCopias).filter((f) => f.endsWith(".parcial"))).toEqual([]);
  });

  it("dos peticiones simultáneas comparten la misma copia", async () => {
    const [a, b] = await Promise.all([s.copias.crear("manual"), s.copias.crear("manual")]);
    expect(a.archivo).toBe(b.archivo);
  });

  it("detecta un archivo dañado", () => {
    const carpeta = carpetaTemporal();
    extras.push(carpeta);
    const rota = path.join(carpeta, "rota.db");
    fs.writeFileSync(rota, "esto no es una base de datos SQLite".repeat(100));
    expect(verificarArchivo(rota).ok).toBe(false);
  });

  it("estado: sin copias avisa; tras crear una muestra la última y avisa si solo es local", async () => {
    let estado = (await s.pedir("/api/copias/estado")).json;
    expect(estado.ultima).toBeNull();
    expect(estado.avisos.join(" ")).toMatch(/ninguna copia/);
    expect(estado.avisos.join(" ")).toMatch(/solo se guardan en este PC/);

    const creada = await s.pedir("/api/copias", { metodo: "POST" });
    expect(creada.estado).toBe(201);
    estado = (await s.pedir("/api/copias/estado")).json;
    expect(estado.ultima).toMatchObject({ archivo: creada.json.archivo, integridadOk: true, motivo: "manual" });
    expect(estado.horasDesdeUltimaCorrecta).toBeLessThan(1);
    expect(estado.totalCopias).toBe(1);
    expect((await s.pedir("/api/copias")).json[0].archivo).toBe(creada.json.archivo);
  });

  it("copia también a la carpeta externa configurada (p. ej. OneDrive)", async () => {
    const externa = carpetaTemporal();
    extras.push(externa);
    const conf = await s.pedir("/api/copias/destino-externo", { metodo: "PUT", cuerpo: { destinoExterno: externa } });
    expect(conf.estado).toBe(200);
    const r = await s.copias.crear("manual");
    expect(r.copiaExterna).toBe(path.resolve(externa));
    expect(verificarArchivo(path.join(externa, r.archivo)).ok).toBe(true);
    expect((await s.pedir("/api/copias/estado")).json.avisos.join(" ")).not.toMatch(/solo se guardan en este PC/);
  });

  it("rechaza destinos externos no válidos", async () => {
    for (const destinoExterno of ["relativa/carpeta", s.config.carpetaDatos, 42]) {
      const r = await s.pedir("/api/copias/destino-externo", { metodo: "PUT", cuerpo: { destinoExterno } });
      expect(r.estado).toBe(400);
    }
  });

  it("la copia programada solo se hace si la última es antigua", async () => {
    await s.copias.comprobarProgramada();
    expect(s.copias.listar()).toHaveLength(1);
    await s.copias.comprobarProgramada();
    expect(s.copias.listar()).toHaveLength(1);
  });

  it("permite descargar una copia y rechaza nombres con rutas", async () => {
    const { archivo } = await s.copias.crear("manual");
    const r = await s.pedir(`/api/copias/${archivo}/descargar`);
    expect(r.estado).toBe(200);
    expect(r.cabeceras.get("content-disposition")).toContain(archivo);
    expect((await s.pedir(`/api/copias/..%2F..%2Fgalipau.db/descargar`)).estado).toBe(400);
    expect((await s.pedir(`/api/copias/galipau-20990101-000000-000-manual.db/descargar`)).estado).toBe(404);
  });
});

describe("restauración controlada", () => {
  it("restaura una copia, guarda antes una copia de seguridad y la app sigue funcionando", async () => {
    await crearCliente("Cliente A");
    const { archivo } = await s.copias.crear("manual");
    await crearCliente("Cliente B (posterior a la copia)");
    expect(await nombresClientes()).toHaveLength(2);

    const r = await s.pedir(`/api/copias/${archivo}/restaurar`, { metodo: "POST", cuerpo: { confirmar: archivo } });
    expect(r.estado).toBe(200);
    expect(r.json.restaurada).toBe(archivo);
    expect(r.json.copiaPrevia).toMatch(/-restauracion\.db$/);

    // The sessions table is restored too: log in again
    await s.iniciarSesion();
    expect(await nombresClientes()).toEqual(["Cliente A"]);
    // The data before restoring is safe in the previous backup
    const previa = path.join(s.config.carpetaCopias, r.json.copiaPrevia);
    expect(verificarArchivo(previa).ok).toBe(true);
    // the app keeps working (writes after restore)
    expect((await crearCliente("Cliente C")).estado).toBe(201);
  });

  it("exige confirmar el nombre exacto", async () => {
    const { archivo } = await s.copias.crear("manual");
    const r = await s.pedir(`/api/copias/${archivo}/restaurar`, { metodo: "POST", cuerpo: { confirmar: "si" } });
    expect(r.estado).toBe(400);
    expect(r.json.campo).toBe("confirmar");
  });

  it("no restaura copias dañadas ni de versiones más nuevas de la app", async () => {
    const { archivo } = await s.copias.crear("manual");
    const ruta = path.join(s.config.carpetaCopias, archivo);

    const nueva = path.join(s.config.carpetaCopias, "galipau-20990101-000000-000-manual.db");
    fs.copyFileSync(ruta, nueva);
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nueva);
    db.pragma("user_version = 99");
    db.close();
    const r1 = await s.pedir(`/api/copias/${path.basename(nueva)}/restaurar`, { metodo: "POST", cuerpo: { confirmar: path.basename(nueva) } });
    expect(r1.estado).toBe(409);

    const danada = path.join(s.config.carpetaCopias, "galipau-20990102-000000-000-manual.db");
    fs.writeFileSync(danada, "basura".repeat(1000));
    const r2 = await s.pedir(`/api/copias/${path.basename(danada)}/restaurar`, { metodo: "POST", cuerpo: { confirmar: path.basename(danada) } });
    expect(r2.estado).toBe(400);
    // nothing changed
    expect((await s.pedir("/api/clientes")).estado).toBe(200);
  });
});

describe("copia antes de migrar", () => {
  it("al actualizar la app, se hace una copia 'migracion' antes de cambiar el esquema y los datos se conservan", async () => {
    const { iniciarServicios, crearLogger } = await import("../../arranque.js");
    const { CARPETA_MIGRACIONES } = await import("../../db/migrar.js");
    await crearCliente("Datos existentes");
    const config = s.config;
    await new Promise((r) => setTimeout(r, 5));
    // Stop the app without deleting its data folder
    await s.cerrarSinBorrar();

    // New app version: the real migrations plus one more
    const carpetaMigraciones = carpetaTemporal();
    extras.push(carpetaMigraciones);
    for (const f of fs.readdirSync(CARPETA_MIGRACIONES)) fs.copyFileSync(path.join(CARPETA_MIGRACIONES, f), path.join(carpetaMigraciones, f));
    fs.writeFileSync(path.join(carpetaMigraciones, "0002_prueba.sql"), "alter table clientes add column web text;");

    const servicios = await iniciarServicios(config, { logger: crearLogger({ silencioso: true }), programarCopias: false, carpetaMigraciones });
    try {
      expect(servicios.bd.versionEsquema()).toBe(2);
      const copias = servicios.copias.listar();
      expect(copias.map((c) => c.motivo)).toEqual(["migracion"]);
      // The pre-migration backup keeps the old schema (v1) with the data
      const ruta = path.join(config.carpetaCopias, copias[0].archivo);
      expect(verificarArchivo(ruta)).toEqual({ ok: true, versionEsquema: 1 });
      expect(servicios.bd.conexion.prepare("select nombre, web from clientes").all()).toEqual([{ nombre: "Datos existentes", web: null }]);
    } finally {
      await servicios.cerrar();
    }
  });
});
