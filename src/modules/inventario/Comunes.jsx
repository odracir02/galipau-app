import { useId, useState } from "react";
import { NavLink } from "react-router-dom";
import { opcionesPrenda, elegirEnPrenda } from "../../domain/catalogo";

export function NavInventario() {
  const clase = ({ isActive }) => `btn btn-sm ${isActive ? "btn-primary" : "btn-outline-secondary"}`;
  return (
    <nav className="d-flex flex-wrap gap-2 mb-3" aria-label="Secciones del inventario">
      <NavLink end to="/inventario" className={clase}>Existencias</NavLink>
      <NavLink to="/inventario/movimiento" className={clase}>Registrar movimiento</NavLink>
      <NavLink to="/inventario/inicial" className={clase}>Carga inicial</NavLink>
      <NavLink to="/inventario/compras" className={clase}>Compras sugeridas</NavLink>
    </nav>
  );
}

const VACIA = { proveedor: "", modelo: "", color: "", size: "", productoId: "" };

/** Picks one catalogue variant (supplier -> model -> colour -> size); only existing combinations. */
export function SelectorVariante({ productos, onElegir, inicialId = "" }) {
  const id = useId();
  const [linea, setLinea] = useState(() => {
    const p = productos.find((x) => String(x.id) === String(inicialId));
    return p ? { proveedor: p.proveedor, modelo: p.modelo, color: p.color, size: p.talla, productoId: String(p.id) } : VACIA;
  });
  const opciones = opcionesPrenda(productos, linea);
  const cambiar = (campo, valor) => {
    const nueva = elegirEnPrenda(linea, campo, valor, productos);
    setLinea(nueva);
    onElegir(nueva.productoId || "");
  };
  const lista = (campo, etiqueta, valores) => (
    <div className="col-6 col-md-3">
      <label className="form-label small mb-0" htmlFor={`${id}-${campo}`}>{etiqueta}</label>
      <select id={`${id}-${campo}`} className="form-select form-select-sm" value={linea[campo]} onChange={(e) => cambiar(campo, e.target.value)} disabled={valores.length === 0}>
        <option value="">{valores.length ? "Selecciona" : "—"}</option>
        {valores.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </div>
  );
  return (
    <div className="row g-2" role="group" aria-label="Artículo">
      {lista("proveedor", "Proveedor", opciones.proveedores)}
      {lista("modelo", "Modelo", opciones.modelos)}
      {lista("color", "Color", opciones.colores)}
      {lista("size", "Talla", opciones.tallas)}
    </div>
  );
}
