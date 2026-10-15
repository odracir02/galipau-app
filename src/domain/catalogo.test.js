import { describe, it, expect } from "vitest";
import { categoriaColor, opcionesLinea, buscarProductos, resolverCostePrenda, normalizarTexto } from "./catalogo";

const catalogo = [
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "XL", color: "Blanco", coste: "2" },
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "S", color: "Negro", coste: "3" },
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "M", color: "BLANCA", coste: "2" },
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "M", color: "Rojo", coste: "3" },
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Premium", talla: "Niño", color: "Azul", coste: "4" },
  { tipo: "Camiseta", proveedor: "Prov B", modelo: "Eco", talla: "L", color: "Blanco roto", coste: "5" },
  { tipo: "Sudadera", proveedor: "Prov C", modelo: "Hood", talla: "L", color: "Gris", coste: "11" },
];

describe("categoriaColor", () => {
  it.each([
    ["Blanca", "Blanca"], ["blanco", "Blanca"], [" BLANCO ", "Blanca"], ["Blancá", "Blanca"],
    ["Negro", "Color"], ["Blanco roto", "Color"], ["", "Color"], [undefined, "Color"],
  ])("%s → %s", (color, esperado) => {
    expect(categoriaColor(color)).toBe(esperado);
  });
});

describe("normalizarTexto", () => {
  it("quita mayúsculas, tildes y espacios", () => {
    expect(normalizarTexto("  Serigrafía ")).toBe("serigrafia");
    expect(normalizarTexto(null)).toBe("");
  });
});

describe("opcionesLinea", () => {
  it("filtra cada nivel por los anteriores y ordena las tallas", () => {
    const op = opcionesLinea(catalogo, { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", size: "M" });
    expect(op.proveedores).toEqual(["Prov A", "Prov B"]);
    expect(op.modelos).toEqual(["Basic", "Premium"]);
    expect(op.tallas).toEqual(["S", "M", "XL"]);
    expect(op.colores).toEqual(["Blanca", "Color"]);
  });

  it("devuelve listas vacías mientras no se elige el nivel superior", () => {
    const op = opcionesLinea(catalogo, { tipo: "Polo", proveedor: "", modelo: "", size: "" });
    expect(op).toEqual({ proveedores: [], modelos: [], tallas: [], colores: [] });
  });
});

describe("buscarProductos / resolverCostePrenda", () => {
  const base = { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", size: "M" };

  it("encuentra la prenda blanca aunque el catálogo use otra grafía", () => {
    expect(buscarProductos(catalogo, { ...base, color: "Blanca" })).toHaveLength(1);
    expect(resolverCostePrenda(catalogo, { ...base, color: "Blanca" })).toMatchObject({ encontrado: true, coste: 2 });
  });

  it("'Color' excluye la prenda blanca", () => {
    const r = resolverCostePrenda(catalogo, { ...base, color: "Color" });
    expect(r).toMatchObject({ encontrado: true, coste: 3, costesDistintos: false });
  });

  it("'Blanco roto' se trata como color, igual que en el desplegable", () => {
    const linea = { tipo: "Camiseta", proveedor: "Prov B", modelo: "Eco", size: "L" };
    expect(buscarProductos(catalogo, { ...linea, color: "Blanca" })).toHaveLength(0);
    expect(buscarProductos(catalogo, { ...linea, color: "Color" })).toHaveLength(1);
  });

  it("indica cuando no encuentra el producto", () => {
    expect(resolverCostePrenda(catalogo, { ...base, modelo: "X", color: "Color" })).toEqual({
      encontrado: false, coste: 0, costesDistintos: false,
    });
  });

  it("detecta costes distintos dentro del mismo grupo de color y usa el primero", () => {
    const cat = [
      { tipo: "Polo", proveedor: "P", modelo: "M", talla: "L", color: "Rojo", coste: "4" },
      { tipo: "Polo", proveedor: "P", modelo: "M", talla: "L", color: "Azul", coste: "4.5" },
    ];
    const r = resolverCostePrenda(cat, { tipo: "Polo", proveedor: "P", modelo: "M", size: "L", color: "Color" });
    expect(r).toMatchObject({ coste: 4, costesDistintos: true });
  });

  it("un coste ausente cuenta como 0 (comportamiento actual)", () => {
    const cat = [{ tipo: "Polo", proveedor: "P", modelo: "M", talla: "L", color: "Rojo" }];
    expect(resolverCostePrenda(cat, { tipo: "Polo", proveedor: "P", modelo: "M", size: "L", color: "Color" }).coste).toBe(0);
  });
});
