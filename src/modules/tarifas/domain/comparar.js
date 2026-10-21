// Compares a supplier price list (normalised entries) with the current
// catalogue of that supplier and builds the operations the owner accepted.
// Nothing here writes data and no price is ever changed without an explicit
// decision: every line starts as "ignorar".
//
// States of a line:
//   nueva        colour/size not in the catalogue
//   igual        same price as now
//   diferente    in the catalogue with another price
//   ambigua      needs a decision (similar model name, repeated with other
//                prices, other reference, grouped sizes)
//   descatalogada in the catalogue but not in the price list
//   no_valida    row that cannot be used (no price, size or colour…)

import { clave, limpiar, tallaCanonica, tallaEnGrupo } from "./normalizar.js";

export const ESTADOS = ["nueva", "igual", "diferente", "ambigua", "descatalogada", "no_valida"];
export const NOMBRE_ESTADO = {
  nueva: "Variante nueva",
  igual: "Precio igual",
  diferente: "Precio diferente",
  ambigua: "Referencia ambigua",
  descatalogada: "Posiblemente descatalogada",
  no_valida: "Registro no válido",
};
export const INTERPRETACIONES = {
  neto: "Precio neto (sin IVA): coste = precio × (1 + IVA)",
  iva_incluido: "Precio con IVA incluido: coste = precio",
};

const r4 = (v) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 1e4) / 1e4);

// Small edit distance, to catch spelling differences ("ORION WOMAN" / "ORION WOMEN")
const distancia = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const parecido = (a, b) => a.replace(/ /g, "") === b.replace(/ /g, "") || (Math.min(a.length, b.length) >= 5 && distancia(a, b) <= 1);

/** Price columns for the database from a price-list amount */
export const precioSegun = (importe, { interpretacion, iva }) =>
  interpretacion === "iva_incluido"
    ? { precio_neto: null, iva_porcentaje: iva, precio_compra: importe }
    : { precio_neto: importe, iva_porcentaje: iva, precio_compra: null };

export const costeDe = (p) =>
  p.precio_neto !== null && p.precio_neto !== undefined
    ? (Number(p.precio_neto) * (100 + Number(p.iva_porcentaje))) / 100
    : p.precio_compra !== null && p.precio_compra !== undefined
      ? Number(p.precio_compra)
      : Number(p.coste_cent ?? 0) / 100;

const mismoPrecio = (actual, nuevo) =>
  r4(actual.precio_neto) === r4(nuevo.precio_neto) && r4(actual.precio_compra) === r4(nuevo.precio_compra) && r4(actual.iva_porcentaje) === r4(nuevo.iva_porcentaje);

const tarifasDe = (precios, unidades) =>
  Object.entries(precios)
    .map(([modalidad, precio]) => ({ modalidad, precio, unidades: unidades?.[modalidad] ?? null }))
    .sort((a, b) => a.modalidad.localeCompare(b.modalidad));
const mismasTarifas = (a = [], b = []) =>
  a.length === b.length &&
  [...a].sort((x, y) => x.modalidad.localeCompare(y.modalidad)).every((t, i) => t.modalidad === b[i].modalidad && r4(t.precio) === r4(b[i].precio) && (t.unidades ?? null) === (b[i].unidades ?? null));

const avisosReferencia = (fuentes) => [...new Set(fuentes.flatMap((f) => f.problemas.filter((p) => /^Referencia/.test(p))))];

const motivosBloqueo = (e) => {
  const m = [];
  if (!limpiar(e.modelo)) m.push("Sin nombre de modelo.");
  if (!e.tallas && !e.grupo) m.push(...e.problemas.filter((p) => /talla/i.test(p)));
  if (e.colores.length === 0) m.push("Sin color.");
  if (Object.keys(e.precios).length === 0) m.push(...(e.problemas.filter((p) => /precio/i.test(p)).length ? e.problemas.filter((p) => /precio/i.test(p)) : ["Sin precio."]));
  return [...new Set(m)];
};

/**
 * @param {object} p
 * @param {object[]} p.entradas  normalised entries (leerTarifa)
 * @param {object[]} p.descartadas rows the format skipped (notes, prices on request)
 * @param {object[]} p.catalogo  v_catalogo_admin rows of THIS supplier
 * @param {Record<number, object[]>} [p.tarifasActuales] variante_id -> current price modes
 * @param {{ modalidad: string, interpretacion: "neto"|"iva_incluido", iva: number }} p.opciones
 * @param {{ equivalencias?: Record<string, number|"nuevo">, filaElegida?: Record<string, number> }} [p.resoluciones]
 *   equivalencias: file model key -> existing modelo_id (same model) or "nuevo";
 *   filaElegida: line key -> Excel row whose price is the right one.
 */
export const compararTarifa = ({ entradas, descartadas = [], catalogo, tarifasActuales = {}, opciones, resoluciones = {} }) => {
  const equivalencias = resoluciones.equivalencias ?? {};
  const filaElegida = resoluciones.filaElegida ?? {};
  const items = [];

  // ---- existing models of the supplier
  const modelos = new Map();
  for (const v of catalogo) {
    if (!modelos.has(v.modelo_id)) modelos.set(v.modelo_id, { id: v.modelo_id, nombre: v.modelo, referencia: v.referencia ?? null, tipo: v.tipo, clave: clave(v.modelo), variantes: [] });
    modelos.get(v.modelo_id).variantes.push(v);
  }
  const listaModelos = [...modelos.values()];

  // ---- file models and their lines (one per colour × size)
  const fichero = new Map(); // key -> { clave, nombre, referencia, marca, tipo, genero, lineas: Map, grupos: [] }
  for (const e of entradas) {
    const bloqueo = motivosBloqueo(e);
    if (bloqueo.length) {
      items.push({ id: `fila-${e.fila}`, estado: "no_valida", modelo: limpiar(e.modelo), referencia: e.referencia, color: e.colorTexto, talla: e.tallaTexto, filas: [e.fila], motivo: bloqueo.join(" ") });
      continue;
    }
    const k = clave(e.modelo);
    if (!fichero.has(k)) fichero.set(k, { clave: k, nombre: limpiar(e.modelo).toUpperCase(), referencia: e.referencia, marca: e.marca, tipo: e.tipo, genero: e.genero, lineas: new Map(), grupos: [] });
    const fm = fichero.get(k);
    if (!fm.referencia && e.referencia) fm.referencia = e.referencia;
    if (!fm.tipo && e.tipo) fm.tipo = e.tipo;
    for (const color of e.colores) {
      if (e.grupo) {
        fm.grupos.push({ color, grupo: e.grupo, tallaTexto: e.tallaTexto, precios: e.precios, unidades: e.unidades, fila: e.fila, problemas: e.problemas });
        continue;
      }
      for (const talla of e.tallas) {
        const lk = `${k}|${clave(color)}|${talla}`;
        const previa = fm.lineas.get(lk);
        const fuente = { fila: e.fila, precios: e.precios, unidades: e.unidades, problemas: e.problemas };
        if (previa) previa.fuentes.push(fuente);
        else fm.lineas.set(lk, { id: lk, color, talla, fuentes: [fuente] });
      }
    }
  }

  const usadas = new Set(); // existing variants found in the file

  for (const fm of fichero.values()) {
    // ---- which existing model is it?
    let modelo = null;
    let candidato = null;
    const eq = equivalencias[fm.clave];
    if (eq === "nuevo") modelo = null;
    else if (eq !== undefined) modelo = modelos.get(Number(eq)) ?? null;
    else {
      modelo =
        (fm.referencia && listaModelos.find((m) => m.referencia && clave(m.referencia) === clave(fm.referencia))) ||
        listaModelos.find((m) => m.clave === fm.clave) ||
        null;
      if (!modelo) candidato = listaModelos.find((m) => parecido(m.clave, fm.clave)) ?? null;
    }
    const base = { modeloClave: fm.clave, modelo: modelo?.nombre ?? fm.nombre, modeloFichero: fm.nombre, referencia: fm.referencia, marca: fm.marca, tipo: modelo?.tipo ?? fm.tipo ?? null, genero: fm.genero, modeloId: modelo?.id ?? null };

    for (const l of fm.lineas.values()) {
      // repeated colour/size: same prices -> one line; other prices -> the owner chooses the row
      const distintas = l.fuentes.filter((f, i) => l.fuentes.findIndex((g) => JSON.stringify(g.precios) === JSON.stringify(f.precios)) === i);
      const elegida = distintas.length > 1 ? distintas.find((f) => f.fila === filaElegida[l.id]) : distintas[0];
      const fuente = elegida ?? distintas[0];
      const item = { ...base, id: l.id, color: l.color, talla: l.talla, filas: l.fuentes.map((f) => f.fila), precios: fuente.precios, unidades: fuente.unidades, tarifas: tarifasDe(fuente.precios, fuente.unidades) };
      const importe = fuente.precios[opciones.modalidad];
      if (importe === undefined) {
        items.push({ ...item, estado: "no_valida", motivo: `Sin precio «${opciones.modalidad}» en el archivo.${fuente.problemas.length ? " " + fuente.problemas.join(" ") : ""}` });
        continue;
      }
      item.importe = importe;
      item.nuevo = precioSegun(importe, opciones);
      item.costeNuevo = costeDe(item.nuevo);
      const existente = modelo?.variantes.find((v) => clave(v.color) === clave(l.color) && tallaCanonica(v.talla) === l.talla);
      if (existente) {
        usadas.add(existente.variante_id);
        Object.assign(item, { varianteId: existente.variante_id, actual: existente, costeActual: costeDe(existente), archivada: !existente.variante_activa, tarifasActuales: tarifasActuales[existente.variante_id] ?? [] });
      }
      item.base = existente ? (mismoPrecio(existente, item.nuevo) ? "igual" : "diferente") : "nueva";
      if (distintas.length > 1 && !elegida) {
        items.push({ ...item, estado: "ambigua", conflicto: "precios", opcionesFila: distintas.map((f) => ({ fila: f.fila, importe: f.precios[opciones.modalidad] ?? null })), motivo: `Aparece ${distintas.length} veces con precios distintos (filas ${distintas.map((f) => f.fila).join(", ")}): elige la fila correcta.` });
      } else if (candidato) {
        items.push({ ...item, estado: "ambigua", conflicto: "modelo", candidato: { id: candidato.id, nombre: candidato.nombre }, motivo: `¿Es el modelo «${candidato.nombre}» del catálogo? El nombre se parece pero no es igual.` });
      } else if (avisosReferencia(l.fuentes).length && eq === undefined) {
        items.push({ ...item, estado: "ambigua", conflicto: "referencia", motivo: avisosReferencia(l.fuentes).join(" ") });
      } else {
        items.push({ ...item, estado: item.base });
      }
    }

    // ---- grouped sizes: only update existing sizes inside the group
    for (const g of fm.grupos) {
      const importe = g.precios[opciones.modalidad];
      const dentro = (modelo?.variantes ?? []).filter((v) => clave(v.color) === clave(g.color) && tallaEnGrupo(v.talla, g.grupo));
      if (dentro.length === 0 || importe === undefined) {
        items.push({
          ...base, id: `${fm.clave}|${clave(g.color)}|${g.tallaTexto}`, estado: "ambigua", conflicto: "grupo", color: g.color, talla: g.tallaTexto, filas: [g.fila], precios: g.precios, importe: importe ?? null,
          motivo: importe === undefined ? `Tallas agrupadas «${g.tallaTexto}» sin precio «${opciones.modalidad}».` : `Tallas agrupadas «${g.tallaTexto}»: el proveedor no detalla qué tallas existen y no hay tallas de ese grupo en el catálogo. No se crean variantes nuevas.`,
        });
        continue;
      }
      for (const v of dentro) {
        if (usadas.has(v.variante_id)) continue; // an explicit size wins over a group
        usadas.add(v.variante_id);
        const nuevo = precioSegun(importe, opciones);
        items.push({
          ...base, id: `${fm.clave}|${clave(g.color)}|${tallaCanonica(v.talla)}`, color: g.color, talla: v.talla, filas: [g.fila], precios: g.precios, unidades: g.unidades, tarifas: tarifasDe(g.precios, g.unidades),
          importe, nuevo, costeNuevo: costeDe(nuevo), varianteId: v.variante_id, actual: v, costeActual: costeDe(v), archivada: !v.variante_activa, tarifasActuales: tarifasActuales[v.variante_id] ?? [],
          desdeGrupo: g.tallaTexto, base: mismoPrecio(v, nuevo) ? "igual" : "diferente", estado: mismoPrecio(v, nuevo) ? "igual" : "diferente",
        });
      }
    }
  }

  // ---- in the catalogue, not in the price list
  const enFichero = new Set([...items].map((i) => i.modeloId).filter(Boolean));
  for (const v of catalogo) {
    if (usadas.has(v.variante_id) || !v.variante_activa) continue;
    items.push({
      id: `cat-${v.variante_id}`, estado: "descatalogada", modelo: v.modelo, referencia: v.referencia, color: v.color, talla: v.talla, varianteId: v.variante_id, modeloId: v.modelo_id, actual: v, costeActual: costeDe(v), filas: [],
      motivo: enFichero.has(v.modelo_id) ? "El color o la talla no aparece en la tarifa." : "El modelo no aparece en la tarifa.",
    });
  }

  for (const d of descartadas) items.push({ id: `desc-${d.fila}`, estado: "no_valida", modelo: d.modelo ?? "", referencia: d.referencia ?? null, color: "", talla: "", filas: [d.fila], motivo: d.motivo });

  return { items, resumen: resumir(items, fichero) };
};

const resumir = (items, fichero) => {
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  for (const i of items) porEstado[i.estado]++;
  const modelosNuevos = [...new Set(items.filter((i) => i.estado === "nueva" && !i.modeloId).map((i) => i.modeloClave))];
  return { porEstado, modelosFichero: fichero.size, modelosNuevos: modelosNuevos.length, total: items.length };
};

/** Decisions allowed for a line: "ignorar" always, plus what its state permits */
export const decisionesPosibles = (item) => {
  const d = ["ignorar"];
  const base = item.estado === "ambigua" ? (item.conflicto === "grupo" ? null : item.base) : item.estado;
  if (base === "nueva") d.push("anadir");
  if (base === "diferente") d.push("actualizar");
  if (item.estado === "descatalogada") d.push("archivar");
  return d;
};

/**
 * Operations for importar_tarifa from the owner's decisions.
 * @param {object[]} items  compararTarifa().items
 * @param {Record<string, string>} decisiones  item id -> "anadir" | "actualizar" | "archivar" | "ignorar"
 * @param {{ tipos?: Record<string, string>, guardarModalidades?: boolean }} extra
 *   tipos: garment type for each NEW model (file model key -> tipo)
 * @returns {{ operaciones: object[], errores: string[] }}
 */
export const construirOperaciones = (items, decisiones, { tipos = {}, guardarModalidades = true } = {}) => {
  const operaciones = [];
  const errores = [];
  for (const i of items) {
    const d = decisiones[i.id] ?? "ignorar";
    if (d === "ignorar") {
      if (guardarModalidades && i.estado === "igual" && i.varianteId && i.tarifas?.length && !mismasTarifas(i.tarifasActuales, i.tarifas))
        operaciones.push({ accion: "tarifas", variante_id: i.varianteId, tarifas: i.tarifas });
      continue;
    }
    if (!decisionesPosibles(i).includes(d)) {
      errores.push(`${i.modelo} ${i.color} ${i.talla}: decisión «${d}» no permitida.`);
      continue;
    }
    if (d === "anadir") {
      const tipo = limpiar(i.tipo ?? tipos[i.modeloClave] ?? "");
      if (!tipo) {
        errores.push(`Indica el tipo de artículo del modelo nuevo «${i.modelo}».`);
        continue;
      }
      operaciones.push({
        accion: "alta",
        modelo: { nombre: i.modelo, referencia: i.referencia ?? null, tipo, marca: i.marca ?? null },
        color: i.color,
        talla: i.talla,
        precio: i.nuevo,
        tarifas: i.tarifas,
      });
    } else if (d === "actualizar") {
      operaciones.push({ accion: "precio", variante_id: i.varianteId, precio: i.nuevo, tarifas: i.tarifas });
    } else if (d === "archivar") {
      operaciones.push({ accion: "archivar", variante_id: i.varianteId });
    }
  }
  return { operaciones, errores: [...new Set(errores)] };
};

/** Expected result of applying the operations (shown before confirming) */
export const resultadoPrevisto = (operaciones, items) => {
  const r = { altas: 0, modelosNuevos: new Set(), precios: 0, subidas: 0, bajadas: 0, archivadas: 0, modalidades: 0 };
  const porVariante = new Map(items.filter((i) => i.varianteId).map((i) => [i.varianteId, i]));
  for (const o of operaciones) {
    if (o.accion === "alta") {
      r.altas++;
      if (!items.find((i) => i.modelo === o.modelo.nombre && i.modeloId)) r.modelosNuevos.add(o.modelo.nombre);
    } else if (o.accion === "precio") {
      r.precios++;
      const i = porVariante.get(o.variante_id);
      if (i && i.costeNuevo > i.costeActual) r.subidas++;
      else if (i && i.costeNuevo < i.costeActual) r.bajadas++;
    } else if (o.accion === "archivar") r.archivadas++;
    else if (o.accion === "tarifas") r.modalidades++;
  }
  return { ...r, modelosNuevos: r.modelosNuevos.size };
};

/**
 * After importing: compares the catalogue again and checks that every
 * operation is reflected (new and updated variants now have the file price,
 * archived ones are no longer active).
 * @returns {{ comprobadas: number, fallos: string[] }}
 */
export const verificarImportacion = (operaciones, itemsDespues, catalogoDespues) => {
  const fallos = [];
  let comprobadas = 0;
  const activa = new Map(catalogoDespues.map((v) => [v.variante_id, v.variante_activa]));
  for (const o of operaciones) {
    if (o.accion === "tarifas") continue;
    let ok;
    if (o.accion === "precio") ok = itemsDespues.some((i) => i.varianteId === o.variante_id && i.base === "igual");
    else if (o.accion === "alta")
      ok = itemsDespues.some((i) => i.varianteId && clave(i.modelo) === clave(o.modelo.nombre) && clave(i.color) === clave(o.color) && tallaCanonica(i.talla) === tallaCanonica(o.talla) && i.base === "igual");
    else if (o.accion === "archivar") ok = activa.get(o.variante_id) === false;
    if (ok) comprobadas++;
    else fallos.push(o.accion === "alta" ? `Alta ${o.modelo.nombre} ${o.color} ${o.talla}` : `${o.accion === "precio" ? "Precio" : "Archivo"} de la variante ${o.variante_id}`);
  }
  return { comprobadas, fallos };
};
