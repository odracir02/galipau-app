// Catalogue administration rules (pure functions, no React, no database).
// The catalogue lists what can be bought from suppliers (or the workshop's
// own products); it never holds stock.

export const TIPOS_SUGERIDOS = ["Camiseta", "Camiseta niño", "Camiseta mujer", "Sudadera", "Polo", "Bolsa", "Gorra", "Delantal", "Otro"];
export const TALLAS_FRECUENTES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "02A", "04A", "06A", "08A", "10A", "12A", "TU"];
export const IVA_GENERAL = 21;

// Purchase prices with up to five decimals (net × 1.21 may have five)
const PRECIO = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 5, useGrouping: "always" });
export const euro5 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? "—" : PRECIO.format(Number(v)));

// Short description of how a variant's price is stored
export const describirPrecio = (v) => {
  if (v.precio_neto !== null && v.precio_neto !== undefined) return `${euro5(v.precio_neto)} + ${Number(v.iva_porcentaje)} % IVA`;
  if (v.precio_compra !== null && v.precio_compra !== undefined) return `${euro5(v.precio_compra)} IVA incl.${v.iva_porcentaje !== null && v.iva_porcentaje !== undefined ? ` (${Number(v.iva_porcentaje)} %)` : ""}`;
  return `${euro5(Number(v.coste_cent ?? 0) / 100)} (solo coste)`;
};

const numero = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const decimales = (v, max) => {
  const f = v * 10 ** max;
  return Math.abs(f - Math.round(f)) < 1e-6;
};

/**
 * Purchase price as typed by the owner:
 *   modo "neto": supplier net price + VAT rate  -> cost = net × (1 + VAT)
 *   modo "final": price that already includes VAT (rate only informative) -> cost = price
 * Returns { valores, coste } with database columns, or { error }.
 */
export const interpretarPrecio = ({ modo, importe, iva }) => {
  const precio = numero(importe);
  if (precio === null || precio < 0) return { error: "Indica un precio válido (0 o más)." };
  if (!decimales(precio, 4)) return { error: "El precio admite como máximo 4 decimales." };
  const tipo = iva === "" || iva === null || iva === undefined ? null : numero(iva);
  if (tipo !== null && (tipo < 0 || tipo > 100 || !decimales(tipo, 2))) return { error: "El IVA debe estar entre 0 y 100 (máximo 2 decimales)." };
  if (modo === "neto") {
    if (tipo === null) return { error: "Con precio neto hay que indicar el IVA de compra (0 si no lleva)." };
    return { valores: { precio_neto: precio, iva_porcentaje: tipo, precio_compra: null }, coste: (precio * (100 + tipo)) / 100 };
  }
  if (modo === "final") return { valores: { precio_neto: null, iva_porcentaje: tipo, precio_compra: precio }, coste: precio };
  return { error: "Elige cómo introduces el precio." };
};

// Effective cost used by the calculator (same rule as the database view)
export const costeEfectivo = (v) => {
  if (v.precio_neto !== null && v.precio_neto !== undefined) return (Number(v.precio_neto) * (100 + Number(v.iva_porcentaje))) / 100;
  if (v.precio_compra !== null && v.precio_compra !== undefined) return Number(v.precio_compra);
  return Number(v.coste_cent ?? 0) / 100;
};

// Form values to edit an existing variant's price
export const precioDeVariante = (v) => {
  if (v.precio_neto !== null && v.precio_neto !== undefined) return { modo: "neto", importe: String(Number(v.precio_neto)), iva: String(Number(v.iva_porcentaje)) };
  if (v.precio_compra !== null && v.precio_compra !== undefined) {
    return { modo: "final", importe: String(Number(v.precio_compra)), iva: v.iva_porcentaje === null || v.iva_porcentaje === undefined ? "" : String(Number(v.iva_porcentaje)) };
  }
  return { modo: "final", importe: String(Number(v.coste_cent ?? 0) / 100), iva: "" };
};

// Splits "Negro, Blanco; Rojo" or one per line, trimmed, without repeats (ignoring case)
export const separarLista = (texto) => {
  const vistos = new Set();
  return String(texto ?? "")
    .split(/[,;\n]/)
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter((t) => t && !vistos.has(t.toLowerCase()) && vistos.add(t.toLowerCase()));
};

export const claveCombinacion = (color, talla) => `${String(color).trim().toLowerCase()}|${String(talla).trim().toLowerCase()}`;

/**
 * Colour × size grid for adding variants. Nothing is created automatically:
 * the owner ticks the combinations that really exist. Existing ones are marked.
 */
export const combinaciones = (colores, tallas, existentes = []) => {
  const ya = new Set(existentes.map((v) => claveCombinacion(v.color, v.talla)));
  return colores.flatMap((color) => tallas.map((talla) => ({ color, talla, clave: claveCombinacion(color, talla), existe: ya.has(claveCombinacion(color, talla)) })));
};

const texto = (v) => (typeof v === "string" ? v.trim() : "");

export const validarProveedor = (p) => {
  const errores = [];
  if (!texto(p.nombre)) errores.push("El nombre del proveedor es obligatorio.");
  if (texto(p.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto(p.email))) errores.push("El email no es válido.");
  return errores;
};

export const validarModelo = (m) => {
  const errores = [];
  if (!texto(m.nombre)) errores.push("El nombre del modelo es obligatorio.");
  if (!texto(m.tipo)) errores.push("Indica el tipo de artículo (camiseta, sudadera, bolsa…).");
  return errores;
};

export const validarVariante = (v, existentes = [], idPropio = null) => {
  const errores = [];
  if (!texto(v.color)) errores.push("Indica el color.");
  if (!texto(v.talla)) errores.push("Indica la talla.");
  if (texto(v.color) && texto(v.talla)) {
    const clave = claveCombinacion(v.color, v.talla);
    if (existentes.some((e) => claveCombinacion(e.color, e.talla) === clave && e.id !== idPropio)) {
      errores.push(`Ya existe la variante ${texto(v.color)} · ${texto(v.talla)} en este modelo.`);
    }
  }
  return errores;
};

// Empty strings to null for optional text columns
export const limpiar = (datos, campos) => Object.fromEntries(campos.map((c) => [c, texto(datos[c]) || null]));
