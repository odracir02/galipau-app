import { useCallback, useEffect, useMemo, useState } from "react";
import { api, EVENTO_SESION_CADUCADA } from "../../shared/api/cliente";
import { ContextoSesion } from "./contexto";
import PantallaAcceso from "./PantallaAcceso";

// Gate for the whole app: shows the access screen until there is a valid session.
function ProveedorSesion({ children }) {
  const [estado, setEstado] = useState({ cargando: true });

  const comprobar = useCallback(async () => {
    try {
      const datos = await api.get("/auth/estado");
      setEstado({ cargando: false, ...datos });
    } catch (error) {
      setEstado({ cargando: false, error: error.message });
    }
  }, []);

  useEffect(() => {
    comprobar();
    const alCaducar = () => setEstado((e) => ({ ...e, autenticado: false }));
    window.addEventListener(EVENTO_SESION_CADUCADA, alCaducar);
    return () => window.removeEventListener(EVENTO_SESION_CADUCADA, alCaducar);
  }, [comprobar]);

  const cerrarSesion = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setEstado((e) => ({ ...e, autenticado: false }));
    }
  }, []);

  const valor = useMemo(() => ({ ...estado, cerrarSesion, comprobar }), [estado, cerrarSesion, comprobar]);

  if (estado.cargando) {
    return <div className="container mt-5" role="status">Cargando Galipau App…</div>;
  }
  if (estado.error) {
    return (
      <div className="container mt-5">
        <div className="alert alert-danger" role="alert">{estado.error}</div>
        <button type="button" className="btn btn-outline-secondary" onClick={comprobar}>Reintentar</button>
      </div>
    );
  }
  if (!estado.autenticado) {
    return <PantallaAcceso configurado={estado.configurado} accesoLocal={estado.accesoLocal} alEntrar={comprobar} />;
  }
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export default ProveedorSesion;
