import { useId } from "react";
import DTFFormFields from "./DTFFormFields";
import SerigrafiaFormFields from "./SerigrafiaFormFields";
import LineaProducto from "./LineaProducto";
import { opcionesLinea } from "../domain/catalogo";

function BloquePresupuesto({
  bloque,
  index,
  productos,
  errores = [],
  puedeEliminar,
  onBloqueChange,
  onLineaChange,
  onAddLinea,
  onRemoveLinea,
  onRemoveBloque,
}) {
  const id = useId();
  const tieneError = (campo) => errores.some((e) => !e.lineaId && e.campo === campo);
  const camposConError = (lineaId) =>
    errores.filter((e) => e.lineaId === lineaId).map((e) => e.campo);

  return (
    <section className="border rounded p-3 mb-4 bg-light" aria-label={`Tipo ${index + 1}`}>
      <div className="d-flex justify-content-between align-items-center">
        <h5>Tipo {index + 1}</h5>
        {puedeEliminar && (
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={onRemoveBloque}>
            Eliminar bloque
          </button>
        )}
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor={`${id}-estampado`}>Tipo de estampado</label>
        <select
          id={`${id}-estampado`}
          className="form-select w-auto"
          value={bloque.estampado}
          onChange={(e) => onBloqueChange("estampado", e.target.value)}
        >
          <option value="DTF">DTF</option>
          <option value="Serigrafía">Serigrafía</option>
        </select>
      </div>

      <div className="mb-3">
        <label className="form-label" htmlFor={`${id}-zonas`}>Número de zonas estampadas</label>
        <select
          id={`${id}-zonas`}
          className="form-select w-auto"
          value={bloque.zonas || 1}
          onChange={(e) => onBloqueChange("zonas", parseInt(e.target.value))}
        >
          <option value={1}>1 zona (ej. frontal)</option>
          <option value={2}>2 zonas (frontal + espalda)</option>
          <option value={3}>3 zonas o más</option>
        </select>
      </div>

      {bloque.estampado === "DTF" && (
        <DTFFormFields
          area={bloque.area}
          invalido={tieneError("area")}
          onChange={(val) => onBloqueChange("area", val)}
        />
      )}

      {bloque.estampado === "Serigrafía" && (
        <SerigrafiaFormFields
          numColores={bloque.numColores}
          invalido={tieneError("numColores")}
          onChange={(val) => onBloqueChange("numColores", val)}
        />
      )}

      <div className="mt-3">
        {bloque.lineas.map((linea, lineaIndex) => (
          <LineaProducto
            key={linea.id}
            linea={linea}
            numero={lineaIndex + 1}
            opciones={opcionesLinea(productos, linea)}
            camposConError={camposConError(linea.id)}
            puedeEliminar={bloque.lineas.length > 1}
            onChange={(campo, val) => onLineaChange(linea.id, campo, val)}
            onRemove={() => onRemoveLinea(linea.id)}
          />
        ))}

        <button type="button" className="btn btn-outline-secondary mt-2" onClick={onAddLinea}>
          + Añadir línea
        </button>
      </div>
    </section>
  );
}

export default BloquePresupuesto;
