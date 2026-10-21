// @vitest-environment jsdom
// Catalogue administration with FICTITIOUS data (no real suppliers or prices).
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import ProveedorDialogos from "../../shared/ui/ProveedorDialogos";
import { crearClienteFalso } from "../../shared/supabase/clienteFalso";
import PaginaCatalogo from "./PaginaCatalogo";
import PaginaProveedores from "./PaginaProveedores";
import PaginaFichaProveedor from "./PaginaFichaProveedor";
import PaginaFichaModelo from "./PaginaFichaModelo";
import { interpretarPrecio, costeEfectivo, precioDeVariante, combinaciones, separarLista, validarVariante, validarModelo, describirPrecio } from "./domain/catalogo";

afterEach(() => cleanup());

describe("precios de compra", () => {
  it("neto + IVA: coste = neto × (1 + IVA), con 5 decimales si hace falta", () => {
    const r = interpretarPrecio({ modo: "neto", importe: "2,125", iva: "21" });
    expect(r.valores).toEqual({ precio_neto: 2.125, iva_porcentaje: 21, precio_compra: null });
    expect(r.coste).toBeCloseTo(2.57125, 12);
  });

  it("precio con IVA incluido: el coste es el precio, nunca se suma el IVA otra vez", () => {
    const r = interpretarPrecio({ modo: "final", importe: "3,10", iva: "21" });
    expect(r.valores).toEqual({ precio_neto: null, iva_porcentaje: 21, precio_compra: 3.1 });
    expect(r.coste).toBe(3.1);
    expect(interpretarPrecio({ modo: "final", importe: "3,10", iva: "" }).valores.iva_porcentaje).toBeNull();
  });

  it.each([
    [{ modo: "neto", importe: "", iva: "21" }, /precio válido/],
    [{ modo: "neto", importe: "-1", iva: "21" }, /precio válido/],
    [{ modo: "neto", importe: "1,23456", iva: "21" }, /4 decimales/],
    [{ modo: "neto", importe: "2", iva: "" }, /IVA de compra/],
    [{ modo: "neto", importe: "2", iva: "150" }, /entre 0 y 100/],
    [{ modo: "x", importe: "2", iva: "" }, /Elige/],
  ])("rechaza %j", (entrada, mensaje) => {
    expect(interpretarPrecio(entrada).error).toMatch(mensaje);
  });

  it("coste efectivo y descripción de cada forma de precio (como la vista de la base de datos)", () => {
    expect(costeEfectivo({ precio_neto: "2.5000", iva_porcentaje: "21.00" })).toBeCloseTo(3.025, 12);
    expect(costeEfectivo({ precio_neto: null, precio_compra: "1.8000" })).toBe(1.8);
    expect(costeEfectivo({ precio_neto: null, precio_compra: null, coste_cent: 415 })).toBe(4.15);
    expect(describirPrecio({ precio_neto: 2.5, iva_porcentaje: 21 })).toMatch(/2,50\s€ \+ 21 % IVA/);
    expect(describirPrecio({ precio_compra: 3.1, iva_porcentaje: 21 })).toMatch(/IVA incl\. \(21 %\)/);
    expect(precioDeVariante({ precio_neto: "2.1250", iva_porcentaje: "21.00" })).toEqual({ modo: "neto", importe: "2.125", iva: "21" });
  });
});

describe("variantes: combinaciones y duplicados", () => {
  it("lista de colores sin repetidos y rejilla que marca lo que ya existe", () => {
    expect(separarLista("Negro, blanco;Rojo\nnegro ,  ")).toEqual(["Negro", "blanco", "Rojo"]);
    const r = combinaciones(["Negro", "Blanco"], ["S", "M"], [{ color: "negro", talla: "s" }]);
    expect(r.map((c) => [c.color, c.talla, c.existe])).toEqual([["Negro", "S", true], ["Negro", "M", false], ["Blanco", "S", false], ["Blanco", "M", false]]);
  });

  it("no admite color + talla repetidos (sin mirar mayúsculas), salvo la propia variante al editarla", () => {
    const existentes = [{ id: 1, color: "Negro", talla: "M" }];
    expect(validarVariante({ color: "NEGRO", talla: "m" }, existentes)).toEqual(["Ya existe la variante NEGRO · m en este modelo."]);
    expect(validarVariante({ color: "Negro", talla: "M" }, existentes, 1)).toEqual([]);
    expect(validarModelo({ nombre: "Bolsa", tipo: "" })[0]).toMatch(/tipo de artículo/);
  });
});

const crearSb = () =>
  crearClienteFalso({
    tablas: {
      proveedores: [{ id: 1, nombre: "Proveedor Ficticio", activo: true, contacto: "Ana" }],
      modelos: [
        { id: 10, proveedor_id: 1, tipo: "Camiseta", nombre: "Base", referencia: "B-1", descripcion: null, activo: true },
        { id: 20, proveedor_id: null, tipo: "Bolsa", nombre: "Bolsa de tela", referencia: null, descripcion: null, activo: true },
      ],
      variantes: [
        { id: 100, modelo_id: 10, color: "Negro", talla: "M", coste_cent: 303, precio_neto: 2.5, iva_porcentaje: 21, precio_compra: null, activo: true },
        { id: 101, modelo_id: 10, color: "Negro", talla: "L", coste_cent: 303, precio_neto: 2.5, iva_porcentaje: 21, precio_compra: null, activo: false },
        { id: 200, modelo_id: 20, color: "Natural", talla: "TU", coste_cent: 180, precio_neto: null, iva_porcentaje: null, precio_compra: 1.8, activo: true },
      ],
      v_catalogo_admin: [
        { variante_id: 100, modelo_id: 10, proveedor_id: 1, proveedor: "Proveedor Ficticio", propio: false, tipo: "Camiseta", modelo: "Base", color: "Negro", talla: "M", precio_neto: 2.5, iva_porcentaje: 21, precio_compra: null, coste_cent: 303, coste: 3.025, variante_activa: true, disponible: true },
        { variante_id: 101, modelo_id: 10, proveedor_id: 1, proveedor: "Proveedor Ficticio", propio: false, tipo: "Camiseta", modelo: "Base", color: "Negro", talla: "L", precio_neto: 2.5, iva_porcentaje: 21, precio_compra: null, coste_cent: 303, coste: 3.025, variante_activa: false, disponible: false },
        { variante_id: 200, modelo_id: 20, proveedor_id: null, proveedor: null, propio: true, tipo: "Bolsa", modelo: "Bolsa de tela", color: "Natural", talla: "TU", precio_neto: null, iva_porcentaje: null, precio_compra: 1.8, coste_cent: 180, coste: 1.8, variante_activa: true, disponible: true },
      ],
    },
  });

const pagina = (sb, ruta) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorDialogos>
        <Routes>
          <Route path="/catalogo" element={<PaginaCatalogo obtenerCliente={async () => sb} />} />
          <Route path="/catalogo/proveedores" element={<PaginaProveedores obtenerCliente={async () => sb} />} />
          <Route path="/catalogo/proveedores/:id" element={<PaginaFichaProveedor obtenerCliente={async () => sb} />} />
          <Route path="/catalogo/modelos/:id" element={<PaginaFichaModelo obtenerCliente={async () => sb} />} />
        </Routes>
      </ProveedorDialogos>
    </MemoryRouter>
  );

describe("interfaz del catálogo", () => {
  it("listado general con filtros por proveedor, color, talla y estado; productos propios sin proveedor", async () => {
    const user = userEvent.setup();
    pagina(crearSb(), "/catalogo");
    const filas = async () => [...(await screen.findByRole("table")).querySelectorAll("tbody tr")];
    expect((await filas()).map((f) => f.textContent)).toEqual([expect.stringMatching(/Proveedor Ficticio.*Base.*Negro.*M.*3,025\s€/), expect.stringMatching(/Propio.*Bolsa de tela.*1,80\s€/)]);
    expect(screen.getByText(/no son existencias/i)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Proveedor"), "__propios__");
    expect((await filas())).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText("Proveedor"), "");
    await user.selectOptions(screen.getByLabelText("Estado"), "archivados");
    expect((await filas())[0].textContent).toMatch(/Base.*Archivado.*Negro.*L/);
    await user.selectOptions(screen.getByLabelText("Estado"), "todos");
    await user.selectOptions(screen.getByLabelText("Talla"), "TU");
    expect((await filas())).toHaveLength(1);
  });

  it("alta de proveedor con datos opcionales y tarjeta de productos propios", async () => {
    const user = userEvent.setup();
    const sb = crearSb();
    pagina(sb, "/catalogo/proveedores");
    await screen.findByText("Proveedor Ficticio");
    expect(screen.getByText("Productos propios").closest("a").getAttribute("href")).toBe("/catalogo/proveedores/propios");
    await user.click(screen.getByRole("button", { name: "Nuevo proveedor" }));
    const form = within(screen.getByRole("form", { name: "Nuevo proveedor" }));
    await user.click(form.getByRole("button", { name: "Crear proveedor" }));
    expect(form.getByRole("alert").textContent).toMatch(/nombre del proveedor es obligatorio/);
    await user.type(form.getByLabelText("Nombre *"), "Mayorista Inventado");
    await user.type(form.getByLabelText("Nuestro nº de cliente"), "C-77");
    await user.click(form.getByRole("button", { name: "Crear proveedor" }));
    expect(await screen.findByText(/Proveedor «Mayorista Inventado» creado/)).toBeTruthy();
    expect(sb.tablas.proveedores[1]).toMatchObject({ nombre: "Mayorista Inventado", referencia_cliente: "C-77", email: null });
  });

  it("ficha de proveedor: crear modelo de cualquier tipo, editar datos y archivar con confirmación (sin borrar)", async () => {
    const user = userEvent.setup();
    const sb = crearSb();
    pagina(sb, "/catalogo/proveedores/1");
    expect(await screen.findByRole("heading", { name: "Proveedor Ficticio" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Nuevo modelo" }));
    const form = within(screen.getByRole("form", { name: "Nuevo modelo" }));
    await user.type(form.getByLabelText("Nombre del modelo *"), "Capucha");
    await user.type(form.getByLabelText("Tipo de artículo *"), "Sudadera");
    await user.click(form.getByRole("button", { name: "Crear y añadir variantes" }));
    expect(await screen.findByText("«Capucha» creado.")).toBeTruthy();
    expect(sb.tablas.modelos.at(-1)).toMatchObject({ proveedor_id: 1, tipo: "Sudadera", nombre: "Capucha", referencia: null });

    await user.click(screen.getByRole("button", { name: "Archivar" }));
    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo.textContent).toMatch(/No se borra nada/);
    await user.click(within(dialogo).getByRole("button", { name: "Archivar proveedor" }));
    await screen.findByText("Proveedor archivado.");
    expect(sb.tablas.proveedores[0].activo).toBe(false);
    expect(sb.tablas.modelos.filter((m) => m.proveedor_id === 1)).toHaveLength(2);
  });

  it("productos propios: se crean sin proveedor", async () => {
    const user = userEvent.setup();
    const sb = crearSb();
    pagina(sb, "/catalogo/proveedores/propios");
    expect(await screen.findByText("Bolsa de tela")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Nuevo producto propio" }));
    const form = within(screen.getByRole("form", { name: "Nuevo producto propio" }));
    await user.type(form.getByLabelText("Nombre del modelo *"), "Delantal");
    await user.type(form.getByLabelText("Tipo de artículo *"), "Delantal");
    await user.click(form.getByRole("button", { name: "Crear y añadir variantes" }));
    await screen.findByText("«Delantal» creado.");
    expect(sb.tablas.modelos.at(-1)).toMatchObject({ proveedor_id: null, nombre: "Delantal" });
    expect(sb.tablas.proveedores).toHaveLength(1);
  });

  it("ficha de modelo: alta en bloque marcando solo las combinaciones confirmadas, con un precio común", async () => {
    const user = userEvent.setup();
    const sb = crearSb();
    pagina(sb, "/catalogo/modelos/10");
    expect(await screen.findByRole("heading", { name: "Base" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Añadir variantes" }));
    const alta = within(screen.getByRole("region", { name: "Añadir variantes" }));
    await user.type(alta.getByLabelText("Colores (separados por comas)"), "Negro, Blanco");
    await user.click(alta.getByRole("button", { name: "S" }));
    await user.click(alta.getByRole("button", { name: "M" }));
    // Negro M already exists; nothing is ticked by default
    expect(alta.getByText(/0 de 3 nuevas/)).toBeTruthy();
    await user.click(alta.getByRole("button", { name: /^Crear 0/ }));
    expect(alta.getByRole("alert").textContent).toMatch(/precio válido|Marca al menos/);
    await user.click(alta.getByLabelText("Negro S"));
    await user.click(alta.getByLabelText("Blanco M"));
    await user.type(alta.getByLabelText("Precio neto (€)"), "2,125");
    expect(alta.getByTestId("coste-efectivo").textContent).toMatch(/2,57125\s€/);
    await user.click(alta.getByRole("button", { name: "Crear 2 variante(s)" }));
    expect(await screen.findByText("2 variante(s) creada(s).")).toBeTruthy();
    const nuevas = sb.tablas.variantes.slice(-2);
    expect(nuevas.map((v) => [v.color, v.talla, v.precio_neto, v.iva_porcentaje, v.precio_compra, v.coste_cent])).toEqual([["Negro", "S", 2.125, 21, null, 257], ["Blanco", "M", 2.125, 21, null, 257]]);
  });

  it("edición rápida del precio (con IVA incluido), duplicado controlado y archivado de variantes", async () => {
    const user = userEvent.setup();
    const sb = crearSb();
    pagina(sb, "/catalogo/modelos/10");
    const fila = (await screen.findByText("3,025 €", { exact: false })).closest("tr");
    await user.click(within(fila).getByRole("button", { name: "Editar" }));
    const editor = within(screen.getByRole("group", { name: "Editar variante" }));
    await user.click(editor.getByLabelText("Precio con IVA ya incluido"));
    await user.clear(editor.getByLabelText("Precio pagado (€)"));
    await user.type(editor.getByLabelText("Precio pagado (€)"), "3,10");
    await user.click(editor.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/Variante guardada\. Los presupuestos guardados no cambian/)).toBeTruthy();
    expect(sb.tablas.variantes[0]).toMatchObject({ precio_neto: null, precio_compra: 3.1, iva_porcentaje: 21, coste_cent: 310 });

    // Duplicate: same colour and size is rejected
    await user.click(screen.getByLabelText("Mostrar archivadas"));
    const negroM = screen.getAllByRole("row").find((r) => /Negro\s*M/.test(r.textContent) && !/Archivada/.test(r.textContent));
    await user.click(within(negroM).getByRole("button", { name: "Duplicar" }));
    const dup = within(screen.getByRole("group", { name: "Duplicar variante" }));
    await user.type(dup.getByLabelText("Talla"), "L");
    await user.click(dup.getByRole("button", { name: "Crear copia" }));
    expect(dup.getByRole("alert").textContent).toMatch(/Ya existe la variante Negro · L/);
    await user.clear(dup.getByLabelText("Talla"));
    await user.type(dup.getByLabelText("Talla"), "XL");
    await user.click(dup.getByRole("button", { name: "Crear copia" }));
    await screen.findByText("Variante duplicada.");
    expect(sb.tablas.variantes.at(-1)).toMatchObject({ color: "Negro", talla: "XL", precio_compra: 3.1 });

    const xl = await waitFor(() => {
      const r = screen.getAllByRole("row").find((x) => /Negro\s*XL/.test(x.textContent));
      expect(r).toBeTruthy();
      return r;
    });
    await user.click(within(xl).getByRole("button", { name: "Archivar" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archivar" }));
    await waitFor(() => expect(sb.tablas.variantes.at(-1).activo).toBe(false));
    expect(sb.tablas.variantes).toHaveLength(4); // nothing deleted
  });
});

describe("catálogo grande: filtros por marca, tipo y modelo, y paginación", () => {
  const fila = (n) => ({
    variante_id: n, modelo_id: 1000 + Math.floor(n / 10), proveedor_id: 1, proveedor: "Proveedor Ficticio", propio: false, tipo: n % 2 ? "Sudadera" : "Camiseta",
    modelo: `Modelo ${Math.floor(n / 10)}`, marca: n < 60 ? "Marca A" : "Marca B", color: n % 3 ? "Negro" : "Blanco", talla: ["S", "M", "L", "XL", "XXL"][n % 5],
    precio_neto: 2, iva_porcentaje: 21, precio_compra: null, coste_cent: 242, coste: 2.42, variante_activa: true, disponible: true,
  });
  const sb = () => crearClienteFalso({ tablas: { v_catalogo_admin: Array.from({ length: 120 }, (_, n) => fila(n)) } });

  it("pagina de 50 en 50 y filtra combinando marca, tipo, modelo y búsqueda", async () => {
    const user = userEvent.setup();
    pagina(sb(), "/catalogo");
    const filas = async () => [...(await screen.findByRole("table")).querySelectorAll("tbody tr")];
    expect(await filas()).toHaveLength(50);
    expect(screen.getByText("1–50 de 120")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    await user.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await filas()).toHaveLength(20);
    await user.selectOptions(screen.getByLabelText("Marca"), "Marca B");
    expect(await filas()).toHaveLength(50); // filtering goes back to page 1
    expect(screen.getByText("1–50 de 60")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Tipo"), "Sudadera");
    expect(await filas()).toHaveLength(30);
    expect([...screen.getByLabelText("Modelo").options].map((o) => o.value)).toHaveLength(7); // "Todos" + models of Marca B
    await user.selectOptions(screen.getByLabelText("Modelo"), "Modelo 7");
    expect((await filas()).map((f) => f.textContent).every((t) => /Modelo 7.*Sudadera.*Marca B/.test(t))).toBe(true);
    await user.type(screen.getByLabelText("Buscar"), "xxl");
    await waitFor(async () => expect(await filas()).toHaveLength(1));
  });
});

describe("ficha del modelo: modalidad y tarifas alternativas", () => {
  it("muestra de qué modalidad sale el precio y las alternativas guardadas", async () => {
    const sb = crearClienteFalso({
      tablas: {
        proveedores: [{ id: 1, nombre: "Proveedor Ficticio", activo: true }],
        modelos: [{ id: 10, proveedor_id: 1, tipo: "Camiseta", nombre: "Base", marca: "Marca A", referencia: "B-1", activo: true }],
        variantes: [{
          id: 100, modelo_id: 10, color: "Negro", talla: "M", coste_cent: 160, precio_neto: 1.32, iva_porcentaje: 21, precio_compra: null, activo: true, modalidad: "unidad",
          variantes_tarifas: [{ modalidad: "caja", precio: "1.1000", unidades: 50 }, { modalidad: "pack", precio: "1.1550", unidades: 5 }, { modalidad: "unidad", precio: "1.3200", unidades: null }],
        }],
      },
    });
    pagina(sb, "/catalogo/modelos/10");
    const fila = (await screen.findByRole("table")).querySelector("tbody tr");
    expect(fila.textContent).toMatch(/1,32\s€ \+ 21 % IVA · unidad/);
    expect(fila.textContent).toMatch(/Alternativas: caja 1,10\s€ \(×50\) · pack 1,155\s€ \(×5\)/);
    expect(screen.getByText(/Camiseta · Marca A · Proveedor Ficticio · Ref\. B-1/)).toBeTruthy();
  });
});
