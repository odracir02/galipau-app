import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BaseDatos } from "./baseDatos.js";
import { migrar, listarMigraciones, ultimaVersion } from "./migrar.js";
import { carpetaTemporal } from "../pruebas/entorno.js";

const limpiar = [];
afterEach(() => {
  while (limpiar.length) fs.rmSync(limpiar.pop(), { recursive: true, force: true });
});

const carpetaMigraciones = (archivos) => {
  const carpeta = carpetaTemporal();
  limpiar.push(carpeta);
  for (const [nombre, sql] of Object.entries(archivos)) fs.writeFileSync(path.join(carpeta, nombre), sql);
  return carpeta;
};

const bdEnArchivo = () => {
  const carpeta = carpetaTemporal();
  limpiar.push(carpeta);
  const bd = new BaseDatos(path.join(carpeta, "prueba.db"));
  bd.abrir();
  return bd;
};

describe("inicialización de SQLite", () => {
  it("crea el archivo y activa WAL, claves foráneas y busy_timeout", () => {
    const bd = bdEnArchivo();
    expect(fs.existsSync(bd.ruta)).toBe(true);
    expect(bd.conexion.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(bd.conexion.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(bd.conexion.pragma("busy_timeout", { simple: true })).toBe(5000);
    bd.cerrar();
  });

  it("las migraciones reales llevan el esquema a la última versión", async () => {
    const bd = new BaseDatos(":memory:");
    bd.abrir();
    const r = await migrar(bd);
    expect(r).toMatchObject({ desde: 0, hasta: ultimaVersion() });
    expect(bd.versionEsquema()).toBe(ultimaVersion());
    const tablas = bd.conexion.prepare("select name from sqlite_master where type = 'table' order by name").all().map((t) => t.name);
    expect(tablas).toEqual(expect.arrayContaining(["clientes", "proveedores", "modelos", "variantes", "presupuestos", "registro_copias", "propietario", "sesiones", "configuracion", "contadores"]));
    bd.cerrar();
  });

  it("todas las tablas son STRICT", async () => {
    const bd = new BaseDatos(":memory:");
    bd.abrir();
    await migrar(bd);
    const noEstrictas = bd.conexion.prepare("select name from pragma_table_list where schema = 'main' and type = 'table' and strict = 0 and name not like 'sqlite_%'").all();
    expect(noEstrictas).toEqual([]);
    bd.cerrar();
  });
});

describe("migraciones", () => {
  it("son idempotentes: una segunda ejecución no aplica nada", async () => {
    const bd = new BaseDatos(":memory:");
    bd.abrir();
    await migrar(bd);
    expect((await migrar(bd)).aplicadas).toEqual([]);
    bd.cerrar();
  });

  it("aplica solo las pendientes, en orden, y hace copia antes si ya hay datos", async () => {
    const carpeta = carpetaMigraciones({
      "0001_a.sql": "create table a (id integer primary key) strict;",
      "0002_b.sql": "create table b (id integer primary key) strict;",
    });
    const bd = bdEnArchivo();
    const llamadas = [];
    await migrar(bd, { carpeta, antesDeMigrar: (p) => llamadas.push(p.length) });
    expect(llamadas).toEqual([]); // empty database: nothing to back up
    fs.writeFileSync(path.join(carpeta, "0003_c.sql"), "create table c (id integer primary key) strict;");
    const r = await migrar(bd, { carpeta, antesDeMigrar: (p) => llamadas.push(p.map((m) => m.archivo)) });
    expect(r.aplicadas).toEqual(["0003_c.sql"]);
    expect(llamadas).toEqual([["0003_c.sql"]]);
    expect(bd.versionEsquema()).toBe(3);
    bd.cerrar();
  });

  it("una migración con error no deja cambios a medias", async () => {
    const carpeta = carpetaMigraciones({
      "0001_a.sql": "create table a (id integer primary key) strict;",
      "0002_rota.sql": "create table b (id integer primary key) strict; insert into tabla_que_no_existe values (1);",
    });
    const bd = bdEnArchivo();
    await expect(migrar(bd, { carpeta })).rejects.toThrow();
    expect(bd.versionEsquema()).toBe(1);
    expect(bd.conexion.prepare("select count(*) n from sqlite_master where name = 'b'").get().n).toBe(0);
    bd.cerrar();
  });

  it("rechaza abrir una base de datos de una versión más reciente de la app", async () => {
    const bd = bdEnArchivo();
    bd.conexion.pragma("user_version = 999");
    await expect(migrar(bd)).rejects.toThrow(/newer than this version/);
    bd.cerrar();
  });

  it("detecta huecos o duplicados en la numeración de archivos", () => {
    const carpeta = carpetaMigraciones({ "0001_a.sql": "", "0003_c.sql": "" });
    expect(() => listarMigraciones(carpeta)).toThrow(/gap or duplicate/);
  });
});
