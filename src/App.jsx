import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import QuoteForm from "./components/QuoteForm";
import BudgetHistory from "./components/BudgetHistory";
import ProveedorSesion from "./app/sesion/ProveedorSesion";
import BarraNavegacion from "./app/BarraNavegacion";
import PaginaCopias from "./modules/copias/PaginaCopias";

function App() {
  return (
    <Router>
      <ProveedorSesion>
        <BarraNavegacion />
        <Routes>
          <Route path="/" element={<QuoteForm />} />
          <Route path="/historial" element={<BudgetHistory />} />
          <Route path="/copias" element={<PaginaCopias />} />
        </Routes>
      </ProveedorSesion>
    </Router>
  );
}

export default App;
