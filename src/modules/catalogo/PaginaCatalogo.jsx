import { useEffect, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Package, Plus, Search } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { listarCatalogoAdmin } from "./data/catalogoRepo";
import { describirPrecio, euro5 } from "./domain/catalogo";
import { normalizarTexto } from "../../domain/catalogo";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";

export function NavCatalogo() {
  const clase = ({ isActive }) => `btn btn-sm ${isActive ? "btn-primary" : "btn-outline-secondary"}`;
  return (
    <nav className="d-flex flex-wrap gap-2 mb-3" aria-label="Secciones del catálogo">
      <NavLink end to="/catalogo" className={clase}>Productos</NavLink>
      <NavLink to="/catalogo/proveedores" className={clase}>Proveedores y productos propios</NavLink>
      <NavLink to="/catalogo/tarifas" className={clase}>Tarifas de proveedores</NavLink>
    </nav>
  );
}

const PROPIOS = "__propios__";
const FILTROS = { texto: "", proveedor: "", color: "", talla: "", estado: "disponibles" };

/** Catalogue overview: every variant with its purchase price and effective cost. Not stock. */
function PaginaCatalogo({ obtenerCliente = obtenerClienteSupabase }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [f, setF] = useState(FILTROS);

  useEffect(() => {
    (async () => {
      try {
        setFilas(await listarCatalogoAdmin(await obtenerCliente()));
      } catch (e) {
        setError(e.message);
        setFilas([]);
      }
    })();
  }, [obtenerCliente]);

  const opciones = useMemo(() => {
    const unicos = (k) => [...new Set((filas ?? []).map((r) => r[k]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "es"));
    return { proveedores: unicos("proveedor"), colores: unicos("color"), tallas: unicos("talla"), hayPropios: (filas ?? []).some((r) => r.propio) };
  }, [filas]);

  const visibles = useMemo(() => {
    const q = normalizarTexto(f.texto);
    return (filas ?? []).filter((r) =>
      (f.estado === "todos" || (f.estado === "disponibles" ? r.disponible : !r.disponible)) &&
      (!f.proveedor || (f.proveedor === PROPIOS ? r.propio : r.proveedor === f.proveedor)) &&
      (!f.color || r.color === f.color) &&
      (!f.talla || r.talla === f.talla) &&
      (!q || normalizarTexto(`${r.proveedor ?? ""} ${r.modelo} ${r.tipo} ${r.referencia ?? ""}`).includes(q))
    );
  }, [filas, f]);

  const cambiar = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  return (
    <>
      <Cabecera titulo="Catálogo" descripcion="Productos que se pueden comprar a los proveedores, con su precio de compra. No son existencias del taller."
        acciones={<Link to="/catalogo/proveedores" className="btn btn-primary btn-icono"><Plus size={16} aria-hidden="true" />Añadir productos</Link>} />
      <NavCatalogo />
      {error && <Aviso tipo="danger">{error}</Aviso>}
      <form className="gx-tarjeta row g-2 mx-0 mb-3 py-3" onSubmit={(e) => e.preventDefault()} aria-label="Filtros del catálogo">
        <div className="col-md-4">
          <label className="form-label small mb-0" htmlFor="cat-texto">Buscar</label>
          <div className="input-group input-group-sm">
            <span className="input-group-text"><Search size={14} aria-hidden="true" /></span>
            <input id="cat-texto" className="form-control" placeholder="Proveedor, modelo, tipo o referencia" value={f.texto} onChange={cambiar("texto")} />
          </div>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0" htmlFor="cat-proveedor">Proveedor</label>
          <select id="cat-proveedor" className="form-select form-select-sm" value={f.proveedor} onChange={cambiar("proveedor")}>
            <option value="">Todos</option>
            {opciones.proveedores.map((p) => <option key={p} value={p}>{p}</option>)}
            {opciones.hayPropios && <option value={PROPIOS}>Productos propios</option>}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0" htmlFor="cat-color">Color</label>
          <select id="cat-color" className="form-select form-select-sm" value={f.color} onChange={cambiar("color")}>
            <option value="">Todos</option>
            {opciones.colores.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0" htmlFor="cat-talla">Talla</label>
          <select id="cat-talla" className="form-select form-select-sm" value={f.talla} onChange={cambiar("talla")}>
            <option value="">Todas</option>
            {opciones.tallas.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0" htmlFor="cat-estado">Estado</label>
          <select id="cat-estado" className="form-select form-select-sm" value={f.estado} onChange={cambiar("estado")}>
            <option value="disponibles">Disponibles</option>
            <option value="archivados">Archivados</option>
            <option value="todos">Todos</option>
          </select>
        </div>
      </form>

      {filas === null ? <Cargando texto="Cargando catálogo…" /> : filas.length === 0 && !error ? (
        <div className="gx-tabla">
          <EstadoVacio icono={Package} titulo="El catálogo está vacío"
            accion={<Link to="/catalogo/proveedores" className="btn btn-primary">Añadir un proveedor o un producto propio</Link>}>
            También puedes importar un catálogo en Configuración → Importación y migración.
          </EstadoVacio>
        </div>
      ) : (
        <div className="gx-tabla">
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead>
                <tr><th>Proveedor</th><th>Modelo</th><th className="d-none d-lg-table-cell">Tipo</th><th>Color</th><th>Talla</th><th className="d-none d-md-table-cell">Precio de compra</th><th className="text-end">Coste</th></tr>
              </thead>
              <tbody>
                {visibles.map((r) => (
                  <tr key={r.variante_id} className={r.disponible ? "" : "text-muted"}>
                    <td>{r.propio ? <em>Propio</em> : r.proveedor}</td>
                    <td><Link to={`/catalogo/modelos/${r.modelo_id}`}>{r.modelo}</Link>{!r.disponible && <span className="gx-insignia gx-estado-importado ms-2">Archivado</span>}</td>
                    <td className="d-none d-lg-table-cell">{r.tipo}</td>
                    <td>{r.color}</td>
                    <td>{r.talla}</td>
                    <td className="d-none d-md-table-cell small">{describirPrecio(r)}</td>
                    <td className="text-end fw-semibold">{euro5(r.coste)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="small text-muted px-3 py-2 border-top">{visibles.length} de {filas.length} variante(s)</div>
        </div>
      )}
    </>
  );
}

export default PaginaCatalogo;
