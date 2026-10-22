// @vitest-environment jsdom
// Orders screens with FICTITIOUS data.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProveedorDialogos from "../../shared/ui/ProveedorDialogos";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import PaginaPedidos from "./PaginaPedidos";
import PaginaPedido from "./PaginaPedido";
import PaginaNuevoPedido from "./PaginaNuevoPedido";

afterEach(() => cleanup());

const resumen = (id, numero, cambios) => ({
  id, numero, presupuesto_id: null, presupuesto_numero: null, cliente_id: 1, cliente_nombre: "Club Ficticio", estado: "pendiente_preparar", cobro_estado: "pendiente",
  importe_cobrado_cent: 0, precio_acordado_cent: 12000, coste_previsto_cent: 8000, fecha_entrega: null, fecha_inicio_prevista: null, creado_en: "2026-10-20T10:00:00Z",
  unidades: 0, unidades_cubiertas: 0, unidades_faltan: 0, pendiente_comprar: 0, pendiente_recibir: 0, lineas_sin_catalogo: 0, ...cambios,
});

const crearSb = (extraRpcs = {}, estadoPedido = "pendiente_preparar", extraTablas = {}) => {
  const llamadas = [];
  const sb = crearClienteFalso({
    tablas: {
      v_pedidos: [
        resumen(1, "P-2026/001", { fecha_entrega: "2026-10-20", unidades: 11, unidades_cubiertas: 6, unidades_faltan: 5 }),
        resumen(2, "P-2026/002", { estado: "en_produccion", fecha_entrega: "2026-12-01" }),
        resumen(3, "P-2026/003", { estado: "entregado", cobro_estado: "cobrado", cliente_nombre: "Peña Inventada" }),
      ],
      pedidos: [{
        id: 1, numero: "P-2026/001", presupuesto_id: 9, cliente_nombre: "Club Ficticio", estado: estadoPedido, cobro_estado: "pendiente", importe_cobrado_cent: 0,
        precio_acordado_cent: 12000, coste_previsto_cent: 8000, economico: { presupuesto_numero: "2026/009", beneficio_cent: 4000, parametros_version: 3 },
        trabajo: { tecnica: "serigrafia", zonas: [{ nombre: "Pecho", colores: 2 }] }, fecha_entrega: "2026-11-20", fecha_inicio_prevista: null, instrucciones: "Tinta al agua",
        notas_internas: null, creado_en: "2026-10-20T10:00:00Z",
      }],
      pedido_lineas: [
        { id: 1, pedido_id: 1, variante_id: 7, descripcion: "Base · NEGRO M", cantidad: 6, coste_unitario_previsto: 3.025, orden: 1 },
        { id: 2, pedido_id: 1, variante_id: 8, descripcion: "Base · NEGRO L", cantidad: 5, coste_unitario_previsto: 3.025, orden: 2 },
        { id: 3, pedido_id: 1, variante_id: null, descripcion: "Delantal del cliente", cantidad: 2, coste_unitario_previsto: 0, orden: 3 },
      ],
      pedido_eventos: [{ id: 1, pedido_id: 1, tipo: "creado", descripcion: "Pedido creado desde el presupuesto 2026/009", creado_en: "2026-10-20T10:00:00Z" }],
      v_pedidos_material: [
        { pedido_id: 1, variante_id: 7, modelo: "Base", color: "NEGRO", talla: "M", necesario: 6, reservado: 0, usado: 0, merma: 0, devuelto: 0, falta: 6, disponible_almacen: 10, pendiente_comprar: 0, pendiente_recibir: 0 },
        { pedido_id: 1, variante_id: 8, modelo: "Base", color: "NEGRO", talla: "L", necesario: 5, reservado: 0, usado: 0, merma: 0, devuelto: 0, falta: 5, disponible_almacen: 3, pendiente_comprar: 0, pendiente_recibir: 0 },
      ],
      presupuestos: [{
        id: 9, numero: "2026/009", estado: "aceptado", cliente_nombre: "Club Ficticio", total_cent: 12000, precio_final_cent: 12000,
        entrada: { formulario: { lineas: [{ productoId: "7", quantity: "6" }, { descripcion: "Delantal del cliente", quantity: "2" }], zonas: [{ nombre: "Pecho", colores: 2 }] },
          lineas: [{ descripcion: "Base", color: "NEGRO", talla: "M", precioUnitario: 3.025 }, { descripcion: "Delantal del cliente", precioUnitario: 0 }] },
      }],
      ...extraTablas,
    },
    rpcs: {
      ...Object.fromEntries(["crear_pedido_desde_presupuesto", "pedido_reservar", "pedido_consumir", "pedido_cambiar_estado", "pedido_necesidad_estado", "pedido_registrar_cobro", "pedido_terminar"].map((n) => [
        n, (args) => {
          llamadas.push([n, args]);
          return { data: n === "crear_pedido_desde_presupuesto" ? 5 : null, error: null };
        },
      ])),
      ...extraRpcs,
    },
  });
  return { sb, llamadas };
};

const montar = (sb, ruta) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorDialogos>
        <Routes>
          <Route path="/pedidos" element={<PaginaPedidos obtenerCliente={async () => sb} hoy="2026-10-22" />} />
          <Route path="/pedidos/nuevo" element={<PaginaNuevoPedido obtenerCliente={async () => sb} />} />
          <Route path="/pedidos/:id" element={<PaginaPedido obtenerCliente={async () => sb} />} />
        </Routes>
      </ProveedorDialogos>
    </MemoryRouter>
  );
const aceptarDialogo = async (user, boton) => user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: boton }));

describe("listado de pedidos", () => {
  it("primero lo que requiere atención, con el motivo; las demás vistas y la búsqueda", async () => {
    const user = userEvent.setup();
    const { sb } = crearSb();
    montar(sb, "/pedidos");
    const filas = async () => [...(await screen.findByRole("table")).querySelectorAll("tbody tr")].map((f) => f.textContent);
    expect(await filas()).toEqual([expect.stringMatching(/P-2026\/001.*Entrega retrasada 2 días · Faltan 5 prendas.*Hace 2 días.*Pendiente de preparar.*6 de 11 listas.*faltan 5/)]);
    await user.click(screen.getByRole("button", { name: "En curso (2)" }));
    expect(await filas()).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Todos (3)" }));
    await user.type(screen.getByLabelText("Buscar"), "peña");
    expect(await filas()).toEqual([expect.stringMatching(/P-2026\/003.*Peña Inventada.*Entregado.*Cobrado/)]);
  });
});

describe("crear un pedido desde un presupuesto", () => {
  it("un presupuesto que ya tiene pedido no crea otro: enlaza con el existente", async () => {
    const { sb, llamadas } = crearSb();
    montar(sb, "/pedidos/nuevo?presupuesto=9");
    expect(await screen.findByText(/ya tiene el pedido/)).toBeTruthy(); // order 1 points to quote 9
    expect(llamadas).toEqual([]);
  });

  it("presupuesto sin pedido: vista previa y creación", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    await sb.from("pedidos").delete().eq("id", 1);
    montar(sb, "/pedidos/nuevo?presupuesto=9");
    expect(await screen.findByText(/6 × Base · NEGRO M/)).toBeTruthy();
    expect(screen.getByText(/sin vincular al catálogo/)).toBeTruthy();
    await user.type(screen.getByLabelText("Fecha de entrega prevista"), "2026-11-20");
    await user.click(screen.getByRole("button", { name: "Crear pedido" }));
    await aceptarDialogo(user, "Crear pedido");
    expect(llamadas).toEqual([["crear_pedido_desde_presupuesto", { p_presupuesto_id: 9, p_datos: { fecha_entrega: "2026-11-20", fecha_inicio_prevista: "", instrucciones: "", notas_internas: "" } }]]);
  });
});

describe("ficha del pedido", () => {
  it("explica el siguiente paso y reserva solo lo confirmado; lo que falta va solo a Compras", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    montar(sb, "/pedidos/1");
    expect(await screen.findByText(/Hay prendas en el almacén para este pedido/)).toBeTruthy();
    expect(screen.getByText(/No vinculadas al catálogo.*2 × Delantal del cliente/)).toBeTruthy();
    expect(screen.getByText(/Pecho \(2 colores\)/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reservar prendas" }));
    const propuesta = screen.getByRole("region", { name: "Propuesta de reserva" });
    expect(within(propuesta).getByLabelText(/NEGRO M/).value).toBe("6");
    expect(within(propuesta).getByLabelText(/NEGRO L/).value).toBe("3"); // only 3 free
    await user.click(within(propuesta).getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alertdialog")).textContent).toMatch(/Lo que falte aparece solo en «Compras»/);
    await aceptarDialogo(user, "Reservar");
    expect(llamadas).toEqual([["pedido_reservar", { p_pedido_id: 1, p_lineas: [{ variante_id: 7, cantidad: 6 }, { variante_id: 8, cantidad: 3 }], p_registrar_faltantes: false }]]);
  });

  it("anota prendas estropeadas y cancelar exige un motivo (opción avanzada)", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    montar(sb, "/pedidos/1");
    await user.click(await screen.findByRole("button", { name: "Anotar prendas usadas o estropeadas" }));
    await user.selectOptions(screen.getByLabelText("Qué ha pasado"), "merma");
    await user.type(screen.getByLabelText("Cantidad"), "1");
    await user.type(screen.getByLabelText("Nota (opcional)"), "Mancha");
    await user.click(screen.getByRole("button", { name: "Anotar" }));
    await aceptarDialogo(user, "Anotar");
    expect(llamadas[0]).toEqual(["pedido_consumir", { p_pedido_id: 1, p_variante_id: 7, p_cantidad: 1, p_tipo: "merma", p_motivo: "Mancha", p_desde_disponible: false }]);
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull(); // hidden until "Más opciones"
    await user.click(screen.getByRole("button", { name: "Más opciones" }));
    await user.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    const boton = screen.getByRole("button", { name: "Cancelar el pedido" });
    expect(boton.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Por qué se cancela/), "El cliente lo anula");
    await user.click(boton);
    expect(llamadas[1]).toEqual(["pedido_cambiar_estado", { p_pedido_id: 1, p_estado: "cancelado", p_motivo: "El cliente lo anula" }]);
  });

  it("avanzar de estado pide confirmación; el cobro va aparte", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    montar(sb, "/pedidos/1");
    await user.click(await screen.findByRole("button", { name: "Listo para producción" }));
    await aceptarDialogo(user, "Listo para producción");
    await user.click(screen.getByRole("button", { name: "Poner todo cobrado" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(llamadas).toEqual([
      ["pedido_cambiar_estado", { p_pedido_id: 1, p_estado: "listo_produccion", p_motivo: null }],
      ["pedido_registrar_cobro", { p_pedido_id: 1, p_importe_cobrado_cent: 12000, p_nota: null }],
    ]);
  });
});

describe("material y compras", () => {
  it("lo que falta aparece por comprar (con enlace a Compras) o en camino con su compra; ya no hay que anotarlo", async () => {
    const { sb } = crearSb({}, "pendiente_material", {
      v_pedidos_material: [
        { pedido_id: 1, variante_id: 7, modelo: "Base", color: "NEGRO", talla: "M", necesario: 6, reservado: 6, usado: 0, merma: 0, devuelto: 0, falta: 0, disponible_almacen: 0, pendiente_comprar: 0, pendiente_recibir: 0 },
        { pedido_id: 1, variante_id: 8, modelo: "Base", color: "NEGRO", talla: "L", necesario: 5, reservado: 0, usado: 0, merma: 0, devuelto: 0, falta: 5, disponible_almacen: 0, pendiente_comprar: 3, pendiente_recibir: 2 },
      ],
      v_compras_lineas: [{ compra_id: 4, numero: "C-2026/004", variante_id: 8, pendiente: 2, estado: "pedida" }],
    });
    montar(sb, "/pedidos/1");
    const fila = (await screen.findByText("Base · NEGRO L")).closest("tr");
    expect(fila.textContent).toMatch(/3 por comprar\s*Ir a Compras\s*2 en camino · C-2026\/004/);
    expect(within(fila).getByRole("link", { name: "C-2026/004" }).getAttribute("href")).toBe("/compras/4");
    expect(screen.queryByRole("button", { name: "Ya pedidas" })).toBeNull();
    expect(screen.getByText(/prepara la compra en «Compras»/)).toBeTruthy();
  });
});

describe("terminar el pedido con consumo automático", () => {
  const plan = (cambios) => () => ({ data: { consumos: [{ variante_id: 7, descripcion: "Base · NEGRO M", cantidad: 6 }, { variante_id: 8, descripcion: "Base · NEGRO L", cantidad: 5 }], incidencias: [], sin_catalogo: [{ descripcion: "Delantal del cliente", cantidad: 2 }], estado: "en_produccion", permitido: true, ...cambios }, error: null });

  it("muestra lo que se descontará y termina en un solo paso", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb({ pedido_preparar_terminar: plan({}) }, "en_produccion");
    montar(sb, "/pedidos/1");
    await user.click(await screen.findByRole("button", { name: "Marcar como terminado" }));
    const panel = screen.getByRole("region", { name: "Terminar el pedido" });
    expect(panel.textContent).toMatch(/6 × Base · NEGRO M.*5 × Base · NEGRO L/);
    expect(panel.textContent).toMatch(/no se descuentan.*2 × Delantal del cliente/);
    expect(llamadas).toEqual([]); // nothing done before confirming
    await user.click(within(panel).getByRole("button", { name: "Terminar y descontar" }));
    expect(await screen.findByText("Pedido terminado y prendas descontadas del almacén.")).toBeTruthy();
    expect(llamadas).toEqual([["pedido_terminar", { p_pedido_id: 1, p_esperado: [{ variante_id: 7, cantidad: 6 }, { variante_id: 8, cantidad: 5 }] }]]);
  });

  it("si hay incidencias explica qué resolver y no termina", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb({ pedido_preparar_terminar: plan({ consumos: [], incidencias: [{ variante_id: 8, tipo: "faltan", mensaje: "Base · NEGRO L: faltan 2 por reservar o anotar. Resérvalas o anota cómo se usaron." }] }) }, "en_produccion");
    montar(sb, "/pedidos/1");
    await user.click(await screen.findByRole("button", { name: "Marcar como terminado" }));
    const panel = screen.getByRole("region", { name: "Terminar el pedido" });
    expect(panel.textContent).toMatch(/Antes de terminar.*faltan 2 por reservar.*No se ha descontado nada/);
    expect(within(panel).queryByRole("button", { name: /Terminar/ })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Entendido" }));
    expect(llamadas).toEqual([]);
  });

  it("sin la función nueva en la base, se comporta como antes (solo cambia el estado)", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb({}, "en_produccion"); // pedido_preparar_terminar does not exist
    montar(sb, "/pedidos/1");
    await user.click(await screen.findByRole("button", { name: "Marcar como terminado" }));
    await aceptarDialogo(user, "Marcar como terminado");
    expect(llamadas).toEqual([["pedido_cambiar_estado", { p_pedido_id: 1, p_estado: "terminado", p_motivo: null }]]);
  });
});
