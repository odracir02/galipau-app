import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cabecera from "../../shared/ui/Cabecera";
import Aviso from "../../shared/ui/Aviso";
import { NavCatalogo } from "../catalogo/PaginaCatalogo";
import { TIPOS_SUGERIDOS, describirPrecio, euro5 } from "../catalogo/domain/catalogo";
import { leerXlsx, huellaArchivo } from "./domain/xlsx";
import { FORMATOS, leerTarifa } from "./domain/formatos";
import { clave } from "./domain/normalizar";
import {
  ESTADOS, NOMBRE_ESTADO, INTERPRETACIONES, compararTarifa, construirOperaciones, decisionesPosibles, resultadoPrevisto, verificarImportacion,
} from "./domain/comparar";
import { listarProveedoresTarifa, leerCatalogoProveedor, importarTarifa } from "./data/tarifasRepo";

const PASOS = ["Proveedor", "Archivo", "Análisis", "Vista previa", "Tarifa", "Conflictos", "Decisiones", "Resultado previsto", "Confirmar", "Verificación"];
const NOMBRE_DECISION = { ignorar: "Ignorar", anadir: "Añadir", actualizar: "Actualizar precio", archivar: "Archivar" };
const MAX_FILAS = 200;
// File contents (FileReader fallback for browsers without Blob.arrayBuffer)
const leerBytes = (fichero) =>
  typeof fichero.arrayBuffer === "function"
    ? fichero.arrayBuffer().then((b) => new Uint8Array(b))
    : new Promise((ok, mal) => {
        const lector = new FileReader();
        lector.onload = () => ok(new Uint8Array(lector.result));
        lector.onerror = () => mal(new Error("No se ha podido leer el archivo."));
        lector.readAsArrayBuffer(fichero);
      });
const pct = (antes, despues) => (antes > 0 ? `${despues >= antes ? "+" : ""}${(((despues - antes) / antes) * 100).toFixed(1).replace(".", ",")} %` : "");

function Pasos({ paso }) {
  return (
    <ol className="gx-pasos d-flex flex-wrap gap-1 list-unstyled small mb-3" aria-label="Pasos de la importación">
      {PASOS.map((p, i) => (
        <li key={p} className={i + 1 < paso ? "hecho" : undefined} aria-current={i + 1 === paso ? "step" : undefined}>
          {i + 1}. {p}
        </li>
      ))}
    </ol>
  );
}

function Navegar({ paso, setPaso, puedeSeguir = true, siguiente = "Siguiente" }) {
  return (
    <div className="d-flex gap-2 mt-3">
      {paso > 1 && <button type="button" className="btn btn-outline-secondary" onClick={() => setPaso(paso - 1)}>Atrás</button>}
      {paso < PASOS.length && <button type="button" className="btn btn-primary" disabled={!puedeSeguir} onClick={() => setPaso(paso + 1)}>{siguiente}</button>}
    </div>
  );
}

/** Supplier price-list import wizard: nothing is saved until step 9. */
function PaginaImportarTarifa({ obtenerCliente = obtenerClienteSupabase }) {
  const confirmar = useConfirmar();
  const [paso, setPaso] = useState(1);
  const [error, setError] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [proveedorSel, setProveedorSel] = useState(""); // "" = detect from the file
  const [formatoSel, setFormatoSel] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [lectura, setLectura] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [opciones, setOpciones] = useState({ modalidad: "", interpretacion: "", iva: "21" });
  const [resoluciones, setResoluciones] = useState({ equivalencias: {}, filaElegida: {} });
  const [decisiones, setDecisiones] = useState({});
  const [tipos, setTipos] = useState({});
  const [guardarModalidades, setGuardarModalidades] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [pestana, setPestana] = useState("diferente");
  const [importando, setImportando] = useState(false);
  const [hecho, setHecho] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setProveedores(await listarProveedoresTarifa(await obtenerCliente()));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [obtenerCliente]);

  // supplier: the one chosen, or the one whose name matches the detected format
  const proveedor = useMemo(() => {
    if (proveedorSel) return proveedores.find((p) => String(p.id) === proveedorSel) ?? null;
    if (!lectura) return null;
    return proveedores.find((p) => clave(p.nombre) === clave(lectura.formato.proveedor)) ?? null;
  }, [proveedorSel, proveedores, lectura]);
  const nombreProveedor = proveedor?.nombre ?? lectura?.formato.proveedor ?? "";

  const leerArchivo = async (fichero) => {
    setError(null);
    setLectura(null);
    setCatalogo(null);
    setDecisiones({});
    setResoluciones({ equivalencias: {}, filaElegida: {} });
    setOpciones((o) => ({ ...o, modalidad: "" }));
    if (!fichero) return;
    try {
      const datos = await leerBytes(fichero);
      const libro = leerXlsx(datos);
      const t = leerTarifa(libro, formatoSel || null);
      setArchivo({ nombre: fichero.name, tamano: fichero.size, sha256: await huellaArchivo(datos) });
      setLectura(t);
      setPaso(3);
    } catch (e) {
      setError(e.message);
    }
  };

  // catalogue of the supplier (empty for a supplier that does not exist yet)
  useEffect(() => {
    if (!lectura) return;
    (async () => {
      try {
        setCatalogo(proveedor ? await leerCatalogoProveedor(await obtenerCliente(), proveedor.id) : { catalogo: [], tarifasActuales: {} });
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [lectura, proveedor, obtenerCliente]);

  const ivaNum = Number(String(opciones.iva).replace(",", "."));
  const opcionesListas = Boolean(opciones.modalidad && opciones.interpretacion && opciones.iva !== "" && ivaNum >= 0 && ivaNum <= 100);
  const opcionesCalculo = useMemo(() => ({ modalidad: opciones.modalidad, interpretacion: opciones.interpretacion, iva: ivaNum }), [opciones.modalidad, opciones.interpretacion, ivaNum]);

  const comparacion = useMemo(() => {
    if (!lectura || !catalogo || !opcionesListas) return null;
    return compararTarifa({ entradas: lectura.entradas, descartadas: lectura.descartadas, catalogo: catalogo.catalogo, tarifasActuales: catalogo.tarifasActuales, opciones: opcionesCalculo, resoluciones });
  }, [lectura, catalogo, opcionesListas, opcionesCalculo, resoluciones]);

  // How many current variants each price mode matches exactly (a hint, never a choice)
  const coincidencias = useMemo(() => {
    if (!lectura || !catalogo || catalogo.catalogo.length === 0) return {};
    return Object.fromEntries(
      lectura.formato.modalidades.map((m) => {
        const r = compararTarifa({ entradas: lectura.entradas, catalogo: catalogo.catalogo, opciones: { modalidad: m.id, interpretacion: opciones.interpretacion || "neto", iva: Number.isFinite(ivaNum) ? ivaNum : 21 } });
        return [m.id, r.items.filter((i) => i.varianteId && i.base === "igual").length];
      })
    );
  }, [lectura, catalogo, opciones.interpretacion, ivaNum]);

  const items = useMemo(() => comparacion?.items ?? [], [comparacion]);
  const { operaciones, errores } = useMemo(() => construirOperaciones(items, decisiones, { tipos, guardarModalidades }), [items, decisiones, tipos, guardarModalidades]);
  const previsto = useMemo(() => resultadoPrevisto(operaciones, items), [operaciones, items]);
  const modelosSinTipo = useMemo(
    () => [...new Map(items.filter((i) => decisiones[i.id] === "anadir" && !i.modeloId && !i.tipo).map((i) => [i.modeloClave, i.modelo])).entries()],
    [items, decisiones]
  );

  const decidirTodos = (lista, decision) =>
    setDecisiones((d) => {
      const n = { ...d };
      for (const i of lista) if (decisionesPosibles(i).includes(decision)) n[i.id] = decision;
      return n;
    });

  const importar = async () => {
    if (errores.length || operaciones.length === 0) return;
    const ok = await confirmar({
      titulo: `¿Aplicar la tarifa de ${nombreProveedor}?`,
      mensaje: `Se aplicarán ${operaciones.length} cambios en el catálogo (${previsto.altas} altas, ${previsto.precios} precios, ${previsto.archivadas} archivadas). Los presupuestos guardados, el stock, las reservas y los movimientos no cambian. Podrás revisarla y revertirla desde el historial.`,
      aceptar: "Aplicar tarifa",
    });
    if (!ok) return;
    setImportando(true);
    setError(null);
    try {
      const sb = await obtenerCliente();
      const conteo = (lista) => lista.reduce((a, o) => ((a[o.accion] = (a[o.accion] ?? 0) + 1), a), {});
      const meta = {
        ...(proveedor ? { proveedor_id: proveedor.id } : { proveedor_nombre: nombreProveedor }),
        modalidad: opciones.modalidad,
        interpretacion: opciones.interpretacion,
        iva: ivaNum,
        archivo: { nombre: archivo.nombre, tamano: archivo.tamano, sha256: archivo.sha256, formato: lectura.formato.id, hoja: lectura.hoja },
        resumen: { analisis: comparacion.resumen.porEstado, operaciones: conteo(operaciones), previsto },
        resoluciones: { equivalencias: resoluciones.equivalencias, filaElegida: resoluciones.filaElegida },
      };
      const id = await importarTarifa(sb, meta, operaciones);
      const provId = proveedor?.id ?? (await listarProveedoresTarifa(sb)).find((p) => clave(p.nombre) === clave(nombreProveedor))?.id;
      const despues = provId ? await leerCatalogoProveedor(sb, provId) : { catalogo: [], tarifasActuales: {} };
      const itemsDespues = compararTarifa({ entradas: lectura.entradas, catalogo: despues.catalogo, opciones: opcionesCalculo, resoluciones }).items;
      setHecho({ id, ...verificarImportacion(operaciones, itemsDespues, despues.catalogo), total: operaciones.filter((o) => o.accion !== "tarifas").length });
      setPaso(10);
    } catch (e) {
      setError(e.message);
    } finally {
      setImportando(false);
    }
  };

  const conflictos = items.filter((i) => i.estado === "ambigua");
  const modelosDudosos = [...new Map(conflictos.filter((i) => i.conflicto === "modelo").map((i) => [i.modeloClave, i])).values()];
  const preciosDudosos = conflictos.filter((i) => i.conflicto === "precios");
  const listaPestana = items.filter((i) => i.estado === pestana && (!filtro || clave(`${i.modelo} ${i.referencia ?? ""} ${i.color} ${i.talla}`).includes(clave(filtro))));

  return (
    <>
      <Link to="/catalogo/tarifas" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Historial de tarifas</Link>
      <Cabecera titulo="Importar tarifa de proveedor" descripcion="Analiza el Excel del proveedor, compáralo con el catálogo y decide qué se añade o se actualiza. Nada se guarda hasta el paso 9." />
      <NavCatalogo />
      <Pasos paso={paso} />
      {error && <Aviso tipo="danger">{error}</Aviso>}

      {paso === 1 && (
        <section aria-labelledby="t-proveedor">
          <h2 id="t-proveedor" className="h5">1. Proveedor</h2>
          <div className="row g-3">
            <div className="col-md-6">
              <label className="form-label" htmlFor="proveedor">Proveedor</label>
              <select id="proveedor" className="form-select" value={proveedorSel} onChange={(e) => setProveedorSel(e.target.value)}>
                <option value="">Detectarlo con el archivo</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="formato">Formato del archivo</label>
              <select id="formato" className="form-select" value={formatoSel} onChange={(e) => setFormatoSel(e.target.value)}>
                <option value="">Detectarlo automáticamente</option>
                {FORMATOS.map((f) => <option key={f.id} value={f.id}>{f.descripcion}</option>)}
              </select>
            </div>
          </div>
          <Navegar paso={paso} setPaso={setPaso} />
        </section>
      )}

      {paso === 2 && (
        <section aria-labelledby="t-archivo">
          <h2 id="t-archivo" className="h5">2. Archivo</h2>
          <label className="form-label" htmlFor="excel">Excel de la tarifa (.xlsx)</label>
          <input id="excel" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="form-control" onChange={(e) => leerArchivo(e.target.files?.[0])} />
          <p className="small text-muted mt-2 mb-0">
            <ShieldCheck size={14} aria-hidden="true" /> El archivo se lee en este navegador, solo los valores (sin fórmulas ni macros). No se sube ni se guarda.
          </p>
          <Navegar paso={paso} setPaso={setPaso} puedeSeguir={Boolean(lectura)} />
        </section>
      )}

      {paso === 3 && lectura && (
        <section aria-labelledby="t-analisis">
          <h2 id="t-analisis" className="h5">3. Análisis (sin guardar nada)</h2>
          <Aviso tipo="info">
            <FileSpreadsheet size={14} aria-hidden="true" /> <strong>{archivo.nombre}</strong> · formato {lectura.formato.proveedor} · hoja «{lectura.hoja}» · huella {archivo.sha256.slice(0, 12)}…
          </Aviso>
          <dl className="row small mb-0">
            <dt className="col-sm-4">Proveedor</dt>
            <dd className="col-sm-8">{proveedor ? proveedor.nombre : <>{nombreProveedor} <span className="text-muted">(no existe: se creará al importar)</span></>}</dd>
            <dt className="col-sm-4">Filas con artículo</dt><dd className="col-sm-8">{lectura.entradas.length}</dd>
            <dt className="col-sm-4">Modelos</dt><dd className="col-sm-8">{new Set(lectura.entradas.map((e) => clave(e.modelo))).size}</dd>
            <dt className="col-sm-4">Modalidades de precio</dt>
            <dd className="col-sm-8">{lectura.formato.modalidades.map((m) => `${m.nombre} (${lectura.entradas.filter((e) => m.id in e.precios).length} filas)`).join(" · ")}</dd>
            <dt className="col-sm-4">Marcas</dt><dd className="col-sm-8">{[...new Set(lectura.entradas.map((e) => e.marca).filter(Boolean))].join(", ") || "—"}</dd>
            <dt className="col-sm-4">Tallas agrupadas</dt><dd className="col-sm-8">{lectura.entradas.filter((e) => e.grupo).length} filas (no crean variantes nuevas)</dd>
            <dt className="col-sm-4">Filas con avisos</dt><dd className="col-sm-8">{lectura.entradas.filter((e) => e.problemas.length).length}</dd>
            <dt className="col-sm-4">Filas descartadas</dt><dd className="col-sm-8">{lectura.descartadas.length} (notas, precios a consultar)</dd>
            <dt className="col-sm-4">Catálogo actual del proveedor</dt><dd className="col-sm-8">{catalogo ? `${catalogo.catalogo.length} variantes` : "Cargando…"}</dd>
          </dl>
          <Navegar paso={paso} setPaso={setPaso} puedeSeguir={Boolean(catalogo)} />
        </section>
      )}

      {paso === 4 && lectura && (
        <section aria-labelledby="t-vista">
          <h2 id="t-vista" className="h5">4. Vista previa del archivo</h2>
          <input type="search" className="form-control mb-2" placeholder="Buscar modelo, referencia o color" aria-label="Buscar en la vista previa" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <div className="gx-tabla table-responsive">
            <table className="table table-sm mb-0 small">
              <thead><tr><th>Fila</th><th>Ref.</th><th>Modelo</th><th>Talla</th><th>Color</th>{lectura.formato.modalidades.map((m) => <th key={m.id} className="text-end">{m.nombre}</th>)}<th>Avisos</th></tr></thead>
              <tbody>
                {lectura.entradas.filter((e) => !filtro || clave(`${e.modelo} ${e.referencia ?? ""} ${e.colorTexto}`).includes(clave(filtro))).slice(0, MAX_FILAS).map((e) => (
                  <tr key={e.fila}>
                    <td>{e.fila}</td><td>{e.referencia}</td><td>{e.modelo}{e.marca && <span className="text-muted"> · {e.marca}</span>}</td>
                    <td>{e.tallaTexto}{e.tallas && e.tallas.join(",") !== e.tallaTexto && <span className="text-muted"> → {e.tallas.join(", ")}</span>}{e.grupo && <span className="text-muted"> (agrupada)</span>}</td>
                    <td>{e.colores.join(", ")}</td>
                    {lectura.formato.modalidades.map((m) => <td key={m.id} className="text-end">{m.id in e.precios ? euro5(e.precios[m.id]) : "—"}{e.unidades[m.id] ? <span className="text-muted"> ×{e.unidades[m.id]}</span> : null}</td>)}
                    <td className="text-warning-emphasis">{e.problemas.join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small text-muted mt-1">Se muestran como máximo {MAX_FILAS} filas; usa la búsqueda para ver el resto.</p>
          <Navegar paso={paso} setPaso={setPaso} />
        </section>
      )}

      {paso === 5 && lectura && (
        <section aria-labelledby="t-tarifa">
          <h2 id="t-tarifa" className="h5">5. Tarifa que se usará en los presupuestos</h2>
          <p className="small text-muted">Elige tú la modalidad y cómo leer los precios: no hay ninguna marcada por defecto. Las demás modalidades se guardan como alternativas.</p>
          <fieldset className="mb-3">
            <legend className="fs-6 fw-semibold">Modalidad</legend>
            {lectura.formato.modalidades.map((m) => (
              <div className="form-check" key={m.id}>
                <input className="form-check-input" type="radio" name="modalidad" id={`mod-${m.id}`} checked={opciones.modalidad === m.id} onChange={() => setOpciones((o) => ({ ...o, modalidad: m.id }))} />
                <label className="form-check-label" htmlFor={`mod-${m.id}`}>
                  {m.nombre}
                  {catalogo?.catalogo.length > 0 && <span className="text-muted small"> — coincide con el precio actual en {coincidencias[m.id] ?? 0} de {catalogo.catalogo.length} variantes</span>}
                </label>
              </div>
            ))}
          </fieldset>
          <fieldset className="mb-3">
            <legend className="fs-6 fw-semibold">Los precios del archivo son…</legend>
            {Object.entries(INTERPRETACIONES).map(([k, texto]) => (
              <div className="form-check" key={k}>
                <input className="form-check-input" type="radio" name="interpretacion" id={`int-${k}`} checked={opciones.interpretacion === k} onChange={() => setOpciones((o) => ({ ...o, interpretacion: k }))} />
                <label className="form-check-label" htmlFor={`int-${k}`}>{texto}</label>
              </div>
            ))}
          </fieldset>
          <div style={{ maxWidth: "12rem" }}>
            <label className="form-label" htmlFor="iva">IVA de compra (%)</label>
            <input id="iva" className="form-control" inputMode="decimal" value={opciones.iva} onChange={(e) => setOpciones((o) => ({ ...o, iva: e.target.value }))} />
          </div>
          <Navegar paso={paso} setPaso={setPaso} puedeSeguir={opcionesListas} />
        </section>
      )}

      {paso === 6 && comparacion && (
        <section aria-labelledby="t-conflictos">
          <h2 id="t-conflictos" className="h5">6. Conflictos</h2>
          {modelosDudosos.length === 0 && preciosDudosos.length === 0 && <Aviso tipo="success">No hay modelos con nombre parecido ni filas repetidas con precios distintos.</Aviso>}
          {modelosDudosos.length > 0 && (
            <>
              <h3 className="h6">Modelos con un nombre parecido a uno del catálogo</h3>
              {modelosDudosos.map((i) => (
                <div key={i.modeloClave} className="d-flex flex-wrap align-items-center gap-2 mb-2">
                  <label htmlFor={`eq-${i.modeloClave}`} className="mb-0"><strong>{i.modeloFichero}</strong> (archivo)</label>
                  <select id={`eq-${i.modeloClave}`} className="form-select form-select-sm w-auto" value={resoluciones.equivalencias[i.modeloClave] ?? ""}
                    onChange={(e) => setResoluciones((r) => ({ ...r, equivalencias: { ...r.equivalencias, [i.modeloClave]: e.target.value === "" ? undefined : e.target.value === "nuevo" ? "nuevo" : Number(e.target.value) } }))}>
                    <option value="">Sin decidir</option>
                    <option value={i.candidato.id}>Es «{i.candidato.nombre}» del catálogo</option>
                    <option value="nuevo">Es un modelo distinto (nuevo)</option>
                  </select>
                </div>
              ))}
            </>
          )}
          {preciosDudosos.length > 0 && (
            <>
              <h3 className="h6 mt-3">Misma talla y color con precios distintos</h3>
              {preciosDudosos.map((i) => (
                <div key={i.id} className="d-flex flex-wrap align-items-center gap-2 mb-2">
                  <label htmlFor={`fila-${i.id}`} className="mb-0">{i.modelo} · {i.color} · {i.talla}</label>
                  <select id={`fila-${i.id}`} className="form-select form-select-sm w-auto" value={resoluciones.filaElegida[i.id] ?? ""}
                    onChange={(e) => setResoluciones((r) => ({ ...r, filaElegida: { ...r.filaElegida, [i.id]: e.target.value ? Number(e.target.value) : undefined } }))}>
                    <option value="">Sin decidir</option>
                    {i.opcionesFila.map((o) => <option key={o.fila} value={o.fila}>Fila {o.fila}: {o.importe === null ? "sin precio" : euro5(o.importe)}</option>)}
                  </select>
                </div>
              ))}
            </>
          )}
          <p className="small text-muted mt-2">Lo que quede sin decidir se queda como «referencia ambigua» y se ignora. Las tallas agrupadas ({conflictos.filter((i) => i.conflicto === "grupo").length}) solo pueden actualizar tallas que ya existen en el catálogo.</p>
          <Navegar paso={paso} setPaso={setPaso} />
        </section>
      )}

      {paso === 7 && comparacion && (
        <section aria-labelledby="t-decisiones">
          <h2 id="t-decisiones" className="h5">7. Decide qué hacer</h2>
          <p className="small text-muted">Todo empieza en «Ignorar»: ningún precio cambia sin que lo marques.</p>
          <div className="nav nav-pills gx-pestanas flex-wrap gap-1 mb-2" role="tablist">
            {ESTADOS.map((e) => (
              <button key={e} type="button" role="tab" aria-selected={pestana === e} className={`nav-link py-1 px-2 small ${pestana === e ? "active" : ""}`} onClick={() => setPestana(e)}>
                {NOMBRE_ESTADO[e]} ({comparacion.resumen.porEstado[e]})
              </button>
            ))}
          </div>
          <div className="d-flex flex-wrap gap-2 mb-2">
            <input type="search" className="form-control form-control-sm w-auto" placeholder="Buscar" aria-label="Buscar en la lista" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            {["anadir", "actualizar", "archivar"].filter((d) => listaPestana.some((i) => decisionesPosibles(i).includes(d))).map((d) => (
              <button key={d} type="button" className="btn btn-sm btn-outline-primary" onClick={() => decidirTodos(listaPestana, d)}>{NOMBRE_DECISION[d]}: todas las de la lista ({listaPestana.filter((i) => decisionesPosibles(i).includes(d)).length})</button>
            ))}
            {listaPestana.length > 0 && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => decidirTodos(listaPestana, "ignorar")}>Ignorar todas</button>}
          </div>
          <div className="gx-tabla table-responsive">
            <table className="table table-sm mb-0 small">
              <thead><tr><th>Modelo</th><th>Color</th><th>Talla</th><th>Ahora</th><th>Tarifa</th><th className="text-end">Coste</th><th>Detalle</th><th>Decisión</th></tr></thead>
              <tbody>
                {listaPestana.slice(0, MAX_FILAS).map((i) => (
                  <tr key={i.id}>
                    <td>{i.modelo}{i.referencia && <span className="text-muted"> · {i.referencia}</span>}</td>
                    <td>{i.color}</td><td>{i.talla}</td>
                    <td>{i.actual ? describirPrecio(i.actual) : "—"}</td>
                    <td>{i.nuevo ? describirPrecio(i.nuevo) : i.importe ? euro5(i.importe) : "—"}</td>
                    <td className="text-end">{i.costeActual !== undefined && i.costeNuevo !== undefined ? <>{euro5(i.costeActual)} → {euro5(i.costeNuevo)} <span className="text-muted">{pct(i.costeActual, i.costeNuevo)}</span></> : i.costeNuevo !== undefined ? euro5(i.costeNuevo) : ""}</td>
                    <td className="text-muted">{[i.motivo, i.desdeGrupo && `Grupo «${i.desdeGrupo}»`, i.archivada && "Variante archivada", i.filas?.length ? `Fila ${i.filas.join(", ")}` : null].filter(Boolean).join(" · ")}</td>
                    <td>
                      <select className="form-select form-select-sm" aria-label={`Decisión para ${i.modelo} ${i.color} ${i.talla}`} value={decisiones[i.id] ?? "ignorar"} disabled={decisionesPosibles(i).length === 1}
                        onChange={(e) => setDecisiones((d) => ({ ...d, [i.id]: e.target.value }))}>
                        {decisionesPosibles(i).map((d) => <option key={d} value={d}>{NOMBRE_DECISION[d]}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {listaPestana.length > MAX_FILAS && <p className="small text-muted mt-1">Se muestran {MAX_FILAS} de {listaPestana.length}; los botones de arriba se aplican a toda la lista.</p>}
          {modelosSinTipo.length > 0 && (
            <div className="mt-3">
              <h3 className="h6">Tipo de artículo de los modelos nuevos</h3>
              <datalist id="tipos-sugeridos">{TIPOS_SUGERIDOS.map((t) => <option key={t} value={t} />)}</datalist>
              <div className="row g-2">
                {modelosSinTipo.map(([k, nombre]) => (
                  <div className="col-sm-6 col-lg-4" key={k}>
                    <label className="form-label small mb-0" htmlFor={`tipo-${k}`}>{nombre}</label>
                    <input id={`tipo-${k}`} className="form-control form-control-sm" list="tipos-sugeridos" value={tipos[k] ?? ""} onChange={(e) => setTipos((t) => ({ ...t, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="form-check mt-3">
            <input className="form-check-input" type="checkbox" id="guardar-modalidades" checked={guardarModalidades} onChange={(e) => setGuardarModalidades(e.target.checked)} />
            <label className="form-check-label" htmlFor="guardar-modalidades">Guardar también las modalidades alternativas de las variantes con precio igual (no cambia su precio)</label>
          </div>
          <Navegar paso={paso} setPaso={setPaso} />
        </section>
      )}

      {paso === 8 && comparacion && (
        <section aria-labelledby="t-previsto">
          <h2 id="t-previsto" className="h5">8. Resultado previsto</h2>
          <ul>
            <li>{previsto.altas} variantes nuevas{previsto.modelosNuevos ? ` (${previsto.modelosNuevos} modelos nuevos)` : ""}</li>
            <li>{previsto.precios} precios actualizados ({previsto.subidas} suben, {previsto.bajadas} bajan)</li>
            <li>{previsto.archivadas} variantes archivadas</li>
            <li>{previsto.modalidades} variantes con modalidades alternativas guardadas</li>
          </ul>
          <p className="small">Precio usado en presupuestos: modalidad <strong>{lectura.formato.modalidades.find((m) => m.id === opciones.modalidad)?.nombre}</strong>, {INTERPRETACIONES[opciones.interpretacion].toLowerCase()}, IVA {ivaNum} %.</p>
          <Aviso tipo="info">No cambian: presupuestos guardados (conservan su precio), existencias, reservas ni movimientos de inventario.</Aviso>
          {errores.map((e) => <Aviso key={e} tipo="warning">{e}</Aviso>)}
          <Navegar paso={paso} setPaso={setPaso} puedeSeguir={errores.length === 0 && operaciones.length > 0} />
        </section>
      )}

      {paso === 9 && comparacion && (
        <section aria-labelledby="t-confirmar">
          <h2 id="t-confirmar" className="h5">9. Confirmar</h2>
          <p>Proveedor <strong>{nombreProveedor}</strong> · archivo <strong>{archivo.nombre}</strong> · {operaciones.length} cambios.</p>
          <p className="small text-muted">Se guarda en una sola operación: o se aplica todo o nada. Queda registrado quién, cuándo, con qué archivo (huella) y cada precio anterior, para poder revisarlo o revertirlo.</p>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setPaso(8)}>Atrás</button>
            <button type="button" className="btn btn-primary" disabled={importando || errores.length > 0 || operaciones.length === 0} onClick={importar}>{importando ? "Aplicando…" : "Aplicar tarifa"}</button>
          </div>
        </section>
      )}

      {paso === 10 && hecho && (
        <section aria-labelledby="t-verificacion">
          <h2 id="t-verificacion" className="h5">10. Verificación</h2>
          <Aviso tipo={hecho.fallos.length ? "warning" : "success"}>
            Tarifa aplicada (importación nº {hecho.id}). Comprobado en el catálogo: {hecho.comprobadas} de {hecho.total} cambios.
            {hecho.fallos.length > 0 && <> No se reflejan: {hecho.fallos.join("; ")}.</>}
          </Aviso>
          <Link to={`/catalogo/tarifas/${hecho.id}`} className="btn btn-primary">Ver el registro de la importación</Link>
        </section>
      )}
    </>
  );
}

export default PaginaImportarTarifa;
