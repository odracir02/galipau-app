import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import Cargando from "../../shared/ui/Cargando";
import { normalizarTexto, posicionTalla } from "../../domain/catalogo";
import { catalogoProveedor } from "./data/comprasRepo";

/** Adds garments of the supplier by hand (to restock): model → colour → amount per size. */
function PanelAnadirPrenda({ proveedorId, lineas, obtenerCliente, onAnadir, onCancelar, ocupado }) {
  const [catalogo, setCatalogo] = useState(null);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [modelo, setModelo] = useState(null);
  const [color, setColor] = useState("");
  const [cantidades, setCantidades] = useState({});

  useEffect(() => {
    let vigente = true;
    obtenerCliente()
      .then((sb) => catalogoProveedor(sb, proveedorId))
      .then((filas) => vigente && setCatalogo(filas.filter((f) => f.disponible !== false)))
      .catch((e) => vigente && setError(e.message));
    return () => {
      vigente = false;
    };
  }, [obtenerCliente, proveedorId]);

  const modelos = useMemo(() => {
    if (!catalogo) return [];
    const q = normalizarTexto(busqueda);
    const vistos = new Map();
    for (const f of catalogo) {
      if (q && !normalizarTexto(`${f.modelo} ${f.referencia ?? ""} ${f.marca ?? ""}`).includes(q)) continue;
      if (!vistos.has(f.modelo)) vistos.set(f.modelo, f);
    }
    return [...vistos.values()].slice(0, 8);
  }, [catalogo, busqueda]);
  const colores = useMemo(() => [...new Set((catalogo ?? []).filter((f) => f.modelo === modelo).map((f) => f.color))].sort(), [catalogo, modelo]);
  const tallas = (catalogo ?? []).filter((f) => f.modelo === modelo && f.color === color).sort((a, b) => posicionTalla(a.talla) - posicionTalla(b.talla));

  const elegirModelo = (m) => {
    setModelo(m);
    const cs = [...new Set(catalogo.filter((f) => f.modelo === m).map((f) => f.color))];
    setColor(cs.length === 1 ? cs[0] : "");
    setCantidades({});
  };

  const anadir = () => {
    const nuevas = tallas
      .map((t) => ({ t, n: Number(cantidades[t.variante_id]) }))
      .filter(({ n }) => Number.isInteger(n) && n > 0)
      .map(({ t, n }) => {
        const existente = lineas.find((l) => l.variante_id === t.variante_id);
        return { variante_id: t.variante_id, para_pedidos: existente?.para_pedidos ?? 0, reposicion: (existente?.reposicion ?? 0) + n };
      });
    onAnadir(nuevas);
  };
  const total = tallas.reduce((s, t) => s + (Number(cantidades[t.variante_id]) > 0 ? Number(cantidades[t.variante_id]) : 0), 0);

  return (
    <section className="border rounded p-3 mt-3" aria-label="Añadir prenda">
      <h3 className="h6">Añadir prenda</h3>
      {error && <p className="small text-danger">{error}</p>}
      {!catalogo && !error && <Cargando texto="Cargando el catálogo del proveedor…" />}
      {catalogo && (
        <>
          <div className="input-group input-group-sm mb-2" style={{ maxWidth: 360 }}>
            <span className="input-group-text"><Search size={14} aria-hidden="true" /></span>
            <input aria-label="Buscar modelo o referencia" className="form-control" placeholder="Modelo o referencia…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
          <div className="d-flex flex-wrap gap-1 mb-2">
            {modelos.map((m) => (
              <button key={m.modelo} type="button" className={`btn btn-sm ${modelo === m.modelo ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => elegirModelo(m.modelo)}>
                {m.modelo}{m.referencia ? ` · ${m.referencia}` : ""}
              </button>
            ))}
            {modelos.length === 0 && <span className="small text-muted">Ningún modelo de este proveedor coincide.</span>}
          </div>
          {modelo && colores.length > 1 && (
            <div className="mb-2" style={{ maxWidth: 280 }}>
              <label className="form-label small mb-0" htmlFor="anadir-color">Color</label>
              <select id="anadir-color" className="form-select form-select-sm" value={color} onChange={(e) => { setColor(e.target.value); setCantidades({}); }}>
                <option value="">Elige…</option>
                {colores.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {tallas.length > 0 && (
            <div className="d-flex flex-wrap gap-2 mb-2" role="group" aria-label="Cantidades por talla">
              {tallas.map((t) => (
                <div key={t.variante_id} className="text-center" style={{ width: "4.5rem" }}>
                  <label className="form-label small mb-0 d-block" htmlFor={`anadir-${t.variante_id}`}>{t.talla}</label>
                  <input id={`anadir-${t.variante_id}`} inputMode="numeric" className="form-control form-control-sm text-center" value={cantidades[t.variante_id] ?? ""}
                    onChange={(e) => setCantidades({ ...cantidades, [t.variante_id]: e.target.value })} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <div className="d-flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={ocupado || total === 0} onClick={anadir}>
          {total > 0 ? `Añadir ${total} ${total === 1 ? "prenda" : "prendas"}` : "Añadir"}
        </button>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </section>
  );
}

export default PanelAnadirPrenda;
