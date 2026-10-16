// Preview of the import of the quote history stored in this browser
// (localStorage "historialPresupuestos") into Supabase. Read-only: the stored
// history is never modified. Each record is identified by a fingerprint
// (SHA-256 of its canonical JSON), so the same record is never imported twice.

import { normalizarPresupuesto } from "../../../domain/historialPresupuestos";

// JSON with sorted keys: the same record always gives the same text
export const jsonCanonico = (valor) => {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;
  if (valor && typeof valor === "object") {
    return `{${Object.keys(valor).sort().filter((k) => valor[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonCanonico(valor[k])}`).join(",")}}`;
  }
  return JSON.stringify(valor ?? null);
};

export const huella = async (registro) => {
  const bytes = new TextEncoder().encode(jsonCanonico(registro));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const fechaIso = (fecha) => (fecha ? fecha.toISOString().slice(0, 10) : null);

/**
 * @param {unknown[]} registros raw history records
 * @param {Set<string>} huellasExistentes fingerprints already imported in Supabase
 * @returns {Promise<{ filas: object[], aImportar: object[], resumen: object }>}
 */
export const prepararHistorial = async (registros, huellasExistentes = new Set()) => {
  const vistas = new Set();
  const filas = [];
  for (const [indice, original] of registros.entries()) {
    const n = normalizarPresupuesto(original);
    const h = await huella(original ?? null);
    const fila = {
      indice,
      huella: h,
      cliente_nombre: n.cliente ?? "(sin nombre)",
      fecha: fechaIso(n.fecha),
      total_cent: n.total === null ? null : Math.round(n.total * 100),
      prendas: n.prendas,
      original,
      avisos: [],
    };
    if (!original || typeof original !== "object" || Array.isArray(original)) {
      fila.estado = "invalido";
      fila.motivo = "No es un presupuesto reconocible.";
    } else if (fila.total_cent === null || fila.total_cent < 0) {
      fila.estado = "invalido";
      fila.motivo = "No tiene un total válido.";
    } else if (huellasExistentes.has(h)) {
      fila.estado = "duplicado";
      fila.motivo = "Ya se importó antes.";
    } else if (vistas.has(h)) {
      fila.estado = "duplicado";
      fila.motivo = "Repetido en el historial (se importa una sola vez).";
    } else {
      fila.estado = "nuevo";
      if (!fila.fecha) fila.avisos.push("Sin fecha válida: se guardará con la fecha de la importación.");
      if (!n.cliente) fila.avisos.push("Sin nombre de cliente.");
    }
    vistas.add(h);
    filas.push(fila);
  }
  const aImportar = filas
    .filter((f) => f.estado === "nuevo")
    .map(({ huella: h, cliente_nombre, fecha, total_cent, original }) => ({ huella: h, cliente_nombre, fecha, total_cent, original }));
  return {
    filas,
    aImportar,
    resumen: {
      leidos: filas.length,
      nuevos: aImportar.length,
      duplicados: filas.filter((f) => f.estado === "duplicado").length,
      invalidos: filas.filter((f) => f.estado === "invalido").length,
      totalCent: aImportar.reduce((s, r) => s + r.total_cent, 0),
    },
  };
};

/** Integrity check after importing: same number of rows and same total amount. */
export const verificarImportacionHistorial = (resumen, importados) => {
  const errores = [];
  if (importados.length !== resumen.nuevos) errores.push(`Se esperaban ${resumen.nuevos} presupuestos y hay ${importados.length}.`);
  const suma = importados.reduce((s, p) => s + Number(p.total_cent), 0);
  if (suma !== resumen.totalCent) errores.push(`La suma de totales no coincide (${suma} frente a ${resumen.totalCent} céntimos).`);
  return errores;
};
