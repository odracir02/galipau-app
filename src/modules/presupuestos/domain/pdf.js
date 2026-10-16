// Renders the customer document model (documento.js) as an A4 PDF with the
// Galipau Arts look of the spreadsheet document. jsPDF is loaded on demand.

const VERDE = [119, 185, 57];
const OSCURO = [34, 43, 42];
const TEXTO = [35, 43, 42];
const GRIS = [100, 107, 103];
const GRIS_CONDICIONES = [70, 78, 75];
const FONDO_FILA = [242, 246, 239];
const LINEA = [211, 223, 207];

const MARGEN = 16;
const ANCHO = 210;
const ALTO = 297;
const UTIL = ANCHO - 2 * MARGEN;

/**
 * @param {object} doc model from construirDocumento
 * @param {{ logo?: { datos: string, formato: "PNG"|"JPEG", ancho: number, alto: number } }} opciones
 * @returns {Promise<import("jspdf").jsPDF>}
 */
export const generarPdf = async (doc, { logo, comprimir = true } = {}) => {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: comprimir });
  pdf.setProperties({ title: `${doc.titulo} ${doc.referencia}`, creator: doc.emisor.nombre });
  let y = 14;

  const color = (c) => pdf.setTextColor(...c);
  const fuente = (estilo, tam) => {
    pdf.setFont("helvetica", estilo);
    pdf.setFontSize(tam);
  };
  const separador = () => {
    pdf.setDrawColor(...LINEA);
    pdf.setLineWidth(0.3);
    pdf.line(MARGEN, y, ANCHO - MARGEN, y);
  };
  // New page if the next block does not fit
  const asegurar = (alto) => {
    if (y + alto > ALTO - 18) {
      pdf.addPage();
      y = 18;
    }
  };

  // Header: logo (or name) left, title and reference right
  if (logo) {
    const ancho = 52;
    const alto = Math.min(30, (logo.alto / logo.ancho) * ancho);
    pdf.addImage(logo.datos, logo.formato, MARGEN, y, (logo.ancho / logo.alto) * alto, alto);
  } else {
    fuente("bold", 18);
    color(VERDE);
    pdf.text(doc.emisor.nombre, MARGEN, y + 10);
  }
  fuente("bold", 23);
  color(TEXTO);
  pdf.text(doc.titulo, ANCHO - MARGEN, y + 10, { align: "right" });
  fuente("normal", 10);
  color(GRIS);
  pdf.text(doc.referencia, ANCHO - MARGEN, y + 17, { align: "right" });
  if (doc.validoHasta) pdf.text(doc.validoHasta, ANCHO - MARGEN, y + 22, { align: "right" });
  if (doc.borrador) {
    fuente("bold", 10);
    color(VERDE);
    pdf.text(doc.borrador, ANCHO - MARGEN, y + 27, { align: "right" });
  }
  y += 36;

  // Issuer
  separador();
  y += 7;
  fuente("bold", 11);
  color(TEXTO);
  pdf.text(doc.emisor.nombre, MARGEN, y);
  fuente("normal", 9);
  doc.emisor.lineas.forEach((l, i) => {
    y += 4.6;
    color(i === doc.emisor.lineas.length - 1 && /^(www\.|https?:)/.test(l) ? VERDE : GRIS);
    pdf.text(l, MARGEN, y);
  });
  y += 7;

  // Customer
  separador();
  y += 7;
  fuente("bold", 10);
  color(VERDE);
  pdf.text(doc.cliente.titulo, MARGEN, y);
  y += 7;
  fuente("bold", 14);
  color(TEXTO);
  pdf.splitTextToSize(doc.cliente.nombre, UTIL).forEach((l) => {
    pdf.text(l, MARGEN, y);
    y += 6;
  });
  fuente("normal", 9.5);
  color(GRIS);
  doc.cliente.lineas.forEach((l) => {
    pdf.text(l, MARGEN, y);
    y += 4.8;
  });
  y += 5;

  // Order detail
  fuente("bold", 11);
  color(TEXTO);
  pdf.text(doc.tabla.titulo, MARGEN, y);
  y += 4;
  const col = [MARGEN, MARGEN + UTIL * 0.55, MARGEN + UTIL * 0.86];
  const anchoCol = [UTIL * 0.55 - 3, UTIL * 0.31 - 3, UTIL * 0.14];
  const cabecera = () => {
    pdf.setFillColor(...OSCURO);
    pdf.rect(MARGEN, y, UTIL, 9, "F");
    fuente("bold", 9.5);
    pdf.setTextColor(255, 255, 255);
    pdf.text(doc.tabla.columnas[0], col[0] + 3, y + 6);
    pdf.text(doc.tabla.columnas[1], col[1], y + 6);
    pdf.text(doc.tabla.columnas[2], col[2] + anchoCol[2] / 2, y + 6, { align: "center" });
    y += 9;
  };
  cabecera();
  doc.tabla.filas.forEach(([producto, tallaColor, unidades]) => {
    fuente("normal", 9.5);
    const lineasProducto = pdf.splitTextToSize(producto, anchoCol[0] - 3);
    const lineasTalla = pdf.splitTextToSize(tallaColor, anchoCol[1]);
    const alto = Math.max(9, 4.6 * Math.max(lineasProducto.length, lineasTalla.length) + 4);
    if (y + alto > ALTO - 18) {
      pdf.addPage();
      y = 18;
      cabecera();
      fuente("normal", 9.5);
    }
    pdf.setFillColor(...FONDO_FILA);
    pdf.rect(MARGEN, y, UTIL, alto, "F");
    pdf.setDrawColor(255, 255, 255);
    pdf.line(MARGEN, y + alto, ANCHO - MARGEN, y + alto);
    color(TEXTO);
    pdf.text(lineasProducto, col[0] + 3, y + 5.6);
    pdf.text(lineasTalla, col[1], y + 5.6);
    pdf.text(unidades, col[2] + anchoCol[2] / 2, y + 5.6, { align: "center" });
    y += alto;
  });
  y += 8;

  // Printing
  if (doc.impresion.lineas.length) {
    asegurar(8 + 5 * doc.impresion.lineas.length);
    fuente("bold", 10.5);
    color(TEXTO);
    pdf.text(doc.impresion.titulo, MARGEN, y);
    fuente("normal", 9.5);
    color(GRIS);
    doc.impresion.lineas.forEach((l) => {
      y += 5;
      pdf.text(l, MARGEN, y);
    });
    y += 9;
  }

  // Notes for the customer
  fuente("normal", 9.5);
  const obs = pdf.splitTextToSize(doc.observaciones.texto, UTIL);
  asegurar(14 + 4.6 * obs.length);
  separador();
  y += 7;
  fuente("bold", 10.5);
  color(TEXTO);
  pdf.text(doc.observaciones.titulo, MARGEN, y);
  y += 5.5;
  fuente("normal", 9.5);
  color(GRIS);
  pdf.text(obs, MARGEN, y);
  y += 4.6 * obs.length + 5;

  // Conditions
  if (doc.condiciones.lineas.length) {
    fuente("normal", 9);
    const cond = doc.condiciones.lineas.map((l) => pdf.splitTextToSize(l, UTIL));
    asegurar(14 + 4.4 * cond.flat().length);
    separador();
    y += 7;
    fuente("bold", 10.5);
    color(VERDE);
    pdf.text(doc.condiciones.titulo, MARGEN, y);
    fuente("normal", 9);
    color(GRIS_CONDICIONES);
    cond.forEach((lineas) => {
      y += 5;
      pdf.text(lineas, MARGEN, y);
      y += 4.4 * (lineas.length - 1);
    });
    y += 9;
  }

  // Total
  asegurar(40);
  fuente("normal", 9.5);
  color(GRIS);
  pdf.text(doc.resumen.unidades, MARGEN, y);
  if (doc.resumen.precioUnidad) pdf.text(doc.resumen.precioUnidad, ANCHO - MARGEN, y, { align: "right" });
  y += 4;
  pdf.setFillColor(...OSCURO);
  pdf.rect(MARGEN, y, UTIL, 17, "F");
  fuente("bold", 12);
  pdf.setTextColor(255, 255, 255);
  pdf.text(doc.resumen.etiquetaTotal, MARGEN + 5, y + 10.5);
  fuente("bold", 19);
  pdf.text(doc.resumen.total, ANCHO - MARGEN - 5, y + 11.5, { align: "right" });
  y += 23;
  fuente("normal", 8);
  color(GRIS);
  pdf.text(doc.aviso, MARGEN, y);

  // Footer on every page
  const paginas = pdf.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    pdf.setPage(i);
    pdf.setDrawColor(...LINEA);
    pdf.line(MARGEN, ALTO - 13, ANCHO - MARGEN, ALTO - 13);
    fuente("bold", 8);
    color(VERDE);
    pdf.text(doc.pie, MARGEN, ALTO - 8.5);
    if (paginas > 1) {
      fuente("normal", 8);
      color(GRIS);
      pdf.text(`${i} / ${paginas}`, ANCHO - MARGEN, ALTO - 8.5, { align: "right" });
    }
  }
  return pdf;
};
