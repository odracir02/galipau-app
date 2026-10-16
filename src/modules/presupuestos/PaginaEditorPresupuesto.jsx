import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import FormularioTrabajo from "../calculadora/FormularioTrabajo";
import DesgloseCostes from "../calculadora/DesgloseCostes";
import { useCalculoSerigrafia } from "../calculadora/useCalculoSerigrafia";
import { cargarParametrosActivos } from "../calculadora/parametrosRepo";
import SelectorCliente from "../clientes/SelectorCliente";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { getProductos } from "../../services/getProductos";
import { cargarEmpresa } from "../empresa/empresaRepo";
import { obtenerPresupuesto, crearPresupuesto, actualizarPresupuesto, cambiarEstado, cargarVersionParametros } from "./data/presupuestosRepo";
import { construirRegistro, estadoDesdeRegistro, estadoDuplicado, formularioVacio, datosDocumentoIniciales, reproducir, sinPrecioGuardado } from "./domain/instantanea";
import { ESTADOS, accionesDesde, esEditable, requierePrecioFinal } from "./domain/estados";
import { IDIOMAS } from "./domain/documento";
import { descargarPdfPresupuesto } from "./descargarPdf";
import { euros, eurosDecimal } from "../../shared/utils/dinero";
import InsigniaEstado from "./InsigniaEstado";
import { ArrowLeft } from "lucide-react";
import ResumenCalculo from "../calculadora/ResumenCalculo";
import Aviso from "../../shared/ui/Aviso";
import Cargando from "../../shared/ui/Cargando";
import { useConfirmar } from "../../shared/ui/contextoDialogos";

const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "");

/** Create, edit, duplicate and follow a quote through its lifecycle. */
function PaginaEditorPresupuesto({ obtenerCliente = obtenerClienteSupabase, cargarProductos = getProductos, guardarPdf }) {
  const { id } = useParams();
  const [busqueda] = useSearchParams();
  const duplicarDe = busqueda.get("duplicar");
  const navigate = useNavigate();
  const confirmar = useConfirmar();

  const [sb, setSb] = useState(null);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState(null);
  const [registro, setRegistro] = useState(null);
  const [productos, setProductos] = useState([]);
  const [empresa, setEmpresa] = useState(null);
  const [activos, setActivos] = useState(null);
  const [parametros, setParametros] = useState(null);
  const [formulario, setFormulario] = useState(() => formularioVacio(null));
  const [documento, setDocumento] = useState(() => datosDocumentoIniciales(null));
  const [cliente, setCliente] = useState(null);
  const [sucio, setSucio] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const cargar = useCallback(async () => {
    setCargado(false);
    setError(null);
    try {
      const cliente = await obtenerCliente();
      setSb(cliente);
      const [a, prods, emp] = await Promise.all([cargarParametrosActivos(cliente, "serigrafia"), cargarProductos(), cargarEmpresa(cliente)]);
      setActivos(a);
      setProductos(prods);
      setEmpresa(emp);
      if (id) {
        const p = await obtenerPresupuesto(cliente, Number(id));
        const e = estadoDesdeRegistro(p);
        setRegistro(p);
        setFormulario(e.formulario);
        setDocumento(e.documento);
        setCliente(e.cliente);
        setParametros(e.parametrosVersion ? await cargarVersionParametros(cliente, "serigrafia", e.parametrosVersion) : a);
      } else {
        setRegistro(null);
        setParametros(a);
        if (duplicarDe) {
          const e = estadoDuplicado(await obtenerPresupuesto(cliente, Number(duplicarDe)), emp);
          setFormulario(e.formulario);
          setDocumento(e.documento);
          setCliente(e.cliente);
          setMensaje({ tipo: "info", texto: "Copia de un presupuesto: revisa los datos y guárdala. Se recalcula con los precios actuales del catálogo y los parámetros vigentes." });
        } else {
          setFormulario(formularioVacio(a?.valores));
          setDocumento(datosDocumentoIniciales(emp));
          setCliente(null);
        }
      }
      setSucio(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargado(true);
    }
  }, [id, duplicarDe, obtenerCliente, cargarProductos]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!sucio) return undefined;
    const aviso = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sucio]);

  const calculo = useCalculoSerigrafia(formulario, productos, parametros?.valores);
  const estado = registro?.estado ?? "borrador";
  const editable = esEditable(estado);
  const comprobacion = useMemo(
    () => (registro?.resultado && parametros && registro.parametros_version === parametros.version ? reproducir(registro, parametros.valores) : null),
    [registro, parametros]
  );

  const modificar = (actualizar) => (valor) => {
    actualizar(valor);
    setSucio(true);
    setMensaje(null);
  };
  const cambiarFormulario = modificar(setFormulario);
  const cambiarDocumento = (campo) => (e) => modificar(setDocumento)((d) => ({ ...d, [campo]: e.target.value }));

  if (!cargado) return <Cargando texto="Cargando presupuesto…" />;
  if (error) {
    return (
      <div className="container mt-4">
        <div className="alert alert-danger" role="alert">{error}</div>
        <Link to="/presupuestos">← Volver a presupuestos</Link>
      </div>
    );
  }
  if (!activos && !parametros) {
    return (
      <div className="container mt-4">
        <div className="alert alert-warning" role="alert">Todavía no hay parámetros de cálculo. Créalos en <Link to="/configuracion/parametros">Parámetros</Link>.</div>
      </div>
    );
  }
  if (estado === "importado") {
    return (
      <div className="container mt-4">
        <h2>Presupuesto importado</h2>
        <p>{registro.cliente_nombre} · {registro.fecha_emision} · {euros(Number(registro.total_cent))}</p>
        <div className="alert alert-secondary">Viene del historial antiguo del navegador: se conserva tal cual, solo para consulta.</div>
        <pre className="small bg-light border rounded p-2">{JSON.stringify(registro.entrada?.original, null, 2)}</pre>
        <Link to="/presupuestos">← Volver a presupuestos</Link>
      </div>
    );
  }

  const datosParaGuardar = () =>
    construirRegistro({
      cliente,
      formulario,
      calculo: calculo.resultado ? { entrada: calculo.entrada, detalle: calculo.detalle, resultado: calculo.resultado } : null,
      parametrosVersion: parametros?.version,
      documento,
    });

  const guardar = async ({ navegar = true } = {}) => {
    if (requierePrecioFinal(estado) && !(calculo.resultado?.precio.finalCent > 0)) {
      setMensaje({ tipo: "danger", texto: "Un presupuesto presentado necesita un cálculo completo y un precio final." });
      return null;
    }
    setOcupado(true);
    try {
      const datos = datosParaGuardar();
      const guardado = registro ? await actualizarPresupuesto(sb, registro.id, datos) : await crearPresupuesto(sb, datos);
      setRegistro(guardado);
      setSucio(false);
      setMensaje({ tipo: "success", texto: "Presupuesto guardado." });
      if (!registro && navegar) navigate(`/presupuestos/${guardado.id}`, { replace: true });
      return guardado;
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      return null;
    } finally {
      setOcupado(false);
    }
  };

  const avanzar = async (hasta) => {
    const problemas = [];
    if (requierePrecioFinal(hasta)) {
      if (!cliente?.nombre) problemas.push("elige un cliente");
      if (!calculo.resultado) problemas.push("completa el cálculo");
      if (!(calculo.resultado?.precio.finalCent > 0)) problemas.push("indica el precio final");
    }
    if (problemas.length) {
      setMensaje({ tipo: "danger", texto: `Antes de continuar: ${problemas.join(", ")}.` });
      return;
    }
    if (hasta === "cancelado" && !(await confirmar({
      titulo: "¿Cancelar este presupuesto?",
      mensaje: "Se conservará en el historial, pero no se podrá reactivar. Si lo necesitas más adelante, podrás duplicarlo.",
      aceptar: "Cancelar presupuesto",
      cancelar: "Volver",
      peligro: true,
    }))) return;
    let actual = registro;
    if (!actual || (sucio && editable)) actual = await guardar({ navegar: false });
    if (!actual) return;
    setOcupado(true);
    try {
      const nuevo = await cambiarEstado(sb, actual.id, hasta);
      setRegistro(nuevo);
      setMensaje({
        tipo: "success",
        texto: hasta === "presentado" && !actual.numero ? `Presupuesto presentado con el número ${nuevo.numero}.` : `Estado actualizado: ${ESTADOS[hasta].etiqueta}.`,
      });
      if (!registro) navigate(`/presupuestos/${nuevo.id}`, { replace: true });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    } finally {
      setOcupado(false);
    }
  };

  const pdf = async () => {
    if (sucio) {
      setMensaje({ tipo: "warning", texto: "Guarda los cambios antes de generar el PDF." });
      return;
    }
    try {
      const nombre = await descargarPdfPresupuesto(sb, registro, empresa, guardarPdf);
      setMensaje({ tipo: "success", texto: `PDF generado: ${nombre}` });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  };

  const usarParametrosVigentes = () => {
    setParametros(activos);
    setSucio(true);
  };
  const usarPreciosActuales = () =>
    cambiarFormulario((f) => ({ ...f, lineas: f.lineas.map(sinPrecioGuardado) }));

  const mostrarAvisos = formulario.lineas.some((l) => l.quantity !== "" || l.proveedor !== "" || l.precioManual !== "");
  const titulo = registro?.numero ? `Presupuesto ${registro.numero}` : registro ? "Presupuesto (borrador)" : "Nuevo presupuesto";

  return (
    <>
      <Link to="/presupuestos" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Presupuestos</Link>
      <div className="gx-cabecera">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <h1 className="me-1">{titulo}</h1>
          <InsigniaEstado estado={estado} />
          {registro?.version > 1 && <span className="gx-insignia gx-estado-importado">revisión {registro.version}</span>}
          {sucio && <span className="gx-insignia gx-estado-en_produccion">Cambios sin guardar</span>}
        </div>
        <div className="gx-cabecera-acciones">
          {editable && (
            <button type="button" className="btn btn-primary" onClick={guardar} disabled={ocupado || (!sucio && registro)}>
              {registro ? "Guardar cambios" : "Guardar borrador"}
            </button>
          )}
          {registro && (
            <button type="button" className="btn btn-outline-dark" onClick={pdf} disabled={ocupado || estado === "cancelado"}>Descargar PDF</button>
          )}
          {registro && <Link className="btn btn-outline-secondary" to={`/presupuestos/nuevo?duplicar=${registro.id}`}>Duplicar</Link>}
        </div>
      </div>

      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}

      {(registro || estado === "borrador") && accionesDesde(estado).length > 0 && (
        <div className="d-flex flex-wrap gap-2 mb-3" aria-label="Cambiar estado">
          {accionesDesde(estado).map((a) => (
            <button key={a.hasta} type="button" disabled={ocupado}
              className={`btn btn-sm ${a.tipo === "avance" ? "btn-success" : a.tipo === "peligro" ? "btn-outline-danger" : "btn-outline-secondary"}`}
              onClick={() => avanzar(a.hasta)}>
              {a.etiqueta}
            </button>
          ))}
        </div>
      )}
      {!editable && <div className="alert alert-light border small py-2">Este presupuesto está <strong>{ESTADOS[estado].etiqueta.toLowerCase()}</strong>: su contenido ya no se puede modificar (las notas internas sí). Para un cambio, duplícalo.</div>}

      <div className="row g-4">
      <div className="col-xl-8">
      <section className="card mb-3">
        <div className="card-body">
          <h4 className="h5">Cliente</h4>
          <SelectorCliente sb={sb} cliente={cliente} soloLectura={!editable} onSeleccionar={modificar(setCliente)} />
        </div>
      </section>

      <section className="card mb-3">
        <div className="card-body">
          <h4 className="h5">Trabajo</h4>
          {parametros && activos && parametros.version !== activos.version && (
            <div className="alert alert-info small py-2 d-flex flex-wrap align-items-center gap-2">
              <span>Calculado con la versión {parametros.version} de los parámetros (la vigente es la {activos.version}).</span>
              {editable && <button type="button" className="btn btn-sm btn-outline-primary" onClick={usarParametrosVigentes}>Recalcular con la versión vigente</button>}
            </div>
          )}
          {calculo.preciosCambiados.length > 0 && (
            <div className="alert alert-warning small py-2" role="note">
              Han cambiado precios del catálogo desde que se guardó:{" "}
              {calculo.preciosCambiados.map((c) => `línea ${c.linea}: ${eurosDecimal(c.guardado)} → ${eurosDecimal(c.actual)}`).join("; ")}. Se mantiene el precio guardado.
              {editable && <button type="button" className="btn btn-sm btn-outline-dark ms-2" onClick={usarPreciosActuales}>Usar los precios actuales</button>}
            </div>
          )}
          <FormularioTrabajo formulario={formulario} onChange={cambiarFormulario} productos={productos} detalle={calculo.detalle}
            soloLectura={!editable} conDescripcion etiquetaPrecioFinal="Precio final para el cliente (€)"
            recomendadoCent={calculo.resultado?.precio.recomendadoCent ?? null} />
          {mostrarAvisos && (calculo.problemas.length > 0 || calculo.erroresEntrada.length > 0) && (
            <div className="alert alert-warning small" role="alert">
              <ul className="mb-0">{[...new Set([...calculo.problemas, ...calculo.erroresEntrada])].map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {calculo.resultado && <DesgloseCostes resultado={calculo.resultado} />}
          {comprobacion && !sucio && (
            <p className={`small ${comprobacion.coincide ? "text-success" : "text-danger"}`} data-testid="comprobacion">
              {comprobacion.coincide
                ? "✓ Cálculo verificado: recalcular con su versión de parámetros da exactamente el resultado guardado."
                : comprobacion.reproducible
                  ? `El resultado guardado no coincide con el recálculo: ${comprobacion.diferencias.join("; ")}.`
                  : comprobacion.motivo}
            </p>
          )}
        </div>
      </section>

      <section className="card mb-3">
        <div className="card-body">
          <h4 className="h5">Documento para el cliente</h4>
          <fieldset disabled={!editable} className="row g-2">
            <div className="col-md-3">
              <label className="form-label small mb-0" htmlFor="idioma">Idioma del PDF</label>
              <select id="idioma" className="form-select form-select-sm" value={documento.idioma} onChange={cambiarDocumento("idioma")}>
                {Object.entries(IDIOMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label small mb-0" htmlFor="fechaEmision">Fecha</label>
              <input id="fechaEmision" type="date" className="form-control form-control-sm" value={documento.fechaEmision} onChange={cambiarDocumento("fechaEmision")} />
            </div>
            <div className="col-md-3">
              <label className="form-label small mb-0" htmlFor="validoHasta">Válido hasta (opcional)</label>
              <input id="validoHasta" type="date" className="form-control form-control-sm" value={documento.validoHasta} onChange={cambiarDocumento("validoHasta")} />
            </div>
            <div className="col-12">
              <label className="form-label small mb-0" htmlFor="observaciones">Observaciones (aparecen en el PDF)</label>
              <textarea id="observaciones" rows={2} className="form-control form-control-sm" value={documento.observaciones} onChange={cambiarDocumento("observaciones")} />
            </div>
            <div className="col-12">
              <label className="form-label small mb-0" htmlFor="condiciones">Condiciones comerciales (una por línea, aparecen en el PDF)</label>
              <textarea id="condiciones" rows={4} className="form-control form-control-sm" value={documento.condiciones} onChange={cambiarDocumento("condiciones")} />
              {empresa?.condiciones?.[documento.idioma] && (
                <button type="button" className="btn btn-link btn-sm p-0"
                  onClick={() => modificar(setDocumento)((d) => ({ ...d, condiciones: empresa.condiciones[d.idioma].join("\n") }))}>
                  Poner las condiciones por defecto en {IDIOMAS[documento.idioma].toLowerCase()}
                </button>
              )}
            </div>
          </fieldset>
          <div className="form-text">El PDF muestra los productos, las cantidades y el total. Nunca incluye costes, márgenes, beneficios ni notas internas.</div>
        </div>
      </section>

      <section className="card mb-3">
        <div className="card-body">
          <label className="form-label h5" htmlFor="notas">Notas internas</label>
          <textarea id="notas" rows={2} className="form-control form-control-sm" value={documento.notas} onChange={cambiarDocumento("notas")} />
          {!editable && registro && (
            <button type="button" className="btn btn-sm btn-outline-primary mt-2" disabled={ocupado || !sucio}
              onClick={async () => {
                try {
                  setRegistro(await actualizarPresupuesto(sb, registro.id, { notas: documento.notas.trim() || null }));
                  setSucio(false);
                  setMensaje({ tipo: "success", texto: "Notas guardadas." });
                } catch (e) {
                  setMensaje({ tipo: "danger", texto: e.message });
                }
              }}>
              Guardar notas
            </button>
          )}
        </div>
      </section>

      {registro && (
        <section className="mb-4 small text-muted">
          <div>Creado {fechaHora(registro.creado_en)} · modificado {fechaHora(registro.actualizado_en)} · motor {registro.motor}{registro.parametros_version ? ` · parámetros v${registro.parametros_version}` : ""}</div>
          {registro.historial_estados?.length > 0 && (
            <div>Historial: {registro.historial_estados.map((h) => `${ESTADOS[h.estado]?.etiqueta ?? h.estado} (${fechaHora(h.en)})`).join(" → ")}</div>
          )}
        </section>
      )}
      </div>
      <div className="col-xl-4">
        <ResumenCalculo resultado={calculo.resultado} parametrosVersion={parametros?.version} />
      </div>
      </div>
    </>
  );
}

export default PaginaEditorPresupuesto;
