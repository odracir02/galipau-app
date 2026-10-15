// Restores a Galipau App database backup into an ISOLATED in-process
// PostgreSQL (PGlite) and checks it. Used by the automated tests and by the
// local restore drill (simulacro.mjs). Never touches a real database.
//
// A backup contains:
//   esquema.sql      pg_dump --schema=public --schema-only --no-owner --no-privileges
//   datos.sql        pg_dump --schema=public --data-only --inserts --column-inserts
//   manifiesto.json  row count + checksum per table, taken in the same snapshot
//
// Two restore paths are verified:
//   A) structure from the backup:  stand-in + esquema.sql + datos.sql
//   B) emergency path:             stand-in + app migrations + datos.sql
//      (what you do on a new Supabase project: `supabase db push`, then the data)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");
const ENTORNO_SUPABASE = path.join(RAIZ, "supabase", "pruebas", "entorno-supabase.sql");
const CARPETA_MIGRACIONES = path.join(RAIZ, "supabase", "migrations");
export const SQL_MANIFIESTO = fs.readFileSync(path.join(AQUI, "manifiesto.sql"), "utf8");

// Recent pg_dump versions wrap plain dumps in psql's \restrict / \unrestrict
// meta-commands. They are only meaningful to psql, so they are removed here.
// Any other psql meta-command (e.g. \! shell escapes) is refused.
export const limpiarVolcado = (sql) => {
  const lineas = sql.split(/\r?\n/);
  const otras = lineas.filter((l) => l.startsWith("\\") && !/^\\(un)?restrict\s/.test(l));
  if (otras.length > 0) throw new Error(`Unexpected psql meta-command in dump: ${otras[0].slice(0, 40)}`);
  return lineas.filter((l) => !/^\\(un)?restrict\s/.test(l)).join("\n");
};

const migraciones = () =>
  fs
    .readdirSync(CARPETA_MIGRACIONES)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => fs.readFileSync(path.join(CARPETA_MIGRACIONES, f), "utf8"));

const nuevaBd = async () => {
  const db = await PGlite.create();
  await db.exec(fs.readFileSync(ENTORNO_SUPABASE, "utf8"));
  return db;
};

/** Path A: the structure comes from the backup itself. */
export const restaurarConEsquema = async ({ esquema, datos }) => {
  const db = await nuevaBd();
  await db.exec("drop schema public cascade"); // the dump recreates it (empty temporary database)
  await db.exec(limpiarVolcado(esquema));
  await db.exec(limpiarVolcado(datos));
  return db;
};

/** Path B: structure from the app migrations, then the data. */
export const restaurarSobreMigraciones = async ({ datos }) => {
  const db = await nuevaBd();
  for (const sql of migraciones()) await db.exec(sql);
  await db.exec(limpiarVolcado(datos));
  return db;
};

export const calcularManifiesto = async (db) => {
  const resultados = await db.exec(SQL_MANIFIESTO);
  return Object.values(resultados.at(-1).rows[0])[0];
};

// Extra checks on the restored data beyond the manifest
export const comprobarIntegridad = async (db) => {
  const consulta = async (sql) => (await db.query(sql)).rows;
  const sinRls = (await consulta(
    "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1"
  )).map((r) => r.relname);
  const [importes] = await consulta(
    "select coalesce((select sum(coste_cent) from public.variantes), 0)::bigint as coste_variantes_cent, coalesce((select sum(total_cent) from public.presupuestos), 0)::bigint as total_presupuestos_cent"
  );
  const [huerfanos] = await consulta(`select
      (select count(*) from public.modelos m left join public.proveedores p on p.id = m.proveedor_id where p.id is null)::int as modelos_sin_proveedor,
      (select count(*) from public.variantes v left join public.modelos m on m.id = v.modelo_id where m.id is null)::int as variantes_sin_modelo,
      (select count(*) from public.presupuestos pr left join public.clientes c on c.id = pr.cliente_id where pr.cliente_id is not null and c.id is null)::int as presupuestos_sin_cliente`);
  const [restricciones] = await consulta(
    "select count(*)::int as n from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and c.contype in ('f', 'c', 'u', 'p') and c.convalidated"
  );
  // Constraints must still be enforced after the restore: a negative cost is refused
  let restriccionesActivas = false;
  try {
    await db.exec("begin; insert into public.proveedores (nombre) values ('__prueba_restriccion__') ; insert into public.modelos (proveedor_id, tipo, nombre) select id, 'X', 'X' from public.proveedores where nombre = '__prueba_restriccion__'; insert into public.variantes (modelo_id, color, talla, coste_cent) select id, 'X', 'X', -1 from public.modelos where nombre = 'X' and tipo = 'X';");
  } catch {
    restriccionesActivas = true;
  } finally {
    await db.exec("rollback").catch(() => {});
  }
  return {
    tablasSinRls: sinRls,
    importes: { costeVariantesCent: Number(importes.coste_variantes_cent), totalPresupuestosCent: Number(importes.total_presupuestos_cent) },
    huerfanos,
    restriccionesValidadas: restricciones.n,
    restriccionesActivas,
  };
};
