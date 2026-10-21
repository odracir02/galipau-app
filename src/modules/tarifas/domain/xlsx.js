// Minimal, read-only .xlsx reader: unzips the workbook and reads cell VALUES
// (shared strings, inline strings, numbers, booleans) of every sheet. It never
// evaluates formulas or touches macros: a cached formula result is read as a
// plain value and VBA parts are ignored. Works in the browser and in Node.

import { unzipSync, strFromU8 } from "fflate";

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodificar = (t) =>
  t.replace(/\r\n?/g, "\n").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTIDADES[e.toLowerCase()]
  );

// Text of a <si> or <is> element: plain <t> or rich-text runs <r><t>…</t></r> (phonetic hints <rPh> ignored)
const textoDe = (xml) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodificar(m[1])).join("");

// "AB12" -> column index 27 (0-based)
export const indiceColumna = (ref) => {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  return [...letras].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
};

const leerHoja = (xml, compartidos) => {
  const filas = [];
  for (const fila of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const numero = Number(/\br="(\d+)"/.exec(fila[1])?.[1] ?? filas.length + 1);
    const valores = [];
    for (const c of fila[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const cuerpo = c[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const tipo = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      let valor = null;
      if (tipo === "s" && v !== undefined) valor = compartidos[Number(v)] ?? null;
      else if (tipo === "inlineStr") valor = textoDe(cuerpo);
      else if (tipo === "str" && v !== undefined) valor = decodificar(v);
      else if (tipo === "b" && v !== undefined) valor = v === "1";
      else if (tipo === "e") valor = v === undefined ? "#ERROR" : decodificar(v); // e.g. "#REF!": kept so the import can flag it
      else if (v !== undefined) valor = Number(v);
      const col = ref ? indiceColumna(ref) : valores.length;
      valores[col] = valor;
    }
    filas[numero - 1] = Array.from(valores, (x) => (x === undefined ? null : x));
  }
  return Array.from(filas, (f) => f ?? []);
};

/**
 * @param {ArrayBuffer|Uint8Array} datos .xlsx file contents
 * @returns {{ hojas: { nombre: string, filas: (string|number|boolean|null)[][] }[] }}
 */
export const leerXlsx = (datos) => {
  let zip;
  try {
    zip = unzipSync(datos instanceof Uint8Array ? datos : new Uint8Array(datos));
  } catch {
    throw new Error("El archivo no es un Excel .xlsx válido.");
  }
  const texto = (ruta) => (zip[ruta] ? strFromU8(zip[ruta]) : null);
  const libro = texto("xl/workbook.xml");
  if (!libro) throw new Error("El archivo no es un Excel .xlsx válido (falta el libro).");
  const compartidos = [...(texto("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));
  const relaciones = Object.fromEntries(
    [...(texto("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map((m) => [m[1], m[2]])
  );
  const hojas = [];
  for (const h of libro.matchAll(/<sheet\b([^>]*)\/>/g)) {
    const nombre = decodificar(/\bname="([^"]*)"/.exec(h[1])?.[1] ?? `Hoja ${hojas.length + 1}`);
    const rid = /\br:id="([^"]+)"/.exec(h[1])?.[1];
    const destino = (relaciones[rid] ?? "").replace(/^\/?xl\//, "").replace(/^\//, "");
    const xml = texto(`xl/${destino}`);
    if (xml) hojas.push({ nombre, filas: leerHoja(xml, compartidos) });
  }
  if (hojas.length === 0) throw new Error("El Excel no contiene hojas legibles.");
  return { hojas };
};

// SHA-256 of the file, to identify exactly which file an import came from
export const huellaArchivo = async (datos) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", datos instanceof Uint8Array ? datos : new Uint8Array(datos));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
