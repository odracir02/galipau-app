// Migration 20261018090000 on a database that already holds data (FICTITIOUS):
// everything except the two new variant columns must stay exactly as it was.
import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { listarMigraciones, CARPETA_MIGRACIONES, PROPIETARIO, INTRUSO, comoPropietario, comoIntruso, comoAnonimo, codigoError } from "./bd.js";

const MIGRACION = "20261018090000_catalogo_precio_neto.sql";
const leer = (f) => fs.readFileSync(path.join(CARPETA_MIGRACIONES, f), "utf8");

// Every row of every public table, as JSON (new variant columns left out)
const instantanea = async (db) => {
  const tablas = (await db.query("select tablename from pg_tables where schemaname = 'public' order by tablename")).rows.map((r) => r.tablename);
  const datos = {};
  for (const t of tablas) {
    const { rows } = await db.query(`select coalesce(jsonb_agg(to_jsonb(x) - 'precio_neto' - 'iva_porcentaje' order by to_jsonb(x)::text), '[]') d from public.${t} x`);
    datos[t] = rows[0].d;
  }
  return datos;
};

describe("migración del precio neto sobre datos existentes", () => {
  it("termina bien sobre un estado a medias (una columna ya añadida, vista y función sin cambiar)", async () => {
    const db = await PGlite.create();
    await db.exec(fs.readFileSync(new URL("./entorno-supabase.sql", import.meta.url), "utf8"));
    const todas = listarMigraciones();
    for (const m of todas.slice(0, todas.indexOf(MIGRACION))) await db.exec(leer(m));
    await db.exec("alter table public.variantes add column precio_neto numeric(12, 4)");
    await db.exec(leer(MIGRACION));
    const cols = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'v_catalogo_plano' order by ordinal_position")).rows.map((r) => r.column_name);
    expect(cols).toEqual(["id", "tipo", "proveedor", "modelo", "talla", "color", "coste_cent", "precio_neto", "iva_porcentaje", "coste", "referencia"]);
    await db.close();
  });

  it("como en el SQL Editor: el archivo generado (una transacción) se aplica sobre la base sin migrar", async () => {
    const { generarInstalacion } = await import("../../ops/produccion/generar-instalacion.mjs");
    const db = await PGlite.create();
    await db.exec(fs.readFileSync(new URL("./entorno-supabase.sql", import.meta.url), "utf8"));
    const todas = listarMigraciones();
    for (const m of todas.slice(0, todas.indexOf(MIGRACION))) await db.exec(leer(m));
    const { sql } = generarInstalacion({ desde: "20261018090000", hasta: "20261018090000" });
    await db.exec(sql);
    await db.exec(sql);
    expect((await db.query("select count(*)::int n from information_schema.columns where table_name = 'v_catalogo_plano' and column_name in ('coste', 'precio_neto')")).rows[0].n).toBe(2);
    await db.close();
  });

  it("conserva clientes, presupuestos, parámetros, contador 2026 = 2, copias y catálogo; es repetible", async () => {
    const db = await PGlite.create();
    await db.exec(fs.readFileSync(new URL("./entorno-supabase.sql", import.meta.url), "utf8"));
    const todas = listarMigraciones();
    for (const m of todas.slice(0, todas.indexOf(MIGRACION))) await db.exec(leer(m));
    await db.query("insert into auth.users (id, email) values ($1, 'p@example.com'), ($2, 'i@example.com')", [PROPIETARIO, INTRUSO]);
    await db.query("insert into public.propietario (user_id) values ($1)", [PROPIETARIO]);

    // Production-like state
    await comoPropietario(db, async (tx) => {
      await tx.query("select public.crear_version_parametros('serigrafia', '{\"margenRecomendado\": 0.3, \"redondeoPrecioUnidad\": 0.5}'::jsonb, 'v1')");
      const cliente = (await tx.query("insert into public.clientes (nombre, nif) values ('Club Ficticio', 'G00000000') returning id")).rows[0].id;
      const { id } = (await tx.query(
        "insert into public.presupuestos (cliente_id, cliente_nombre, tecnica, parametros_version, motor, entrada, resultado, total_cent, precio_final_cent, fecha_emision) values ($1, 'Club Ficticio', 'serigrafia', 1, 'serigrafia-coste-real/2', '{}', '{}', 15000, 15000, '2025-12-10') returning id",
        [cliente]
      )).rows[0];
      await tx.query("update public.presupuestos set estado = 'presentado' where id = $1", [id]);
      await tx.query("insert into public.contadores (serie, anio, ultimo) values ('PRES', 2026, 2)");
      await tx.query("insert into public.configuracion (clave, valor) values ('empresa', '{\"nombre\": \"Taller Ficticio\"}')");
      const prov = (await tx.query("insert into public.proveedores (nombre) values ('Proveedor Ficticio') returning id")).rows[0].id;
      const mod = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Camiseta', 'Base') returning id", [prov])).rows[0].id;
      await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent) values ($1, 'Negro', 'M', 312)", [mod]);
    });
    await db.exec("insert into public.registro_copias (tipo, estado, detalle) values ('base_datos', 'correcta', '{}')");

    const antes = await instantanea(db);
    await db.exec(leer(MIGRACION));
    await db.exec(leer(MIGRACION)); // running it twice is harmless
    const despues = await instantanea(db);
    expect(despues).toEqual(antes);
    expect(Object.keys(despues)).toHaveLength(11);

    // Existing variant: new columns empty, cost unchanged and exposed as before
    const v = (await comoPropietario(db, (tx) => tx.query("select coste_cent, precio_neto, iva_porcentaje, coste::float coste from public.v_catalogo_plano"))).rows;
    expect(v).toEqual([{ coste_cent: 312, precio_neto: null, iva_porcentaje: null, coste: 3.12 }]);

    // The 2026 counter is untouched: the next quote presented is 2026/003
    const numero = await comoPropietario(db, async (tx) => {
      const { id } = (await tx.query("insert into public.presupuestos (cliente_nombre, motor, entrada, resultado, total_cent, precio_final_cent, fecha_emision) values ('X', 'm', '{}', '{}', 100, 100, '2026-10-20') returning id")).rows[0];
      return (await tx.query("update public.presupuestos set estado = 'presentado' where id = $1 returning numero", [id])).rows[0].numero;
    });
    expect(numero).toBe("2026/003");

    // A backup taken before the migration (rows without the new columns) still restores
    await db.exec("insert into public.variantes (modelo_id, color, talla, coste_cent) select modelo_id, 'Blanco', 'L', 290 from public.variantes limit 1");

    // Security unchanged on the replaced view and function
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.v_catalogo_plano")))).toBe("42501");
    expect((await comoIntruso(db, (tx) => tx.query("select * from public.v_catalogo_plano"))).rows).toEqual([]);
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("select public.importar_catalogo('[{}]'::jsonb)")))).toBe("42501");
    await db.close();
  });
});
