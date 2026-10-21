import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Shirt } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import {
  obtenerModelo, actualizarModelo, archivarModelo, obtenerProveedor, listarVariantes, crearVariantes, actualizarVariante, archivarVariante,
} from "./data/catalogoRepo";
import { interpretarPrecio, precioDeVariante, describirPrecio, costeEfectivo, euro5, validarVariante } from "./domain/catalogo";
import { FormularioModelo } from "./Formularios";
import CampoPrecio from "./CampoPrecio";
import AltaVariantes from "./AltaVariantes";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";

// Inline editor for one variant (also used to duplicate it with another colour/size)
function EditorVariante({ variante, duplicar, existentes, onGuardar, onCancelar }) {
  const [color, setColor] = useState(variante.color);
  const [talla, setTalla] = useState(duplicar ? "" : variante.talla);
  const [precio, setPrecio] = useState(() => precioDeVariante(variante));
  const [error, setError] = useState(null);
  const guardar = async () => {
    const fallos = validarVariante({ color, talla }, existentes, duplicar ? null : variante.id);
    const p = interpretarPrecio(precio);
    if (fallos.length || p.error) return setError([...fallos, p.error].filter(Boolean).join(" "));
    try {
      await onGuardar({ color: color.trim(), talla: talla.trim(), ...p.valores, coste_cent: Math.round(p.coste * 100) });
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <tr>
      <td colSpan={5}>
        <div className="p-2 bg-light rounded" role="group" aria-label={duplicar ? "Duplicar variante" : "Editar variante"}>
          <div className="small fw-semibold mb-2">{duplicar ? `Duplicar ${variante.color} · ${variante.talla}: indica el nuevo color o talla` : "Editar variante"}</div>
          <div className="row g-2 mb-2">
            <div className="col-6 col-md-3"><label className="form-label small mb-0" htmlFor="ed-color">Color</label><input id="ed-color" className="form-control form-control-sm" value={color} onChange={(e) => setColor(e.target.value)} /></div>
            <div className="col-6 col-md-3"><label className="form-label small mb-0" htmlFor="ed-talla">Talla</label><input id="ed-talla" className="form-control form-control-sm" value={talla} onChange={(e) => setTalla(e.target.value)} /></div>
          </div>
          <CampoPrecio valor={precio} onChange={setPrecio} compacto />
          {error && <div className="alert alert-danger small py-1 mt-2 mb-0" role="alert">{error}</div>}
          <div className="d-flex gap-2 mt-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={guardar}>{duplicar ? "Crear copia" : "Guardar"}</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCancelar}>Cancelar</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

/** Model card: details, archive, and its colour/size variants with purchase prices. */
function PaginaFichaModelo({ obtenerCliente = obtenerClienteSupabase }) {
  const { id } = useParams();
  const modeloId = Number(id);
  const confirmar = useConfirmar();
  const [modelo, setModelo] = useState(null);
  const [proveedor, setProveedor] = useState(null);
  const [variantes, setVariantes] = useState(null);
  const [editandoModelo, setEditandoModelo] = useState(false);
  const [alta, setAlta] = useState(false);
  const [edicion, setEdicion] = useState(null); // { id, duplicar }
  const [archivadas, setArchivadas] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const sb = await obtenerCliente();
      const m = await obtenerModelo(sb, modeloId);
      setModelo(m);
      setProveedor(m.proveedor_id ? await obtenerProveedor(sb, m.proveedor_id) : null);
      setVariantes(await listarVariantes(sb, modeloId));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setVariantes([]);
    }
  }, [obtenerCliente, modeloId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const ejecutar = async (fn, ok) => {
    try {
      await fn(await obtenerCliente());
      setMensaje({ tipo: "success", texto: ok });
      setEdicion(null);
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  };

  const archivarEsteModelo = async () => {
    const activo = !modelo.activo;
    if (!activo && !(await confirmar({
      titulo: `¿Archivar «${modelo.nombre}»?`,
      mensaje: "Dejará de aparecer en la calculadora. No se borra nada: los presupuestos guardados conservan sus precios y podrás reactivarlo.",
      aceptar: "Archivar modelo",
      peligro: true,
    }))) return;
    ejecutar((sb) => archivarModelo(sb, modeloId, activo), activo ? "Modelo reactivado." : "Modelo archivado.");
  };

  const archivarVar = async (v) => {
    if (v.activo && !(await confirmar({ titulo: `¿Archivar ${v.color} · ${v.talla}?`, mensaje: "Dejará de ofrecerse en la calculadora. Podrás reactivarla.", aceptar: "Archivar", peligro: true }))) return;
    ejecutar((sb) => archivarVariante(sb, v.id, !v.activo), v.activo ? "Variante archivada." : "Variante reactivada.");
  };

  if (!modelo) return mensaje ? <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso> : <Cargando texto="Cargando modelo…" />;
  const visibles = (variantes ?? []).filter((v) => archivadas || v.activo);
  const vuelta = modelo.proveedor_id ? `/catalogo/proveedores/${modelo.proveedor_id}` : "/catalogo/proveedores/propios";

  return (
    <>
      <Link to={vuelta} className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />{proveedor?.nombre ?? "Productos propios"}</Link>
      <div className="gx-cabecera">
        <div>
          <h1>{modelo.nombre}{!modelo.activo && <span className="gx-insignia gx-estado-importado ms-2 align-middle">Archivado</span>}</h1>
          <p>{[modelo.tipo, modelo.marca, proveedor?.nombre ?? "Producto propio", modelo.referencia ? `Ref. ${modelo.referencia}` : null].filter(Boolean).join(" · ")}{modelo.descripcion ? ` — ${modelo.descripcion}` : ""}</p>
        </div>
        <div className="gx-cabecera-acciones">
          <button type="button" className="btn btn-outline-secondary" onClick={() => setEditandoModelo(true)}>Editar modelo</button>
          <button type="button" className="btn btn-outline-secondary" onClick={archivarEsteModelo}>{modelo.activo ? "Archivar" : "Reactivar"}</button>
          <button type="button" className="btn btn-primary btn-icono" onClick={() => setAlta(true)}><Plus size={16} aria-hidden="true" />Añadir variantes</button>
        </div>
      </div>
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {editandoModelo && (
        <FormularioModelo titulo="Editar modelo" inicial={modelo} onCancelar={() => setEditandoModelo(false)}
          onGuardar={async (d) => {
            setModelo(await actualizarModelo(await obtenerCliente(), modeloId, d));
            setEditandoModelo(false);
            setMensaje({ tipo: "success", texto: "Modelo guardado." });
          }} />
      )}
      {alta && (
        <AltaVariantes existentes={variantes ?? []} onCerrar={() => setAlta(false)}
          onCrear={async (filas) => {
            await crearVariantes(await obtenerCliente(), modeloId, filas);
            setAlta(false);
            setMensaje({ tipo: "success", texto: `${filas.length} variante(s) creada(s).` });
            await cargar();
          }} />
      )}

      <div className="d-flex align-items-center gap-3 mb-2">
        <h2 className="h6 mb-0">Variantes</h2>
        <div className="form-check mb-0">
          <input id="var-archivadas" type="checkbox" className="form-check-input" checked={archivadas} onChange={(e) => setArchivadas(e.target.checked)} />
          <label className="form-check-label small" htmlFor="var-archivadas">Mostrar archivadas</label>
        </div>
        <span className="small text-muted ms-auto d-none d-md-inline">Precios de compra · no son existencias</span>
      </div>
      {variantes === null ? <Cargando /> : visibles.length === 0 ? (
        <div className="gx-tabla"><EstadoVacio icono={Shirt} titulo="Sin variantes" accion={<button type="button" className="btn btn-primary" onClick={() => setAlta(true)}>Añadir colores y tallas</button>} /></div>
      ) : (
        <div className="gx-tabla">
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead><tr><th>Color</th><th>Talla</th><th className="d-none d-md-table-cell">Precio de compra</th><th className="text-end">Coste</th><th /></tr></thead>
              <tbody>
                {visibles.map((v) =>
                  edicion?.id === v.id ? (
                    <EditorVariante key={v.id} variante={v} duplicar={edicion.duplicar} existentes={variantes} onCancelar={() => setEdicion(null)}
                      onGuardar={(datos) => (edicion.duplicar
                        ? ejecutar((sb) => crearVariantes(sb, modeloId, [{ color: datos.color, talla: datos.talla, coste_cent: datos.coste_cent, precio: { precio_neto: datos.precio_neto, iva_porcentaje: datos.iva_porcentaje, precio_compra: datos.precio_compra } }]), "Variante duplicada.")
                        : ejecutar((sb) => actualizarVariante(sb, v.id, datos), "Variante guardada. Los presupuestos guardados no cambian."))} />
                  ) : (
                    <tr key={v.id} className={v.activo ? "" : "text-muted"}>
                      <td>{v.color}{!v.activo && <span className="gx-insignia gx-estado-importado ms-2">Archivada</span>}</td>
                      <td>{v.talla}</td>
                      <td className="d-none d-md-table-cell small">
                        {describirPrecio(v)}{v.modalidad && <span className="text-muted"> · {v.modalidad}</span>}
                        {(v.variantes_tarifas ?? []).filter((t) => t.modalidad !== v.modalidad).length > 0 && (
                          <div className="text-muted">
                            Alternativas: {v.variantes_tarifas.filter((t) => t.modalidad !== v.modalidad).map((t) => `${t.modalidad} ${euro5(Number(t.precio))}${t.unidades ? ` (×${t.unidades})` : ""}`).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="text-end fw-semibold">{euro5(costeEfectivo(v))}</td>
                      <td className="text-end text-nowrap">
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setEdicion({ id: v.id, duplicar: false })}>Editar</button>{" "}
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEdicion({ id: v.id, duplicar: true })}>Duplicar</button>{" "}
                        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => archivarVar(v)}>{v.activo ? "Archivar" : "Reactivar"}</button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export default PaginaFichaModelo;
