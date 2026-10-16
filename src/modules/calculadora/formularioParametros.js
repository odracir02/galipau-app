// Conversion between parameter values and the editable form (text fields).

import { CAMPOS_PARAMETROS } from "../../domain/calculo/serigrafia/parametros";
import { leerNumero } from "../../shared/utils/dinero";

const texto = (v) => (v === null || v === undefined ? "" : String(v));

export const consumibleVacio = () => ({ clave: "", nombre: "", base: "pantalla", precio: "", contenido: "1", unidad: "", rendimiento: "", consumo: "" });

export const aFormulario = (valores) => ({
  // Optional rules missing in older versions start with their initial value, so saving creates a version with them
  campos: Object.fromEntries(CAMPOS_PARAMETROS.map((c) => [c.clave, texto(valores?.[c.clave] ?? c.valorInicial)])),
  consumibles: (valores?.consumibles ?? []).map((c) => ({
    clave: c.clave, nombre: c.nombre, base: c.base, precio: texto(c.precio), contenido: texto(c.contenido),
    unidad: texto(c.unidad), rendimiento: texto(c.rendimiento), consumo: texto(c.consumo), notas: c.notas,
  })),
});

const claveDe = (nombre, usadas) => {
  const base = (nombre || "consumible").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "consumible";
  let clave = base;
  for (let n = 2; usadas.has(clave); n++) clave = `${base}_${n}`;
  usadas.add(clave);
  return clave;
};

export const desdeFormulario = (form) => {
  const valores = Object.fromEntries(CAMPOS_PARAMETROS.map((c) => [c.clave, leerNumero(form.campos[c.clave])]));
  const usadas = new Set();
  valores.consumibles = form.consumibles.map((c) => {
    const rendimiento = leerNumero(c.rendimiento);
    const consumo = leerNumero(c.consumo);
    const salida = {
      clave: c.clave || claveDe(c.nombre, usadas),
      nombre: c.nombre.trim(),
      base: c.base,
      precio: leerNumero(c.precio),
      contenido: leerNumero(c.contenido),
      unidad: c.unidad.trim(),
    };
    if (c.clave) usadas.add(c.clave);
    if (rendimiento !== null) salida.rendimiento = rendimiento;
    if (consumo !== null) salida.consumo = consumo;
    if (c.notas) salida.notas = c.notas;
    return salida;
  });
  return valores;
};

// Accepts either a bare parameters object or a file with a "parametros" key
export const extraerParametrosImportados = (json) => (json && typeof json === "object" && json.parametros ? json.parametros : json);

// Reads a text file with FileReader (File.text() is missing in older browsers)
export const leerArchivoTexto = (archivo) =>
  new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(lector.error ?? new Error("No se pudo leer el archivo"));
    lector.readAsText(archivo);
  });
