import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Upload } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";
import { NavCatalogo } from "../catalogo/PaginaCatalogo";
import { listarCatalogoAdmin } from "../catalogo/data/catalogoRepo";
import { describirPrecio } from "../catalogo/domain/catalogo";
import { INTERPRETACIONES } from "./domain/comparar";
import { listarImportacionesTarifa, listarProveedoresTarifa, obtenerImportacionTarifa, listarCambiosImportacion, revertirTarifa } from "./data/tarifasRepo";

const fecha = (iso) => (iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "");
const NOMBRE_ACCION = { alta_proveedor: "Proveedor nuevo", alta_modelo: "Modelo nuevo", alta_variante: "Variante nueva", precio: "Precio", archivar: "Archivada", tarifas: "Modalidades", datos_modelo: "Marca / referencia" };
const NOMBRE_REVERSION = {
  precios_restaurados: "precios restaurados", precios_conservados: "precios conservados (cambiados después)", variantes_borradas: "variantes nuevas retiradas",
  variantes_archivadas: "variantes archivadas (en uso)", reactivadas: "variantes reactivadas", tarifas_restauradas: "modalidades restauradas",
  modelos_borrados: "modelos retirados", proveedores_borrados: "proveedores retirados", datos_modelo_restaurados: "marcas o referencias vaciadas",
};

const Estado = ({ imp }) =>
  imp.revertida_en ? <span className="gx-insignia gx-estado-importado">Revertida {fecha(imp.revertida_en)}</span> : <span className="gx-insignia gx-estado-aceptado">Aplicada</span>;

/** History of supplier price-list imports */
export function PaginaTarifas({ obtenerCliente = obtenerClienteSupabase }) {
  const [lista, setLista] = useState(null);
  const [proveedores, setProveedores] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const sb = await obtenerCliente();
        setProveedores(Object.fromEntries((await listarProveedoresTarifa(sb)).map((p) => [p.id, p])));
        setLista(await listarImportacionesTarifa(sb));
      } catch (e) {
        setError(e.message);
        setLista([]);
      }
    })();
  }, [obtenerCliente]);

  return (
    <>
      <Cabecera titulo="Tarifas de proveedores" descripcion="Cada importación queda registrada con su archivo, sus cambios y quién la hizo. Se puede revisar y revertir."
        acciones={<Link to="/catalogo/tarifas/importar" className="btn btn-primary btn-icono"><Upload size={16} aria-hidden="true" />Importar tarifa</Link>} />
      <NavCatalogo />
      {error && <Aviso tipo="danger">{error}</Aviso>}
      {lista === null ? <Cargando texto="Cargando importaciones…" /> : lista.length === 0 ? (
        <EstadoVacio titulo="Todavía no se ha importado ninguna tarifa" accion={<Link to="/catalogo/tarifas/importar" className="btn btn-primary">Importar la primera tarifa</Link>}>
          Sube el Excel del proveedor: verás qué cambia antes de guardar nada.
        </EstadoVacio>
      ) : (
        <div className="gx-tabla table-responsive">
          <table className="table mb-0">
            <thead><tr><th>Nº</th><th>Fecha</th><th>Proveedor</th><th>Archivo</th><th>Modalidad</th><th>Cambios</th><th>Estado</th></tr></thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id}>
                  <td><Link to={`/catalogo/tarifas/${i.id}`}>{i.id}</Link></td>
                  <td>{fecha(i.creada_en)}</td>
                  <td>{proveedores[i.proveedor_id]?.nombre ?? "—"}</td>
                  <td className="small">{i.resumen?.archivo?.nombre}</td>
                  <td>{i.resumen?.modalidad}</td>
                  <td className="small">{Object.entries(i.resumen?.resumen?.operaciones ?? {}).map(([k, n]) => `${n} ${k}`).join(" · ")}</td>
                  <td><Estado imp={i} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const describirCambio = (c) => {
  if (c.accion === "precio" && c.despues?.modalidad) return `${describirPrecio(c.antes)} → ${describirPrecio(c.despues)} (${c.despues.modalidad})`;
  if (c.accion === "precio") return `${describirPrecio(c.antes)} → ${describirPrecio(c.despues)}`;
  if (c.accion === "tarifas") return `${(c.antes?.tarifas ?? []).length} → ${(c.despues?.tarifas ?? []).length} modalidades`;
  if (c.accion === "datos_modelo") return Object.entries(c.despues ?? {}).map(([k, v]) => `${k}: — → ${v}`).join(" · ");
  return "";
};

/** One import: file, options, every change, and the safe revert */
export function PaginaImportacionTarifa({ obtenerCliente = obtenerClienteSupabase }) {
  const { id } = useParams();
  const confirmar = useConfirmar();
  const [imp, setImp] = useState(null);
  const [cambios, setCambios] = useState([]);
  const [variantes, setVariantes] = useState({});
  const [mensaje, setMensaje] = useState(null);
  const [revirtiendo, setRevirtiendo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      setImp(await obtenerImportacionTarifa(sb, Number(id)));
      setCambios(await listarCambiosImportacion(sb, Number(id)));
      setVariantes(Object.fromEntries((await listarCatalogoAdmin(sb)).map((v) => [v.variante_id, v])));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  }, [obtenerCliente, id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const modelos = useMemo(() => Object.fromEntries(Object.values(variantes).map((v) => [v.modelo_id, v.modelo])), [variantes]);
  const porAccion = useMemo(() => cambios.reduce((a, c) => ((a[c.accion] = (a[c.accion] ?? 0) + 1), a), {}), [cambios]);

  const revertir = async () => {
    const ok = await confirmar({
      titulo: `¿Revertir la importación nº ${id}?`,
      mensaje: "Se restauran los precios anteriores salvo los que se hayan cambiado después a mano. Las variantes nuevas se retiran, o se archivan si ya se usan en presupuestos o en inventario. Los presupuestos y el stock no cambian.",
      aceptar: "Revertir",
      peligro: true,
    });
    if (!ok) return;
    setRevirtiendo(true);
    try {
      const r = await revertirTarifa(await obtenerCliente(), Number(id));
      const partes = Object.entries(r).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${NOMBRE_REVERSION[k] ?? k}`);
      setMensaje({ tipo: "success", texto: `Importación revertida: ${partes.join(", ") || "no había nada que deshacer"}.` });
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    } finally {
      setRevirtiendo(false);
    }
  };

  if (!imp && !mensaje) return <Cargando texto="Cargando importación…" />;
  const r = imp?.resumen ?? {};
  return (
    <>
      <Link to="/catalogo/tarifas" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Tarifas de proveedores</Link>
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {imp && (
        <>
          <Cabecera titulo={`Importación de tarifa nº ${imp.id}`} descripcion={`${fecha(imp.creada_en)} · ${r.archivo?.nombre ?? ""}`}
            acciones={!imp.revertida_en && <button type="button" className="btn btn-outline-danger" disabled={revirtiendo} onClick={revertir}>{revirtiendo ? "Revirtiendo…" : "Revertir"}</button>}>
            <Estado imp={imp} />
          </Cabecera>
          <dl className="row small">
            <dt className="col-sm-3">Archivo</dt><dd className="col-sm-9">{r.archivo?.nombre} · formato {r.archivo?.formato} · hoja «{r.archivo?.hoja}» · SHA-256 <code className="text-break">{r.archivo?.sha256}</code></dd>
            <dt className="col-sm-3">Precio usado</dt><dd className="col-sm-9">Modalidad {r.modalidad} · {INTERPRETACIONES[r.interpretacion] ?? r.interpretacion} · IVA {r.iva} %</dd>
            <dt className="col-sm-3">Usuario</dt><dd className="col-sm-9"><code>{imp.usuario ?? "—"}</code></dd>
            <dt className="col-sm-3">Análisis</dt><dd className="col-sm-9">{Object.entries(r.resumen?.analisis ?? {}).map(([k, n]) => `${k}: ${n}`).join(" · ")}</dd>
            <dt className="col-sm-3">Conflictos resueltos</dt>
            <dd className="col-sm-9">{Object.keys(r.resoluciones?.equivalencias ?? {}).length} modelos · {Object.keys(r.resoluciones?.filaElegida ?? {}).length} filas repetidas</dd>
            <dt className="col-sm-3">Cambios</dt><dd className="col-sm-9">{Object.entries(porAccion).map(([k, n]) => `${n} ${NOMBRE_ACCION[k] ?? k}`).join(" · ")}</dd>
            {r.reversion && <><dt className="col-sm-3">Reversión</dt><dd className="col-sm-9">{Object.entries(r.reversion).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${NOMBRE_REVERSION[k] ?? k}`).join(", ")}</dd></>}
          </dl>
          <div className="gx-tabla table-responsive">
            <table className="table table-sm mb-0 small">
              <thead><tr><th>Cambio</th><th>Artículo</th><th>Detalle</th></tr></thead>
              <tbody>
                {cambios.slice(0, 500).map((c) => {
                  const v = variantes[c.variante_id];
                  return (
                    <tr key={c.id}>
                      <td>{NOMBRE_ACCION[c.accion] ?? c.accion}</td>
                      <td>{v ? `${v.modelo} · ${v.color} · ${v.talla}` : c.variante_id ? `Variante ${c.variante_id} (ya no existe)` : c.modelo_id ? (modelos[c.modelo_id] ?? `Modelo ${c.modelo_id}`) : c.proveedor_id ? `Proveedor ${c.proveedor_id}` : ""}</td>
                      <td>{describirCambio(c)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {cambios.length > 500 && <p className="small text-muted mt-1">Se muestran 500 de {cambios.length} cambios.</p>}
        </>
      )}
    </>
  );
}
