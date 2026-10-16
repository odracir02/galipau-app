import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError } from "./bd.js";

let db;
const valores = (mano) => JSON.stringify({ manoObraEurHora: mano, consumibles: [] });
const crear = (tx, mano, notas = null) =>
  tx.query("select public.crear_version_parametros('serigrafia', $1::jsonb, $2) as v", [valores(mano), notas]).then((r) => r.rows[0].v);

beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
});
afterEach(async () => {
  await db.close();
});

describe("parámetros de cálculo versionados", () => {
  it("cada versión nueva queda activa y archiva la anterior", async () => {
    await comoPropietario(db, async (tx) => {
      expect(await crear(tx, 20, "Valores iniciales")).toBe(1);
      expect(await crear(tx, 22, "Sube la mano de obra")).toBe(2);
      const { rows } = await tx.query("select version, estado, valores->>'manoObraEurHora' mano, notas from public.parametros_calculo order by version");
      expect(rows).toEqual([
        { version: 1, estado: "archivada", mano: "20", notas: "Valores iniciales" },
        { version: 2, estado: "activa", mano: "22", notas: "Sube la mano de obra" },
      ]);
    });
  });

  it("las técnicas tienen su propia numeración", async () => {
    await comoPropietario(db, async (tx) => {
      await crear(tx, 20);
      const dtf = (await tx.query("select public.crear_version_parametros('dtf', '{}'::jsonb) v")).rows[0].v;
      expect(dtf).toBe(1);
      expect((await tx.query("select count(*)::int n from public.parametros_calculo where estado = 'activa'")).rows[0].n).toBe(2);
    });
  });

  it("una versión no se puede modificar ni reactivar", async () => {
    await comoPropietario(db, async (tx) => {
      await crear(tx, 20);
      await crear(tx, 21);
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.parametros_calculo set valores = '{}' where version = 1")))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.parametros_calculo set estado = 'activa' where version = 1")))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("delete from public.parametros_calculo")))).toBe("42501");
  });

  it("solo puede haber una versión activa por técnica", async () => {
    await comoPropietario(db, (tx) => crear(tx, 20));
    expect(
      await codigoError(() =>
        comoPropietario(db, (tx) => tx.query("insert into public.parametros_calculo (tecnica, version, estado, valores) values ('serigrafia', 9, 'activa', '{}')"))
      )
    ).toBe("23505");
  });

  it("los valores deben ser un objeto JSON y la técnica válida", async () => {
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.crear_version_parametros('serigrafia', '[]'::jsonb)")))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.crear_version_parametros('bordado', '{}'::jsonb)")))).toBe("23514");
  });

  it("otra cuenta no ve los parámetros ni puede crear versiones", async () => {
    await comoPropietario(db, (tx) => crear(tx, 20));
    expect((await comoIntruso(db, (tx) => tx.query("select * from public.parametros_calculo"))).rows).toEqual([]);
    expect(await codigoError(() => comoIntruso(db, (tx) => crear(tx, 99)))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("insert into public.parametros_calculo (tecnica, version, estado, valores) values ('serigrafia', 5, 'archivada', '{}')")))).toBe("42501");
  });

  it("un visitante anónimo no tiene ningún acceso", async () => {
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.parametros_calculo")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => crear(tx, 1)))).toBe("42501");
  });
});
