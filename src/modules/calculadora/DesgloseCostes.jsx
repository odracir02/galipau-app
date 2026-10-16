import { eurosDecimal, euros, porcentaje } from "../../shared/utils/dinero";

// Readable cost breakdown of a real-cost calculation result (the key figures are in ResumenCalculo)
function DesgloseCostes({ resultado }) {
  const { costes, ingresos } = resultado;
  return (
    <section className="mt-4" aria-label="Desglose del coste">
      <h2 className="h6 mb-2">Desglose del coste</h2>
      <div className="gx-tabla">
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead>
              <tr><th>Concepto</th><th className="d-none d-md-table-cell">Cálculo</th><th className="text-end">Importe</th></tr>
            </thead>
            <tbody>
              {costes.grupos.map((g) => [
                <tr key={g.clave} className="table-light">
                  <th colSpan={2}>{g.etiqueta}</th>
                  <th className="text-end">{euros(g.cent)}</th>
                </tr>,
                ...(g.conceptos.length > 1 || g.conceptos[0]?.etiqueta !== g.etiqueta
                  ? g.conceptos.map((c) => (
                      <tr key={`${g.clave}-${c.clave}`}>
                        <td className="ps-4">{c.etiqueta}</td>
                        <td className="d-none d-md-table-cell small text-muted">{c.detalle}</td>
                        <td className="text-end">{eurosDecimal(c.importe)}</td>
                      </tr>
                    ))
                  : []),
              ])}
              <tr className="fw-bold">
                <td colSpan={2}>Coste real total</td>
                <td className="text-end">{euros(costes.totalCent)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="small text-muted mt-2 mb-0">
        {ingresos.iva.mensaje} El beneficio ya descuenta la mano de obra valorada en los parámetros. {resultado.pantallas} pantalla(s) · merma {porcentaje(resultado.merma)}.
      </p>
    </section>
  );
}

export default DesgloseCostes;
