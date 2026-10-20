import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { getProductos } from "../../services/getProductos";
import { obtenerArticulo, registrarMovimiento } from "./data/inventarioRepo";
import { MOVIMIENTOS_MANUALES, prepararMovimiento, describirArticulo } from "./domain/inventario";
import { euro5 } from "../catalogo/domain/catalogo";
import { NavInventario, SelectorVariante } from "./Comunes";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";

const FORM = { tipo: "entrada", unidades: "", coste: "", referencia: "", motivo: "", fecha: "" };

/** Fast stock movement form: entry, exit, return, loss or adjustment by count. */
function PaginaMovimiento({ obtenerCliente = obtenerClienteSupabase, cargarProductos = getProductos }) {
  const [busqueda] = useSearchParams();
  const [productos, setProductos] = useState(null);
  const [varianteId, setVarianteId] = useState(busqueda.get("variante") ?? "");
  const [articulo, setArticulo] = useState(null);
  const [form, setForm] = useState(() => ({ ...FORM, tipo: MOVIMIENTOS_MANUALES[busqueda.get("tipo")] ? busqueda.get("tipo") : "entrada" }));
  const [errores, setErrores] = useState([]);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    cargarProductos().then(setProductos).catch((e) => setMensaje({ tipo: "danger", texto: e.message }));
  }, [cargarProductos]);

  // Current stock of the chosen item (null = not in stock yet)
  useEffect(() => {
    if (!varianteId) return setArticulo(null);
    let vigente = true;
    (async () => {
      const a = await obtenerArticulo(await obtenerCliente(), varianteId);
      if (vigente) setArticulo(a);
    })().catch((e) => setMensaje({ tipo: "danger", texto: e.message }));
    return () => {
      vigente = false;
    };
  }, [varianteId, obtenerCliente, mensaje]);

  const producto = productos?.find((p) => String(p.id) === String(varianteId));
  const def = MOVIMIENTOS_MANUALES[form.tipo];
  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const registrar = async (e) => {
    e.preventDefault();
    setMensaje(null);
    if (!varianteId) return setErrores(["Elige el artículo."]);
    const p = prepararMovimiento(form, articulo);
    if (p.errores) return setErrores(p.errores);
    setErrores([]);
    setOcupado(true);
    try {
      await registrarMovimiento(await obtenerCliente(), { varianteId, tipo: form.tipo, cantidad: p.cantidad, motivo: form.motivo, referencia: form.referencia, coste: p.coste, fecha: form.fecha });
      setMensaje({ tipo: "success", texto: `${MOVIMIENTOS_MANUALES[form.tipo].etiqueta} registrada: ${p.cantidad > 0 ? "+" : ""}${p.cantidad} · ${describirArticulo({ ...producto, talla: producto.talla })}.` });
      setForm((f) => ({ ...FORM, tipo: f.tipo, referencia: f.referencia, fecha: f.fecha })); // ready for the next line of the same delivery
    } catch (error) {
      setMensaje({ tipo: "danger", texto: error.message });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Cabecera titulo="Registrar movimiento" descripcion="Cada movimiento queda en el historial y no se puede borrar; los errores se corrigen desde la ficha del artículo." />
      <NavInventario />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {productos === null ? <Cargando texto="Cargando catálogo…" /> : (
        <form className="gx-tarjeta" onSubmit={registrar} noValidate aria-label="Movimiento de almacén">
          <div className="d-flex flex-wrap gap-2 mb-3" role="radiogroup" aria-label="Tipo de movimiento">
            {Object.entries(MOVIMIENTOS_MANUALES).map(([k, v]) => (
              <button key={k} type="button" role="radio" aria-checked={form.tipo === k} className={`btn btn-sm ${form.tipo === k ? "btn-primary" : "btn-outline-secondary"}`}
                onClick={() => setForm((f) => ({ ...f, tipo: k }))}>{v.etiqueta}</button>
            ))}
          </div>
          <SelectorVariante productos={productos} inicialId={varianteId} onElegir={(id) => {
            setVarianteId(id);
            const p = productos.find((x) => String(x.id) === String(id));
            if (p && MOVIMIENTOS_MANUALES[form.tipo].coste) setForm((f) => ({ ...f, coste: f.coste || String(Number(p.coste)) }));
          }} />
          {varianteId && (
            <p className="small mt-2 mb-0" data-testid="stock-actual">
              {articulo ? <>Ahora: <strong>{articulo.fisico}</strong> físicas · {articulo.reservado} reservadas · <strong>{articulo.disponible}</strong> disponibles. <Link to={`/inventario/articulos/${varianteId}`}>Ver ficha</Link></> : "Este artículo aún no tiene existencias."}
            </p>
          )}
          <div className="row g-2 mt-1">
            <div className="col-6 col-md-2">
              <label className="form-label small mb-0" htmlFor="mov-unidades">{def.recuento ? "Unidades contadas" : "Unidades"}</label>
              <input id="mov-unidades" className="form-control form-control-sm" inputMode="numeric" value={form.unidades} onChange={cambiar("unidades")} />
            </div>
            {def.coste && (
              <div className="col-6 col-md-2">
                <label className="form-label small mb-0" htmlFor="mov-coste">Coste unitario (€)</label>
                <input id="mov-coste" className="form-control form-control-sm" inputMode="decimal" value={form.coste} onChange={cambiar("coste")} />
                {producto && <div className="form-text">Catálogo hoy: {euro5(producto.coste)}</div>}
              </div>
            )}
            <div className="col-6 col-md-3">
              <label className="form-label small mb-0" htmlFor="mov-referencia">Referencia (albarán, pedido…)</label>
              <input id="mov-referencia" className="form-control form-control-sm" value={form.referencia} onChange={cambiar("referencia")} />
            </div>
            <div className="col-6 col-md-2">
              <label className="form-label small mb-0" htmlFor="mov-fecha">Fecha</label>
              <input id="mov-fecha" type="date" className="form-control form-control-sm" value={form.fecha} onChange={cambiar("fecha")} />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label small mb-0" htmlFor="mov-motivo">Motivo{def.motivoObligatorio ? " *" : " (opcional)"}</label>
              <input id="mov-motivo" className="form-control form-control-sm" value={form.motivo} onChange={cambiar("motivo")} />
            </div>
          </div>
          {errores.length > 0 && <div className="alert alert-danger small py-2 mt-2 mb-0" role="alert">{errores.join(" ")}</div>}
          <button type="submit" className="btn btn-primary mt-3" disabled={ocupado}>Registrar {def.etiqueta.toLowerCase()}</button>
        </form>
      )}
    </>
  );
}

export default PaginaMovimiento;
