// @vitest-environment jsdom
// Test and production webs: visible stripe and the cross-environment block.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { comprobarEntorno, entornoWeb, leerEntornoBd } from "./entorno";
import GuardaEntorno from "./GuardaEntorno";
import BandaEntorno from "./BandaEntorno";
import { crearClienteFalso } from "../shared/supabase/clienteFalso";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const sbCon = (entorno) => crearClienteFalso({ tablas: { configuracion: entorno ? [{ clave: "entorno", valor: entorno }] : [] } });

describe("entorno de la web", () => {
  it("producción por defecto; pruebas solo si se indica expresamente", () => {
    expect(entornoWeb(undefined)).toBe("produccion");
    expect(entornoWeb("cualquier cosa")).toBe("produccion");
    expect(entornoWeb("pruebas")).toBe("pruebas");
    vi.stubEnv("VITE_ENTORNO", "pruebas");
    expect(entornoWeb()).toBe("pruebas");
  });

  it("bloquea las combinaciones cruzadas y avisa si la base de pruebas no está marcada", () => {
    expect(comprobarEntorno("pruebas", "produccion").estado).toBe("bloqueo");
    expect(comprobarEntorno("produccion", "pruebas").estado).toBe("bloqueo");
    expect(comprobarEntorno("pruebas", null).estado).toBe("aviso");
    expect(comprobarEntorno("pruebas", "pruebas").estado).toBe("ok");
    expect(comprobarEntorno("produccion", "produccion").estado).toBe("ok");
    expect(comprobarEntorno("produccion", null).estado).toBe("ok");
  });

  it("lee la marca de la base de datos", async () => {
    expect(await leerEntornoBd(sbCon("pruebas"))).toBe("pruebas");
    expect(await leerEntornoBd(sbCon(null))).toBeNull();
  });
});

describe("protección en la interfaz", () => {
  const app = <main><h1>Aplicación</h1></main>;

  it("web de pruebas conectada a producción: no muestra la aplicación", async () => {
    render(<GuardaEntorno nube web="pruebas" obtenerCliente={async () => sbCon("produccion")}>{app}</GuardaEntorno>);
    expect((await screen.findByRole("alert")).textContent).toMatch(/web de PRUEBAS, pero está conectada a la base de datos de PRODUCCIÓN/);
    expect(screen.queryByRole("heading", { name: "Aplicación" })).toBeNull();
  });

  it("web de producción conectada a pruebas: también se bloquea", async () => {
    render(<GuardaEntorno nube web="produccion" obtenerCliente={async () => sbCon("pruebas")}>{app}</GuardaEntorno>);
    expect((await screen.findByRole("alert")).textContent).toMatch(/web de PRODUCCIÓN, pero está conectada a la base de datos de PRUEBAS/);
  });

  it("cada web con su base: funciona; mientras comprueba no muestra nada que se pueda usar", async () => {
    render(<GuardaEntorno nube web="pruebas" obtenerCliente={async () => sbCon("pruebas")}>{app}</GuardaEntorno>);
    expect(screen.getByRole("status").textContent).toMatch(/Comprobando el entorno/);
    expect(await screen.findByRole("heading", { name: "Aplicación" })).toBeTruthy();
  });

  it("base de pruebas sin marcar: avisa pero deja trabajar", async () => {
    render(<GuardaEntorno nube web="pruebas" obtenerCliente={async () => sbCon(null)}>{app}</GuardaEntorno>);
    expect(await screen.findByRole("heading", { name: "Aplicación" })).toBeTruthy();
    expect(screen.getByText(/no está marcada como de pruebas/)).toBeTruthy();
  });

  it("la banda «ENTORNO DE PRUEBAS» solo aparece en la web de pruebas", () => {
    const { rerender } = render(<BandaEntorno web="pruebas" />);
    expect(screen.getByRole("note", { name: "Entorno de pruebas" }).textContent).toMatch(/ENTORNO DE PRUEBAS · datos ficticios/);
    rerender(<BandaEntorno web="produccion" />);
    expect(screen.queryByRole("note", { name: "Entorno de pruebas" })).toBeNull();
  });
});
