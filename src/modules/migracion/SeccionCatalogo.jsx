import { useMemo, useState } from "react";
import { prepararCatalogo, conciliarCatalogo, filasParaImportar, extraerProductos, costeExacto, claveVariante } from "./domain/catalogo";
import { catalogoActual, importarCatalogo, ultimasCopias } from "./migracionRepo";
import { leerArchivoTexto } from "../calculadora/formularioParametros";
import ConfirmarEscrito from "./ConfirmarEscrito";
import { copiaReciente, HORAS_COPIA } from "./domain/copias";

const TIPOS_SUGERIDOS = ["Camiseta", "Camiseta niño", "Sudadera", "Polo", "Bolsa", "Otra"];
const PRECIO = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: "always" });
const euro4 = (v) => (v === null || v === undefined ? "—" : PRECIO.format(v));

const descargarJson = (datos, nombre) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
};


/**
 * Catalogue import: from Firestore (read-only) or from a catalogue file
 * (e.g. exported from the master spreadsheet). Preview, garment type per
 * model, recent-backup check, typed confirmation and reconciliation.
 */
function SeccionCatalogo({ leerCatalogoFirestore, ocupado, ejecutar, setMensaje, alImportar }) {
  const [origen, setOrigen] = useState(null); // { tipo, nombre, productos }
  const [actuales, setActuales] = useState([]);
  const [copias, setCopias] = useState(null);
  const [tipos, setTipos] = useState({});
  const [carga, setCarga] = useState(0); // a new preview resets the typed confirmation

  const preparado = useMemo(() => (origen ? prepararCatalogo(origen.productos, actuales, tipos) : null), [origen, actuales, tipos]);
  const hayCopia = copiaReciente(copias);

  const cargar = (obtener) =>
    ejecutar(async (sb) => {
      const o = await obtener();
      const [a, c] = await Promise.all([catalogoActual(sb), ultimasCopias(sb)]);
      setActuales(a);
      setCopias(c);
      setTipos({});
      setOrigen(o);
      setCarga((n) => n + 1);
    });

  const desdeFirestore = () =>
    cargar(async () => {
      try {
        return { tipo: "firestore", nombre: "Firestore (productos)", productos: await leerCatalogoFirestore() };
      } catch (e) {
        throw new Error(/permission|permiso/i.test(e.message ?? "")
          ? "Firestore no permite leer el catálogo (permisos). Usa un archivo de catálogo o revisa las reglas de Firestore."
          : `No se ha podido leer Firestore: ${e.message}`);
      }
    });

  const desdeArchivo = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    await cargar(async () => {
      let json;
      try {
        json = JSON.parse(await leerArchivoTexto(archivo));
      } catch {
        throw new Error("El archivo no es un JSON válido.");
      }
      return { tipo: "archivo", nombre: archivo.name, productos: extraerProductos(json), origenArchivo: json?.origen ?? null };
    });
  };

  const importar = () =>
    ejecutar(async (sb) => {
      const resumen = { ...preparado.resumen, origen: origen.tipo, archivo: origen.tipo === "archivo" ? origen.nombre : undefined };
      const id = await importarCatalogo(sb, filasParaImportar(preparado.nuevas), resumen);
      const despues = await catalogoActual(sb);
      const c = conciliarCatalogo(preparado.validas, despues, preparado.cambiosCoste);
      setMensaje(c.correcto
        ? { tipo: "success", texto: `Importación ${id} correcta: ${preparado.resumen.nuevas} productos nuevos. Comprobación: ${c.encontradas} de ${c.esperadas} productos del origen están en el catálogo con su precio. El origen no se ha modificado.` }
        : { tipo: "danger", texto: `Importación ${id} con diferencias: faltan ${c.faltan.length} y ${c.costeDistinto.length} tienen otro precio. Revísala y, si hace falta, reviértela abajo.` });
      setActuales(despues);
      setOrigen(null);
      await alImportar();
    });

  const estadoFila = (f) => {
    const k = claveVariante(f);
    if (preparado.nuevas.some((n) => claveVariante(n) === k)) return "Nuevo";
    if (preparado.existentes.some((n) => claveVariante(n) === k)) return "Ya existe";
    return "Coste distinto";
  };

  return (
    <section className="card mb-3">
      <div className="card-body">
        <h4 className="h5">Catálogo de prendas</h4>
        <p className="small text-muted">
          Copia los productos al catálogo de Supabase con su precio tal cual (precio neto e IVA si el origen los indica). Lo que ya existe no se modifica y
          repetir la importación no duplica productos. El origen nunca se modifica.
        </p>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={desdeFirestore} disabled={ocupado}>Vista previa desde Firestore</button>
          <label className="small mb-0" htmlFor="archivo-catalogo">o desde un archivo de catálogo:</label>
          <input id="archivo-catalogo" type="file" accept="application/json,.json" className="form-control form-control-sm" style={{ maxWidth: 300 }} onChange={desdeArchivo} disabled={ocupado} />
        </div>

        {preparado && (
          <div className="mt-3" data-testid="vista-catalogo">
            <p className="mb-1">
              <strong>{origen.nombre}</strong>: leídos <strong>{preparado.resumen.leidos}</strong> · válidos únicos {preparado.resumen.validasUnicas} ·
              nuevos <strong>{preparado.resumen.nuevas}</strong> · ya existentes {preparado.resumen.existentes} · coste distinto en Supabase {preparado.resumen.cambiosCoste} ·
              conflictos {preparado.resumen.conflictos} · no válidos {preparado.resumen.invalidas} · repetidos idénticos {preparado.resumen.repetidasIdenticas}
            </p>
            <p className="small text-muted mb-2">{preparado.resumen.proveedores} proveedor(es) y {preparado.resumen.modelos} modelo(s).</p>
            <button type="button" className="btn btn-sm btn-outline-secondary mb-3"
              onClick={() => descargarJson({ formato: "galipau-catalogo/1", origen: origen.nombre, exportadoEn: new Date().toISOString(), productos: origen.productos }, `catalogo-${origen.tipo}-${new Date().toISOString().slice(0, 10)}.json`)}>
              Descargar copia del origen (JSON)
            </button>

            <h5 className="h6">Tipo de prenda por modelo</h5>
            <p className="small text-muted mb-1">Necesario para describir la prenda. No se deduce: elígelo o escríbelo para cada modelo nuevo.</p>
            <div className="gx-tabla mb-3">
              <div className="table-responsive">
                <table className="table table-sm small mb-0">
                  <thead><tr><th>Proveedor</th><th>Modelo</th><th>Variantes</th><th>Tipo</th></tr></thead>
                  <tbody>
                    {preparado.modelos.map((m) => (
                      <tr key={m.clave}>
                        <td>{m.proveedor}</td><td>{m.modelo}</td><td>{m.variantes}</td>
                        <td>
                          {m.existente ? `${m.tipo} (ya existe)` : (
                            <>
                              <input aria-label={`Tipo de ${m.proveedor} ${m.modelo}`} list="tipos-prenda" className={`form-control form-control-sm ${m.tipo ? "" : "is-invalid"}`} style={{ maxWidth: 200 }}
                                value={tipos[m.clave] ?? m.tipo} onChange={(e) => setTipos((t) => ({ ...t, [m.clave]: e.target.value }))} />
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <datalist id="tipos-prenda">{TIPOS_SUGERIDOS.map((t) => <option key={t} value={t} />)}</datalist>

            {preparado.conflictos.length + preparado.cambiosCoste.length + preparado.invalidas.length > 0 && (
              <>
                <h5 className="h6">Incidencias</h5>
                <ul className="small">
                  {preparado.conflictos.map((c) => <li key={`c-${claveVariante(c.fila)}`}>Conflicto: {c.fila.proveedor} {c.fila.modelo} {c.fila.color} {c.fila.talla}. {c.motivo}</li>)}
                  {preparado.cambiosCoste.map((c) => <li key={`d-${claveVariante(c.fila)}`}>{c.fila.proveedor} {c.fila.modelo} {c.fila.color} {c.fila.talla}: origen {euro4(costeExacto(c.fila))}, Supabase {euro4(c.costeActual)}. {c.motivo}</li>)}
                  {preparado.invalidas.map((c) => <li key={`i-${c.indice}`}>Fila {c.indice + 1}: {c.motivo}</li>)}
                </ul>
              </>
            )}

            <h5 className="h6">Productos ({preparado.validas.length})</h5>
            <div className="gx-tabla mb-2" style={{ maxHeight: 360, overflow: "auto" }}>
              <table className="table table-sm small mb-0">
                <thead><tr><th>Proveedor</th><th>Modelo</th><th>Color</th><th>Talla</th><th className="text-end">Neto</th><th className="text-end">IVA</th><th className="text-end">Coste</th><th>Resultado</th></tr></thead>
                <tbody>
                  {preparado.validas.map((f) => (
                    <tr key={claveVariante(f)}>
                      <td>{f.proveedor}</td><td>{f.modelo}</td><td>{f.color}</td><td>{f.talla}</td>
                      <td className="text-end">{f.precio_neto === null ? "—" : euro4(f.precio_neto)}</td>
                      <td className="text-end">{f.iva_porcentaje === null ? "—" : `${f.iva_porcentaje} %`}</td>
                      <td className="text-end">{euro4(costeExacto(f))}</td>
                      <td>{estadoFila(f)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {copias && !hayCopia && (
              <div className="alert alert-warning small py-2" role="alert">
                No hay una copia de seguridad correcta de la base de datos de las últimas {HORAS_COPIA} horas. Lanza una copia (repositorio de copias → Actions) antes de importar.
              </div>
            )}
            {preparado.modelosSinTipo.length > 0 && <div className="small text-danger">Falta el tipo de prenda de {preparado.modelosSinTipo.length} modelo(s).</div>}
            {preparado.resumen.nuevas === 0 && <div className="small text-muted">No hay productos nuevos que importar.</div>}
            {preparado.resumen.nuevas > 0 && (
              <ConfirmarEscrito key={carga} texto={`Importar ${preparado.resumen.nuevas} productos`} onConfirmar={importar} deshabilitado={ocupado || !preparado.listoParaImportar || !hayCopia} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default SeccionCatalogo;
