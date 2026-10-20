// @vitest-environment jsdom
// Cost calculator -> new quote: the job typed in the calculator must reach the
// quote editor intact (production bug: the editor opened empty). FICTITIOUS data.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PaginaCalculadoraSerigrafia from "./PaginaCalculadoraSerigrafia";
import PaginaEditorPresupuesto from "../presupuestos/PaginaEditorPresupuesto";
import ProveedorDialogos from "../../shared/ui/ProveedorDialogos";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import { PARAMETROS_EJEMPLO } from "../../domain/calculo/serigrafia/parametros";
import { CLAVE_TRABAJO, leerTrabajo, guardarTrabajo, formularioTransferido, transferenciaAPresupuesto, trabajoVacio, avisosAntesDeTransferir } from "./trabajoCalculadora";
import { formularioVacio } from "../presupuestos/domain/instantanea";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const CATALOGO = [
  { id: "1", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Negro", coste: 3 },
  { id: "2", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "L", color: "Negro", coste: 3.2 },
  { id: "3", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Blanco", coste: 2.5 },
];
const fila = (version, valores = PARAMETROS_EJEMPLO, estado = "activa") => ({ id: version, tecnica: "serigrafia", version, estado, valores, notas: null, creado_en: "2026-10-20T08:00:00Z" });

const crearSb = (parametros = [fila(1)]) =>
  crearClienteFalso({
    tablas: { parametros_calculo: parametros, presupuestos: [], clientes: [{ id: 7, nombre: "Club Ficticio", archivado: false }], configuracion: [] },
    disparadores: { presupuestos: { alInsertar: (f) => ({ ...f, estado: "borrador", numero: null, version: 1, historial_estados: [], creado_en: "2026-10-20T10:00:00Z", actualizado_en: "2026-10-20T10:00:00Z" }) } },
  });

const App = ({ sb, entradas = ["/costes"] }) => {
  const props = { obtenerCliente: async () => sb, cargarProductos: async () => CATALOGO };
  return (
    <MemoryRouter initialEntries={entradas}>
      <ProveedorDialogos>
        <Routes>
          <Route path="/costes" element={<PaginaCalculadoraSerigrafia {...props} />} />
          <Route path="/presupuestos/nuevo" element={<PaginaEditorPresupuesto {...props} />} />
          <Route path="/presupuestos/:id" element={<PaginaEditorPresupuesto {...props} />} />
        </Routes>
      </ProveedorDialogos>
    </MemoryRouter>
  );
};

const linea = (n) => within(screen.getByRole("group", { name: `Línea ${n}` }));
const elegir = async (user, n, { color, talla, cantidad }) => {
  await user.selectOptions(linea(n).getByLabelText("Proveedor"), "Demo");
  await user.selectOptions(linea(n).getByLabelText("Modelo"), "Básica");
  await user.selectOptions(linea(n).getByLabelText("Color"), color);
  await user.selectOptions(linea(n).getByLabelText("Talla"), talla);
  await user.type(linea(n).getByLabelText("Cantidad"), String(cantidad));
};
const escribir = async (user, etiqueta, valor) => {
  const campo = screen.getByLabelText(etiqueta);
  await user.clear(campo);
  await user.type(campo, valor);
};
const cifras = () => ["coste-total", "coste-unidad", "precio-unidad-sin-redondear", "precio-unidad-redondeado", "precio-recomendado", "margen-recomendado", "precio-final", "beneficio"]
  .map((id) => [id, screen.getByTestId(id).textContent]);

// Two lines (different sizes, one with a manual price), three zones, design time, waste and final price
const rellenarTrabajoCompleto = async (user) => {
  await elegir(user, 1, { color: "Negro", talla: "M", cantidad: 10 });
  await user.click(screen.getByRole("button", { name: "+ Añadir línea" }));
  await elegir(user, 2, { color: "Negro", talla: "L", cantidad: 5 });
  await user.type(screen.getAllByLabelText("Precio manual de la prenda (opcional, €)")[1], "4,10");
  await escribir(user, "Colores Delantera", "2");
  await escribir(user, "Colores Trasera", "1");
  await user.click(screen.getByRole("button", { name: "+ Añadir zona" }));
  await escribir(user, "Tiempo de diseño (minutos)", "45");
  await escribir(user, "Merma (%)", "6");
  await user.type(screen.getByLabelText("Precio final cobrado (€, opcional)"), "260");
};

describe("de la calculadora a un presupuesto nuevo", () => {
  it("reproduce el fallo de producción: «Crear presupuesto» abre el editor con todo el trabajo y el mismo resultado", async () => {
    const user = userEvent.setup();
    const sb = crearSb();
    render(<App sb={sb} />);
    await screen.findByText(/versión 1/);
    await rellenarTrabajoCompleto(user);
    const enCalculadora = cifras();

    await user.click(screen.getByRole("button", { name: "Crear presupuesto" }));
    expect(await screen.findByRole("heading", { name: "Nuevo presupuesto" })).toBeTruthy();
    expect(screen.getByText(/Trabajo traído de la calculadora/)).toBeTruthy();

    // Every field arrived
    expect(["Proveedor", "Modelo", "Color", "Talla", "Cantidad"].map((c) => linea(1).getByLabelText(c).value)).toEqual(["Demo", "Básica", "Negro", "M", "10"]);
    expect(["Proveedor", "Modelo", "Color", "Talla", "Cantidad"].map((c) => linea(2).getByLabelText(c).value)).toEqual(["Demo", "Básica", "Negro", "L", "5"]);
    expect(screen.getAllByLabelText("Precio manual de la prenda (opcional, €)").map((i) => i.value)).toEqual(["", "4,10"]);
    expect(screen.getByTestId("coste-linea-1").textContent).toMatch(/10 × 3,00\s€/);
    expect(screen.getByTestId("coste-linea-2").textContent).toMatch(/5 × 4,10\s€.*precio manual/);
    expect(["Delantera", "Trasera", "Zona 3"].map((z) => screen.getByLabelText(`Colores ${z}`).value)).toEqual(["2", "1", "1"]);
    expect(screen.getByLabelText("Tiempo de diseño (minutos)").value).toBe("45");
    expect(screen.getByLabelText("Merma (%)").value).toBe("6");
    expect(screen.getByLabelText("Precio final para el cliente (€)").value).toBe("260");

    // Same amounts, immediately
    expect(cifras()).toEqual(enCalculadora);
    expect(screen.getByText(/parámetros v1/)).toBeTruthy();

    // Nothing saved and no number used
    expect(sb.tablas.presupuestos).toHaveLength(0);
  });

  it("después se puede elegir el cliente, modificar los datos y guardar el borrador", async () => {
    const user = userEvent.setup();
    const sb = crearSb();
    render(<App sb={sb} />);
    await screen.findByText(/versión 1/);
    await rellenarTrabajoCompleto(user);
    await user.click(screen.getByRole("button", { name: "Crear presupuesto" }));
    await screen.findByRole("heading", { name: "Nuevo presupuesto" });

    await user.type(screen.getByLabelText("Buscar cliente"), "Club");
    await user.click(await screen.findByRole("option", { name: /Club Ficticio/ }));
    await escribir(user, "Colores Trasera", "0");
    await user.clear(linea(1).getByLabelText("Cantidad"));
    await user.type(linea(1).getByLabelText("Cantidad"), "20");
    await user.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await screen.findByText("Presupuesto guardado.");

    const p = sb.tablas.presupuestos[0];
    expect(p).toMatchObject({ estado: "borrador", numero: null, cliente_id: 7, parametros_version: 1, precio_final_cent: 26000 });
    expect(p.entrada.lineas.map((l) => [l.talla, l.cantidad, l.precioUnitario, l.origen])).toEqual([["M", 20, 3, "catalogo"], ["L", 5, 4.1, "manual"]]);
    expect(p.entrada.motor.zonas.map((z) => z.colores)).toEqual([2, 0, 1]);
    expect(p.entrada.motor).toMatchObject({ minutosDiseno: 45, merma: 0.06 });
    expect(p.entrada.formulario.lineas[0].productoId).toBe("1");
  });

  it("conserva la versión de parámetros con la que se calculó aunque ya haya otra vigente", async () => {
    const otra = { ...PARAMETROS_EJEMPLO, manoObraEurHora: 30 };
    const sb = crearSb([fila(1, PARAMETROS_EJEMPLO, "archivada"), fila(2, otra)]);
    const formulario = { ...formularioVacio(PARAMETROS_EJEMPLO), lineas: [{ id: "l1", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", color: "Negro", size: "M", productoId: "1", quantity: "10", precioManual: "", descripcion: "" }] };
    render(<App sb={sb} entradas={[{ pathname: "/presupuestos/nuevo", state: transferenciaAPresupuesto(formulario, 1) }]} />);
    expect(await screen.findByText(/Calculado con la versión 1 de los parámetros \(la vigente es la 2\)/)).toBeTruthy();
    expect(screen.getByText(/parámetros v1/)).toBeTruthy();
  });

  it("si el trabajo está incompleto avisa antes de continuar; se puede seguir en la calculadora o pasarlo igualmente", async () => {
    const user = userEvent.setup();
    render(<App sb={crearSb()} />);
    await screen.findByText(/versión 1/);
    await user.type(linea(1).getByLabelText("Cantidad"), "12");
    await user.click(screen.getByRole("button", { name: "Crear presupuesto" }));
    const dialogo = screen.getByRole("alertdialog", { name: "El trabajo está incompleto" });
    expect(dialogo.textContent).toMatch(/elige una prenda del catálogo o indica un precio manual/);
    await user.click(within(dialogo).getByRole("button", { name: "Seguir en la calculadora" }));
    expect(screen.getByRole("heading", { name: "Calculadora de costes" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Crear presupuesto" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Pasar al presupuesto" }));
    expect(await screen.findByRole("heading", { name: "Nuevo presupuesto" })).toBeTruthy();
    expect(linea(1).getByLabelText("Cantidad").value).toBe("12");
  });

  it("con la calculadora vacía abre un presupuesto vacío, sin avisos", async () => {
    const user = userEvent.setup();
    render(<App sb={crearSb()} />);
    await screen.findByText(/versión 1/);
    await user.click(screen.getByRole("button", { name: "Crear presupuesto" }));
    expect(await screen.findByRole("heading", { name: "Nuevo presupuesto" })).toBeTruthy();
    expect(screen.queryByText(/Trabajo traído de la calculadora/)).toBeNull();
  });

  it("el trabajo de la calculadora no se pierde al salir y volver; «Empezar de nuevo» lo borra", async () => {
    const user = userEvent.setup();
    const sb = crearSb();
    const { unmount } = render(<App sb={sb} />);
    await screen.findByText(/versión 1/);
    await elegir(user, 1, { color: "Blanco", talla: "M", cantidad: 8 });
    await escribir(user, "Merma (%)", "3");
    unmount();
    render(<App sb={sb} />);
    await screen.findByText(/versión 1/);
    expect(linea(1).getByLabelText("Cantidad").value).toBe("8");
    expect(linea(1).getByLabelText("Color").value).toBe("Blanco");
    expect(screen.getByLabelText("Merma (%)").value).toBe("3"); // not replaced by the default waste
    await user.click(screen.getByRole("button", { name: "Empezar de nuevo" }));
    expect(linea(1).getByLabelText("Cantidad").value).toBe("");
    expect(screen.getByLabelText("Merma (%)").value).toBe("5");
    await waitFor(() => expect(leerTrabajo()?.lineas[0].quantity).toBe(""));
  });
});

describe("estado del trabajo transferido", () => {
  const f = { ...formularioVacio(PARAMETROS_EJEMPLO), lineas: [{ id: "a", quantity: "3", precioManual: "", precioGuardado: 9 }] };

  it("se pasa por el estado de navegación como copia independiente y sin precios guardados", () => {
    const estado = transferenciaAPresupuesto(f, 4);
    f.lineas[0].quantity = "99";
    const t = formularioTransferido(estado);
    expect(t.parametrosVersion).toBe(4);
    expect(t.formulario.lineas[0]).toEqual({ id: "a", quantity: "3", precioManual: "" });
    expect(JSON.stringify(estado)).not.toMatch(/http|\?/);
  });

  it("descarta estados vacíos o dañados", () => {
    expect(formularioTransferido(null)).toBeNull();
    expect(formularioTransferido({ desdeCalculadora: { formulario: { lineas: [] } } })).toBeNull();
    expect(formularioTransferido({ otra: 1 })).toBeNull();
  });

  it("almacenamiento de la pestaña: tolera datos dañados y almacenamiento bloqueado", () => {
    sessionStorage.setItem(CLAVE_TRABAJO, "{roto");
    expect(leerTrabajo()).toBeNull();
    const bloqueado = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(leerTrabajo(bloqueado)).toBeNull();
    expect(() => guardarTrabajo(f, bloqueado)).not.toThrow();
  });

  it("vacío e incompleto", () => {
    expect(trabajoVacio(formularioVacio(PARAMETROS_EJEMPLO))).toBe(true);
    expect(trabajoVacio({ ...formularioVacio(null), precioFinal: "10" })).toBe(false);
    expect(avisosAntesDeTransferir({ problemas: ["a"], erroresEntrada: ["a", "b"], resultado: null })).toEqual(["a", "b"]);
    expect(avisosAntesDeTransferir({ problemas: ["a"], resultado: {} })).toEqual([]);
  });
});
