// Data access for the controlled imports (history and catalogue). Each import
// runs in one database transaction and can be reverted as a whole.

import { desenvolver } from "../../shared/supabase/errores";
import { leerTodo } from "../../shared/supabase/paginar";

export const huellasImportadas = async (sb) => {
  const filas = await leerTodo((desde, hasta) =>
    sb.from("presupuestos").select("id, entrada").eq("estado", "importado").order("id").range(desde, hasta)
  );
  return new Set(filas.map((f) => f.entrada?.origen?.huella).filter(Boolean));
};

export const presupuestosDeImportacion = async (sb, importacionId) =>
  desenvolver(await sb.from("presupuestos").select("id, total_cent").eq("importacion_id", importacionId)) ?? [];

export const catalogoActual = async (sb) =>
  leerTodo((desde, hasta) =>
    sb.from("v_catalogo_plano").select("id, tipo, proveedor, modelo, talla, color, coste_cent").order("id").range(desde, hasta)
  );

export const importarHistorial = async (sb, registros, resumen) =>
  desenvolver(await sb.rpc("importar_historial", { p_registros: registros, p_resumen: resumen }));

export const importarCatalogo = async (sb, filas, resumen) =>
  desenvolver(await sb.rpc("importar_catalogo", { p_filas: filas, p_resumen: resumen }));

export const revertirImportacion = async (sb, id) => desenvolver(await sb.rpc("revertir_importacion", { p_id: id }));

export const listarImportaciones = async (sb) =>
  desenvolver(await sb.from("importaciones").select("id, tipo, creada_en, resumen, revertida_en").order("creada_en", { ascending: false }).limit(50)) ?? [];
