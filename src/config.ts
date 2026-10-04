// Werte kommen beim Build aus der .env-Datei (siehe .env.example) – leer = Funktion aus.

declare const __ZWIP_CONFIG__: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  publicUrl: string;
};

export const CONFIG = typeof __ZWIP_CONFIG__ !== "undefined" ? __ZWIP_CONFIG__ : { supabaseUrl: "", supabaseAnonKey: "", publicUrl: "" };

export const hasGlobalBoard = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

/** Basis-URL für Teilen-Links. */
export function publicBase(): string {
  if (CONFIG.publicUrl) return CONFIG.publicUrl;
  const { protocol, href } = window.location;
  return protocol.startsWith("http") ? href : "https://zwip.app/";
}
