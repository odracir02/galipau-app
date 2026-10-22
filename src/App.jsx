import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import QuoteForm from "./components/QuoteForm";
import BudgetHistory from "./components/BudgetHistory";
import ProveedorSesion from "./app/sesion/ProveedorSesion";
import ProveedorTema from "./app/tema/ProveedorTema";
import ProveedorDialogos from "./shared/ui/ProveedorDialogos";
import Disposicion from "./app/Disposicion";
import GuardaEntorno from "./app/GuardaEntorno";
import PaginaCopias from "./modules/copias/PaginaCopias";
import PaginaCopiasNube from "./modules/copias/PaginaCopiasNube";
import PaginaCalculadoraSerigrafia from "./modules/calculadora/PaginaCalculadoraSerigrafia";
import PaginaParametros from "./modules/calculadora/PaginaParametros";
import PaginaPresupuestos from "./modules/presupuestos/PaginaPresupuestos";
import PaginaEditorPresupuesto from "./modules/presupuestos/PaginaEditorPresupuesto";
import PaginaEmpresa from "./modules/empresa/PaginaEmpresa";
import PaginaMigracion from "./modules/migracion/PaginaMigracion";
import PaginaInicio from "./modules/inicio/PaginaInicio";
import PaginaClientes from "./modules/clientes/PaginaClientes";
import PaginaCatalogo from "./modules/catalogo/PaginaCatalogo";
import PaginaProveedores from "./modules/catalogo/PaginaProveedores";
import PaginaImportarTarifa from "./modules/tarifas/PaginaImportarTarifa";
import PaginaClasificar from "./modules/catalogo/PaginaClasificar";
import PaginaCategorias from "./modules/catalogo/PaginaCategorias";
import { PaginaTarifas, PaginaImportacionTarifa } from "./modules/tarifas/PaginaTarifas";
import PaginaFichaProveedor from "./modules/catalogo/PaginaFichaProveedor";
import PaginaFichaModelo from "./modules/catalogo/PaginaFichaModelo";
import PaginaInventario from "./modules/inventario/PaginaInventario";
import PaginaMovimiento from "./modules/inventario/PaginaMovimiento";
import PaginaArticulo from "./modules/inventario/PaginaArticulo";
import PaginaCargaInicial from "./modules/inventario/PaginaCargaInicial";
import PaginaCompras from "./modules/inventario/PaginaCompras";
import PaginaConfiguracion from "./modules/configuracion/PaginaConfiguracion";
import PaginaApariencia from "./modules/configuracion/PaginaApariencia";
import PaginaCompatibilidad from "./modules/configuracion/PaginaCompatibilidad";
import PaginaProximamente from "./modules/configuracion/PaginaProximamente";
import { backendActivo } from "./app/backend";

// Old addresses keep working
const REDIRECCIONES = { "/parametros": "/configuracion/parametros", "/empresa": "/configuracion/empresa", "/copias": "/configuracion/copias", "/migracion": "/configuracion/migracion" };

function App({ servicioSesion }) {
  const nube = backendActivo() === "supabase";
  return (
    <Router>
      <ProveedorTema>
        <ProveedorSesion servicio={servicioSesion}>
          <ProveedorDialogos>
            <GuardaEntorno nube={nube}>
            <Disposicion nube={nube}>
              <Routes>
                {nube ? (
                  <>
                    <Route path="/" element={<PaginaInicio />} />
                    <Route path="/presupuestos" element={<PaginaPresupuestos />} />
                    <Route path="/presupuestos/nuevo" element={<PaginaEditorPresupuesto />} />
                    <Route path="/presupuestos/:id" element={<PaginaEditorPresupuesto />} />
                    <Route path="/clientes" element={<PaginaClientes />} />
                    <Route path="/catalogo" element={<PaginaCatalogo />} />
                    <Route path="/catalogo/proveedores" element={<PaginaProveedores />} />
                    <Route path="/catalogo/proveedores/:id" element={<PaginaFichaProveedor />} />
                    <Route path="/catalogo/modelos/:id" element={<PaginaFichaModelo />} />
                    <Route path="/catalogo/clasificar" element={<PaginaClasificar />} />
                    <Route path="/catalogo/categorias" element={<PaginaCategorias />} />
                    <Route path="/catalogo/tarifas" element={<PaginaTarifas />} />
                    <Route path="/catalogo/tarifas/importar" element={<PaginaImportarTarifa />} />
                    <Route path="/catalogo/tarifas/:id" element={<PaginaImportacionTarifa />} />
                    <Route path="/pedidos" element={<PaginaProximamente modulo="pedidos" />} />
                    <Route path="/produccion" element={<PaginaProximamente modulo="produccion" />} />
                    <Route path="/inventario" element={<PaginaInventario />} />
                    <Route path="/inventario/movimiento" element={<PaginaMovimiento />} />
                    <Route path="/inventario/articulos/:varianteId" element={<PaginaArticulo />} />
                    <Route path="/inventario/inicial" element={<PaginaCargaInicial />} />
                    <Route path="/inventario/compras" element={<PaginaCompras />} />
                    {/* Temporary compatibility tools (previous form and browser history) */}
                    <Route path="/antiguo" element={<QuoteForm />} />
                  </>
                ) : (
                  <Route path="/" element={<QuoteForm />} />
                )}
                <Route path="/historial" element={<BudgetHistory />} />
                <Route path="/costes" element={<PaginaCalculadoraSerigrafia />} />
                <Route path="/configuracion" element={<PaginaConfiguracion nube={nube} />}>
                  <Route index element={<Navigate to="parametros" replace />} />
                  <Route path="parametros" element={<PaginaParametros />} />
                  <Route path="copias" element={nube ? <PaginaCopiasNube /> : <PaginaCopias />} />
                  <Route path="apariencia" element={<PaginaApariencia />} />
                  {nube && <Route path="empresa" element={<PaginaEmpresa />} />}
                  {nube && <Route path="migracion" element={<PaginaMigracion />} />}
                  {nube && <Route path="compatibilidad" element={<PaginaCompatibilidad />} />}
                </Route>
                {Object.entries(REDIRECCIONES).map(([desde, hasta]) => (
                  <Route key={desde} path={desde} element={<Navigate to={hasta} replace />} />
                ))}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Disposicion>
            </GuardaEntorno>
          </ProveedorDialogos>
        </ProveedorSesion>
      </ProveedorTema>
    </Router>
  );
}

export default App;
