import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError } from "./bd.js";

let db;
beforeEach(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
  await comoPropietario(db, (tx) => tx.query("select public.crear_version_parametros('serigrafia', '{\"margenRecomendado\": 0.3}'::jsonb)"));
});
afterEach(async () => {
  await db.close();
});

const BORRADOR = `insert into public.presupuestos (cliente_nombre, tecnica, parametros_version, motor, entrada, resultado,
  total_cent, coste_total_cent, precio_recomendado_cent, precio_final_cent, fecha_emision)
  values ('Cliente', 'serigrafia', 1, 'serigrafia-coste-real/2', '{"lineas": []}', '{"precio": {}}', 9000, 6499, 9000, $1, $2) returning id`;

const crearBorrador = (tx, { final = 9000, fecha = "2026-10-17" } = {}) => tx.query(BORRADOR, [final, fecha]).then((r) => r.rows[0].id);
const estado = (tx, id, nuevo) => tx.query("update public.presupuestos set estado = $2 where id = $1 returning numero, estado, version", [id, nuevo]).then((r) => r.rows[0]);
const fila = (tx, id) => tx.query("select * from public.presupuestos where id = $1", [id]).then((r) => r.rows[0]);

describe("presupuestos: numeración", () => {
  it("un borrador no tiene número; lo recibe al presentarse, correlativo por año", async () => {
    await comoPropietario(db, async (tx) => {
      const a = await crearBorrador(tx);
      const b = await crearBorrador(tx);
      const c = await crearBorrador(tx, { fecha: "2027-01-02" });
      expect((await fila(tx, a)).numero).toBeNull();
      expect((await estado(tx, b, "presentado")).numero).toBe("2026/001");
      expect((await estado(tx, a, "presentado")).numero).toBe("2026/002");
      expect((await estado(tx, c, "presentado")).numero).toBe("2027/001");
    });
  });

  it("volver a borrador y presentar de nuevo conserva el número", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await crearBorrador(tx);
      await estado(tx, id, "presentado");
      await estado(tx, id, "borrador");
      expect((await estado(tx, id, "presentado")).numero).toBe("2026/001");
    });
  });

  it("no se puede elegir ni cambiar el número desde la aplicación", async () => {
    expect(await codigoError(() => comoPropietario(db, (tx) =>
      tx.query("insert into public.presupuestos (numero, cliente_nombre, motor, entrada, total_cent) values ('2026/999', 'C', 'm', '{}', 0)")))).toBe("23514");
    const id = await comoPropietario(db, async (tx) => {
      const id = await crearBorrador(tx);
      await estado(tx, id, "presentado");
      return id;
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.presupuestos set numero = '2026/500' where id = $1", [id])))).toBe("42501");
  });

  it("sin duplicados: muchos presupuestos presentados dan números únicos y seguidos", async () => {
    const numeros = await comoPropietario(db, async (tx) => {
      const r = [];
      for (let i = 0; i < 25; i++) r.push((await estado(tx, await crearBorrador(tx), "presentado")).numero);
      return r;
    });
    expect(new Set(numeros).size).toBe(25);
    expect(numeros[0]).toBe("2026/001");
    expect(numeros[24]).toBe("2026/025");
  });

  it("pasado el 999 sigue creciendo sin cortar cifras", async () => {
    await comoPropietario(db, async (tx) => {
      await tx.query("insert into public.contadores (serie, anio, ultimo) values ('PRES', 2026, 999)");
      expect((await estado(tx, await crearBorrador(tx), "presentado")).numero).toBe("2026/1000");
    });
  });

  it("si la operación falla, el número no se consume", async () => {
    const id = await comoPropietario(db, (tx) => crearBorrador(tx));
    await codigoError(() => comoPropietario(db, async (tx) => {
      await estado(tx, id, "presentado");
      throw new Error("fallo posterior");
    }));
    await comoPropietario(db, async (tx) => expect((await estado(tx, id, "presentado")).numero).toBe("2026/001"));
  });
});

describe("presupuestos: estados y transiciones", () => {
  it("ciclo completo con registro de cada cambio", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await crearBorrador(tx);
      for (const e of ["presentado", "aceptado", "en_produccion", "finalizado", "cobrado"]) await estado(tx, id, e);
      const p = await fila(tx, id);
      expect(p.estado).toBe("cobrado");
      expect(p.historial_estados.map((h) => h.estado)).toEqual(["borrador", "presentado", "aceptado", "en_produccion", "finalizado", "cobrado"]);
    });
  });

  it.each([
    ["borrador", "aceptado"],
    ["borrador", "cobrado"],
    ["presentado", "finalizado"],
    ["aceptado", "cobrado"],
  ])("rechaza %s → %s", async (desde, hasta) => {
    const id = await comoPropietario(db, async (tx) => {
      const id = await crearBorrador(tx);
      const camino = { borrador: [], presentado: ["presentado"], aceptado: ["presentado", "aceptado"] }[desde];
      for (const e of camino) await estado(tx, id, e);
      return id;
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => estado(tx, id, hasta)))).toBe("23514");
  });

  it("finalizado no pasa a cobrado solo: hay que marcarlo", async () => {
    await comoPropietario(db, async (tx) => {
      const id = await crearBorrador(tx);
      for (const e of ["presentado", "aceptado", "en_produccion", "finalizado"]) await estado(tx, id, e);
      expect((await fila(tx, id)).estado).toBe("finalizado");
    });
  });

  it("cancelado es definitivo y un finalizado o cobrado no se puede cancelar", async () => {
    const [cancelado, finalizado] = await comoPropietario(db, async (tx) => {
      const a = await crearBorrador(tx);
      await estado(tx, a, "cancelado");
      const b = await crearBorrador(tx);
      for (const e of ["presentado", "aceptado", "en_produccion", "finalizado"]) await estado(tx, b, e);
      return [a, b];
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => estado(tx, cancelado, "borrador")))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => estado(tx, finalizado, "cancelado")))).toBe("23514");
  });

  it("no se presenta sin precio final ni resultado calculado", async () => {
    const id = await comoPropietario(db, (tx) => crearBorrador(tx, { final: null }));
    expect(await codigoError(() => comoPropietario(db, (tx) => estado(tx, id, "presentado")))).toBe("23514");
  });

  it("un presupuesto nuevo empieza siempre como borrador y el registro de estados no se puede reescribir", async () => {
    expect(await codigoError(() => comoPropietario(db, (tx) =>
      tx.query("insert into public.presupuestos (cliente_nombre, motor, entrada, total_cent, estado) values ('C', 'm', '{}', 0, 'aceptado')")))).toBe("23514");
    await comoPropietario(db, async (tx) => {
      const id = await crearBorrador(tx);
      await tx.query("update public.presupuestos set historial_estados = '[]' where id = $1", [id]);
      expect((await fila(tx, id)).historial_estados).toHaveLength(1);
    });
  });
});

describe("presupuestos: edición y conservación", () => {
  it("borrador y presentado se pueden editar (presentado sube de versión); aceptado ya no", async () => {
    const id = await comoPropietario(db, async (tx) => {
      const id = await crearBorrador(tx);
      await tx.query("update public.presupuestos set precio_final_cent = 9500 where id = $1", [id]);
      expect((await fila(tx, id)).version).toBe(1);
      await estado(tx, id, "presentado");
      await tx.query("update public.presupuestos set precio_final_cent = 9900, total_cent = 9900 where id = $1", [id]);
      expect((await fila(tx, id)).version).toBe(2);
      await estado(tx, id, "aceptado");
      // notes stay editable
      await tx.query("update public.presupuestos set notas = 'Entrega el viernes' where id = $1", [id]);
      return id;
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.presupuestos set precio_final_cent = 1 where id = $1", [id])))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.presupuestos set entrada = '{}' where id = $1", [id])))).toBe("42501");
  });

  it("los presupuestos no se borran (ni siquiera los borradores)", async () => {
    const id = await comoPropietario(db, (tx) => crearBorrador(tx));
    const borrados = await comoPropietario(db, (tx) => tx.query("delete from public.presupuestos where id = $1", [id]));
    expect(borrados.affectedRows).toBe(0);
    expect(await comoPropietario(db, (tx) => fila(tx, id))).toBeTruthy();
  });

  it("la versión de parámetros referenciada debe existir y no se puede borrar", async () => {
    expect(await codigoError(() => comoPropietario(db, (tx) =>
      tx.query("insert into public.presupuestos (cliente_nombre, tecnica, parametros_version, motor, entrada, total_cent) values ('C', 'serigrafia', 7, 'm', '{}', 0)")))).toBe("23503");
  });
});

describe("presupuestos: seguridad", () => {
  it("otra cuenta y un visitante anónimo no ven ni crean presupuestos", async () => {
    await comoPropietario(db, (tx) => crearBorrador(tx));
    expect((await comoIntruso(db, (tx) => tx.query("select * from public.presupuestos"))).rows).toEqual([]);
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("insert into public.presupuestos (cliente_nombre, motor, entrada, total_cent) values ('C', 'm', '{}', 0)")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.presupuestos")))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("select public.siguiente_numero_presupuesto(2026)")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select public.siguiente_numero_presupuesto(2026)")))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("select public.importar_historial('[{}]'::jsonb)")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.importaciones")))).toBe("42501");
  });
});

describe("importaciones reversibles", () => {
  const registro = (huella, total = 1234) => ({ huella, cliente_nombre: "Cliente antiguo", fecha: "2025-06-01", total_cent: total, original: { clientName: "Cliente antiguo", total: total / 100 } });

  it("importa el historial como presupuestos de solo lectura y lo revierte entero", async () => {
    await comoPropietario(db, async (tx) => {
      const id = (await tx.query("select public.importar_historial($1::jsonb, '{\"origen\": \"prueba\"}') id", [JSON.stringify([registro("a"), registro("b", 500)])])).rows[0].id;
      const { rows } = await tx.query("select estado, numero, total_cent::int total_cent, entrada->'origen'->>'huella' h from public.presupuestos where importacion_id = $1 order by h", [id]);
      expect(rows).toEqual([
        { estado: "importado", numero: null, total_cent: 1234, h: "a" },
        { estado: "importado", numero: null, total_cent: 500, h: "b" },
      ]);
      const p = rows.length && (await tx.query("select id from public.presupuestos where importacion_id = $1 limit 1", [id])).rows[0].id;
      await tx.query("update public.presupuestos set notas = 'revisado' where id = $1", [p]);
      await tx.query("select public.revertir_importacion($1)", [id]);
      expect((await tx.query("select count(*)::int n from public.presupuestos")).rows[0].n).toBe(0);
      expect((await tx.query("select revertida_en is not null r from public.importaciones where id = $1", [id])).rows[0].r).toBe(true);
    });
  });

  it("un presupuesto importado no se puede modificar ni cambiar de estado", async () => {
    const p = await comoPropietario(db, async (tx) => {
      const id = (await tx.query("select public.importar_historial($1::jsonb) id", [JSON.stringify([registro("x")])])).rows[0].id;
      return (await tx.query("select id from public.presupuestos where importacion_id = $1", [id])).rows[0].id;
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("update public.presupuestos set total_cent = 1 where id = $1", [p])))).toBe("42501");
    expect(await codigoError(() => comoPropietario(db, (tx) => estado(tx, p, "presentado")))).toBe("42501");
  });

  it("el mismo registro no se importa dos veces", async () => {
    await comoPropietario(db, (tx) => tx.query("select public.importar_historial($1::jsonb)", [JSON.stringify([registro("dup")])]));
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select public.importar_historial($1::jsonb)", [JSON.stringify([registro("dup")])])))).toBe("23505");
  });

  it("importa el catálogo reutilizando lo existente y al revertir solo quita lo importado", async () => {
    await comoPropietario(db, async (tx) => {
      const prov = (await tx.query("insert into public.proveedores (nombre) values ('Existente') returning id")).rows[0].id;
      const mod = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Camiseta', 'Base') returning id", [prov])).rows[0].id;
      await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent) values ($1, 'Negro', 'M', 300)", [mod]);
      const filas = [
        { proveedor: "Existente", tipo: "Camiseta", modelo: "Base", talla: "M", color: "Negro", coste_cent: 999 }, // already there: untouched
        { proveedor: "Existente", tipo: "Camiseta", modelo: "Base", talla: "L", color: "Negro", coste_cent: 310 },
        { proveedor: "Nuevo", tipo: "Sudadera", modelo: "Capucha", talla: "S", color: "Blanco", coste_cent: 1200 },
      ];
      const id = (await tx.query("select public.importar_catalogo($1::jsonb) id", [JSON.stringify(filas)])).rows[0].id;
      const antes = (await tx.query("select proveedor, modelo, talla, color, coste_cent from public.v_catalogo_plano order by proveedor, talla")).rows;
      expect(antes).toEqual([
        { proveedor: "Existente", modelo: "Base", talla: "L", color: "Negro", coste_cent: 310 },
        { proveedor: "Existente", modelo: "Base", talla: "M", color: "Negro", coste_cent: 300 },
        { proveedor: "Nuevo", modelo: "Capucha", talla: "S", color: "Blanco", coste_cent: 1200 },
      ]);
      await tx.query("select public.revertir_importacion($1)", [id]);
      const despues = (await tx.query("select proveedor, talla, coste_cent from public.v_catalogo_plano")).rows;
      expect(despues).toEqual([{ proveedor: "Existente", talla: "M", coste_cent: 300 }]);
      expect(await codigoError(() => tx.query("select public.revertir_importacion($1)", [id]))).toBe("22023");
    });
  });
});

describe("la interfaz y la base de datos usan las mismas transiciones", () => {
  it("todas las parejas de estados coinciden", async () => {
    const { TRANSICIONES } = await import("../../src/modules/presupuestos/domain/estados.js");
    const estados = Object.keys(TRANSICIONES);
    const { rows } = await db.query(
      "select d.e desde, h.e hasta, public.transicion_presupuesto_permitida(d.e, h.e) ok from unnest($1::text[]) d(e) cross join unnest($1::text[]) h(e)",
      [estados]
    );
    const enBd = rows.filter((r) => r.ok).map((r) => `${r.desde}>${r.hasta}`).sort();
    const enUi = estados.flatMap((d) => TRANSICIONES[d].map((h) => `${d}>${h}`)).sort();
    expect(enBd).toEqual(enUi);
  });
});

describe("migración sobre un proyecto con datos del esquema anterior", () => {
  it("convierte los estados antiguos y agrupa los 'importado' en una importación", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const fs = await import("node:fs");
    const { listarMigraciones, CARPETA_MIGRACIONES } = await import("./bd.js");
    const vieja = await PGlite.create();
    await vieja.exec(fs.readFileSync(new URL("./entorno-supabase.sql", import.meta.url), "utf8"));
    const [ultima, ...anteriores] = listarMigraciones().reverse();
    for (const m of anteriores.reverse()) await vieja.exec(fs.readFileSync(`${CARPETA_MIGRACIONES}/${m}`, "utf8"));
    await vieja.exec(`insert into public.presupuestos (numero, cliente_nombre, estado, motor, entrada, total_cent) values
      ('A', 'C', 'enviado', 'legacy', '{}', 1), ('B', 'C', 'importado', 'legacy', '{}', 2), ('C', 'C', 'caducado', 'legacy', '{}', 3)`);
    await vieja.exec(fs.readFileSync(`${CARPETA_MIGRACIONES}/${ultima}`, "utf8"));
    const { rows } = await vieja.query("select numero, estado, importacion_id is not null importada from public.presupuestos order by numero");
    expect(rows).toEqual([
      { numero: "A", estado: "presentado", importada: false },
      { numero: "B", estado: "importado", importada: true },
      { numero: "C", estado: "cancelado", importada: false },
    ]);
    await vieja.close();
  });
});
