// Test double of the supabase-js client (tests only, never imported by the app).
// Tables are plain arrays; queries support select/order/range/limit/eq.

export const crearClienteFalso = ({ tablas = {}, usuarios = [], propietario = null, sesionInicial = null, fallos = {}, rpcs = {} } = {}) => {
  let sesion = sesionInicial;
  const oyentes = new Set();
  const llamadas = [];
  const emitir = (evento) => oyentes.forEach((cb) => cb(evento, sesion));

  const consulta = (tabla) => {
    let filas = [...(tablas[tabla] ?? [])];
    const q = {
      select: () => q,
      order: (col, { ascending = true } = {}) => {
        filas.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (ascending ? 1 : -1));
        return q;
      },
      eq: (col, valor) => {
        filas = filas.filter((f) => f[col] === valor);
        return q;
      },
      limit: (n) => {
        filas = filas.slice(0, n);
        return q;
      },
      range: (desde, hasta) => {
        llamadas.push(`${tabla}:${desde}-${hasta}`);
        filas = filas.slice(desde, hasta + 1);
        return q;
      },
      then: (resolver, rechazar) => {
        const resultado = fallos[tabla] ? { data: null, error: fallos[tabla] } : { data: filas, error: null };
        return Promise.resolve(resultado).then(resolver, rechazar);
      },
    };
    return q;
  };

  return {
    llamadas,
    from: (tabla) => consulta(tabla),
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
