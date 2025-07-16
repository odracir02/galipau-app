import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BloquePresupuesto from "./BloquePresupuesto";
import { getProductos } from "../services/getProductos";

function QuoteForm() {
  const [clientName, setClientName] = useState("");
  const [productos, setProductos] = useState([]);
  const [bloques, setBloques] = useState([
    {
      id: Date.now(),
      estampado: "DTF",
      area: null,
      numColores: null,
      lineas: [
        {
          tipo: "Camiseta",
          proveedor: "",
          modelo: "",
          color: "",
          size: "",
          quantity: "",
        },
      ],
    },
  ]);

  const [quoteResult, setQuoteResult] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetchProductos = async () => {
      const data = await getProductos();
      setProductos(data);
    };
    fetchProductos();
  }, []);

  const handleChangeBloque = (index, field, value) => {
    const copia = [...bloques];
    copia[index][field] = value;
    setBloques(copia);
  };

  const handleChangeLinea = (bloqueIndex, lineaIndex, field, value) => {
    const copia = [...bloques];
    copia[bloqueIndex].lineas[lineaIndex][field] = value;
    setBloques(copia);
  };

  const addLinea = (bloqueIndex) => {
    const copia = [...bloques];
    copia[bloqueIndex].lineas.push({
      tipo: "Camiseta",
      proveedor: "",
      modelo: "",
      color: "",
      size: "",
      quantity: "",
    });
    setBloques(copia);
  };

  const addBloque = () => {
    setBloques([
      ...bloques,
      {
        id: Date.now(),
        estampado: "DTF",
        area: null,
        numColores: null,
        lineas: [
          {
            tipo: "Camiseta",
            proveedor: "",
            modelo: "",
            color: "",
            size: "",
            quantity: "",
          },
        ],
      },
    ]);
  };

  const handleCalcularPresupuesto = () => {
    const costePorCm2 = (9 / 5500) * 1.21;
    const precioBastidor = 25;
    const precioManoObra = 1.5;

    const todasLasLineas = bloques.flatMap((bloque) =>
      bloque.lineas.map((linea) => ({
        ...linea,
        estampado: bloque.estampado,
        area: bloque.area,
        zonas: bloque.zonas || 1,
        numColores: bloque.numColores,
      }))
    );

    const lineasValidas = todasLasLineas.filter(
      (l) =>
        l.tipo &&
        l.proveedor &&
        l.modelo &&
        l.color &&
        l.size &&
        l.quantity &&
        l.estampado
    );

    if (lineasValidas.length === 0) return;

    let totalPrendas = 0;
    let subtotalSinDescuento = 0;

    const lineasConPrecio = lineasValidas.map((linea) => {
      const unidades = parseInt(linea.quantity);
      const zonas = parseInt(linea.zonas) || 1;
      totalPrendas += unidades;

      let precioUnitario = 0;
      let subtotal = 0;

      if (linea.estampado === "DTF") {
        const costeFilm = (linea.area || 0) * costePorCm2;
        const costeClienteFilm = costeFilm * 2;
        const filmPorUnidad = costeClienteFilm / unidades;
        const manoObraUnidad = zonas * precioManoObra;
        precioUnitario = filmPorUnidad + manoObraUnidad;
      }

      if (linea.estampado === "Serigrafía") {
        const costeBastidorTotal = zonas * precioBastidor;
        const costeManoObraTotal = zonas * unidades * precioManoObra;
        const totalBloque = costeBastidorTotal + costeManoObraTotal;
        precioUnitario = totalBloque / unidades;
      }

      subtotal = precioUnitario * unidades;
      subtotalSinDescuento += subtotal;

      return {
        ...linea,
        precioUnitario,
        subtotal,
      };
    });

    let descuentoPorcentaje = 0;
    if (totalPrendas >= 50) descuentoPorcentaje = 15;
    else if (totalPrendas >= 20) descuentoPorcentaje = 10;
    else if (totalPrendas >= 10) descuentoPorcentaje = 5;

    const descuento = (subtotalSinDescuento * descuentoPorcentaje) / 100;
    const total = subtotalSinDescuento - descuento;

    setQuoteResult({
      clientName,
      totalPrendas,
      lineas: lineasConPrecio,
      subtotalSinDescuento,
      descuentoPorcentaje,
      descuento,
      total,
    });

    setSaved(false);
  };

  const handleGuardarPresupuesto = () => {
    if (!quoteResult || saved) return;

    const historial =
      JSON.parse(localStorage.getItem("historialPresupuestos")) || [];
    const nuevo = { ...quoteResult, fecha: new Date().toISOString() };
    localStorage.setItem(
      "historialPresupuestos",
      JSON.stringify([...historial, nuevo])
    );
    setSaved(true);
  };

  return (
    <div className="container mt-5">
      <h2 className="mb-4">Generar presupuesto</h2>

      <div className="mb-3">
        <label className="form-label">Nombre del cliente</label>
        <input
          type="text"
          className="form-control"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
      </div>

      {bloques.map((bloque, i) => (
        <BloquePresupuesto
          key={bloque.id}
          bloque={bloque}
          index={i}
          onBloqueChange={handleChangeBloque}
          onLineaChange={handleChangeLinea}
          onAddLinea={addLinea}
          productos={productos}
        />
      ))}

      <button className="btn btn-primary mt-3" onClick={addBloque}>
        + Añadir bloque
      </button>

      <button
        className="btn btn-success mt-3 ms-2"
        onClick={handleCalcularPresupuesto}
      >
        Calcular presupuesto
      </button>

      <Link to="/historial" className="btn btn-outline-secondary ms-2 mt-3">
        Ver historial
      </Link>

      {quoteResult && (
        <div className="mt-5">
          <h4>Resumen del presupuesto</h4>
          <p>
            <strong>Cliente:</strong> {quoteResult.clientName}
          </p>
          <p>
            <strong>Total de prendas:</strong> {quoteResult.totalPrendas}
          </p>

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
                </tr>
              ))}
            </tbody>
          </table>

          <h5>
            Subtotal sin descuento:{" "}
            {quoteResult.subtotalSinDescuento.toFixed(2)} €
          </h5>
          <h5>
            Descuento aplicado ({quoteResult.descuentoPorcentaje}%): -
            {quoteResult.descuento.toFixed(2)} €
          </h5>
          <h4>Total final: {quoteResult.total.toFixed(2)} €</h4>

          <button
            className="btn btn-success"
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
