// Legacy quote engine, extracted verbatim from QuoteForm.jsx.
//
// The arithmetic (including the order of operations) is intentionally kept
// identical to the original implementation so results do not change. The
// characterisation tests only prove that behaviour is preserved; they do NOT
// prove the formulas are commercially correct (see known issues ERR-03..06).
//
// Inputs are expected to be validated beforehand (see ../validacion.js).

import { resolverCostePrenda } from "../catalogo";
import { PARAMETROS_LEGACY } from "./parametrosLegacy";

const numeroONull = (valor) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isNaN(n) ? null : n;
};

// Flattens blocks into lines carrying the block's print settings.
const aplanarLineas = (bloques) =>
  bloques.flatMap((bloque, indiceBloque) =>
    bloque.lineas.map((linea, indiceLinea) => {
      const { id, ...datosLinea } = linea;
      return {
        ...datosLinea,
        estampado: bloque.estampado,
        area: numeroONull(bloque.area),
        zonas: bloque.zonas || 1,
        numColores: numeroONull(bloque.numColores),
        _aviso: { lineaId: id, bloque: indiceBloque + 1, linea: indiceLinea + 1 },
      };
    })
  );

export const porcentajeDescuento = (totalPrendas, tramos) => {
  for (const tramo of tramos) {
    if (totalPrendas >= tramo.minimoPrendas) return tramo.porcentaje;
  }
  return 0;
};

export const calcularPresupuestoLegacy = ({
  clientName,
  bloques,
  productos,
  parametros = PARAMETROS_LEGACY,
}) => {
  const costePorCm2 =
    (parametros.precioFilmReferencia / parametros.superficieFilmReferenciaCm2) *
    parametros.factorIvaFilm;
  const precioBastidor = parametros.precioBastidor;
  const precioManoObra = parametros.precioManoObra;

  const avisos = [];
  let totalPrendas = 0;
  let subtotalSinDescuento = 0;
  let beneficioTotal = 0;

  const lineasConPrecio = aplanarLineas(bloques).map((lineaPlana) => {
    const { _aviso, ...linea } = lineaPlana;
    const unidades = parseInt(linea.quantity);
    const zonas = parseInt(linea.zonas) || 1;
    totalPrendas += unidades;

    const coste = resolverCostePrenda(productos, linea);
    if (!coste.encontrado) {
      avisos.push({ ..._aviso, tipo: "productoNoEncontrado" });
    } else if (coste.costesDistintos) {
      avisos.push({ ..._aviso, tipo: "costesDistintos" });
    }
    const costePrenda = coste.coste;

    let precioUnitario = 0;
    let subtotal = 0;
    let beneficioLinea = 0;

    if (linea.estampado === "DTF") {
      const costeFilm = (linea.area || 0) * costePorCm2;
      const costeClienteFilm = costeFilm * parametros.multiplicadorFilm;
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

  const descuentoPorcentaje = porcentajeDescuento(totalPrendas, parametros.tramosDescuento);
  const descuento = (subtotalSinDescuento * descuentoPorcentaje) / 100;
  const total = subtotalSinDescuento - descuento;

  return {
    resultado: {
      clientName,
      totalPrendas,
      lineas: lineasConPrecio,
      subtotalSinDescuento,
      descuentoPorcentaje,
      descuento,
      total,
      beneficioTotal,
    },
    avisos,
  };
};
