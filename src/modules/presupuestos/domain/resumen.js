// Dashboard figures from the quote list (only real data, nothing estimated).

const EN_MARCHA = new Set(["aceptado", "en_produccion"]);
const CONFIRMADOS = new Set(["aceptado", "en_produccion", "finalizado", "cobrado"]);

const sumar = (lista) => lista.reduce((s, p) => s + Number(p.total_cent ?? 0), 0);

export const resumenPresupuestos = (presupuestos, hoy = new Date()) => {
  const anio = String(hoy.getFullYear());
  const vivos = presupuestos.filter((p) => p.estado !== "importado");
  const delAnio = vivos.filter((p) => String(p.fecha_emision ?? "").startsWith(anio));
  const por = (filtro) => vivos.filter(filtro);
  const presentados = por((p) => p.estado === "presentado");
  const enMarcha = por((p) => EN_MARCHA.has(p.estado));
  const porCobrar = por((p) => p.estado === "finalizado");
  const confirmadosAnio = delAnio.filter((p) => CONFIRMADOS.has(p.estado));
  return {
    anio,
    borradores: por((p) => p.estado === "borrador").length,
    presentados: { cantidad: presentados.length, importeCent: sumar(presentados) },
    enMarcha: { cantidad: enMarcha.length, importeCent: sumar(enMarcha) },
    porCobrar: { cantidad: porCobrar.length, importeCent: sumar(porCobrar) },
    cobradoAnioCent: sumar(delAnio.filter((p) => p.estado === "cobrado")),
    confirmadoAnio: {
      cantidad: confirmadosAnio.length,
      importeCent: sumar(confirmadosAnio),
      beneficioCent: confirmadosAnio.reduce((s, p) => s + Number(p.beneficio_cent ?? 0), 0),
    },
    recientes: [...vivos]
      .sort((a, b) => String(b.actualizado_en ?? b.creado_en).localeCompare(String(a.actualizado_en ?? a.creado_en)))
      .slice(0, 6),
  };
};
