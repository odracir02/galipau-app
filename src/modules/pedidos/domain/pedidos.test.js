// Orders domain rules. FICTITIOUS data.
import { describe, it, expect } from "vitest";
import { accionesPedido, motivosAtencion, propuestaReserva, siguientePaso, lineasDesdePresupuesto, textoEntrega, esTransicionPedido, TRANSICIONES_PEDIDO } from "./pedidos";

const HOY = "2026-10-22";
const p = (cambios) => ({ estado: "pendiente_preparar", cobro_estado: "pendiente", fecha_entrega: null, unidades_faltan: 0, lineas_sin_catalogo: 0, ...cambios });

describe("estados del pedido", () => {
  it("acciones: avance primero, correcciones y cancelar aparte", () => {
    expect(accionesPedido("en_produccion")).toEqual([
      { hasta: "terminado", etiqueta: "Marcar como terminado", tipo: "avance" },
      { hasta: "listo_produccion", etiqueta: "Volver a «listo para producción»", tipo: "correccion" },
      { hasta: "cancelado", etiqueta: "Cancelar pedido", tipo: "peligro" },
    ]);
    expect(esTransicionPedido("pendiente_preparar", "entregado")).toBe(false);
    expect(Object.values(TRANSICIONES_PEDIDO).flat()).toHaveLength(16);
  });
});

describe("pedidos que requieren atención", () => {
  it.each([
    [p({ fecha_entrega: "2026-10-20" }), ["Entrega retrasada 2 días"]],
    [p({ fecha_entrega: "2026-10-22" }), ["Se entrega hoy"]],
    [p({ fecha_entrega: "2026-10-24", unidades_faltan: 5 }), ["Se entrega en 2 días", "Faltan 5 prendas"]],
    [p({ estado: "terminado" }), ["Terminado, pendiente de entregar"]],
    [p({ estado: "entregado", cobro_estado: "parcial", fecha_entrega: "2026-01-01" }), ["Entregado sin cobrar del todo"]],
    [p({ estado: "en_produccion", lineas_sin_catalogo: 1 }), ["1 prenda sin vincular al catálogo"]],
    [p({ fecha_entrega: "2026-12-01" }), []],
    [p({ estado: "cancelado", fecha_entrega: "2026-10-01" }), []],
  ])("%j", (pedido, motivos) => expect(motivosAtencion(pedido, HOY)).toEqual(motivos));

  it("texto de la entrega", () => {
    expect(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-30", null].map((f) => textoEntrega(f, HOY))).toEqual(["Hace 1 día", "Hoy", "Mañana", "En 8 días", "Sin fecha"]);
  });
});

describe("propuesta de reserva y siguiente paso", () => {
  const material = [
    { variante_id: 1, modelo: "Base", color: "NEGRO", talla: "M", falta: 6, disponible_almacen: 10 },
    { variante_id: 2, modelo: "Base", color: "NEGRO", talla: "L", falta: 5, disponible_almacen: 3 },
    { variante_id: 3, modelo: "Base", color: "NEGRO", talla: "XL", falta: 0, disponible_almacen: 4 },
  ];
  it("propone lo que falta hasta lo que hay libre; nada de lo ya cubierto", () => {
    expect(propuestaReserva(material)).toEqual([
      { variante_id: 1, descripcion: "Base · NEGRO M", falta: 6, disponible: 10, cantidad: 6 },
      { variante_id: 2, descripcion: "Base · NEGRO L", falta: 5, disponible: 3, cantidad: 3 },
    ]);
  });
  it("explica qué hacer en cada momento", () => {
    expect(siguientePaso(p({}), material)).toMatch(/Reservar prendas/);
    expect(siguientePaso(p({}), [{ ...material[1], disponible_almacen: 0, pendiente_comprar: 5 }])).toMatch(/Faltan 5 prendas: prepara la compra en «Compras»/);
    expect(siguientePaso(p({}), [{ ...material[1], disponible_almacen: 0, pendiente_comprar: 0, pendiente_recibir: 5 }])).toMatch(/ya pedidas al proveedor: cuando lleguen, se reservan solas/);
    expect(siguientePaso(p({}), [material[2]])).toMatch(/Listo para producción/);
    expect(siguientePaso(p({ estado: "entregado", cobro_estado: "parcial" }))).toMatch(/anota el cobro/);
  });
});

describe("vista previa de la conversión", () => {
  it("las líneas del presupuesto, con su prenda del catálogo si la tiene", () => {
    const presupuesto = {
      entrada: {
        formulario: { lineas: [{ productoId: "7", quantity: "6" }, { descripcion: "Delantal", quantity: "2" }, { productoId: "8", quantity: "" }] },
        lineas: [{ descripcion: "Base", color: "NEGRO", talla: "M", precioUnitario: 3.025 }, { descripcion: "Delantal", precioUnitario: 0 }, { descripcion: "Base" }],
      },
    };
    expect(lineasDesdePresupuesto(presupuesto)).toEqual([
      { descripcion: "Base · NEGRO M", cantidad: 6, variante_id: 7, coste: 3.025 },
      { descripcion: "Delantal", cantidad: 2, variante_id: null, coste: 0 },
    ]);
  });
});

describe("compatibilidad con una base sin pedidos", () => {
  it("sin el módulo de pedidos en la base, el presupuesto no ofrece crear pedido (undefined), y con él sí (null)", async () => {
    const { crearClienteFalso } = await import("../../../shared/supabase/clienteFalso");
    const { pedidoDePresupuesto } = await import("../data/pedidosRepo");
    const sinModulo = crearClienteFalso({ fallos: { pedidos: { code: "PGRST205", message: "Could not find the table" } } });
    expect(await pedidoDePresupuesto(sinModulo, 1)).toBeUndefined();
    expect(await pedidoDePresupuesto(crearClienteFalso({ tablas: { pedidos: [] } }), 1)).toBeNull();
  });
});
