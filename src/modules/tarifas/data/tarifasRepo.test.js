// Batched import client: retries, failure in the middle and resume. FICTITIOUS operations.
import { describe, it, expect } from "vitest";
import { importarTarifa, esErrorTransitorio, importacionesIncompletas } from "./tarifasRepo";

const OPS = Array.from({ length: 7 }, (_, n) => ({ accion: "archivar", variante_id: n + 1 }));
// fake API: each call returns the next scripted answer (default: ok with id 7)
const api = (guion = {}) => {
  const llamadas = [];
  const veces = {};
  return {
    llamadas,
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, lote: args.p_lote, total: args.p_total, clave: args.p_clave, n: args.p_operaciones.length });
      const k = `${args.p_lote}`;
      veces[k] = (veces[k] ?? 0) + 1;
      const r = guion[k]?.[veces[k] - 1];
      if (r instanceof Error) throw r;
      return r ?? { data: 7, error: null };
    },
  };
};

describe("importación por lotes (cliente)", () => {
  it("lotes numerados con la misma clave y el total", async () => {
    const sb = api();
    const avances = [];
    expect(await importarTarifa(sb, {}, OPS, { clave: "k-1", tamano: 3, alAvanzar: (l, t) => avances.push(`${l}/${t}`) })).toBe(7);
    expect(sb.llamadas.map((c) => [c.lote, c.total, c.clave, c.n])).toEqual([[1, 3, "k-1", 3], [2, 3, "k-1", 3], [3, 3, "k-1", 1]]);
    expect(avances).toEqual(["1/3", "2/3", "3/3"]);
  });

  it("un error transitorio (red, tiempo agotado) repite el MISMO lote; el servidor no duplica", async () => {
    const sb = api({ 2: [new TypeError("Failed to fetch"), { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }] });
    expect(await importarTarifa(sb, {}, OPS, { clave: "k-2", tamano: 3 })).toBe(7);
    expect(sb.llamadas.map((c) => c.lote)).toEqual([1, 2, 2, 2, 3]);
  });

  it("un error de datos a mitad para y dice qué se guardó, para reanudar o revertir", async () => {
    const sb = api({ 2: [{ data: null, error: { code: "P0002", message: "Variant 999 not found" } }] });
    const e = await importarTarifa(sb, {}, OPS, { clave: "k-3", tamano: 3 }).catch((x) => x);
    expect(e).toMatchObject({ clave: "k-3", importacionId: 7, lote: 2, lotes: 3, lotesAplicados: 1 });
    expect(sb.llamadas.map((c) => c.lote)).toEqual([1, 2]); // no blind retries of a data error
    // resume: from the failed batch, same key and same operations
    const sb2 = api();
    expect(await importarTarifa(sb2, {}, OPS, { clave: "k-3", tamano: 3, desdeLote: 2 })).toBe(7);
    expect(sb2.llamadas.map((c) => [c.lote, c.clave])).toEqual([[2, "k-3"], [3, "k-3"]]);
  });

  it("se rinde tras los reintentos y clasifica los errores", async () => {
    const red = { data: null, error: { message: "fetch failed" } };
    const sb = api({ 1: [red, red, red] });
    const e = await importarTarifa(sb, {}, OPS, { clave: "k-4", tamano: 3 }).catch((x) => x);
    expect(e).toMatchObject({ importacionId: null, lote: 1, lotesAplicados: 0 });
    expect(sb.llamadas).toHaveLength(3);
    expect([{ code: "40001" }, { code: "23505" }, { code: "P0002" }].map(esErrorTransitorio)).toEqual([true, false, false]);
  });

  it("detecta las importaciones incompletas de un proveedor", () => {
    const lista = [
      { id: 1, proveedor_id: 5, revertida_en: null, resumen: { estado: "en_curso" } },
      { id: 2, proveedor_id: 5, revertida_en: "2026-10-21", resumen: { estado: "en_curso" } },
      { id: 3, proveedor_id: 5, revertida_en: null, resumen: { estado: "completa" } },
      { id: 4, proveedor_id: 6, revertida_en: null, resumen: { estado: "en_curso" } },
    ];
    expect(importacionesIncompletas(lista, 5).map((i) => i.id)).toEqual([1]);
  });
});
