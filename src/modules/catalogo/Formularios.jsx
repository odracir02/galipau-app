import { useId, useState } from "react";
import { TIPOS_SUGERIDOS, validarModelo, validarProveedor } from "./domain/catalogo";

const CAMPOS_PROVEEDOR = [
  { clave: "nombre", etiqueta: "Nombre *", ancho: "col-md-6" },
  { clave: "contacto", etiqueta: "Persona de contacto", ancho: "col-md-6" },
  { clave: "telefono", etiqueta: "Teléfono", ancho: "col-md-4" },
  { clave: "email", etiqueta: "Email", ancho: "col-md-4", tipo: "email" },
  { clave: "web", etiqueta: "Web", ancho: "col-md-4" },
  { clave: "nif", etiqueta: "NIF", ancho: "col-md-4" },
  { clave: "referencia_cliente", etiqueta: "Nuestro nº de cliente", ancho: "col-md-4" },
  { clave: "notas", etiqueta: "Notas", ancho: "col-md-12" },
];
const CAMPOS_MODELO = [
  { clave: "nombre", etiqueta: "Nombre del modelo *", ancho: "col-md-5" },
  { clave: "tipo", etiqueta: "Tipo de artículo *", ancho: "col-md-3", lista: "tipos-articulo" },
  { clave: "referencia", etiqueta: "Referencia del fabricante", ancho: "col-md-4" },
  { clave: "descripcion", etiqueta: "Descripción", ancho: "col-md-12" },
];

// Generic inline form with validation and a save/cancel pair
function Formulario({ titulo, campos, inicial, validar, onGuardar, onCancelar, textoGuardar = "Guardar" }) {
  const [datos, setDatos] = useState(() => Object.fromEntries(campos.map((c) => [c.clave, inicial?.[c.clave] ?? ""])));
  const [errores, setErrores] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const uid = useId();
  const guardar = async (e) => {
    e.preventDefault();
    const fallos = validar(datos);
    setErrores(fallos);
    if (fallos.length) return;
    setOcupado(true);
    try {
      await onGuardar(datos);
    } catch (error) {
      setErrores([error.message]);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="gx-tarjeta mb-3" onSubmit={guardar} aria-label={titulo} noValidate>
      <h2 className="h6 mb-3">{titulo}</h2>
      <div className="row g-2">
        {campos.map((c) => (
          <div key={c.clave} className={c.ancho}>
            <label className="form-label small mb-0" htmlFor={`${uid}-${c.clave}`}>{c.etiqueta}</label>
            <input id={`${uid}-${c.clave}`} type={c.tipo ?? "text"} list={c.lista} className="form-control form-control-sm" value={datos[c.clave]}
              onChange={(e) => setDatos((d) => ({ ...d, [c.clave]: e.target.value }))} />
          </div>
        ))}
      </div>
      <datalist id="tipos-articulo">{TIPOS_SUGERIDOS.map((t) => <option key={t} value={t} />)}</datalist>
      {errores.length > 0 && <div className="alert alert-danger small py-2 mt-2 mb-0" role="alert">{errores.join(" ")}</div>}
      <div className="d-flex gap-2 mt-3">
        <button type="submit" className="btn btn-sm btn-primary" disabled={ocupado}>{textoGuardar}</button>
        {onCancelar && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}

export const FormularioProveedor = (props) => <Formulario campos={CAMPOS_PROVEEDOR} validar={validarProveedor} {...props} />;
export const FormularioModelo = (props) => <Formulario campos={CAMPOS_MODELO} validar={validarModelo} {...props} />;
