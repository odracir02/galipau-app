// Unit tests with FICTITIOUS parameters (PARAMETROS_EJEMPLO). Expected values
// were worked out by hand from the model formulas.
import { describe, it, expect } from "vitest";
import { calcularCosteSerigrafia, validarEntrada, aCentimos, redondearArribaCent, ErrorCalculo, VERSION_MOTOR } from "./motor";
import { PARAMETROS_EJEMPLO, validarParametros, costePorBase } from "./parametros";

const P = PARAMETROS_EJEMPLO;
const base = (extra = {}) => ({
  lineas: [{ cantidad: 10, precioUnitario: 3 }],
  zonas: [{ nombre: "Delantera", colores: 1 }, { nombre: "Trasera", colores: 1 }],
  minutosDiseno: 30,
  precioFinal: 150,
  ...extra,
});
const grupo = (r, clave) => r.costes.grupos.find((g) => g.clave === clave);
const concepto = (r, g, c) => grupo(r, g).conceptos.find((x) => x.clave === c);

describe("modelo de coste (caso base calculado a mano)", () => {
  const r = calcularCosteSerigrafia(base(), P);

  it("unidades, pantallas y merma por defecto", () => {
    expect(r).toMatchObject({ unidades: 10, pantallas: 2, merma: 0.05 });
    expect(r.unidadesConMerma).toBeCloseTo(10.5, 10);
  });

  it("prendas con merma: 10 × 3 € × 1,05", () => {
    expect(grupo(r, "prendas").importe).toBeCloseTo(31.5, 10);
  });

  it("consumibles por pantalla, por prenda y por prenda y color", () => {
    expect(concepto(r, "consumibles", "fotolitos").importe).toBeCloseTo(2, 10); // 2 × 100/(100×1)
    expect(concepto(r, "consumibles", "emulsion").importe).toBeCloseTo(2, 10); // 2 × 40/(1×40)
    expect(concepto(r, "consumibles", "plastisol").importe).toBeCloseTo(4, 10); // 20 × 20/(1×100)
    expect(concepto(r, "consumibles", "cinta").importe).toBeCloseTo(0.8, 10); // 2 × 10/50×2
    expect(concepto(r, "consumibles", "adhesivo").importe).toBeCloseTo(0.1, 10); // 10 × 10/(1×1000)
    expect(grupo(r, "consumibles").importe).toBeCloseTo(8.9, 10);
  });

  it("electricidad de flash, plancha y horno", () => {
    expect(concepto(r, "electricidad", "flash").importe).toBeCloseTo(0.2 * 1 * (6 / 60 + 20 * 30 / 3600), 10);
    expect(concepto(r, "electricidad", "plancha").importe).toBeCloseTo(0.2 * 1 * (6 / 60 + 10 * 30 / 3600), 10);
    expect(concepto(r, "electricidad", "horno").importe).toBeCloseTo(0.2 * 3 * (10 / 60) * 1, 10);
    expect(grupo(r, "electricidad").importe).toBeCloseTo(0.19, 10);
  });

  it("reserva y mano de obra (diseño, pantallas, prendas)", () => {
    expect(grupo(r, "reserva").importe).toBeCloseTo(1, 10);
    expect(concepto(r, "manoObra", "diseno").importe).toBeCloseTo(9, 10); // 30 min a 18 €/h
    expect(concepto(r, "manoObra", "pantallas").importe).toBeCloseTo(8.4, 10); // 2 × (6+2+2+4) min
    expect(concepto(r, "manoObra", "prendas").importe).toBeCloseTo(6, 10); // (300+600+300) s a 18 €/h
    expect(grupo(r, "manoObra").importe).toBeCloseTo(23.4, 10);
  });

  it("coste total, recomendado, beneficio y margen", () => {
    expect(r.costes.total).toBeCloseTo(64.99, 10);
    expect(r.costes.totalCent).toBe(6499);
    expect(r.costes.porUnidadCent).toBe(650);
    expect(r.precio.recomendadoSinRedondearCent).toBe(8665); // 64,99 / 0,75
    expect(r.precio.recomendadoPorUnidadSinRedondearCent).toBe(867);
    expect(r.precio.recomendadoPorUnidadCent).toBe(900); // 8,67 → 9,00 (múltiplo de 0,50 hacia arriba)
    expect(r.precio.recomendadoCent).toBe(9000); // 9,00 × 10
    expect(r.precio.beneficioRecomendado.cent).toBe(2501); // 90,00 − 64,99
    expect(r.precio.beneficioRecomendado.margen).toBeCloseTo(25.01 / 90, 10);
    expect(r.beneficio.cent).toBe(8501);
    expect(r.beneficio.margen).toBeCloseTo(85.01 / 150, 10);
  });

  it("no añade IVA a las ventas (decisión del propietario) ni declara exención", () => {
    expect(r.ingresos.iva.tratamiento).toBe("sinIvaAnadido");
    expect(r.ingresos.iva.mensaje).not.toMatch(/exent/i);
    expect(r.precio.finalCent).toBe(15000);
  });

  it("explica cada concepto", () => {
    expect(concepto(r, "consumibles", "plastisol").detalle).toBe("20 prenda y color × 0.2 €");
    expect(concepto(r, "manoObra", "pantallas").detalle).toBe("2 pantalla(s) × 14 min");
  });
});

describe("cantidades, colores, zonas y merma", () => {
  it("sin colores (solo prenda): no hay pantallas, tinta, flash ni horno", () => {
    const r = calcularCosteSerigrafia(base({ zonas: [{ colores: 0 }, { colores: 0 }] }), P);
    expect(r.pantallas).toBe(0);
    for (const c of ["fotolitos", "emulsion", "plastisol", "cinta"]) expect(concepto(r, "consumibles", c).importe).toBe(0);
    expect(concepto(r, "electricidad", "flash").importe).toBe(0);
    expect(concepto(r, "electricidad", "horno").importe).toBe(0);
    expect(concepto(r, "electricidad", "plancha").importe).toBeGreaterThan(0);
    expect(concepto(r, "manoObra", "pantallas").importe).toBe(0);
    expect(concepto(r, "manoObra", "prendas").importe).toBeCloseTo((10 * 30 / 3600 + 10 * 30 / 3600) * 18, 10);
  });

  it("varias zonas suman sus colores; el horno trabaja por tandas", () => {
    const r = calcularCosteSerigrafia(base({ zonas: [{ colores: 3 }, { colores: 2 }, { nombre: "Manga", colores: 1 }] }), P);
    expect(r.pantallas).toBe(6);
    expect(concepto(r, "electricidad", "horno").importe).toBeCloseTo(0.2 * 3 * (10 / 60) * 3, 10); // ⌈6/2⌉ = 3 tandas
  });

  it("varias líneas con precios distintos", () => {
    const r = calcularCosteSerigrafia(base({ lineas: [{ cantidad: 4, precioUnitario: 2 }, { cantidad: 6, precioUnitario: 5 }], merma: 0 }), P);
    expect(r.unidades).toBe(10);
    expect(grupo(r, "prendas").importe).toBeCloseTo(38, 10);
  });

  it("merma explícita (incluido 0) sustituye a la de los parámetros", () => {
    expect(calcularCosteSerigrafia(base({ merma: 0 }), P).merma).toBe(0);
    expect(grupo(calcularCosteSerigrafia(base({ merma: 0.1 }), P), "prendas").importe).toBeCloseTo(33, 10);
    expect(calcularCosteSerigrafia(base({ merma: undefined }), P).merma).toBe(0.05);
  });

  it("la merma solo afecta a las prendas (regla del Excel V2_24)", () => {
    const sin = calcularCosteSerigrafia(base({ merma: 0 }), P);
    const con = calcularCosteSerigrafia(base({ merma: 0.5 }), P);
    expect(con.costes.total - sin.costes.total).toBeCloseTo(30 * 0.5, 10);
  });

  it("una sola prenda y un solo color", () => {
    const r = calcularCosteSerigrafia(base({ lineas: [{ cantidad: 1, precioUnitario: 0 }], zonas: [{ colores: 1 }], minutosDiseno: 0, precioFinal: null }), P);
    expect(r.unidades).toBe(1);
    expect(r.pantallas).toBe(1);
    expect(r.costes.totalCent).toBeGreaterThan(0);
  });
});

describe("precio final, beneficio y redondeos", () => {
  it("sin precio final no hay beneficio ni margen", () => {
    const r = calcularCosteSerigrafia(base({ precioFinal: null }), P);
    expect(r.beneficio).toBeNull();
    expect(r.precio.final).toBeNull();
    expect(r.precio.recomendadoCent).toBe(9000);
  });

  it("precio final 0: pérdida igual al coste y margen 0 (sin dividir por cero)", () => {
    const r = calcularCosteSerigrafia(base({ precioFinal: 0 }), P);
    expect(r.beneficio.cent).toBe(-6499);
    expect(r.beneficio.margen).toBe(0);
  });

  it("precio por debajo del coste: beneficio y margen negativos", () => {
    const r = calcularCosteSerigrafia(base({ precioFinal: 50 }), P);
    expect(r.beneficio.cent).toBe(-1499);
    expect(r.beneficio.margen).toBeLessThan(0);
  });

  it("los céntimos se redondean al final (no por concepto)", () => {
    expect(aCentimos(12.344)).toBe(1234);
    expect(aCentimos(12.345)).toBe(1235);
    expect(aCentimos(-0.004)).toBe(-0);
    // exact half cents hidden by binary noise still round half up (like the spreadsheet)
    expect(1.005 * 100).toBeLessThan(100.5); // 100.49999999999999
    expect(aCentimos(1.005)).toBe(101);
    expect(aCentimos(0.1 + 0.2)).toBe(30);
    expect(aCentimos(3.9204 * 25)).toBe(9801);
    expect(aCentimos(2.57125 * 2)).toBe(514); // 5.1425 -> 514.25 -> 514
    const r = calcularCosteSerigrafia(base(), P);
    expect(r.costes.totalCent).toBe(Math.round(r.costes.total * 100));
  });

  it("no modifica la entrada ni los parámetros", () => {
    const entrada = base();
    const copia = JSON.parse(JSON.stringify(entrada));
    calcularCosteSerigrafia(entrada, P);
    expect(entrada).toEqual(copia);
  });
});

describe("redondeo del precio recomendado (regla comercial)", () => {
  it.each([
    [300, 300], [301, 350], [315, 350], [350, 350], [360, 400], [399, 400], [401, 450], [0, 0], [1, 50],
  ])("%i céntimos → %i", (cent, esperado) => {
    expect(redondearArribaCent(cent, 50)).toBe(esperado);
  });

  it("sin errores de coma flotante: un unitario de 3,00 € calculado con decimales sigue en 3,00 €", () => {
    expect((0.1 + 0.2) * 10).not.toBe(3); // 3.0000000000000004
    expect(redondearArribaCent(aCentimos((0.1 + 0.2) * 10), 50)).toBe(300);
    expect(Math.ceil((0.1 + 0.2) * 10 * 2) / 2).toBe(3.5); // the naive float formula would fail here
  });

  it("paso 0 o ausente: no redondea", () => {
    expect(redondearArribaCent(867, 0)).toBe(867);
    const antiguos = { ...P };
    delete antiguos.redondeoPrecioUnidad; // parameter versions saved before the rule existed
    const r = calcularCosteSerigrafia(base(), antiguos);
    expect(r.precio.recomendadoCent).toBe(8665);
    expect(r.precio.recomendadoPorUnidadCent).toBe(867);
    expect(r.precio.redondeoPorUnidadCent).toBe(0);
    expect(calcularCosteSerigrafia(base(), { ...P, redondeoPrecioUnidad: 0 }).precio.recomendadoCent).toBe(8665);
  });

  it("el paso es configurable", () => {
    expect(calcularCosteSerigrafia(base(), { ...P, redondeoPrecioUnidad: 0.05 }).precio.recomendadoCent).toBe(8700); // 8,67 → 8,70
    expect(calcularCosteSerigrafia(base(), { ...P, redondeoPrecioUnidad: 1 }).precio.recomendadoCent).toBe(9000);
  });

  it("el total redondeado es siempre unidades × unitario redondeado", () => {
    for (const cantidad of [1, 3, 7, 25, 100]) {
      const r = calcularCosteSerigrafia(base({ lineas: [{ cantidad, precioUnitario: 2.37 }] }), P);
      expect(r.precio.recomendadoPorUnidadCent % 50).toBe(0);
      expect(r.precio.recomendadoPorUnidadCent).toBeGreaterThanOrEqual(r.precio.recomendadoPorUnidadSinRedondearCent);
      expect(r.precio.recomendadoPorUnidadCent - r.precio.recomendadoPorUnidadSinRedondearCent).toBeLessThan(50);
      expect(r.precio.recomendadoCent).toBe(r.precio.recomendadoPorUnidadCent * cantidad);
    }
  });

  it("no cambia el coste ni el precio final introducido a mano", () => {
    const antiguos = { ...P };
    delete antiguos.redondeoPrecioUnidad;
    const con = calcularCosteSerigrafia(base({ precioFinal: 123.45 }), P);
    const sin = calcularCosteSerigrafia(base({ precioFinal: 123.45 }), antiguos);
    expect(con.costes).toEqual(sin.costes);
    expect(con.precio.finalCent).toBe(12345);
    expect(con.beneficio).toEqual(sin.beneficio);
  });

  it("el resultado indica la versión del motor", () => {
    expect(calcularCosteSerigrafia(base(), P).motor).toBe(VERSION_MOTOR);
  });
});

describe("validación", () => {
  it.each([
    [{ lineas: [] }, /al menos una línea/],
    [{ lineas: [{ cantidad: 0, precioUnitario: 1 }] }, /cantidad/],
    [{ lineas: [{ cantidad: 1.5, precioUnitario: 1 }] }, /cantidad/],
    [{ lineas: [{ cantidad: 1, precioUnitario: -1 }] }, /precio/],
    [{ zonas: [{ colores: -1 }] }, /colores/],
    [{ zonas: [{ colores: 1.5 }] }, /colores/],
    [{ merma: 1.5 }, /merma/],
    [{ minutosDiseno: -5 }, /diseño/],
    [{ precioFinal: -1 }, /precio final/],
  ])("rechaza %j", (cambio, mensaje) => {
    expect(validarEntrada(base(cambio)).join(" ")).toMatch(mensaje);
    expect(() => calcularCosteSerigrafia(base(cambio), P)).toThrow(ErrorCalculo);
  });

  it("valida los parámetros", () => {
    expect(validarParametros(P)).toEqual([]);
    expect(validarParametros({ ...P, manoObraEurHora: -1 }).join(" ")).toMatch(/Mano de obra/);
    expect(validarParametros({ ...P, margenRecomendado: 1 }).join(" ")).toMatch(/Margen/);
    expect(validarParametros({ ...P, hornoCapacidadPantallas: 2.5 }).join(" ")).toMatch(/entero/);
    expect(validarParametros({ ...P, redondeoPrecioUnidad: 0.555 }).join(" ")).toMatch(/dos decimales/);
    expect(validarParametros({ ...P, redondeoPrecioUnidad: -0.5 }).join(" ")).toMatch(/Redondeo/);
    expect(validarParametros({ ...P, redondeoPrecioUnidad: null })).toEqual([]);
    const sinCampo = { ...P };
    delete sinCampo.curadoSegPrenda;
    expect(validarParametros(sinCampo).join(" ")).toMatch(/Curado/);
    const dobles = { ...P, consumibles: [{ ...P.consumibles[0], consumo: 1 }] };
    expect(validarParametros(dobles).join(" ")).toMatch(/uno de los dos/);
    const repetido = { ...P, consumibles: [P.consumibles[0], P.consumibles[0]] };
    expect(validarParametros(repetido).join(" ")).toMatch(/duplicada/);
    expect(() => calcularCosteSerigrafia(base(), { ...P, electricidadEurKwh: "0.2" })).toThrow(/Parámetros no válidos/);
  });

  it("coste por base de un consumible: por rendimiento o por consumo", () => {
    expect(costePorBase({ precio: 30, contenido: 1, rendimiento: 15 })).toBe(2);
    expect(costePorBase({ precio: 10, contenido: 50, consumo: 2 })).toBeCloseTo(0.4, 12);
  });
});
