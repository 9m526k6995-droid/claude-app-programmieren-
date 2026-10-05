// Punkte für Minigame-Läufe. Genau dieselbe Formel rechnet der Server (supabase/clans.sql → zwip_stage_points).
//   Punkte für Stufe n = 100 + 25·(n−1), sehr schnell +50 %, schnell +25 %.

export interface Speed {
  veryFast: number;
  fast: number;
}

export function stageBase(n: number): number {
  return 100 + 25 * (Math.max(1, Math.floor(n)) - 1);
}

export function stagePoints(n: number, t: number, speed: Speed): number {
  const mult = t <= speed.veryFast ? 1.5 : t <= speed.fast ? 1.25 : 1;
  return Math.round(stageBase(n) * mult);
}

export function runScore(steps: { ok: boolean; t: number }[], speed: Speed): number {
  let sum = 0;
  steps.forEach((s, i) => {
    if (s.ok) sum += stagePoints(i + 1, s.t, speed);
  });
  return sum;
}

/** Alte Bestwerte (nur Stufen) → Punkte ohne Tempo-Bonus */
export function scoreFromStage(stage: number): number {
  return stage > 0 ? stage * 100 + (25 * stage * (stage - 1)) / 2 : 0;
}

export function fmtScore(n: number): string {
  return Math.round(n).toLocaleString("de-DE");
}
