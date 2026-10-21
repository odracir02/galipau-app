import 'bootstrap/dist/css/bootstrap.min.css';
import '@fontsource-variable/inter';
import './app/tema/tema.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { aplicarTema, leerPreferencias } from './app/tema/preferencias';
import { entornoWeb } from './app/entorno';

// Apply the saved theme before the first paint (no light flash in dark mode)
aplicarTema(leerPreferencias().tema);

// A test build says so everywhere, including the browser tab
if (entornoWeb() === 'pruebas') {
  document.title = `PRUEBAS · ${document.title}`;
  document.documentElement.setAttribute('data-entorno', 'pruebas');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
