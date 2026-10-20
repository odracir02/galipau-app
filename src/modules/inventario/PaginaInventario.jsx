import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Boxes, Lock, PackageCheck, PackagePlus, Search, Wallet } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { listarStock } from "./data/inventarioRepo";
import { resumenInventario } from "./domain/inventario";
import { normalizarTexto } from "../../domain/catalogo";
import { euros } from "../../shared/utils/dinero";
import { NavInventario } from "./Comunes";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";

const Kpi = ({ icono: Icono, etiqueta, valor, detalle, testid }) => (
  <div className="gx-kpi">
    <div className="gx-kpi-etiqueta"><Icono size={16} aria-hidden="true" />{etiqueta}</div>
    <div className="gx-kpi-valor" data-testid={testid}>{valor}</div>
    {detalle && <div className="gx-kpi-detalle">{detalle}</div>}
  </div>
);

/** Inventory overview: physical, reserved and available units per item. */
function PaginaInventario({ obtenerCliente = obtenerClienteSupabase }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState("todos");

  useEffect(() => {
    (async () => {
      try {
        setFilas(await listarStock(await obtenerCliente()));
      } catch (e) {
        setError(e.message);
        setFilas([]);
      }
    })();
  }, [obtenerCliente]);

  const r = useMemo(() => resumenInventario(filas ?? []), [filas]);
  const visibles = (filas ?? []).filter((f) =>
    (filtro === "todos" || (filtro === "bajo" && f.bajo_minimo) || (filtro === "reservas" && f.reservado > 0) || (filtro === "sin" && f.fisico === 0)) &&
    (!texto || normalizarTexto(`${f.proveedor ?? "propio"} ${f.modelo} ${f.tipo} ${f.color} ${f.talla} ${f.ubicacion ?? ""}`).includes(normalizarTexto(texto)))
  );

  return (
    <>
      <Cabecera titulo="Inventario" descripcion="Existencias físicas del taller. Disponible = físico − reservado."
        acciones={<Link to="/inventario/movimiento" className="btn btn-primary btn-icono"><PackagePlus size={16} aria-hidden="true" />Registrar movimiento</Link>} />
      <NavInventario />
      {error && <Aviso tipo="danger">{error}</Aviso>}
      {filas === null ? <Cargando texto="Cargando inventario…" /> : (
        <>
          <div className="row g-3 mb-3">
            <div className="col-6 col-xl-3"><Kpi icono={Boxes} etiqueta="Unidades físicas" valor={r.fisico} detalle={`${r.referencias} referencia(s)`} testid="inv-fisico" /></div>
            <div className="col-6 col-xl-3"><Kpi icono={Lock} etiqueta="Reservadas" valor={r.reservado} detalle={`${r.disponible} disponibles`} testid="inv-reservado" /></div>
            <div className="col-6 col-xl-3"><Kpi icono={AlertTriangle} etiqueta="Bajo mínimo" valor={r.bajoMinimo} detalle={<Link to="/inventario/compras">Ver compras sugeridas</Link>} testid="inv-bajo" /></div>
            <div className="col-6 col-xl-3"><Kpi icono={Wallet} etiqueta="Valor estimado" valor={euros(Math.round(r.valor * 100))} detalle={r.sinValorar ? `${r.sinValorar} referencia(s) sin coste de entrada` : "Coste medio de las entradas"} testid="inv-valor" /></div>
          </div>
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <div className="input-group input-group-sm" style={{ maxWidth: 380 }}>
              <span className="input-group-text"><Search size={14} aria-hidden="true" /></span>
              <input aria-label="Buscar en el inventario" className="form-control" placeholder="Modelo, color, talla, ubicación…" value={texto} onChange={(e) => setTexto(e.target.value)} />
            </div>
            <select aria-label="Filtro de existencias" className="form-select form-select-sm" style={{ maxWidth: 220 }} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="todos">Todas las referencias</option>
              <option value="bajo">Bajo mínimo</option>
              <option value="reservas">Con reservas</option>
              <option value="sin">Sin existencias</option>
            </select>
          </div>
          {filas.length === 0 ? (
            <div className="gx-tabla">
              <EstadoVacio icono={PackageCheck} titulo="El inventario está vacío"
                accion={<Link to="/inventario/inicial" className="btn btn-primary">Registrar el inventario inicial</Link>}>
                Tener un producto en el catálogo no significa tenerlo en el taller: indica tú las unidades que hay.
              </EstadoVacio>
            </div>
          ) : (
            <div className="gx-tabla">
              <div className="table-responsive">
                <table className="table table-hover align-middle">
                  <thead><tr><th>Artículo</th><th>Color</th><th>Talla</th><th className="text-end">Físico</th><th className="text-end">Reservado</th><th className="text-end">Disponible</th><th className="text-end d-none d-md-table-cell">Mínimo</th></tr></thead>
                  <tbody>
                    {visibles.map((f) => (
                      <tr key={f.articulo_id}>
                        <td>
                          <Link to={`/inventario/articulos/${f.variante_id}`}>{f.modelo}</Link>
                          <div className="small text-muted">{f.propio ? "Producto propio" : f.proveedor}{f.ubicacion ? ` · ${f.ubicacion}` : ""}</div>
                        </td>
                        <td>{f.color}</td>
                        <td>{f.talla}</td>
                        <td className="text-end">{f.fisico}</td>
                        <td className="text-end">{f.reservado || "—"}</td>
                        <td className="text-end fw-semibold">
                          {f.disponible}
                          {f.bajo_minimo && <span className="gx-insignia gx-estado-cancelado ms-2">Bajo mínimo</span>}
                        </td>
                        <td className="text-end d-none d-md-table-cell">{f.stock_minimo || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="small text-muted px-3 py-2 border-top">{visibles.length} de {filas.length} referencia(s)</div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default PaginaInventario;
