import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import { leerTodo } from "../../shared/supabase/paginar";
import { NavCatalogo } from "./PaginaCatalogo";
import { CATEGORIAS_PROPUESTAS, SIN_CLASIFICAR, resolverCategoria } from "./domain/clasificacion";
import { listarCategorias, crearCategoria, renombrarCategoria, ordenarCategoria, borrarCategoria, fusionarCategorias } from "./data/clasificacionRepo";

/** The owner's list of categories: add, rename, reorder, merge and delete (only when empty). */
function PaginaCategorias({ obtenerCliente = obtenerClienteSupabase }) {
  const confirmar = useConfirmar();
  const [categorias, setCategorias] = useState(null);
  const [usos, setUsos] = useState({});
  const [nueva, setNueva] = useState("");
  const [editando, setEditando] = useState(null); // { id, nombre }
  const [fusion, setFusion] = useState({}); // id -> target name
  const [mensaje, setMensaje] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const cats = await listarCategorias(sb);
      if (cats === null) throw new Error("La base de datos todavía no tiene la lista de categorías: aplica la migración de categorías.");
      const modelos = await leerTodo((desde, hasta) => sb.from("modelos").select("id, tipo").order("id").range(desde, hasta));
      setUsos(modelos.reduce((a, m) => ((a[m.tipo] = (a[m.tipo] ?? 0) + 1), a), {}));
      setCategorias(cats);
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setCategorias([]);
    }
  }, [obtenerCliente]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const ejecutar = async (accion, texto) => {
    setMensaje(null);
    try {
      await accion(await obtenerCliente());
      if (texto) setMensaje({ tipo: "success", texto });
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  };

  const nombres = useMemo(() => (categorias ?? []).map((c) => c.nombre), [categorias]);
  const faltan = CATEGORIAS_PROPUESTAS.filter((p) => !resolverCategoria(p, nombres));
  const siguienteOrden = () => Math.max(0, ...(categorias ?? []).filter((c) => c.nombre !== SIN_CLASIFICAR).map((c) => c.orden)) + 1;

  // Reordering renumbers the whole list (10, 20, 30…) so the order is always explicit
  const mover = (indice, paso) =>
    ejecutar(async (sb) => {
      const lista = [...categorias];
      const [c] = lista.splice(indice, 1);
      lista.splice(indice + paso, 0, c);
      for (const [i, x] of lista.entries()) if (x.orden !== (i + 1) * 10) await ordenarCategoria(sb, x.id, (i + 1) * 10);
    });

  if (categorias === null) return <Cargando texto="Cargando categorías…" />;
  return (
    <>
      <Link to="/catalogo/clasificar" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Clasificar modelos</Link>
      <Cabecera titulo="Categorías" descripcion="Tu lista de categorías del catálogo. Renombrar una categoría la cambia en todos sus modelos." />
      <NavCatalogo />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}

      <form className="gx-tarjeta d-flex flex-wrap gap-2 align-items-end mb-3" onSubmit={(e) => {
        e.preventDefault();
        if (nueva.trim()) ejecutar((sb) => crearCategoria(sb, nueva, siguienteOrden()), `Categoría «${nueva.trim()}» añadida.`).then(() => setNueva(""));
      }}>
        <div>
          <label className="form-label small mb-0" htmlFor="cat-nueva">Nueva categoría</label>
          <input id="cat-nueva" className="form-control form-control-sm" value={nueva} onChange={(e) => setNueva(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!nueva.trim()}>Añadir</button>
        {faltan.length > 0 && (
          <button type="button" className="btn btn-sm btn-outline-primary ms-auto"
            onClick={() => ejecutar(async (sb) => {
              let orden = siguienteOrden();
              for (const nombre of faltan) await crearCategoria(sb, nombre, nombre === SIN_CLASIFICAR ? 1000 : orden++);
            }, `Añadidas: ${faltan.join(", ")}.`)}>
            Añadir las categorías propuestas ({faltan.length})
          </button>
        )}
      </form>

      <div className="gx-tabla">
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead><tr><th>Orden</th><th>Categoría</th><th className="text-end">Modelos</th><th>Acciones</th></tr></thead>
            <tbody>
              {categorias.map((c, i) => {
                const enUso = usos[c.nombre] ?? 0;
                return (
                  <tr key={c.id}>
                    <td className="text-nowrap">
                      <button type="button" className="btn btn-sm btn-link p-0 me-1" aria-label={`Subir ${c.nombre}`} disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp size={16} /></button>
                      <button type="button" className="btn btn-sm btn-link p-0" aria-label={`Bajar ${c.nombre}`} disabled={i === categorias.length - 1} onClick={() => mover(i, 1)}><ArrowDown size={16} /></button>
                    </td>
                    <td>
                      {editando?.id === c.id ? (
                        <form className="d-flex gap-1" onSubmit={(e) => {
                          e.preventDefault();
                          ejecutar((sb) => renombrarCategoria(sb, c.id, editando.nombre), `Renombrada a «${editando.nombre.trim()}»${enUso ? ` en ${enUso} modelos` : ""}.`).then(() => setEditando(null));
                        }}>
                          <input className="form-control form-control-sm" aria-label={`Nuevo nombre de ${c.nombre}`} value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} />
                          <button type="submit" className="btn btn-sm btn-primary" disabled={!editando.nombre.trim()}>Guardar</button>
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditando(null)}>Cancelar</button>
                        </form>
                      ) : c.nombre}
                    </td>
                    <td className="text-end">{enUso}</td>
                    <td>
                      <div className="d-flex flex-wrap gap-1">
                      {c.nombre !== SIN_CLASIFICAR && editando?.id !== c.id && (
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditando({ id: c.id, nombre: c.nombre })}>Renombrar</button>
                      )}
                      {c.nombre !== SIN_CLASIFICAR && enUso === 0 && (
                        <button type="button" className="btn btn-sm btn-outline-danger"
                          onClick={async () => (await confirmar({ titulo: `¿Borrar «${c.nombre}»?`, mensaje: "No tiene modelos. Se quita de la lista.", aceptar: "Borrar", peligro: true })) && ejecutar((sb) => borrarCategoria(sb, c.id), `«${c.nombre}» borrada.`)}>
                          Borrar
                        </button>
                      )}
                      {c.nombre !== SIN_CLASIFICAR && enUso > 0 && (
                        <span className="d-inline-flex gap-1">
                          <select className="form-select form-select-sm w-auto" aria-label={`Fusionar ${c.nombre} con`} value={fusion[c.id] ?? ""} onChange={(e) => setFusion({ ...fusion, [c.id]: e.target.value })}>
                            <option value="">Fusionar con…</option>
                            {nombres.filter((x) => x !== c.nombre).map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                          {fusion[c.id] && (
                            <button type="button" className="btn btn-sm btn-outline-primary"
                              onClick={async () => (await confirmar({ titulo: `¿Fusionar «${c.nombre}» con «${fusion[c.id]}»?`, mensaje: `Sus ${enUso} modelos pasan a «${fusion[c.id]}» y «${c.nombre}» se quita de la lista. Solo cambia la categoría.`, aceptar: "Fusionar" }))
                                && ejecutar((sb) => fusionarCategorias(sb, c.nombre, fusion[c.id]), `«${c.nombre}» fusionada con «${fusion[c.id]}».`)}>
                              Fusionar
                            </button>
                          )}
                        </span>
                      )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default PaginaCategorias;
