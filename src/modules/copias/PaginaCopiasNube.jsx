// Backups page for the cloud (Supabase) backend. Backups are produced by an
// external scheduled job (GitHub Actions, private repository) that writes its
// result to registro_copias; this page shows that status and offers a manual
// export of all data as JSON.

import { useCallback, useEffect, useState } from "react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { desenvolver } from "../../shared/supabase/errores";
import { avisosCopias, exportarDatos, fecha, TIPOS } from "./copiasNube";

function PaginaCopiasNube({ obtenerCliente = obtenerClienteSupabase }) {
  const [ultimas, setUltimas] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const filas = desenvolver(await sb.from("registro_copias").select("*").order("creada_en", { ascending: false }).limit(50));
      const porTipo = {};
      for (const f of filas) porTipo[f.tipo] ??= f;
      setUltimas(porTipo);
    } catch (error) {
      setMensaje({ tipo: "danger", texto: error.message });
    }
  }, [obtenerCliente]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const exportar = async () => {
    setOcupado(true);
    setMensaje(null);
    try {
      const datos = await exportarDatos(await obtenerCliente());
      const blob = new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = `galipau-exportacion-${datos.exportadoEn.slice(0, 10)}.json`;
      enlace.click();
      URL.revokeObjectURL(url);
      const total = Object.values(datos.tablas).reduce((n, filas) => n + filas.length, 0);
      setMensaje({ tipo: "success", texto: `Exportación descargada (${total} registros). Guárdala en un lugar seguro: contiene datos de clientes.` });
    } catch (error) {
      setMensaje({ tipo: "danger", texto: error.message });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="container mt-4">
      <h2 className="mb-3">Copias de seguridad</h2>
      {mensaje && <div className={`alert alert-${mensaje.tipo}`} role="alert">{mensaje.texto}</div>}
      {ultimas && avisosCopias(ultimas).map((a) => <div key={a} className="alert alert-warning" role="alert">{a}</div>)}

      <div className="card mb-4">
        <div className="card-body">
          <h5 className="card-title">Copias automáticas</h5>
          <p className="text-muted small">
            Se realizan fuera de la aplicación (tarea programada en un repositorio privado), cifradas, y cada una se verifica
            restaurándola en una base de datos temporal antes de darla por buena.
          </p>
          {ultimas === null ? (
            <p role="status">Cargando…</p>
          ) : (
            <ul className="list-unstyled mb-0">
              {Object.entries(TIPOS).map(([tipo, nombre]) => (
                <li key={tipo}>
                  <strong>{nombre}:</strong> {ultimas[tipo] ? `${fecha(ultimas[tipo].creada_en)} — ${ultimas[tipo].estado === "correcta" ? "verificada" : "fallida"}` : "ninguna"}
                  {ultimas[tipo]?.detalle?.ejecucion?.startsWith("https://github.com/") && (
                    <a className="ms-2 small" href={ultimas[tipo].detalle.ejecucion} target="_blank" rel="noreferrer">Ver detalles</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <h5 className="card-title">Exportación manual</h5>
          <p className="text-muted small">Descarga todos los datos en un archivo JSON para guardarlo en tu PC, OneDrive o un USB.</p>
          <button type="button" className="btn btn-primary" onClick={exportar} disabled={ocupado}>Exportar todos los datos</button>
        </div>
      </div>
    </div>
  );
}

export default PaginaCopiasNube;
