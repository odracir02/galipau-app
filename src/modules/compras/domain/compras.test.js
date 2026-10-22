import { describe, it, expect } from "vitest";
import {
  agruparPorProveedor, agruparLineas, textoParaProveedor, urlWebSegura, avisoCaja, siguientePasoCompra, recepcionInicial, lineasParaRecibir, erroresRecepcion, resumenRecepcion,
} from "./compras";

const fila = (cambios) => ({ variante_id: 1, proveedor_id: 1, proveedor: "Proveedor Ficticio", modelo: "Base", color: "NEGRO", talla: "M", para_pedidos: 0, reposicion: 0, ...cambios });

describe("por comprar", () => {
  it("agrupa por proveedor, separa pedidos y reposición, y ordena por la entrega más próxima", () => {
    const grupos = agruparPorProveedor(
      [
        fila({ variante_id: 1, talla: "M", para_pedidos: 7 }),
        fila({ variante_id: 2, talla: "L", para_pedidos: 5, reposicion: 2 }),
        fila({ variante_id: 3, proveedor_id: 2, proveedor: "Otro", modelo: "Polo", reposicion: 4 }),
        fila({ variante_id: 4, proveedor_id: 3, proveedor: "Tercero", modelo: "Sudadera", para_pedidos: 1 }),
      ],
      [
        { variante_id: 1, pedido_id: 10, numero: "P-2026/010", fecha_entrega: "2026-11-20", pendiente_comprar: 7 },
        { variante_id: 2, pedido_id: 11, numero: "P-2026/011", fecha_entrega: "2026-11-10", pendiente_comprar: 5 },
        { variante_id: 4, pedido_id: 12, numero: "P-2026/012", fecha_entrega: null, pendiente_comprar: 1 },
      ],
      [{ id: 5, proveedor_id: 1, estado: "borrador", numero: "C-2026/005" }, { id: 6, proveedor_id: 2, estado: "pedida" }]
    );
    expect(grupos.map((g) => [g.proveedor, g.unidades, g.paraPedidos, g.reposicion, g.modelos])).toEqual([
      ["Proveedor Ficticio", 14, 12, 2, 1],
      ["Tercero", 1, 1, 0, 1],
      ["Otro", 4, 0, 4, 1],
    ]);
    expect(grupos[0].pedidos.map((p) => p.numero)).toEqual(["P-2026/011", "P-2026/010"]);
    expect(grupos[0].primeraEntrega).toBe("2026-11-10");
    expect(grupos[0].borrador?.numero).toBe("C-2026/005");
    expect(grupos[2].borrador).toBeNull();
  });
});

describe("líneas y texto para el proveedor", () => {
  const lineas = [
    { id: 1, modelo: "Base", color: "NEGRO", referencia: "B-100", talla: "XL", cantidad: 3 },
    { id: 2, modelo: "Base", color: "NEGRO", referencia: "B-100", talla: "S", cantidad: 2 },
    { id: 3, modelo: "Polo", color: "BLANCO", referencia: null, talla: "M", cantidad: 1 },
  ];
  it("agrupa por modelo y color con las tallas en orden de prenda", () => {
    expect(agruparLineas(lineas).map((g) => [g.modelo, g.color, g.lineas.map((l) => l.talla)])).toEqual([["Base", "NEGRO", ["S", "XL"]], ["Polo", "BLANCO", ["M"]]]);
  });
  it("texto para mirar al comprar en la web", () => {
    expect(textoParaProveedor({ numero: "C-2026/001", proveedor: "Proveedor Ficticio" }, lineas)).toBe(
      "Compra C-2026/001 · Proveedor Ficticio\nB-100 · Base · NEGRO → S: 2 · XL: 3\nPolo · BLANCO → M: 1\nTotal: 6 prendas"
    );
  });
});

describe("web del proveedor", () => {
  it("solo direcciones http(s) válidas; sin esquema se entiende https", () => {
    expect(urlWebSegura("https://proveedor.example.com/tienda")).toBe("https://proveedor.example.com/tienda");
    expect(urlWebSegura("www.proveedor.example.com")).toBe("https://www.proveedor.example.com/");
    expect(urlWebSegura("javascript:alert(1)")).toBeNull();
    expect(urlWebSegura("ftp://proveedor.example.com")).toBeNull();
    expect(urlWebSegura("no es una web")).toBeNull();
    expect(urlWebSegura("localhost")).toBeNull();
    expect(urlWebSegura("")).toBeNull();
    expect(urlWebSegura(null)).toBeNull();
  });
});

describe("avisos", () => {
  it("cajas: solo avisa si hay dato del proveedor y la cantidad no es un número de cajas; nunca redondea", () => {
    expect(avisoCaja({ caja_unidades: 50, cantidad: 46 })).toBe("El proveedor también la vende en cajas de 50: pides 46.");
    expect(avisoCaja({ caja_unidades: 50, cantidad: 100 })).toBeNull();
    expect(avisoCaja({ caja_unidades: null, cantidad: 7 })).toBeNull();
  });
  it("siguiente paso según la situación", () => {
    expect(siguientePasoCompra({ situacion: "borrador", lineas: 2 })).toMatch(/Marcar como pedida/);
    expect(siguientePasoCompra({ situacion: "borrador", lineas: 0 })).toMatch(/Añade/);
    expect(siguientePasoCompra({ situacion: "pedida" })).toMatch(/Registrar llegada/);
    expect(siguientePasoCompra({ situacion: "parcial", pendientes: 1 })).toMatch(/Faltan por llegar 1 prenda:/);
    expect(siguientePasoCompra({ situacion: "recibida" })).toBe("");
  });
});

describe("recepción", () => {
  const lineas = [
    { id: 1, modelo: "Base", color: "NEGRO", talla: "L", pendiente: 5, precio_neto: 2.5 },
    { id: 2, modelo: "Base", color: "NEGRO", talla: "M", pendiente: 2, precio_neto: "2.1250" },
    { id: 3, modelo: "Base", color: "NEGRO", talla: "S", pendiente: 0, precio_neto: 2.5 },
  ];
  it("viene rellena con lo pendiente, en orden de talla", () => {
    expect(recepcionInicial(lineas)).toEqual([
      { compra_linea_id: 2, descripcion: "Base · NEGRO M", pendiente: 2, cantidad: "2", precioPrevisto: "2,125", precio: "2,125" },
      { compra_linea_id: 1, descripcion: "Base · NEGRO L", pendiente: 5, cantidad: "5", precioPrevisto: "2,5", precio: "2,5" },
    ]);
  });
  it("envía solo lo llegado, y el precio solo si cambia", () => {
    const filas = recepcionInicial(lineas);
    filas[0].cantidad = "0";
    filas[1].precio = "2,20";
    expect(lineasParaRecibir(filas)).toEqual([{ compra_linea_id: 1, cantidad: 5, precio_neto: 2.2 }]);
    expect(erroresRecepcion(filas)).toEqual([]);
    expect(erroresRecepcion([{ ...filas[1], cantidad: "2,5" }])).toEqual(["Base · NEGRO L: escribe un número entero de prendas."]);
    expect(erroresRecepcion([{ ...filas[1], cantidad: "0" }])).toEqual(["Indica cuántas prendas han llegado."]);
  });
  it("resume en palabras lo que hará la llegada", () => {
    const plan = {
      entradas: [{ cantidad: 5 }, { cantidad: 4 }],
      reservas: [{ numero: "P-2026/002", cantidad: 4 }, { numero: "P-2026/001", cantidad: 1 }, { numero: "P-2026/002", cantidad: 2 }],
      libres: [{ cantidad: 2 }],
      listos: [{ numero: "P-2026/002" }],
      exceso: 0,
    };
    expect(resumenRecepcion(plan)).toEqual({ entran: 9, reservas: [{ numero: "P-2026/002", cantidad: 6 }, { numero: "P-2026/001", cantidad: 1 }], reservadas: 7, libres: 2, listos: ["P-2026/002"], exceso: 0 });
  });
});
