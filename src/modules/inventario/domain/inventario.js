// Inventory rules for the interface (the database enforces them again).
// Available = physical − reserved. Catalogue and stock are separate concepts.

export const TIPOS_MOVIMIENTO = {
  inicial: "Inventario inicial",
  entrada: "Entrada",
  salida: "Salida",
  devolucion: "Devolución",
  merma: "Merma o pérdida",
  ajuste: "Ajuste de inventario",
  correccion: "Corrección",
};

// Movements the owner records by hand (opening stock and corrections have their own flows)
export const MOVIMIENTOS_MANUALES = {
  entrada: { etiqueta: "Entrada de mercancía", signo: 1, coste: true },
  salida: { etiqueta: "Salida (consumo o entrega)", signo: -1 },
  devolucion: { etiqueta: "Devolución (vuelve al taller)", signo: 1, coste: true },
  merma: { etiqueta: "Merma o pérdida", signo: -1, motivoObligatorio: true },
  ajuste: { etiqueta: "Ajuste por recuento", recuento: true, motivoObligatorio: true },
};

const entero = (v) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim().replace(",", "."));
  return Number.isInteger(n) ? n : null;
};
const decimal = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Turns the movement form into the signed change for the database.
 * For an adjustment the owner types the counted units; the change is counted − physical.
 * Returns { cantidad, coste } or { errores }.
 */
export const prepararMovimiento = ({ tipo, unidades, motivo, coste }, articulo) => {
  const def = MOVIMIENTOS_MANUALES[tipo];
  const errores = [];
  if (!def) return { errores: ["Elige el tipo de movimiento."] };
  const n = entero(unidades);
  const fisico = articulo?.fisico ?? 0;
  const reservado = articulo?.reservado ?? 0;
  let cantidad = null;
  if (def.recuento) {
    if (n === null || n < 0) errores.push("Indica las unidades contadas (0 o más, sin decimales).");
    else if (n === fisico) errores.push("El recuento coincide con el stock: no hay nada que ajustar.");
    else if (n < reservado) errores.push(`Hay ${reservado} unidad(es) reservadas: el recuento no puede quedar por debajo.`);
    else cantidad = n - fisico;
  } else if (n === null || n <= 0) {
    errores.push("Indica las unidades (número entero mayor que 0).");
  } else {
    cantidad = def.signo * n;
    if (cantidad < 0 && n > fisico - reservado) {
      errores.push(`Solo hay ${fisico - reservado} unidad(es) disponibles${reservado ? ` (${reservado} reservadas)` : ""}.`);
    }
  }
  if (def.motivoObligatorio && !String(motivo ?? "").trim()) errores.push("Indica el motivo.");
  const c = def.coste ? decimal(coste) : null;
  if (Number.isNaN(c) || (c !== null && c < 0)) errores.push("El coste unitario no es válido.");
  return errores.length ? { errores } : { cantidad, coste: c };
};

export const describirArticulo = (a) => [a.propio ? "Propio" : a.proveedor, a.modelo, a.color, a.talla].filter(Boolean).join(" · ");

export const resumenInventario = (filas) => ({
  referencias: filas.length,
  fisico: filas.reduce((s, f) => s + f.fisico, 0),
  reservado: filas.reduce((s, f) => s + f.reservado, 0),
  disponible: filas.reduce((s, f) => s + (f.fisico - f.reservado), 0),
  bajoMinimo: filas.filter((f) => f.bajo_minimo).length,
  valor: filas.reduce((s, f) => s + (f.valor === null || f.valor === undefined ? 0 : Number(f.valor)), 0),
  sinValorar: filas.filter((f) => f.fisico > 0 && (f.valor === null || f.valor === undefined)).length,
});

/** Opening stock lines from the load form: only rows with a quantity, never assumed. */
export const lineasCargaInicial = (filas) => {
  const errores = [];
  const lineas = [];
  for (const f of filas) {
    if (String(f.cantidad ?? "").trim() === "") continue;
    const n = entero(f.cantidad);
    if (n === null || n <= 0) {
      errores.push(`${f.descripcion}: la cantidad debe ser un entero mayor que 0.`);
      continue;
    }
    const c = decimal(f.coste);
    if (Number.isNaN(c) || (c !== null && c < 0)) {
      errores.push(`${f.descripcion}: el coste unitario no es válido.`);
      continue;
    }
    lineas.push({ variante_id: Number(f.varianteId), cantidad: n, ...(c !== null ? { coste_unitario: c } : {}) });
  }
  return { lineas, errores, unidades: lineas.reduce((s, l) => s + l.cantidad, 0) };
};
