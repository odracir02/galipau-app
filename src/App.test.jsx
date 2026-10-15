// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { CLAVE_HISTORIAL } from "./domain/historialPresupuestos";
import { registroActual } from "./domain/historialPresupuestos.fixtures";

vi.mock("./services/getProductos", () => ({ getProductos: vi.fn().mockResolvedValue([]) }));

// Minimal fake of the local API (no real server, no real data)
const crearApiFalsa = ({ configurado = true, autenticado = true, accesoLocal = true } = {}) => {
  const estado = { configurado, autenticado, accesoLocal, contrasena: "clave-correcta", copias: [] };
  const responder = (status, cuerpo) => Promise.resolve(new Response(cuerpo === undefined ? "" : JSON.stringify(cuerpo), { status }));
  const llamadas = [];
  const fetchFalso = vi.fn((url, opciones = {}) => {
    const metodo = opciones.method ?? "GET";
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : undefined;
    llamadas.push(`${metodo} ${url}`);
    if (url === "/api/auth/estado") return responder(200, { configurado: estado.configurado, autenticado: estado.autenticado, accesoLocal: estado.accesoLocal });
    if (url === "/api/auth/configurar") {
      estado.configurado = true;
      estado.autenticado = true;
      estado.contrasena = cuerpo.contrasena;
      return responder(201, { ok: true });
    }
    if (url === "/api/auth/login") {
      if (cuerpo.contrasena !== estado.contrasena) return responder(401, { error: "Contraseña incorrecta.", codigo: "credenciales_invalidas" });
      estado.autenticado = true;
      return responder(200, { ok: true });
    }
    if (url === "/api/auth/logout") {
      estado.autenticado = false;
      return responder(200, { ok: true });
    }
    if (!estado.autenticado) return responder(401, { error: "Inicia sesión para continuar.", codigo: "no_autenticado" });
    if (url === "/api/copias/estado") {
      return responder(200, {
        ultima: estado.copias[0] ?? null, horasEntreCopias: 24, carpetaLocal: "C:\\datos\\copias", destinoExterno: null,
        oneDriveDetectado: "C:\\Users\\demo\\OneDrive", totalCopias: estado.copias.length,
        avisos: ["Las copias solo se guardan en este PC."],
      });
    }
    if (url === "/api/copias" && metodo === "GET") return responder(200, estado.copias.map((c) => ({ archivo: c.archivo, fecha: c.creadaEn, motivo: c.motivo, tamanoBytes: 81920 })));
    if (url === "/api/copias" && metodo === "POST") {
      const copia = { archivo: "galipau-20261015-100000-000-manual.db", motivo: "manual", creadaEn: "2026-10-15T08:00:00.000Z", integridadOk: true };
      estado.copias.unshift(copia);
      return responder(201, copia);
    }
    return responder(404, { error: "no encontrado" });
  });
  return { estado, fetchFalso, llamadas };
};

let apiFalsa;
const arrancar = (opciones, ruta = "/") => {
  apiFalsa = crearApiFalsa(opciones);
  vi.stubGlobal("fetch", apiFalsa.fetchFalso);
  window.history.pushState({}, "", ruta);
  render(<App />);
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App — acceso", () => {
  it("primer uso: crea la contraseña y entra", async () => {
    const user = userEvent.setup();
    arrancar({ configurado: false, autenticado: false });
    expect(await screen.findByText(/Primer uso: crea la contraseña/)).toBeTruthy();

    await user.type(screen.getByLabelText("Nueva contraseña"), "corta");
    await user.click(screen.getByRole("button", { name: "Crear contraseña y entrar" }));
    expect(screen.getByRole("alert").textContent).toMatch(/al menos 8/);

    await user.clear(screen.getByLabelText("Nueva contraseña"));
    await user.type(screen.getByLabelText("Nueva contraseña"), "mi-clave-segura");
    await user.type(screen.getByLabelText("Repite la contraseña"), "otra-distinta");
    await user.click(screen.getByRole("button", { name: "Crear contraseña y entrar" }));
    expect(screen.getByRole("alert").textContent).toMatch(/no coinciden/);

    await user.clear(screen.getByLabelText("Repite la contraseña"));
    await user.type(screen.getByLabelText("Repite la contraseña"), "mi-clave-segura");
    await user.click(screen.getByRole("button", { name: "Crear contraseña y entrar" }));
    expect(await screen.findByRole("heading", { name: "Generar presupuesto" })).toBeTruthy();
    expect(apiFalsa.estado.contrasena).toBe("mi-clave-segura");
  });

  it("desde otro dispositivo no permite crear la contraseña", async () => {
    arrancar({ configurado: false, autenticado: false, accesoLocal: false });
    expect(await screen.findByText(/desde el propio PC/)).toBeTruthy();
    expect(screen.queryByLabelText("Nueva contraseña")).toBeNull();
  });

  it("login: muestra el error del servidor y entra con la contraseña correcta", async () => {
    const user = userEvent.setup();
    arrancar({ autenticado: false });
    await user.type(await screen.findByLabelText("Contraseña"), "mala");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Contraseña incorrecta.");

    await user.clear(screen.getByLabelText("Contraseña"));
    await user.type(screen.getByLabelText("Contraseña"), "clave-correcta");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("heading", { name: "Generar presupuesto" })).toBeTruthy();
  });

  it("cerrar sesión vuelve a la pantalla de acceso", async () => {
    const user = userEvent.setup();
    arrancar();
    await user.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByLabelText("Contraseña")).toBeTruthy();
    expect(apiFalsa.llamadas).toContain("POST /api/auth/logout");
  });

  it("si la sesión caduca, una petición 401 devuelve al acceso", async () => {
    const user = userEvent.setup();
    arrancar();
    await user.click(await screen.findByRole("link", { name: "Copias de seguridad" }));
    await screen.findByRole("heading", { name: "Copias de seguridad" });
    apiFalsa.estado.autenticado = false; // session expired on the server
    await user.click(screen.getByRole("button", { name: "Hacer copia ahora" }));
    expect(await screen.findByLabelText("Contraseña")).toBeTruthy();
  });

  it("muestra un error claro si el servidor no responde", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    window.history.pushState({}, "", "/");
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/No se puede conectar con el servidor/);
  });
});

describe("App — navegación", () => {
  it("navega del formulario al historial y vuelve", async () => {
    const user = userEvent.setup();
    localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify([registroActual]));
    arrancar();

    expect(await screen.findByRole("heading", { name: "Generar presupuesto" })).toBeTruthy();
    await user.click(screen.getByRole("link", { name: "Ver historial" }));

    expect(screen.getByRole("heading", { name: "Historial de presupuestos" })).toBeTruthy();
    expect(screen.getByText("Asociación Mixta")).toBeTruthy();
    expect(screen.getByText("DTF + Serigrafía")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "← Volver al formulario" }));
    expect(screen.getByRole("heading", { name: "Generar presupuesto" })).toBeTruthy();
  });

  it("borra un presupuesto desde el historial", async () => {
    const user = userEvent.setup();
    localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify([registroActual, { ...registroActual, clientName: "Otro" }]));
    arrancar({}, "/historial");

    await user.click((await screen.findAllByRole("button", { name: "Borrar" }))[0]);
    expect(screen.queryByText("Asociación Mixta")).toBeNull();
    expect(JSON.parse(localStorage.getItem(CLAVE_HISTORIAL)).map((p) => p.clientName)).toEqual(["Otro"]);
  });
});

describe("App — copias de seguridad", () => {
  it("muestra avisos, crea una copia y la lista", async () => {
    const user = userEvent.setup();
    arrancar({}, "/copias");
    expect(await screen.findByText("Las copias solo se guardan en este PC.")).toBeTruthy();
    expect(screen.getByText(/Última copia:/).parentElement.textContent).toMatch(/ninguna/);

    await user.click(screen.getByRole("button", { name: "Hacer copia ahora" }));
    expect(await screen.findByText(/Copia creada y verificada/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("link", { name: "Descargar" }).getAttribute("href")).toBe("/api/copias/galipau-20261015-100000-000-manual.db/descargar"));
    expect(screen.getByText("Verificada")).toBeTruthy();
  });

  it("sugiere OneDrive si está instalado y pide confirmación para restaurar", async () => {
    const user = userEvent.setup();
    arrancar({}, "/copias");
    await user.click(await screen.findByRole("button", { name: /Usar OneDrive/ }));
    expect(screen.getByLabelText("Carpeta externa").value).toBe("C:\\Users\\demo\\OneDrive\\GalipauApp\\copias");

    await user.click(screen.getByRole("button", { name: "Hacer copia ahora" }));
    await user.click(await screen.findByRole("button", { name: "Restaurar…" }));
    expect(screen.getByRole("alertdialog", { name: "Confirmar restauración" }).textContent).toMatch(/se sustituirán/);
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
