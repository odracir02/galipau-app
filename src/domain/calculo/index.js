// Entry point of the quote engine. The UI only depends on this module, so the
// legacy engine can later be replaced by one based on the master spreadsheet
// without touching the components.
//
// Contract:
//   calcularPresupuesto({ clientName, bloques, productos }) ->
//     { resultado: { clientName, totalPrendas, lineas[], subtotalSinDescuento,
//                    descuentoPorcentaje, descuento, total, beneficioTotal },
//       avisos: [{ lineaId, bloque, linea, tipo }] }

export { calcularPresupuestoLegacy as calcularPresupuesto } from "./calculoLegacy";
export { PARAMETROS_LEGACY } from "./parametrosLegacy";
