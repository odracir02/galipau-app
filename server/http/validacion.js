// Minimal declarative validation for API input, with Spanish user messages.
// A schema is an object of field -> rule; validar() returns clean data or
// throws ErrorApi(400) pointing to the first invalid field.

import { ErrorApi } from "./errores.js";

const vacio = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export const reglas = {
  texto: ({ requerido = false, max = 500, etiqueta, transformar } = {}) => (valor, campo) => {
    if (vacio(valor)) {
      if (requerido) throw new ErrorApi(400, `${etiqueta ?? campo}: es obligatorio.`, { campo });
      return null;
    }
    if (typeof valor !== "string") throw new ErrorApi(400, `${etiqueta ?? campo}: debe ser texto.`, { campo });
    const limpio = valor.trim();
    if (limpio.length > max) throw new ErrorApi(400, `${etiqueta ?? campo}: máximo ${max} caracteres.`, { campo });
    return transformar ? transformar(limpio) : limpio;
  },

  email: ({ etiqueta = "Email" } = {}) => (valor, campo) => {
    const t = reglas.texto({ max: 254, etiqueta })(valor, campo);
    if (t !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new ErrorApi(400, `${etiqueta}: formato no válido.`, { campo });
    return t;
  },

  opcion: (valores, { requerido = false, etiqueta, porDefecto } = {}) => (valor, campo) => {
    if (vacio(valor)) {
      if (porDefecto !== undefined) return porDefecto;
      if (requerido) throw new ErrorApi(400, `${etiqueta ?? campo}: es obligatorio.`, { campo });
      return null;
    }
    if (!valores.includes(valor)) throw new ErrorApi(400, `${etiqueta ?? campo}: valor no permitido.`, { campo });
    return valor;
  },

  entero: ({ requerido = false, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, etiqueta } = {}) => (valor, campo) => {
    if (vacio(valor)) {
      if (requerido) throw new ErrorApi(400, `${etiqueta ?? campo}: es obligatorio.`, { campo });
      return null;
    }
    if (!Number.isInteger(valor) || valor < min || valor > max) {
      throw new ErrorApi(400, `${etiqueta ?? campo}: debe ser un número entero entre ${min} y ${max}.`, { campo });
    }
    return valor;
  },

  booleano: ({ porDefecto } = {}) => (valor, campo) => {
    if (valor === undefined && porDefecto !== undefined) return porDefecto;
    if (typeof valor !== "boolean") throw new ErrorApi(400, `${campo}: debe ser verdadero o falso.`, { campo });
    return valor;
  },
};

/**
 * @param {Record<string, Function>} esquema
 * @param {unknown} datos
 * @param {{ parcial?: boolean }} opciones parcial: only validate fields present (PATCH)
 */
export const validar = (esquema, datos, { parcial = false } = {}) => {
  if (datos === null || typeof datos !== "object" || Array.isArray(datos)) {
    throw new ErrorApi(400, "El cuerpo de la petición debe ser un objeto JSON.");
  }
  const desconocidos = Object.keys(datos).filter((k) => !(k in esquema));
  if (desconocidos.length > 0) {
    throw new ErrorApi(400, `Campo no permitido: ${desconocidos[0]}.`, { campo: desconocidos[0] });
  }
  const limpio = {};
  for (const [campo, regla] of Object.entries(esquema)) {
    if (parcial && !(campo in datos)) continue;
    limpio[campo] = regla(datos[campo], campo);
  }
  return limpio;
};

export const idDeRuta = (valor) => {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorApi(400, "Identificador no válido.", { campo: "id" });
  return id;
};
