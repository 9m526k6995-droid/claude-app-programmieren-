// Clan-Bausteine: Freischaltungen pro Level, Schnellnachrichten, Level-Formel und kleine HTML-Helfer.
// Die Listen müssen zu supabase/clans.sql passen (zwip_clan_unlock_level, zwip_quick_message) – ein Unit-Test prüft das.

import { esc } from "./ui";

export const CLAN_MAX = 500;

export const EMBLEMS: { e: string; lvl: number }[] = [
  ...["🛡️", "⚔️", "🔥", "⚡", "🐺", "🦊"].map((e) => ({ e, lvl: 1 })),
  ...["🐉", "🦅", "💀", "👑"].map((e) => ({ e, lvl: 3 })),
  ...["🌪️", "🌋", "🦁", "🐍"].map((e) => ({ e, lvl: 5 })),
  ...["💎", "🚀", "🪐"].map((e) => ({ e, lvl: 8 })),
  ...["🏆", "🌟", "🔱"].map((e) => ({ e, lvl: 12 })),
];

export const COLORS: { c: string; lvl: number; name: string }[] = [
  { c: "#a45cff", lvl: 1, name: "Lila" },
  { c: "#ff3d8b", lvl: 1, name: "Pink" },
  { c: "#3d7bff", lvl: 1, name: "Blau" },
  { c: "#22c36b", lvl: 1, name: "Grün" },
  { c: "#ff8a3d", lvl: 2, name: "Orange" },
  { c: "#ffd23d", lvl: 2, name: "Gelb" },
  { c: "#25d9e8", lvl: 2, name: "Türkis" },
  { c: "#ff3d5a", lvl: 4, name: "Rot" },
  { c: "#c6ff3d", lvl: 4, name: "Neon" },
  { c: "#ffffff", lvl: 4, name: "Weiß" },
  { c: "#111111", lvl: 7, name: "Schwarz" },
  { c: "#b8860b", lvl: 7, name: "Gold" },
];

export const FRAMES: { f: string; lvl: number; name: string }[] = [
  { f: "none", lvl: 1, name: "Ohne" },
  { f: "silver", lvl: 5, name: "Silber" },
  { f: "gold", lvl: 10, name: "Gold" },
  { f: "diamond", lvl: 15, name: "Diamant" },
  { f: "legend", lvl: 20, name: "Legende" },
];

export const QUICK_MESSAGES = ["GG! 🎉", "Wer spielt mit? 🎮", "Los, Clan-Challenge! 💪", "Neuer Rekord! 🏆", "Gute Nacht 🌙", "Danke! 🙌", "Wir schaffen das! 🔥"];

export const JOIN_MODES: { m: "open" | "request" | "invite"; label: string; hint: string }[] = [
  { m: "open", label: "Offen", hint: "Jeder kann sofort beitreten" },
  { m: "request", label: "Auf Anfrage", hint: "Der Leiter nimmt Anfragen an" },
  { m: "invite", label: "Nur Einladung", hint: "Nur wer eingeladen wird" },
];

/** Level L braucht 1000·(L−1)² XP, höchstens Level 50 (wie zwip_clan_level) */
export function clanLevel(xp: number): number {
  return Math.min(50, Math.floor(Math.sqrt(Math.max(0, xp) / 1000)) + 1);
}

export function levelXp(level: number): number {
  return 1000 * (level - 1) ** 2;
}

/** Was wird mit diesem Level neu freigeschaltet? */
export function unlocksAt(level: number): string[] {
  const out: string[] = [];
  EMBLEMS.filter((x) => x.lvl === level).forEach((x) => out.push(x.e));
  COLORS.filter((x) => x.lvl === level).forEach((x) => out.push(`Farbe ${x.name}`));
  FRAMES.filter((x) => x.lvl === level && x.f !== "none").forEach((x) => out.push(`Rahmen ${x.name}`));
  return out;
}

/** Nächste Level mit Belohnung (für die Vorschau „Als Nächstes“) */
export function nextRewards(level: number, count = 3): { level: number; items: string[] }[] {
  const res: { level: number; items: string[] }[] = [];
  for (let l = level + 1; l <= 50 && res.length < count; l++) {
    const items = unlocksAt(l);
    if (items.length) res.push({ level: l, items });
  }
  return res;
}

/** Clan-Wappen: Emoji auf Farbe, optional mit Rahmen */
export function emblemHtml(c: { emblem: string; color: string; frame?: string }, size: "s" | "m" | "l" = "m"): string {
  return `<span class="clan-emblem size-${size} frame-${esc(c.frame ?? "none")}" style="--cc:${esc(c.color)}" aria-hidden="true">${esc(c.emblem)}</span>`;
}

export function joinModeLabel(m: string): string {
  return JOIN_MODES.find((x) => x.m === m)?.label ?? m;
}

/** „vor 3 Min.“ / „14:32“ / „Mo 14:32“ */
export function chatTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  const hm = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (diff < 86400 && new Date(now).getDate() === d.getDate()) return hm;
  return `${d.toLocaleDateString("de-DE", { weekday: "short" })} ${hm}`;
}
