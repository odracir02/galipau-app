// Inventory on a real PostgreSQL (PGlite), FICTITIOUS data.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError } from "./bd.js";

let db;
let V; // variant ids: { negroM, negroL, bolsa }
beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
  V = await comoPropietario(db, async (tx) => {
    const p = (await tx.query("insert into public.proveedores (nombre) values ('Proveedor Ficticio') returning id")).rows[0].id;
    const m = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Camiseta', 'Base') returning id", [p])).rows[0].id;
    const propio = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values (null, 'Bolsa', 'Bolsa de tela') returning id")).rows[0].id;
    const v = async (modelo, color, talla, neto) =>
      (await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje) values ($1, $2, $3, 0, $4, 21) returning id", [modelo, color, talla, neto])).rows[0].id;
    return { negroM: await v(m, "Negro", "M", 2.5), negroL: await v(m, "Negro", "L", 2.5), bolsa: await v(propio, "Natural", "TU", 1.5) };
  });
});
afterEach(async () => {
  await db.close();
});

const registrar = (tx, variante, tipo, cantidad, extra = {}) =>
  tx.query("select public.stock_registrar($1, $2, $3, $4, $5, $6) id", [variante, tipo, cantidad, extra.motivo ?? null, extra.referencia ?? null, extra.coste ?? null]).then((r) => r.rows[0].id);
const stock = (tx, variante) => tx.query("select fisico, reservado, disponible, stock_minimo, bajo_minimo, coste_medio::float coste_medio, valor::float valor from public.v_stock where variante_id = $1", [variante]).then((r) => r.rows[0]);
const reservar = (tx, variante, cantidad, referencia) => tx.query("select public.stock_reservar($1, $2, $3) id", [variante, cantidad, referencia]).then((r) => r.rows[0].id);

describe("existencias iniciales", () => {
  it("se cargan varias referencias a la vez, solo las indicadas y una única vez", async () => {
    await comoPropietario(db, async (tx) => {
      const n = (await tx.query("select public.stock_carga_inicial($1::jsonb) n", [JSON.stringify([{ variante_id: V.negroM, cantidad: 12, coste_unitario: 3.025 }, { variante_id: V.bolsa, cantidad: 30 }])])).rows[0].n;
      expect(n).toBe(2);
      expect(await stock(tx, V.negroM)).toMatchObject({ fisico: 12, reservado: 0, disponible: 12, coste_medio: 3.025 });
      expect(await stock(tx, V.negroL)).toBeUndefined(); // in the catalogue, but no stock
      expect((await tx.query("select tipo, cantidad, motivo from public.stock_movimientos order by id")).rows).toEqual([
        { tipo: "inicial", cantidad: 12, motivo: "Inventario inicial" }, { tipo: "inicial", cantidad: 30, motivo: "Inventario inicial" },
      ]);
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.stock_carga_inicial($1::jsonb)", [JSON.stringify([{ variante_id: V.negroM, cantidad: 1 }])])))).toBe("23505");
    // all or nothing: one bad line rejects the whole load
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.stock_carga_inicial($1::jsonb)", [JSON.stringify([{ variante_id: V.negroL, cantidad: 5 }, { variante_id: V.negroL, cantidad: 0 }])])))).toBe("23514");
    expect(await comoPropietario(db, (tx) => stock(tx, V.negroL))).toBeUndefined();
  });
});

describe("movimientos", () => {
  it("entradas, salidas, devoluciones, mermas y ajustes positivos y negativos", async () => {
    await comoPropietario(db, async (tx) => {
      await registrar(tx, V.negroM, "entrada", 20, { coste: 3, referencia: "Albarán 1" });
      await registrar(tx, V.negroM, "salida", -5, { motivo: "Pedido de prueba" });
      await registrar(tx, V.negroM, "devolucion", 1, { coste: 3 });
      await registrar(tx, V.negroM, "merma", -2, { motivo: "Manchada" });
      await registrar(tx, V.negroM, "ajuste", -1, { motivo: "Recuento" });
      await registrar(tx, V.negroM, "ajuste", 3, { motivo: "Recuento" });
      expect((await stock(tx, V.negroM)).fisico).toBe(16);
      const signos = (await tx.query("select tipo, cantidad, coste_unitario::float c from public.stock_movimientos order by id")).rows;
      expect(signos.map((m) => [m.tipo, m.cantidad, m.c])).toEqual([["entrada", 20, 3], ["salida", -5, null], ["devolucion", 1, 3], ["merma", -2, null], ["ajuste", -1, null], ["ajuste", 3, null]]);
    });
  });

  it.each([
    ["salida", 5, "23514"], // a stock exit must be negative
    ["entrada", -5, "23514"],
    ["ajuste", 2, "22023"], // adjustments need a reason
    ["inicial", 2, "22023"], // opening stock has its own function
  ])("rechaza %s con cantidad %i", async (tipo, cantidad, codigo) => {
    await comoPropietario(db, (tx) => registrar(tx, V.negroM, "entrada", 10));
    expect(await codigoError(() => comoPropietario(db, (tx) => registrar(tx, V.negroM, tipo, cantidad)))).toBe(codigo);
  });

  it("stock insuficiente: no se puede sacar más de lo que hay ni de un artículo sin stock", async () => {
    await comoPropietario(db, (tx) => registrar(tx, V.negroM, "entrada", 3));
    expect(await codigoError(() => comoPropietario(db, (tx) => registrar(tx, V.negroM, "salida", -4)))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => registrar(tx, V.negroL, "salida", -1)))).toBe("P0002");
    expect(await comoPropietario(db, (tx) => stock(tx, V.negroM))).toMatchObject({ fisico: 3 });
  });

  it("corrección auditable: un movimiento compensatorio enlazado; el original no se borra ni se modifica", async () => {
    await comoPropietario(db, async (tx) => {
      const mal = await registrar(tx, V.negroM, "entrada", 50, { coste: 3 });
      await registrar(tx, V.negroM, "entrada", 10, { coste: 4 });
      const c = (await tx.query("select public.stock_corregir($1, 'Eran 5, no 50') id", [mal])).rows[0].id;
      expect((await tx.query("select tipo, cantidad, corrige_movimiento_id from public.stock_movimientos where id = $1", [c])).rows[0]).toEqual({ tipo: "correccion", cantidad: -50, corrige_movimiento_id: mal });
      // the corrected entry no longer counts in the average cost
      expect(await stock(tx, V.negroM)).toMatchObject({ fisico: 10, coste_medio: 4, valor: 40 });
      expect((await tx.query("select count(*)::int n from public.stock_movimientos")).rows[0].n).toBe(3);
    });
    const mal = await comoPropietario(db, (tx) => tx.query("select id from public.stock_movimientos order by id limit 1").then((r) => r.rows[0].id));
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.stock_corregir($1, 'otra vez')", [mal])))).toBe("23505");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.stock_corregir($1, '')", [mal])))).toBe("22023");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.stock_movimientos set cantidad = 1")))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("delete from public.stock_movimientos")))).toBe("42501");
  });

  it("las cantidades solo cambian con las funciones (no se pueden escribir directamente)", async () => {
    await comoPropietario(db, (tx) => registrar(tx, V.negroM, "entrada", 5));
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.stock_articulos set fisico = 999")))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("insert into public.stock_movimientos (articulo_id, tipo, cantidad) select id, 'entrada', 5 from public.stock_articulos")))).toBe("42501");
    await comoPropietario(db, (tx) => tx.query("update public.stock_articulos set stock_minimo = 8, ubicacion = 'Estante A'"));
    expect(await comoPropietario(db, (tx) => stock(tx, V.negroM))).toMatchObject({ stock_minimo: 8, bajo_minimo: true });
  });

  it("el coste de cada entrada se conserva aunque cambie el precio del catálogo", async () => {
    await comoPropietario(db, async (tx) => {
      await registrar(tx, V.negroM, "entrada", 10, { coste: 3.025 });
      await tx.query("update public.variantes set precio_neto = 4 where id = $1", [V.negroM]);
      const s = (await tx.query("select coste_catalogo::float cc, coste_medio::float cm from public.v_stock where variante_id = $1", [V.negroM])).rows[0];
      expect(s).toEqual({ cc: 4.84, cm: 3.025 });
      expect((await tx.query("select coste_unitario::float c from public.stock_movimientos")).rows[0].c).toBe(3.025);
    });
  });
});

describe("reservas", () => {
  it("reducen lo disponible sin tocar lo físico; se liberan; no se duplican", async () => {
    await comoPropietario(db, async (tx) => {
      await registrar(tx, V.negroM, "entrada", 10);
      const r = await reservar(tx, V.negroM, 4, "PED-1");
      expect(await stock(tx, V.negroM)).toMatchObject({ fisico: 10, reservado: 4, disponible: 6 });
      await tx.query("select public.stock_liberar_reserva($1)", [r]);
      expect(await stock(tx, V.negroM)).toMatchObject({ fisico: 10, reservado: 0, disponible: 10 });
      await reservar(tx, V.negroM, 4, "PED-1"); // allowed again once released
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => reservar(tx, V.negroM, 1, "ped-1")))).toBe("23505");
  });

  it("no se reserva más de lo disponible ni se saca lo reservado", async () => {
    await comoPropietario(db, async (tx) => {
      await registrar(tx, V.negroM, "entrada", 10);
      await reservar(tx, V.negroM, 8, "PED-1");
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => reservar(tx, V.negroM, 3, "PED-2")))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => registrar(tx, V.negroM, "salida", -3)))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => registrar(tx, V.negroL, "entrada", 1).then(() => reservar(tx, V.negroL, 0, "X"))))).toBe("23514");
  });

  it("consumir una reserva (futuros pedidos) crea la salida y descuenta físico y reservado", async () => {
    await comoPropietario(db, async (tx) => {
      await registrar(tx, V.negroM, "entrada", 10);
      const r = await reservar(tx, V.negroM, 4, "PED-9");
      await tx.query("select public.stock_consumir_reserva($1)", [r]);
      expect(await stock(tx, V.negroM)).toMatchObject({ fisico: 6, reservado: 0 });
      expect((await tx.query("select tipo, cantidad, referencia from public.stock_movimientos order by id desc limit 1")).rows[0]).toEqual({ tipo: "salida", cantidad: -4, referencia: "PED-9" });
      expect(await codigoError(() => tx.query("select public.stock_liberar_reserva($1)", [r]))).toBe("22023");
    });
  });

  it("operaciones simultáneas: dos reservas a la vez no pueden coger las mismas unidades", async () => {
    await comoPropietario(db, (tx) => registrar(tx, V.negroM, "entrada", 5));
    const resultados = await Promise.allSettled([
      comoPropietario(db, (tx) => reservar(tx, V.negroM, 4, "PED-A")),
      comoPropietario(db, (tx) => reservar(tx, V.negroM, 4, "PED-B")),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await comoPropietario(db, (tx) => stock(tx, V.negroM))).toMatchObject({ fisico: 5, reservado: 4 });
    // last line of defence: the table itself refuses reserved > physical
    expect(await codigoError(() => db.query("update public.stock_articulos set reservado = 6"))).toBe("23514");
  });
});

describe("compras sugeridas, productos propios y presupuestos", () => {
  it("sugiere comprar lo que falta para el mínimo y las necesidades registradas (sin comprar nada)", async () => {
    await comoPropietario(db, async (tx) => {
      await tx.query("select public.stock_carga_inicial($1::jsonb)", [JSON.stringify([{ variante_id: V.bolsa, cantidad: 2 }])]);
      await tx.query("update public.stock_articulos set stock_minimo = 10");
      await tx.query("insert into public.stock_necesidades (variante_id, cantidad, referencia) values ($1, 6, 'Encargo futuro')", [V.negroL]);
      const c = (await tx.query("select modelo, propio, disponible, stock_minimo, necesidades::int necesidades, sugerido::int sugerido from public.v_stock_compras order by modelo")).rows;
      expect(c).toEqual([
        { modelo: "Base", propio: false, disponible: 0, stock_minimo: 0, necesidades: 6, sugerido: 6 },
        { modelo: "Bolsa de tela", propio: true, disponible: 2, stock_minimo: 10, necesidades: 0, sugerido: 8 },
      ]);
      expect((await tx.query("select count(*)::int n from public.stock_movimientos")).rows[0].n).toBe(1);
    });
  });

  it("crear y presentar presupuestos no modifica el stock", async () => {
    await comoPropietario(db, async (tx) => {
      await registrar(tx, V.negroM, "entrada", 10);
      await tx.query("select public.crear_version_parametros('serigrafia', '{}'::jsonb)");
      const entrada = JSON.stringify({ lineas: [{ cantidad: 8, precioUnitario: 3 }], formulario: { lineas: [{ productoId: String(V.negroM), quantity: "8" }] } });
      const { id } = (await tx.query("insert into public.presupuestos (cliente_nombre, tecnica, parametros_version, motor, entrada, resultado, total_cent, precio_final_cent) values ('C', 'serigrafia', 1, 'm', $1, '{}', 100, 100) returning id", [entrada])).rows[0];
      await tx.query("update public.presupuestos set estado = 'presentado' where id = $1", [id]);
      await tx.query("update public.presupuestos set estado = 'aceptado' where id = $1", [id]);
      expect(await stock(tx, V.negroM)).toMatchObject({ fisico: 10, reservado: 0 });
      expect((await tx.query("select count(*)::int n from public.stock_reservas")).rows[0].n).toBe(0);
    });
  });
});

describe("seguridad", () => {
  it("otra cuenta y un visitante anónimo no ven ni mueven stock", async () => {
    await comoPropietario(db, (tx) => registrar(tx, V.negroM, "entrada", 10));
    expect((await comoIntruso(db, (tx) => tx.query("select * from public.v_stock"))).rows).toEqual([]);
    expect(await codigoError(() => comoIntruso(db, (tx) => registrar(tx, V.negroM, "salida", -1)))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("select public.stock_carga_inicial('[{\"variante_id\": 1, \"cantidad\": 1}]'::jsonb)")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.stock_movimientos")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => registrar(tx, V.negroM, "entrada", 1)))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.stock_articulo_bloqueado($1, true)", [V.negroM])))).toBe("42501");
  });
});
