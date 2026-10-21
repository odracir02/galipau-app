import { FlaskConical } from "lucide-react";
import { ENTORNOS, entornoWeb } from "./entorno";

// Unmistakable stripe on every screen of a test build (nothing in production)
function BandaEntorno({ flotante = false, web = entornoWeb() }) {
  if (web !== "pruebas") return null;
  return (
    <div className={`gx-banda-pruebas ${flotante ? "gx-banda-flotante" : ""}`} role="note" aria-label="Entorno de pruebas">
      <FlaskConical size={16} aria-hidden="true" />
      <span>{ENTORNOS.pruebas.aviso}</span>
    </div>
  );
}

export default BandaEntorno;
