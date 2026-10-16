import { useId } from "react";
import { opcionesPrenda } from "../../domain/catalogo";

/**
 * Exact garment choice: supplier -> model -> colour -> size. Each list only
 * offers values that exist with the previous choices, so impossible
 * combinations cannot be selected. `busqueda` narrows suppliers and models.
 */
function SelectorPrenda({ linea, numero, productos, busqueda = "", puedeEliminar, onElegir, onCantidad, onRemove }) {
  const id = useId();
  const opciones = opcionesPrenda(productos, linea, busqueda);

  const desplegable = (campo, etiqueta, valores) => {
    // Keep a saved value visible even if it is no longer in the catalogue
    const lista = linea[campo] && !valores.includes(linea[campo]) ? [linea[campo], ...valores] : valores;
    return (
      <div className="col-6 col-md-3">
        <label className="form-label" htmlFor={`${id}-${campo}`}>{etiqueta}</label>
        <select id={`${id}-${campo}`} className="form-select" value={linea[campo] ?? ""} onChange={(e) => onElegir(campo, e.target.value)}
          disabled={lista.length === 0}>
          <option value="">{lista.length === 0 ? "—" : "Selecciona"}</option>
          {lista.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
    );
  };

  return (
    <div className="row g-2 mb-2 align-items-end" role="group" aria-label={`Línea ${numero}`}>
      {desplegable("proveedor", "Proveedor", opciones.proveedores)}
      {desplegable("modelo", "Modelo", opciones.modelos)}
      {desplegable("color", "Color", opciones.colores)}
      {desplegable("size", "Talla", opciones.tallas)}
      <div className="col-4 col-md-2">
        <label className="form-label" htmlFor={`${id}-quantity`}>Cantidad</label>
        <input id={`${id}-quantity`} type="number" className="form-control" min="1" step="1" inputMode="numeric"
          value={linea.quantity} onChange={(e) => onCantidad(e.target.value)} />
      </div>
      <div className="col-2 col-md-1">
        {puedeEliminar && (
          <button type="button" className="btn btn-outline-danger w-100" onClick={onRemove} aria-label={`Eliminar línea ${numero}`} title="Eliminar línea">✕</button>
        )}
      </div>
      {linea.tipo && linea.productoId && <div className="col-12 small text-muted">{linea.tipo}</div>}
    </div>
  );
}

export default SelectorPrenda;
