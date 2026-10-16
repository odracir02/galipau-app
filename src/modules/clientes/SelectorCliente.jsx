import { useEffect, useState } from "react";
import { buscarClientes, crearCliente, actualizarCliente } from "./clientesRepo";
import FormularioCliente from "./FormularioCliente";

/** Customer search, selection and creation. */
function SelectorCliente({ sb, cliente, onSeleccionar, soloLectura = false }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState([]);
  const [modo, setModo] = useState(cliente ? "seleccionado" : "buscar");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (modo !== "buscar" || !sb) return undefined;
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const r = await buscarClientes(sb, texto);
        if (vigente) setResultados(r);
      } catch (e) {
        if (vigente) setError(e.message);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [sb, texto, modo]);

  useEffect(() => {
    if (cliente) setModo((m) => (m === "buscar" ? "seleccionado" : m));
  }, [cliente]);

  if (modo === "nuevo") {
    return (
      <FormularioCliente titulo="Nuevo cliente" inicial={{ nombre: texto }} onCancelar={() => setModo(cliente ? "seleccionado" : "buscar")}
        onGuardar={async (datos) => {
          const nuevo = await crearCliente(sb, datos);
          onSeleccionar(nuevo);
          setModo("seleccionado");
        }} />
    );
  }
  if (modo === "editar" && cliente?.id) {
    return (
      <FormularioCliente titulo="Editar cliente" inicial={cliente} onCancelar={() => setModo("seleccionado")}
        onGuardar={async (datos) => {
          onSeleccionar(await actualizarCliente(sb, cliente.id, datos));
          setModo("seleccionado");
        }} />
    );
  }
  if (cliente && modo === "seleccionado") {
    const detalle = [cliente.nif, cliente.email, cliente.telefono, [cliente.codigo_postal, cliente.ciudad].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    return (
      <div className="d-flex align-items-start gap-3 flex-wrap" data-testid="cliente-seleccionado">
        <div>
          <div className="fw-semibold">{cliente.nombre}</div>
          {detalle && <div className="small text-muted">{detalle}</div>}
          {!cliente.id && <div className="small text-warning">Datos guardados en el presupuesto (cliente sin ficha).</div>}
        </div>
        {!soloLectura && (
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setModo("buscar")}>Cambiar</button>
            {cliente.id && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setModo("editar")}>Editar datos</button>}
          </div>
        )}
      </div>
    );
  }
  return (
    <div>
      <div className="input-group input-group-sm" style={{ maxWidth: 520 }}>
        <input aria-label="Buscar cliente" className="form-control" placeholder="Buscar cliente por nombre…" value={texto} onChange={(e) => setTexto(e.target.value)} disabled={soloLectura} />
        <button type="button" className="btn btn-outline-primary" onClick={() => setModo("nuevo")} disabled={soloLectura}>+ Nuevo cliente</button>
        {cliente && <button type="button" className="btn btn-outline-secondary" onClick={() => setModo("seleccionado")}>Cancelar</button>}
      </div>
      {error && <div className="text-danger small mt-1">{error}</div>}
      {resultados.length > 0 && (
        <div className="list-group mt-1" style={{ maxWidth: 520 }} role="listbox" aria-label="Clientes encontrados">
          {resultados.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={false} className="list-group-item list-group-item-action py-1 small"
              onClick={() => {
                onSeleccionar(c);
                setModo("seleccionado");
              }}>
              <strong>{c.nombre}</strong>{c.nif ? ` · ${c.nif}` : ""}{c.ciudad ? ` · ${c.ciudad}` : ""}
            </button>
          ))}
        </div>
      )}
      {texto.trim() && resultados.length === 0 && <div className="small text-muted mt-1">Sin resultados. Puedes crear el cliente con «+ Nuevo cliente».</div>}
    </div>
  );
}

export default SelectorCliente;
