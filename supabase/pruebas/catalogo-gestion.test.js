// Catalogue management on a real PostgreSQL (PGlite), FICTITIOUS data.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError, listarMigraciones, CARPETA_MIGRACIONES, PROPIETARIO } from "./bd.js";

let db;
beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
});
afterEach(async () => {
  await db.close();
});

const proveedor = (tx, nombre = "Proveedor Ficticio") => tx.query("insert into public.proveedores (nombre) values ($1) returning id", [nombre]).then((r) => r.rows[0].id);
const modelo = (tx, proveedorId, nombre = "Base", tipo = "Camiseta") =>
  tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, $2, $3) returning id", [proveedorId, tipo, nombre]).then((r) => r.rows[0].id);
const variante = (tx, modeloId, campos) => {
  const c = { color: "Negro", talla: "M", coste_cent: 0, ...campos };
  return tx.query(
    "insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje, precio_compra) values ($1, $2, $3, $4, $5, $6, $7) returning id, coste_cent",
    [modeloId, c.color, c.talla, c.coste_cent, c.precio_neto ?? null, c.iva_porcentaje ?? null, c.precio_compra ?? null]
  ).then((r) => r.rows[0]);
};
const plano = (tx) => tx.query("select proveedor, modelo, color, talla, coste::float coste, coste_cent, propio from public.v_catalogo_plano order by id").then((r) => r.rows);

describe("precios", () => {
  it("neto + IVA o precio con IVA incluido; el coste exacto y los céntimos se calculan solos", async () => {
    await comoPropietario(db, async (tx) => {
      const m = await modelo(tx, await proveedor(tx));
      expect((await variante(tx, m, { talla: "S", precio_neto: 2.125, iva_porcentaje: 21 })).coste_cent).toBe(257);
      expect((await variante(tx, m, { talla: "M", precio_compra: 3.0251 })).coste_cent).toBe(303);
      expect((await variante(tx, m, { talla: "L", precio_compra: 4.2, iva_porcentaje: 21 })).coste_cent).toBe(420); // VAT included, not added again
      expect((await plano(tx)).map((f) => f.coste)).toEqual([2.57125, 3.0251, 4.2]);
    });
  });

  it("no admite neto y precio con IVA a la vez, ni neto sin IVA", async () => {
    const m = await comoPropietario(db, async (tx) => modelo(tx, await proveedor(tx)));
    expect(await codigoError(() => comoPropietario(db, (tx) => variante(tx, m, { precio_neto: 2, iva_porcentaje: 21, precio_compra: 2.42 })))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => variante(tx, m, { precio_neto: 2, coste_cent: 242 })))).toBe("23514");
  });

  it("cambiar la tarifa recalcula el coste del catálogo pero no toca los presupuestos guardados", async () => {
    await comoPropietario(db, async (tx) => {
      await tx.query("select public.crear_version_parametros('serigrafia', '{}'::jsonb)");
      const v = await variante(tx, await modelo(tx, await proveedor(tx)), { precio_neto: 2, iva_porcentaje: 21 });
      const entrada = JSON.stringify({ lineas: [{ precioUnitario: 2.42, origen: "catalogo" }] });
      const { id } = (await tx.query("insert into public.presupuestos (cliente_nombre, tecnica, parametros_version, motor, entrada, resultado, total_cent) values ('C', 'serigrafia', 1, 'm', $1, '{}', 100) returning id", [entrada])).rows[0];
      await tx.query("update public.variantes set precio_neto = 2.5 where id = $1", [v.id]);
      expect((await plano(tx))[0]).toMatchObject({ coste: 3.025, coste_cent: 303 });
      expect((await tx.query("select entrada->'lineas'->0->>'precioUnitario' p from public.presupuestos where id = $1", [id])).rows[0].p).toBe("2.42");
    });
  });
});

describe("duplicados", () => {
  it("modelos y variantes no se repiten aunque cambien las mayúsculas", async () => {
    const [p, m] = await comoPropietario(db, async (tx) => {
      const p = await proveedor(tx);
      const m = await modelo(tx, p, "Base");
      await variante(tx, m, { color: "Negro", talla: "M", coste_cent: 300 });
      return [p, m];
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => modelo(tx, p, "BASE", "Polo")))).toBe("23505");
    expect(await codigoError(() => comoPropietario(db, (tx) => variante(tx, m, { color: "negro", talla: "m", coste_cent: 1 })))).toBe("23505");
    // the same model name with another supplier is fine
    await comoPropietario(db, async (tx) => modelo(tx, await proveedor(tx, "Otro"), "Base"));
  });
});

describe("productos propios (sin proveedor)", () => {
  it("se registran sin inventar un proveedor, se usan en la calculadora y no se duplican", async () => {
    await comoPropietario(db, async (tx) => {
      const m = await modelo(tx, null, "Bolsa de tela", "Bolsa");
      await variante(tx, m, { color: "Natural", talla: "TU", precio_compra: 1.8 });
      expect(await plano(tx)).toEqual([{ proveedor: "Productos propios", modelo: "Bolsa de tela", color: "Natural", talla: "TU", coste: 1.8, coste_cent: 180, propio: true }]);
      expect((await tx.query("select count(*)::int n from public.proveedores")).rows[0].n).toBe(0);
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => modelo(tx, null, "BOLSA DE TELA", "bolsa")))).toBe("23505");
  });
});

describe("archivado", () => {
  it("lo archivado desaparece de la calculadora pero se conserva en la administración", async () => {
    await comoPropietario(db, async (tx) => {
      const p = await proveedor(tx);
      const m = await modelo(tx, p);
      const v1 = await variante(tx, m, { talla: "S", coste_cent: 100 });
      await variante(tx, m, { talla: "M", coste_cent: 100 });
      await tx.query("update public.variantes set activo = false where id = $1", [v1.id]);
      expect((await plano(tx)).map((f) => f.talla)).toEqual(["M"]);
      await tx.query("update public.proveedores set activo = false where id = $1", [p]);
      expect(await plano(tx)).toEqual([]);
      const admin = (await tx.query("select talla, variante_activa, proveedor_activo, disponible from public.v_catalogo_admin order by talla")).rows;
      expect(admin).toEqual([
        { talla: "M", variante_activa: true, proveedor_activo: false, disponible: false },
        { talla: "S", variante_activa: false, proveedor_activo: false, disponible: false },
      ]);
    });
  });
});

describe("seguridad", () => {
  it("otra cuenta y un visitante anónimo no ven ni modifican el catálogo", async () => {
    await comoPropietario(db, async (tx) => variante(tx, await modelo(tx, null, "Propio"), { coste_cent: 1 }));
    expect((await comoIntruso(db, (tx) => tx.query("select * from public.v_catalogo_admin"))).rows).toEqual([]);
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.v_catalogo_admin")))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values (null, 'X', 'Y')")))).toBe("42501");
    expect((await comoIntruso(db, (tx) => tx.query("update public.variantes set coste_cent = 0"))).affectedRows ?? 0).toBe(0);
  });
});

describe("migración sobre el catálogo existente", () => {
  it("las variantes importadas (neto + IVA) conservan precio y coste exacto; nada más cambia; es repetible", async () => {
    const MIG = "20261021090000_catalogo_gestion.sql";
    const vieja = await PGlite.create();
    await vieja.exec(fs.readFileSync(new URL("./entorno-supabase.sql", import.meta.url), "utf8"));
    const todas = listarMigraciones();
    for (const m of todas.slice(0, todas.indexOf(MIG))) await vieja.exec(fs.readFileSync(path.join(CARPETA_MIGRACIONES, m), "utf8"));
    await vieja.query("insert into auth.users (id, email) values ($1, 'p@example.com')", [PROPIETARIO]);
    await vieja.query("insert into public.propietario (user_id) values ($1)", [PROPIETARIO]);
    const filas = [
      { proveedor: "Marca A", modelo: "BASE", tipo: "Camiseta", color: "BLANCO", talla: "M", precio_neto: 2.5, iva_porcentaje: 21 },
      { proveedor: "Marca A", modelo: "BASE", tipo: "Camiseta", color: "COLOR", talla: "M", precio_neto: 2.125, iva_porcentaje: 21 },
      { proveedor: "Marca B", modelo: "KIDS", tipo: "Camiseta niño", color: "COLOR", talla: "10A", coste_cent: 415 },
    ];
    await comoPropietario(vieja, (tx) => tx.query("select public.importar_catalogo($1::jsonb)", [JSON.stringify(filas)]));
    const leer = () => comoPropietario(vieja, (tx) => tx.query("select id, tipo, proveedor, modelo, talla, color, coste_cent, precio_neto::text, iva_porcentaje::text, coste::text, referencia from public.v_catalogo_plano order by id")).then((r) => r.rows);
    const tablas = async () => {
      const r = {};
      for (const t of ["proveedores", "modelos", "variantes", "importaciones", "presupuestos", "contadores", "parametros_calculo", "clientes", "registro_copias", "configuracion"]) {
        r[t] = (await vieja.query(`select coalesce(jsonb_agg(to_jsonb(x) - 'precio_compra' - 'contacto' - 'referencia_cliente' order by to_jsonb(x)::text), '[]') d from public.${t} x`)).rows[0].d;
      }
      return r;
    };
    const antes = await leer();
    const tablasAntes = await tablas();
    const sql = fs.readFileSync(path.join(CARPETA_MIGRACIONES, MIG), "utf8");
    await vieja.exec(sql);
    await vieja.exec(sql);
    expect(await leer()).toEqual(antes);
    expect(await tablas()).toEqual(tablasAntes);
    await vieja.close();
  });
});
