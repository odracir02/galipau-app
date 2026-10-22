// Customer document (PDF) model, built from a stored quote.
//
// Only commercial data goes into the document: never costs, margins, profit,
// parameter values or internal notes. No tax statement is printed (the tax
// regime is not confirmed): prices are shown as they are, without adding VAT.
// Spanish and Valencian, following the spreadsheet document.

import { euros } from "../../../shared/utils/dinero";

export const IDIOMAS = { es: "Castellano", va: "Valencià" };

export const TEXTOS = {
  es: {
    titulo: "PRESUPUESTO",
    borrador: "BORRADOR",
    numero: "Nº",
    validoHasta: "Válido hasta",
    cliente: "CLIENTE",
    nif: "NIF / CIF",
    detalle: "DETALLE DEL PEDIDO",
    columnas: ["MARCA / MODELO", "TALLA / COLOR", "UDS."],
    impresion: "CARACTERÍSTICAS DE IMPRESIÓN",
    colores: (n) => `${n} ${n === 1 ? "color" : "colores"}`,
    totalUnidades: "Total de unidades",
    precioUnidad: "Precio por unidad",
    total: "TOTAL PRESUPUESTO",
    observaciones: "OBSERVACIONES",
    sinObservaciones: "Sin observaciones",
    condiciones: "CONDICIONES",
    aviso: "Presupuesto informativo. No es una factura.",
    archivo: "Presupuesto",
  },
  va: {
    titulo: "PRESSUPOST",
    borrador: "ESBORRANY",
    numero: "Nº",
    validoHasta: "Vàlid fins a",
    cliente: "CLIENT",
    nif: "NIF / CIF",
    detalle: "DETALL DE LA COMANDA",
    columnas: ["MARCA / MODEL", "TALLA / COLOR", "UTS."],
    impresion: "CARACTERÍSTIQUES D’IMPRESSIÓ",
    colores: (n) => `${n} ${n === 1 ? "color" : "colors"}`,
    totalUnidades: "Total d’unitats",
    precioUnidad: "Preu per unitat",
    total: "TOTAL PRESSUPOST",
    observaciones: "OBSERVACIONS",
    sinObservaciones: "Sense observacions",
    condiciones: "CONDICIONS",
    aviso: "Pressupost informatiu. No és una factura.",
    archivo: "Pressupost",
  },
};

// Default commercial conditions (from the spreadsheet document), editable in "Empresa y PDF"
export const CONDICIONES_POR_DEFECTO = {
  va: [
    "Pagament: 50 % en acceptar el pressupost i 50 % abans del lliurament.",
    "La producció començarà després d’aprovar el disseny i confirmar la disponibilitat de les peces de roba.",
    "Recollida al taller. El transport, si escau, es pressupostarà a banda.",
    "Qualsevol canvi en la quantitat, el model o la impressió requerirà revisar el pressupost.",
  ],
  es: [
    "Pago: 50 % al aceptar el presupuesto y 50 % antes de la entrega.",
    "La producción comenzará después de aprobar el diseño y confirmar la disponibilidad de las prendas.",
    "Recogida en el taller. El transporte, si procede, se presupuestará aparte.",
    "Cualquier cambio en la cantidad, el modelo o la impresión requerirá revisar el presupuesto.",
  ],
};

// Default zone names translated for the Valencian document
const ZONAS_VA = { delantera: "Davant", trasera: "Darrere", manga: "Màniga", "manga izquierda": "Màniga esquerra", "manga derecha": "Màniga dreta", cuello: "Coll", espalda: "Esquena" };
const COLORES_VA = { blanca: "Blanca", color: "Color" };

const traducir = (tabla, texto, idioma) => (idioma === "va" ? tabla[String(texto).trim().toLowerCase()] ?? texto : texto);

const fecha = (iso) => {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

const unir = (partes, sep = "   ·   ") => partes.filter((p) => p && String(p).trim()).join(sep);

export class ErrorDocumento extends Error {}

/**
 * @param {object} p stored quote row
 * @param {object} empresa business data (configuracion 'empresa')
 */
export const construirDocumento = (p, empresa = {}) => {
  if (p.estado === "cancelado") throw new ErrorDocumento("El presupuesto está cancelado: no se genera el PDF.");
  if (p.estado === "importado") throw new ErrorDocumento("Los presupuestos importados del historial no tienen el detalle necesario para el PDF.");
  if (!p.resultado || !Array.isArray(p.entrada?.lineas) || p.entrada.lineas.length === 0) {
    throw new ErrorDocumento("Calcula y guarda el presupuesto antes de generar el PDF.");
  }
  if (!(p.precio_final_cent > 0)) throw new ErrorDocumento("Indica el precio final antes de generar el PDF.");

  const idioma = p.idioma === "va" ? "va" : "es";
  const t = TEXTOS[idioma];
  const c = p.cliente_datos ?? {};
  const unidades = p.entrada.lineas.reduce((n, l) => n + (Number(l.cantidad) || 0), 0);
  const total = p.precio_final_cent;
  const zonas = (p.entrada.motor?.zonas ?? []).filter((z) => z.colores > 0);
  const nombreEmpresa = (empresa.nombre || "Galipau Arts").trim();
  const numero = p.numero ?? null;

  return {
    idioma,
    titulo: t.titulo,
    borrador: numero ? null : t.borrador,
    referencia: unir([numero ? `${t.numero} ${numero}` : "", fecha(p.fecha_emision)], "   "), // a draft shows only the date (it is labelled below)
    validoHasta: p.valido_hasta ? `${t.validoHasta}: ${fecha(p.valido_hasta)}` : null,
    emisor: {
      nombre: nombreEmpresa.toUpperCase(),
      lineas: [
        unir([empresa.titular, empresa.nif ? `NIF ${empresa.nif}` : ""]),
        unir([empresa.direccion, empresa.localidad]),
        unir([empresa.telefono, empresa.email]),
        empresa.web ?? "",
      ].filter((l) => l.trim()),
    },
    cliente: {
      titulo: t.cliente,
      nombre: c.razon_social || c.nombre || p.cliente_nombre,
      lineas: [
        c.razon_social && c.nombre && c.razon_social !== c.nombre ? c.nombre : "",
        c.nif ? `${t.nif}: ${c.nif}` : "",
        unir([c.direccion, unir([c.codigo_postal, c.ciudad], " "), c.provincia && c.provincia !== c.ciudad ? `(${c.provincia})` : ""], ", "),
        unir([c.telefono, c.email]),
      ].filter((l) => l && l.trim()),
    },
    tabla: {
      titulo: t.detalle,
      columnas: t.columnas,
      filas: p.entrada.lineas.map((l) => [
        l.descripcion || unir([l.proveedor, l.modelo], "  ·  "),
        unir([l.talla, traducir(COLORES_VA, l.color, idioma)], "  ·  "),
        String(l.cantidad),
      ]),
    },
    impresion: {
      titulo: t.impresion,
      lineas: zonas.map((z) => `${traducir(ZONAS_VA, z.nombre, idioma)}: ${t.colores(z.colores)}`),
    },
    resumen: {
      unidades: `${t.totalUnidades}: ${unidades}`,
      // Only when the total is an exact number of cents per unit
      precioUnidad: unidades > 0 && total % unidades === 0 ? `${t.precioUnidad}: ${euros(total / unidades)}` : null,
      etiquetaTotal: t.total,
      total: euros(total),
    },
    observaciones: { titulo: t.observaciones, texto: (p.observaciones ?? "").trim() || t.sinObservaciones },
    condiciones: {
      titulo: t.condiciones,
      lineas: (p.condiciones ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
    },
    aviso: (empresa.aviso?.[idioma] ?? t.aviso).trim(),
    pie: (empresa.eslogan ?? nombreEmpresa).toUpperCase(),
    nombreArchivo: `${t.archivo}_${(numero ?? t.borrador).replace(/[/\\]/g, "-")}_${nombreEmpresa.replace(/[^A-Za-z0-9]+/g, "_")}.pdf`,
  };
};

// One-line summaries shown while the document settings and the internal notes are folded
const fechaCorta = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const recortar = (texto, max) => (texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto);
const lineasDe = (texto) => String(texto ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

export const resumenDocumento = (documento, empresa) => {
  const condiciones = lineasDe(documento.condiciones);
  const porDefecto = empresa?.condiciones?.[documento.idioma] ?? [];
  const observaciones = lineasDe(documento.observaciones).join(" ");
  return [
    IDIOMAS[documento.idioma] ?? documento.idioma,
    documento.fechaEmision && `fecha ${fechaCorta(documento.fechaEmision)}`,
    documento.validoHasta ? `válido hasta ${fechaCorta(documento.validoHasta)}` : "sin fecha de validez",
    observaciones ? `observaciones: «${recortar(observaciones, 40)}»` : "sin observaciones",
    condiciones.length === 0
      ? "sin condiciones"
      : condiciones.join("\n") === porDefecto.map((l) => l.trim()).filter(Boolean).join("\n")
        ? "condiciones por defecto"
        : `${condiciones.length} ${condiciones.length === 1 ? "condición propia" : "condiciones propias"}`,
  ].filter(Boolean).join(" · ");
};

export const resumenNotas = (notas) => {
  const lineas = lineasDe(notas);
  return lineas.length ? recortar(lineas.join(" "), 90) : "Sin notas. Solo las ves tú: nunca salen en el PDF.";
};
