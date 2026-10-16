// FICTITIOUS test data for the quotes module (no real customers or prices).
import { PARAMETROS_EJEMPLO } from "../../../domain/calculo/serigrafia/parametros";
import { calcularCosteSerigrafia } from "../../../domain/calculo/serigrafia/motor";
import { construirEntrada } from "../../calculadora/construirEntrada";
import { construirRegistro } from "./instantanea";

export const CATALOGO_FICTICIO = [
  { id: "1", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "M", color: "Negro", coste: 3 },
  { id: "2", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", talla: "L", color: "Blanco", coste: 2.5 },
];

export const CLIENTE_FICTICIO = {
  id: 7, nombre: "Club Ficticio", nif: "G00000000", email: "club@example.com", telefono: "600000000",
  direccion: "Calle Inventada 1", codigo_postal: "46000", ciudad: "València", provincia: "València",
};

export const formularioFicticio = (cambios = {}) => ({
  lineas: [
    { id: "l1", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", size: "M", color: "Color", quantity: "6", precioManual: "", descripcion: "" },
    { id: "l2", tipo: "Camiseta", proveedor: "Demo", modelo: "Básica", size: "L", color: "Blanca", quantity: "4", precioManual: "", descripcion: "" },
  ],
  zonas: [{ id: "delantera", nombre: "Delantera", colores: "1" }, { id: "trasera", nombre: "Trasera", colores: "1" }],
  minutosDiseno: "30",
  mermaPorcentaje: "5",
  precioFinal: "150",
  ...cambios,
});

export const calcularFicticio = (formulario = formularioFicticio(), parametros = PARAMETROS_EJEMPLO, productos = CATALOGO_FICTICIO) => {
  const { entrada, detalle, problemas, preciosCambiados } = construirEntrada({ ...formulario, productos });
  return { entrada, detalle, problemas, preciosCambiados, resultado: calcularCosteSerigrafia(entrada, parametros) };
};

export const DOCUMENTO_FICTICIO = {
  idioma: "va", fechaEmision: "2026-10-17", validoHasta: "2026-11-16",
  observaciones: "Logo en blanc", condiciones: "Pagament: 50 % en acceptar el pressupost.", notas: "Nota interna: cliente de confianza",
};

export const registroFicticio = (cambios = {}) => ({
  id: 1,
  numero: "2026/003",
  estado: "presentado",
  version: 1,
  creado_en: "2026-10-17T10:00:00Z",
  actualizado_en: "2026-10-17T10:00:00Z",
  ...construirRegistro({
    cliente: CLIENTE_FICTICIO,
    formulario: formularioFicticio(),
    calculo: calcularFicticio(),
    parametrosVersion: 3,
    documento: DOCUMENTO_FICTICIO,
  }),
  ...cambios,
});
