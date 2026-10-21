// Supplier price-list import: reading, formats, comparison and operations. FICTITIOUS data only.
import { describe, it, expect } from "vitest";
import { leerXlsx, huellaArchivo, indiceColumna } from "./xlsx.js";
import { interpretarTalla, interpretarColores, tallaEnGrupo, tallaCanonica, clave, precioTarifa, interpretarListaTallas } from "./normalizar.js";
import { leerTarifa } from "./formatos.js";
import { compararTarifa, construirOperaciones, decisionesPosibles, resultadoPrevisto, precioSegun, verificarImportacion, gruposPendientes, claveGrupo } from "./comparar.js";
import { crearXlsx, TARIFA_ROLY_FICTICIA, TARIFA_SOLS_FICTICIA } from "./xlsxPrueba.js";

const libroRoly = () => leerXlsx(crearXlsx([{ nombre: "Tarifa", filas: TARIFA_ROLY_FICTICIA }]));
const libroSols = () => leerXlsx(crearXlsx([{ nombre: "Portada", filas: [["Tarifa ficticia"]] }, { nombre: "Tarifa", filas: TARIFA_SOLS_FICTICIA }]));

describe("lector de .xlsx (solo valores, sin fórmulas ni macros)", () => {
  it("lee textos compartidos y en línea, números, errores y filas vacías", () => {
    const { hojas } = leerXlsx(crearXlsx([{ nombre: "A & B", filas: [["x", "y<z>", 1.5], [], [null, null, "#REF!", "dos\r\nlíneas"]] }]));
    expect(hojas[0].nombre).toBe("A & B");
    expect(hojas[0].filas).toEqual([["x", "y<z>", 1.5], [], [null, null, "#REF!", "dos\nlíneas"]]);
    expect(indiceColumna("AB12")).toBe(27);
  });

  it("rechaza lo que no es un .xlsx y calcula la huella SHA-256", async () => {
    expect(() => leerXlsx(new TextEncoder().encode("no soy un excel"))).toThrow(/no es un Excel/);
    expect(await huellaArchivo(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("normalización", () => {
  it.each([
    ["S-2XL", ["S", "M", "L", "XL", "XXL"]],
    ["XS a XXL", ["XS", "S", "M", "L", "XL", "XXL"]],
    ["4XL a  5XL", ["4XL", "5XL"]],
    ["3XS-XS", ["3XS", "XXS", "XS"]],
    ["2XL", ["XXL"]],
    ["One size", ["TU"]],
    ["TUN", ["TU"]],
    ["6A", ["06A"]],
    ["36/39", ["36/39"]],
    ["S/M", ["S/M"]],
  ])("talla «%s» -> %j", (t, tallas) => expect(interpretarTalla(t)).toMatchObject({ tallas, grupo: null, problema: null }));

  it.each([
    ["Kids", "edad"],
    ["2A a 12A ", "edad"],
    ["38-52", "numero"],
    ["34 a 46", "numero"],
    ["3/6M a 18/23M", "otro"],
    ["S a XLL", "otro"],
  ])("talla agrupada «%s» (no se inventan tallas)", (t, tipo) => expect(interpretarTalla(t)).toMatchObject({ tallas: null, grupo: { tipo } }));

  it("tallas no válidas y pertenencia a un grupo", () => {
    expect(interpretarTalla("Consultar").problema).toMatch(/consultar/);
    expect(interpretarTalla("BLANCO").problema).toMatch(/no reconocida/);
    expect(interpretarTalla("").problema).toMatch(/Sin talla/);
    const g = interpretarTalla("4A a 10A").grupo;
    expect(["02A", "04A", "10A", "12A", "M"].map((t) => tallaEnGrupo(t, g))).toEqual([false, true, true, false, false]);
    expect(tallaEnGrupo("08A", interpretarTalla("Kids").grupo)).toBe(true);
    expect(tallaCanonica(" 2xl ")).toBe("XXL");
  });

  it("colores: primer idioma y varios colores por celda", () => {
    expect(interpretarColores("Blanco - White - Blanc")).toEqual(["BLANCO"]);
    expect(interpretarColores("Blanco/Color - White/Colour - Blanc/Couleur")).toEqual(["BLANCO", "COLOR"]);
    expect(interpretarColores("BLANCO &\nABSOLUTE WHITE")).toEqual(["BLANCO", "ABSOLUTE WHITE"]);
    expect(interpretarColores("Color -Colour", { separadorIdiomas: /\s*-\s*/ })).toEqual(["COLOR"]);
    expect(clave("  Línea-Básica ")).toBe("LINEA BASICA");
  });

  it("precios: se elimina el ruido de coma flotante sin perder decimales", () => {
    expect(precioTarifa(1.2599999999999998)).toBe(1.26);
    expect(precioTarifa(2.12345)).toBe(2.12345);
    expect(precioTarifa(-1)).toBeNull();
  });
});

describe("formato ROLY", () => {
  it("se detecta solo y hereda referencia, nombre, género y unidades de las filas anteriores", () => {
    const t = leerTarifa(libroRoly());
    expect(t.formato.id).toBe("roly");
    const alfa = t.entradas.filter((e) => e.referencia === "9001");
    expect(alfa).toHaveLength(5);
    expect(alfa[1]).toMatchObject({ modelo: "Alfa", genero: "Hombre", tallas: ["3XL"], colores: ["BLANCO"], precios: { caja: 1.3, pack: 1.365, unidad: 1.56 }, unidades: { caja: 50, pack: 5 } });
  });

  it("guarda las tres modalidades sin elegir ninguna y señala los precios con error", () => {
    const t = leerTarifa(libroRoly());
    const conError = t.entradas.find((e) => e.fila === 7);
    expect(conError.precios).toEqual({ caja: 1.2, pack: 1.26 });
    expect(conError.problemas).toEqual(["Precio «Unidad» con error en el archivo (#REF!)."]);
    expect(t.entradas.find((e) => e.fila === 9)).toMatchObject({ colores: ["NEGRO JASPEADO"], precios: { caja: 1.4, pack: 1.47 } }); // "-": not sold by unit
    expect(t.entradas.find((e) => e.fila === 8)).toMatchObject({ colores: ["BLANCO", "COLOR"], tallas: null, grupo: { tipo: "edad" } });
  });

  it("referencias con ceros, talla única, filas a consultar y la sección de precios por cantidad", () => {
    const t = leerTarifa(libroRoly());
    expect(t.entradas.find((e) => e.referencia === "0902")).toMatchObject({ tallas: ["TU"], unidades: { caja: 100, pack: 10 } });
    expect(t.entradas.find((e) => e.referencia === "9003").problemas.join(" ")).toMatch(/consultar/);
    expect(t.descartadas.map((d) => d.motivo)).toEqual(["Nota de tarifa confidencial (no es un artículo).", "Precio por cantidad a consultar con el proveedor."]);
  });
});

describe("formato SOL'S", () => {
  it("se detecta en cualquier hoja y hereda marca, género, referencia, nombre, color y talla", () => {
    const t = leerTarifa(libroSols());
    expect(t.formato.id).toBe("sols");
    expect(t.hoja).toBe("Tarifa");
    expect(t.entradas.slice(0, 3).map((e) => [e.modelo, e.colores, e.tallaTexto, e.precios.tarifa])).toEqual([
      ["ORION", ["BLANCO"], "XS a XXL", 2.1],
      ["ORION", ["COLOR"], "XS a XXL", 2.4],
      ["ORION", ["COLOR"], "3XL", 2.7],
    ]);
    expect(t.entradas.find((e) => e.modelo === "LYRA")).toMatchObject({ marca: "NEOBLU", tallas: ["TU"] });
    expect(t.entradas.find((e) => e.modelo === "SIRIO").problemas).toEqual(["Sin color."]);
  });

  it("un formato equivocado o desconocido se explica", () => {
    expect(() => leerTarifa(libroSols(), "roly")).toThrow(/formato de tarifa ROLY/);
    expect(() => leerTarifa(leerXlsx(crearXlsx([{ nombre: "x", filas: [["a", "b"]] }])))).toThrow(/No se reconoce/);
  });
});

// Current catalogue of the fictitious supplier (v_catalogo_admin rows)
const variante = (id, modelo_id, modelo, color, talla, precio_neto, extra = {}) => ({
  variante_id: id, modelo_id, modelo, referencia: null, tipo: "Camiseta", color, talla, precio_neto, iva_porcentaje: 21, precio_compra: null, coste_cent: 0, variante_activa: true, ...extra,
});
const CATALOGO_SOLS = [
  variante(1, 10, "ORION", "BLANCO", "M", 2.1),
  variante(2, 10, "ORION", "COLOR", "M", 2.3),
  variante(3, 10, "ORION", "COLOR", "XXXS", 2.3), // not in the price list
  variante(4, 11, "ORION KIDS", "COLOR", "04A", 1.9),
  variante(5, 12, "ORIÓN WOMAN", "BLANCO", "S", 2.1), // similar to ORION WOMEN
];
const OPCIONES = { modalidad: "tarifa", interpretacion: "neto", iva: 21 };
const comparar = (resoluciones) => {
  const t = leerTarifa(libroSols());
  return compararTarifa({ entradas: t.entradas, descartadas: t.descartadas, catalogo: CATALOGO_SOLS, opciones: OPCIONES, resoluciones });
};
const buscar = (items, modelo, color, talla) => items.find((i) => i.modelo === modelo && i.color === color && i.talla === talla);

describe("comparación con el catálogo", () => {
  it("clasifica cada variante: nueva, igual, diferente, ambigua, descatalogada y no válida", () => {
    const { items, resumen } = comparar();
    expect(buscar(items, "ORION", "BLANCO", "M")).toMatchObject({ estado: "igual", varianteId: 1 });
    expect(buscar(items, "ORION", "COLOR", "M")).toMatchObject({ estado: "diferente", varianteId: 2, importe: 2.4 });
    expect(buscar(items, "ORION", "COLOR", "M").costeActual).toBeCloseTo(2.783, 10);
    expect(buscar(items, "ORION", "BLANCO", "XS")).toMatchObject({ estado: "nueva", modeloId: 10 });
    expect(buscar(items, "ORION", "COLOR", "XXXS")).toMatchObject({ estado: "descatalogada", varianteId: 3 });
    // a size group is never one size: pending until the owner lists its sizes
    expect(items.filter((i) => i.modelo === "ORION KIDS")).toEqual([expect.objectContaining({ estado: "ambigua", conflicto: "grupo", talla: "2A a 12A", sugerencia: ["04A"] })]);
    expect(items.some((i) => i.varianteId === 4 && i.estado === "descatalogada")).toBe(false);
    expect(buscar(items, "LYRA", "COLOR", "TU")).toMatchObject({ estado: "nueva", modeloId: null, marca: "NEOBLU" });
    expect(items.find((i) => i.modelo === "SIRIO")).toMatchObject({ estado: "no_valida", motivo: "Sin color." });
    expect(resumen.porEstado.igual).toBe(1);
    expect(resumen.modelosNuevos).toBe(1); // LYRA (ORION WOMEN is pending: similar name)
  });

  it("no duplica un modelo por una pequeña diferencia de nombre: pregunta, y se resuelve", () => {
    const sin = comparar();
    const dudosa = buscar(sin.items, "ORION WOMEN", "BLANCO", "S");
    expect(dudosa).toMatchObject({ estado: "ambigua", conflicto: "modelo", candidato: { id: 12, nombre: "ORIÓN WOMAN" } });
    const mismo = comparar({ equivalencias: { "ORION WOMEN": 12 } });
    expect(buscar(mismo.items, "ORIÓN WOMAN", "BLANCO", "S")).toMatchObject({ estado: "igual", varianteId: 5 });
    expect(buscar(mismo.items, "ORIÓN WOMAN", "ABSOLUTE WHITE", "S")).toMatchObject({ estado: "nueva", modeloId: 12 });
    const otro = comparar({ equivalencias: { "ORION WOMEN": "nuevo" } });
    expect(buscar(otro.items, "ORION WOMEN", "BLANCO", "S")).toMatchObject({ estado: "nueva", modeloId: null });
  });

  it("la misma talla y color con dos precios: el propietario elige la fila", () => {
    const sin = comparar({ equivalencias: { "ORION WOMEN": "nuevo" } });
    const doble = buscar(sin.items, "ORION WOMEN", "COLOR", "3XL");
    expect(doble).toMatchObject({ estado: "ambigua", conflicto: "precios", opcionesFila: [{ fila: 7, importe: 2.5 }, { fila: 8, importe: 2.6 }] });
    const con = comparar({ equivalencias: { "ORION WOMEN": "nuevo" }, filaElegida: { [doble.id]: 8 } });
    expect(buscar(con.items, "ORION WOMEN", "COLOR", "3XL")).toMatchObject({ estado: "nueva", importe: 2.6 });
  });

  it("la modalidad elegida decide el precio; sin precio en esa modalidad no es válida", () => {
    const t = leerTarifa(libroRoly());
    const catalogo = [variante(1, 10, "ALFA", "BLANCO", "M", 1.32)];
    const caja = compararTarifa({ entradas: t.entradas, catalogo, opciones: { modalidad: "caja", interpretacion: "neto", iva: 21 } });
    const unidad = compararTarifa({ entradas: t.entradas, catalogo, opciones: { modalidad: "unidad", interpretacion: "neto", iva: 21 } });
    expect(buscar(caja.items, "ALFA", "BLANCO", "M")).toMatchObject({ estado: "diferente", importe: 1.1 });
    expect(buscar(unidad.items, "ALFA", "BLANCO", "M")).toMatchObject({ estado: "igual", importe: 1.32 });
    expect(buscar(unidad.items, "ALFA", "NEGRO JASPEADO", "M")).toMatchObject({ estado: "no_valida" });
    expect(buscar(caja.items, "ALFA", "BLANCO", "M").tarifas).toEqual([
      { modalidad: "caja", precio: 1.1, unidades: 50 }, { modalidad: "pack", precio: 1.155, unidades: 5 }, { modalidad: "unidad", precio: 1.32, unidades: null },
    ]);
  });

  it("precio neto o con IVA incluido", () => {
    expect(precioSegun(2.5, { interpretacion: "neto", iva: 21 })).toEqual({ precio_neto: 2.5, iva_porcentaje: 21, precio_compra: null });
    expect(precioSegun(2.5, { interpretacion: "iva_incluido", iva: 21 })).toEqual({ precio_neto: null, iva_porcentaje: 21, precio_compra: 2.5 });
  });
});

describe("operaciones a partir de las decisiones", () => {
  it("sin decisiones no se cambia ningún precio (solo se guardan las modalidades si se pide)", () => {
    const { items } = comparar();
    expect(construirOperaciones(items, {}, { guardarModalidades: false, completarModelos: false }).operaciones).toEqual([]);
    const { operaciones } = construirOperaciones(items, {});
    expect(operaciones.filter((o) => o.accion !== "completar_modelo").map((o) => [o.accion, o.variante_id])).toEqual([["tarifas", 1]]);
    // existing models only get their EMPTY reference / brand filled
    expect(operaciones.filter((o) => o.accion === "completar_modelo")).toEqual([
      { accion: "completar_modelo", modelo_id: 10, referencia: "5001", marca: "SOL'S" },
      { accion: "completar_modelo", modelo_id: 11, referencia: "5003", marca: "SOL'S" },
    ]);
  });

  it("añadir, actualizar y archivar solo lo decidido; un modelo nuevo necesita tipo", () => {
    const { items } = comparar();
    const nueva = buscar(items, "LYRA", "COLOR", "TU");
    const cambio = buscar(items, "ORION", "COLOR", "M");
    const baja = buscar(items, "ORION", "COLOR", "XXXS");
    const decisiones = { [nueva.id]: "anadir", [cambio.id]: "actualizar", [baja.id]: "archivar" };
    expect(construirOperaciones(items, decisiones).errores).toEqual(["Indica el tipo de artículo del modelo nuevo «LYRA»."]);
    const { operaciones, errores } = construirOperaciones(items, decisiones, { tipos: { LYRA: "Bolsa" }, guardarModalidades: false, completarModelos: false });
    expect(errores).toEqual([]);
    expect(operaciones).toHaveLength(3);
    expect(operaciones).toEqual(expect.arrayContaining([
      { accion: "precio", variante_id: 2, precio: { precio_neto: 2.4, iva_porcentaje: 21, precio_compra: null }, modalidad: "tarifa", tarifas: [{ modalidad: "tarifa", precio: 2.4, unidades: null }] },
      { accion: "archivar", variante_id: 3 },
      { accion: "alta", modelo: { nombre: "LYRA", referencia: "5004", tipo: "Bolsa", marca: "NEOBLU" }, color: "COLOR", talla: "TU", precio: { precio_neto: 9.5, iva_porcentaje: 21, precio_compra: null }, modalidad: "tarifa", tarifas: [{ modalidad: "tarifa", precio: 9.5, unidades: null }] },
    ]));
    expect(resultadoPrevisto(operaciones, items)).toMatchObject({ altas: 1, modelosNuevos: 1, precios: 1, subidas: 1, archivadas: 1 });
  });

  it("no permite decisiones que el estado no admite (p. ej. actualizar una ambigua de tallas agrupadas)", () => {
    const { items } = comparar();
    const igual = buscar(items, "ORION", "BLANCO", "M");
    expect(decisionesPosibles(igual)).toEqual(["ignorar"]);
    expect(construirOperaciones(items, { [igual.id]: "actualizar" }).errores[0]).toMatch(/no permitida/);
    expect(decisionesPosibles({ estado: "ambigua", conflicto: "grupo" })).toEqual(["ignorar"]);
    expect(decisionesPosibles({ estado: "ambigua", conflicto: "modelo", base: "nueva" })).toEqual(["ignorar", "anadir"]);
  });
});

describe("verificación después de importar", () => {
  it("cada alta, cambio de precio y archivo debe verse en el catálogo nuevo", () => {
    const antes = comparar();
    const nueva = buscar(antes.items, "ORION", "BLANCO", "XS");
    const cambio = buscar(antes.items, "ORION", "COLOR", "M");
    const baja = buscar(antes.items, "ORION", "COLOR", "XXXS");
    const { operaciones } = construirOperaciones(antes.items, { [nueva.id]: "anadir", [cambio.id]: "actualizar", [baja.id]: "archivar" }, { guardarModalidades: false });
    // catalogue as the database would return it after the import
    const despues = CATALOGO_SOLS.map((v) => (v.variante_id === 2 ? { ...v, precio_neto: 2.4 } : v.variante_id === 3 ? { ...v, variante_activa: false } : v));
    despues.push(variante(9, 10, "ORION", "BLANCO", "XS", 2.1));
    const t = leerTarifa(libroSols());
    const items = compararTarifa({ entradas: t.entradas, catalogo: despues, opciones: OPCIONES }).items;
    expect(verificarImportacion(operaciones, items, despues)).toEqual({ comprobadas: 3, fallos: [] });
    expect(verificarImportacion(operaciones, items, CATALOGO_SOLS).fallos).toEqual(["Archivo de la variante 3"]);
  });
});

describe("tallas agrupadas: siempre variantes individuales", () => {
  it("la lista de tallas del propietario admite tallas sueltas y rechaza grupos", () => {
    expect(interpretarListaTallas("2A, 4a; 6A\n8A, 4A")).toEqual({ tallas: ["02A", "04A", "06A", "08A"], errores: [] });
    expect(interpretarListaTallas("38, 40, 42").tallas).toEqual(["38", "40", "42"]);
    expect(interpretarListaTallas("Kids, 2A a 12A").errores).toEqual([
      "«Kids» es un grupo de tallas: escribe cada talla por separado.",
      "«2A a 12A» es un grupo de tallas: escribe cada talla por separado.",
    ]);
  });

  it("un grupo resuelto se desglosa en una variante por talla, con el precio de su fila", () => {
    const tallas = ["02A", "04A", "06A", "08A", "10A", "12A"];
    const { items } = comparar({ tallasGrupo: { [claveGrupo("*", "2A a 12A")]: tallas } });
    const kids = items.filter((i) => i.modelo === "ORION KIDS");
    expect(kids.map((i) => [i.talla, i.estado, i.importe])).toEqual(tallas.map((t) => [t, t === "04A" ? "igual" : "nueva", 1.9]));
    expect(kids[0]).toMatchObject({ desdeGrupo: "2A a 12A", filas: [9] });
  });

  it("la resolución de un modelo concreto manda sobre la general", () => {
    const { items } = comparar({ tallasGrupo: { [claveGrupo("*", "2A a 12A")]: ["02A", "04A"], [claveGrupo("ORION KIDS", "2A a 12A")]: ["04A", "06A"] } });
    expect(items.filter((i) => i.modelo === "ORION KIDS").map((i) => i.talla)).toEqual(["04A", "06A"]);
  });

  it("lista los grupos pendientes con sus modelos y la sugerencia del catálogo", () => {
    expect(gruposPendientes(comparar().items)).toEqual([
      { texto: "2A a 12A", clave: "*|2A A 12A", filas: 1, modelos: [{ modeloClave: "ORION KIDS", modelo: "ORION KIDS", clave: "ORION KIDS|2A A 12A", colores: ["COLOR"], sugerencia: ["04A"] }] },
    ]);
  });

  it("nunca se da de alta un grupo como si fuera una talla", () => {
    const falsa = { id: "x", estado: "nueva", modelo: "ORION", modeloClave: "ORION", color: "COLOR", talla: "38-52", tipo: "Camiseta", nuevo: {}, tarifas: [] };
    expect(construirOperaciones([falsa], { x: "anadir" }).errores).toEqual(["ORION COLOR: «38-52» no es una talla individual."]);
  });
});

describe("propuesta confirmada por el propietario", () => {
  it("ROLY: Unidad, neto y 21 %; SOL'S: su única tarifa, neto y 21 % (solo para estos formatos)", () => {
    expect(leerTarifa(libroRoly()).formato.propuesta).toMatchObject({ modalidad: "unidad", interpretacion: "neto", iva: 21 });
    expect(leerTarifa(libroSols()).formato.propuesta).toMatchObject({ modalidad: "tarifa", interpretacion: "neto", iva: 21 });
  });

  it("coste de adquisición = neto × 1,21, sin redondeos prematuros ni doble IVA", () => {
    const t = leerTarifa(libroRoly());
    const { items } = compararTarifa({ entradas: t.entradas, catalogo: [], opciones: { modalidad: "pack", interpretacion: "neto", iva: 21 } });
    const i = buscar(items, "ALFA", "BLANCO", "M");
    expect(i.nuevo).toEqual({ precio_neto: 1.155, iva_porcentaje: 21, precio_compra: null });
    expect(i.costeNuevo).toBeCloseTo(1.39755, 12);
  });
});

describe("modalidad alternativa (decisión del propietario)", () => {
  const roly = (alternativa) => {
    const t = leerTarifa(libroRoly());
    return compararTarifa({ entradas: t.entradas, catalogo: [], opciones: { modalidad: "unidad", interpretacion: "neto", iva: 21, alternativa } }).items;
  };

  it("sin alternativa, lo que no tiene precio Unidad no se importa", () => {
    expect(buscar(roly(undefined), "BETA BOLSA", "COLOR", "TU")).toMatchObject({ estado: "nueva", modalidadUsada: "unidad" });
    expect(buscar(roly(undefined), "ALFA", "NEGRO JASPEADO", "M")).toMatchObject({ estado: "no_valida" });
  });

  it("Pack solo si el pack es de UNA unidad; los errores del archivo siguen excluidos", () => {
    // fixture: ALFA packs of 5 -> no alternative; a pack of one unit would be used
    expect(buscar(roly({ modalidad: "pack", soloUnidad: true }), "ALFA", "NEGRO JASPEADO", "M")).toMatchObject({ estado: "no_valida" });
    expect(buscar(roly({ modalidad: "pack", soloUnidad: false }), "ALFA", "NEGRO JASPEADO", "M")).toMatchObject({ estado: "nueva", modalidadUsada: "pack", importe: 1.47 });
    expect(buscar(roly({ modalidad: "pack", soloUnidad: false }), "ALFA", "COLOR", "M")).toMatchObject({ modalidadUsada: "pack", importe: 1.26 }); // #REF! in Unidad
    expect(buscar(roly({ modalidad: "pack", soloUnidad: true }), "EPSILON", "COLOR", "M")).toMatchObject({ estado: "nueva", modalidadUsada: "pack", importe: 5.25 });
    expect(buscar(roly(undefined), "EPSILON", "COLOR", "M")).toMatchObject({ estado: "no_valida" });
  });
});
