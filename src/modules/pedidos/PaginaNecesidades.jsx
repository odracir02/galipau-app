import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";
import { listarNecesidades, estadoNecesidad } from "./data/pedidosRepo";

/** Garments missing for orders, grouped by supplier and garment: what to buy and what is on its way. */
function PaginaNecesidades({ obtenerCliente = obtenerClienteSupabase }) {
  const [filas, setFilas] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setFilas(await listarNecesidades(await obtenerCliente()));
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setFilas([]);
    }
  }, [obtenerCliente]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  // supplier -> garment -> { comprar, recibir, pedidos }
  const grupos = useMemo(() => {
    const g = new Map();
    for (const n of filas ?? []) {
      const prov = n.proveedor ?? "Productos propios";
      if (!g.has(prov)) g.set(prov, new Map());
      const prendas = g.get(prov);
      if (!prendas.has(n.variante_id)) prendas.set(n.variante_id, { variante_id: n.variante_id, descripcion: `${n.modelo} · ${n.color} ${n.talla}`, marca: n.marca, comprar: 0, recibir: 0, pedidos: [] });
      const x = prendas.get(n.variante_id);
      if (n.estado === "pendiente") x.comprar += n.cantidad;
      else x.recibir += n.cantidad;
      x.pedidos.push(n);
    }
    return [...g.entries()].map(([proveedor, prendas]) => ({ proveedor, prendas: [...prendas.values()] }));
  }, [filas]);

  const marcarPedidas = async (prenda) => {
    setOcupado(true);
    try {
      const sb = await obtenerCliente();
      for (const n of prenda.pedidos.filter((x) => x.estado === "pendiente")) await estadoNecesidad(sb, n.pedido_id, n.variante_id, "pedida");
      setMensaje({ tipo: "success", texto: `${prenda.descripcion}: marcado como pedido al proveedor.` });
      await cargar();
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Link to="/pedidos" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Pedidos</Link>
      <Cabecera titulo="Material que falta" descripcion="Prendas que necesitan los pedidos y no hay en el almacén. Aquí no se compra nada: es la lista para pedirlas al proveedor." />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      {filas === null ? <Cargando texto="Cargando…" /> : grupos.length === 0 ? (
        <div className="gx-tabla"><EstadoVacio icono={PackageCheck} titulo="No falta material">Los pedidos tienen todas sus prendas reservadas o no hay faltas anotadas.</EstadoVacio></div>
      ) : grupos.map((g) => (
        <section key={g.proveedor} className="gx-tabla mb-3" aria-label={g.proveedor}>
          <h2 className="h6 px-3 pt-3">{g.proveedor}</h2>
          <div className="table-responsive">
            <table className="table align-middle mb-0">
              <thead><tr><th>Prenda</th><th className="text-end">Por comprar</th><th className="text-end">Pedidas, sin llegar</th><th className="d-none d-md-table-cell">Para</th><th /></tr></thead>
              <tbody>
                {g.prendas.map((x) => (
                  <tr key={x.variante_id}>
                    <td>{x.descripcion}{x.marca && <span className="text-muted small"> · {x.marca}</span>}</td>
                    <td className="text-end fw-semibold">{x.comprar || "—"}</td>
                    <td className="text-end">{x.recibir || "—"}</td>
                    <td className="d-none d-md-table-cell small">{x.pedidos.map((n) => <Link key={n.id} to={`/pedidos/${n.pedido_id}`} className="me-2">{n.numero} ({n.cantidad})</Link>)}</td>
                    <td className="text-end">{x.comprar > 0 && <button type="button" className="btn btn-sm btn-outline-primary" disabled={ocupado} onClick={() => marcarPedidas(x)}>Ya pedidas</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="small text-muted">Cuando lleguen, apunta la entrada en <Link to="/inventario/movimiento">Inventario</Link> y reserva las prendas desde cada pedido.</p>
    </>
  );
}

export default PaginaNecesidades;
