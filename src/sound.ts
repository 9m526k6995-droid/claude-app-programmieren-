// Alle Sounds werden live per Web Audio erzeugt – keine Audiodateien, kein Ladezeit-Overhead.

export interface Sfx {
  tap(): void;
  pop(i?: number): void;
  good(points: number): void;
  bad(): void;
  go(): void;
  tick(): void;
  beat(accent?: boolean): void;
  win(): void;
  /** Der ZWIP-Sound: „zwiiip“ + Erkennungsmelodie (ca. 1,3 s). Für die großen Momente. */
  jingle(): void;
  /** Nur das „zwiiip“ (z. B. beim Start einer Runde) */
  zwip(): void;
  setMuted(m: boolean): void;
  /** Vibration an/aus (unabhängig vom Ton) */
  setVibrate(v: boolean): void;
  unlock(): void;
}

export function createSfx(initiallyMuted: boolean, initiallyVibrate = true): Sfx {
  let ctx: AudioContext | null = null;
  let muted = initiallyMuted;
  let vibrate = initiallyVibrate;

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

  function buzz(pattern: number | number[] = 60) {
    if (vibrate && typeof navigator !== "undefined" && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- ZWIP-Erkennungssound ----------
  // Idee: Der Name als Klang. Ein schneller Aufwärts-Swoosh („zwiiip“) und danach ein kurzes Motiv
  // „ta-ta-TAA – taaa“ (E–G–C | G) in Dur. Immer gleich, damit es sich einprägt.

  /** Weicher Synth-Ton aus zwei leicht verstimmten Oszillatoren + Obertönen */
  function voice(freq: number, t0: number, dur: number, vol: number, c: AudioContext, out: AudioNode) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.6, t0 + Math.min(0.12, dur * 0.5));
    // Lange Töne klingen aus statt abrupt zu verschwinden
    if (dur > 0.3) g.gain.setValueAtTime(vol * 0.6, t0 + dur - 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(out);
    for (const [type, mult, det, v] of [
      ["square", 1, -6, 0.35],
      ["square", 1, 6, 0.35],
      ["triangle", 2, 0, 0.5],
    ] as [OscillatorType, number, number, number][]) {
      const o = c.createOscillator();
      const og = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq * mult, t0);
      o.detune.setValueAtTime(det, t0);
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }

  function swoosh(c: AudioContext, t0: number, out: AudioNode) {
    // Ton, der schnell nach oben rutscht …
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(260, t0);
    o.frequency.exponentialRampToValueAtTime(2600, t0 + 0.16);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.17, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(900, t0);
    lp.frequency.exponentialRampToValueAtTime(6000, t0 + 0.16);
    o.connect(lp).connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 0.22);
    // … plus ein Hauch Rauschen für das „zw“
    const len = Math.floor(c.sampleRate * 0.18);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const n = c.createBufferSource();
    n.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(1200, t0);
    bp.frequency.exponentialRampToValueAtTime(7000, t0 + 0.16);
    const ng = c.createGain();
    ng.gain.value = 0.14;
    n.connect(bp).connect(ng).connect(out);
    n.start(t0);
  }

  function master(c: AudioContext): AudioNode {
    // Leichtes Echo, damit es nach „Spiel“ klingt und nicht nach Piepser
    const out = c.createGain();
    out.gain.value = 0.9;
    const delay = c.createDelay(0.5);
    delay.delayTime.value = 0.13;
    const fb = c.createGain();
    fb.gain.value = 0.22;
    const wet = c.createGain();
    wet.gain.value = 0.25;
    out.connect(c.destination);
    out.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(c.destination);
    return out;
  }

  function playJingle(withSwoosh: boolean) {
    const c = ac();
    if (!c) return;
    const out = master(c);
    let t = c.currentTime + 0.02;
    if (withSwoosh) {
      swoosh(c, t, out);
      t += 0.2;
    }
    // E5 G5 C6 … G6 (lang, mit Vibrato) – darunter ein kurzer Bass-Schlag
    const E5 = 659.25, G5 = 783.99, C6 = 1046.5, G6 = 1567.98;
    voice(E5, t, 0.12, 0.11, c, out);
    voice(G5, t + 0.1, 0.12, 0.11, c, out);
    voice(C6, t + 0.2, 0.26, 0.13, c, out);
    // Schluss-Ton mit Vibrato
    const tEnd = t + 0.42;
    voice(G6, tEnd, 0.7, 0.12, c, out);
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 6;
    lg.gain.value = 0;
    lg.gain.setValueAtTime(0, tEnd + 0.15);
    lg.gain.linearRampToValueAtTime(14, tEnd + 0.5);
    lfo.connect(lg);
    lfo.start(tEnd);
    lfo.stop(tEnd + 0.75);
    // Bass + Kick unter dem ersten und letzten Ton
    for (const [bt, f] of [[t, 130.81], [tEnd, 196]] as [number, number][]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f * 1.6, bt);
      o.frequency.exponentialRampToValueAtTime(f, bt + 0.06);
      g.gain.setValueAtTime(0.0001, bt);
      g.gain.exponentialRampToValueAtTime(0.32, bt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.35);
      o.connect(g).connect(out);
      o.start(bt);
      o.stop(bt + 0.4);
    }
    // Glitzer zum Schluss
    [2093, 2637, 3136].forEach((f, i) => tone(f, 0.12, "sine", 0.05, undefined, tEnd - c.currentTime + 0.08 + i * 0.06));
    buzz([20, 60, 20, 60, 40, 120, 90]);
  }

  return {
    jingle() {
      playJingle(true);
    },
    zwip() {
      const c = ac();
      if (!c) return;
      swoosh(c, c.currentTime + 0.01, master(c));
    },
    unlock() {
      ac();
    },
    setMuted(m) {
      muted = m;
    },
    setVibrate(v) {
      vibrate = v;
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
      buzz(15);
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
    beat(accent = false) {
      tone(accent ? 220 : 180, 0.12, "sine", 0.32, 70);
      tone(accent ? 1500 : 1100, 0.03, "square", 0.05);
    },
    win() {
      // Gleiches Motiv wie der ZWIP-Sound – so erkennt man ihn bei jedem Erfolg wieder
      playJingle(false);
    },
  };
}
