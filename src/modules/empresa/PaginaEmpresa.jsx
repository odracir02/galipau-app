import { useEffect, useState } from "react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { cargarEmpresa, guardarEmpresa, subirLogo, EMPRESA_POR_DEFECTO } from "./empresaRepo";
import { CONDICIONES_POR_DEFECTO, IDIOMAS } from "../presupuestos/domain/documento";

const CAMPOS = [
  { clave: "nombre", etiqueta: "Nombre comercial" },
  { clave: "titular", etiqueta: "Titular" },
  { clave: "nif", etiqueta: "NIF" },
  { clave: "direccion", etiqueta: "Dirección" },
  { clave: "localidad", etiqueta: "Código postal y población" },
  { clave: "telefono", etiqueta: "Teléfono" },
  { clave: "email", etiqueta: "Email" },
  { clave: "web", etiqueta: "Web" },
  { clave: "eslogan", etiqueta: "Pie del documento (p. ej. «Galipau Arts · Dissenyat a …»)" },
];

const aFormulario = (e) => ({
  ...Object.fromEntries(CAMPOS.map(({ clave }) => [clave, e[clave] ?? ""])),
  idiomaPorDefecto: e.idiomaPorDefecto ?? "va",
  validezDias: String(e.validezDias ?? ""),
  condiciones_es: (e.condiciones?.es ?? []).join("\n"),
  condiciones_va: (e.condiciones?.va ?? []).join("\n"),
});

const lineas = (texto) => texto.split("\n").map((l) => l.trim()).filter(Boolean);

/** Business data and defaults for the customer PDF. Stored only in Supabase. */
function PaginaEmpresa({ obtenerCliente = obtenerClienteSupabase }) {
  const [empresa, setEmpresa] = useState(null);
  const [form, setForm] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const e = await cargarEmpresa(await obtenerCliente());
        setEmpresa(e);
        setForm(aFormulario(e));
      } catch (e) {
        setMensaje({ tipo: "danger", texto: e.message });
      }
    })();
  }, [obtenerCliente]);

  if (!form) return <div className="container mt-4">{mensaje ? <div className="alert alert-danger" role="alert">{mensaje.texto}</div> : <div role="status">Cargando…</div>}</div>;

  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async () => {
    const dias = form.validezDias.trim() === "" ? null : Number(form.validezDias);
    if (dias !== null && !(Number.isInteger(dias) && dias > 0 && dias <= 365)) {
      setMensaje({ tipo: "danger", texto: "La validez debe ser un número entero de días (1 a 365) o quedar vacía." });
      return;
    }
    const valores = {
      ...Object.fromEntries(CAMPOS.map(({ clave }) => [clave, form[clave].trim()])),
      nombre: form.nombre.trim() || EMPRESA_POR_DEFECTO.nombre,
      idiomaPorDefecto: form.idiomaPorDefecto,
      validezDias: dias,
      condiciones: { es: lineas(form.condiciones_es), va: lineas(form.condiciones_va) },
      logo: empresa.logo ?? null,
    };
    try {
      const guardado = await guardarEmpresa(await obtenerCliente(), valores);
      setEmpresa({ ...empresa, ...guardado });
      setMensaje({ tipo: "success", texto: "Datos guardados. Se usarán en los próximos PDF." });
    } catch (e) {
      setMensaje({ tipo: "danger", texto: e.message });
    }
  };

  const cambiarLogo = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    try {
      const sb = await obtenerCliente();
      const logo = await subirLogo(sb, archivo);
      const guardado = await guardarEmpresa(sb, { ...empresa, logo });
      setEmpresa({ ...empresa, ...guardado });
      setMensaje({ tipo: "success", texto: "Logo guardado." });
    } catch (error) {
      setMensaje({ tipo: "danger", texto: error.message });
    }
  };

  return (
    <div className="container mt-4" style={{ maxWidth: 900 }}>
      <h2>Empresa y PDF</h2>
      <p className="text-muted">Datos que aparecen en los presupuestos en PDF. Se guardan en tu base de datos privada, no en el código de la aplicación.</p>
      {mensaje && <div className={`alert alert-${mensaje.tipo} py-2`} role={mensaje.tipo === "danger" ? "alert" : "status"}>{mensaje.texto}</div>}

      <div className="row g-2">
        {CAMPOS.map((c) => (
          <div key={c.clave} className={c.clave === "eslogan" || c.clave === "direccion" ? "col-md-12" : "col-md-6"}>
            <label className="form-label small mb-0" htmlFor={`empresa-${c.clave}`}>{c.etiqueta}</label>
            <input id={`empresa-${c.clave}`} className="form-control form-control-sm" value={form[c.clave]} onChange={cambiar(c.clave)} />
          </div>
        ))}
        <div className="col-md-6">
          <label className="form-label small mb-0" htmlFor="empresa-idioma">Idioma por defecto del PDF</label>
          <select id="empresa-idioma" className="form-select form-select-sm" value={form.idiomaPorDefecto} onChange={cambiar("idiomaPorDefecto")}>
            {Object.entries(IDIOMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label small mb-0" htmlFor="empresa-validez">Validez por defecto del presupuesto (días, opcional)</label>
          <input id="empresa-validez" className="form-control form-control-sm" inputMode="numeric" value={form.validezDias} onChange={cambiar("validezDias")} />
        </div>
        {["va", "es"].map((idioma) => (
          <div key={idioma} className="col-12">
            <label className="form-label small mb-0" htmlFor={`empresa-condiciones-${idioma}`}>Condiciones por defecto en {IDIOMAS[idioma].toLowerCase()} (una por línea)</label>
            <textarea id={`empresa-condiciones-${idioma}`} rows={4} className="form-control form-control-sm" value={form[`condiciones_${idioma}`]} onChange={cambiar(`condiciones_${idioma}`)} />
            <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setForm((f) => ({ ...f, [`condiciones_${idioma}`]: CONDICIONES_POR_DEFECTO[idioma].join("\n") }))}>
              Restablecer las del Excel
            </button>
          </div>
        ))}
      </div>
      <div className="form-text mb-2">No añadas textos fiscales (como exenciones de IVA) sin haber confirmado antes su fundamento legal.</div>
      <button type="button" className="btn btn-primary" onClick={guardar}>Guardar datos</button>

      <hr />
      <h5>Logo</h5>
      <p className="small text-muted mb-1">{empresa.logo ? "Hay un logo guardado (se imprime arriba a la izquierda)." : "Sin logo: el PDF muestra el nombre comercial."} PNG o JPG, máximo 2 MB.</p>
      <label className="form-label small" htmlFor="empresa-logo">Subir logo</label>
      <input id="empresa-logo" type="file" accept="image/png,image/jpeg" className="form-control form-control-sm" style={{ maxWidth: 400 }} onChange={cambiarLogo} />
    </div>
  );
}

export default PaginaEmpresa;
