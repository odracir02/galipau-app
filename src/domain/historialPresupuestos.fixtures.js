// Records with the exact shape produced by each version of QuoteForm.jsx
export const registroAntiguo = {
  clientName: "Club Antiguo",
  printType: "Serigrafía",
  sizeEntries: [
    { tipo: "Camiseta", size: "M", color: "Blanca", quantity: "5", costeUnitario: 2, subtotal: 10 },
    { tipo: "Camiseta", size: "L", color: "Blanca", quantity: "7", costeUnitario: 2, subtotal: 14 },
  ],
  totalQuantity: 12,
  subtotalSinDescuento: 24,
  descuentoPorcentaje: 5,
  descuentoAplicado: 1.2,
  totalPresupuesto: 22.8,
  fecha: "2025-07-15T10:00:00.000Z",
};

export const registroBloques = {
  clientName: "Tienda Bloques",
  totalPrendas: 8,
  lineas: [{ tipo: "Camiseta", size: "M", quantity: "8", estampado: "DTF", precioUnitario: 2.1, subtotal: 16.8 }],
  subtotalSinDescuento: 16.8,
  descuentoPorcentaje: 0,
  descuento: 0,
  total: 16.8,
  fecha: "2025-07-20T10:00:00.000Z",
};

export const registroActual = {
  clientName: "Asociación Mixta",
  totalPrendas: 30,
  lineas: [
    { tipo: "Camiseta", size: "M", quantity: "10", estampado: "DTF", precioUnitario: 4, subtotal: 40, beneficioLinea: 15 },
    { tipo: "Sudadera", size: "L", quantity: "20", estampado: "Serigrafía", precioUnitario: 12, subtotal: 240, beneficioLinea: 55 },
    { tipo: "Camiseta", size: "S", quantity: "0", estampado: "DTF", precioUnitario: null, subtotal: null, beneficioLinea: null },
  ],
  subtotalSinDescuento: 280,
  descuentoPorcentaje: 10,
  descuento: 28,
  total: 252,
  beneficioTotal: 70,
  fecha: "2025-08-01T10:00:00.000Z",
};
