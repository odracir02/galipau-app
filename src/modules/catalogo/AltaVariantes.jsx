import { useState } from "react";
import CampoPrecio from "./CampoPrecio";
import { TALLAS_FRECUENTES, combinaciones, interpretarPrecio, separarLista } from "./domain/catalogo";

const PRECIO_INICIAL = { modo: "neto", importe: "", iva: "21" };

/**
 * Adds many variants at once without retyping: colours × sizes grid where the
 * owner ticks only the combinations that really exist, with one shared price.
 */
function AltaVariantes({ existentes, onCrear, onCerrar }) {
  const [colores, setColores] = useState("");
  const [tallas, setTallas] = useState([]);
  const [otraTalla, setOtraTalla] = useState("");
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [precio, setPrecio] = useState(PRECIO_INICIAL);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const listaColores = separarLista(colores);
  const rejilla = combinaciones(listaColores, tallas, existentes);
  const nuevas = rejilla.filter((c) => !c.existe);
  const elegidas = nuevas.filter((c) => marcadas.has(c.clave));

  const alternarTalla = (t) => setTallas((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  const alternar = (clave) => setMarcadas((m) => {
    const n = new Set(m);
    if (n.has(clave)) n.delete(clave);
    else n.add(clave);
    return n;
  });

  const crear = async () => {
    setError(null);
    const p = interpretarPrecio(precio);
    if (p.error) return setError(p.error);
    if (elegidas.length === 0) return setError("Marca al menos una combinación de color y talla.");
    setOcupado(true);
    try {
      await onCrear(elegidas.map((c) => ({ color: c.color, talla: c.talla, precio: p.valores, coste_cent: Math.round(p.coste * 100) })));
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="gx-tarjeta mb-3" aria-label="Añadir variantes">
      <h2 className="h6">Añadir variantes</h2>
      <div className="row g-3">
        <div className="col-md-5">
          <label className="form-label small mb-0" htmlFor="alta-colores">Colores (separados por comas)</label>
          <input id="alta-colores" className="form-control form-control-sm" placeholder="Blanco, Negro, Rojo" value={colores} onChange={(e) => setColores(e.target.value)} />
        </div>
        <div className="col-md-7">
          <div className="form-label small mb-1">Tallas</div>
          <div className="d-flex flex-wrap gap-1" role="group" aria-label="Tallas">
            {[...TALLAS_FRECUENTES, ...tallas.filter((t) => !TALLAS_FRECUENTES.includes(t))].map((t) => (
              <button key={t} type="button" aria-pressed={tallas.includes(t)} className={`btn btn-sm ${tallas.includes(t) ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => alternarTalla(t)}>{t}</button>
            ))}
            <span className="input-group input-group-sm" style={{ width: 150 }}>
              <input aria-label="Otra talla" className="form-control" placeholder="Otra talla" value={otraTalla} onChange={(e) => setOtraTalla(e.target.value)} />
              <button type="button" className="btn btn-outline-secondary" onClick={() => {
                const t = otraTalla.trim();
                if (t && !tallas.some((x) => x.toLowerCase() === t.toLowerCase())) setTallas((ts) => [...ts, t]);
                setOtraTalla("");
              }}>Añadir</button>
            </span>
          </div>
        </div>
      </div>

      {rejilla.length > 0 && (
        <div className="mt-3">
          <div className="d-flex align-items-center gap-2 mb-2">
            <span className="small text-muted">Marca solo las combinaciones que existen ({elegidas.length} de {nuevas.length} nuevas).</span>
            <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setMarcadas(new Set(nuevas.map((c) => c.clave)))}>Marcar todas</button>
            <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setMarcadas(new Set())}>Ninguna</button>
          </div>
          <div className="table-responsive">
            <table className="table table-sm small w-auto">
              <thead><tr><th>Color</th>{tallas.map((t) => <th key={t} className="text-center">{t}</th>)}</tr></thead>
              <tbody>
                {listaColores.map((color) => (
                  <tr key={color}>
                    <th>{color}</th>
                    {tallas.map((talla) => {
                      const c = rejilla.find((x) => x.color === color && x.talla === talla);
                      return (
                        <td key={talla} className="text-center">
                          {c.existe ? <span className="text-muted" title="Ya existe">✓</span> : (
                            <input type="checkbox" className="form-check-input" aria-label={`${color} ${talla}`} checked={marcadas.has(c.clave)} onChange={() => alternar(c.clave)} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-2">
        <div className="form-label small mb-1">Precio de compra para las variantes marcadas</div>
        <CampoPrecio valor={precio} onChange={setPrecio} compacto />
      </div>
      {error && <div className="alert alert-danger small py-2 mt-2 mb-0" role="alert">{error}</div>}
      <div className="d-flex gap-2 mt-3">
        <button type="button" className="btn btn-sm btn-primary" onClick={crear} disabled={ocupado}>Crear {elegidas.length} variante(s)</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCerrar}>Cerrar</button>
      </div>
    </section>
  );
}

export default AltaVariantes;
