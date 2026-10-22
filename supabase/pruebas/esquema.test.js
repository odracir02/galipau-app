import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { crearBd, comoPropietario, codigoError, listarMigraciones } from "./bd.js";

let db;
beforeAll(async () => {
  db = await crearBd();
});
afterAll(async () => {
  await db.close();
});

const insertarCliente = (tx, datos = {}) =>
  tx.query("insert into public.clientes (nombre, nif, email, tipo) values ($1, $2, $3, coalesce($4, 'particular')) returning id", [
    datos.nombre ?? "Club",
    datos.nif ?? null,
    datos.email ?? null,
    datos.tipo ?? null,
  ]);

describe("migraciones", () => {
  it("se aplican en orden y crean el esquema esperado", async () => {
    expect(listarMigraciones()).toEqual(["20261015120000_esquema_inicial.sql", "20261015120100_almacenamiento.sql", "20261016090000_parametros_calculo.sql", "20261017090000_presupuestos_ciclo_vida.sql", "20261018090000_catalogo_precio_neto.sql", "20261021090000_catalogo_gestion.sql", "20261022090000_inventario.sql", "20261023090000_tarifas_proveedor.sql", "20261024090000_importaciones_sin_ciclo.sql", "20261025090000_categorias.sql", "20261026090000_pedidos.sql", "20261027090000_pedido_terminar.sql"]);
    const { rows } = await db.query("select tablename from pg_tables where schemaname = 'public' order by tablename");
    expect(rows.map((r) => r.tablename)).toEqual([
      "categorias", "clasificacion_cambios", "clientes", "configuracion", "contadores", "importaciones", "importaciones_cambios", "modelos", "parametros_calculo", "pedido_eventos", "pedido_lineas", "pedidos", "presupuestos", "propietario", "proveedores", "registro_copias", "stock_articulos", "stock_movimientos", "stock_necesidades", "stock_reservas", "variantes", "variantes_tarifas",
    ]);
  });

  it("todas las tablas de public tienen RLS activado", async () => {
    const { rows } = await db.query(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity"
    );
    expect(rows).toEqual([]);
  });

  it("no hay ciclos de claves foráneas entre tablas (la copia de solo datos debe poder restaurarse)", async () => {
    const { rows } = await db.query(`select distinct c.conrelid::regclass::text desde, c.confrelid::regclass::text hacia
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'f' and n.nspname = 'public' and c.conrelid <> c.confrelid`);
    const aristas = {};
    for (const r of rows) (aristas[r.desde] ??= []).push(r.hacia);
    const ciclos = [];
    const visitar = (nodo, camino) => {
      for (const sig of aristas[nodo] ?? []) {
        if (camino.includes(sig)) ciclos.push([...camino.slice(camino.indexOf(sig)), sig].join(" -> "));
        else visitar(sig, [...camino, sig]);
      }
    };
    for (const t of Object.keys(aristas)) visitar(t, [t]);
    expect(ciclos).toEqual([]);
  });

  it("las vistas usan security_invoker (respetan RLS)", async () => {
    const { rows } = await db.query(
      "select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'"
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const v of rows) expect(v.reloptions).toContain("security_invoker=true");
  });

  it("las funciones security definer fijan search_path", async () => {
    const { rows } = await db.query(
      "select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef"
    );
    for (const f of rows) expect(f.proconfig?.join(",")).toMatch(/search_path=/);
  });

  it("el bucket de archivos es privado y limita el tamaño", async () => {
    const { rows } = await db.query("select public, file_size_limit from storage.buckets where id = 'archivos'");
    expect(rows).toEqual([{ public: false, file_size_limit: 10485760 }]);
  });
});

describe("restricciones de integridad", () => {
  it("NIF único y con formato normalizado", async () => {
    await comoPropietario(db, async (tx) => {
      await insertarCliente(tx, { nif: "B12345678" });
      expect(await codigoError(() => insertarCliente(tx, { nif: "B12345678" }))).toBe("23505");
    }).catch(() => {});
    expect(await codigoError(() => comoPropietario(db, (tx) => insertarCliente(tx, { nif: "b-1234 5678" })))).toBe("23514");
  });

  it("nombre obligatorio, tipo válido y email con formato", async () => {
    expect(await codigoError(() => comoPropietario(db, (tx) => insertarCliente(tx, { nombre: "   " })))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => insertarCliente(tx, { tipo: "vip" })))).toBe("23514");
    expect(await codigoError(() => comoPropietario(db, (tx) => insertarCliente(tx, { email: "no-es-email" })))).toBe("23514");
  });

  it("claves foráneas: ni clientes inexistentes ni borrar uno en uso", async () => {
    const crearPresupuesto = (tx, clienteId) =>
      tx.query(
        "insert into public.presupuestos (cliente_id, cliente_nombre, motor, entrada, total_cent) values ($1, 'C', 'legacy', '{}', 100)",
        [clienteId]
      );
    expect(await codigoError(() => comoPropietario(db, (tx) => crearPresupuesto(tx, 999999)))).toBe("23503");
    expect(
      await codigoError(() =>
        comoPropietario(db, async (tx) => {
          const { rows } = await insertarCliente(tx, { nombre: "En uso" });
          await crearPresupuesto(tx, rows[0].id);
          await tx.query("delete from public.clientes where id = $1", [rows[0].id]);
        })
      )
    ).toBe("23001"); // ON DELETE RESTRICT -> restrict_violation
  });

  it("céntimos enteros: un importe decimal enviado como texto (como hace la API) se rechaza", async () => {
    // PostgREST converts JSON values with the column type's input function
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("select '10.5'::integer")))).toBe("22P02");
    expect(
      await codigoError(() =>
        comoPropietario(db, (tx) =>
          tx.query("insert into public.presupuestos (cliente_nombre, motor, entrada, total_cent) values ('C', 'legacy', '{}', -1)")
        )
      )
    ).toBe("23514");
  });

  it("fechas nativas: fechas imposibles y 'válido hasta' anterior a la emisión", async () => {
    const insertar = (fecha, hasta) =>
      comoPropietario(db, (tx) =>
        tx.query(
          "insert into public.presupuestos (cliente_nombre, motor, entrada, total_cent, fecha_emision, valido_hasta) values ('C', 'legacy', '{}', 0, $1, $2)",
          [fecha, hasta]
        )
      );
    expect(await codigoError(() => insertar("2026-02-30", null))).toBe("22008");
    expect(await codigoError(() => insertar("2026-10-15", "2026-10-01"))).toBe("23514");
    expect(await codigoError(() => insertar("2026-10-15", "2026-11-15"))).toBeNull();
  });

  it("catálogo: variante única y coste no negativo; la vista plana une las tablas", async () => {
    await comoPropietario(db, async (tx) => {
      const p = (await tx.query("insert into public.proveedores (nombre) values ('Demo') returning id")).rows[0].id;
      const m = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Camiseta', 'Básica') returning id", [p])).rows[0].id;
      await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent) values ($1, 'Negro', 'M', 235)", [m]);
      const { rows } = await tx.query("select tipo, proveedor, modelo, talla, color, coste_cent from public.v_catalogo_plano");
      expect(rows).toEqual([{ tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Negro", coste_cent: 235 }]);
    });
    const duplicada = () =>
      comoPropietario(db, (tx) => tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent) select id, 'Negro', 'M', 1 from public.modelos limit 1"));
    expect(await codigoError(duplicada)).toBe("23505");
    const negativa = () =>
      comoPropietario(db, (tx) => tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent) select id, 'Rojo', 'M', -5 from public.modelos limit 1"));
    expect(await codigoError(negativa)).toBe("23514");
  });

  it("actualizado_en se actualiza solo", async () => {
    await comoPropietario(db, async (tx) => {
      const { rows } = await tx.query("insert into public.configuracion (clave, valor) values ('k', '1') returning actualizado_en");
      await tx.query("select pg_sleep(0.01)");
      const despues = await tx.query("update public.configuracion set valor = '2' where clave = 'k' returning actualizado_en");
      expect(new Date(despues.rows[0].actualizado_en) >= new Date(rows[0].actualizado_en)).toBe(true);
    });
  });
});

describe("transacciones: numeración", () => {
  it("correlativa por serie y año", async () => {
    const numeros = await comoPropietario(db, async (tx) => {
      const r = [];
      for (const [s, a] of [["P", 2030], ["P", 2030], ["PED", 2030], ["P", 2031]]) {
        r.push((await tx.query("select public.siguiente_numero($1, $2) as n", [s, a])).rows[0].n);
      }
      return r;
    });
    expect(numeros).toEqual(["P-2030-0001", "P-2030-0002", "PED-2030-0001", "P-2031-0001"]);
  });

  it("si la creación del documento falla, el número no se consume", async () => {
    const fallo = await codigoError(() =>
      comoPropietario(db, async (tx) => {
        const n = (await tx.query("select public.siguiente_numero('X', 2030) as n")).rows[0].n;
        await tx.query("insert into public.presupuestos (numero, cliente_nombre, motor, entrada, total_cent) values ($1, 'C', 'legacy', '{}', -1)", [n]);
      })
    );
    expect(fallo).toBe("23514");
    const n = await comoPropietario(db, async (tx) => (await tx.query("select public.siguiente_numero('X', 2030) as n")).rows[0].n);
    expect(n).toBe("X-2030-0001");
  });
});

describe("datos ficticios del proyecto de pruebas", () => {
  it("se cargan sobre las migraciones, son idempotentes y el propietario los ve en la vista", async () => {
    const { crearBd } = await import("./bd.js");
    const fs = await import("node:fs");
    const sql = fs.readFileSync(new URL("../datos-ficticios.sql", import.meta.url), "utf8");
    const limpia = await crearBd();
    await limpia.exec(sql);
    await limpia.exec(sql); // second run: no duplicates
    const n = await comoPropietario(limpia, async (tx) => (await tx.query("select count(*)::int n from public.v_catalogo_plano")).rows[0].n);
    expect(n).toBe(36);
    const clientes = await comoPropietario(limpia, async (tx) => (await tx.query("select count(*)::int n from public.clientes")).rows[0].n);
    expect(clientes).toBe(2);
    await limpia.close();
  });

  it("se niegan a cargarse en una base de datos marcada como producción", async () => {
    const { crearBd } = await import("./bd.js");
    const fs = await import("node:fs");
    const prod = await crearBd();
    await prod.query("insert into public.configuracion (clave, valor) values ('entorno', '\"produccion\"')");
    await expect(prod.exec(fs.readFileSync(new URL("../datos-ficticios.sql", import.meta.url), "utf8"))).rejects.toThrow(/production/);
    await prod.close();
  });
});
