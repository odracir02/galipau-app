import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BaseDatos } from "./baseDatos.js";
import { migrar } from "./migrar.js";
import { siguienteNumero } from "./contadores.js";

let bd;
const ahora = "2026-10-15T10:00:00.000Z";
const falla = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e.code ?? e.message;
  }
};

beforeEach(async () => {
  bd = new BaseDatos(":memory:");
  bd.abrir();
  await migrar(bd);
});
afterEach(() => bd.cerrar());

const crearCliente = (extra = {}) =>
  bd.conexion
    .prepare("insert into clientes (nombre, nif, creado_en, actualizado_en, tipo) values (@nombre, @nif, @t, @t, @tipo)")
    .run({ nombre: "Club", nif: null, tipo: "empresa", t: ahora, ...extra }).lastInsertRowid;

const crearPresupuesto = (extra = {}) =>
  bd.conexion
    .prepare(
      `insert into presupuestos (numero, cliente_id, cliente_nombre, fecha_emision, motor, entrada_json, total_cent, creado_en, actualizado_en)
       values (@numero, @clienteId, 'Club', @fecha, 'legacy', @entrada, @total, @t, @t)`
    )
    .run({ numero: "P-2026-0001", clienteId: null, fecha: "2026-10-15", entrada: "{}", total: 1000, t: ahora, ...extra });

describe("restricciones de integridad", () => {
  it("NIF único", () => {
    crearCliente({ nif: "B12345678" });
    expect(falla(() => crearCliente({ nif: "B12345678" }))).toBe("SQLITE_CONSTRAINT_UNIQUE");
    expect(falla(() => crearCliente({ nif: null }))).toBeNull(); // several customers without NIF allowed
  });

  it("nombre obligatorio y no vacío; tipo dentro de la lista", () => {
    expect(falla(() => crearCliente({ nombre: "   " }))).toBe("SQLITE_CONSTRAINT_CHECK");
    expect(falla(() => crearCliente({ tipo: "otro" }))).toBe("SQLITE_CONSTRAINT_CHECK");
  });

  it("claves foráneas activas: no se puede usar un cliente inexistente ni borrar uno en uso", () => {
    expect(falla(() => crearPresupuesto({ clienteId: 999 }))).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
    const id = crearCliente();
    crearPresupuesto({ clienteId: id });
    // ON DELETE RESTRICT: SQLite reports it as a trigger constraint ("FOREIGN KEY constraint failed")
    expect(falla(() => bd.conexion.prepare("delete from clientes where id = ?").run(id))).toBe("SQLITE_CONSTRAINT_TRIGGER");
  });

  it("importes en céntimos enteros: rechaza decimales y negativos", () => {
    expect(falla(() => crearPresupuesto({ total: 10.5 }))).toBe("SQLITE_CONSTRAINT_DATATYPE");
    expect(falla(() => crearPresupuesto({ total: -1 }))).toBe("SQLITE_CONSTRAINT_CHECK");
  });

  it("fechas con formato ISO (las inválidas no pasan aunque date() devuelva NULL)", () => {
    expect(falla(() => crearPresupuesto({ fecha: "15/10/2026" }))).toBe("SQLITE_CONSTRAINT_CHECK");
    expect(falla(() => crearPresupuesto({ fecha: "2026-02-30" }))).toBe("SQLITE_CONSTRAINT_CHECK");
    expect(falla(() => crearPresupuesto({ fecha: "2026-10-15" }))).toBeNull();
  });

  it("JSON válido en la entrada del cálculo", () => {
    expect(falla(() => crearPresupuesto({ entrada: "{no json" }))).toBe("SQLITE_CONSTRAINT_CHECK");
  });

  it("catálogo: variante única por modelo, color y talla, con coste no negativo", () => {
    const db = bd.conexion;
    db.prepare("insert into proveedores (nombre, creado_en, actualizado_en) values ('P', ?, ?)").run(ahora, ahora);
    db.prepare("insert into modelos (proveedor_id, tipo, nombre) values (1, 'Camiseta', 'M')").run();
    db.prepare("insert into variantes (modelo_id, color, talla, coste_cent) values (1, 'Negro', 'M', 235)").run();
    expect(falla(() => db.prepare("insert into variantes (modelo_id, color, talla, coste_cent) values (1, 'Negro', 'M', 300)").run())).toBe("SQLITE_CONSTRAINT_UNIQUE");
    expect(falla(() => db.prepare("insert into variantes (modelo_id, color, talla, coste_cent) values (1, 'Rojo', 'M', -1)").run())).toBe("SQLITE_CONSTRAINT_CHECK");
    expect(falla(() => db.prepare("insert into modelos (proveedor_id, tipo, nombre) values (99, 'Camiseta', 'X')").run())).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
  });

  it("un solo propietario", () => {
    const db = bd.conexion;
    db.prepare("insert into propietario (id, hash_contrasena, actualizado_en) values (1, 'h', ?)").run(ahora);
    expect(falla(() => db.prepare("insert into propietario (id, hash_contrasena, actualizado_en) values (2, 'h', ?)").run(ahora))).toBe("SQLITE_CONSTRAINT_CHECK");
  });
});

describe("transacciones", () => {
  it("numeración correlativa por serie y año", () => {
    const numeros = bd.transaccion(() => [siguienteNumero(bd, "P", 2026), siguienteNumero(bd, "P", 2026), siguienteNumero(bd, "PED", 2026), siguienteNumero(bd, "P", 2027)]);
    expect(numeros).toEqual(["P-2026-0001", "P-2026-0002", "PED-2026-0001", "P-2027-0001"]);
  });

  it("si la creación del documento falla, el número no se consume", () => {
    expect(() =>
      bd.transaccion(() => {
        const numero = siguienteNumero(bd, "P", 2026);
        crearPresupuesto({ numero, total: -5 }); // fails CHECK
      })
    ).toThrow();
    expect(bd.transaccion(() => siguienteNumero(bd, "P", 2026))).toBe("P-2026-0001");
  });

  it("exige ejecutarse dentro de una transacción", () => {
    expect(() => siguienteNumero(bd, "P", 2026)).toThrow(/inside a transaction/);
  });
});
