import { useCallback, useEffect, useMemo, useState } from "react";
import { ContextoSesion } from "./contexto";
import PantallaAcceso from "./PantallaAcceso";
import { crearSesionLocal, crearSesionSupabase } from "./servicios";
import { backendActivo } from "../backend";

const servicioPorDefecto = () => (backendActivo() === "supabase" ? crearSesionSupabase() : crearSesionLocal());

// Gate for the whole app: shows the access screen until there is a valid session.
function ProveedorSesion({ children, servicio: servicioInyectado }) {
  const [servicio] = useState(() => servicioInyectado ?? servicioPorDefecto());
  const [estado, setEstado] = useState({ cargando: true });

  const comprobar = useCallback(async () => {
    try {
      const datos = await servicio.estado();
      setEstado({ cargando: false, ...datos });
    } catch (error) {
      setEstado({ cargando: false, error: error.message });
    }
  }, [servicio]);

  useEffect(() => {
    comprobar();
    return servicio.suscribir(() => setEstado((e) => ({ ...e, autenticado: false })));
  }, [comprobar, servicio]);

  const cerrarSesion = useCallback(async () => {
    try {
      await servicio.cerrarSesion();
    } finally {
      setEstado((e) => ({ ...e, autenticado: false, aviso: undefined }));
    }
  }, [servicio]);

  const valor = useMemo(() => ({ ...estado, backend: servicio.tipo, cerrarSesion, comprobar }), [estado, servicio, cerrarSesion, comprobar]);

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
    return (
      <PantallaAcceso
        servicio={servicio}
        configurado={estado.configurado}
        accesoLocal={estado.accesoLocal}
        aviso={estado.aviso}
        alEntrar={comprobar}
      />
    );
  }
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export default ProveedorSesion;
