// Loading indicator (announced to screen readers)
function Cargando({ texto = "Cargando…" }) {
  return (
    <div className="gx-cargando" role="status">
      <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}

export default Cargando;
