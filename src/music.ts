// Hintergrundmusik: lockerer, gut gelaunter Chill-Hop-Groove – entspannt, aber mit Drive (kein Schlaflied).
// Komplett live per Web Audio erzeugt (keine Dateien, keine Rechte-Fragen).
// C-Dur wie der ZWIP-Sound. Akkordfolgen und Melodie-Bausteine wechseln zufällig, damit es nie nach Schleife klingt.
//
// Aufbau: Pro Takt werden ein paar Töne vorausgeplant (Lookahead), danach rechnet der Browser selbst –
// das ist sparsam mit Akku und läuft auch auf älteren Handys flüssig.

export type MusicMode = "menu" | "round" | "rhythm";

export const BPM = 104;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// ---------- Harmonie (reine Funktionen, auch für Tests) ----------


/** Akkorde als Halbtöne über C (Grundton zuerst) */
export const CHORDS: Record<string, number[]> = {
  C: [0, 4, 7, 12],
  Cadd9: [0, 4, 7, 14],
  G: [7, 11, 14, 19],
  Gsus: [7, 12, 14, 19],
  Am7: [9, 12, 16, 19],
  F: [5, 9, 12, 17],
  Fmaj7: [5, 9, 12, 16],
  Dm7: [2, 5, 9, 12],
  Em7: [4, 7, 11, 14],
};

/** Gut gelaunte Pop-Akkordfolgen (je 4 Takte) */
export const PROGRESSIONS: string[][] = [
  ["C", "G", "Am7", "F"],
  ["Am7", "F", "C", "G"],
  ["F", "G", "Em7", "Am7"],
  ["C", "Em7", "F", "G"],
  ["Fmaj7", "G", "C", "Am7"],
  ["Cadd9", "Am7", "Dm7", "Gsus"],
];

/** Dur-Pentatonik (C D E G A) – klingt zu jedem Akkord oben gut */
export const PENTA = [0, 2, 4, 7, 9];

/** Melodie-Bausteine: [Beat im Takt (0–3.5), Stufe in der Pentatonik, Länge in Beats] – kurze, eingängige Hooks */
export const MOTIFS: [number, number, number][][] = [
  [[0, 2, 0.5], [0.5, 3, 0.5], [1, 4, 0.5], [1.5, 3, 0.5], [2, 2, 1]],
  [[0, 4, 0.5], [0.75, 4, 0.25], [1, 5, 0.5], [2, 4, 0.5], [2.5, 3, 1]],
  [[0.5, 3, 0.5], [1, 4, 0.5], [1.5, 5, 0.5], [2.5, 4, 0.5], [3, 2, 1]],
  [[0, 5, 0.5], [0.5, 4, 0.5], [1, 3, 0.5], [1.5, 2, 0.5], [2, 3, 1.5]],
  [[0, 2, 0.25], [0.25, 2, 0.25], [0.5, 4, 0.5], [1.5, 3, 0.5], [2, 4, 1]],
  [[1, 6, 0.5], [1.5, 5, 0.5], [2, 4, 0.5], [2.5, 5, 0.5], [3, 4, 1]],
  [[0, 3, 0.75], [0.75, 4, 0.75], [1.5, 5, 0.5], [2, 7, 1]],
];

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Nächste Akkordfolge – nie zweimal dieselbe hintereinander */
export function nextProgression(prev: number, rand: () => number = Math.random): number {
  let i = Math.floor(rand() * PROGRESSIONS.length);
  if (i === prev) i = (i + 1 + Math.floor(rand() * (PROGRESSIONS.length - 1))) % PROGRESSIONS.length;
  return i;
}

/** Pentatonik-Stufe → MIDI-Note (ab C5) */
export function pentaMidi(step: number): number {
  const oct = Math.floor(step / PENTA.length);
  return 72 + oct * 12 + PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length];
}

// ---------- Klangerzeugung ----------

interface Layers {
  pad: GainNode;
  arp: GainNode;
  keys: GainNode;
  bass: GainNode;
  beat: GainNode;
  bus: GainNode; // alles zusammen (für Modus und Ducking)
  // Gemeinsame Filter (spart Rechenleistung: nicht pro Ton ein eigener Filter)
  hatF: BiquadFilterNode;
  clapF: BiquadFilterNode;
  arpF: BiquadFilterNode;
  bassF: BiquadFilterNode;
  out: GainNode; // Lautstärke aus den Einstellungen
}

/** Kerngerüst: Layer-Mischpult + warmer Lo-Fi-Filter + sanftes Echo. Funktioniert live und offline (für Hörbeispiele). */
function buildGraph(c: BaseAudioContext, dest: AudioNode): Layers {
  const out = c.createGain();
  out.connect(dest);
  const warm = c.createBiquadFilter();
  warm.type = "lowpass";
  warm.frequency.value = 5200; // frisch, aber ohne schrille Spitzen
  warm.Q.value = 0.4;
  warm.connect(out);
  const bus = c.createGain();
  bus.connect(warm);
  // Echo nur für Keys (luftig, aber leise)
  const echo = c.createDelay(1);
  echo.delayTime.value = BEAT * 0.75;
  const fb = c.createGain();
  fb.gain.value = 0.3;
  const wet = c.createGain();
  wet.gain.value = 0.28;
  echo.connect(fb).connect(echo);
  echo.connect(wet).connect(bus);
  const mk = (to: AudioNode = bus) => {
    const g = c.createGain();
    g.connect(to);
    return g;
  };
  const keys = mk();
  keys.connect(echo);
  const arp = mk();
  arp.connect(echo);
  const beat = mk();
  const bass = mk();
  const filt = (type: BiquadFilterType, freq: number, q: number, to: AudioNode) => {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(to);
    return f;
  };
  return {
    pad: mk(),
    arp,
    keys,
    bass,
    beat,
    bus,
    out,
    hatF: filt("highpass", 8000, 0.5, beat),
    clapF: filt("bandpass", 1500, 0.7, beat),
    arpF: filt("lowpass", 1900, 0.8, arp),
    bassF: filt("lowpass", 520, 0.7, bass),
  };
}

/** Lautstärken der Layer je Modus */
const MIX: Record<MusicMode, { pad: number; arp: number; keys: number; bass: number; beat: number; bus: number }> = {
  menu: { pad: 1, arp: 1, keys: 1, bass: 1, beat: 1, bus: 1 },
  // Runde: Groove bleibt (Puls + Bass + leises Arpeggio), aber ohne Melodie und leiser
  round: { pad: 0.9, arp: 0.35, keys: 0, bass: 0.7, beat: 0.55, bus: 0.55 },
  // Rhythmus-/Timing-Spiele: nur Fläche, kein Beat
  rhythm: { pad: 0.9, arp: 0, keys: 0, bass: 0.3, beat: 0, bus: 0.45 },
};

let noise: AudioBuffer | null = null;
function noiseBuf(c: BaseAudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  const len = Math.floor(c.sampleRate * 0.25);
  noise = c.createBuffer(1, len, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

function env(g: GainNode, t: number, a: number, peak: number, hold: number, r: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.linearRampToValueAtTime(0.0001, t + a + hold + r);
}

function padChord(c: BaseAudioContext, L: Layers, notes: number[], t: number) {
  // Ein Takt Fläche: weiche Dreieck-Töne, langsam ein- und ausgeblendet (überlappen sich)
  for (const n of notes) {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.value = midiToHz(48 + n);
    o.detune.value = (Math.random() - 0.5) * 8;
    const g = c.createGain();
    env(g, t, 0.35, 0.014, BAR - 0.45, 0.6);
    o.connect(g).connect(L.pad);
    o.start(t);
    o.stop(t + BAR + 0.7);
  }
}

function bassNote(c: BaseAudioContext, L: Layers, note: number, t: number, len: number) {
  // Knackiger Bass: Sinus + leicht gefilterter Sägezahn für Biss
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.05, t + len * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(L.bassF);
  const o = c.createOscillator();
  o.type = "triangle";
  o.frequency.value = midiToHz(36 + note);
  o.connect(g);
  o.start(t);
  o.stop(t + len + 0.05);
}

/** Kurzer Pluck für das Arpeggio (gibt Tempo und gute Laune) */
function pluck(c: BaseAudioContext, L: Layers, midi: number, t: number, vol: number) {
  const o = c.createOscillator();
  o.type = "square";
  o.frequency.value = midiToHz(midi);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g).connect(L.arpF);
  o.start(t);
  o.stop(t + 0.22);
}

function bell(c: BaseAudioContext, L: Layers, midi: number, t: number, len: number) {
  // Glöckchen/E-Piano: Sinus + leiser Oberton, schnell abklingend
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.06, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.6, len * BEAT * 1.6));
  g.connect(L.keys);
  for (const [mult, v, type] of [[1, 1, "triangle"], [2.01, 0.25, "sine"]] as [number, number, OscillatorType][]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = midiToHz(midi) * mult;
    const og = c.createGain();
    og.gain.value = v;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + len * BEAT * 1.6 + 0.7);
  }
}

function kick(c: BaseAudioContext, L: Layers, t: number) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.24, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  o.connect(g).connect(L.beat);
  o.start(t);
  o.stop(t + 0.3);
}

function hat(c: BaseAudioContext, L: Layers, t: number, vol: number, snare = false) {
  const s = c.createBufferSource();
  s.buffer = noiseBuf(c);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (snare ? 0.13 : 0.04));
  s.connect(g).connect(snare ? L.clapF : L.hatF);
  s.start(t);
  s.stop(t + 0.2);
}

/** Zustand des Arrangements (welche Akkordfolge, welcher Takt) */
interface Song {
  prog: number;
  groove: number;
  arp: number;
  bar: number; // Takt innerhalb der Folge (0–3)
  barsTotal: number;
  lastMotif: number;
}

/** Bass-Grooves: [Beat, Intervall über dem Grundton, Länge in Beats] – synkopiert, damit es wippt */
const BASS_GROOVES: [number, number, number][][] = [
  [[0, 0, 0.5], [0.75, 0, 0.25], [1.5, 12, 0.5], [2, 0, 0.5], [2.75, 7, 0.25], [3.5, 12, 0.5]],
  [[0, 0, 0.75], [1, 0, 0.5], [1.5, 7, 0.5], [2.5, 0, 0.5], [3, 12, 0.5], [3.5, 7, 0.5]],
  [[0, 0, 0.5], [0.5, 12, 0.25], [1, 0, 0.5], [2, 0, 0.5], [2.5, 12, 0.25], [3, 7, 0.5], [3.5, 5, 0.5]],
];

/** Arpeggio-Muster (Index in die Akkordtöne), 8tel */
const ARPS: number[][] = [
  [0, 1, 2, 3, 2, 1, 2, 3],
  [0, 2, 1, 3, 0, 2, 1, 3],
  [3, 2, 1, 2, 3, 2, 1, 0],
];

/** Plant einen kompletten Takt ab Zeit t */
function scheduleBar(c: BaseAudioContext, L: Layers, song: Song, t: number) {
  if (song.bar === 0 && song.barsTotal > 0) song.prog = nextProgression(song.prog);
  if (song.bar === 0) {
    song.groove = Math.floor(Math.random() * BASS_GROOVES.length);
    song.arp = Math.floor(Math.random() * ARPS.length);
  }
  const chord = CHORDS[PROGRESSIONS[song.prog][song.bar]];
  const root = chord[0] % 12;
  const intro = song.barsTotal < 2; // weicher Einstieg: erst Fläche + Arpeggio, dann der Groove
  const swing = BEAT * 0.04;
  padChord(c, L, chord, t);

  // Arpeggio in 8teln (bringt Tempo rein)
  ARPS[song.arp].forEach((idx, i) => {
    const off = (i % 2 ? swing : 0) + i * BEAT * 0.5;
    pluck(c, L, 60 + chord[idx], t + off, i % 2 ? 0.018 : 0.026);
  });

  if (!intro) {
    for (const [beat, iv, len] of BASS_GROOVES[song.groove]) bassNote(c, L, root + iv, t + beat * BEAT, len * BEAT);
    // Drums: Kick auf 1 und 3 (+ Extra-Kick vor der 3), Clap auf 2 und 4, Hi-Hats in 8teln mit 16tel-Ghosts
    kick(c, L, t);
    kick(c, L, t + BEAT * 1.75);
    kick(c, L, t + BEAT * 2);
    if (song.bar === 3) kick(c, L, t + BEAT * 3.5); // kleiner Schubs ins nächste Pattern
    hat(c, L, t + BEAT, 0.07, true);
    hat(c, L, t + BEAT * 3, 0.07, true);
    for (let i = 0; i < 8; i++) hat(c, L, t + i * BEAT * 0.5 + (i % 2 ? swing : 0), i % 2 ? 0.03 : 0.02);
    if (Math.random() < 0.5) hat(c, L, t + BEAT * 3.75, 0.016);
  }

  // Hook: ab Takt 3 fast immer, im 4er-Block als Frage–Antwort (Takt 1 und 3 gleich, 2 und 4 variiert)
  if (song.barsTotal >= 2 && (song.bar % 2 === 0 || Math.random() < 0.6)) {
    let m: number;
    if (song.bar === 2 && song.lastMotif >= 0) m = song.lastMotif;
    else {
      m = Math.floor(Math.random() * MOTIFS.length);
      if (m === song.lastMotif) m = (m + 1) % MOTIFS.length;
    }
    if (song.bar === 0) song.lastMotif = m;
    for (const [beat, step, len] of MOTIFS[m]) bell(c, L, pentaMidi(step), t + beat * BEAT + (beat % 1 ? swing : 0), len);
  }
  song.bar = (song.bar + 1) % 4;
  song.barsTotal++;
}

function applyMix(L: Layers, mode: MusicMode, t: number, glide: number) {
  const m = MIX[mode];
  for (const k of ["pad", "arp", "keys", "bass", "beat", "bus"] as const) {
    const g = L[k].gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(m[k], t + glide);
  }
}

// ---------- Live-Wiedergabe ----------

const MAX_OUT = 0.6; // Musik bleibt immer deutlich leiser als die Effekte

export interface MusicSettings {
  on: boolean;
  volume: number; // 0–1
}

export function createMusic(initial: MusicSettings) {
  let ctx: AudioContext | null = null;
  let L: Layers | null = null;
  let song: Song = { prog: Math.floor(Math.random() * PROGRESSIONS.length), groove: 0, arp: 0, bar: 0, barsTotal: 0, lastMotif: -1 };
  let nextBarAt = 0;
  let timer = 0;
  let mode: MusicMode = "menu";
  let settings = { ...initial };
  let unlocked = false;
  let duckUntil = 0;

  const level = () => (settings.on ? Math.max(0, Math.min(1, settings.volume)) * MAX_OUT : 0);

  function tick() {
    if (!ctx || !L || ctx.state !== "running") return;
    // Immer gut eine Sekunde vorausplanen
    while (nextBarAt < ctx.currentTime + 1.2) {
      if (nextBarAt < ctx.currentTime) nextBarAt = ctx.currentTime + 0.05;
      scheduleBar(ctx, L, song, nextBarAt);
      nextBarAt += BAR;
    }
  }

  function startLoop() {
    clearInterval(timer);
    timer = window.setInterval(tick, 400);
    tick();
  }

  function fadeOut(then: () => void) {
    if (!ctx || !L) return then();
    const t = ctx.currentTime;
    L.out.gain.cancelScheduledValues(t);
    L.out.gain.setValueAtTime(L.out.gain.value, t);
    L.out.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    window.setTimeout(then, 450);
  }

  function fadeIn(secs = 2.5) {
    if (!ctx || !L) return;
    const t = ctx.currentTime;
    L.out.gain.cancelScheduledValues(t);
    L.out.gain.setValueAtTime(L.out.gain.value, t);
    L.out.gain.linearRampToValueAtTime(level(), t + secs);
  }

  function ensure(): boolean {
    if (ctx) return true;
    try {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new C({ latencyHint: "playback" });
    } catch {
      return false;
    }
    L = buildGraph(ctx, ctx.destination);
    L.out.gain.value = 0.0001;
    applyMix(L, mode, ctx.currentTime, 0.01);
    nextBarAt = ctx.currentTime + 0.1;
    return true;
  }

  function play() {
    if (!unlocked || !settings.on || document.visibilityState === "hidden") return;
    if (!ensure() || !ctx) return;
    void ctx.resume().then(() => {
      startLoop();
      fadeIn();
    });
  }

  function pause() {
    clearInterval(timer);
    if (!ctx) return;
    fadeOut(() => {
      if (ctx && (document.visibilityState === "hidden" || !settings.on)) void ctx.suspend();
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pause();
    else play();
  });
  window.addEventListener("pagehide", () => pause());

  return {
    /** Nach dem ersten Tippen aufrufen (Browser erlauben Ton erst dann) */
    unlock() {
      if (unlocked) return;
      unlocked = true;
      play();
    },
    setMode(m: MusicMode) {
      if (m === mode) return;
      mode = m;
      if (ctx && L) applyMix(L, mode, ctx.currentTime, m === "menu" ? 1.8 : 0.6);
    },
    /** Kurz leiser – damit Ergebnis-Sound und ZWIP-Sound wirken */
    duck(secs = 2.6) {
      if (!ctx || !L || ctx.state !== "running") return;
      const t = ctx.currentTime;
      duckUntil = t + secs;
      const g = L.out.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(level() * 0.2, t + 0.15);
      g.setValueAtTime(level() * 0.2, duckUntil);
      g.linearRampToValueAtTime(level(), duckUntil + 1.5);
    },
    set(s: Partial<MusicSettings>) {
      const wasOn = settings.on;
      settings = { ...settings, ...s };
      if (settings.on && !wasOn) play();
      else if (!settings.on && wasOn) pause();
      else if (ctx && L && ctx.state === "running") fadeIn(0.3);
    },
    get mode() {
      return mode;
    },
  };
}

export type Music = ReturnType<typeof createMusic>;

/** Spiele mit Rhythmus/Timing: nur Fläche, kein Beat */
export const RHYTHM_GAMES = new Set(["beat", "wait", "stop", "clock", "ampel", "stack"]);

// ---------- Offline (Hörbeispiele) ----------

/** Rendert die Musik in einen Offline-Kontext (für Hörbeispiele/Tests) */
export function renderInto(c: BaseAudioContext, seconds: number, segments: { mode: MusicMode; from: number }[]) {
  const L = buildGraph(c, c.destination);
  L.out.gain.setValueAtTime(0.0001, 0);
  L.out.gain.linearRampToValueAtTime(MAX_OUT * 0.5, 2);
  const song: Song = { prog: 0, groove: 0, arp: 0, bar: 0, barsTotal: 0, lastMotif: -1 };
  for (const s of segments) {
    const m = MIX[s.mode];
    for (const k of ["pad", "arp", "keys", "bass", "beat", "bus"] as const) L[k].gain.setValueAtTime(m[k], s.from);
  }
  for (let t = 0.05; t < seconds; t += BAR) scheduleBar(c, L, song, t);
}
