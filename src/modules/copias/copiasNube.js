// Pure helpers for the cloud backups page (status warnings and JSON export).

import { leerTodo } from "../../shared/supabase/paginar";

export const fecha = (iso) => (iso ? new Date(iso).toLocaleString("es-ES") : "—");
export const TIPOS = { base_datos: "Base de datos", archivos: "Archivos" };

export const TABLAS_EXPORTACION = ["configuracion", "contadores", "parametros_calculo", "importaciones", "clientes", "proveedores", "modelos", "variantes", "presupuestos", "stock_articulos", "stock_movimientos", "stock_reservas", "stock_necesidades"];
export const HORAS_AVISO = 48;

export const avisosCopias = (ultimas, ahora = Date.now()) => {
  const avisos = [];
  for (const tipo of Object.keys(TIPOS)) {
    const u = ultimas[tipo];
    if (!u) {
      avisos.push(`${TIPOS[tipo]}: todavía no hay ninguna copia registrada.`);
      continue;
    }
    if (u.estado !== "correcta") avisos.push(`${TIPOS[tipo]}: la última copia falló (${fecha(u.creada_en)}).`);
    else if (tipo === "base_datos" && (ahora - Date.parse(u.creada_en)) / 3600000 > HORAS_AVISO) {
      avisos.push(`${TIPOS[tipo]}: la última copia correcta tiene más de ${HORAS_AVISO} horas.`);
    }
  }
  return avisos;
};

export const exportarDatos = async (sb, ahora = new Date()) => {
  const datos = { aplicacion: "galipau-app", exportadoEn: ahora.toISOString(), tablas: {} };
  for (const tabla of TABLAS_EXPORTACION) {
    datos.tablas[tabla] = await leerTodo((desde, hasta) => sb.from(tabla).select("*").range(desde, hasta));
  }
  return datos;
};

