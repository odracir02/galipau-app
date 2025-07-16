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

      <Link to="/historial" className="btn btn-outline-secondary ms-2 mt-3">
        Ver historial
      </Link>
    </div>
  );
}

export default QuoteForm;
