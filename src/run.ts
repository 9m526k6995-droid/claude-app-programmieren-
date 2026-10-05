// Aufbau einer Runde und Punkte – reine Logik, deshalb gut testbar.

import { makeRng, hashStr } from "./rng";

export type Mode = "daily" | "free" | "endless" | "challenge";

export const ROUNDS = 10;
/** Die ursprünglichen 8 Challenges (Daily #1–#4). */
export const CLASSIC_IDS = ["odd", "stop", "wait", "more", "pop", "sum", "ink", "swipe"] as const;
/** Alle Challenges. Neue einfach hinten anhängen und NEW_GAMES_FROM_DAY anpassen. */
export const GAME_IDS = [...CLASSIC_IDS, "find", "memory", "beat", "pattern"] as const;
/** Ab dieser Daily sind die neuen Challenges dabei – ältere Dailies (und Duelle darauf) bleiben exakt gleich. */
export const NEW_GAMES_FROM_DAY = 5;

export function idsForDay(day: number): readonly string[] {
  return day < NEW_GAMES_FROM_DAY ? CLASSIC_IDS : GAME_IDS;
}

export interface RoundSpec {
  gameId: string;
  seed: number;
  level: number;
  /** Nur im Minigame-Lauf: Stufe 1, 2, 3 … */
  stage?: number;
}

/** Reihenfolge: möglichst viele verschiedene Challenges, nie zweimal direkt hintereinander. */
export function buildRounds(seed: number, count = ROUNDS, ids: readonly string[] = GAME_IDS): RoundSpec[] {
  const rng = makeRng(seed);
  const order: string[] = [];
  while (order.length < count) {
    const bag = rng.shuffle(ids);
    if (order.length && bag[0] === order[order.length - 1]) bag.push(bag.shift()!);
    order.push(...bag);
  }
  return order.slice(0, count).map((gameId, i) => ({
    gameId,
    seed: hashStr(`${seed}:${i}:${gameId}`),
    level: count <= 1 ? 0 : Math.min(1, i / (count - 1)),
  }));
}

/** Für Endlos: weitere Runden nachschieben, Schwierigkeit steigt über ~15 Runden an. */
export function endlessRound(seed: number, i: number, prevId: string | null, ids: readonly string[] = GAME_IDS): RoundSpec {
  const rng = makeRng(hashStr(`${seed}:endless:${i}`));
  let gameId = rng.pick(ids);
  if (gameId === prevId) gameId = ids[(ids.indexOf(gameId) + 1) % ids.length];
  return { gameId, seed: hashStr(`${seed}:e${i}:${gameId}`), level: Math.min(1, i / 15) };
}

/** Punkte pro Runde: 0 bei Fehler, sonst 30–100 je nach Tempo bzw. Präzision. */
export function roundPoints(ok: boolean, elapsedMs: number, limitMs: number, rating?: number): number {
  if (!ok) return 0;
  const speed = rating ?? Math.max(0, Math.min(1, 1 - elapsedMs / limitMs));
  return Math.round(30 + 70 * Math.max(0, Math.min(1, speed)));
}

export type Tile = "perfect" | "good" | "ok" | "fail";

export function tileOf(points: number): Tile {
  if (points <= 0) return "fail";
  if (points >= 86) return "perfect";
  if (points >= 65) return "good";
  return "ok";
}

export const TILE_EMOJI: Record<Tile, string> = { perfect: "🟪", good: "🟩", ok: "🟨", fail: "🟥" };

export function verdict(score: number): string {
  if (score >= 900) return "Unmenschlich ⚡";
  if (score >= 800) return "Blitzartig!";
  if (score >= 680) return "Richtig stark";
  if (score >= 540) return "Solide!";
  if (score >= 380) return "Warm geworden";
  return "Morgen kommt Revanche";
}
