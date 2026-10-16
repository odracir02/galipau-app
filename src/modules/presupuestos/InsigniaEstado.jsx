import { ESTADOS } from "./domain/estados";

function InsigniaEstado({ estado }) {
  const e = ESTADOS[estado];
  if (!e) return <span className="badge text-bg-secondary">{estado}</span>;
  return <span className={`badge text-bg-${e.color} ${e.color === "light" ? "border" : ""}`}>{e.etiqueta}</span>;
}

export default InsigniaEstado;
