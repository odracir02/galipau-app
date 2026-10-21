// Supplier price-list formats. Each format recognises its file by the header
// row and turns the supplier's layout (merged/inherited cells, several price
// modes, multilingual text) into the same normalised entries, so the rest of
// the import (comparison, preview, saving) works for any supplier. A new
// supplier only needs a new entry in FORMATOS.
//
// `propuesta` holds what the owner confirmed for THIS supplier's file (price
// mode, net or VAT-included, VAT rate). It only pre-fills the wizard and stays
// visible and editable; a format without it starts with nothing chosen.
//
// Entry: { fila, referencia, modelo, marca, genero, tipo, tallaTexto, tallas,
//          grupo, colorTexto, colores, precios: { [modalidad]: number },
//          unidades: { [modalidad]: number }, problemas: string[] }

import { clave, limpiar, interpretarTalla, interpretarColores, precioTarifa, tieneMasDe4Decimales } from "./normalizar.js";

const vacio = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const texto = (v) => (vacio(v) ? null : limpiar(v));
const referencia = (v) => (vacio(v) ? null : typeof v === "number" ? String(Math.trunc(v)) : limpiar(v));
const entero = (v) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : null);

// Price cell: number, "-" (not offered) or an Excel error ("#REF!")
const leerPrecio = (v, nombre, problemas) => {
  if (vacio(v) || (typeof v === "string" && /^[-–—]$/.test(v.trim()))) return null;
  if (typeof v === "string" && v.trim().startsWith("#")) {
    problemas.push(`Precio «${nombre}» con error en el archivo (${v.trim()}).`);
    return null;
  }
  const n = precioTarifa(typeof v === "string" ? Number(v.trim().replace(",", ".")) : v);
  if (n === null) {
    problemas.push(`Precio «${nombre}» no válido: «${v}».`);
    return null;
  }
  if (tieneMasDe4Decimales(n)) problemas.push(`Precio «${nombre}» con más de 4 decimales (${n}).`);
  return n;
};

// Index of the header row and of each column, by header text
const buscarCabecera = (filas, requeridas, maxFilas = 30) => {
  for (let i = 0; i < Math.min(filas.length, maxFilas); i++) {
    const claves = (filas[i] ?? []).map((v) => clave(v));
    const columnas = {};
    for (const [campo, nombres] of Object.entries(requeridas)) {
      const j = claves.findIndex((c) => nombres.includes(c));
      if (j >= 0) columnas[campo] = j;
    }
    if (Object.keys(columnas).length === Object.keys(requeridas).length) return { fila: i, columnas };
  }
  return null;
};

const completarTallaYColor = (e, opciones = {}) => {
  const t = interpretarTalla(opciones.idiomaTalla ? e.tallaTexto.split(/\s+-\s+/)[0] : e.tallaTexto);
  e.tallas = t.tallas;
  e.grupo = t.grupo;
  if (t.problema) e.problemas.push(t.problema);
  e.colores = interpretarColores(opciones.color ? opciones.color(e.colorTexto) : e.colorTexto, opciones);
  if (e.colores.length === 0) e.problemas.push("Sin color.");
  if (Object.keys(e.precios).length === 0 && !e.problemas.some((p) => p.startsWith("Talla y precio a consultar"))) e.problemas.push("Sin precio.");
  return e;
};

// ---------------------------------------------------------------- ROLY
// One row per model / gender / size range / colour. Reference, name, gender and
// units per box/pack are written once and inherited by the following rows.
// Three alternative prices: box, pack and unit. A final section lists prices
// by quantity, all "Consultar" (on request).
const GENEROS = new Set(["ADULTO", "HOMBRE", "MUJER", "NINO", "NINA", "UNISEX", "BEBE", "JUNIOR", "CHICO", "CHICA"]);

// "Color - Colour - Couleur- Negro Jaspeado": a fourth part names the specific colour
const colorRoly = (t) => {
  const partes = t.split(/\s*-\s*/).filter(Boolean);
  return partes.length > 3 ? partes.slice(3).join(" ") : t;
};

const ROLY = {
  id: "roly",
  proveedor: "ROLY",
  descripcion: "Tarifa ROLY (Ref. · Nombre · Género · Talla · Color · Caja · Pack · Unid.)",
  modalidades: [
    { id: "caja", nombre: "Caja", unidades: "ud/caja" },
    { id: "pack", nombre: "Pack", unidades: "ud/pack" },
    { id: "unidad", nombre: "Unidad" },
  ],
  propuesta: {
    modalidad: "unidad", interpretacion: "neto", iva: 21,
    nota: "Confirmado por el propietario para la tarifa ROLY: precios sin IVA, IVA de compra 21 %. Unidad es la modalidad propuesta (coincide con los precios ya usados); Caja y Pack se guardan como alternativas.",
  },
  detectar: (filas) =>
    buscarCabecera(filas, {
      ref: ["REF"], nombre: ["NOMBRE"], genero: ["GENERO"], talla: ["TALLA"], color: ["COLOR"],
      udCaja: ["UD CAJA"], udPack: ["UD PACK"], caja: ["CAJA"], pack: ["PACK"], unidad: ["UNID", "UNIDAD"],
    }),
  leer: (filas, { fila: cab, columnas: c }) => {
    const entradas = [];
    const descartadas = [];
    let m = null; // current model
    let enCantidades = false;
    for (let i = cab + 1; i < filas.length; i++) {
      const f = filas[i] ?? [];
      const celda = (k) => f[c[k]];
      if (f.every(vacio)) continue;
      const tallaTxt = texto(celda("talla")) ?? "";
      if (/PRECIOS SEGUN CANTIDAD/.test(clave(tallaTxt))) {
        enCantidades = true;
        continue;
      }
      if (clave(celda("ref")) === "REF") continue; // repeated header lines (other languages)
      if (/TARIFA CONFIDENCIAL/.test(clave(tallaTxt))) {
        descartadas.push({ fila: i + 1, motivo: "Nota de tarifa confidencial (no es un artículo)." });
        continue;
      }
      if (enCantidades) {
        const ref = referencia(celda("ref"));
        if (ref) m = { referencia: ref, modelo: texto(celda("nombre")) };
        descartadas.push({ fila: i + 1, referencia: m?.referencia ?? null, modelo: m?.modelo ?? null, articulo: texto(celda("genero")), motivo: "Precio por cantidad a consultar con el proveedor." });
        continue;
      }
      const ref = referencia(celda("ref"));
      if (ref) {
        m = { referencia: ref, modelo: texto(celda("nombre")), genero: null, unidades: {} };
      }
      if (!m) {
        descartadas.push({ fila: i + 1, motivo: "Fila sin referencia antes del primer artículo." });
        continue;
      }
      if (texto(celda("nombre")) && !ref) m.modelo = texto(celda("nombre"));
      if (texto(celda("genero"))) m.genero = texto(celda("genero")).split(/\s+-\s+/)[0];
      const udCaja = entero(celda("udCaja"));
      const udPack = entero(celda("udPack"));
      if (udCaja) m.unidades.caja = udCaja;
      if (udPack) m.unidades.pack = udPack;
      const problemas = [];
      const precios = {};
      for (const mod of ROLY.modalidades) {
        const p = leerPrecio(celda(mod.id), mod.nombre, problemas);
        if (p !== null) precios[mod.id] = p;
      }
      const esGenero = m.genero && GENEROS.has(clave(m.genero));
      if (!m.modelo) problemas.push("Sin nombre de modelo.");
      entradas.push(
        completarTallaYColor({
          fila: i + 1,
          referencia: m.referencia,
          modelo: m.modelo ?? "",
          marca: null,
          genero: esGenero ? m.genero : null,
          tipo: m.genero && !esGenero ? m.genero : null,
          tallaTexto: tallaTxt,
          colorTexto: texto(celda("color")) ?? m.color ?? "",
          precios,
          unidades: Object.fromEntries(Object.entries(m.unidades).filter(([k]) => k in precios)),
          problemas,
          },
          // "Blanco - White - Blanc", "Color -Colour", "Gris-Grey- Gris": Roly colours have no hyphen of their own
          { separadorIdiomas: /\s*-\s*/, idiomaTalla: true, color: colorRoly }
        )
      );
      if (texto(celda("color"))) m.color = texto(celda("color"));
    }
    return { entradas, descartadas };
  },
};

// ---------------------------------------------------------------- SOL'S
// One price per row ("Tu Tarifa"). Brand, gender, reference, name, colour and
// size are written once and inherited by the following rows; a model starts
// when the name changes. The file also carries other brands (NEOBLU, ATF, RTP).
const SOLS = {
  id: "sols",
  proveedor: "SOL'S",
  descripcion: "Tarifa SOL'S (Brand · Género · Ref · Nombre · Color · Talla · Tu Tarifa)",
  modalidades: [{ id: "tarifa", nombre: "Tarifa" }],
  propuesta: { modalidad: "tarifa", interpretacion: "neto", iva: 21, nota: "Confirmado por el propietario para la tarifa SOL'S: precios sin IVA, IVA de compra 21 %." },
  detectar: (filas) =>
    buscarCabecera(filas, { marca: ["BRAND", "MARCA"], genero: ["GENERO"], ref: ["REF"], nombre: ["NOMBRE"], color: ["COLOR"], talla: ["TALLA"], precio: ["TU TARIFA", "TARIFA"] }),
  leer: (filas, { fila: cab, columnas: c }) => {
    const entradas = [];
    const descartadas = [];
    let m = null;
    for (let i = cab + 1; i < filas.length; i++) {
      const f = filas[i] ?? [];
      const celda = (k) => f[c[k]];
      if (f.every(vacio)) continue;
      const nombre = texto(celda("nombre"));
      const ref = referencia(celda("ref"));
      const problemas = [];
      if (!m || (nombre && clave(nombre) !== clave(m.modelo))) {
        m = { modelo: nombre ?? "", referencia: ref, marca: texto(celda("marca")) ?? m?.marca ?? null, genero: texto(celda("genero")), color: null, talla: null };
        if (!nombre) problemas.push("Sin nombre de modelo.");
      } else if (ref && m.referencia && ref !== m.referencia) {
        problemas.push(`Referencia ${ref} distinta de la del modelo (${m.referencia}) con el mismo nombre.`);
      } else if (ref && !m.referencia) {
        m.referencia = ref;
      }
      if (texto(celda("marca"))) m.marca = texto(celda("marca"));
      if (texto(celda("genero"))) m.genero = texto(celda("genero"));
      if (texto(celda("color"))) m.color = texto(celda("color"));
      if (texto(celda("talla"))) m.talla = texto(celda("talla"));
      const precio = leerPrecio(celda("precio"), "Tarifa", problemas);
      entradas.push(
        completarTallaYColor({
          fila: i + 1,
          referencia: m.referencia,
          modelo: m.modelo,
          marca: m.marca,
          genero: m.genero,
          tipo: null,
          tallaTexto: m.talla ?? "",
          colorTexto: m.color ?? "",
          precios: precio === null ? {} : { tarifa: precio },
          unidades: {},
          problemas,
        })
      );
    }
    return { entradas, descartadas };
  },
};

export const FORMATOS = [ROLY, SOLS];
export const formatoPorId = (id) => FORMATOS.find((f) => f.id === id) ?? null;

/**
 * Reads a workbook ({ hojas }) with the given format, or detects it.
 * @returns {{ formato, hoja: string, entradas: object[], descartadas: object[] }}
 */
export const leerTarifa = (libro, idFormato = null) => {
  const candidatos = idFormato ? [formatoPorId(idFormato)].filter(Boolean) : FORMATOS;
  for (const formato of candidatos) {
    for (const hoja of libro.hojas) {
      const cabecera = formato.detectar(hoja.filas);
      if (cabecera) return { formato, hoja: hoja.nombre, ...formato.leer(hoja.filas, cabecera) };
    }
  }
  throw new Error(
    idFormato
      ? `El archivo no tiene el formato de tarifa ${formatoPorId(idFormato)?.proveedor ?? idFormato}: no se encuentran sus columnas.`
      : "No se reconoce el formato de la tarifa. Formatos admitidos: " + FORMATOS.map((f) => f.proveedor).join(", ") + "."
  );
};
