import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import QuoteForm from "./components/QuoteForm";
import BudgetHistory from "./components/BudgetHistory";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<QuoteForm />} />
        <Route path="/historial" element={<BudgetHistory />} />
      </Routes>
    </Router>
  );
}

export default App;
