// Catalogue helpers: option lists for the dependent selectors and product
// lookup. The same colour classification is used for both, so the options the
// user sees always match the products found when calculating.

export const ORDEN_TALLAS = [
  "Niño", "02A", "04A", "06A", "08A", "10A", "12A", "14A", "16A",
  "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "XXXL", "4XL", "5XL", "TU",
];

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

// Known sizes in garment order; unknown ones go last, alphabetically
const posicionTalla = (t) => {
  const i = ORDEN_TALLAS.findIndex((x) => x.toLowerCase() === String(t).toLowerCase());
  return i === -1 ? ORDEN_TALLAS.length : i;
};
const ordenarTallas = (tallas) =>
  [...tallas].sort((a, b) => posicionTalla(a) - posicionTalla(b) || String(a).localeCompare(String(b)));

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

// ---------------------------------------------------------------------------
// Exact product selection (real-cost calculator and quotes):
// supplier -> model -> colour -> size, with the real colour, so the price is
// the one of that exact variant. Only existing combinations are offered.
// ---------------------------------------------------------------------------

const ordenAlfabetico = (lista) => [...lista].sort((a, b) => String(a).localeCompare(String(b), "es"));

export const opcionesPrenda = (productos, linea, busqueda = "") => {
  const q = normalizarTexto(busqueda);
  const visibles = q
    ? productos.filter((p) => normalizarTexto(`${p.proveedor} ${p.modelo} ${p.tipo ?? ""} ${p.referencia ?? ""}`).includes(q))
    : productos;
  const delProveedor = visibles.filter((p) => p.proveedor === linea.proveedor);
  const delModelo = delProveedor.filter((p) => p.modelo === linea.modelo);
  const delColor = delModelo.filter((p) => p.color === linea.color);
  return {
    proveedores: ordenAlfabetico(unicos(visibles.map((p) => p.proveedor))),
    modelos: ordenAlfabetico(unicos(delProveedor.map((p) => p.modelo))),
    colores: ordenAlfabetico(unicos(delModelo.map((p) => p.color))),
    tallas: ordenarTallas(unicos(delColor.map((p) => p.talla))),
  };
};

// Changing a level clears the levels below it and the chosen product
const NIVELES = ["proveedor", "modelo", "color", "size"];
export const elegirEnPrenda = (linea, campo, valor, productos) => {
  const nueva = { ...linea, [campo]: valor };
  for (const c of NIVELES.slice(NIVELES.indexOf(campo) + 1)) nueva[c] = "";
  delete nueva.precioGuardado;
  const producto = productos.find(
    (p) => p.proveedor === nueva.proveedor && p.modelo === nueva.modelo && p.color === nueva.color && p.talla === nueva.size
  );
  nueva.productoId = producto ? String(producto.id) : "";
  if (producto) nueva.tipo = producto.tipo ?? nueva.tipo;
  return nueva;
};

export const productoPorId = (productos, id) => (id ? productos.find((p) => String(p.id) === String(id)) ?? null : null);
