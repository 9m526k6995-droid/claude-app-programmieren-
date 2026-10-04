// Trophäen-System: Ligen, Meilensteine, Berechnung, Schwierigkeit.
// Reine Logik ohne DOM – deshalb gut testbar. Die verbindliche Berechnung macht der Server
// (supabase/trophies.sql → finish_trophy_round). Diese Datei rechnet identisch, damit die
// Live-Anzeige während der Runde genau das zeigt, was der Server am Ende gutschreibt.

export const MAX_TROPHIES = 20000;
export const TROPHY_TASKS = 15;

export const POINTS = {
  correct: 10,
  veryFast: 3,
  fast: 2,
  wrong: -8,
  timeout: -8,
  /** Serienbonus bei genau 5, 10 und 15 richtigen Antworten am Stück */
  streak: { 5: 5, 10: 10, 15: 15 } as Record<number, number>,
};

export interface League {
  id: string;
  name: string;
  min: number;
  emoji: string;
  color: string;
}

/** Reihenfolge = aufsteigend. Die IDs entsprechen der Spalte profiles.league in der Datenbank. */
export const LEAGUES: League[] = [
  { id: "anfaenger", name: "Anfänger", min: 0, emoji: "🌱", color: "#8fd694" },
  { id: "bronze", name: "Bronze", min: 1000, emoji: "🥉", color: "#d9925b" },
  { id: "silber", name: "Silber", min: 2500, emoji: "🥈", color: "#c9d2e3" },
  { id: "gold", name: "Gold", min: 5000, emoji: "🥇", color: "#ffd23d" },
  { id: "platin", name: "Platin", min: 8000, emoji: "💠", color: "#7fe7e0" },
  { id: "diamant", name: "Diamant", min: 12000, emoji: "💎", color: "#7fb4ff" },
  { id: "meister", name: "Meister", min: 16000, emoji: "👑", color: "#c79bff" },
  { id: "legende", name: "Legende", min: 20000, emoji: "🏆", color: "#ff7ab6" },
];

export function clampTrophies(t: number): number {
  return Math.max(0, Math.min(MAX_TROPHIES, Math.round(t)));
}

export function leagueFor(trophies: number): League {
  const t = clampTrophies(trophies);
  let l = LEAGUES[0];
  for (const x of LEAGUES) if (t >= x.min) l = x;
  return l;
}

export function leagueById(id: string | null | undefined): League {
  return LEAGUES.find((l) => l.id === id) ?? LEAGUES[0];
}

/** Meilensteine: bis 5.000 alle 500, danach alle 1.000 bis 20.000. */
export const MILESTONES: number[] = [
  ...Array.from({ length: 11 }, (_, i) => i * 500),
  ...Array.from({ length: 15 }, (_, i) => 6000 + i * 1000),
];

/** Zwischen welchen Meilensteinen liegt der Spieler, und wie weit ist er (0..1)? */
export function milestoneProgress(trophies: number): { from: number; to: number; ratio: number } {
  const t = clampTrophies(trophies);
  if (t >= MAX_TROPHIES) return { from: MAX_TROPHIES, to: MAX_TROPHIES, ratio: 1 };
  let from = 0;
  for (const m of MILESTONES) if (t >= m) from = m;
  const to = MILESTONES[MILESTONES.indexOf(from) + 1];
  return { from, to, ratio: (t - from) / (to - from) };
}

export function formatTrophies(n: number): string {
  return Math.round(n).toLocaleString("de-DE");
}

export function formatDelta(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${formatTrophies(Math.abs(n))}`;
}

// ---------- Berechnung ----------

export type Tier = 0 | 1 | 2; // 0 normal, 1 schnell, 2 sehr schnell

export interface TaskResult {
  game: string;
  ok: boolean;
  timeout: boolean;
  tier: Tier;
  /** gemessene Antwortzeit bzw. Präzision in ms (für spätere Plausibilitätsprüfungen) */
  ms: number;
}

export interface TaskScore {
  delta: number;
  streak: number;
  streakBonus: number;
  speedBonus: number;
  label: string;
}

export interface RoundScore {
  base: number;
  speed: number;
  streakBonus: number;
  penalty: number;
  raw: number;
  correct: number;
  wrong: number;
  bestStreak: number;
  steps: TaskScore[];
}

export function scoreRound(tasks: TaskResult[]): RoundScore {
  const r: RoundScore = { base: 0, speed: 0, streakBonus: 0, penalty: 0, raw: 0, correct: 0, wrong: 0, bestStreak: 0, steps: [] };
  let streak = 0;
  for (const t of tasks) {
    if (t.ok && !t.timeout) {
      const speedBonus = t.tier === 2 ? POINTS.veryFast : t.tier === 1 ? POINTS.fast : 0;
      streak += 1;
      const sb = POINTS.streak[streak] ?? 0;
      r.correct += 1;
      r.base += POINTS.correct;
      r.speed += speedBonus;
      r.streakBonus += sb;
      r.bestStreak = Math.max(r.bestStreak, streak);
      r.steps.push({
        delta: POINTS.correct + speedBonus + sb,
        streak,
        streakBonus: sb,
        speedBonus,
        label: t.tier === 2 ? "BLITZ!" : t.tier === 1 ? "SCHNELL!" : "",
      });
    } else {
      streak = 0;
      r.wrong += 1;
      r.penalty += -POINTS.wrong;
      r.steps.push({ delta: POINTS.wrong, streak: 0, streakBonus: 0, speedBonus: 0, label: t.timeout ? "ZEIT UM" : "" });
    }
  }
  r.raw = r.base + r.speed + r.streakBonus - r.penalty;
  return r;
}

/** Speed-Stufe aus gemessener Zeit und den Grenzen des Minispiels. */
export function tierFor(ms: number, limits: { veryFast: number; fast: number }): Tier {
  if (ms <= limits.veryFast) return 2;
  if (ms <= limits.fast) return 1;
  return 0;
}

// ---------- Schwierigkeit ----------

/** Level-Spanne (0 = leicht, 1 = schwer) je nach Trophäenstand. Nutzt die eingebauten Stufen der Minispiele. */
export function difficultyRange(trophies: number): [number, number] {
  const t = clampTrophies(trophies);
  if (t < 2500) return [0, 0.35]; // leicht
  if (t < 8000) return [0.15, 0.55]; // leicht bis mittel
  if (t < 12000) return [0.35, 0.7]; // mittel
  if (t < 16000) return [0.5, 0.85]; // mittel bis schwer
  return [0.65, 1]; // schwer
}

export function difficultyLabel(trophies: number): string {
  const t = clampTrophies(trophies);
  if (t < 2500) return "leicht";
  if (t < 8000) return "leicht bis mittel";
  if (t < 12000) return "mittel";
  if (t < 16000) return "mittel bis schwer";
  return "schwer";
}

/** Level der i-ten Aufgabe: steigt innerhalb der Runde vom Minimum zum Maximum der Spanne. */
export function levelFor(trophies: number, i: number, n = TROPHY_TASKS): number {
  const [lo, hi] = difficultyRange(trophies);
  return lo + (hi - lo) * (n <= 1 ? 0 : i / (n - 1));
}
