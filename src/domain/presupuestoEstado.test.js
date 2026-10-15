import { describe, it, expect } from "vitest";
import {
  crearBloque,
  crearLinea,
  actualizarCampoLinea,
  actualizarBloque,
  actualizarLinea,
  agregarLinea,
  eliminarLinea,
  agregarBloque,
  eliminarBloque,
} from "./presupuestoEstado";

const lineaCompleta = () => ({
  ...crearLinea(),
  proveedor: "Prov A",
  modelo: "Basic",
  size: "M",
  color: "Blanca",
  quantity: "10",
});

describe("identificadores", () => {
  it("son únicos aunque se creen en el mismo milisegundo", () => {
    const ids = new Set(Array.from({ length: 500 }, () => crearLinea().id));
    expect(ids.size).toBe(500);
    expect(crearBloque().id).not.toBe(crearBloque().id);
  });
});

describe("actualizarCampoLinea — reinicio de desplegables dependientes", () => {
  it.each([
    ["tipo", "Sudadera", ["proveedor", "modelo", "size", "color"]],
    ["proveedor", "Prov B", ["modelo", "size", "color"]],
    ["modelo", "Premium", ["size", "color"]],
    ["size", "L", ["color"]],
  ])("cambiar %s vacía %j", (campo, valor, vaciados) => {
    const original = lineaCompleta();
    const nueva = actualizarCampoLinea(original, campo, valor);
    expect(nueva[campo]).toBe(valor);
    for (const c of vaciados) expect(nueva[c]).toBe("");
    expect(nueva.quantity).toBe("10");
  });

  it("cambiar color o cantidad no vacía nada más", () => {
    const original = lineaCompleta();
    expect(actualizarCampoLinea(original, "color", "Color")).toMatchObject({ modelo: "Basic", size: "M" });
    expect(actualizarCampoLinea(original, "quantity", "5")).toMatchObject({ color: "Blanca", size: "M" });
  });

  it("volver a elegir el mismo valor no borra los campos dependientes", () => {
    const original = lineaCompleta();
    expect(actualizarCampoLinea(original, "proveedor", "Prov A")).toBe(original);
  });

  it("no modifica el objeto original", () => {
    const original = lineaCompleta();
    const copia = { ...original };
    actualizarCampoLinea(original, "tipo", "Polo");
    expect(original).toEqual(copia);
  });
});

describe("operaciones sobre bloques y líneas", () => {
  const inicial = () => {
    const b1 = crearBloque();
    const b2 = { ...crearBloque(), lineas: [lineaCompleta(), lineaCompleta()] };
    return [b1, b2];
  };

  it("actualizarBloque cambia solo el bloque indicado, sin mutar", () => {
    const bloques = inicial();
    const nuevos = actualizarBloque(bloques, bloques[1].id, "area", "300");
    expect(nuevos[1].area).toBe("300");
    expect(nuevos[0]).toBe(bloques[0]);
    expect(bloques[1].area).toBe("");
  });

  it("actualizarLinea cambia solo la línea indicada", () => {
    const bloques = inicial();
    const [l1, l2] = bloques[1].lineas;
    const nuevos = actualizarLinea(bloques, bloques[1].id, l2.id, "modelo", "Otro");
    expect(nuevos[1].lineas[0]).toBe(l1);
    expect(nuevos[1].lineas[1]).toMatchObject({ modelo: "Otro", size: "", color: "" });
  });

  it("agregarLinea añade una línea vacía con id nuevo", () => {
    const bloques = inicial();
    const nuevos = agregarLinea(bloques, bloques[0].id);
    expect(nuevos[0].lineas).toHaveLength(2);
    expect(nuevos[0].lineas[1].id).not.toBe(nuevos[0].lineas[0].id);
    expect(nuevos[0].lineas[1].quantity).toBe("");
  });

  it("eliminarLinea quita la línea indicada pero deja siempre al menos una", () => {
    const bloques = inicial();
    const [l1, l2] = bloques[1].lineas;
    const nuevos = eliminarLinea(bloques, bloques[1].id, l1.id);
    expect(nuevos[1].lineas).toEqual([l2]);
    const ultima = eliminarLinea(nuevos, bloques[1].id, l2.id);
    expect(ultima[1].lineas).toEqual([l2]);
  });

  it("agregarBloque y eliminarBloque mantienen al menos un bloque", () => {
    const bloques = inicial();
    expect(agregarBloque(bloques)).toHaveLength(3);
    const uno = eliminarBloque(bloques, bloques[0].id);
    expect(uno).toEqual([bloques[1]]);
    expect(eliminarBloque(uno, bloques[1].id)).toBe(uno);
  });
});
