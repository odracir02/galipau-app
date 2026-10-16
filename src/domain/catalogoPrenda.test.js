// Exact garment selection (supplier -> model -> colour -> size) with FICTITIOUS products.
import { describe, it, expect } from "vitest";
import { opcionesPrenda, elegirEnPrenda, productoPorId } from "./catalogo";
import { construirEntrada } from "../modules/calculadora/construirEntrada";
import { construirRegistro, estadoDesdeRegistro, lineaVacia } from "../modules/presupuestos/domain/instantanea";
import { calcularCosteSerigrafia } from "./calculo/serigrafia/motor";
import { PARAMETROS_EJEMPLO } from "./calculo/serigrafia/parametros";

const P = [
  { id: "1", tipo: "Camiseta", proveedor: "Marca A", modelo: "BASE", color: "BLANCO", talla: "M", coste: 3.025 },
  { id: "2", tipo: "Camiseta", proveedor: "Marca A", modelo: "BASE", color: "BLANCO", talla: "XXS", coste: 3.025 },
  { id: "3", tipo: "Camiseta", proveedor: "Marca A", modelo: "BASE", color: "COLOR", talla: "3XL", coste: 3.3275 },
  { id: "4", tipo: "Camiseta niño", proveedor: "Marca A", modelo: "KIDS", color: "COLOR", talla: "10A", coste: 2.8 },
  { id: "5", tipo: "Camiseta niño", proveedor: "Marca A", modelo: "KIDS", color: "COLOR", talla: "02A", coste: 2.8 },
  { id: "6", tipo: "Polo", proveedor: "Marca B", modelo: "POLO", color: "MARRON", talla: "TU", coste: 7 },
];

const elegir = (pasos) => pasos.reduce((l, [c, v]) => elegirEnPrenda(l, c, v, P), lineaVacia());

describe("selectores dependientes", () => {
  it("solo ofrecen combinaciones existentes, en orden", () => {
    let l = lineaVacia();
    expect(opcionesPrenda(P, l).proveedores).toEqual(["Marca A", "Marca B"]);
    expect(opcionesPrenda(P, l).modelos).toEqual([]);
    l = elegir([["proveedor", "Marca A"]]);
    expect(opcionesPrenda(P, l).modelos).toEqual(["BASE", "KIDS"]);
    l = elegir([["proveedor", "Marca A"], ["modelo", "BASE"]]);
    expect(opcionesPrenda(P, l).colores).toEqual(["BLANCO", "COLOR"]);
    l = elegir([["proveedor", "Marca A"], ["modelo", "BASE"], ["color", "BLANCO"]]);
    expect(opcionesPrenda(P, l).tallas).toEqual(["XXS", "M"]);
    l = elegir([["proveedor", "Marca A"], ["modelo", "KIDS"], ["color", "COLOR"]]);
    expect(opcionesPrenda(P, l).tallas).toEqual(["02A", "10A"]);
  });

  it("elegir la talla fija el producto exacto y su tipo; cambiar un nivel borra los de abajo", () => {
    const l = elegir([["proveedor", "Marca A"], ["modelo", "BASE"], ["color", "COLOR"], ["size", "3XL"]]);
    expect(l).toMatchObject({ productoId: "3", tipo: "Camiseta" });
    const otra = elegirEnPrenda({ ...l, precioGuardado: 4 }, "modelo", "KIDS", P);
    expect(otra).toMatchObject({ modelo: "KIDS", color: "", size: "", productoId: "" });
    expect(otra.precioGuardado).toBeUndefined();
  });

  it("búsqueda por proveedor, modelo o tipo (sin tildes ni mayúsculas)", () => {
    expect(opcionesPrenda(P, lineaVacia(), "polo").proveedores).toEqual(["Marca B"]);
    expect(opcionesPrenda(P, { ...lineaVacia(), proveedor: "Marca A" }, "niño").modelos).toEqual(["KIDS"]);
    expect(productoPorId(P, "6").talla).toBe("TU");
    expect(productoPorId(P, "99")).toBeNull();
  });
});

describe("precio del catálogo en el cálculo", () => {
  const formulario = (linea, cambios = {}) => ({
    lineas: [{ ...linea, quantity: "120" }], zonas: [{ nombre: "Delantera", colores: "1" }], minutosDiseno: "0", mermaPorcentaje: "0", precioFinal: "", ...cambios,
  });

  it("usa el coste exacto de la variante (4 decimales), no el redondeado", () => {
    const l = elegir([["proveedor", "Marca A"], ["modelo", "BASE"], ["color", "COLOR"], ["size", "3XL"]]);
    const { entrada, detalle, problemas } = construirEntrada({ ...formulario(l), productos: P });
    expect(problemas).toEqual([]);
    expect(entrada.lineas[0]).toEqual({ cantidad: 120, precioUnitario: 3.3275 });
    expect(detalle[0]).toMatchObject({ descripcion: "Camiseta Marca A BASE", talla: "3XL", color: "COLOR", origen: "catalogo" });
    const r = calcularCosteSerigrafia(entrada, PARAMETROS_EJEMPLO);
    expect(r.costes.grupos[0].importe).toBeCloseTo(120 * 3.3275, 10);
  });

  it("el precio manual sigue mandando y no se toca el IVA", () => {
    const l = elegir([["proveedor", "Marca A"], ["modelo", "BASE"], ["color", "BLANCO"], ["size", "M"]]);
    expect(construirEntrada({ ...formulario({ ...l, precioManual: "3,10" }), productos: P }).entrada.lineas[0].precioUnitario).toBe(3.1);
  });

  it("si la variante desaparece del catálogo, lo avisa", () => {
    const l = elegir([["proveedor", "Marca A"], ["modelo", "BASE"], ["color", "BLANCO"], ["size", "M"]]);
    const { problemas } = construirEntrada({ ...formulario(l), productos: P.filter((p) => p.id !== "1") });
    expect(problemas[0]).toMatch(/ya no está en el catálogo/);
  });

  it("compatibilidad con presupuestos: se guarda el producto elegido y al reabrir conserva su precio", () => {
    const l = elegir([["proveedor", "Marca A"], ["modelo", "BASE"], ["color", "COLOR"], ["size", "3XL"]]);
    const f = formulario(l, { precioFinal: "1000" });
    const base = construirEntrada({ ...f, productos: P });
    const registro = construirRegistro({ cliente: null, formulario: f, calculo: { ...base, resultado: calcularCosteSerigrafia(base.entrada, PARAMETROS_EJEMPLO) }, parametrosVersion: 1, documento: { idioma: "es", fechaEmision: "2026-10-17" } });
    expect(registro.entrada.formulario.lineas[0].productoId).toBe("3");
    expect(registro.entrada.lineas[0]).toMatchObject({ precioUnitario: 3.3275, origen: "catalogo" });
    const reabierto = estadoDesdeRegistro(registro).formulario.lineas[0];
    expect(reabierto).toMatchObject({ productoId: "3", precioGuardado: 3.3275 });
    const subida = P.map((p) => (p.id === "3" ? { ...p, coste: 4.2 } : p));
    const { entrada, preciosCambiados } = construirEntrada({ ...estadoDesdeRegistro(registro).formulario, productos: subida });
    expect(entrada.lineas[0].precioUnitario).toBe(3.3275);
    expect(preciosCambiados).toEqual([{ linea: 1, guardado: 3.3275, actual: 4.2 }]);
  });

  it("los presupuestos antiguos (color agrupado Blanca/Color, sin producto) se siguen calculando", () => {
    const antiguo = { ...lineaVacia(), tipo: "Camiseta", proveedor: "Marca A", modelo: "BASE", size: "M", color: "Blanca" };
    const legado = [{ ...P[0], color: "Blanco" }];
    expect(construirEntrada({ ...formulario(antiguo), productos: legado }).entrada.lineas[0].precioUnitario).toBe(3.025);
  });
});
