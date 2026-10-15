// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { CLAVE_HISTORIAL } from "./domain/historialPresupuestos";
import { registroActual } from "./domain/historialPresupuestos.fixtures";

vi.mock("./services/getProductos", () => ({ getProductos: vi.fn().mockResolvedValue([]) }));

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("App — navegación", () => {
  it("navega del formulario al historial y vuelve", async () => {
    const user = userEvent.setup();
    localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify([registroActual]));
    render(<App />);

    expect(screen.getByRole("heading", { name: "Generar presupuesto" })).toBeTruthy();
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
    window.history.pushState({}, "", "/historial");
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: "Borrar" })[0]);
    expect(screen.queryByText("Asociación Mixta")).toBeNull();
    expect(JSON.parse(localStorage.getItem(CLAVE_HISTORIAL)).map((p) => p.clientName)).toEqual(["Otro"]);
  });
});
