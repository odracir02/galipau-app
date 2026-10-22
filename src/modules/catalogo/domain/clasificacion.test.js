// Category suggestions. FICTITIOUS model names.
import { describe, it, expect } from "vitest";
import { sugerirCategorias, familiaDe, resolverCategoria, SIN_CLASIFICAR, CATEGORIAS_PROPUESTAS } from "./clasificacion";

let n = 0;
const m = (nombre, extra = {}) => ({ id: ++n, nombre, proveedor_id: 1, tipo: SIN_CLASIFICAR, ...extra });
const CATS = ["Camiseta", "Polos", "Sin clasificar"];

describe("sugerencias de categoría", () => {
  it("una palabra explícita de prenda da confianza alta, en la categoría existente aunque cambie el plural", () => {
    const modelos = [m("ORION POLO"), m("Lyra", { descripcion: "Camiseta de algodón 150 g" }), m("VEGA HOODIE"), m("NUBE TOTE BAG")];
    const s = sugerirCategorias(modelos, CATS);
    expect(s.get(modelos[0].id)).toMatchObject({ categoria: "Polos", existe: true, confianza: "alta", revisar: false, motivo: "El nombre o la descripción dice «POLO»" });
    expect(s.get(modelos[1].id)).toMatchObject({ categoria: "Camiseta", existe: true, confianza: "alta" }); // "Camisetas" -> owner's "Camiseta"
    expect(s.get(modelos[2].id)).toMatchObject({ categoria: "Sudaderas", existe: false });
    expect(s.get(modelos[3].id)).toMatchObject({ categoria: "Bolsas y mochilas" });
  });

  it("los nombres comerciales sin otra evidencia se quedan sin sugerencia (también palabras ambiguas)", () => {
    const modelos = [m("ATLAS"), m("SPORTY MEN"), m("RACE HOODED"), m("NINO"), m("SHIRT 200"), m("CAPRICORN"), m("BAGUETTE")];
    expect(sugerirCategorias(modelos, CATS).size).toBe(0);
  });

  it("la misma familia del mismo proveedor ya clasificada sugiere esa categoría con confianza media", () => {
    const base = m("ORION", { tipo: "Camiseta" });
    const mujer = m("ORION WOMEN");
    const ajuste = m("ORION FIT LSL");
    const otroProveedor = m("ORION WOMEN 2", { proveedor_id: 2 });
    const s = sugerirCategorias([base, mujer, ajuste, otroProveedor], CATS);
    expect(s.get(mujer.id)).toMatchObject({ categoria: "Camiseta", confianza: "media", revisar: true });
    expect(s.get(mujer.id).motivo).toMatch(/Misma familia que ORION \(Camiseta\)/);
    expect(s.get(ajuste.id)).toMatchObject({ categoria: "Camiseta" });
    expect(s.has(otroProveedor.id)).toBe(false);
    expect(s.has(base.id)).toBe(false); // already classified: never suggested again
  });

  it("una familia con categorías distintas no sugiere nada; la versión infantil no hereda de la de adulto", () => {
    const a = m("VEGA", { tipo: "Camiseta" });
    const b = m("VEGA FIT", { tipo: "Polos" });
    const c = m("VEGA WOMEN");
    const kids = m("ORION KIDS");
    const adulto = m("ORION", { tipo: "Camiseta" });
    const s = sugerirCategorias([a, b, c, kids, adulto], CATS);
    expect(s.has(c.id)).toBe(false);
    expect(s.get(kids.id)).toMatchObject({ categoria: "Ropa infantil", confianza: "media", revisar: true });
  });

  it("familia, categorías existentes y lista propuesta", () => {
    expect(familiaDe("Regent Fit Women")).toBe("REGENT");
    expect(familiaDe("TEMPO 185 MEN")).toBe("TEMPO");
    expect(resolverCategoria("Gorras y accesorios", ["gorras y accesorio"])).toBe("gorras y accesorio");
    expect(resolverCategoria("Chaquetas", CATS)).toBeNull();
    expect(CATEGORIAS_PROPUESTAS).toContain(SIN_CLASIFICAR);
  });
});
