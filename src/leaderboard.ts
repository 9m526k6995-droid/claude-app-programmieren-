// Globale Tages-Bestenliste über Supabase (Free Tier). Ohne Konfiguration bleibt sie aus,
// die Crew-Bestenliste (Freunde über Duell-Links) funktioniert immer – ganz ohne Server.

import { CONFIG, hasGlobalBoard } from "./config";

export interface BoardRow {
  name: string;
  score: number;
  player: string;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  // Neue "publishable" Keys (sb_publishable_…) gehören nur in den apikey-Header.
  // Alte anon-Keys sind JWTs (eyJ…) und dürfen zusätzlich als Bearer mitgehen.
  const isJwt = CONFIG.supabaseAnonKey.startsWith("eyJ");
  return {
    apikey: CONFIG.supabaseAnonKey,
    ...(isJwt ? { Authorization: `Bearer ${CONFIG.supabaseAnonKey}` } : {}),
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function submitScore(entry: {
  day: number;
  name: string;
  deviceId: string;
  player: string;
  score: number;
  rounds: number[];
}): Promise<boolean> {
  if (!hasGlobalBoard) return false;
  try {
    const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/scores`, {
      method: "POST",
      headers: headers({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        day: entry.day,
        name: entry.name.slice(0, 24),
        device_id: entry.deviceId,
        player: entry.player,
        score: entry.score,
        rounds: entry.rounds,
      }),
    });
    // 409 = heute schon eingetragen – zählt trotzdem als Erfolg
    return res.ok || res.status === 409;
  } catch {
    return false;
  }
}

export async function fetchBoard(day: number, limit = 50): Promise<BoardRow[] | null> {
  if (!hasGlobalBoard) return null;
  try {
    const q = `day=eq.${day}&select=name,score,player&order=score.desc,created_at.asc&limit=${limit}`;
    const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/scores?${q}`, { headers: headers() });
    if (!res.ok) return null;
    return (await res.json()) as BoardRow[];
  } catch {
    return null;
  }
}

/** Platz unter allen Spielern heute (über Count-Header, ohne alle Zeilen zu laden). */
export async function fetchRank(day: number, score: number): Promise<{ rank: number; total: number } | null> {
  if (!hasGlobalBoard) return null;
  try {
    const count = async (filter: string) => {
      const res = await fetch(`${CONFIG.supabaseUrl}/rest/v1/scores?day=eq.${day}${filter}&select=player`, {
        method: "HEAD",
        headers: headers({ Prefer: "count=exact", Range: "0-0" }),
      });
      const cr = res.headers.get("content-range");
      return cr ? Number(cr.split("/")[1]) : NaN;
    };
    const [better, total] = await Promise.all([count(`&score=gt.${score}`), count("")]);
    if (!Number.isFinite(better) || !Number.isFinite(total)) return null;
    return { rank: better + 1, total: Math.max(total, better + 1) };
  } catch {
    return null;
  }
}
