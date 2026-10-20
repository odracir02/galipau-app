import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FilePlus2, SlidersHorizontal } from "lucide-react";
import DesgloseCostes from "./DesgloseCostes";
import ResumenCalculo from "./ResumenCalculo";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";
import FormularioTrabajo from "./FormularioTrabajo";
import { useCalculoSerigrafia } from "./useCalculoSerigrafia";
import { cargarParametrosActivos } from "./parametrosRepo";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { getProductos } from "../../services/getProductos";
import { backendActivo } from "../../app/backend";
import { calcularPresupuesto } from "../../domain/calculo";
import { euros, leerNumero } from "../../shared/utils/dinero";
import { formularioVacio } from "../presupuestos/domain/instantanea";
import { leerTrabajo, guardarTrabajo, olvidarTrabajo, trabajoVacio, transferenciaAPresupuesto, avisosAntesDeTransferir } from "./trabajoCalculadora";
import { useConfirmar } from "../../shared/ui/contextoDialogos";

// Quick real-cost calculator (nothing is saved). Quotes use the same form in the quote editor.
function PaginaCalculadoraSerigrafia({ obtenerCliente = obtenerClienteSupabase, cargarProductos = getProductos }) {
  const nube = backendActivo() === "supabase" || obtenerCliente !== obtenerClienteSupabase;
  const [parametros, setParametros] = useState(undefined);
  const [productos, setProductos] = useState([]);
  const [error, setError] = useState(null);
  // The job typed so far survives leaving the page (kept for this browser tab)
  const [trabajoGuardado] = useState(() => leerTrabajo());
  const [formulario, setFormulario] = useState(() => trabajoGuardado ?? formularioVacio(null));
  const navigate = useNavigate();
  const confirmar = useConfirmar();
  const [comparar, setComparar] = useState(false);

  useEffect(() => {
    if (!nube) return;
    (async () => {
      try {
        const sb = await obtenerCliente();
        const [p, prods] = await Promise.all([cargarParametrosActivos(sb, "serigrafia"), cargarProductos()]);
        setParametros(p);
        setProductos(prods);
        // Default waste from the parameters only for a fresh job, never over what was typed
        if (p && !trabajoGuardado) setFormulario((f) => ({ ...f, mermaPorcentaje: formularioVacio(p.valores).mermaPorcentaje }));
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [nube, obtenerCliente, cargarProductos, trabajoGuardado]);

  useEffect(() => {
    guardarTrabajo(formulario);
  }, [formulario]);

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

  const titulo = "Calculadora de costes";
  if (!nube) {
    return (
      <>
        <Cabecera titulo={titulo} />
        <Aviso tipo="info">La calculadora de costes usa los parámetros guardados en la nube. Está disponible en la versión en la nube de Galipau App.</Aviso>
      </>
    );
  }
  if (error) return <Aviso tipo="danger">{error}</Aviso>;
  if (parametros === undefined) return <Cargando texto="Cargando parámetros…" />;
  if (parametros === null) {
    return (
      <>
        <Cabecera titulo={titulo} />
        <div className="gx-tarjeta">
          <EstadoVacio icono={SlidersHorizontal} titulo="Faltan los parámetros de cálculo"
            accion={<Link className="btn btn-primary" to="/configuracion/parametros">Ir a Parámetros</Link>}>
            <span role="alert">Todavía no hay parámetros de cálculo. Créalos o impórtalos en <Link to="/configuracion/parametros">Parámetros</Link>.</span>
          </EstadoVacio>
        </div>
      </>
    );
  }

  const mostrarAvisos = formulario.lineas.some((l) => l.quantity !== "" || l.proveedor !== "");

  // Opens a new quote with this job already filled in (nothing is saved here)
  const crearPresupuesto = async () => {
    const avisos = trabajoVacio(formulario) ? [] : avisosAntesDeTransferir({ problemas, erroresEntrada, resultado });
    if (avisos.length) {
      const seguir = await confirmar({
        titulo: "El trabajo está incompleto",
        mensaje: `${avisos.join(" ")} Puedes completarlo ahora o pasarlo así al presupuesto y terminarlo allí.`,
        aceptar: "Pasar al presupuesto",
        cancelar: "Seguir en la calculadora",
      });
      if (!seguir) return;
    }
    navigate("/presupuestos/nuevo", { state: trabajoVacio(formulario) ? null : transferenciaAPresupuesto(formulario, parametros.version) });
  };

  const empezarDeNuevo = () => {
    olvidarTrabajo();
    setFormulario(formularioVacio(parametros.valores));
  };

  return (
    <>
      <Cabecera titulo={titulo} descripcion={`Coste real de un trabajo de serigrafía con los parámetros vigentes (versión ${parametros.version}). No se guarda nada.`}
        acciones={
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={empezarDeNuevo}>Empezar de nuevo</button>
            <button type="button" className="btn btn-primary btn-icono" onClick={crearPresupuesto}><FilePlus2 size={16} aria-hidden="true" />Crear presupuesto</button>
          </>
        } />
      <div className="row g-4">
        <div className="col-xl-8">
          <div className="gx-tarjeta">
            <FormularioTrabajo formulario={formulario} onChange={setFormulario} productos={productos} detalle={detalle} />
          </div>
          {mostrarAvisos && (problemas.length > 0 || erroresEntrada.length > 0) && (
            <div className="alert alert-warning small mt-3" role="alert">
              <ul className="mb-0">{[...new Set([...problemas, ...erroresEntrada])].map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {resultado && parametros.valores.redondeoPrecioUnidad == null && (
            <div className="alert alert-info small mt-3 mb-0" role="note">
              La versión {parametros.version} de los parámetros no incluye el redondeo del precio recomendado. Para activarlo, guarda una nueva versión en{" "}
              <Link to="/configuracion/parametros">Parámetros</Link> (el campo viene relleno con 0,5 €).
            </div>
          )}
          {resultado && (
            <>
              <DesgloseCostes resultado={resultado} />
              <div className="form-check mt-3">
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
        <div className="col-xl-4">
          <ResumenCalculo resultado={resultado} parametrosVersion={parametros.version} />
        </div>
      </div>
    </>
  );
}

export default PaginaCalculadoraSerigrafia;
