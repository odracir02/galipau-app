// Test helper: a real PostgreSQL (PGlite, in-process) with the Supabase
// stand-in and every migration applied, plus helpers to run SQL as the
// anonymous visitor, any authenticated user or the owner.

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CARPETA_MIGRACIONES = path.join(RAIZ, "migrations");

export const listarMigraciones = () =>
  fs
    .readdirSync(CARPETA_MIGRACIONES)
    .filter((f) => /^\d{14}_[a-z0-9_]+\.sql$/.test(f))
    .sort();

export const PROPIETARIO = "11111111-1111-1111-1111-111111111111";
export const INTRUSO = "22222222-2222-2222-2222-222222222222";

// privilegiosPorDefecto=false simulates a project created with
// "Automatically expose new tables" disabled (no default grants in public).
export const crearBd = async ({ conPropietario = true, privilegiosPorDefecto = true } = {}) => {
  const db = await PGlite.create();
  let entorno = fs.readFileSync(path.join(RAIZ, "pruebas", "entorno-supabase.sql"), "utf8");
  if (!privilegiosPorDefecto) entorno = entorno.replace(/^alter default privileges in schema public grant .*$/gm, "");
  await db.exec(entorno);
  for (const archivo of listarMigraciones()) {
    await db.exec(fs.readFileSync(path.join(CARPETA_MIGRACIONES, archivo), "utf8"));
  }
  if (conPropietario) {
    await db.query("insert into auth.users (id, email) values ($1, 'propietario@example.com'), ($2, 'intruso@example.com')", [PROPIETARIO, INTRUSO]);
    await db.query("insert into public.propietario (user_id) values ($1)", [PROPIETARIO]);
  }
  return db;
};

/**
 * Runs `fn(tx)` inside a transaction as a given Supabase role/user, like
 * PostgREST does: SET LOCAL ROLE + request.jwt.claims.
 * @param {"anon"|"authenticated"} rol
 * @param {string|null} uid
 */
export const como = (db, rol, uid, fn) =>
  db.transaction(async (tx) => {
    await tx.exec(`set local role ${rol}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(uid ? { sub: uid, role: rol } : { role: rol })]);
    return fn(tx);
  });

export const comoPropietario = (db, fn) => como(db, "authenticated", PROPIETARIO, fn);
export const comoIntruso = (db, fn) => como(db, "authenticated", INTRUSO, fn);
export const comoAnonimo = (db, fn) => como(db, "anon", null, fn);

// Returns the SQLSTATE code of the error thrown by fn, or null if it succeeded
export const codigoError = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.code ?? e.message;
  }
};
