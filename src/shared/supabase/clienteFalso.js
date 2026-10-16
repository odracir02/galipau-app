// Test double of the supabase-js client (tests only, never imported by the app).
// Tables are plain arrays. Queries are evaluated when awaited and support
// select/insert/update/upsert/delete with eq/neq/in/ilike/gte/lte filters,
// order/range/limit and single/maybeSingle. `disparadores` emulate database
// triggers: { tabla: { alInsertar(fila), alActualizar(antes, despues) } }, which
// may return the row to store or { error } to reject the write.

export const crearClienteFalso = ({
  tablas = {}, usuarios = [], propietario = null, sesionInicial = null, fallos = {}, rpcs = {}, disparadores = {}, archivos = {},
} = {}) => {
  let sesion = sesionInicial;
  const oyentes = new Set();
  const llamadas = [];
  const emitir = (evento) => oyentes.forEach((cb) => cb(evento, sesion));

  const consulta = (tabla) => {
    let operacion = "select";
    let datos = null;
    let opcionesUpsert = {};
    const filtros = [];
    const despues = [];
    let modo = "lista";
    let devolver = false;

    const filtro = (fn) => {
      filtros.push(fn);
      return q;
    };
    const q = {
      select: () => {
        devolver = true;
        return q;
      },
      insert: (filas) => {
        operacion = "insert";
        datos = filas;
        return q;
      },
      update: (cambios) => {
        operacion = "update";
        datos = cambios;
        return q;
      },
      upsert: (filas, opciones = {}) => {
        operacion = "upsert";
        datos = filas;
        opcionesUpsert = opciones;
        return q;
      },
      delete: () => {
        operacion = "delete";
        return q;
      },
      eq: (col, valor) => filtro((f) => f[col] === valor),
      neq: (col, valor) => filtro((f) => f[col] !== valor),
      in: (col, valores) => filtro((f) => valores.includes(f[col])),
      gte: (col, valor) => filtro((f) => f[col] >= valor),
      lte: (col, valor) => filtro((f) => f[col] <= valor),
      ilike: (col, patron) => {
        const re = new RegExp(`^${patron.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
        return filtro((f) => re.test(String(f[col] ?? "")));
      },
      order: (col, { ascending = true } = {}) => {
        despues.push((filas) => [...filas].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1)));
        return q;
      },
      limit: (n) => {
        despues.push((filas) => filas.slice(0, n));
        return q;
      },
      range: (desde, hasta) => {
        llamadas.push(`${tabla}:${desde}-${hasta}`);
        despues.push((filas) => filas.slice(desde, hasta + 1));
        return q;
      },
      single: () => {
        modo = "single";
        return q;
      },
      maybeSingle: () => {
        modo = "maybeSingle";
        return q;
      },
      then: (resolver, rechazar) => Promise.resolve(ejecutar()).then(resolver, rechazar),
    };

    const ejecutar = () => {
      if (fallos[tabla]) return { data: null, error: fallos[tabla] };
      tablas[tabla] ??= [];
      const lista = tablas[tabla];
      const cumple = (f) => filtros.every((fn) => fn(f));
      const d = disparadores[tabla] ?? {};
      let resultado;
      if (operacion === "select") {
        resultado = despues.reduce((filas, fn) => fn(filas), lista.filter(cumple));
      } else if (operacion === "insert" || operacion === "upsert") {
        resultado = [];
        for (const original of Array.isArray(datos) ? datos : [datos]) {
          const clave = opcionesUpsert.onConflict;
          const existente = operacion === "upsert" && clave ? lista.find((f) => f[clave] === original[clave]) : null;
          if (existente) {
            Object.assign(existente, original);
            resultado.push(existente);
            continue;
          }
          let fila = { id: Math.max(0, ...lista.map((f) => Number(f.id) || 0)) + 1, ...original };
          if (d.alInsertar) {
            const r = d.alInsertar(fila, tablas);
            if (r?.error) return { data: null, error: r.error };
            fila = r ?? fila;
          }
          lista.push(fila);
          resultado.push(fila);
        }
      } else if (operacion === "update") {
        resultado = [];
        for (const [i, antes] of lista.entries()) {
          if (!cumple(antes)) continue;
          let nueva = { ...antes, ...datos };
          if (d.alActualizar) {
            const r = d.alActualizar(antes, nueva, tablas);
            if (r?.error) return { data: null, error: r.error };
            nueva = r ?? nueva;
          }
          lista[i] = nueva;
          resultado.push(nueva);
        }
      } else {
        resultado = lista.filter(cumple);
        tablas[tabla] = lista.filter((f) => !cumple(f));
      }
      if (operacion !== "select" && !devolver) return { data: null, error: null };
      if (modo === "single") {
        return resultado.length === 1 ? { data: resultado[0], error: null } : { data: null, error: { code: "PGRST116", message: "not exactly one row" } };
      }
      if (modo === "maybeSingle") return { data: resultado[0] ?? null, error: null };
      return { data: resultado, error: null };
    };
    return q;
  };

  const almacen = (bucket) => ({
    upload: async (ruta, archivo, opciones = {}) => {
      const clave = `${bucket}/${ruta}`;
      if (archivos[clave] && !opciones.upsert) return { data: null, error: { statusCode: "409", message: "The resource already exists" } };
      archivos[clave] = archivo;
      return { data: { path: ruta }, error: null };
    },
    download: async (ruta) => {
      const a = archivos[`${bucket}/${ruta}`];
      return a ? { data: a, error: null } : { data: null, error: { statusCode: "404", message: "Object not found" } };
    },
    remove: async (rutas) => {
      rutas.forEach((r) => delete archivos[`${bucket}/${r}`]);
      return { data: [], error: null };
    },
  });

  return {
    llamadas,
    tablas,
    archivos,
    from: (tabla) => consulta(tabla),
    storage: { from: almacen },
    rpc: async (nombre, args) => {
      if (fallos.rpc) return { data: null, error: fallos.rpc };
      llamadas.push(`rpc:${nombre}`);
      if (rpcs[nombre]) return rpcs[nombre](args, tablas);
      if (nombre === "es_propietario") return { data: Boolean(sesion && sesion.user.id === propietario), error: null };
      return { data: null, error: { code: "PGRST202", message: "not found" } };
    },
    auth: {
      getSession: async () => ({ data: { session: sesion }, error: null }),
      signInWithPassword: async ({ email, password }) => {
        if (fallos.login) return { data: null, error: fallos.login };
        const u = usuarios.find((x) => x.email === email && x.password === password);
        if (!u) return { data: null, error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } };
        sesion = { user: { id: u.id, email: u.email } };
        emitir("SIGNED_IN");
        return { data: { session: sesion }, error: null };
      },
      signOut: async () => {
        sesion = null;
        emitir("SIGNED_OUT");
        return { error: null };
      },
      onAuthStateChange: (cb) => {
        oyentes.add(cb);
        return { data: { subscription: { unsubscribe: () => oyentes.delete(cb) } } };
      },
    },
    get sesion() {
      return sesion;
    },
  };
};
