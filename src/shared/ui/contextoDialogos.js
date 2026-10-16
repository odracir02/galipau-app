import { createContext, useContext } from "react";

// Falls back to the browser dialog when there is no provider (e.g. isolated tests)
export const ContextoDialogos = createContext({ confirmar: async ({ mensaje }) => window.confirm(mensaje) });
export const useConfirmar = () => useContext(ContextoDialogos).confirmar;
