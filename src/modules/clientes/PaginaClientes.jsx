import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, UserPlus, Users } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { buscarClientes, crearCliente, actualizarCliente, archivarCliente } from "./clientesRepo";
import FormularioCliente from "./FormularioCliente";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";

/** Customer list: search, create, edit and archive (customers are never deleted). */
function PaginaClientes({ obtenerCliente = obtenerClienteSupabase }) {
  const [texto, setTexto] = useState("");
  const [archivados, setArchivados] = useState(false);
  const [clientes, setClientes] = useState(null);
  const [editando, setEditando] = useState(null); // null | "nuevo" | client
  const [mensaje, setMensaje] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setClientes(await buscarClientes(await obtenerCliente(), texto, 500, { incluirArchivados: archivados }));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setClientes([]);
    }
  }, [obtenerCliente, texto, archivados]);

  useEffect(() => {
    const t = setTimeout(cargar, 200);
    return () => clearTimeout(t);
  }, [cargar]);

  const guardar = async (datos) => {
    const sb = await obtenerCliente();
    const guardado = editando === "nuevo" ? await crearCliente(sb, datos) : await actualizarCliente(sb, editando.id, datos);
    setMensaje({ tipo: "success", texto: `Cliente «${guardado.nombre}» guardado.` });
    setEditando(null);
    await cargar();
  };

  const archivar = async (c) => {
    try {
      await archivarCliente(await obtenerCliente(), c.id, !c.archivado);
      setMensaje({ tipo: "success", texto: c.archivado ? `«${c.nombre}» vuelve a estar activo.` : `«${c.nombre}» archivado: ya no aparece al buscar clientes en los presupuestos.` });
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  };

  return (
    <>
      <Cabecera titulo="Clientes" descripcion="Fichas de clientes para los presupuestos."
        acciones={<button type="button" className="btn btn-primary btn-icono" onClick={() => setEditando("nuevo")}><UserPlus size={16} aria-hidden="true" />Nuevo cliente</button>} />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {editando && (
        <div className="mb-3">
          <FormularioCliente key={editando === "nuevo" ? "nuevo" : editando.id} titulo={editando === "nuevo" ? "Nuevo cliente" : "Editar cliente"}
            inicial={editando === "nuevo" ? {} : editando} onGuardar={guardar} onCancelar={() => setEditando(null)} />
        </div>
      )}
      <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
        <div className="input-group" style={{ maxWidth: 420 }}>
          <span className="input-group-text"><Search size={16} aria-hidden="true" /></span>
          <input aria-label="Buscar clientes" className="form-control" placeholder="Buscar por nombre…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
        <div className="form-check">
          <input id="ver-archivados" type="checkbox" className="form-check-input" checked={archivados} onChange={(e) => setArchivados(e.target.checked)} />
          <label className="form-check-label" htmlFor="ver-archivados">Mostrar archivados</label>
        </div>
      </div>
      {clientes === null ? <Cargando texto="Cargando clientes…" /> : clientes.length === 0 ? (
        <div className="gx-tabla">
          <EstadoVacio icono={Users} titulo={texto ? "Sin resultados" : "Todavía no hay clientes"}>
            {texto ? "Prueba con otro nombre." : "Crea clientes aquí o directamente desde un presupuesto."}
          </EstadoVacio>
        </div>
      ) : (
        <div className="gx-tabla">
          <div className="table-responsive">
            <table className="table table-hover">
              <thead><tr><th>Nombre</th><th className="d-none d-md-table-cell">NIF / CIF</th><th className="d-none d-lg-table-cell">Contacto</th><th className="d-none d-md-table-cell">Población</th><th /></tr></thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id} className={c.archivado ? "text-muted" : ""}>
                    <td className="fw-semibold">{c.nombre}{c.archivado && <span className="gx-insignia gx-estado-importado ms-2">Archivado</span>}</td>
                    <td className="d-none d-md-table-cell">{c.nif ?? "—"}</td>
                    <td className="d-none d-lg-table-cell small">{[c.email, c.telefono].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="d-none d-md-table-cell">{c.ciudad ?? "—"}</td>
                    <td className="text-end text-nowrap">
                      <Link className="btn btn-sm btn-outline-secondary" to={`/presupuestos?cliente=${encodeURIComponent(c.nombre)}`}>Presupuestos</Link>{" "}
                      <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setEditando(c)}>Editar</button>{" "}
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => archivar(c)}>{c.archivado ? "Reactivar" : "Archivar"}</button>
                    </td>
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

export default PaginaClientes;
