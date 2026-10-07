// Season Pass & Shop: Datentypen und kleine, testbare Helfer (Preise, Farben, Item-Vorschau).
// Alles hier ist rein kosmetisch – nichts davon hat Einfluss auf Trophäen, Ligen oder Punkte.

import { esc } from "./ui";

export type ItemKind = "skin" | "frame" | "avatar" | "title" | "namecolor" | "emote" | "victory";
export type Rarity = "common" | "rare" | "epic" | "legendary";

export interface ItemData {
  a?: string;
  b?: string;
  c1?: string;
  c2?: string;
  bg?: string;
  anim?: boolean;
  e?: string | string[];
  t?: string;
}

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  rarity: Rarity;
  data: ItemData;
  exclusive?: boolean;
}

export interface Reward {
  level: number;
  track: "free" | "premium";
  item: Item | null;
  coins: number;
  gems: number;
  claimed: boolean;
}

export interface Quest {
  key: string;
  title: string;
  metric: string;
  goal: number;
  progress: number;
  xp: number;
  coins: number;
  done: boolean;
}

export interface Wallet {
  coins: number;
  gems: number;
}

export interface SeasonPass {
  season: { id: number; num: number; name: string; starts_at: string; ends_at: string; levels: number; level_xp: number };
  xp: number;
  level: number;
  premium: boolean;
  rewards: Reward[];
  quests: { daily: Quest[]; weekly: Quest[]; daily_ends: string; weekly_ends: string };
  wallet: Wallet;
  pass_price_cents: number | null;
  can_buy: boolean;
}

export interface ShopItem extends Item {
  price_coins: number | null;
  price_gems: number | null;
  always: boolean;
  owned: boolean;
}

export interface Product {
  id: string;
  name: string;
  price_cents: number;
  gems: number;
  coins: number;
  items: Item[];
  once: boolean;
  owned: boolean;
}

export interface Shop {
  day: string;
  ends_at: string;
  items: ShopItem[];
  products: Product[];
  wallet: Wallet;
  test_mode: "off" | "admins" | "all";
  can_buy: boolean;
  season: string;
}

export interface Equipped {
  skin: Item | null;
  frame: Item | null;
  avatar: Item | null;
  title: Item | null;
  namecolor: Item | null;
  victory: Item | null;
}

export interface Cosmetics {
  items: (Item & { source: string; acquired_at: string })[];
  equipped: Equipped;
  wallet: Wallet;
}

export interface SeasonPing {
  xp: number;
  quests: number;
  level: number;
  old_level: number;
  season: string;
}

export const KIND_LABEL: Record<ItemKind, string> = {
  skin: "Skin",
  frame: "Rahmen",
  avatar: "Profilbild",
  title: "Titel",
  namecolor: "Namensfarbe",
  emote: "Emote",
  victory: "Siegesanimation",
};

export const KIND_ORDER: ItemKind[] = ["skin", "avatar", "frame", "namecolor", "title", "victory", "emote"];

export const RARITY_LABEL: Record<Rarity, string> = { common: "Normal", rare: "Selten", epic: "Episch", legendary: "Legendär" };

/** Nur echte Hex-Farben durchlassen (Schutz vor CSS-Tricks, der Server prüft das auch). */
export function safeColor(c: unknown, fallback = "#a45cff"): string {
  return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
}

/** Ein Emoji/kurzer Text aus Item-Daten – ohne HTML-Zeichen. */
export function safeEmoji(e: unknown, fallback = "✨"): string {
  const s = Array.isArray(e) ? e[0] : e;
  return typeof s === "string" && s.length > 0 && s.length <= 12 && !/[<>&"'\\]/.test(s) ? s : fallback;
}

export function emojiList(e: unknown): string[] {
  const arr = Array.isArray(e) ? e : [e];
  const out = arr.map((x) => safeEmoji(x, "")).filter(Boolean);
  return out.length ? out : ["✨"];
}

/** 499 → "4,99 €" */
export function euro(cents: number): string {
  return `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** 1100 → "1.100" */
export function num(n: number): string {
  return Math.round(n).toLocaleString("de-DE");
}

/**
 * Ungefährer Euro-Wert von Gems – damit man immer sieht, was etwas "in echt" kostet.
 * Grundlage: das mittlere Paket (500 Gems für 4,99 € → rund 1 Cent pro Gem).
 */
export function gemsInEuro(gems: number, products: { id: string; gems: number; price_cents: number }[] = []): string {
  const ref = products.find((p) => p.id === "gems_m" && p.gems > 0) ?? { gems: 500, price_cents: 499 };
  return euro(Math.max(1, Math.round((gems * ref.price_cents) / ref.gems)));
}

/** Stufe aus XP (Stufe 0 bis max) */
export function levelOf(xp: number, levelXp: number, levels: number): number {
  if (levelXp <= 0) return 0;
  return Math.max(0, Math.min(levels, Math.floor(xp / levelXp)));
}

/** "noch 3 T 4 Std" / "noch 5 Std 12 Min" / "noch 3 Min" */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!(ms > 0)) return "endet gleich";
  const min = Math.floor(ms / 60000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `noch ${d} T ${h} Std`;
  if (h > 0) return `noch ${h} Std ${m} Min`;
  return `noch ${Math.max(1, m)} Min`;
}

/** Kleine Vorschau eines Items (Kachel-Inhalt) */
export function itemIcon(it: Item, cls = ""): string {
  const d = it.data ?? {};
  switch (it.kind) {
    case "skin":
      return `<span class="it-ico it-skin ${cls}${d.anim ? " anim" : ""}" style="--a:${safeColor(d.a)};--b:${safeColor(d.b, "#ff3d8b")}"></span>`;
    case "frame":
      return `<span class="it-ico it-frame ${cls}${d.anim ? " anim" : ""}" style="--c1:${safeColor(d.c1)};--c2:${safeColor(d.c2 ?? d.c1)}"><i>👤</i></span>`;
    case "avatar":
      return `<span class="it-ico it-avatar ${cls}" style="--bg:${safeColor(d.bg, "#2f2445")}">${safeEmoji(d.e)}</span>`;
    case "title":
      return `<span class="it-ico it-title ${cls}">🏷️</span>`;
    case "namecolor":
      return `<span class="it-ico it-name ${cls}" style="--c1:${safeColor(d.c1)};--c2:${safeColor(d.c2 ?? d.c1)}">Aa</span>`;
    case "emote":
      return `<span class="it-ico it-emote ${cls}">${safeEmoji(d.e)}</span>`;
    case "victory":
      return `<span class="it-ico it-victory ${cls}">${emojiList(d.e).slice(0, 3).join("")}</span>`;
  }
  return `<span class="it-ico ${cls}">🎁</span>`;
}

/** Inhalt einer Belohnung (Item oder Coins/Gems) als Kachel-Innenleben */
export function rewardInner(r: Pick<Reward, "item" | "coins" | "gems">): { icon: string; label: string } {
  if (r.item) return { icon: itemIcon(r.item), label: esc(r.item.name) };
  if (r.gems) return { icon: `<span class="it-ico it-cur">💎</span>`, label: `${num(r.gems)} Gems` };
  return { icon: `<span class="it-ico it-cur">🪙</span>`, label: `${num(r.coins)} Coins` };
}

/** Stil für einen Namen mit Namensfarbe */
export function nameStyle(nc: Item | null | undefined): string {
  if (!nc) return "";
  const c1 = safeColor(nc.data.c1);
  const c2 = nc.data.c2 ? safeColor(nc.data.c2) : "";
  return c2
    ? `background:linear-gradient(90deg,${c1},${c2});-webkit-background-clip:text;background-clip:text;color:transparent`
    : `color:${c1}`;
}

/** Text für die Aufgabe "Lade einen Freund ein" */
export function inviteText(name: string, url: string): string {
  return `Spiel ZWIP mit mir! ⚡ 10 Blitz-Challenges, jeden Tag neu. Hol dir die App: ${url}${name ? ` (eingeladen von ${name})` : ""}`;
}
