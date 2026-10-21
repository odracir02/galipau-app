// Data access for supplier price-list imports. Reading the Excel file and the
// comparison happen in the browser; only the operations the owner accepted
// are sent, in one transaction (importar_tarifa).

import { desenvolver } from "../../../shared/supabase/errores";
import { leerTodo } from "../../../shared/supabase/paginar";

const MENSAJES = {
  variantes_modelo_color_talla_ci: "Una de las variantes nuevas ya existe en el catálogo (mismo color y talla). Vuelve a analizar el archivo.",
  modelos_nombre_por_proveedor: "Uno de los modelos nuevos ya existe con ese nombre. Vuelve a analizar el archivo.",
};

export const listarProveedoresTarifa = async (sb) => desenvolver(await sb.from("proveedores").select("id, nombre, activo, modalidad_tarifa").order("nombre")) ?? [];

// Current catalogue of one supplier (archived variants included) and its stored price modes
export const leerCatalogoProveedor = async (sb, proveedorId) => {
  const catalogo = await leerTodo((desde, hasta) => sb.from("v_catalogo_admin").select("*").eq("proveedor_id", proveedorId).order("variante_id").range(desde, hasta));
  const ids = new Set(catalogo.map((v) => v.variante_id));
  const tarifas = await leerTodo((desde, hasta) => sb.from("variantes_tarifas").select("variante_id, modalidad, precio, unidades").order("id").range(desde, hasta));
  const tarifasActuales = {};
  for (const t of tarifas) {
    if (!ids.has(t.variante_id)) continue;
    (tarifasActuales[t.variante_id] ??= []).push({ modalidad: t.modalidad, precio: Number(t.precio), unidades: t.unidades ?? null });
  }
  return { catalogo, tarifasActuales };
};

/** @returns {Promise<number>} id of the import */
export const importarTarifa = async (sb, meta, operaciones) => desenvolver(await sb.rpc("importar_tarifa", { p_meta: meta, p_operaciones: operaciones }), MENSAJES);

export const listarImportacionesTarifa = async (sb) =>
  desenvolver(await sb.from("importaciones").select("id, creada_en, proveedor_id, usuario, resumen, revertida_en").eq("tipo", "tarifa_proveedor").order("id", { ascending: false })) ?? [];

export const obtenerImportacionTarifa = async (sb, id) => desenvolver(await sb.from("importaciones").select("*").eq("id", id).eq("tipo", "tarifa_proveedor").single());

export const listarCambiosImportacion = async (sb, id) =>
  leerTodo((desde, hasta) => sb.from("importaciones_cambios").select("*").eq("importacion_id", id).order("id").range(desde, hasta));

export const revertirTarifa = async (sb, id) => desenvolver(await sb.rpc("revertir_tarifa", { p_importacion_id: id }));
