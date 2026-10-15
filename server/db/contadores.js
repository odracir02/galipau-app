// Gap-free sequential document numbers per series and year (e.g. P-2026-0001).
// Must be called inside the same transaction that creates the document, so a
// failed creation does not consume a number.

export const siguienteNumero = (bd, serie, anio = new Date().getFullYear()) => {
  if (!bd.conexion.inTransaction) throw new Error("siguienteNumero must run inside a transaction");
  const { ultimo } = bd.conexion
    .prepare(
      `insert into contadores (serie, anio, ultimo) values (?, ?, 1)
       on conflict (serie, anio) do update set ultimo = ultimo + 1 returning ultimo`
    )
    .get(serie, anio);
  return `${serie}-${anio}-${String(ultimo).padStart(4, "0")}`;
};
