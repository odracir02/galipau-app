// Catalogue data source for the quote form, selectable during the gradual
// migration from Firebase to the local SQLite database:
//   VITE_CATALOGO_FUENTE=firebase (default) -> legacy Firestore collection
//   VITE_CATALOGO_FUENTE=local              -> local API (/api/catalogo/productos)
// Both return the same flat shape: { id, tipo, proveedor, modelo, talla, color, coste }.

import { api } from "../shared/api/cliente";

export const FUENTES_CATALOGO = ["firebase", "local"];

export const fuenteCatalogo = (valor = import.meta.env.VITE_CATALOGO_FUENTE) =>
  FUENTES_CATALOGO.includes(valor) ? valor : "firebase";

export const getProductos = async (fuente = fuenteCatalogo()) => {
  if (fuente === "local") return api.get("/catalogo/productos");
  // Loaded on demand so Firebase is not bundled into the initial load
  const { getProductosFirebase } = await import("./catalogoFirebase");
  return getProductosFirebase();
};
