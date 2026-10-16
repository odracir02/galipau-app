import { Link } from "react-router-dom";
import { ClipboardList, Factory, Package } from "lucide-react";
import Cabecera from "../../shared/ui/Cabecera";
import EstadoVacio from "../../shared/ui/EstadoVacio";

const MODULOS = {
  pedidos: {
    titulo: "Pedidos",
    icono: ClipboardList,
    texto: "Convertirá un presupuesto aceptado en pedido, con fechas de entrega, pagos a cuenta y seguimiento.",
    mientras: "Mientras tanto, sigue los trabajos con los estados del presupuesto (aceptado, en producción, finalizado y cobrado).",
  },
  produccion: {
    titulo: "Producción",
    icono: Factory,
    texto: "Tablero de trabajos por fases (diseño, pantallas, impresión, entrega) con el calendario del taller.",
    mientras: "Mientras tanto, usa el estado «En producción» de los presupuestos.",
  },
  inventario: {
    titulo: "Inventario",
    icono: Package,
    texto: "Existencias de prendas y consumibles, reservas por pedido y avisos de reposición.",
    mientras: "Mientras tanto, los costes de prendas y consumibles se gestionan en el catálogo y en los parámetros de cálculo.",
  },
};

/** Planned module: explains what it will do. It is not presented as a working feature. */
function PaginaProximamente({ modulo }) {
  const m = MODULOS[modulo];
  return (
    <>
      <Cabecera titulo={m.titulo} descripcion="Módulo en preparación" />
      <div className="gx-tarjeta">
        <EstadoVacio icono={m.icono} titulo="Todavía no disponible" accion={<Link className="btn btn-outline-primary" to="/presupuestos">Ir a presupuestos</Link>}>
          <p className="mb-1">{m.texto}</p>
          <p className="mb-0">{m.mientras}</p>
        </EstadoVacio>
      </div>
    </>
  );
}

export default PaginaProximamente;
