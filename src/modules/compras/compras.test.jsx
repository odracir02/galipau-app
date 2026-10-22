// @vitest-environment jsdom
// Purchases screens with FICTITIOUS data.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProveedorDialogos from "../../shared/ui/ProveedorDialogos";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import PaginaCompras from "./PaginaCompras";
import PaginaCompra from "./PaginaCompra";

afterEach(() => cleanup());

const compra = (cambios) => ({
  id: 5, numero: "C-2026/005", proveedor_id: 1, proveedor: "Proveedor Ficticio", proveedor_web: "https://proveedor.example.com", estado: "borrador", situacion: "borrador",
  referencia_proveedor: null, fecha_pedido: null, motivo_cancelacion: null, lineas: 2, unidades: 14, recibidas: 0, pendientes: 14, cerradas: 0,
  base_prevista_cent: 3500, iva_previsto_cent: 735, total_previsto_cent: 4235, base_real_cent: 0, iva_real_cent: 0, total_real_cent: 0, sin_precio: false, recepciones: 0, ...cambios,
});
const lineaCompra = (cambios) => ({
  compra_id: 5, numero: "C-2026/005", estado: "borrador", proveedor_id: 1, marca: null, modelo: "Base", referencia: "B-100", color: "NEGRO", tipo: "Camisetas",
  para_pedidos: 0, reposicion: 0, recibido: 0, cerrada: 0, precio_neto: 2.5, iva_porcentaje: 21, caja_unidades: null, orden: 1, ...cambios,
});

const crearSb = ({ compras = [compra()], lineas, rpcs = {} } = {}) => {
  const llamadas = [];
  const registrar = (nombre, data = null) => (args) => {
    llamadas.push([nombre, args]);
    return { data, error: null };
  };
  const sb = crearClienteFalso({
    tablas: {
      v_compras_por_comprar: [
        { variante_id: 7, proveedor_id: 1, proveedor: "Proveedor Ficticio", modelo: "Base", color: "NEGRO", talla: "M", para_pedidos: 7, reposicion: 2 },
        { variante_id: 8, proveedor_id: 1, proveedor: "Proveedor Ficticio", modelo: "Base", color: "NEGRO", talla: "L", para_pedidos: 5, reposicion: 0 },
        { variante_id: 9, proveedor_id: 2, proveedor: "Otro Proveedor", modelo: "Polo", color: "BLANCO", talla: "M", para_pedidos: 0, reposicion: 4 },
      ],
      v_compras_por_comprar_pedidos: [
        { variante_id: 7, pedido_id: 1, numero: "P-2026/001", fecha_entrega: "2026-11-20", pendiente_comprar: 3 },
        { variante_id: 7, pedido_id: 2, numero: "P-2026/002", fecha_entrega: "2026-11-10", pendiente_comprar: 4 },
        { variante_id: 8, pedido_id: 1, numero: "P-2026/001", fecha_entrega: "2026-11-20", pendiente_comprar: 5 },
      ],
      v_compras: compras,
      v_compras_lineas: lineas ?? [
        lineaCompra({ id: 11, variante_id: 8, talla: "L", para_pedidos: 5, cantidad: 5, pendiente: 5, caja_unidades: 50, orden: 2 }),
        lineaCompra({ id: 10, variante_id: 7, talla: "M", para_pedidos: 7, reposicion: 2, cantidad: 9, pendiente: 9 }),
      ],
      compra_eventos: [{ id: 1, compra_id: 5, tipo: "creada", descripcion: "Compra preparada con lo que hay por comprar", creado_en: "2026-10-22T10:00:00Z" }],
      proveedores: [{ id: 1, nombre: "Proveedor Ficticio", activo: true }, { id: 2, nombre: "Otro Proveedor", activo: true }],
      v_catalogo_admin: [],
    },
    rpcs: {
      compra_preparar: registrar("compra_preparar", 5),
      compra_guardar_lineas: registrar("compra_guardar_lineas"),
      compra_marcar_pedida: registrar("compra_marcar_pedida"),
      ...rpcs,
    },
  });
  return { sb, llamadas };
};

const montar = (sb, ruta) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorDialogos>
        <Routes>
          <Route path="/compras" element={<PaginaCompras obtenerCliente={async () => sb} />} />
          <Route path="/compras/:id" element={<PaginaCompra obtenerCliente={async () => sb} />} />
        </Routes>
      </ProveedorDialogos>
    </MemoryRouter>
  );

describe("compras", () => {
  it("por comprar: una tarjeta por proveedor, pedidos y reposición separados; con borrador se actualiza en un clic", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    montar(sb, "/compras");
    const tarjeta = await screen.findByRole("article", { name: "Por comprar a Proveedor Ficticio" });
    expect(tarjeta.textContent).toMatch(/14 prendas.*12 para pedidos.*2 para reponer el almacén.*Para P-2026\/002, P-2026\/001 · entrega más próxima 10\/11\/2026/);
    expect(screen.getByRole("article", { name: "Por comprar a Otro Proveedor" }).textContent).toMatch(/4 para reponer/);
    await user.click(within(tarjeta).getByRole("button", { name: "Actualizar el borrador C-2026/005" }));
    expect(llamadas).toEqual([["compra_preparar", { p_proveedor_id: 1 }]]);
    expect(await screen.findByRole("heading", { name: "Compra C-2026/005" })).toBeTruthy();
  });

  it("borrador: tallas en orden, aviso de cajas, ajustar y marcar como pedida con la referencia en un solo clic", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    montar(sb, "/compras/5");
    expect(await screen.findByText(/Compra estas prendas en la web del proveedor/)).toBeTruthy();
    const filas = screen.getAllByRole("row").map((r) => r.textContent);
    expect(filas.findIndex((t) => /^M/.test(t))).toBeLessThan(filas.findIndex((t) => /^L/.test(t)));
    expect(screen.getByText("Para P-2026/001 (3), P-2026/002 (4)")).toBeTruthy();
    expect(screen.getByText("El proveedor también la vende en cajas de 50: pides 5.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Web de Proveedor Ficticio/ }).getAttribute("href")).toBe("https://proveedor.example.com/");
    const reponer = screen.getByLabelText("Para el almacén, talla M de Base NEGRO");
    await user.clear(reponer);
    await user.type(reponer, "0");
    await user.type(screen.getByLabelText("Nº de pedido en la web (opcional)"), "WEB-77");
    await user.click(screen.getByRole("button", { name: "Marcar como pedida" }));
    await waitFor(() => expect(llamadas.length).toBe(2));
    expect(llamadas).toEqual([
      ["compra_guardar_lineas", { p_compra_id: 5, p_lineas: [{ variante_id: 7, para_pedidos: 7, reposicion: 0 }] }],
      ["compra_marcar_pedida", { p_compra_id: 5, p_referencia: "WEB-77" }],
    ]);
  });

  it("copiar la lista para comprar en la web; descartar está en «Más opciones»; sin web válida no hay enlace", async () => {
    const user = userEvent.setup();
    const escribir = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escribir }, configurable: true });
    const { sb } = crearSb({ compras: [compra({ proveedor_web: "javascript:alert(1)" })] });
    montar(sb, "/compras/5");
    await user.click(await screen.findByRole("button", { name: "Copiar lista" }));
    expect(escribir).toHaveBeenCalledWith("Compra C-2026/005 · Proveedor Ficticio\nB-100 · Base · NEGRO → M: 9 · L: 5\nTotal: 14 prendas");
    expect(screen.queryByRole("link", { name: /Web de/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Descartar el borrador" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Más opciones" }));
    expect(screen.getByRole("button", { name: "Descartar el borrador" })).toBeTruthy();
  });

  it("llegada: viene rellena con lo pendiente, resume reservas y confirma con su clave y lo mostrado", async () => {
    const user = userEvent.setup();
    const plan = (lineas) => ({
      entradas: lineas.map((l) => ({ compra_linea_id: l.compra_linea_id, cantidad: l.cantidad, pendiente: l.compra_linea_id === 10 ? 9 : 5, exceso: Math.max(l.cantidad - (l.compra_linea_id === 10 ? 9 : 5), 0) })),
      reservas: [{ pedido_id: 2, numero: "P-2026/002", variante_id: 7, cantidad: 4 }, { pedido_id: 1, numero: "P-2026/001", variante_id: 7, cantidad: 3 }],
      libres: [{ variante_id: 7, cantidad: 2 }],
      listos: [{ pedido_id: 2, numero: "P-2026/002" }],
      exceso: lineas.reduce((s, l) => s + Math.max(l.cantidad - (l.compra_linea_id === 10 ? 9 : 5), 0), 0),
    });
    const previas = [];
    const { sb, llamadas } = crearSb({
      compras: [compra({ estado: "pedida", situacion: "pedida", fecha_pedido: "2026-10-22" })],
      rpcs: {
        compra_previsualizar_recepcion: (args) => {
          previas.push(args.p_lineas);
          return { data: plan(args.p_lineas), error: null };
        },
        compra_recibir: (args) => {
          llamadas.push(["compra_recibir", args]);
          return { data: { unidades: 14, reservas: plan(args.p_lineas).reservas }, error: null };
        },
      },
    });
    montar(sb, "/compras/5");
    await user.click(await screen.findByRole("button", { name: "Registrar llegada" }));
    const panel = screen.getByRole("region", { name: "Registrar llegada" });
    expect(within(panel).getByLabelText("Base · NEGRO M").value).toBe("9");
    expect(within(panel).getByLabelText("Base · NEGRO L").value).toBe("5");
    expect((await within(panel).findByTestId("resumen-llegada")).textContent).toMatch(/Entran 14 prendas.*P-2026\/002 \(4\), P-2026\/001 \(3\).*libres en el almacén: 2.*«Listo para producción»: P-2026\/002/);

    // two more L than ordered: needs an explicit check
    const l = within(panel).getByLabelText("Base · NEGRO L");
    await user.clear(l);
    await user.type(l, "7");
    await within(panel).findByText(/Han llegado/);
    const confirmar = within(panel).getByRole("button", { name: "Confirmar llegada" });
    await waitFor(() => expect(previas.at(-1)).toEqual([{ compra_linea_id: 10, cantidad: 9 }, { compra_linea_id: 11, cantidad: 7 }]));
    expect(confirmar.disabled).toBe(true);
    await user.click(within(panel).getByLabelText("Son correctas: añadirlas al almacén"));
    await user.type(within(panel).getByLabelText("Nº de albarán (opcional)"), "ALB-9");
    await waitFor(() => expect(confirmar.disabled).toBe(false));
    await user.click(confirmar);
    await screen.findByText(/Llegada registrada: 14 prendas en el almacén, 7 reservadas para los pedidos/);
    const [, args] = llamadas.find(([n]) => n === "compra_recibir");
    expect(args).toMatchObject({
      p_compra_id: 5, p_clave: expect.stringMatching(/^[0-9a-f-]{36}$/), p_albaran: "ALB-9", p_confirmar_exceso: true,
      p_lineas: [{ compra_linea_id: 10, cantidad: 9 }, { compra_linea_id: 11, cantidad: 7 }],
      p_esperado: [{ pedido_id: 2, variante_id: 7, cantidad: 4 }, { pedido_id: 1, variante_id: 7, cantidad: 3 }],
    });
  });

  it("una compra recibida es solo consulta: sin acciones", async () => {
    const { sb } = crearSb({
      compras: [compra({ estado: "pedida", situacion: "recibida", recibidas: 14, pendientes: 0, recepciones: 1, base_real_cent: 3300, iva_real_cent: 693, total_real_cent: 3993 })],
      lineas: [lineaCompra({ id: 10, variante_id: 7, talla: "M", para_pedidos: 9, cantidad: 9, recibido: 9, pendiente: 0, estado: "pedida" })],
    });
    montar(sb, "/compras/5");
    expect(await screen.findByText("Total real recibido")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Registrar llegada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Más opciones" })).toBeNull();
    expect(screen.queryByText(/Siguiente paso/)).toBeNull();
  });
});
