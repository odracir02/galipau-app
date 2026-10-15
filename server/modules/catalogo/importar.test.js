import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BaseDatos } from "../../db/baseDatos.js";
import { migrar } from "../../db/migrar.js";
import { importarCatalogo, eurosACent } from "./importar.js";
import { crearRepositorioCatalogo } from "./repositorio.js";
import { calcularPresupuesto } from "../../../src/domain/calculo/index.js";

// FICTITIOUS data with the shape of the legacy Firestore "productos" collection
const PRODUCTOS = [
  { id: "a1", tipo: "Camiseta", proveedor: "Demo A", modelo: "Básica", talla: "M", color: "Blanca", coste: "2" },
  { id: "a2", tipo: "Camiseta", proveedor: "Demo A", modelo: "Básica", talla: "M", color: "Negro", coste: "2.35" },
  { id: "a3", tipo: "Camiseta", proveedor: "Demo A", modelo: "Básica", talla: "L", color: "Negro", coste: 2.6 },
  { id: "b1", tipo: "Sudadera", proveedor: "Demo B", modelo: "Capucha", talla: "L", color: "Gris", coste: "11,40" },
];

let bd;
beforeEach(async () => {
  bd = new BaseDatos(":memory:");
  bd.abrir();
  await migrar(bd);
});
afterEach(() => bd.cerrar());

describe("eurosACent", () => {
  it.each([
    ["2.35", 235], [2.35, 235], ["11,40", 1140], ["2", 200], [0, 0], ["0.1", 10], [19.99, 1999],
    ["-1", null], ["2.355", null], ["abc", null], ["", null], [null, null],
  ])("%j → %j", (entrada, esperado) => expect(eurosACent(entrada)).toBe(esperado));
});

describe("importarCatalogo", () => {
  it("crea proveedores, modelos y variantes con costes en céntimos", () => {
    const informe = importarCatalogo(bd, PRODUCTOS);
    expect(informe).toMatchObject({ total: 4, importadas: 4, actualizadas: 0, sinCambios: 0, rechazadas: [] });
    expect(crearRepositorioCatalogo(bd).resumen()).toEqual({ proveedores: 2, modelos: 2, variantes: 4 });
  });

  it("es idempotente y actualiza costes cambiados", () => {
    importarCatalogo(bd, PRODUCTOS);
    expect(importarCatalogo(bd, PRODUCTOS)).toMatchObject({ importadas: 0, sinCambios: 4 });
    const cambiado = PRODUCTOS.map((p) => (p.id === "a2" ? { ...p, coste: "2.50" } : p));
    expect(importarCatalogo(bd, cambiado)).toMatchObject({ actualizadas: 1, sinCambios: 3 });
    expect(crearRepositorioCatalogo(bd).resumen().variantes).toBe(4);
  });

  it("informa de las filas inválidas sin importarlas", () => {
    const informe = importarCatalogo(bd, [...PRODUCTOS, { id: "x", tipo: "Polo", proveedor: "", modelo: "M", talla: "S", color: "Rojo", coste: "abc" }]);
    expect(informe.importadas).toBe(4);
    expect(informe.rechazadas).toEqual([{ indice: 4, id: "x", errores: ["falta proveedor", 'coste no válido ("abc")'] }]);
  });

  it("modo solo validar no escribe nada", () => {
    importarCatalogo(bd, PRODUCTOS, { soloValidar: true });
    expect(crearRepositorioCatalogo(bd).resumen().variantes).toBe(0);
  });

  it("el catálogo plano conserva los datos originales (coste en euros)", () => {
    importarCatalogo(bd, PRODUCTOS);
    const plano = crearRepositorioCatalogo(bd).listarPlano();
    const clave = (p) => [p.tipo, p.proveedor, p.modelo, p.talla, p.color].join("|");
    const esperado = PRODUCTOS.map((p) => [clave(p), Number(String(p.coste).replace(",", "."))]).sort();
    expect(plano.map((p) => [clave(p), p.coste]).sort()).toEqual(esperado);
  });

  it("la calculadora da el mismo resultado con el catálogo de SQLite que con el original", () => {
    importarCatalogo(bd, PRODUCTOS);
    const plano = crearRepositorioCatalogo(bd).listarPlano();
    const bloques = [
      {
        id: "b1", estampado: "DTF", zonas: 2, area: "300", numColores: "",
        lineas: [
          { id: "l1", tipo: "Camiseta", proveedor: "Demo A", modelo: "Básica", size: "M", color: "Blanca", quantity: "12" },
          { id: "l2", tipo: "Camiseta", proveedor: "Demo A", modelo: "Básica", size: "L", color: "Color", quantity: "7" },
        ],
      },
      {
        id: "b2", estampado: "Serigrafía", zonas: 1, area: "", numColores: "2",
        lineas: [{ id: "l3", tipo: "Sudadera", proveedor: "Demo B", modelo: "Capucha", size: "L", color: "Color", quantity: "25" }],
      },
    ];
    const original = PRODUCTOS.map((p) => ({ ...p, coste: String(p.coste).replace(",", ".") }));
    const conOriginal = calcularPresupuesto({ clientName: "C", bloques, productos: original });
    const conSqlite = calcularPresupuesto({ clientName: "C", bloques, productos: plano });
    expect(conSqlite.resultado).toEqual(conOriginal.resultado);
  });
});
