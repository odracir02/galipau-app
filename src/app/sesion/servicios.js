// Session services with a common interface, one per backend:
//   estado()        -> { configurado, autenticado, accesoLocal?, email?, aviso? }
//   configurar()    -> first-run password (local backend only)
//   iniciarSesion({ email?, contrasena })
//   cerrarSesion()
//   suscribir(cb)   -> calls cb when the session may have changed; returns unsubscribe

import { api, ErrorApi, EVENTO_SESION_CADUCADA } from "../../shared/api/cliente";
import { obtenerClienteSupabase } from "../../shared/supabase/cliente";
import { traducirErrorSupabase } from "../../shared/supabase/errores";

const escucharCaducidad = (cb) => {
  window.addEventListener(EVENTO_SESION_CADUCADA, cb);
  return () => window.removeEventListener(EVENTO_SESION_CADUCADA, cb);
};

export const crearSesionLocal = () => ({
  tipo: "local",
  estado: () => api.get("/auth/estado"),
  configurar: (contrasena) => api.post("/auth/configurar", { contrasena }),
  iniciarSesion: ({ contrasena }) => api.post("/auth/login", { contrasena }),
  cerrarSesion: () => api.post("/auth/logout"),
  suscribir: escucharCaducidad,
});

export const MENSAJE_SIN_ACCESO = "Esta cuenta no tiene acceso a Galipau App.";

export const crearSesionSupabase = (obtenerCliente = obtenerClienteSupabase) => ({
  tipo: "supabase",

  async estado() {
    const sb = await obtenerCliente();
    const { data, error } = await sb.auth.getSession();
    if (error) throw traducirErrorSupabase(error);
    const sesion = data?.session;
    if (!sesion) return { configurado: true, autenticado: false };

    // Only the registered owner may use the app (also enforced by RLS)
    const { data: esPropietario, error: errorRpc } = await sb.rpc("es_propietario");
    if (errorRpc) throw traducirErrorSupabase(errorRpc);
    if (esPropietario !== true) {
      await sb.auth.signOut();
      return { configurado: true, autenticado: false, aviso: MENSAJE_SIN_ACCESO };
    }
    return { configurado: true, autenticado: true, email: sesion.user?.email ?? null };
  },

  async configurar() {
    throw new ErrorApi(400, "La cuenta del propietario se crea desde el panel de Supabase.");
  },

  async iniciarSesion({ email, contrasena }) {
    const sb = await obtenerCliente();
    const { error } = await sb.auth.signInWithPassword({ email: String(email ?? "").trim(), password: contrasena });
    if (!error) return;
    if (error.status === 400 || error.code === "invalid_credentials") throw new ErrorApi(401, "Email o contraseña incorrectos.");
    if (error.status === 429) throw new ErrorApi(429, "Demasiados intentos. Espera unos minutos antes de volver a intentarlo.");
    throw traducirErrorSupabase(error);
  },

  async cerrarSesion() {
    const sb = await obtenerCliente();
    await sb.auth.signOut();
  },

  suscribir(cb) {
    let cancelado = false;
    let quitarAuth = () => {};
    obtenerCliente()
      .then((sb) => {
        if (cancelado) return;
        const { data } = sb.auth.onAuthStateChange((evento) => {
          if (evento === "SIGNED_OUT" || evento === "USER_UPDATED") cb();
        });
        quitarAuth = () => data?.subscription?.unsubscribe();
      })
      .catch(() => {});
    const quitarCaducidad = escucharCaducidad(cb);
    return () => {
      cancelado = true;
      quitarAuth();
      quitarCaducidad();
    };
  },
});
