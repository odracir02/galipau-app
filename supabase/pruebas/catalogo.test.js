// Catalogue prices and imports on a real PostgreSQL (PGlite), FICTITIOUS data.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError } from "./bd.js";
import { prepararCatalogo, filasParaImportar, conciliarCatalogo } from "../../src/modules/migracion/domain/catalogo.js";

let db;
beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
});
afterEach(async () => {
  await db.close();
});

const importar = (tx, filas) => tx.query("select public.importar_catalogo($1::jsonb) id", [JSON.stringify(filas)]).then((r) => r.rows[0].id);
const vista = (tx) => tx.query("select proveedor, modelo, tipo, color, talla, coste_cent, precio_neto::float precio_neto, iva_porcentaje::float iva, coste::float coste from public.v_catalogo_plano order by id").then((r) => r.rows);

describe("precio neto + IVA", () => {
  it("neto con tres decimales (2,125 € × 1,21 = 2,57125 €) se conserva sin redondear", async () => {
    await comoPropietario(db, async (tx) => {
      await importar(tx, [{ proveedor: "Marca B", modelo: "M", tipo: "Camiseta", color: "BLANCO", talla: "S", precio_neto: 2.125, iva_porcentaje: 21 }]);
      expect((await vista(tx))[0]).toMatchObject({ precio_neto: 2.125, coste: 2.57125, coste_cent: 257 });
    });
  });

  it("la vista da el coste exacto (neto × (1 + IVA)) y los céntimos redondeados", async () => {
    await comoPropietario(db, async (tx) => {
      await importar(tx, [{ proveedor: "Marca A", modelo: "BASE", tipo: "Camiseta", color: "BLANCO", talla: "M", precio_neto: 2.5, iva_porcentaje: 21 }]);
      expect(await vista(tx)).toEqual([{ proveedor: "Marca A", modelo: "BASE", tipo: "Camiseta", color: "BLANCO", talla: "M", coste_cent: 303, precio_neto: 2.5, iva: 21, coste: 3.025 }]);
    });
  });

  it("sin neto, el coste es el guardado; neto sin IVA no se admite", async () => {
    await comoPropietario(db, async (tx) => {
      await importar(tx, [{ proveedor: "P", modelo: "M", tipo: "Polo", color: "Negro", talla: "L", coste_cent: 415 }]);
      expect((await vista(tx))[0]).toMatchObject({ coste: 4.15, precio_neto: null, iva: null });
    });
    expect(await codigoError(() => comoPropietario(db, async (tx) => {
      const m = (await tx.query("select id from public.modelos limit 1")).rows[0].id;
      await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto) values ($1, 'X', 'S', 100, 1)", [m]);
    }))).toBe("23514");
  });

  it("repetir la importación no duplica: modelos por nombre (sin mirar tipo ni mayúsculas)", async () => {
    await comoPropietario(db, async (tx) => {
      const filas = [{ proveedor: "Marca A", modelo: "BASE", tipo: "Camiseta", color: "BLANCO", talla: "M", precio_neto: 2.5, iva_porcentaje: 21 }];
      await importar(tx, filas);
      await importar(tx, filas);
      await importar(tx, [{ ...filas[0], proveedor: "MARCA A", modelo: "base", tipo: "Otra" }]);
      expect((await tx.query("select (select count(*) from public.proveedores)::int p, (select count(*) from public.modelos)::int m, (select count(*) from public.variantes)::int v")).rows[0]).toEqual({ p: 1, m: 1, v: 1 });
    });
  });

  it("otra cuenta o un visitante anónimo no pueden importar ni ver el catálogo", async () => {
    const fila = [{ proveedor: "P", modelo: "M", tipo: "T", color: "C", talla: "S", coste_cent: 1 }];
    expect(await codigoError(() => comoIntruso(db, (tx) => importar(tx, fila)))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => importar(tx, fila)))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.v_catalogo_plano")))).toBe("42501");
    await comoPropietario(db, (tx) => importar(tx, fila));
    expect((await comoIntruso(db, (tx) => tx.query("select * from public.v_catalogo_plano"))).rows).toEqual([]);
  });
});

describe("ensayo completo con un catálogo ficticio de 300 productos", () => {
  // 5 suppliers × 6 models × 2 colours × up to 5 sizes, plus deliberate problems
  const origen = () => {
    const filas = [];
    for (let p = 1; p <= 5; p++) {
      for (let m = 1; m <= 6; m++) {
        for (const color of ["BLANCO", "COLOR"]) {
          for (const talla of ["S", "M", "L", "XL", "XXL"]) {
            const neto = 200 + p * 10 + m + (color === "COLOR" ? 37 : 0);
            filas.push({ proveedor: `Proveedor ${p}`, modelo: `Modelo ${p}-${m}`, color, talla, precio_neto: neto / 100, iva: 0.21 });
          }
        }
      }
    }
    filas.push({ ...filas[0] }); // identical duplicate
    filas.push({ ...filas[1], precio_neto: 9.99 }); // price conflict
    filas.push({ proveedor: "", modelo: "X", color: "C", talla: "S", precio_neto: 1, iva: 0.21 }); // invalid
    return filas;
  };
  const tipos = Object.fromEntries(Array.from({ length: 5 }, (_, p) => Array.from({ length: 6 }, (_, m) => [`proveedor ${p + 1}|modelo ${p + 1}-${m + 1}`, "Camiseta"])).flat());

  it("vista previa → importar → cuadrar → repetir sin duplicar → revertir", async () => {
    const leerVista = (tx) => tx.query("select proveedor, modelo, color, talla, coste_cent, coste::float coste from public.v_catalogo_plano").then((r) => r.rows);
    await comoPropietario(db, async (tx) => {
      const p = prepararCatalogo(origen(), await leerVista(tx), tipos);
      expect(p.resumen).toMatchObject({ leidos: 303, validasUnicas: 299, nuevas: 299, conflictos: 1, invalidas: 1, repetidasIdenticas: 1, proveedores: 5, modelos: 30 });
      expect(p.listoParaImportar).toBe(true);

      const id = await importar(tx, filasParaImportar(p.nuevas));
      const despues = await leerVista(tx);
      expect(despues).toHaveLength(299);
      expect(conciliarCatalogo(p.validas, despues)).toMatchObject({ esperadas: 299, encontradas: 299, correcto: true });
      // decimals preserved: 2.11 × 1.21 = 2.5531
      expect(despues.find((f) => f.modelo === "Modelo 1-1" && f.color === "BLANCO" && f.talla === "L").coste).toBeCloseTo(2.5531, 10);

      const otraVez = prepararCatalogo(origen(), despues, tipos);
      expect(otraVez.resumen).toMatchObject({ nuevas: 0, existentes: 299 });

      await tx.query("select public.revertir_importacion($1)", [id]);
      expect((await tx.query("select (select count(*) from public.variantes)::int v, (select count(*) from public.modelos)::int m, (select count(*) from public.proveedores)::int p")).rows[0]).toEqual({ v: 0, m: 0, p: 0 });
    });
  });
});
