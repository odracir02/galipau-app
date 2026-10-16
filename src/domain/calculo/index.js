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

// Real-cost engines by technique (screen printing first; DTF will follow the
// same contract: calcular(entrada, parametros) -> { costes, precio, beneficio, ... }).
export { calcularCosteSerigrafia, VERSION_MOTOR as VERSION_MOTOR_SERIGRAFIA, ErrorCalculo } from "./serigrafia/motor";
export { CAMPOS_PARAMETROS, GRUPOS_PARAMETROS, BASES_CONSUMO, validarParametros } from "./serigrafia/parametros";

import { calcularCosteSerigrafia } from "./serigrafia/motor";

export const MOTORES_COSTE = Object.freeze({
  serigrafia: calcularCosteSerigrafia,
});

export const calcularCostePorTecnica = (tecnica, entrada, parametros) => {
  const motor = MOTORES_COSTE[tecnica];
  if (!motor) throw new Error(`No real-cost engine for technique: ${tecnica}`);
  return motor(entrada, parametros);
};
