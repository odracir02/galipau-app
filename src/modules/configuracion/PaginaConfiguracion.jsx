import { NavLink, Outlet } from "react-router-dom";
import { Archive, Building2, DatabaseBackup, History, Palette, SlidersHorizontal, Upload } from "lucide-react";
import Cabecera from "../../shared/ui/Cabecera";

const SECCIONES_NUBE = [
  { ruta: "parametros", texto: "Parámetros de cálculo", icono: SlidersHorizontal },
  { ruta: "empresa", texto: "Empresa y PDF", icono: Building2 },
  { ruta: "copias", texto: "Copias de seguridad", icono: DatabaseBackup },
  { ruta: "migracion", texto: "Importación y migración", icono: Upload },
  { ruta: "apariencia", texto: "Apariencia", icono: Palette },
  { ruta: "compatibilidad", texto: "Versión antigua (temporal)", icono: History },
];
const SECCIONES_LOCAL = [
  { ruta: "parametros", texto: "Parámetros de cálculo", icono: SlidersHorizontal },
  { ruta: "copias", texto: "Copias de seguridad", icono: Archive },
  { ruta: "apariencia", texto: "Apariencia", icono: Palette },
];

/** All settings in one place, with a side sub-navigation. */
function PaginaConfiguracion({ nube = false }) {
  const secciones = nube ? SECCIONES_NUBE : SECCIONES_LOCAL;
  return (
    <>
      <Cabecera titulo="Configuración" descripcion="Parámetros, datos de la empresa, copias de seguridad y apariencia." />
      <div className="row g-4">
        <div className="col-lg-3">
          <nav className="gx-subnav" aria-label="Secciones de configuración">
            {secciones.map(({ ruta, texto, icono: Icono }) => (
              <NavLink key={ruta} to={ruta}>
                <Icono size={17} aria-hidden="true" />
                {texto}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="col-lg-9 gx-configuracion">
          <Outlet />
        </div>
      </div>
    </>
  );
}

export default PaginaConfiguracion;
