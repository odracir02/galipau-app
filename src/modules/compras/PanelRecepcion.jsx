import { useEffect, useRef, useState } from "react";
import Aviso from "../../shared/ui/Aviso";
import { recepcionInicial, lineasParaRecibir, erroresRecepcion, resumenRecepcion } from "./domain/compras";
import { previsualizarRecepcion, recibirCompra } from "./data/comprasRepo";

const hoy = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const prendas = (n) => `${n} ${n === 1 ? "prenda" : "prendas"}`;

/**
 * Registering an arrival: filled in with what is pending, a live summary of what
 * will happen (stock entry, reservations for orders, free units) and one confirmation.
 */
function PanelRecepcion({ compra, lineas, obtenerCliente, onHecho, onCancelar }) {
  const [filas, setFilas] = useState(() => recepcionInicial(lineas));
  const [conPrecio, setConPrecio] = useState(false);
  const [albaran, setAlbaran] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [exceso, setExceso] = useState(false);
  const [plan, setPlan] = useState(null);
  const [calculando, setCalculando] = useState(true);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [vuelta, setVuelta] = useState(0); // recalculates the summary after a failed confirmation
  const clave = useRef(crypto.randomUUID()); // the same request sent twice records one arrival

  const errores = erroresRecepcion(filas);
  const enviar = lineasParaRecibir(filas);
  const firma = JSON.stringify(enviar);

  useEffect(() => {
    if (errores.length) {
      setPlan(null);
      setCalculando(false);
      return undefined;
    }
    let vigente = true;
    setCalculando(true);
    const t = setTimeout(async () => {
      try {
        const p = await previsualizarRecepcion(await obtenerCliente(), compra.id, JSON.parse(firma));
        if (vigente) setPlan(p);
      } catch (e) {
        if (vigente) setError(e.message);
      } finally {
        if (vigente) setCalculando(false);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [firma, errores.length, compra.id, obtenerCliente, vuelta]);

  const resumen = plan ? resumenRecepcion(plan) : null;
  const pendientesDespues = filas.reduce((s, f) => s + Math.max(f.pendiente - (Number(f.cantidad) || 0), 0), 0);
  const cambiar = (i, campo, valor) => setFilas(filas.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));

  const confirmar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const r = await recibirCompra(await obtenerCliente(), compra.id, { clave: clave.current, lineas: enviar, esperado: plan.reservas, fecha, albaran, confirmarExceso: exceso });
      clave.current = crypto.randomUUID();
      onHecho(r);
    } catch (e) {
      setError(e.message);
      setVuelta((v) => v + 1); // something changed: show the new summary
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="border border-success rounded p-3 mb-3" aria-label="Registrar llegada">
      <h2 className="h6">Registrar llegada</h2>
      <p className="small text-muted">Viene rellenado con lo que falta por llegar. Si ha llegado todo, solo tienes que confirmar; si no, cambia las cantidades.</p>
      <div className="table-responsive">
        <table className="table table-sm align-middle mb-2">
          <thead>
            <tr>
              <th className="gx-col-nombre">Prenda</th>
              <th className="gx-num">Pendientes</th>
              <th className="gx-num">Han llegado</th>
              {conPrecio && <th className="gx-num">Precio sin IVA (€)</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={f.compra_linea_id}>
                <td><label htmlFor={`llegan-${f.compra_linea_id}`} className="mb-0">{f.descripcion}</label></td>
                <td className="gx-num">{f.pendiente}</td>
                <td className="gx-num">
                  <input id={`llegan-${f.compra_linea_id}`} inputMode="numeric" className="form-control form-control-sm mx-auto text-center" style={{ maxWidth: "5.5rem" }}
                    value={f.cantidad} onChange={(e) => cambiar(i, "cantidad", e.target.value)} />
                </td>
                {conPrecio && (
                  <td className="gx-num">
                    <input aria-label={`Precio sin IVA de ${f.descripcion}`} inputMode="decimal" className="form-control form-control-sm mx-auto text-center" style={{ maxWidth: "6.5rem" }}
                      value={f.precio} onChange={(e) => cambiar(i, "precio", e.target.value)} placeholder="sin precio" />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!conPrecio && <button type="button" className="btn btn-link btn-sm p-0 mb-2" onClick={() => setConPrecio(true)}>El precio es distinto al previsto</button>}
      <div className="row g-2 mb-2">
        <div className="col-sm-6 col-md-4">
          <label className="form-label small mb-0" htmlFor="rec-albaran">Nº de albarán (opcional)</label>
          <input id="rec-albaran" className="form-control form-control-sm" value={albaran} onChange={(e) => setAlbaran(e.target.value)} />
        </div>
        <div className="col-sm-6 col-md-4">
          <label className="form-label small mb-0" htmlFor="rec-fecha">Fecha de llegada</label>
          <input id="rec-fecha" type="date" className="form-control form-control-sm" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>

      {errores.length > 0 && <Aviso tipo="warning">{errores.join(" ")}</Aviso>}
      {error && <Aviso tipo="danger">{error}</Aviso>}
      {resumen && !errores.length && (
        <div className="small mb-2" data-testid="resumen-llegada" aria-live="polite">
          <p className="mb-1"><strong>Entran {prendas(resumen.entran)} en el almacén.</strong></p>
          {resumen.reservas.length > 0 && <p className="mb-1">Se reservan para: {resumen.reservas.map((r) => `${r.numero} (${r.cantidad})`).join(", ")}.</p>}
          {resumen.libres > 0 && <p className="mb-1">Quedan libres en el almacén: {resumen.libres}.</p>}
          {resumen.listos.length > 0 && <p className="mb-1">Con todo su material, pasan a «Listo para producción»: {resumen.listos.join(", ")}.</p>}
          {pendientesDespues > 0 && <p className="mb-1 text-muted">Seguirán pendientes de llegar: {pendientesDespues}.</p>}
        </div>
      )}
      {resumen?.exceso > 0 && (
        <div className="border border-warning rounded p-2 mb-2 small">
          <p className="mb-1">Han llegado <strong>{resumen.exceso}</strong> {resumen.exceso === 1 ? "prenda más" : "prendas más"} de las pedidas. Si son correctas, quedarán libres en el almacén.</p>
          <div className="form-check mb-0">
            <input id="rec-exceso" type="checkbox" className="form-check-input" checked={exceso} onChange={(e) => setExceso(e.target.checked)} />
            <label className="form-check-label" htmlFor="rec-exceso">Son correctas: añadirlas al almacén</label>
          </div>
        </div>
      )}
      <div className="d-flex gap-2">
        <button type="button" className="btn btn-success btn-sm" onClick={confirmar}
          disabled={ocupado || calculando || !plan || errores.length > 0 || (resumen?.exceso > 0 && !exceso)}>
          Confirmar llegada
        </button>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onCancelar}>Cancelar</button>
      </div>
    </section>
  );
}

export default PanelRecepcion;
