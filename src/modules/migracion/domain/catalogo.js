// Preview of a catalogue import into Supabase (proveedores -> modelos -> variantes).
//
// Accepted rows (flat): { proveedor, modelo, color, talla, tipo?, referencia?,
//   precio_neto?, iva?, coste? }  — prices in euros; iva as 0.21 or 21.
// Sources: the Firestore "productos" collection (only `coste`) or a catalogue
// file exported from the master spreadsheet (net price + VAT + real cost).
// Prices are copied as they are: nothing is recalculated beyond net × (1 + VAT)
// when the source gives both, no VAT is added, and existing Supabase prices
// are never changed.

const texto = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

const numero = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

// Net prices keep up to four decimals (some supplier prices have three)
const aCuatroDecimales = (euros) => {
  const d = euros * 10000;
  return Math.abs(d - Math.round(d)) < 1e-6 ? Math.round(d) / 10000 : null;
};

export const claveModelo = (f) => `${f.proveedor}|${f.modelo}`.toLowerCase();
export const claveVariante = (f) => [f.proveedor, f.modelo, f.color, f.talla].map((x) => String(x).toLowerCase()).join("|");

// Exact cost in euros of a prepared row
export const costeExacto = (f) => (f.precio_neto !== null && f.precio_neto !== undefined
  ? (Number(f.precio_neto) * (100 + Number(f.iva_porcentaje))) / 100
  : f.coste_cent / 100);

/** Normalises one source row. Returns { fila } or { motivo }. */
export const normalizarFila = (p) => {
  const fila = {
    proveedor: texto(p?.proveedor),
    modelo: texto(p?.modelo),
    color: texto(p?.color),
    talla: texto(p?.talla),
    tipo: texto(p?.tipo),
    referencia: texto(p?.referencia),
    precio_neto: null,
    iva_porcentaje: null,
    coste_cent: null,
  };
  const falta = ["proveedor", "modelo", "color", "talla"].filter((k) => !fila[k]);
  if (falta.length) return { fila, motivo: `Falta: ${falta.join(", ")}.` };

  const neto = numero(p?.precio_neto);
  const ivaBruto = numero(p?.iva);
  const coste = numero(p?.coste);
  if (neto !== null || ivaBruto !== null) {
    if (neto === null || ivaBruto === null) return { fila, motivo: "Tiene precio neto o IVA, pero no los dos." };
    const iva = ivaBruto <= 1 ? Math.round(ivaBruto * 10000) / 100 : ivaBruto; // 0.21 -> 21
    if (neto < 0 || iva < 0 || iva > 100) return { fila, motivo: "Precio neto o IVA fuera de rango." };
    const netoExacto = aCuatroDecimales(neto);
    if (netoExacto === null) return { fila, motivo: "El precio neto tiene más de cuatro decimales." };
    fila.precio_neto = netoExacto;
    fila.iva_porcentaje = iva;
    fila.coste_cent = Math.round(netoExacto * (100 + iva));
    if (coste !== null && Math.abs(costeExacto(fila) - coste) > 0.00005) {
      return { fila, motivo: `El coste (${coste}) no coincide con neto × (1 + IVA) (${costeExacto(fila)}).` };
    }
  } else {
    if (coste === null || coste < 0) return { fila, motivo: "Coste no válido." };
    fila.coste_cent = Math.round(coste * 100);
  }
  return { fila };
};

const mismoPrecio = (a, b) => a.coste_cent === b.coste_cent && a.precio_neto === b.precio_neto && Number(a.iva_porcentaje) === Number(b.iva_porcentaje);

/**
 * @param {object[]} productos source rows
 * @param {object[]} actuales Supabase rows from v_catalogo_plano
 * @param {Record<string, string>} tiposModelo garment type chosen per model (claveModelo -> tipo)
 */
export const prepararCatalogo = (productos, actuales = [], tiposModelo = {}) => {
  const invalidas = [];
  const porClave = new Map();
  productos.forEach((p, indice) => {
    const { fila, motivo } = normalizarFila(p);
    if (motivo) {
      invalidas.push({ indice, id: p?.id, fila, motivo });
      return;
    }
    const clave = claveVariante(fila);
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(fila);
  });

  const enSupabase = new Map(actuales.map((a) => [claveVariante(a), a]));
  const modelosSupabase = new Map(actuales.map((a) => [claveModelo(a), a.tipo]));
  const validas = [];
  const conflictos = [];
  let repetidasIdenticas = 0;
  for (const grupo of porClave.values()) {
    if (grupo.some((g) => !mismoPrecio(g, grupo[0]))) {
      conflictos.push({ fila: grupo[0], costes: [...new Set(grupo.map((g) => g.coste_cent))], motivo: "El mismo producto aparece con precios distintos: no se importa hasta decidir cuál es el correcto." });
      continue;
    }
    repetidasIdenticas += grupo.length - 1;
    validas.push(grupo[0]);
  }

  // Garment type per model: from the source, an existing model, or the owner's choice
  const modelos = new Map();
  for (const f of validas) {
    const k = claveModelo(f);
    if (!modelos.has(k)) modelos.set(k, { clave: k, proveedor: f.proveedor, modelo: f.modelo, tipo: "", variantes: 0, existente: modelosSupabase.has(k) });
    const m = modelos.get(k);
    m.variantes += 1;
    m.tipo = m.tipo || modelosSupabase.get(k) || f.tipo || tiposModelo[k] || "";
  }
  for (const f of validas) f.tipo = modelos.get(claveModelo(f)).tipo;

  const nuevas = [];
  const existentes = [];
  const cambiosCoste = [];
  for (const f of validas) {
    const actual = enSupabase.get(claveVariante(f));
    if (!actual) nuevas.push(f);
    else if (Math.abs(Number(actual.coste ?? actual.coste_cent / 100) - costeExacto(f)) < 0.000001) existentes.push(f);
    else cambiosCoste.push({ fila: f, costeActual: Number(actual.coste ?? actual.coste_cent / 100), motivo: "Ya existe en Supabase con otro coste: se conserva el de Supabase." });
  }
  const modelosSinTipo = [...modelos.values()].filter((m) => !m.tipo);
  return {
    validas,
    nuevas,
    existentes,
    cambiosCoste,
    conflictos,
    invalidas,
    modelos: [...modelos.values()],
    modelosSinTipo,
    listoParaImportar: nuevas.length > 0 && modelosSinTipo.length === 0,
    resumen: {
      leidos: productos.length,
      validasUnicas: validas.length,
      nuevas: nuevas.length,
      existentes: existentes.length,
      cambiosCoste: cambiosCoste.length,
      conflictos: conflictos.length,
      invalidas: invalidas.length,
      repetidasIdenticas,
      modelos: modelos.size,
      proveedores: new Set(validas.map((f) => f.proveedor.toLowerCase())).size,
    },
  };
};

// Rows sent to the import function
export const filasParaImportar = (nuevas) =>
  nuevas.map(({ proveedor, modelo, color, talla, tipo, referencia, precio_neto, iva_porcentaje, coste_cent }) => ({
    proveedor, modelo, color, talla, tipo, referencia, precio_neto, iva_porcentaje, coste_cent,
  }));

/**
 * Reconciliation after importing: every valid source row must be in the catalogue
 * with its exact cost (new ones) or the cost Supabase already had (reported before).
 */
export const conciliarCatalogo = (validas, catalogoDespues, cambiosCoste = []) => {
  const despues = new Map(catalogoDespues.map((a) => [claveVariante(a), a]));
  const conCambio = new Set(cambiosCoste.map((c) => claveVariante(c.fila)));
  const faltan = [];
  const costeDistinto = [];
  for (const f of validas) {
    const a = despues.get(claveVariante(f));
    if (!a) faltan.push(f);
    else if (!conCambio.has(claveVariante(f)) && Math.abs(Number(a.coste ?? a.coste_cent / 100) - costeExacto(f)) >= 0.000001) costeDistinto.push(f);
  }
  return { esperadas: validas.length, encontradas: validas.length - faltan.length, faltan, costeDistinto, correcto: faltan.length === 0 && costeDistinto.length === 0 };
};

// Accepts a bare list or a file { productos: [...] }
export const extraerProductos = (json) => {
  const lista = Array.isArray(json) ? json : json?.productos;
  if (!Array.isArray(lista)) throw new Error("El archivo no contiene una lista de productos.");
  return lista;
};
