import LineaProducto from "../../components/LineaProducto";
import { opcionesLinea } from "../../domain/catalogo";
import { actualizarCampoLinea } from "../../domain/presupuestoEstado";
import { eurosDecimal, euros } from "../../shared/utils/dinero";
import { lineaVacia } from "../presupuestos/domain/instantanea";

// Fields that do not change which catalogue product a line refers to
const CAMPOS_LIBRES = new Set(["precioManual", "descripcion", "quantity"]);

/**
 * Screen printing job form (garment lines, print zones, design time, waste and
 * final price), shared by the cost calculator and the quote editor.
 * `formulario` is { lineas, zonas, minutosDiseno, mermaPorcentaje, precioFinal };
 * `onChange(fn)` receives an updater function.
 */
function FormularioTrabajo({
  formulario, onChange, productos, detalle = [], soloLectura = false, conDescripcion = false,
  etiquetaPrecioFinal = "Precio final cobrado (€, opcional)", recomendadoCent = null,
}) {
  const { lineas, zonas, minutosDiseno, mermaPorcentaje, precioFinal } = formulario;
  const cambiar = (campo, valor) => onChange((f) => ({ ...f, [campo]: valor }));

  const cambiarLinea = (id, campo, valor) =>
    onChange((f) => ({
      ...f,
      lineas: f.lineas.map((l) => {
        if (l.id !== id) return l;
        if (CAMPOS_LIBRES.has(campo)) return { ...l, [campo]: valor };
        // Choosing another product drops the price saved with the quote
        const { precioGuardado: _anterior, ...resto } = l;
        return actualizarCampoLinea(resto, campo, valor);
      }),
    }));

  const cambiarZona = (id, cambios) => onChange((f) => ({ ...f, zonas: f.zonas.map((z) => (z.id === id ? { ...z, ...cambios } : z)) }));

  return (
    <fieldset disabled={soloLectura}>
      <h3 className="gx-subtitulo">Prendas</h3>
      {lineas.map((l, i) => {
        const d = detalle[i];
        const costeLinea = d && Number.isFinite(d.cantidad) && Number.isFinite(d.precioUnitario) ? d.cantidad * d.precioUnitario : null;
        return (
          <div key={l.id} className="border rounded p-2 mb-2 bg-light">
            <LineaProducto
              linea={l}
              numero={i + 1}
              opciones={opcionesLinea(productos, l)}
              puedeEliminar={lineas.length > 1 && !soloLectura}
              onChange={(campo, valor) => cambiarLinea(l.id, campo, valor)}
              onRemove={() => onChange((f) => ({ ...f, lineas: f.lineas.filter((x) => x.id !== l.id) }))}
            />
            <div className="row g-2 align-items-center">
              <div className="col-auto"><label className="form-label small mb-0" htmlFor={`manual-${l.id}`}>Precio manual de la prenda (opcional, €)</label></div>
              <div className="col-auto">
                <input id={`manual-${l.id}`} className="form-control form-control-sm" inputMode="decimal" style={{ maxWidth: 120 }}
                  value={l.precioManual ?? ""} onChange={(e) => cambiarLinea(l.id, "precioManual", e.target.value)} placeholder="del catálogo" />
              </div>
              {conDescripcion && (
                <>
                  <div className="col-auto"><label className="form-label small mb-0" htmlFor={`descripcion-${l.id}`}>Texto para el cliente (opcional)</label></div>
                  <div className="col">
                    <input id={`descripcion-${l.id}`} className="form-control form-control-sm" value={l.descripcion ?? ""}
                      onChange={(e) => cambiarLinea(l.id, "descripcion", e.target.value)} placeholder={[l.tipo, l.proveedor, l.modelo].filter(Boolean).join(" ")} />
                  </div>
                </>
              )}
              {costeLinea !== null && (
                <div className="col-12 small text-muted" data-testid={`coste-linea-${i + 1}`}>
                  Coste de prendas de la línea: {d.cantidad} × {eurosDecimal(d.precioUnitario)} = <strong>{eurosDecimal(costeLinea)}</strong>
                  {d.origen === "manual" ? " (precio manual)" : d.origen === "guardado" ? " (precio guardado en el presupuesto)" : ""}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!soloLectura && (
        <button type="button" className="btn btn-outline-secondary btn-sm mb-4" onClick={() => onChange((f) => ({ ...f, lineas: [...f.lineas, lineaVacia()] }))}>
          + Añadir línea
        </button>
      )}

      <div className="row g-3 mb-3">
        <div className="col-md-6">
          <h3 className="gx-subtitulo">Zonas de impresión</h3>
          {zonas.map((z) => (
            <div className="input-group input-group-sm mb-2" key={z.id}>
              <input aria-label={`Nombre de la zona ${z.nombre}`} className="input-group-text text-start" style={{ maxWidth: 140 }} value={z.nombre}
                onChange={(e) => cambiarZona(z.id, { nombre: e.target.value })} />
              <input aria-label={`Colores ${z.nombre}`} className="form-control" inputMode="numeric" value={z.colores}
                onChange={(e) => cambiarZona(z.id, { colores: e.target.value })} />
              <span className="input-group-text">colores</span>
              {zonas.length > 1 && !soloLectura && (
                <button type="button" className="btn btn-outline-danger" aria-label={`Quitar zona ${z.nombre}`} onClick={() => onChange((f) => ({ ...f, zonas: f.zonas.filter((x) => x.id !== z.id) }))}>✕</button>
              )}
            </div>
          ))}
          {!soloLectura && (
            <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onChange((f) => ({ ...f, zonas: [...f.zonas, { id: `zona-${Date.now()}`, nombre: `Zona ${f.zonas.length + 1}`, colores: "1" }] }))}>
              + Añadir zona
            </button>
          )}
          <div className="form-text">Cada color de cada zona necesita una pantalla.</div>
        </div>
        <div className="col-md-6">
          <h3 className="gx-subtitulo">Trabajo y precio</h3>
          <label className="form-label small mb-0" htmlFor="minutosDiseno">Tiempo de diseño (minutos)</label>
          <input id="minutosDiseno" className="form-control form-control-sm mb-2" inputMode="numeric" value={minutosDiseno} onChange={(e) => cambiar("minutosDiseno", e.target.value)} />
          <label className="form-label small mb-0" htmlFor="merma">Merma (%)</label>
          <input id="merma" className="form-control form-control-sm mb-2" inputMode="decimal" value={mermaPorcentaje} onChange={(e) => cambiar("mermaPorcentaje", e.target.value)} />
          <label className="form-label small mb-0" htmlFor="precioFinal">{etiquetaPrecioFinal}</label>
          <div className="input-group input-group-sm">
            <input id="precioFinal" className="form-control" inputMode="decimal" value={precioFinal} onChange={(e) => cambiar("precioFinal", e.target.value)} />
            {recomendadoCent !== null && !soloLectura && (
              <button type="button" className="btn btn-outline-primary" onClick={() => cambiar("precioFinal", (recomendadoCent / 100).toFixed(2).replace(".", ","))}>
                Usar el recomendado ({euros(recomendadoCent)})
              </button>
            )}
          </div>
        </div>
      </div>
    </fieldset>
  );
}

export default FormularioTrabajo;
