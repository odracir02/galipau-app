// HTTP client for the local Galipau API. Same-origin requests with the session
// cookie; errors are normalised to ErrorApi with the server's Spanish message.

export const EVENTO_SESION_CADUCADA = "galipau:sesion-caducada";

export class ErrorApi extends Error {
  constructor(estado, mensaje, { campo, codigo } = {}) {
    super(mensaje);
    this.estado = estado;
    this.campo = campo;
    this.codigo = codigo;
  }
}

const peticion = async (metodo, ruta, cuerpo) => {
  let respuesta;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo,
      credentials: "same-origin",
      headers: cuerpo !== undefined ? { "content-type": "application/json" } : undefined,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi(0, "No se puede conectar con el servidor de Galipau App. Comprueba que está en marcha.", { codigo: "sin_conexion" });
  }

  const texto = await respuesta.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = null;
  }

  if (!respuesta.ok) {
    if (respuesta.status === 401 && !ruta.startsWith("/auth/")) window.dispatchEvent(new Event(EVENTO_SESION_CADUCADA));
    throw new ErrorApi(respuesta.status, datos?.error ?? `Error ${respuesta.status}`, { campo: datos?.campo, codigo: datos?.codigo });
  }
  return datos;
};

export const api = {
  get: (ruta) => peticion("GET", ruta),
  post: (ruta, cuerpo) => peticion("POST", ruta, cuerpo),
  put: (ruta, cuerpo) => peticion("PUT", ruta, cuerpo),
  patch: (ruta, cuerpo) => peticion("PATCH", ruta, cuerpo),
};
