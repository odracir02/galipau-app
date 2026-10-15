import { useCallback, useEffect, useState } from "react";
import { api } from "../../shared/api/cliente";
import { useSesion } from "../../app/sesion/contexto";

const MOTIVOS = { automatica: "Automática", manual: "Manual", migracion: "Antes de actualizar", restauracion: "Antes de restaurar" };
const fecha = (iso) => (iso ? new Date(iso).toLocaleString("es-ES") : "—");
const tamano = (bytes) => (bytes == null ? "—" : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

function PaginaCopias() {
  const { comprobar, accesoLocal } = useSesion();
  const [estado, setEstado] = useState(null);
  const [copias, setCopias] = useState([]);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [destino, setDestino] = useState("");
  const [aRestaurar, setARestaurar] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const [e, lista] = await Promise.all([api.get("/copias/estado"), api.get("/copias")]);
      setEstado(e);
      setCopias(lista);
      setDestino(e.destinoExterno ?? "");
    } catch (error) {
      setMensaje({ tipo: "danger", texto: error.message });
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const ejecutar = async (accion, exito) => {
    setOcupado(true);
    setMensaje(null);
    try {
      const resultado = await accion();
      setMensaje({ tipo: "success", texto: exito(resultado) });
      await cargar();
    } catch (error) {
      setMensaje({ tipo: "danger", texto: error.message });
    } finally {
      setOcupado(false);
    }
  };

  const crearCopia = () => ejecutar(() => api.post("/copias"), (r) => `Copia creada y verificada: ${r.archivo}`);

  const guardarDestino = (valor) =>
    ejecutar(
      () => api.put("/copias/destino-externo", { destinoExterno: valor || null }),
      (r) => (r.destinoExterno ? `Las copias se guardarán también en ${r.destinoExterno}` : "Carpeta externa desactivada.")
    );

  const restaurar = async (archivo) => {
    setOcupado(true);
    setMensaje(null);
    try {
      await api.post(`/copias/${encodeURIComponent(archivo)}/restaurar`, { confirmar: archivo });
      // The restored database has its own sessions: log in again
      await comprobar();
    } catch (error) {
      setMensaje({ tipo: "danger", texto: error.message });
      setOcupado(false);
      setARestaurar(null);
    }
  };

  if (!estado) {
    return (
      <div className="container mt-4">
        {mensaje ? <div className={`alert alert-${mensaje.tipo}`}>{mensaje.texto}</div> : <p role="status">Cargando…</p>}
      </div>
    );
  }

  const ultima = estado.ultima;
  return (
    <div className="container mt-4">
      <h2 className="mb-3">Copias de seguridad</h2>

      {mensaje && <div className={`alert alert-${mensaje.tipo}`} role="alert">{mensaje.texto}</div>}
      {estado.avisos.map((aviso) => (
        <div key={aviso} className="alert alert-warning" role="alert">{aviso}</div>
      ))}

      <div className="card mb-4">
        <div className="card-body">
          <h5 className="card-title">Estado</h5>
          <p className="mb-1">
            <strong>Última copia:</strong> {ultima ? `${fecha(ultima.creadaEn)} (${MOTIVOS[ultima.motivo]})` : "ninguna"}
            {ultima && (ultima.integridadOk ? <span className="badge text-bg-success ms-2">Verificada</span> : <span className="badge text-bg-danger ms-2">Fallida</span>)}
          </p>
          <p className="mb-1"><strong>Copias automáticas:</strong> cada {estado.horasEntreCopias} h mientras la aplicación está en marcha.</p>
          <p className="mb-1 text-break"><strong>Carpeta local:</strong> {estado.carpetaLocal}</p>
          <p className="mb-3 text-break"><strong>Carpeta externa:</strong> {estado.destinoExterno ?? "no configurada"}</p>
          <button type="button" className="btn btn-primary" onClick={crearCopia} disabled={ocupado}>Hacer copia ahora</button>
        </div>
      </div>

      {accesoLocal && (
        <div className="card mb-4">
          <div className="card-body">
            <h5 className="card-title">Carpeta externa (recomendado)</h5>
            <p className="text-muted small">
              Cada copia terminada se guarda también aquí. Usa una carpeta sincronizada con la nube (OneDrive) o un disco externo.
              Las copias que solo están en este PC no te protegen si el equipo se avería o se pierde.
            </p>
            <div className="input-group mb-2">
              <input
                aria-label="Carpeta externa"
                className="form-control"
                placeholder="C:\Users\...\OneDrive\GalipauApp\copias"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
              />
              <button type="button" className="btn btn-outline-primary" onClick={() => guardarDestino(destino)} disabled={ocupado}>Guardar</button>
              {estado.destinoExterno && (
                <button type="button" className="btn btn-outline-secondary" onClick={() => guardarDestino("")} disabled={ocupado}>Desactivar</button>
              )}
            </div>
            {estado.oneDriveDetectado && !estado.destinoExterno && (
              <button
                type="button"
                className="btn btn-link p-0"
                onClick={() => setDestino(`${estado.oneDriveDetectado}\\GalipauApp\\copias`)}
              >
                Usar OneDrive ({estado.oneDriveDetectado})
              </button>
            )}
          </div>
        </div>
      )}

      <h5>Copias disponibles ({copias.length})</h5>
      {copias.length === 0 ? (
        <p>No hay copias todavía.</p>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Tamaño</th><th></th></tr>
            </thead>
            <tbody>
              {copias.map((c) => (
                <tr key={c.archivo}>
                  <td>{fecha(c.fecha)}</td>
                  <td>{MOTIVOS[c.motivo]}</td>
                  <td>{tamano(c.tamanoBytes)}</td>
                  <td className="text-end text-nowrap">
                    <a className="btn btn-sm btn-outline-secondary" href={`/api/copias/${encodeURIComponent(c.archivo)}/descargar`}>Descargar</a>
                    {accesoLocal && (
                      <button type="button" className="btn btn-sm btn-outline-danger ms-2" onClick={() => setARestaurar(c.archivo)} disabled={ocupado}>
                        Restaurar…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aRestaurar && (
        <div className="alert alert-danger" role="alertdialog" aria-label="Confirmar restauración">
          <p className="mb-2">
            <strong>¿Restaurar {aRestaurar}?</strong> Todos los datos actuales se sustituirán por los de esa copia. Antes se hará
            automáticamente una copia de los datos actuales. Tendrás que volver a iniciar sesión (con la contraseña que había en la copia).
          </p>
          <button type="button" className="btn btn-danger" onClick={() => restaurar(aRestaurar)} disabled={ocupado}>Sí, restaurar</button>
          <button type="button" className="btn btn-outline-secondary ms-2" onClick={() => setARestaurar(null)} disabled={ocupado}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

export default PaginaCopias;
