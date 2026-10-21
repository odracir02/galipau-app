// @vitest-environment jsdom
// Price-list import wizard and history with FICTITIOUS data (no real suppliers or prices).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProveedorDialogos from "../../shared/ui/ProveedorDialogos";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import PaginaImportarTarifa from "./PaginaImportarTarifa";
import { PaginaTarifas, PaginaImportacionTarifa } from "./PaginaTarifas";
import { crearXlsx, TARIFA_SOLS_FICTICIA, TARIFA_ROLY_FICTICIA } from "./domain/xlsxPrueba";

afterEach(() => cleanup());

const fila = (variante_id, color, talla, precio_neto, extra = {}) => ({
  variante_id, modelo_id: 10, proveedor_id: 1, proveedor: "SOL'S", propio: false, tipo: "Camiseta", modelo: "ORION", referencia: null, color, talla,
  precio_neto, iva_porcentaje: 21, precio_compra: null, coste_cent: 0, variante_activa: true, disponible: true, ...extra,
});

const crearSb = () => {
  const llamadas = [];
  const sb = crearClienteFalso({
    tablas: {
      proveedores: [{ id: 1, nombre: "SOL'S", activo: true, modalidad_tarifa: null }],
      v_catalogo_admin: [fila(1, "BLANCO", "M", 2.1), fila(2, "COLOR", "M", 2.3)],
      variantes_tarifas: [],
      importaciones: [],
      importaciones_cambios: [],
    },
    rpcs: {
      // emulates the database function: applies price changes to the view rows
      importar_tarifa: ({ p_meta, p_operaciones }, tablas) => {
        llamadas.push({ p_meta, p_operaciones });
        for (const o of p_operaciones) {
          const v = tablas.v_catalogo_admin.find((x) => x.variante_id === o.variante_id);
          if (o.accion === "precio") Object.assign(v, o.precio);
        }
        tablas.importaciones.push({ id: 7, tipo: "tarifa_proveedor", creada_en: "2026-10-21T10:00:00Z", proveedor_id: 1, usuario: "u-1", resumen: p_meta, revertida_en: null });
        return { data: 7, error: null };
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
          <Route path="/catalogo/tarifas" element={<PaginaTarifas obtenerCliente={async () => sb} />} />
          <Route path="/catalogo/tarifas/importar" element={<PaginaImportarTarifa obtenerCliente={async () => sb} />} />
          <Route path="/catalogo/tarifas/:id" element={<PaginaImportacionTarifa obtenerCliente={async () => sb} />} />
        </Routes>
      </ProveedorDialogos>
    </MemoryRouter>
  );

describe("asistente de importación de tarifas", () => {
  it("analiza sin guardar, exige elegir modalidad e interpretación y solo aplica lo decidido", async () => {
    const user = userEvent.setup();
    const { sb, llamadas } = crearSb();
    montar(sb, "/catalogo/tarifas/importar");
    await user.click(screen.getByRole("button", { name: "Siguiente" })); // 1 -> 2 (detect supplier)
    const excel = new File([crearXlsx([{ nombre: "Tarifa", filas: TARIFA_SOLS_FICTICIA }])], "tarifa-ficticia.xlsx");
    await user.upload(screen.getByLabelText("Excel de la tarifa (.xlsx)"), excel);

    // 3. analysis: supplier detected, nothing saved
    expect(await screen.findByText(/formato SOL'S/)).toBeTruthy();
    expect(await screen.findByText("2 variantes")).toBeTruthy();
    expect(llamadas).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    // 4. preview
    expect(screen.getByRole("table").textContent).toMatch(/ORION.*XS a XXL/);
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    // 5. pre-filled only with what the owner confirmed for this supplier's file, visible and editable
    const seguir = screen.getByRole("button", { name: "Siguiente" });
    expect(screen.getByText(/Confirmado por el propietario para la tarifa SOL'S/)).toBeTruthy();
    expect(screen.getByLabelText(/^Tarifa/).checked).toBe(true);
    expect(screen.getByLabelText(/Precio neto/).checked).toBe(true);
    expect(screen.getByText(/coincide con el precio actual en 1 de 2/)).toBeTruthy();
    const iva = screen.getByLabelText("IVA de compra (%)");
    expect(iva.value).toBe("21");
    await user.clear(iva);
    expect(seguir.disabled).toBe(true); // a VAT rate is required
    await user.type(iva, "21");
    await user.click(seguir);

    // 6. conflicts: two prices for ORION WOMEN COLOR 3XL
    await user.selectOptions(screen.getByLabelText(/ORION WOMEN · COLOR · 3XL/), "8");
    // size groups: a group is rejected as a size; individual sizes split it
    const grupo = screen.getByLabelText(/«2A a 12A»/);
    await user.type(grupo, "2A a 12A");
    expect(screen.getByText(/es un grupo de tallas: escribe cada talla por separado/)).toBeTruthy();
    await user.clear(grupo);
    await user.type(grupo, "2A, 4A");
    expect(screen.getByText("2 tallas: 02A, 04A")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    // 7. decisions: everything starts as "ignorar"
    expect(screen.getByRole("tab", { name: /Precio diferente \(1\)/ }).getAttribute("aria-selected")).toBe("true");
    await user.selectOptions(screen.getByLabelText("Decisión para ORION COLOR M"), "actualizar");
    await user.click(screen.getByRole("tab", { name: /Variante nueva/ }));
    expect(screen.getByLabelText("Decisión para ORION KIDS COLOR 04A")).toBeTruthy();
    await user.type(screen.getByLabelText("Buscar en la lista"), "LYRA");
    await user.click(screen.getByRole("button", { name: /Añadir: todas las de la lista \(1\)/ }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    // 8. a new model needs its garment type
    expect(screen.getByText(/Indica el tipo de artículo del modelo nuevo «LYRA»/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Siguiente" }).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Atrás" }));
    await user.type(screen.getByLabelText("LYRA"), "Bolsa");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText(/1 variantes nuevas \(1 modelos nuevos\)/)).toBeTruthy();
    expect(screen.getByRole("table", { name: "Variantes que se crearán" }).textContent).toMatch(/LYRA.*COLOR.*TU.*9,50/);
    expect(screen.getByText(/1 precios actualizados \(1 suben, 0 bajan\)/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    // 9. confirm
    await user.click(screen.getByRole("button", { name: "Aplicar tarifa" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Aplicar tarifa" }));
    expect(await screen.findByText(/Tarifa aplicada \(importación nº 7\)/)).toBeTruthy();

    expect(llamadas).toHaveLength(1);
    const { p_meta, p_operaciones } = llamadas[0];
    expect(p_meta).toMatchObject({ proveedor_id: 1, modalidad: "tarifa", interpretacion: "neto", iva: 21, archivo: { nombre: "tarifa-ficticia.xlsx", formato: "sols" } });
    expect(p_meta.archivo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(p_operaciones.filter((o) => o.accion === "completar_modelo")).toEqual([{ accion: "completar_modelo", modelo_id: 10, referencia: "5001", marca: "SOL'S" }]);
    expect(p_operaciones.filter((o) => o.accion !== "tarifas" && o.accion !== "completar_modelo")).toEqual([
      { accion: "precio", variante_id: 2, precio: { precio_neto: 2.4, iva_porcentaje: 21, precio_compra: null }, modalidad: "tarifa", tarifas: [{ modalidad: "tarifa", precio: 2.4, unidades: null }] },
      expect.objectContaining({ accion: "alta", modelo: { nombre: "LYRA", referencia: "5004", tipo: "Bolsa", marca: "NEOBLU" }, color: "COLOR", talla: "TU" }),
    ]);
    // 10. verification against the catalogue read again (the fake does not create variants)
    expect(screen.getByText(/Comprobado en el catálogo: 1 de 2 cambios/)).toBeTruthy();
  });

  it("ROLY: Unidad propuesta; la alternativa Pack (solo packs de 1 unidad) hay que elegirla y queda indicada", async () => {
    const user = userEvent.setup();
    const sb = crearClienteFalso({ tablas: { proveedores: [{ id: 5, nombre: "ROLY", activo: true }], v_catalogo_admin: [], variantes_tarifas: [] } });
    montar(sb, "/catalogo/tarifas/importar");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.upload(screen.getByLabelText("Excel de la tarifa (.xlsx)"), new File([crearXlsx([{ nombre: "Tarifa", filas: TARIFA_ROLY_FICTICIA }])], "roly-ficticia.xlsx"));
    expect(await screen.findByText(/formato ROLY/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByLabelText(/^Unidad/).checked).toBe(true);
    expect(screen.getByLabelText(/No importarla/).checked).toBe(true);
    await user.click(screen.getByLabelText(/Usar el precio de Pack solo cuando el pack es de 1 unidad \(1 filas\)/));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("tab", { name: /Variante nueva/ }));
    await user.type(screen.getByLabelText("Buscar en la lista"), "EPSILON");
    const filas = [...screen.getByRole("table").querySelectorAll("tbody tr")];
    expect(filas).toHaveLength(3); // S, M, L: one variant per size
    expect(filas[0].textContent).toMatch(/5,25\s€ \+ 21 % IVA \(pack\)/);
  });

  it("un archivo que no es una tarifa se explica y no avanza", async () => {
    const user = userEvent.setup();
    const { sb } = crearSb();
    montar(sb, "/catalogo/tarifas/importar");
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.upload(screen.getByLabelText("Excel de la tarifa (.xlsx)"), new File([crearXlsx([{ nombre: "x", filas: [["hola"]] }])], "otra-cosa.xlsx"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No se reconoce el formato/);
    expect(screen.getByRole("button", { name: "Siguiente" }).disabled).toBe(true);
  });
});

describe("historial de tarifas", () => {
  const conHistorial = () => {
    let revertida = false;
    const sb = crearClienteFalso({
      tablas: {
        proveedores: [{ id: 1, nombre: "SOL'S", activo: true }],
        importaciones: [{
          id: 7, tipo: "tarifa_proveedor", creada_en: "2026-10-21T10:00:00Z", proveedor_id: 1, usuario: "u-1", revertida_en: null,
          resumen: { modalidad: "tarifa", interpretacion: "neto", iva: 21, archivo: { nombre: "tarifa-ficticia.xlsx", sha256: "f".repeat(64), formato: "sols", hoja: "Tarifa" }, resumen: { operaciones: { precio: 1 } } },
        }],
        importaciones_cambios: [{ id: 1, importacion_id: 7, accion: "precio", variante_id: 2, antes: { precio_neto: 2.3, iva_porcentaje: 21 }, despues: { precio_neto: 2.4, iva_porcentaje: 21 } }],
        v_catalogo_admin: [fila(2, "COLOR", "M", 2.4)],
      },
      rpcs: {
        revertir_tarifa: (_, tablas) => {
          revertida = true;
          tablas.importaciones[0].revertida_en = "2026-10-21T11:00:00Z";
          return { data: { precios_restaurados: 1, precios_conservados: 0 }, error: null };
        },
      },
    });
    return { sb, revertida: () => revertida };
  };

  it("lista las importaciones y muestra el detalle con cada precio anterior", async () => {
    const { sb } = conHistorial();
    montar(sb, "/catalogo/tarifas");
    expect((await screen.findByRole("table")).textContent).toMatch(/7.*SOL'S.*tarifa-ficticia\.xlsx.*tarifa.*1 precio.*Aplicada/);
    await userEvent.setup().click(screen.getByRole("link", { name: "7" }));
    expect(await screen.findByText(/ORION · COLOR · M/)).toBeTruthy();
    expect(screen.getByRole("table").textContent).toMatch(/2,30\s€ \+ 21 % IVA → 2,40\s€ \+ 21 % IVA/);
    expect(screen.getByText("f".repeat(64))).toBeTruthy();
  });

  it("revertir pide confirmación e informa de lo que se ha hecho", async () => {
    const user = userEvent.setup();
    const { sb, revertida } = conHistorial();
    montar(sb, "/catalogo/tarifas/7");
    await user.click(await screen.findByRole("button", { name: "Revertir" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revertir" }));
    expect((await screen.findByText(/Importación revertida: 1 precios restaurados/)).textContent).toBeTruthy();
    expect(revertida()).toBe(true);
    expect(await screen.findByText(/Revertida/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revertir" })).toBeNull();
  });
});
