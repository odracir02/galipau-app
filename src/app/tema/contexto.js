import { createContext, useContext } from "react";

const SIN_PROVEEDOR = {
  tema: "claro", efectivo: "claro", menuContraido: false, cambiarTema: () => {}, alternarTema: () => {}, alternarMenu: () => {},
};

export const ContextoTema = createContext(SIN_PROVEEDOR);
export const useTema = () => useContext(ContextoTema);
