import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { obtenerClienteSupabase } from "../shared/supabase/cliente";
import { comprobarEntorno, entornoWeb, leerEntornoBd } from "./entorno";
import Cargando from "../shared/ui/Cargando";

/**
 * Blocks the app when this web build and the connected database belong to
 * different environments (test web on production data, or the opposite).
 */
function GuardaEntorno({ nube, children, obtenerCliente = obtenerClienteSupabase, web = entornoWeb() }) {
  const [resultado, setResultado] = useState(nube ? null : { estado: "ok" });

  useEffect(() => {
    if (!nube) return undefined;
    let vigente = true;
    (async () => {
      let bd = null;
      try {
        bd = await leerEntornoBd(await obtenerCliente());
      } catch {
        bd = null; // unreadable: no block, the pages report connection problems themselves
      }
      if (vigente) setResultado(comprobarEntorno(web, bd));
    })();
    return () => {
      vigente = false;
    };
  }, [nube, obtenerCliente, web]);

  // Nothing is shown (so nothing can be written) until the database is confirmed
  if (resultado === null) return <div className="gx-acceso"><Cargando texto="Comprobando el entorno…" /></div>;
  if (resultado.estado === "bloqueo") {
    return (
      <div className="gx-acceso">
        <div className="gx-acceso-tarjeta" role="alert">
          <h1 className="h5 d-flex align-items-center gap-2"><ShieldAlert size={22} aria-hidden="true" />Conexión bloqueada</h1>
          <p className="mb-0">{resultado.mensaje}</p>
        </div>
      </div>
    );
  }
  return (
    <>
      {resultado.estado === "aviso" && <div className="alert alert-warning rounded-0 mb-0 small py-2 text-center" role="status">{resultado.mensaje}</div>}
      {children}
    </>
  );
}

export default GuardaEntorno;
