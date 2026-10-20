import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Truck } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { listarProveedores, crearProveedor, listarCatalogoAdmin } from "./data/catalogoRepo";
import { normalizarTexto } from "../../domain/catalogo";
import { FormularioProveedor } from "./Formularios";
import { NavCatalogo } from "./PaginaCatalogo";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";

/** Suppliers (and the workshop's own products), with search and archived filter. */
function PaginaProveedores({ obtenerCliente = obtenerClienteSupabase }) {
  const [proveedores, setProveedores] = useState(null);
  const [resumen, setResumen] = useState([]);
  const [texto, setTexto] = useState("");
  const [archivados, setArchivados] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const [p, r] = await Promise.all([listarProveedores(sb), listarCatalogoAdmin(sb)]);
      setProveedores(p);
      setResumen(r);
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setProveedores([]);
    }
  }, [obtenerCliente]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cuenta = useMemo(() => {
    const c = {};
    for (const r of resumen) {
      const k = r.propio ? "propios" : r.proveedor_id;
      c[k] ??= { modelos: new Set(), variantes: 0 };
      c[k].modelos.add(r.modelo_id);
      if (r.variante_activa) c[k].variantes += 1;
    }
    return c;
  }, [resumen]);

  const visibles = (proveedores ?? []).filter((p) => (archivados || p.activo) && (!texto || normalizarTexto(`${p.nombre} ${p.contacto ?? ""}`).includes(normalizarTexto(texto))));
  const detalle = (k) => (cuenta[k] ? `${cuenta[k].modelos.size} modelo(s) · ${cuenta[k].variantes} variante(s)` : "Sin modelos");

  return (
    <>
      <Cabecera titulo="Proveedores" descripcion="Proveedores habituales y productos propios del taller."
        acciones={<button type="button" className="btn btn-primary btn-icono" onClick={() => setNuevo(true)}><Plus size={16} aria-hidden="true" />Nuevo proveedor</button>} />
      <NavCatalogo />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {nuevo && (
        <FormularioProveedor titulo="Nuevo proveedor" onCancelar={() => setNuevo(false)} textoGuardar="Crear proveedor"
          onGuardar={async (d) => {
            const p = await crearProveedor(await obtenerCliente(), d);
            setNuevo(false);
            setMensaje({ tipo: "success", texto: `Proveedor «${p.nombre}» creado. Ahora puedes añadirle modelos.` });
            await cargar();
          }} />
      )}
      <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
        <div className="input-group input-group-sm" style={{ maxWidth: 380 }}>
          <span className="input-group-text"><Search size={14} aria-hidden="true" /></span>
          <input aria-label="Buscar proveedor" className="form-control" placeholder="Buscar proveedor…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <div className="form-check">
          <input id="prov-archivados" type="checkbox" className="form-check-input" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} />
          <label className="form-check-label small" htmlFor="prov-archivados">Mostrar archivados</label>
        </div>
      </div>
      {proveedores === null ? <Cargando texto="Cargando proveedores…" /> : (
        <div className="row g-3">
          <div className="col-md-6 col-xl-4">
            <Link to="/catalogo/proveedores/propios" className="gx-kpi d-block text-reset text-decoration-none">
              <div className="gx-kpi-etiqueta">Sin proveedor habitual</div>
              <div className="h6 mt-1 mb-0">Productos propios</div>
              <div className="gx-kpi-detalle">{detalle("propios")}</div>
            </Link>
          </div>
          {visibles.map((p) => (
            <div key={p.id} className="col-md-6 col-xl-4">
              <Link to={`/catalogo/proveedores/${p.id}`} className={`gx-kpi d-block text-reset text-decoration-none ${p.activo ? "" : "opacity-75"}`}>
                <div className="gx-kpi-etiqueta">{p.contacto || "Proveedor"}{!p.activo && <span className="gx-insignia gx-estado-importado ms-2">Archivado</span>}</div>
                <div className="h6 mt-1 mb-0">{p.nombre}</div>
                <div className="gx-kpi-detalle">{detalle(p.id)}</div>
              </Link>
            </div>
          ))}
          {visibles.length === 0 && (
            <div className="col-12">
              <div className="gx-tabla">
                <EstadoVacio icono={Truck} titulo={texto ? "Sin resultados" : "Todavía no hay proveedores"}>
                  {texto ? "Prueba con otro nombre." : "Crea el primero con «Nuevo proveedor»."}
                </EstadoVacio>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default PaginaProveedores;
