import { describe, it, expect, vi, afterEach } from "vitest";
import { fuenteCatalogo, getProductos } from "./getProductos";

vi.mock("./catalogoFirebase", () => ({ getProductosFirebase: vi.fn().mockResolvedValue([{ id: "fb1", coste: "2" }]) }));

afterEach(() => vi.unstubAllGlobals());

describe("fuente del catálogo", () => {
  it("por defecto usa Firebase hasta migrar el catálogo", () => {
    expect(fuenteCatalogo(undefined)).toBe("firebase");
    expect(fuenteCatalogo("otra")).toBe("firebase");
    expect(fuenteCatalogo("local")).toBe("local");
  });

  it("firebase: usa el servicio de Firestore (sin llamar a la API local)", async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);
    expect(await getProductos("firebase")).toEqual([{ id: "fb1", coste: "2" }]);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("local: pide el catálogo a la API de SQLite", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "1", coste: 2.35 }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchFalso);
    expect(await getProductos("local")).toEqual([{ id: "1", coste: 2.35 }]);
    expect(fetchFalso.mock.calls[0][0]).toBe("/api/catalogo/productos");
  });

  it("local: propaga los errores de la API para que el formulario muestre el aviso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Inicia sesión para continuar." }), { status: 401 })));
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    await expect(getProductos("local")).rejects.toMatchObject({ estado: 401, message: "Inicia sesión para continuar." });
  });
});
