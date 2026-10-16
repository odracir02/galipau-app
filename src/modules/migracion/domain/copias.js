// A database backup counts as recent if it is correct and at most 48 hours old
export const HORAS_COPIA = 48;

export const copiaReciente = (ultimas, ahora = Date.now()) => {
  const u = ultimas?.base_datos;
  return Boolean(u && u.estado === "correcta" && (ahora - Date.parse(u.creada_en)) / 3600000 <= HORAS_COPIA);
};
