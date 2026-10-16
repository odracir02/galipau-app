import { useId } from "react";

function LineaProducto({
  linea,
  numero,
  opciones,
  camposConError = [],
  puedeEliminar,
  onChange,
  onRemove,
}) {
  const id = useId();
  const { proveedores, modelos, tallas, colores } = opciones;
  const productoInvalido = camposConError.includes("producto");
  const clase = (base, campo) =>
    `${base} ${camposConError.includes(campo) || productoInvalido ? "is-invalid" : ""}`;

  const desplegable = (campo, etiqueta, valores) => (
    <div className="col-6 col-md-4">
      <label className="form-label" htmlFor={`${id}-${campo}`}>{etiqueta}</label>
      <select
        id={`${id}-${campo}`}
        className={clase("form-select", campo)}
        value={linea[campo]}
        onChange={(e) => onChange(campo, e.target.value)}
        disabled={valores.length === 0 && !linea[campo]}
        required
      >
        <option value="">Selecciona</option>
        {valores.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="row g-2 mb-2 align-items-end" role="group" aria-label={`Línea ${numero}`}>
      <div className="col-6 col-md-4">
        <label className="form-label" htmlFor={`${id}-tipo`}>Tipo</label>
        <select
          id={`${id}-tipo`}
          className="form-select"
          value={linea.tipo}
          onChange={(e) => onChange("tipo", e.target.value)}
          required
        >
          <option value="Camiseta">Camiseta</option>
          <option value="Sudadera">Sudadera</option>
          <option value="Polo">Polo</option>
        </select>
      </div>

      {desplegable("proveedor", "Proveedor", proveedores)}
      {desplegable("modelo", "Modelo", modelos)}
      {desplegable("size", "Talla", tallas)}
      {desplegable("color", "Color", colores)}

      <div className="col-4 col-md-2">
        <label className="form-label" htmlFor={`${id}-quantity`}>Cantidad</label>
        <input
          id={`${id}-quantity`}
          type="number"
          className={`form-control ${camposConError.includes("quantity") ? "is-invalid" : ""}`}
          min="1"
          step="1"
          inputMode="numeric"
          value={linea.quantity}
          onChange={(e) => onChange("quantity", e.target.value)}
          required
        />
      </div>

      <div className="col-2 col-md-1">
        {puedeEliminar && (
          <button
            type="button"
            className="btn btn-outline-danger w-100"
            onClick={onRemove}
            aria-label={`Eliminar línea ${numero}`}
            title="Eliminar línea"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export default LineaProducto;
