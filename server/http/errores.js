// Centralised error handling. Every API error is returned as
// { error: string, campo?: string, codigo: string } with an appropriate status.

export class ErrorApi extends Error {
  constructor(estado, mensaje, { campo, codigo } = {}) {
    super(mensaje);
    this.estado = estado;
    this.campo = campo;
    this.codigo = codigo ?? codigoPorEstado(estado);
  }
}

const codigoPorEstado = (estado) =>
  ({ 400: "datos_invalidos", 401: "no_autenticado", 403: "prohibido", 404: "no_encontrado", 409: "conflicto", 429: "demasiados_intentos", 503: "mantenimiento" })[
    estado
  ] ?? "error";

export const noEncontrado = (que = "El recurso") => new ErrorApi(404, `${que} no existe.`);

// Translates SQLite constraint errors into user-friendly API errors.
// `mensajesUnicos` maps "table.column" to a message for UNIQUE violations.
export const traducirErrorSqlite = (error, mensajesUnicos = {}) => {
  const codigo = error?.code;
  if (typeof codigo !== "string" || !codigo.startsWith("SQLITE_CONSTRAINT")) return error;

  if (codigo === "SQLITE_CONSTRAINT_UNIQUE" || codigo === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    const columna = /UNIQUE constraint failed: ([\w.]+)/.exec(error.message)?.[1];
    return new ErrorApi(409, mensajesUnicos[columna] ?? "Ya existe un registro con esos datos.", {
      campo: columna?.split(".")[1],
    });
  }
  // ON DELETE RESTRICT is reported as SQLITE_CONSTRAINT_TRIGGER with the same message
  if (codigo === "SQLITE_CONSTRAINT_FOREIGNKEY" || /FOREIGN KEY constraint failed/.test(error.message)) {
    return new ErrorApi(409, "La operación afecta a datos relacionados que no existen o que están en uso.");
  }
  if (codigo === "SQLITE_CONSTRAINT_NOTNULL") {
    const columna = /NOT NULL constraint failed: [\w]+\.(\w+)/.exec(error.message)?.[1];
    return new ErrorApi(400, "Falta un dato obligatorio.", { campo: columna });
  }
  return new ErrorApi(400, "Los datos no cumplen las reglas de integridad.");
};

export const manejadorNoEncontrado = (req, res, next) => next(new ErrorApi(404, "Ruta de la API no encontrada."));

// Express error handler (must keep 4 arguments)
// eslint-disable-next-line no-unused-vars
export const crearManejadorErrores = (logger) => (err, req, res, next) => {
  let error = traducirErrorSqlite(err);

  if (err?.type === "entity.parse.failed") error = new ErrorApi(400, "El cuerpo de la petición no es JSON válido.");
  if (err?.type === "entity.too.large") error = new ErrorApi(413, "La petición es demasiado grande.", { codigo: "demasiado_grande" });

  if (error instanceof ErrorApi) {
    const cuerpo = { error: error.message, codigo: error.codigo };
    if (error.campo) cuerpo.campo = error.campo;
    return res.status(error.estado).json(cuerpo);
  }

  logger?.error?.("Unexpected error", req.method, req.originalUrl, err);
  res.status(500).json({ error: "Error interno del servidor.", codigo: "error_interno" });
};
