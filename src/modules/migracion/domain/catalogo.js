// Preview of the import of the Firestore catalogue ("productos": flat rows
// tipo, proveedor, modelo, talla, color, coste in euros) into the Supabase
// catalogue (proveedores -> modelos -> variantes). Prices are copied as they
// are: nothing is recalculated, and existing Supabase prices are never changed.

const texto = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

const costeCent = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

export const claveVariante = (f) => [f.proveedor, f.tipo, f.modelo, f.talla, f.color].map((x) => x.toLowerCase()).join("|");

/**
 * @param {object[]} productos Firestore rows
 * @param {object[]} actuales Supabase rows from v_catalogo_plano ({ proveedor, tipo, modelo, talla, color, coste_cent })
 */
export const prepararCatalogo = (productos, actuales = []) => {
  const invalidas = [];
  const porClave = new Map();
  productos.forEach((p, indice) => {
    const fila = {
      proveedor: texto(p?.proveedor),
      tipo: texto(p?.tipo),
      modelo: texto(p?.modelo),
      talla: texto(p?.talla),
      color: texto(p?.color),
      coste_cent: costeCent(p?.coste),
    };
    const falta = ["proveedor", "tipo", "modelo", "talla", "color"].filter((k) => !fila[k]);
    if (falta.length || fila.coste_cent === null) {
      invalidas.push({ indice, id: p?.id, fila, motivo: falta.length ? `Falta: ${falta.join(", ")}.` : "Coste no válido." });
      return;
    }
    const clave = claveVariante(fila);
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(fila);
  });

  const enSupabase = new Map(actuales.map((a) => [claveVariante({ ...a, proveedor: a.proveedor, tipo: a.tipo }), a]));
  const nuevas = [];
  const existentes = [];
  const cambiosCoste = [];
  const conflictos = [];
  let repetidasIdenticas = 0;
  for (const [clave, grupo] of porClave) {
    const costes = [...new Set(grupo.map((g) => g.coste_cent))];
    if (costes.length > 1) {
      conflictos.push({ fila: grupo[0], costes, motivo: "El mismo producto aparece con costes distintos: no se importa hasta decidir cuál es el correcto." });
      continue;
    }
    repetidasIdenticas += grupo.length - 1;
    const fila = grupo[0];
    const actual = enSupabase.get(clave);
    if (!actual) nuevas.push(fila);
    else if (actual.coste_cent === fila.coste_cent) existentes.push(fila);
    else cambiosCoste.push({ fila, costeActualCent: actual.coste_cent, motivo: "Ya existe en Supabase con otro coste: se conserva el de Supabase." });
  }
  return {
    nuevas,
    existentes,
    cambiosCoste,
    conflictos,
    invalidas,
    resumen: {
      leidos: productos.length,
      nuevas: nuevas.length,
      existentes: existentes.length,
      cambiosCoste: cambiosCoste.length,
      conflictos: conflictos.length,
      invalidas: invalidas.length,
      repetidasIdenticas,
    },
  };
};

/** Integrity check after importing: every new row must now be in the catalogue with its cost. */
export const verificarImportacionCatalogo = (nuevas, catalogoDespues) => {
  const despues = new Map(catalogoDespues.map((a) => [claveVariante(a), a.coste_cent]));
  return nuevas
    .filter((f) => despues.get(claveVariante(f)) !== f.coste_cent)
    .map((f) => `No se encuentra tras importar: ${f.proveedor} ${f.modelo} ${f.talla} ${f.color}.`);
};
