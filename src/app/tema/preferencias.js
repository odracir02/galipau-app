// Appearance preferences (theme and collapsed menu), kept in this browser only.
// Light is the default; "sistema" follows the operating system setting.

export const CLAVE_PREFERENCIAS = "galipau.apariencia";
export const TEMAS = { claro: "Claro", oscuro: "Oscuro", sistema: "Según el sistema" };
export const PREFERENCIAS_POR_DEFECTO = Object.freeze({ tema: "claro", menuContraido: false });

export const leerPreferencias = (almacen = globalThis.localStorage) => {
  try {
    const datos = JSON.parse(almacen?.getItem(CLAVE_PREFERENCIAS) ?? "null");
    if (!datos || typeof datos !== "object") return { ...PREFERENCIAS_POR_DEFECTO };
    return {
      tema: datos.tema in TEMAS ? datos.tema : PREFERENCIAS_POR_DEFECTO.tema,
      menuContraido: datos.menuContraido === true,
    };
  } catch {
    return { ...PREFERENCIAS_POR_DEFECTO };
  }
};

export const guardarPreferencias = (preferencias, almacen = globalThis.localStorage) => {
  try {
    almacen?.setItem(CLAVE_PREFERENCIAS, JSON.stringify(preferencias));
  } catch {
    /* private mode or blocked storage: the preference just isn't remembered */
  }
};

export const sistemaOscuro = (ventana = globalThis.window) => {
  try {
    return Boolean(ventana?.matchMedia?.("(prefers-color-scheme: dark)").matches);
  } catch {
    return false;
  }
};

export const temaEfectivo = (tema, ventana) => (tema === "sistema" ? (sistemaOscuro(ventana) ? "oscuro" : "claro") : tema);

// Bootstrap 5.3 colour modes + our own tokens both key off data-bs-theme
export const aplicarTema = (tema, raiz = globalThis.document?.documentElement, ventana) => {
  const efectivo = temaEfectivo(tema, ventana);
  raiz?.setAttribute("data-bs-theme", efectivo === "oscuro" ? "dark" : "light");
  return efectivo;
};
