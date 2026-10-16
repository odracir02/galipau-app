// Parameters of the screen printing real-cost engine.
// Real values are stored (versioned) in the database, never in the code: the
// values in PARAMETROS_EJEMPLO are fictitious and only used for tests and demos.

export const BASES_CONSUMO = {
  pantalla: "por pantalla",
  prenda: "por prenda",
  prendaColor: "por prenda y color",
};

// Scalar parameters: key, label, unit, group and limits
export const CAMPOS_PARAMETROS = [
  { clave: "manoObraEurHora", etiqueta: "Mano de obra", unidad: "€/hora", grupo: "general", min: 0 },
  { clave: "reservaMaquinariaPorPrenda", etiqueta: "Reserva de mantenimiento de maquinaria", unidad: "€/prenda", grupo: "general", min: 0 },
  { clave: "mermaPorDefecto", etiqueta: "Merma estándar", unidad: "fracción (0,04 = 4 %)", grupo: "general", min: 0, max: 1 },
  { clave: "margenRecomendado", etiqueta: "Margen del precio recomendado", unidad: "fracción sobre el precio de venta", grupo: "general", min: 0, max: 0.99 },
  { clave: "electricidadEurKwh", etiqueta: "Electricidad", unidad: "€/kWh", grupo: "electricidad", min: 0 },
  { clave: "flashPotenciaKw", etiqueta: "Flash: potencia", unidad: "kW", grupo: "maquinaria", min: 0 },
  { clave: "flashCalentamientoMin", etiqueta: "Flash: calentamiento", unidad: "min/trabajo", grupo: "maquinaria", min: 0 },
  { clave: "planchaPotenciaKw", etiqueta: "Plancha: potencia", unidad: "kW", grupo: "maquinaria", min: 0 },
  { clave: "planchaCalentamientoMin", etiqueta: "Plancha: calentamiento", unidad: "min/trabajo", grupo: "maquinaria", min: 0 },
  { clave: "hornoPotenciaKw", etiqueta: "Horno: potencia", unidad: "kW", grupo: "maquinaria", min: 0 },
  { clave: "hornoMinutosTanda", etiqueta: "Horno: secado por tanda", unidad: "min/tanda", grupo: "maquinaria", min: 0 },
  { clave: "hornoCapacidadPantallas", etiqueta: "Horno: capacidad", unidad: "pantallas/tanda", grupo: "maquinaria", min: 1, entero: true },
  { clave: "prepararPantallaMin", etiqueta: "Preparar pantalla", unidad: "min/pantalla", grupo: "tiempos", min: 0 },
  { clave: "registroMin", etiqueta: "Registro", unidad: "min/pantalla", grupo: "tiempos", min: 0 },
  { clave: "encintadoSeg", etiqueta: "Encintado", unidad: "s/pantalla", grupo: "tiempos", min: 0 },
  { clave: "recuperacionMin", etiqueta: "Recuperación de emulsión", unidad: "min/pantalla", grupo: "tiempos", min: 0 },
  { clave: "colocarPrendaSeg", etiqueta: "Colocar prenda", unidad: "s/prenda", grupo: "tiempos", min: 0 },
  { clave: "retirarPrendaSeg", etiqueta: "Retirar prenda", unidad: "s/prenda", grupo: "tiempos", min: 0 },
  { clave: "impresionSegColorPrenda", etiqueta: "Impresión", unidad: "s/color/prenda", grupo: "tiempos", min: 0 },
  { clave: "curadoSegPrenda", etiqueta: "Curado en plancha", unidad: "s/prenda", grupo: "tiempos", min: 0 },
];

export const GRUPOS_PARAMETROS = {
  general: "General",
  electricidad: "Electricidad",
  maquinaria: "Maquinaria",
  tiempos: "Tiempos de producción",
};

// Cost of one unit of `base` for a consumable:
//   with rendimiento: precio / (contenido × rendimiento)   (bases covered per unit of content)
//   with consumo:     precio / contenido × consumo         (content used per base)
export const costePorBase = (c) => (c.consumo ? (c.precio / c.contenido) * c.consumo : c.precio / (c.contenido * c.rendimiento));

const numero = (v) => typeof v === "number" && Number.isFinite(v);

/** Returns a list of error messages (empty = valid). */
export const validarParametros = (p) => {
  const errores = [];
  if (!p || typeof p !== "object") return ["Los parámetros deben ser un objeto."];
  for (const campo of CAMPOS_PARAMETROS) {
    const v = p[campo.clave];
    if (!numero(v)) {
      errores.push(`${campo.etiqueta}: falta o no es un número.`);
      continue;
    }
    if (campo.min !== undefined && v < campo.min) errores.push(`${campo.etiqueta}: debe ser como mínimo ${campo.min}.`);
    if (campo.max !== undefined && v > campo.max) errores.push(`${campo.etiqueta}: debe ser como máximo ${campo.max}.`);
    if (campo.entero && !Number.isInteger(v)) errores.push(`${campo.etiqueta}: debe ser un número entero.`);
  }
  if (!Array.isArray(p.consumibles)) {
    errores.push("Faltan los consumibles.");
    return errores;
  }
  const claves = new Set();
  for (const c of p.consumibles) {
    const nombre = c?.nombre || c?.clave || "Consumible";
    if (!c?.clave || !/^[a-z0-9_]+$/.test(c.clave)) errores.push(`${nombre}: clave no válida.`);
    else if (claves.has(c.clave)) errores.push(`${nombre}: clave duplicada.`);
    else claves.add(c.clave);
    if (!c?.nombre?.trim()) errores.push(`${nombre}: falta el nombre.`);
    if (!(c?.base in BASES_CONSUMO)) errores.push(`${nombre}: base de consumo no válida.`);
    if (!numero(c?.precio) || c.precio < 0) errores.push(`${nombre}: el precio debe ser un número no negativo.`);
    if (!numero(c?.contenido) || c.contenido <= 0) errores.push(`${nombre}: el contenido debe ser mayor que 0.`);
    const tieneRendimiento = c?.rendimiento !== undefined && c?.rendimiento !== null;
    const tieneConsumo = c?.consumo !== undefined && c?.consumo !== null;
    if (tieneRendimiento === tieneConsumo) errores.push(`${nombre}: indica el rendimiento o el consumo (uno de los dos).`);
    if (tieneRendimiento && (!numero(c.rendimiento) || c.rendimiento <= 0)) errores.push(`${nombre}: el rendimiento debe ser mayor que 0.`);
    if (tieneConsumo && (!numero(c.consumo) || c.consumo <= 0)) errores.push(`${nombre}: el consumo debe ser mayor que 0.`);
  }
  return errores;
};

// FICTITIOUS values with the right structure (round numbers, easy to check by hand)
export const PARAMETROS_EJEMPLO = Object.freeze({
  manoObraEurHora: 18,
  reservaMaquinariaPorPrenda: 0.1,
  mermaPorDefecto: 0.05,
  margenRecomendado: 0.25,
  electricidadEurKwh: 0.2,
  flashPotenciaKw: 1,
  flashCalentamientoMin: 6,
  planchaPotenciaKw: 1,
  planchaCalentamientoMin: 6,
  hornoPotenciaKw: 3,
  hornoMinutosTanda: 10,
  hornoCapacidadPantallas: 2,
  prepararPantallaMin: 6,
  registroMin: 2,
  encintadoSeg: 120,
  recuperacionMin: 4,
  colocarPrendaSeg: 20,
  retirarPrendaSeg: 10,
  impresionSegColorPrenda: 30,
  curadoSegPrenda: 30,
  consumibles: Object.freeze([
    { clave: "fotolitos", nombre: "Fotolitos", base: "pantalla", precio: 100, contenido: 100, unidad: "uds", rendimiento: 1 },
    { clave: "emulsion", nombre: "Emulsión", base: "pantalla", precio: 40, contenido: 1, unidad: "kg", rendimiento: 40 },
    { clave: "plastisol", nombre: "Plastisol", base: "prendaColor", precio: 20, contenido: 1, unidad: "kg", rendimiento: 100 },
    { clave: "cinta", nombre: "Cinta", base: "pantalla", precio: 10, contenido: 50, unidad: "m", consumo: 2 },
    { clave: "adhesivo", nombre: "Adhesivo", base: "prenda", precio: 10, contenido: 1, unidad: "bote", rendimiento: 1000 },
  ]),
});
