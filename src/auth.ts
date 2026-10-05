// Echte Anmeldung über Supabase Auth (E-Mail + Passwort).
// Spricht direkt die offizielle Auth-REST-API an – kein Zusatzpaket nötig.
// Verwendet nur den öffentlichen "anon" Key. Geheime Keys (service_role) gehören NIE in diese App.

import { CONFIG } from "./config";

/** Der angemeldete Benutzer. `id` ist die dauerhafte Benutzer-ID (UUID aus Supabase),
 *  an die später Highscores, Fortschritt, Statistiken und Einstellungen gehängt werden. */
export interface AuthUser {
  id: string;
  email: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Unix-Zeit in Sekunden */
  expiresAt: number;
  user: AuthUser;
}

export type AuthErrorCode =
  | "not_configured"
  | "invalid_email"
  | "weak_password"
  | "password_mismatch"
  | "invalid_credentials"
  | "email_taken"
  | "email_not_confirmed"
  | "rate_limited"
  | "wrong_password"
  | "same_password"
  | "reauth_needed"
  | "network"
  | "unknown";

export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const MIN_PASSWORD = 8;
const KEY = "zwip:auth";

export const authConfigured = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

let session: Session | null = null;
let refreshTimer = 0;
const listeners: ((s: Session | null) => void)[] = [];

export function onAuthChange(fn: (s: Session | null) => void) {
  listeners.push(fn);
}

export function currentSession(): Session | null {
  return session;
}

export function currentUser(): AuthUser | null {
  return session?.user ?? null;
}

// ---------- Speicher ----------

function persist(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* privater Modus: Sitzung gilt dann nur bis zum Schließen */
  }
}

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s?.accessToken && s?.refreshToken && s?.user?.id ? s : null;
  } catch {
    return null;
  }
}

function setSession(s: Session | null) {
  session = s;
  persist(s);
  clearTimeout(refreshTimer);
  if (s) {
    // 60 Sekunden vor Ablauf automatisch erneuern
    const ms = Math.max(5_000, (s.expiresAt - 60) * 1000 - Date.now());
    refreshTimer = window.setTimeout(() => void refresh().catch(() => {}), Math.min(ms, 2 ** 31 - 1));
  }
  listeners.forEach((fn) => fn(s));
}

// ---------- Fehlertexte ----------

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

const MESSAGES: Record<AuthErrorCode, string> = {
  not_configured: "Die Anmeldung ist noch nicht eingerichtet. (Supabase-Zugangsdaten fehlen – siehe DEPLOYMENT.md)",
  invalid_email: "Bitte gib eine gültige E-Mail-Adresse ein.",
  weak_password: `Das Passwort ist zu schwach. Nimm mindestens ${MIN_PASSWORD} Zeichen.`,
  password_mismatch: "Die beiden Passwörter stimmen nicht überein.",
  invalid_credentials: "E-Mail oder Passwort ist falsch.",
  email_taken: "Mit dieser E-Mail gibt es schon einen Account. Melde dich stattdessen an.",
  email_not_confirmed: "Bitte bestätige zuerst deine E-Mail-Adresse. Schau in dein Postfach (auch im Spam-Ordner).",
  rate_limited: "Zu viele Versuche. Warte kurz und probier es dann nochmal.",
  wrong_password: "Dein aktuelles Passwort stimmt nicht.",
  same_password: "Das neue Passwort muss anders sein als das alte.",
  reauth_needed: "Aus Sicherheitsgründen bitte einmal ab- und wieder anmelden, dann klappt das Ändern.",
  network: "Keine Verbindung zum Server. Prüfe dein Internet und versuch es nochmal.",
  unknown: "Da ist etwas schiefgelaufen. Bitte versuch es nochmal.",
};

export function authMessage(code: AuthErrorCode): string {
  return MESSAGES[code];
}

function fail(code: AuthErrorCode): never {
  throw new AuthError(code, MESSAGES[code]);
}

/** Übersetzt Supabase-Fehlerantworten in verständliche Fehler. */
function mapError(status: number, body: Record<string, unknown>): AuthErrorCode {
  const code = String(body.error_code ?? body.code ?? body.error ?? "").toLowerCase();
  const msg = String(body.msg ?? body.message ?? body.error_description ?? "").toLowerCase();
  if (status === 429 || code.includes("rate_limit") || msg.includes("rate limit")) return "rate_limited";
  if (code === "invalid_credentials" || code === "invalid_grant" || msg.includes("invalid login credentials")) return "invalid_credentials";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return "email_taken";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "email_not_confirmed";
  if (code === "same_password" || msg.includes("should be different")) return "same_password";
  if (code === "reauthentication_needed" || code === "reauthentication_not_valid") return "reauth_needed";
  if (code === "weak_password" || msg.includes("password should")) return "weak_password";
  if (code === "email_address_invalid" || code === "validation_failed" || msg.includes("invalid format") || msg.includes("email address")) return "invalid_email";
  return "unknown";
}

// ---------- API ----------

async function call(path: string, body: unknown, token?: string, method = "POST"): Promise<Record<string, unknown>> {
  if (!authConfigured) fail("not_configured");
  let res: Response;
  try {
    res = await fetch(`${CONFIG.supabaseUrl}/auth/v1${path}`, {
      method,
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    fail("network");
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* leere oder kaputte Antwort */
  }
  if (!res.ok) fail(mapError(res.status, data));
  return data;
}

function toSession(d: Record<string, unknown>): Session | null {
  const user = d.user as { id?: string; email?: string } | undefined;
  if (!d.access_token || !d.refresh_token || !user?.id) return null;
  const expiresAt = Number(d.expires_at) || Math.floor(Date.now() / 1000) + (Number(d.expires_in) || 3600);
  return {
    accessToken: String(d.access_token),
    refreshToken: String(d.refresh_token),
    expiresAt,
    user: { id: user.id, email: user.email ?? "" },
  };
}

/** Account anlegen. Gibt `needsConfirmation: true` zurück, wenn Supabase erst eine Bestätigungs-Mail schickt. */
export async function signUp(email: string, password: string, confirm: string): Promise<{ needsConfirmation: boolean }> {
  email = email.trim().toLowerCase();
  if (!validateEmail(email)) fail("invalid_email");
  if (password.length < MIN_PASSWORD) fail("weak_password");
  if (password !== confirm) fail("password_mismatch");
  const redirect = location.protocol.startsWith("http") ? `?redirect_to=${encodeURIComponent(location.origin + location.pathname)}` : "";
  const data = await call(`/signup${redirect}`, { email, password });
  const s = toSession(data);
  if (s) {
    setSession(s);
    return { needsConfirmation: false };
  }
  // Mit aktivierter E-Mail-Bestätigung meldet Supabase eine bereits vergebene Adresse aus
  // Datenschutzgründen nicht als Fehler, sondern liefert einen Benutzer ohne Identitäten.
  const identities = (data.identities ?? (data.user as { identities?: unknown[] } | undefined)?.identities) as unknown[] | undefined;
  if (Array.isArray(identities) && identities.length === 0) fail("email_taken");
  return { needsConfirmation: true };
}

export async function signIn(email: string, password: string): Promise<Session> {
  email = email.trim().toLowerCase();
  if (!validateEmail(email)) fail("invalid_email");
  if (!password) fail("invalid_credentials");
  const s = toSession(await call("/token?grant_type=password", { email, password }));
  if (!s) fail("unknown");
  setSession(s);
  return s;
}

/**
 * Passwort ändern. Prüft zuerst das aktuelle Passwort (wie eine erneute Anmeldung),
 * damit niemand an einem kurz liegengelassenen Handy das Passwort ändern kann.
 */
export async function changePassword(current: string, next: string, confirm: string): Promise<void> {
  const s = session;
  if (!s) fail("invalid_credentials");
  if (!current) fail("wrong_password");
  if (next.length < MIN_PASSWORD) fail("weak_password");
  if (next !== confirm) fail("password_mismatch");
  if (next === current) fail("same_password");
  let fresh: Session | null;
  try {
    fresh = toSession(await call("/token?grant_type=password", { email: s.user.email, password: current }));
  } catch (e) {
    if (e instanceof AuthError && e.code === "invalid_credentials") fail("wrong_password");
    throw e;
  }
  if (!fresh) fail("unknown");
  setSession(fresh);
  await call("/user", { password: next }, fresh.accessToken, "PUT");
}

let refreshing: Promise<Session | null> | null = null;

/** Erneuert das Zugangstoken. Bei abgelaufener/ungültiger Sitzung → abgemeldet. */
export function refresh(): Promise<Session | null> {
  if (refreshing) return refreshing;
  const current = session;
  if (!current) return Promise.resolve(null);
  refreshing = call("/token?grant_type=refresh_token", { refresh_token: current.refreshToken })
    .then((d) => {
      const s = toSession(d);
      setSession(s);
      return s;
    })
    .catch((e) => {
      // Ohne Netz bleibt man angemeldet; nur eine wirklich ungültige Sitzung wird beendet
      if (e instanceof AuthError && e.code === "network") throw e;
      setSession(null);
      return null;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function signOut(): Promise<void> {
  const s = session;
  setSession(null);
  if (s) {
    try {
      await call("/logout", {}, s.accessToken);
    } catch {
      /* lokal ist man trotzdem abgemeldet */
    }
  }
}

/**
 * Beim Start: Sitzung aus dem Speicher holen (bleibt nach Neuladen erhalten)
 * oder aus dem Bestätigungslink der Registrierungs-Mail übernehmen.
 */
export async function restoreSession(): Promise<Session | null> {
  if (!authConfigured) return null;

  // Rücksprung aus der Bestätigungs-Mail: #access_token=…&refresh_token=…
  if (location.hash.includes("access_token=")) {
    const h = new URLSearchParams(location.hash.slice(1));
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch {
      /* egal */
    }
    const accessToken = h.get("access_token");
    const refreshToken = h.get("refresh_token");
    if (accessToken && refreshToken) {
      try {
        const res = await fetch(`${CONFIG.supabaseUrl}/auth/v1/user`, {
          headers: { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
        });
        const user = (await res.json()) as { id?: string; email?: string };
        if (res.ok && user.id) {
          setSession({
            accessToken,
            refreshToken,
            expiresAt: Number(h.get("expires_at")) || Math.floor(Date.now() / 1000) + Number(h.get("expires_in") || 3600),
            user: { id: user.id, email: user.email ?? "" },
          });
          return session;
        }
      } catch {
        /* weiter mit gespeicherter Sitzung */
      }
    }
  }

  const stored = readStored();
  if (!stored) return null;
  session = stored;
  if (stored.expiresAt - 60 > Date.now() / 1000) {
    setSession(stored); // Timer für automatische Erneuerung setzen
    return stored;
  }
  try {
    return await refresh();
  } catch {
    // Offline: mit der gespeicherten Sitzung weiterspielen, Erneuerung beim nächsten Mal
    return stored;
  }
}

// Wenn die App lange im Hintergrund war, Token beim Zurückkommen auffrischen
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && session && session.expiresAt - 60 < Date.now() / 1000) {
    void refresh().catch(() => {});
  }
});

/**
 * Aufruf einer Datenbank-Funktion (Supabase RPC) im Namen des angemeldeten Benutzers.
 * Erneuert das Zugangstoken bei Bedarf automatisch.
 */
export async function authedRpc(fn: string, args: Record<string, unknown> = {}): Promise<Response> {
  if (!authConfigured) fail("not_configured");
  if (session && session.expiresAt - 30 < Date.now() / 1000) await refresh().catch(() => {});
  const send = () =>
    fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${session?.accessToken ?? CONFIG.supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  let res = await send();
  if (res.status === 401 && session) {
    await refresh().catch(() => {});
    if (session) res = await send();
  }
  return res;
}
