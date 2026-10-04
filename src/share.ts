// Teilen: Emoji-Text für WhatsApp, Duell-Links und Story-Bilder für TikTok/Instagram.

import { tileOf, TILE_EMOJI, type Mode } from "./run";

export interface ChallengePayload {
  v: 1;
  /** Name */
  n: string;
  /** öffentliche Spieler-ID */
  i: string;
  /** "d" = Daily, "t" = Training mit Seed */
  m: "d" | "t";
  /** Daily-Nummer */
  d?: number;
  /** Seed für Training */
  z?: number;
  /** Punkte pro Runde */
  r: number[];
}

function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeChallenge(p: ChallengePayload): string {
  return b64urlEncode(JSON.stringify(p));
}

export function decodeChallenge(code: string): ChallengePayload | null {
  try {
    const p = JSON.parse(b64urlDecode(code.trim())) as ChallengePayload;
    if (p.v !== 1 || !Array.isArray(p.r) || p.r.length < 1 || p.r.length > 10) return null;
    if (!p.r.every((x) => Number.isInteger(x) && x >= 0 && x <= 100)) return null;
    if (p.m === "d" && !Number.isInteger(p.d)) return null;
    if (p.m === "t" && !Number.isInteger(p.z)) return null;
    if (p.m !== "d" && p.m !== "t") return null;
    p.n = String(p.n ?? "Jemand").slice(0, 24);
    p.i = String(p.i ?? "").slice(0, 16);
    return p;
  } catch {
    return null;
  }
}

/** Nimmt einen ganzen Link oder nur den Code entgegen. */
export function extractChallengeCode(input: string): string | null {
  const s = input.trim();
  const m = s.match(/[?&#]c=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

export function sumPoints(r: number[]): number {
  return r.reduce((a, b) => a + b, 0);
}

export function gridText(rounds: number[]): string {
  const tiles = rounds.map((p) => TILE_EMOJI[tileOf(p)]);
  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += 5) rows.push(tiles.slice(i, i + 5).join(""));
  return rows.join("\n");
}

export function shareText(opts: {
  mode: Mode;
  day?: number;
  score: number;
  rounds: number[];
  streak?: number;
  endlessRounds?: number;
  link?: string;
  vs?: { name: string; score: number };
}): string {
  const lines: string[] = [];
  if (opts.mode === "endless") {
    lines.push(`ZWIP Endlos ⚡ ${opts.endlessRounds} Runden · ${opts.score} Punkte`);
  } else {
    const label = opts.mode === "daily" || (opts.mode === "challenge" && opts.day) ? `#${opts.day}` : "Training";
    lines.push(`ZWIP ${label} ⚡ ${opts.score}/1000`);
    lines.push(gridText(opts.rounds));
  }
  if (opts.vs) {
    const won = opts.score > opts.vs.score;
    lines.push(won ? `Hab ${opts.vs.name} geschlagen (${opts.vs.score}) 😎` : `${opts.vs.name} war besser (${opts.vs.score}) – Revanche!`);
  }
  if (opts.streak && opts.streak > 1) lines.push(`🔥 ${opts.streak} Tage am Stück`);
  if (opts.link) lines.push(opts.link.startsWith("http") ? `Schlag mich: ${opts.link}` : opts.link);
  return lines.join("\n");
}

export function buildLink(base: string, code?: string): string {
  const url = base.split("?")[0].split("#")[0];
  return code ? `${url}?c=${code}` : url;
}

/** Story-Bild 1080×1920 für TikTok/Instagram. */
export async function storyImage(opts: {
  title: string;
  score: number;
  rounds: number[];
  verdict: string;
  streak: number;
  url: string;
}): Promise<Blob | null> {
  const W = 1080,
    H = 1920;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#6a2cff");
  grad.addColorStop(0.55, "#ff3d8b");
  grad.addColorStop(1, "#ffb03d");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // Deko-Kreise
  g.globalAlpha = 0.14;
  g.fillStyle = "#fff";
  [
    [160, 260, 180],
    [940, 520, 120],
    [880, 1600, 220],
    [120, 1500, 90],
  ].forEach(([x, y, r]) => {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  });
  g.globalAlpha = 1;

  const font = (size: number, weight = 800) =>
    `${weight} ${size}px "Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = "center";

  // Logo als Sticker
  g.save();
  g.translate(W / 2, 330);
  g.rotate(-0.06);
  g.font = font(230, 900);
  g.fillStyle = "#16101f";
  g.fillText("ZWIP", 12, 14);
  g.fillStyle = "#fff";
  g.fillText("ZWIP", 0, 0);
  g.restore();

  g.fillStyle = "rgba(255,255,255,.92)";
  g.font = font(54, 700);
  g.fillText(opts.title, W / 2, 470);

  g.font = font(300, 900);
  g.fillStyle = "#fff";
  g.fillText(String(opts.score), W / 2, 820);
  g.font = font(60, 800);
  g.fillText(opts.verdict, W / 2, 920);

  const colors: Record<string, string> = { perfect: "#a45cff", good: "#22c36b", ok: "#ffc61a", fail: "#ff3d5a" };
  const size = 150,
    gap = 22;
  const cols = 5;
  const startX = (W - (cols * size + (cols - 1) * gap)) / 2;
  opts.rounds.forEach((p, i) => {
    const x = startX + (i % cols) * (size + gap);
    const y = 1030 + Math.floor(i / cols) * (size + gap);
    g.fillStyle = "rgba(22,16,31,.35)";
    roundRect(g, x + 6, y + 10, size, size, 34);
    g.fill();
    g.fillStyle = colors[tileOf(p)];
    roundRect(g, x, y, size, size, 34);
    g.fill();
    g.fillStyle = "#fff";
    g.font = font(54, 900);
    g.fillText(String(p), x + size / 2, y + size / 2 + 19);
  });

  if (opts.streak > 1) {
    g.font = font(64, 800);
    g.fillStyle = "#fff";
    g.fillText(`🔥 ${opts.streak} Tage Streak`, W / 2, 1490);
  }

  g.fillStyle = "#16101f";
  roundRect(g, 140, 1600, W - 280, 150, 75);
  g.fill();
  g.fillStyle = "#fff";
  g.font = font(54, 800);
  g.fillText("Schaffst du mehr?", W / 2, 1670);
  g.font = font(34, 600);
  g.fillStyle = "rgba(255,255,255,.75)";
  g.fillText(opts.url.replace(/^https?:\/\//, "").slice(0, 46), W / 2, 1722);

  return new Promise((res) => c.toBlob((b) => res(b), "image/png"));
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
