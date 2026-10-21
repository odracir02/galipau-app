import { useDeferredValue, useEffect, useMemo, useState } from "react";
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
import Paginacion from "../../shared/ui/Paginacion";
import { paginar } from "../../shared/ui/paginado";

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
const FILTROS = { texto: "", proveedor: "", marca: "", tipo: "", modelo: "", color: "", talla: "", estado: "disponibles" };
const SIN_MARCA = "__sin_marca__";

/** Catalogue overview: every variant with its purchase price and effective cost. Not stock. */
function PaginaCatalogo({ obtenerCliente = obtenerClienteSupabase }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [f, setF] = useState(FILTROS);
  const [pagina, setPagina] = useState(1);
  const texto = useDeferredValue(f.texto); // typing stays fluid with thousands of rows

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
    // models offered for the chosen supplier and brand only
    const delProveedor = (filas ?? []).filter((r) => (!f.proveedor || (f.proveedor === PROPIOS ? r.propio : r.proveedor === f.proveedor)) && (!f.marca || (f.marca === SIN_MARCA ? !r.marca : r.marca === f.marca)));
    return {
      proveedores: unicos("proveedor"), marcas: unicos("marca"), tipos: unicos("tipo"), colores: unicos("color"), tallas: unicos("talla"),
      modelos: [...new Set(delProveedor.map((r) => r.modelo))].sort((a, b) => a.localeCompare(b, "es")),
      hayPropios: (filas ?? []).some((r) => r.propio), haySinMarca: (filas ?? []).some((r) => !r.marca),
    };
  }, [filas, f.proveedor, f.marca]);

  const visibles = useMemo(() => {
    const q = normalizarTexto(texto);
    return (filas ?? []).filter((r) =>
      (f.estado === "todos" || (f.estado === "disponibles" ? r.disponible : !r.disponible)) &&
      (!f.proveedor || (f.proveedor === PROPIOS ? r.propio : r.proveedor === f.proveedor)) &&
      (!f.marca || (f.marca === SIN_MARCA ? !r.marca : r.marca === f.marca)) &&
      (!f.tipo || r.tipo === f.tipo) &&
      (!f.modelo || r.modelo === f.modelo) &&
      (!f.color || r.color === f.color) &&
      (!f.talla || r.talla === f.talla) &&
      (!q || normalizarTexto(`${r.proveedor ?? ""} ${r.marca ?? ""} ${r.modelo} ${r.tipo} ${r.referencia ?? ""} ${r.color} ${r.talla}`).includes(q))
    );
  }, [filas, f.proveedor, f.marca, f.tipo, f.modelo, f.color, f.talla, f.estado, texto]);

  const cambiar = (k) => (e) => {
    const valor = e.target.value;
    setF((x) => ({ ...x, [k]: valor, ...(k === "proveedor" || k === "marca" ? { modelo: "" } : {}) }));
    setPagina(1);
  };
  const seleccion = (id, etiqueta, k, lista, todos = "Todos", extra = null) => (
    <div className="col-6 col-md-3 col-xl">
      <label className="form-label small mb-0" htmlFor={id}>{etiqueta}</label>
      <select id={id} className="form-select form-select-sm" value={f[k]} onChange={cambiar(k)}>
        <option value="">{todos}</option>
        {lista.map((v) => <option key={v} value={v}>{v}</option>)}
        {extra}
      </select>
    </div>
  );

  return (
    <>
      <Cabecera titulo="Catálogo" descripcion="Productos que se pueden comprar a los proveedores, con su precio de compra. No son existencias del taller."
        acciones={<Link to="/catalogo/proveedores" className="btn btn-primary btn-icono"><Plus size={16} aria-hidden="true" />Añadir productos</Link>} />
      <NavCatalogo />
      {error && <Aviso tipo="danger">{error}</Aviso>}
      <form className="gx-tarjeta row g-2 mx-0 mb-3 py-3" onSubmit={(e) => e.preventDefault()} aria-label="Filtros del catálogo">
        <div className="col-12 col-xl-3">
          <label className="form-label small mb-0" htmlFor="cat-texto">Buscar</label>
          <div className="input-group input-group-sm">
            <span className="input-group-text"><Search size={14} aria-hidden="true" /></span>
            <input id="cat-texto" className="form-control" placeholder="Modelo, referencia, marca, color…" value={f.texto} onChange={cambiar("texto")} />
          </div>
        </div>
        {seleccion("cat-proveedor", "Proveedor", "proveedor", opciones.proveedores, "Todos", opciones.hayPropios && <option value={PROPIOS}>Productos propios</option>)}
        {seleccion("cat-marca", "Marca", "marca", opciones.marcas, "Todas", opciones.haySinMarca && opciones.marcas.length > 0 && <option value={SIN_MARCA}>Sin marca</option>)}
        {seleccion("cat-tipo", "Tipo", "tipo", opciones.tipos)}
        {seleccion("cat-modelo", "Modelo", "modelo", opciones.modelos)}
        {seleccion("cat-color", "Color", "color", opciones.colores)}
        {seleccion("cat-talla", "Talla", "talla", opciones.tallas, "Todas")}
        <div className="col-6 col-md-3 col-xl">
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
                <tr><th>Proveedor</th><th>Modelo</th><th className="d-none d-lg-table-cell">Tipo</th><th className="d-none d-xl-table-cell">Marca</th><th>Color</th><th>Talla</th><th className="d-none d-md-table-cell">Precio de compra</th><th className="text-end">Coste</th></tr>
              </thead>
              <tbody>
                {paginar(visibles, pagina).map((r) => (
                  <tr key={r.variante_id} className={r.disponible ? "" : "text-muted"}>
                    <td>{r.propio ? <em>Propio</em> : r.proveedor}</td>
                    <td><Link to={`/catalogo/modelos/${r.modelo_id}`}>{r.modelo}</Link>{!r.disponible && <span className="gx-insignia gx-estado-importado ms-2">Archivado</span>}</td>
                    <td className="d-none d-lg-table-cell">{r.tipo}</td>
                    <td className="d-none d-xl-table-cell">{r.marca ?? ""}</td>
                    <td>{r.color}</td>
                    <td>{r.talla}</td>
                    <td className="d-none d-md-table-cell small">{describirPrecio(r)}</td>
                    <td className="text-end fw-semibold">{euro5(r.coste)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="d-flex flex-wrap justify-content-between align-items-center border-top">
            <div className="small text-muted px-3 py-2">{visibles.length.toLocaleString("es-ES")} de {filas.length.toLocaleString("es-ES")} variante(s)</div>
            <Paginacion total={visibles.length} pagina={pagina} onCambiar={setPagina} etiqueta="Páginas del catálogo" />
          </div>
        </div>
      )}
    </>
  );
}

export default PaginaCatalogo;
