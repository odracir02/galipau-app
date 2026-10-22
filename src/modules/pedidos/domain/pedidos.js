// Orders: states, attention, reservation proposal and quote conversion preview
// (pure functions). The state rules mirror public.pedido_transicion_permitida;
// a database test checks both stay identical.

export const ESTADOS_PEDIDO = {
  pendiente_preparar: { etiqueta: "Pendiente de preparar", clase: "borrador" },
  pendiente_material: { etiqueta: "Pendiente de material", clase: "material" },
  listo_produccion: { etiqueta: "Listo para producción", clase: "presentado" },
  en_produccion: { etiqueta: "En producción", clase: "en_produccion" },
  terminado: { etiqueta: "Terminado", clase: "finalizado" },
  entregado: { etiqueta: "Entregado", clase: "cobrado" },
  cancelado: { etiqueta: "Cancelado", clase: "cancelado" },
};
export const ORDEN_ESTADOS = Object.keys(ESTADOS_PEDIDO);

export const TRANSICIONES_PEDIDO = {
  pendiente_preparar: ["pendiente_material", "listo_produccion", "cancelado"],
  pendiente_material: ["listo_produccion", "pendiente_preparar", "cancelado"],
  listo_produccion: ["en_produccion", "pendiente_material", "cancelado"],
  en_produccion: ["terminado", "listo_produccion", "cancelado"],
  terminado: ["entregado", "en_produccion"],
  entregado: ["terminado"],
  cancelado: ["pendiente_preparar"],
};

export const COBRO = {
  pendiente: { etiqueta: "Sin cobrar", clase: "borrador" },
  parcial: { etiqueta: "Cobrado en parte", clase: "en_produccion" },
  cobrado: { etiqueta: "Cobrado", clase: "cobrado" },
};

const ACCIONES = {
  pendiente_material: "Falta material",
  listo_produccion: "Listo para producción",
  en_produccion: "Empezar producción",
  terminado: "Marcar como terminado",
  entregado: "Marcar como entregado",
  cancelado: "Cancelar pedido",
  pendiente_preparar: "Reabrir pedido",
};
const RETROCESOS = new Set(["pendiente_material>pendiente_preparar", "listo_produccion>pendiente_material", "en_produccion>listo_produccion", "terminado>en_produccion", "entregado>terminado"]);

export const esTransicionPedido = (desde, hasta) => (TRANSICIONES_PEDIDO[desde] ?? []).includes(hasta);

/** Buttons for the current state: forward steps first, corrections and cancelling apart (advanced) */
export const accionesPedido = (estado) =>
  (TRANSICIONES_PEDIDO[estado] ?? []).map((hasta) => {
    const retroceso = RETROCESOS.has(`${estado}>${hasta}`);
    return {
      hasta,
      etiqueta: retroceso ? `Volver a «${ESTADOS_PEDIDO[hasta].etiqueta.toLowerCase()}»` : ACCIONES[hasta],
      tipo: hasta === "cancelado" ? "peligro" : retroceso ? "correccion" : "avance",
    };
  });

export const ACTIVOS = new Set(["pendiente_preparar", "pendiente_material", "listo_produccion", "en_produccion", "terminado"]);

const diasHasta = (fecha, hoy) => (fecha ? Math.round((new Date(`${String(fecha).slice(0, 10)}T00:00:00Z`) - new Date(`${hoy}T00:00:00Z`)) / 86400000) : null);

/**
 * Why an order needs attention (empty when it does not).
 * @param {object} p v_pedidos row
 * @param {string} hoy YYYY-MM-DD
 */
export const motivosAtencion = (p, hoy) => {
  const m = [];
  const dias = diasHasta(p.fecha_entrega, hoy);
  if (ACTIVOS.has(p.estado) && dias !== null && dias < 0) m.push(`Entrega retrasada ${-dias} ${-dias === 1 ? "día" : "días"}`);
  else if (ACTIVOS.has(p.estado) && p.estado !== "terminado" && dias !== null && dias <= 3) m.push(dias === 0 ? "Se entrega hoy" : `Se entrega en ${dias} ${dias === 1 ? "día" : "días"}`);
  if (["pendiente_preparar", "pendiente_material", "listo_produccion"].includes(p.estado) && p.unidades_faltan > 0) m.push(`Faltan ${p.unidades_faltan} prendas`);
  if (p.estado === "terminado") m.push("Terminado, pendiente de entregar");
  if (p.estado === "entregado" && p.cobro_estado !== "cobrado") m.push("Entregado sin cobrar del todo");
  if (ACTIVOS.has(p.estado) && p.lineas_sin_catalogo > 0) m.push(`${p.lineas_sin_catalogo} ${p.lineas_sin_catalogo === 1 ? "prenda sin vincular" : "prendas sin vincular"} al catálogo`);
  return m;
};

export const textoEntrega = (fecha, hoy) => {
  const dias = diasHasta(fecha, hoy);
  if (dias === null) return "Sin fecha";
  if (dias < 0) return `Hace ${-dias} ${-dias === 1 ? "día" : "días"}`;
  if (dias === 0) return "Hoy";
  if (dias === 1) return "Mañana";
  return `En ${dias} días`;
};

/** Proposed reservation per variant: what is missing, up to what is free in the workshop */
export const propuestaReserva = (material) =>
  material
    .map((m) => ({ variante_id: m.variante_id, descripcion: `${m.modelo} · ${m.color} ${m.talla}`, falta: m.falta, disponible: m.disponible_almacen, cantidad: Math.max(0, Math.min(m.falta, m.disponible_almacen)) }))
    .filter((p) => p.falta > 0);

/** Suggested next step for the owner, in plain words */
export const siguientePaso = (p, material = []) => {
  const falta = material.reduce((s, m) => s + m.falta, 0);
  const libres = material.some((m) => m.falta > 0 && m.disponible_almacen > 0);
  switch (p.estado) {
    case "pendiente_preparar":
    case "pendiente_material":
      if (libres) return "Hay prendas en el almacén para este pedido: pulsa «Reservar prendas».";
      if (falta > 0) return `Faltan ${falta} prendas: anótalas como compra pendiente y, cuando lleguen, resérvalas.`;
      return "Todo el material está reservado: pásalo a «Listo para producción».";
    case "listo_produccion":
      return "Cuando empecéis a estampar, pulsa «Empezar producción».";
    case "en_produccion":
      return "Anota las prendas usadas (y las estropeadas, si hay). Al acabar, «Marcar como terminado».";
    case "terminado":
      return "Cuando el cliente lo recoja, «Marcar como entregado».";
    case "entregado":
      return p.cobro_estado === "cobrado" ? "Pedido entregado y cobrado." : "Pedido entregado: anota el cobro cuando lo recibas.";
    default:
      return "";
  }
};

/** Preview of the lines an accepted quote turns into (same rules as crear_pedido_desde_presupuesto) */
export const lineasDesdePresupuesto = (presupuesto) => {
  const formulario = presupuesto?.entrada?.formulario?.lineas ?? [];
  const detalle = presupuesto?.entrada?.lineas ?? [];
  return formulario
    .map((l, i) => {
      const d = detalle[i] ?? {};
      const cantidad = Math.floor(Number(String(l.quantity ?? d.cantidad ?? 0).replace(",", ".")) || 0);
      const descripcion = [d.descripcion, [d.color, d.talla].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || [l.modelo, l.color, l.size].filter(Boolean).join(" · ") || "Prenda";
      return { descripcion, cantidad, variante_id: /^\d+$/.test(String(l.productoId ?? "")) ? Number(l.productoId) : null, coste: typeof d.precioUnitario === "number" ? d.precioUnitario : null };
    })
    .filter((l) => l.cantidad > 0);
};

export const PRESUPUESTO_CONVERTIBLE = new Set(["aceptado", "en_produccion", "finalizado", "cobrado"]);
