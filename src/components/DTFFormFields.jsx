import { useId } from "react";

function DTFFormFields({ area, invalido, onChange }) {
  const id = useId();
  return (
    <div className="mt-2">
      <label className="form-label" htmlFor={id}>Área de impresión (cm²)</label>
      <input
        id={id}
        type="number"
        className={`form-control ${invalido ? "is-invalid" : ""}`}
        placeholder="Ej: 300"
        min="0"
        step="any"
        value={area ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </div>
  );
}

export default DTFFormFields;
