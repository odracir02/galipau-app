// Client-side pagination helpers (page numbers start at 1)
export const POR_PAGINA = 50;
export const paginar = (filas, pagina, porPagina = POR_PAGINA) => filas.slice((pagina - 1) * porPagina, pagina * porPagina);
export const totalPaginas = (total, porPagina = POR_PAGINA) => Math.max(1, Math.ceil(total / porPagina));
