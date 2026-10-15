// Projects created with "Automatically expose new tables" disabled get no
// default grants: the migration's explicit grants must be enough for the owner,
// and still give nothing to anonymous visitors or other accounts.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { crearBd, comoPropietario, comoIntruso, comoAnonimo, como, codigoError } from "./bd.js";

let db;
beforeAll(async () => {
  db = await crearBd({ privilegiosPorDefecto: false });
});
afterAll(async () => {
  await db.close();
});

describe("proyecto sin exposición automática de tablas", () => {
  it("las tablas no tienen permisos por defecto: solo los concedidos explícitamente", async () => {
    const { rows } = await db.query(
      "select grantee, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'clientes' and grantee in ('anon', 'authenticated') group by grantee"
    );
    expect(rows).toEqual([{ grantee: "authenticated", p: "DELETE,INSERT,SELECT,UPDATE" }]);
  });

  it("el propietario puede trabajar con normalidad (CRUD, vista, numeración)", async () => {
    await comoPropietario(db, async (tx) => {
      const id = (await tx.query("insert into public.clientes (nombre) values ('Cliente') returning id")).rows[0].id;
      await tx.query("update public.clientes set telefono = '600' where id = $1", [id]);
      const p = (await tx.query("insert into public.proveedores (nombre) values ('P') returning id")).rows[0].id;
      const m = (await tx.query("insert into public.modelos (proveedor_id, tipo, nombre) values ($1, 'Camiseta', 'M') returning id", [p])).rows[0].id;
      await tx.query("insert into public.variantes (modelo_id, color, talla, coste_cent) values ($1, 'Negro', 'M', 235)", [m]);
      expect((await tx.query("select count(*)::int n from public.v_catalogo_plano")).rows[0].n).toBe(1);
      expect((await tx.query("select public.siguiente_numero('P', 2030) n")).rows[0].n).toBe("P-2030-0001");
      expect((await tx.query("select count(*)::int n from public.registro_copias")).rows[0].n).toBe(0);
      await tx.query("delete from public.clientes where id = $1", [id]);
    });
  });

  it("anónimos y otras cuentas siguen sin acceso", async () => {
    expect(await codigoError(() => comoAnonimo(db, (tx) => tx.query("select * from public.clientes")))).toBe("42501");
    expect((await comoIntruso(db, (tx) => tx.query("select * from public.variantes"))).rows).toEqual([]);
    expect(await codigoError(() => comoIntruso(db, (tx) => tx.query("insert into public.clientes (nombre) values ('x')")))).toBe("42501");
  });

  it("la tarea de copias (service_role) puede leer todo y registrar su resultado, pero no modificar datos", async () => {
    await como(db, "service_role", null, async (tx) => {
      await tx.query("insert into public.registro_copias (tipo, estado) values ('archivos', 'correcta')");
      expect((await tx.query("select count(*)::int n from public.clientes")).rows[0].n).toBeGreaterThanOrEqual(0);
    });
    expect(await codigoError(() => como(db, "service_role", null, (tx) => tx.query("delete from public.clientes")))).toBe("42501");
  });
});
