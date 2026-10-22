// Category suggestions for catalogue models (pure functions, no React).
//
// Evidence, strongest first:
//   1. an explicit garment word in the name or description (POLO, SUDADERA,
//      JACKET, MOCHILA…): high confidence;
//   2. the same model family of the same supplier (REGENT / REGENT WOMEN /
//      REGENT FIT…) already classified: medium confidence, to review;
//   3. a children's word (KIDS, BABY…) without a garment word: medium, to review.
// Brand names and other proper nouns are never evidence: without any of the
// above a model keeps "Sin clasificar". Nothing is applied automatically.

import { clave } from "../../tarifas/domain/normalizar.js";

export const SIN_CLASIFICAR = "Sin clasificar";

// Starting list the owner can add with one click (then rename, reorder or merge freely)
export const CATEGORIAS_PROPUESTAS = [
  "Camisetas", "Polos", "Sudaderas", "Chaquetas", "Pantalones", "Ropa deportiva", "Ropa infantil",
  "Bolsas y mochilas", "Gorras y accesorios", "Delantales y ropa de trabajo", "Otros", SIN_CLASIFICAR,
];

// Explicit words only (Spanish, English, French). Ambiguous words such as SPORT, HOODED or SHIRT are left out on purpose.
const REGLAS = [
  { categoria: "Camisetas", palabras: ["CAMISETA", "CAMISETAS", "T SHIRT", "TSHIRT", "TEE", "TANK TOP", "TIRANTES", "TEE SHIRT"] },
  { categoria: "Polos", palabras: ["POLO", "POLOS"] },
  { categoria: "Sudaderas", palabras: ["SUDADERA", "SUDADERAS", "SWEATSHIRT", "SWEAT", "HOODIE", "HOODY", "CREWNECK"] },
  { categoria: "Chaquetas", palabras: ["CHAQUETA", "JACKET", "SOFTSHELL", "PARKA", "CORTAVIENTOS", "WINDBREAKER", "ANORAK", "CHALECO", "BODYWARMER", "GILET", "PLUMIFERO", "VESTE"] },
  { categoria: "Chaquetas", confianza: "media", palabras: ["PADDED", "3IN1", "ACOLCHADA", "ACOLCHADO"], motivo: (p) => `«${p}» indica una prenda de abrigo (chaqueta o chaleco); revisar` },
  { categoria: "Pantalones", palabras: ["PANTALON", "PANTALONES", "PANTS", "TROUSERS", "JOGGER", "JOGGERS", "BERMUDA", "BERMUDAS", "SHORTS", "LEGGINGS", "MALLAS"] },
  { categoria: "Ropa deportiva", palabras: ["MAILLOT", "CICLISMO", "RUNNING"] },
  { categoria: "Bolsas y mochilas", palabras: ["BOLSA", "BOLSAS", "BAG", "TOTE", "MOCHILA", "MOCHILAS", "BACKPACK", "GYMSAC", "SACO"] },
  { categoria: "Gorras y accesorios", palabras: ["GORRA", "GORRAS", "CAP", "GORRO", "BEANIE", "BUCKET", "SOMBRERO", "HAT", "BANDANA", "BRAGA", "BUFANDA", "SCARF", "GUANTES", "GLOVES", "CINTURON", "BELT", "CALCETINES", "SOCKS"] },
  { categoria: "Delantales y ropa de trabajo", palabras: ["DELANTAL", "DELANTALES", "APRON", "BATA", "CASACA", "WORKWEAR"] },
  { categoria: "Otros", palabras: ["TOALLA", "TOWEL", "ALBORNOZ", "BATHROBE", "MANTA", "BLANKET"] },
];
// NIÑO / NIÑA are left out: they are also model names (e.g. an adult model called NINO)
const INFANTIL = ["KIDS", "KID", "BABY", "BEBE", "CHILD", "INFANTIL", "BAMBINO"];
// Words that name a version of the same garment (fit, audience, sleeve, weight…), ignored to find the family
const VERSIONES = new Set(["MEN", "MAN", "WOMEN", "WOMAN", "LADY", "KIDS", "KID", "CHILD", "BABY", "LSL", "LS", "L", "S", "FIT", "V", "BW", "TT", "II", "III", "PREMIUM", "ORGANIC", "NEW", "RE"]);

const tieneFrase = (texto, frase) => ` ${texto} `.includes(` ${frase} `);
const esInfantil = (texto) => INFANTIL.some((p) => tieneFrase(texto, p));

/** Family key of a model name: REGENT FIT WOMEN -> REGENT; TEMPO 185 MEN -> TEMPO */
export const familiaDe = (nombre) =>
  clave(nombre)
    .split(" ")
    .filter((p) => p && !VERSIONES.has(p) && !/^\d+$/.test(p))
    .join(" ");

// A category of the owner's list matching a suggested name (ignoring case, accents and plural)
const singular = (t) => clave(t).split(" ").map((p) => p.replace(/(ES|S)$/, "")).join(" ");
export const resolverCategoria = (nombre, existentes) => existentes.find((c) => clave(c) === clave(nombre)) ?? existentes.find((c) => singular(c) === singular(nombre)) ?? null;

const porPalabras = (texto) => {
  for (const r of REGLAS)
    for (const p of r.palabras)
      if (tieneFrase(texto, p)) return { categoria: r.categoria, confianza: r.confianza ?? "alta", motivo: r.motivo ? r.motivo(p) : `El nombre o la descripción dice «${p}»` };
  return null;
};

/**
 * @param {{ id: number, nombre: string, descripcion?: string, proveedor_id: number|null, tipo: string }[]} modelos
 * @param {string[]} categorias owner's categories
 * @returns {Map<number, { categoria: string, existe: boolean, motivo: string, confianza: "alta"|"media", revisar: boolean }>}
 *   Only for models in "Sin clasificar"; classified models never get a suggestion.
 */
export const sugerirCategorias = (modelos, categorias) => {
  const resultado = new Map();
  const conCategoria = (s) => {
    const existente = resolverCategoria(s.categoria, categorias);
    return { ...s, categoria: existente ?? s.categoria, existe: Boolean(existente), revisar: s.confianza !== "alta" };
  };

  // 1. explicit words
  const directas = new Map();
  for (const m of modelos) {
    const s = porPalabras(clave(`${m.nombre} ${m.descripcion ?? ""}`));
    if (s) directas.set(m.id, s);
  }

  // 2. families of the same supplier (adult and children versions kept apart): known categories
  const familias = new Map();
  const claveFamilia = (m) => `${m.proveedor_id ?? "propio"}|${esInfantil(clave(m.nombre)) ? "infantil" : "adulto"}|${familiaDe(m.nombre)}`;
  for (const m of modelos) {
    const categoria = m.tipo !== SIN_CLASIFICAR ? m.tipo : directas.get(m.id)?.confianza === "alta" ? directas.get(m.id).categoria : null;
    if (!categoria || !familiaDe(m.nombre)) continue;
    const k = claveFamilia(m);
    if (!familias.has(k)) familias.set(k, []);
    familias.get(k).push({ nombre: m.nombre, categoria });
  }

  for (const m of modelos) {
    if (m.tipo !== SIN_CLASIFICAR) continue;
    const directa = directas.get(m.id);
    if (directa) {
      resultado.set(m.id, conCategoria(directa));
      continue;
    }
    const parientes = (familias.get(claveFamilia(m)) ?? []).filter((p) => p.nombre !== m.nombre);
    const distintas = [...new Set(parientes.map((p) => clave(resolverCategoria(p.categoria, categorias) ?? p.categoria)))];
    if (parientes.length && distintas.length === 1) {
      const ejemplos = parientes.slice(0, 3).map((p) => p.nombre).join(", ");
      resultado.set(m.id, conCategoria({ categoria: parientes[0].categoria, confianza: "media", motivo: `Misma familia que ${ejemplos} (${parientes[0].categoria}); revisar` }));
      continue;
    }
    if (esInfantil(clave(m.nombre))) {
      resultado.set(m.id, conCategoria({ categoria: "Ropa infantil", confianza: "media", motivo: "Prenda infantil (KIDS, BABY… en el nombre); el tipo de prenda no se indica; revisar" }));
    }
  }
  return resultado;
};
