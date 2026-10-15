import { describe, it, expect } from "vitest";
import {
  CLAVE_HISTORIAL,
  leerHistorial,
  guardarHistorial,
  eliminarPresupuesto,
  normalizarPresupuesto,
  formatearPresupuesto,
} from "./historialPresupuestos";
import { registroAntiguo, registroBloques, registroActual } from "./historialPresupuestos.fixtures";

const crearStorage = (inicial = {}) => {
  const datos = { ...inicial };
  return {
    datos,
    getItem: (k) => (k in datos ? datos[k] : null),
    setItem: (k, v) => {
      datos[k] = String(v);
    },
  };
};

describe("normalizarPresupuesto", () => {
  it("lee el formato actual (total, totalPrendas, lineas)", () => {
    const p = normalizarPresupuesto(registroActual);
    expect(p.cliente).toBe("Asociación Mixta");
    expect(p.total).toBe(252);
    expect(p.prendas).toBe(30);
    expect(p.tecnicas).toEqual(["DTF", "Serigrafía"]);
    expect(p.fecha?.toISOString()).toBe("2025-08-01T10:00:00.000Z");
  });

  it("lee el formato por bloques sin beneficioTotal", () => {
    const p = normalizarPresupuesto(registroBloques);
    expect(p.total).toBe(16.8);
    expect(p.prendas).toBe(8);
    expect(p.tecnicas).toEqual(["DTF"]);
  });

  it("lee el formato antiguo (printType, totalQuantity, totalPresupuesto)", () => {
    const p = normalizarPresupuesto(registroAntiguo);
    expect(p.total).toBe(22.8);
    expect(p.prendas).toBe(12);
    expect(p.tecnicas).toEqual(["Serigrafía"]);
  });

  it("muestra una sola técnica aunque se repita en varias líneas", () => {
    const p = normalizarPresupuesto({
      lineas: [{ estampado: "DTF" }, { estampado: "DTF" }, { estampado: " DTF " }],
    });
    expect(p.tecnicas).toEqual(["DTF"]);
  });

  it("obtiene las prendas sumando las líneas si falta el total guardado", () => {
    expect(normalizarPresupuesto({ lineas: [{ quantity: "3" }, { quantity: 4 }] }).prendas).toBe(7);
    expect(normalizarPresupuesto({ sizeEntries: [{ quantity: "2" }, { quantity: "5" }] }).prendas).toBe(7);
  });

  it("no inventa prendas si alguna línea tiene una cantidad no válida", () => {
    expect(normalizarPresupuesto({ lineas: [{ quantity: "3" }, { quantity: "" }] }).prendas).toBeNull();
  });

  it("devuelve null en los campos ausentes o no válidos", () => {
    const p = normalizarPresupuesto({ clientName: "  ", total: null, totalPrendas: "abc", fecha: "no es fecha" });
    expect(p).toEqual({ cliente: null, tecnicas: [], prendas: null, total: null, fecha: null });
  });

  it("acepta registros que no son objetos sin lanzar errores", () => {
    for (const valor of [null, undefined, 42, "texto", []]) {
      expect(() => normalizarPresupuesto(valor)).not.toThrow();
      expect(normalizarPresupuesto(valor).total).toBeNull();
    }
  });

  it("acepta importes guardados como texto numérico", () => {
    expect(normalizarPresupuesto({ total: "19.5" }).total).toBe(19.5);
  });

  it("no modifica el registro original", () => {
    const copia = JSON.parse(JSON.stringify(registroActual));
    normalizarPresupuesto(registroActual);
    expect(registroActual).toEqual(copia);
  });
});

describe("formatearPresupuesto", () => {
  it("formatea importes y técnicas mixtas", () => {
    const f = formatearPresupuesto(registroActual);
    expect(f.total).toBe("252.00 €");
    expect(f.tecnicas).toBe("DTF + Serigrafía");
    expect(f.prendas).toBe(30);
  });

  it("muestra un guion en los datos que faltan", () => {
    expect(formatearPresupuesto({})).toEqual({
      cliente: "—",
      tecnicas: "—",
      prendas: "—",
      total: "—",
      fecha: "—",
    });
  });
});

describe("leerHistorial", () => {
  it("devuelve [] si no hay nada guardado o no hay storage", () => {
    expect(leerHistorial(crearStorage())).toEqual([]);
    expect(leerHistorial(undefined)).toEqual([]);
  });

  it("devuelve los registros guardados en cualquier formato", () => {
    const lista = [registroAntiguo, registroBloques, registroActual];
    const storage = crearStorage({ [CLAVE_HISTORIAL]: JSON.stringify(lista) });
    expect(leerHistorial(storage)).toEqual(lista);
  });

  it("no falla con JSON corrupto ni con contenido que no es una lista, y no lo modifica", () => {
    const corrupto = crearStorage({ [CLAVE_HISTORIAL]: "{no-json" });
    expect(leerHistorial(corrupto)).toEqual([]);
    expect(corrupto.datos[CLAVE_HISTORIAL]).toBe("{no-json");

    const objeto = crearStorage({ [CLAVE_HISTORIAL]: '{"a":1}' });
    expect(leerHistorial(objeto)).toEqual([]);
    expect(objeto.datos[CLAVE_HISTORIAL]).toBe('{"a":1}');
  });

  it("no falla si el acceso a localStorage lanza una excepción", () => {
    const bloqueado = { getItem: () => { throw new Error("SecurityError"); } };
    expect(leerHistorial(bloqueado)).toEqual([]);
  });
});

describe("eliminarPresupuesto", () => {
  it("quita solo el elemento indicado y conserva el resto intacto", () => {
    const lista = [registroAntiguo, null, registroActual];
    const resultado = eliminarPresupuesto(lista, 1);
    expect(resultado).toEqual([registroAntiguo, registroActual]);
    expect(resultado[0]).toBe(registroAntiguo);
    expect(lista).toHaveLength(3);
  });

  it("al guardar tras eliminar, el resto de registros se conserva sin transformar", () => {
    const storage = crearStorage({
      [CLAVE_HISTORIAL]: JSON.stringify([registroAntiguo, registroBloques, registroActual]),
    });
    const lista = leerHistorial(storage);
    guardarHistorial(storage, eliminarPresupuesto(lista, 1));
    expect(JSON.parse(storage.datos[CLAVE_HISTORIAL])).toEqual([registroAntiguo, registroActual]);
  });
});
