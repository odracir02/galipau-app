// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import QuoteForm from "./QuoteForm";
import { getProductos } from "../services/getProductos";
import { CLAVE_HISTORIAL } from "../domain/historialPresupuestos";

// The Firestore service is always mocked: these tests never reach real data.
vi.mock("../services/getProductos", () => ({ getProductos: vi.fn() }));

const CATALOGO = [
  { id: "1", tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "S", color: "Blanca", coste: "2" },
  { id: "2", tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "M", color: "Blanca", coste: "2" },
  { id: "3", tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "M", color: "Negro", coste: "3" },
  { id: "4", tipo: "Camiseta", proveedor: "Prov B", modelo: "Eco", talla: "L", color: "Rojo", coste: "4" },
];

const renderizar = () =>
  render(
    <MemoryRouter>
      <QuoteForm />
    </MemoryRouter>
  );

const linea = (n = 1, bloque = 1) =>
  within(within(screen.getByRole("region", { name: `Tipo ${bloque}` })).getByRole("group", { name: `Línea ${n}` }));

const opciones = (select) => [...select.options].map((o) => o.value).filter(Boolean);

const rellenarLinea = async (user, l, { proveedor = "Prov A", modelo = "Basic", talla = "M", color = "Blanca", cantidad = "10" } = {}) => {
  await user.selectOptions(l.getByLabelText("Proveedor"), proveedor);
  await user.selectOptions(l.getByLabelText("Modelo"), modelo);
  await user.selectOptions(l.getByLabelText("Talla"), talla);
  await user.selectOptions(l.getByLabelText("Color"), color);
  await user.clear(l.getByLabelText("Cantidad"));
  await user.type(l.getByLabelText("Cantidad"), cantidad);
};

const rellenarValido = async (user) => {
  await user.type(screen.getByLabelText("Nombre del cliente"), "Club Ciclista");
  await user.type(screen.getByLabelText("Área de impresión (cm²)"), "300");
  await rellenarLinea(user, linea());
};

const calcular = (user) => user.click(screen.getByRole("button", { name: "Calcular presupuesto" }));

beforeEach(() => {
  localStorage.clear();
  getProductos.mockReset();
  getProductos.mockResolvedValue(CATALOGO);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuoteForm — catálogo", () => {
  it("muestra un aviso mientras carga y después rellena los proveedores", async () => {
    renderizar();
    expect(screen.getByRole("status").textContent).toContain("Cargando catálogo");
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor"))).toEqual(["Prov A", "Prov B"]));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("muestra un error si falla la carga y permite reintentar", async () => {
    const user = userEvent.setup();
    getProductos.mockRejectedValueOnce(new Error("network"));
    renderizar();
    const alerta = await screen.findByText(/No se ha podido cargar el catálogo/);
    expect(alerta).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor"))).toEqual(["Prov A", "Prov B"]));
    expect(screen.queryByText(/No se ha podido cargar el catálogo/)).toBeNull();
    expect(getProductos).toHaveBeenCalledTimes(2);
  });

  it("avisa si el catálogo está vacío y no permite calcular", async () => {
    const user = userEvent.setup();
    getProductos.mockResolvedValue([]);
    renderizar();
    await screen.findByText("El catálogo de productos está vacío.");
    await user.type(screen.getByLabelText("Nombre del cliente"), "C");
    await calcular(user);
    expect(screen.getByText(/El catálogo de productos no está disponible/)).toBeTruthy();
    expect(screen.queryByText("Resumen del presupuesto")).toBeNull();
  });
});

describe("QuoteForm — desplegables dependientes", () => {
  it("al cambiar el proveedor se vacían modelo, talla y color", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await rellenarLinea(user, linea());

    await user.selectOptions(linea().getByLabelText("Proveedor"), "Prov B");
    expect(linea().getByLabelText("Modelo").value).toBe("");
    expect(linea().getByLabelText("Talla").value).toBe("");
    expect(linea().getByLabelText("Color").value).toBe("");
    expect(opciones(linea().getByLabelText("Modelo"))).toEqual(["Eco"]);
    expect(linea().getByLabelText("Cantidad").value).toBe("10");
  });

  it("al cambiar la talla solo se vacía el color, y los colores se agrupan en Blanca/Color", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await rellenarLinea(user, linea());
    expect(opciones(linea().getByLabelText("Color"))).toEqual(["Blanca", "Color"]);

    await user.selectOptions(linea().getByLabelText("Talla"), "S");
    expect(linea().getByLabelText("Modelo").value).toBe("Basic");
    expect(linea().getByLabelText("Color").value).toBe("");
    expect(opciones(linea().getByLabelText("Color"))).toEqual(["Blanca"]);
  });
});

describe("QuoteForm — bloques y líneas", () => {
  it("'+ Añadir línea' añade una línea sin enviar el formulario", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await user.click(screen.getByRole("button", { name: "+ Añadir línea" }));

    expect(linea(2)).toBeTruthy();
    expect(screen.queryByText("Revisa los siguientes datos:")).toBeNull();
    expect(screen.queryByText("Resumen del presupuesto")).toBeNull();
  });

  it("permite eliminar líneas y bloques, manteniendo siempre al menos uno", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    expect(screen.queryByRole("button", { name: /Eliminar línea/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar bloque" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "+ Añadir línea" }));
    await user.selectOptions(linea(2).getByLabelText("Proveedor"), "Prov B");
    await user.click(screen.getByRole("button", { name: "Eliminar línea 1" }));
    expect(linea(1).getByLabelText("Proveedor").value).toBe("Prov B");
    expect(screen.queryByRole("group", { name: "Línea 2" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "+ Añadir bloque" }));
    expect(screen.getByRole("region", { name: "Tipo 2" })).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Eliminar bloque" })[0]);
    expect(screen.queryByRole("region", { name: "Tipo 2" })).toBeNull();
    expect(linea(1).getByLabelText("Proveedor").value).toBe("");
  });

  it("serigrafía muestra el n.º de colores en lugar del área", async () => {
    const user = userEvent.setup();
    renderizar();
    await user.selectOptions(screen.getByLabelText("Tipo de estampado"), "Serigrafía");
    expect(screen.getByLabelText("N.º de colores")).toBeTruthy();
    expect(screen.queryByLabelText("Área de impresión (cm²)")).toBeNull();
  });
});

describe("QuoteForm — validación y cálculo", () => {
  it("muestra los errores y no calcula con datos incompletos", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await calcular(user);

    const alerta = screen.getByText("Revisa los siguientes datos:").closest("[role=alert]");
    expect(alerta.textContent).toContain("Indica el nombre del cliente.");
    expect(alerta.textContent).toContain("Tipo 1: el área de impresión debe ser un número mayor que 0.");
    expect(alerta.textContent).toContain("Tipo 1, línea 1: la cantidad debe ser un número entero mayor que 0.");
    expect(screen.getByLabelText("Nombre del cliente").className).toContain("is-invalid");
    expect(linea().getByLabelText("Cantidad").className).toContain("is-invalid");
    expect(screen.queryByText("Resumen del presupuesto")).toBeNull();
  });

  it("rechaza una cantidad de 0", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await rellenarValido(user);
    await user.clear(linea().getByLabelText("Cantidad"));
    await user.type(linea().getByLabelText("Cantidad"), "0");
    await calcular(user);
    expect(screen.getByText(/la cantidad debe ser un número entero mayor que 0/)).toBeTruthy();
    expect(screen.queryByText("Resumen del presupuesto")).toBeNull();
  });

  it("calcula con la prenda blanca incluida en el precio", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await rellenarValido(user);
    await calcular(user);

    expect(screen.getByText("Resumen del presupuesto")).toBeTruthy();
    // 2 € garment + 0.1188 € film + 1.5 € labour
    expect(screen.getByRole("cell", { name: "3.62 €" })).toBeTruthy();
    expect(screen.getByText(/Total final para el cliente: 34.38 €/)).toBeTruthy();
  });

  it("marca el resultado como desactualizado al modificar datos y bloquea el guardado", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await rellenarValido(user);
    await calcular(user);
    const guardar = screen.getByRole("button", { name: "Guardar presupuesto" });
    expect(guardar.disabled).toBe(false);

    await user.type(linea().getByLabelText("Cantidad"), "0");
    expect(screen.getByText(/Has modificado los datos después de calcular/)).toBeTruthy();
    expect(guardar.disabled).toBe(true);

    await calcular(user);
    expect(screen.queryByText(/Has modificado los datos después de calcular/)).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar presupuesto" }).disabled).toBe(false);
  });

  it("guarda el presupuesto en el historial una sola vez", async () => {
    const user = userEvent.setup();
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await rellenarValido(user);
    await calcular(user);
    await user.click(screen.getByRole("button", { name: "Guardar presupuesto" }));

    const boton = screen.getByRole("button", { name: "Presupuesto guardado" });
    expect(boton.disabled).toBe(true);
    const historial = JSON.parse(localStorage.getItem(CLAVE_HISTORIAL));
    expect(historial).toHaveLength(1);
    expect(historial[0]).toMatchObject({ clientName: "Club Ciclista", totalPrendas: 10, descuentoPorcentaje: 5 });
    expect(historial[0].lineas[0]).not.toHaveProperty("id");
    expect(typeof historial[0].fecha).toBe("string");
  });

  it("no sobrescribe un historial dañado al guardar", async () => {
    const user = userEvent.setup();
    localStorage.setItem(CLAVE_HISTORIAL, "{dañado");
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await rellenarValido(user);
    await calcular(user);
    await user.click(screen.getByRole("button", { name: "Guardar presupuesto" }));

    expect(screen.getByText(/el historial almacenado en este navegador está dañado/)).toBeTruthy();
    expect(localStorage.getItem(CLAVE_HISTORIAL)).toBe("{dañado");
  });

  it("avisa cuando el grupo 'Color' contiene colores con costes distintos", async () => {
    const user = userEvent.setup();
    getProductos.mockResolvedValue([
      ...CATALOGO,
      { id: "5", tipo: "Camiseta", proveedor: "Prov A", modelo: "Basic", talla: "M", color: "Azul", coste: "3.5" },
    ]);
    renderizar();
    await waitFor(() => expect(opciones(linea().getByLabelText("Proveedor")).length).toBe(2));
    await rellenarValido(user);
    await user.selectOptions(linea().getByLabelText("Color"), "Color");
    await calcular(user);
    expect(screen.getByText(/Tipo 1, línea 1: el catálogo tiene varios colores con costes distintos/)).toBeTruthy();
  });
});
