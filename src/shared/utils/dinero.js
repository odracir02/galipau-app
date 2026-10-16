// Money formatting for the UI (amounts are handled in integer cents).

const FORMATO = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PORCENTAJE = new Intl.NumberFormat("es-ES", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const euros = (cent) => (cent === null || cent === undefined ? "—" : FORMATO.format(cent / 100));
export const eurosDecimal = (valor) => (valor === null || valor === undefined ? "—" : FORMATO.format(valor));
export const porcentaje = (fraccion) => (fraccion === null || fraccion === undefined ? "—" : PORCENTAJE.format(fraccion));

// Parses a user-typed number accepting comma or dot as decimal separator
export const leerNumero = (texto) => {
  if (texto === null || texto === undefined) return null;
  const t = String(texto).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
