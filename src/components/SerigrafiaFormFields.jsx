function SerigrafiaFormFields({ numColores, onChange }) {
  return (
    <div className="mt-2">
      <label className="form-label">N.º de colores</label>
      <input
        type="number"
        className="form-control"
        placeholder="Ej: 2"
        value={numColores || ""}
        onChange={(e) => onChange(Number(e.target.value))}
        required
      />
    </div>
  );
}

export default SerigrafiaFormFields;
