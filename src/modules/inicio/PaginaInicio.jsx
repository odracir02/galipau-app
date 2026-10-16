import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Calculator, CheckCircle2, Clock, FilePlus2, FileText, Hammer, Wallet } from "lucide-react";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { desenvolver } from "../../shared/supabase/errores";
import { listarPresupuestos } from "../presupuestos/data/presupuestosRepo";
import { resumenPresupuestos } from "../presupuestos/domain/resumen";
import { avisosCopias } from "../copias/copiasNube";
import { euros } from "../../shared/utils/dinero";
import Cabecera from "../../shared/ui/Cabecera";
import Cargando from "../../shared/ui/Cargando";
import Aviso from "../../shared/ui/Aviso";
import EstadoVacio from "../../shared/ui/EstadoVacio";
import InsigniaEstado from "../presupuestos/InsigniaEstado";

function Kpi({ icono: Icono, etiqueta, valor, detalle, to, testid }) {
  const contenido = (
    <div className="gx-kpi">
      <div className="gx-kpi-etiqueta"><Icono size={16} aria-hidden="true" />{etiqueta}</div>
      <div className="gx-kpi-valor" data-testid={testid}>{valor}</div>
      {detalle && <div className="gx-kpi-detalle">{detalle}</div>}
    </div>
  );
  return to ? <Link to={to} className="text-reset text-decoration-none d-block h-100">{contenido}</Link> : contenido;
}

/** Home: the state of the workshop at a glance, from real data only. */
function PaginaInicio({ obtenerCliente = obtenerClienteSupabase }) {
  const [datos, setDatos] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const sb = await obtenerCliente();
        setDatos(resumenPresupuestos(await listarPresupuestos(sb, { limite: 1000 })));
        try {
          const filas = desenvolver(await sb.from("registro_copias").select("tipo, estado, creada_en").order("creada_en", { ascending: false }).limit(20)) ?? [];
          const ultimas = {};
          for (const f of filas) ultimas[f.tipo] ??= f;
          setAvisos(avisosCopias(ultimas));
        } catch {
          /* the backup status is secondary on this page */
        }
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [obtenerCliente]);

  const acciones = (
    <>
      <Link to="/costes" className="btn btn-outline-secondary btn-icono"><Calculator size={16} aria-hidden="true" />Calcular un coste</Link>
      <Link to="/presupuestos/nuevo" className="btn btn-primary btn-icono"><FilePlus2 size={16} aria-hidden="true" />Nuevo presupuesto</Link>
    </>
  );

  return (
    <>
      <Cabecera titulo="Inicio" descripcion="Resumen del taller" acciones={acciones} />
      {error && <Aviso tipo="danger">{error}</Aviso>}
      {avisos.length > 0 && (
        <Aviso tipo="warning">
          {avisos.join(" ")} <Link to="/configuracion/copias">Ver copias de seguridad</Link>
        </Aviso>
      )}
      {!datos && !error && <Cargando texto="Cargando resumen…" />}
      {datos && (
        <>
          <div className="row g-3 mb-4">
            <div className="col-sm-6 col-xl-3">
              <Kpi icono={Clock} etiqueta="Pendientes de respuesta" valor={datos.presentados.cantidad}
                detalle={`${euros(datos.presentados.importeCent)} presentados`} to="/presupuestos" testid="kpi-presentados" />
            </div>
            <div className="col-sm-6 col-xl-3">
              <Kpi icono={Hammer} etiqueta="Trabajos en marcha" valor={datos.enMarcha.cantidad}
                detalle={`${euros(datos.enMarcha.importeCent)} aceptados o en producción`} to="/presupuestos" testid="kpi-en-marcha" />
            </div>
            <div className="col-sm-6 col-xl-3">
              <Kpi icono={Wallet} etiqueta="Pendiente de cobro" valor={euros(datos.porCobrar.importeCent)}
                detalle={`${datos.porCobrar.cantidad} trabajo(s) finalizado(s)`} to="/presupuestos" testid="kpi-por-cobrar" />
            </div>
            <div className="col-sm-6 col-xl-3">
              <Kpi icono={CheckCircle2} etiqueta={`Confirmado en ${datos.anio}`} valor={euros(datos.confirmadoAnio.importeCent)}
                detalle={`Beneficio previsto ${euros(datos.confirmadoAnio.beneficioCent)} · cobrado ${euros(datos.cobradoAnioCent)}`} testid="kpi-confirmado" />
            </div>
          </div>

          <section className="gx-tabla">
            <div className="d-flex align-items-center px-3 pt-3 pb-2">
              <h2 className="h6 mb-0">Actividad reciente</h2>
              <Link to="/presupuestos" className="ms-auto small">Ver todos</Link>
            </div>
            {datos.recientes.length === 0 ? (
              <EstadoVacio icono={FileText} titulo="Aún no hay presupuestos"
                accion={<Link to="/presupuestos/nuevo" className="btn btn-primary">Crear el primero</Link>}>
                Los presupuestos que crees aparecerán aquí.
              </EstadoVacio>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead><tr><th>Número</th><th>Cliente</th><th className="d-none d-sm-table-cell">Estado</th><th className="text-end">Total</th></tr></thead>
                  <tbody>
                    {datos.recientes.map((p) => (
                      <tr key={p.id}>
                        <td><Link to={`/presupuestos/${p.id}`}>{p.numero ?? "Borrador"}</Link></td>
                        <td>{p.cliente_nombre}<div className="d-sm-none mt-1"><InsigniaEstado estado={p.estado} /></div></td>
                        <td className="d-none d-sm-table-cell"><InsigniaEstado estado={p.estado} /></td>
                        <td className="text-end">{euros(Number(p.total_cent))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default PaginaInicio;
