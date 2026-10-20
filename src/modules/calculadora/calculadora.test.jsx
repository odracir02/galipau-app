// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import PaginaCalculadoraSerigrafia from "./PaginaCalculadoraSerigrafia";
import PaginaParametros from "./PaginaParametros";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import { PARAMETROS_EJEMPLO } from "../../domain/calculo/serigrafia/parametros";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const filaParametros = (version, valores = PARAMETROS_EJEMPLO, estado = "activa") => ({
  id: version, tecnica: "serigrafia", version, estado, valores: JSON.parse(JSON.stringify(valores)), notas: `v${version}`, creado_en: "2026-10-16T08:00:00Z",
});

const crearSupabase = (filas = [filaParametros(1)]) => {
  const tablas = { parametros_calculo: filas };
  const llamadasRpc = [];
  const cliente = crearClienteFalso({
    tablas,
    rpcs: {
      crear_version_parametros: (args) => {
        llamadasRpc.push(args);
        const version = Math.max(0, ...tablas.parametros_calculo.map((f) => f.version)) + 1;
        tablas.parametros_calculo.forEach((f) => { if (f.estado === "activa") f.estado = "archivada"; });
        tablas.parametros_calculo.push(filaParametros(version, args.p_valores));
        return { data: version, error: null };
      },
    },
  });
  return { cliente, tablas, llamadasRpc };
};

const CATALOGO = [{ id: "1", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Negro", coste: 3 }];

const renderCalculadora = (sb) =>
  render(
    <MemoryRouter>
      <PaginaCalculadoraSerigrafia obtenerCliente={async () => sb} cargarProductos={async () => CATALOGO} />
    </MemoryRouter>
  );

const rellenarCasoBase = async (user) => {
  const linea = within(await screen.findByRole("group", { name: "Línea 1" }));
  await user.selectOptions(linea.getByLabelText("Proveedor"), "Demo");
  await user.selectOptions(linea.getByLabelText("Modelo"), "Básica");
  await user.selectOptions(linea.getByLabelText("Color"), "Negro");
  await user.selectOptions(linea.getByLabelText("Talla"), "M");
  await user.type(linea.getByLabelText("Cantidad"), "10");
  await user.clear(screen.getByLabelText("Colores Trasera"));
  await user.type(screen.getByLabelText("Colores Trasera"), "1");
  await user.clear(screen.getByLabelText("Tiempo de diseño (minutos)"));
  await user.type(screen.getByLabelText("Tiempo de diseño (minutos)"), "30");
  await user.type(screen.getByLabelText("Precio final cobrado (€, opcional)"), "150");
};

describe("calculadora de costes de serigrafía", () => {
  it("calcula el caso base con su desglose (valores ficticios calculados a mano)", async () => {
    const user = userEvent.setup();
    renderCalculadora(crearSupabase().cliente);
    expect(await screen.findByText(/versión 1/)).toBeTruthy();
    expect(screen.getByLabelText("Merma (%)").value).toBe("5");
    await rellenarCasoBase(user);

    expect((await screen.findByTestId("coste-total")).textContent).toMatch(/64,99\s€/);
    // 86,65 € / 10 = 8,67 €/ud → 9,00 €/ud (múltiplos de 0,50 € hacia arriba) → 90,00 €
    expect(screen.getByTestId("precio-unidad-sin-redondear").textContent).toMatch(/8,67\s€/);
    expect(screen.getByTestId("precio-unidad-redondeado").textContent).toMatch(/9,00\s€/);
    expect(screen.getByTestId("precio-recomendado").textContent).toMatch(/90,00\s€/);
    expect(screen.getByTestId("beneficio-recomendado").textContent).toMatch(/25,01\s€/);
    // The manual final price is not rounded
    expect(screen.getByTestId("precio-final").textContent).toMatch(/150,00\s€/);
    expect(screen.getByTestId("beneficio").textContent).toMatch(/85,01\s€/);
    const tabla = screen.getByRole("table");
    for (const texto of ["Prendas", "Materiales y consumibles", "Electricidad", "Reserva de maquinaria", "Mano de obra", "Plastisol", "Preparación de pantallas"]) {
      expect(within(tabla).getAllByText(new RegExp(texto)).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Precios sin IVA añadido/)).toBeTruthy();
  });

  it("un precio manual sustituye al del catálogo", async () => {
    const user = userEvent.setup();
    renderCalculadora(crearSupabase().cliente);
    await rellenarCasoBase(user);
    await user.type(screen.getByLabelText("Precio manual de la prenda (opcional, €)"), "4");
    // 10 × 1 € más de prenda × 1,05 de merma = 10,50 € más
    await waitFor(() => expect(screen.getByTestId("coste-total").textContent).toMatch(/75,49\s€/));
  });

  it("añadir una zona con colores aumenta las pantallas", async () => {
    const user = userEvent.setup();
    renderCalculadora(crearSupabase().cliente);
    await rellenarCasoBase(user);
    await user.click(screen.getByRole("button", { name: "+ Añadir zona" }));
    expect(screen.getByLabelText("Colores Zona 3").value).toBe("1");
    expect(await screen.findByText(/3 pantalla\(s\) · merma/)).toBeTruthy();
  });

  it("muestra la comparación con el motor antiguo", async () => {
    const user = userEvent.setup();
    renderCalculadora(crearSupabase().cliente);
    await rellenarCasoBase(user);
    await user.click(await screen.findByLabelText("Comparar con el motor antiguo (tarifas)"));
    expect(screen.getByRole("note").textContent).toMatch(/Motor antiguo: total/);
  });

  it("avisa de datos incompletos y no muestra resultado", async () => {
    const user = userEvent.setup();
    renderCalculadora(crearSupabase().cliente);
    const linea = within(await screen.findByRole("group", { name: "Línea 1" }));
    await user.type(linea.getByLabelText("Cantidad"), "5");
    expect(screen.getByRole("alert").textContent).toMatch(/elige una prenda del catálogo o indica un precio manual/);
    expect(screen.queryByTestId("coste-total")).toBeNull();
  });

  it("una versión de parámetros anterior a la regla conserva el precio sin redondear y avisa", async () => {
    const user = userEvent.setup();
    const antiguos = { ...PARAMETROS_EJEMPLO };
    delete antiguos.redondeoPrecioUnidad;
    renderCalculadora(crearSupabase([filaParametros(1, antiguos)]).cliente);
    await rellenarCasoBase(user);
    expect((await screen.findByTestId("precio-recomendado")).textContent).toMatch(/86,65\s€/);
    expect(screen.queryByTestId("precio-unidad-redondeado")).toBeNull();
    expect(screen.getByText(/no incluye el redondeo del precio recomendado/)).toBeTruthy();
  });

  it("sin parámetros invita a crearlos", async () => {
    renderCalculadora(crearSupabase([]).cliente);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Todavía no hay parámetros/);
    expect(screen.getByRole("link", { name: "Parámetros" }).getAttribute("href")).toBe("/configuracion/parametros");
  });
});

describe("parámetros de cálculo", () => {
  const renderParametros = (sb) => render(<MemoryRouter><PaginaParametros obtenerCliente={async () => sb} /></MemoryRouter>);

  it("muestra la versión activa y guarda un cambio como versión nueva", async () => {
    const user = userEvent.setup();
    const { cliente, llamadasRpc } = crearSupabase();
    renderParametros(cliente);
    const mano = await screen.findByLabelText("Mano de obra");
    expect(mano.value).toBe("18");
    await user.clear(mano);
    await user.type(mano, "25,5");
    await user.type(screen.getByLabelText("Motivo del cambio (opcional)"), "Nueva tarifa");
    await user.click(screen.getByRole("button", { name: "Guardar como nueva versión" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/Versión 2 guardada y activa/);
    expect(llamadasRpc[0]).toMatchObject({ p_tecnica: "serigrafia", p_notas: "Nueva tarifa" });
    expect(llamadasRpc[0].p_valores.manoObraEurHora).toBe(25.5);
    expect(llamadasRpc[0].p_valores.consumibles).toHaveLength(PARAMETROS_EJEMPLO.consumibles.length);
    expect(screen.getByText(/Versión 1 — .* — archivada/)).toBeTruthy();
  });

  it("una versión sin la regla de redondeo propone 0,5 € al guardar la siguiente", async () => {
    const user = userEvent.setup();
    const antiguos = { ...PARAMETROS_EJEMPLO };
    delete antiguos.redondeoPrecioUnidad;
    const { cliente, llamadasRpc } = crearSupabase([filaParametros(1, antiguos)]);
    renderParametros(cliente);
    expect((await screen.findByLabelText("Redondeo del precio recomendado por unidad")).value).toBe("0.5");
    await user.click(screen.getByRole("button", { name: "Guardar como nueva versión" }));
    await screen.findByText(/Versión 2 guardada y activa/);
    expect(llamadasRpc[0].p_valores.redondeoPrecioUnidad).toBe(0.5);
  });

  it("valida antes de guardar", async () => {
    const user = userEvent.setup();
    const { cliente, llamadasRpc } = crearSupabase();
    renderParametros(cliente);
    await user.clear(await screen.findByLabelText("Mano de obra"));
    await user.click(screen.getByRole("button", { name: "Guardar como nueva versión" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Mano de obra: falta o no es un número/);
    expect(llamadasRpc).toHaveLength(0);
  });

  it("importa valores desde un archivo JSON (sin guardarlos hasta confirmar)", async () => {
    const user = userEvent.setup();
    const { cliente, llamadasRpc } = crearSupabase([]);
    renderParametros(cliente);
    expect(await screen.findByText(/Todavía no hay ninguna versión/)).toBeTruthy();
    const archivo = new File([JSON.stringify({ parametros: { ...PARAMETROS_EJEMPLO, manoObraEurHora: 21 } })], "parametros.json", { type: "application/json" });
    await user.upload(screen.getByLabelText(/Importar valores/), archivo);
    expect(await screen.findByText(/Valores cargados desde parametros.json/)).toBeTruthy();
    expect(screen.getByLabelText("Mano de obra").value).toBe("21");
    expect(llamadasRpc).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Guardar como nueva versión" }));
    expect(await screen.findByText(/Versión 1 guardada y activa/)).toBeTruthy();
  });

  it("rechaza un archivo sin parámetros válidos", async () => {
    const user = userEvent.setup();
    renderParametros(crearSupabase().cliente);
    await screen.findByLabelText("Mano de obra");
    await user.upload(screen.getByLabelText(/Importar valores/), new File(['{"hola": 1}'], "otro.json", { type: "application/json" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no contiene parámetros válidos/);
    expect(screen.getByLabelText("Mano de obra").value).toBe("18");
  });
});
