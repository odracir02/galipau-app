// Data access for purchases. Reads come from views; every change goes through a
// database function (owner only, one transaction, logged in compra_eventos).

import { desenvolver } from "../../../shared/supabase/errores";
import { leerTodo } from "../../../shared/supabase/paginar";

const MENSAJES = { compras_borrador_por_proveedor: "Este proveedor ya tiene un borrador de compra." };

export const listarPorComprar = (sb) =>
  leerTodo((desde, hasta) => sb.from("v_compras_por_comprar").select("*").order("proveedor").order("modelo").order("variante_id").range(desde, hasta));
export const listarPedidosPorComprar = (sb) =>
  leerTodo((desde, hasta) => sb.from("v_compras_por_comprar_pedidos").select("*").order("variante_id").range(desde, hasta));
export const listarCompras = (sb) => leerTodo((desde, hasta) => sb.from("v_compras").select("*").order("id", { ascending: false }).range(desde, hasta));
export const listarProveedores = async (sb) => desenvolver(await sb.from("proveedores").select("id, nombre, activo").order("nombre")) ?? [];

export const obtenerCompra = async (sb, id) => {
  const [compra, lineas, eventos] = await Promise.all([
    sb.from("v_compras").select("*").eq("id", id).single(),
    sb.from("v_compras_lineas").select("*").eq("compra_id", id).order("orden"),
    sb.from("compra_eventos").select("*").eq("compra_id", id).order("id", { ascending: false }),
  ]);
  return { compra: desenvolver(compra), lineas: desenvolver(lineas) ?? [], eventos: desenvolver(eventos) ?? [] };
};

// Garments of one supplier, to add to a purchase by hand
export const catalogoProveedor = (sb, proveedorId) =>
  leerTodo((desde, hasta) =>
    sb.from("v_catalogo_admin").select("variante_id, modelo, referencia, marca, color, talla, disponible").eq("proveedor_id", proveedorId).order("modelo").order("variante_id").range(desde, hasta)
  );

// Pending purchases of some variants (for the orders screen); [] when the database has no purchases yet
export const comprasPendientesDeVariantes = async (sb, varianteIds) => {
  if (!varianteIds.length) return [];
  const r = await sb.from("v_compras_lineas").select("compra_id, numero, variante_id, pendiente, estado").in("variante_id", varianteIds).eq("estado", "pedida");
  return r.error ? [] : (r.data ?? []).filter((l) => l.pendiente > 0);
};

const rpc = async (sb, nombre, args) => desenvolver(await sb.rpc(nombre, args), MENSAJES);

export const prepararCompra = async (sb, proveedorId) => Number(await rpc(sb, "compra_preparar", { p_proveedor_id: proveedorId }));
export const guardarLineas = (sb, id, lineas) => rpc(sb, "compra_guardar_lineas", { p_compra_id: id, p_lineas: lineas });
export const marcarPedida = (sb, id, referencia) => rpc(sb, "compra_marcar_pedida", { p_compra_id: id, p_referencia: referencia || null });
export const actualizarCompra = (sb, id, datos) => rpc(sb, "compra_actualizar", { p_compra_id: id, p_datos: datos });
export const volverABorrador = (sb, id) => rpc(sb, "compra_volver_borrador", { p_compra_id: id });
export const descartarBorrador = (sb, id) => rpc(sb, "compra_descartar", { p_compra_id: id });
export const cancelarCompra = (sb, id, motivo) => rpc(sb, "compra_cancelar", { p_compra_id: id, p_motivo: motivo });
export const cerrarPendiente = (sb, id, motivo) => rpc(sb, "compra_cerrar_pendiente", { p_compra_id: id, p_motivo: motivo });
export const previsualizarRecepcion = (sb, id, lineas) => rpc(sb, "compra_previsualizar_recepcion", { p_compra_id: id, p_lineas: lineas });
// One receipt, atomically. clave identifies the request: sending it again records nothing new.
export const recibirCompra = (sb, id, { clave, lineas, esperado, fecha, albaran, confirmarExceso }) =>
  rpc(sb, "compra_recibir", {
    p_compra_id: id, p_clave: clave, p_lineas: lineas,
    p_esperado: esperado.map(({ pedido_id, variante_id, cantidad }) => ({ pedido_id, variante_id, cantidad })),
    p_fecha: fecha || null, p_albaran: albaran || null, p_confirmar_exceso: Boolean(confirmarExceso),
  });
