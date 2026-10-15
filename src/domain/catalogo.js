// Catalogue helpers: option lists for the dependent selectors and product
// lookup. The same colour classification is used for both, so the options the
// user sees always match the products found when calculating.

export const ORDEN_TALLAS = ["Niño", "S", "M", "L", "XL", "2XL", "3XL"];

export const COLOR_BLANCA = "Blanca";
export const COLOR_COLOR = "Color";

export const normalizarTexto = (texto) =>
  typeof texto === "string"
    ? texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
    : "";

// Garments are grouped as "Blanca" (white) or "Color" (any other colour).
export const categoriaColor = (color) => {
  const c = normalizarTexto(color);
  return c === "blanca" || c === "blanco" ? COLOR_BLANCA : COLOR_COLOR;
};

const unicos = (valores) => [...new Set(valores.filter((v) => v !== undefined && v !== null && v !== ""))];

const ordenarTallas = (tallas) =>
  [...tallas].sort((a, b) => ORDEN_TALLAS.indexOf(a) - ORDEN_TALLAS.indexOf(b));

export const opcionesLinea = (productos, linea) => {
  const { tipo, proveedor, modelo, size } = linea;
  const delTipo = productos.filter((p) => p.tipo === tipo);
  const delProveedor = delTipo.filter((p) => p.proveedor === proveedor);
  const delModelo = delProveedor.filter((p) => p.modelo === modelo);
  const deLaTalla = delModelo.filter((p) => p.talla === size);

  return {
    proveedores: unicos(delTipo.map((p) => p.proveedor)),
    modelos: unicos(delProveedor.map((p) => p.modelo)),
    tallas: ordenarTallas(unicos(delModelo.map((p) => p.talla))),
    colores: unicos(deLaTalla.map((p) => categoriaColor(p.color))),
  };
};

// All catalogue products matching a quote line, in catalogue order.
export const buscarProductos = (productos, linea) =>
  productos.filter(
    (p) =>
      p.tipo === linea.tipo &&
      p.proveedor === linea.proveedor &&
      p.modelo === linea.modelo &&
      p.talla === linea.size &&
      categoriaColor(p.color) === linea.color
  );

// Garment cost for a line. When several catalogue colours fall into the same
// group, the first one is used (same behaviour as before) and the ambiguity is
// reported so it can be shown to the user.
export const resolverCostePrenda = (productos, linea) => {
  const candidatos = buscarProductos(productos, linea);
  if (candidatos.length === 0) {
    return { encontrado: false, coste: 0, costesDistintos: false };
  }
  const costes = unicos(candidatos.map((p) => parseFloat(p.coste || 0)));
  return {
    encontrado: true,
    coste: parseFloat(candidatos[0].coste || 0),
    costesDistintos: costes.length > 1,
    producto: candidatos[0],
  };
};
