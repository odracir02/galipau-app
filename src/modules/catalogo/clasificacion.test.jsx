// @vitest-environment jsdom
// Bulk classification and category management with FICTITIOUS data.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProveedorDialogos from "../../shared/ui/ProveedorDialogos";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import PaginaClasificar from "./PaginaClasificar";
import PaginaCategorias from "./PaginaCategorias";

afterEach(() => cleanup());

const variante = (id, modelo_id, modelo, tipo, extra = {}) => ({
  variante_id: id, modelo_id, modelo, tipo, proveedor_id: 1, proveedor: "Proveedor Ficticio", propio: false, marca: "Marca Ficticia", referencia: null,
  color: "NEGRO", talla: "M", precio_neto: 2, iva_porcentaje: 21, precio_compra: null, coste_cent: 242, coste: 2.42, variante_activa: true, modelo_activo: true, disponible: true, ...extra,
});

const crearSb = () => {
  const llamadas = [];
  let lote = 0;
  const sb = crearClienteFalso({
    tablas: {
      v_catalogo_admin: [
        variante(1, 10, "ORION POLO", "Sin clasificar"), variante(2, 10, "ORION POLO", "Sin clasificar", { talla: "L" }),
        variante(3, 11, "VEGA", "Camiseta"),
        variante(4, 12, "VEGA WOMEN", "Sin clasificar"),
        variante(5, 13, "LYRA", "Sin clasificar", { modelo_activo: false, disponible: false }),
        variante(6, 14, "ATLAS", "Sin clasificar"),
      ],
      modelos: [[10, "Sin clasificar"], [11, "Camiseta"], [12, "Sin clasificar"], [13, "Sin clasificar"], [14, "Sin clasificar"]].map(([id, tipo]) => ({ id, tipo, descripcion: null })),
      categorias: [{ id: 1, nombre: "Camiseta", orden: 0 }, { id: 2, nombre: "Polos", orden: 0 }, { id: 3, nombre: "Sin clasificar", orden: 1000 }],
    },
    rpcs: {
      // emulates the database: only the category of the given models changes
      clasificar_modelos: ({ p_modelos, p_categoria }, tablas) => {
        llamadas.push(["clasificar", [...p_modelos], p_categoria]);
        for (const v of tablas.v_catalogo_admin) if (p_modelos.includes(v.modelo_id)) v.tipo = p_categoria;
        return { data: { lote: `L${++lote}`, cambiados: p_modelos.length, sin_cambio: 0 }, error: null };
      },
      deshacer_clasificacion: ({ p_lote }) => {
        llamadas.push(["deshacer", p_lote]);
        return { data: 1, error: null };
      },
    },
  });
  return { sb, llamadas };
};

const montar = (sb, ruta) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorDialogos>
        <Routes>
          <Route path="/catalogo/clasificar" element={<PaginaClasificar obtenerCliente={async () => sb} />} />
          <Route path="/catalogo/categorias" element={<PaginaCategorias obtenerCliente={async () => sb} />} />
        </Routes>
      </ProveedorDialogos>
    </MemoryRouter>
  );
const filas = () => [...screen.getByRole("table").querySelectorAll("tbody tr")];
// category row by its name cell (other rows list every name in their merge menu)
const filaCategoria = (nombre) => filas().find((r) => r.cells[1].textContent === nombre);

describe("clasificar modelos", () => {
  it("muestra los sin clasificar con sugerencias motivadas y acepta solo las elegidas, con vista previa y deshacer", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    montar(sb, "/catalogo/clasificar");
    await screen.findByText("ORION POLO");
    expect(filas().map((f) => f.textContent)).toEqual([
      expect.stringMatching(/ORION POLO.*Sin clasificar.*Polos · alta.*dice «POLO».*2/),
      expect.stringMatching(/VEGA WOMEN.*Sin clasificar.*Camiseta · media.*Misma familia que VEGA/),
      expect.stringMatching(/LYRA.*Archivado.*Sin clasificar.*—/),
      expect.stringMatching(/ATLAS.*Sin clasificar.*—/),
    ]);
    await user.click(screen.getByLabelText("Seleccionar ORION POLO"));
    await user.click(screen.getByLabelText("Seleccionar VEGA WOMEN"));
    await user.click(screen.getByRole("button", { name: "Aceptar sugerencias (2)" }));
    const vista = screen.getByRole("region", { name: /Vista previa: 2 modelos cambian/ });
    expect(vista.textContent).toMatch(/Sin clasificar → Polos \(1\): ORION POLO/);
    expect(vista.textContent).toMatch(/Sin clasificar → Camiseta \(1\): VEGA WOMEN/);
    expect(llamadas).toEqual([]); // nothing saved before confirming
    await user.click(within(vista).getByRole("button", { name: "Confirmar" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clasificar" }));
    expect(await screen.findByText(/2 modelos clasificados/)).toBeTruthy();
    expect(llamadas).toEqual([["clasificar", [10], "Polos"], ["clasificar", [12], "Camiseta"]]);
    expect(filas()).toHaveLength(2); // the filter shows what is still unclassified
    await user.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(await screen.findByText(/Deshecho/)).toBeTruthy();
    expect(llamadas.slice(2)).toEqual([["deshacer", "L1"], ["deshacer", "L2"]]);
  });

  it("asignación en bloque: tramo con Mayús, también un archivado (que sigue archivado) y aviso si ya tenían categoría", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    montar(sb, "/catalogo/clasificar");
    await screen.findByText("ORION POLO");
    await user.click(screen.getByLabelText("Seleccionar VEGA WOMEN"));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByLabelText("Seleccionar ATLAS"));
    await user.keyboard("{/Shift}");
    expect(screen.getByText("3 seleccionados")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Categoría", { selector: "#cl-destino" }), "Camiseta");
    await user.click(screen.getByRole("button", { name: "Asignar a 3 modelos" }));
    expect(screen.getByRole("region", { name: /3 modelos cambian/ }).textContent).toMatch(/VEGA WOMEN, LYRA, ATLAS/);
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Clasificar" }));
    await screen.findByText(/3 modelos clasificados/);
    expect(llamadas).toEqual([["clasificar", [12, 13, 14], "Camiseta"]]);
    // a classified model can be changed only on purpose, and the preview says so
    await user.selectOptions(screen.getByLabelText("Categoría", { selector: "#cl-categoria" }), "Camiseta");
    await user.click(screen.getByLabelText("Seleccionar VEGA"));
    await user.selectOptions(screen.getByLabelText("Categoría", { selector: "#cl-destino" }), "Polos");
    await user.click(screen.getByRole("button", { name: "Asignar a 1 modelo" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alertdialog")).textContent).toMatch(/1 modelo ya tenía otra categoría/);
  });
});

describe("gestionar categorías", () => {
  it("añade las propuestas que faltan, renombra y solo deja borrar las que no tienen modelos", async () => {
    const user = userEvent.setup();
    const { sb } = crearSb();
    montar(sb, "/catalogo/categorias");
    expect(await screen.findByRole("button", { name: /Añadir las categorías propuestas \(9\)/ })).toBeTruthy(); // Camisetas (as «Camiseta»), Polos and Sin clasificar already exist
    await user.click(screen.getByRole("button", { name: /Añadir las categorías propuestas/ }));
    expect(await screen.findByText(/Añadidas: Sudaderas, Chaquetas/)).toBeTruthy();
    expect(screen.getAllByRole("row").map((r) => r.textContent).join("|")).toMatch(/Ropa infantil/);
    const fila = filaCategoria("Sudaderas");
    expect(within(fila).getByRole("button", { name: "Borrar" })).toBeTruthy();
    const enUso = filaCategoria("Camiseta");
    expect(within(enUso).queryByRole("button", { name: "Borrar" })).toBeNull(); // in use: merge instead
    expect(within(enUso).getByLabelText("Fusionar Camiseta con")).toBeTruthy();
    await user.click(within(filaCategoria("Polos")).getByRole("button", { name: "Renombrar" }));
    const campo = screen.getByLabelText("Nuevo nombre de Polos");
    await user.clear(campo);
    await user.type(campo, "Polos y camisas");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/Renombrada a «Polos y camisas»/)).toBeTruthy();
  });
});
