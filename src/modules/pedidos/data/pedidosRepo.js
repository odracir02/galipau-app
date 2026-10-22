// Data access for orders. Every change goes through a database function
// (owner only, one transaction, logged in pedido_eventos).

import { desenvolver } from "../../../shared/supabase/errores";
import { leerTodo } from "../../../shared/supabase/paginar";

const MENSAJES = { pedidos_presupuesto_activo: "Este presupuesto ya tiene un pedido." };

export const listarPedidos = async (sb) =>
  leerTodo((desde, hasta) => sb.from("v_pedidos").select("*").order("id", { ascending: false }).range(desde, hasta));

export const obtenerPedido = async (sb, id) => {
  const [pedido, lineas, eventos, material] = await Promise.all([
    sb.from("pedidos").select("*").eq("id", id).single(),
    sb.from("pedido_lineas").select("*").eq("pedido_id", id).order("orden"),
    sb.from("pedido_eventos").select("*").eq("pedido_id", id).order("id", { ascending: false }),
    sb.from("v_pedidos_material").select("*").eq("pedido_id", id).order("variante_id"),
  ]);
  return { pedido: desenvolver(pedido), lineas: desenvolver(lineas) ?? [], eventos: desenvolver(eventos) ?? [], material: desenvolver(material) ?? [] };
};

// The active (not cancelled) order of a quote, or null; undefined when the database has no orders yet
export const pedidoDePresupuesto = async (sb, presupuestoId) => {
  const r = await sb.from("pedidos").select("id, numero, estado").eq("presupuesto_id", presupuestoId).neq("estado", "cancelado").maybeSingle();
  return r.error ? undefined : r.data;
};

const rpc = async (sb, nombre, args) => desenvolver(await sb.rpc(nombre, args), MENSAJES);

export const crearPedidoDesdePresupuesto = (sb, presupuestoId, datos) => rpc(sb, "crear_pedido_desde_presupuesto", { p_presupuesto_id: presupuestoId, p_datos: datos });
export const crearPedido = (sb, datos) => rpc(sb, "crear_pedido", { p_datos: datos });
export const actualizarPedido = (sb, id, datos) => rpc(sb, "pedido_actualizar", { p_pedido_id: id, p_datos: datos });
export const actualizarLineas = (sb, id, lineas) => rpc(sb, "pedido_actualizar_lineas", { p_pedido_id: id, p_lineas: lineas });
export const cambiarEstadoPedido = (sb, id, estado, motivo = null) => rpc(sb, "pedido_cambiar_estado", { p_pedido_id: id, p_estado: estado, p_motivo: motivo });
export const registrarCobro = (sb, id, importeCent, nota = null) => rpc(sb, "pedido_registrar_cobro", { p_pedido_id: id, p_importe_cobrado_cent: importeCent, p_nota: nota });
export const reservarPrendas = (sb, id, lineas, registrarFaltantes) => rpc(sb, "pedido_reservar", { p_pedido_id: id, p_lineas: lineas, p_registrar_faltantes: registrarFaltantes });
export const liberarPrendas = (sb, id, varianteId = null) => rpc(sb, "pedido_liberar", { p_pedido_id: id, p_variante_id: varianteId });
export const consumirPrendas = (sb, id, varianteId, cantidad, tipo, motivo, desdeDisponible = false) =>
  rpc(sb, "pedido_consumir", { p_pedido_id: id, p_variante_id: varianteId, p_cantidad: cantidad, p_tipo: tipo, p_motivo: motivo || null, p_desde_disponible: desdeDisponible });
export const devolverPrendas = (sb, id, varianteId, cantidad, motivo) => rpc(sb, "pedido_devolver", { p_pedido_id: id, p_variante_id: varianteId, p_cantidad: cantidad, p_motivo: motivo || null });
export const estadoNecesidad = (sb, id, varianteId, estado) => rpc(sb, "pedido_necesidad_estado", { p_pedido_id: id, p_variante_id: varianteId, p_estado: estado });

export const listarNecesidades = async (sb) =>
  leerTodo((desde, hasta) => sb.from("v_necesidades_pedidos").select("*").order("proveedor").order("modelo").range(desde, hasta));
