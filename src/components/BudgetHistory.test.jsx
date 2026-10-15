import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import BudgetHistory from "./BudgetHistory";
import { CLAVE_HISTORIAL } from "../domain/historialPresupuestos";
import {
  registroAntiguo,
  registroBloques,
  registroActual,
} from "../domain/historialPresupuestos.fixtures";

const renderizarCon = (contenido) => {
  vi.stubGlobal("localStorage", {
    getItem: (k) => (k === CLAVE_HISTORIAL ? contenido : null),
    setItem: () => {},
  });
  return renderToStaticMarkup(
    <MemoryRouter>
      <BudgetHistory />
    </MemoryRouter>
  );
};

describe("BudgetHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("muestra el mensaje vacío si no hay presupuestos", () => {
    expect(renderizarCon(null)).toContain("No hay presupuestos guardados.");
  });

  it("renderiza sin errores registros antiguos, actuales e incompletos", () => {
    const lista = [registroAntiguo, registroBloques, registroActual, { clientName: "Incompleto" }, null];
    const html = renderizarCon(JSON.stringify(lista));

    expect(html).toContain("Club Antiguo");
    expect(html).toContain("22.80 €");
    expect(html).toContain("Tienda Bloques");
    expect(html).toContain("16.80 €");
    expect(html).toContain("Asociación Mixta");
    expect(html).toContain("252.00 €");
    expect(html).toContain("DTF + Serigrafía");
    expect(html).toContain("Incompleto");
    expect(html.match(/Borrar/g)).toHaveLength(5);
  });

  it("no se rompe con datos corruptos en localStorage", () => {
    expect(renderizarCon("{no-json")).toContain("No hay presupuestos guardados.");
  });
});
