// Data access for catalogue categories and bulk classification of models.
// Classifying only changes modelos.tipo (through clasificar_modelos).

import { desenvolver } from "../../../shared/supabase/errores";
import { leerTodo } from "../../../shared/supabase/paginar";

const MENSAJES = { categorias_nombre_ci: "Ya existe una categoría con ese nombre.", categorias_nombre_key: "Ya existe una categoría con ese nombre." };

// The owner's list in order; null if the database does not have categories yet
export const listarCategorias = async (sb) => {
  const r = await sb.from("categorias").select("id, nombre, orden").order("orden").order("nombre");
  return r.error ? null : r.data ?? [];
};

export const crearCategoria = async (sb, nombre, orden) => desenvolver(await sb.from("categorias").insert({ nombre: nombre.trim(), orden }).select("*").single(), MENSAJES);
export const renombrarCategoria = async (sb, id, nombre) => desenvolver(await sb.from("categorias").update({ nombre: nombre.trim() }).eq("id", id).select("*").single(), MENSAJES);
export const ordenarCategoria = async (sb, id, orden) => desenvolver(await sb.from("categorias").update({ orden }).eq("id", id).select("id").single());
export const borrarCategoria = async (sb, id) => desenvolver(await sb.from("categorias").delete().eq("id", id));
export const fusionarCategorias = async (sb, origen, destino) => desenvolver(await sb.rpc("fusionar_categorias", { p_origen: origen, p_destino: destino }));

/** Models with supplier, brand, category and number of variants (archived included) */
export const listarModelosClasificacion = async (sb) => {
  const variantes = await leerTodo((desde, hasta) => sb.from("v_catalogo_admin").select("*").order("variante_id").range(desde, hasta));
  const descripciones = await leerTodo((desde, hasta) => sb.from("modelos").select("id, descripcion").order("id").range(desde, hasta));
  const descripcion = new Map(descripciones.map((d) => [d.id, d.descripcion]));
  const modelos = new Map();
  for (const v of variantes) {
    if (!modelos.has(v.modelo_id))
      modelos.set(v.modelo_id, {
        id: v.modelo_id, nombre: v.modelo, tipo: v.tipo, proveedor_id: v.proveedor_id, proveedor: v.propio ? "Productos propios" : v.proveedor,
        marca: v.marca ?? null, referencia: v.referencia ?? null, activo: v.modelo_activo !== false, descripcion: descripcion.get(v.modelo_id) ?? null, variantes: 0,
      });
    modelos.get(v.modelo_id).variantes++;
  }
  return [...modelos.values()].sort((a, b) => a.id - b.id);
};

/** @returns {Promise<{ lote: string, cambiados: number, sin_cambio: number }>} */
export const clasificarModelos = async (sb, ids, categoria) => desenvolver(await sb.rpc("clasificar_modelos", { p_modelos: ids, p_categoria: categoria }));
export const deshacerClasificacion = async (sb, lote) => desenvolver(await sb.rpc("deshacer_clasificacion", { p_lote: lote }));
