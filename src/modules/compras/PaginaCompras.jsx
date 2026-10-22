import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShoppingCart, Truck } from "lucide-react";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { InsigniaCompra } from "./InsigniaCompra";
import { agruparPorProveedor, EN_CAMINO, fechaCorta } from "./domain/compras";
import { listarPorComprar, listarPedidosPorComprar, listarCompras, listarProveedores, prepararCompra } from "./data/comprasRepo";

const prendas = (n) => `${n} ${n === 1 ? "prenda" : "prendas"}`;

/** What to buy, grouped by supplier, and what is on its way. */
function PaginaCompras({ obtenerCliente = obtenerClienteSupabase }) {
  const navigate = useNavigate();
  const [datos, setDatos] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [nueva, setNueva] = useState(null); // supplier id being chosen for a purchase by hand
  const [anteriores, setAnteriores] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const [porComprar, pedidos, compras, proveedores] = await Promise.all([listarPorComprar(sb), listarPedidosPorComprar(sb), listarCompras(sb), listarProveedores(sb)]);
      setDatos({ grupos: agruparPorProveedor(porComprar, pedidos, compras), compras, proveedores });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  }, [obtenerCliente]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const preparar = async (proveedorId) => {
    setOcupado(true);
    setMensaje(null);
    try {
      navigate(`/compras/${await prepararCompra(await obtenerCliente(), proveedorId)}`);
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setOcupado(false);
    }
  };

  if (!datos) return mensaje ? <Aviso tipo="danger">{mensaje.texto}</Aviso> : <Cargando texto="Calculando lo que hay que comprar…" />;
  const { grupos, compras, proveedores } = datos;
  const enCamino = compras.filter((c) => EN_CAMINO.has(c.situacion));
  const borradores = compras.filter((c) => c.estado === "borrador" && !grupos.some((g) => g.borrador?.id === c.id));
  const cerradas = compras.filter((c) => c.situacion === "recibida" || c.situacion === "cancelada");

  return (
    <>
      <Cabecera titulo="Compras" descripcion="Lo que hay que comprar para los pedidos y para el almacén, y lo que está en camino."
        acciones={nueva === null && <button type="button" className="btn btn-outline-secondary" onClick={() => setNueva("")}>Nueva compra</button>} />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {nueva !== null && (
        <form className="gx-tarjeta d-flex flex-wrap align-items-end gap-2 mb-3" aria-label="Nueva compra" onSubmit={(e) => { e.preventDefault(); if (nueva) preparar(Number(nueva)); }}>
          <div>
            <label className="form-label small mb-0" htmlFor="nueva-proveedor">Proveedor</label>
            <select id="nueva-proveedor" className="form-select form-select-sm" value={nueva} onChange={(e) => setNueva(e.target.value)}>
              <option value="">Elige…</option>
              {proveedores.filter((p) => p.activo !== false).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!nueva || ocupado}>Crear la compra</button>
          <button type="button" className="btn btn-link btn-sm" onClick={() => setNueva(null)}>Cancelar</button>
          <p className="small text-muted w-100 mb-0">Si el proveedor ya tiene un borrador, se abre ese. Después añade las prendas con «Añadir prenda».</p>
        </form>
      )}

      <section className="mb-4" aria-labelledby="t-por-comprar">
        <h2 id="t-por-comprar" className="h5">Por comprar</h2>
        {grupos.length === 0 ? (
          <div className="gx-tabla">
            <EstadoVacio icono={ShoppingCart} titulo="No hay nada por comprar">
              Los pedidos tienen todo su material (o ya está pedido) y el almacén no está bajo mínimos.
            </EstadoVacio>
          </div>
        ) : (
          <div className="row g-3">
            {grupos.map((g) => (
              <div className="col-md-6 col-xl-4" key={g.proveedor_id}>
                <article className="card h-100" aria-label={`Por comprar a ${g.proveedor}`}>
                  <div className="card-body d-flex flex-column">
                    <h3 className="h6 mb-1">{g.proveedor}</h3>
                    <p className="mb-2"><strong>{prendas(g.unidades)}</strong> <span className="text-muted small">· {g.modelos} {g.modelos === 1 ? "modelo y color" : "modelos y colores"}</span></p>
                    <div className="d-flex flex-wrap gap-1 mb-2">
                      {g.paraPedidos > 0 && <span className="gx-insignia gx-estado-material">{g.paraPedidos} para pedidos</span>}
                      {g.reposicion > 0 && <span className="gx-insignia gx-estado-borrador">{g.reposicion} para reponer el almacén</span>}
                    </div>
                    {g.pedidos.length > 0 && (
                      <p className="small text-muted mb-3">
                        Para {g.pedidos.slice(0, 3).map((p) => p.numero).join(", ")}{g.pedidos.length > 3 ? ` y ${g.pedidos.length - 3} más` : ""}
                        {g.primeraEntrega && <> · entrega más próxima {fechaCorta(g.primeraEntrega)}</>}
                      </p>
                    )}
                    <div className="mt-auto">
                      <button type="button" className="btn btn-primary btn-sm" disabled={ocupado} onClick={() => preparar(g.proveedor_id)}>
                        {g.borrador ? `Actualizar el borrador ${g.borrador.numero}` : "Preparar compra"}
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            ))}
          </div>
        )}
        {borradores.length > 0 && (
          <p className="small mt-2 mb-0">
            Borradores: {borradores.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link to={`/compras/${c.id}`}>{c.numero}</Link> ({c.proveedor}, {prendas(c.unidades)})</span>)}
          </p>
        )}
      </section>

      <section className="mb-4" aria-labelledby="t-en-camino">
        <h2 id="t-en-camino" className="h5">En camino</h2>
        {enCamino.length === 0 ? (
          <p className="small text-muted">No hay compras pendientes de llegar.</p>
        ) : (
          <div className="gx-tabla">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead><tr><th>Compra</th><th>Proveedor</th><th className="d-none d-sm-table-cell">Pedida el</th><th className="gx-num">Pendientes</th><th>Situación</th></tr></thead>
                <tbody>
                  {enCamino.map((c) => (
                    <tr key={c.id} className="gx-fila-enlace" onClick={() => navigate(`/compras/${c.id}`)}>
                      <td className="fw-semibold"><Link to={`/compras/${c.id}`} className="text-reset text-decoration-none" onClick={(e) => e.stopPropagation()}>{c.numero}</Link></td>
                      <td>{c.proveedor}{c.referencia_proveedor && <div className="small text-muted">ref. {c.referencia_proveedor}</div>}</td>
                      <td className="d-none d-sm-table-cell">{fechaCorta(c.fecha_pedido)}</td>
                      <td className="gx-num">{c.pendientes}</td>
                      <td><InsigniaCompra situacion={c.situacion} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {cerradas.length > 0 && (
        <section aria-label="Compras anteriores">
          <button type="button" className="btn btn-link btn-sm p-0" aria-expanded={anteriores} onClick={() => setAnteriores(!anteriores)}>
            {anteriores ? "Ocultar las compras anteriores" : `Ver las compras anteriores (${cerradas.length})`}
          </button>
          {anteriores && (
            <div className="gx-tabla mt-2">
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead><tr><th>Compra</th><th>Proveedor</th><th className="gx-num">Prendas</th><th>Situación</th></tr></thead>
                  <tbody>
                    {cerradas.map((c) => (
                      <tr key={c.id} className="gx-fila-enlace" onClick={() => navigate(`/compras/${c.id}`)}>
                        <td className="fw-semibold"><Link to={`/compras/${c.id}`} className="text-reset text-decoration-none" onClick={(e) => e.stopPropagation()}>{c.numero}</Link></td>
                        <td>{c.proveedor}</td>
                        <td className="gx-num">{c.recibidas}</td>
                        <td><InsigniaCompra situacion={c.situacion} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
      {enCamino.length === 0 && grupos.length === 0 && cerradas.length === 0 && (
        <p className="small text-muted d-flex align-items-center gap-1"><Truck size={14} aria-hidden="true" />Cuando prepares una compra y la marques como pedida, la verás aquí hasta que llegue.</p>
      )}
    </>
  );
}

export default PaginaCompras;
