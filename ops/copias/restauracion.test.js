// End-to-end backup/restore test with FICTITIOUS data and the real pg_dump
// (compiled to WebAssembly): dump -> restore into an isolated database -> verify.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import { crearBd, comoPropietario } from "../../supabase/pruebas/bd.js";
import { compararManifiestos } from "./verificar-manifiesto.mjs";
import { limpiarVolcado, restaurarConEsquema, restaurarSobreMigraciones, calcularManifiesto, comprobarIntegridad } from "./restauracion.mjs";

const ARGS_ESQUEMA = ["--schema=public", "--schema-only", "--no-owner", "--no-privileges"];
const ARGS_DATOS = ["--schema=public", "--data-only", "--inserts", "--column-inserts", "--no-owner", "--no-privileges"];

let origen, copia, manifiestoOrigen;

beforeAll(async () => {
  // 1. Fictitious data: catalogue, customers, a quote with JSON and amounts, backup log
  origen = await crearBd();
  await origen.exec(fs.readFileSync(new URL("../../supabase/datos-ficticios.sql", import.meta.url), "utf8"));
  await comoPropietario(origen, async (tx) => {
    const cliente = (await tx.query("select id from public.clientes order by id limit 1")).rows[0].id;
    const { id } = (await tx.query(
      "insert into public.presupuestos (cliente_id, cliente_nombre, motor, entrada, resultado, total_cent, precio_final_cent, fecha_emision, valido_hasta, notas) values ($1, 'Club Deportivo Ficticio', 'legacy', $2, $3, 3390, 3390, '2026-10-15', '2026-11-15', 'Comillas '' y tildes: camión, ñ') returning id",
      [cliente, JSON.stringify({ bloques: [{ estampado: "DTF", area: "300" }] }), JSON.stringify({ total: 33.9 })]
    )).rows[0];
    // Presented and accepted: number, version and state log are set by the database and must survive the restore
    await tx.query("update public.presupuestos set estado = 'presentado' where id = $1", [id]);
    await tx.query("update public.presupuestos set estado = 'aceptado' where id = $1", [id]);
    // Stock with an opening load, an entry, a correction and an active reservation
    const variante = (await tx.query("select id from public.variantes order by id desc limit 1")).rows[0].id; // not the row the tamper test removes
    await tx.query("select public.stock_carga_inicial($1::jsonb)", [JSON.stringify([{ variante_id: variante, cantidad: 12, coste_unitario: 3.025 }])]);
    const entrada = (await tx.query("select public.stock_registrar($1, 'entrada', 30, null, 'Albarán ficticio', 3.1) id", [variante])).rows[0].id;
    await tx.query("select public.stock_corregir($1, 'Eran 3')", [entrada]);
    await tx.query("select public.stock_registrar($1, 'entrada', 3, null, 'Albarán ficticio', 3.1)", [variante]);
    await tx.query("select public.stock_reservar($1, 5, 'PED-FICTICIO')", [variante]);
    // An order with a reservation, a partial consumption and a purchase need (orders reference stock and stock references orders' rows)
    const pedido = (await tx.query("select public.crear_pedido($1::jsonb) id", [JSON.stringify({ cliente_nombre: "Club Deportivo Ficticio", precio_acordado_cent: 5000, lineas: [{ variante_id: variante, descripcion: "Prenda ficticia", cantidad: 40 }] })])).rows[0].id;
    await tx.query("select public.pedido_reservar($1, $2::jsonb, true)", [pedido, JSON.stringify([{ variante_id: variante, cantidad: 10 }])]);
    await tx.query("select public.pedido_consumir($1, $2, 4)", [pedido, variante]);
    await tx.query("select public.pedido_cambiar_estado($1, 'pendiente_material')", [pedido]);
  });
  await origen.exec("insert into public.registro_copias (tipo, estado, detalle) values ('base_datos', 'correcta', '{\"prueba\": true}')");
  // As in production: suppliers created by a catalogue import (proveedores -> importaciones) and a
  // price-list import of a supplier (importaciones -> proveedores). Both must restore.
  const imp = (await origen.query("insert into public.importaciones (tipo, resumen) values ('catalogo_firestore', '{}') returning id")).rows[0].id;
  await origen.query("update public.proveedores set importacion_id = $1", [imp]);
  await comoPropietario(origen, async (tx) => {
    const prov = (await tx.query("select min(id) id from public.proveedores")).rows[0].id;
    await tx.query("select public.importar_tarifa($1::jsonb, $2::jsonb, gen_random_uuid(), 1, 1)", [
      JSON.stringify({ proveedor_id: prov, modalidad: "tarifa", interpretacion: "neto", iva: 21 }),
      JSON.stringify([{ accion: "alta", modelo: { nombre: "Modelo de tarifa ficticio", tipo: "Sin clasificar", marca: "Marca Ficticia" }, color: "ROJO", talla: "M", precio: { precio_neto: 1.5, iva_porcentaje: 21 }, modalidad: "tarifa", tarifas: [{ modalidad: "tarifa", precio: 1.5 }] }]),
    ]);
  });

  // 2. Source manifest, then the backup with the real pg_dump. (The WASM pg_dump
  // leaves this in-process session read-only, so the manifest is taken first;
  // the data does not change in between. In CI both run in the same snapshot.)
  manifiestoOrigen = await calcularManifiesto(origen);
  copia = {
    esquema: await (await pgDump({ pg: origen, args: ARGS_ESQUEMA })).text(),
    datos: await (await pgDump({ pg: origen, args: ARGS_DATOS })).text(),
  };
}, 60_000);

afterAll(async () => {
  await origen?.close();
});

describe("volcado", () => {
  it("contiene la estructura, la seguridad y los datos esperados", () => {
    expect(copia.esquema).toMatch(/CREATE TABLE public\.presupuestos/);
    expect((copia.esquema.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length).toBe(22);
    expect((copia.esquema.match(/CREATE POLICY/g) ?? []).length).toBe(32);
    expect((copia.datos.match(/^INSERT INTO public\.variantes \(/gm) ?? []).length).toBe(37);
    expect(copia.datos).toMatch(/OVERRIDING SYSTEM VALUE/);
    expect(copia.datos).toMatch(/setval\('public\.clientes_id_seq'/);
  });

  it("limpia los metacomandos \\restrict y rechaza cualquier otro", () => {
    expect(limpiarVolcado("\\restrict abc\nselect 1;\n\\unrestrict abc\n")).toBe("select 1;\n");
    expect(() => limpiarVolcado("select 1;\n\\! rm -rf /\n")).toThrow(/meta-command/);
  });
});

describe("restauración en una base de datos aislada", () => {
  it("vía A (estructura de la copia): datos idénticos al origen", async () => {
    const db = await restaurarConEsquema(copia);
    expect(compararManifiestos(manifiestoOrigen, await calcularManifiesto(db))).toEqual([]);
    await db.close();
  });

  it("vía B (migraciones + datos, como en un proyecto de Supabase nuevo): datos idénticos", async () => {
    const db = await restaurarSobreMigraciones(copia);
    expect(compararManifiestos(manifiestoOrigen, await calcularManifiesto(db))).toEqual([]);
    await db.close();
  });

  it("conserva relaciones, importes, RLS y restricciones", async () => {
    const db = await restaurarConEsquema(copia);
    const r = await comprobarIntegridad(db);
    expect(r.tablasSinRls).toEqual([]);
    expect(r.huerfanos).toEqual({ modelos_sin_proveedor: 0, variantes_sin_modelo: 0, presupuestos_sin_cliente: 0 });
    expect(r.importes.totalPresupuestosCent).toBe(3390);
    const coste = Number((await origen.query("select sum(coste_cent) s from public.variantes")).rows[0].s);
    expect(r.importes.costeVariantesCent).toBe(coste);
    expect(r.restriccionesActivas).toBe(true);
    // texts, JSON and dates intact
    const p = (await db.query("select notas, entrada, fecha_emision::text f from public.presupuestos")).rows[0];
    expect(p).toEqual({ notas: "Comillas ' y tildes: camión, ñ", entrada: { bloques: [{ estampado: "DTF", area: "300" }] }, f: "2026-10-15" });
    await db.close();
  });

  it("la numeración continúa después de restaurar (secuencias y contadores)", async () => {
    const db = await restaurarSobreMigraciones(copia);
    await db.query("insert into public.propietario (user_id) select user_id from public.propietario on conflict do nothing");
    const id = (await db.query("insert into public.clientes (nombre) values ('Nuevo tras restaurar') returning id")).rows[0].id;
    const maxPrevio = Number((await origen.query("select max(id) m from public.clientes")).rows[0].m);
    expect(Number(id)).toBeGreaterThan(maxPrevio);
    const { rows } = await db.query("select ultimo from public.contadores where serie = 'PRES' and anio = 2026");
    expect(rows[0].ultimo).toBe(1);
    const restaurado = (await db.query("select numero, estado, version, jsonb_array_length(historial_estados) n from public.presupuestos")).rows[0];
    expect(restaurado).toEqual({ numero: "2026/001", estado: "aceptado", version: 1, n: 3 });
    const stock = (await db.query("select fisico, reservado from public.stock_articulos")).rows[0];
    expect(stock).toEqual({ fisico: 11, reservado: 11 }); // 4 used by the order; 5 + 10 - 4 reserved
    expect((await db.query("select count(*)::int n, count(corrige_movimiento_id)::int c from public.stock_movimientos")).rows[0]).toEqual({ n: 5, c: 1 });
    // The next quote presented after the restore gets the next number
    await db.exec("set row_security = on"); // the dump session turns it off
    const siguiente = await comoPropietario(db, async (tx) => {
      const { id: nuevo } = (await tx.query("insert into public.presupuestos (cliente_nombre, motor, entrada, resultado, total_cent, precio_final_cent, fecha_emision) values ('X', 'serigrafia-coste-real/2', '{}', '{}', 100, 100, '2026-10-20') returning id")).rows[0];
      return (await tx.query("update public.presupuestos set estado = 'presentado' where id = $1 returning numero", [nuevo])).rows[0].numero;
    });
    expect(siguiente).toBe("2026/002");
    // orders keep their state, reservations and needs, and the next order gets the next number
    const pedido = (await db.query("select numero, estado from public.pedidos")).rows[0];
    expect(pedido.estado).toBe("pendiente_material");
    expect((await db.query("select estado, cantidad from public.stock_necesidades where pedido_id is not null")).rows).toEqual([{ estado: "pendiente", cantidad: 30 }]); // 40 needed - 10 reserved (4 of them used)
    const nuevoPedido = await comoPropietario(db, async (tx) => {
      const { id } = (await tx.query("select public.crear_pedido($1::jsonb) id", [JSON.stringify({ cliente_nombre: "Y", precio_acordado_cent: 1, lineas: [] })])).rows[0];
      return (await tx.query("select numero from public.pedidos where id = $1", [id])).rows[0].numero;
    });
    expect(Number(nuevoPedido.split("/")[1])).toBe(Number(pedido.numero.split("/")[1]) + 1);
    await db.close();
  });

  it("detecta una copia incompleta o alterada", async () => {
    const lineas = copia.datos.split("\n");
    const sinUnaFila = lineas.filter((l, i) => i !== lineas.findIndex((x) => x.startsWith("INSERT INTO public.variantes"))).join("\n");
    const db = await restaurarConEsquema({ esquema: copia.esquema, datos: sinUnaFila });
    expect(compararManifiestos(manifiestoOrigen, await calcularManifiesto(db))).toContain("variantes: 37 rows in source, 36 restored");
    await db.close();

    const alterada = copia.datos.replace("3390", "3391");
    const db2 = await restaurarConEsquema({ esquema: copia.esquema, datos: alterada });
    expect(compararManifiestos(manifiestoOrigen, await calcularManifiesto(db2))).toEqual(["presupuestos: same row count but different content"]);
    await db2.close();
  });
});
