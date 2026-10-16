// Data access for customers (public.clientes).

import { desenvolver } from "../../shared/supabase/errores";

const COLUMNAS = "id, tipo, nombre, razon_social, nif, email, telefono, direccion, codigo_postal, ciudad, provincia, notas, archivado";
const MENSAJES = { clientes_nif_key: "Ya existe un cliente con ese NIF." };

export const CAMPOS_CLIENTE = [
  { clave: "nombre", etiqueta: "Nombre", obligatorio: true },
  { clave: "razon_social", etiqueta: "Razón social" },
  { clave: "nif", etiqueta: "NIF / CIF" },
  { clave: "email", etiqueta: "Email", tipo: "email" },
  { clave: "telefono", etiqueta: "Teléfono" },
  { clave: "direccion", etiqueta: "Dirección" },
  { clave: "codigo_postal", etiqueta: "Código postal" },
  { clave: "ciudad", etiqueta: "Población" },
  { clave: "provincia", etiqueta: "Provincia" },
];

// Normalises the form: trims, empty -> null, NIF uppercase without spaces or dashes
export const normalizarCliente = (datos) => {
  const salida = {};
  for (const { clave } of CAMPOS_CLIENTE) {
    const v = typeof datos[clave] === "string" ? datos[clave].trim() : datos[clave];
    salida[clave] = v === "" || v === undefined ? null : v;
  }
  if (salida.nif) salida.nif = salida.nif.toUpperCase().replace(/[\s.-]/g, "");
  return salida;
};

export const validarCliente = (c) => {
  const errores = [];
  if (!c.nombre) errores.push("El nombre es obligatorio.");
  if (c.nif && !/^[A-Z0-9]{5,20}$/.test(c.nif)) errores.push("El NIF solo puede tener letras y números (5 a 20).");
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errores.push("El email no es válido.");
  return errores;
};

export const buscarClientes = async (sb, texto = "", limite = 20) => {
  let q = sb.from("clientes").select(COLUMNAS).eq("archivado", false);
  if (texto.trim()) q = q.ilike("nombre", `%${texto.trim().replace(/[%_]/g, "")}%`);
  return desenvolver(await q.order("nombre").limit(limite)) ?? [];
};

export const crearCliente = async (sb, datos) =>
  desenvolver(await sb.from("clientes").insert({ ...normalizarCliente(datos), archivado: false }).select(COLUMNAS).single(), MENSAJES);

export const actualizarCliente = async (sb, id, datos) =>
  desenvolver(await sb.from("clientes").update(normalizarCliente(datos)).eq("id", id).select(COLUMNAS).single(), MENSAJES);
