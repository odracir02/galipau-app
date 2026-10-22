// Quotes domain with FICTITIOUS data (PARAMETROS_EJEMPLO and an invented catalogue).
import { describe, it, expect } from "vitest";
import { ESTADOS, TRANSICIONES, accionesDesde, esEditable, esTransicionPermitida, etiquetaEstado } from "./estados";
import {
  construirRegistro, estadoDesdeRegistro, estadoDuplicado, reproducir, datosDocumentoIniciales, instantaneaCliente, formularioVacio,
} from "./instantanea";
import { construirDocumento, ErrorDocumento, CONDICIONES_POR_DEFECTO, resumenDocumento, resumenNotas } from "./documento";
import { generarPdf } from "./pdf";
import { calcularFicticio, formularioFicticio, registroFicticio, CLIENTE_FICTICIO, CATALOGO_FICTICIO, DOCUMENTO_FICTICIO } from "./fixtures";
import { PARAMETROS_EJEMPLO } from "../../../domain/calculo/serigrafia/parametros";
import { construirEntrada } from "../../calculadora/construirEntrada";
import { euros } from "../../../shared/utils/dinero";

const EMPRESA = {
  nombre: "Galipau Arts", titular: "Titular Ficticio", nif: "00000000T", direccion: "Calle Ejemplo 1", localidad: "46000 Ciudad",
  telefono: "+34 600 000 000", email: "info@example.com", web: "www.example.com", eslogan: "Galipau Arts · Hecho a mano",
  validezDias: 30, idiomaPorDefecto: "va", condiciones: CONDICIONES_POR_DEFECTO,
};

describe("estados del presupuesto", () => {
  it("cada estado tiene etiqueta en castellano y valenciano, y transiciones definidas", () => {
    for (const clave of Object.keys(ESTADOS)) {
      expect(TRANSICIONES[clave]).toBeDefined();
      expect(etiquetaEstado(clave, "va")).toBeTruthy();
    }
    expect(etiquetaEstado("cancelado", "va")).toBe("Anul·lat");
  });

  it("solo se avanza paso a paso; cobrar exige haber finalizado", () => {
    expect(esTransicionPermitida("finalizado", "cobrado")).toBe(true);
    expect(esTransicionPermitida("en_produccion", "cobrado")).toBe(false);
    expect(esTransicionPermitida("borrador", "aceptado")).toBe(false);
    expect(TRANSICIONES.cancelado).toEqual([]);
    expect(TRANSICIONES.importado).toEqual([]);
  });

  it("acciones: avance, corrección y cancelación", () => {
    expect(accionesDesde("presentado")).toEqual([
      { hasta: "aceptado", etiqueta: "Marcar como aceptado", tipo: "avance" },
      { hasta: "borrador", etiqueta: "Corregir: volver a «borrador»", tipo: "correccion" },
      { hasta: "cancelado", etiqueta: "Cancelar presupuesto", tipo: "peligro" },
    ]);
  });

  it("solo borrador y presentado son editables", () => {
    expect(Object.keys(ESTADOS).filter(esEditable)).toEqual(["borrador", "presentado"]);
  });
});

describe("instantánea del presupuesto", () => {
  it("guarda cliente, líneas con su precio, entrada del motor, resultado y versiones", () => {
    const r = registroFicticio();
    expect(r.cliente_id).toBe(7);
    expect(r.cliente_datos).toMatchObject({ nombre: "Club Ficticio", nif: "G00000000" });
    expect(r.tecnica).toBe("serigrafia");
    expect(r.parametros_version).toBe(3);
    expect(r.motor).toBe("serigrafia-coste-real/2");
    expect(r.entrada.lineas.map((l) => [l.descripcion, l.talla, l.cantidad, l.precioUnitario, l.origen])).toEqual([
      ["Camiseta Demo Básica", "M", 6, 3, "catalogo"],
      ["Camiseta Demo Básica", "L", 4, 2.5, "catalogo"],
    ]);
    expect(r.entrada.motor.lineas).toEqual([{ cantidad: 6, precioUnitario: 3 }, { cantidad: 4, precioUnitario: 2.5 }]);
    expect(r.precio_final_cent).toBe(15000);
    expect(r.total_cent).toBe(15000);
    expect(r.coste_total_cent).toBe(r.resultado.costes.totalCent);
    expect(r.precio_recomendado_cent).toBe(r.resultado.precio.recomendadoCent);
    expect(r.beneficio_cent).toBe(15000 - r.coste_total_cent);
    expect(r.notas).toBe("Nota interna: cliente de confianza");
  });

  it("varias líneas: el coste de prendas suma cada línea", () => {
    const { resultado } = calcularFicticio(formularioFicticio({ mermaPorcentaje: "0" }));
    expect(resultado.costes.grupos[0].importe).toBeCloseTo(6 * 3 + 4 * 2.5, 10);
  });

  it("redondeo y precio manual: el recomendado se redondea a 0,50 €/ud; el final se guarda tal cual", () => {
    const r = registroFicticio();
    expect(r.resultado.precio.recomendadoPorUnidadCent % 50).toBe(0);
    expect(r.resultado.precio.recomendadoCent).toBe(r.resultado.precio.recomendadoPorUnidadCent * 10);
    const raro = construirRegistro({ cliente: null, formulario: formularioFicticio({ precioFinal: "123,45" }), calculo: calcularFicticio(formularioFicticio({ precioFinal: "123,45" })), parametrosVersion: 3, documento: DOCUMENTO_FICTICIO });
    expect(raro.precio_final_cent).toBe(12345);
  });

  it("sin precio final, el total provisional es el recomendado", () => {
    const f = formularioFicticio({ precioFinal: "" });
    const r = construirRegistro({ cliente: null, formulario: f, calculo: calcularFicticio(f), parametrosVersion: 3, documento: DOCUMENTO_FICTICIO });
    expect(r.precio_final_cent).toBeNull();
    expect(r.total_cent).toBe(r.precio_recomendado_cent);
    expect(r.cliente_nombre).toBe("(sin cliente)");
  });

  it("un borrador incompleto se guarda sin resultado ni versión de parámetros", () => {
    const f = formularioVacio(PARAMETROS_EJEMPLO);
    const r = construirRegistro({ cliente: CLIENTE_FICTICIO, formulario: f, calculo: null, parametrosVersion: 3, documento: DOCUMENTO_FICTICIO });
    expect(r.resultado).toBeNull();
    expect(r.parametros_version).toBeNull();
    expect(r.total_cent).toBe(0);
    expect(f.mermaPorcentaje).toBe("5");
  });

  it("al reabrir, las líneas del catálogo conservan su precio aunque el catálogo cambie, y se avisa", () => {
    const estado = estadoDesdeRegistro(registroFicticio());
    expect(estado.formulario.lineas[0].precioGuardado).toBe(3);
    const caro = CATALOGO_FICTICIO.map((p) => (p.id === "1" ? { ...p, coste: 3.4 } : p));
    const { entrada, preciosCambiados } = construirEntrada({ ...estado.formulario, productos: caro });
    expect(entrada.lineas[0].precioUnitario).toBe(3);
    expect(preciosCambiados).toEqual([{ linea: 1, guardado: 3, actual: 3.4 }]);
    expect(estado.parametrosVersion).toBe(3);
    expect(estado.documento).toMatchObject({ idioma: "va", observaciones: "Logo en blanc", fechaEmision: "2026-10-17" });
    expect(estado.cliente).toMatchObject({ id: 7, nombre: "Club Ficticio" });
  });

  it("duplicar: mismo contenido con precios actuales, parámetros vigentes, fechas nuevas y sin notas internas", () => {
    const d = estadoDuplicado(registroFicticio(), EMPRESA, new Date("2026-12-01T12:00:00"));
    expect(d.formulario.lineas.every((l) => l.precioGuardado === undefined)).toBe(true);
    expect(d.formulario.lineas.map((l) => l.quantity)).toEqual(["6", "4"]);
    expect(d.parametrosVersion).toBeNull();
    expect(d.documento).toMatchObject({ fechaEmision: "2026-12-01", validoHasta: "2026-12-31", notas: "", observaciones: "Logo en blanc" });
  });

  it("conservación: recalcular con los parámetros de su versión reproduce el resultado al céntimo", () => {
    const r = registroFicticio();
    expect(reproducir(r, PARAMETROS_EJEMPLO)).toEqual({ reproducible: true, coincide: true, diferencias: [] });
    const otros = reproducir(r, { ...PARAMETROS_EJEMPLO, manoObraEurHora: 30 });
    expect(otros.coincide).toBe(false);
    expect(otros.diferencias[0]).toMatch(/^coste total/);
    expect(reproducir({ ...r, motor: "serigrafia-coste-real/1" }, PARAMETROS_EJEMPLO).reproducible).toBe(false);
  });

  it("datos iniciales del documento según la empresa", () => {
    expect(datosDocumentoIniciales(EMPRESA, new Date("2026-10-17T09:00:00"))).toMatchObject({
      idioma: "va", fechaEmision: "2026-10-17", validoHasta: "2026-11-16", condiciones: CONDICIONES_POR_DEFECTO.va.join("\n"),
    });
    expect(datosDocumentoIniciales({}, new Date("2026-10-17T09:00:00")).validoHasta).toBe("");
    expect(instantaneaCliente({ nombre: " Ana ", email: "", nif: null })).toEqual({ nombre: "Ana" });
  });
});

describe("documento para el cliente", () => {
  const INTERNOS = (r) => [
    String(r.coste_total_cent), String(r.beneficio_cent), String(r.precio_recomendado_cent),
    (r.coste_total_cent / 100).toFixed(2).replace(".", ","), "Nota interna", "coste", "beneficio", "margen",
  ];

  it("en valenciano: número, fecha, cliente, líneas, impresión, total y condiciones", () => {
    const doc = construirDocumento(registroFicticio(), EMPRESA);
    expect(doc.titulo).toBe("PRESSUPOST");
    expect(doc.referencia).toBe("Nº 2026/003   17/10/2026");
    expect(doc.validoHasta).toBe("Vàlid fins a: 16/11/2026");
    expect(doc.emisor.lineas[0]).toBe("Titular Ficticio   ·   NIF 00000000T");
    expect(doc.cliente).toMatchObject({ titulo: "CLIENT", nombre: "Club Ficticio" });
    expect(doc.cliente.lineas).toContain("NIF / CIF: G00000000");
    expect(doc.tabla.columnas).toEqual(["MARCA / MODEL", "TALLA / COLOR", "UTS."]);
    expect(doc.tabla.filas).toEqual([["Camiseta Demo Básica", "M  ·  Color", "6"], ["Camiseta Demo Básica", "L  ·  Blanca", "4"]]);
    expect(doc.impresion.lineas).toEqual(["Davant: 1 color", "Darrere: 1 color"]);
    expect(doc.resumen).toEqual({ unidades: "Total d’unitats: 10", precioUnidad: `Preu per unitat: ${euros(1500)}`, etiquetaTotal: "TOTAL PRESSUPOST", total: euros(15000) });
    expect(doc.observaciones.texto).toBe("Logo en blanc");
    expect(doc.condiciones.lineas).toEqual(["Pagament: 50 % en acceptar el pressupost."]);
    expect(doc.aviso).toBe("Pressupost informatiu. No és una factura.");
    expect(doc.nombreArchivo).toBe("Pressupost_2026-003_Galipau_Arts.pdf");
  });

  it("en castellano", () => {
    const doc = construirDocumento(registroFicticio({ idioma: "es" }), EMPRESA);
    expect(doc.titulo).toBe("PRESUPUESTO");
    expect(doc.impresion.lineas).toEqual(["Delantera: 1 color", "Trasera: 1 color"]);
    expect(doc.resumen.etiquetaTotal).toBe("TOTAL PRESUPUESTO");
  });

  it("no revela costes, márgenes, beneficios ni notas internas, y no declara exención de IVA", () => {
    const r = registroFicticio();
    const texto = JSON.stringify(construirDocumento(r, EMPRESA)).toLowerCase();
    for (const dato of INTERNOS(r)) expect(texto).not.toContain(dato.toLowerCase());
    expect(texto).not.toMatch(/iva|exent|exempt/);
  });

  it("precio por unidad solo cuando el total se reparte exacto", () => {
    expect(construirDocumento(registroFicticio({ precio_final_cent: 15001 }), EMPRESA).resumen.precioUnidad).toBeNull();
  });

  it("borrador sin número", () => {
    const doc = construirDocumento(registroFicticio({ numero: null, estado: "borrador" }), EMPRESA);
    expect(doc.borrador).toBe("ESBORRANY");
    expect(doc.referencia).toBe("17/10/2026");
    expect(doc.nombreArchivo).toBe("Pressupost_ESBORRANY_Galipau_Arts.pdf");
  });

  it.each([
    [{ estado: "cancelado" }, /cancelado/],
    [{ estado: "importado" }, /importados/],
    [{ precio_final_cent: null }, /precio final/],
    [{ resultado: null }, /Calcula/],
  ])("rechaza %j", (cambio, mensaje) => {
    expect(() => construirDocumento(registroFicticio(cambio), EMPRESA)).toThrow(ErrorDocumento);
    expect(() => construirDocumento(registroFicticio(cambio), EMPRESA)).toThrow(mensaje);
  });
});

describe("PDF", () => {
  it("genera un PDF A4 con los datos comerciales y sin datos internos", async () => {
    const r = registroFicticio();
    const pdf = await generarPdf(construirDocumento(r, EMPRESA), { comprimir: false });
    const bytes = pdf.output("arraybuffer");
    const texto = new TextDecoder("latin1").decode(bytes);
    expect(texto.startsWith("%PDF-")).toBe(true);
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    for (const t of ["PRESSUPOST", "Club Ficticio", "TOTAL PRESSUPOST", "150,00", "Davant: 1 color", "Pagament"]) expect(texto).toContain(t);
    for (const dato of [String(r.coste_total_cent), "Nota interna"]) expect(texto).not.toContain(dato);
  });

  it("muchas líneas pasan a una segunda página con pie numerado", async () => {
    const f = formularioFicticio({ lineas: Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", size: "M", color: "Color", quantity: "1", precioManual: "", descripcion: `Prenda ${i + 1}` })) });
    const r = { ...registroFicticio(), ...construirRegistro({ cliente: CLIENTE_FICTICIO, formulario: f, calculo: calcularFicticio(f), parametrosVersion: 3, documento: DOCUMENTO_FICTICIO }) };
    const pdf = await generarPdf(construirDocumento(r, EMPRESA), { comprimir: false });
    expect(pdf.getNumberOfPages()).toBeGreaterThan(1);
    expect(new TextDecoder("latin1").decode(pdf.output("arraybuffer"))).toContain("Prenda 40");
  });
});

describe("resúmenes del editor", () => {
  const empresa = { condiciones: { va: ["Pagament: 50 %", "Recollida al taller"], es: ["Pago: 50 %"] } };
  const doc = (cambios) => ({ idioma: "va", fechaEmision: "2026-10-22", validoHasta: "2026-11-21", observaciones: "", condiciones: "Pagament: 50 %\nRecollida al taller", notas: "", ...cambios });

  it("resume el documento: idioma, fechas, observaciones y si las condiciones son las de siempre", () => {
    expect(resumenDocumento(doc(), empresa)).toBe("Valencià · fecha 22/10/2026 · válido hasta 21/11/2026 · sin observaciones · condiciones por defecto");
    expect(resumenDocumento(doc({ idioma: "es" }), empresa)).toMatch(/Castellano .* 2 condiciones propias$/);
    expect(resumenDocumento(doc({ validoHasta: "", condiciones: " ", observaciones: "Entrega urgente antes del viernes para el torneo del club" }), empresa))
      .toBe("Valencià · fecha 22/10/2026 · sin fecha de validez · observaciones: «Entrega urgente antes del viernes para…» · sin condiciones");
    expect(resumenDocumento(doc(), null)).toMatch(/2 condiciones propias$/);
  });

  it("resume las notas internas en una línea", () => {
    expect(resumenNotas("")).toMatch(/^Sin notas/);
    expect(resumenNotas("Primera\nSegunda")).toBe("Primera Segunda");
    expect(resumenNotas("x".repeat(120))).toHaveLength(90);
  });
});
