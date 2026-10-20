// @vitest-environment jsdom
// Inventory interface and rules with FICTITIOUS data. The database functions
// are emulated here; their real behaviour is tested on PostgreSQL in supabase/pruebas/inventario.test.js.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProveedorDialogos from "../../shared/ui/ProveedorDialogos";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import PaginaInventario from "./PaginaInventario";
import PaginaMovimiento from "./PaginaMovimiento";
import PaginaArticulo from "./PaginaArticulo";
import PaginaCargaInicial from "./PaginaCargaInicial";
import PaginaCompras from "./PaginaCompras";
import { prepararMovimiento, lineasCargaInicial, resumenInventario } from "./domain/inventario";

afterEach(() => cleanup());

describe("reglas del inventario", () => {
  const art = { fisico: 10, reservado: 4 };
  it("entradas y devoluciones suman; salidas y mermas restan; no más de lo disponible", () => {
    expect(prepararMovimiento({ tipo: "entrada", unidades: "5", coste: "3,025" }, art)).toEqual({ cantidad: 5, coste: 3.025 });
    expect(prepararMovimiento({ tipo: "devolucion", unidades: "1" }, art)).toEqual({ cantidad: 1, coste: null });
    expect(prepararMovimiento({ tipo: "salida", unidades: "6" }, art)).toEqual({ cantidad: -6, coste: null });
    expect(prepararMovimiento({ tipo: "salida", unidades: "7" }, art).errores[0]).toMatch(/Solo hay 6 unidad\(es\) disponibles \(4 reservadas\)/);
    expect(prepararMovimiento({ tipo: "merma", unidades: "1" }, art).errores).toEqual(["Indica el motivo."]);
    expect(prepararMovimiento({ tipo: "entrada", unidades: "1,5" }, art).errores[0]).toMatch(/entero/);
    expect(prepararMovimiento({ tipo: "salida", unidades: "1" }, null).errores[0]).toMatch(/Solo hay 0/);
  });

  it("ajuste por recuento: la diferencia con lo físico, sin bajar de lo reservado", () => {
    expect(prepararMovimiento({ tipo: "ajuste", unidades: "12", motivo: "Recuento" }, art)).toEqual({ cantidad: 2, coste: null });
    expect(prepararMovimiento({ tipo: "ajuste", unidades: "7", motivo: "Recuento" }, art)).toEqual({ cantidad: -3, coste: null });
    expect(prepararMovimiento({ tipo: "ajuste", unidades: "3", motivo: "Recuento" }, art).errores[0]).toMatch(/4 unidad\(es\) reservadas/);
    expect(prepararMovimiento({ tipo: "ajuste", unidades: "10", motivo: "Recuento" }, art).errores[0]).toMatch(/coincide/);
  });

  it("carga inicial: solo las filas con cantidad, sin suponer nada", () => {
    const r = lineasCargaInicial([
      { varianteId: "1", descripcion: "A", cantidad: "12", coste: "3,025" },
      { varianteId: "2", descripcion: "B", cantidad: "", coste: "2" },
      { varianteId: "3", descripcion: "C", cantidad: "0", coste: "2" },
      { varianteId: "4", descripcion: "D", cantidad: "3", coste: "" },
    ]);
    expect(r.lineas).toEqual([{ variante_id: 1, cantidad: 12, coste_unitario: 3.025 }, { variante_id: 4, cantidad: 3 }]);
    expect(r.unidades).toBe(15);
    expect(r.errores).toEqual(["C: la cantidad debe ser un entero mayor que 0."]);
  });

  it("resumen: físico, reservado, disponible, bajo mínimo y valor", () => {
    expect(resumenInventario([{ fisico: 10, reservado: 4, bajo_minimo: false, valor: 30 }, { fisico: 2, reservado: 0, bajo_minimo: true, valor: null }]))
      .toEqual({ referencias: 2, fisico: 12, reservado: 4, disponible: 8, bajoMinimo: 1, valor: 30, sinValorar: 1 });
  });
});

const PRODUCTOS = [
  { id: "1", tipo: "Camiseta", proveedor: "Proveedor Ficticio", modelo: "Base", color: "Negro", talla: "M", coste: 3.025 },
  { id: "2", tipo: "Camiseta", proveedor: "Proveedor Ficticio", modelo: "Base", color: "Negro", talla: "L", coste: 3.025 },
  { id: "3", tipo: "Bolsa", proveedor: "Productos propios", modelo: "Bolsa de tela", color: "Natural", talla: "TU", coste: 1.8 },
];

// In-memory stand-in for the database functions
const crearSb = ({ conStock = true } = {}) => {
  const stock = conStock ? [{ articulo_id: 1, variante_id: 1, proveedor: "Proveedor Ficticio", propio: false, tipo: "Camiseta", modelo: "Base", color: "Negro", talla: "M", coste_catalogo: 3.025, en_catalogo: true, fisico: 10, reservado: 0, disponible: 10, stock_minimo: 12, bajo_minimo: true, coste_medio: 3, valor: 30, ubicacion: null, notas: null }] : [];
  const tablas = { v_stock: stock, stock_movimientos: conStock ? [{ id: 1, articulo_id: 1, tipo: "inicial", cantidad: 10, fecha: "2026-10-20", motivo: "Inventario inicial", coste_unitario: 3, corrige_movimiento_id: null }] : [], stock_reservas: [], stock_articulos: [], stock_necesidades: [], v_stock_compras: conStock ? [{ variante_id: 1, modelo: "Base", color: "Negro", talla: "M", proveedor: "Proveedor Ficticio", propio: false, disponible: 10, stock_minimo: 12, necesidades: 0, sugerido: 2, coste_catalogo: 3.025 }] : [] };
  const llamadas = [];
  const fila = (v) => tablas.v_stock.find((s) => s.variante_id === v);
  const recalcular = (s) => Object.assign(s, { disponible: s.fisico - s.reservado, bajo_minimo: s.fisico - s.reservado < s.stock_minimo });
  const rpcs = {
    stock_registrar: (a) => {
      llamadas.push(["registrar", a]);
      let s = fila(a.p_variante_id);
      if (!s) {
        s = { articulo_id: tablas.v_stock.length + 1, variante_id: a.p_variante_id, modelo: "Base", color: "Negro", talla: "L", fisico: 0, reservado: 0, stock_minimo: 0 };
        tablas.v_stock.push(s);
      }
      s.fisico += a.p_cantidad;
      recalcular(s);
      return { data: 99, error: null };
    },
    stock_carga_inicial: (a) => {
      llamadas.push(["inicial", a]);
      return { data: a.p_lineas.length, error: null };
    },
    stock_corregir: (a) => {
      llamadas.push(["corregir", a]);
      const m = tablas.stock_movimientos.find((x) => x.id === a.p_movimiento_id);
      tablas.stock_movimientos.unshift({ id: 50, articulo_id: m.articulo_id, tipo: "correccion", cantidad: -m.cantidad, fecha: "2026-10-20", motivo: a.p_motivo, corrige_movimiento_id: m.id });
      const s = tablas.v_stock[0];
      s.fisico -= m.cantidad;
      recalcular(s);
      return { data: 50, error: null };
    },
    stock_reservar: (a) => {
      llamadas.push(["reservar", a]);
      const s = fila(a.p_variante_id);
      s.reservado += a.p_cantidad;
      recalcular(s);
      tablas.stock_reservas.push({ id: 7, articulo_id: s.articulo_id, cantidad: a.p_cantidad, referencia: a.p_referencia, estado: "activa" });
      return { data: 7, error: null };
    },
    stock_liberar_reserva: (a) => {
      llamadas.push(["liberar", a]);
      const r = tablas.stock_reservas.find((x) => x.id === a.p_reserva_id);
      r.estado = "liberada";
      const s = tablas.v_stock[0];
      s.reservado -= r.cantidad;
      recalcular(s);
      return { data: null, error: null };
    },
  };
  const sb = crearClienteFalso({ tablas, rpcs });
  return { sb, tablas, llamadas };
};

const pagina = (sb, ruta) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorDialogos>
        <Routes>
          <Route path="/inventario" element={<PaginaInventario obtenerCliente={async () => sb} />} />
          <Route path="/inventario/movimiento" element={<PaginaMovimiento obtenerCliente={async () => sb} cargarProductos={async () => PRODUCTOS} />} />
          <Route path="/inventario/articulos/:varianteId" element={<PaginaArticulo obtenerCliente={async () => sb} />} />
          <Route path="/inventario/inicial" element={<PaginaCargaInicial obtenerCliente={async () => sb} cargarProductos={async () => PRODUCTOS} />} />
          <Route path="/inventario/compras" element={<PaginaCompras obtenerCliente={async () => sb} cargarProductos={async () => PRODUCTOS} />} />
        </Routes>
      </ProveedorDialogos>
    </MemoryRouter>
  );

const elegir = async (user, { color, talla, modelo = "Base", proveedor = "Proveedor Ficticio" }) => {
  const g = within(await screen.findByRole("group", { name: "Artículo" }));
  await user.selectOptions(g.getByLabelText("Proveedor"), proveedor);
  await user.selectOptions(g.getByLabelText("Modelo"), modelo);
  await user.selectOptions(g.getByLabelText("Color"), color);
  await user.selectOptions(g.getByLabelText("Talla"), talla);
};

describe("interfaz del inventario", () => {
  it("vacío: no supone existencias e invita a la carga inicial", async () => {
    pagina(crearSb({ conStock: false }).sb, "/inventario");
    expect(await screen.findByText("El inventario está vacío")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Registrar el inventario inicial" }).getAttribute("href")).toBe("/inventario/inicial");
  });

  it("resumen y listado con aviso de stock bajo y filtros", async () => {
    const user = userEvent.setup();
    pagina(crearSb().sb, "/inventario");
    expect((await screen.findByTestId("inv-fisico")).textContent).toBe("10");
    expect(screen.getByTestId("inv-bajo").textContent).toBe("1");
    expect(screen.getByRole("table").textContent).toMatch(/Base.*Negro.*M.*10.*Bajo mínimo/);
    await user.selectOptions(screen.getByLabelText("Filtro de existencias"), "reservas");
    expect(screen.getByText(/0 de 1 referencia/)).toBeTruthy();
  });

  it("carga inicial: solo las cantidades escritas, con confirmación; lo que ya está en inventario no se toca", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    pagina(sb, "/inventario/inicial");
    await screen.findByText("Ya en inventario");
    await user.type(screen.getByLabelText("Unidades Base Negro L"), "6");
    await user.type(screen.getByLabelText("Unidades Bolsa de tela Natural TU"), "20");
    expect(screen.getByTestId("resumen-carga").textContent).toBe("2 referencia(s) · 26 unidad(es)");
    await user.click(screen.getByRole("button", { name: "Registrar inventario inicial" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toMatch(/2 referencia\(s\) y 26 unidad\(es\)/);
    await user.click(within(dialogo).getByRole("button", { name: "Registrar" }));
    expect(await screen.findByText(/Inventario inicial registrado: 2 referencia\(s\), 26 unidad\(es\)/)).toBeTruthy();
    expect(llamadas[0][1].p_lineas).toEqual([{ variante_id: 2, cantidad: 6, coste_unitario: 3.025 }, { variante_id: 3, cantidad: 20, coste_unitario: 1.8 }]);
  });

  it("entrada con coste propio, salida sin pasar de lo disponible y ajuste con motivo", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    pagina(sb, "/inventario/movimiento");
    await elegir(user, { color: "Negro", talla: "M" });
    expect((await screen.findByTestId("stock-actual")).textContent).toMatch(/10 físicas/);
    expect(screen.getByLabelText("Coste unitario (€)").value).toBe("3.025");
    await user.clear(screen.getByLabelText("Coste unitario (€)"));
    await user.type(screen.getByLabelText("Coste unitario (€)"), "2,90");
    await user.type(screen.getByLabelText("Unidades"), "5");
    await user.type(screen.getByLabelText(/Referencia/), "Albarán 7");
    await user.click(screen.getByRole("button", { name: "Registrar entrada de mercancía" }));
    expect(await screen.findByText(/Entrada de mercancía registrada: \+5/)).toBeTruthy();
    expect(llamadas[0][1]).toMatchObject({ p_variante_id: 1, p_tipo: "entrada", p_cantidad: 5, p_coste_unitario: 2.9, p_referencia: "Albarán 7" });

    await user.click(screen.getByRole("radio", { name: "Salida (consumo o entrega)" }));
    await waitFor(() => expect(screen.getByTestId("stock-actual").textContent).toMatch(/15 físicas/));
    await user.type(screen.getByLabelText("Unidades"), "16");
    await user.click(screen.getByRole("button", { name: /Registrar salida/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/Solo hay 15 unidad/);
    expect(llamadas).toHaveLength(1);

    await user.click(screen.getByRole("radio", { name: "Ajuste por recuento" }));
    await user.clear(screen.getByLabelText("Unidades contadas"));
    await user.type(screen.getByLabelText("Unidades contadas"), "14");
    await user.click(screen.getByRole("button", { name: /Registrar ajuste/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/Indica el motivo/);
    await user.type(screen.getByLabelText("Motivo *"), "Recuento de octubre");
    await user.click(screen.getByRole("button", { name: /Registrar ajuste/ }));
    await screen.findByText(/Ajuste por recuento registrada: -1/);
    expect(llamadas[1][1]).toMatchObject({ p_tipo: "ajuste", p_cantidad: -1, p_motivo: "Recuento de octubre" });
  });

  it("ficha: corrección compensatoria con motivo, reservas que no pasan de lo disponible y liberación confirmada", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    pagina(sb, "/inventario/articulos/1");
    expect((await screen.findByTestId("art-disponible")).textContent).toBe("10");
    expect(screen.getByText(/Por debajo del mínimo \(12\)/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Corregir" }));
    const anular = screen.getByRole("button", { name: "Anular con un movimiento compensatorio" });
    expect(anular.disabled).toBe(true);
    await user.type(screen.getByLabelText("Motivo de la corrección *"), "Contado dos veces");
    await user.click(anular);
    expect(await screen.findByText("Movimiento corregido con un movimiento compensatorio.")).toBeTruthy();
    expect(llamadas[0]).toEqual(["corregir", { p_movimiento_id: 1, p_motivo: "Contado dos veces" }]);
    expect(screen.getByText(/corrige el nº 1/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Corregir" })).toBeNull(); // neither the original nor the correction can be corrected again

    // Back to 10 units for the reservation part
    sb.tablas.v_stock[0].fisico = 10;
    sb.tablas.v_stock[0].disponible = 10;
    cleanup();
    pagina(sb, "/inventario/articulos/1");
    await screen.findByTestId("art-disponible");
    await user.type(screen.getByLabelText("Unidades"), "11");
    await user.type(screen.getByLabelText("Para (pedido o referencia)"), "PED-1");
    await user.click(screen.getByRole("button", { name: "Reservar" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Solo hay 10 unidad/);
    await user.clear(screen.getByLabelText("Unidades"));
    await user.type(screen.getByLabelText("Unidades"), "4");
    await user.click(screen.getByRole("button", { name: "Reservar" }));
    expect(await screen.findByText("4 unidad(es) reservadas.")).toBeTruthy();
    expect(screen.getByTestId("art-reservado").textContent).toBe("4");
    expect(screen.getByTestId("art-fisico").textContent).toBe("10");
    await user.click(screen.getByRole("button", { name: "Liberar" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Liberar" }));
    expect(await screen.findByText("Reserva liberada.")).toBeTruthy();
    expect(screen.getByTestId("art-reservado").textContent).toBe("0");
  });

  it("compras sugeridas: recomendación (no compra) y registro de necesidades", async () => {
    const user = userEvent.setup();
    const { sb, tablas } = crearSb();
    pagina(sb, "/inventario/compras");
    expect((await screen.findByTestId("sugerido-1")).textContent).toBe("2");
    expect(screen.getByText(/Es una recomendación: no se compra nada/)).toBeTruthy();
    await elegir(user, { color: "Natural", talla: "TU", modelo: "Bolsa de tela", proveedor: "Productos propios" });
    await user.type(screen.getByLabelText("Unidades"), "6");
    await user.type(screen.getByLabelText("Para (opcional)"), "Encargo futuro");
    await user.click(screen.getByRole("button", { name: "Registrar necesidad" }));
    expect(await screen.findByText("Necesidad registrada.")).toBeTruthy();
    expect(tablas.stock_necesidades[0]).toMatchObject({ variante_id: 3, cantidad: 6, referencia: "Encargo futuro", estado: "pendiente" });
    expect(tablas.stock_movimientos).toHaveLength(1);
  });
});
