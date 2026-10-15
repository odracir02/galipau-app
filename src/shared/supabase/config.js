// Supabase configuration from Vite environment variables.
// Only the project URL and the PUBLIC (anon / publishable) key may reach the
// browser. The public key is not a security mechanism: access is protected by
// authentication + Row Level Security. Secret keys are refused outright.

const decodificarJwt = (token) => {
  try {
    const [, carga] = token.split(".");
    return JSON.parse(atob(carga.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
};

export const esClaveSecreta = (clave) => {
  if (typeof clave !== "string") return false;
  if (clave.startsWith("sb_secret_")) return true;
  const carga = clave.split(".").length === 3 ? decodificarJwt(clave) : null;
  return carga?.role === "service_role" || carga?.role === "supabase_admin";
};

export class ErrorConfiguracion extends Error {}

export const leerConfigSupabase = (entorno = import.meta.env) => {
  const url = entorno.VITE_SUPABASE_URL;
  const clave = entorno.VITE_SUPABASE_PUBLISHABLE_KEY || entorno.VITE_SUPABASE_ANON_KEY;

  if (!url || !clave) {
    throw new ErrorConfiguracion("Falta la configuración de Supabase (VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY).");
  }
  let urlValida;
  try {
    urlValida = new URL(url);
  } catch {
    throw new ErrorConfiguracion("VITE_SUPABASE_URL no es una URL válida.");
  }
  if (urlValida.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(urlValida.hostname)) {
    throw new ErrorConfiguracion("VITE_SUPABASE_URL debe usar HTTPS.");
  }
  if (esClaveSecreta(clave)) {
    throw new ErrorConfiguracion(
      "Se ha configurado una clave SECRETA de Supabase en la interfaz. Usa solo la clave pública (anon/publishable) y revoca la secreta en el panel de Supabase."
    );
  }
  return { url: urlValida.origin, clave };
};
