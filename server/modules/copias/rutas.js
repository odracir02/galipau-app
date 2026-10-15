import { Router } from "express";
import { soloDesdeEstePc } from "../../http/middleware.js";
import { ErrorApi } from "../../http/errores.js";

export const rutasCopias = ({ copias }) => {
  const r = Router();

  r.get("/estado", (req, res) => res.json(copias.estado()));
  r.get("/", (req, res) => res.json(copias.listar()));

  r.post("/", async (req, res) => {
    res.status(201).json(await copias.crear("manual"));
  });

  // Download a backup (e.g. to keep it on a USB drive)
  r.get("/:archivo/descargar", (req, res) => {
    res.download(copias.rutaDe(req.params.archivo), req.params.archivo);
  });

  r.put("/destino-externo", soloDesdeEstePc, (req, res) => {
    const ruta = req.body?.destinoExterno;
    if (ruta !== null && typeof ruta !== "string") throw new ErrorApi(400, "Ruta no válida.", { campo: "destinoExterno" });
    res.json({ destinoExterno: copias.configurarDestinoExterno(ruta) });
  });

  r.post("/:archivo/restaurar", soloDesdeEstePc, async (req, res) => {
    if (req.body?.confirmar !== req.params.archivo) {
      throw new ErrorApi(400, "Para restaurar hay que confirmar el nombre exacto de la copia.", { campo: "confirmar" });
    }
    res.json(await copias.restaurar(req.params.archivo));
  });

  return r;
};
