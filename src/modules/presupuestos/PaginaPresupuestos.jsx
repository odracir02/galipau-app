import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Copy, Download, FilePlus2, FileText } from "lucide-react";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { listarPresupuestos, obtenerPresupuesto } from "./data/presupuestosRepo";
import { cargarEmpresa } from "../empresa/empresaRepo";
import { descargarPdfPresupuesto } from "./descargarPdf";
import { ESTADOS } from "./domain/estados";
import { euros } from "../../shared/utils/dinero";
import InsigniaEstado from "./InsigniaEstado";

const FILTROS_INICIALES = { cliente: "", estado: "", desde: "", hasta: "" };
const fecha = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

/** Quote history with filters by customer, date and state. */
function PaginaPresupuestos({ obtenerCliente = obtenerClienteSupabase, guardarPdf }) {
  const [busqueda] = useSearchParams();
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState(() => ({ ...FILTROS_INICIALES, cliente: busqueda.get("cliente") ?? "" }));
  const [presupuestos, setPresupuestos] = useState(null);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  const cargar = useCallback(async (f) => {
    try {
      setError(null);
      setPresupuestos(await listarPresupuestos(await obtenerCliente(), f));
    } catch (e) {
      setError(e.message);
      setPresupuestos([]);
    }
  }, [obtenerCliente]);

  useEffect(() => {
    const t = setTimeout(() => cargar(filtros), 250);
    return () => clearTimeout(t);
  }, [filtros, cargar]);

  const cambiar = (campo) => (e) => setFiltros((f) => ({ ...f, [campo]: e.target.value }));

  const pdf = async (id) => {
    try {
      const sb = await obtenerCliente();
      const [p, empresa] = await Promise.all([obtenerPresupuesto(sb, id), cargarEmpresa(sb)]);
      setMensaje({ tipo: "success", texto: `PDF generado: ${await descargarPdfPresupuesto(sb, p, empresa, guardarPdf)}` });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  };

  const totalVisible = (presupuestos ?? []).filter((p) => p.estado !== "cancelado").reduce((s, p) => s + Number(p.total_cent), 0);

  return (
    <>
      <Cabecera titulo="Presupuestos" descripcion="Historial completo, con filtros por cliente, estado y fecha."
        acciones={<Link to="/presupuestos/nuevo" className="btn btn-primary btn-icono"><FilePlus2 size={16} aria-hidden="true" />Nuevo presupuesto</Link>} />

      <form className="row g-2 mb-3 gx-tarjeta mx-0 py-3" onSubmit={(e) => e.preventDefault()} aria-label="Filtros">
        <div className="col-md-4">
          <label className="form-label small mb-0" htmlFor="filtro-cliente">Cliente</label>
          <input id="filtro-cliente" className="form-control form-control-sm" value={filtros.cliente} onChange={cambiar("cliente")} placeholder="Nombre del cliente" />
        </div>
        <div className="col-md-3">
          <label className="form-label small mb-0" htmlFor="filtro-estado">Estado</label>
          <select id="filtro-estado" className="form-select form-select-sm" value={filtros.estado} onChange={cambiar("estado")}>
            <option value="">Todos</option>
            {Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.etiqueta}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0" htmlFor="filtro-desde">Desde</label>
          <input id="filtro-desde" type="date" className="form-control form-control-sm" value={filtros.desde} onChange={cambiar("desde")} />
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0" htmlFor="filtro-hasta">Hasta</label>
          <input id="filtro-hasta" type="date" className="form-control form-control-sm" value={filtros.hasta} onChange={cambiar("hasta")} />
        </div>
        <div className="col-md-1 d-flex align-items-end">
          <button type="button" className="btn btn-sm btn-outline-secondary w-100" onClick={() => setFiltros(FILTROS_INICIALES)}>Limpiar</button>
        </div>
      </form>

      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {error && <Aviso tipo="danger">{error}</Aviso>}
      {presupuestos === null ? (
        <Cargando texto="Cargando presupuestos…" />
      ) : presupuestos.length === 0 ? (
        <div className="gx-tabla">
          {Object.values(filtros).some(Boolean) ? (
            <EstadoVacio icono={FileText} titulo="No hay presupuestos con estos filtros"
              accion={<button type="button" className="btn btn-outline-secondary" onClick={() => setFiltros(FILTROS_INICIALES)}>Quitar filtros</button>} />
          ) : (
            <EstadoVacio icono={FileText} titulo="Todavía no hay presupuestos"
              accion={<Link to="/presupuestos/nuevo" className="btn btn-primary">Crear el primero</Link>}>
              Calcula el coste, elige el precio y genera el PDF para el cliente.
            </EstadoVacio>
          )}
        </div>
      ) : (
        <div className="gx-tabla">
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead>
              <tr><th>Número</th><th className="d-none d-sm-table-cell">Fecha</th><th>Cliente</th><th className="d-none d-sm-table-cell">Estado</th><th className="text-end">Total</th><th className="text-end d-none d-md-table-cell">Beneficio</th><th /></tr>
            </thead>
            <tbody>
              {presupuestos.map((p) => (
                // The whole row opens the quote; the number is the keyboard-accessible link
                <tr key={p.id} className="gx-fila-enlace" onClick={() => navigate(`/presupuestos/${p.id}`)}>
                  <td className="fw-semibold">
                    <Link to={`/presupuestos/${p.id}`} className="text-reset text-decoration-none" onClick={(e) => e.stopPropagation()}>
                      {p.numero ?? <span className="text-muted fw-normal">Borrador</span>}
                    </Link>
                  </td>
                  <td className="d-none d-sm-table-cell">{fecha(p.fecha_emision)}</td>
                  <td>{p.cliente_nombre}<div className="d-sm-none mt-1"><InsigniaEstado estado={p.estado} /></div></td>
                  <td className="d-none d-sm-table-cell"><InsigniaEstado estado={p.estado} /></td>
                  <td className="text-end">{euros(Number(p.total_cent))}{p.precio_final_cent === null && p.estado !== "importado" ? <span className="text-muted small"> (rec.)</span> : ""}</td>
                  <td className={`text-end d-none d-md-table-cell ${Number(p.beneficio_cent) < 0 ? "text-danger" : ""}`}>{p.beneficio_cent === null ? "—" : euros(Number(p.beneficio_cent))}</td>
                  <td className="text-end text-nowrap" onClick={(e) => e.stopPropagation()}>
                    {p.estado !== "importado" && p.estado !== "cancelado" && p.precio_final_cent !== null ? (
                      <button type="button" className="btn btn-sm btn-link text-body px-2" onClick={() => pdf(p.id)} aria-label={`Descargar PDF de ${p.numero ?? "borrador"}`} title="Descargar PDF">
                        <Download size={16} aria-hidden="true" />
                      </button>
                    ) : (
                      <span className="btn btn-sm px-2 invisible" aria-hidden="true"><Download size={16} /></span> // keeps the icons aligned
                    )}
                    {p.estado !== "importado" && (
                      <Link className="btn btn-sm btn-link text-body px-2" to={`/presupuestos/nuevo?duplicar=${p.id}`} aria-label="Duplicar" title="Duplicar">
                        <Copy size={16} aria-hidden="true" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          <div className="small text-muted px-3 py-2 border-top">{presupuestos.length} presupuesto(s) · total sin cancelados {euros(totalVisible)}{presupuestos.length >= 200 ? " · se muestran los 200 más recientes: usa los filtros" : ""}</div>
        </div>
      )}
    </>
  );
}

export default PaginaPresupuestos;
