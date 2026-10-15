// Characterisation tests: they lock in the CURRENT behaviour of the legacy
// engine so the refactoring cannot change results. They do not assert that the
// formulas are commercially correct.
import { describe, it, expect } from "vitest";
import { calcularPresupuestoLegacy, porcentajeDescuento } from "./calculoLegacy";
import { PARAMETROS_LEGACY } from "./parametrosLegacy";
import { calcularPresupuesto } from "./index";

// Verbatim copy of QuoteForm.handleCalcularPresupuesto at commit b57b716,
// with React state replaced by arguments and return value.
function calculoOriginal(bloques, productos, clientName) {
  const costePorCm2 = (9 / 5500) * 1.21;
  const precioBastidor = 25;
  const precioManoObra = 1.5;
  const todasLasLineas = bloques.flatMap((bloque) =>
    bloque.lineas.map((linea) => ({
      ...linea,
      estampado: bloque.estampado,
      area: bloque.area,
      zonas: bloque.zonas || 1,
      numColores: bloque.numColores,
    }))
  );
  let totalPrendas = 0;
  let subtotalSinDescuento = 0;
  let beneficioTotal = 0;
  const lineasConPrecio = todasLasLineas.map((linea) => {
    const unidades = parseInt(linea.quantity);
    const zonas = parseInt(linea.zonas) || 1;
    totalPrendas += unidades;
    const producto = productos.find(
      (p) =>
        p.tipo === linea.tipo &&
        p.proveedor === linea.proveedor &&
        p.modelo === linea.modelo &&
        p.talla === linea.size &&
        ((linea.color.toLowerCase() === "blanco" && p.color.toLowerCase().includes("blanco")) ||
          (linea.color.toLowerCase() === "color" && !p.color.toLowerCase().includes("blanco")))
    );
    const costePrenda = producto ? parseFloat(producto.coste || 0) : 0;
    let precioUnitario = 0;
    let subtotal = 0;
    let beneficioLinea = 0;
    if (linea.estampado === "DTF") {
      const costeFilm = (linea.area || 0) * costePorCm2;
      const costeClienteFilm = costeFilm * 2;
      const filmPorUnidad = costeClienteFilm / unidades;
      const manoObraUnidad = zonas * precioManoObra;
      const beneficioFilmTotal = costeClienteFilm - costeFilm;
      const beneficioManoObra = unidades * zonas * precioManoObra;
      precioUnitario = costePrenda + filmPorUnidad + manoObraUnidad;
      const beneficioPrenda = precioUnitario - filmPorUnidad - manoObraUnidad - costePrenda;
      beneficioLinea = beneficioPrenda * unidades + beneficioFilmTotal + beneficioManoObra;
    }
    if (linea.estampado === "Serigrafía") {
      const costeBastidorTotal = zonas * precioBastidor;
      const costeManoObraTotal = zonas * unidades * precioManoObra;
      const totalBloque = costeBastidorTotal + costeManoObraTotal;
      const extraPorUnidad = totalBloque / unidades;
      precioUnitario = costePrenda + extraPorUnidad;
      const beneficioPrenda = precioUnitario - extraPorUnidad - costePrenda;
      const beneficioManoObra = unidades * zonas * precioManoObra;
      const beneficioBastidor = zonas * precioBastidor;
      beneficioLinea = beneficioPrenda * unidades + beneficioManoObra + beneficioBastidor;
    }
    subtotal = precioUnitario * unidades;
    subtotalSinDescuento += subtotal;
    beneficioTotal += beneficioLinea;
    return { ...linea, precioUnitario, subtotal, beneficioLinea };
  });
  let descuentoPorcentaje = 0;
  if (totalPrendas >= 50) descuentoPorcentaje = 15;
  else if (totalPrendas >= 20) descuentoPorcentaje = 10;
  else if (totalPrendas >= 10) descuentoPorcentaje = 5;
  const descuento = (subtotalSinDescuento * descuentoPorcentaje) / 100;
  const total = subtotalSinDescuento - descuento;
  return {
    clientName,
    totalPrendas,
    lineas: lineasConPrecio,
    subtotalSinDescuento,
    descuentoPorcentaje,
    descuento,
    total,
    beneficioTotal,
  };
}

// Catalogue without white garments: here the original and the new colour
// lookup must select exactly the same product.
const catalogoColor = [
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "S", color: "Negro", coste: "2.35" },
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "M", color: "Negro", coste: "2.35" },
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "M", color: "Rojo", coste: "2.60" },
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "XL", color: "Azul", coste: 2.9 },
  { tipo: "Sudadera", proveedor: "Prov B", modelo: "Hood", talla: "L", color: "Gris", coste: "11.4" },
  { tipo: "Polo", proveedor: "Prov B", modelo: "Pique", talla: "M", color: "Verde" },
];

const linea = (tipo, proveedor, modelo, size, quantity) => ({
  tipo, proveedor, modelo, size, color: "Color", quantity,
});
const LINEAS = [
  linea("Camiseta", "Prov A", "Basic", "S", "1"),
  linea("Camiseta", "Prov A", "Basic", "M", "7"),
  linea("Camiseta", "Prov A", "Basic", "XL", "13"),
  linea("Sudadera", "Prov B", "Hood", "L", "25"),
  linea("Polo", "Prov B", "Pique", "M", "60"),
];

const conIds = (bloques) =>
  bloques.map((b, i) => ({ ...b, id: `b${i}`, lineas: b.lineas.map((l, j) => ({ ...l, id: `b${i}l${j}` })) }));

describe("calcularPresupuestoLegacy — equivalencia con la implementación original", () => {
  const casos = [];
  for (const estampado of ["DTF", "Serigrafía"]) {
    for (const zonas of [1, 2, 3]) {
      for (const area of [1, 85.5, 300, 1200]) {
        for (let n = 1; n <= LINEAS.length; n++) {
          casos.push({ estampado, zonas, area, lineas: LINEAS.slice(0, n) });
        }
      }
    }
  }

  it.each(casos.map((c, i) => [i, c]))("caso %i produce resultados idénticos", (_, caso) => {
    const bloques = [{ estampado: caso.estampado, zonas: caso.zonas, area: caso.area, numColores: 2, lineas: caso.lineas }];
    const esperado = calculoOriginal(bloques, catalogoColor, "Cliente");
    const { resultado } = calcularPresupuestoLegacy({
      clientName: "Cliente",
      bloques: conIds(bloques),
      productos: catalogoColor,
    });
    expect(resultado).toEqual(esperado);
  });

  it("produce resultados idénticos con varios bloques de técnicas mezcladas", () => {
    const bloques = [
      { estampado: "DTF", zonas: 2, area: 250, numColores: null, lineas: LINEAS.slice(0, 3) },
      { estampado: "Serigrafía", zonas: 1, area: null, numColores: 3, lineas: LINEAS.slice(3) },
      { estampado: "DTF", zonas: 1, area: 40, numColores: null, lineas: [LINEAS[1]] },
    ];
    const esperado = calculoOriginal(bloques, catalogoColor, "Mixto");
    const { resultado } = calcularPresupuestoLegacy({ clientName: "Mixto", bloques: conIds(bloques), productos: catalogoColor });
    expect(resultado).toEqual(esperado);
  });

  it("acepta área y n.º de colores como texto (valor de los inputs) con el mismo resultado", () => {
    const original = calculoOriginal(
      [{ estampado: "DTF", zonas: 1, area: 300, numColores: null, lineas: [LINEAS[1]] }],
      catalogoColor,
      "C"
    );
    const { resultado } = calcularPresupuestoLegacy({
      clientName: "C",
      bloques: conIds([{ estampado: "DTF", zonas: 1, area: "300", numColores: "", lineas: [LINEAS[1]] }]),
      productos: catalogoColor,
    });
    expect(resultado).toEqual(original);
  });

  it("no incluye identificadores internos en las líneas del resultado", () => {
    const { resultado } = calcularPresupuestoLegacy({
      clientName: "C",
      bloques: conIds([{ estampado: "DTF", zonas: 1, area: 300, lineas: [LINEAS[0]] }]),
      productos: catalogoColor,
    });
    expect(resultado.lineas[0]).not.toHaveProperty("id");
    expect(Object.keys(resultado.lineas[0]).some((k) => k.startsWith("_"))).toBe(false);
  });
});

describe("calcularPresupuestoLegacy — valores de referencia actuales", () => {
  // Reference values of the current formulas (NOT validated by the business).
  it("DTF, 10 camisetas de 2,35 €, 300 cm², 1 zona", () => {
    const { resultado } = calcularPresupuesto({
      clientName: "C",
      bloques: conIds([{ estampado: "DTF", zonas: 1, area: "300", lineas: [{ ...LINEAS[1], quantity: "10" }] }]),
      productos: catalogoColor,
    });
    expect(resultado.lineas[0].precioUnitario).toBeCloseTo(3.9688, 4);
    expect(resultado.subtotalSinDescuento).toBeCloseTo(39.688, 3);
    expect(resultado.descuentoPorcentaje).toBe(5);
    expect(resultado.total).toBeCloseTo(37.7036, 4);
    expect(resultado.beneficioTotal).toBeCloseTo(15.594, 3);
  });

  it("Serigrafía, 30 camisetas en una línea vs repartidas en tres (comportamiento actual, ERR-03)", () => {
    const una = calcularPresupuesto({
      clientName: "C",
      bloques: conIds([{ estampado: "Serigrafía", zonas: 1, numColores: "2", lineas: [{ ...LINEAS[1], quantity: "30" }] }]),
      productos: catalogoColor,
    });
    const tres = calcularPresupuesto({
      clientName: "C",
      bloques: conIds([{
        estampado: "Serigrafía", zonas: 1, numColores: "2",
        lineas: ["S", "M", "XL"].map((size) => ({ ...LINEAS[0], size, quantity: "10" })),
      }]),
      productos: catalogoColor,
    });
    expect(una.resultado.total).toBeCloseTo(126.45, 3);
    expect(tres.resultado.total).toBeCloseTo(176.4, 3);
  });
});

describe("porcentajeDescuento", () => {
  it.each([
    [0, 0], [9, 0], [10, 5], [19, 5], [20, 10], [49, 10], [50, 15], [500, 15],
  ])("%i prendas → %i %%", (prendas, esperado) => {
    expect(porcentajeDescuento(prendas, PARAMETROS_LEGACY.tramosDescuento)).toBe(esperado);
  });
});

describe("avisos del cálculo", () => {
  it("avisa cuando varios colores del grupo tienen costes distintos", () => {
    const { avisos } = calcularPresupuesto({
      clientName: "C",
      bloques: conIds([{ estampado: "DTF", zonas: 1, area: "100", lineas: [LINEAS[1]] }]),
      productos: catalogoColor,
    });
    expect(avisos).toEqual([{ lineaId: "b0l0", bloque: 1, linea: 1, tipo: "costesDistintos" }]);
  });

  it("avisa si el producto no está en el catálogo", () => {
    const { avisos, resultado } = calcularPresupuesto({
      clientName: "C",
      bloques: conIds([{ estampado: "DTF", zonas: 1, area: "100", lineas: [{ ...LINEAS[0], modelo: "Inexistente" }] }]),
      productos: catalogoColor,
    });
    expect(avisos[0].tipo).toBe("productoNoEncontrado");
    expect(resultado.lineas[0].precioUnitario).toBeGreaterThan(0);
  });
});

describe("prendas blancas (corrección ERR-02)", () => {
  const catalogo = [
    { tipo: "Camiseta", proveedor: "P", modelo: "M1", talla: "M", color: "Blanca", coste: "2" },
    { tipo: "Camiseta", proveedor: "P", modelo: "M1", talla: "M", color: "Negro", coste: "3" },
  ];
  const bloque = (color) =>
    conIds([{ estampado: "Serigrafía", zonas: 1, numColores: "1", lineas: [{ tipo: "Camiseta", proveedor: "P", modelo: "M1", size: "M", color, quantity: "10" }] }]);

  it("la implementación original calculaba la prenda blanca a 0 €", () => {
    const original = calculoOriginal(
      [{ estampado: "Serigrafía", zonas: 1, lineas: [{ tipo: "Camiseta", proveedor: "P", modelo: "M1", size: "M", color: "Blanca", quantity: "10" }] }],
      catalogo,
      "C"
    );
    expect(original.lineas[0].precioUnitario).toBeCloseTo(4, 6); // 0 € garment + 4 € printing
  });

  it("ahora usa el coste de la prenda blanca", () => {
    const { resultado } = calcularPresupuesto({ clientName: "C", bloques: bloque("Blanca"), productos: catalogo });
    expect(resultado.lineas[0].precioUnitario).toBeCloseTo(6, 6); // 2 € garment + 4 € printing
  });

  it("'Color' ya no selecciona la prenda blanca", () => {
    const { resultado } = calcularPresupuesto({ clientName: "C", bloques: bloque("Color"), productos: catalogo });
    expect(resultado.lineas[0].precioUnitario).toBeCloseTo(7, 6); // 3 € garment + 4 € printing
  });
});
