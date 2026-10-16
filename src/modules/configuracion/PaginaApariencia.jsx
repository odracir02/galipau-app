import { Monitor, Moon, Sun } from "lucide-react";
import { useTema } from "../../app/tema/contexto";
import { TEMAS } from "../../app/tema/preferencias";

const ICONOS = { claro: Sun, oscuro: Moon, sistema: Monitor };
const DESCRIPCION = {
  claro: "Fondo claro. Recomendado con buena luz.",
  oscuro: "Fondo oscuro, más descansado de noche.",
  sistema: "Sigue la configuración de este dispositivo.",
};

function PaginaApariencia() {
  const { tema, cambiarTema, menuContraido, alternarMenu } = useTema();
  return (
    <section className="gx-tarjeta">
      <h2 className="h5">Apariencia</h2>
      <p className="text-muted small">Se guarda en este navegador.</p>
      <fieldset>
        <legend className="form-label">Tema</legend>
        <div className="row g-2">
          {Object.entries(TEMAS).map(([clave, texto]) => {
            const Icono = ICONOS[clave];
            return (
              <div key={clave} className="col-sm-4">
                <label className={`gx-kpi d-block ${tema === clave ? "border-success" : ""}`} style={{ cursor: "pointer" }}>
                  <input type="radio" className="form-check-input me-2" name="tema" value={clave} checked={tema === clave} onChange={() => cambiarTema(clave)} />
                  <Icono size={16} aria-hidden="true" className="me-1" />
                  <strong>{texto}</strong>
                  <div className="small text-muted mt-1">{DESCRIPCION[clave]}</div>
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>
      <div className="form-check form-switch mt-3">
        <input id="menu-contraido" className="form-check-input" type="checkbox" role="switch" checked={menuContraido} onChange={alternarMenu} />
        <label className="form-check-label" htmlFor="menu-contraido">Menú lateral contraído en pantallas grandes (solo iconos)</label>
      </div>
    </section>
  );
}

export default PaginaApariencia;
