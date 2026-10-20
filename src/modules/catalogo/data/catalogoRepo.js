// Data access for catalogue administration (proveedores, modelos, variantes).
// Nothing is ever deleted from here: items are archived (activo = false).

import { desenvolver } from "../../../shared/supabase/errores";
import { leerTodo } from "../../../shared/supabase/paginar";
import { limpiar } from "../domain/catalogo";

const MENSAJES = {
  proveedores_nombre_key: "Ya existe un proveedor con ese nombre.",
  modelos_nombre_por_proveedor: "Este proveedor ya tiene un modelo con ese nombre.",
  modelos_proveedor_id_tipo_nombre_key: "Este proveedor ya tiene un modelo con ese nombre.",
  modelos_propios_nombre: "Ya hay un producto propio con ese nombre y tipo.",
  variantes_modelo_color_talla_ci: "Ya existe esa combinación de color y talla en el modelo.",
  variantes_modelo_id_color_talla_key: "Ya existe esa combinación de color y talla en el modelo.",
};

const CAMPOS_PROVEEDOR = ["nif", "email", "telefono", "web", "contacto", "referencia_cliente", "notas"];
const CAMPOS_MODELO = ["referencia", "descripcion"];

// ---- Suppliers
export const listarProveedores = async (sb) =>
  desenvolver(await sb.from("proveedores").select("id, nombre, nif, email, telefono, web, contacto, referencia_cliente, notas, activo").order("nombre")) ?? [];

export const obtenerProveedor = async (sb, id) => desenvolver(await sb.from("proveedores").select("*").eq("id", id).single());

const datosProveedor = (d) => ({ nombre: d.nombre.trim(), ...limpiar(d, CAMPOS_PROVEEDOR) });
export const crearProveedor = async (sb, d) => desenvolver(await sb.from("proveedores").insert({ ...datosProveedor(d), activo: true }).select("*").single(), MENSAJES);
export const actualizarProveedor = async (sb, id, d) => desenvolver(await sb.from("proveedores").update(datosProveedor(d)).eq("id", id).select("*").single(), MENSAJES);
export const archivarProveedor = async (sb, id, activo) => desenvolver(await sb.from("proveedores").update({ activo }).eq("id", id).select("*").single());

// ---- Models (proveedorId null = own products)
export const listarModelos = async (sb, proveedorId) => {
  let q = sb.from("modelos").select("id, proveedor_id, tipo, nombre, referencia, descripcion, activo");
  q = proveedorId === null ? q.is("proveedor_id", null) : q.eq("proveedor_id", proveedorId);
  return desenvolver(await q.order("nombre")) ?? [];
};
export const obtenerModelo = async (sb, id) => desenvolver(await sb.from("modelos").select("*").eq("id", id).single());

const datosModelo = (d) => ({ tipo: d.tipo.trim(), nombre: d.nombre.trim(), ...limpiar(d, CAMPOS_MODELO) });
export const crearModelo = async (sb, proveedorId, d) =>
  desenvolver(await sb.from("modelos").insert({ proveedor_id: proveedorId, activo: true, ...datosModelo(d) }).select("*").single(), MENSAJES);
export const actualizarModelo = async (sb, id, d) => desenvolver(await sb.from("modelos").update(datosModelo(d)).eq("id", id).select("*").single(), MENSAJES);
export const archivarModelo = async (sb, id, activo) => desenvolver(await sb.from("modelos").update({ activo }).eq("id", id).select("*").single());

// ---- Variants
export const listarVariantes = async (sb, modeloId) =>
  desenvolver(await sb.from("variantes").select("id, modelo_id, color, talla, coste_cent, precio_neto, iva_porcentaje, precio_compra, activo").eq("modelo_id", modeloId).order("id")) ?? [];

// `precio` comes from interpretarPrecio(...).valores; coste_cent is recalculated by the database
export const crearVariantes = async (sb, modeloId, filas) =>
  desenvolver(await sb.from("variantes").insert(filas.map((f) => ({ modelo_id: modeloId, color: f.color.trim(), talla: f.talla.trim(), coste_cent: f.coste_cent, activo: true, ...f.precio }))).select("*"), MENSAJES) ?? [];

export const actualizarVariante = async (sb, id, cambios) => desenvolver(await sb.from("variantes").update(cambios).eq("id", id).select("*").single(), MENSAJES);
export const archivarVariante = async (sb, id, activo) => desenvolver(await sb.from("variantes").update({ activo }).eq("id", id).select("*").single());

// ---- Overview (all variants, archived included)
export const listarCatalogoAdmin = async (sb) =>
  leerTodo((desde, hasta) => sb.from("v_catalogo_admin").select("*").order("variante_id").range(desde, hasta));
