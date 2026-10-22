import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, PackageSearch, Search } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";
import Paginacion from "../../shared/ui/Paginacion";
import { paginar } from "../../shared/ui/paginado";
import { normalizarTexto } from "../../domain/catalogo";
import { euros } from "../../shared/utils/dinero";
import { InsigniaPedido, InsigniaCobro } from "./Insignias";
import { ESTADOS_PEDIDO, ACTIVOS, motivosAtencion, textoEntrega } from "./domain/pedidos";
import { listarPedidos } from "./data/pedidosRepo";

const hoyIso = () => new Date().toISOString().slice(0, 10);
const VISTAS = { atencion: "Requieren atención", curso: "En curso", terminados: "Entregados", todos: "Todos" };
const fecha = (f) => (f ? new Date(`${String(f).slice(0, 10)}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }) : "—");

/** Orders: what needs attention first, then search and filters. */
function PaginaPedidos({ obtenerCliente = obtenerClienteSupabase, hoy = hoyIso() }) {
  const [pedidos, setPedidos] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState("atencion");
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("");
  const [pagina, setPagina] = useState(1);
  const q = useDeferredValue(texto);

  useEffect(() => {
    (async () => {
      try {
        setPedidos(await listarPedidos(await obtenerCliente()));
      } catch (e) {
        setError(e.message);
        setPedidos([]);
      }
    })();
  }, [obtenerCliente]);

  const conMotivos = useMemo(() => (pedidos ?? []).map((p) => ({ ...p, motivos: motivosAtencion(p, hoy) })), [pedidos, hoy]);
  const cuenta = useMemo(() => ({
    atencion: conMotivos.filter((p) => p.motivos.length).length,
    curso: conMotivos.filter((p) => ACTIVOS.has(p.estado)).length,
    terminados: conMotivos.filter((p) => p.estado === "entregado").length,
    todos: conMotivos.length,
  }), [conMotivos]);
  const visibles = useMemo(() => {
    const n = normalizarTexto(q);
    return conMotivos
      .filter((p) => (vista === "atencion" ? p.motivos.length : vista === "curso" ? ACTIVOS.has(p.estado) : vista === "terminados" ? p.estado === "entregado" : true))
      .filter((p) => !estado || p.estado === estado)
      .filter((p) => !n || normalizarTexto(`${p.numero} ${p.cliente_nombre} ${p.presupuesto_numero ?? ""}`).includes(n))
      .sort((a, b) => (vista === "todos" ? b.id - a.id : String(a.fecha_entrega ?? "9999").localeCompare(String(b.fecha_entrega ?? "9999"))));
  }, [conMotivos, vista, estado, q]);

  const elegirVista = (v) => {
    setVista(v);
    setPagina(1);
  };

  return (
    <>
      <Cabecera titulo="Pedidos" descripcion="Trabajos aceptados: material, producción, entrega y cobro."
        acciones={
          <>
            <Link to="/pedidos/necesidades" className="btn btn-outline-secondary btn-icono"><PackageSearch size={16} aria-hidden="true" />Material que falta</Link>
            <Link to="/presupuestos" className="btn btn-primary btn-icono"><ClipboardList size={16} aria-hidden="true" />Crear desde un presupuesto</Link>
          </>
        } />
      {error && <Aviso tipo="danger">{error}</Aviso>}
      <nav className="d-flex flex-wrap gap-2 mb-3" aria-label="Vistas de pedidos">
        {Object.entries(VISTAS).map(([k, t]) => (
          <button key={k} type="button" className={`btn btn-sm ${vista === k ? "btn-primary" : "btn-outline-secondary"}`} aria-pressed={vista === k} onClick={() => elegirVista(k)}>
            {t} ({cuenta[k]})
          </button>
        ))}
      </nav>
      <form className="gx-tarjeta row g-2 mx-0 mb-3 py-3" onSubmit={(e) => e.preventDefault()} aria-label="Buscar pedidos">
        <div className="col-md-8">
          <label className="form-label small mb-0" htmlFor="ped-texto">Buscar</label>
          <div className="input-group input-group-sm">
            <span className="input-group-text"><Search size={14} aria-hidden="true" /></span>
            <input id="ped-texto" className="form-control" placeholder="Número, cliente o presupuesto" value={texto} onChange={(e) => { setTexto(e.target.value); setPagina(1); }} />
          </div>
        </div>
        <div className="col-md-4">
          <label className="form-label small mb-0" htmlFor="ped-estado">Estado</label>
          <select id="ped-estado" className="form-select form-select-sm" value={estado} onChange={(e) => { setEstado(e.target.value); setPagina(1); }}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS_PEDIDO).map(([k, e]) => <option key={k} value={k}>{e.etiqueta}</option>)}
          </select>
        </div>
      </form>

      {pedidos === null ? <Cargando texto="Cargando pedidos…" /> : visibles.length === 0 ? (
        <div className="gx-tabla">
          <EstadoVacio icono={ClipboardList} titulo={vista === "atencion" ? "Nada requiere atención" : "No hay pedidos"}
            accion={<Link to="/presupuestos" className="btn btn-primary">Ir a presupuestos</Link>}>
            Los pedidos se crean desde un presupuesto aceptado.
          </EstadoVacio>
        </div>
      ) : (
        <div className="gx-tabla">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Estado</th><th className="d-none d-md-table-cell gx-num">Prendas</th><th className="d-none d-lg-table-cell">Cobro</th><th className="d-none d-lg-table-cell text-end">Precio</th></tr></thead>
              <tbody>
                {paginar(visibles, pagina).map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/pedidos/${p.id}`} className="fw-semibold">{p.numero}</Link>{p.presupuesto_numero && <div className="small text-muted">Presupuesto {p.presupuesto_numero}</div>}</td>
                    <td>{p.cliente_nombre}{p.motivos.length > 0 && <div className="small text-warning-emphasis">{p.motivos.join(" · ")}</div>}</td>
                    <td className="text-nowrap">{fecha(p.fecha_entrega)}<div className="small text-muted">{textoEntrega(p.fecha_entrega, hoy)}</div></td>
                    <td><InsigniaPedido estado={p.estado} /></td>
                    <td className="d-none d-md-table-cell small gx-num">{p.unidades ? `${p.unidades_cubiertas} de ${p.unidades} listas` : "—"}{p.unidades_faltan > 0 && <div className="text-warning-emphasis">faltan {p.unidades_faltan}</div>}</td>
                    <td className="d-none d-lg-table-cell"><InsigniaCobro estado={p.cobro_estado} /></td>
                    <td className="d-none d-lg-table-cell text-end">{euros(p.precio_acordado_cent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="d-flex flex-wrap justify-content-between align-items-center border-top">
            <div className="small text-muted px-3 py-2">{visibles.length} {visibles.length === 1 ? "pedido" : "pedidos"}</div>
            <Paginacion total={visibles.length} pagina={pagina} onCambiar={setPagina} etiqueta="Páginas de pedidos" />
          </div>
        </div>
      )}
      <p className="small text-muted mt-3">
        ¿Un trabajo sin presupuesto? <Link to="/pedidos/nuevo">Crear un pedido a mano</Link>.
      </p>
    </>
  );
}

export default PaginaPedidos;
