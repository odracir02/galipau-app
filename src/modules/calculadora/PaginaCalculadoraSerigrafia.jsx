import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import LineaProducto from "../../components/LineaProducto";
import DesgloseCostes from "./DesgloseCostes";
import { cargarParametrosActivos } from "./parametrosRepo";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { getProductos } from "../../services/getProductos";
import { backendActivo } from "../../app/backend";
import { opcionesLinea } from "../../domain/catalogo";
import { crearLinea, actualizarCampoLinea } from "../../domain/presupuestoEstado";
import { calcularCosteSerigrafia, validarEntrada } from "../../domain/calculo/serigrafia/motor";
import { calcularPresupuesto } from "../../domain/calculo";
import { euros, leerNumero } from "../../shared/utils/dinero";
import { construirEntrada } from "./construirEntrada";

const zonasIniciales = () => [
  { id: "delantera", nombre: "Delantera", colores: "1" },
  { id: "trasera", nombre: "Trasera", colores: "0" },
];

function PaginaCalculadoraSerigrafia({ obtenerCliente = obtenerClienteSupabase, cargarProductos = getProductos }) {
  const nube = backendActivo() === "supabase" || obtenerCliente !== obtenerClienteSupabase;
  const [parametros, setParametros] = useState(undefined);
  const [productos, setProductos] = useState([]);
  const [error, setError] = useState(null);

  const [lineas, setLineas] = useState(() => [{ ...crearLinea(), precioManual: "" }]);
  const [zonas, setZonas] = useState(zonasIniciales);
  const [minutosDiseno, setMinutosDiseno] = useState("0");
  const [mermaPorcentaje, setMermaPorcentaje] = useState("");
  const [precioFinal, setPrecioFinal] = useState("");
  const [comparar, setComparar] = useState(false);

  useEffect(() => {
    if (!nube) return;
    (async () => {
      try {
        const sb = await obtenerCliente();
        const [p, prods] = await Promise.all([cargarParametrosActivos(sb, "serigrafia"), cargarProductos()]);
        setParametros(p);
        setProductos(prods);
        if (p) setMermaPorcentaje(String(Math.round(p.valores.mermaPorDefecto * 10000) / 100));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [nube, obtenerCliente, cargarProductos]);

  const { entrada, problemas } = useMemo(
    () => construirEntrada({ lineas, productos, zonas, minutosDiseno, mermaPorcentaje, precioFinal }),
    [lineas, productos, zonas, minutosDiseno, mermaPorcentaje, precioFinal]
  );
  const erroresEntrada = useMemo(() => validarEntrada(entrada), [entrada]);
  const resultado = useMemo(() => {
    if (!parametros || erroresEntrada.length) return null;
    try {
      return calcularCosteSerigrafia(entrada, parametros.valores);
    } catch {
      return null;
    }
  }, [entrada, erroresEntrada, parametros]);

  // Old engine, only for comparison
  const legacy = useMemo(() => {
    if (!comparar || !resultado) return null;
    const conColores = zonas.filter((z) => (leerNumero(z.colores) ?? 0) > 0);
    try {
      return calcularPresupuesto({
        clientName: "",
        productos,
        bloques: [{
          id: "b", estampado: "Serigrafía", area: "", zonas: Math.min(3, Math.max(1, conColores.length)),
          numColores: String(Math.max(1, ...conColores.map((z) => leerNumero(z.colores)))),
          lineas,
        }],
      }).resultado;
    } catch {
      return null;
    }
  }, [comparar, resultado, zonas, lineas, productos]);

  if (!nube) {
    return (
      <div className="container mt-4">
        <h2>Calculadora de costes — serigrafía</h2>
        <div className="alert alert-info">La calculadora de costes usa los parámetros guardados en la nube. Está disponible en la versión en la nube de Galipau App.</div>
      </div>
    );
  }
  if (error) return <div className="container mt-4"><div className="alert alert-danger" role="alert">{error}</div></div>;
  if (parametros === undefined) return <div className="container mt-4" role="status">Cargando parámetros…</div>;
  if (parametros === null) {
    return (
      <div className="container mt-4">
        <h2>Calculadora de costes — serigrafía</h2>
        <div className="alert alert-warning" role="alert">
          Todavía no hay parámetros de cálculo. Créalos o impórtalos en <Link to="/parametros">Parámetros</Link>.
        </div>
      </div>
    );
  }

  const cambiarLinea = (id, campo, valor) =>
    setLineas((ls) => ls.map((l) => (l.id !== id ? l : campo === "precioManual" ? { ...l, precioManual: valor } : actualizarCampoLinea(l, campo, valor))));
  const mostrarAvisos = lineas.some((l) => l.quantity !== "" || l.proveedor !== "");

  return (
    <div className="container mt-4">
      <h2 className="mb-1">Calculadora de costes — serigrafía</h2>
      <p className="text-muted">Coste real del trabajo según los parámetros vigentes (versión {parametros.version}). El cálculo se actualiza al escribir.</p>

      <h5>Prendas</h5>
      {lineas.map((l, i) => (
        <div key={l.id} className="border rounded p-2 mb-2 bg-light">
          <LineaProducto
            linea={l}
            numero={i + 1}
            opciones={opcionesLinea(productos, l)}
            puedeEliminar={lineas.length > 1}
            onChange={(campo, valor) => cambiarLinea(l.id, campo, valor)}
            onRemove={() => setLineas((ls) => ls.filter((x) => x.id !== l.id))}
          />
          <div className="row g-2 align-items-center">
            <div className="col-auto"><label className="form-label small mb-0" htmlFor={`manual-${l.id}`}>Precio manual de la prenda (opcional, €)</label></div>
            <div className="col-auto">
              <input id={`manual-${l.id}`} className="form-control form-control-sm" inputMode="decimal" style={{ maxWidth: 120 }}
                value={l.precioManual} onChange={(e) => cambiarLinea(l.id, "precioManual", e.target.value)} placeholder="del catálogo" />
            </div>
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-outline-secondary btn-sm mb-4" onClick={() => setLineas((ls) => [...ls, { ...crearLinea(), precioManual: "" }])}>
        + Añadir línea
      </button>

      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <h5>Zonas de impresión</h5>
          {zonas.map((z) => (
            <div className="input-group input-group-sm mb-2" key={z.id}>
              <span className="input-group-text" style={{ minWidth: 110 }}>{z.nombre}</span>
              <input aria-label={`Colores ${z.nombre}`} className="form-control" inputMode="numeric" value={z.colores}
                onChange={(e) => setZonas((zs) => zs.map((x) => (x.id === z.id ? { ...x, colores: e.target.value } : x)))} />
              <span className="input-group-text">colores</span>
              {zonas.length > 1 && (
                <button type="button" className="btn btn-outline-danger" aria-label={`Quitar zona ${z.nombre}`} onClick={() => setZonas((zs) => zs.filter((x) => x.id !== z.id))}>✕</button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setZonas((zs) => [...zs, { id: `zona-${Date.now()}`, nombre: `Zona ${zs.length + 1}`, colores: "1" }])}>
            + Añadir zona
          </button>
          <div className="form-text">Cada color de cada zona necesita una pantalla.</div>
        </div>
        <div className="col-md-6">
          <h5>Trabajo y precio</h5>
          <label className="form-label small mb-0" htmlFor="minutosDiseno">Tiempo de diseño (minutos)</label>
          <input id="minutosDiseno" className="form-control form-control-sm mb-2" inputMode="numeric" value={minutosDiseno} onChange={(e) => setMinutosDiseno(e.target.value)} />
          <label className="form-label small mb-0" htmlFor="merma">Merma (%)</label>
          <input id="merma" className="form-control form-control-sm mb-2" inputMode="decimal" value={mermaPorcentaje} onChange={(e) => setMermaPorcentaje(e.target.value)} />
          <label className="form-label small mb-0" htmlFor="precioFinal">Precio final cobrado (€, opcional)</label>
          <input id="precioFinal" className="form-control form-control-sm" inputMode="decimal" value={precioFinal} onChange={(e) => setPrecioFinal(e.target.value)} />
        </div>
      </div>

      {mostrarAvisos && (problemas.length > 0 || erroresEntrada.length > 0) && (
        <div className="alert alert-warning small" role="alert">
          <ul className="mb-0">{[...new Set([...problemas, ...erroresEntrada])].map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      {resultado && (
        <>
          <DesgloseCostes resultado={resultado} parametrosVersion={parametros.version} />
          <div className="form-check mt-2">
            <input id="comparar" type="checkbox" className="form-check-input" checked={comparar} onChange={(e) => setComparar(e.target.checked)} />
            <label className="form-check-label small" htmlFor="comparar">Comparar con el motor antiguo (tarifas)</label>
          </div>
          {comparar && (
            <div className="alert alert-light border small mt-2" role="note">
              {legacy
                ? `Motor antiguo: total ${euros(Math.round(legacy.total * 100))} (descuento ${legacy.descuentoPorcentaje} %). Su «beneficio» (${euros(Math.round(legacy.beneficioTotal * 100))}) no descuenta materiales ni mano de obra y no es comparable.`
                : "El motor antiguo necesita prendas del catálogo (sin precios manuales)."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PaginaCalculadoraSerigrafia;
