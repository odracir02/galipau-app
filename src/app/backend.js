// Active backend during the gradual migration:
//   VITE_BACKEND=local    -> local Express + SQLite server (default for now)
//   VITE_BACKEND=supabase -> Supabase (PostgreSQL + Auth), used for the cloud deployment

export const BACKENDS = ["local", "supabase"];

export const backendActivo = (valor = import.meta.env.VITE_BACKEND) => (BACKENDS.includes(valor) ? valor : "local");
