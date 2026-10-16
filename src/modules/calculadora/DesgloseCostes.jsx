import { euros, eurosDecimal, porcentaje } from "../../shared/utils/dinero";

// Readable cost breakdown of a real-cost calculation result.
function DesgloseCostes({ resultado, parametrosVersion }) {
  const { costes, precio, beneficio, ingresos } = resultado;
  const redondea = precio.redondeoPorUnidadCent > 0;
  const perdida = beneficio && beneficio.cent < 0;
  return (
    <div className="mt-4">
      <div className="row g-3 mb-3">
        <div className="col-md-6 col-lg-4">
          <div className="border rounded p-3 h-100">
            <div className="text-muted small">Coste real total</div>
            <div className="fs-4 fw-semibold" data-testid="coste-total">{euros(costes.totalCent)}</div>
            <div className="small">{euros(costes.porUnidadCent)} por unidad · {resultado.unidades} uds</div>
          </div>
        </div>
        <div className="col-md-6 col-lg-4">
          <div className="border rounded p-3 h-100">
            <div className="text-muted small">Precio recomendado (sugerido, {porcentaje(precio.margenRecomendado)} de margen)</div>
            <div className="fs-4 fw-semibold" data-testid="precio-recomendado">{euros(precio.recomendadoCent)}</div>
            {redondea ? (
              <div className="small">
                Por unidad: <span data-testid="precio-unidad-sin-redondear">{euros(precio.recomendadoPorUnidadSinRedondearCent)}</span>
                {" → "}<strong data-testid="precio-unidad-redondeado">{euros(precio.recomendadoPorUnidadCent)}</strong>
                <span className="text-muted"> (hacia arriba a múltiplos de {euros(precio.redondeoPorUnidadCent)})</span>
              </div>
            ) : (
              <div className="small">{euros(precio.recomendadoPorUnidadCent)} por unidad <span className="text-muted">(sin redondeo)</span></div>
            )}
            <div className="small" data-testid="beneficio-recomendado">
              Beneficio previsto: {euros(precio.beneficioRecomendado.cent)} · {porcentaje(precio.beneficioRecomendado.margen)} sobre la venta
            </div>
          </div>
        </div>
        <div className="col-md-12 col-lg-4">
          <div className={`border rounded p-3 h-100 ${perdida ? "border-danger" : ""}`}>
            <div className="text-muted small">Precio final cobrado (decidido por ti)</div>
            <div className="fs-4 fw-semibold" data-testid="precio-final">{euros(precio.finalCent)}</div>
            {beneficio ? (
              <div className="small">
                Beneficio:{" "}
                <strong className={perdida ? "text-danger" : "text-success"} data-testid="beneficio">{euros(beneficio.cent)}</strong>
                {` · ${porcentaje(beneficio.margen)} sobre la venta · ${euros(beneficio.porUnidadCent)}/ud`}
              </div>
            ) : (
              <div className="small text-muted">Indica el precio final para ver el beneficio real. No se redondea.</div>
            )}
          </div>
        </div>
      </div>

      <div className="alert alert-secondary small py-2">
        {ingresos.iva.mensaje} El beneficio ya descuenta la mano de obra valorada en los parámetros.
      </div>

      <h5>Desglose del coste</h5>
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
      <p className="small text-muted">
        {resultado.pantallas} pantalla(s) · merma {porcentaje(resultado.merma)} · motor {resultado.motor}
        {parametrosVersion ? ` · parámetros versión ${parametrosVersion}` : ""}
      </p>
    </div>
  );
}

export default DesgloseCostes;
