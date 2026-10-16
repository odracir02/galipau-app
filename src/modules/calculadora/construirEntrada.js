// Builds the real-cost engine input from the calculator form.

import { resolverCostePrenda } from "../../domain/catalogo";
import { leerNumero } from "../../shared/utils/dinero";

// Returns { entrada, problemas }
export const construirEntrada = ({ lineas, productos, zonas, minutosDiseno, mermaPorcentaje, precioFinal }) => {
  const problemas = [];
  const lineasMotor = lineas.map((l, i) => {
    const cantidad = leerNumero(l.quantity);
    const manual = leerNumero(l.precioManual);
    let precioUnitario = manual;
    if (manual === null) {
      const r = resolverCostePrenda(productos, l);
      if (!r.encontrado) problemas.push(`Línea ${i + 1}: elige una prenda del catálogo o indica un precio manual.`);
      else if (r.costesDistintos) problemas.push(`Línea ${i + 1}: hay colores con costes distintos en el grupo «${l.color}»; se usa el primero.`);
      precioUnitario = r.encontrado ? r.coste : NaN;
    }
    return { cantidad, precioUnitario };
  });
  const merma = leerNumero(mermaPorcentaje);
  const entrada = {
    lineas: lineasMotor,
    zonas: zonas.map((z) => ({ nombre: z.nombre, colores: leerNumero(z.colores) ?? 0 })),
    minutosDiseno: leerNumero(minutosDiseno) ?? 0,
    merma: merma === null ? undefined : merma / 100,
    precioFinal: leerNumero(precioFinal),
  };
  return { entrada, problemas };
};

