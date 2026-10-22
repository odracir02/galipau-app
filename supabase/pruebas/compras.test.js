// Purchases from suppliers on a real PostgreSQL (PGlite). FICTITIOUS data.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError } from "./bd.js";

let db;
let F; // fixture ids: { prov, otro, m, l, xl, ajena, propia }
beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
  F = await comoPropietario(db, async (tx) => {
    const proveedor = async (nombre, web = null) => (await tx.query("insert into public.proveedores (nombre, web) values ($1, $2) returning id", [nombre, web])).rows[0].id;
    const prov = await proveedor("Proveedor Ficticio", "https://proveedor.example.com");
    const otro = await proveedor("Otro Proveedor");
    const modelo = async (p, nombre, referencia) => (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre, referencia) values ($1, 'Camisetas', $2, $3) returning id", [p, nombre, referencia])).rows[0].id;
    const base = await modelo(prov, "Base", "B-100");
    const variante = async (m, talla, neto = 2.5) => (await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje) values ($1, 'NEGRO', $2, 0, $3, 21) returning id", [m, talla, neto])).rows[0].id;
    const m = await variante(base, "M");
    const l = await variante(base, "L");
    const xl = await variante(base, "XL");
    const ajena = await variante(await modelo(otro, "Otra", "O-1"), "M", 3);
    const propia = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values (null, 'Bolsas', 'Bolsa propia') returning id")).rows[0].id;
    const vPropia = (await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent, precio_compra) values ($1, 'Natural', 'TU', 0, 1.8) returning id", [propia])).rows[0].id;
    await tx.query("select public.stock_carga_inicial($1::jsonb)", [JSON.stringify([{ variante_id: m, cantidad: 3, coste_unitario: 3 }, { variante_id: vPropia, cantidad: 1 }])]);
    await tx.query("update public.stock_articulos set stock_minimo = 5 where variante_id = $1", [vPropia]); // own product below minimum: never bought here
    await tx.query("insert into public.variantes_tarifas (variante_id, modalidad, precio, unidades) values ($1, 'Caja', 2.3, 50)", [l]);
    return { prov, otro, m, l, xl, ajena, propia: vPropia };
  });
});
afterEach(async () => {
  await db.close();
});

const crearPedido = (tx, fecha, lineas) =>
  tx.query("select public.crear_pedido($1::jsonb) id", [JSON.stringify({ cliente_nombre: "Club Ficticio", precio_acordado_cent: 10000, fecha_entrega: fecha, lineas })]).then((r) => r.rows[0].id);
const linea = (variante_id, cantidad) => ({ variante_id, descripcion: "Prenda ficticia", cantidad });
const porComprar = (tx) => tx.query("select variante_id, falta_pedidos, disponible, en_camino, para_pedidos, reposicion from public.v_compras_por_comprar order by variante_id").then((r) => r.rows);
const preparar = (tx, prov = F.prov) => tx.query("select public.compra_preparar($1) id", [prov]).then((r) => Number(r.rows[0].id));
const lineas = (tx, compra) =>
  tx.query("select id, variante_id, para_pedidos, reposicion, cantidad, recibido, pendiente, precio_neto::float, iva_porcentaje::float, caja_unidades from public.v_compras_lineas where compra_id = $1 order by variante_id", [compra]).then((r) => r.rows);
const compra = (tx, id) => tx.query("select * from public.v_compras where id = $1", [id]).then((r) => r.rows[0]);
const stock = (tx, v) => tx.query("select fisico, reservado from public.stock_articulos where variante_id = $1", [v]).then((r) => r.rows[0]);
const material = (tx, pedido, v) => tx.query("select falta, reservado, pendiente_comprar, pendiente_recibir from public.v_pedidos_material where pedido_id = $1 and variante_id = $2", [pedido, v]).then((r) => r.rows[0]);
const estadoPedido = (tx, id) => tx.query("select estado from public.pedidos where id = $1", [id]).then((r) => r.rows[0].estado);
const previsualizar = (tx, id, ls) => tx.query("select public.compra_previsualizar_recepcion($1, $2::jsonb) p", [id, JSON.stringify(ls)]).then((r) => r.rows[0].p);
const recibir = (tx, id, ls, esperado, { clave = crypto.randomUUID(), exceso = false, albaran = null } = {}) =>
  tx.query("select public.compra_recibir($1, $2, $3::jsonb, $4::jsonb, null, $5, $6) r", [id, clave, JSON.stringify(ls), JSON.stringify(esperado), albaran, exceso]).then((r) => r.rows[0].r);
// expected error inside a running transaction, which then goes on
const falla = async (tx, fn) => {
  await tx.query("savepoint esperado");
  const codigo = await codigoError(fn);
  await tx.query("rollback to savepoint esperado");
  return codigo;
};
// receives with the reservations the preview proposes (what the screen confirms)
const recibirComoPantalla = async (tx, id, ls, opciones) => recibir(tx, id, ls, (await previsualizar(tx, id, ls)).reservas, opciones);

// Two orders: P1 (6 M, 5 L, delivery 20/11) and P2 (4 M, delivery 10/11); 3 M free in stock
const dosPedidos = async (tx) => ({ p1: await crearPedido(tx, "2026-11-20", [linea(F.m, 6), linea(F.l, 5)]), p2: await crearPedido(tx, "2026-11-10", [linea(F.m, 4)]) });

describe("por comprar", () => {
  it("agrupa lo que falta en todos los pedidos activos, descuenta lo libre y añade la reposición bajo mínimo; nunca productos propios", async () => {
    await comoPropietario(db, async (tx) => {
      const { p1 } = await dosPedidos(tx);
      await tx.query("select public.stock_registrar($1, 'entrada', 1, null, null, 3)", [F.xl]);
      await tx.query("update public.stock_articulos set stock_minimo = 4 where variante_id = $1", [F.xl]);
      expect(await porComprar(tx)).toEqual([
        { variante_id: F.m, falta_pedidos: 10, disponible: 3, en_camino: 0, para_pedidos: 7, reposicion: 0 },
        { variante_id: F.l, falta_pedidos: 5, disponible: 0, en_camino: 0, para_pedidos: 5, reposicion: 0 },
        { variante_id: F.xl, falta_pedidos: 0, disponible: 1, en_camino: 0, para_pedidos: 0, reposicion: 3 },
      ]);
      // a cancelled order no longer needs anything
      await tx.query("select public.pedido_cambiar_estado($1, 'cancelado', 'Prueba')", [p1]);
      expect((await porComprar(tx)).map((x) => [x.variante_id, x.para_pedidos])).toEqual([[F.m, 1], [F.xl, 0]]);
    });
  });
});

describe("preparar la compra", () => {
  it("crea un borrador relleno con el precio del catálogo; prepararla otra vez no duplica y respeta la reposición tocada a mano", async () => {
    await comoPropietario(db, async (tx) => {
      const { p1 } = await dosPedidos(tx);
      await tx.query("update public.stock_articulos set stock_minimo = 2 where variante_id = $1", [F.m]);
      const id = await preparar(tx);
      const c = await compra(tx, id);
      expect(c).toMatchObject({ numero: expect.stringMatching(/^C-\d{4}\/001$/), estado: "borrador", situacion: "borrador", proveedor: "Proveedor Ficticio", proveedor_web: "https://proveedor.example.com", unidades: 14 });
      expect(Number(c.base_prevista_cent)).toBe(3500); // 14 × 2,50
      expect(Number(c.iva_previsto_cent)).toBe(735);
      expect(Number(c.total_previsto_cent)).toBe(4235);
      expect(await lineas(tx, id)).toEqual([
        expect.objectContaining({ variante_id: F.m, para_pedidos: 7, reposicion: 2, cantidad: 9, precio_neto: 2.5, iva_porcentaje: 21, caja_unidades: null }),
        expect.objectContaining({ variante_id: F.l, para_pedidos: 5, reposicion: 0, cantidad: 5, caja_unidades: 50 }),
      ]);
      // the owner lowers the restocking and adds a size by hand
      await tx.query("select public.compra_guardar_lineas($1, $2::jsonb)", [id, JSON.stringify([{ variante_id: F.m, para_pedidos: 7, reposicion: 0 }, { variante_id: F.xl, para_pedidos: 0, reposicion: 3 }])]);
      // an order grows: preparing again updates the same draft
      await tx.query("select public.pedido_actualizar_lineas($1, $2::jsonb)", [p1, JSON.stringify([linea(F.m, 8), linea(F.l, 5)])]);
      expect(await preparar(tx)).toBe(id);
      expect((await lineas(tx, id)).map((x) => [x.variante_id, x.para_pedidos, x.reposicion])).toEqual([[F.m, 9, 0], [F.l, 5, 0], [F.xl, 0, 3]]);
      expect(Number((await tx.query("select count(*) n from public.compras")).rows[0].n)).toBe(1);
      // only garments of this supplier
      expect(await codigoError(() => tx.query("select public.compra_guardar_lineas($1, $2::jsonb)", [id, JSON.stringify([{ variante_id: F.ajena, reposicion: 1 }])]))).toBe("P0001");
    });
  });

  it("una compra nueva sin necesidades queda vacía para añadir prendas a mano", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await preparar(tx, F.otro);
      expect(await lineas(tx, id)).toEqual([]);
      expect(await codigoError(() => tx.query("select public.compra_marcar_pedida($1)", [id]))).toBe("P0001");
    });
  });
});

describe("marcar como pedida y seguimiento", () => {
  it("es idempotente; lo pedido deja de estar por comprar y cada pedido sabe qué espera, por fecha de entrega", async () => {
    await comoPropietario(db, async (tx) => {
      const { p1, p2 } = await dosPedidos(tx);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1, 'WEB-123')", [id]);
      await tx.query("select public.compra_marcar_pedida($1, 'WEB-123')", [id]); // double click
      expect(await compra(tx, id)).toMatchObject({ estado: "pedida", situacion: "pedida", referencia_proveedor: "WEB-123", pendientes: 12 });
      expect(Number((await tx.query("select count(*) n from public.compra_eventos where compra_id = $1 and tipo = 'pedida'", [id])).rows[0].n)).toBe(1);
      expect(await porComprar(tx)).toEqual([]);
      // 7 M on the way: P2 (10/11) waits for 4, P1 (20/11) for 3 and still misses 3 (there are 3 free to reserve)
      expect(await material(tx, p2, F.m)).toEqual({ falta: 4, reservado: 0, pendiente_comprar: 0, pendiente_recibir: 4 });
      expect(await material(tx, p1, F.m)).toEqual({ falta: 6, reservado: 0, pendiente_comprar: 3, pendiente_recibir: 3 });
      expect(Number((await tx.query("select pendiente_recibir from public.v_pedidos where id = $1", [p1])).rows[0].pendiente_recibir)).toBe(8);
      // no further changes to the lines once ordered
      expect(await codigoError(() => tx.query("select public.compra_guardar_lineas($1, '[]'::jsonb)", [id]))).toBe("P0001");
    });
  });
});

describe("recepción", () => {
  it("llegada parcial: entrada en el almacén, reserva por fecha de entrega, pedido completo listo para producción, y el resto pendiente", async () => {
    await comoPropietario(db, async (tx) => {
      const { p1, p2 } = await dosPedidos(tx);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      const [lm] = await lineas(tx, id);
      const plan = await previsualizar(tx, id, [{ compra_linea_id: lm.id, cantidad: 5 }]);
      expect(plan.reservas.map((r) => [r.numero, r.cantidad])).toEqual([[expect.stringMatching(/002$/), 4], [expect.stringMatching(/001$/), 1]]);
      expect(plan.libres).toEqual([]);
      expect(plan.listos.map((x) => x.pedido_id)).toEqual([p2]);
      expect(await stock(tx, F.m)).toEqual({ fisico: 3, reservado: 0 }); // the preview changes nothing

      const r = await recibir(tx, id, [{ compra_linea_id: lm.id, cantidad: 5 }], plan.reservas, { albaran: "ALB-1" });
      expect(r).toMatchObject({ unidades: 5, compra: expect.stringMatching(/^C-/) });
      expect(await stock(tx, F.m)).toEqual({ fisico: 8, reservado: 5 });
      expect(await material(tx, p2, F.m)).toMatchObject({ falta: 0, reservado: 4 });
      expect(await material(tx, p1, F.m)).toMatchObject({ falta: 5, reservado: 1, pendiente_recibir: 2 });
      expect(await estadoPedido(tx, p2)).toBe("listo_produccion");
      expect(await estadoPedido(tx, p1)).toBe("pendiente_preparar");
      expect(await compra(tx, id)).toMatchObject({ situacion: "parcial", recibidas: 5, pendientes: 7, recepciones: 1 });
      expect((await lineas(tx, id)).map((x) => [x.variante_id, x.recibido, x.pendiente])).toEqual([[F.m, 5, 2], [F.l, 0, 5]]);
      // movement: one entry, linked to the purchase, real price with VAT
      const mov = (await tx.query("select tipo, cantidad, compra_id, referencia, coste_unitario::float c from public.stock_movimientos where compra_id = $1", [id])).rows;
      expect(mov).toEqual([{ tipo: "entrada", cantidad: 5, compra_id: id, referencia: expect.stringMatching(/albarán ALB-1$/), c: 3.025 }]);
      // the history of the order explains it
      const ev = (await tx.query("select descripcion from public.pedido_eventos where pedido_id = $1 order by id", [p2])).rows.map((e) => e.descripcion);
      expect(ev).toEqual(expect.arrayContaining([expect.stringMatching(/4 prendas reservadas al llegar la compra/), expect.stringMatching(/Material completo/)]));

      // the rest arrives: purchase received; P1 has everything it was waiting for
      const resto = (await lineas(tx, id)).map((x) => ({ compra_linea_id: x.id, cantidad: x.pendiente }));
      await recibirComoPantalla(tx, id, resto);
      expect(await compra(tx, id)).toMatchObject({ situacion: "recibida", pendientes: 0, recepciones: 2 });
      expect(await material(tx, p1, F.m)).toMatchObject({ falta: 3, reservado: 3 }); // the 3 free units are still there to reserve by hand
      expect(await material(tx, p1, F.l)).toMatchObject({ falta: 0, reservado: 5 });
      expect(await codigoError(() => recibirComoPantalla(tx, id, resto))).toBe("P0001"); // nothing pending: over-receipt needs confirmation
    });
  });

  it("la misma petición dos veces registra una sola llegada", async () => {
    await comoPropietario(db, async (tx) => {
      await dosPedidos(tx);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      const [lm] = await lineas(tx, id);
      const ls = [{ compra_linea_id: lm.id, cantidad: 7 }];
      const plan = await previsualizar(tx, id, ls);
      const clave = crypto.randomUUID();
      const primera = await recibir(tx, id, ls, plan.reservas, { clave });
      const segunda = await recibir(tx, id, ls, plan.reservas, { clave });
      expect(segunda).toMatchObject({ repetida: true, recepcion_id: primera.recepcion_id });
      expect(await stock(tx, F.m)).toEqual({ fisico: 10, reservado: 7 });
      expect(Number((await tx.query("select count(*) n from public.stock_movimientos where compra_id = $1", [id])).rows[0].n)).toBe(1);
    });
  });

  it("si los pedidos cambian entre el resumen y la confirmación no se hace nada", async () => {
    await comoPropietario(db, async (tx) => {
      const { p2 } = await dosPedidos(tx);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      const [lm] = await lineas(tx, id);
      const ls = [{ compra_linea_id: lm.id, cantidad: 7 }];
      const plan = await previsualizar(tx, id, ls);
      await tx.query("select public.pedido_cambiar_estado($1, 'cancelado', 'El cliente lo anula')", [p2]);
      expect(await codigoError(() => tx.query("savepoint s").then(() => recibir(tx, id, ls, plan.reservas)))).toBe("40001");
      await tx.query("rollback to savepoint s");
      expect(await stock(tx, F.m)).toEqual({ fisico: 3, reservado: 0 });
      // recalculated: nothing for the cancelled order, its share stays free
      const nuevo = await previsualizar(tx, id, ls);
      expect(nuevo.reservas.map((r) => r.cantidad)).toEqual([6]);
      expect(nuevo.libres.map((x) => x.cantidad)).toEqual([1]);
      await recibir(tx, id, ls, nuevo.reservas);
      expect(await stock(tx, F.m)).toEqual({ fisico: 10, reservado: 6 });
    });
  });

  it("unidades de más: solo con confirmación, y quedan libres en el almacén", async () => {
    await comoPropietario(db, async (tx) => {
      await crearPedido(tx, "2026-11-10", [linea(F.l, 2)]);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      const [ll] = await lineas(tx, id);
      const ls = [{ compra_linea_id: ll.id, cantidad: 5 }];
      const plan = await previsualizar(tx, id, ls);
      expect(plan).toMatchObject({ exceso: 3, libres: [expect.objectContaining({ cantidad: 3 })] });
      expect(await codigoError(() => tx.query("savepoint s").then(() => recibir(tx, id, ls, plan.reservas)))).toBe("P0001");
      await tx.query("rollback to savepoint s");
      await recibir(tx, id, ls, plan.reservas, { exceso: true });
      expect(await stock(tx, F.l)).toEqual({ fisico: 5, reservado: 2 });
      expect(await compra(tx, id)).toMatchObject({ situacion: "recibida", recibidas: 5, pendientes: 0 });
    });
  });

  it("precio real distinto: queda en la llegada y en el coste del almacén; catálogo y pedidos no cambian", async () => {
    await comoPropietario(db, async (tx) => {
      const { p1 } = await dosPedidos(tx);
      const antes = (await tx.query("select coste_cent, precio_neto::float from public.variantes where id = $1", [F.l])).rows[0];
      const pedidoAntes = (await tx.query("select precio_acordado_cent, coste_previsto_cent, economico from public.pedidos where id = $1", [p1])).rows[0];
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      const ll = (await lineas(tx, id)).find((x) => x.variante_id === F.l);
      await recibirComoPantalla(tx, id, [{ compra_linea_id: ll.id, cantidad: 5, precio_neto: 2.2 }]);
      const c = await compra(tx, id);
      expect([Number(c.base_real_cent), Number(c.iva_real_cent), Number(c.total_real_cent)]).toEqual([1100, 231, 1331]);
      expect(Number(c.base_prevista_cent)).toBe(3000); // the expected price stays as it was
      expect((await tx.query("select coste_unitario::float c from public.stock_movimientos where compra_id = $1", [id])).rows[0].c).toBe(2.662);
      expect((await tx.query("select coste_cent, precio_neto::float from public.variantes where id = $1", [F.l])).rows[0]).toEqual(antes);
      expect((await tx.query("select precio_acordado_cent, coste_previsto_cent, economico from public.pedidos where id = $1", [p1])).rows[0]).toEqual(pedidoAntes);
    });
  });

  it("dos pedidos y unidades justas: nunca se reserva más de lo que hay ni dos veces lo mismo", async () => {
    await comoPropietario(db, async (tx) => {
      const { p1, p2 } = await dosPedidos(tx);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      // meanwhile the 3 free M are reserved by hand for P1
      await tx.query("select public.pedido_reservar($1, $2::jsonb)", [p1, JSON.stringify([{ variante_id: F.m, cantidad: 3 }])]);
      const [lm] = await lineas(tx, id);
      await recibirComoPantalla(tx, id, [{ compra_linea_id: lm.id, cantidad: 7 }]);
      expect(await stock(tx, F.m)).toEqual({ fisico: 10, reservado: 10 });
      expect(await material(tx, p1, F.m)).toMatchObject({ falta: 0, reservado: 6 });
      expect(await material(tx, p2, F.m)).toMatchObject({ falta: 0, reservado: 4 });
      const activas = (await tx.query("select pedido_id, sum(cantidad)::int n from public.stock_reservas where estado = 'activa' group by 1 order by 1")).rows;
      expect(activas).toEqual([{ pedido_id: p1, n: 6 }, { pedido_id: p2, n: 4 }]);
    });
  });
});

describe("incidencias sin bloquear (17A)", () => {
  it("dar por cerrado lo pendiente devuelve las prendas a «por comprar»", async () => {
    await comoPropietario(db, async (tx) => {
      await dosPedidos(tx);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      expect(await falla(tx, () => tx.query("select public.compra_cerrar_pendiente($1, '')", [id]))).toBe("P0001");
      await tx.query("select public.compra_cerrar_pendiente($1, 'Agotado en el proveedor')", [id]);
      expect(await compra(tx, id)).toMatchObject({ situacion: "recibida", pendientes: 0, cerradas: 12 });
      expect((await porComprar(tx)).map((x) => [x.variante_id, x.para_pedidos])).toEqual([[F.m, 7], [F.l, 5]]);
      expect(await preparar(tx)).not.toBe(id); // a new draft
    });
  });

  it("volver a borrador o cancelar mientras no ha llegado nada; descartar un borrador", async () => {
    await comoPropietario(db, async (tx) => {
      await dosPedidos(tx);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      await tx.query("select public.compra_volver_borrador($1)", [id]);
      expect(await compra(tx, id)).toMatchObject({ estado: "borrador", fecha_pedido: null });
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      expect(await falla(tx, () => tx.query("select public.compra_cancelar($1, null)", [id]))).toBe("P0001");
      await tx.query("select public.compra_cancelar($1, 'Pedido duplicado en la web')", [id]);
      expect(await compra(tx, id)).toMatchObject({ estado: "cancelada", situacion: "cancelada", motivo_cancelacion: "Pedido duplicado en la web" });
      expect((await porComprar(tx)).length).toBe(2); // back to buy
      const borrador = await preparar(tx);
      await tx.query("select public.compra_descartar($1)", [borrador]);
      expect((await compra(tx, borrador)).estado).toBe("cancelada");
    });
  });

  it("con mercancía recibida no se cancela ni vuelve a borrador; corregir la entrada desde inventario la deja pendiente otra vez", async () => {
    await comoPropietario(db, async (tx) => {
      await crearPedido(tx, null, [linea(F.xl, 2)]);
      const id = await preparar(tx);
      await tx.query("select public.compra_marcar_pedida($1)", [id]);
      const [lx] = await lineas(tx, id);
      await recibirComoPantalla(tx, id, [{ compra_linea_id: lx.id, cantidad: 2 }]);
      expect(await codigoError(() => tx.query("savepoint s").then(() => tx.query("select public.compra_cancelar($1, 'x')", [id])))).toBe("P0001");
      await tx.query("rollback to savepoint s");
      expect(await codigoError(() => tx.query("savepoint s").then(() => tx.query("select public.compra_volver_borrador($1)", [id])))).toBe("P0001");
      await tx.query("rollback to savepoint s");
      // a wrong receipt is fixed with the existing tools: release the reservation, correct the entry
      const pedido = (await tx.query("select pedido_id from public.stock_reservas where estado = 'activa'")).rows[0].pedido_id;
      await tx.query("select public.pedido_liberar($1)", [pedido]);
      const mov = (await tx.query("select id from public.stock_movimientos where compra_id = $1", [id])).rows[0].id;
      await tx.query("select public.stock_corregir($1, 'No llegó: error al registrar')", [mov]);
      expect(await compra(tx, id)).toMatchObject({ situacion: "pedida", recibidas: 0, pendientes: 2 });
    });
  });
});

describe("seguridad", () => {
  it("solo el propietario lee y opera; nadie escribe directamente en las tablas", async () => {
    const id = await comoPropietario(db, async (tx) => {
      await dosPedidos(tx);
      return preparar(tx);
    });
    expect(await comoIntruso(db, (tx) => tx.query("select count(*)::int n from public.compras").then((r) => r.rows[0].n))).toBe(0);
    expect(await comoIntruso(db, (tx) => tx.query("select count(*)::int n from public.v_compras_por_comprar").then((r) => r.rows[0].n))).toBe(0);
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("select public.compra_preparar($1)", [F.prov])))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("select public.compra_marcar_pedida($1)", [id])))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select public.compra_recibir($1, gen_random_uuid(), '[]'::jsonb, '[]'::jsonb)", [id])))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.v_compras")))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.compras set estado = 'pedida', fecha_pedido = current_date")))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("insert into public.compra_recepciones (compra_id, clave) values ($1, gen_random_uuid())", [id])))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.compra_plan_recepcion($1, '[]'::jsonb)", [id])))).toBe("42501");
  });

  it("la migración se puede aplicar dos veces sin cambiar nada", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync(new URL("../migrations/20261028090000_compras.sql", import.meta.url), "utf8");
    const id = await comoPropietario(db, async (tx) => {
      await dosPedidos(tx);
      return preparar(tx);
    });
    await db.exec(sql);
    expect(await comoPropietario(db, (tx) => compra(tx, id))).toMatchObject({ unidades: 12, estado: "borrador" });
  });
});
