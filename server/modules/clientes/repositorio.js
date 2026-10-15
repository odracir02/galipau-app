// SQL access for customers. Column names are snake_case in SQL and camelCase in the API.

const COLUMNAS = {
  tipo: "tipo",
  nombre: "nombre",
  razonSocial: "razon_social",
  nif: "nif",
  email: "email",
  telefono: "telefono",
  direccion: "direccion",
  codigoPostal: "codigo_postal",
  ciudad: "ciudad",
  provincia: "provincia",
  pais: "pais",
  notas: "notas",
  archivado: "archivado",
};

const SELECT = `select id, tipo, nombre, razon_social as razonSocial, nif, email, telefono, direccion,
  codigo_postal as codigoPostal, ciudad, provincia, pais, notas, archivado, creado_en as creadoEn,
  actualizado_en as actualizadoEn from clientes`;

const aApi = (fila) => (fila ? { ...fila, archivado: fila.archivado === 1 } : null);
const aSql = (valor) => (typeof valor === "boolean" ? Number(valor) : valor);

export const crearRepositorioClientes = (bd) => {
  const db = () => bd.conexion;
  const ahora = () => new Date().toISOString();

  return {
    listar({ incluirArchivados = false, buscar } = {}) {
      const condiciones = [];
      const parametros = {};
      if (!incluirArchivados) condiciones.push("archivado = 0");
      if (buscar) {
        condiciones.push("(nombre like :buscar or razon_social like :buscar or nif like :buscar or email like :buscar)");
        parametros.buscar = `%${buscar}%`;
      }
      const where = condiciones.length ? ` where ${condiciones.join(" and ")}` : "";
      return db().prepare(`${SELECT}${where} order by nombre collate nocase`).all(parametros).map(aApi);
    },

    obtener(id) {
      return aApi(db().prepare(`${SELECT} where id = ?`).get(id));
    },

    crear(datos) {
      const campos = Object.keys(datos).filter((k) => datos[k] !== null && k in COLUMNAS);
      const t = ahora();
      const sql = `insert into clientes (${campos.map((k) => COLUMNAS[k]).join(", ")}, creado_en, actualizado_en)
        values (${campos.map((k) => `@${k}`).join(", ")}, @creadoEn, @actualizadoEn)`;
      const valores = Object.fromEntries(campos.map((k) => [k, aSql(datos[k])]));
      const { lastInsertRowid } = db().prepare(sql).run({ ...valores, creadoEn: t, actualizadoEn: t });
      return this.obtener(Number(lastInsertRowid));
    },

    actualizar(id, cambios) {
      const campos = Object.keys(cambios).filter((k) => k in COLUMNAS);
      if (campos.length === 0) return this.obtener(id);
      const sql = `update clientes set ${campos.map((k) => `${COLUMNAS[k]} = @${k}`).join(", ")},
        actualizado_en = @actualizadoEn where id = @id`;
      const valores = Object.fromEntries(campos.map((k) => [k, aSql(cambios[k])]));
      const { changes } = db().prepare(sql).run({ ...valores, actualizadoEn: ahora(), id });
      return changes ? this.obtener(id) : null;
    },
  };
};
