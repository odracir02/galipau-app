// Authorised and unauthorised access. The anonymous (public) key is not a
// security mechanism: these tests prove that protection comes from
// authentication + RLS, even though Supabase grants table privileges by default.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, codigoError, PROPIETARIO, INTRUSO } from "./bd.js";

let db;
const TABLAS = ["clientes", "configuracion", "contadores", "importaciones", "modelos", "parametros_calculo", "presupuestos", "propietario", "proveedores", "registro_copias", "stock_articulos", "stock_movimientos", "stock_necesidades", "stock_reservas", "variantes"];

beforeAll(async () => {
  db = await crearBd();
  // Data created by the owner and by the backup job
  await comoPropietario(db, async (tx) => {
    await tx.query("insert into public.clientes (nombre, nif) values ('Cliente privado', 'B99999999')");
    const p = (await tx.query("insert into public.proveedores (nombre) values ('Proveedor') returning id")).rows[0].id;
    const m = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Camiseta', 'M') returning id", [p])).rows[0].id;
    await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent) values ($1, 'Negro', 'M', 235)", [m]);
    await tx.query("insert into public.configuracion (clave, valor) values ('empresa', '{\"nombre\": \"Galipau\"}')");
  });
  await db.query("insert into public.registro_copias (tipo, estado, detalle) values ('base_datos', 'correcta', '{}')");
  await db.query("insert into storage.objects (bucket_id, name) values ('archivos', 'logo.png')");
});
afterAll(async () => {
  await db.close();
});

describe("visitante anónimo (solo con la clave pública)", () => {
  it.each(TABLAS)("no puede leer %s", async (tabla) => {
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query(`select * from public.${tabla}`)))).toBe("42501");
  });

  it("no puede leer la vista del catálogo", async () => {
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.v_catalogo_plano")))).toBe("42501");
  });

  it("no puede escribir ni ejecutar funciones", async () => {
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("insert into public.clientes (nombre) values ('x')")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select public.siguiente_numero('P')")))).toBe("42501");
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select public.es_propietario()")))).toBe("42501");
  });

  it("no ve archivos del almacenamiento", async () => {
    const { rows } = await comoAnonimo(db, (tx) => tx.query("select * from storage.objects"));
    expect(rows).toEqual([]);
  });
});

describe("otra cuenta autenticada (no propietaria)", () => {
  it("es_propietario() devuelve falso", async () => {
    const { rows } = await comoIntruso(db, (tx) => tx.query("select public.es_propietario() as es"));
    expect(rows[0].es).toBe(false);
  });

  it.each(TABLAS)("no ve ninguna fila de %s", async (tabla) => {
    const { rows } = await comoIntruso(db, (tx) => tx.query(`select * from public.${tabla}`));
    expect(rows).toEqual([]);
  });

  it("no ve el catálogo a través de la vista", async () => {
    const { rows } = await comoIntruso(db, (tx) => tx.query("select * from public.v_catalogo_plano"));
    expect(rows).toEqual([]);
  });

  it("no puede crear, modificar ni borrar datos", async () => {
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("insert into public.clientes (nombre) values ('x')")))).toBe("42501");
    const upd = await comoIntruso(db, (tx) => tx.query("update public.clientes set nombre = 'hackeado'"));
    expect(upd.affectedRows).toBe(0);
    const del = await comoIntruso(db, (tx) => tx.query("delete from public.clientes"));
    expect(del.affectedRows).toBe(0);
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("select public.siguiente_numero('P')")))).toBe("42501");
  });

  it("no puede convertirse en propietario", async () => {
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("insert into public.propietario (id, user_id) values (1, $1)", [INTRUSO])))).toBe("42501");
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("update public.propietario set user_id = $1", [INTRUSO])))).toBe("42501");
  });

  it("no puede leer, subir ni borrar archivos", async () => {
    expect((await comoIntruso(db, (tx) => tx.query("select * from storage.objects"))).rows).toEqual([]);
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('archivos', 'x.png')")))).toBe("42501");
    expect((await comoIntruso(db, (tx) => tx.query("delete from storage.objects"))).affectedRows).toBe(0);
  });
});

describe("propietario", () => {
  it("es_propietario() devuelve verdadero y ve su fila de propietario", async () => {
    const { rows } = await comoPropietario(db, (tx) => tx.query("select public.es_propietario() as es, (select user_id from public.propietario) as uid"));
    expect(rows[0]).toEqual({ es: true, uid: PROPIETARIO });
  });

  it("lee, crea, modifica y borra sus datos", async () => {
    await comoPropietario(db, async (tx) => {
      expect((await tx.query("select nombre from public.clientes")).rows).toEqual([{ nombre: "Cliente privado" }]);
      const id = (await tx.query("insert into public.clientes (nombre) values ('Nuevo') returning id")).rows[0].id;
      expect((await tx.query("update public.clientes set telefono = '600' where id = $1", [id])).affectedRows).toBe(1);
      expect((await tx.query("delete from public.clientes where id = $1", [id])).affectedRows).toBe(1);
      expect((await tx.query("select count(*)::int n from public.v_catalogo_plano")).rows[0].n).toBe(1);
    });
  });

  it("lee el registro de copias pero no puede falsificarlo", async () => {
    await comoPropietario(db, async (tx) => {
      expect((await tx.query("select estado from public.registro_copias")).rows).toEqual([{ estado: "correcta" }]);
    });
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("insert into public.registro_copias (tipo, estado) values ('base_datos', 'correcta')")))).toBe("42501");
  });

  it("no puede modificar ni borrar su fila de propietario desde la app", async () => {
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("delete from public.propietario")))).toBe("42501");
  });

  it("gestiona archivos solo en el bucket 'archivos'", async () => {
    await comoPropietario(db, async (tx) => {
      expect((await tx.query("select name from storage.objects")).rows).toEqual([{ name: "logo.png" }]);
      await tx.query("insert into storage.objects (bucket_id, name) values ('archivos', 'diseno.pdf')");
    });
    await db.query("insert into storage.buckets (id, name) values ('otro', 'otro')");
    expect(await codigoError(() => comoPropietario(db, (tx) => tx.query("insert into storage.objects (bucket_id, name) values ('otro', 'x.png')")))).toBe("42501");
  });

  it("sin fila de propietario, nadie tiene acceso (instalación recién creada)", async () => {
    const vacia = await crearBd({ conPropietario: false });
    const { rows } = await comoPropietario(vacia, (tx) => tx.query("select public.es_propietario() as es"));
    expect(rows[0].es).toBe(false);
    expect(await codigoError(() => comoPropietario(vacia, (tx) => tx.query("insert into public.clientes (nombre) values ('x')")))).toBe("42501");
    await vacia.close();
  });
});
