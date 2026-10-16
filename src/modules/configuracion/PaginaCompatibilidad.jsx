import { Link } from "react-router-dom";
import Aviso from "../../shared/ui/Aviso";

// Temporary access to the previous quote form and browser history
function PaginaCompatibilidad() {
  return (
    <section className="gx-tarjeta">
      <h2 className="h5">Versión antigua (temporal)</h2>
      <Aviso tipo="warning">
        Herramientas anteriores, mantenidas solo por compatibilidad mientras se migra el historial. Usan el motor de tarifas antiguo y guardan en este
        navegador, no en la nube. Para presupuestos nuevos usa <Link to="/presupuestos">Presupuestos</Link>.
      </Aviso>
      <div className="d-flex flex-wrap gap-2">
        <Link className="btn btn-outline-secondary" to="/antiguo">Formulario de presupuesto antiguo</Link>
        <Link className="btn btn-outline-secondary" to="/historial">Historial del navegador</Link>
      </div>
    </section>
  );
}

export default PaginaCompatibilidad;
