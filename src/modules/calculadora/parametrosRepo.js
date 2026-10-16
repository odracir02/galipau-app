// Data access for versioned pricing parameters (Supabase table parametros_calculo).

import { desenvolver } from "../../shared/supabase/errores";

const COLUMNAS = "id, tecnica, version, estado, valores, notas, creado_en";

export const cargarParametrosActivos = async (sb, tecnica) => {
  const filas = desenvolver(
    await sb.from("parametros_calculo").select(COLUMNAS).eq("tecnica", tecnica).eq("estado", "activa").limit(1)
  );
  const fila = filas?.[0];
  return fila ? { version: fila.version, valores: fila.valores, notas: fila.notas, creadoEn: fila.creado_en } : null;
};

export const listarVersiones = async (sb, tecnica) =>
  desenvolver(await sb.from("parametros_calculo").select(COLUMNAS).eq("tecnica", tecnica).order("version", { ascending: false }).limit(50)) ?? [];

export const crearVersion = async (sb, tecnica, valores, notas) =>
  desenvolver(await sb.rpc("crear_version_parametros", { p_tecnica: tecnica, p_valores: valores, p_notas: notas || null }));
