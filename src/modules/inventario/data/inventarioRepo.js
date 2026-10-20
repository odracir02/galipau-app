// Data access for the inventory. Quantities only change through database
// functions (atomic, row-locked); tables are read here and never written directly.

import { desenvolver } from "../../../shared/supabase/errores";
import { leerTodo } from "../../../shared/supabase/paginar";

const MENSAJES = { stock_reserva_activa_unica: "Ya hay una reserva activa de este artículo para esa referencia.", stock_inicial_unico: "Este artículo ya tiene inventario inicial." };

export const listarStock = async (sb) => leerTodo((desde, hasta) => sb.from("v_stock").select("*").order("articulo_id").range(desde, hasta));

export const obtenerArticulo = async (sb, varianteId) => desenvolver(await sb.from("v_stock").select("*").eq("variante_id", Number(varianteId)).maybeSingle());

export const listarMovimientos = async (sb, articuloId) =>
  desenvolver(await sb.from("stock_movimientos").select("*").eq("articulo_id", articuloId).order("id", { ascending: false }).limit(500)) ?? [];

export const listarReservas = async (sb, articuloId) =>
  desenvolver(await sb.from("stock_reservas").select("*").eq("articulo_id", articuloId).order("id", { ascending: false })) ?? [];

export const registrarMovimiento = async (sb, { varianteId, tipo, cantidad, motivo, referencia, coste, fecha }) =>
  desenvolver(await sb.rpc("stock_registrar", {
    p_variante_id: Number(varianteId), p_tipo: tipo, p_cantidad: cantidad, p_motivo: motivo || null,
    p_referencia: referencia || null, p_coste_unitario: coste ?? null, p_fecha: fecha || null,
  }));

export const cargarInventarioInicial = async (sb, lineas, motivo) =>
  desenvolver(await sb.rpc("stock_carga_inicial", { p_lineas: lineas, p_motivo: motivo || null }), MENSAJES);

export const corregirMovimiento = async (sb, movimientoId, motivo) => desenvolver(await sb.rpc("stock_corregir", { p_movimiento_id: movimientoId, p_motivo: motivo }));

export const reservar = async (sb, varianteId, cantidad, referencia) =>
  desenvolver(await sb.rpc("stock_reservar", { p_variante_id: Number(varianteId), p_cantidad: cantidad, p_referencia: referencia }), MENSAJES);

export const liberarReserva = async (sb, reservaId) => desenvolver(await sb.rpc("stock_liberar_reserva", { p_reserva_id: reservaId }));

export const actualizarArticulo = async (sb, articuloId, { stock_minimo, ubicacion, notas }) =>
  desenvolver(await sb.from("stock_articulos").update({ stock_minimo, ubicacion: ubicacion || null, notas: notas || null }).eq("id", articuloId).select("*").single());

export const listarComprasSugeridas = async (sb) => desenvolver(await sb.from("v_stock_compras").select("*").order("modelo")) ?? [];

export const listarNecesidades = async (sb) =>
  desenvolver(await sb.from("stock_necesidades").select("*").eq("estado", "pendiente").order("id", { ascending: false })) ?? [];
export const crearNecesidad = async (sb, varianteId, cantidad, referencia) =>
  desenvolver(await sb.from("stock_necesidades").insert({ variante_id: Number(varianteId), cantidad, referencia: referencia || null, estado: "pendiente" }).select("*").single());
export const cerrarNecesidad = async (sb, id, estado) => desenvolver(await sb.from("stock_necesidades").update({ estado }).eq("id", id).select("*").single());
