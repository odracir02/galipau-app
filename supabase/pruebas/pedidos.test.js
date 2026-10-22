// Orders and their link to quotes and inventory, on a real PostgreSQL (PGlite). FICTITIOUS data.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError } from "./bd.js";
import { TRANSICIONES_PEDIDO, ORDEN_ESTADOS } from "../../src/modules/pedidos/domain/pedidos.js";

let db;
let F; // fixture ids: { v1, v2, cliente, presupuesto }
beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
  F = await comoPropietario(db, async (tx) => {
    await tx.query("select public.crear_version_parametros('serigrafia', '{\"margenRecomendado\": 0.3}'::jsonb)");
    const prov = (await tx.query("insert into public.proveedores (nombre) values ('Proveedor Ficticio') returning id")).rows[0].id;
    const modelo = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Camisetas', 'Base') returning id", [prov])).rows[0].id;
    const variante = async (talla) => (await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje) values ($1, 'NEGRO', $2, 0, 2.5, 21) returning id", [modelo, talla])).rows[0].id;
    const v1 = await variante("M");
    const v2 = await variante("L");
    await tx.query("select public.stock_carga_inicial($1::jsonb)", [JSON.stringify([{ variante_id: v1, cantidad: 10, coste_unitario: 3 }, { variante_id: v2, cantidad: 3, coste_unitario: 3 }])]);
    const cliente = (await tx.query("insert into public.clientes (nombre) values ('Club Ficticio') returning id")).rows[0].id;
    return { v1, v2, cliente, presupuesto: await presupuestoAceptado(tx, cliente, v1, v2) };
  });
});
afterEach(async () => {
  await db.close();
});

// An accepted quote: 6 × M and 5 × L from the catalogue, plus a garment typed by hand
const presupuestoAceptado = async (tx, cliente, v1, v2) => {
  const entrada = {
    formulario: {
      lineas: [
        { id: "a", productoId: String(v1), modelo: "Base", color: "NEGRO", size: "M", quantity: "6" },
        { id: "b", productoId: String(v2), modelo: "Base", color: "NEGRO", size: "L", quantity: "5" },
        { id: "c", descripcion: "Delantal del cliente", quantity: "2", precioManual: "0" },
      ],
      zonas: [{ id: 1, nombre: "Pecho", colores: 2 }],
      minutosDiseno: "30",
    },
    lineas: [
      { descripcion: "Base", color: "NEGRO", talla: "M", cantidad: 6, precioUnitario: 3.025 },
      { descripcion: "Base", color: "NEGRO", talla: "L", cantidad: 5, precioUnitario: 3.025 },
      { descripcion: "Delantal del cliente", cantidad: 2, precioUnitario: 0 },
    ],
  };
  const id = (await tx.query(
    `insert into public.presupuestos (cliente_id, cliente_nombre, tecnica, parametros_version, motor, entrada, resultado, total_cent, coste_total_cent, precio_recomendado_cent, precio_final_cent, beneficio_cent)
     values ($1, 'Club Ficticio', 'serigrafia', 1, 'serigrafia-coste-real/2', $2, '{"precio": {"finalCent": 12000}}', 12000, 8000, 11500, 12000, 4000) returning id`,
    [cliente, JSON.stringify(entrada)]
  )).rows[0].id;
  await tx.query("update public.presupuestos set estado = 'presentado' where id = $1", [id]);
  await tx.query("update public.presupuestos set estado = 'aceptado' where id = $1", [id]);
  return id;
};

const convertir = (tx, presupuesto = F.presupuesto, datos = {}) =>
  tx.query("select public.crear_pedido_desde_presupuesto($1, $2::jsonb) id", [presupuesto, JSON.stringify(datos)]).then((r) => r.rows[0].id);
const pedido = (tx, id) => tx.query("select * from public.pedidos where id = $1", [id]).then((r) => r.rows[0]);
const material = (tx, id) =>
  tx.query("select talla, necesario, reservado, usado, merma, devuelto, falta, disponible_almacen, pendiente_comprar, pendiente_recibir from public.v_pedidos_material where pedido_id = $1 order by talla desc", [id]).then((r) => r.rows);
const stock = (tx, v) => tx.query("select fisico, reservado from public.stock_articulos where variante_id = $1", [v]).then((r) => r.rows[0]);
const reservar = (tx, id, lineas, faltantes = false) => tx.query("select public.pedido_reservar($1, $2::jsonb, $3) r", [id, JSON.stringify(lineas), faltantes]).then((r) => r.rows[0].r);
const estado = (tx, id, nuevo, motivo = null) => tx.query("select public.pedido_cambiar_estado($1, $2, $3)", [id, nuevo, motivo]);
const quote = (tx) => tx.query("select estado, precio_final_cent, total_cent, entrada from public.presupuestos where id = $1", [F.presupuesto]).then((r) => r.rows[0]);

describe("conversión de presupuesto a pedido", () => {
  it("copia cliente, prendas, zonas y la instantánea económica sin volver a escribir nada", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx, F.presupuesto, { fecha_entrega: "2026-11-20", instrucciones: "Tinta al agua" });
      const p = await pedido(tx, id);
      expect(p).toMatchObject({ numero: expect.stringMatching(/^P-\d{4}\/001$/), presupuesto_id: F.presupuesto, cliente_id: F.cliente, cliente_nombre: "Club Ficticio",
        estado: "pendiente_preparar", cobro_estado: "pendiente", precio_acordado_cent: 12000, coste_previsto_cent: 8000, instrucciones: "Tinta al agua" });
      expect(p.fecha_entrega.toISOString().slice(0, 10)).toBe("2026-11-20");
      expect(p.economico).toMatchObject({ total_cent: 12000, precio_final_cent: 12000, beneficio_cent: 4000, parametros_version: 1 });
      expect(p.trabajo.zonas).toEqual([{ id: 1, nombre: "Pecho", colores: 2 }]);
      const lineas = (await tx.query("select variante_id, descripcion, cantidad, coste_unitario_previsto::float c from public.pedido_lineas where pedido_id = $1 order by orden", [id])).rows;
      expect(lineas).toEqual([
        { variante_id: F.v1, descripcion: "Base · NEGRO M", cantidad: 6, c: 3.025 },
        { variante_id: F.v2, descripcion: "Base · NEGRO L", cantidad: 5, c: 3.025 },
        { variante_id: null, descripcion: "Delantal del cliente", cantidad: 2, c: 0 },
      ]);
      expect((await tx.query("select tipo from public.pedido_eventos where pedido_id = $1", [id])).rows).toEqual([{ tipo: "creado" }]);
      // accepting and converting never move physical stock
      expect(await stock(tx, F.v1)).toEqual({ fisico: 10, reservado: 0 });
    });
  });

  it("no hay dos pedidos para el mismo presupuesto; tras cancelar el primero, sí se puede volver a crear", async () => {
    const id = await comoPropietario(db, (tx) => convertir(tx));
    expect(await codigoError(() => comoPropietario(db, (tx) => convertir(tx)))).toBe("23505");
    await comoPropietario(db, (tx) => estado(tx, id, "cancelado", "El cliente lo anula"));
    const otro = await comoPropietario(db, (tx) => convertir(tx));
    expect(otro).not.toBe(id);
  });

  it("solo presupuestos aceptados; la numeración es correlativa y única aunque se creen pedidos seguidos", async () => {
    await comoPropietario(db, async (tx) => {
      const borrador = (await tx.query("insert into public.presupuestos (cliente_nombre, motor, entrada, total_cent) values ('X', 'm', '{}', 0) returning id")).rows[0].id;
      await tx.query("savepoint s");
      await expect(convertir(tx, borrador)).rejects.toThrow(/accepted quote/);
      await tx.query("rollback to savepoint s");
      const numeros = [];
      for (let i = 0; i < 5; i++) numeros.push((await pedido(tx, await tx.query("select public.crear_pedido($1::jsonb) id", [JSON.stringify({ cliente_nombre: `C${i}`, precio_acordado_cent: 100, lineas: [{ descripcion: "Bolsa", cantidad: 1 }] })]).then((r) => r.rows[0].id))).numero);
      expect(new Set(numeros).size).toBe(5);
      expect(numeros.map((n) => Number(n.split("/")[1]))).toEqual([1, 2, 3, 4, 5]);
    });
    // the number column is unique as a last line of defence
    expect(await codigoError(() => db.query("update public.pedidos set numero = (select min(numero) from public.pedidos) where id = (select max(id) from public.pedidos)"))).toBe("23505");
  });

  it("el precio acordado y la instantánea no cambian aunque cambien las tarifas o el presupuesto de origen", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await tx.query("update public.variantes set precio_neto = 9.99 where id = $1", [F.v1]);
      await tx.query("select public.crear_version_parametros('serigrafia', '{\"margenRecomendado\": 0.9}'::jsonb)");
      const p = await pedido(tx, id);
      expect(p.precio_acordado_cent).toBe(12000);
      expect((await tx.query("select coste_unitario_previsto::float c from public.pedido_lineas where pedido_id = $1 and variante_id = $2", [id, F.v1])).rows[0].c).toBe(3.025);
    });
  });
});

describe("estados", () => {
  it("transiciones permitidas y rechazadas; cancelar exige motivo", async () => {
    await comoPropietario(db, async (tx) => {
      const ok = (await tx.query(`select array_agg(d || '>' || h order by d, h) t from unnest(array['pendiente_preparar','pendiente_material','listo_produccion','en_produccion','terminado','entregado','cancelado']) d,
        unnest(array['pendiente_preparar','pendiente_material','listo_produccion','en_produccion','terminado','entregado','cancelado']) h where public.pedido_transicion_permitida(d, h)`)).rows[0].t;
      expect(ok).toHaveLength(16);
      // the app's copy of the rules is identical
      const app = ORDEN_ESTADOS.flatMap((d) => TRANSICIONES_PEDIDO[d].map((h) => `${d}>${h}`)).sort();
      expect([...ok].sort()).toEqual(app);
    });
    const id = await comoPropietario(db, (tx) => convertir(tx));
    expect(await codigoError(() => comoPropietario(db, (tx) => estado(tx, id, "entregado")))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => estado(tx, id, "cancelado")))).toBe("22023");
    await comoPropietario(db, async (tx) => {
      for (const e of ["listo_produccion", "en_produccion", "terminado", "entregado"]) await estado(tx, id, e);
      const eventos = (await tx.query("select datos ->> 'hasta' h from public.pedido_eventos where pedido_id = $1 and tipo = 'estado' order by id", [id])).rows.map((r) => r.h);
      expect(eventos).toEqual(["listo_produccion", "en_produccion", "terminado", "entregado"]);
    });
  });

  it("el presupuesto sigue al pedido (producción, finalizado, cobrado) y el cobro va aparte del estado físico", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await estado(tx, id, "listo_produccion");
      expect((await quote(tx)).estado).toBe("aceptado");
      await estado(tx, id, "en_produccion");
      expect((await quote(tx)).estado).toBe("en_produccion");
      await tx.query("select public.pedido_registrar_cobro($1, 5000)", [id]);
      expect((await pedido(tx, id)).cobro_estado).toBe("parcial");
      await estado(tx, id, "terminado");
      expect((await quote(tx)).estado).toBe("finalizado");
      await tx.query("select public.pedido_registrar_cobro($1, 12000)", [id]);
      expect((await pedido(tx, id)).cobro_estado).toBe("cobrado");
      expect((await quote(tx)).estado).toBe("cobrado");
      expect((await pedido(tx, id)).estado).toBe("terminado"); // paying does not deliver
    });
  });
});

describe("reservas", () => {
  it("compara lo necesario con el almacén, reserva solo lo confirmado y registra lo que falta", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      // what is missing counts as "to buy" without noting anything (purchases, 20261028)
      expect(await material(tx, id)).toEqual([
        { talla: "M", necesario: 6, reservado: 0, usado: 0, merma: 0, devuelto: 0, falta: 6, disponible_almacen: 10, pendiente_comprar: 6, pendiente_recibir: 0 },
        { talla: "L", necesario: 5, reservado: 0, usado: 0, merma: 0, devuelto: 0, falta: 5, disponible_almacen: 3, pendiente_comprar: 5, pendiente_recibir: 0 },
      ]);
      // partial reservation: all of M, the 3 available of L; the 2 missing L become a purchase need
      expect(await reservar(tx, id, [{ variante_id: F.v1, cantidad: 6 }, { variante_id: F.v2, cantidad: 3 }], true)).toEqual({ reservadas: 9 });
      expect(await material(tx, id)).toEqual([
        { talla: "M", necesario: 6, reservado: 6, usado: 0, merma: 0, devuelto: 0, falta: 0, disponible_almacen: 4, pendiente_comprar: 0, pendiente_recibir: 0 },
        { talla: "L", necesario: 5, reservado: 3, usado: 0, merma: 0, devuelto: 0, falta: 2, disponible_almacen: 0, pendiente_comprar: 2, pendiente_recibir: 0 },
      ]);
      expect(await stock(tx, F.v1)).toEqual({ fisico: 10, reservado: 6 }); // reserving never moves physical stock
      await tx.query("select public.pedido_necesidad_estado($1, $2, 'pedida')", [id, F.v2]);
      expect((await material(tx, id))[1]).toMatchObject({ pendiente_comprar: 0, pendiente_recibir: 2 });
      const compras = (await tx.query("select necesidades, pendiente_recibir, sugerido from public.v_stock_compras where variante_id = $1", [F.v2])).rows[0];
      expect(compras).toEqual({ necesidades: 0, pendiente_recibir: 2, sugerido: 0 }); // already ordered: not suggested again
      // nothing is purchased automatically
      expect((await tx.query("select count(*)::int n from public.stock_movimientos where tipo = 'entrada'")).rows[0].n).toBe(0);
    });
  });

  it("no se reserva más de lo que el pedido necesita ni de lo disponible", async () => {
    const id = await comoPropietario(db, (tx) => convertir(tx));
    expect(await codigoError(() => comoPropietario(db, (tx) => reservar(tx, id, [{ variante_id: F.v1, cantidad: 7 }])))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => reservar(tx, id, [{ variante_id: F.v2, cantidad: 4 }])))).toBe("23514");
    expect(await comoPropietario(db, (tx) => stock(tx, F.v2))).toEqual({ fisico: 3, reservado: 0 }); // all or nothing
  });

  it("dos pedidos compiten por la misma referencia: el segundo solo puede reservar lo que queda", async () => {
    await comoPropietario(db, async (tx) => {
      const a = await convertir(tx);
      const otroPresupuesto = await presupuestoAceptado(tx, F.cliente, F.v1, F.v2);
      const b = await convertir(tx, otroPresupuesto);
      await reservar(tx, a, [{ variante_id: F.v2, cantidad: 3 }]);
      await tx.query("savepoint s");
      await expect(reservar(tx, b, [{ variante_id: F.v2, cantidad: 1 }])).rejects.toThrow(/0 available/);
      await tx.query("rollback to savepoint s");
      // a second reservation for the same order adds to the first one
      await reservar(tx, b, [{ variante_id: F.v1, cantidad: 2 }]);
      await reservar(tx, b, [{ variante_id: F.v1, cantidad: 3 }]);
      expect((await tx.query("select count(*)::int n, sum(cantidad)::int c from public.stock_reservas where pedido_id = $1 and estado = 'activa'", [b])).rows[0]).toEqual({ n: 1, c: 5 });
      expect(await stock(tx, F.v1)).toEqual({ fisico: 10, reservado: 5 });
    });
  });

  it("liberar devuelve las unidades a disponible y reabre lo que falta", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await reservar(tx, id, [{ variante_id: F.v1, cantidad: 6 }], true);
      expect((await tx.query("select public.pedido_liberar($1, $2) n", [id, F.v1])).rows[0].n).toBe(6);
      expect(await stock(tx, F.v1)).toEqual({ fisico: 10, reservado: 0 });
      expect((await material(tx, id))[0]).toMatchObject({ reservado: 0, falta: 6 });
    });
  });
});

describe("consumo, merma y devolución", () => {
  it("consumir una reserva en partes descuenta una sola vez y conserva la trazabilidad", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await reservar(tx, id, [{ variante_id: F.v1, cantidad: 6 }]);
      await tx.query("select public.pedido_consumir($1, $2, 4)", [id, F.v1]);
      expect(await stock(tx, F.v1)).toEqual({ fisico: 6, reservado: 2 }); // 4 out of physical and of reserved, once
      await tx.query("select public.pedido_consumir($1, $2, 1, 'merma', 'Mancha de tinta')", [id, F.v1]);
      await tx.query("select public.pedido_consumir($1, $2, 1)", [id, F.v1]);
      expect(await stock(tx, F.v1)).toEqual({ fisico: 4, reservado: 0 });
      expect((await material(tx, id))[0]).toMatchObject({ necesario: 6, reservado: 0, usado: 5, merma: 1, falta: 1 }); // the spoiled one is still needed
      const reservas = (await tx.query("select estado, cantidad from public.stock_reservas where pedido_id = $1 order by id", [id])).rows;
      expect(reservas).toEqual([{ estado: "consumida", cantidad: 1 }, { estado: "consumida", cantidad: 4 }, { estado: "consumida", cantidad: 1 }]);
      const movs = (await tx.query("select tipo, cantidad, referencia, reserva_id is not null enlazada from public.stock_movimientos where pedido_id = $1 order by id", [id])).rows;
      expect(movs).toEqual([
        { tipo: "salida", cantidad: -4, referencia: expect.stringMatching(/^P-/), enlazada: true },
        { tipo: "merma", cantidad: -1, referencia: expect.stringMatching(/^P-/), enlazada: true },
        { tipo: "salida", cantidad: -1, referencia: expect.stringMatching(/^P-/), enlazada: true },
      ]);
    });
  });

  it("sin reserva solo se consume de lo disponible si se confirma; una devolución no supera lo que salió", async () => {
    const id = await comoPropietario(db, (tx) => convertir(tx));
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.pedido_consumir($1, $2, 2)", [id, F.v1])))).toBe("23514");
    await comoPropietario(db, async (tx) => {
      await tx.query("select public.pedido_consumir($1, $2, 2, 'salida', null, true)", [id, F.v1]);
      await tx.query("select public.pedido_devolver($1, $2, 1, 'Sobró una')", [id, F.v1]);
      expect(await stock(tx, F.v1)).toEqual({ fisico: 9, reservado: 0 });
      expect((await material(tx, id))[0]).toMatchObject({ usado: 1, devuelto: 1 });
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.pedido_devolver($1, $2, 2)", [id, F.v1])))).toBe("23514");
  });

  it("cancelar libera las reservas activas, cierra las necesidades y no toca lo ya usado", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await reservar(tx, id, [{ variante_id: F.v1, cantidad: 6 }, { variante_id: F.v2, cantidad: 3 }], true);
      await tx.query("select public.pedido_consumir($1, $2, 2)", [id, F.v1]);
      await estado(tx, id, "cancelado", "Anulado por el cliente");
      expect(await stock(tx, F.v1)).toEqual({ fisico: 8, reservado: 0 });
      expect(await stock(tx, F.v2)).toEqual({ fisico: 3, reservado: 0 });
      expect((await tx.query("select estado from public.stock_necesidades where pedido_id = $1", [id])).rows).toEqual([{ estado: "cancelada" }]);
      expect((await quote(tx)).estado).toBe("aceptado"); // the quote is not cancelled automatically
    });
  });

  it("las prendas solo se editan mientras no hay nada reservado ni usado", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await tx.query("select public.pedido_actualizar_lineas($1, $2::jsonb)", [id, JSON.stringify([{ variante_id: F.v1, descripcion: "Base · NEGRO M", cantidad: 8 }])]);
      expect((await material(tx, id))).toHaveLength(1);
      await reservar(tx, id, [{ variante_id: F.v1, cantidad: 1 }]);
      await tx.query("savepoint s");
      await expect(tx.query("select public.pedido_actualizar_lineas($1, $2::jsonb)", [id, JSON.stringify([{ descripcion: "Otra", cantidad: 1 }])])).rejects.toThrow(/Release the reservations/);
      await tx.query("rollback to savepoint s");
    });
  });
});

describe("seguridad", () => {
  it("solo el propietario ve o cambia pedidos; nadie escribe en las tablas sin pasar por las funciones", async () => {
    const id = await comoPropietario(db, (tx) => convertir(tx));
    expect(await comoIntruso(db, (tx) => tx.query("select * from public.pedidos").then((r) => r.rows))).toEqual([]);
    expect(await comoIntruso(db, (tx) => tx.query("select * from public.v_pedidos").then((r) => r.rows))).toEqual([]);
    expect(await codigoError(() => comoIntruso(db, (tx) => estado(tx, id, "listo_produccion")))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => convertir(tx)))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.pedidos")))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.pedidos set precio_acordado_cent = 1 where id = $1", [id])))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.pedido_evento($1, 'datos', 'x')", [id])))).toBe("42501");
  });
});

describe("terminar con consumo automático de lo reservado", () => {
  const preparar = (tx, id) => tx.query("select public.pedido_preparar_terminar($1) r", [id]).then((r) => r.rows[0].r);
  const terminar = (tx, id, esperado) => tx.query("select public.pedido_terminar($1, $2::jsonb) r", [id, JSON.stringify(esperado)]).then((r) => r.rows[0].r);
  const enProduccion = async (tx, id) => {
    await estado(tx, id, "listo_produccion");
    await estado(tx, id, "en_produccion");
  };
  const salidas = (tx, id) => tx.query("select count(*)::int n, coalesce(sum(cantidad), 0)::int c from public.stock_movimientos where pedido_id = $1", [id]).then((r) => r.rows[0]);
  const resumen = (plan) => plan.consumos.map((c) => [c.variante_id, c.cantidad]);
  const soloM = (tx, id) => tx.query("select public.pedido_actualizar_lineas($1, $2::jsonb)", [id, JSON.stringify([{ variante_id: F.v1, descripcion: "Base · NEGRO M", cantidad: 6 }])]);

  it("si faltan prendas no descuenta nada ni lo da por terminado; resuelto, descuenta solo lo pendiente y termina a la vez", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await reservar(tx, id, [{ variante_id: F.v1, cantidad: 6 }, { variante_id: F.v2, cantidad: 3 }], true);
      await enProduccion(tx, id);
      const plan = await preparar(tx, id);
      expect(plan).toMatchObject({ permitido: true, sin_catalogo: [{ descripcion: "Delantal del cliente", cantidad: 2 }] });
      expect(plan.incidencias).toEqual([expect.objectContaining({ variante_id: F.v2, tipo: "faltan", cantidad: 2 })]);
      await tx.query("savepoint s");
      await expect(terminar(tx, id, plan.consumos)).rejects.toThrow(/faltan 2 por reservar/);
      await tx.query("rollback to savepoint s");
      expect((await pedido(tx, id)).estado).toBe("en_produccion");
      expect(await stock(tx, F.v1)).toEqual({ fisico: 10, reservado: 6 }); // nothing discounted
      // the 2 missing L arrive and are reserved
      await tx.query("select public.stock_registrar($1, 'entrada', 2, null, 'Albarán ficticio', 3)", [F.v2]);
      await reservar(tx, id, [{ variante_id: F.v2, cantidad: 2 }]);
      const listo = await preparar(tx, id);
      expect(listo.incidencias).toEqual([]);
      expect(resumen(listo)).toEqual([[F.v1, 6], [F.v2, 5]]);
      expect(await terminar(tx, id, listo.consumos)).toMatchObject({ consumidas: 11 });
      expect((await pedido(tx, id)).estado).toBe("terminado");
      expect(await stock(tx, F.v1)).toEqual({ fisico: 4, reservado: 0 });
      expect(await stock(tx, F.v2)).toEqual({ fisico: 0, reservado: 0 });
      expect((await material(tx, id)).map((m) => [m.talla, m.usado, m.reservado, m.falta])).toEqual([["M", 6, 0, 0], ["L", 5, 0, 0]]);
      expect((await quote(tx)).estado).toBe("finalizado");
      const movs = (await tx.query("select tipo, cantidad, reserva_id is not null enlazada, motivo from public.stock_movimientos where pedido_id = $1 order by id", [id])).rows;
      expect(movs).toEqual([
        { tipo: "salida", cantidad: -6, enlazada: true, motivo: "Consumo al terminar el pedido" },
        { tipo: "salida", cantidad: -5, enlazada: true, motivo: "Consumo al terminar el pedido" },
      ]);
      const eventos = (await tx.query("select tipo, descripcion from public.pedido_eventos where pedido_id = $1 and tipo in ('consumo', 'estado') order by id desc limit 2", [id])).rows;
      expect(eventos).toEqual([{ tipo: "estado", descripcion: "Cambio de estado" }, { tipo: "consumo", descripcion: "11 prendas reservadas usadas al terminar" }]);
    });
  });

  it("repetir la acción o reabrir y volver a terminar nunca descuenta dos veces", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await soloM(tx, id);
      await reservar(tx, id, [{ variante_id: F.v1, cantidad: 6 }]);
      await enProduccion(tx, id);
      const plan = await preparar(tx, id);
      await terminar(tx, id, plan.consumos);
      const antes = await salidas(tx, id);
      await tx.query("savepoint s");
      await expect(terminar(tx, id, plan.consumos)).rejects.toThrow(/cannot be finished from state terminado/); // a second click or another device
      await tx.query("rollback to savepoint s");
      await estado(tx, id, "en_produccion"); // reopened
      const otra = await preparar(tx, id);
      expect(otra.consumos).toEqual([]);
      await terminar(tx, id, []);
      expect(await salidas(tx, id)).toEqual(antes);
      expect(await stock(tx, F.v1)).toEqual({ fisico: 4, reservado: 0 });
    });
  });

  it("tiene en cuenta lo anotado a mano: uso parcial y merma previa", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await convertir(tx);
      await soloM(tx, id);
      await reservar(tx, id, [{ variante_id: F.v1, cantidad: 6 }]);
      await enProduccion(tx, id);
      await tx.query("select public.pedido_consumir($1, $2, 2)", [id, F.v1]); // partial use recorded by hand
      await tx.query("select public.pedido_consumir($1, $2, 1, 'merma', 'Mancha')", [id, F.v1]); // one spoiled
      const plan = await preparar(tx, id);
      expect(plan.incidencias).toEqual([expect.objectContaining({ tipo: "faltan", cantidad: 1, mensaje: expect.stringMatching(/hubo 1 estropeadas/) })]);
      await reservar(tx, id, [{ variante_id: F.v1, cantidad: 1 }]); // the replacement
      const listo = await preparar(tx, id);
      expect(resumen(listo)).toEqual([[F.v1, 4]]); // 6 needed - 2 already used
      await terminar(tx, id, listo.consumos);
      expect((await material(tx, id))[0]).toMatchObject({ usado: 6, merma: 1, reservado: 0, falta: 0 });
      expect(await stock(tx, F.v1)).toEqual({ fisico: 3, reservado: 0 }); // 10 - 2 - 1 - 4
    });
  });

  it("reservas de más, cambios entre el resumen y la confirmación, y estados no permitidos: nada cambia", async () => {
    const id = await comoPropietario(db, async (tx) => {
      const nuevo = await convertir(tx);
      await soloM(tx, nuevo);
      await reservar(tx, nuevo, [{ variante_id: F.v1, cantidad: 6 }]);
      return nuevo;
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => terminar(tx, id, [{ variante_id: F.v1, cantidad: 6 }])))).toBe("23514"); // not in production yet
    await comoPropietario(db, (tx) => enProduccion(tx, id));
    // the summary said 6, but meanwhile 2 were recorded by hand: the confirmation no longer matches
    await comoPropietario(db, (tx) => tx.query("select public.pedido_consumir($1, $2, 2)", [id, F.v1]));
    expect(await codigoError(() => comoPropietario(db, (tx) => terminar(tx, id, [{ variante_id: F.v1, cantidad: 6 }])))).toBe("40001");
    // an extra reservation made from the inventory with this order's id
    await comoPropietario(db, (tx) => tx.query("select public.stock_reservar($1, 1, 'Extra ficticia', $2)", [F.v1, id]));
    const plan = await comoPropietario(db, (tx) => preparar(tx, id));
    expect(plan.incidencias).toEqual([expect.objectContaining({ tipo: "reservadas_de_mas", cantidad: 1 })]);
    expect(await codigoError(() => comoPropietario(db, (tx) => terminar(tx, id, [{ variante_id: F.v1, cantidad: 4 }])))).toBe("23514");
    expect(await comoPropietario(db, async (tx) => [(await pedido(tx, id)).estado, await stock(tx, F.v1)])).toEqual(["en_produccion", { fisico: 8, reservado: 5 }]);
    // only the owner
    expect(await codigoError(() => comoIntruso(db, (tx) => preparar(tx, id)))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => terminar(tx, id, [])))).toBe("42501");
  });
});
