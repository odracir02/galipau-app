import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

const ICONOS = { success: CheckCircle2, danger: XCircle, warning: AlertTriangle, info: Info };

// Message box with an icon; errors are announced immediately (role="alert")
function Aviso({ tipo = "info", children, className = "" }) {
  const Icono = ICONOS[tipo] ?? Info;
  return (
    <div className={`alert alert-${tipo} py-2 ${className}`} role={tipo === "danger" ? "alert" : "status"}>
      <Icono size={18} className="flex-shrink-0 mt-1" aria-hidden="true" />
      <div className="flex-grow-1">{children}</div>
    </div>
  );
}

export default Aviso;
