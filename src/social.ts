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

export type Relation = "self" | "none" | "friend" | "outgoing" | "incoming";

/** Profil-Karte: eigenes oder öffentliches Profil inkl. Bild (supabase/profile.sql). */
export interface ProfileCard extends PlayerInfo {
  username: string;
  best_trophies?: number;
  avatar: string | null;
  member_since?: string;
  relation?: Relation;
}

// ---------- Minigames ----------

export interface MinigameEntry {
  rank: number;
  username: string;
  league: string;
  stage: number;
  ms: number;
  is_me?: boolean;
}

export interface MinigameBoard {
  top: MinigameEntry[];
  me: MinigameEntry | null;
  above: MinigameEntry | null;
  below: MinigameEntry | null;
  total: number;
}

export interface MinigameBest {
  game: string;
  best_stage: number;
  best_ms: number;
  plays: number;
  rank: number | null;
}

export interface MinigameFinish {
  stage: number;
  total_ms: number;
  best_stage: number;
  best_ms: number;
  plays: number;
  is_record: boolean;
  rank: number | null;
  total_players: number;
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
  unknown_game: "Dieses Minigame gibt es nicht.",
  run_not_active: "Dieser Lauf wurde schon gewertet.",
  run_expired: "Der Lauf hat zu lange gedauert und wurde nicht gewertet.",
  run_too_fast: "Der Lauf war unrealistisch schnell und wurde nicht gewertet.",
  invalid_stage: "Ungültiges Ergebnis – wurde nicht gewertet.",
  invalid_time: "Ungültige Zeit – wurde nicht gewertet.",
  invalid_steps: "Ungültiges Ergebnis – wurde nicht gewertet.",
  avatar_invalid: "Das Bild konnte nicht gespeichert werden. Probier ein anderes Foto.",
  setup_missing: "Die Datenbank ist noch nicht auf dem neuesten Stand.",
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
export const startMinigameRun = (game: string) => call<{ run_id: string; seed: number }>("start_minigame_run", { p_game: game });
export const finishMinigameRun = (run: string, stage: number, totalMs: number, steps: { ok: boolean; ms: number }[]) =>
  call<MinigameFinish>("finish_minigame_run", { p_run: run, p_stage: stage, p_total_ms: totalMs, p_steps: steps });
export const getMinigameBoard = (game: string, limit = 50) => call<MinigameBoard>("get_minigame_board", { p_game: game, p_limit: limit });
export const getMyMinigameBests = () => call<MinigameBest[]>("get_my_minigame_bests");
export const getMyProfileCard = () => call<ProfileCard>("get_my_profile_card");
export const setAvatar = (avatar: string | null) => call<ProfileCard>("set_avatar", { p_avatar: avatar });
export const getPlayerProfile = (name: string) => call<ProfileCard>("get_player_profile", { p_username: name });

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

// ---------- Eigenes Profilbild (Anzeige-Cache für den Profil-Knopf oben) ----------

const AVATAR_KEY = "zwip:avatar";

export function cachedAvatar(userId: string | undefined): string | null {
  try {
    const raw = localStorage.getItem(AVATAR_KEY);
    const v = raw ? (JSON.parse(raw) as { uid: string; a: string | null }) : null;
    return v && v.uid === userId ? v.a : null;
  } catch {
    return null;
  }
}

export function setCachedAvatar(userId: string | undefined, avatar: string | null) {
  try {
    if (userId && avatar) localStorage.setItem(AVATAR_KEY, JSON.stringify({ uid: userId, a: avatar }));
    else localStorage.removeItem(AVATAR_KEY);
  } catch {
    /* Speicher voll oder privat – dann eben ohne Cache */
  }
  avatarListeners.forEach((fn) => fn(avatar));
}

const avatarListeners: ((a: string | null) => void)[] = [];
export function onAvatarChange(fn: (a: string | null) => void) {
  avatarListeners.push(fn);
}
