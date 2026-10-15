// Supabase's Data API returns at most 1,000 rows per request by default.
// This reads a whole table/view page by page so no rows are silently dropped.

import { desenvolver } from "./errores";

export const TAMANO_PAGINA = 1000;

/**
 * @param {(desde: number, hasta: number) => PromiseLike<{ data, error }>} pedirPagina
 */
export const leerTodo = async (pedirPagina, tamano = TAMANO_PAGINA) => {
  const filas = [];
  for (let desde = 0; ; desde += tamano) {
    const pagina = desenvolver(await pedirPagina(desde, desde + tamano - 1)) ?? [];
    filas.push(...pagina);
    if (pagina.length < tamano) return filas;
  }
};
