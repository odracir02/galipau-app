// Single access point to the SQLite database. The connection can be swapped
// (restore from backup) while the server keeps running.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const abrirConexion = (ruta, { soloLectura = false } = {}) => {
  const db = new Database(ruta, { readonly: soloLectura, fileMustExist: soloLectura });
  if (!soloLectura) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  db.pragma("foreign_keys = ON"); // SQLite requires enabling FKs on every connection
  db.pragma("busy_timeout = 5000");
  return db;
};

export class BaseDatos {
  #ruta;
  #db = null;
  #mantenimiento = false;

  constructor(ruta) {
    this.#ruta = ruta;
  }

  get ruta() {
    return this.#ruta;
  }

  get enMemoria() {
    return this.#ruta === ":memory:";
  }

  abrir() {
    if (this.#db) return this.#db;
    if (!this.enMemoria) fs.mkdirSync(path.dirname(this.#ruta), { recursive: true });
    this.#db = abrirConexion(this.#ruta);
    return this.#db;
  }

  get conexion() {
    if (!this.#db) throw new Error("Database is not open");
    return this.#db;
  }

  get abierta() {
    return this.#db !== null;
  }

  get enMantenimiento() {
    return this.#mantenimiento;
  }

  transaccion(fn) {
    return this.conexion.transaction(fn)();
  }

  versionEsquema() {
    return this.conexion.pragma("user_version", { simple: true });
  }

  cerrar() {
    if (!this.#db) return;
    try {
      if (!this.enMemoria) this.#db.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      this.#db.close();
      this.#db = null;
    }
  }

  // Replaces the database file with another (already verified) SQLite file.
  // The caller is responsible for verifying the source and backing up first.
  reemplazarCon(rutaOrigen) {
    if (this.enMemoria) throw new Error("Cannot replace an in-memory database");
    this.#mantenimiento = true;
    try {
      this.cerrar();
      const temporal = `${this.#ruta}.restaurando`;
      fs.copyFileSync(rutaOrigen, temporal);
      for (const sufijo of ["-wal", "-shm"]) fs.rmSync(`${this.#ruta}${sufijo}`, { force: true });
      fs.renameSync(temporal, this.#ruta);
      this.abrir();
    } finally {
      this.#mantenimiento = false;
    }
  }
}
