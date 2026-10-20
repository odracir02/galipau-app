// Screen printing real-cost engine.
// Reproduces the verified cost model of the master spreadsheet (V2_24) with
// configurable, versioned parameters. Pure function: no React, no database.
//
// Model (per quote):
//   U = total garments, P = screens = Σ colours per printed zone
//   cost = garments × (1 + waste) + consumables + electricity + machinery reserve + labour
//   recommended price = cost / (1 − recommended margin), then (commercial rule,
//   optional per parameter version) the unit price is rounded UP to a multiple
//   of `redondeoPrecioUnidad` and multiplied back by the units
//   profit = final price − cost; margin = profit / final price
// Amounts are computed in euros (floating point, like the spreadsheet) and
// rounded to cents only in the totals; price rounding works on integer cents. Sales VAT is NOT added
// (owner decision: prices without VAT); the final price is used as entered.

import { costePorBase, validarParametros, BASES_CONSUMO } from "./parametros";

export const VERSION_MOTOR = "serigrafia-coste-real/2";

export class ErrorCalculo extends Error {
  constructor(errores) {
    super(errores.join(" "));
    this.errores = errores;
  }
}

// Rounds euros to integer cents, half up. The product is first reduced to 15
// significant digits (as the spreadsheet does), so binary floating-point noise
// cannot tip an exact half cent the wrong way: 98.01 * 100 = 9800.999999999998
// becomes 9801, and an exact x.xx5 always rounds up.
export const aCentimos = (euros) => Math.round(Number((euros * 100).toPrecision(15)));

// Rounds integer cents UP to the next multiple of `pasoCent` (0 = no rounding).
// Integer arithmetic avoids floating point errors (e.g. 3,00 € stays 3,00 €).
export const redondearArribaCent = (cent, pasoCent) => (pasoCent > 0 ? Math.ceil(cent / pasoCent) * pasoCent : cent);

const entero = (v) => Number.isInteger(v) && v >= 0;

export const validarEntrada = (e) => {
  const errores = [];
  if (!e || typeof e !== "object") return ["Faltan los datos del cálculo."];
  if (!Array.isArray(e.lineas) || e.lineas.length === 0) errores.push("Añade al menos una línea de prendas.");
  (e.lineas ?? []).forEach((l, i) => {
    if (!Number.isInteger(l?.cantidad) || l.cantidad <= 0) errores.push(`Línea ${i + 1}: la cantidad debe ser un entero mayor que 0.`);
    if (typeof l?.precioUnitario !== "number" || !Number.isFinite(l.precioUnitario) || l.precioUnitario < 0) {
      errores.push(`Línea ${i + 1}: el precio de la prenda debe ser un número no negativo.`);
    }
  });
  if (!Array.isArray(e.zonas)) errores.push("Faltan las zonas de impresión.");
  (e.zonas ?? []).forEach((z, i) => {
    if (!entero(z?.colores)) errores.push(`Zona ${z?.nombre || i + 1}: los colores deben ser un entero (0 o más).`);
  });
  if (e.minutosDiseno !== undefined && !(typeof e.minutosDiseno === "number" && e.minutosDiseno >= 0)) {
    errores.push("Los minutos de diseño deben ser un número no negativo.");
  }
  if (e.merma !== undefined && e.merma !== null && !(typeof e.merma === "number" && e.merma >= 0 && e.merma <= 1)) {
    errores.push("La merma debe estar entre 0 y 1 (por ejemplo 0,04 = 4 %).");
  }
  if (e.precioFinal !== undefined && e.precioFinal !== null && !(typeof e.precioFinal === "number" && Number.isFinite(e.precioFinal) && e.precioFinal >= 0)) {
    errores.push("El precio final debe ser un número no negativo.");
  }
  return errores;
};

const concepto = (clave, etiqueta, importe, detalle) => ({ clave, etiqueta, importe, cent: aCentimos(importe), detalle });

const fmt = (n, d = 4) => Number(n.toFixed(d)).toString();

/**
 * @param {{ lineas: {cantidad:number, precioUnitario:number, descripcion?:string}[],
 *           zonas: {nombre?:string, colores:number}[], minutosDiseno?: number,
 *           merma?: number, precioFinal?: number|null }} entrada
 * @param {object} p parameters (see parametros.js)
 */
export const calcularCosteSerigrafia = (entrada, p) => {
  const erroresParametros = validarParametros(p);
  if (erroresParametros.length) throw new ErrorCalculo(["Parámetros no válidos:", ...erroresParametros]);
  const errores = validarEntrada(entrada);
  if (errores.length) throw new ErrorCalculo(errores);

  const U = entrada.lineas.reduce((n, l) => n + l.cantidad, 0);
  const P = entrada.zonas.reduce((n, z) => n + Math.max(0, z.colores), 0);
  const merma = entrada.merma ?? p.mermaPorDefecto;
  const minutosDiseno = entrada.minutosDiseno ?? 0;
  const tarifa = p.manoObraEurHora;

  // Garments (+ waste)
  const prendasSinMerma = entrada.lineas.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  const prendas = prendasSinMerma * (1 + merma);

  // Consumables
  const cantidadBase = { pantalla: P, prenda: U, prendaColor: U * P };
  const consumibles = p.consumibles.map((c) => {
    const unitario = costePorBase(c);
    const n = cantidadBase[c.base];
    return concepto(c.clave, c.nombre, n * unitario, `${n} ${BASES_CONSUMO[c.base].replace("por ", "")} × ${fmt(unitario)} €`);
  });

  // Electricity (heating once per job + use time)
  const flash = P === 0 ? 0 : p.electricidadEurKwh * p.flashPotenciaKw * ((p.flashCalentamientoMin / 60) + (U * P * p.impresionSegColorPrenda / 3600));
  const plancha = U === 0 ? 0 : p.electricidadEurKwh * p.planchaPotenciaKw * ((p.planchaCalentamientoMin / 60) + (U * p.curadoSegPrenda / 3600));
  const tandas = Math.ceil(P / p.hornoCapacidadPantallas);
  const horno = P === 0 ? 0 : p.electricidadEurKwh * p.hornoPotenciaKw * (p.hornoMinutosTanda / 60) * tandas;
  const electricidad = [
    concepto("flash", "Flash", flash, P === 0 ? "sin pantallas" : `calentamiento + ${U * P} impresiones`),
    concepto("plancha", "Plancha (curado)", plancha, `calentamiento + ${U} curados`),
    concepto("horno", "Horno (secado de pantallas)", horno, `${P === 0 ? 0 : tandas} tanda(s)`),
  ];

  const reserva = U * p.reservaMaquinariaPorPrenda;

  // Labour
  const moDiseno = minutosDiseno / 60 * tarifa;
  const minutosPantalla = p.prepararPantallaMin + p.registroMin + (p.encintadoSeg / 60) + p.recuperacionMin;
  const moPantallas = P * (minutosPantalla / 60) * tarifa;
  const moPrendas = ((U * (p.colocarPrendaSeg + p.retirarPrendaSeg) / 3600) + (U * P * p.impresionSegColorPrenda / 3600) + (U * p.curadoSegPrenda / 3600)) * tarifa;
  const manoObra = [
    concepto("diseno", "Diseño", moDiseno, `${minutosDiseno} min`),
    concepto("pantallas", "Preparación de pantallas", moPantallas, `${P} pantalla(s) × ${fmt(minutosPantalla, 2)} min`),
    concepto("prendas", "Producción de prendas", moPrendas, `${U} prendas (colocar, imprimir ${P} color(es), curar)`),
  ];

  const suma = (lista) => lista.reduce((s, c) => s + c.importe, 0);
  const totalConsumibles = suma(consumibles);
  const totalElectricidad = suma(electricidad);
  const totalManoObra = suma(manoObra);
  const costeTotal = prendas + totalConsumibles + totalElectricidad + reserva + totalManoObra;
  const precioRecomendado = costeTotal === 0 ? 0 : costeTotal / (1 - p.margenRecomendado);

  const precioFinal = entrada.precioFinal ?? null;
  const beneficio = precioFinal === null ? null : precioFinal - costeTotal;
  const margen = precioFinal === null ? null : precioFinal === 0 ? 0 : beneficio / precioFinal;
  const porUnidad = (v) => (U === 0 || v === null ? null : v / U);

  // Recommended price: unit price in cents, rounded up by the commercial rule, times the units
  const costeTotalCent = aCentimos(costeTotal);
  const pasoCent = aCentimos(p.redondeoPrecioUnidad ?? 0);
  const recomendadoSinRedondearCent = aCentimos(precioRecomendado);
  const recomendadoPorUnidadSinRedondearCent = aCentimos(precioRecomendado / U);
  const recomendadoPorUnidadCent = redondearArribaCent(recomendadoPorUnidadSinRedondearCent, pasoCent);
  const recomendadoCent = pasoCent > 0 ? recomendadoPorUnidadCent * U : recomendadoSinRedondearCent;
  const beneficioRecomendadoCent = recomendadoCent - costeTotalCent;

  return {
    motor: VERSION_MOTOR,
    unidades: U,
    unidadesConMerma: U * (1 + merma),
    pantallas: P,
    merma,
    costes: {
      grupos: [
        { clave: "prendas", etiqueta: "Prendas", importe: prendas, cent: aCentimos(prendas), conceptos: [
          concepto("prendas", `Prendas (incluye ${fmt(merma * 100, 2)} % de merma)`, prendas, `${U} prendas, ${fmt(prendasSinMerma, 2)} € sin merma`),
        ] },
        { clave: "consumibles", etiqueta: "Materiales y consumibles", importe: totalConsumibles, cent: aCentimos(totalConsumibles), conceptos: consumibles },
        { clave: "electricidad", etiqueta: "Electricidad", importe: totalElectricidad, cent: aCentimos(totalElectricidad), conceptos: electricidad },
        { clave: "reserva", etiqueta: "Reserva de maquinaria", importe: reserva, cent: aCentimos(reserva), conceptos: [
          concepto("reserva", "Reserva de mantenimiento", reserva, `${U} prendas × ${fmt(p.reservaMaquinariaPorPrenda, 4)} €`),
        ] },
        { clave: "manoObra", etiqueta: "Mano de obra", importe: totalManoObra, cent: aCentimos(totalManoObra), conceptos: manoObra },
      ],
      total: costeTotal,
      totalCent: costeTotalCent,
      porUnidad: porUnidad(costeTotal),
      porUnidadCent: U === 0 ? null : aCentimos(costeTotal / U),
    },
    precio: {
      recomendado: recomendadoCent / 100,
      recomendadoCent,
      recomendadoPorUnidadCent,
      recomendadoSinRedondearCent,
      recomendadoPorUnidadSinRedondearCent,
      redondeoPorUnidadCent: pasoCent,
      margenRecomendado: p.margenRecomendado,
      // Expected profit and margin if the rounded recommended price is charged
      beneficioRecomendado: {
        cent: beneficioRecomendadoCent,
        margen: recomendadoCent === 0 ? 0 : beneficioRecomendadoCent / recomendadoCent,
      },
      final: precioFinal,
      finalCent: precioFinal === null ? null : aCentimos(precioFinal),
    },
    ingresos: {
      // Owner decision: prices are quoted without adding VAT. This is NOT a VAT exemption claim:
      // the tax regime is still to be confirmed, and a configurable treatment can be added here later.
      iva: { tratamiento: "sinIvaAnadido", mensaje: "Precios sin IVA añadido: ni el precio recomendado ni el precio final suman IVA." },
    },
    beneficio: beneficio === null ? null : {
      importe: beneficio,
      cent: aCentimos(beneficio),
      porUnidadCent: U === 0 ? null : aCentimos(beneficio / U),
      margen,
    },
  };
};
