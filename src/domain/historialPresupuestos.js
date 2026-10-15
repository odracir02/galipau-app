// Reading and normalisation of the quote history stored in localStorage.
//
// Known formats (from the git history):
//  - Legacy (commits effc08c / 6f67a96): { clientName, printType, sizeEntries,
//    totalQuantity, subtotalSinDescuento, descuentoPorcentaje, descuentoAplicado,
//    totalPresupuesto, fecha }
//  - Block-based (ded2667): { clientName, totalPrendas, lineas[{ estampado, quantity, ... }],
//    subtotalSinDescuento, descuentoPorcentaje, descuento, total, fecha }
//  - Current (fd980ea): same as block-based + beneficioTotal
//
// These functions only read and present data: they never recalculate amounts
// or modify stored records.

export const CLAVE_HISTORIAL = "historialPresupuestos";

const SIN_DATO = "—";

const aNumero = (valor) => {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const sumarCantidades = (lineas) => {
  if (!Array.isArray(lineas) || lineas.length === 0) return null;
  let suma = 0;
  for (const linea of lineas) {
    const cantidad = aNumero(linea?.quantity);
    if (cantidad === null) return null;
    suma += cantidad;
  }
  return suma;
};

const obtenerTecnicas = (presupuesto) => {
  const tecnicas = [];
  const agregar = (t) => {
    if (typeof t === "string" && t.trim() !== "" && !tecnicas.includes(t.trim())) {
      tecnicas.push(t.trim());
    }
  };
  agregar(presupuesto.printType);
  if (Array.isArray(presupuesto.lineas)) {
    presupuesto.lineas.forEach((l) => agregar(l?.estampado));
  }
  return tecnicas;
};

const obtenerFecha = (valor) => {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
};

// Reads the history without ever throwing. If the stored content is not a valid
// list, returns [] (stored data is left untouched).
export const leerHistorial = (storage) => {
  try {
    const crudo = storage?.getItem(CLAVE_HISTORIAL);
    if (!crudo) return [];
    const datos = JSON.parse(crudo);
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
};

export const guardarHistorial = (storage, presupuestos) => {
  storage.setItem(CLAVE_HISTORIAL, JSON.stringify(presupuestos));
};

// Returns a copy without the given item; all other records are kept exactly
// as they were stored.
export const eliminarPresupuesto = (presupuestos, index) =>
  presupuestos.filter((_, i) => i !== index);

// Converts a record in any known format into a common structure.
// Missing or invalid values are returned as null.
export const normalizarPresupuesto = (registro) => {
  const p = registro && typeof registro === "object" ? registro : {};

  const cliente =
    typeof p.clientName === "string" && p.clientName.trim() !== ""
      ? p.clientName
      : null;

  const prendas =
    aNumero(p.totalPrendas) ??
    aNumero(p.totalQuantity) ??
    sumarCantidades(p.lineas) ??
    sumarCantidades(p.sizeEntries);

  const total = aNumero(p.total) ?? aNumero(p.totalPresupuesto);

  return {
    cliente,
    tecnicas: obtenerTecnicas(p),
    prendas,
    total,
    fecha: obtenerFecha(p.fecha),
  };
};

// Display-ready strings for the history table.
export const formatearPresupuesto = (registro) => {
  const p = normalizarPresupuesto(registro);
  return {
    cliente: p.cliente ?? SIN_DATO,
    tecnicas: p.tecnicas.length > 0 ? p.tecnicas.join(" + ") : SIN_DATO,
    prendas: p.prendas ?? SIN_DATO,
    total: p.total !== null ? `${p.total.toFixed(2)} €` : SIN_DATO,
    fecha: p.fecha ? p.fecha.toLocaleString() : SIN_DATO,
  };
};
