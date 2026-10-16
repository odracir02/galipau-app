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

const COLUMNAS_CATALOGO = "id, tipo, proveedor, modelo, talla, color, coste_cent, coste, precio_neto, iva_porcentaje, referencia";
const COLUMNAS_CATALOGO_BASICAS = "id, tipo, proveedor, modelo, talla, color, coste_cent";

export const leerCatalogoSupabase = async (sb) => {
  const { leerTodo } = await import("../shared/supabase/paginar");
  const leer = (columnas) => leerTodo((desde, hasta) => sb.from("v_catalogo_plano").select(columnas).order("id").range(desde, hasta));
  let filas;
  try {
    filas = await leer(COLUMNAS_CATALOGO);
  } catch (e) {
    // Database without the net-price migration yet: read the original columns
    if (!/precio_neto|coste|referencia|42703|does not exist/i.test(`${e.message} ${e.detalles?.codigo ?? ""}`)) throw e;
    filas = await leer(COLUMNAS_CATALOGO_BASICAS);
  }
  // `coste` is exact (net × (1 + VAT) when the net price is known); coste_cent is the rounded value
  return filas.map(({ coste_cent, coste, precio_neto, iva_porcentaje, ...f }) => ({
    ...f,
    id: String(f.id),
    costeCent: coste_cent,
    coste: coste === null || coste === undefined ? coste_cent / 100 : Number(coste),
    precioNeto: precio_neto === null || precio_neto === undefined ? null : Number(precio_neto),
    ivaPorcentaje: iva_porcentaje === null || iva_porcentaje === undefined ? null : Number(iva_porcentaje),
  }));
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
