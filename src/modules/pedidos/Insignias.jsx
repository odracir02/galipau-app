import { ESTADOS_PEDIDO, COBRO } from "./domain/pedidos";

// Physical state of an order (theme colours, readable in light and dark)
export function InsigniaPedido({ estado }) {
  const e = ESTADOS_PEDIDO[estado];
  return <span className={`gx-insignia gx-estado-${e?.clase ?? "borrador"}`}>{e?.etiqueta ?? estado}</span>;
}

// Payment state, kept apart from production
export function InsigniaCobro({ estado }) {
  const c = COBRO[estado];
  return <span className={`gx-insignia gx-estado-${c?.clase ?? "borrador"}`}>{c?.etiqueta ?? estado}</span>;
}
