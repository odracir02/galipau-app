// Builds the real-cost engine input from the calculator form.

import { resolverCostePrenda, productoPorId } from "../../domain/catalogo";
import { leerNumero } from "../../shared/utils/dinero";

// Text shown to the customer for a line (free text wins over catalogue fields)
export const describirLinea = (l) =>
  (l.descripcion ?? "").trim() || [l.tipo, l.proveedor, l.modelo].filter(Boolean).join(" ") || "Prenda";

/**
 * Price used for each line, in order: manual price, the price saved with the
 * quote (`precioGuardado`, so reopening a quote never changes it silently),
 * then the current catalogue price.
 * Returns { entrada, problemas, detalle, preciosCambiados }.
 */
export const construirEntrada = ({ lineas, productos, zonas, minutosDiseno, mermaPorcentaje, precioFinal }) => {
  const problemas = [];
  const preciosCambiados = [];
  const detalle = lineas.map((l, i) => {
    const cantidad = leerNumero(l.quantity);
    const manual = leerNumero(l.precioManual);
    // Lines chosen with the exact selector carry the product id; older lines use the colour group
    const exacto = l.productoId ? productoPorId(productos, l.productoId) : null;
    const catalogo = l.productoId
      ? { encontrado: Boolean(exacto), coste: exacto ? Number(exacto.coste) : 0, costesDistintos: false }
      : resolverCostePrenda(productos, l);
    let precioUnitario;
    let origen;
    if (manual !== null) {
      precioUnitario = manual;
      origen = "manual";
    } else if (typeof l.precioGuardado === "number") {
      precioUnitario = l.precioGuardado;
      origen = "guardado";
      if (catalogo.encontrado && Math.round(catalogo.coste * 10000) !== Math.round(l.precioGuardado * 10000)) {
        preciosCambiados.push({ linea: i + 1, guardado: l.precioGuardado, actual: catalogo.coste });
      }
    } else {
      if (!catalogo.encontrado) {
        problemas.push(l.productoId
          ? `Línea ${i + 1}: la prenda ya no está en el catálogo; vuelve a elegirla o indica un precio manual.`
          : `Línea ${i + 1}: elige una prenda del catálogo o indica un precio manual.`);
      }
      else if (catalogo.costesDistintos) problemas.push(`Línea ${i + 1}: hay colores con costes distintos en el grupo «${l.color}»; se usa el primero.`);
      precioUnitario = catalogo.encontrado ? catalogo.coste : NaN;
      origen = "catalogo";
    }
    return {
      descripcion: describirLinea(l),
      tipo: l.tipo ?? "",
      proveedor: l.proveedor ?? "",
      modelo: l.modelo ?? "",
      talla: l.size ?? "",
      color: l.color ?? "",
      cantidad,
      precioUnitario,
      origen,
    };
  });
  const merma = leerNumero(mermaPorcentaje);
  const entrada = {
    lineas: detalle.map(({ cantidad, precioUnitario }) => ({ cantidad, precioUnitario })),
    zonas: zonas.map((z) => ({ nombre: z.nombre, colores: leerNumero(z.colores) ?? 0 })),
    minutosDiseno: leerNumero(minutosDiseno) ?? 0,
    merma: merma === null ? undefined : merma / 100,
    precioFinal: leerNumero(precioFinal),
  };
  return { entrada, problemas, detalle, preciosCambiados };
};
