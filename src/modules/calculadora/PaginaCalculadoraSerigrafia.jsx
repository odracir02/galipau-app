import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DesgloseCostes from "./DesgloseCostes";
import FormularioTrabajo from "./FormularioTrabajo";
import { useCalculoSerigrafia } from "./useCalculoSerigrafia";
import { cargarParametrosActivos } from "./parametrosRepo";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { getProductos } from "../../services/getProductos";
import { backendActivo } from "../../app/backend";
import { calcularPresupuesto } from "../../domain/calculo";
import { euros, leerNumero } from "../../shared/utils/dinero";
import { formularioVacio } from "../presupuestos/domain/instantanea";

// Quick real-cost calculator (nothing is saved). Quotes use the same form in the quote editor.
function PaginaCalculadoraSerigrafia({ obtenerCliente = obtenerClienteSupabase, cargarProductos = getProductos }) {
  const nube = backendActivo() === "supabase" || obtenerCliente !== obtenerClienteSupabase;
  const [parametros, setParametros] = useState(undefined);
  const [productos, setProductos] = useState([]);
  const [error, setError] = useState(null);
  const [formulario, setFormulario] = useState(() => formularioVacio(null));
  const [comparar, setComparar] = useState(false);

  useEffect(() => {
    if (!nube) return;
    (async () => {
      try {
        const sb = await obtenerCliente();
        const [p, prods] = await Promise.all([cargarParametrosActivos(sb, "serigrafia"), cargarProductos()]);
        setParametros(p);
        setProductos(prods);
        if (p) setFormulario((f) => ({ ...f, mermaPorcentaje: formularioVacio(p.valores).mermaPorcentaje }));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [nube, obtenerCliente, cargarProductos]);

  const { problemas, erroresEntrada, resultado, detalle } = useCalculoSerigrafia(formulario, productos, parametros?.valores);

  // Old engine, only for comparison
  const legacy = useMemo(() => {
    if (!comparar || !resultado) return null;
    const conColores = formulario.zonas.filter((z) => (leerNumero(z.colores) ?? 0) > 0);
    try {
      return calcularPresupuesto({
        clientName: "",
        productos,
        bloques: [{
          id: "b", estampado: "Serigrafía", area: "", zonas: Math.min(3, Math.max(1, conColores.length)),
          numColores: String(Math.max(1, ...conColores.map((z) => leerNumero(z.colores)))),
          lineas: formulario.lineas,
        }],
      }).resultado;
    } catch {
      return null;
    }
  }, [comparar, resultado, formulario, productos]);

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

  const mostrarAvisos = formulario.lineas.some((l) => l.quantity !== "" || l.proveedor !== "");

  return (
    <div className="container mt-4">
      <h2 className="mb-1">Calculadora de costes — serigrafía</h2>
      <p className="text-muted">
        Coste real del trabajo según los parámetros vigentes (versión {parametros.version}). El cálculo se actualiza al escribir. Para guardarlo como presupuesto, usa{" "}
        <Link to="/presupuestos/nuevo">Nuevo presupuesto</Link>.
      </p>

      <FormularioTrabajo formulario={formulario} onChange={setFormulario} productos={productos} detalle={detalle} />

      {mostrarAvisos && (problemas.length > 0 || erroresEntrada.length > 0) && (
        <div className="alert alert-warning small" role="alert">
          <ul className="mb-0">{[...new Set([...problemas, ...erroresEntrada])].map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      {resultado && (
        <>
          {parametros.valores.redondeoPrecioUnidad == null && (
            <div className="alert alert-info small mt-3 mb-0" role="note">
              La versión {parametros.version} de los parámetros no incluye el redondeo del precio recomendado. Para activarlo, guarda una nueva versión en{" "}
              <Link to="/parametros">Parámetros</Link> (el campo viene relleno con 0,5 €).
            </div>
          )}
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
