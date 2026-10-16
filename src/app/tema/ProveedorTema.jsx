import { useCallback, useEffect, useMemo, useState } from "react";
import { ContextoTema } from "./contexto";
import { aplicarTema, guardarPreferencias, leerPreferencias } from "./preferencias";

/** Theme and menu preferences for the whole app, applied to <html data-bs-theme>. */
function ProveedorTema({ children }) {
  const [preferencias, setPreferencias] = useState(leerPreferencias);
  const [efectivo, setEfectivo] = useState(() => aplicarTema(preferencias.tema));

  useEffect(() => {
    setEfectivo(aplicarTema(preferencias.tema));
    guardarPreferencias(preferencias);
    if (preferencias.tema !== "sistema" || !window.matchMedia) return undefined;
    const consulta = window.matchMedia("(prefers-color-scheme: dark)");
    const cambio = () => setEfectivo(aplicarTema("sistema"));
    consulta.addEventListener?.("change", cambio);
    return () => consulta.removeEventListener?.("change", cambio);
  }, [preferencias]);

  const cambiarTema = useCallback((tema) => setPreferencias((p) => ({ ...p, tema })), []);
  const alternarTema = useCallback(() => setPreferencias((p) => ({ ...p, tema: efectivo === "oscuro" ? "claro" : "oscuro" })), [efectivo]);
  const alternarMenu = useCallback(() => setPreferencias((p) => ({ ...p, menuContraido: !p.menuContraido })), []);

  const valor = useMemo(
    () => ({ tema: preferencias.tema, efectivo, menuContraido: preferencias.menuContraido, cambiarTema, alternarTema, alternarMenu }),
    [preferencias, efectivo, cambiarTema, alternarTema, alternarMenu]
  );
  return <ContextoTema.Provider value={valor}>{children}</ContextoTema.Provider>;
}

export default ProveedorTema;
