import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import { euros, eurosDecimal, leerNumero } from "../../shared/utils/dinero";
import { InsigniaPedido, InsigniaCobro } from "./Insignias";
import { ESTADOS_PEDIDO, accionesPedido, propuestaReserva, siguientePaso } from "./domain/pedidos";
import {
  obtenerPedido, actualizarPedido, cambiarEstadoPedido, registrarCobro, reservarPrendas, liberarPrendas, consumirPrendas, devolverPrendas, estadoNecesidad,
} from "./data/pedidosRepo";

const fechaHora = (iso) => new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
const dia = (f) => (f ? String(f).slice(0, 10) : "");
const TIPOS_MOVIMIENTO = { salida: "Usadas en el pedido", merma: "Estropeadas (merma)", devolucion: "Devueltas al almacén" };

/** One order: next step, material, production records, dates, payment and history. */
function PaginaPedido({ obtenerCliente = obtenerClienteSupabase }) {
  const { id } = useParams();
  const pedidoId = Number(id);
  const confirmar = useConfirmar();
  const [datos, setDatos] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [propuesta, setPropuesta] = useState(null); // [{ variante_id, descripcion, falta, disponible, cantidad }]
  const [registrarFaltantes, setRegistrarFaltantes] = useState(true);
  const [movimiento, setMovimiento] = useState(null); // { variante_id, tipo, cantidad, motivo, libres }
  const [mas, setMas] = useState(false);
  const [edicion, setEdicion] = useState(null); // { fecha_entrega, fecha_inicio_prevista, instrucciones, notas_internas }
  const [cobro, setCobro] = useState("");
  const [cancelando, setCancelando] = useState(null); // reason being typed

  const cargar = useCallback(async () => {
    try {
      const d = await obtenerPedido(await obtenerCliente(), pedidoId);
      setDatos(d);
      setCobro(String((d.pedido.importe_cobrado_cent ?? 0) / 100).replace(".", ","));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  }, [obtenerCliente, pedidoId]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const ejecutar = async (accion, texto) => {
    setOcupado(true);
    setMensaje(null);
    try {
      await accion(await obtenerCliente());
      setMensaje({ tipo: "success", texto });
      setPropuesta(null);
      setMovimiento(null);
      await cargar();
      return true;
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      return false;
    } finally {
      setOcupado(false);
    }
  };

  if (!datos) return mensaje ? <Aviso tipo="danger">{mensaje.texto}</Aviso> : <Cargando texto="Cargando pedido…" />;
  const { pedido: p, lineas, eventos, material } = datos;
  const cerrado = p.estado === "cancelado" || p.estado === "entregado";
  const acciones = accionesPedido(p.estado);
  const avance = acciones.filter((a) => a.tipo === "avance");
  const otras = acciones.filter((a) => a.tipo !== "avance");
  const sinCatalogo = lineas.filter((l) => !l.variante_id);
  const reservable = propuestaReserva(material);

  const cambiarEstado = async (a) => {
    if (a.hasta === "cancelado") return setCancelando("");
    if (!(await confirmar({ titulo: `¿${a.etiqueta}?`, mensaje: `El pedido pasará a «${ESTADOS_PEDIDO[a.hasta].etiqueta}».`, aceptar: a.etiqueta }))) return;
    await ejecutar((sb) => cambiarEstadoPedido(sb, p.id, a.hasta), `Estado: ${ESTADOS_PEDIDO[a.hasta].etiqueta}.`);
  };

  const confirmarReserva = async () => {
    const lineasReserva = propuesta.filter((x) => x.cantidad > 0).map(({ variante_id, cantidad }) => ({ variante_id, cantidad }));
    const total = lineasReserva.reduce((s, x) => s + x.cantidad, 0);
    const faltan = propuesta.reduce((s, x) => s + x.falta - x.cantidad, 0);
    if (!(await confirmar({
      titulo: `¿Reservar ${total} prendas para ${p.numero}?`,
      mensaje: `Quedan apartadas para este pedido (no salen todavía del almacén).${registrarFaltantes && faltan > 0 ? ` Las ${faltan} que faltan quedan anotadas como compra pendiente.` : ""}`,
      aceptar: "Reservar",
    }))) return;
    await ejecutar((sb) => reservarPrendas(sb, p.id, lineasReserva, registrarFaltantes), `${total} prendas reservadas.`);
  };

  const guardarMovimiento = async () => {
    const m = movimiento;
    const cantidad = Number(m.cantidad);
    const fila = material.find((x) => x.variante_id === Number(m.variante_id));
    const ok = await confirmar({
      titulo: `¿Anotar ${cantidad} ${TIPOS_MOVIMIENTO[m.tipo].toLowerCase()}?`,
      mensaje: `${fila ? `${fila.modelo} · ${fila.color} ${fila.talla}. ` : ""}${m.tipo === "devolucion" ? "Vuelven a contar como existencias." : "Salen del almacén."}`,
      aceptar: "Anotar",
    });
    if (!ok) return;
    await ejecutar(
      (sb) => (m.tipo === "devolucion" ? devolverPrendas(sb, p.id, Number(m.variante_id), cantidad, m.motivo) : consumirPrendas(sb, p.id, Number(m.variante_id), cantidad, m.tipo, m.motivo, m.libres)),
      "Anotado."
    );
  };

  return (
    <>
      <Link to="/pedidos" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Pedidos</Link>
      <div className="gx-cabecera">
        <div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            <h1 className="me-1">Pedido {p.numero}</h1>
            <InsigniaPedido estado={p.estado} />
            <InsigniaCobro estado={p.cobro_estado} />
          </div>
          <p className="mb-0">
            {p.cliente_nombre}
            {p.presupuesto_id && <> · <Link to={`/presupuestos/${p.presupuesto_id}`}>presupuesto {p.economico?.presupuesto_numero ?? ""}</Link></>}
            {p.fecha_entrega && <> · entrega {new Date(`${dia(p.fecha_entrega)}T00:00:00`).toLocaleDateString("es-ES")}</>}
          </p>
        </div>
      </div>
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {siguientePaso(p, material) && <Aviso tipo="info"><strong>Siguiente paso:</strong> {siguientePaso(p, material)}</Aviso>}

      <div className="d-flex flex-wrap gap-2 mb-3" aria-label="Cambiar estado">
        {avance.map((a) => <button key={a.hasta} type="button" className="btn btn-success" disabled={ocupado} onClick={() => cambiarEstado(a)}>{a.etiqueta}</button>)}
        {otras.length > 0 && <button type="button" className="btn btn-link btn-sm" aria-expanded={mas} onClick={() => setMas(!mas)}>{mas ? "Menos opciones" : "Más opciones"}</button>}
        {mas && otras.map((a) => (
          <button key={a.hasta} type="button" className={`btn btn-sm ${a.tipo === "peligro" ? "btn-outline-danger" : "btn-outline-secondary"}`} disabled={ocupado} onClick={() => cambiarEstado(a)}>{a.etiqueta}</button>
        ))}
      </div>

      {cancelando !== null && (
        <form className="border border-danger rounded p-3 mb-3" aria-label="Cancelar pedido" onSubmit={async (e) => {
          e.preventDefault();
          if (await ejecutar((sb) => cambiarEstadoPedido(sb, p.id, "cancelado", cancelando), "Pedido cancelado.")) setCancelando(null);
        }}>
          <label className="form-label small" htmlFor="motivo-cancelar">¿Por qué se cancela? Las prendas reservadas volverán a estar disponibles; las ya usadas no cambian.</label>
          <input id="motivo-cancelar" className="form-control form-control-sm mb-2" value={cancelando} onChange={(e) => setCancelando(e.target.value)} />
          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-danger btn-sm" disabled={ocupado || !cancelando.trim()}>Cancelar el pedido</button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setCancelando(null)}>Volver</button>
          </div>
        </form>
      )}

      <div className="row g-4">
        <div className="col-xl-8">
          <section className="card mb-3" aria-labelledby="t-material">
            <div className="card-body">
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                <h2 id="t-material" className="h5 mb-0">Prendas</h2>
                {!cerrado && reservable.length > 0 && !propuesta && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setPropuesta(reservable)}>Reservar prendas</button>
                )}
              </div>
              {material.length === 0 && sinCatalogo.length === 0 && <p className="small text-muted mb-0">Este pedido no tiene prendas.</p>}
              {material.length > 0 && (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead><tr><th className="gx-col-nombre">Prenda</th><th className="gx-num">Necesarias</th><th className="gx-num"><span className="d-none d-sm-inline">Reservadas</span><span className="d-sm-none">Reserv.</span></th><th className="gx-num d-none d-sm-table-cell">Usadas</th><th className="gx-num">Faltan</th><th className="gx-num d-none d-md-table-cell">Libres en almacén</th><th className="d-none d-md-table-cell">Compra</th></tr></thead>
                    <tbody>
                      {material.map((m) => (
                        <tr key={m.variante_id}>
                          <td>{m.modelo} · {m.color} {m.talla}{m.merma > 0 && <div className="small text-muted">{m.merma} estropeadas</div>}</td>
                          <td className="gx-num">{m.necesario}</td>
                          <td className="gx-num">{m.reservado}</td>
                          <td className="gx-num d-none d-sm-table-cell">{m.usado}</td>
                          <td className={`gx-num ${m.falta > 0 ? "fw-semibold text-warning-emphasis" : ""}`}>{m.falta}</td>
                          <td className="gx-num d-none d-md-table-cell">{m.disponible_almacen}</td>
                          <td className="d-none d-md-table-cell small">
                            {m.pendiente_comprar === 0 && m.pendiente_recibir === 0 ? <span className="text-muted">—</span> : (
                              <div className="gx-celda-lista">
                                {m.pendiente_comprar > 0 && <span><strong>{m.pendiente_comprar}</strong> por comprar</span>}
                                {m.pendiente_comprar > 0 && (
                                  <button type="button" className="btn btn-link btn-sm p-0" disabled={ocupado}
                                    onClick={() => ejecutar((sb) => estadoNecesidad(sb, p.id, m.variante_id, "pedida"), "Marcado como pedido al proveedor.")} title="Marcar estas prendas como ya pedidas al proveedor">Ya pedidas</button>
                                )}
                                {m.pendiente_recibir > 0 && <span><strong>{m.pendiente_recibir}</strong> pedidas, sin llegar</span>}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sinCatalogo.length > 0 && (
                <p className="small text-muted mt-2 mb-0">No vinculadas al catálogo (no se pueden reservar): {sinCatalogo.map((l) => `${l.cantidad} × ${l.descripcion}`).join(", ")}.</p>
              )}

              {propuesta && (
                <div className="border rounded p-3 mt-3" role="region" aria-label="Propuesta de reserva">
                  <h3 className="h6">Propuesta de reserva</h3>
                  <p className="small text-muted">Se reserva lo que falta, hasta lo que hay libre en el almacén. Puedes cambiar las cantidades.</p>
                  {propuesta.map((x, i) => (
                    <div key={x.variante_id} className="d-flex flex-wrap align-items-center gap-2 mb-1">
                      <label className="small mb-0" htmlFor={`res-${x.variante_id}`} style={{ minWidth: "14rem" }}>{x.descripcion} <span className="text-muted">(faltan {x.falta}, libres {x.disponible})</span></label>
                      <input id={`res-${x.variante_id}`} type="number" min="0" max={Math.min(x.falta, x.disponible)} className="form-control form-control-sm" style={{ width: "6rem" }} value={x.cantidad}
                        onChange={(e) => setPropuesta(propuesta.map((y, j) => (j === i ? { ...y, cantidad: Math.max(0, Math.min(Number(e.target.value) || 0, y.falta, y.disponible)) } : y)))} />
                    </div>
                  ))}
                  <div className="form-check mt-2">
                    <input id="res-faltantes" type="checkbox" className="form-check-input" checked={registrarFaltantes} onChange={(e) => setRegistrarFaltantes(e.target.checked)} />
                    <label className="form-check-label small" htmlFor="res-faltantes">Anotar lo que falta como compra pendiente</label>
                  </div>
                  <div className="d-flex gap-2 mt-2">
                    <button type="button" className="btn btn-primary btn-sm" disabled={ocupado || propuesta.every((x) => x.cantidad === 0) && !registrarFaltantes} onClick={confirmarReserva}>Confirmar</button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setPropuesta(null)}>Cancelar</button>
                  </div>
                </div>
              )}

              {!cerrado && material.length > 0 && !movimiento && (
                <div className="d-flex flex-wrap gap-2 mt-3">
                  <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setMovimiento({ variante_id: String(material[0].variante_id), tipo: "salida", cantidad: "", motivo: "", libres: false })}>Anotar prendas usadas o estropeadas</button>
                  {material.some((m) => m.reservado > 0) && (
                    <button type="button" className="btn btn-outline-secondary btn-sm" disabled={ocupado}
                      onClick={async () => (await confirmar({ titulo: "¿Liberar las prendas reservadas?", mensaje: "Vuelven a estar disponibles para otros pedidos.", aceptar: "Liberar" })) && ejecutar((sb) => liberarPrendas(sb, p.id), "Reservas liberadas.")}>
                      Liberar reservas
                    </button>
                  )}
                </div>
              )}
              {movimiento && (
                <form className="border rounded p-3 mt-3" aria-label="Anotar prendas" onSubmit={(e) => { e.preventDefault(); guardarMovimiento(); }}>
                  <div className="row g-2">
                    <div className="col-md-5">
                      <label className="form-label small mb-0" htmlFor="mov-prenda">Prenda</label>
                      <select id="mov-prenda" className="form-select form-select-sm" value={movimiento.variante_id} onChange={(e) => setMovimiento({ ...movimiento, variante_id: e.target.value })}>
                        {material.map((m) => <option key={m.variante_id} value={m.variante_id}>{m.modelo} · {m.color} {m.talla}</option>)}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small mb-0" htmlFor="mov-tipo">Qué ha pasado</label>
                      <select id="mov-tipo" className="form-select form-select-sm" value={movimiento.tipo} onChange={(e) => setMovimiento({ ...movimiento, tipo: e.target.value })}>
                        {Object.entries(TIPOS_MOVIMIENTO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small mb-0" htmlFor="mov-cantidad">Cantidad</label>
                      <input id="mov-cantidad" type="number" min="1" className="form-control form-control-sm" value={movimiento.cantidad} onChange={(e) => setMovimiento({ ...movimiento, cantidad: e.target.value })} />
                    </div>
                    <div className="col-12">
                      <label className="form-label small mb-0" htmlFor="mov-motivo">Nota (opcional)</label>
                      <input id="mov-motivo" className="form-control form-control-sm" value={movimiento.motivo} onChange={(e) => setMovimiento({ ...movimiento, motivo: e.target.value })} />
                    </div>
                    {movimiento.tipo !== "devolucion" && (
                      <div className="col-12 form-check ms-1">
                        <input id="mov-libres" type="checkbox" className="form-check-input" checked={movimiento.libres} onChange={(e) => setMovimiento({ ...movimiento, libres: e.target.checked })} />
                        <label className="form-check-label small" htmlFor="mov-libres">Si no estaban reservadas, cogerlas de las libres del almacén</label>
                      </div>
                    )}
                  </div>
                  <div className="d-flex gap-2 mt-2">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={ocupado || !(Number(movimiento.cantidad) > 0)}>Anotar</button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setMovimiento(null)}>Cancelar</button>
                  </div>
                </form>
              )}
            </div>
          </section>

          <section className="card mb-3" aria-labelledby="t-trabajo">
            <div className="card-body">
              <h2 id="t-trabajo" className="h5">Trabajo</h2>
              <p className="small mb-1">
                {p.trabajo?.tecnica ? `Técnica: ${p.trabajo.tecnica}. ` : ""}
                {(p.trabajo?.zonas ?? []).length ? `Zonas: ${p.trabajo.zonas.map((z) => `${z.nombre} (${z.colores} ${Number(z.colores) === 1 ? "color" : "colores"})`).join(", ")}.` : "Sin zonas de impresión indicadas."}
              </p>
              {edicion ? null : (
                <>
                  <p className="small mb-1"><strong>Instrucciones:</strong> {p.instrucciones || "—"}</p>
                  <p className="small mb-0"><strong>Notas internas:</strong> {p.notas_internas || "—"}</p>
                </>
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
          <section className="card mb-3" aria-labelledby="t-datos">
            <div className="card-body">
              <h2 id="t-datos" className="h5">Fechas y notas</h2>
              {edicion ? (
                <form onSubmit={async (e) => { e.preventDefault(); if (await ejecutar((sb) => actualizarPedido(sb, p.id, edicion), "Datos guardados.")) setEdicion(null); }}>
                  {[["fecha_entrega", "Entrega prevista", "date"], ["fecha_inicio_prevista", "Empezar producción el", "date"]].map(([k, t, tipo]) => (
                    <div className="mb-2" key={k}>
                      <label className="form-label small mb-0" htmlFor={`ed-${k}`}>{t}</label>
                      <input id={`ed-${k}`} type={tipo} className="form-control form-control-sm" value={edicion[k]} onChange={(e) => setEdicion({ ...edicion, [k]: e.target.value })} />
                    </div>
                  ))}
                  {[["instrucciones", "Instrucciones de producción"], ["notas_internas", "Notas internas"]].map(([k, t]) => (
                    <div className="mb-2" key={k}>
                      <label className="form-label small mb-0" htmlFor={`ed-${k}`}>{t}</label>
                      <textarea id={`ed-${k}`} rows="2" className="form-control form-control-sm" value={edicion[k]} onChange={(e) => setEdicion({ ...edicion, [k]: e.target.value })} />
                    </div>
                  ))}
                  <div className="d-flex gap-2">
                    <button type="submit" className="btn btn-primary btn-sm" disabled={ocupado}>Guardar</button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEdicion(null)}>Cancelar</button>
                  </div>
                </form>
              ) : (
                <>
                  <dl className="small mb-2">
                    <dt>Entrega prevista</dt><dd>{p.fecha_entrega ? new Date(`${dia(p.fecha_entrega)}T00:00:00`).toLocaleDateString("es-ES") : "Sin fecha"}</dd>
                    <dt>Empezar producción</dt><dd>{p.fecha_inicio_prevista ? new Date(`${dia(p.fecha_inicio_prevista)}T00:00:00`).toLocaleDateString("es-ES") : "—"}</dd>
                    <dt>Creado</dt><dd>{fechaHora(p.creado_en)}</dd>
                  </dl>
                  <button type="button" className="btn btn-outline-secondary btn-sm"
                    onClick={() => setEdicion({ fecha_entrega: dia(p.fecha_entrega), fecha_inicio_prevista: dia(p.fecha_inicio_prevista), instrucciones: p.instrucciones ?? "", notas_internas: p.notas_internas ?? "" })}>
                    Editar fechas y notas
                  </button>
                </>
              )}
            </div>
          </section>

          <section className="card mb-3" aria-labelledby="t-cobro">
            <div className="card-body">
              <h2 id="t-cobro" className="h5">Precio y cobro</h2>
              <p className="mb-1">Precio acordado: <strong>{euros(p.precio_acordado_cent)}</strong></p>
              <p className="small text-muted">Cobrado: {euros(p.importe_cobrado_cent)} · {p.cobro_estado === "cobrado" ? "todo cobrado" : `queda ${euros(Math.max(0, p.precio_acordado_cent - p.importe_cobrado_cent))}`}</p>
              <form className="d-flex gap-2 align-items-end" onSubmit={(e) => {
                e.preventDefault();
                const v = leerNumero(cobro);
                if (v === null || v < 0) return setMensaje({ tipo: "danger", texto: "Indica el total cobrado en euros." });
                ejecutar((sb) => registrarCobro(sb, p.id, Math.round(v * 100)), "Cobro actualizado.");
              }}>
                <div>
                  <label className="form-label small mb-0" htmlFor="cobro">Total cobrado hasta hoy (€)</label>
                  <input id="cobro" inputMode="decimal" className="form-control form-control-sm" value={cobro} onChange={(e) => setCobro(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-outline-primary btn-sm" disabled={ocupado}>Guardar</button>
              </form>
              <button type="button" className="btn btn-link btn-sm p-0 mt-2" onClick={() => setCobro(String(p.precio_acordado_cent / 100).replace(".", ","))}>Poner todo cobrado</button>
            </div>
          </section>

          <section className="card mb-3" aria-labelledby="t-economico">
            <div className="card-body">
              <h2 id="t-economico" className="h5">Cálculo original</h2>
              <p className="small text-muted">Copia del presupuesto aceptado: no cambia aunque cambien tarifas o parámetros.</p>
              <dl className="small mb-0">
                <dt>Coste previsto</dt><dd>{euros(p.coste_previsto_cent)}</dd>
                {p.economico?.beneficio_cent !== undefined && <><dt>Beneficio previsto</dt><dd>{euros(p.economico.beneficio_cent)}</dd></>}
                {p.economico?.parametros_version && <><dt>Parámetros de cálculo</dt><dd>versión {p.economico.parametros_version}</dd></>}
              </dl>
              {lineas.some((l) => l.coste_unitario_previsto !== null) && (
                <details className="small mt-2">
                  <summary>Coste de las prendas</summary>
                  <ul className="mb-0">{lineas.map((l) => <li key={l.id}>{l.cantidad} × {l.descripcion}: {eurosDecimal(Number(l.coste_unitario_previsto ?? 0))}</li>)}</ul>
                </details>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default PaginaPedido;
