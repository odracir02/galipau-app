import { useState } from "react";

export const CONFIRMACION = "IMPORTAR";

// Import button that only works after typing the confirmation word
function ConfirmarEscrito({ texto, onConfirmar, deshabilitado }) {
  const [escrito, setEscrito] = useState("");
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
      <label className="small" htmlFor={`confirmar-${texto}`}>Para importar, escribe {CONFIRMACION}:</label>
      <input id={`confirmar-${texto}`} className="form-control form-control-sm" style={{ maxWidth: 140 }} value={escrito} onChange={(e) => setEscrito(e.target.value)} />
      <button type="button" className="btn btn-sm btn-warning" disabled={deshabilitado || escrito !== CONFIRMACION} onClick={onConfirmar}>{texto}</button>
    </div>
  );
}

export default ConfirmarEscrito;
