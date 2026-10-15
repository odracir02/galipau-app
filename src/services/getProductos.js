// Catalogue data source for the quote form, selectable during the gradual
// migration:
//   VITE_CATALOGO_FUENTE=firebase -> legacy Firestore collection (default with the local backend)
//   VITE_CATALOGO_FUENTE=local    -> local Express API (/api/catalogo/productos)
//   VITE_CATALOGO_FUENTE=supabase -> Supabase view v_catalogo_plano (default with VITE_BACKEND=supabase)
// All return the same flat shape: { id, tipo, proveedor, modelo, talla, color, coste }.

import { api } from "../shared/api/cliente";
import { backendActivo } from "../app/backend";

export const FUENTES_CATALOGO = ["firebase", "local", "supabase"];

export const fuenteCatalogo = (valor = import.meta.env.VITE_CATALOGO_FUENTE, backend = backendActivo()) => {
  if (FUENTES_CATALOGO.includes(valor)) return valor;
  return backend === "supabase" ? "supabase" : "firebase";
};

export const leerCatalogoSupabase = async (sb) => {
  const { leerTodo } = await import("../shared/supabase/paginar");
  const filas = await leerTodo((desde, hasta) =>
    sb.from("v_catalogo_plano").select("id, tipo, proveedor, modelo, talla, color, coste_cent").order("id").range(desde, hasta)
  );
  return filas.map(({ coste_cent, ...f }) => ({ ...f, id: String(f.id), costeCent: coste_cent, coste: coste_cent / 100 }));
};

export const getProductos = async (fuente = fuenteCatalogo()) => {
  if (fuente === "local") return api.get("/catalogo/productos");
  if (fuente === "supabase") {
    const { obtenerClienteSupabase } = await import("../shared/supabase/cliente");
    return leerCatalogoSupabase(await obtenerClienteSupabase());
  }
  // Loaded on demand so Firebase is not bundled into the initial load
  const { getProductosFirebase } = await import("./catalogoFirebase");
  return getProductosFirebase();
};
