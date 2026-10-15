import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BloquePresupuesto from "./BloquePresupuesto";
import { getProductos } from "../services/getProductos";
import {
  crearBloque,
  actualizarBloque,
  actualizarLinea,
  agregarLinea,
  eliminarLinea,
  agregarBloque,
  eliminarBloque,
} from "../domain/presupuestoEstado";
import { validarPresupuesto } from "../domain/validacion";
import { calcularPresupuesto } from "../domain/calculo";
import { agregarAlHistorial } from "../domain/historialPresupuestos";

const MENSAJES_AVISO = {
  productoNoEncontrado: "producto no encontrado en el catálogo; se ha calculado sin coste de prenda.",
  costesDistintos:
    "el catálogo tiene varios colores con costes distintos para esta selección; se ha usado el primero.",
};

const MENSAJES_GUARDADO = {
  historialIlegible:
    "No se ha podido guardar: el historial almacenado en este navegador está dañado. No se ha modificado.",
  errorAlmacenamiento: "No se ha podido guardar el presupuesto en este navegador.",
};

function QuoteForm() {
  const [clientName, setClientName] = useState("");
  const [bloques, setBloques] = useState(() => [crearBloque()]);

  const [productos, setProductos] = useState([]);
  const [estadoCatalogo, setEstadoCatalogo] = useState("cargando");

  const [errores, setErrores] = useState([]);
  const [calculo, setCalculo] = useState(null);
  const [desactualizado, setDesactualizado] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState(null);

  const cargarProductos = useCallback(async () => {
    setEstadoCatalogo("cargando");
    try {
      const data = await getProductos();
      setProductos(data);
      setEstadoCatalogo(data.length > 0 ? "listo" : "vacio");
    } catch (e) {
      console.error("Error loading products", e);
      setProductos([]);
      setEstadoCatalogo("error");
    }
  }, []);

  useEffect(() => {
    cargarProductos();
  }, [cargarProductos]);

  // Any change to the form makes a previous result outdated.
  const modificar = (actualizar) => {
    setBloques(actualizar);
    if (calculo) setDesactualizado(true);
  };

  const handleClientName = (valor) => {
    setClientName(valor);
    if (calculo) setDesactualizado(true);
  };

  const handleCalcularPresupuesto = () => {
    const encontrados = validarPresupuesto({ clientName, bloques, productos });
    setErrores(encontrados);
    if (encontrados.length > 0) return;

    setCalculo(calcularPresupuesto({ clientName, bloques, productos }));
    setDesactualizado(false);
    setSaved(false);
    setErrorGuardado(null);
  };

  const handleGuardarPresupuesto = () => {
    if (!calculo || saved || desactualizado) return;
    const nuevo = { ...calculo.resultado, fecha: new Date().toISOString() };
    const respuesta = agregarAlHistorial(localStorage, nuevo);
    if (respuesta.ok) {
      setSaved(true);
      setErrorGuardado(null);
    } else {
      setErrorGuardado(MENSAJES_GUARDADO[respuesta.motivo]);
    }
  };

  const erroresDe = (bloqueId) => errores.filter((e) => e.bloqueId === bloqueId);
  const quoteResult = calculo?.resultado;
  const avisos = calculo?.avisos ?? [];

  return (
    <div className="container mt-5">
      <h2 className="mb-4">Generar presupuesto</h2>

      {estadoCatalogo === "cargando" && (
        <div className="alert alert-info" role="status">Cargando catálogo de productos…</div>
      )}
      {estadoCatalogo === "error" && (
        <div className="alert alert-danger d-flex align-items-center gap-3" role="alert">
          <span>No se ha podido cargar el catálogo de productos. Comprueba la conexión.</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={cargarProductos}>
            Reintentar
          </button>
        </div>
      )}
      {estadoCatalogo === "vacio" && (
        <div className="alert alert-warning" role="alert">El catálogo de productos está vacío.</div>
      )}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleCalcularPresupuesto();
        }}
      >
        <div className="mb-3">
          <label className="form-label" htmlFor="clientName">Nombre del cliente</label>
          <input
            id="clientName"
            type="text"
            className={`form-control ${errores.some((e) => e.campo === "clientName") ? "is-invalid" : ""}`}
            value={clientName}
            onChange={(e) => handleClientName(e.target.value)}
            required
          />
        </div>

        {bloques.map((bloque, i) => (
          <BloquePresupuesto
            key={bloque.id}
            bloque={bloque}
            index={i}
            productos={productos}
            errores={erroresDe(bloque.id)}
            puedeEliminar={bloques.length > 1}
            onBloqueChange={(campo, valor) => modificar((bs) => actualizarBloque(bs, bloque.id, campo, valor))}
            onLineaChange={(lineaId, campo, valor) =>
              modificar((bs) => actualizarLinea(bs, bloque.id, lineaId, campo, valor))
            }
            onAddLinea={() => modificar((bs) => agregarLinea(bs, bloque.id))}
            onRemoveLinea={(lineaId) => modificar((bs) => eliminarLinea(bs, bloque.id, lineaId))}
            onRemoveBloque={() => modificar((bs) => eliminarBloque(bs, bloque.id))}
          />
        ))}

        {errores.length > 0 && (
          <div className="alert alert-danger" role="alert">
            <strong>Revisa los siguientes datos:</strong>
            <ul className="mb-0">
              {errores.map((e, i) => (
                <li key={i}>{e.mensaje}</li>
              ))}
            </ul>
          </div>
        )}

        <button className="btn btn-primary mt-3" type="button" onClick={() => modificar(agregarBloque)}>
          + Añadir bloque
        </button>

        <button type="submit" className="btn btn-success mt-3 ms-2">
          Calcular presupuesto
        </button>
      </form>

      <Link to="/historial" className="btn btn-outline-secondary ms-2 mt-3">
        Ver historial
      </Link>

      {quoteResult && (
        <div className="mt-5">
          <h4>Resumen del presupuesto</h4>

          {desactualizado && (
            <div className="alert alert-warning" role="alert">
              Has modificado los datos después de calcular. Vuelve a calcular el presupuesto antes de guardarlo.
            </div>
          )}

          {avisos.length > 0 && (
            <div className="alert alert-warning" role="alert">
              <ul className="mb-0">
                {avisos.map((a) => (
                  <li key={`${a.lineaId}-${a.tipo}`}>
                    Tipo {a.bloque}, línea {a.linea}: {MENSAJES_AVISO[a.tipo]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p><strong>Cliente:</strong> {quoteResult.clientName}</p>
          <p><strong>Total de prendas:</strong> {quoteResult.totalPrendas}</p>

          <div className="table-responsive">
            <table className="table table-bordered">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Proveedor</th>
                  <th>Modelo</th>
                  <th>Color</th>
                  <th>Talla</th>
                  <th>Cantidad</th>
                  <th>Estampado</th>
                  <th>€/unidad</th>
                  <th>Subtotal</th>
                  <th>Beneficio</th>
                </tr>
              </thead>
              <tbody>
                {quoteResult.lineas.map((l, i) => (
                  <tr key={i}>
                    <td>{l.tipo}</td>
                    <td>{l.proveedor}</td>
                    <td>{l.modelo}</td>
                    <td>{l.color}</td>
                    <td>{l.size}</td>
                    <td>{l.quantity}</td>
                    <td>{l.estampado}</td>
                    <td>{l.precioUnitario.toFixed(2)} €</td>
                    <td>{l.subtotal.toFixed(2)} €</td>
                    <td>{l.beneficioLinea.toFixed(2)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h5>
            Subtotal sin descuento: {quoteResult.subtotalSinDescuento.toFixed(2)} €
          </h5>
          <h5>
            Descuento aplicado ({quoteResult.descuentoPorcentaje}%): -
            {quoteResult.descuento.toFixed(2)} €
          </h5>
          <h4 className="mt-3">
            Total final para el cliente: {quoteResult.total.toFixed(2)} €
          </h4>
          <h5 className="mt-2 text-success">
            Beneficio estimado: {quoteResult.beneficioTotal.toFixed(2)} €
          </h5>

          {errorGuardado && (
            <div className="alert alert-danger" role="alert">{errorGuardado}</div>
          )}

          <button
            type="button"
            className="btn btn-success"
            onClick={handleGuardarPresupuesto}
            disabled={saved || desactualizado}
          >
            {saved ? "Presupuesto guardado" : "Guardar presupuesto"}
          </button>
        </div>
      )}
    </div>
  );
}

export default QuoteForm;
