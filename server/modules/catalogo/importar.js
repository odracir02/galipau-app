// Imports a flat product list (the shape of the legacy Firestore "productos"
// collection: tipo, proveedor, modelo, talla, color, coste in euros) into the
// relational catalogue. Idempotent: re-importing updates costs instead of
// duplicating rows. Invalid rows are reported, never silently accepted.

const texto = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

// Converts a euro amount ("2.35", 2.35, "2,35") into integer cents; null if invalid
export const eurosACent = (valor) => {
  const t = typeof valor === "number" ? String(valor) : texto(valor).replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [enteros, decimales = ""] = t.split(".");
  return Number(enteros) * 100 + Number(decimales.padEnd(2, "0"));
};

export const validarFila = (fila) => {
  const errores = [];
  const datos = {
    tipo: texto(fila?.tipo),
    proveedor: texto(fila?.proveedor),
    modelo: texto(fila?.modelo),
    talla: texto(fila?.talla),
    color: texto(fila?.color),
    costeCent: eurosACent(fila?.coste ?? ""),
  };
  for (const campo of ["tipo", "proveedor", "modelo", "talla", "color"]) {
    if (!datos[campo]) errores.push(`falta ${campo}`);
  }
  if (datos.costeCent === null) errores.push(`coste no válido (${JSON.stringify(fila?.coste ?? null)})`);
  return { datos, errores };
};

/**
 * @returns {{ total, importadas, actualizadas, sinCambios, rechazadas: {indice, id, errores}[] }}
 */
export const importarCatalogo = (bd, filas, { soloValidar = false } = {}) => {
  const db = bd.conexion;
  const ahora = new Date().toISOString();
  const informe = { total: filas.length, importadas: 0, actualizadas: 0, sinCambios: 0, rechazadas: [] };

  const validas = [];
  filas.forEach((fila, indice) => {
    const { datos, errores } = validarFila(fila);
    if (errores.length) informe.rechazadas.push({ indice, id: fila?.id ?? null, errores });
    else validas.push(datos);
  });
  if (soloValidar) return informe;

  const upsertProveedor = db.prepare(
    `insert into proveedores (nombre, creado_en, actualizado_en) values (?, ?, ?)
     on conflict (nombre) do update set nombre = excluded.nombre returning id`
  );
  const upsertModelo = db.prepare(
    `insert into modelos (proveedor_id, tipo, nombre) values (?, ?, ?)
     on conflict (proveedor_id, tipo, nombre) do update set nombre = excluded.nombre returning id`
  );
  const buscarVariante = db.prepare(`select id, coste_cent from variantes where modelo_id = ? and color = ? and talla = ?`);
  const insertarVariante = db.prepare(`insert into variantes (modelo_id, color, talla, coste_cent) values (?, ?, ?, ?)`);
  const actualizarCoste = db.prepare(`update variantes set coste_cent = ? where id = ?`);

  // All or nothing
  db.transaction(() => {
    for (const d of validas) {
      const proveedorId = upsertProveedor.get(d.proveedor, ahora, ahora).id;
      const modeloId = upsertModelo.get(proveedorId, d.tipo, d.modelo).id;
      const existente = buscarVariante.get(modeloId, d.color, d.talla);
      if (!existente) {
        insertarVariante.run(modeloId, d.color, d.talla, d.costeCent);
        informe.importadas++;
      } else if (existente.coste_cent !== d.costeCent) {
        actualizarCoste.run(d.costeCent, existente.id);
        informe.actualizadas++;
      } else {
        informe.sinCambios++;
      }
    }
  })();

  return informe;
};
