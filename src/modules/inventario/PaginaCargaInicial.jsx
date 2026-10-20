import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { getProductos } from "../../services/getProductos";
import { listarStock, cargarInventarioInicial } from "./data/inventarioRepo";
import { lineasCargaInicial } from "./domain/inventario";
import { normalizarTexto } from "../../domain/catalogo";
import { euro5 } from "../catalogo/domain/catalogo";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import { NavInventario } from "./Comunes";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";

/**
 * Opening stock: the owner types the units actually in the workshop for the
 * catalogue items found; empty rows are ignored. Nothing is assumed.
 */
function PaginaCargaInicial({ obtenerCliente = obtenerClienteSupabase, cargarProductos = getProductos }) {
  const confirmar = useConfirmar();
  const [productos, setProductos] = useState(null);
  const [enStock, setEnStock] = useState(new Set());
  const [texto, setTexto] = useState("");
  const [valores, setValores] = useState({}); // varianteId -> { cantidad, coste }
  const [mensaje, setMensaje] = useState(null);
  const [errores, setErrores] = useState([]);
  const [ocupado, setOcupado] = useState(false);

  const cargar = async () => {
    try {
      const [p, s] = await Promise.all([cargarProductos(), listarStock(await obtenerCliente())]);
      setProductos(p);
      setEnStock(new Set(s.map((x) => String(x.variante_id))));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setProductos([]);
    }
  };
  useEffect(() => {
    cargar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visibles = useMemo(
    () => (productos ?? []).filter((p) => !texto || normalizarTexto(`${p.proveedor} ${p.modelo} ${p.tipo} ${p.color} ${p.talla}`).includes(normalizarTexto(texto))),
    [productos, texto]
  );
  const filas = (productos ?? []).map((p) => ({
    varianteId: String(p.id), descripcion: `${p.modelo} ${p.color} ${p.talla}`,
    cantidad: valores[p.id]?.cantidad ?? "", coste: valores[p.id]?.coste ?? String(Number(p.coste)),
  }));
  const resumen = lineasCargaInicial(filas.filter((f) => !enStock.has(f.varianteId)));
  const cambiar = (id, campo, valor) => setValores((v) => ({ ...v, [id]: { ...v[id], [campo]: valor } }));

  const guardar = async () => {
    setErrores(resumen.errores);
    if (resumen.errores.length) return;
    if (resumen.lineas.length === 0) return setErrores(["Escribe la cantidad de al menos un artículo."]);
    const ok = await confirmar({
      titulo: "¿Registrar el inventario inicial?",
      mensaje: `${resumen.lineas.length} referencia(s) y ${resumen.unidades} unidad(es) en total. Quedará en el historial; un error se corrige con un movimiento compensatorio.`,
      aceptar: "Registrar",
    });
    if (!ok) return;
    setOcupado(true);
    try {
      const n = await cargarInventarioInicial(await obtenerCliente(), resumen.lineas, "Inventario inicial");
      setMensaje({ tipo: "success", texto: `Inventario inicial registrado: ${n} referencia(s), ${resumen.unidades} unidad(es).` });
      setValores({});
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Cabecera titulo="Carga inicial de stock" descripcion="Indica solo las prendas que hay físicamente en el taller. Las filas vacías no se registran." />
      <NavInventario />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {productos === null ? <Cargando texto="Cargando catálogo…" /> : productos.length === 0 ? (
        <Aviso tipo="info">El catálogo está vacío. Añade productos en <Link to="/catalogo">Catálogo</Link>.</Aviso>
      ) : (
        <>
          <div className="d-flex flex-wrap gap-3 align-items-center mb-2">
            <div className="input-group input-group-sm" style={{ maxWidth: 380 }}>
              <span className="input-group-text"><Search size={14} aria-hidden="true" /></span>
              <input aria-label="Filtrar artículos" className="form-control" placeholder="Proveedor, modelo, color, talla…" value={texto} onChange={(e) => setTexto(e.target.value)} />
            </div>
            <span className="small" data-testid="resumen-carga">{resumen.lineas.length} referencia(s) · {resumen.unidades} unidad(es)</span>
            <button type="button" className="btn btn-primary btn-sm ms-auto" onClick={guardar} disabled={ocupado}>Registrar inventario inicial</button>
          </div>
          {errores.length > 0 && <div className="alert alert-danger small py-2" role="alert">{errores.join(" ")}</div>}
          <div className="gx-tabla">
            <div className="table-responsive" style={{ maxHeight: "65vh" }}>
              <table className="table table-sm align-middle">
                <thead><tr><th>Artículo</th><th>Color</th><th>Talla</th><th style={{ width: 110 }}>Unidades</th><th style={{ width: 130 }}>Coste ud. (€)</th></tr></thead>
                <tbody>
                  {visibles.map((p) => {
                    const ya = enStock.has(String(p.id));
                    return (
                      <tr key={p.id} className={ya ? "text-muted" : ""}>
                        <td>{p.modelo}<div className="small text-muted">{p.proveedor}</div></td>
                        <td>{p.color}</td>
                        <td>{p.talla}</td>
                        <td>
                          {ya ? <span className="small">Ya en inventario</span> : (
                            <input aria-label={`Unidades ${p.modelo} ${p.color} ${p.talla}`} className="form-control form-control-sm" inputMode="numeric"
                              value={valores[p.id]?.cantidad ?? ""} onChange={(e) => cambiar(p.id, "cantidad", e.target.value)} />
                          )}
                        </td>
                        <td>
                          {!ya && (
                            <input aria-label={`Coste ${p.modelo} ${p.color} ${p.talla}`} className="form-control form-control-sm" inputMode="decimal"
                              value={valores[p.id]?.coste ?? String(Number(p.coste))} onChange={(e) => cambiar(p.id, "coste", e.target.value)} title={`Catálogo: ${euro5(p.coste)}`} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default PaginaCargaInicial;
