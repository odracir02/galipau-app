// Data access for quotes (public.presupuestos). Lifecycle rules, numbering and
// immutability are enforced by the database; this module only reads and writes.

import { desenvolver } from "../../../shared/supabase/errores";

const COLUMNAS_LISTA =
  "id, numero, estado, cliente_id, cliente_nombre, fecha_emision, valido_hasta, total_cent, precio_final_cent, precio_recomendado_cent, coste_total_cent, beneficio_cent, tecnica, creado_en, actualizado_en";

/**
 * @param {{ cliente?: string, estado?: string, desde?: string, hasta?: string, limite?: number }} filtros
 */
export const listarPresupuestos = async (sb, { cliente, estado, desde, hasta, limite = 200 } = {}) => {
  let q = sb.from("presupuestos").select(COLUMNAS_LISTA);
  if (cliente?.trim()) q = q.ilike("cliente_nombre", `%${cliente.trim().replace(/[%_]/g, "")}%`);
  if (estado) q = q.eq("estado", estado);
  if (desde) q = q.gte("fecha_emision", desde);
  if (hasta) q = q.lte("fecha_emision", hasta);
  return desenvolver(await q.order("creado_en", { ascending: false }).limit(limite)) ?? [];
};

export const obtenerPresupuesto = async (sb, id) => desenvolver(await sb.from("presupuestos").select("*").eq("id", id).single());

export const crearPresupuesto = async (sb, registro) =>
  desenvolver(await sb.from("presupuestos").insert(registro).select("*").single());

export const actualizarPresupuesto = async (sb, id, cambios) =>
  desenvolver(await sb.from("presupuestos").update(cambios).eq("id", id).select("*").single());

export const cambiarEstado = async (sb, id, estado) => actualizarPresupuesto(sb, id, { estado });

// Parameter values of a given version (to recalculate an existing quote exactly)
export const cargarVersionParametros = async (sb, tecnica, version) => {
  const fila = desenvolver(
    await sb.from("parametros_calculo").select("version, valores, estado").eq("tecnica", tecnica).eq("version", version).maybeSingle()
  );
  return fila ? { version: fila.version, valores: fila.valores, activa: fila.estado === "activa" } : null;
};
