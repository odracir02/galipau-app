// Checks a Supabase project from the outside, as an anonymous visitor, with
// only the PUBLIC information the web app already contains (URL and
// publishable key). Nothing is written. It verifies that:
//   - no table returns data without logging in (RLS / privileges);
//   - the database functions cannot be called anonymously;
//   - public sign-up is disabled.
//
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... node ops/produccion/verificar.mjs

import path from "node:path";
import { fileURLToPath } from "node:url";
import { esClaveSecreta } from "../../src/shared/supabase/config.js";

export const TABLAS = [
  "clientes", "configuracion", "contadores", "importaciones", "modelos", "parametros_calculo",
  "presupuestos", "propietario", "proveedores", "registro_copias", "variantes", "v_catalogo_plano", "v_catalogo_admin",
];

// Called with arguments that would fail anyway: they must be rejected before running
export const FUNCIONES = {
  siguiente_numero: { p_serie: "ZZZZZ", p_anio: 2999 },
  siguiente_numero_presupuesto: { p_anio: 2999 },
  crear_version_parametros: { p_tecnica: "x", p_valores: {} },
  importar_historial: { p_registros: [] },
  importar_catalogo: { p_filas: [] },
  revertir_importacion: { p_id: -1 },
  transicion_presupuesto_permitida: { p_desde: "x", p_hasta: "y" },
};

const denegado = (estado) => estado === 401 || estado === 403 || estado === 404;

/** @returns {Promise<{ ok: boolean, resultados: { prueba: string, ok: boolean, detalle: string }[] }>} */
export const verificarProyecto = async ({ url, clave, fetch: pedir = globalThis.fetch }) => {
  if (!url || !clave) throw new Error("Faltan SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY.");
  if (esClaveSecreta(clave)) throw new Error("Esa es una clave SECRETA: usa la clave pública (publishable/anon). No la compartas.");
  const base = url.replace(/\/+$/, "");
  const cabeceras = { apikey: clave, Authorization: `Bearer ${clave}`, "Content-Type": "application/json" };
  const resultados = [];

  for (const tabla of TABLAS) {
    const r = await pedir(`${base}/rest/v1/${tabla}?select=*&limit=1`, { headers: cabeceras });
    const cuerpo = await r.text();
    // A wrong key is also answered with 401: that must not pass as "access denied"
    if (/invalid api key/i.test(cuerpo)) throw new Error("La clave no es válida para este proyecto (Invalid API key): revisa que esté completa y que sea de este proyecto.");
    let filas = null;
    try {
      filas = JSON.parse(cuerpo);
    } catch {
      /* not JSON */
    }
    const ok = denegado(r.status) || (r.status === 200 && Array.isArray(filas) && filas.length === 0);
    resultados.push({ prueba: `tabla ${tabla}`, ok, detalle: ok ? (denegado(r.status) ? `acceso denegado (${r.status})` : "sin filas visibles") : `¡DATOS VISIBLES! (${r.status})` });
  }

  for (const [nombre, args] of Object.entries(FUNCIONES)) {
    const r = await pedir(`${base}/rest/v1/rpc/${nombre}`, { method: "POST", headers: cabeceras, body: JSON.stringify(args) });
    const ok = denegado(r.status);
    resultados.push({ prueba: `función ${nombre}`, ok, detalle: ok ? `denegada (${r.status})` : `¡EJECUTABLE SIN SESIÓN! (${r.status})` });
  }

  const r = await pedir(`${base}/auth/v1/settings`, { headers: { apikey: clave } });
  const ajustes = r.ok ? await r.json() : null;
  const sinRegistro = ajustes?.disable_signup === true;
  resultados.push({ prueba: "registro público", ok: sinRegistro, detalle: ajustes ? (sinRegistro ? "desactivado" : "¡ACTIVADO! Desactívalo en Authentication → Sign In / Providers") : `no se pudo leer (${r.status})` });

  return { ok: resultados.every((x) => x.ok), resultados };
};

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  try {
    const { ok, resultados } = await verificarProyecto({ url: process.env.SUPABASE_URL, clave: process.env.SUPABASE_PUBLISHABLE_KEY });
    for (const x of resultados) console.log(`${x.ok ? "OK   " : "FALLO"}  ${x.prueba}: ${x.detalle}`);
    console.log(ok ? "\nTodo correcto: sin sesión no se ve ni se ejecuta nada." : "\nHay problemas de seguridad: revisa las líneas FALLO.");
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
