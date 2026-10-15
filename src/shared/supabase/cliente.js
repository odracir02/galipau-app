// Lazily created Supabase client (only loaded when the Supabase backend is active).

import { leerConfigSupabase } from "./config";

let cliente = null;

export const obtenerClienteSupabase = async () => {
  if (cliente) return cliente;
  const { url, clave } = leerConfigSupabase();
  const { createClient } = await import("@supabase/supabase-js");
  cliente = createClient(url, clave, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return cliente;
};
