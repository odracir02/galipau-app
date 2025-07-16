import DTFFormFields from "./DTFFormFields";
import SerigrafiaFormFields from "./SerigrafiaFormFields";
import LineaProducto from "./LineaProducto";

function BloquePresupuesto({
  bloque,
  index,
  onBloqueChange,
  onLineaChange,
  onAddLinea,
  productos,
}) {
  const normalize = (str) =>
    str?.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  const normalizeColor = (color) => {
    const c = normalize(color);
    if (c === "blanca" || c === "blanco") return "Blanca";
    return "Color";
  };

  const handleBloqueFieldChange = (field, value) => {
    onBloqueChange(index, field, value);
  };

  const handleLineaFieldChange = (lineaIndex, field, value) => {
    onLineaChange(index, lineaIndex, field, value);
  };

  const handleAddLinea = () => {
    onAddLinea(index);
  };

  const tallaOrden = ["Niño", "S", "M", "L", "XL", "2XL", "3XL"];

  return (
    <div className="border rounded p-3 mb-4 bg-light">
      <h5>Bloque {index + 1}</h5>

      <div className="mb-3">
        <label className="form-label">Tipo de estampado</label>
        <select
          className="form-select w-auto"
          value={bloque.estampado}
          onChange={(e) => handleBloqueFieldChange("estampado", e.target.value)}
        >
          <option value="DTF">DTF</option>
          <option value="Serigrafía">Serigrafía</option>
        </select>
      </div>

      {bloque.estampado === "DTF" && (
        <DTFFormFields
          area={bloque.area}
          onChange={(val) => handleBloqueFieldChange("area", val)}
        />
      )}

      {bloque.estampado === "Serigrafía" && (
        <SerigrafiaFormFields
          numColores={bloque.numColores}
          onChange={(val) => handleBloqueFieldChange("numColores", val)}
        />
      )}

      <div className="mt-3">
        {bloque.lineas.map((linea, lineaIndex) => {
          const tipo = linea.tipo;
          const proveedor = linea.proveedor;
          const modelo = linea.modelo;
          const talla = linea.size;

          const proveedores = [
            ...new Set(productos.filter(p => p.tipo === tipo).map(p => p.proveedor)),
          ];

          const modelos = [
            ...new Set(productos
              .filter(p => p.tipo === tipo && p.proveedor === proveedor)
              .map(p => p.modelo)),
          ];

          const tallas = [
            ...new Set(productos
              .filter(p =>
                p.tipo === tipo &&
                p.proveedor === proveedor &&
                p.modelo === modelo
              )
              .map(p => p.talla)),
          ].sort((a, b) => tallaOrden.indexOf(a) - tallaOrden.indexOf(b));

          const colores = [
            ...new Set(productos
              .filter(p =>
                p.tipo === tipo &&
                p.proveedor === proveedor &&
                p.modelo === modelo &&
                p.talla === talla
              )
              .map(p => normalizeColor(p.color))),
          ];

          return (
            <LineaProducto
              key={lineaIndex}
              linea={linea}
              onChange={(field, val) => handleLineaFieldChange(lineaIndex, field, val)}
              proveedores={proveedores}
              modelos={modelos}
              tallas={tallas}
              colores={colores}
            />
          );
        })}

        <button className="btn btn-outline-secondary mt-2" onClick={handleAddLinea}>
          + Añadir línea
        </button>
      </div>
    </div>
  );
}

export default BloquePresupuesto;
