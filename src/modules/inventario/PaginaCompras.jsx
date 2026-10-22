import { useCallback, useEffect, useState } from "react";
import { ShoppingCart } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { getProductos } from "../../services/getProductos";
import { listarComprasSugeridas, listarNecesidades, crearNecesidad, cerrarNecesidad } from "./data/inventarioRepo";
import { euro5 } from "../catalogo/domain/catalogo";
import { NavInventario, SelectorVariante } from "./Comunes";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";

/** Purchase suggestions from minimum stock and registered needs. A recommendation, never a purchase. */
function PaginaCompras({ obtenerCliente = obtenerClienteSupabase, cargarProductos = getProductos }) {
  const [compras, setCompras] = useState(null);
  const [necesidades, setNecesidades] = useState([]);
  const [productos, setProductos] = useState([]);
  const [nueva, setNueva] = useState({ varianteId: "", cantidad: "", referencia: "" });
  const [clave, setClave] = useState(0);
  const [mensaje, setMensaje] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const [c, n, p] = await Promise.all([listarComprasSugeridas(sb), listarNecesidades(sb), cargarProductos()]);
      setCompras(c);
      setNecesidades(n);
      setProductos(p);
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setCompras([]);
    }
  }, [obtenerCliente, cargarProductos]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const nombre = (id) => {
    const p = productos.find((x) => String(x.id) === String(id));
    return p ? `${p.modelo} · ${p.color} · ${p.talla}` : `Variante ${id}`;
  };
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

  const total = (compras ?? []).reduce((s, c) => s + Number(c.sugerido) * Number(c.coste_catalogo ?? 0), 0);

  return (
    <>
      <Cabecera titulo="Compras sugeridas" descripcion="Lo que falta para llegar al stock mínimo y cubrir las necesidades registradas. Es una recomendación: no se compra nada." />
      <NavInventario />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {compras === null ? <Cargando /> : compras.length === 0 ? (
        <div className="gx-tabla mb-3"><EstadoVacio icono={ShoppingCart} titulo="No falta nada">Ningún artículo está por debajo de su mínimo ni hay necesidades pendientes.</EstadoVacio></div>
      ) : (
        <div className="gx-tabla mb-3">
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead><tr><th>Artículo</th><th className="gx-num">Disponible</th><th className="gx-num">Mínimo</th><th className="gx-num">Necesidades</th><th className="gx-num">Sugerido</th><th className="text-end d-none d-md-table-cell">Coste estimado</th></tr></thead>
              <tbody>
                {compras.map((c) => (
                  <tr key={c.variante_id}>
                    <td>{c.modelo} · {c.color} · {c.talla}<div className="small text-muted">{c.propio ? "Producto propio" : c.proveedor}</div></td>
                    <td className="gx-num">{c.disponible}</td>
                    <td className="gx-num">{c.stock_minimo || "—"}</td>
                    <td className="gx-num">{Number(c.necesidades) || "—"}{Number(c.pendiente_recibir) > 0 && <div className="small text-muted">{c.pendiente_recibir} pedidas, sin llegar</div>}</td>
                    <td className="gx-num fw-semibold" data-testid={`sugerido-${c.variante_id}`}>{c.sugerido}</td>
                    <td className="text-end d-none d-md-table-cell">{euro5(Number(c.sugerido) * Number(c.coste_catalogo ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small text-muted px-3 py-2 border-top">Coste estimado al precio actual del catálogo: {euro5(total)}</div>
        </div>
      )}

      <section className="gx-tarjeta" aria-label="Necesidades registradas">
        <h2 className="h6">Necesidades registradas</h2>
        <p className="small text-muted">Unidades que harán falta para trabajos futuros (por ejemplo, un pedido todavía sin stock).</p>
        {necesidades.length > 0 && (
          <ul className="list-unstyled">
            {necesidades.map((n) => (
              <li key={n.id} className="d-flex flex-wrap align-items-center gap-2 py-1 border-bottom">
                <strong>{n.cantidad}</strong> × {nombre(n.variante_id)} {n.referencia && <span className="small text-muted">· {n.referencia}</span>}
                <span className="ms-auto d-flex gap-1">
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => ejecutar((sb) => cerrarNecesidad(sb, n.id, "atendida"), "Necesidad marcada como atendida.")}>Atendida</button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => ejecutar((sb) => cerrarNecesidad(sb, n.id, "cancelada"), "Necesidad cancelada.")}>Cancelar</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <SelectorVariante key={clave} productos={productos} onElegir={(id) => setNueva((x) => ({ ...x, varianteId: id }))} />
        <div className="row g-2 mt-1 align-items-end">
          <div className="col-4 col-md-2"><label className="form-label small mb-0" htmlFor="nec-cantidad">Unidades</label><input id="nec-cantidad" className="form-control form-control-sm" inputMode="numeric" value={nueva.cantidad} onChange={(e) => setNueva((x) => ({ ...x, cantidad: e.target.value }))} /></div>
          <div className="col-8 col-md-4"><label className="form-label small mb-0" htmlFor="nec-referencia">Para (opcional)</label><input id="nec-referencia" className="form-control form-control-sm" value={nueva.referencia} onChange={(e) => setNueva((x) => ({ ...x, referencia: e.target.value }))} /></div>
          <div className="col-12 col-md-3">
            <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={async () => {
              const n = Number(nueva.cantidad);
              if (!nueva.varianteId || !Number.isInteger(n) || n <= 0) return setMensaje({ tipo: "danger", texto: "Elige el artículo y las unidades." });
              if (await ejecutar((sb) => crearNecesidad(sb, nueva.varianteId, n, nueva.referencia.trim()), "Necesidad registrada.")) {
                setNueva({ varianteId: "", cantidad: "", referencia: "" });
                setClave((k) => k + 1);
              }
            }}>Registrar necesidad</button>
          </div>
        </div>
      </section>
    </>
  );
}

export default PaginaCompras;
