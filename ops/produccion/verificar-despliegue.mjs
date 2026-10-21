// Checks which Supabase project a deployed web is built against, by reading
// its public JavaScript (nothing is written, no login). Used to prove that the
// production and test webs never point to each other's database.
//
//   node ops/produccion/verificar-despliegue.mjs https://galipau-app.pages.dev <expected-project-ref>

import path from "node:path";
import { fileURLToPath } from "node:url";

const REF = /https:\/\/([a-z0-9]{20})\.supabase\.co/g;

export const analizarDespliegue = async (url, { fetch: pedir = globalThis.fetch } = {}) => {
  const base = url.replace(/\/+$/, "");
  const html = await (await pedir(`${base}/`)).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]);
  if (scripts.length === 0) throw new Error(`No se encuentra el código de la aplicación en ${base}.`);
  const refs = new Set();
  const vistos = new Set();
  const pendientes = scripts.map((s) => new URL(s, `${base}/`).href);
  // Entry script plus the chunks it imports (the Supabase settings may live in one of them)
  while (pendientes.length && vistos.size < 60) {
    const js = pendientes.shift();
    if (vistos.has(js)) continue;
    vistos.add(js);
    const codigo = await (await pedir(js)).text();
    for (const m of codigo.matchAll(REF)) refs.add(m[1]);
    for (const m of codigo.matchAll(/["'](\.?\/?assets\/[\w.-]+\.js)["']/g)) pendientes.push(new URL(m[1].replace(/^\.?\/?/, "/"), `${base}/`).href);
  }
  return { url: base, refs: [...refs], archivos: vistos.size };
};

export const comprobarDespliegue = (analisis, refEsperado) => {
  const errores = [];
  if (analisis.refs.length === 0) errores.push("No se ha encontrado ninguna dirección de Supabase en el código publicado.");
  for (const r of analisis.refs) if (r !== refEsperado) errores.push(`Apunta a otro proyecto de Supabase: ${r}.`);
  if (!analisis.refs.includes(refEsperado)) errores.push(`No apunta al proyecto esperado (${refEsperado}).`);
  return errores;
};

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const [url, ref] = process.argv.slice(2);
  if (!url || !ref) {
    console.error("Uso: node ops/produccion/verificar-despliegue.mjs <url> <ref-del-proyecto-supabase>");
    process.exit(2);
  }
  const a = await analizarDespliegue(url);
  const errores = comprobarDespliegue(a, ref);
  console.log(`${a.url}: proyectos de Supabase en el código: ${a.refs.join(", ") || "ninguno"} (${a.archivos} archivos revisados)`);
  console.log(errores.length ? `FALLO: ${errores.join(" ")}` : "OK: apunta solo al proyecto esperado.");
  process.exit(errores.length ? 1 : 0);
}
