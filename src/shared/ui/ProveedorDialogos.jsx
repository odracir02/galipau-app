import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContextoDialogos } from "./contextoDialogos";

/**
 * Accessible confirmation dialogs: `await confirmar({ titulo, mensaje, aceptar, peligro })`
 * resolves to true or false. Escape cancels; focus starts on the safe option.
 */
function ProveedorDialogos({ children }) {
  const [dialogo, setDialogo] = useState(null);
  const cancelarRef = useRef(null);

  const pendiente = useRef(null);

  const confirmar = useCallback(
    (opciones) =>
      new Promise((resolver) => {
        pendiente.current?.(false); // a new dialog replaces (cancels) an open one
        pendiente.current = resolver;
        setDialogo({ aceptar: "Aceptar", cancelar: "Cancelar", ...opciones });
      }),
    []
  );
  const cerrar = useCallback((resultado) => {
    pendiente.current?.(resultado);
    pendiente.current = null;
    setDialogo(null);
  }, []);

  useEffect(() => {
    if (!dialogo) return undefined;
    cancelarRef.current?.focus();
    const tecla = (e) => e.key === "Escape" && cerrar(false);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [dialogo, cerrar]);

  const valor = useMemo(() => ({ confirmar }), [confirmar]);
  return (
    <ContextoDialogos.Provider value={valor}>
      {children}
      {dialogo && (
        <div className="gx-dialogo-velo" onMouseDown={(e) => e.target === e.currentTarget && cerrar(false)}>
          <div className="gx-dialogo" role="alertdialog" aria-modal="true" aria-labelledby="gx-dialogo-titulo" aria-describedby="gx-dialogo-mensaje">
            <h2 id="gx-dialogo-titulo">{dialogo.titulo}</h2>
            <p id="gx-dialogo-mensaje">{dialogo.mensaje}</p>
            <div className="d-flex justify-content-end gap-2">
              <button ref={cancelarRef} type="button" className="btn btn-outline-secondary" onClick={() => cerrar(false)}>{dialogo.cancelar}</button>
              <button type="button" className={`btn ${dialogo.peligro ? "btn-danger" : "btn-primary"}`} onClick={() => cerrar(true)}>{dialogo.aceptar}</button>
            </div>
          </div>
        </div>
      )}
    </ContextoDialogos.Provider>
  );
}

export default ProveedorDialogos;
