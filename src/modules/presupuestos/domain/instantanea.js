// Conversion between the quote editor state and the stored quote row.
//
// A stored quote keeps an economic snapshot: the editor form (to reopen it),
// the exact engine input (with every garment price), the full engine result,
// the engine version and the parameter version. With the parameter values of
// that version the result can be reproduced exactly, whatever happens later to
// the catalogue or the active parameters.

import { calcularCosteSerigrafia, VERSION_MOTOR } from "../../../domain/calculo/serigrafia/motor";
import { crearLinea } from "../../../domain/presupuestoEstado";

export const VERSION_INSTANTANEA = 1;

export const zonasIniciales = () => [
  { id: "delantera", nombre: "Delantera", colores: "1" },
  { id: "trasera", nombre: "Trasera", colores: "0" },
];

export const lineaVacia = () => ({ ...crearLinea(), tipo: "", precioManual: "", descripcion: "", productoId: "" });

export const formularioVacio = (valoresParametros) => ({
  lineas: [lineaVacia()],
  zonas: zonasIniciales(),
  minutosDiseno: "0",
  mermaPorcentaje: valoresParametros ? String(Math.round(valoresParametros.mermaPorDefecto * 10000) / 100) : "",
  precioFinal: "",
});

const sumarDias = (fechaIso, dias) => {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

export const hoyIso = (ahora = new Date()) => {
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export const datosDocumentoIniciales = (empresa, ahora = new Date()) => {
  const fecha = hoyIso(ahora);
  const dias = empresa?.validezDias;
  return {
    idioma: empresa?.idiomaPorDefecto ?? "va",
    fechaEmision: fecha,
    validoHasta: Number.isInteger(dias) && dias > 0 ? sumarDias(fecha, dias) : "",
    observaciones: "",
    condiciones: (empresa?.condiciones?.[empresa?.idiomaPorDefecto ?? "va"] ?? []).join("\n"),
    notas: "",
  };
};

// Customer data copied into the quote (the document must not change if the customer record changes later)
export const instantaneaCliente = (c) =>
  c
    ? Object.fromEntries(
        ["nombre", "razon_social", "nif", "email", "telefono", "direccion", "codigo_postal", "ciudad", "provincia"]
          .filter((k) => c[k] !== null && c[k] !== undefined && String(c[k]).trim() !== "")
          .map((k) => [k, String(c[k]).trim()])
      )
    : {};

// Strips UI-only fields from the form before storing it
const formularioParaGuardar = (f) => ({
  lineas: f.lineas.map(({ id, tipo, proveedor, modelo, size, color, quantity, precioManual, descripcion, productoId }) => ({
    id, tipo, proveedor, modelo, size, color, quantity, precioManual: precioManual ?? "", descripcion: descripcion ?? "",
    ...(productoId ? { productoId } : {}),
  })),
  zonas: f.zonas.map(({ id, nombre, colores }) => ({ id, nombre, colores })),
  minutosDiseno: f.minutosDiseno,
  mermaPorcentaje: f.mermaPorcentaje,
  precioFinal: f.precioFinal,
});

/**
 * Builds the row to insert/update in public.presupuestos.
 * calculo: { entrada, detalle, resultado } (resultado may be null for an incomplete draft)
 */
export const construirRegistro = ({ cliente, formulario, calculo, parametrosVersion, documento }) => {
  const r = calculo?.resultado ?? null;
  const precioFinalCent = r?.precio.finalCent ?? null;
  const recomendadoCent = r?.precio.recomendadoCent ?? null;
  return {
    cliente_id: cliente?.id ?? null,
    cliente_nombre: (cliente?.nombre ?? "").trim() || "(sin cliente)",
    cliente_datos: instantaneaCliente(cliente),
    tecnica: "serigrafia",
    parametros_version: r ? parametrosVersion : null,
    motor: r?.motor ?? VERSION_MOTOR,
    entrada: {
      version: VERSION_INSTANTANEA,
      formulario: formularioParaGuardar(formulario),
      motor: r ? calculo.entrada : null,
      lineas: r ? calculo.detalle.map((l) => ({ ...l, origen: l.origen === "guardado" ? "catalogo" : l.origen })) : [],
    },
    resultado: r,
    total_cent: precioFinalCent ?? recomendadoCent ?? 0,
    coste_total_cent: r?.costes.totalCent ?? null,
    precio_recomendado_cent: recomendadoCent,
    precio_final_cent: precioFinalCent,
    beneficio_cent: r?.beneficio?.cent ?? null,
    idioma: documento.idioma,
    fecha_emision: documento.fechaEmision,
    valido_hasta: documento.validoHasta || null,
    observaciones: documento.observaciones?.trim() || null,
    condiciones: documento.condiciones?.trim() || null,
    notas: documento.notas?.trim() || null,
  };
};

// A line that takes its price from the current catalogue again
export const sinPrecioGuardado = (linea) => {
  const copia = { ...linea };
  delete copia.precioGuardado;
  return copia;
};

// Editor state from a stored quote. Catalogue lines keep their saved price.
export const estadoDesdeRegistro = (p) => {
  const f = p.entrada?.formulario;
  const guardadas = p.entrada?.lineas ?? [];
  const formulario = f
    ? {
        ...f,
        lineas: f.lineas.map((l, i) => {
          const g = guardadas[i];
          const conPrecio = g && g.origen === "catalogo" && typeof g.precioUnitario === "number";
          return { ...lineaVacia(), ...l, ...(conPrecio ? { precioGuardado: g.precioUnitario } : {}) };
        }),
        zonas: f.zonas?.length ? f.zonas : zonasIniciales(),
      }
    : formularioVacio(null);
  return {
    formulario,
    documento: {
      idioma: p.idioma ?? "es",
      fechaEmision: p.fecha_emision,
      validoHasta: p.valido_hasta ?? "",
      observaciones: p.observaciones ?? "",
      condiciones: p.condiciones ?? "",
      notas: p.notas ?? "",
    },
    cliente: p.cliente_id ? { id: p.cliente_id, ...p.cliente_datos } : p.cliente_datos?.nombre ? { ...p.cliente_datos } : null,
    parametrosVersion: p.parametros_version ?? null,
  };
};

// A new draft with the same content: current catalogue prices, active parameters, new dates
export const estadoDuplicado = (p, empresa, ahora = new Date()) => {
  const e = estadoDesdeRegistro(p);
  const iniciales = datosDocumentoIniciales(empresa, ahora);
  return {
    ...e,
    formulario: { ...e.formulario, lineas: e.formulario.lineas.map((l) => ({ ...sinPrecioGuardado(l), id: lineaVacia().id })) },
    documento: { ...e.documento, fechaEmision: iniciales.fechaEmision, validoHasta: iniciales.validoHasta, notas: "" },
    parametrosVersion: null,
  };
};

const CAMPOS_COMPROBADOS = [
  ["coste total", (r) => r.costes.totalCent],
  ["precio recomendado", (r) => r.precio.recomendadoCent],
  ["precio recomendado sin redondear", (r) => r.precio.recomendadoSinRedondearCent],
  ["precio final", (r) => r.precio.finalCent],
  ["beneficio", (r) => r.beneficio?.cent ?? null],
];

/** Recalculates a stored quote with the values of its parameter version and compares. */
export const reproducir = (p, valoresParametros) => {
  if (!p.resultado || !p.entrada?.motor) return { reproducible: false, motivo: "El presupuesto no tiene un cálculo guardado." };
  if (p.motor !== VERSION_MOTOR) {
    return { reproducible: false, motivo: `Calculado con otro motor (${p.motor}); el actual es ${VERSION_MOTOR}.` };
  }
  const nuevo = calcularCosteSerigrafia(p.entrada.motor, valoresParametros);
  const diferencias = CAMPOS_COMPROBADOS
    .filter(([, f]) => f(nuevo) !== f(p.resultado))
    .map(([nombre, f]) => `${nombre}: guardado ${f(p.resultado)}, recalculado ${f(nuevo)}`);
  return { reproducible: true, coincide: diferencias.length === 0, diferencias };
};
