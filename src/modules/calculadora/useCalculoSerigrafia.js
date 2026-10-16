import { useMemo } from "react";
import { construirEntrada } from "./construirEntrada";
import { calcularCosteSerigrafia, validarEntrada } from "../../domain/calculo/serigrafia/motor";

// Live real-cost calculation of a job form with the given parameter values
export const useCalculoSerigrafia = (formulario, productos, valoresParametros) => {
  const base = useMemo(() => construirEntrada({ ...formulario, productos }), [formulario, productos]);
  const erroresEntrada = useMemo(() => validarEntrada(base.entrada), [base]);
  const resultado = useMemo(() => {
    if (!valoresParametros || erroresEntrada.length) return null;
    try {
      return calcularCosteSerigrafia(base.entrada, valoresParametros);
    } catch {
      return null;
    }
  }, [base, erroresEntrada, valoresParametros]);
  return { ...base, erroresEntrada, resultado };
};
