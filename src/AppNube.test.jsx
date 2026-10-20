// @vitest-environment jsdom
// The app in cloud mode (VITE_BACKEND=supabase) with a fake Supabase client.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { crearSesionSupabase } from "./app/sesion/servicios";
import { crearClienteFalso } from "./shared/supabase/clienteFalso";
import PaginaCopiasNube from "./modules/copias/PaginaCopiasNube";
import { avisosCopias, exportarDatos } from "./modules/copias/copiasNube";
import { leerCatalogoSupabase } from "./services/getProductos";

vi.mock("./services/getProductos", async (original) => ({ ...(await original()), getProductos: vi.fn().mockResolvedValue([]) }));

const PROPIETARIO = { id: "uid-p", email: "p@example.com", password: "clave-buena" };
const OTRO = { id: "uid-o", email: "o@example.com", password: "otra-clave" };

beforeEach(() => {
  vi.stubEnv("VITE_BACKEND", "supabase");
  window.history.pushState({}, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const arrancar = (opciones = {}) => {
  const cliente = crearClienteFalso({ usuarios: [PROPIETARIO, OTRO], propietario: PROPIETARIO.id, ...opciones });
  render(<App servicioSesion={crearSesionSupabase(async () => cliente)} />);
  return cliente;
};

describe("App en la nube — acceso", () => {
  it("pide email y contraseña, y el propietario entra", async () => {
    const user = userEvent.setup();
    arrancar();
    expect(await screen.findByText("Accede con tu cuenta privada.")).toBeTruthy();
    expect(screen.queryByText(/Primer uso/)).toBeNull();
    await user.type(screen.getByLabelText("Email"), PROPIETARIO.email);
    await user.type(screen.getByLabelText("Contraseña"), PROPIETARIO.password);
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Inicio" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nuevo presupuesto" }).getAttribute("href")).toBe("/presupuestos/nuevo");
    const menu = within(screen.getByRole("navigation", { name: "Navegación principal" }));
    expect(menu.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Inicio", "Calculadora de costes", "Presupuestos", "Clientes", "Catálogo", "PedidosPronto", "ProducciónPronto", "Inventario",
    ]);
    expect(screen.getByRole("link", { name: "Configuración" }).getAttribute("href")).toBe("/configuracion");
    expect(screen.queryByRole("link", { name: "Versión antigua" })).toBeNull();
    expect(screen.getByRole("contentinfo").textContent).toBe("Galipau Arts · Galipau App");
  });

  it("una cuenta que no es la propietaria no accede", async () => {
    const user = userEvent.setup();
    arrancar();
    await user.type(await screen.findByLabelText("Email"), OTRO.email);
    await user.type(screen.getByLabelText("Contraseña"), OTRO.password);
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Esta cuenta no tiene acceso a Galipau App.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Inicio" })).toBeNull();
  });

  it("contraseña incorrecta y campos vacíos", async () => {
    const user = userEvent.setup();
    arrancar();
    await user.click(await screen.findByRole("button", { name: "Entrar" }));
    expect(screen.getByRole("alert").textContent).toBe("Introduce tu email y tu contraseña.");
    await user.type(screen.getByLabelText("Email"), PROPIETARIO.email);
    await user.type(screen.getByLabelText("Contraseña"), "mala");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Email o contraseña incorrectos.");
  });

  it("cerrar sesión vuelve al acceso", async () => {
    const user = userEvent.setup();
    arrancar({ sesionInicial: { user: PROPIETARIO } });
    await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
  });
});

describe("copias en la nube", () => {
  const ahora = Date.parse("2026-10-15T12:00:00Z");

  it("avisos según el registro de copias", () => {
    expect(avisosCopias({}, ahora)).toHaveLength(2);
    expect(avisosCopias({ base_datos: { estado: "correcta", creada_en: "2026-10-15T03:00:00Z" }, archivos: { estado: "correcta", creada_en: "2026-10-12T03:00:00Z" } }, ahora)).toEqual([]);
    expect(avisosCopias({ base_datos: { estado: "correcta", creada_en: "2026-10-12T03:00:00Z" }, archivos: { estado: "fallida", creada_en: "2026-10-15T03:00:00Z" } }, ahora).join(" ")).toMatch(/más de 48 horas.*falló/);
  });

  it("la exportación incluye todas las tablas, paginando", async () => {
    const clientes = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, nombre: `C${i}` }));
    const sb = crearClienteFalso({ tablas: { clientes, configuracion: [{ clave: "k", valor: 1 }] } });
    const datos = await exportarDatos(sb, new Date("2026-10-15T00:00:00Z"));
    expect(datos.exportadoEn).toBe("2026-10-15T00:00:00.000Z");
    expect(datos.tablas.clientes).toHaveLength(1200);
    expect(datos.tablas.configuracion).toHaveLength(1);
    expect(Object.keys(datos.tablas)).toEqual(["configuracion", "contadores", "parametros_calculo", "importaciones", "clientes", "proveedores", "modelos", "variantes", "presupuestos", "stock_articulos", "stock_movimientos", "stock_reservas", "stock_necesidades"]);
  });

  it("la página muestra el estado de las copias y descarga la exportación", async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => "blob:galipau");
    URL.revokeObjectURL = vi.fn();
    const clic = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const sb = crearClienteFalso({
      tablas: {
        registro_copias: [{ tipo: "base_datos", estado: "correcta", creada_en: new Date().toISOString() }],
        clientes: [{ id: 1, nombre: "C" }],
      },
    });
    render(<PaginaCopiasNube obtenerCliente={async () => sb} />);
    expect(await screen.findByText(/verificada/)).toBeTruthy();
    expect(screen.getByText("Archivos: todavía no hay ninguna copia registrada.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Exportar todos los datos" }));
    expect(await screen.findByText(/Exportación descargada \(1 registros\)/)).toBeTruthy();
    expect(clic).toHaveBeenCalled();
    clic.mockRestore();
  });
});

describe("catálogo desde Supabase", () => {
  it("convierte céntimos a euros y lee más de 1.000 variantes", async () => {
    const vista = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, tipo: "Camiseta", proveedor: "P", modelo: "M", talla: "M", color: "Negro", coste_cent: 235 }));
    const sb = crearClienteFalso({ tablas: { v_catalogo_plano: vista } });
    const productos = await leerCatalogoSupabase(sb);
    expect(productos).toHaveLength(1001);
    expect(productos[0]).toEqual({ id: "1", tipo: "Camiseta", proveedor: "P", modelo: "M", talla: "M", color: "Negro", costeCent: 235, coste: 2.35, precioNeto: null, ivaPorcentaje: null });
    // Exact cost from net price + VAT (four decimals, not rounded to cents)
    const exacta = crearClienteFalso({ tablas: { v_catalogo_plano: [{ id: 9, tipo: "Camiseta", proveedor: "P", modelo: "M", talla: "M", color: "Blanco", coste_cent: 303, coste: "3.025", precio_neto: "2.5000", iva_porcentaje: "21.00" }] } });
    expect((await leerCatalogoSupabase(exacta))[0]).toMatchObject({ coste: 3.025, costeCent: 303, precioNeto: 2.5, ivaPorcentaje: 21 });
    expect(sb.llamadas).toEqual(["v_catalogo_plano:0-999", "v_catalogo_plano:1000-1999"]);
  });
});
