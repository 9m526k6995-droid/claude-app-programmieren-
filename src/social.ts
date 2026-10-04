// Trophäen, Weltrangliste und Freunde – alles über Datenbank-Funktionen (supabase/trophies.sql).
// Die App schreibt nie direkt in Tabellen; der Server rechnet und prüft.

import { authedRpc } from "./auth";
import type { TaskResult } from "./trophies";

export interface PlayerInfo {
  username: string;
  trophies: number;
  league: string;
  world_rank?: number;
  best_streak?: number;
  trophy_rounds?: number;
}

export interface MyProfile extends PlayerInfo {
  username: string;
  best_trophies: number;
}

export interface BoardEntry extends PlayerInfo {
  rank: number;
  is_me: boolean;
}

export interface TrophyBoard {
  top: BoardEntry[];
  me: PlayerInfo | null;
  above: PlayerInfo | null;
  below: PlayerInfo | null;
  total: number;
}

export interface RoundStart {
  round_id: string;
  seed: number;
  trophies: number;
  league: string;
}

export interface RoundFinish {
  old_trophies: number;
  new_trophies: number;
  delta: number;
  raw_delta: number;
  base: number;
  speed_bonus: number;
  streak_bonus: number;
  penalty: number;
  correct: number;
  wrong: number;
  best_streak: number;
  old_league: string;
  new_league: string;
  world_rank: number | null;
}

export interface SearchHit extends PlayerInfo {
  relation: "none" | "friend" | "outgoing" | "incoming";
}

export interface FriendsData {
  friends: PlayerInfo[];
  incoming: PlayerInfo[];
  outgoing: PlayerInfo[];
}

const MESSAGES: Record<string, string> = {
  not_authenticated: "Bitte melde dich erneut an.",
  username_invalid: "Der Name darf 3–16 Zeichen haben: Buchstaben (ohne Umlaute), Zahlen und _.",
  username_taken: "Dieser Name ist schon vergeben. Probier einen anderen.",
  username_required: "Wähle zuerst deinen Spielernamen.",
  round_not_active: "Diese Runde wurde schon gewertet.",
  round_expired: "Die Runde hat zu lange gedauert und wurde nicht gewertet.",
  round_too_fast: "Die Runde war unrealistisch schnell und wurde nicht gewertet.",
  invalid_tasks: "Die Runde war unvollständig und wurde nicht gewertet.",
  player_not_found: "Keinen Spieler mit diesem Namen gefunden.",
  cannot_add_self: "Dich selbst kannst du nicht hinzufügen 😄",
  already_friends: "Ihr seid schon befreundet.",
  request_already_sent: "Du hast schon eine Anfrage geschickt.",
  request_not_found: "Diese Anfrage gibt es nicht mehr.",
  not_friends: "Ihr seid nicht befreundet.",
  setup_missing: "Die Datenbank ist noch nicht auf dem neuesten Stand (supabase/trophies.sql fehlt).",
  network: "Keine Verbindung zum Server. Prüfe dein Internet.",
  unknown: "Da ist etwas schiefgelaufen. Bitte versuch es nochmal.",
};

export class SocialError extends Error {
  constructor(public code: string) {
    super(MESSAGES[code] ?? MESSAGES.unknown);
  }
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await authedRpc(fn, args);
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "not_configured") throw e;
    throw new SocialError("network");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignorieren */
  }
  if (!res.ok) {
    const err = (data ?? {}) as { message?: string; code?: string };
    // PGRST202 = Funktion existiert nicht → SQL-Datei wurde noch nicht ausgeführt
    if (err.code === "PGRST202" || res.status === 404) throw new SocialError("setup_missing");
    if (err.message && MESSAGES[err.message]) throw new SocialError(err.message);
    if (res.status === 401 || res.status === 403) throw new SocialError("not_authenticated");
    throw new SocialError("unknown");
  }
  return data as T;
}

export const getMyProfile = () => call<MyProfile>("get_my_trophy_profile");
export const setUsername = (name: string) => call<MyProfile>("set_username", { p_username: name });
export const startTrophyRound = () => call<RoundStart>("start_trophy_round");
export const finishTrophyRound = (roundId: string, tasks: TaskResult[]) =>
  call<RoundFinish>("finish_trophy_round", { p_round_id: roundId, p_tasks: tasks });
export const getTrophyBoard = (limit = 100) => call<TrophyBoard>("get_trophy_board", { p_limit: limit });
export const searchPlayers = (q: string) => call<SearchHit[]>("search_players", { p_query: q });
export const sendFriendRequest = (name: string) => call<{ status: "pending" | "accepted" }>("send_friend_request", { p_username: name });
export const respondFriendRequest = (name: string, accept: boolean) =>
  call<{ status: string }>("respond_friend_request", { p_username: name, p_accept: accept });
export const removeFriend = (name: string) => call<{ removed: boolean }>("remove_friend", { p_username: name });
export const getFriends = () => call<FriendsData>("get_friends");

// ---------- Zwischenspeicher für die Flamme (zeigt sofort den letzten bekannten Stand) ----------

const CACHE_KEY = "zwip:trophies";
let cached: MyProfile | null = null;
const listeners: ((p: MyProfile | null) => void)[] = [];

export function cachedProfile(userId: string | undefined): MyProfile | null {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const v = raw ? (JSON.parse(raw) as { uid: string; p: MyProfile }) : null;
    if (v && v.uid === userId) cached = v.p;
  } catch {
    /* egal */
  }
  return cached;
}

/** Nur Anzeige-Cache. Die Rangliste liest IMMER aus der Datenbank, nie aus diesem Speicher. */
export function setCachedProfile(userId: string | undefined, p: MyProfile | null) {
  cached = p;
  try {
    if (p && userId) localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: userId, p }));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* egal */
  }
  listeners.forEach((fn) => fn(p));
}

export function onProfileChange(fn: (p: MyProfile | null) => void) {
  listeners.push(fn);
}

export async function refreshProfile(userId: string | undefined): Promise<MyProfile | null> {
  const p = await getMyProfile();
  setCachedProfile(userId, p);
  return p;
}
