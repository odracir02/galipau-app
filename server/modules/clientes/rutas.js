import { Router } from "express";
import { noEncontrado, traducirErrorSqlite } from "../../http/errores.js";
import { reglas, validar, idDeRuta } from "../../http/validacion.js";
import { crearRepositorioClientes } from "./repositorio.js";

const normalizarNif = (nif) => nif.toUpperCase().replace(/[\s-]/g, "");

const ESQUEMA = {
  tipo: reglas.opcion(["empresa", "particular", "asociacion"], { etiqueta: "Tipo", porDefecto: "particular" }),
  nombre: reglas.texto({ requerido: true, max: 200, etiqueta: "Nombre" }),
  razonSocial: reglas.texto({ max: 200, etiqueta: "Razón social" }),
  nif: reglas.texto({ max: 20, etiqueta: "NIF", transformar: normalizarNif }),
  email: reglas.email(),
  telefono: reglas.texto({ max: 30, etiqueta: "Teléfono" }),
  direccion: reglas.texto({ max: 300, etiqueta: "Dirección" }),
  codigoPostal: reglas.texto({ max: 10, etiqueta: "Código postal" }),
  ciudad: reglas.texto({ max: 100, etiqueta: "Ciudad" }),
  provincia: reglas.texto({ max: 100, etiqueta: "Provincia" }),
  pais: reglas.texto({ max: 100, etiqueta: "País" }),
  notas: reglas.texto({ max: 5000, etiqueta: "Notas" }),
  archivado: reglas.booleano({ porDefecto: false }),
};

const MENSAJES_UNICOS = { "clientes.nif": "Ya existe un cliente con ese NIF." };

const conTraduccion = (fn) => {
  try {
    return fn();
  } catch (error) {
    throw traducirErrorSqlite(error, MENSAJES_UNICOS);
  }
};

export const rutasClientes = ({ bd }) => {
  const repo = crearRepositorioClientes(bd);
  const r = Router();

  r.get("/", (req, res) => {
    const buscar = typeof req.query.buscar === "string" ? req.query.buscar.trim().slice(0, 100) : undefined;
    res.json(repo.listar({ incluirArchivados: req.query.archivados === "1", buscar }));
  });

  r.get("/:id", (req, res) => {
    const cliente = repo.obtener(idDeRuta(req.params.id));
    if (!cliente) throw noEncontrado("El cliente");
    res.json(cliente);
  });

  r.post("/", (req, res) => {
    const datos = validar(ESQUEMA, req.body ?? {});
    if (datos.pais === null) delete datos.pais;
    res.status(201).json(conTraduccion(() => repo.crear(datos)));
  });

  r.patch("/:id", (req, res) => {
    const id = idDeRuta(req.params.id);
    const cambios = validar(ESQUEMA, req.body ?? {}, { parcial: true });
    if ("nombre" in cambios && cambios.nombre === null) delete cambios.nombre;
    const cliente = conTraduccion(() => repo.actualizar(id, cambios));
    if (!cliente) throw noEncontrado("El cliente");
    res.json(cliente);
  });

  return r;
};
