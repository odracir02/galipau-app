// Pricing parameters of the current (legacy) quote engine, previously hard-coded
// in QuoteForm.jsx. Values are kept exactly as they were; they have NOT been
// validated against the master spreadsheet and will be replaced in a later phase.

export const PARAMETROS_LEGACY = Object.freeze({
  // DTF film: reference price for a reference surface, plus VAT factor.
  // Cost per cm² = (precioFilmReferencia / superficieFilmReferenciaCm2) * factorIvaFilm
  precioFilmReferencia: 9,
  superficieFilmReferenciaCm2: 5500,
  factorIvaFilm: 1.21,
  // Customer price of the film = film cost * multiplicadorFilm
  multiplicadorFilm: 2,
  // Screen printing: price per screen, charged per print area
  precioBastidor: 25,
  // Labour per print area and garment (DTF and screen printing)
  precioManoObra: 1.5,
  // Volume discount tiers, evaluated from the highest minimum down
  tramosDescuento: Object.freeze([
    Object.freeze({ minimoPrendas: 50, porcentaje: 15 }),
    Object.freeze({ minimoPrendas: 20, porcentaje: 10 }),
    Object.freeze({ minimoPrendas: 10, porcentaje: 5 }),
  ]),
});
