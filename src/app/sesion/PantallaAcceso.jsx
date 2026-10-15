import { useState } from "react";
import { api } from "../../shared/api/cliente";

const MIN_LONGITUD = 8;

function PantallaAcceso({ configurado, accesoLocal, alEntrar }) {
  const [contrasena, setContrasena] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const creando = !configurado;

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    if (creando) {
      if (contrasena.length < MIN_LONGITUD) return setError(`La contraseña debe tener al menos ${MIN_LONGITUD} caracteres.`);
      if (contrasena !== repetir) return setError("Las contraseñas no coinciden.");
    }
    setEnviando(true);
    try {
      await api.post(creando ? "/auth/configurar" : "/auth/login", { contrasena });
      await alEntrar();
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  };

  if (creando && !accesoLocal) {
    return (
      <div className="container mt-5" style={{ maxWidth: 480 }}>
        <h2 className="mb-3">Galipau App</h2>
        <div className="alert alert-warning" role="alert">
          Todavía no se ha creado la contraseña. Ábrela por primera vez desde el propio PC para configurarla.
        </div>
      </div>
    );
  }

  return (
    <div className="container mt-5" style={{ maxWidth: 480 }}>
      <h2 className="mb-1">Galipau App</h2>
      <p className="text-muted">{creando ? "Primer uso: crea la contraseña de acceso." : "Introduce tu contraseña para continuar."}</p>

      <form noValidate onSubmit={enviar}>
        <div className="mb-3">
          <label className="form-label" htmlFor="contrasena">{creando ? "Nueva contraseña" : "Contraseña"}</label>
          <input
            id="contrasena"
            type="password"
            className="form-control"
            autoComplete={creando ? "new-password" : "current-password"}
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            autoFocus
          />
          {creando && <div className="form-text">Mínimo {MIN_LONGITUD} caracteres. No hay forma de recuperarla: guárdala en un lugar seguro.</div>}
        </div>
        {creando && (
          <div className="mb-3">
            <label className="form-label" htmlFor="repetir">Repite la contraseña</label>
            <input
              id="repetir"
              type="password"
              className="form-control"
              autoComplete="new-password"
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
            />
          </div>
        )}
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {creando ? "Crear contraseña y entrar" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

export default PantallaAcceso;
