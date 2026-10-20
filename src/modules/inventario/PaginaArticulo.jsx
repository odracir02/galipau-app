import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, PackagePlus } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { obtenerArticulo, listarMovimientos, listarReservas, corregirMovimiento, reservar, liberarReserva, actualizarArticulo } from "./data/inventarioRepo";
import { TIPOS_MOVIMIENTO, describirArticulo } from "./domain/inventario";
import { euro5 } from "../catalogo/domain/catalogo";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";

const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "");

/** Stock item card: quantities, minimum, movement history (with corrections) and reservations. */
function PaginaArticulo({ obtenerCliente = obtenerClienteSupabase }) {
  const { varianteId } = useParams();
  const confirmar = useConfirmar();
  const [a, setA] = useState(undefined);
  const [movimientos, setMovimientos] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [mensaje, setMensaje] = useState(null);
  const [ajustes, setAjustes] = useState({ stock_minimo: "", ubicacion: "", notas: "" });
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [reserva, setReserva] = useState({ cantidad: "", referencia: "" });

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const art = await obtenerArticulo(sb, varianteId);
      setA(art);
      if (art) {
        setAjustes({ stock_minimo: String(art.stock_minimo), ubicacion: art.ubicacion ?? "", notas: art.notas ?? "" });
        const [m, r] = await Promise.all([listarMovimientos(sb, art.articulo_id), listarReservas(sb, art.articulo_id)]);
        setMovimientos(m);
        setReservas(r);
      }
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setA(null);
    }
  }, [obtenerCliente, varianteId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const ejecutar = async (fn, ok) => {
    try {
      await fn(await obtenerCliente());
      setMensaje({ tipo: "success", texto: ok });
      await cargar();
      return true;
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      return false;
    }
  };

  if (a === undefined) return <Cargando texto="Cargando artículo…" />;
  if (a === null) {
    return (
      <>
        {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
        <Aviso tipo="info">Este artículo todavía no tiene existencias. <Link to={`/inventario/movimiento?variante=${varianteId}`}>Registra una entrada</Link>.</Aviso>
      </>
    );
  }
  const corregidos = new Set(movimientos.filter((m) => m.corrige_movimiento_id).map((m) => m.corrige_movimiento_id));
  const activas = reservas.filter((r) => r.estado === "activa");

  return (
    <>
      <Link to="/inventario" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Inventario</Link>
      <div className="gx-cabecera">
        <div>
          <h1>{a.modelo} · {a.color} · {a.talla}</h1>
          <p>{describirArticulo(a)} · catálogo hoy {euro5(a.coste_catalogo)}{a.en_catalogo ? "" : " (archivado en el catálogo)"}</p>
        </div>
        <div className="gx-cabecera-acciones">
          <Link to={`/inventario/movimiento?variante=${varianteId}`} className="btn btn-primary btn-icono"><PackagePlus size={16} aria-hidden="true" />Registrar movimiento</Link>
        </div>
      </div>
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}

      <div className="row g-3 mb-3">
        {[["Físico", a.fisico, "art-fisico"], ["Reservado", a.reservado, "art-reservado"], ["Disponible", a.disponible, "art-disponible"], ["Valor (coste medio)", a.valor === null ? "—" : euro5(a.valor), "art-valor"]].map(([t, v, id]) => (
          <div key={t} className="col-6 col-lg-3">
            <div className={`gx-kpi ${t === "Disponible" && a.bajo_minimo ? "border-danger" : ""}`}>
              <div className="gx-kpi-etiqueta">{t}</div>
              <div className="gx-kpi-valor" data-testid={id}>{v}</div>
              {t === "Disponible" && a.bajo_minimo && <div className="gx-kpi-detalle gx-negativo">Por debajo del mínimo ({a.stock_minimo})</div>}
              {t.startsWith("Valor") && a.coste_medio !== null && <div className="gx-kpi-detalle">{euro5(a.coste_medio)} por unidad</div>}
            </div>
          </div>
        ))}
      </div>

      <section className="gx-tarjeta mb-3" aria-label="Ajustes del artículo">
        <div className="row g-2 align-items-end">
          <div className="col-4 col-md-2"><label className="form-label small mb-0" htmlFor="art-minimo">Stock mínimo</label><input id="art-minimo" className="form-control form-control-sm" inputMode="numeric" value={ajustes.stock_minimo} onChange={(e) => setAjustes((x) => ({ ...x, stock_minimo: e.target.value }))} /></div>
          <div className="col-8 col-md-3"><label className="form-label small mb-0" htmlFor="art-ubicacion">Ubicación</label><input id="art-ubicacion" className="form-control form-control-sm" value={ajustes.ubicacion} onChange={(e) => setAjustes((x) => ({ ...x, ubicacion: e.target.value }))} /></div>
          <div className="col-12 col-md-5"><label className="form-label small mb-0" htmlFor="art-notas">Notas</label><input id="art-notas" className="form-control form-control-sm" value={ajustes.notas} onChange={(e) => setAjustes((x) => ({ ...x, notas: e.target.value }))} /></div>
          <div className="col-12 col-md-2">
            <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={() => {
              const n = Number(ajustes.stock_minimo);
              if (!Number.isInteger(n) || n < 0) return setMensaje({ tipo: "danger", texto: "El stock mínimo debe ser un número entero (0 o más)." });
              ejecutar((sb) => actualizarArticulo(sb, a.articulo_id, { ...ajustes, stock_minimo: n }), "Ajustes guardados.");
            }}>Guardar</button>
          </div>
        </div>
      </section>

      <section className="mb-3" aria-label="Reservas">
        <h2 className="h6">Reservas</h2>
        <div className="gx-tarjeta">
          {activas.length === 0 ? <p className="small text-muted mb-2">Sin reservas activas. Los presupuestos no reservan stock; las reservas se conectarán con los pedidos.</p> : (
            <ul className="list-unstyled mb-2">
              {activas.map((r) => (
                <li key={r.id} className="d-flex align-items-center gap-2 py-1">
                  <strong>{r.cantidad}</strong> ud. · {r.referencia} <span className="small text-muted">{fechaHora(r.creado_en)}</span>
                  <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={async () => {
                    if (await confirmar({ titulo: "¿Liberar la reserva?", mensaje: `Las ${r.cantidad} unidades de «${r.referencia}» vuelven a estar disponibles.`, aceptar: "Liberar" })) {
                      ejecutar((sb) => liberarReserva(sb, r.id), "Reserva liberada.");
                    }
                  }}>Liberar</button>
                </li>
              ))}
            </ul>
          )}
          <div className="row g-2 align-items-end">
            <div className="col-4 col-md-2"><label className="form-label small mb-0" htmlFor="res-cantidad">Unidades</label><input id="res-cantidad" className="form-control form-control-sm" inputMode="numeric" value={reserva.cantidad} onChange={(e) => setReserva((x) => ({ ...x, cantidad: e.target.value }))} /></div>
            <div className="col-8 col-md-4"><label className="form-label small mb-0" htmlFor="res-referencia">Para (pedido o referencia)</label><input id="res-referencia" className="form-control form-control-sm" value={reserva.referencia} onChange={(e) => setReserva((x) => ({ ...x, referencia: e.target.value }))} /></div>
            <div className="col-12 col-md-3">
              <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={async () => {
                const n = Number(reserva.cantidad);
                if (!Number.isInteger(n) || n <= 0) return setMensaje({ tipo: "danger", texto: "Indica las unidades a reservar." });
                if (n > a.disponible) return setMensaje({ tipo: "danger", texto: `Solo hay ${a.disponible} unidad(es) disponibles.` });
                if (!reserva.referencia.trim()) return setMensaje({ tipo: "danger", texto: "Indica para qué es la reserva." });
                if (await ejecutar((sb) => reservar(sb, varianteId, n, reserva.referencia.trim()), `${n} unidad(es) reservadas.`)) setReserva({ cantidad: "", referencia: "" });
              }}>Reservar</button>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Historial de movimientos">
        <h2 className="h6">Historial de movimientos</h2>
        <div className="gx-tabla">
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead><tr><th>Fecha</th><th>Tipo</th><th className="text-end">Cantidad</th><th className="d-none d-md-table-cell">Coste ud.</th><th>Motivo / referencia</th><th /></tr></thead>
              <tbody>
                {movimientos.map((m) => [
                  <tr key={m.id} className={corregidos.has(m.id) ? "text-muted text-decoration-line-through" : ""}>
                    <td className="small">{m.fecha}</td>
                    <td>{TIPOS_MOVIMIENTO[m.tipo]}</td>
                    <td className={`text-end fw-semibold ${m.cantidad > 0 ? "gx-positivo" : "gx-negativo"}`}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
                    <td className="d-none d-md-table-cell small">{m.coste_unitario === null ? "" : euro5(m.coste_unitario)}</td>
                    <td className="small">{[m.motivo, m.referencia].filter(Boolean).join(" · ")}{m.corrige_movimiento_id ? ` (corrige el nº ${m.corrige_movimiento_id})` : ""}</td>
                    <td className="text-end">
                      {m.tipo !== "correccion" && !corregidos.has(m.id) && (
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setCorrigiendo(m.id); setMotivo(""); }}>Corregir</button>
                      )}
                    </td>
                  </tr>,
                  corrigiendo === m.id && (
                    <tr key={`c-${m.id}`}>
                      <td colSpan={6}>
                        <div className="d-flex flex-wrap gap-2 align-items-end p-2 bg-light rounded" role="group" aria-label="Corregir movimiento">
                          <div className="flex-grow-1">
                            <label className="form-label small mb-0" htmlFor="cor-motivo">Motivo de la corrección *</label>
                            <input id="cor-motivo" className="form-control form-control-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                          </div>
                          <button type="button" className="btn btn-sm btn-primary" disabled={!motivo.trim()} onClick={async () => {
                            if (await ejecutar((sb) => corregirMovimiento(sb, m.id, motivo.trim()), "Movimiento corregido con un movimiento compensatorio.")) setCorrigiendo(null);
                          }}>Anular con un movimiento compensatorio</button>
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setCorrigiendo(null)}>Cancelar</button>
                        </div>
                      </td>
                    </tr>
                  ),
                ])}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

export default PaginaArticulo;
