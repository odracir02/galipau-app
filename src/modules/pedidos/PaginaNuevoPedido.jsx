import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { useConfirmar } from "../../shared/ui/contextoDialogos";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import { euros, eurosDecimal, leerNumero } from "../../shared/utils/dinero";
import { normalizarTexto } from "../../domain/catalogo";
import SelectorCliente from "../clientes/SelectorCliente";
import { obtenerPresupuesto } from "../presupuestos/data/presupuestosRepo";
import { listarCatalogoAdmin } from "../catalogo/data/catalogoRepo";
import { lineasDesdePresupuesto, PRESUPUESTO_CONVERTIBLE } from "./domain/pedidos";
import { crearPedidoDesdePresupuesto, crearPedido, pedidoDePresupuesto } from "./data/pedidosRepo";

const VACIO = { fecha_entrega: "", fecha_inicio_prevista: "", instrucciones: "", notas_internas: "" };

function CamposComunes({ datos, setDatos }) {
  return (
    <div className="row g-2">
      <div className="col-sm-6">
        <label className="form-label small mb-0" htmlFor="np-entrega">Fecha de entrega prevista</label>
        <input id="np-entrega" type="date" className="form-control form-control-sm" value={datos.fecha_entrega} onChange={(e) => setDatos({ ...datos, fecha_entrega: e.target.value })} />
      </div>
      <div className="col-sm-6">
        <label className="form-label small mb-0" htmlFor="np-inicio">Empezar producción el (opcional)</label>
        <input id="np-inicio" type="date" className="form-control form-control-sm" value={datos.fecha_inicio_prevista} onChange={(e) => setDatos({ ...datos, fecha_inicio_prevista: e.target.value })} />
      </div>
      <div className="col-12">
        <label className="form-label small mb-0" htmlFor="np-instrucciones">Instrucciones de producción</label>
        <textarea id="np-instrucciones" rows="2" className="form-control form-control-sm" value={datos.instrucciones} onChange={(e) => setDatos({ ...datos, instrucciones: e.target.value })} />
      </div>
      <div className="col-12">
        <label className="form-label small mb-0" htmlFor="np-notas">Notas internas</label>
        <textarea id="np-notas" rows="2" className="form-control form-control-sm" value={datos.notas_internas} onChange={(e) => setDatos({ ...datos, notas_internas: e.target.value })} />
      </div>
    </div>
  );
}

/** New order: from an accepted quote (?presupuesto=ID, nothing typed again) or by hand. */
function PaginaNuevoPedido({ obtenerCliente = obtenerClienteSupabase }) {
  const [params] = useSearchParams();
  const presupuestoId = params.get("presupuesto") ? Number(params.get("presupuesto")) : null;
  const navigate = useNavigate();
  const confirmar = useConfirmar();
  const [sb, setSb] = useState(null);
  const [presupuesto, setPresupuesto] = useState(null);
  const [existente, setExistente] = useState(null);
  const [datos, setDatos] = useState(VACIO);
  const [mensaje, setMensaje] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  // manual order
  const [cliente, setCliente] = useState(null);
  const [precio, setPrecio] = useState("");
  const [lineas, setLineas] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const cliente_ = await obtenerCliente();
        setSb(cliente_);
        if (presupuestoId) {
          setPresupuesto(await obtenerPresupuesto(cliente_, presupuestoId));
          setExistente(await pedidoDePresupuesto(cliente_, presupuestoId));
        } else {
          setCatalogo((await listarCatalogoAdmin(cliente_)).filter((v) => v.disponible));
        }
      } catch (e) {
        setMensaje({ tipo: "danger", texto: e.message });
      }
    })();
  }, [obtenerCliente, presupuestoId]);

  const previas = useMemo(() => (presupuesto ? lineasDesdePresupuesto(presupuesto) : []), [presupuesto]);
  const resultados = useMemo(() => {
    const q = normalizarTexto(busqueda);
    if (q.length < 2) return [];
    return catalogo.filter((v) => normalizarTexto(`${v.modelo} ${v.color} ${v.talla} ${v.proveedor ?? ""} ${v.marca ?? ""}`).includes(q)).slice(0, 12);
  }, [catalogo, busqueda]);

  const crearDesdePresupuesto = async () => {
    if (!(await confirmar({ titulo: `¿Crear el pedido del presupuesto ${presupuesto.numero}?`, mensaje: "Se copian el cliente, las prendas, las zonas y el precio acordado. No se reserva ni se gasta ninguna prenda todavía.", aceptar: "Crear pedido" }))) return;
    setOcupado(true);
    try {
      const id = await crearPedidoDesdePresupuesto(sb, presupuesto.id, datos);
      navigate(`/pedidos/${id}`);
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setOcupado(false);
    }
  };

  const crearManual = async () => {
    const importe = leerNumero(precio);
    const problemas = [];
    if (!cliente) problemas.push("elige el cliente");
    if (importe === null || importe < 0) problemas.push("indica el precio acordado");
    if (lineas.length === 0 || lineas.some((l) => !(Number(l.cantidad) > 0) || !l.descripcion.trim())) problemas.push("añade al menos una prenda con su cantidad");
    if (problemas.length) return setMensaje({ tipo: "danger", texto: `Antes de crear el pedido: ${problemas.join(", ")}.` });
    setOcupado(true);
    try {
      const id = await crearPedido(sb, {
        ...datos, cliente_id: cliente.id, cliente_nombre: cliente.nombre, precio_acordado_cent: Math.round(importe * 100),
        lineas: lineas.map((l) => ({ variante_id: l.variante_id, descripcion: l.descripcion, cantidad: Number(l.cantidad), coste_unitario_previsto: l.coste ?? null })),
      });
      navigate(`/pedidos/${id}`);
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
      setOcupado(false);
    }
  };

  const volver = <Link to="/pedidos" className="small d-inline-flex align-items-center gap-1 mb-2"><ArrowLeft size={14} aria-hidden="true" />Pedidos</Link>;

  if (presupuestoId) {
    if (!presupuesto) return <>{volver}{mensaje ? <Aviso tipo="danger">{mensaje.texto}</Aviso> : <Cargando texto="Cargando presupuesto…" />}</>;
    return (
      <>
        {volver}
        <Cabecera titulo={`Nuevo pedido del presupuesto ${presupuesto.numero ?? ""}`} descripcion="Revisa los datos antes de crear el pedido. Nada se copia a mano." />
        {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
        {existente ? (
          <Aviso tipo="warning">Este presupuesto ya tiene el pedido <Link to={`/pedidos/${existente.id}`}>{existente.numero}</Link>. No se crea otro.</Aviso>
        ) : !PRESUPUESTO_CONVERTIBLE.has(presupuesto.estado) ? (
          <Aviso tipo="warning">Solo un presupuesto aceptado se puede convertir en pedido. <Link to={`/presupuestos/${presupuesto.id}`}>Volver al presupuesto</Link>.</Aviso>
        ) : (
          <div className="row g-4">
            <div className="col-lg-7">
              <section className="card mb-3"><div className="card-body">
                <h2 className="h6">Lo que se copia del presupuesto</h2>
                <p className="mb-1"><strong>{presupuesto.cliente_nombre}</strong></p>
                <p className="mb-2">Precio acordado: <strong>{euros(presupuesto.precio_final_cent ?? presupuesto.total_cent)}</strong></p>
                <ul className="small mb-2">
                  {previas.map((l, i) => (
                    <li key={i}>{l.cantidad} × {l.descripcion}{l.coste !== null && <span className="text-muted"> · coste {eurosDecimal(l.coste)}</span>}{!l.variante_id && <span className="text-warning-emphasis"> (sin vincular al catálogo: no se podrá reservar)</span>}</li>
                  ))}
                </ul>
                <p className="small text-muted mb-0">
                  Zonas: {(presupuesto.entrada?.formulario?.zonas ?? []).map((z) => `${z.nombre} (${z.colores} colores)`).join(", ") || "—"}
                </p>
              </div></section>
            </div>
            <div className="col-lg-5">
              <section className="card mb-3"><div className="card-body">
                <h2 className="h6">Datos del pedido</h2>
                <CamposComunes datos={datos} setDatos={setDatos} />
                <button type="button" className="btn btn-primary mt-3" disabled={ocupado} onClick={crearDesdePresupuesto}>{ocupado ? "Creando…" : "Crear pedido"}</button>
              </div></section>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {volver}
      <Cabecera titulo="Nuevo pedido sin presupuesto" descripcion="Para trabajos que no pasaron por un presupuesto. Lo normal es crearlo desde un presupuesto aceptado." />
      {mensaje && <Aviso tipo={mensaje.tipo}>{mensaje.texto}</Aviso>}
      <div className="row g-4">
        <div className="col-lg-7">
          <section className="card mb-3"><div className="card-body">
            <h2 className="h6">Cliente</h2>
            {sb ? <SelectorCliente sb={sb} cliente={cliente} onSeleccionar={setCliente} /> : <Cargando />}
          </div></section>
          <section className="card mb-3"><div className="card-body">
            <h2 className="h6">Prendas</h2>
            <label className="form-label small mb-0" htmlFor="np-buscar">Buscar en el catálogo</label>
            <input id="np-buscar" className="form-control form-control-sm" placeholder="Modelo, color, talla…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            {resultados.length > 0 && (
              <ul className="list-group list-group-flush small mt-1" aria-label="Resultados del catálogo">
                {resultados.map((v) => (
                  <li key={v.variante_id} className="list-group-item d-flex justify-content-between align-items-center px-0">
                    <span>{v.modelo} · {v.color} {v.talla} <span className="text-muted">{v.proveedor ?? "Propio"}</span></span>
                    <button type="button" className="btn btn-sm btn-outline-primary"
                      onClick={() => { setLineas([...lineas, { variante_id: v.variante_id, descripcion: `${v.modelo} · ${v.color} ${v.talla}`, cantidad: "", coste: Number(v.coste) }]); setBusqueda(""); }}>
                      Añadir
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-link btn-sm p-0 mt-1" onClick={() => setLineas([...lineas, { variante_id: null, descripcion: "", cantidad: "", coste: null }])}>Añadir una prenda que no está en el catálogo</button>
            {lineas.map((l, i) => (
              <div key={i} className="d-flex flex-wrap gap-2 align-items-center mt-2">
                <input className="form-control form-control-sm" style={{ flex: "1 1 14rem" }} aria-label={`Prenda ${i + 1}`} value={l.descripcion} readOnly={Boolean(l.variante_id)}
                  onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)))} placeholder="Descripción" />
                <input type="number" min="1" className="form-control form-control-sm" style={{ width: "6rem" }} aria-label={`Cantidad de la prenda ${i + 1}`} value={l.cantidad}
                  onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} />
                <button type="button" className="btn btn-sm btn-outline-danger" aria-label={`Quitar la prenda ${i + 1}`} onClick={() => setLineas(lineas.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
          </div></section>
        </div>
        <div className="col-lg-5">
          <section className="card mb-3"><div className="card-body">
            <h2 className="h6">Precio y datos</h2>
            <label className="form-label small mb-0" htmlFor="np-precio">Precio acordado (€)</label>
            <input id="np-precio" inputMode="decimal" className="form-control form-control-sm mb-2" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            <CamposComunes datos={datos} setDatos={setDatos} />
            <button type="button" className="btn btn-primary mt-3" disabled={ocupado} onClick={crearManual}>{ocupado ? "Creando…" : "Crear pedido"}</button>
          </div></section>
        </div>
      </div>
    </>
  );
}

export default PaginaNuevoPedido;
