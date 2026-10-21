// Which environment this web build is (set per Cloudflare Pages project with
// VITE_ENTORNO) and the check against the mark stored in the database
// (configuracion 'entorno'), so a test web can never work on production data
// and the production web never on test data.

export const ENTORNOS = {
  produccion: { nombre: "Producción" },
  pruebas: { nombre: "Pruebas", aviso: "ENTORNO DE PRUEBAS · datos ficticios · no es la web real" },
};

// Reads the environment mark of the connected database (owner only, after login)
export const leerEntornoBd = async (sb) => {
  const { data, error } = await sb.from("configuracion").select("valor").eq("clave", "entorno").maybeSingle();
  if (error) throw error;
  return typeof data?.valor === "string" ? data.valor : null;
};

export const entornoWeb = (valor = import.meta.env.VITE_ENTORNO) => (valor === "pruebas" ? "pruebas" : "produccion");

/**
 * @param {"produccion"|"pruebas"} web this build
 * @param {string|null} bd mark read from the database (null = not marked or not readable)
 * @returns {{ estado: "ok"|"aviso"|"bloqueo", mensaje?: string }}
 */
export const comprobarEntorno = (web, bd) => {
  if (web === "pruebas" && bd === "produccion") {
    return { estado: "bloqueo", mensaje: "Esta es la web de PRUEBAS, pero está conectada a la base de datos de PRODUCCIÓN. Se ha bloqueado para no modificar datos reales: revisa las variables VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY del proyecto de pruebas en Cloudflare." };
  }
  if (web === "produccion" && bd === "pruebas") {
    return { estado: "bloqueo", mensaje: "Esta es la web de PRODUCCIÓN, pero está conectada a la base de datos de PRUEBAS. Se ha bloqueado para no trabajar con datos ficticios: revisa las variables del proyecto de producción en Cloudflare." };
  }
  if (web === "pruebas" && bd !== "pruebas") {
    return { estado: "aviso", mensaje: "La base de datos no está marcada como de pruebas. Ejecuta supabase/datos-ficticios.sql en el proyecto de pruebas (marca el entorno y carga datos ficticios)." };
  }
  return { estado: "ok" };
};
