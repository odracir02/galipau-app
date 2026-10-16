// Browser side of the customer PDF: loads the logo, builds and saves the file.

import { construirDocumento } from "./domain/documento";
import { generarPdf } from "./domain/pdf";
import { descargarLogo, FORMATOS_LOGO } from "../empresa/empresaRepo";

const leerComoDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(blob);
  });

const medirImagen = (dataUrl) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ ancho: img.naturalWidth || 1, alto: img.naturalHeight || 1 });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

export const cargarLogoPdf = async (sb, empresa) => {
  if (!empresa?.logo) return null;
  try {
    const blob = await descargarLogo(sb);
    const formato = blob && FORMATOS_LOGO[blob.type || empresa.logo.tipo];
    if (!formato) return null;
    const datos = await leerComoDataUrl(blob);
    const medidas = await medirImagen(datos);
    return medidas ? { datos, formato, ...medidas } : null;
  } catch {
    return null; // the document is still generated, with the name instead of the logo
  }
};

/**
 * Builds the PDF of a stored quote and hands it to `guardar` (defaults to a browser download).
 * Throws ErrorDocumento with a user message when the quote cannot be printed.
 */
export const descargarPdfPresupuesto = async (sb, registro, empresa, guardar = (pdf, nombre) => pdf.save(nombre)) => {
  const doc = construirDocumento(registro, empresa);
  const logo = await cargarLogoPdf(sb, empresa);
  const pdf = await generarPdf(doc, { logo });
  await guardar(pdf, doc.nombreArchivo);
  return doc.nombreArchivo;
};
