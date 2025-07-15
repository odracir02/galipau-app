import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

function BudgetHistory() {
  const [presupuestos, setPresupuestos] = useState([]);

  useEffect(() => {
    const data = JSON.parse(localStorage.getItem("historialPresupuestos")) || [];
    setPresupuestos(data);
  }, []);

  const eliminarPresupuesto = (index) => {
    const actualizados = [...presupuestos];
    actualizados.splice(index, 1);
    setPresupuestos(actualizados);
    localStorage.setItem("historialPresupuestos", JSON.stringify(actualizados));
  };

  return (
    <div className="container mt-5">
      <h2>Historial de presupuestos</h2>
      {presupuestos.length === 0 ? (
        <p>No hay presupuestos guardados.</p>
      ) : (
        <table className="table table-bordered mt-4">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Prendas</th>
              <th>Total</th>
              <th>Fecha</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {presupuestos.map((p, idx) => (
              <tr key={idx}>
                <td>{p.clientName}</td>
                <td>{p.printType}</td>
                <td>{p.totalQuantity}</td>
                <td>{p.totalPresupuesto.toFixed(2)} €</td>
                <td>{new Date(p.fecha).toLocaleString()}</td>
                <td>
                  <button className="btn btn-danger btn-sm" onClick={() => eliminarPresupuesto(idx)}>
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Link to="/" className="btn btn-secondary mt-3">
        ← Volver al formulario
      </Link>
    </div>
  );
}

export default BudgetHistory;
