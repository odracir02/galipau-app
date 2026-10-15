// Backups using SQLite's online backup API (consistent while the app runs).
// Every backup is verified (integrity_check + foreign_key_check) before being
// accepted. An optional external folder (e.g. OneDrive) receives a copy of each
// finished backup; the live database is never placed in a synced folder.

import fs from "node:fs";
import path from "node:path";
import { abrirConexion } from "../../db/baseDatos.js";
import { migrar, ultimaVersion } from "../../db/migrar.js";
import { ErrorApi } from "../../http/errores.js";

export const MOTIVOS = ["automatica", "manual", "migracion", "restauracion"];
const PATRON_ARCHIVO = /^galipau-(\d{8})-(\d{6})-(\d{3})-(automatica|manual|migracion|restauracion)\.db$/;
const CLAVE_DESTINO = "copias.destinoExterno";

const dos = (n, l = 2) => String(n).padStart(l, "0");
export const nombreCopia = (fecha, motivo) =>
  `galipau-${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}-` +
  `${dos(fecha.getHours())}${dos(fecha.getMinutes())}${dos(fecha.getSeconds())}-${dos(fecha.getMilliseconds(), 3)}-${motivo}.db`;

export const leerNombreCopia = (nombre) => {
  const m = PATRON_ARCHIVO.exec(nombre);
  if (!m) return null;
  const [, d, h, ms, motivo] = m;
  const fecha = new Date(
    Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)),
    Number(h.slice(0, 2)), Number(h.slice(2, 4)), Number(h.slice(4, 6)), Number(ms)
  );
  return { nombre, fecha, motivo };
};

// Keeps the newest `diarias` backups plus the newest backup of each of the last
// `mensuales` months. Returns the names that can be deleted.
export const seleccionarParaBorrar = (nombres, { diarias = 30, mensuales = 12 } = {}) => {
  const copias = nombres.map(leerNombreCopia).filter(Boolean).sort((a, b) => b.fecha - a.fecha);
  const conservar = new Set(copias.slice(0, diarias).map((c) => c.nombre));
  const meses = new Set();
  for (const c of copias) {
    const mes = `${c.fecha.getFullYear()}-${c.fecha.getMonth()}`;
    if (!meses.has(mes) && meses.size < mensuales) {
      meses.add(mes);
      conservar.add(c.nombre);
    }
  }
  return copias.filter((c) => !conservar.has(c.nombre)).map((c) => c.nombre);
};

export const verificarArchivo = (ruta) => {
  let db;
  try {
    db = abrirConexion(ruta, { soloLectura: true });
    const integridad = db.pragma("integrity_check", { simple: true });
    const clavesForaneas = db.pragma("foreign_key_check");
    const versionEsquema = db.pragma("user_version", { simple: true });
    if (integridad !== "ok") return { ok: false, versionEsquema, error: `integrity_check: ${integridad}` };
    if (clavesForaneas.length > 0) return { ok: false, versionEsquema, error: "foreign_key_check failed" };
    return { ok: true, versionEsquema };
  } catch (error) {
    return { ok: false, versionEsquema: null, error: error.message };
  } finally {
    db?.close();
  }
};

const copiarSeguro = (origen, destino) => {
  const temporal = `${destino}.parcial`;
  fs.copyFileSync(origen, temporal);
  if (fs.statSync(temporal).size !== fs.statSync(origen).size) throw new Error("Copied file size mismatch");
  fs.renameSync(temporal, destino);
};

export const crearServicioCopias = ({ bd, config, logger, ahora = () => new Date() }) => {
  let enCurso = null;
  let temporizador = null;

  const carpetaLocal = config.carpetaCopias;
  const db = () => bd.conexion;

  const leerDestinoExterno = () => {
    try {
      const fila = db().prepare("select valor from configuracion where clave = ?").get(CLAVE_DESTINO);
      return fila ? JSON.parse(fila.valor) : null;
    } catch {
      return null; // table not created yet (before the first migration)
    }
  };

  const registrar = (datos) => {
    try {
      db()
        .prepare(
          `insert into registro_copias (archivo, motivo, creada_en, tamano_bytes, version_esquema, integridad_ok, copia_externa, error)
           values (@archivo, @motivo, @creadaEn, @tamanoBytes, @versionEsquema, @integridadOk, @copiaExterna, @error)`
        )
        .run(datos);
    } catch (e) {
      logger?.warn?.("Could not record backup in log", e.message);
    }
  };

  const listarNombres = (carpeta) => (fs.existsSync(carpeta) ? fs.readdirSync(carpeta).filter((n) => PATRON_ARCHIVO.test(n)) : []);

  const rotar = (carpeta) => {
    for (const nombre of seleccionarParaBorrar(listarNombres(carpeta))) {
      fs.rmSync(path.join(carpeta, nombre), { force: true });
    }
  };

  const ejecutarCopia = async (motivo) => {
    if (!MOTIVOS.includes(motivo)) throw new Error(`Invalid backup reason: ${motivo}`);
    fs.mkdirSync(carpetaLocal, { recursive: true });
    const fecha = ahora();
    const archivo = nombreCopia(fecha, motivo);
    const destino = path.join(carpetaLocal, archivo);
    const temporal = `${destino}.parcial`;
    const base = { archivo, motivo, creadaEn: fecha.toISOString(), tamanoBytes: null, versionEsquema: null, copiaExterna: null, error: null };

    try {
      await db().backup(temporal);
      // Self-contained single file: no -wal/-shm companions to lose when copied
      const copia = abrirConexion(temporal);
      copia.pragma("journal_mode = DELETE");
      copia.close();
      const verificacion = verificarArchivo(temporal);
      if (!verificacion.ok) throw new Error(`Backup verification failed: ${verificacion.error}`);
      fs.renameSync(temporal, destino);
      base.tamanoBytes = fs.statSync(destino).size;
      base.versionEsquema = verificacion.versionEsquema;
    } catch (error) {
      fs.rmSync(temporal, { force: true });
      registrar({ ...base, integridadOk: 0, error: error.message });
      logger?.error?.("Backup failed", error);
      throw error;
    }

    // Off-site copy of the finished backup (optional)
    const externo = leerDestinoExterno();
    if (externo) {
      try {
        copiarSeguro(destino, path.join(externo, archivo));
        base.copiaExterna = externo;
        rotar(externo);
      } catch (error) {
        base.error = `Copia externa fallida: ${error.message}`;
        logger?.warn?.("External backup copy failed", error.message);
      }
    }

    rotar(carpetaLocal);
    registrar({ ...base, integridadOk: 1 });
    logger?.info?.(`Backup created: ${archivo}`);
    return { ...base, integridadOk: true };
  };

  const servicio = {
    carpetaLocal,

    // Only one backup at a time; concurrent callers share the running one
    crear(motivo = "manual") {
      if (!enCurso) enCurso = ejecutarCopia(motivo).finally(() => (enCurso = null));
      return enCurso;
    },

    listar() {
      return listarNombres(carpetaLocal)
        .map((nombre) => ({ ...leerNombreCopia(nombre), tamanoBytes: fs.statSync(path.join(carpetaLocal, nombre)).size }))
        .sort((a, b) => b.fecha - a.fecha)
        .map((c) => ({ archivo: c.nombre, fecha: c.fecha.toISOString(), motivo: c.motivo, tamanoBytes: c.tamanoBytes }));
    },

    rutaDe(archivo) {
      if (typeof archivo !== "string" || !PATRON_ARCHIVO.test(archivo)) throw new ErrorApi(400, "Nombre de copia no válido.");
      const ruta = path.join(carpetaLocal, archivo);
      if (!fs.existsSync(ruta)) throw new ErrorApi(404, "La copia no existe.");
      return ruta;
    },

    ultima() {
      try {
        return db()
          .prepare(
            `select archivo, motivo, creada_en as creadaEn, tamano_bytes as tamanoBytes, version_esquema as versionEsquema,
                    integridad_ok as integridadOk, copia_externa as copiaExterna, error
             from registro_copias order by id desc limit 1`
          )
          .get() ?? null;
      } catch {
        return null;
      }
    },

    ultimaCorrecta() {
      try {
        return db().prepare("select creada_en as creadaEn from registro_copias where integridad_ok = 1 order by id desc limit 1").get() ?? null;
      } catch {
        return null;
      }
    },

    estado() {
      const ultima = servicio.ultima();
      const correcta = servicio.ultimaCorrecta();
      const destinoExterno = leerDestinoExterno();
      const horas = correcta ? (ahora() - new Date(correcta.creadaEn)) / 3600000 : null;
      const avisos = [];
      if (!destinoExterno) {
        avisos.push(
          "Las copias solo se guardan en este PC. No protegen frente a averías, robo o pérdida del equipo: configura una carpeta externa (OneDrive, disco USB…)."
        );
      }
      if (horas === null) avisos.push("Todavía no se ha hecho ninguna copia de seguridad.");
      else if (horas > config.horasEntreCopias * 2) avisos.push(`La última copia correcta tiene más de ${Math.floor(horas)} horas.`);
      if (ultima && !ultima.integridadOk) avisos.push(`La última copia falló: ${ultima.error}`);
      else if (ultima?.error) avisos.push(ultima.error);

      return {
        ultima: ultima ? { ...ultima, integridadOk: ultima.integridadOk === 1 } : null,
        horasDesdeUltimaCorrecta: horas === null ? null : Math.round(horas * 10) / 10,
        carpetaLocal,
        destinoExterno,
        oneDriveDetectado: config.oneDriveDetectado,
        horasEntreCopias: config.horasEntreCopias,
        totalCopias: listarNombres(carpetaLocal).length,
        avisos,
      };
    },

    configurarDestinoExterno(ruta) {
      if (ruta === null || ruta === "") {
        db().prepare("delete from configuracion where clave = ?").run(CLAVE_DESTINO);
        return null;
      }
      if (typeof ruta !== "string" || !path.isAbsolute(ruta)) {
        throw new ErrorApi(400, "Indica una ruta absoluta de carpeta.", { campo: "destinoExterno" });
      }
      const destino = path.resolve(ruta);
      if (destino.startsWith(path.resolve(config.carpetaDatos))) {
        throw new ErrorApi(400, "La carpeta externa no puede estar dentro de la carpeta de datos.", { campo: "destinoExterno" });
      }
      try {
        fs.mkdirSync(destino, { recursive: true });
        const prueba = path.join(destino, ".galipau-prueba-escritura");
        fs.writeFileSync(prueba, "ok");
        fs.rmSync(prueba);
      } catch (error) {
        throw new ErrorApi(400, `No se puede escribir en esa carpeta: ${error.message}`, { campo: "destinoExterno" });
      }
      db()
        .prepare("insert into configuracion (clave, valor) values (?, ?) on conflict (clave) do update set valor = excluded.valor")
        .run(CLAVE_DESTINO, JSON.stringify(destino));
      return destino;
    },

    // Controlled restore: verify the backup, take a safety backup of the current
    // data, swap the file, reopen and migrate if the backup is older.
    async restaurar(archivo) {
      const ruta = servicio.rutaDe(archivo);
      const verificacion = verificarArchivo(ruta);
      if (!verificacion.ok) throw new ErrorApi(400, `La copia está dañada y no se puede restaurar (${verificacion.error}).`);
      if (verificacion.versionEsquema > ultimaVersion()) {
        throw new ErrorApi(409, "La copia es de una versión más reciente de la aplicación. Actualiza la aplicación antes de restaurarla.");
      }
      const seguridad = await servicio.crear("restauracion");
      bd.reemplazarCon(ruta);
      await migrar(bd, { logger });
      registrar({ ...seguridad, integridadOk: 1, error: `Copia de seguridad previa a restaurar ${archivo}` });
      logger?.info?.(`Database restored from ${archivo}`);
      return { restaurada: archivo, copiaPrevia: seguridad.archivo };
    },

    async comprobarProgramada() {
      const correcta = servicio.ultimaCorrecta();
      const horas = correcta ? (ahora() - new Date(correcta.creadaEn)) / 3600000 : Infinity;
      if (horas >= config.horasEntreCopias) {
        try {
          await servicio.crear("automatica");
        } catch {
          // already logged and recorded
        }
      }
    },

    programar({ intervaloMs = 60 * 60 * 1000 } = {}) {
      servicio.detener();
      temporizador = setInterval(() => servicio.comprobarProgramada(), intervaloMs);
      temporizador.unref?.();
      return servicio.comprobarProgramada();
    },

    detener() {
      if (temporizador) clearInterval(temporizador);
      temporizador = null;
    },

    esperar: () => enCurso ?? Promise.resolve(),
  };

  return servicio;
};
