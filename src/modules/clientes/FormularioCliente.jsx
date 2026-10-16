import { useState } from "react";
import { CAMPOS_CLIENTE, normalizarCliente, validarCliente } from "./clientesRepo";

const formularioDe = (c) => Object.fromEntries(CAMPOS_CLIENTE.map(({ clave }) => [clave, c?.[clave] ?? ""]));

// Customer form (create or edit), used in the quote editor and in Clientes
function FormularioCliente({ inicial, titulo, onGuardar, onCancelar }) {
  const [datos, setDatos] = useState(() => formularioDe(inicial));
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    const e = validarCliente(normalizarCliente(datos));
    setErrores(e);
    if (e.length) return;
    setGuardando(true);
    try {
      await onGuardar(datos);
    } catch (error) {
      setErrores([error.message]);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="border rounded p-3 bg-light" role="group" aria-label={titulo}>
      <h6>{titulo}</h6>
      <div className="row g-2">
        {CAMPOS_CLIENTE.map((c) => (
          <div key={c.clave} className={c.clave === "direccion" || c.clave === "nombre" ? "col-md-6" : "col-md-3"}>
            <label className="form-label small mb-0" htmlFor={`cliente-${c.clave}`}>{c.etiqueta}{c.obligatorio ? " *" : ""}</label>
            <input id={`cliente-${c.clave}`} type={c.tipo ?? "text"} className="form-control form-control-sm" value={datos[c.clave]}
              onChange={(e) => setDatos((d) => ({ ...d, [c.clave]: e.target.value }))} />
          </div>
        ))}
      </div>
      {errores.length > 0 && <div className="alert alert-danger small py-2 mt-2 mb-0" role="alert">{errores.join(" ")}</div>}
      <div className="mt-2 d-flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={guardar} disabled={guardando}>Guardar cliente</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

export default FormularioCliente;
