// Loads FICTITIOUS catalogue data into the DEVELOPMENT database.
// Refuses to run against the production data folder.
// Usage: npm run db:ejemplo

import { cargarConfig } from "../config.js";
import { iniciarServicios, crearLogger } from "../arranque.js";
import { importarCatalogo } from "../modules/catalogo/importar.js";

const config = cargarConfig(process.env, { modo: "desarrollo" });
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to load sample data in production mode.");
  process.exit(1);
}

const PRODUCTOS_FICTICIOS = [];
const tallas = ["S", "M", "L", "XL"];
const modelos = [
  { tipo: "Camiseta", proveedor: "Proveedor Demo A", modelo: "Básica 150", coste: { Blanco: "1.95", Negro: "2.35", Rojo: "2.35" } },
  { tipo: "Camiseta", proveedor: "Proveedor Demo B", modelo: "Premium 190", coste: { Blanco: "3.10", Azul: "3.60" } },
  { tipo: "Sudadera", proveedor: "Proveedor Demo A", modelo: "Capucha 280", coste: { Blanco: "9.80", Gris: "10.40" } },
  { tipo: "Polo", proveedor: "Proveedor Demo B", modelo: "Piqué 210", coste: { Blanco: "5.20", Verde: "5.70" } },
];
for (const m of modelos) {
  for (const [color, coste] of Object.entries(m.coste)) {
    for (const talla of tallas) PRODUCTOS_FICTICIOS.push({ tipo: m.tipo, proveedor: m.proveedor, modelo: m.modelo, talla, color, coste });
  }
}

const servicios = await iniciarServicios(config, { logger: crearLogger(), programarCopias: false });
const informe = importarCatalogo(servicios.bd, PRODUCTOS_FICTICIOS);
console.log(`Development database: ${config.rutaBaseDatos}`);
console.log(`Sample catalogue: ${informe.importadas} new, ${informe.actualizadas} updated, ${informe.sinCambios} unchanged`);
await servicios.cerrar();
