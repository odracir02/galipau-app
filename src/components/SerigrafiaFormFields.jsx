import { useId } from "react";

function SerigrafiaFormFields({ numColores, invalido, onChange }) {
  const id = useId();
  return (
    <div className="mt-2">
      <label className="form-label" htmlFor={id}>N.º de colores</label>
      <input
        id={id}
        type="number"
        className={`form-control ${invalido ? "is-invalid" : ""}`}
        placeholder="Ej: 2"
        min="1"
        step="1"
        inputMode="numeric"
        value={numColores ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </div>
  );
}

export default SerigrafiaFormFields;
