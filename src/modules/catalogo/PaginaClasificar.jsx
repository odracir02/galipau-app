import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Tags } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import Paginacion from "../../shared/ui/Paginacion";
import { paginar, POR_PAGINA } from "../../shared/ui/paginado";
import { normalizarTexto } from "../../domain/catalogo";
import { NavCatalogo } from "./PaginaCatalogo";
import { SIN_CLASIFICAR, sugerirCategorias, familiaDe } from "./domain/clasificacion";
import { listarCategorias, listarModelosClasificacion, clasificarModelos, deshacerClasificacion, crearCategoria } from "./data/clasificacionRepo";

const FILTROS = { texto: "", proveedor: "", marca: "", categoria: SIN_CLASIFICAR, estado: "todos", sugerencia: "" };
const n = (v) => v.toLocaleString("es-ES");
const pl = (v, uno, varios) => `${n(v)} ${v === 1 ? uno : varios}`;

/** Bulk classification of catalogue models: only the category changes. */
function PaginaClasificar({ obtenerCliente = obtenerClienteSupabase }) {
  const confirmar = useConfirmar();
  const [modelos, setModelos] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [f, setF] = useState(FILTROS);
  const [orden, setOrden] = useState("tarifa");
  const [pagina, setPagina] = useState(1);
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [ultimo, setUltimo] = useState(null); // last clicked row (shift+click selects the range)
  const [destino, setDestino] = useState("");
  const [vista, setVista] = useState(null); // preview: { cambios: [{ modelo, de, a }], nuevas: string[], sinCambio: number }
  const [resultado, setResultado] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const texto = useDeferredValue(f.texto);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const [lista, cats] = await Promise.all([listarModelosClasificacion(sb), listarCategorias(sb)]);
      setModelos(lista);
      setCategorias(cats ?? []);
      if (cats === null) setMensaje({ tipo: "warning", texto: "La base de datos todavía no tiene la lista de categorías: aplica la migración de categorías." });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setModelos([]);
    }
  }, [obtenerCliente]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const nombresCategorias = useMemo(() => categorias.map((c) => c.nombre), [categorias]);
  const sugerencias = useMemo(() => sugerirCategorias(modelos ?? [], nombresCategorias), [modelos, nombresCategorias]);
  const opciones = useMemo(() => {
    const unicos = (k) => [...new Set((modelos ?? []).map((m) => m[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const enUso = new Set((modelos ?? []).map((m) => m.tipo));
    return { proveedores: unicos("proveedor"), marcas: unicos("marca"), categorias: [...nombresCategorias, ...[...enUso].filter((t) => !nombresCategorias.includes(t))] };
  }, [modelos, nombresCategorias]);

  const visibles = useMemo(() => {
    const q = normalizarTexto(texto);
    const lista = (modelos ?? []).filter((m) =>
      (!f.proveedor || m.proveedor === f.proveedor) &&
      (!f.marca || m.marca === f.marca) &&
      (!f.categoria || m.tipo === f.categoria) &&
      (f.estado === "todos" || (f.estado === "activos" ? m.activo : !m.activo)) &&
      (!f.sugerencia || (f.sugerencia === "con" ? sugerencias.has(m.id) : !sugerencias.has(m.id))) &&
      (!q || normalizarTexto(`${m.nombre} ${m.marca ?? ""} ${m.referencia ?? ""} ${m.proveedor} ${m.descripcion ?? ""}`).includes(q))
    );
    return orden === "nombre" ? [...lista].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")) : lista;
  }, [modelos, f, texto, orden, sugerencias]);

  const cambiarFiltro = (k) => (e) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setPagina(1);
    setUltimo(null);
  };
  const alternar = (m, indice, conShift) => {
    setSeleccion((s) => {
      const nueva = new Set(s);
      if (conShift && ultimo !== null) {
        const [a, b] = [Math.min(ultimo, indice), Math.max(ultimo, indice)];
        const marcar = !s.has(m.id);
        for (const x of visibles.slice(a, b + 1)) (marcar ? nueva.add(x.id) : nueva.delete(x.id));
      } else if (nueva.has(m.id)) nueva.delete(m.id);
      else nueva.add(m.id);
      return nueva;
    });
    setUltimo(indice);
  };
  const seleccionarFamilia = (m) => {
    const k = `${m.proveedor_id}|${familiaDe(m.nombre)}`;
    setSeleccion((s) => new Set([...s, ...visibles.filter((x) => `${x.proveedor_id}|${familiaDe(x.nombre)}` === k).map((x) => x.id)]));
  };
  const pagina_ = paginar(visibles, pagina);
  const elegidos = (modelos ?? []).filter((m) => seleccion.has(m.id));
  const conSugerencia = elegidos.filter((m) => sugerencias.has(m.id));

  const prever = (pares) => {
    const cambios = pares.filter(({ modelo, a }) => modelo.tipo !== a).map(({ modelo, a }) => ({ modelo, de: modelo.tipo, a }));
    const nuevas = [...new Set(pares.map((p) => p.a).filter((a) => !nombresCategorias.includes(a)))];
    setVista({ cambios, nuevas, sinCambio: pares.length - cambios.length });
    setResultado(null);
  };

  const aplicar = async () => {
    const reclasificados = vista.cambios.filter((c) => c.de !== SIN_CLASIFICAR).length;
    const ok = await confirmar({
      titulo: `¿Cambiar la categoría de ${pl(vista.cambios.length, "modelo", "modelos")}?`,
      mensaje: `${reclasificados ? `${pl(reclasificados, "modelo ya tenía", "modelos ya tenían")} otra categoría y la cambiará. ` : ""}Solo cambia la categoría: precios, IVA, referencias, colores, tallas, archivado, presupuestos e inventario no cambian. Se puede deshacer.`,
      aceptar: "Clasificar",
    });
    if (!ok) return;
    setOcupado(true);
    setMensaje(null);
    try {
      const sb = await obtenerCliente();
      let orden_ = Math.max(0, ...categorias.filter((c) => c.nombre !== SIN_CLASIFICAR).map((c) => c.orden)) + 1;
      for (const nombre of vista.nuevas) await crearCategoria(sb, nombre, orden_++);
      const porCategoria = new Map();
      for (const c of vista.cambios) porCategoria.set(c.a, [...(porCategoria.get(c.a) ?? []), c.modelo.id]);
      const lotes = [];
      let cambiados = 0;
      for (const [categoria, ids] of porCategoria) {
        const r = await clasificarModelos(sb, ids, categoria);
        lotes.push(r.lote);
        cambiados += r.cambiados;
      }
      setResultado({ lotes, cambiados });
      setVista(null);
      setSeleccion(new Set());
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    } finally {
      setOcupado(false);
    }
  };

  const deshacer = async () => {
    setOcupado(true);
    try {
      const sb = await obtenerCliente();
      let n_ = 0;
      for (const lote of resultado.lotes) n_ += await deshacerClasificacion(sb, lote);
      setResultado(null);
      setMensaje({ tipo: "success", texto: `Deshecho: ${pl(n_, "modelo vuelve", "modelos vuelven")} a su categoría anterior.` });
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    } finally {
      setOcupado(false);
    }
  };

  if (modelos === null) return <Cargando texto="Cargando modelos…" />;
  const sinClasificar = modelos.filter((m) => m.tipo === SIN_CLASIFICAR).length;
  const porGrupo = vista ? [...vista.cambios.reduce((g, c) => g.set(`${c.de} → ${c.a}`, [...(g.get(`${c.de} → ${c.a}`) ?? []), c.modelo.nombre]), new Map())] : [];

  return (
    <>
      <Cabecera titulo="Clasificar modelos" descripcion="Pon la categoría a muchos modelos a la vez. Solo cambia la categoría: colores, tallas y precios no se tocan."
        acciones={<Link to="/catalogo/categorias" className="btn btn-outline-secondary btn-icono"><Tags size={16} aria-hidden="true" />Gestionar categorías</Link>} />
      <NavCatalogo />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {resultado && (
        <Aviso tipo="success">
          {pl(resultado.cambiados, "modelo clasificado", "modelos clasificados")}.{" "}
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline" disabled={ocupado} onClick={deshacer}>Deshacer</button>
        </Aviso>
      )}
      <p className="small text-muted">
        {pl(sinClasificar, "modelo sin clasificar", "modelos sin clasificar")} · {pl(sugerencias.size, "con sugerencia", "con sugerencia")}. Consejo: ordena «como en la tarifa» y marca un modelo, luego otro con Mayús pulsado para seleccionar todo el tramo.
      </p>

      <form className="gx-tarjeta row g-2 mx-0 mb-3 py-3" onSubmit={(e) => e.preventDefault()} aria-label="Filtros de modelos">
        <div className="col-12 col-xl-3">
          <label className="form-label small mb-0" htmlFor="cl-texto">Buscar</label>
          <div className="input-group input-group-sm">
            <span className="input-group-text"><Search size={14} aria-hidden="true" /></span>
            <input id="cl-texto" className="form-control" placeholder="Modelo, marca, referencia…" value={f.texto} onChange={cambiarFiltro("texto")} />
          </div>
        </div>
        {[
          ["cl-proveedor", "Proveedor", "proveedor", opciones.proveedores, "Todos"],
          ["cl-marca", "Marca", "marca", opciones.marcas, "Todas"],
          ["cl-categoria", "Categoría", "categoria", opciones.categorias, "Todas"],
        ].map(([id, etiqueta, k, lista, todos]) => (
          <div className="col-6 col-md-3 col-xl" key={id}>
            <label className="form-label small mb-0" htmlFor={id}>{etiqueta}</label>
            <select id={id} className="form-select form-select-sm" value={f[k]} onChange={cambiarFiltro(k)}>
              <option value="">{todos}</option>
              {lista.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        ))}
        <div className="col-6 col-md-3 col-xl">
          <label className="form-label small mb-0" htmlFor="cl-sugerencia">Sugerencia</label>
          <select id="cl-sugerencia" className="form-select form-select-sm" value={f.sugerencia} onChange={cambiarFiltro("sugerencia")}>
            <option value="">Todas</option><option value="con">Con sugerencia</option><option value="sin">Sin sugerencia</option>
          </select>
        </div>
        <div className="col-6 col-md-3 col-xl">
          <label className="form-label small mb-0" htmlFor="cl-orden">Orden</label>
          <select id="cl-orden" className="form-select form-select-sm" value={orden} onChange={(e) => setOrden(e.target.value)}>
            <option value="tarifa">Como en la tarifa</option><option value="nombre">Por nombre</option>
          </select>
        </div>
      </form>

      <div className="gx-tarjeta mb-3 py-2 d-flex flex-wrap align-items-center gap-2" role="toolbar" aria-label="Acciones de clasificación">
        <strong className="me-1">{pl(seleccion.size, "seleccionado", "seleccionados")}</strong>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSeleccion((s) => new Set([...s, ...pagina_.map((m) => m.id)]))}>Seleccionar página</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSeleccion((s) => new Set([...s, ...visibles.map((m) => m.id)]))}>Seleccionar los {n(visibles.length)} filtrados</button>
        {seleccion.size > 0 && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSeleccion(new Set())}>Quitar selección</button>}
        <span className="vr mx-1" />
        <label htmlFor="cl-destino" className="small mb-0">Categoría</label>
        <select id="cl-destino" className="form-select form-select-sm w-auto" value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Elegir…</option>
          {nombresCategorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-primary" disabled={!destino || seleccion.size === 0} onClick={() => prever(elegidos.map((modelo) => ({ modelo, a: destino })))}>
          Asignar a {pl(seleccion.size, "modelo", "modelos")}
        </button>
        <button type="button" className="btn btn-sm btn-outline-primary" disabled={conSugerencia.length === 0} onClick={() => prever(conSugerencia.map((modelo) => ({ modelo, a: sugerencias.get(modelo.id).categoria })))}>
          Aceptar sugerencias ({n(conSugerencia.length)})
        </button>
      </div>

      {vista && (
        <section className="gx-tarjeta mb-3 border-primary" aria-labelledby="t-vista">
          <h2 id="t-vista" className="h6">Vista previa: {pl(vista.cambios.length, "modelo cambia", "modelos cambian")} de categoría</h2>
          {vista.cambios.length === 0 ? <p className="small mb-2">Los modelos elegidos ya están en esa categoría: no hay nada que cambiar.</p> : (
            <ul className="small mb-2">
              {porGrupo.map(([grupo, nombres]) => (
                <li key={grupo}><strong>{grupo}</strong> ({n(nombres.length)}): {nombres.slice(0, 8).join(", ")}{nombres.length > 8 ? `… y ${n(nombres.length - 8)} más` : ""}</li>
              ))}
            </ul>
          )}
          {vista.nuevas.length > 0 && <p className="small mb-2">Se añadirán a la lista las categorías: {vista.nuevas.join(", ")}.</p>}
          {vista.sinCambio > 0 && <p className="small text-muted mb-2">{pl(vista.sinCambio, "modelo ya estaba", "modelos ya estaban")} en esa categoría.</p>}
          <p className="small text-muted">Solo cambia la categoría. Precios, IVA, referencias, colores, tallas, archivado, presupuestos e inventario no cambian.</p>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-primary" disabled={ocupado || vista.cambios.length === 0} onClick={aplicar}>{ocupado ? "Guardando…" : "Confirmar"}</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setVista(null)}>Cancelar</button>
          </div>
        </section>
      )}

      <div className="gx-tabla">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead>
              <tr>
                <th style={{ width: "2.5rem" }}><span className="visually-hidden">Seleccionar</span></th>
                <th>Modelo</th><th className="d-none d-md-table-cell">Proveedor</th><th className="d-none d-lg-table-cell">Marca</th><th>Categoría</th><th>Sugerencia</th><th className="d-none d-md-table-cell text-end">Variantes</th>
              </tr>
            </thead>
            <tbody>
              {pagina_.map((m, i) => {
                const s = sugerencias.get(m.id);
                const indice = (pagina - 1) * POR_PAGINA + i;
                return (
                  <tr key={m.id} className={m.activo ? "" : "text-muted"}>
                    <td>
                      <input type="checkbox" className="form-check-input" aria-label={`Seleccionar ${m.nombre}`} checked={seleccion.has(m.id)}
                        onChange={() => {}} onClick={(e) => alternar(m, indice, e.shiftKey)} />
                    </td>
                    <td>
                      <Link to={`/catalogo/modelos/${m.id}`}>{m.nombre}</Link>
                      {!m.activo && <span className="gx-insignia gx-estado-importado ms-2">Archivado</span>}
                      <button type="button" className="btn btn-link btn-sm p-0 ms-2 small" onClick={() => seleccionarFamilia(m)} title="Seleccionar los modelos de la misma familia">familia</button>
                    </td>
                    <td className="d-none d-md-table-cell">{m.proveedor}</td>
                    <td className="d-none d-lg-table-cell">{m.marca ?? ""}</td>
                    <td>{m.tipo}</td>
                    <td className="small">
                      {s ? (
                        <>
                          <span className={`gx-insignia ${s.confianza === "alta" ? "gx-estado-aceptado" : "gx-estado-en_produccion"}`}>{s.categoria}{s.existe ? "" : " (nueva)"} · {s.confianza}</span>
                          <div className="text-muted">{s.motivo}</div>
                        </>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="d-none d-md-table-cell text-end">{m.variantes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="d-flex flex-wrap justify-content-between align-items-center border-top">
          <div className="small text-muted px-3 py-2">{pl(visibles.length, "modelo", "modelos")}</div>
          <Paginacion total={visibles.length} pagina={pagina} onCambiar={setPagina} etiqueta="Páginas de modelos" />
        </div>
      </div>
    </>
  );
}

export default PaginaClasificar;
