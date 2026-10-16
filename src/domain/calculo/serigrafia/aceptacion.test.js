// Acceptance tests against the verified reference quotes of the master
// spreadsheet. The real parameters and quotes are PRIVATE: they live in
// privado/serigrafia-v2_24.json (git-ignored). Without that file (e.g. in CI)
// these tests are skipped.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { calcularCosteSerigrafia, redondearArribaCent } from "./motor";
import { validarParametros } from "./parametros";

const ARCHIVO = fileURLToPath(new URL("../../../../privado/serigrafia-v2_24.json", import.meta.url));
const disponible = fs.existsSync(ARCHIVO);
const datos = disponible ? JSON.parse(fs.readFileSync(ARCHIVO, "utf8")) : { parametros: null, casos: [] };

describe.skipIf(!disponible)("aceptación: reproduce el Excel V2_24 al céntimo", () => {
  it("los parámetros privados son válidos", () => {
    expect(validarParametros(datos.parametros)).toEqual([]);
  });

  it.each(datos.casos.map((c) => [c.nombre, c]))("%s", (_, caso) => {
    const r = calcularCosteSerigrafia(caso.entrada, datos.parametros);
    const e = caso.esperado;
    expect(r.unidades).toBe(e.unidades);
    expect(r.pantallas).toBe(e.pantallas);
    expect(r.costes.totalCent).toBe(e.costeTotalCent);
    expect(r.beneficio.cent).toBe(e.beneficioCent);
    expect(r.precio.recomendadoCent).toBe(e.precioRecomendadoCent);
    expect(r.beneficio.margen).toBeCloseTo(e.margen, 6);
    for (const [clave, importe] of Object.entries(e.grupos)) {
      expect(r.costes.grupos.find((g) => g.clave === clave).importe, clave).toBeCloseTo(importe, 2);
    }
    const mo = r.costes.grupos.find((g) => g.clave === "manoObra").conceptos;
    for (const [clave, importe] of Object.entries(e.manoObra)) {
      expect(mo.find((c) => c.clave === clave).importe, clave).toBeCloseTo(importe, 2);
    }
  });

  // The spreadsheet does not round the recommended price; the 0,50 € rule is applied on top
  it.each(datos.casos.map((c) => [c.nombre, c]))("%s con redondeo a 0,50 €: el coste no cambia", (_, caso) => {
    const r = calcularCosteSerigrafia(caso.entrada, { ...datos.parametros, redondeoPrecioUnidad: 0.5 });
    const e = caso.esperado;
    expect(r.costes.totalCent).toBe(e.costeTotalCent);
    expect(r.beneficio.cent).toBe(e.beneficioCent);
    expect(r.precio.recomendadoSinRedondearCent).toBe(e.precioRecomendadoCent);
    const unitario = redondearArribaCent(Math.round((e.precioRecomendadoCent / 100 / e.unidades) * 100), 50);
    expect(r.precio.recomendadoPorUnidadCent).toBe(unitario);
    expect(r.precio.recomendadoCent).toBe(unitario * e.unidades);
    expect(r.precio.beneficioRecomendado.cent).toBe(unitario * e.unidades - e.costeTotalCent);
  });
});
