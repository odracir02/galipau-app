import { NavLink } from "react-router-dom";
import { useSesion } from "./sesion/contexto";

const enlace = ({ isActive }) => `nav-link${isActive ? " active fw-semibold" : ""}`;

function BarraNavegacion() {
  const { cerrarSesion } = useSesion();
  return (
    <nav className="navbar navbar-expand bg-body-tertiary border-bottom px-3 flex-wrap" aria-label="Navegación principal">
      <span className="navbar-brand">Galipau App</span>
      <div className="navbar-nav flex-wrap">
        <NavLink to="/" end className={enlace}>Presupuesto</NavLink>
        <NavLink to="/historial" className={enlace}>Historial</NavLink>
        <NavLink to="/copias" className={enlace}>Copias de seguridad</NavLink>
      </div>
      <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={cerrarSesion}>
        Cerrar sesión
      </button>
    </nav>
  );
}

export default BarraNavegacion;
