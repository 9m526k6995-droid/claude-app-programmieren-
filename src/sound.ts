// Alle Sounds werden live per Web Audio erzeugt – keine Audiodateien, kein Ladezeit-Overhead.

export interface Sfx {
  tap(): void;
  pop(i?: number): void;
  good(points: number): void;
  bad(): void;
  go(): void;
  tick(): void;
  win(): void;
  setMuted(m: boolean): void;
  unlock(): void;
}

export function createSfx(initiallyMuted: boolean): Sfx {
  let ctx: AudioContext | null = null;
  let muted = initiallyMuted;

  function ac(): AudioContext | null {
    if (muted) return null;
    if (!ctx) {
      try {
        const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctx = new C();
      } catch {
        return null;
      }
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.18, slideTo?: number, delay = 0) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function buzz() {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(60);
      } catch {
        /* ignore */
      }
    }
  }

  return {
    unlock() {
      ac();
    },
    setMuted(m) {
      muted = m;
    },
    tap() {
      tone(660, 0.05, "triangle", 0.12);
    },
    pop(i = 0) {
      tone(500 + i * 120, 0.09, "sine", 0.2, 900 + i * 160);
    },
    good(points) {
      const base = 520 + points * 3;
      tone(base, 0.08, "triangle", 0.16);
      tone(base * 1.5, 0.12, "triangle", 0.14, undefined, 0.06);
      if (points >= 86) tone(base * 2, 0.16, "sine", 0.12, undefined, 0.13);
    },
    bad() {
      tone(220, 0.22, "sawtooth", 0.1, 110);
      buzz();
    },
    go() {
      tone(880, 0.12, "square", 0.08);
    },
    tick() {
      tone(1200, 0.025, "square", 0.04);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "triangle", 0.15, undefined, i * 0.09));
    },
  };
}
