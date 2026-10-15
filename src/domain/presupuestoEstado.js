// Immutable state helpers for the quote form (blocks and product lines).

let secuencia = 0;
export const nuevoId = (prefijo) => `${prefijo}-${Date.now().toString(36)}-${++secuencia}`;

export const ESTAMPADO_DTF = "DTF";
export const ESTAMPADO_SERIGRAFIA = "Serigrafía";

export const crearLinea = () => ({
  id: nuevoId("linea"),
  tipo: "Camiseta",
  proveedor: "",
  modelo: "",
  color: "",
  size: "",
  quantity: "",
});

export const crearBloque = () => ({
  id: nuevoId("bloque"),
  estampado: ESTAMPADO_DTF,
  area: "",
  numColores: "",
  zonas: 1,
  lineas: [crearLinea()],
});

// Fields that depend on each selector: changing a field clears every field
// below it, so no hidden, no-longer-valid value can survive.
const DEPENDIENTES = {
  tipo: ["proveedor", "modelo", "size", "color"],
  proveedor: ["modelo", "size", "color"],
  modelo: ["size", "color"],
  size: ["color"],
};

export const actualizarCampoLinea = (linea, campo, valor) => {
  if (linea[campo] === valor) return linea;
  const actualizada = { ...linea, [campo]: valor };
  for (const dependiente of DEPENDIENTES[campo] ?? []) {
    actualizada[dependiente] = "";
  }
  return actualizada;
};

const mapearBloque = (bloques, bloqueId, fn) =>
  bloques.map((b) => (b.id === bloqueId ? fn(b) : b));

export const actualizarBloque = (bloques, bloqueId, campo, valor) =>
  mapearBloque(bloques, bloqueId, (b) => ({ ...b, [campo]: valor }));

export const actualizarLinea = (bloques, bloqueId, lineaId, campo, valor) =>
  mapearBloque(bloques, bloqueId, (b) => ({
    ...b,
    lineas: b.lineas.map((l) => (l.id === lineaId ? actualizarCampoLinea(l, campo, valor) : l)),
  }));

export const agregarLinea = (bloques, bloqueId) =>
  mapearBloque(bloques, bloqueId, (b) => ({ ...b, lineas: [...b.lineas, crearLinea()] }));

// A block always keeps at least one line, and a quote at least one block.
export const eliminarLinea = (bloques, bloqueId, lineaId) =>
  mapearBloque(bloques, bloqueId, (b) =>
    b.lineas.length <= 1 ? b : { ...b, lineas: b.lineas.filter((l) => l.id !== lineaId) }
  );

export const agregarBloque = (bloques) => [...bloques, crearBloque()];

export const eliminarBloque = (bloques, bloqueId) =>
  bloques.length <= 1 ? bloques : bloques.filter((b) => b.id !== bloqueId);
