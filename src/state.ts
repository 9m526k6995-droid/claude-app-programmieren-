// Lokaler Spielstand. Kein Login nötig – alles liegt erst einmal auf dem Gerät.

export interface DayResult {
  score: number;
  rounds: number[];
}

export interface CrewMember {
  id: string;
  name: string;
  days: Record<number, DayResult>;
  addedAt: number;
}

export interface State {
  v: 1;
  deviceId: string;
  name: string;
  nameSet: boolean;
  muted: boolean;
  daily: Record<number, DayResult>;
  streak: { count: number; last: number; best: number };
  best: { daily: number; free: number; endless: number };
  crew: Record<string, CrewMember>;
  plays: number;
  seen: string[];
}

const KEY = "zwip:v1";
let memoryFallback: string | null = null;

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memoryFallback;
  }
}

function writeRaw(v: string) {
  memoryFallback = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* Privater Modus / Sandbox: dann eben nur im Speicher */
  }
}

const ADJ = ["Flinke", "Wilde", "Turbo", "Neon", "Blitz", "Mega", "Crispy", "Lässige", "Fixe", "Kosmo"];
const NOUN = ["Ente", "Welle", "Gurke", "Rakete", "Möwe", "Kiwi", "Pixel", "Qualle", "Tukan", "Brezel"];

export function randomName(rand: () => number = Math.random): string {
  const a = ADJ[Math.floor(rand() * ADJ.length)];
  const n = NOUN[Math.floor(rand() * NOUN.length)];
  return `${a} ${n} ${10 + Math.floor(rand() * 90)}`;
}

function newId(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function freshState(): State {
  return {
    v: 1,
    deviceId: newId(),
    name: randomName(),
    nameSet: false,
    muted: false,
    daily: {},
    streak: { count: 0, last: -99, best: 0 },
    best: { daily: 0, free: 0, endless: 0 },
    crew: {},
    plays: 0,
    seen: [],
  };
}

export function loadState(): State {
  const raw = readRaw();
  if (!raw) return freshState();
  try {
    const parsed = JSON.parse(raw) as Partial<State>;
    if (parsed.v !== 1) return freshState();
    return { ...freshState(), ...parsed } as State;
  } catch {
    return freshState();
  }
}

export function saveState(s: State) {
  writeRaw(JSON.stringify(s));
}

/** Kurze öffentliche ID (für Duelle). Die echte deviceId bleibt privat. */
export function publicId(s: State): string {
  return s.deviceId.replace(/-/g, "").slice(0, 8);
}

/** Streak, wie er gerade gilt (verfällt, wenn gestern nicht gespielt wurde). */
export function currentStreak(s: State, today: number): number {
  return s.streak.last >= today - 1 ? s.streak.count : 0;
}

/** Speichert ein Daily-Ergebnis. Nur der erste Versuch pro Tag zählt. */
export function recordDaily(s: State, day: number, result: DayResult): boolean {
  if (s.daily[day]) return false;
  s.daily[day] = result;
  if (s.streak.last === day - 1) s.streak.count += 1;
  else if (s.streak.last !== day) s.streak.count = 1;
  s.streak.last = day;
  s.streak.best = Math.max(s.streak.best, s.streak.count);
  s.best.daily = Math.max(s.best.daily, result.score);
  return true;
}

export function addCrewResult(s: State, id: string, name: string, day: number, result: DayResult) {
  if (!id) return;
  const m = s.crew[id] ?? { id, name, days: {}, addedAt: Date.now() };
  m.name = name || m.name;
  m.days[day] = result;
  s.crew[id] = m;
}
