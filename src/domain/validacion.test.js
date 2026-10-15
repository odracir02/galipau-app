import { describe, it, expect } from "vitest";
import { validarPresupuesto, esEnteroPositivo, esNumeroPositivo } from "./validacion";

const productos = [
  { tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "M", color: "Blanca", coste: "2" },
];

const lineaValida = { id: "l1", tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", size: "M", color: "Blanca", quantity: "10" };
const bloqueDTF = (extra = {}, lineas = [lineaValida]) => ({
  id: "b1", estampado: "DTF", zonas: 1, area: "300", numColores: "", lineas, ...extra,
});

const validar = (bloques, clientName = "Cliente") => validarPresupuesto({ clientName, bloques, productos });
const campos = (errores) => errores.map((e) => e.campo);

describe("esEnteroPositivo / esNumeroPositivo", () => {
  it.each([["1", true], ["25", true], [7, true], ["0", false], ["", false], ["-3", false], ["2.5", false], ["1e2", false], ["abc", false], [null, false]])(
    "esEnteroPositivo(%j) = %s",
    (valor, esperado) => expect(esEnteroPositivo(valor)).toBe(esperado)
  );

  it.each([["300", true], ["0.5", true], [12, true], ["0", false], ["-1", false], ["", false], ["abc", false], [undefined, false]])(
    "esNumeroPositivo(%j) = %s",
    (valor, esperado) => expect(esNumeroPositivo(valor)).toBe(esperado)
  );
});

describe("validarPresupuesto", () => {
  it("acepta un presupuesto completo", () => {
    expect(validar([bloqueDTF()])).toEqual([]);
  });

  it("exige el nombre del cliente", () => {
    expect(campos(validar([bloqueDTF()], "   "))).toEqual(["clientName"]);
  });

  it.each([[""], ["0"], ["-5"], ["2.5"], ["abc"]])("rechaza la cantidad %j", (quantity) => {
    const errores = validar([bloqueDTF({}, [{ ...lineaValida, quantity }])]);
    expect(errores).toHaveLength(1);
    expect(errores[0]).toMatchObject({ campo: "quantity", bloqueId: "b1", lineaId: "l1" });
    expect(errores[0].mensaje).toBe("Tipo 1, línea 1: la cantidad debe ser un número entero mayor que 0.");
  });

  it.each([[""], ["0"], ["-100"], ["abc"]])("rechaza el área DTF %j", (area) => {
    expect(campos(validar([bloqueDTF({ area })]))).toEqual(["area"]);
  });

  it("en serigrafía exige n.º de colores entero positivo y no el área", () => {
    expect(campos(validar([bloqueDTF({ estampado: "Serigrafía", area: "", numColores: "0" })]))).toEqual(["numColores"]);
    expect(validar([bloqueDTF({ estampado: "Serigrafía", area: "", numColores: "3" })])).toEqual([]);
  });

  it("rechaza zonas no válidas", () => {
    expect(campos(validar([bloqueDTF({ zonas: 7 })]))).toEqual(["zonas"]);
  });

  it("indica los desplegables vacíos de cada línea", () => {
    const errores = validar([bloqueDTF({}, [{ ...lineaValida, proveedor: "", modelo: "", size: "", color: "" }])]);
    expect(campos(errores)).toEqual(["proveedor", "modelo", "size", "color"]);
    expect(errores[2].mensaje).toBe("Tipo 1, línea 1: selecciona la talla.");
  });

  it("rechaza productos que no existen en el catálogo", () => {
    expect(campos(validar([bloqueDTF({}, [{ ...lineaValida, color: "Color" }])]))).toEqual(["producto"]);
  });

  it("falla si el catálogo no está disponible", () => {
    const errores = validarPresupuesto({ clientName: "C", bloques: [bloqueDTF()], productos: [] });
    expect(campos(errores)).toEqual(["catalogo"]);
  });

  it("numera bloques y líneas en los mensajes", () => {
    const b2 = { ...bloqueDTF({}, [lineaValida, { ...lineaValida, id: "l2", quantity: "" }]), id: "b2" };
    const errores = validar([bloqueDTF(), b2]);
    expect(errores[0].mensaje).toMatch(/^Tipo 2, línea 2:/);
  });
});
