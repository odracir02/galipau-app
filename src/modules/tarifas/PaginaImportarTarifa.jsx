import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cabecera from "../../shared/ui/Cabecera";
import Aviso from "../../shared/ui/Aviso";
import Cargando from "../../shared/ui/Cargando";
import Paginacion from "../../shared/ui/Paginacion";
import { paginar } from "../../shared/ui/paginado";
import { NavCatalogo } from "../catalogo/PaginaCatalogo";
import { TIPOS_SUGERIDOS, describirPrecio, euro5 } from "../catalogo/domain/catalogo";
import { leerXlsx, huellaArchivo } from "./domain/xlsx";
import { FORMATOS, leerTarifa } from "./domain/formatos";
import { clave, interpretarListaTallas } from "./domain/normalizar";
import {
  ESTADOS, NOMBRE_ESTADO, INTERPRETACIONES, compararTarifa, construirOperaciones, decisionesPosibles, resultadoPrevisto, verificarImportacion, gruposPendientes,
} from "./domain/comparar";
import {
  listarProveedoresTarifa, leerCatalogoProveedor, importarTarifa, buscarImportacionPorClave, revertirTarifa, listarImportacionesTarifa, importacionesIncompletas, TAMANO_LOTE,
} from "./data/tarifasRepo";

const PASOS = ["Proveedor", "Archivo", "Análisis", "Vista previa", "Tarifa", "Conflictos", "Decisiones", "Resultado previsto", "Confirmar", "Verificación"];
const NOMBRE_DECISION = { ignorar: "Ignorar", anadir: "Añadir", actualizar: "Actualizar precio", archivar: "Archivar" };
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
function PaginaImportarTarifa({ obtenerCliente = obtenerClienteSupabase, tamanoLote = TAMANO_LOTE }) {
  const confirmar = useConfirmar();
  const [paso, setPaso] = useState(1);
  const [error, setError] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [proveedorSel, setProveedorSel] = useState(""); // "" = detect from the file
  const [formatoSel, setFormatoSel] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [lectura, setLectura] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [opciones, setOpciones] = useState({ modalidad: "", interpretacion: "", iva: "", alternativa: "" }); // alternativa: "pack|1" = Pack only for packs of one unit
  const [resoluciones, setResoluciones] = useState({ equivalencias: {}, filaElegida: {} });
  const [textosGrupo, setTextosGrupo] = useState({}); // size-group key -> sizes typed by the owner
  const [decisiones, setDecisiones] = useState({});
  const [tipos, setTipos] = useState({});
  const [guardarModalidades, setGuardarModalidades] = useState(true);
  const [tipoTodos, setTipoTodos] = useState("");
  const [paginaTipos, setPaginaTipos] = useState(1);
  const [filtro, setFiltroTexto] = useState("");
  const [pagina, setPagina] = useState(1);
  const setFiltro = (v) => {
    setFiltroTexto(v);
    setPagina(1);
  };
  // each step starts on its first page and without a search
  const cambiarPaso = (n) => {
    setPaso(n);
    setPagina(1);
    setFiltroTexto("");
  };
  const [pestana, setPestana] = useState("diferente");
  const [importando, setImportando] = useState(null); // { lote, lotes } while applying
  const [hecho, setHecho] = useState(null);
  // "sencillo": upload, summary, import (the owner's approved rules); "avanzado": the 10 steps
  const [modo, setModo] = useState("sencillo");
  const [actualizarPrecios, setActualizarPrecios] = useState(false);
  const [parcial, setParcial] = useState(null); // an import that stopped half-way: { meta, ops, clave, lotes, lotesAplicados, importacionId, mensaje }
  const [avisoReversion, setAvisoReversion] = useState(null);
  const [importaciones, setImportaciones] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const sb = await obtenerCliente();
        setProveedores(await listarProveedoresTarifa(sb));
        setImportaciones(await listarImportacionesTarifa(sb).catch(() => []));
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
    setTextosGrupo({});
    if (!fichero) return;
    try {
      const datos = await leerBytes(fichero);
      const libro = leerXlsx(datos);
      const t = leerTarifa(libro, formatoSel || null);
      setArchivo({ nombre: fichero.name, tamano: fichero.size, sha256: await huellaArchivo(datos) });
      setLectura(t);
      // only what the owner confirmed for this supplier's file; otherwise nothing is chosen
      const pr = t.formato.propuesta;
      setOpciones(pr
        ? { modalidad: pr.modalidad, interpretacion: pr.interpretacion, iva: String(pr.iva), alternativa: pr.alternativa ? `${pr.alternativa.modalidad}|${pr.alternativa.soloUnidad ? 1 : 0}` : "" }
        : { modalidad: "", interpretacion: "", iva: "", alternativa: "" });
      // a file without the owner's confirmed reading needs the detailed mode
      if (!pr) setModo("avanzado");
      cambiarPaso(3);
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
  const opcionesCalculo = useMemo(() => {
    const [alt, uno] = opciones.alternativa.split("|");
    return { modalidad: opciones.modalidad, interpretacion: opciones.interpretacion, iva: ivaNum, ...(alt && alt !== opciones.modalidad ? { alternativa: { modalidad: alt, soloUnidad: uno === "1" } } : {}) };
  }, [opciones.modalidad, opciones.interpretacion, opciones.alternativa, ivaNum]);
  // rows without a price in the chosen mode, and how many each alternative would cover
  const sinPrecio = useMemo(() => {
    if (!lectura || !opciones.modalidad) return null;
    const filas = lectura.entradas.filter((e) => Object.keys(e.precios).length > 0 && !(opciones.modalidad in e.precios));
    return {
      filas: filas.length,
      por: Object.fromEntries(lectura.formato.modalidades.filter((m) => m.id !== opciones.modalidad).map((m) => [m.id, {
        siempre: filas.filter((e) => m.id in e.precios).length,
        unidad: filas.filter((e) => m.id in e.precios && e.unidades[m.id] === 1).length,
      }])),
    };
  }, [lectura, opciones.modalidad]);

  // size groups split by the owner: only lists of individual sizes without errors count
  const grupoResuelto = useMemo(() => {
    const r = {};
    for (const [k, texto] of Object.entries(textosGrupo)) r[k] = interpretarListaTallas(texto);
    return r;
  }, [textosGrupo]);
  const resolucionesEfectivas = useMemo(
    () => ({ ...resoluciones, tallasGrupo: Object.fromEntries(Object.entries(grupoResuelto).filter(([, r]) => r.errores.length === 0 && r.tallas.length > 0).map(([k, r]) => [k, r.tallas])) }),
    [resoluciones, grupoResuelto]
  );

  const comparacion = useMemo(() => {
    if (!lectura || !catalogo || !opcionesListas) return null;
    return compararTarifa({ entradas: lectura.entradas, descartadas: lectura.descartadas, catalogo: catalogo.catalogo, tarifasActuales: catalogo.tarifasActuales, opciones: opcionesCalculo, resoluciones: resolucionesEfectivas });
  }, [lectura, catalogo, opcionesListas, opcionesCalculo, resolucionesEfectivas]);

  // every size group of the file (resolved or not), to keep them editable
  const grupos = useMemo(() => {
    if (!lectura || !catalogo || !opcionesListas) return [];
    return gruposPendientes(compararTarifa({ entradas: lectura.entradas, catalogo: catalogo.catalogo, opciones: opcionesCalculo, resoluciones }).items);
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
  // simple mode applies the approved rules: add every new variant ("Sin clasificar" for new models),
  // change existing prices only if the owner ticks it, leave everything else out
  const decisionesEfectivas = useMemo(() => {
    if (modo !== "sencillo") return decisiones;
    return Object.fromEntries(items.flatMap((i) => (i.estado === "nueva" ? [[i.id, "anadir"]] : i.estado === "diferente" && actualizarPrecios ? [[i.id, "actualizar"]] : [])));
  }, [modo, decisiones, items, actualizarPrecios]);
  const tiposEfectivos = useMemo(
    () => (modo !== "sencillo" ? tipos : Object.fromEntries(items.filter((i) => i.estado === "nueva" && !i.modeloId && !i.tipo).map((i) => [i.modeloClave, "Sin clasificar"]))),
    [modo, tipos, items]
  );
  const { operaciones, errores } = useMemo(
    () => construirOperaciones(items, decisionesEfectivas, { tipos: tiposEfectivos, guardarModalidades }),
    [items, decisionesEfectivas, tiposEfectivos, guardarModalidades]
  );
  const previsto = useMemo(() => resultadoPrevisto(operaciones, items), [operaciones, items]);
  const altas = useMemo(() => operaciones.filter((o) => o.accion === "alta"), [operaciones]);
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

  // Sends the batches; on a failure keeps everything needed to resume or revert
  const ejecutar = async ({ meta, ops, clave: claveImportacion, desdeLote, importacionId }) => {
    const lotes = Math.max(1, Math.ceil(ops.length / tamanoLote));
    setImportando({ lote: desdeLote - 1, lotes });
    setError(null);
    const sb = await obtenerCliente();
    let id;
    try {
      id = await importarTarifa(sb, meta, ops, { clave: claveImportacion, desdeLote, tamano: tamanoLote, alAvanzar: (lote, total) => setImportando({ lote, lotes: total }) });
    } catch (e) {
      // the import may exist even if the answer to its first batch was lost
      const existente = e.importacionId ?? importacionId ?? (await buscarImportacionPorClave(sb, claveImportacion).catch(() => null))?.id ?? null;
      setParcial({ meta, ops, clave: claveImportacion, lotes: e.lotes ?? lotes, lotesAplicados: e.lotesAplicados ?? desdeLote - 1, importacionId: existente, mensaje: e.message });
      setImportando(null);
      return;
    }
    setParcial(null);
    try {
      const provId = proveedor?.id ?? (await listarProveedoresTarifa(sb)).find((p) => clave(p.nombre) === clave(nombreProveedor))?.id;
      const despues = provId ? await leerCatalogoProveedor(sb, provId) : { catalogo: [], tarifasActuales: {} };
      const itemsDespues = compararTarifa({ entradas: lectura.entradas, catalogo: despues.catalogo, opciones: opcionesCalculo, resoluciones: resolucionesEfectivas }).items;
      setHecho({ id, ...verificarImportacion(ops, itemsDespues, despues.catalogo), total: ops.filter((o) => o.accion !== "tarifas" && o.accion !== "completar_modelo").length, resumen: resultadoPrevisto(ops, items) });
      cambiarPaso(10);
    } catch (e) {
      setError(`La tarifa se aplicó (importación nº ${id}), pero no se ha podido comprobar el catálogo: ${e.message}`);
    } finally {
      setImportando(null);
    }
  };

  const importar = async () => {
    if (errores.length || operaciones.length === 0) return;
    const ok = await confirmar({
      titulo: `¿Aplicar la tarifa de ${nombreProveedor}?`,
      mensaje: `Se aplicarán ${operaciones.length} cambios en el catálogo (${previsto.altas} altas, ${previsto.precios} precios, ${previsto.archivadas} archivadas). Los presupuestos guardados, el stock, las reservas y los movimientos no cambian. Podrás revisarla y revertirla desde el historial.`,
      aceptar: "Aplicar tarifa",
    });
    if (!ok) return;
    const conteo = (lista) => lista.reduce((a, o) => ((a[o.accion] = (a[o.accion] ?? 0) + 1), a), {});
    const meta = {
      ...(proveedor ? { proveedor_id: proveedor.id } : { proveedor_nombre: nombreProveedor }),
      modalidad: opciones.modalidad,
      alternativa: opcionesCalculo.alternativa ?? null,
      interpretacion: opciones.interpretacion,
      iva: ivaNum,
      archivo: { nombre: archivo.nombre, tamano: archivo.tamano, sha256: archivo.sha256, formato: lectura.formato.id, hoja: lectura.hoja },
      resumen: { analisis: comparacion.resumen.porEstado, operaciones: conteo(operaciones), previsto },
      resoluciones: { equivalencias: resoluciones.equivalencias, filaElegida: resoluciones.filaElegida, tallasGrupo: resolucionesEfectivas.tallasGrupo },
    };
    // the exact operations are kept: a retry resumes them, it never recomputes them
    await ejecutar({ meta, ops: [...operaciones], clave: globalThis.crypto.randomUUID(), desdeLote: 1 });
  };

  const reanudar = () => ejecutar({ meta: parcial.meta, ops: parcial.ops, clave: parcial.clave, desdeLote: parcial.lotesAplicados + 1, importacionId: parcial.importacionId });

  const revertirParcial = async () => {
    const ok = await confirmar({
      titulo: `¿Revertir la importación incompleta nº ${parcial.importacionId}?`,
      mensaje: "Se deshace lo que entró en los lotes guardados. No se tocan los cambios hechos después, ni presupuestos ni inventario.",
      aceptar: "Revertir",
      peligro: true,
    });
    if (!ok) return;
    try {
      const sb = await obtenerCliente();
      await revertirTarifa(sb, parcial.importacionId);
      setParcial(null);
      setCatalogo(proveedor ? await leerCatalogoProveedor(sb, proveedor.id) : { catalogo: [], tarifasActuales: {} });
      setError(null);
      setAvisoReversion(`Importación nº ${parcial.importacionId} revertida. El catálogo se ha vuelto a leer: revisa el resultado previsto antes de aplicar de nuevo.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const conflictos = items.filter((i) => i.estado === "ambigua");
  const modelosDudosos = [...new Map(conflictos.filter((i) => i.conflicto === "modelo").map((i) => [i.modeloClave, i])).values()];
  const preciosDudosos = conflictos.filter((i) => i.conflicto === "precios");
  const entradasVista = (lectura?.entradas ?? []).filter((e) => !filtro || clave(`${e.modelo} ${e.marca ?? ""} ${e.referencia ?? ""} ${e.colorTexto}`).includes(clave(filtro)));
  const altasVista = altas.filter((o) => !filtro || clave(`${o.modelo.nombre} ${o.modelo.marca ?? ""} ${o.color} ${o.talla}`).includes(clave(filtro)));
  const listaPestana = items.filter((i) => i.estado === pestana && (!filtro || clave(`${i.modelo} ${i.referencia ?? ""} ${i.color} ${i.talla}`).includes(clave(filtro))));

  const cajaParcial = parcial && (
    <Aviso tipo="warning">
      <p className="mb-2">
        <strong>Importación incompleta.</strong> {parcial.mensaje} Se guardaron {parcial.lotesAplicados} de {parcial.lotes} lotes
        {parcial.importacionId ? ` (importación nº ${parcial.importacionId})` : ""}; del lote {parcial.lotesAplicados + 1} no se guardó nada.
      </p>
      <div className="d-flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={Boolean(importando)} onClick={reanudar}>
          {importando ? `Aplicando lote ${Math.min(importando.lote + 1, importando.lotes)} de ${importando.lotes}…` : `Reintentar desde el lote ${parcial.lotesAplicados + 1}`}
        </button>
        {parcial.importacionId && <button type="button" className="btn btn-sm btn-outline-danger" disabled={Boolean(importando)} onClick={revertirParcial}>Revertir lo ya guardado</button>}
      </div>
    </Aviso>
  );

  const empezarDeNuevo = () => {
    setLectura(null);
    setArchivo(null);
    setCatalogo(null);
    setHecho(null);
    setDecisiones({});
    setActualizarPrecios(false);
    setError(null);
    cambiarPaso(1);
  };
  const irAlDetalle = () => {
    setModo("avanzado");
    cambiarPaso(lectura ? 3 : 1);
  };

  // ---- simple mode figures
  const cuenta = (estado) => comparacion?.resumen.porEstado[estado] ?? 0;
  const cambiosPrincipales = previsto.altas + previsto.precios;
  const n = (v) => v.toLocaleString("es-ES");
  const pl = (v, uno, varios) => `${n(v)} ${v === 1 ? uno : varios}`;

  const vistaSencilla = hecho ? (
    <section aria-labelledby="t-hecho" className="gx-tarjeta p-4">
      <h2 id="t-hecho" className="h4 d-flex align-items-center gap-2"><CheckCircle2 className="text-success" aria-hidden="true" />¡Hecho!</h2>
      <p className="mb-1">
        {pl(hecho.resumen?.altas ?? 0, "producto añadido", "productos añadidos")}{hecho.resumen?.precios ? ` y ${pl(hecho.resumen.precios, "precio actualizado", "precios actualizados")}` : ""} en el catálogo de {nombreProveedor}.
      </p>
      <p className="small text-muted">{hecho.fallos.length ? `Atención: ${hecho.fallos.length} cambios no se ven en el catálogo (${hecho.fallos.slice(0, 3).join("; ")}…).` : "Comprobado: todo está en el catálogo."}</p>
      <div className="d-flex flex-wrap gap-2">
        <Link to="/catalogo" className="btn btn-primary">Ver el catálogo</Link>
        {hecho.resumen?.modelosNuevos > 0 && <Link to="/catalogo/clasificar" className="btn btn-outline-primary">Clasificar los {n(hecho.resumen.modelosNuevos)} modelos nuevos</Link>}
        <Link to={`/catalogo/tarifas/${hecho.id}`} className="btn btn-outline-secondary">Ver o deshacer esta importación</Link>
        <button type="button" className="btn btn-outline-secondary" onClick={empezarDeNuevo}>Importar otra tarifa</button>
      </div>
    </section>
  ) : !lectura ? (
    <section aria-labelledby="t-subir" className="gx-tarjeta p-4 text-center">
      <FileSpreadsheet size={40} className="text-muted mb-2" aria-hidden="true" />
      <h2 id="t-subir" className="h5">Sube la tarifa del proveedor</h2>
      <p className="text-muted mb-3">El Excel que te envía el proveedor (por ahora ROLY o SOL'S). Se lee aquí mismo y no se guarda nada hasta que pulses «Importar».</p>
      <label className="btn btn-primary btn-lg mb-0">
        Elegir el archivo Excel
        <input type="file" className="visually-hidden" aria-label="Excel de la tarifa (.xlsx)" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => leerArchivo(e.target.files?.[0])} />
      </label>
    </section>
  ) : !comparacion ? (
    <Cargando texto="Comparando la tarifa con tu catálogo…" />
  ) : (
    <section aria-labelledby="t-resumen">
      <h2 id="t-resumen" className="h5 mb-1">Tarifa de {nombreProveedor}</h2>
      <p className="small text-muted">{archivo.nombre}{proveedor ? "" : " · proveedor nuevo: se creará al importar"}</p>
      <div className="row g-3 mb-3">
        {[
          ["Productos nuevos", cuenta("nueva"), comparacion.resumen.modelosNuevos ? `de ${pl(comparacion.resumen.modelosNuevos, "modelo nuevo", "modelos nuevos")}; se añaden` : "se añaden al catálogo"],
          ["Sin cambios", cuenta("igual"), "ya están con el mismo precio"],
          ["Precios distintos", cuenta("diferente"), actualizarPrecios ? "se actualizarán" : "no se cambian salvo que lo marques"],
          ["Para revisar", cuenta("ambigua") + cuenta("no_valida"), "no se importan (tallas sin detallar, datos dudosos o errores del Excel)"],
        ].map(([titulo, valor, detalle]) => (
          <div className="col-6 col-lg-3" key={titulo}>
            <div className="gx-kpi"><div className="gx-kpi-etiqueta">{titulo}</div><div className="gx-kpi-valor">{n(valor)}</div><div className="gx-kpi-detalle">{detalle}</div></div>
          </div>
        ))}
      </div>
      <ul className="small text-muted">
        <li>{lectura.formato.propuesta?.resumen}</li>
        <li>Los modelos nuevos entran como «Sin clasificar»; después se clasifican en bloque en «Clasificar», con sugerencias que tú confirmas.</li>
        {cuenta("descatalogada") > 0 && <li>{cuenta("descatalogada") === 1 ? "1 producto de tu catálogo no aparece en esta tarifa: se mantiene como está." : `${n(cuenta("descatalogada"))} productos de tu catálogo no aparecen en esta tarifa: se mantienen como están.`}</li>}
        <li>No cambian los presupuestos guardados ni el inventario. Se puede deshacer desde el historial.</li>
      </ul>
      {cuenta("diferente") > 0 && (
        <div className="form-check mb-3">
          <input className="form-check-input" type="checkbox" id="actualizar-precios" checked={actualizarPrecios} onChange={(e) => setActualizarPrecios(e.target.checked)} />
          <label className="form-check-label" htmlFor="actualizar-precios">{cuenta("diferente") === 1 ? "Actualizar también el precio que ha cambiado" : `Actualizar también los ${n(cuenta("diferente"))} precios que han cambiado`}</label>
        </div>
      )}
      {avisoReversion && <Aviso tipo="info">{avisoReversion}</Aviso>}
      {parcial ? cajaParcial : operaciones.length === 0 ? (
        <Aviso tipo="success">Tu catálogo ya está al día con esta tarifa: no hay nada que importar.</Aviso>
      ) : (
        <button type="button" className="btn btn-primary btn-lg" disabled={Boolean(importando) || errores.length > 0} onClick={importar}>
          {importando
            ? `Importando… (${Math.min(importando.lote + 1, importando.lotes)} de ${importando.lotes})`
            : cambiosPrincipales > 0 ? `Importar ${pl(previsto.altas, "producto", "productos")}${previsto.precios ? ` y ${pl(previsto.precios, "precio", "precios")}` : ""}` : "Guardar marcas y tarifas alternativas"}
        </button>
      )}
      {errores.map((e) => <Aviso key={e} tipo="warning">{e}</Aviso>)}
      <div className="d-flex flex-wrap gap-3 mt-3 small">
        {!parcial && !importando && <button type="button" className="btn btn-link btn-sm p-0" onClick={empezarDeNuevo}>Cambiar de archivo</button>}
        {!parcial && !importando && <button type="button" className="btn btn-link btn-sm p-0" onClick={irAlDetalle}>Revisar en detalle (modo avanzado)</button>}
      </div>
    </section>
  );

  return (
    <>
      <Link to="/catalogo/tarifas" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Historial de tarifas</Link>
      <Cabecera titulo="Importar tarifa de proveedor"
        descripcion={modo === "sencillo" ? "Sube el Excel del proveedor, revisa el resumen y pulsa Importar." : "Modo avanzado: revisa y decide cada línea. Nada se guarda hasta el paso 9."} />
      <NavCatalogo />
      {modo === "avanzado" && <Pasos paso={paso} />}
      {error && <Aviso tipo="danger">{error}</Aviso>}
      {modo === "sencillo" ? (
        <>
          {vistaSencilla}
          {!lectura && !hecho && <button type="button" className="btn btn-link btn-sm p-0 mt-3" onClick={irAlDetalle}>Usar el modo avanzado (revisar línea a línea)</button>}
        </>
      ) : (
      <>
      <button type="button" className="btn btn-link btn-sm p-0 mb-2" onClick={() => setModo("sencillo")}>← Volver al modo sencillo</button>

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
          <Navegar paso={paso} setPaso={cambiarPaso} />
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
          <Navegar paso={paso} setPaso={cambiarPaso} puedeSeguir={Boolean(lectura)} />
        </section>
      )}

      {paso === 3 && lectura && (
        <section aria-labelledby="t-analisis">
          <h2 id="t-analisis" className="h5">3. Análisis (sin guardar nada)</h2>
          <Aviso tipo="info">
            <FileSpreadsheet size={14} aria-hidden="true" /> <strong>{archivo.nombre}</strong> · formato {lectura.formato.proveedor} · hoja «{lectura.hoja}» · huella {archivo.sha256.slice(0, 12)}…
          </Aviso>
          {proveedor && importacionesIncompletas(importaciones, proveedor.id).map((i) => (
            <Aviso key={i.id} tipo="warning">
              La importación nº {i.id} de este proveedor quedó incompleta ({i.resumen.lotes_aplicados} de {i.resumen.lotes_total} lotes).
              Lo que entró aparecerá como «precio igual» y no se duplicará. <Link to={`/catalogo/tarifas/${i.id}`}>Revisarla o revertirla</Link>.
            </Aviso>
          ))}
          <dl className="row small mb-0">
            <dt className="col-sm-4">Proveedor</dt>
            <dd className="col-sm-8">{proveedor ? proveedor.nombre : <>{nombreProveedor} <span className="text-muted">(no existe: se creará al importar)</span></>}</dd>
            <dt className="col-sm-4">Filas con artículo</dt><dd className="col-sm-8">{lectura.entradas.length}</dd>
            <dt className="col-sm-4">Modelos</dt><dd className="col-sm-8">{new Set(lectura.entradas.map((e) => clave(e.modelo))).size}</dd>
            <dt className="col-sm-4">Modalidades de precio</dt>
            <dd className="col-sm-8">{lectura.formato.modalidades.map((m) => `${m.nombre} (${lectura.entradas.filter((e) => m.id in e.precios).length} filas)`).join(" · ")}</dd>
            <dt className="col-sm-4">Marcas</dt><dd className="col-sm-8">{[...new Set(lectura.entradas.map((e) => e.marca).filter(Boolean))].join(", ") || "—"}</dd>
            <dt className="col-sm-4">Tallas agrupadas</dt><dd className="col-sm-8">{lectura.entradas.filter((e) => e.grupo).length} filas: hay que indicar sus tallas individuales en el paso 6</dd>
            <dt className="col-sm-4">Filas con avisos</dt><dd className="col-sm-8">{lectura.entradas.filter((e) => e.problemas.length).length}</dd>
            <dt className="col-sm-4">Filas descartadas</dt><dd className="col-sm-8">{lectura.descartadas.length} (notas, precios a consultar)</dd>
            <dt className="col-sm-4">Catálogo actual del proveedor</dt><dd className="col-sm-8">{catalogo ? `${catalogo.catalogo.length} variantes` : "Cargando…"}</dd>
          </dl>
          <Navegar paso={paso} setPaso={cambiarPaso} puedeSeguir={Boolean(catalogo)} />
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
                {paginar(entradasVista, pagina).map((e) => (
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
          <Paginacion total={entradasVista.length} pagina={pagina} onCambiar={setPagina} etiqueta="Páginas de la vista previa" />
          <Navegar paso={paso} setPaso={cambiarPaso} />
        </section>
      )}

      {paso === 5 && lectura && (
        <section aria-labelledby="t-tarifa">
          <h2 id="t-tarifa" className="h5">5. Tarifa que se usará en los presupuestos</h2>
          {lectura.formato.propuesta ? (
            <Aviso tipo="info">{lectura.formato.propuesta.nota} Revísalo antes de seguir.</Aviso>
          ) : (
            <p className="small text-muted">Elige tú la modalidad y cómo leer los precios: no hay ninguna marcada por defecto. Las demás modalidades se guardan como alternativas.</p>
          )}
          <p className="small text-muted">El coste que usa la calculadora es neto × (1 + IVA) con precio neto, o el precio tal cual si ya lleva el IVA (nunca se suma dos veces). La modalidad no cambia sola según la cantidad.</p>
          <fieldset className="mb-3">
            <legend className="fs-6 fw-semibold">Modalidad</legend>
            {lectura.formato.modalidades.map((m) => (
              <div className="form-check" key={m.id}>
                <input className="form-check-input" type="radio" name="modalidad" id={`mod-${m.id}`} checked={opciones.modalidad === m.id} onChange={() => setOpciones((o) => ({ ...o, modalidad: m.id, alternativa: "" }))} />
                <label className="form-check-label" htmlFor={`mod-${m.id}`}>
                  {m.nombre}
                  {catalogo?.catalogo.length > 0 && <span className="text-muted small"> — coincide con el precio actual en {coincidencias[m.id] ?? 0} de {catalogo.catalogo.length} variantes</span>}
                </label>
              </div>
            ))}
          </fieldset>
          {sinPrecio && sinPrecio.filas > 0 && lectura.formato.modalidades.length > 1 && (
            <fieldset className="mb-3">
              <legend className="fs-6 fw-semibold">Si una variante no tiene precio de {lectura.formato.modalidades.find((m) => m.id === opciones.modalidad)?.nombre} ({sinPrecio.filas} filas)…</legend>
              <div className="form-check">
                <input className="form-check-input" type="radio" name="alternativa" id="alt-ninguna" checked={!opciones.alternativa} onChange={() => setOpciones((o) => ({ ...o, alternativa: "" }))} />
                <label className="form-check-label" htmlFor="alt-ninguna">No importarla (queda como registro no válido)</label>
              </div>
              {lectura.formato.modalidades.filter((m) => m.id !== opciones.modalidad && sinPrecio.por[m.id]?.siempre > 0).flatMap((m) => [
                m.unidades && sinPrecio.por[m.id].unidad > 0 && (
                  <div className="form-check" key={`${m.id}|1`}>
                    <input className="form-check-input" type="radio" name="alternativa" id={`alt-${m.id}-1`} checked={opciones.alternativa === `${m.id}|1`} onChange={() => setOpciones((o) => ({ ...o, alternativa: `${m.id}|1` }))} />
                    <label className="form-check-label" htmlFor={`alt-${m.id}-1`}>Usar el precio de {m.nombre} solo cuando el {m.nombre.toLowerCase()} es de 1 unidad ({sinPrecio.por[m.id].unidad} filas)</label>
                  </div>
                ),
                <div className="form-check" key={`${m.id}|0`}>
                  <input className="form-check-input" type="radio" name="alternativa" id={`alt-${m.id}-0`} checked={opciones.alternativa === `${m.id}|0`} onChange={() => setOpciones((o) => ({ ...o, alternativa: `${m.id}|0` }))} />
                  <label className="form-check-label" htmlFor={`alt-${m.id}-0`}>Usar siempre el precio de {m.nombre} ({sinPrecio.por[m.id].siempre} filas)</label>
                </div>,
              ])}
              <div className="form-text">Cada variante guarda de qué modalidad sale su precio. Las filas con errores del archivo quedan fuera salvo que elijas usar otra modalidad siempre.</div>
            </fieldset>
          )}
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
          <Navegar paso={paso} setPaso={cambiarPaso} puedeSeguir={opcionesListas} />
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
          {grupos.length > 0 && (
            <>
              <h3 className="h6 mt-3">Tallas agrupadas</h3>
              <p className="small text-muted">
                Cada talla es una variante. Escribe las tallas individuales que incluye cada grupo, separadas por comas (por ejemplo «02A, 04A, 06A»), solo si las sabes con certeza
                (ficha del proveedor). Lo que no se resuelva queda pendiente y no se importa. Cada talla conserva el precio de su fila.
              </p>
              {grupos.map((g) => {
                const r = grupoResuelto[g.clave];
                return (
                  <div key={g.clave} className="border rounded p-2 mb-2">
                    <label htmlFor={`grupo-${g.clave}`} className="form-label mb-1">
                      <strong>«{g.texto}»</strong> <span className="text-muted small">({g.filas} filas, {g.modelos.length} modelos)</span>
                    </label>
                    <input id={`grupo-${g.clave}`} className="form-control form-control-sm" placeholder="Tallas para todos los modelos" value={textosGrupo[g.clave] ?? ""}
                      onChange={(e) => setTextosGrupo((t) => ({ ...t, [g.clave]: e.target.value }))} />
                    {r?.errores.map((e) => <div key={e} className="small text-danger">{e}</div>)}
                    {r && r.errores.length === 0 && r.tallas.length > 0 && <div className="small text-success">{r.tallas.length} tallas: {r.tallas.join(", ")}</div>}
                    <details className="mt-1 small">
                      <summary>Tallas distintas para un modelo</summary>
                      {g.modelos.map((m) => {
                        const rm = grupoResuelto[m.clave];
                        return (
                          <div key={m.clave} className="d-flex flex-wrap align-items-center gap-2 mt-1">
                            <label htmlFor={`grupo-${m.clave}`} className="mb-0" style={{ minWidth: "12rem" }}>{m.modelo} <span className="text-muted">({m.colores.join(", ")})</span></label>
                            <input id={`grupo-${m.clave}`} className="form-control form-control-sm w-auto" placeholder="Como el grupo" value={textosGrupo[m.clave] ?? ""}
                              onChange={(e) => setTextosGrupo((t) => ({ ...t, [m.clave]: e.target.value }))} />
                            {m.sugerencia.length > 0 && (
                              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setTextosGrupo((t) => ({ ...t, [m.clave]: m.sugerencia.join(", ") }))}>
                                Usar las del catálogo ({m.sugerencia.join(", ")})
                              </button>
                            )}
                            {rm?.errores.map((e) => <span key={e} className="text-danger">{e}</span>)}
                          </div>
                        );
                      })}
                    </details>
                  </div>
                );
              })}
            </>
          )}
          <p className="small text-muted mt-2">Lo que quede sin decidir se queda como «referencia ambigua» y se ignora: {conflictos.length} líneas ({conflictos.filter((i) => i.conflicto === "grupo").length} de tallas agrupadas sin resolver).</p>
          <Navegar paso={paso} setPaso={cambiarPaso} />
        </section>
      )}

      {paso === 7 && comparacion && (
        <section aria-labelledby="t-decisiones">
          <h2 id="t-decisiones" className="h5">7. Decide qué hacer</h2>
          <p className="small text-muted">Todo empieza en «Ignorar»: ningún precio cambia sin que lo marques.</p>
          <div className="nav nav-pills gx-pestanas flex-wrap gap-1 mb-2" role="tablist">
            {ESTADOS.map((e) => (
              <button key={e} type="button" role="tab" aria-selected={pestana === e} className={`nav-link py-1 px-2 small ${pestana === e ? "active" : ""}`} onClick={() => { setPestana(e); setPagina(1); }}>
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
                {paginar(listaPestana, pagina).map((i) => (
                  <tr key={i.id}>
                    <td>{i.modelo}{i.referencia && <span className="text-muted"> · {i.referencia}</span>}</td>
                    <td>{i.color}</td><td>{i.talla}</td>
                    <td>{i.actual ? describirPrecio(i.actual) : "—"}</td>
                    <td>{i.nuevo ? describirPrecio(i.nuevo) : i.importe ? euro5(i.importe) : "—"}{i.modalidadUsada && i.modalidadUsada !== opciones.modalidad && <span className="text-muted"> ({i.modalidadUsada})</span>}</td>
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
          <Paginacion total={listaPestana.length} pagina={pagina} onCambiar={setPagina} etiqueta="Páginas de la lista" />
          <p className="small text-muted mt-1">Los botones de arriba se aplican a toda la lista filtrada, no solo a esta página.</p>
          {modelosSinTipo.length > 0 && (
            <div className="mt-3">
              <h3 className="h6">Tipo de artículo de los modelos nuevos ({modelosSinTipo.length})</h3>
              <p className="small text-muted mb-2">La tarifa no indica el tipo. Puedes darlo a todos a la vez y corregirlo después en la ficha de cada modelo.</p>
              <div className="d-flex flex-wrap gap-2 mb-2">
                <input className="form-control form-control-sm w-auto" list="tipos-sugeridos" placeholder="Tipo para todos" aria-label="Tipo para todos los modelos nuevos sin tipo" value={tipoTodos} onChange={(e) => setTipoTodos(e.target.value)} />
                <button type="button" className="btn btn-sm btn-outline-primary" disabled={!tipoTodos.trim()}
                  onClick={() => setTipos((t) => ({ ...t, ...Object.fromEntries(modelosSinTipo.filter(([k]) => !t[k]?.trim()).map(([k]) => [k, tipoTodos.trim()])) }))}>
                  Aplicar a los que no tienen tipo
                </button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setTipoTodos("Sin clasificar")}>Sin clasificar</button>
              </div>
              <datalist id="tipos-sugeridos">{TIPOS_SUGERIDOS.map((t) => <option key={t} value={t} />)}</datalist>
              <div className="row g-2">
                {paginar(modelosSinTipo, paginaTipos).map(([k, nombre]) => (
                  <div className="col-sm-6 col-lg-4" key={k}>
                    <label className="form-label small mb-0" htmlFor={`tipo-${k}`}>{nombre}</label>
                    <input id={`tipo-${k}`} className="form-control form-control-sm" list="tipos-sugeridos" value={tipos[k] ?? ""} onChange={(e) => setTipos((t) => ({ ...t, [k]: e.target.value }))} />
                  </div>
                ))}
              </div>
              <Paginacion total={modelosSinTipo.length} pagina={paginaTipos} onCambiar={setPaginaTipos} etiqueta="Páginas de modelos nuevos" />
            </div>
          )}
          <div className="form-check mt-3">
            <input className="form-check-input" type="checkbox" id="guardar-modalidades" checked={guardarModalidades} onChange={(e) => setGuardarModalidades(e.target.checked)} />
            <label className="form-check-label" htmlFor="guardar-modalidades">Guardar también las modalidades alternativas de las variantes con precio igual (no cambia su precio)</label>
          </div>
          <Navegar paso={paso} setPaso={cambiarPaso} />
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
            {previsto.modelosCompletados > 0 && <li>{previsto.modelosCompletados} modelos existentes reciben la marca o la referencia que les faltaba (no se sobrescribe nada)</li>}
            {Object.keys(previsto.porModalidad).length > 1 && <li>Precio según modalidad: {Object.entries(previsto.porModalidad).map(([m, n]) => `${m} ${n}`).join(" · ")}</li>}
          </ul>
          <p className="small">Precio usado en presupuestos: modalidad <strong>{lectura.formato.modalidades.find((m) => m.id === opciones.modalidad)?.nombre}</strong>, {INTERPRETACIONES[opciones.interpretacion]}, IVA {ivaNum} %.</p>
          <Aviso tipo="info">No cambian: presupuestos guardados (conservan su precio), existencias, reservas ni movimientos de inventario.</Aviso>
          {conflictos.some((i) => i.conflicto === "grupo") && (
            <Aviso tipo="warning">{conflictos.filter((i) => i.conflicto === "grupo").length} líneas con tallas agrupadas siguen pendientes y no se importarán (paso 6).</Aviso>
          )}
          {altas.length > 0 && (
            <>
              <h3 className="h6">Variantes que se crearán ({altas.length})</h3>
              <input type="search" className="form-control form-control-sm mb-2" placeholder="Buscar" aria-label="Buscar en las variantes nuevas" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
              <div className="gx-tabla table-responsive">
                <table className="table table-sm mb-0 small" aria-label="Variantes que se crearán">
                  <thead><tr><th>Modelo</th><th>Color</th><th>Talla</th><th>Precio</th></tr></thead>
                  <tbody>
                    {paginar(altasVista, pagina).map((o) => (
                      <tr key={`${o.modelo.nombre}|${o.color}|${o.talla}`}><td>{o.modelo.nombre}</td><td>{o.color}</td><td>{o.talla}</td><td>{describirPrecio(o.precio)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacion total={altasVista.length} pagina={pagina} onCambiar={setPagina} etiqueta="Páginas de variantes nuevas" />
            </>
          )}
          {errores.filter((e) => !e.startsWith("Indica el tipo")).map((e) => <Aviso key={e} tipo="warning">{e}</Aviso>)}
          {errores.some((e) => e.startsWith("Indica el tipo")) && (
            <Aviso tipo="warning">Falta el tipo de artículo en {errores.filter((e) => e.startsWith("Indica el tipo")).length} modelos nuevos: ponlo en el paso 7 (puedes usar «Sin clasificar» para todos).</Aviso>
          )}
          <Navegar paso={paso} setPaso={cambiarPaso} puedeSeguir={errores.length === 0 && operaciones.length > 0} />
        </section>
      )}

      {paso === 9 && comparacion && (
        <section aria-labelledby="t-confirmar">
          <h2 id="t-confirmar" className="h5">9. Confirmar</h2>
          <p>Proveedor <strong>{nombreProveedor}</strong> · archivo <strong>{archivo.nombre}</strong> · {operaciones.length} cambios.</p>
          <p className="small text-muted">
            Se guarda por lotes de {tamanoLote} cambios: cada lote entero o nada. Si uno falla, podrás reintentarlo sin duplicar nada o revertir lo ya guardado.
            Queda registrado quién, cuándo, con qué archivo (huella) y cada precio anterior.
          </p>
          {avisoReversion && <Aviso tipo="info">{avisoReversion}</Aviso>}
          {parcial ? (
            cajaParcial
          ) : (
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-outline-secondary" onClick={() => cambiarPaso(8)}>Atrás</button>
              <button type="button" className="btn btn-primary" disabled={Boolean(importando) || errores.length > 0 || operaciones.length === 0} onClick={importar}>{importando ? `Aplicando lote ${Math.min(importando.lote + 1, importando.lotes)} de ${importando.lotes}…` : "Aplicar tarifa"}</button>
            </div>
          )}
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
      )}
    </>
  );
}

export default PaginaImportarTarifa;
