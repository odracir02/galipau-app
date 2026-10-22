// Purchases from suppliers: grouping, texts and checks without React.
// Quantities and prices come calculated from the database views.

import { posicionTalla } from "../../../domain/catalogo";

// Visible state (v_compras.situacion): received and partly received are derived from the receipts
export const SITUACIONES = {
  borrador: { etiqueta: "Borrador", clase: "borrador" },
  pedida: { etiqueta: "Pedida", clase: "presentado" },
  parcial: { etiqueta: "Llegó en parte", clase: "en_produccion" },
  recibida: { etiqueta: "Recibida", clase: "cobrado" },
  cancelada: { etiqueta: "Cancelada", clase: "cancelado" },
};

export const EN_CAMINO = new Set(["pedida", "parcial"]);

const fechaCorta = (f) => (f ? String(f).slice(0, 10).split("-").reverse().join("/") : "");
const compararFechas = (a, b) => (a ?? "9999").localeCompare(b ?? "9999");

/**
 * "Por comprar" rows grouped by supplier, most urgent first.
 * @param porComprar rows of v_compras_por_comprar
 * @param pedidos rows of v_compras_por_comprar_pedidos (orders behind each variant)
 * @param compras rows of v_compras (to find the supplier's open draft)
 */
export const agruparPorProveedor = (porComprar, pedidos = [], compras = []) => {
  const grupos = new Map();
  for (const f of porComprar) {
    const g = grupos.get(f.proveedor_id) ?? { proveedor_id: f.proveedor_id, proveedor: f.proveedor, unidades: 0, paraPedidos: 0, reposicion: 0, modelos: new Set(), pedidos: new Map() };
    g.unidades += f.para_pedidos + f.reposicion;
    g.paraPedidos += f.para_pedidos;
    g.reposicion += f.reposicion;
    g.modelos.add(`${f.modelo}|${f.color}`);
    if (f.para_pedidos > 0) {
      for (const p of pedidos.filter((x) => x.variante_id === f.variante_id && x.pendiente_comprar > 0)) g.pedidos.set(p.pedido_id, p);
    }
    grupos.set(f.proveedor_id, g);
  }
  return [...grupos.values()]
    .map((g) => {
      const lista = [...g.pedidos.values()].sort((a, b) => compararFechas(a.fecha_entrega, b.fecha_entrega) || a.pedido_id - b.pedido_id);
      return {
        ...g,
        modelos: g.modelos.size,
        pedidos: lista.map((p) => ({ pedido_id: p.pedido_id, numero: p.numero, fecha_entrega: p.fecha_entrega })),
        primeraEntrega: lista.find((p) => p.fecha_entrega)?.fecha_entrega ?? null,
        borrador: compras.find((c) => c.proveedor_id === g.proveedor_id && c.estado === "borrador") ?? null,
      };
    })
    .sort((a, b) => compararFechas(a.primeraEntrega, b.primeraEntrega) || (a.paraPedidos > 0 ? 0 : 1) - (b.paraPedidos > 0 ? 0 : 1) || a.proveedor.localeCompare(b.proveedor));
};

/** Lines grouped by model and colour, sizes in garment order (how supplier websites are filled in) */
export const agruparLineas = (lineas) => {
  const grupos = new Map();
  for (const l of lineas) {
    const clave = `${l.modelo}|${l.color}`;
    const g = grupos.get(clave) ?? { clave, modelo: l.modelo, color: l.color, marca: l.marca, referencia: l.referencia, lineas: [] };
    g.lineas.push(l);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map((g) => ({
    ...g,
    lineas: [...g.lineas].sort((a, b) => posicionTalla(a.talla) - posicionTalla(b.talla) || String(a.talla).localeCompare(String(b.talla))),
  }));
};

/** Plain text to look at (or paste) while buying on the supplier's website */
export const textoParaProveedor = (compra, lineas) => {
  const grupos = agruparLineas(lineas.filter((l) => l.cantidad > 0));
  const total = lineas.reduce((s, l) => s + l.cantidad, 0);
  return [
    `Compra ${compra.numero} · ${compra.proveedor}`,
    ...grupos.map((g) => `${[g.referencia, g.modelo, g.color].filter(Boolean).join(" · ")} → ${g.lineas.map((l) => `${l.talla}: ${l.cantidad}`).join(" · ")}`),
    `Total: ${total} ${total === 1 ? "prenda" : "prendas"}`,
  ].join("\n");
};

/** The supplier's website, only if it is a valid http(s) address; "www.x.com" is read as https */
export const urlWebSegura = (web) => {
  const texto = String(web ?? "").trim();
  if (!texto || /\s/.test(texto)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(texto) ? texto : `https://${texto}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
};

/** Box hint when the supplier sells the garment in boxes and the amount is not a whole number of them (never rounded) */
export const avisoCaja = (linea) => {
  const caja = Number(linea.caja_unidades);
  if (!(caja > 1) || !(linea.cantidad > 0) || linea.cantidad % caja === 0) return null;
  return `El proveedor también la vende en cajas de ${caja}: pides ${linea.cantidad}.`;
};

/** What to do now with a purchase (v_compras row) */
export const siguientePasoCompra = (c) => {
  switch (c.situacion) {
    case "borrador":
      return c.lineas > 0
        ? "Compra estas prendas en la web del proveedor y, al terminar, pulsa «Marcar como pedida»."
        : "Añade las prendas que quieras comprar.";
    case "pedida":
      return "Cuando llegue la mercancía, pulsa «Registrar llegada»: entra en el almacén y se reserva sola para los pedidos.";
    case "parcial":
      return `Faltan por llegar ${c.pendientes} ${c.pendientes === 1 ? "prenda" : "prendas"}: regístralas cuando lleguen. Si no van a llegar, usa «Más opciones».`;
    case "recibida":
      return "";
    default:
      return "";
  }
};

/** Receipt form rows, filled in with what is pending: if everything arrived, nothing has to be typed */
export const recepcionInicial = (lineas) =>
  agruparLineas(lineas.filter((l) => l.pendiente > 0))
    .flatMap((g) => g.lineas)
    .map((l) => ({
      compra_linea_id: l.id,
      descripcion: `${l.modelo} · ${l.color} ${l.talla}`,
      pendiente: l.pendiente,
      cantidad: String(l.pendiente),
      precioPrevisto: l.precio_neto === null || l.precio_neto === undefined ? "" : String(Number(l.precio_neto)).replace(".", ","),
      precio: l.precio_neto === null || l.precio_neto === undefined ? "" : String(Number(l.precio_neto)).replace(".", ","),
    }));

const numero = (texto) => {
  const t = String(texto ?? "").trim().replace(",", ".");
  return t === "" ? null : Number(t);
};

/** What is sent to the database: only arrived lines; a price only when it differs from the expected one */
export const lineasParaRecibir = (filas) =>
  filas
    .map((f) => ({ f, cantidad: numero(f.cantidad) }))
    .filter(({ cantidad }) => Number.isInteger(cantidad) && cantidad > 0)
    .map(({ f, cantidad }) => {
      const precio = numero(f.precio);
      const linea = { compra_linea_id: f.compra_linea_id, cantidad };
      if (precio !== null && Number.isFinite(precio) && precio !== numero(f.precioPrevisto)) linea.precio_neto = precio;
      return linea;
    });

/** Problems typed in the receipt form, in plain words */
export const erroresRecepcion = (filas) => {
  const errores = [];
  for (const f of filas) {
    const c = numero(f.cantidad);
    if (c !== null && (!Number.isInteger(c) || c < 0)) errores.push(`${f.descripcion}: escribe un número entero de prendas.`);
    const p = numero(f.precio);
    if (p !== null && (!Number.isFinite(p) || p < 0)) errores.push(`${f.descripcion}: el precio no es válido.`);
  }
  if (!errores.length && lineasParaRecibir(filas).length === 0) errores.push("Indica cuántas prendas han llegado.");
  return errores;
};

/** The receipt summary in plain words (plan from compra_previsualizar_recepcion) */
export const resumenRecepcion = (plan) => {
  const suma = (lista) => lista.reduce((s, x) => s + x.cantidad, 0);
  const porPedido = new Map();
  for (const r of plan.reservas) porPedido.set(r.numero, (porPedido.get(r.numero) ?? 0) + r.cantidad);
  return {
    entran: suma(plan.entradas),
    reservas: [...porPedido.entries()].map(([numeroPedido, cantidad]) => ({ numero: numeroPedido, cantidad })),
    reservadas: suma(plan.reservas),
    libres: suma(plan.libres),
    listos: plan.listos.map((x) => x.numero),
    exceso: plan.exceso ?? 0,
  };
};

/** "pedida el 22/10/2026" style line for lists */
export const textoFechaPedido = (c) => (c.fecha_pedido ? `pedida el ${fechaCorta(c.fecha_pedido)}` : "");
export { fechaCorta };
