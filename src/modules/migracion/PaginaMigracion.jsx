import { useCallback, useEffect, useState } from "react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { leerHistorial } from "../../domain/historialPresupuestos";
import { prepararHistorial, verificarImportacionHistorial } from "./domain/historial";
import { prepararCatalogo, verificarImportacionCatalogo } from "./domain/catalogo";
import {
  huellasImportadas, importarHistorial, importarCatalogo, revertirImportacion, listarImportaciones, catalogoActual, presupuestosDeImportacion,
} from "./migracionRepo";
import { euros } from "../../shared/utils/dinero";
import { leerArchivoTexto } from "../calculadora/formularioParametros";

const CONFIRMACION = "IMPORTAR";
const cargarFirestore = async () => (await import("../../services/catalogoFirebase")).getProductosFirebase();

function Confirmar({ texto, onConfirmar, deshabilitado }) {
  const [escrito, setEscrito] = useState("");
  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
      <label className="small" htmlFor={`confirmar-${texto}`}>Para importar, escribe {CONFIRMACION}:</label>
      <input id={`confirmar-${texto}`} className="form-control form-control-sm" style={{ maxWidth: 140 }} value={escrito} onChange={(e) => setEscrito(e.target.value)} />
      <button type="button" className="btn btn-sm btn-warning" disabled={deshabilitado || escrito !== CONFIRMACION} onClick={onConfirmar}>{texto}</button>
    </div>
  );
}

/**
 * Controlled migration of historical data into Supabase: preview first,
 * duplicates detected, integrity checked after importing, and every import
 * reversible. Nothing is imported until the owner confirms explicitly.
 */
function PaginaMigracion({ obtenerCliente = obtenerClienteSupabase, leerAlmacen = () => globalThis.localStorage, leerCatalogoFirestore = cargarFirestore }) {
  const [importaciones, setImportaciones] = useState([]);
  const [historial, setHistorial] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const recargarImportaciones = useCallback(async () => {
    try {
      setImportaciones(await listarImportaciones(await obtenerCliente()));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  }, [obtenerCliente]);

  useEffect(() => {
    recargarImportaciones();
  }, [recargarImportaciones]);

  const ejecutar = async (fn) => {
    setOcupado(true);
    setMensaje(null);
    try {
      await fn(await obtenerCliente());
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    } finally {
      setOcupado(false);
    }
  };

  const previsualizarHistorial = () =>
    ejecutar(async (sb) => setHistorial(await prepararHistorial(leerHistorial(leerAlmacen()), await huellasImportadas(sb))));

  // History exported from another browser or address ("Exportar historial" in the old version)
  const previsualizarArchivo = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    await ejecutar(async (sb) => {
      let datos;
      try {
        datos = JSON.parse(await leerArchivoTexto(archivo));
      } catch {
        throw new Error("El archivo no es un JSON válido.");
      }
      if (!Array.isArray(datos)) throw new Error("El archivo no contiene una lista de presupuestos.");
      setHistorial(await prepararHistorial(datos, await huellasImportadas(sb)));
    });
  };

  const previsualizarCatalogo = () =>
    ejecutar(async (sb) => setCatalogo(prepararCatalogo(await leerCatalogoFirestore(), await catalogoActual(sb))));

  const confirmarHistorial = () =>
    ejecutar(async (sb) => {
      const id = await importarHistorial(sb, historial.aImportar, { ...historial.resumen, origen: "localStorage" });
      const errores = verificarImportacionHistorial(historial.resumen, await presupuestosDeImportacion(sb, id));
      setMensaje(errores.length
        ? { tipo: "danger", texto: `Importación ${id} con diferencias: ${errores.join(" ")} Puedes revertirla abajo.` }
        : { tipo: "success", texto: `Importación ${id} correcta: ${historial.resumen.nuevos} presupuestos (${euros(historial.resumen.totalCent)}). El historial del navegador no se ha modificado.` });
      setHistorial(null);
      await recargarImportaciones();
    });

  const confirmarCatalogo = () =>
    ejecutar(async (sb) => {
      const id = await importarCatalogo(sb, catalogo.nuevas, { ...catalogo.resumen, origen: "firestore" });
      const errores = verificarImportacionCatalogo(catalogo.nuevas, await catalogoActual(sb));
      setMensaje(errores.length
        ? { tipo: "danger", texto: `Importación ${id} con diferencias: ${errores.slice(0, 5).join(" ")} Puedes revertirla abajo.` }
        : { tipo: "success", texto: `Importación ${id} correcta: ${catalogo.resumen.nuevas} productos nuevos. Firestore no se ha modificado.` });
      setCatalogo(null);
      await recargarImportaciones();
    });

  const revertir = (imp) => {
    if (!window.confirm(`¿Revertir la importación ${imp.id}? Se borrarán solo los datos que creó esa importación.`)) return;
    ejecutar(async (sb) => {
      await revertirImportacion(sb, imp.id);
      setMensaje({ tipo: "success", texto: `Importación ${imp.id} revertida.` });
      await recargarImportaciones();
    });
  };

  return (
    <div className="container mt-4">
      <h2>Migración de datos históricos</h2>
      <div className="alert alert-warning">
        Herramienta preparada para cuando autorices la migración. Primero muestra una vista previa; no importa nada hasta que lo confirmes escribiendo {CONFIRMACION}.
        Nunca modifica el historial del navegador ni Firestore, y cada importación se puede revertir.
      </div>
      {mensaje && <div className={`alert alert-${mensaje.tipo} py-2`} role={mensaje.tipo === "danger" ? "alert" : "status"}>{mensaje.texto}</div>}

      <section className="card mb-3">
        <div className="card-body">
          <h4 className="h5">Historial de presupuestos de este navegador</h4>
          <p className="small text-muted">
            Se importan como presupuestos «importados» de solo consulta, con su contenido original. El historial antiguo vive en el navegador y la dirección donde
            usabas la versión anterior: si no es este, expórtalo allí desde «Historial» → «Exportar historial» y carga el archivo aquí.
          </p>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={previsualizarHistorial} disabled={ocupado}>Ver vista previa</button>
            <label className="small mb-0" htmlFor="archivo-historial">o carga un historial exportado:</label>
            <input id="archivo-historial" type="file" accept="application/json,.json" className="form-control form-control-sm" style={{ maxWidth: 300 }} onChange={previsualizarArchivo} disabled={ocupado} />
          </div>
          {historial && (
            <div className="mt-3" data-testid="vista-historial">
              <p className="mb-1">
                Leídos <strong>{historial.resumen.leidos}</strong> · nuevos <strong>{historial.resumen.nuevos}</strong> ({euros(historial.resumen.totalCent)}) ·
                duplicados {historial.resumen.duplicados} · no válidos {historial.resumen.invalidos}
              </p>
              <div className="table-responsive" style={{ maxHeight: 300 }}>
                <table className="table table-sm small">
                  <thead><tr><th>#</th><th>Cliente</th><th>Fecha</th><th className="text-end">Total</th><th>Resultado</th></tr></thead>
                  <tbody>
                    {historial.filas.map((f) => (
                      <tr key={f.indice} className={f.estado === "nuevo" ? "" : "text-muted"}>
                        <td>{f.indice + 1}</td><td>{f.cliente_nombre}</td><td>{f.fecha ?? "—"}</td>
                        <td className="text-end">{f.total_cent === null ? "—" : euros(f.total_cent)}</td>
                        <td>{f.estado === "nuevo" ? `Se importará${f.avisos.length ? ` (${f.avisos.join(" ")})` : ""}` : f.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {historial.resumen.nuevos > 0 && <Confirmar texto={`Importar ${historial.resumen.nuevos} presupuestos`} onConfirmar={confirmarHistorial} deshabilitado={ocupado} />}
            </div>
          )}
        </div>
      </section>

      <section className="card mb-3">
        <div className="card-body">
          <h4 className="h5">Catálogo de Firestore</h4>
          <p className="small text-muted">Copia los productos al catálogo de Supabase con su coste tal cual. Lo que ya existe no se modifica; los productos repetidos con costes distintos no se importan hasta decidir.</p>
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={previsualizarCatalogo} disabled={ocupado}>Ver vista previa</button>
          {catalogo && (
            <div className="mt-3" data-testid="vista-catalogo">
              <p className="mb-1">
                Leídos <strong>{catalogo.resumen.leidos}</strong> · nuevos <strong>{catalogo.resumen.nuevas}</strong> · ya existentes {catalogo.resumen.existentes} ·
                coste distinto en Supabase {catalogo.resumen.cambiosCoste} · conflictos {catalogo.resumen.conflictos} · no válidos {catalogo.resumen.invalidas} · repetidos idénticos {catalogo.resumen.repetidasIdenticas}
              </p>
              {catalogo.conflictos.length + catalogo.cambiosCoste.length + catalogo.invalidas.length > 0 && (
                <ul className="small">
                  {catalogo.conflictos.map((c) => <li key={`c-${c.fila.proveedor}-${c.fila.modelo}-${c.fila.talla}-${c.fila.color}`}>Conflicto: {c.fila.proveedor} {c.fila.modelo} {c.fila.talla} {c.fila.color} ({c.costes.map((x) => euros(x)).join(" / ")}). {c.motivo}</li>)}
                  {catalogo.cambiosCoste.map((c) => <li key={`d-${c.fila.proveedor}-${c.fila.modelo}-${c.fila.talla}-${c.fila.color}`}>{c.fila.proveedor} {c.fila.modelo} {c.fila.talla} {c.fila.color}: Firestore {euros(c.fila.coste_cent)}, Supabase {euros(c.costeActualCent)}. {c.motivo}</li>)}
                  {catalogo.invalidas.map((c) => <li key={`i-${c.indice}`}>Fila {c.indice + 1}: {c.motivo}</li>)}
                </ul>
              )}
              {catalogo.resumen.nuevas > 0 && <Confirmar texto={`Importar ${catalogo.resumen.nuevas} productos`} onConfirmar={confirmarCatalogo} deshabilitado={ocupado} />}
            </div>
          )}
        </div>
      </section>

      <section className="mb-4">
        <h4 className="h5">Importaciones realizadas</h4>
        {importaciones.length === 0 ? <p className="small text-muted">Ninguna.</p> : (
          <table className="table table-sm small">
            <thead><tr><th>Nº</th><th>Tipo</th><th>Fecha</th><th>Resumen</th><th /></tr></thead>
            <tbody>
              {importaciones.map((i) => (
                <tr key={i.id}>
                  <td>{i.id}</td>
                  <td>{i.tipo === "historial_local" ? "Historial del navegador" : "Catálogo de Firestore"}</td>
                  <td>{new Date(i.creada_en).toLocaleString("es-ES")}</td>
                  <td>{i.resumen?.nuevos ?? i.resumen?.nuevas ?? "?"} registros{i.revertida_en ? ` · revertida el ${new Date(i.revertida_en).toLocaleString("es-ES")}` : ""}</td>
                  <td>{!i.revertida_en && <button type="button" className="btn btn-sm btn-outline-danger" disabled={ocupado} onClick={() => revertir(i)}>Revertir</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default PaginaMigracion;
