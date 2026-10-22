import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Copy, ExternalLink } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import { euros, eurosDecimal } from "../../shared/utils/dinero";
import { InsigniaCompra } from "./InsigniaCompra";
import PanelRecepcion from "./PanelRecepcion";
import PanelAnadirPrenda from "./PanelAnadirPrenda";
import { agruparLineas, avisoCaja, siguientePasoCompra, textoParaProveedor, urlWebSegura, fechaCorta, EN_CAMINO } from "./domain/compras";
import {
  obtenerCompra, listarPedidosPorComprar, prepararCompra, guardarLineas, marcarPedida, actualizarCompra, volverABorrador, descartarBorrador, cancelarCompra, cerrarPendiente,
} from "./data/comprasRepo";

const fechaHora = (iso) => new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
const prendas = (n) => `${n} ${n === 1 ? "prenda" : "prendas"}`;
const precioLinea = (l) => (l.precio_neto === null ? "—" : `${eurosDecimal(Number(l.precio_neto))}${l.iva_porcentaje === null ? " IVA incl." : " + IVA"}`);

/** One purchase: buy on the supplier's website, mark it as ordered, register what arrives. */
function PaginaCompra({ obtenerCliente = obtenerClienteSupabase }) {
  const { id } = useParams();
  const compraId = Number(id);
  const confirmar = useConfirmar();
  const [datos, setDatos] = useState(null);
  const [pedidos, setPedidos] = useState([]); // orders behind each variant still to buy (drafts)
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [edicion, setEdicion] = useState({}); // { [variante_id]: { para_pedidos, reposicion } } typed in a draft
  const [referencia, setReferencia] = useState("");
  const [recibiendo, setRecibiendo] = useState(false);
  const [anadiendo, setAnadiendo] = useState(false);
  const [mas, setMas] = useState(false);
  const [motivo, setMotivo] = useState(null); // { accion: "cancelar" | "cerrar" | "referencia", texto }
  const [texto, setTexto] = useState(null); // list shown when the clipboard is not available

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const d = await obtenerCompra(sb, compraId);
      setDatos(d);
      setEdicion({});
      if (d.compra.estado === "borrador") setPedidos(await listarPedidosPorComprar(sb).catch(() => []));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  }, [obtenerCliente, compraId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const ejecutar = async (accion, textoOk) => {
    setOcupado(true);
    setMensaje(null);
    try {
      await accion(await obtenerCliente());
      if (textoOk) setMensaje({ tipo: "success", texto: textoOk });
      setMotivo(null);
      setMas(false);
      await cargar();
      return true;
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      return false;
    } finally {
      setOcupado(false);
    }
  };

  if (!datos) return mensaje ? <Aviso tipo="danger">{mensaje.texto}</Aviso> : <Cargando texto="Cargando compra…" />;
  const { compra: c, lineas, eventos } = datos;
  const borrador = c.estado === "borrador";
  const enCamino = EN_CAMINO.has(c.situacion);
  const web = urlWebSegura(c.proveedor_web);
  const grupos = agruparLineas(lineas);
  const valor = (l, campo) => edicion[l.variante_id]?.[campo] ?? String(l[campo]);
  const cambios = Object.entries(edicion).map(([variante, v]) => {
    const l = lineas.find((x) => x.variante_id === Number(variante));
    return { variante_id: Number(variante), para_pedidos: Number(v.para_pedidos ?? l.para_pedidos), reposicion: Number(v.reposicion ?? l.reposicion) };
  });
  const cambiosValidos = cambios.every((x) => Number.isInteger(x.para_pedidos) && x.para_pedidos >= 0 && Number.isInteger(x.reposicion) && x.reposicion >= 0);
  const sinGuardar = cambios.length > 0;
  const editar = (l, campo, v) => setEdicion({ ...edicion, [l.variante_id]: { ...edicion[l.variante_id], [campo]: v } });
  const unidadesVista = lineas.reduce((s, l) => s + Number(valor(l, "para_pedidos") || 0) + Number(valor(l, "reposicion") || 0), 0);

  const guardar = () => ejecutar((sb) => guardarLineas(sb, c.id, cambios), "Cambios guardados.");
  const pedida = () =>
    ejecutar(async (sb) => {
      if (sinGuardar) await guardarLineas(sb, c.id, cambios);
      await marcarPedida(sb, c.id, referencia.trim());
    }, "Compra marcada como pedida. Cuando llegue, pulsa «Registrar llegada».");
  const copiar = async () => {
    const t = textoParaProveedor(c, lineas.map((l) => ({ ...l, cantidad: Number(valor(l, "para_pedidos") || 0) + Number(valor(l, "reposicion") || 0) })));
    try {
      await navigator.clipboard.writeText(t);
      setMensaje({ tipo: "success", texto: "Lista copiada: pégala donde quieras o tenla a mano al comprar en la web." });
    } catch {
      setTexto(t);
    }
  };
  const descartar = async () => {
    if (!(await confirmar({ titulo: `¿Descartar el borrador ${c.numero}?`, mensaje: "No se compra nada. Las prendas vuelven a «Por comprar».", aceptar: "Descartar", peligro: true }))) return;
    await ejecutar((sb) => descartarBorrador(sb, c.id), "Borrador descartado.");
  };
  const enviarMotivo = (e) => {
    e.preventDefault();
    const t = motivo.texto.trim();
    if (motivo.accion === "cancelar") ejecutar((sb) => cancelarCompra(sb, c.id, t), "Compra cancelada. Sus prendas vuelven a «Por comprar».");
    else if (motivo.accion === "cerrar") ejecutar((sb) => cerrarPendiente(sb, c.id, t), "Lo pendiente queda cerrado y vuelve a «Por comprar».");
    else ejecutar((sb) => actualizarCompra(sb, c.id, { referencia_proveedor: t }), "Referencia guardada.");
  };

  const otras = [];
  if (borrador) {
    otras.push({ texto: "Actualizar con los pedidos", accion: () => ejecutar((sb) => prepararCompra(sb, c.proveedor_id), "Borrador actualizado con lo que hay por comprar.") });
    otras.push({ texto: "Descartar el borrador", accion: descartar, peligro: true });
  } else if (enCamino) {
    otras.push({ texto: c.referencia_proveedor ? "Cambiar la referencia del proveedor" : "Añadir la referencia del proveedor", accion: () => setMotivo({ accion: "referencia", texto: c.referencia_proveedor ?? "" }) });
    if (c.recibidas === 0 && c.cerradas === 0) otras.push({ texto: "Volver a borrador", accion: () => ejecutar((sb) => volverABorrador(sb, c.id), "La compra vuelve a ser un borrador.") });
    if (c.recibidas === 0) otras.push({ texto: "Cancelar la compra", accion: () => setMotivo({ accion: "cancelar", texto: "" }), peligro: true });
    else otras.push({ texto: "Dar por cerrado lo pendiente", accion: () => setMotivo({ accion: "cerrar", texto: "" }), peligro: true });
  }

  return (
    <>
      <Link to="/compras" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Compras</Link>
      <div className="gx-cabecera">
        <div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <h1 className="me-1">Compra {c.numero}</h1>
            <InsigniaCompra situacion={c.situacion} />
          </div>
          <p className="mb-0">
            {c.proveedor}
            {c.referencia_proveedor && <> · ref. {c.referencia_proveedor}</>}
            {c.fecha_pedido && <> · pedida el {fechaCorta(c.fecha_pedido)}</>}
          </p>
        </div>
      </div>
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {siguientePasoCompra(c) && <Aviso tipo="info"><strong>Siguiente paso:</strong> {siguientePasoCompra(c)}</Aviso>}
      {c.situacion === "cancelada" && c.motivo_cancelacion && <Aviso tipo="secondary">Cancelada: {c.motivo_cancelacion}</Aviso>}

      <div className="d-flex flex-wrap align-items-end gap-2 mb-3" aria-label="Acciones de la compra">
        {borrador && lineas.length > 0 && (
          <>
            <div>
              <label className="form-label small mb-0" htmlFor="ref-proveedor">Nº de pedido en la web (opcional)</label>
              <input id="ref-proveedor" className="form-control form-control-sm" style={{ maxWidth: "14rem" }} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
            </div>
            <button type="button" className="btn btn-success" disabled={ocupado || !cambiosValidos} onClick={pedida}>Marcar como pedida</button>
          </>
        )}
        {enCamino && !recibiendo && <button type="button" className="btn btn-success" disabled={ocupado} onClick={() => setRecibiendo(true)}>Registrar llegada</button>}
        {web && (borrador || enCamino) && (
          <a className="btn btn-outline-secondary btn-icono" href={web} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden="true" />Web de {c.proveedor}</a>
        )}
        {lineas.length > 0 && (borrador || enCamino) && (
          <button type="button" className="btn btn-outline-secondary btn-icono" onClick={copiar}><Copy size={16} aria-hidden="true" />Copiar lista</button>
        )}
        {otras.length > 0 && <button type="button" className="btn btn-link btn-sm" aria-expanded={mas} onClick={() => setMas(!mas)}>{mas ? "Menos opciones" : "Más opciones"}</button>}
      </div>
      {mas && (
        <div className="d-flex flex-wrap gap-2 mb-3" aria-label="Más opciones">
          {otras.map((o) => <button key={o.texto} type="button" className={`btn btn-sm ${o.peligro ? "btn-outline-danger" : "btn-outline-secondary"}`} disabled={ocupado} onClick={o.accion}>{o.texto}</button>)}
        </div>
      )}
      {texto && (
        <div className="mb-3">
          <label className="form-label small" htmlFor="texto-lista">Lista para el proveedor (selecciónala y cópiala):</label>
          <textarea id="texto-lista" className="form-control form-control-sm" rows={Math.min(10, texto.split("\n").length)} readOnly value={texto} />
        </div>
      )}
      {motivo && (
        <form className={`border rounded p-3 mb-3 ${motivo.accion === "referencia" ? "" : "border-danger"}`} aria-label="Motivo" onSubmit={enviarMotivo}>
          <label className="form-label small" htmlFor="motivo">
            {motivo.accion === "cancelar" ? "¿Por qué se cancela? No ha llegado nada: sus prendas vuelven a «Por comprar»."
              : motivo.accion === "cerrar" ? "¿Por qué no llegará lo pendiente? Esas prendas vuelven a «Por comprar»; lo ya recibido no cambia."
                : "Referencia o número de pedido en la web del proveedor"}
          </label>
          <input id="motivo" className="form-control form-control-sm mb-2" value={motivo.texto} onChange={(e) => setMotivo({ ...motivo, texto: e.target.value })} />
          <div className="d-flex gap-2">
            <button type="submit" className={`btn btn-sm ${motivo.accion === "referencia" ? "btn-primary" : "btn-danger"}`} disabled={ocupado || (motivo.accion !== "referencia" && !motivo.texto.trim())}>
              {motivo.accion === "cancelar" ? "Cancelar la compra" : motivo.accion === "cerrar" ? "Cerrar lo pendiente" : "Guardar"}
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setMotivo(null)}>Volver</button>
          </div>
        </form>
      )}
      {recibiendo && (
        <PanelRecepcion compra={c} lineas={lineas} obtenerCliente={obtenerCliente} onCancelar={() => setRecibiendo(false)}
          onHecho={async (r) => {
            setRecibiendo(false);
            const reservadas = (r.reservas ?? []).reduce((s, x) => s + x.cantidad, 0);
            setMensaje({ tipo: "success", texto: `Llegada registrada: ${prendas(r.unidades)} en el almacén${reservadas ? `, ${reservadas} reservadas para los pedidos` : ""}.` });
            await cargar();
          }} />
      )}

      <div className="row g-4">
        <div className="col-xl-8">
          <section className="card mb-3" aria-labelledby="t-prendas">
            <div className="card-body">
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                <h2 id="t-prendas" className="h5 mb-0">Prendas</h2>
                {borrador && sinGuardar && <button type="button" className="btn btn-outline-primary btn-sm" disabled={ocupado || !cambiosValidos} onClick={guardar}>Guardar cambios</button>}
              </div>
              {!cambiosValidos && <p className="small text-danger">Escribe cantidades enteras, sin negativos.</p>}
              {lineas.length === 0 ? (
                <p className="small text-muted">Esta compra todavía no tiene prendas.</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      {borrador ? (
                        <tr><th>Talla</th><th className="gx-num">Para pedidos</th><th className="gx-num">Para el almacén</th><th className="gx-num">Total</th><th className="text-end d-none d-md-table-cell">Precio</th></tr>
                      ) : (
                        <tr><th>Talla</th><th className="gx-num">Pedidas</th><th className="gx-num">Llegadas</th><th className="gx-num">Pendientes</th><th className="text-end d-none d-md-table-cell">Precio</th></tr>
                      )}
                    </thead>
                    <tbody>
                      {grupos.map((g) => [
                        <tr key={g.clave} className="table-light"><th colSpan={5}>{[g.referencia, g.modelo, g.color].filter(Boolean).join(" · ")}</th></tr>,
                        ...g.lineas.map((l) => {
                          const total = Number(valor(l, "para_pedidos") || 0) + Number(valor(l, "reposicion") || 0);
                          const aviso = avisoCaja({ ...l, cantidad: total });
                          const para = pedidos.filter((p) => p.variante_id === l.variante_id && p.pendiente_comprar > 0);
                          return (
                            <tr key={l.id}>
                              <td>
                                {l.talla}
                                {borrador && l.para_pedidos > 0 && para.length > 0 && <div className="small text-muted">Para {para.map((p) => `${p.numero} (${p.pendiente_comprar})`).join(", ")}</div>}
                                {aviso && <div className="small text-warning-emphasis">{aviso}</div>}
                              </td>
                              {borrador ? (
                                <>
                                  <td className="gx-num">
                                    <input aria-label={`Para pedidos, talla ${l.talla} de ${g.modelo} ${g.color}`} inputMode="numeric" className="form-control form-control-sm mx-auto text-center" style={{ maxWidth: "5rem" }}
                                      value={valor(l, "para_pedidos")} onChange={(e) => editar(l, "para_pedidos", e.target.value)} />
                                  </td>
                                  <td className="gx-num">
                                    <input aria-label={`Para el almacén, talla ${l.talla} de ${g.modelo} ${g.color}`} inputMode="numeric" className="form-control form-control-sm mx-auto text-center" style={{ maxWidth: "5rem" }}
                                      value={valor(l, "reposicion")} onChange={(e) => editar(l, "reposicion", e.target.value)} />
                                  </td>
                                  <td className="gx-num fw-semibold">{total}</td>
                                </>
                              ) : (
                                <>
                                  <td className="gx-num">{l.cantidad}</td>
                                  <td className="gx-num">{l.recibido}</td>
                                  <td className={`gx-num ${l.pendiente > 0 ? "fw-semibold" : ""}`}>{l.pendiente}{l.cerrada > 0 && <div className="small text-muted">{l.cerrada} no llegarán</div>}</td>
                                </>
                              )}
                              <td className="text-end small text-nowrap d-none d-md-table-cell">{precioLinea(l)}</td>
                            </tr>
                          );
                        }),
                      ])}
                    </tbody>
                  </table>
                </div>
              )}
              {borrador && !anadiendo && <button type="button" className="btn btn-outline-secondary btn-sm mt-3" onClick={() => setAnadiendo(true)}>Añadir prenda</button>}
              {borrador && anadiendo && (
                <PanelAnadirPrenda proveedorId={c.proveedor_id} lineas={lineas} obtenerCliente={obtenerCliente} ocupado={ocupado} onCancelar={() => setAnadiendo(false)}
                  onAnadir={async (nuevas) => {
                    if (await ejecutar((sb) => guardarLineas(sb, c.id, nuevas), "Prendas añadidas a la compra.")) setAnadiendo(false);
                  }} />
              )}
            </div>
          </section>

          <section className="card mb-3" aria-labelledby="t-historial">
            <div className="card-body">
              <h2 id="t-historial" className="h5">Historial</h2>
              <ul className="list-unstyled small mb-0">
                {eventos.map((e) => <li key={e.id} className="py-1 border-bottom"><span className="text-muted">{fechaHora(e.creado_en)}</span> · {e.descripcion}</li>)}
              </ul>
            </div>
          </section>
        </div>

        <div className="col-xl-4">
          <section className="card mb-3" aria-labelledby="t-importe">
            <div className="card-body">
              <h2 id="t-importe" className="h5">Importe</h2>
              <p className="mb-2"><strong>{prendas(borrador ? unidadesVista : c.unidades)}</strong>{!borrador && c.recibidas > 0 && <span className="text-muted small"> · {c.recibidas} llegadas</span>}</p>
              <dl className="small mb-0">
                <div className="gx-fila-dato"><span>Previsto sin IVA</span><strong>{euros(Number(c.base_prevista_cent))}</strong></div>
                <div className="gx-fila-dato"><span>IVA</span><strong>{euros(Number(c.iva_previsto_cent))}</strong></div>
                <div className="gx-fila-dato"><span>Total previsto</span><strong>{euros(Number(c.total_previsto_cent))}</strong></div>
                {c.recepciones > 0 && (
                  <>
                    <div className="gx-fila-dato mt-2"><span>Real recibido sin IVA</span><strong>{euros(Number(c.base_real_cent))}</strong></div>
                    <div className="gx-fila-dato"><span>IVA</span><strong>{euros(Number(c.iva_real_cent))}</strong></div>
                    <div className="gx-fila-dato"><span>Total real recibido</span><strong>{euros(Number(c.total_real_cent))}</strong></div>
                  </>
                )}
              </dl>
              {borrador && sinGuardar && <p className="small text-muted mt-2 mb-0">El importe se actualiza al guardar los cambios.</p>}
              {c.sin_precio && <p className="small text-muted mt-2 mb-0">Alguna prenda no tiene precio en el catálogo: no cuenta en el importe previsto.</p>}
              <p className="small text-muted mt-2 mb-0">Precios del catálogo al preparar la compra. El precio real se anota al registrar la llegada; el catálogo y los presupuestos no cambian.</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default PaginaCompra;
