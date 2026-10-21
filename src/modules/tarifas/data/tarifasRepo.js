// Data access for supplier price-list imports. Reading the Excel file and the
// comparison happen in the browser; only the operations the owner accepted
// are sent, in one transaction (importar_tarifa).

import { desenvolver, traducirErrorSupabase } from "../../../shared/supabase/errores";
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

export const TAMANO_LOTE = 500;

// Errors worth retrying the same batch for (network, timeout, lock): the batch is idempotent
const TRANSITORIOS = new Set(["57014", "40001", "40P01", "PGRST000", "PGRST001", "PGRST002", "PGRST003"]);
export const esErrorTransitorio = (error) =>
  !error?.code || TRANSITORIOS.has(error.code) || /failed to fetch|networkerror|load failed|fetch failed|timeout/i.test(`${error.message ?? ""}`);

/**
 * Sends the accepted operations in numbered batches under one client key.
 * Each batch is a transaction; repeating a batch that was already saved does
 * nothing, so a transient error is retried safely. If a batch fails for good,
 * the error carries what is needed to resume or revert:
 *   { clave, importacionId, lote (failed), lotes, lotesAplicados }
 * @param {{ clave?: string, desdeLote?: number, tamano?: number, reintentos?: number, alAvanzar?: (lote: number, lotes: number) => void }} [o]
 * @returns {Promise<number>} id of the import
 */
export const importarTarifa = async (sb, meta, operaciones, { clave = globalThis.crypto.randomUUID(), desdeLote = 1, tamano = TAMANO_LOTE, reintentos = 2, alAvanzar } = {}) => {
  const lotes = Math.max(1, Math.ceil(operaciones.length / tamano));
  let id = null;
  for (let n = desdeLote; n <= lotes; n++) {
    const args = { p_meta: meta, p_operaciones: operaciones.slice((n - 1) * tamano, n * tamano), p_clave: clave, p_lote: n, p_total: lotes };
    let respuesta;
    for (let intento = 0; ; intento++) {
      try {
        respuesta = await sb.rpc("importar_tarifa", args);
      } catch (e) {
        respuesta = { data: null, error: e };
      }
      if (!respuesta.error || !esErrorTransitorio(respuesta.error) || intento >= reintentos) break;
    }
    if (respuesta.error) {
      const e = traducirErrorSupabase(respuesta.error, MENSAJES);
      throw Object.assign(e, { clave, importacionId: id, lote: n, lotes, lotesAplicados: n - 1 });
    }
    id = respuesta.data;
    alAvanzar?.(n, lotes);
  }
  return id;
};

// The import a client key created (e.g. when the answer to the first batch was lost)
export const buscarImportacionPorClave = async (sb, clave) =>
  desenvolver(await sb.from("importaciones").select("id, resumen, revertida_en").eq("clave", clave).maybeSingle());

// Imports of a supplier that stopped half-way and were not reverted
export const importacionesIncompletas = (lista, proveedorId) =>
  lista.filter((i) => i.proveedor_id === proveedorId && !i.revertida_en && i.resumen?.estado === "en_curso");

export const listarImportacionesTarifa = async (sb) =>
  desenvolver(await sb.from("importaciones").select("id, creada_en, proveedor_id, usuario, resumen, revertida_en").eq("tipo", "tarifa_proveedor").order("id", { ascending: false })) ?? [];

export const obtenerImportacionTarifa = async (sb, id) => desenvolver(await sb.from("importaciones").select("*").eq("id", id).eq("tipo", "tarifa_proveedor").single());

export const listarCambiosImportacion = async (sb, id) =>
  leerTodo((desde, hasta) => sb.from("importaciones_cambios").select("*").eq("importacion_id", id).order("id").range(desde, hasta));

export const revertirTarifa = async (sb, id) => desenvolver(await sb.rpc("revertir_tarifa", { p_importacion_id: id }));
