import { useState } from "react";

// Downloads the stored history exactly as it is (read-only), for the controlled migration
const exportarHistorial = (presupuestos) => {
  const blob = new Blob([JSON.stringify(presupuestos, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `historial-presupuestos-${new Date().toISOString().slice(0, 10)}.json`;
  enlace.click();
  URL.revokeObjectURL(url);
};
import { Link } from "react-router-dom";
import {
  leerHistorial,
  guardarHistorial,
  eliminarPresupuesto as quitarDeLista,
  formatearPresupuesto,
} from "../domain/historialPresupuestos";

function BudgetHistory() {
  const [presupuestos, setPresupuestos] = useState(() =>
    leerHistorial(globalThis.localStorage)
  );

  const eliminarPresupuesto = (index) => {
    const actualizados = quitarDeLista(presupuestos, index);
    setPresupuestos(actualizados);
    guardarHistorial(localStorage, actualizados);
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
            {presupuestos.map((registro, idx) => {
              const p = formatearPresupuesto(registro);
              return (
                <tr key={idx}>
                  <td>{p.cliente}</td>
                  <td>{p.tecnicas}</td>
                  <td>{p.prendas}</td>
                  <td>{p.total}</td>
                  <td>{p.fecha}</td>
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => eliminarPresupuesto(idx)}>
                      Borrar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Link to="/" className="btn btn-secondary mt-3">
        ← Volver al formulario
      </Link>
      {presupuestos.length > 0 && (
        <button type="button" className="btn btn-outline-secondary mt-3 ms-2" onClick={() => exportarHistorial(presupuestos)}>
          Exportar historial (archivo JSON)
        </button>
      )}
    </div>
  );
}

export default BudgetHistory;
