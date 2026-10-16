import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
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
    <div className="container mt-4">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        <h2 className="mb-0">Presupuestos</h2>
        <Link to="/presupuestos/nuevo" className="btn btn-primary ms-auto">+ Nuevo presupuesto</Link>
      </div>

      <form className="row g-2 mb-3" onSubmit={(e) => e.preventDefault()} aria-label="Filtros">
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

      {mensaje && <div className={`alert alert-${mensaje.tipo} py-2`} role={mensaje.tipo === "danger" ? "alert" : "status"}>{mensaje.texto}</div>}
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {presupuestos === null ? (
        <div role="status">Cargando presupuestos…</div>
      ) : presupuestos.length === 0 ? (
        <p className="text-muted">No hay presupuestos{Object.values(filtros).some(Boolean) ? " con estos filtros" : ""}.</p>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle">
            <thead>
              <tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th className="text-end">Total</th><th className="text-end d-none d-md-table-cell">Beneficio</th><th /></tr>
            </thead>
            <tbody>
              {presupuestos.map((p) => (
                <tr key={p.id}>
                  <td>{p.numero ?? <span className="text-muted">—</span>}</td>
                  <td>{fecha(p.fecha_emision)}</td>
                  <td>{p.cliente_nombre}</td>
                  <td><InsigniaEstado estado={p.estado} /></td>
                  <td className="text-end">{euros(Number(p.total_cent))}{p.precio_final_cent === null && p.estado !== "importado" ? <span className="text-muted small"> (rec.)</span> : ""}</td>
                  <td className={`text-end d-none d-md-table-cell ${Number(p.beneficio_cent) < 0 ? "text-danger" : ""}`}>{p.beneficio_cent === null ? "—" : euros(Number(p.beneficio_cent))}</td>
                  <td className="text-end text-nowrap">
                    <Link className="btn btn-sm btn-outline-primary" to={`/presupuestos/${p.id}`}>Abrir</Link>{" "}
                    {p.estado !== "importado" && <Link className="btn btn-sm btn-outline-secondary" to={`/presupuestos/nuevo?duplicar=${p.id}`}>Duplicar</Link>}{" "}
                    {p.estado !== "importado" && p.estado !== "cancelado" && p.precio_final_cent !== null && (
                      <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => pdf(p.id)}>PDF</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small text-muted">{presupuestos.length} presupuesto(s) · total sin cancelados {euros(totalVisible)}{presupuestos.length >= 200 ? " · se muestran los 200 más recientes: usa los filtros" : ""}</div>
        </div>
      )}
    </div>
  );
}

export default PaginaPresupuestos;
