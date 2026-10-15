// Input validation for the quote form. It only checks that the data is complete
// and valid; it does not apply any pricing rule.

import { buscarProductos } from "./catalogo";
import { ESTAMPADO_DTF, ESTAMPADO_SERIGRAFIA } from "./presupuestoEstado";

const ZONAS_VALIDAS = [1, 2, 3];

const texto = (valor) => (valor === null || valor === undefined ? "" : String(valor).trim());

export const esEnteroPositivo = (valor) => /^\d+$/.test(texto(valor)) && Number(texto(valor)) > 0;

export const esNumeroPositivo = (valor) => {
  const t = texto(valor);
  if (t === "") return false;
  const n = Number(t);
  return Number.isFinite(n) && n > 0;
};

// Returns a list of { bloqueId, lineaId, campo, mensaje }. Empty list = valid.
export const validarPresupuesto = ({ clientName, bloques, productos }) => {
  const errores = [];
  const error = (mensaje, extra = {}) => errores.push({ mensaje, ...extra });

  if (texto(clientName) === "") {
    error("Indica el nombre del cliente.", { campo: "clientName" });
  }

  if (!Array.isArray(productos) || productos.length === 0) {
    error("El catálogo de productos no está disponible. No se puede calcular el presupuesto.", {
      campo: "catalogo",
    });
  }

  bloques.forEach((bloque, i) => {
    const prefijoBloque = `Tipo ${i + 1}`;
    const enBloque = (campo, mensaje) => error(`${prefijoBloque}: ${mensaje}`, { bloqueId: bloque.id, campo });

    if (![ESTAMPADO_DTF, ESTAMPADO_SERIGRAFIA].includes(bloque.estampado)) {
      enBloque("estampado", "selecciona un tipo de estampado.");
    }
    if (!ZONAS_VALIDAS.includes(Number(bloque.zonas))) {
      enBloque("zonas", "selecciona el número de zonas.");
    }
    if (bloque.estampado === ESTAMPADO_DTF && !esNumeroPositivo(bloque.area)) {
      enBloque("area", "el área de impresión debe ser un número mayor que 0.");
    }
    if (bloque.estampado === ESTAMPADO_SERIGRAFIA && !esEnteroPositivo(bloque.numColores)) {
      enBloque("numColores", "el número de colores debe ser un número entero mayor que 0.");
    }

    bloque.lineas.forEach((linea, j) => {
      const enLinea = (campo, mensaje) =>
        error(`${prefijoBloque}, línea ${j + 1}: ${mensaje}`, { bloqueId: bloque.id, lineaId: linea.id, campo });

      const faltan = [
        ["proveedor", "proveedor"],
        ["modelo", "modelo"],
        ["size", "talla"],
        ["color", "color"],
      ].filter(([campo]) => texto(linea[campo]) === "");

      faltan.forEach(([campo, nombre]) => enLinea(campo, `selecciona ${nombre === "talla" ? "la" : "el"} ${nombre}.`));

      if (!esEnteroPositivo(linea.quantity)) {
        enLinea("quantity", "la cantidad debe ser un número entero mayor que 0.");
      }

      if (faltan.length === 0 && Array.isArray(productos) && productos.length > 0) {
        if (buscarProductos(productos, linea).length === 0) {
          enLinea("producto", "el producto seleccionado no existe en el catálogo.");
        }
      }
    });
  });

  return errores;
};
