// Supplier price-list imports on a real PostgreSQL (PGlite), FICTITIOUS data.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError } from "./bd.js";

let db;
let B; // { proveedor, modelo, blancoM, blancoL }
beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
  B = await comoPropietario(db, async (tx) => {
    const proveedor = (await tx.query("insert into public.proveedores (nombre) values ('Textil Ficticio') returning id")).rows[0].id;
    const modelo = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre, referencia) values ($1, 'Camiseta', 'Basica', 'F100') returning id", [proveedor])).rows[0].id;
    const v = async (color, talla) =>
      (await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje) values ($1, $2, $3, 0, 1.5, 21) returning id", [modelo, color, talla])).rows[0].id;
    return { proveedor, modelo, blancoM: await v("BLANCO", "M"), blancoL: await v("BLANCO", "L") };
  });
});
afterEach(async () => {
  await db.close();
});

const META = { modalidad: "caja", interpretacion: "neto", archivo: { nombre: "tarifa-ficticia.xlsx", sha256: "a".repeat(64), formato: "prueba" }, resumen: { altas: 1 } };
const importar = (tx, operaciones, meta = {}) =>
  tx.query("select public.importar_tarifa($1::jsonb, $2::jsonb) id", [JSON.stringify({ ...META, proveedor_id: B.proveedor, ...meta }), JSON.stringify(operaciones)]).then((r) => r.rows[0].id);
const revertir = (tx, id) => tx.query("select public.revertir_tarifa($1) r", [id]).then((r) => r.rows[0].r);
const variante = (tx, id) =>
  tx.query("select activo, precio_neto::float neto, iva_porcentaje::float iva, coste_cent from public.variantes where id = $1", [id]).then((r) => r.rows[0]);
const tarifas = (tx, id) => tx.query("select modalidad, precio::float precio, unidades from public.variantes_tarifas where variante_id = $1 order by modalidad", [id]).then((r) => r.rows);
const TARIFAS = (caja) => [{ modalidad: "caja", precio: caja, unidades: 50 }, { modalidad: "unidad", precio: caja * 1.2 }];

describe("importar una tarifa", () => {
  it("cambia solo los precios indicados, guarda las modalidades alternativas y registra antes/después", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await importar(tx, [{ accion: "precio", variante_id: B.blancoM, precio: { precio_neto: 1.7375, iva_porcentaje: 21 }, tarifas: TARIFAS(1.7375) }]);
      expect(await variante(tx, B.blancoM)).toMatchObject({ neto: 1.7375, iva: 21, coste_cent: 210 }); // 1.7375 × 1.21 = 2.102375 €
      expect(await variante(tx, B.blancoL)).toMatchObject({ neto: 1.5 }); // not in the operations: untouched
      expect(await tarifas(tx, B.blancoM)).toEqual([{ modalidad: "caja", precio: 1.7375, unidades: 50 }, { modalidad: "unidad", precio: 2.085, unidades: null }]);
      const imp = (await tx.query("select tipo, proveedor_id, usuario, resumen from public.importaciones where id = $1", [id])).rows[0];
      expect(imp).toMatchObject({ tipo: "tarifa_proveedor", proveedor_id: B.proveedor, usuario: "11111111-1111-1111-1111-111111111111" });
      expect(imp.resumen.archivo.sha256).toBe("a".repeat(64));
      const cambio = (await tx.query("select accion, antes, despues from public.importaciones_cambios where importacion_id = $1", [id])).rows[0];
      expect(cambio.accion).toBe("precio");
      expect(cambio.antes).toMatchObject({ precio_neto: 1.5, tarifas: [] });
      expect(cambio.despues).toMatchObject({ precio_neto: 1.7375 });
      expect((await tx.query("select modalidad_tarifa from public.proveedores where id = $1", [B.proveedor])).rows[0].modalidad_tarifa).toBe("caja");
    });
  });

  it("da de alta variantes y modelos nuevos, reutilizando el modelo por referencia y sin duplicar color/talla", async () => {
    await comoPropietario(db, async (tx) => {
      await importar(tx, [
        { accion: "alta", modelo: { nombre: "Basica (nombre nuevo)", referencia: "F100", tipo: "Camiseta" }, color: "NEGRO", talla: "M", precio: { precio_neto: 2, iva_porcentaje: 21 }, tarifas: TARIFAS(2) },
        { accion: "alta", modelo: { nombre: "Sudadera", referencia: "F200", tipo: "Sudadera", marca: "Marca Ficticia" }, color: "BLANCO", talla: "XL", precio: { precio_neto: 9, iva_porcentaje: 21 } },
      ]);
      const filas = (await tx.query("select m.nombre, m.marca, v.color, v.talla from public.variantes v join public.modelos m on m.id = v.modelo_id order by v.id")).rows;
      expect(filas.slice(2)).toEqual([{ nombre: "Basica", marca: null, color: "NEGRO", talla: "M" }, { nombre: "Sudadera", marca: "Marca Ficticia", color: "BLANCO", talla: "XL" }]);
    });
    // an existing colour/size is rejected (it must arrive as a price change) and nothing is saved
    const op = { accion: "alta", modelo: { nombre: "Basica", referencia: "F100", tipo: "Camiseta" }, color: "blanco", talla: "m", precio: { precio_neto: 3, iva_porcentaje: 21 } };
    expect(await codigoError(() => comoPropietario(db, (tx) => importar(tx, [op])))).toBe("23505");
    expect(await comoPropietario(db, (tx) => tx.query("select count(*)::int n from public.importaciones").then((r) => r.rows[0].n))).toBe(1);
  });

  it("crea el proveedor si no existe y rellena la referencia que le faltaba a un modelo", async () => {
    await comoPropietario(db, async (tx) => {
      const sinRef = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Gorra', 'Gorra Lisa') returning id", [B.proveedor])).rows[0].id;
      await importar(tx, [{ accion: "alta", modelo: { nombre: "gorra lisa", referencia: "G9", tipo: "Gorra" }, color: "ROJO", talla: "TU", precio: { precio_neto: 1, iva_porcentaje: 21 } }]);
      expect((await tx.query("select referencia from public.modelos where id = $1", [sinRef])).rows[0].referencia).toBe("G9");
      await tx.query("select public.importar_tarifa($1::jsonb, $2::jsonb)", [
        JSON.stringify({ ...META, proveedor_nombre: "Proveedor Nuevo Ficticio" }),
        JSON.stringify([{ accion: "alta", modelo: { nombre: "Polo", tipo: "Polo" }, color: "AZUL", talla: "S", precio: { precio_neto: 4, iva_porcentaje: 21 } }]),
      ]);
      expect((await tx.query("select count(*)::int n from public.proveedores where nombre = 'Proveedor Nuevo Ficticio'")).rows[0].n).toBe(1);
    });
  });

  it("nada que importar, operación desconocida o variante inexistente: error y no se guarda nada", async () => {
    expect(await codigoError(() => comoPropietario(db, (tx) => importar(tx, [])))).toBe("22023");
    expect(await codigoError(() => comoPropietario(db, (tx) => importar(tx, [{ accion: "borrar_todo" }])))).toBe("22023");
    expect(await codigoError(() => comoPropietario(db, (tx) => importar(tx, [{ accion: "precio", variante_id: B.blancoM, precio: { precio_neto: 9, iva_porcentaje: 21 } }, { accion: "precio", variante_id: 999999, precio: { precio_neto: 1, iva_porcentaje: 21 } }])))).toBe("P0002");
    expect(await comoPropietario(db, (tx) => variante(tx, B.blancoM))).toMatchObject({ neto: 1.5 });
  });
});

describe("revertir una tarifa", () => {
  it("restaura precios y modalidades, borra las altas sin uso y archiva las que tienen stock", async () => {
    await comoPropietario(db, async (tx) => {
      await tx.query("insert into public.variantes_tarifas (variante_id, modalidad, precio) values ($1, 'caja', 1.4)", [B.blancoM]);
      const id = await importar(tx, [
        { accion: "precio", variante_id: B.blancoM, precio: { precio_neto: 1.8, iva_porcentaje: 21 }, tarifas: TARIFAS(1.8) },
        { accion: "alta", modelo: { nombre: "Basica", referencia: "F100", tipo: "Camiseta" }, color: "NEGRO", talla: "S", precio: { precio_neto: 2, iva_porcentaje: 21 } },
        { accion: "alta", modelo: { nombre: "Bolsa", referencia: "B1", tipo: "Bolsa" }, color: "NATURAL", talla: "TU", precio: { precio_neto: 0.9, iva_porcentaje: 21 } },
        { accion: "archivar", variante_id: B.blancoL },
      ]);
      const bolsa = (await tx.query("select v.id from public.variantes v join public.modelos m on m.id = v.modelo_id where m.nombre = 'Bolsa'")).rows[0].id;
      await tx.query("select public.stock_registrar($1, 'entrada', 10, null, null, null)", [bolsa]);
      const r = await revertir(tx, id);
      expect(r).toMatchObject({ precios_restaurados: 1, precios_conservados: 0, variantes_borradas: 1, variantes_archivadas: 1, reactivadas: 1, modelos_borrados: 0 });
      expect(await variante(tx, B.blancoM)).toMatchObject({ neto: 1.5, coste_cent: 182 });
      expect(await tarifas(tx, B.blancoM)).toEqual([{ modalidad: "caja", precio: 1.4, unidades: null }]);
      expect(await variante(tx, B.blancoL)).toMatchObject({ activo: true });
      expect(await variante(tx, bolsa)).toMatchObject({ activo: false }); // used in stock: archived, never deleted
      expect((await tx.query("select count(*)::int n from public.stock_movimientos")).rows[0].n).toBe(1); // stock untouched
      expect((await tx.query("select revertida_en is not null r from public.importaciones where id = $1", [id])).rows[0].r).toBe(true);
    });
  });

  it("no deshace un precio cambiado después a mano ni se puede revertir dos veces", async () => {
    const id = await comoPropietario(db, (tx) => importar(tx, [{ accion: "precio", variante_id: B.blancoM, precio: { precio_neto: 1.8, iva_porcentaje: 21 } }]));
    await comoPropietario(db, (tx) => tx.query("update public.variantes set precio_neto = 1.95 where id = $1", [B.blancoM]));
    const r = await comoPropietario(db, (tx) => revertir(tx, id));
    expect(r).toMatchObject({ precios_restaurados: 0, precios_conservados: 1 });
    expect(await comoPropietario(db, (tx) => variante(tx, B.blancoM))).toMatchObject({ neto: 1.95 });
    expect(await codigoError(() => comoPropietario(db, (tx) => revertir(tx, id)))).toBe("22023");
    // the generic revert refuses price-list imports
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.revertir_importacion($1)", [id])))).toBe("22023");
  });

  it("una variante nueva usada en un presupuesto se archiva, no se borra", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await importar(tx, [{ accion: "alta", modelo: { nombre: "Basica", referencia: "F100", tipo: "Camiseta" }, color: "VERDE", talla: "M", precio: { precio_neto: 2, iva_porcentaje: 21 } }]);
      const nueva = (await tx.query("select id from public.variantes where color = 'VERDE'")).rows[0].id;
      await tx.query("insert into public.presupuestos (cliente_nombre, motor, entrada, total_cent) values ('Cliente Ficticio', 'm', $1::jsonb, 0)", [
        JSON.stringify({ formulario: { lineas: [{ productoId: String(nueva), quantity: 10 }] } }),
      ]);
      expect(await revertir(tx, id)).toMatchObject({ variantes_borradas: 0, variantes_archivadas: 1 });
      expect(await variante(tx, nueva)).toMatchObject({ activo: false });
    });
  });
});

describe("seguridad", () => {
  it("solo el propietario importa, revierte o lee el registro de cambios", async () => {
    expect(await codigoError(() => comoIntruso(db, (tx) => importar(tx, [{ accion: "archivar", variante_id: B.blancoM }])))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => importar(tx, [{ accion: "archivar", variante_id: B.blancoM }])))).toBe("42501");
    const id = await comoPropietario(db, (tx) => importar(tx, [{ accion: "archivar", variante_id: B.blancoM }]));
    expect(await codigoError(() => comoIntruso(db, (tx) => revertir(tx, id)))).toBe("42501");
    expect(await comoIntruso(db, (tx) => tx.query("select * from public.importaciones_cambios").then((r) => r.rows))).toEqual([]);
    expect(await comoIntruso(db, (tx) => tx.query("select * from public.variantes_tarifas").then((r) => r.rows))).toEqual([]);
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.variantes_tarifas")))).toBe("42501");
  });
});

describe("tarifas grandes por lotes", () => {
  it("varios lotes forman una sola importación, que se cierra con el último y se revierte entera", async () => {
    const alta = (n) => ({ accion: "alta", modelo: { nombre: `Modelo ${Math.floor(n / 4)}`, referencia: `R${Math.floor(n / 4)}`, tipo: "Camiseta", marca: "Marca Ficticia" }, color: "NEGRO", talla: ["S", "M", "L", "XL"][n % 4], precio: { precio_neto: 1.2345, iva_porcentaje: 21 }, tarifas: TARIFAS(1.2345) });
    const ops = Array.from({ length: 1200 }, (_, n) => alta(n));
    const lote = (tx, desde, hasta, id, completa) =>
      tx.query("select public.importar_tarifa($1::jsonb, $2::jsonb, $3) id", [JSON.stringify(id ? { completa } : { ...META, proveedor_id: B.proveedor, completa }), JSON.stringify(ops.slice(desde, hasta)), id]).then((r) => r.rows[0].id);
    const id = await comoPropietario(db, (tx) => lote(tx, 0, 500, null, false));
    expect(await comoPropietario(db, (tx) => lote(tx, 500, 1000, id, false))).toBe(id);
    await comoPropietario(db, (tx) => lote(tx, 1000, 1200, id, true));
    await comoPropietario(db, async (tx) => {
      expect((await tx.query("select resumen ->> 'lotes' lotes, resumen ->> 'completa' completa from public.importaciones where id = $1", [id])).rows[0]).toEqual({ lotes: "3", completa: "true" });
      expect((await tx.query("select count(*)::int n from public.variantes where importacion_id = $1", [id])).rows[0].n).toBe(1200);
      expect((await tx.query("select count(distinct modelo_id)::int n, min(marca) marca from public.v_catalogo_admin where marca is not null")).rows[0]).toEqual({ n: 300, marca: "Marca Ficticia" });
      expect((await tx.query("select count(*)::int n from public.v_catalogo_plano where marca = 'Marca Ficticia'")).rows[0].n).toBe(1200);
      expect((await tx.query("select count(*)::int n from public.variantes_tarifas")).rows[0].n).toBe(2400);
    });
    // a complete import does not accept more batches
    expect(await codigoError(() => comoPropietario(db, (tx) => lote(tx, 0, 1, id, true)))).toBe("22023");
    const r = await comoPropietario(db, (tx) => revertir(tx, id));
    expect(r).toMatchObject({ variantes_borradas: 1200, modelos_borrados: 300 });
  }, 120000);

  it("el modelo elegido en la vista previa se usa por su id y debe ser del proveedor", async () => {
    await comoPropietario(db, async (tx) => {
      await importar(tx, [{ accion: "alta", modelo: { id: B.modelo, nombre: "Otro nombre", tipo: "Camiseta" }, color: "AZUL", talla: "M", precio: { precio_neto: 2, iva_porcentaje: 21 } }]);
      expect((await tx.query("select modelo_id from public.variantes where color = 'AZUL'")).rows[0].modelo_id).toBe(B.modelo);
      const ajeno = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values (null, 'Bolsa', 'Propia') returning id")).rows[0].id;
      await tx.query("savepoint s");
      await expect(importar(tx, [{ accion: "alta", modelo: { id: ajeno, nombre: "Propia", tipo: "Bolsa" }, color: "ROJO", talla: "TU", precio: { precio_neto: 1, iva_porcentaje: 21 } }])).rejects.toThrow(/does not belong/);
      await tx.query("rollback to savepoint s");
    });
  });
});

describe("marca, referencia y modalidad de cada variante", () => {
  it("completa solo la marca o la referencia vacías, nunca sobrescribe, y la reversión las vacía si nadie las cambió", async () => {
    await comoPropietario(db, async (tx) => {
      const sinNada = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Polo', 'Polo Liso') returning id", [B.proveedor])).rows[0].id;
      const id = await importar(tx, [
        { accion: "completar_modelo", modelo_id: B.modelo, referencia: "OTRA", marca: "Marca Ficticia" }, // already has reference F100
        { accion: "completar_modelo", modelo_id: sinNada, referencia: "P7", marca: "Marca Ficticia" },
      ]);
      const modelo = (m) => tx.query("select referencia, marca from public.modelos where id = $1", [m]).then((r) => r.rows[0]);
      expect(await modelo(B.modelo)).toEqual({ referencia: "F100", marca: "Marca Ficticia" });
      expect(await modelo(sinNada)).toEqual({ referencia: "P7", marca: "Marca Ficticia" });
      expect((await tx.query("select marca from public.v_catalogo_plano where id = $1", [B.blancoM])).rows[0].marca).toBe("Marca Ficticia");
      await tx.query("update public.modelos set marca = 'Cambiada a mano' where id = $1", [sinNada]);
      expect(await revertir(tx, id)).toMatchObject({ datos_modelo_restaurados: 2 });
      expect(await modelo(B.modelo)).toEqual({ referencia: "F100", marca: null });
      expect(await modelo(sinNada)).toEqual({ referencia: null, marca: "Cambiada a mano" }); // later manual change kept
    });
  });

  it("cada variante guarda de qué modalidad sale su precio, y la reversión la restaura", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await importar(tx, [
        { accion: "alta", modelo: { id: B.modelo, nombre: "Basica", tipo: "Camiseta" }, color: "VERDE", talla: "S", precio: { precio_neto: 5.25, iva_porcentaje: 21 }, modalidad: "pack", tarifas: [{ modalidad: "caja", precio: 5, unidades: 20 }, { modalidad: "pack", precio: 5.25, unidades: 1 }] },
        { accion: "precio", variante_id: B.blancoM, precio: { precio_neto: 1.6, iva_porcentaje: 21 }, modalidad: "unidad" },
      ]);
      const filas = (await tx.query("select color, modalidad, precio_neto::float neto, coste_cent from public.variantes where color = 'VERDE' or id = $1 order by id", [B.blancoM])).rows;
      expect(filas).toEqual([{ color: "BLANCO", modalidad: "unidad", neto: 1.6, coste_cent: 194 }, { color: "VERDE", modalidad: "pack", neto: 5.25, coste_cent: 635 }]);
      await revertir(tx, id);
      expect((await tx.query("select modalidad, precio_neto::float neto from public.variantes where id = $1", [B.blancoM])).rows[0]).toEqual({ modalidad: null, neto: 1.5 });
    });
  });
});
