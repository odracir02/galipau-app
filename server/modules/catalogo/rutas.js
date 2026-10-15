import { Router } from "express";
import { crearRepositorioCatalogo } from "./repositorio.js";

export const rutasCatalogo = ({ bd }) => {
  const repo = crearRepositorioCatalogo(bd);
  const r = Router();

  // Flat product list consumed by the quote form
  r.get("/productos", (req, res) => res.json(repo.listarPlano()));
  r.get("/resumen", (req, res) => res.json(repo.resumen()));

  return r;
};
