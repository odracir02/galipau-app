// Quote lifecycle. Mirrors public.transicion_presupuesto_permitida (the database
// enforces it; this copy drives the UI). A test checks both stay identical.

export const ESTADOS = {
  borrador: { etiqueta: "Borrador", va: "Esborrany", color: "secondary" },
  presentado: { etiqueta: "Presentado", va: "Presentat", color: "primary" },
  aceptado: { etiqueta: "Aceptado", va: "Acceptat", color: "info" },
  en_produccion: { etiqueta: "En producción", va: "En producció", color: "warning" },
  finalizado: { etiqueta: "Finalizado", va: "Finalitzat", color: "dark" },
  cobrado: { etiqueta: "Cobrado", va: "Cobrat", color: "success" },
  cancelado: { etiqueta: "Cancelado", va: "Anul·lat", color: "danger" },
  importado: { etiqueta: "Importado (histórico)", va: "Importat", color: "light" },
};

export const TRANSICIONES = {
  borrador: ["presentado", "cancelado"],
  presentado: ["aceptado", "borrador", "cancelado"],
  aceptado: ["en_produccion", "presentado", "cancelado"],
  en_produccion: ["finalizado", "aceptado", "cancelado"],
  finalizado: ["cobrado", "en_produccion"],
  cobrado: ["finalizado"],
  cancelado: [],
  importado: [],
};

// Button labels for each target state (forward actions first in TRANSICIONES)
const ACCIONES = {
  presentado: "Marcar como presentado",
  aceptado: "Marcar como aceptado",
  en_produccion: "Pasar a producción",
  finalizado: "Marcar como finalizado",
  cobrado: "Marcar como cobrado",
  cancelado: "Cancelar presupuesto",
  borrador: "Volver a borrador",
};

// Going back is allowed to correct mistakes; the UI labels it as such
const RETROCESOS = new Set(["presentado>borrador", "aceptado>presentado", "en_produccion>aceptado", "finalizado>en_produccion", "cobrado>finalizado"]);

export const esTransicionPermitida = (desde, hasta) => (TRANSICIONES[desde] ?? []).includes(hasta);

export const accionesDesde = (estado) =>
  (TRANSICIONES[estado] ?? []).map((hasta) => {
    const retroceso = RETROCESOS.has(`${estado}>${hasta}`);
    return {
      hasta,
      etiqueta: retroceso ? `Corregir: volver a «${ESTADOS[hasta].etiqueta.toLowerCase()}»` : ACCIONES[hasta],
      tipo: hasta === "cancelado" ? "peligro" : retroceso ? "correccion" : "avance",
    };
  });

// Content (lines, prices, customer…) can only change in these states
export const esEditable = (estado) => estado === "borrador" || estado === "presentado";

// States that need a calculated result and a final price
export const requierePrecioFinal = (estado) => !["borrador", "cancelado"].includes(estado);

export const etiquetaEstado = (estado, idioma = "es") => {
  const e = ESTADOS[estado];
  if (!e) return estado;
  return idioma === "va" ? e.va : e.etiqueta;
};
