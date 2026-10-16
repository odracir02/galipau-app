// Business data printed on customer documents. Stored in Supabase
// (configuracion 'empresa' and the private Storage bucket for the logo), never
// in the code: the public repository only has empty defaults.

import { desenvolver } from "../../shared/supabase/errores";
import { CONDICIONES_POR_DEFECTO } from "../presupuestos/domain/documento";

export const CLAVE_EMPRESA = "empresa";
export const RUTA_LOGO = "empresa/logo";
export const BUCKET = "archivos";
export const FORMATOS_LOGO = { "image/png": "PNG", "image/jpeg": "JPEG" };

export const EMPRESA_POR_DEFECTO = Object.freeze({
  nombre: "Galipau Arts",
  titular: "",
  nif: "",
  direccion: "",
  localidad: "",
  telefono: "",
  email: "",
  web: "",
  eslogan: "",
  idiomaPorDefecto: "va",
  validezDias: 30,
  condiciones: CONDICIONES_POR_DEFECTO,
  logo: null, // { tipo: "image/png" } when uploaded
});

export const cargarEmpresa = async (sb) => {
  const fila = desenvolver(await sb.from("configuracion").select("valor").eq("clave", CLAVE_EMPRESA).maybeSingle());
  const valor = fila?.valor && typeof fila.valor === "object" ? fila.valor : {};
  return { ...EMPRESA_POR_DEFECTO, ...valor, condiciones: { ...CONDICIONES_POR_DEFECTO, ...(valor.condiciones ?? {}) } };
};

export const guardarEmpresa = async (sb, valores) =>
  desenvolver(await sb.from("configuracion").upsert({ clave: CLAVE_EMPRESA, valor: valores }, { onConflict: "clave" }).select("valor").single()).valor;

export const subirLogo = async (sb, archivo) => {
  if (!FORMATOS_LOGO[archivo.type]) throw new Error("El logo debe ser PNG o JPG.");
  if (archivo.size > 2 * 1024 * 1024) throw new Error("El logo no puede superar 2 MB.");
  const { error } = await sb.storage.from(BUCKET).upload(RUTA_LOGO, archivo, { upsert: true, contentType: archivo.type });
  if (error) throw new Error(`No se ha podido subir el logo: ${error.message}`);
  return { tipo: archivo.type };
};

export const descargarLogo = async (sb) => {
  const { data, error } = await sb.storage.from(BUCKET).download(RUTA_LOGO);
  if (error) return null;
  return data;
};
