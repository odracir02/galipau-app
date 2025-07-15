import { useState, useEffect } from "react";
import { getProductos } from "../services/getProductos";
import { Link } from "react-router-dom";

function QuoteForm() {
  const [clientName, setClientName] = useState("");
  const [printType, setPrintType] = useState("DTF");
  const [productos, setProductos] = useState([]);
  const [quoteResult, setQuoteResult] = useState(null);
  const [saved, setSaved] = useState(false);

  const [sizeEntries, setSizeEntries] = useState([
    {
      tipo: "Camiseta",
      proveedor: "",
      modelo: "",
      color: "",
      size: "",
      quantity: "",
      id: Date.now(),
    },
  ]);

  useEffect(() => {
    const fetchProductos = async () => {
      const data = await getProductos();
      setProductos(data);
    };
    fetchProductos();
  }, []);

  const normalizeString = (str) =>
    str
      ?.toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const normalizeColor = (color) => {
    const c = normalizeString(color);
    if (c === "blanca" || c === "blanco") return "blanco";
    if (c === "color") return "color";
    return c;
  };

  const handleChange = (index, field, value) => {
    const updated = [...sizeEntries];
    updated[index][field] = value;
    setSizeEntries(updated);
  };

  const addSizeEntry = () => {
    setSizeEntries([
      ...sizeEntries,
      {
        tipo: "Camiseta",
        proveedor: "",
        modelo: "",
        color: "",
        size: "",
        quantity: "",
        id: Date.now(),
      },
    ]);
  };

  const removeSizeEntry = (index) => {
    const updated = [...sizeEntries];
    updated.splice(index, 1);
    setSizeEntries(updated);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const validEntries = sizeEntries.filter(
      (entry) =>
        entry.tipo &&
        entry.quantity &&
        entry.size &&
        entry.proveedor &&
        entry.modelo &&
        entry.color
    );

    if (validEntries.length === 0) return;

    const entriesWithCost = validEntries.map((entry) => {
      const producto = productos.find((p) => {
        return (
          normalizeString(p.tipo) === normalizeString(entry.tipo) &&
          normalizeString(p.proveedor) === normalizeString(entry.proveedor) &&
          normalizeString(p.modelo) === normalizeString(entry.modelo) &&
          normalizeString(p.color) === normalizeColor(entry.color) &&
          normalizeString(p.talla) === normalizeString(entry.size)
        );
      });

      const costeUnitario = producto ? parseFloat(producto.coste || 0) : 0;
      const subtotal = costeUnitario * parseInt(entry.quantity);

      return {
        ...entry,
        costeUnitario,
        subtotal,
      };
    });

    const totalQuantity = entriesWithCost.reduce(
      (acc, curr) => acc + parseInt(curr.quantity),
      0
    );

    let descuentoPorcentaje = 0;
    if (totalQuantity >= 50) descuentoPorcentaje = 15;
    else if (totalQuantity >= 20) descuentoPorcentaje = 10;
    else if (totalQuantity >= 10) descuentoPorcentaje = 5;

    const subtotalSinDescuento = entriesWithCost.reduce(
      (acc, curr) => acc + curr.subtotal,
      0
    );

    const descuentoAplicado =
      (subtotalSinDescuento * descuentoPorcentaje) / 100;
    const totalConDescuento = subtotalSinDescuento - descuentoAplicado;

    const formData = {
      clientName,
      printType,
      sizeEntries: entriesWithCost,
      totalQuantity,
      subtotalSinDescuento,
      descuentoPorcentaje,
      descuentoAplicado,
      totalPresupuesto: totalConDescuento,
    };

    setQuoteResult(formData);
    setSaved(false); // No se guarda hasta que se pulse el botón de guardar
  };

  const handleGuardarPresupuesto = () => {
    if (!quoteResult || saved) return;

    const stored =
      JSON.parse(localStorage.getItem("historialPresupuestos")) || [];
    const actualizado = [
      ...stored,
      { ...quoteResult, fecha: new Date().toISOString() },
    ];
    localStorage.setItem("historialPresupuestos", JSON.stringify(actualizado));
    setSaved(true);
  };

  return (
    <div className="container mt-5">
      <h2 className="mb-4">Generar presupuesto</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="form-label">Nombre del cliente</label>
          <input
            type="text"
            className="form-control"
            value={clientName}
            required
            onChange={(e) => setClientName(e.target.value)}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Tallas, cantidades y tipo</label>
          {sizeEntries.map((entry, index) => {
            const proveedoresDisponibles = [
              ...new Set(productos.map((p) => p.proveedor)),
            ];

            const modelosDisponibles = productos
              .filter(
                (p) => p.proveedor === entry.proveedor && p.tipo === entry.tipo
              )
              .map((p) => p.modelo);

            const modelosUnicos = [...new Set(modelosDisponibles)];

            const tallaOrden = ["Niño", "S", "M", "L", "XL", "2XL", "3XL"];
            const tallasDisponibles = [
              ...new Set(
                productos
                  .filter(
                    (p) =>
                      p.tipo === entry.tipo &&
                      p.proveedor === entry.proveedor &&
                      p.modelo === entry.modelo
                  )
                  .map((p) => p.talla)
              ),
            ].sort((a, b) => tallaOrden.indexOf(a) - tallaOrden.indexOf(b));

            const coloresDisponibles = [
              ...new Set(
                productos
                  .filter(
                    (p) =>
                      p.tipo === entry.tipo &&
                      p.proveedor === entry.proveedor &&
                      p.modelo === entry.modelo &&
                      p.talla === entry.size
                  )
                  .map((p) =>
                    normalizeColor(p.color) === "blanco" ? "Blanca" : "Color"
                  )
              ),
            ];

            return (
              <div className="row g-2 mb-2" key={entry.id}>
                <div className="col-md-2">
                  <select
                    className="form-select"
                    required
                    value={entry.tipo}
                    onChange={(e) =>
                      handleChange(index, "tipo", e.target.value)
                    }
                  >
                    <option value="Camiseta">Camiseta</option>
                    <option value="Sudadera">Sudadera</option>
                    <option value="Polo">Polo</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <select
                    className="form-select"
                    required
                    value={entry.proveedor}
                    onChange={(e) =>
                      handleChange(index, "proveedor", e.target.value)
                    }
                  >
                    <option value="">Proveedor</option>
                    {proveedoresDisponibles.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <select
                    className="form-select"
                    required
                    value={entry.modelo}
                    onChange={(e) =>
                      handleChange(index, "modelo", e.target.value)
                    }
                    disabled={!entry.proveedor || !entry.tipo}
                  >
                    <option value="">Modelo</option>
                    {modelosUnicos.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <select
                    className="form-select"
                    value={entry.size}
                    required
                    onChange={(e) =>
                      handleChange(index, "size", e.target.value)
                    }
                  >
                    <option value="">Talla</option>
                    {tallasDisponibles.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <select
                    className="form-select"
                    value={entry.color}
                    required
                    onChange={(e) =>
                      handleChange(index, "color", e.target.value)
                    }
                  >
                    <option value="">Selecciona color</option>
                    {coloresDisponibles.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-1">
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Cant."
                    className="form-control"
                    value={entry.quantity}
                    onChange={(e) =>
                      handleChange(index, "quantity", e.target.value)
                    }
                  />
                </div>
                <div className="col-md-1">
                  <button
                    type="button"
                    className="btn btn-danger w-100"
                    onClick={() => removeSizeEntry(index)}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={addSizeEntry}
          >
            + Añadir otra línea
          </button>
        </div>

        <div className="mb-3">
          <label className="form-label d-block">Tipo de estampado</label>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="estampado"
              value="DTF"
              checked={printType === "DTF"}
              onChange={(e) => setPrintType(e.target.value)}
            />
            <label className="form-check-label">DTF</label>
          </div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              name="estampado"
              value="Serigrafía"
              checked={printType === "Serigrafía"}
              onChange={(e) => setPrintType(e.target.value)}
            />
            <label className="form-check-label">Serigrafía</label>
          </div>
        </div>

        <button type="submit" className="btn btn-primary">
          Calcular presupuesto
        </button>
        <Link to="/historial" className="btn btn-outline-secondary ms-2">
          Ver historial de presupuestos
        </Link>
      </form>

      {quoteResult && (
        <div className="mt-5">
          <h4>Resumen del presupuesto</h4>
          <p>
            <strong>Cliente:</strong> {quoteResult.clientName}
          </p>
          <p>
            <strong>Estampado:</strong> {quoteResult.printType}
          </p>

          <table className="table table-bordered mt-3">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Proveedor</th>
                <th>Modelo</th>
                <th>Color</th>
                <th>Talla</th>
                <th>Cantidad</th>
                <th>€/unidad</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {quoteResult.sizeEntries.map((entry, idx) => (
                <tr key={idx}>
                  <td>{entry.tipo}</td>
                  <td>{entry.proveedor}</td>
                  <td>{entry.modelo}</td>
                  <td>{entry.color}</td>
                  <td>{entry.size}</td>
                  <td>{entry.quantity}</td>
                  <td>{entry.costeUnitario.toFixed(2)} €</td>
                  <td>{entry.subtotal.toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h5 className="mt-4">
            Total de prendas: {quoteResult.totalQuantity}
          </h5>
          <h5>
            Subtotal sin descuento:{" "}
            {quoteResult.subtotalSinDescuento.toFixed(2)} €
          </h5>
          <h5>
            Descuento aplicado ({quoteResult.descuentoPorcentaje}%): -
            {quoteResult.descuentoAplicado.toFixed(2)} €
          </h5>
          <h4 className="mt-3">
            Total final: {quoteResult.totalPresupuesto.toFixed(2)} €
          </h4>

          <button
            className="btn btn-success mt-3"
            onClick={handleGuardarPresupuesto}
            disabled={saved}
          >
            {saved ? "Presupuesto guardado" : "Guardar presupuesto"}
          </button>
        </div>
      )}
    </div>
  );
}

export default QuoteForm;
