import { Calculator, Factory, Tag, Wallet } from "lucide-react";
import { euros, porcentaje } from "../../shared/utils/dinero";

const Fila = ({ etiqueta, children, testid }) => (
  <div className="gx-fila-dato">
    <span>{etiqueta}</span>
    <strong data-testid={testid}>{children}</strong>
  </div>
);

/**
 * Key figures of a real-cost result, always in view (sticky on wide screens):
 * production cost, recommended price (before and after rounding), expected
 * margin, the owner's final price and the profit it gives.
 */
function ResumenCalculo({ resultado, parametrosVersion }) {
  if (!resultado) {
    return (
      <aside className="gx-panel-resultados" aria-label="Resultado del cálculo">
        <div className="gx-resultado text-center text-muted py-4">
          <Calculator size={28} className="mb-2" aria-hidden="true" />
          <div className="fw-semibold text-body">Resultado</div>
          <div className="small">Completa las prendas y las zonas de impresión para ver el coste y el precio recomendado.</div>
        </div>
      </aside>
    );
  }
  const { costes, precio, beneficio } = resultado;
  const redondea = precio.redondeoPorUnidadCent > 0;
  const perdida = beneficio && beneficio.cent < 0;
  return (
    <aside className="gx-panel-resultados" aria-label="Resultado del cálculo">
      <div className="gx-resultado">
        <div className="gx-kpi-etiqueta"><Factory size={16} aria-hidden="true" />Coste total de producción</div>
        <div className="gx-kpi-valor" data-testid="coste-total">{euros(costes.totalCent)}</div>
        <Fila etiqueta="Coste por unidad" testid="coste-unidad">{euros(costes.porUnidadCent)}</Fila>
        <Fila etiqueta="Unidades · pantallas">{resultado.unidades} · {resultado.pantallas}</Fila>
      </div>

      <div className="gx-resultado gx-resultado-principal">
        <div className="gx-kpi-etiqueta"><Tag size={16} aria-hidden="true" />Precio recomendado</div>
        <div className="gx-kpi-valor" data-testid="precio-recomendado">{euros(precio.recomendadoCent)}</div>
        {redondea ? (
          <>
            <Fila etiqueta="Por unidad, sin redondear" testid="precio-unidad-sin-redondear">{euros(precio.recomendadoPorUnidadSinRedondearCent)}</Fila>
            <Fila etiqueta={`Por unidad, redondeado (múltiplos de ${euros(precio.redondeoPorUnidadCent)})`} testid="precio-unidad-redondeado">{euros(precio.recomendadoPorUnidadCent)}</Fila>
          </>
        ) : (
          <Fila etiqueta="Por unidad (sin redondeo)">{euros(precio.recomendadoPorUnidadCent)}</Fila>
        )}
        <Fila etiqueta="Margen previsto" testid="margen-recomendado">{porcentaje(precio.beneficioRecomendado.margen)}</Fila>
        <Fila etiqueta="Beneficio previsto" testid="beneficio-recomendado">{euros(precio.beneficioRecomendado.cent)}</Fila>
        <div className="small text-muted mt-1">Margen aplicado: {porcentaje(precio.margenRecomendado)} sobre el precio de venta</div>
      </div>

      <div className={`gx-resultado ${perdida ? "border-danger" : ""}`}>
        <div className="gx-kpi-etiqueta"><Wallet size={16} aria-hidden="true" />Precio final (decidido por ti)</div>
        <div className="gx-kpi-valor" data-testid="precio-final">{euros(precio.finalCent)}</div>
        {beneficio ? (
          <>
            <Fila etiqueta="Beneficio">
              <span className={perdida ? "gx-negativo" : "gx-positivo"} data-testid="beneficio">{euros(beneficio.cent)}</span>
            </Fila>
            <Fila etiqueta="Margen sobre la venta">{porcentaje(beneficio.margen)}</Fila>
            <Fila etiqueta="Beneficio por unidad">{euros(beneficio.porUnidadCent)}</Fila>
          </>
        ) : (
          <div className="small text-muted">Escribe el precio final para ver el beneficio real. No se redondea.</div>
        )}
      </div>
      <div className="small text-muted px-1">
        Sin IVA añadido · motor {resultado.motor}{parametrosVersion ? ` · parámetros v${parametrosVersion}` : ""}
      </div>
    </aside>
  );
}

export default ResumenCalculo;
