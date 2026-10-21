import { ChevronLeft, ChevronRight } from "lucide-react";
import { POR_PAGINA, totalPaginas } from "./paginado";

/** "1–50 de 3.408" with previous/next buttons; renders nothing for a single page */
function Paginacion({ total, pagina, onCambiar, porPagina = POR_PAGINA, etiqueta = "Paginación" }) {
  const paginas = totalPaginas(total, porPagina);
  if (paginas <= 1) return null;
  const actual = Math.min(pagina, paginas);
  const n = (v) => v.toLocaleString("es-ES");
  return (
    <nav className="d-flex align-items-center justify-content-end gap-2 small px-3 py-2" aria-label={etiqueta}>
      <span className="text-muted">{n((actual - 1) * porPagina + 1)}–{n(Math.min(actual * porPagina, total))} de {n(total)}</span>
      <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Página anterior" disabled={actual <= 1} onClick={() => onCambiar(actual - 1)}>
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <span aria-current="page">{actual} / {paginas}</span>
      <button type="button" className="btn btn-sm btn-outline-secondary" aria-label="Página siguiente" disabled={actual >= paginas} onClick={() => onCambiar(actual + 1)}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </nav>
  );
}

export default Paginacion;
