// TEST helper: builds a small .xlsx in memory (FICTITIOUS data) with shared
// strings, inline strings, numbers and error cells, like a supplier file.
import { zipSync, strToU8 } from "fflate";

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const columna = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

/** @param {{ nombre: string, filas: any[][] }[]} hojas  "#REF!" cells are written as Excel errors */
export const crearXlsx = (hojas) => {
  const compartidas = [];
  const indice = (t) => {
    let i = compartidas.indexOf(t);
    if (i < 0) i = compartidas.push(t) - 1;
    return i;
  };
  const ficheros = {};
  hojas.forEach((h, n) => {
    const filas = h.filas
      .map((f, i) => {
        const celdas = f
          .map((v, j) => {
            const ref = `${columna(j)}${i + 1}`;
            if (v === null || v === undefined) return "";
            if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
            if (typeof v === "string" && v.startsWith("#")) return `<c r="${ref}" t="e"><v>${esc(v)}</v></c>`;
            if (j % 2 === 1) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`; // both string kinds are used
            return `<c r="${ref}" t="s"><v>${indice(String(v))}</v></c>`;
          })
          .join("");
        return `<row r="${i + 1}">${celdas}</row>`;
      })
      .join("");
    ficheros[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${filas}</sheetData></worksheet>`);
  });
  ficheros["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0"?><workbook xmlns:r="r"><sheets>${hojas.map((h, n) => `<sheet name="${esc(h.nombre)}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join("")}</sheets></workbook>`
  );
  ficheros["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0"?><Relationships>${hojas.map((_, n) => `<Relationship Id="rId${n + 1}" Type="worksheet" Target="worksheets/sheet${n + 1}.xml"/>`).join("")}</Relationships>`
  );
  ficheros["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0"?><sst>${compartidas.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join("")}</sst>`);
  return zipSync(ficheros);
};

// Fictitious price lists in the layout of each supported supplier
export const TARIFA_ROLY_FICTICIA = [
  [null, null, null, null, null, "PACKAGING", null, "TARIFA CONFIDENCIAL"],
  ["Ref.", "Nombre", "Género", "Talla", "Color", "Ud/Caja", "Ud/Pack", "Caja", "Pack", "Unid."],
  ["Ref.", "Name", "Gender", "Size", "Colour", "Units/box", "Units/pack", "Box", "Pack", "Unit"],
  [],
  [9001, "Alfa", "Hombre - Man - Homme", "S-2XL", "Blanco - White - Blanc", 50, 5, 1.1, 1.155, 1.32],
  [null, null, "Hombre - Man - Homme", "3XL", "Blanco - White - Blanc", null, null, 1.3, 1.365, 1.56],
  [null, null, "Hombre - Man - Homme", "S-2XL", "Color -Colour - Couleur", null, null, 1.2, 1.2599999999999998, "#REF!"],
  [null, null, "Niño - Kid - Enfant", "Kids", "Blanco/Color - White/Colour - Blanc/Couleur", null, null, 0.9, 0.945, 1.08],
  [null, null, "Hombre - Man - Homme", "S-2XL", "Color - Colour - Couleur- Negro Jaspeado", null, null, 1.4, 1.47, "-"],
  ["0902", "Beta Bolsa", "Unisex - Unisex - Unisex", "One size", "Color - Colour - Couleur", 100, 10, 0.5, 0.525, 0.6],
  [9004, "Epsilon", "Unisex - Unisex - Unisex", "S-L", "Color - Colour - Couleur", 20, 1, 5, 5.25, "-"], // sold by packs of ONE unit
  [9003, "Gamma", "Mujer - Woman - Femme", "Consultar", "Color - Colour - Couleur"],
  [null, null, null, "TARIFA CONFIDENCIAL\nCONFIDENTIAL PRICE", null, null, null, 0.9],
  ["Ref.", "Nombre", "Artículo", "PRECIOS SEGÚN CANTIDAD · PRICES PER QUANTITY"],
  ["Ref.", "Name", "Article", "< 500", "≥ 500"],
  ["9010", "Delta", "Gorra", "Consultar"],
];

export const TARIFA_SOLS_FICTICIA = [
  [],
  [null, "Brand", "GÉNERO", "Ref", "NOMBRE", "COLOR", "TALLA", "Tu Tarifa"],
  [null, "SOL'S", "MEN", 5001, "ORION", "BLANCO", "XS a XXL", 2.1],
  [null, null, null, null, null, "COLOR", null, 2.4],
  [null, null, null, null, null, null, "3XL", 2.7],
  [null, "SOL'S", "WOMEN", 5002, "ORION WOMEN", "BLANCO &\nABSOLUTE WHITE", "S a XXL", 2.1],
  [null, null, null, 5002, null, "COLOR", "3XL", 2.5],
  [null, null, null, null, null, null, "3XL", 2.6],
  [null, "SOL'S", "KIDS", 5003, "ORION KIDS", "COLOR", "2A a 12A ", 1.9],
  [null, "NEOBLU", "UNISEX", 5004, "LYRA", "COLOR", "TUN", 9.5],
  [null, null, null, null, null, null, null, null],
  [null, "SOL'S", "MEN", 5005, "SIRIO", null, "M", 3],
];
