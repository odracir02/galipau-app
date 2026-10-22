// Catalogue categories and bulk classification on a real PostgreSQL (PGlite), FICTITIOUS data.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError, listarMigraciones, CARPETA_MIGRACIONES } from "./bd.js";

let db;
let D; // { proveedor, camiseta, bolsa, archivado, vCam, vBolsa }
beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
  D = await comoPropietario(db, async (tx) => {
    const proveedor = (await tx.query("insert into public.proveedores (nombre) values ('Proveedor Ficticio') returning id")).rows[0].id;
    const modelo = async (nombre, tipo, extra = "") =>
      (await tx.query(`insert into public.modelos (proveedor_id, tipo, nombre, referencia, marca${extra ? ", activo" : ""}) values ($1, $2, $3, 'R-1', 'Marca Ficticia'${extra ? ", false" : ""}) returning id`, [proveedor, tipo, nombre])).rows[0].id;
    const camiseta = await modelo("Alfa", "Sin clasificar");
    const bolsa = await modelo("Beta", "Sin clasificar");
    const archivado = await modelo("Gamma", "Bolsa", "archivado");
    const variante = async (m) => (await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje) values ($1, 'NEGRO', 'M', 0, 2.125, 21) returning id", [m])).rows[0].id;
    return { proveedor, camiseta, bolsa, archivado, vCam: await variante(camiseta), vBolsa: await variante(bolsa) };
  });
});
afterEach(async () => {
  await db.close();
});

const categorias = (tx) => tx.query("select nombre from public.categorias order by nombre").then((r) => r.rows.map((x) => x.nombre));
const tipo = (tx, id) => tx.query("select tipo from public.modelos where id = $1", [id]).then((r) => r.rows[0].tipo);
const clasificar = (tx, ids, categoria) => tx.query("select public.clasificar_modelos($1::bigint[], $2) r", [ids, categoria]).then((r) => r.rows[0].r);
// everything that must NOT change when classifying
const foto = (tx) =>
  tx.query(`select v.id, v.color, v.talla, v.precio_neto, v.iva_porcentaje, v.precio_compra, v.coste_cent, v.activo, v.modalidad,
      m.referencia, m.marca, m.activo modelo_activo, m.nombre, p.coste
    from public.variantes v join public.modelos m on m.id = v.modelo_id left join public.v_catalogo_plano p on p.id = v.id order by v.id`).then((r) => r.rows);

describe("lista de categorías", () => {
  it("un tipo nuevo se añade solo a la lista, con la grafía existente si solo cambian mayúsculas", async () => {
    await comoPropietario(db, async (tx) => {
      expect(await categorias(tx)).toEqual(["Bolsa", "Sin clasificar"]);
      const m = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, '  sin CLASIFICAR ', 'Delta') returning tipo", [D.proveedor])).rows[0];
      expect(m.tipo).toBe("Sin clasificar");
      await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Polos', 'Epsilon')", [D.proveedor]);
      expect(await categorias(tx)).toEqual(["Bolsa", "Polos", "Sin clasificar"]);
    });
  });

  it("renombrar una categoría la renombra en sus modelos; no se borra si está en uso", async () => {
    await comoPropietario(db, async (tx) => {
      await tx.query("insert into public.categorias (nombre, orden) values ('Bolsas y mochilas', 5)");
      await tx.query("update public.categorias set nombre = 'Bolsas' where nombre = 'Bolsa'");
      expect(await tipo(tx, D.archivado)).toBe("Bolsas");
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("delete from public.categorias where nombre = 'Bolsas'")))).toBe("23001"); // restrict: in use
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("insert into public.categorias (nombre) values ('bolsas')")))).toBe("23505");
    await comoPropietario(db, (tx) => tx.query("delete from public.categorias where nombre = 'Bolsas y mochilas'"));
  });
});

describe("clasificación en bloque", () => {
  it("solo cambia la categoría: variantes, precios, IVA, coste de la calculadora, referencias, marcas y archivado intactos", async () => {
    await comoPropietario(db, async (tx) => {
      await tx.query("insert into public.categorias (nombre) values ('Camisetas')");
      await tx.query("select public.stock_registrar($1, 'entrada', 10, null, null, 2)", [D.vCam]);
      const antes = await foto(tx);
      const stockAntes = (await tx.query("select * from public.stock_movimientos")).rows;
      const r = await clasificar(tx, [D.camiseta, D.archivado], "camisetas");
      expect(r).toMatchObject({ cambiados: 2, sin_cambio: 0 });
      expect([await tipo(tx, D.camiseta), await tipo(tx, D.archivado), await tipo(tx, D.bolsa)]).toEqual(["Camisetas", "Camisetas", "Sin clasificar"]);
      expect(await foto(tx)).toEqual(antes);
      expect((await tx.query("select activo from public.modelos where id = $1", [D.archivado])).rows[0].activo).toBe(false); // never re-activated
      expect((await tx.query("select * from public.stock_movimientos")).rows).toEqual(stockAntes);
      const log = (await tx.query("select modelo_id, antes, despues from public.clasificacion_cambios where lote = $1 order by modelo_id", [r.lote])).rows;
      expect(log).toEqual([{ modelo_id: D.camiseta, antes: "Sin clasificar", despues: "Camisetas" }, { modelo_id: D.archivado, antes: "Bolsa", despues: "Camisetas" }]);
      // the same models again: nothing to change
      expect(await clasificar(tx, [D.camiseta], "Camisetas")).toMatchObject({ cambiados: 0, sin_cambio: 1 });
    });
  });

  it("una categoría inexistente se rechaza y no cambia nada", async () => {
    expect(await codigoError(() => comoPropietario(db, (tx) => clasificar(tx, [D.camiseta], "No existe")))).toBe("P0002");
    expect(await comoPropietario(db, (tx) => tipo(tx, D.camiseta))).toBe("Sin clasificar");
  });

  it("deshacer devuelve la categoría anterior, salvo a los modelos cambiados después", async () => {
    await comoPropietario(db, async (tx) => {
      await tx.query("insert into public.categorias (nombre) values ('Camisetas'), ('Polos')");
      const r = await clasificar(tx, [D.camiseta, D.bolsa], "Camisetas");
      await clasificar(tx, [D.bolsa], "Polos"); // later legitimate change
      expect((await tx.query("select public.deshacer_clasificacion($1) n", [r.lote])).rows[0].n).toBe(1);
      expect([await tipo(tx, D.camiseta), await tipo(tx, D.bolsa)]).toEqual(["Sin clasificar", "Polos"]);
    });
  });

  it("fusionar mueve los modelos a otra categoría y elimina la primera; «Sin clasificar» no se elimina", async () => {
    await comoPropietario(db, async (tx) => {
      await tx.query("insert into public.categorias (nombre) values ('Bolsas y mochilas')");
      expect(await tx.query("select public.fusionar_categorias('Bolsa', 'Bolsas y mochilas') r").then((x) => x.rows[0].r)).toMatchObject({ cambiados: 1 });
      expect(await tipo(tx, D.archivado)).toBe("Bolsas y mochilas");
      expect(await categorias(tx)).toEqual(["Bolsas y mochilas", "Sin clasificar"]);
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.fusionar_categorias('Sin clasificar', 'Bolsas y mochilas')")))).toBe("22023");
  });

  it("solo el propietario clasifica o gestiona categorías", async () => {
    expect(await codigoError(() => comoIntruso(db, (tx) => clasificar(tx, [D.camiseta], "Bolsa")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => clasificar(tx, [D.camiseta], "Bolsa")))).toBe("42501");
    expect(await comoIntruso(db, (tx) => tx.query("select * from public.categorias").then((r) => r.rows))).toEqual([]);
    expect(await comoIntruso(db, (tx) => tx.query("update public.categorias set nombre = 'X' returning id").then((r) => r.rows))).toEqual([]);
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.categorias")))).toBe("42501");
  });
});

describe("migración sobre un catálogo existente", () => {
  it("la lista se rellena con los tipos en uso (una grafía por nombre) y no cambia nada más", async () => {
    const vieja = await PGlite.create();
    await vieja.exec(fs.readFileSync(path.join(CARPETA_MIGRACIONES, "..", "pruebas", "entorno-supabase.sql"), "utf8"));
    const anteriores = listarMigraciones().filter((f) => f < "20261025090000");
    for (const f of anteriores) await vieja.exec(fs.readFileSync(path.join(CARPETA_MIGRACIONES, f), "utf8"));
    await vieja.exec(`insert into public.proveedores (nombre) values ('P');
      insert into public.modelos (proveedor_id, tipo, nombre) select id, 'Camiseta', 'A' from public.proveedores;
      insert into public.modelos (proveedor_id, tipo, nombre) select id, 'camiseta ', 'B' from public.proveedores;
      insert into public.modelos (proveedor_id, tipo, nombre, activo) select id, 'Bolsa', 'C', false from public.proveedores;`);
    const sql = fs.readFileSync(path.join(CARPETA_MIGRACIONES, "20261025090000_categorias.sql"), "utf8");
    await vieja.exec(sql);
    await vieja.exec(sql); // re-runnable
    expect((await vieja.query("select nombre from public.categorias order by nombre")).rows.map((r) => r.nombre)).toEqual(["Bolsa", "Camiseta"]);
    expect((await vieja.query("select nombre, tipo, activo from public.modelos order by nombre")).rows).toEqual([
      { nombre: "A", tipo: "Camiseta", activo: true }, { nombre: "B", tipo: "Camiseta", activo: true }, { nombre: "C", tipo: "Bolsa", activo: false },
    ]);
    await vieja.close();
  });
});
