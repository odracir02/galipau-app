import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Layers, Plus } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { obtenerProveedor, actualizarProveedor, archivarProveedor, listarModelos, crearModelo } from "./data/catalogoRepo";
import { FormularioModelo, FormularioProveedor } from "./Formularios";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";

/** Supplier card (or the own-products group): details, archive and its models. */
function PaginaFichaProveedor({ obtenerCliente = obtenerClienteSupabase }) {
  const { id } = useParams();
  const propios = id === "propios";
  const proveedorId = propios ? null : Number(id);
  const confirmar = useConfirmar();
  const [proveedor, setProveedor] = useState(propios ? { nombre: "Productos propios", activo: true } : null);
  const [modelos, setModelos] = useState(null);
  const [editando, setEditando] = useState(false);
  const [nuevoModelo, setNuevoModelo] = useState(false);
  const [archivados, setArchivados] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      if (!propios) setProveedor(await obtenerProveedor(sb, proveedorId));
      setModelos(await listarModelos(sb, proveedorId));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setModelos([]);
    }
  }, [obtenerCliente, propios, proveedorId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const archivar = async () => {
    const activo = !proveedor.activo;
    if (!activo && !(await confirmar({
      titulo: `¿Archivar «${proveedor.nombre}»?`,
      mensaje: "Sus modelos dejarán de aparecer en la calculadora. No se borra nada: los presupuestos guardados no cambian y podrás reactivarlo.",
      aceptar: "Archivar proveedor",
      peligro: true,
    }))) return;
    try {
      setProveedor(await archivarProveedor(await obtenerCliente(), proveedorId, activo));
      setMensaje({ tipo: "success", texto: activo ? "Proveedor reactivado." : "Proveedor archivado." });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  };

  if (!proveedor && !mensaje) return <Cargando texto="Cargando proveedor…" />;
  const visibles = (modelos ?? []).filter((m) => archivados || m.activo);

  return (
    <>
      <Link to="/catalogo/proveedores" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Proveedores</Link>
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {proveedor && (
        <>
          <div className="gx-cabecera">
            <div>
              <h1>{proveedor.nombre}{!proveedor.activo && <span className="gx-insignia gx-estado-importado ms-2 align-middle">Archivado</span>}</h1>
              <p>{propios ? "Artículos que no vienen de un proveedor habitual (no hace falta inventar uno)." : [proveedor.contacto, proveedor.telefono, proveedor.email, proveedor.referencia_cliente ? `Nº cliente ${proveedor.referencia_cliente}` : null].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
            </div>
            <div className="gx-cabecera-acciones">
              {!propios && <button type="button" className="btn btn-outline-secondary" onClick={() => setEditando(true)}>Editar datos</button>}
              {!propios && <button type="button" className="btn btn-outline-secondary" onClick={archivar}>{proveedor.activo ? "Archivar" : "Reactivar"}</button>}
              <button type="button" className="btn btn-primary btn-icono" onClick={() => setNuevoModelo(true)}><Plus size={16} aria-hidden="true" />{propios ? "Nuevo producto propio" : "Nuevo modelo"}</button>
            </div>
          </div>
          {editando && (
            <FormularioProveedor titulo="Editar proveedor" inicial={proveedor} onCancelar={() => setEditando(false)}
              onGuardar={async (d) => {
                setProveedor(await actualizarProveedor(await obtenerCliente(), proveedorId, d));
                setEditando(false);
                setMensaje({ tipo: "success", texto: "Datos del proveedor guardados." });
              }} />
          )}
          {nuevoModelo && (
            <FormularioModelo titulo={propios ? "Nuevo producto propio" : "Nuevo modelo"} onCancelar={() => setNuevoModelo(false)} textoGuardar="Crear y añadir variantes"
              onGuardar={async (d) => {
                const m = await crearModelo(await obtenerCliente(), proveedorId, d);
                setNuevoModelo(false);
                setMensaje({ tipo: "success", texto: `«${m.nombre}» creado.` });
                await cargar();
              }} />
          )}
        </>
      )}
      <div className="d-flex align-items-center gap-3 mb-2">
        <h2 className="h6 mb-0">{propios ? "Productos" : "Modelos"}</h2>
        <div className="form-check mb-0">
          <input id="mod-archivados" type="checkbox" className="form-check-input" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} />
          <label className="form-check-label small" htmlFor="mod-archivados">Mostrar archivados</label>
        </div>
      </div>
      {modelos === null ? <Cargando /> : visibles.length === 0 ? (
        <div className="gx-tabla"><EstadoVacio icono={Layers} titulo="Todavía no hay modelos">Crea uno y añade sus colores y tallas.</EstadoVacio></div>
      ) : (
        <div className="gx-tabla">
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead><tr><th>Modelo</th><th>Tipo</th><th className="d-none d-md-table-cell">Referencia</th><th className="d-none d-lg-table-cell">Descripción</th></tr></thead>
              <tbody>
                {visibles.map((m) => (
                  <tr key={m.id} className={m.activo ? "" : "text-muted"}>
                    <td><Link to={`/catalogo/modelos/${m.id}`}>{m.nombre}</Link>{!m.activo && <span className="gx-insignia gx-estado-importado ms-2">Archivado</span>}</td>
                    <td>{m.tipo}</td>
                    <td className="d-none d-md-table-cell">{m.referencia ?? "—"}</td>
                    <td className="d-none d-lg-table-cell small">{m.descripcion ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export default PaginaFichaProveedor;
