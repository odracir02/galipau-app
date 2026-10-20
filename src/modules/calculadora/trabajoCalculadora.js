// The job being worked on in the cost calculator: kept for the browser tab
// (so leaving and coming back does not lose it) and handed to the quote editor
// through navigation state (never in the URL). Same form structure as quotes.

export const CLAVE_TRABAJO = "galipau.calculadora.trabajo";

const esFormulario = (f) =>
  Boolean(f && typeof f === "object" && Array.isArray(f.lineas) && f.lineas.length > 0 && Array.isArray(f.zonas));

const almacenSesion = () => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export const leerTrabajo = (almacen = almacenSesion()) => {
  try {
    const f = JSON.parse(almacen?.getItem(CLAVE_TRABAJO) ?? "null");
    return esFormulario(f) ? f : null;
  } catch {
    return null;
  }
};

export const guardarTrabajo = (formulario, almacen = almacenSesion()) => {
  try {
    almacen?.setItem(CLAVE_TRABAJO, JSON.stringify(formulario));
  } catch {
    /* storage blocked: the job just isn't remembered */
  }
};

export const olvidarTrabajo = (almacen = almacenSesion()) => {
  try {
    almacen?.removeItem(CLAVE_TRABAJO);
  } catch {
    /* ignore */
  }
};

// A form with nothing typed in yet (only the defaults)
export const trabajoVacio = (f) =>
  f.lineas.every((l) => !l.quantity && !l.proveedor && !l.precioManual) && !String(f.precioFinal ?? "").trim();

/** Navigation state for the quote editor: an independent copy of the form and the parameter version used. */
export const transferenciaAPresupuesto = (formulario, parametrosVersion) => ({
  desdeCalculadora: {
    formulario: JSON.parse(JSON.stringify(formulario)),
    parametrosVersion: parametrosVersion ?? null,
  },
});

/** Form received by the editor, or null when the state is missing or malformed. */
export const formularioTransferido = (estado) => {
  const t = estado?.desdeCalculadora;
  if (!t || !esFormulario(t.formulario)) return null;
  return {
    formulario: {
      ...t.formulario,
      lineas: t.formulario.lineas.map((l) => {
        const copia = { ...l };
        delete copia.precioGuardado; // a new quote takes prices from the catalogue or the manual price
        return copia;
      }),
    },
    parametrosVersion: Number.isInteger(t.parametrosVersion) ? t.parametrosVersion : null,
  };
};

/** Problems to show before leaving the calculator (empty list = complete job). */
export const avisosAntesDeTransferir = ({ problemas = [], erroresEntrada = [], resultado }) =>
  resultado ? [] : [...new Set([...problemas, ...erroresEntrada])];
