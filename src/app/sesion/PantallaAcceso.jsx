import { useState } from "react";

const MIN_LONGITUD = 8;

function PantallaAcceso({ servicio, configurado, accesoLocal, aviso, alEntrar }) {
  const [email, setEmail] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const nube = servicio.tipo === "supabase";
  const creando = !nube && !configurado;

  const enviar = async (e) => {
    e.preventDefault();
    setError(null);
    if (creando) {
      if (contrasena.length < MIN_LONGITUD) return setError(`La contraseña debe tener al menos ${MIN_LONGITUD} caracteres.`);
      if (contrasena !== repetir) return setError("Las contraseñas no coinciden.");
    }
    if (nube && (!email.trim() || !contrasena)) return setError("Introduce tu email y tu contraseña.");
    setEnviando(true);
    try {
      if (creando) await servicio.configurar(contrasena);
      else await servicio.iniciarSesion({ email, contrasena });
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
      <p className="text-muted">
        {creando ? "Primer uso: crea la contraseña de acceso." : nube ? "Accede con tu cuenta privada." : "Introduce tu contraseña para continuar."}
      </p>
      {aviso && <div className="alert alert-warning" role="alert">{aviso}</div>}

      <form noValidate onSubmit={enviar}>
        {nube && (
          <div className="mb-3">
            <label className="form-label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="form-control"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
        )}
        <div className="mb-3">
          <label className="form-label" htmlFor="contrasena">{creando ? "Nueva contraseña" : "Contraseña"}</label>
          <input
            id="contrasena"
            type="password"
            className="form-control"
            autoComplete={creando ? "new-password" : "current-password"}
            value={contrasena}
            onChange={(e) => setContrasena(e.target.value)}
            autoFocus={!nube}
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
