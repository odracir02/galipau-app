import { createContext, useContext } from "react";

export const ContextoSesion = createContext(null);

export const useSesion = () => {
  const sesion = useContext(ContextoSesion);
  if (!sesion) throw new Error("useSesion must be used inside <ProveedorSesion>");
  return sesion;
};
