// Catalogue import preview with FICTITIOUS rows (no real suppliers or prices).
import { describe, it, expect } from "vitest";
import { normalizarFila, prepararCatalogo, conciliarCatalogo, filasParaImportar, costeExacto, extraerProductos, claveModelo } from "./catalogo";
import { copiaReciente } from "./copias";

const excel = (cambios = {}) => ({ proveedor: "Marca A", modelo: "BASE", color: "BLANCO", talla: "M", precio_neto: 2.5, iva: 0.21, coste: 3.025, ...cambios });

describe("normalización de filas", () => {
  it("neto + IVA de la hoja maestra: coste exacto con 4 decimales y céntimos redondeados aparte", () => {
    const { fila, motivo } = normalizarFila(excel());
    expect(motivo).toBeUndefined();
    expect(fila).toMatchObject({ precio_neto: 2.5, iva_porcentaje: 21, coste_cent: 303 });
    expect(costeExacto(fila)).toBeCloseTo(3.025, 10);
  });

  it("neto con tres decimales (2,125 €): se conserva y el coste es exacto", () => {
    const { fila, motivo } = normalizarFila(excel({ precio_neto: 2.125, coste: 2.57125 }));
    expect(motivo).toBeUndefined();
    expect(fila).toMatchObject({ precio_neto: 2.125, coste_cent: 257 });
    expect(costeExacto(fila)).toBeCloseTo(2.57125, 10);
  });

  it("IVA como 21 o como 0,21; coste opcional", () => {
    expect(normalizarFila(excel({ iva: 21, coste: undefined })).fila.iva_porcentaje).toBe(21);
    expect(normalizarFila(excel({ iva: "0,21" })).fila.iva_porcentaje).toBe(21);
  });

  it("solo coste (Firestore): sin neto ni IVA, no se añade IVA", () => {
    const { fila } = normalizarFila({ proveedor: "P", modelo: "M", color: "Negro", talla: "L", coste: "4,15" });
    expect(fila).toMatchObject({ precio_neto: null, iva_porcentaje: null, coste_cent: 415 });
  });

  it.each([
    [{ proveedor: "" }, /Falta: proveedor/],
    [{ iva: undefined }, /no los dos/],
    [{ precio_neto: 2.50555, coste: undefined }, /más de cuatro decimales/],
    [{ coste: 3.6 }, /no coincide/],
    [{ iva: 1.5 }, /fuera de rango|no coincide/],
    [{ precio_neto: undefined, iva: undefined, coste: "abc" }, /Coste no válido/],
  ])("rechaza %j", (cambio, mensaje) => {
    expect(normalizarFila(excel(cambio)).motivo).toMatch(mensaje);
  });
});

describe("vista previa", () => {
  it("duplicados idénticos, conflictos de precio y tipo de prenda obligatorio por modelo", () => {
    const filas = [excel(), excel(), excel({ talla: "L", precio_neto: 3, coste: undefined }), excel({ talla: "L", precio_neto: 3.1, coste: undefined }), excel({ modelo: "OTRO", tipo: "Polo" })];
    const p = prepararCatalogo(filas);
    expect(p.resumen).toMatchObject({ leidos: 5, validasUnicas: 2, nuevas: 2, conflictos: 1, repetidasIdenticas: 1, modelos: 2 });
    expect(p.modelosSinTipo.map((m) => m.modelo)).toEqual(["BASE"]);
    expect(p.listoParaImportar).toBe(false);
    const conTipo = prepararCatalogo(filas, [], { [claveModelo({ proveedor: "Marca A", modelo: "BASE" })]: "Camiseta" });
    expect(conTipo.listoParaImportar).toBe(true);
    expect(filasParaImportar(conTipo.nuevas)[0]).toEqual({ proveedor: "Marca A", modelo: "BASE", color: "BLANCO", talla: "M", tipo: "Camiseta", referencia: "", precio_neto: 2.5, iva_porcentaje: 21, coste_cent: 303 });
  });

  it("compara con Supabase por coste exacto (sin confundir 3,025 con 3,59) e ignora mayúsculas", () => {
    const actuales = [{ proveedor: "MARCA A", modelo: "base", color: "blanco", talla: "m", tipo: "Camiseta", coste_cent: 303, coste: 3.025 }];
    const p = prepararCatalogo([excel(), excel({ talla: "L" })], actuales);
    expect(p.resumen).toMatchObject({ existentes: 1, nuevas: 1, cambiosCoste: 0 });
    expect(p.modelosSinTipo).toEqual([]); // the model already exists with its type
    const redondeado = prepararCatalogo([excel()], [{ ...actuales[0], coste: 3.59 }]);
    expect(redondeado.resumen.cambiosCoste).toBe(1);
  });

  it("repetir con el mismo origen después de importar no propone nada nuevo", () => {
    const tipos = { [claveModelo({ proveedor: "Marca A", modelo: "BASE" })]: "Camiseta" };
    const primera = prepararCatalogo([excel(), excel({ talla: "L" })], [], tipos);
    const catalogo = primera.nuevas.map((f, i) => ({ id: i, ...f, coste: costeExacto(f) }));
    const segunda = prepararCatalogo([excel(), excel({ talla: "L" })], catalogo, tipos);
    expect(segunda.resumen).toMatchObject({ nuevas: 0, existentes: 2 });
  });

  it("conciliación tras importar: recuento y precio de cada producto del origen", () => {
    const p = prepararCatalogo([excel(), excel({ talla: "L" })], [], { "marca a|base": "Camiseta" });
    const despues = p.nuevas.map((f) => ({ ...f, coste: costeExacto(f) }));
    expect(conciliarCatalogo(p.validas, despues)).toMatchObject({ esperadas: 2, encontradas: 2, correcto: true });
    expect(conciliarCatalogo(p.validas, despues.slice(1))).toMatchObject({ encontradas: 1, correcto: false });
    expect(conciliarCatalogo(p.validas, [{ ...despues[0], coste: 3.59 }, despues[1]]).costeDistinto).toHaveLength(1);
  });

  it("acepta una lista o un archivo { productos }", () => {
    expect(extraerProductos([1])).toEqual([1]);
    expect(extraerProductos({ productos: [2] })).toEqual([2]);
    expect(() => extraerProductos({})).toThrow(/lista de productos/);
  });

  it("copia de seguridad reciente: correcta y de menos de 48 horas", () => {
    const ahora = Date.parse("2026-10-17T12:00:00Z");
    expect(copiaReciente({ base_datos: { estado: "correcta", creada_en: "2026-10-16T13:00:00Z" } }, ahora)).toBe(true);
    expect(copiaReciente({ base_datos: { estado: "correcta", creada_en: "2026-10-14T12:00:00Z" } }, ahora)).toBe(false);
    expect(copiaReciente({ base_datos: { estado: "fallida", creada_en: "2026-10-17T11:00:00Z" } }, ahora)).toBe(false);
    expect(copiaReciente({}, ahora)).toBe(false);
  });
});
