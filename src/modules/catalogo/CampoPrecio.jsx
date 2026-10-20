import { useId } from "react";
import { interpretarPrecio, euro5 } from "./domain/catalogo";

/**
 * Purchase price input: supplier net price + VAT, or a price that already
 * includes VAT. Shows the effective cost the calculator will use, so VAT is
 * never added twice.
 */
function CampoPrecio({ valor, onChange, compacto = false }) {
  const id = useId();
  const r = valor.importe === "" ? null : interpretarPrecio(valor);
  const cambiar = (campo) => (e) => onChange({ ...valor, [campo]: e.target.value });
  return (
    <div className={compacto ? "" : "gx-tarjeta py-3"} role="group" aria-label="Precio de compra">
      <div className="d-flex flex-wrap gap-3 mb-2">
        <div className="form-check">
          <input className="form-check-input" type="radio" id={`${id}-neto`} name={`${id}-modo`} checked={valor.modo === "neto"} onChange={() => onChange({ ...valor, modo: "neto", iva: valor.iva === "" ? "21" : valor.iva })} />
          <label className="form-check-label small" htmlFor={`${id}-neto`}>Precio neto + IVA</label>
        </div>
        <div className="form-check">
          <input className="form-check-input" type="radio" id={`${id}-final`} name={`${id}-modo`} checked={valor.modo === "final"} onChange={() => onChange({ ...valor, modo: "final" })} />
          <label className="form-check-label small" htmlFor={`${id}-final`}>Precio con IVA ya incluido</label>
        </div>
      </div>
      <div className="row g-2 align-items-end">
        <div className="col-6 col-md-4">
          <label className="form-label small mb-0" htmlFor={`${id}-importe`}>{valor.modo === "neto" ? "Precio neto (€)" : "Precio pagado (€)"}</label>
          <input id={`${id}-importe`} className={`form-control form-control-sm ${r?.error ? "is-invalid" : ""}`} inputMode="decimal" value={valor.importe} onChange={cambiar("importe")} />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-0" htmlFor={`${id}-iva`}>{valor.modo === "neto" ? "IVA de compra (%)" : "IVA incluido (%, opcional)"}</label>
          <input id={`${id}-iva`} className="form-control form-control-sm" inputMode="decimal" value={valor.iva} onChange={cambiar("iva")} />
        </div>
        <div className="col-12 col-md-5 small">
          {r?.error ? <span className="text-danger">{r.error}</span> : r ? (
            <span>Coste para la calculadora: <strong data-testid="coste-efectivo">{euro5(r.coste)}</strong>{valor.modo === "final" ? " (no se suma IVA)" : ""}</span>
          ) : <span className="text-muted">Escribe el precio.</span>}
        </div>
      </div>
    </div>
  );
}

export default CampoPrecio;
