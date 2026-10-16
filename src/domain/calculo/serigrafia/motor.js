// Screen printing real-cost engine.
// Reproduces the verified cost model of the master spreadsheet (V2_24) with
// configurable, versioned parameters. Pure function: no React, no database.
//
// Model (per quote):
//   U = total garments, P = screens = Σ colours per printed zone
//   cost = garments × (1 + waste) + consumables + electricity + machinery reserve + labour
//   recommended price = cost / (1 − recommended margin)
//   profit = final price − cost; margin = profit / final price
// Amounts are computed in euros (floating point, like the spreadsheet) and
// rounded to cents only in the totals. Sales VAT is NOT handled (pending a
// business decision): the final price is used as entered.

import { costePorBase, validarParametros, BASES_CONSUMO } from "./parametros";

export const VERSION_MOTOR = "serigrafia-coste-real/1";

export class ErrorCalculo extends Error {
  constructor(errores) {
    super(errores.join(" "));
    this.errores = errores;
  }
}

export const aCentimos = (euros) => Math.round(euros * 100);

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
      totalCent: aCentimos(costeTotal),
      porUnidad: porUnidad(costeTotal),
      porUnidadCent: U === 0 ? null : aCentimos(costeTotal / U),
    },
    precio: {
      recomendado: precioRecomendado,
      recomendadoCent: aCentimos(precioRecomendado),
      recomendadoPorUnidadCent: U === 0 ? null : aCentimos(precioRecomendado / U),
      margenRecomendado: p.margenRecomendado,
      final: precioFinal,
      finalCent: precioFinal === null ? null : aCentimos(precioFinal),
    },
    ingresos: {
      // Sales VAT treatment is undefined until the owner confirms the tax regime
      iva: { tratamiento: "pendiente", mensaje: "Tratamiento del IVA en ventas pendiente de definir: el precio final se usa tal como se introduce." },
    },
    beneficio: beneficio === null ? null : {
      importe: beneficio,
      cent: aCentimos(beneficio),
      porUnidadCent: U === 0 ? null : aCentimos(beneficio / U),
      margen,
    },
  };
};
