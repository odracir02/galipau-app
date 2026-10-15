// Translates Supabase / PostgreSQL errors into user-facing Spanish messages,
// mirroring the messages of the local API.

import { ErrorApi } from "../api/cliente";

const MENSAJES_RED = /failed to fetch|networkerror|load failed|fetch failed/i;

export const traducirErrorSupabase = (error, mensajesUnicos = {}) => {
  if (!error) return null;
  if (error instanceof ErrorApi) return error;
  const codigo = error.code;
  const texto = `${error.message ?? ""} ${error.details ?? ""}`;

  if (MENSAJES_RED.test(texto) || error.name === "TypeError") {
    return new ErrorApi(0, "No se puede conectar con Supabase. Comprueba la conexión a Internet o si el proyecto está en pausa (se reactiva desde el panel de Supabase).", { codigo: "sin_conexion" });
  }
  switch (codigo) {
    case "23505": {
      const restriccion = /constraint "([\w]+)"/.exec(texto)?.[1];
      return new ErrorApi(409, mensajesUnicos[restriccion] ?? "Ya existe un registro con esos datos.", { codigo: "conflicto" });
    }
    case "23503":
    case "23001":
      return new ErrorApi(409, "La operación afecta a datos relacionados que no existen o que están en uso.", { codigo: "conflicto" });
    case "23502":
      return new ErrorApi(400, "Falta un dato obligatorio.", { codigo: "datos_invalidos", campo: error.column });
    case "23514":
    case "22P02":
    case "22008":
    case "22007":
      return new ErrorApi(400, "Los datos no cumplen las reglas de integridad.", { codigo: "datos_invalidos" });
    case "42501":
      return new ErrorApi(403, "No tienes permiso para realizar esta operación.", { codigo: "prohibido" });
    case "PGRST301":
    case "PGRST302":
      return new ErrorApi(401, "La sesión ha caducado. Vuelve a iniciar sesión.", { codigo: "no_autenticado" });
    default:
      return new ErrorApi(500, error.message || "Error inesperado de Supabase.", { codigo: "error" });
  }
};

// Unwraps a supabase-js response: returns data or throws a translated error
export const desenvolver = ({ data, error }, mensajesUnicos) => {
  if (error) throw traducirErrorSupabase(error, mensajesUnicos);
  return data;
};
