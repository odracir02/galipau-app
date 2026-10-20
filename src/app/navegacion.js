// Main navigation, defined once. Modules not built yet are marked "proximamente":
// they lead to an explanatory page and are never presented as working features.
import { BookOpen, Calculator, ClipboardList, Factory, FileText, History, Home, Package, Settings, Users } from "lucide-react";

export const NAVEGACION_NUBE = [
  {
    seccion: null,
    enlaces: [
      { ruta: "/", texto: "Inicio", icono: Home, exacta: true },
      { ruta: "/costes", texto: "Calculadora de costes", icono: Calculator },
      { ruta: "/presupuestos", texto: "Presupuestos", icono: FileText },
      { ruta: "/clientes", texto: "Clientes", icono: Users },
    ],
  },
  {
    seccion: "Taller",
    enlaces: [
      { ruta: "/catalogo", texto: "Catálogo", icono: BookOpen },
      { ruta: "/pedidos", texto: "Pedidos", icono: ClipboardList, proximamente: true },
      { ruta: "/produccion", texto: "Producción", icono: Factory, proximamente: true },
      { ruta: "/inventario", texto: "Inventario", icono: Package, proximamente: true },
    ],
  },
];

// Local mode (Express + SQLite, legacy): the previous quote form and history
export const NAVEGACION_LOCAL = [
  {
    seccion: null,
    enlaces: [
      { ruta: "/", texto: "Presupuesto", icono: FileText, exacta: true },
      { ruta: "/historial", texto: "Historial", icono: History },
      { ruta: "/costes", texto: "Calculadora de costes", icono: Calculator },
    ],
  },
];

export const ENLACE_CONFIGURACION = { ruta: "/configuracion", texto: "Configuración", icono: Settings };
