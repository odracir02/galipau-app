import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import QuoteForm from "./components/QuoteForm";
import BudgetHistory from "./components/BudgetHistory";
import ProveedorSesion from "./app/sesion/ProveedorSesion";
import BarraNavegacion from "./app/BarraNavegacion";
import PiePagina from "./app/PiePagina";
import PaginaCopias from "./modules/copias/PaginaCopias";
import PaginaCopiasNube from "./modules/copias/PaginaCopiasNube";
import { backendActivo } from "./app/backend";

function App({ servicioSesion }) {
  const nube = backendActivo() === "supabase";
  return (
    <Router>
      <ProveedorSesion servicio={servicioSesion}>
        <BarraNavegacion />
        <main className="pb-5">
          <Routes>
            <Route path="/" element={<QuoteForm />} />
            <Route path="/historial" element={<BudgetHistory />} />
            <Route path="/copias" element={nube ? <PaginaCopiasNube /> : <PaginaCopias />} />
          </Routes>
        </main>
        <PiePagina />
      </ProveedorSesion>
    </Router>
  );
}

export default App;
