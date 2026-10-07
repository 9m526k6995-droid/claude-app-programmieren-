// Trophäen, Weltrangliste und Freunde – alles über Datenbank-Funktionen (supabase/trophies.sql).
// Die App schreibt nie direkt in Tabellen; der Server rechnet und prüft.

import { authedRpc } from "./auth";
import type { TaskResult } from "./trophies";
import type { SeasonPass, SeasonPing, Shop, Cosmetics, Equipped, ItemKind, Item } from "./passKit";

export interface PlayerInfo {
  username: string;
  trophies: number;
  league: string;
  country?: string | null;
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
  /** gesetzt = Rangliste dieses Landes (rank = Platz im Land) */
  country?: string | null;
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
  league_fee?: number;
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
  country?: string | null;
  score: number;
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
  best_score: number;
  best_stage: number;
  best_ms: number;
  plays: number;
  rank: number | null;
}

export interface MinigameFinish {
  flagged?: boolean;
  flag?: string;
  stage: number;
  total_ms: number;
  score: number;
  best_score: number;
  prev_best_score: number;
  clan_xp: number;
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
  invalid_scope: "Diese Rangliste gibt es nicht.",
  already_in_clan: "Du bist schon in einem Clan. Verlass ihn zuerst.",
  clan_name_invalid: "Der Clan-Name darf 3–20 Zeichen haben: Buchstaben, Zahlen, Leerzeichen, _ und -.",
  clan_name_bad: "Dieser Clan-Name ist nicht erlaubt.",
  clan_name_taken: "Diesen Clan-Namen gibt es schon. Probier einen anderen.",
  clan_not_found: "Diesen Clan gibt es nicht mehr.",
  clan_full: "Der Clan ist voll (500 Mitglieder).",
  invite_only: "Diesem Clan kann man nur mit Einladung beitreten.",
  too_many_requests: "Du hast schon 5 offene Anfragen. Warte auf eine Antwort.",
  too_many_invites: "Heute hast du schon genug Einladungen verschickt.",
  not_in_clan: "Du bist in keinem Clan.",
  not_leader: "Das darf nur der Clan-Leiter.",
  invalid_push: "Push konnte nicht eingerichtet werden.",
  invite_invalid: "Dieser Einladungslink gilt nicht (mehr). Frag nach einem neuen.",
  player_in_clan: "Dieser Spieler ist schon in einem Clan.",
  invite_not_found: "Diese Einladung gibt es nicht mehr.",
  locked: "Das ist erst mit einem höheren Clan-Level freigeschaltet.",
  invalid_mode: "Ungültige Einstellung.",
  invalid_period: "Diesen Zeitraum gibt es nicht.",
  muted: "Du bist im Clan-Chat gerade stummgeschaltet.",
  slow_down: "Nicht so schnell – warte kurz.",
  invalid_message: "Die Nachricht darf 1–200 Zeichen haben.",
  message_not_found: "Diese Nachricht gibt es nicht mehr.",
  invalid_country: "Dieses Land gibt es nicht.",
  country_locked: "Dein Land kannst du nur einmal im Monat ändern.",
  username_bad: "Dieser Name ist nicht erlaubt. Bitte wähle einen anderen.",
  banned: "Dein Konto ist gerade gesperrt.",
  invalid_age: "Bitte gib dein richtiges Alter an.",
  parent_consent_required: "Unter 16 brauchst du die Zustimmung deiner Eltern.",
  invalid_report: "Ungültige Meldung.",
  not_admin: "Dafür brauchst du Admin-Rechte.",
  setup_missing: "Die Datenbank ist noch nicht auf dem neuesten Stand.",
  reward_locked: "Diese Stufe hast du noch nicht erreicht.",
  premium_required: "Dafür brauchst du den Season Pass.",
  already_claimed: "Schon abgeholt ✓",
  invalid_reward: "Diese Belohnung gibt es nicht.",
  not_in_shop: "Das gibt es heute nicht im Shop.",
  already_owned: "Hast du schon ✓",
  not_enough_coins: "Dafür hast du nicht genug Coins.",
  not_enough_gems: "Dafür hast du nicht genug Gems.",
  invalid_currency: "So kann man das nicht bezahlen.",
  payments_unavailable: "Käufe mit echtem Geld kommen bald.",
  product_not_found: "Dieses Angebot gibt es nicht mehr.",
  not_owned: "Das hast du noch nicht.",
  invalid_kind: "Ungültige Art.",
  season_not_found: "Diese Season gibt es nicht.",
  season_overlap: "Die Season überschneidet sich mit einer anderen.",
  invalid_weeks: "Eine Season dauert 1 bis 26 Wochen.",
  invalid_date: "Ungültiges Datum.",
  invalid_name: "Der Name darf 1–40 Zeichen haben.",
  invalid_item_id: "Die ID darf nur a–z, 0–9 und _ enthalten (2–40 Zeichen).",
  invalid_item_data: "Die Item-Daten passen nicht (Farben als #RRGGBB, kurze Emojis/Texte).",
  invalid_rarity: "Ungültige Seltenheit.",
  item_not_found: "Dieses Item gibt es nicht.",
  exclusive_item: "Exklusive Season-Items können nicht in den Shop.",
  invalid_amount: "Ungültige Menge oder ungültiger Preis.",
  invalid_setting: "Ungültige Einstellung.",
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
export interface Badges {
  friends: number;
  friend_requests: number;
  friends_accepted: number;
  accepted_names: string[];
  clan?: number;
}
export const getBadges = () => call<Badges>("get_badges");
export const markFriendsSeen = () => call<null>("mark_friends_seen");
export const startMinigameRun = (game: string) => call<{ run_id: string; seed: number }>("start_minigame_run", { p_game: game });
export interface MinigameRanking {
  scope: string;
  rows: (MinigameEntry & { world_rank: number })[];
  my_rank: number | null;
  has_clan: boolean;
  total: number;
}
export const getMinigameRanking = (game: string, scope: string, limit = 50) =>
  call<MinigameRanking>("get_minigame_ranking", { p_game: game, p_scope: scope, p_limit: limit });
export const finishMinigameRun = (run: string, stage: number, totalMs: number, steps: { ok: boolean; ms: number; t?: number }[]) =>
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

// ---------- Clans ----------

export type JoinMode = "open" | "request" | "invite";

export interface ClanInfo {
  id: string;
  name: string;
  emblem: string;
  color: string;
  frame: string;
  description: string;
  join_mode: JoinMode;
  xp: number;
  level: number;
  level_xp: number;
  next_level_xp: number | null;
  members: number;
  max_members: number;
  leader: string | null;
  rank: number;
  invited_by?: string;
  requested?: boolean;
  invited?: boolean;
}

export interface ClanMember {
  username: string;
  league: string;
  trophies: number;
  role: "leader" | "member";
  joined_at: string;
  xp_total: number;
  xp_week: number;
  is_me: boolean;
  muted: boolean;
}

export interface ClanChallenge {
  key: string;
  title: string;
  metric: "points" | "rounds" | "active";
  goal: number;
  progress: number;
  reward: number;
  done: boolean;
}

export interface MyClan {
  clan: ClanInfo | null;
  invites?: ClanInfo[];
  my_requests?: string[];
  role?: "leader" | "member";
  muted_until?: string | null;
  my_xp_total?: number;
  my_xp_week?: number;
  members?: ClanMember[];
  requests?: { username: string; league: string; trophies: number }[];
  invited?: string[];
  challenges?: { week_start: string; week_end: string; items: ClanChallenge[]; size?: number };
  unread?: number;
}

export interface ClanPublic extends ClanInfo {
  is_member: boolean;
  member_list: { username: string; league: string; role: string; xp_week: number }[];
}

export interface ClanBoardRow {
  rank: number;
  id: string;
  name: string;
  emblem: string;
  color: string;
  frame: string;
  members: number;
  level: number;
  points: number;
  is_mine: boolean;
}

export interface ClanMessage {
  id: number;
  username: string | null;
  body: string | null;
  hidden: boolean;
  kind: "text" | "quick" | "system";
  at: string;
  is_me: boolean;
}

export interface ClanContrib {
  rank: number;
  username: string;
  league: string;
  role: string;
  points: number;
  rounds: number;
  is_me: boolean;
}

export const getMyClan = () => call<MyClan>("get_my_clan");

// Einladungslink (?clan=CODE)
export interface ClanInvite {
  code: string;
  can_reset: boolean;
}
export const getClanInvite = () => call<ClanInvite>("get_clan_invite");
export const resetClanInvite = () => call<ClanInvite>("reset_clan_invite");
export const clanByInvite = (code: string) => call<ClanInfo & { in_this_clan: boolean; in_a_clan: boolean }>("clan_by_invite", { p_code: code });
export const joinClanByInvite = (code: string) => call<{ status: "joined"; clan_id: string }>("join_clan_by_invite", { p_code: code });

// Clan-Ligen
export type ClanLeagueId = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "champion";
export interface ClanLeagueRow extends ClanInfo {
  rank: number;
  per_member: number;
  active: number;
  week_xp: number;
  is_mine: boolean;
}
export interface ClanLeague {
  league: ClanLeagueId;
  next_league: ClanLeagueId;
  week_end: string;
  xp: number;
  active: number;
  per_member: number;
  clans_in_league: number;
  my_rank: number;
  rows: ClanLeagueRow[];
}
export const getClanLeague = () => call<ClanLeague>("get_clan_league");
export const createClan = (name: string, emblem: string, color: string, description: string, joinMode: JoinMode) =>
  call<MyClan>("create_clan", { p_name: name, p_emblem: emblem, p_color: color, p_description: description, p_join_mode: joinMode });
export const updateClan = (emblem: string, color: string, frame: string, description: string, joinMode: JoinMode) =>
  call<MyClan>("update_clan", { p_emblem: emblem, p_color: color, p_frame: frame, p_description: description, p_join_mode: joinMode });
export const searchClans = (q: string) => call<ClanInfo[]>("search_clans", { p_query: q });
export const getClan = (id: string) => call<ClanPublic>("get_clan", { p_clan: id });
export const joinClan = (id: string) => call<{ status: "joined" | "requested" }>("join_clan", { p_clan: id });
export const cancelClanRequest = (id: string) => call<null>("cancel_clan_request", { p_clan: id });
export const inviteToClan = (name: string) => call<{ status: "invited" | "joined" }>("invite_to_clan", { p_username: name });
export const respondClanInvite = (id: string, accept: boolean) => call<{ status: string }>("respond_clan_invite", { p_clan: id, p_accept: accept });
export const respondClanRequest = (name: string, accept: boolean) => call<MyClan>("respond_clan_request", { p_username: name, p_accept: accept });
export const leaveClan = () => call<null>("leave_clan");
export const kickClanMember = (name: string) => call<MyClan>("kick_clan_member", { p_username: name });
export const transferClanLeader = (name: string) => call<MyClan>("transfer_clan_leader", { p_username: name });
export const getClanBoard = (period: string) => call<{ period: string; rows: ClanBoardRow[]; total: number }>("get_clan_board", { p_period: period });
export const getClanContrib = (period: string) => call<ClanContrib[]>("get_clan_contrib", { p_period: period });
export const getClanMessages = (after = 0) => call<ClanMessage[]>("get_clan_messages", { p_after: after });
export const sendClanMessage = (body: string | null, quick: number | null = null) =>
  call<ClanMessage[]>("send_clan_message", { p_body: body, p_quick: quick });
export const reportClanMessage = (id: number, reason = "") => call<{ hidden: boolean; reports: number }>("report_clan_message", { p_id: id, p_reason: reason });
export const hideClanMessage = (id: number) => call<null>("hide_clan_message", { p_id: id });
export const muteClanMember = (name: string, hours: number) => call<MyClan>("mute_clan_member", { p_username: name, p_hours: hours });
export const getPlayerClan = (name: string) =>
  call<{ id: string; name: string; emblem: string; color: string; frame: string; level: number; role: string } | null>("get_player_clan", { p_username: name });

// ---------- Land & regionale Ranglisten ----------

export interface MyCountry {
  country: string | null;
  hidden: boolean;
  changed_at: string | null;
  next_change_at: string | null;
  fix_until: string | null;
  can_change: boolean;
}

export const getMyCountry = () => call<MyCountry>("get_my_country");
export const setCountry = (code: string | null) => call<MyCountry>("set_country", { p_code: code ?? "" });
export const setCountryHidden = (hidden: boolean) => call<MyCountry>("set_country_hidden", { p_hidden: hidden });
export const getTrophyRegionBoard = (country: string | null, limit = 100) =>
  call<TrophyBoard>("get_trophy_region_board", { p_country: country ?? "", p_limit: limit });

// ---------- Rechtliches, Konto, Moderation ----------

export interface MyTerms {
  accepted: boolean;
  accepted_at: string | null;
  under16: boolean | null;
  banned_until: string | null;
  ban_reason: string | null;
  warning: string | null;
  warning_at: string | null;
  is_admin: boolean;
}

export const getMyTerms = () => call<MyTerms>("get_my_terms");
export const acceptTerms = (age: number, parentOk: boolean) => call<MyTerms>("accept_terms", { p_age: age, p_parent_ok: parentOk });
export const exportMyData = () => call<Record<string, unknown>>("export_my_data");
export const reportPlayer = (name: string, kind: "name" | "avatar" | "highscore" | "other", game: string | null = null, detail = "") =>
  call<{ ok: boolean }>("report_player", { p_username: name, p_kind: kind, p_game: game, p_detail: detail });

export interface AdminOverview {
  players: number;
  clans: number;
  open_chat: number;
  open_players: number;
  open_runs: number;
  banned: number;
}
export interface AdminReports {
  chat: { id: number; body: string; hidden: boolean; at: string; username: string | null; clan: string | null; reports: number; reasons: string[]; banned: boolean }[];
  players: { id: number; kind: string; game: string | null; detail: string; at: string; target: string; reporter: string | null; avatar: string | null; warnings: number; banned: boolean; same_reports: number }[];
  runs: { id: string; game: string; stage: number; score: number; flagged: string; at: string; username: string; banned: boolean }[];
}
export interface AdminPlayer {
  username: string;
  trophies: number;
  league: string;
  country: string | null;
  created_at: string;
  warnings: number;
  last_warning: string | null;
  banned_until: string | null;
  ban_reason: string | null;
  has_avatar: boolean;
  avatar: string | null;
  clan: { id: string; name: string } | null;
  reports: number;
  chat_reports: number;
}
export const isAdmin = () => call<boolean>("is_admin");
export const adminOverview = () => call<AdminOverview>("admin_overview");
export const adminReports = () => call<AdminReports>("admin_reports");
export const adminMessageContext = (id: number) =>
  call<{ id: number; username: string | null; body: string; kind: string; hidden: boolean; at: string; is_target: boolean }[]>("admin_message_context", { p_id: id });
export const adminResolveMessage = (id: number, hide: boolean) => call<AdminOverview>("admin_resolve_message", { p_id: id, p_hide: hide });
export const adminResolveReport = (id: number, status: "done" | "dismissed") => call<AdminOverview>("admin_resolve_report", { p_id: id, p_status: status });
export const adminResolveRun = (id: string, valid: boolean) => call<AdminOverview>("admin_resolve_run", { p_id: id, p_valid: valid });
export const adminBan = (name: string, hours: number, reason: string) => call<AdminPlayer>("admin_ban", { p_username: name, p_hours: hours, p_reason: reason });
export const adminWarn = (name: string, reason: string) => call<AdminPlayer>("admin_warn", { p_username: name, p_reason: reason });
export const adminResetName = (name: string) => call<AdminPlayer>("admin_reset_name", { p_username: name });
export const adminResetAvatar = (name: string) => call<AdminPlayer>("admin_reset_avatar", { p_username: name });
export const adminResetClan = (id: string) => call<unknown>("admin_reset_clan", { p_clan: id });
export const adminPlayer = (name: string) => call<AdminPlayer | null>("admin_player", { p_username: name });
export const adminSearch = (q: string) => call<{ username: string; warnings: number; banned: boolean; league: string }[]>("admin_search", { p_query: q });
export const adminWords = () => call<{ word: string; active: boolean; at: string }[]>("admin_words");
export const adminSetWord = (word: string, active: boolean) => call<{ word: string; active: boolean; at: string }[]>("admin_set_word", { p_word: word, p_active: active });

// ---------- Push-Erinnerungen ----------
export interface PushSettings {
  public_key: string | null;
  devices: number;
  remind_hour: number;
}
export const getPushSettings = () => call<PushSettings>("get_push_settings");
export const savePushSub = (endpoint: string, p256dh: string, auth: string, tz: string, hour: number) =>
  call<PushSettings>("save_push_sub", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_tz: tz, p_hour: hour });
export const removePushSub = (endpoint: string | null) => call<PushSettings>("remove_push_sub", { p_endpoint: endpoint });
export const markDailyPlayed = (day: number, streak: number) => call<null>("mark_daily_played", { p_day: day, p_streak: streak });

// ---------- Season Pass, Shop, Sammlung (supabase/seasonpass.sql) ----------

export const getSeasonPass = () => call<SeasonPass>("get_season_pass");
export const claimSeasonReward = (level: number | null = null, track: "free" | "premium" | null = null) =>
  call<SeasonPass>("claim_season_reward", { p_level: level, p_track: track });
export const getSeasonPing = () => call<SeasonPing>("get_season_ping");
export const getShop = () => call<Shop>("get_shop");
export const buyShopItem = (item: string, currency: "coins" | "gems") => call<Shop>("buy_shop_item", { p_item: item, p_currency: currency });
export const buyProductTest = (product: string) => call<Shop & { purchase_id: string; product: string }>("buy_product_test", { p_product: product });
export const getMyCosmetics = () => call<Cosmetics>("get_my_cosmetics");
export const equipCosmetic = (kind: Exclude<ItemKind, "emote">, item: string | null) => call<Cosmetics>("equip_cosmetic", { p_kind: kind, p_item: item });
export const getPlayerCosmetics = (name: string) => call<Equipped>("get_player_cosmetics", { p_username: name });
export const claimReferral = (name: string) => call<{ ok: boolean }>("claim_referral", { p_username: name });

export interface AdminSeason {
  id: number;
  num: number;
  name: string;
  starts_at: string;
  ends_at: string;
  levels: number;
  level_xp: number;
  players: number;
  premium: number;
  rewards: number;
}
export interface AdminShopRow {
  item_id: string;
  price_coins: number | null;
  price_gems: number | null;
  always: boolean;
  active: boolean;
  today: boolean;
}
export interface AdminProduct {
  id: string;
  name: string;
  price_cents: number;
  gems: number;
  coins: number;
  item_ids: string[];
  once: boolean;
  active: boolean;
  apple_id: string | null;
  google_id: string | null;
}
export interface AdminPassOverview {
  current: number;
  seasons: AdminSeason[];
  items: (Item & { active: boolean; owners: number })[];
  shop: AdminShopRow[];
  products: AdminProduct[];
  settings: { test_purchases: "off" | "admins" | "all" };
  stats: { test_purchases: number; real_purchases: number; real_revenue_cents: number };
}
export interface AdminReward {
  level: number;
  track: "free" | "premium";
  item_id: string | null;
  coins: number;
  gems: number;
}
export const adminPassOverview = () => call<AdminPassOverview>("admin_sp_overview");
export const adminPassRewards = (season: number) => call<AdminReward[]>("admin_sp_rewards", { p_season: season });
export const adminPassSetReward = (season: number, level: number, track: string, item: string | null, coins: number, gems: number) =>
  call<AdminReward[]>("admin_sp_set_reward", { p_season: season, p_level: level, p_track: track, p_item: item, p_coins: coins, p_gems: gems });
export const adminPassCreateSeason = (name: string, startsAt: string, weeks: number) =>
  call<AdminPassOverview>("admin_sp_create_season", { p_name: name, p_starts_at: startsAt, p_weeks: weeks });
export const adminPassUpdateSeason = (id: number, name: string, endsAt: string) =>
  call<AdminPassOverview>("admin_sp_update_season", { p_id: id, p_name: name, p_ends_at: endsAt });
export const adminPassSaveItem = (id: string, kind: string, name: string, rarity: string, data: unknown, active: boolean) =>
  call<AdminPassOverview>("admin_sp_save_item", { p_id: id, p_kind: kind, p_name: name, p_rarity: rarity, p_data: data, p_active: active });
export const adminPassSetShop = (item: string, coins: number | null, gems: number | null, always: boolean, active: boolean) =>
  call<AdminPassOverview>("admin_sp_set_shop", { p_item: item, p_price_coins: coins, p_price_gems: gems, p_always: always, p_active: active });
export const adminPassSetProduct = (id: string, name: string, priceCents: number, gems: number, coins: number, active: boolean) =>
  call<AdminPassOverview>("admin_sp_set_product", { p_id: id, p_name: name, p_price_cents: priceCents, p_gems: gems, p_coins: coins, p_active: active });
export const adminPassSetSetting = (key: string, value: string) => call<AdminPassOverview>("admin_sp_set_setting", { p_key: key, p_value: value });
