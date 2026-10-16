import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from "lucide-react";
import { useSesion } from "./sesion/contexto";
import { useTema } from "./tema/contexto";
import { MARCA } from "./marca";
import { ENLACE_CONFIGURACION, NAVEGACION_LOCAL, NAVEGACION_NUBE } from "./navegacion";

const clase = (extra = "") => ({ isActive }) => `gx-nav-enlace ${extra} ${isActive ? "active" : ""}`;

function Enlace({ enlace }) {
  const Icono = enlace.icono;
  return (
    <NavLink to={enlace.ruta} end={enlace.exacta} className={clase(enlace.proximamente ? "gx-proximamente" : "")} title={enlace.texto}>
      <Icono size={19} aria-hidden="true" />
      <span className="gx-texto-nav">{enlace.texto}</span>
      {enlace.proximamente && <span className="gx-pronto">Pronto</span>}
    </NavLink>
  );
}

/** App shell: side navigation (collapsible on desktop, off-canvas on small screens), top bar and footer. */
function Disposicion({ nube = false, children }) {
  const { cerrarSesion } = useSesion();
  const { efectivo, alternarTema, menuContraido, alternarMenu } = useTema();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const { pathname } = useLocation();
  const grupos = nube ? NAVEGACION_NUBE : NAVEGACION_LOCAL;
  const oscuro = efectivo === "oscuro";

  // Close the mobile menu after navigating
  useEffect(() => setMenuAbierto(false), [pathname]);
  useEffect(() => {
    if (!menuAbierto) return undefined;
    const tecla = (e) => e.key === "Escape" && setMenuAbierto(false);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [menuAbierto]);

  return (
    <div className={`gx-shell ${menuContraido ? "gx-contraido" : ""} ${menuAbierto ? "gx-menu-abierto" : ""}`}>
      <aside className="gx-lateral" id="gx-menu" aria-label="Menú principal">
        <div className="gx-lateral-marca">
          <img src={MARCA.logo} alt="" />
          <div className="flex-grow-1">
            <strong>{MARCA.producto}</strong>
            <small>{MARCA.descripcion}</small>
          </div>
          <button type="button" className="gx-boton-icono gx-solo-movil" aria-label="Cerrar menú" onClick={() => setMenuAbierto(false)}>
            <X size={20} />
          </button>
        </div>
        <nav className="gx-nav" aria-label="Navegación principal">
          {grupos.map((g) => (
            <div key={g.seccion ?? "principal"} className="d-flex flex-column gap-1">
              {g.seccion && <div className="gx-nav-seccion">{g.seccion}</div>}
              {g.enlaces.map((e) => <Enlace key={e.ruta} enlace={e} />)}
            </div>
          ))}
        </nav>
        <div className="gx-lateral-pie">
          <Enlace enlace={ENLACE_CONFIGURACION} />
        </div>
      </aside>
      {menuAbierto && <div className="gx-velo" onClick={() => setMenuAbierto(false)} aria-hidden="true" />}

      <div className="gx-principal">
        <header className="gx-superior">
          <button type="button" className="gx-boton-icono gx-solo-movil" aria-label="Abrir menú" aria-controls="gx-menu" aria-expanded={menuAbierto} onClick={() => setMenuAbierto(true)}>
            <Menu size={20} />
          </button>
          <button type="button" className="gx-boton-icono gx-solo-escritorio" aria-label={menuContraido ? "Expandir menú" : "Contraer menú"} onClick={alternarMenu}>
            {menuContraido ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
          </button>
          <span className="fw-semibold gx-solo-movil text-truncate">{MARCA.producto}</span>
          <div className="ms-auto d-flex align-items-center gap-1">
            <button type="button" className="gx-boton-icono" onClick={alternarTema} aria-label={oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} title={oscuro ? "Modo claro" : "Modo oscuro"}>
              {oscuro ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary btn-icono ms-1" onClick={cerrarSesion} aria-label="Cerrar sesión">
              <LogOut size={16} aria-hidden="true" />
              <span className="d-none d-sm-inline">Salir</span>
            </button>
          </div>
        </header>
        <main className="gx-contenido">{children}</main>
        <footer className="gx-pie">{MARCA.pie}</footer>
      </div>
    </div>
  );
}

export default Disposicion;
