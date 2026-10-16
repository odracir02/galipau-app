import { useCallback, useEffect, useState } from "react";
import { cargarParametrosActivos, crearVersion, listarVersiones } from "./parametrosRepo";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { backendActivo } from "../../app/backend";
import { CAMPOS_PARAMETROS, GRUPOS_PARAMETROS, BASES_CONSUMO, validarParametros } from "../../domain/calculo/serigrafia/parametros";
import { leerNumero } from "../../shared/utils/dinero";
import { aFormulario, desdeFormulario, extraerParametrosImportados, consumibleVacio, leerArchivoTexto } from "./formularioParametros";

// Administration of the versioned screen printing parameters. Saving never
// edits a version: it creates a new active one and archives the previous.
function PaginaParametros({ obtenerCliente = obtenerClienteSupabase }) {
  const nube = backendActivo() === "supabase" || obtenerCliente !== obtenerClienteSupabase;
  const [activa, setActiva] = useState(undefined);
  const [versiones, setVersiones] = useState([]);
  const [form, setForm] = useState(() => aFormulario(null));
  const [notas, setNotas] = useState("");
  const [mensaje, setMensaje] = useState(null);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const [a, v] = await Promise.all([cargarParametrosActivos(sb, "serigrafia"), listarVersiones(sb, "serigrafia")]);
      setActiva(a);
      setVersiones(v);
      setForm(aFormulario(a?.valores ?? null));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setActiva(null);
    }
  }, [obtenerCliente]);

  useEffect(() => {
    if (nube) cargar();
  }, [nube, cargar]);

  if (!nube) {
    return <div className="container mt-4"><h2>Parámetros de cálculo</h2><div className="alert alert-info">Disponible en la versión en la nube de Galipau App.</div></div>;
  }
  if (activa === undefined) return <div className="container mt-4" role="status">Cargando parámetros…</div>;

  const cambiarCampo = (clave, valor) => setForm((f) => ({ ...f, campos: { ...f.campos, [clave]: valor } }));
  const cambiarConsumible = (i, clave, valor) =>
    setForm((f) => ({ ...f, consumibles: f.consumibles.map((c, j) => (j === i ? { ...c, [clave]: valor } : c)) }));

  const importar = async (archivo) => {
    setMensaje(null);
    try {
      const datos = extraerParametrosImportados(JSON.parse(await leerArchivoTexto(archivo)));
      const problemas = validarParametros(datos);
      if (problemas.length) throw new Error(`El archivo no contiene parámetros válidos: ${problemas.slice(0, 3).join(" ")}`);
      setForm(aFormulario(datos));
      setNotas((n) => n || `Importado de ${archivo.name}`);
      setMensaje({ tipo: "info", texto: `Valores cargados desde ${archivo.name}. Revísalos y pulsa «Guardar como nueva versión».` });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message.startsWith("El archivo") ? e.message : `No se pudo leer el archivo: ${e.message}` });
    }
  };

  const guardar = async () => {
    setMensaje(null);
    const valores = desdeFormulario(form);
    const problemas = validarParametros(valores);
    setErrores(problemas);
    if (problemas.length) return;
    setGuardando(true);
    try {
      const sb = await obtenerCliente();
      const version = await crearVersion(sb, "serigrafia", valores, notas.trim());
      setNotas("");
      await cargar();
      setMensaje({ tipo: "success", texto: `Versión ${version} guardada y activa. Los cálculos nuevos ya la usan.` });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    } finally {
      setGuardando(false);
    }
  };

  const grupos = Object.entries(GRUPOS_PARAMETROS);
  return (
    <div className="container mt-4">
      <h2 className="mb-1">Parámetros de cálculo — serigrafía</h2>
      <p className="text-muted">
        {activa ? `Versión activa: ${activa.version}${activa.notas ? ` (${activa.notas})` : ""}.` : "Todavía no hay ninguna versión."} Al guardar se crea una versión nueva; las anteriores se conservan.
      </p>
      {mensaje && <div className={`alert alert-${mensaje.tipo}`} role="alert">{mensaje.texto}</div>}

      <div className="mb-3">
        <label className="form-label small" htmlFor="importar">Importar valores desde un archivo JSON (por ejemplo, los del Excel)</label>
        <input id="importar" type="file" accept="application/json,.json" className="form-control form-control-sm" style={{ maxWidth: 420 }}
          onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
      </div>

      <div className="row g-3">
        {grupos.map(([grupo, titulo]) => (
          <div className="col-lg-6" key={grupo}>
            <h5>{titulo}</h5>
            {CAMPOS_PARAMETROS.filter((c) => c.grupo === grupo).map((c) => (
              <div className="input-group input-group-sm mb-1" key={c.clave}>
                <label className="input-group-text flex-grow-1 text-wrap text-start" htmlFor={`p-${c.clave}`} style={{ maxWidth: "60%" }}>{c.etiqueta}</label>
                <input id={`p-${c.clave}`} className="form-control" inputMode="decimal" value={form.campos[c.clave]} onChange={(e) => cambiarCampo(c.clave, e.target.value)} />
                <span className="input-group-text small">{c.unidad}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <h5 className="mt-4">Materiales y consumibles</h5>
      <p className="small text-muted">Coste por uso = precio ÷ (contenido × rendimiento), o precio ÷ contenido × consumo. Usa precios con el IVA que realmente pagas.</p>
      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr><th>Nombre</th><th>Se gasta</th><th>Precio (€)</th><th>Contenido</th><th>Unidad</th><th>Rendimiento (usos/unidad)</th><th>o consumo (unidades/uso)</th><th></th></tr>
          </thead>
          <tbody>
            {form.consumibles.map((c, i) => (
              <tr key={i}>
                <td><input aria-label={`Nombre consumible ${i + 1}`} className="form-control form-control-sm" value={c.nombre} onChange={(e) => cambiarConsumible(i, "nombre", e.target.value)} /></td>
                <td>
                  <select aria-label={`Base consumible ${i + 1}`} className="form-select form-select-sm" value={c.base} onChange={(e) => cambiarConsumible(i, "base", e.target.value)}>
                    {Object.entries(BASES_CONSUMO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </td>
                {["precio", "contenido", "unidad", "rendimiento", "consumo"].map((k) => (
                  <td key={k}>
                    <input aria-label={`${k} consumible ${i + 1}`} className="form-control form-control-sm" inputMode={k === "unidad" ? "text" : "decimal"} value={c[k]} onChange={(e) => cambiarConsumible(i, k, e.target.value)} />
                  </td>
                ))}
                <td><button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Quitar consumible ${i + 1}`} onClick={() => setForm((f) => ({ ...f, consumibles: f.consumibles.filter((_, j) => j !== i) }))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setForm((f) => ({ ...f, consumibles: [...f.consumibles, consumibleVacio()] }))}>+ Añadir consumible</button>

      <div className="mt-4" style={{ maxWidth: 600 }}>
        <label className="form-label" htmlFor="notas">Motivo del cambio (opcional)</label>
        <input id="notas" className="form-control mb-2" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej.: nuevo precio del plastisol" />
        {errores.length > 0 && (
          <div className="alert alert-danger small" role="alert"><ul className="mb-0">{errores.map((e) => <li key={e}>{e}</li>)}</ul></div>
        )}
        <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>Guardar como nueva versión</button>
      </div>

      {versiones.length > 0 && (
        <>
          <h5 className="mt-5">Historial de versiones</h5>
          <ul className="list-unstyled small">
            {versiones.map((v) => (
              <li key={v.version}>Versión {v.version} — {new Date(v.creado_en).toLocaleString("es-ES")} — {v.estado}{v.notas ? ` — ${v.notas}` : ""}</li>
            ))}
          </ul>
        </>
      )}
      <p className="small text-muted">Valores numéricos: admite coma o punto decimal ({leerNumero("1,5") === 1.5 ? "1,5 = 1.5" : ""}).</p>
    </div>
  );
}

export default PaginaParametros;
