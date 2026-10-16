import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import QuoteForm from "./components/QuoteForm";
import BudgetHistory from "./components/BudgetHistory";
import ProveedorSesion from "./app/sesion/ProveedorSesion";
import BarraNavegacion from "./app/BarraNavegacion";
import PiePagina from "./app/PiePagina";
import PaginaCopias from "./modules/copias/PaginaCopias";
import PaginaCopiasNube from "./modules/copias/PaginaCopiasNube";
import PaginaCalculadoraSerigrafia from "./modules/calculadora/PaginaCalculadoraSerigrafia";
import PaginaParametros from "./modules/calculadora/PaginaParametros";
import PaginaPresupuestos from "./modules/presupuestos/PaginaPresupuestos";
import PaginaEditorPresupuesto from "./modules/presupuestos/PaginaEditorPresupuesto";
import PaginaEmpresa from "./modules/empresa/PaginaEmpresa";
import PaginaMigracion from "./modules/migracion/PaginaMigracion";
import { backendActivo } from "./app/backend";

function App({ servicioSesion }) {
  const nube = backendActivo() === "supabase";
  return (
    <Router>
      <ProveedorSesion servicio={servicioSesion}>
        <BarraNavegacion nube={nube} />
        <main className="pb-5">
          <Routes>
            {nube ? (
              <>
                {/* Cloud: quotes are stored in Supabase with the real-cost engine */}
                <Route path="/" element={<PaginaPresupuestos />} />
                <Route path="/presupuestos" element={<PaginaPresupuestos />} />
                <Route path="/presupuestos/nuevo" element={<PaginaEditorPresupuesto />} />
                <Route path="/presupuestos/:id" element={<PaginaEditorPresupuesto />} />
                <Route path="/empresa" element={<PaginaEmpresa />} />
                <Route path="/migracion" element={<PaginaMigracion />} />
                <Route path="/antiguo" element={<QuoteForm />} />
              </>
            ) : (
              <Route path="/" element={<QuoteForm />} />
            )}
            <Route path="/historial" element={<BudgetHistory />} />
            <Route path="/costes" element={<PaginaCalculadoraSerigrafia />} />
            <Route path="/parametros" element={<PaginaParametros />} />
            <Route path="/copias" element={nube ? <PaginaCopiasNube /> : <PaginaCopias />} />
          </Routes>
        </main>
        <PiePagina />
      </ProveedorSesion>
    </Router>
  );
}

export default App;
