// Normalisation of supplier price-list values (pure functions).
//
// Sizes: only what the supplier states is accepted. A range on the standard
// letter scale ("XS-2XL", "S a XXL") lists consecutive sizes and is expanded;
// any other range ("2A a 12A", "38-52", "Kids") does not say which sizes exist,
// so it is kept as a GROUP: it can update matching existing variants but never
// creates new ones.

export const ESCALA_LETRAS = ["3XS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL", "7XL"];
const ALIAS_LETRAS = { "2XS": "XXS", XXXS: "3XS", "2XL": "XXL", XXXL: "3XL", XXXXL: "4XL", XXXXXL: "5XL" };
const TALLA_UNICA = /^(tu|tun|t\.?u\.?|talla unica|one size|unica|os)$/;

// Comparison key for names: no accents, upper case, single spaces, no punctuation
export const clave = (texto) =>
  String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

// Display text: single spaces, trimmed
export const limpiar = (texto) => String(texto ?? "").replace(/\s+/g, " ").trim();

const letra = (t) => {
  const u = t.toUpperCase();
  const c = ALIAS_LETRAS[u] ?? u;
  return ESCALA_LETRAS.includes(c) ? c : null;
};
const edad = (t) => {
  const m = /^(\d{1,2})\s*(?:A|AÑOS?|Y)$/i.exec(t);
  return m ? Number(m[1]) : null;
};
const formatoEdad = (n) => `${String(n).padStart(2, "0")}A`;

/**
 * @returns {{ tallas: string[]|null, grupo: null|{ tipo: "edad"|"numero"|"otro", desde: number|null, hasta: number|null }, problema: string|null }}
 *   tallas: canonical sizes confirmed by the supplier; null when the text is a group or invalid.
 */
export const interpretarTalla = (texto) => {
  const t = limpiar(texto);
  if (!t) return { tallas: null, grupo: null, problema: "Sin talla." };
  const min = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (min === "consultar") return { tallas: null, grupo: null, problema: "Talla y precio a consultar con el proveedor." };
  if (TALLA_UNICA.test(min)) return { tallas: ["TU"], grupo: null, problema: null };
  if (min === "kids" || min === "nino" || min === "infantil") return { tallas: null, grupo: { tipo: "edad", desde: null, hasta: null }, problema: null };

  const una = letra(t);
  if (una) return { tallas: [una], grupo: null, problema: null };
  const e = edad(t);
  if (e !== null) return { tallas: [formatoEdad(e)], grupo: null, problema: null };
  if (/^\d{1,3}(\/\d{1,3})?$/.test(t)) return { tallas: [t], grupo: null, problema: null }; // "40", "36/39" (socks)

  const rango = /^(\S+)\s*(?:-|\ba\b|\bto\b)\s*(\S+)$/i.exec(t);
  if (rango) {
    const [desde, hasta] = [letra(rango[1]), letra(rango[2])];
    if (desde && hasta) {
      const [i, j] = [ESCALA_LETRAS.indexOf(desde), ESCALA_LETRAS.indexOf(hasta)];
      if (i <= j) return { tallas: ESCALA_LETRAS.slice(i, j + 1), grupo: null, problema: null };
    }
    const [e1, e2] = [edad(rango[1]), edad(rango[2])];
    if (e1 !== null && e2 !== null && e1 <= e2) return { tallas: null, grupo: { tipo: "edad", desde: e1, hasta: e2 }, problema: null };
    if (/^\d+$/.test(rango[1]) && /^\d+$/.test(rango[2]) && Number(rango[1]) <= Number(rango[2]))
      return { tallas: null, grupo: { tipo: "numero", desde: Number(rango[1]), hasta: Number(rango[2]) }, problema: null };
    if (desde || hasta || e1 !== null || e2 !== null || /M$/i.test(rango[2]) || /\//.test(t)) return { tallas: null, grupo: { tipo: "otro", desde: null, hasta: null }, problema: null };
  }
  if (/^[A-Z]{1,3}\/[A-Z]{1,3}$/i.test(t)) return { tallas: [t.toUpperCase()], grupo: null, problema: null }; // "S/M"
  return { tallas: null, grupo: null, problema: `Talla no reconocida: «${t}».` };
};

// Whether an existing size belongs to a size group of the price list
export const tallaEnGrupo = (talla, grupo) => {
  if (!grupo) return false;
  const t = String(talla ?? "").toUpperCase();
  if (grupo.tipo === "edad") {
    const m = /^(\d{1,2})A$/.exec(t);
    if (!m) return false;
    return grupo.desde === null || (Number(m[1]) >= grupo.desde && Number(m[1]) <= grupo.hasta);
  }
  if (grupo.tipo === "numero") return /^\d+$/.test(t) && Number(t) >= grupo.desde && Number(t) <= grupo.hasta;
  return false;
};

// Canonical form of an existing catalogue size, to compare with the price list
export const tallaCanonica = (talla) => {
  const t = limpiar(talla);
  return letra(t) ?? (edad(t) !== null ? formatoEdad(edad(t)) : TALLA_UNICA.test(t.toLowerCase()) ? "TU" : t.toUpperCase());
};

/**
 * Colours as the supplier states them. Multilingual text keeps the first
 * language ("Blanco - White - Blanc" -> BLANCO); a cell that names several
 * colours at the same price ("Blanco/Color", "BLANCO & ABSOLUTE WHITE") gives
 * one colour each.
 */
export const interpretarColores = (texto, { separadorIdiomas = /\s+-\s+/ } = {}) => {
  const t = limpiar(texto);
  if (!t) return [];
  const primerIdioma = t.split(separadorIdiomas)[0];
  return [...new Set(primerIdioma.split(/\s*(?:\/|&|\+)\s*/).map((c) => limpiar(c).toUpperCase()).filter(Boolean))];
};

// Excel floating-point noise (1.7329999999999999) -> 1.733; more than 4 decimals is reported
export const precioTarifa = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return Number(v.toPrecision(12));
};
export const tieneMasDe4Decimales = (v) => Math.abs(v * 1e4 - Math.round(v * 1e4)) > 1e-6;

/**
 * Individual sizes typed by the owner to split a size group ("02A, 04A, 06A").
 * Each item must be ONE size (a letter range such as "S-XL" is also accepted);
 * groups ("Kids", "2A a 12A") are rejected.
 * @returns {{ tallas: string[], errores: string[] }}
 */
export const interpretarListaTallas = (texto) => {
  const tallas = [];
  const errores = [];
  for (const parte of String(texto ?? "").split(/[,;\n]+/).map(limpiar).filter(Boolean)) {
    const t = interpretarTalla(parte);
    if (t.tallas) tallas.push(...t.tallas);
    else errores.push(t.grupo ? `«${parte}» es un grupo de tallas: escribe cada talla por separado.` : t.problema);
  }
  return { tallas: [...new Set(tallas)], errores };
};
