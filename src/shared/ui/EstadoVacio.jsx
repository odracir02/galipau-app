import { Inbox } from "lucide-react";

// Friendly empty state with an optional action
function EstadoVacio({ icono: Icono = Inbox, titulo, children, accion }) {
  return (
    <div className="gx-vacio">
      <div className="gx-vacio-icono" aria-hidden="true"><Icono size={26} /></div>
      <h3>{titulo}</h3>
      {children && <div className="small mb-3">{children}</div>}
      {accion}
    </div>
  );
}

export default EstadoVacio;
