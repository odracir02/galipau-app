import { ESTADOS } from "./domain/estados";

// State badge; colours come from the theme (gx-estado-*), readable in light and dark
function InsigniaEstado({ estado }) {
  const e = ESTADOS[estado];
  return <span className={`gx-insignia gx-estado-${e ? estado : "borrador"}`}>{e?.etiqueta ?? estado}</span>;
}

export default InsigniaEstado;
