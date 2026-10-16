import { useEffect, useState } from "react";
import { CAMPOS_CLIENTE, buscarClientes, crearCliente, actualizarCliente, normalizarCliente, validarCliente } from "./clientesRepo";

const formularioDe = (c) => Object.fromEntries(CAMPOS_CLIENTE.map(({ clave }) => [clave, c?.[clave] ?? ""]));

// Inline customer form (create or edit)
function FormularioCliente({ inicial, titulo, onGuardar, onCancelar }) {
  const [datos, setDatos] = useState(() => formularioDe(inicial));
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    const e = validarCliente(normalizarCliente(datos));
    setErrores(e);
    if (e.length) return;
    setGuardando(true);
    try {
      await onGuardar(datos);
    } catch (error) {
      setErrores([error.message]);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="border rounded p-3 bg-light" role="group" aria-label={titulo}>
      <h6>{titulo}</h6>
      <div className="row g-2">
        {CAMPOS_CLIENTE.map((c) => (
          <div key={c.clave} className={c.clave === "direccion" || c.clave === "nombre" ? "col-md-6" : "col-md-3"}>
            <label className="form-label small mb-0" htmlFor={`cliente-${c.clave}`}>{c.etiqueta}{c.obligatorio ? " *" : ""}</label>
            <input id={`cliente-${c.clave}`} type={c.tipo ?? "text"} className="form-control form-control-sm" value={datos[c.clave]}
              onChange={(e) => setDatos((d) => ({ ...d, [c.clave]: e.target.value }))} />
          </div>
        ))}
      </div>
      {errores.length > 0 && <div className="alert alert-danger small py-2 mt-2 mb-0" role="alert">{errores.join(" ")}</div>}
      <div className="mt-2 d-flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" onClick={guardar} disabled={guardando}>Guardar cliente</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

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
