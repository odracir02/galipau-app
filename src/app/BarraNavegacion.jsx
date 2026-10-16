import { NavLink } from "react-router-dom";
import { useSesion } from "./sesion/contexto";

const enlace = ({ isActive }) => `nav-link${isActive ? " active fw-semibold" : ""}`;

function BarraNavegacion({ nube = false }) {
  const { cerrarSesion } = useSesion();
  return (
    <nav className="navbar navbar-expand bg-body-tertiary border-bottom px-3 flex-wrap" aria-label="Navegación principal">
      <span className="navbar-brand">Galipau App</span>
      <div className="navbar-nav flex-wrap">
        {nube ? (
          <>
            <NavLink to="/presupuestos" className={enlace}>Presupuestos</NavLink>
            <NavLink to="/costes" className={enlace}>Calculadora de costes</NavLink>
            <NavLink to="/parametros" className={enlace}>Parámetros</NavLink>
            <NavLink to="/empresa" className={enlace}>Empresa y PDF</NavLink>
            <NavLink to="/copias" className={enlace}>Copias de seguridad</NavLink>
            <NavLink to="/migracion" className={enlace}>Migración</NavLink>
            <NavLink to="/antiguo" className={enlace} title="Formulario y historial anteriores (navegador)">Versión antigua</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/" end className={enlace}>Presupuesto</NavLink>
            <NavLink to="/costes" className={enlace}>Calculadora de costes</NavLink>
            <NavLink to="/historial" className={enlace}>Historial</NavLink>
            <NavLink to="/copias" className={enlace}>Copias de seguridad</NavLink>
            <NavLink to="/parametros" className={enlace}>Parámetros</NavLink>
          </>
        )}
      </div>
      <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" onClick={cerrarSesion}>
        Cerrar sesión
      </button>
    </nav>
  );
}

export default BarraNavegacion;
