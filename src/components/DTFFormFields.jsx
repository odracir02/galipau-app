function DTFFormFields({ area, onChange }) {
  return (
    <div className="mt-2">
      <label className="form-label">Área de impresión (cm²)</label>
      <input
        type="number"
        className="form-control"
        placeholder="Ej: 300"
        value={area || ""}
        onChange={(e) => onChange(Number(e.target.value))}
        required
      />
    </div>
  );
}

export default DTFFormFields;
