function LineaProducto({
  linea,
  onChange,
  proveedores,
  modelos,
  tallas,
  colores,
}) {
  return (
    <div className="row g-2 mb-2 align-items-end">
      <div className="col-md-2">
        <label className="form-label">Tipo</label>
        <select
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

      <div className="col-md-2">
        <label className="form-label">Proveedor</label>
        <select
          className="form-select"
          value={linea.proveedor}
          onChange={(e) => onChange("proveedor", e.target.value)}
          required
        >
          <option value="">Selecciona</option>
          {proveedores.map((prov) => (
            <option key={prov} value={prov}>
              {prov}
            </option>
          ))}
        </select>
      </div>

      <div className="col-md-2">
        <label className="form-label">Modelo</label>
        <select
          className="form-select"
          value={linea.modelo}
          onChange={(e) => onChange("modelo", e.target.value)}
          required
        >
          <option value="">Selecciona</option>
          {modelos.map((mod) => (
            <option key={mod} value={mod}>
              {mod}
            </option>
          ))}
        </select>
      </div>

      <div className="col-md-2">
        <label className="form-label">Talla</label>
        <select
          className="form-select"
          value={linea.size}
          onChange={(e) => onChange("size", e.target.value)}
          required
        >
          <option value="">Selecciona</option>
          {tallas.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="col-md-2">
        <label className="form-label">Color</label>
        <select
          className="form-select"
          value={linea.color}
          onChange={(e) => onChange("color", e.target.value)}
          required
        >
          <option value="">Selecciona</option>
          {colores.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="col-md-2">
        <label className="form-label">Cantidad</label>
        <input
          type="number"
          className="form-control"
          min="1"
          value={linea.quantity}
          onChange={(e) => onChange("quantity", e.target.value)}
          required
        />
      </div>
    </div>
  );
}

export default LineaProducto;
