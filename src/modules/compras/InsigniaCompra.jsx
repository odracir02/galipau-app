import { SITUACIONES } from "./domain/compras";

// Visible state of a purchase (theme colours, readable in light and dark)
export function InsigniaCompra({ situacion }) {
  const s = SITUACIONES[situacion];
  return <span className={`gx-insignia gx-estado-${s?.clase ?? "borrador"}`}>{s?.etiqueta ?? situacion}</span>;
}
