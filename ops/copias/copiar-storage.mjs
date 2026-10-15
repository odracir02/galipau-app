// Backup of Supabase Storage files (bucket "archivos"), separate from the
// database dump. Downloads every object, records size and SHA-256 in a
// manifest, and can re-verify a downloaded folder against that manifest.
//
// Usage (in the private backup repository's workflow):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node copiar-storage.mjs descargar <folder>
//   node copiar-storage.mjs verificar <folder>
// The service role key must only ever live in that repository's secrets.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUCKET = "archivos";
export const MANIFIESTO = "manifiesto-archivos.json";
const PAGINA = 1000;

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

// Object names must stay inside the destination folder
export const rutaSegura = (nombre) => {
  if (typeof nombre !== "string" || nombre.length === 0) return false;
  const partes = nombre.split("/");
  return !nombre.startsWith("/") && !partes.some((p) => p === ".." || p === "." || p === "") && !nombre.includes("\\");
};

/** Lists every object of the bucket, recursively (folders have id === null). */
export const listarObjetos = async (storage, bucket = BUCKET, prefijo = "") => {
  const objetos = [];
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await storage.from(bucket).list(prefijo, { limit: PAGINA, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Cannot list "${prefijo || "/"}": ${error.message}`);
    for (const item of data) {
      const ruta = prefijo ? `${prefijo}/${item.name}` : item.name;
      if (item.id === null) objetos.push(...(await listarObjetos(storage, bucket, ruta)));
      else objetos.push({ ruta, bytes: item.metadata?.size ?? null });
    }
    if (data.length < PAGINA) return objetos;
  }
};

export const descargarTodo = async (storage, destino, { bucket = BUCKET, ahora = new Date() } = {}) => {
  fs.mkdirSync(destino, { recursive: true });
  const objetos = await listarObjetos(storage, bucket);
  const archivos = [];
  for (const { ruta } of objetos) {
    if (!rutaSegura(ruta)) throw new Error(`Unsafe object name refused: ${JSON.stringify(ruta)}`);
    const { data, error } = await storage.from(bucket).download(ruta);
    if (error) throw new Error(`Cannot download "${ruta}": ${error.message}`);
    const buffer = Buffer.from(await data.arrayBuffer());
    const archivo = path.join(destino, "archivos", ...ruta.split("/"));
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, buffer);
    archivos.push({ ruta, bytes: buffer.length, sha256: sha256(buffer) });
  }
  const manifiesto = { bucket, creadoEn: ahora.toISOString(), total: archivos.length, bytes: archivos.reduce((n, a) => n + a.bytes, 0), archivos };
  fs.writeFileSync(path.join(destino, MANIFIESTO), JSON.stringify(manifiesto, null, 2));
  return manifiesto;
};

export const verificarCarpeta = (destino) => {
  const manifiesto = JSON.parse(fs.readFileSync(path.join(destino, MANIFIESTO), "utf8"));
  const errores = [];
  for (const a of manifiesto.archivos) {
    const archivo = path.join(destino, "archivos", ...a.ruta.split("/"));
    if (!fs.existsSync(archivo)) {
      errores.push(`${a.ruta}: missing`);
      continue;
    }
    const buffer = fs.readFileSync(archivo);
    if (buffer.length !== a.bytes) errores.push(`${a.ruta}: size ${buffer.length} != ${a.bytes}`);
    else if (sha256(buffer) !== a.sha256) errores.push(`${a.ruta}: checksum mismatch`);
  }
  if (manifiesto.archivos.length !== manifiesto.total) errores.push("manifest total does not match its file list");
  return { manifiesto, errores };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [orden, destino] = process.argv.slice(2);
  try {
    if (orden === "descargar") {
      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const m = await descargarTodo(sb.storage, destino);
      console.log(`Downloaded ${m.total} files (${m.bytes} bytes).`);
    } else if (orden === "verificar") {
      const { manifiesto, errores } = verificarCarpeta(destino);
      if (errores.length) {
        console.error("::error::Storage backup verification FAILED:");
        errores.forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
      }
      console.log(`Storage backup verified: ${manifiesto.total} files, checksums match.`);
    } else {
      console.log("Usage: node copiar-storage.mjs descargar|verificar <folder>");
      process.exit(1);
    }
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
