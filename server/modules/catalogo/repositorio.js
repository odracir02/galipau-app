// Catalogue access. The relational model (suppliers → models → variants) is
// exposed to the current quote form in the legacy flat shape
// { id, tipo, proveedor, modelo, talla, color, coste } so the UI and the
// legacy pricing engine work unchanged. `coste` is in euros (from integer cents).

export const centAEuros = (cent) => cent / 100;

export const crearRepositorioCatalogo = (bd) => {
  const db = () => bd.conexion;

  return {
    listarPlano({ incluirInactivos = false } = {}) {
      const filtro = incluirInactivos ? "" : "where v.activo = 1 and m.activo = 1 and p.activo = 1";
      return db()
        .prepare(
          `select v.id, m.tipo, p.nombre as proveedor, m.nombre as modelo, v.talla, v.color, v.coste_cent as costeCent
           from variantes v join modelos m on m.id = v.modelo_id join proveedores p on p.id = m.proveedor_id
           ${filtro} order by v.id`
        )
        .all()
        .map((f) => ({ ...f, id: String(f.id), coste: centAEuros(f.costeCent) }));
    },

    resumen() {
      return db()
        .prepare(
          `select (select count(*) from proveedores) as proveedores, (select count(*) from modelos) as modelos,
                  (select count(*) from variantes) as variantes`
        )
        .get();
    },
  };
};
