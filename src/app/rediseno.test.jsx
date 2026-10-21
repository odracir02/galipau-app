// @vitest-environment jsdom
// Design system and navigation: themes, menu, settings area, home, customers and dialogs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { crearSesionSupabase } from "./sesion/servicios";
import { crearClienteFalso } from "../shared/supabase/clienteFalso";
import { CLAVE_PREFERENCIAS, leerPreferencias, guardarPreferencias, temaEfectivo, aplicarTema } from "./tema/preferencias";
import ProveedorTema from "./tema/ProveedorTema";
import PaginaApariencia from "../modules/configuracion/PaginaApariencia";
import PaginaInicio from "../modules/inicio/PaginaInicio";
import PaginaClientes from "../modules/clientes/PaginaClientes";
import ProveedorDialogos from "../shared/ui/ProveedorDialogos";
import { useConfirmar } from "../shared/ui/contextoDialogos";
import { resumenPresupuestos } from "../modules/presupuestos/domain/resumen";

vi.mock("../services/getProductos", async (original) => ({ ...(await original()), getProductos: vi.fn().mockResolvedValue([]) }));

const PROPIETARIO = { id: "uid-p", email: "p@example.com", password: "clave-buena" };

const almacenFalso = () => {
  const datos = {};
  return { getItem: (k) => datos[k] ?? null, setItem: (k, v) => { datos[k] = String(v); }, datos };
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-bs-theme");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const entrar = async (ruta = "/") => {
  vi.stubEnv("VITE_BACKEND", "supabase");
  window.history.pushState({}, "", ruta);
  const cliente = crearClienteFalso({ usuarios: [PROPIETARIO], propietario: PROPIETARIO.id, sesionInicial: { user: { id: PROPIETARIO.id, email: PROPIETARIO.email } } });
  const user = userEvent.setup();
  render(<App servicioSesion={crearSesionSupabase(async () => cliente)} />);
  await screen.findByRole("navigation", { name: "Navegación principal" });
  return user;
};

describe("preferencias de apariencia", () => {
  it("claro por defecto; lee y guarda; tolera datos dañados o almacenamiento bloqueado", () => {
    const a = almacenFalso();
    expect(leerPreferencias(a)).toEqual({ tema: "claro", menuContraido: false });
    guardarPreferencias({ tema: "oscuro", menuContraido: true }, a);
    expect(leerPreferencias(a)).toEqual({ tema: "oscuro", menuContraido: true });
    a.setItem(CLAVE_PREFERENCIAS, "{roto");
    expect(leerPreferencias(a).tema).toBe("claro");
    a.setItem(CLAVE_PREFERENCIAS, JSON.stringify({ tema: "violeta" }));
    expect(leerPreferencias(a).tema).toBe("claro");
    const bloqueado = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(leerPreferencias(bloqueado).tema).toBe("claro");
    expect(() => guardarPreferencias({ tema: "oscuro" }, bloqueado)).not.toThrow();
  });

  it("«según el sistema» sigue la preferencia del dispositivo", () => {
    const oscuro = { matchMedia: () => ({ matches: true }) };
    const claro = { matchMedia: () => ({ matches: false }) };
    expect(temaEfectivo("sistema", oscuro)).toBe("oscuro");
    expect(temaEfectivo("sistema", claro)).toBe("claro");
    expect(temaEfectivo("sistema", {})).toBe("claro");
    const raiz = document.createElement("html");
    expect(aplicarTema("oscuro", raiz)).toBe("oscuro");
    expect(raiz.getAttribute("data-bs-theme")).toBe("dark");
  });
});

describe("estructura y navegación", () => {
  it("modo claro por defecto; el botón cambia a oscuro y se recuerda", async () => {
    const user = await entrar();
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: "Cambiar a modo oscuro" }));
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
    expect(JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS)).tema).toBe("oscuro");
    expect(screen.getByRole("button", { name: "Cambiar a modo claro" })).toBeTruthy();
  });

  it("el menú se contrae en escritorio y se abre y cierra en móvil", async () => {
    const user = await entrar();
    const shell = document.querySelector(".gx-shell");
    await user.click(screen.getByRole("button", { name: "Contraer menú" }));
    expect(shell.classList.contains("gx-contraido")).toBe(true);
    expect(JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS)).menuContraido).toBe(true);
    await user.click(screen.getByRole("button", { name: "Expandir menú" }));
    expect(shell.classList.contains("gx-contraido")).toBe(false);

    const abrir = screen.getByRole("button", { name: "Abrir menú" });
    await user.click(abrir);
    expect(shell.classList.contains("gx-menu-abierto")).toBe(true);
    expect(abrir.getAttribute("aria-expanded")).toBe("true");
    // Navigating closes it
    await user.click(within(screen.getByRole("navigation", { name: "Navegación principal" })).getByRole("link", { name: /Clientes/ }));
    expect(shell.classList.contains("gx-menu-abierto")).toBe(false);
    await user.click(abrir);
    await user.keyboard("{Escape}");
    expect(shell.classList.contains("gx-menu-abierto")).toBe(false);
  });

  it("los módulos futuros se ven como «Pronto» y explican que no están disponibles", async () => {
    const user = await entrar();
    await user.click(screen.getByRole("link", { name: /Producción/ }));
    expect(await screen.findByRole("heading", { name: "Producción" })).toBeTruthy();
    expect(screen.getByText("Todavía no disponible")).toBeTruthy();
    expect(screen.getByText("Módulo en preparación")).toBeTruthy();
  });

  it("Configuración agrupa los ajustes; las direcciones antiguas redirigen", async () => {
    const user = await entrar();
    await user.click(screen.getByRole("link", { name: "Configuración" }));
    const sub = within(await screen.findByRole("navigation", { name: "Secciones de configuración" }));
    expect(sub.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Parámetros de cálculo", "Empresa y PDF", "Copias de seguridad", "Importación y migración", "Apariencia", "Versión antigua (temporal)",
    ]);
    await user.click(sub.getByRole("link", { name: "Versión antigua (temporal)" }));
    expect(screen.getByRole("link", { name: "Formulario de presupuesto antiguo" }).getAttribute("href")).toBe("/antiguo");
    cleanup();
    await entrar("/copias");
    await waitFor(() => expect(window.location.pathname).toBe("/configuracion/copias")); // the redirect runs after rendering
  });
});

describe("Apariencia", () => {
  it("elige tema claro, oscuro o según el sistema", async () => {
    const user = userEvent.setup();
    render(<ProveedorTema><PaginaApariencia /></ProveedorTema>);
    expect(screen.getByRole("radio", { name: /Claro/ }).checked).toBe(true);
    await user.click(screen.getByRole("radio", { name: /Oscuro/ }));
    expect(document.documentElement.getAttribute("data-bs-theme")).toBe("dark");
    await user.click(screen.getByRole("radio", { name: /Según el sistema/ }));
    expect(JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS)).tema).toBe("sistema");
  });
});

describe("Inicio", () => {
  const p = (id, estado, total, extra = {}) => ({ id, estado, total_cent: total, beneficio_cent: Math.round(total / 4), fecha_emision: "2026-10-01", cliente_nombre: `C${id}`, creado_en: `2026-10-0${id}T10:00:00Z`, numero: estado === "borrador" ? null : `2026/00${id}`, ...extra });
  const lista = [p(1, "borrador", 1000), p(2, "presentado", 20000), p(3, "aceptado", 30000), p(4, "en_produccion", 5000), p(5, "finalizado", 7000), p(6, "cobrado", 9000), p(7, "cancelado", 99999), p(8, "importado", 12345)];

  it("resumen con datos reales, sin contar cancelados ni importados en lo confirmado", () => {
    const r = resumenPresupuestos(lista, new Date("2026-10-17"));
    expect(r.borradores).toBe(1);
    expect(r.presentados).toEqual({ cantidad: 1, importeCent: 20000 });
    expect(r.enMarcha).toEqual({ cantidad: 2, importeCent: 35000 });
    expect(r.porCobrar).toEqual({ cantidad: 1, importeCent: 7000 });
    expect(r.cobradoAnioCent).toBe(9000);
    expect(r.confirmadoAnio.importeCent).toBe(51000);
    expect(r.recientes.map((x) => x.id)).not.toContain(8);
  });

  it("muestra las cifras y la actividad reciente", async () => {
    const sb = crearClienteFalso({ tablas: { presupuestos: lista, registro_copias: [] } });
    render(<MemoryRouter><PaginaInicio obtenerCliente={async () => sb} /></MemoryRouter>);
    expect((await screen.findByTestId("kpi-presentados")).textContent).toBe("1");
    expect(screen.getByTestId("kpi-en-marcha").textContent).toBe("2");
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText(/todavía no hay ninguna copia registrada/)).toBeTruthy();
  });

  it("sin presupuestos, invita a crear el primero", async () => {
    const sb = crearClienteFalso({ tablas: { presupuestos: [], registro_copias: [] } });
    render(<MemoryRouter><PaginaInicio obtenerCliente={async () => sb} /></MemoryRouter>);
    expect(await screen.findByText("Aún no hay presupuestos")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Crear el primero" }).getAttribute("href")).toBe("/presupuestos/nuevo");
  });
});

describe("Clientes", () => {
  it("busca, crea, edita y archiva (sin borrar)", async () => {
    const user = userEvent.setup();
    const sb = crearClienteFalso({ tablas: { clientes: [{ id: 1, nombre: "Club Ficticio", archivado: false, ciudad: "València" }] } });
    render(<MemoryRouter><PaginaClientes obtenerCliente={async () => sb} /></MemoryRouter>);
    expect(await screen.findByText("Club Ficticio")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    const form = within(screen.getByRole("group", { name: "Nuevo cliente" }));
    await user.type(form.getByLabelText("Nombre *"), "Peña Inventada");
    await user.click(form.getByRole("button", { name: "Guardar cliente" }));
    expect(await screen.findByText("Cliente «Peña Inventada» guardado.")).toBeTruthy();
    expect(sb.tablas.clientes).toHaveLength(2);
    const fila = (await screen.findByText("Club Ficticio")).closest("tr");
    await user.click(within(fila).getByRole("button", { name: "Archivar" }));
    await waitFor(() => expect(screen.queryByText("Club Ficticio")).toBeNull());
    expect(sb.tablas.clientes.find((c) => c.id === 1).archivado).toBe(true);
    await user.click(screen.getByLabelText("Mostrar archivados"));
    expect(await screen.findByText("Club Ficticio")).toBeTruthy();
    expect(within(screen.getByText("Club Ficticio").closest("tr")).getByRole("link", { name: "Presupuestos" }).getAttribute("href")).toBe("/presupuestos?cliente=Club%20Ficticio");
  });
});

describe("diálogos de confirmación", () => {
  function Prueba({ alResponder }) {
    const confirmar = useConfirmar();
    return <button type="button" onClick={async () => alResponder(await confirmar({ titulo: "¿Seguro?", mensaje: "No se puede deshacer.", aceptar: "Sí, hacerlo", peligro: true }))}>Abrir</button>;
  }

  it("accesible: el foco empieza en la opción segura; aceptar, cancelar y Escape", async () => {
    const user = userEvent.setup();
    const alResponder = vi.fn();
    render(<ProveedorDialogos><Prueba alResponder={alResponder} /></ProveedorDialogos>);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    const dialogo = screen.getByRole("alertdialog", { name: "¿Seguro?" });
    expect(dialogo.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement.textContent).toBe("Cancelar");
    await user.click(within(dialogo).getByRole("button", { name: "Sí, hacerlo" }));
    expect(alResponder).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.keyboard("{Escape}");
    expect(alResponder).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
