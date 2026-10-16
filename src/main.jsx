import 'bootstrap/dist/css/bootstrap.min.css';
import '@fontsource-variable/inter';
import './app/tema/tema.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { aplicarTema, leerPreferencias } from './app/tema/preferencias';

// Apply the saved theme before the first paint (no light flash in dark mode)
aplicarTema(leerPreferencias().tema);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
