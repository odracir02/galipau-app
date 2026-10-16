// @vitest-environment jsdom
// Quote pages with a fake Supabase that emulates the database rules
// (draft without number, number on presentation, transitions, read-only states).
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PaginaEditorPresupuesto from "./PaginaEditorPresupuesto";
import PaginaPresupuestos from "./PaginaPresupuestos";
import PaginaEmpresa from "../empresa/PaginaEmpresa";
import PaginaMigracion from "../migracion/PaginaMigracion";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import { PARAMETROS_EJEMPLO } from "../../domain/calculo/serigrafia/parametros";
import { TRANSICIONES, esEditable } from "./domain/estados";
import { CATALOGO_FICTICIO, CLIENTE_FICTICIO, registroFicticio } from "./domain/fixtures";
import { huella } from "../migracion/domain/historial";

afterEach(() => cleanup());

const fila = (version, valores = PARAMETROS_EJEMPLO, estado = "activa") => ({ id: version, tecnica: "serigrafia", version, estado, valores, notas: null, creado_en: "2026-10-17T08:00:00Z" });

const CONTENIDO = ["cliente_id", "cliente_nombre", "cliente_datos", "entrada", "resultado", "parametros_version", "total_cent", "precio_final_cent", "idioma", "observaciones", "condiciones", "fecha_emision", "valido_hasta"];

const crearBd = ({ presupuestos = [], parametros = [fila(1)], clientes = [CLIENTE_FICTICIO], configuracion = [] } = {}) => {
  let contador = 0;
  const tablas = { presupuestos, parametros_calculo: parametros, clientes: clientes.map((c) => ({ archivado: false, ...c })), configuracion, importaciones: [] };
  const rpcs = {};
  const sb = crearClienteFalso({
    tablas,
    rpcs,
    disparadores: {
      presupuestos: {
        alInsertar: (f) => ({ ...f, estado: "borrador", numero: null, version: 1, historial_estados: [{ estado: "borrador", en: "2026-10-17T10:00:00Z" }], creado_en: "2026-10-17T10:00:00Z", actualizado_en: "2026-10-17T10:00:00Z" }),
        alActualizar: (antes, despues) => {
          if (!esEditable(antes.estado) && CONTENIDO.some((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))) return { error: { code: "42501", message: "read-only" } };
          if (despues.estado !== antes.estado) {
            if (!TRANSICIONES[antes.estado].includes(despues.estado)) return { error: { code: "23514", message: "transition" } };
            if (despues.estado === "presentado" && !despues.numero) despues.numero = `2026/${String(++contador).padStart(3, "0")}`;
            despues.historial_estados = [...antes.historial_estados, { estado: despues.estado, en: "2026-10-17T11:00:00Z" }];
          }
          return despues;
        },
      },
    },
  });
  return { sb, tablas, rpcs };
};

const renderEditor = (sb, ruta = "/presupuestos/nuevo", extra = {}) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/presupuestos/nuevo" element={<PaginaEditorPresupuesto obtenerCliente={async () => sb} cargarProductos={async () => CATALOGO_FICTICIO} {...extra} />} />
        <Route path="/presupuestos/:id" element={<PaginaEditorPresupuesto obtenerCliente={async () => sb} cargarProductos={async () => CATALOGO_FICTICIO} {...extra} />} />
        <Route path="/presupuestos" element={<div>Lista</div>} />
      </Routes>
    </MemoryRouter>
  );

const elegirCliente = async (user) => {
  await user.type(await screen.findByLabelText("Buscar cliente"), "Club");
  await user.click(await screen.findByRole("option", { name: /Club Ficticio/ }));
};

const rellenarTrabajo = async (user) => {
  const linea = within(screen.getByRole("group", { name: "Línea 1" }));
  await user.selectOptions(linea.getByLabelText("Proveedor"), "Demo");
  await user.selectOptions(linea.getByLabelText("Modelo"), "Básica");
  await user.selectOptions(linea.getByLabelText("Talla"), "M");
  await user.selectOptions(linea.getByLabelText("Color"), "Color");
  await user.type(linea.getByLabelText("Cantidad"), "10");
  await user.clear(screen.getByLabelText("Colores Trasera"));
  await user.type(screen.getByLabelText("Colores Trasera"), "1");
  await user.clear(screen.getByLabelText("Tiempo de diseño (minutos)"));
  await user.type(screen.getByLabelText("Tiempo de diseño (minutos)"), "30");
};

describe("editor de presupuestos", () => {
  it("crea un borrador con cliente, líneas y precio final, y lo guarda con su instantánea", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearBd();
    renderEditor(sb);
    expect(await screen.findByRole("heading", { name: "Nuevo presupuesto" })).toBeTruthy();
    await elegirCliente(user);
    await rellenarTrabajo(user);
    // Recommended 90,00 € (8,67 → 9,00 €/ud); the owner takes it as final price
    await user.click(await screen.findByRole("button", { name: /Usar el recomendado \(90,00/ }));
    expect(screen.getByLabelText("Precio final para el cliente (€)").value).toBe("90,00");
    expect(screen.getByTestId("coste-linea-1").textContent).toMatch(/10 × 3,00\s€ = 30,00\s€/);
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));

    expect(await screen.findByText("Presupuesto guardado.")).toBeTruthy();
    const p = tablas.presupuestos[0];
    expect(p).toMatchObject({ estado: "borrador", numero: null, cliente_id: 7, cliente_nombre: "Club Ficticio", tecnica: "serigrafia", parametros_version: 1, motor: "serigrafia-coste-real/2", precio_final_cent: 9000, total_cent: 9000, coste_total_cent: 6499, idioma: "va" });
    expect(p.entrada.lineas[0]).toMatchObject({ cantidad: 10, precioUnitario: 3, origen: "catalogo", talla: "M" });
    expect(p.resultado.precio.recomendadoSinRedondearCent).toBe(8665);
    expect(p.cliente_datos.nif).toBe("G00000000");
    expect(p.condiciones).toMatch(/^Pagament/);
    expect(await screen.findByRole("heading", { name: "Presupuesto (borrador)" })).toBeTruthy();
  });

  it("al presentarlo recibe número y después avanza por los estados; aceptado ya no se edita", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearBd({ presupuestos: [{ ...registroFicticio(), numero: null, estado: "borrador", historial_estados: [{ estado: "borrador", en: "2026-10-17T10:00:00Z" }] }], parametros: [fila(3)] });
    renderEditor(sb, "/presupuestos/1");
    await user.click(await screen.findByRole("button", { name: "Marcar como presentado" }));
    expect(await screen.findByText("Presupuesto presentado con el número 2026/001.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Presupuesto 2026/001" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Marcar como aceptado" }));
    expect(await screen.findByText("Estado actualizado: Aceptado.")).toBeTruthy();
    expect(tablas.presupuestos[0].estado).toBe("aceptado");
    expect(screen.getByLabelText("Precio final para el cliente (€)").matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: /Guardar (borrador|cambios)/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar notas" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Marcar como cobrado" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pasar a producción" })).toBeTruthy();
    expect(screen.getByText(/Historial: Borrador .* → Presentado .* → Aceptado/)).toBeTruthy();
  });

  it("no deja presentar sin precio final", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearBd();
    renderEditor(sb);
    await elegirCliente(user);
    await rellenarTrabajo(user);
    await user.click(screen.getByRole("button", { name: "Marcar como presentado" }));
    expect(screen.getByRole("alert").textContent).toMatch(/indica el precio final/);
    expect(tablas.presupuestos).toHaveLength(0);
  });

  it("recupera un presupuesto, lo edita y se conserva el precio guardado aunque el catálogo cambie", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearBd({ presupuestos: [registroFicticio()], parametros: [fila(3)] });
    const catalogoCaro = CATALOGO_FICTICIO.map((p) => (p.id === "1" ? { ...p, coste: 3.4 } : p));
    render(
      <MemoryRouter initialEntries={["/presupuestos/1"]}>
        <Routes><Route path="/presupuestos/:id" element={<PaginaEditorPresupuesto obtenerCliente={async () => sb} cargarProductos={async () => catalogoCaro} />} /></Routes>
      </MemoryRouter>
    );
    expect(await screen.findByRole("heading", { name: "Presupuesto 2026/003" })).toBeTruthy();
    expect(screen.getByTestId("cliente-seleccionado").textContent).toMatch(/Club Ficticio/);
    expect(screen.getByRole("note").textContent).toMatch(/línea 1: 3,00\s€ → 3,40\s€/);
    expect(screen.getByTestId("comprobacion").textContent).toMatch(/Cálculo verificado/);
    const precio = screen.getByLabelText("Precio final para el cliente (€)");
    await user.clear(precio);
    await user.type(precio, "160");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await screen.findByText("Presupuesto guardado.");
    expect(tablas.presupuestos[0].precio_final_cent).toBe(16000);
    expect(tablas.presupuestos[0].entrada.lineas[0].precioUnitario).toBe(3);
    // Optionally adopt the current catalogue prices
    await user.click(screen.getByRole("button", { name: "Usar los precios actuales" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(tablas.presupuestos[0].entrada.lineas[0].precioUnitario).toBe(3.4));
  });

  it("conserva la versión de parámetros del presupuesto y permite recalcular con la vigente", async () => {
    const user = userEvent.setup();
    const v4 = { ...PARAMETROS_EJEMPLO, manoObraEurHora: 30 };
    const { sb, tablas } = crearBd({ presupuestos: [registroFicticio()], parametros: [fila(3, PARAMETROS_EJEMPLO, "archivada"), fila(4, v4)] });
    renderEditor(sb, "/presupuestos/1");
    const coste = tablas.presupuestos[0].coste_total_cent;
    expect(await screen.findByText(/Calculado con la versión 3 de los parámetros \(la vigente es la 4\)/)).toBeTruthy();
    expect(screen.getByTestId("coste-total").textContent).toMatch(new RegExp((coste / 100).toFixed(2).replace(".", ",")));
    await user.click(screen.getByRole("button", { name: "Recalcular con la versión vigente" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(tablas.presupuestos[0].parametros_version).toBe(4));
    expect(tablas.presupuestos[0].coste_total_cent).toBeGreaterThan(coste);
  });

  it("duplica un presupuesto como borrador nuevo", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearBd({ presupuestos: [{ ...registroFicticio(), estado: "cobrado" }], parametros: [fila(3)] });
    renderEditor(sb, "/presupuestos/nuevo?duplicar=1");
    expect(await screen.findByText(/Copia de un presupuesto/)).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Línea 1" })).getByLabelText("Cantidad").value).toBe("6");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await screen.findByText("Presupuesto guardado.");
    expect(tablas.presupuestos).toHaveLength(2);
    expect(tablas.presupuestos[1]).toMatchObject({ estado: "borrador", numero: null, cliente_id: 7, precio_final_cent: 15000, notas: null });
    expect(tablas.presupuestos[0].estado).toBe("cobrado");
  });

  it("crea un cliente nuevo desde el presupuesto", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearBd({ clientes: [] });
    renderEditor(sb);
    await user.click(await screen.findByRole("button", { name: "+ Nuevo cliente" }));
    const form = within(screen.getByRole("group", { name: "Nuevo cliente" }));
    await user.type(form.getByLabelText("Nombre *"), "Asociación Nueva");
    await user.type(form.getByLabelText("NIF / CIF"), "g-1234567-8");
    await user.click(form.getByRole("button", { name: "Guardar cliente" }));
    expect((await screen.findByTestId("cliente-seleccionado")).textContent).toMatch(/Asociación Nueva/);
    expect(tablas.clientes[0]).toMatchObject({ nombre: "Asociación Nueva", nif: "G12345678" });
  });

  it("genera el PDF del presupuesto guardado (y pide guardar antes si hay cambios)", async () => {
    const user = userEvent.setup();
    const guardarPdf = vi.fn();
    const { sb } = crearBd({ presupuestos: [registroFicticio()], parametros: [fila(3)] });
    renderEditor(sb, "/presupuestos/1", { guardarPdf });
    await user.click(await screen.findByRole("button", { name: "Descargar PDF" }));
    await waitFor(() => expect(guardarPdf).toHaveBeenCalledTimes(1));
    expect(guardarPdf.mock.calls[0][1]).toBe("Pressupost_2026-003_Galipau_Arts.pdf");
    expect(guardarPdf.mock.calls[0][0].getNumberOfPages()).toBe(1);
    await user.type(screen.getByLabelText("Observaciones (aparecen en el PDF)"), " y negro");
    await user.click(screen.getByRole("button", { name: "Descargar PDF" }));
    expect(screen.getByText("Guarda los cambios antes de generar el PDF.")).toBeTruthy();
    expect(guardarPdf).toHaveBeenCalledTimes(1);
  });
});

describe("historial de presupuestos", () => {
  const p = (id, cambios) => ({ ...registroFicticio(), id, ...cambios });

  it("lista y filtra por cliente, estado y fecha", async () => {
    const user = userEvent.setup();
    const { sb } = crearBd({
      presupuestos: [
        p(1, { numero: "2026/001", cliente_nombre: "Club Ficticio", estado: "aceptado", fecha_emision: "2026-09-01", creado_en: "2026-09-01T10:00:00Z" }),
        p(2, { numero: "2026/002", cliente_nombre: "Peña Inventada", estado: "presentado", fecha_emision: "2026-10-01", creado_en: "2026-10-01T10:00:00Z" }),
        p(3, { numero: null, cliente_nombre: "Club Ficticio", estado: "borrador", fecha_emision: "2026-10-10", creado_en: "2026-10-10T10:00:00Z" }),
      ],
    });
    render(<MemoryRouter><PaginaPresupuestos obtenerCliente={async () => sb} /></MemoryRouter>);
    const filas = async () => (await screen.findByRole("table")).querySelectorAll("tbody tr");
    expect((await filas()).length).toBe(3);
    expect((await filas())[0].textContent).toMatch(/Club Ficticio.*Borrador/);
    await user.type(screen.getByLabelText("Cliente"), "peña");
    await waitFor(async () => expect((await filas()).length).toBe(1));
    await user.clear(screen.getByLabelText("Cliente"));
    await user.selectOptions(screen.getByLabelText("Estado"), "aceptado");
    await waitFor(async () => expect((await filas())[0].textContent).toMatch(/2026\/001/));
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    await user.type(screen.getByLabelText("Desde"), "2026-09-15");
    await waitFor(async () => expect((await filas()).length).toBe(2));
    expect(screen.getAllByRole("link", { name: "Duplicar" })[0].getAttribute("href")).toMatch(/duplicar=/);
  });
});

describe("empresa y PDF", () => {
  it("guarda los datos del negocio en la configuración (no en el código)", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearBd();
    render(<PaginaEmpresa obtenerCliente={async () => sb} />);
    await user.type(await screen.findByLabelText("Titular"), "Titular Ficticio");
    await user.clear(screen.getByLabelText("Validez por defecto del presupuesto (días, opcional)"));
    await user.type(screen.getByLabelText("Validez por defecto del presupuesto (días, opcional)"), "15");
    await user.click(screen.getByRole("button", { name: "Guardar datos" }));
    expect(await screen.findByText(/Datos guardados/)).toBeTruthy();
    expect(tablas.configuracion[0]).toMatchObject({ clave: "empresa" });
    expect(tablas.configuracion[0].valor).toMatchObject({ titular: "Titular Ficticio", validezDias: 15, idiomaPorDefecto: "va" });
    expect(tablas.configuracion[0].valor.condiciones.va[0]).toMatch(/^Pagament/);
  });
});

describe("migración controlada", () => {
  const almacen = (registros) => ({ getItem: () => JSON.stringify(registros), setItem: vi.fn() });

  it("vista previa del historial con duplicados; no importa sin confirmar y nunca toca el navegador", async () => {
    const user = userEvent.setup();
    const { sb, tablas, rpcs } = crearBd();
    const antiguo = { clientName: "Cliente A", total: 33.9, fecha: "2025-05-01T10:00:00Z", lineas: [{ quantity: 3, estampado: "DTF" }] };
    tablas.presupuestos.push({ id: 50, estado: "importado", entrada: { origen: { huella: await huella({ clientName: "Ya importado", total: 1 }) } } });
    const registros = [antiguo, antiguo, { clientName: "Ya importado", total: 1 }, { clientName: "Sin total" }];
    rpcs.importar_historial = (args, t) => {
      t.importaciones.push({ id: 1, tipo: "historial_local", creada_en: "2026-10-17T12:00:00Z", resumen: args.p_resumen, revertida_en: null });
      args.p_registros.forEach((r, i) => t.presupuestos.push({ id: 100 + i, estado: "importado", importacion_id: 1, total_cent: r.total_cent, entrada: { origen: { huella: r.huella } } }));
      return { data: 1, error: null };
    };
    const local = almacen(registros);
    render(<PaginaMigracion obtenerCliente={async () => sb} leerAlmacen={() => local} />);
    await user.click(screen.getAllByRole("button", { name: "Ver vista previa" })[0]);
    const vista = within(await screen.findByTestId("vista-historial"));
    expect(vista.getByText(/Leídos/).textContent).toMatch(/Leídos 4 · nuevos 1 \(33,90\s€\) · duplicados 2 · no válidos 1/);
    expect(vista.getByText("Ya se importó antes.")).toBeTruthy();
    const boton = vista.getByRole("button", { name: "Importar 1 presupuestos" });
    expect(boton.disabled).toBe(true);
    await user.type(vista.getByLabelText(/escribe IMPORTAR/), "IMPORTAR");
    await user.click(boton);
    expect(await screen.findByText(/Importación 1 correcta: 1 presupuestos/)).toBeTruthy();
    expect(local.setItem).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Revertir" })).toBeTruthy();
  });

  it("acepta un historial exportado desde otro navegador", async () => {
    const user = userEvent.setup();
    const { sb } = crearBd();
    render(<PaginaMigracion obtenerCliente={async () => sb} leerAlmacen={() => almacen([])} />);
    const archivo = new File([JSON.stringify([{ clientName: "Exportado", total: 12, fecha: "2025-01-02T00:00:00Z" }])], "historial.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("o carga un historial exportado:"), archivo);
    expect((await screen.findByTestId("vista-historial")).textContent).toMatch(/Leídos 1 · nuevos 1/);
    await user.upload(screen.getByLabelText("o carga un historial exportado:"), new File(["{}"], "x.json", { type: "application/json" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no contiene una lista/);
  });

  it("vista previa del catálogo: nuevos, existentes, conflictos y costes distintos", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearBd();
    tablas.v_catalogo_plano = [{ id: 1, tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Negro", coste_cent: 310 }];
    const firestore = [
      { id: "a", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Negro", coste: 3 },
      { id: "b", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "L", color: "Negro", coste: "3,2" },
      { id: "c", tipo: "Polo", proveedor: "Otro", modelo: "P", talla: "S", color: "Rojo", coste: 5 },
      { id: "d", tipo: "Polo", proveedor: "Otro", modelo: "P", talla: "S", color: "Rojo", coste: 6 },
      { id: "e", tipo: "Polo", proveedor: "", modelo: "P", talla: "S", color: "Rojo", coste: 6 },
    ];
    render(<PaginaMigracion obtenerCliente={async () => sb} leerAlmacen={() => almacen([])} leerCatalogoFirestore={async () => firestore} />);
    await user.click(screen.getAllByRole("button", { name: "Ver vista previa" })[1]);
    const vista = within(await screen.findByTestId("vista-catalogo"));
    expect(vista.getByText(/Leídos/).textContent).toMatch(/Leídos 5 · nuevos 1 · ya existentes 0 · coste distinto en Supabase 1 · conflictos 1 · no válidos 1/);
    expect(vista.getByText(/Conflicto: Otro P S Rojo/)).toBeTruthy();
    expect(vista.getByRole("button", { name: "Importar 1 productos" }).disabled).toBe(true);
  });
});
