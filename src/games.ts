// Die Mini-Challenges.
//
// Jedes Spiel läuft in zwei Varianten:
//   * Gemischte Modi (Daily, Training, Endlos, Trophäen, Duell): Schwierigkeit `level` 0..1.
//     Dieser Weg verbraucht den Zufall exakt wie vorher, damit Dailies und Duelle für alle gleich bleiben.
//   * Minigames (Stufen-Lauf): `stage` 1, 2, 3 … Die Werte für jede Stufe liefert `stage(n)`.
//     Sie werden monoton schwerer und haben feste Grenzen, damit es nie unmöglich wird.
// Neue Challenges = neues Objekt in GAMES.

import type { Rng } from "./rng";
import type { Sfx } from "./sound";

export interface Outcome {
  ok: boolean;
  /** 0..1 – ersetzt die Zeitwertung, wenn die Challenge selbst Präzision misst */
  rating?: number;
  /** Vom Spiel selbst gemessene Zeit/Abweichung in ms (z. B. Reaktionszeit ab Grün). Sonst misst der Ablauf. */
  ms?: number;
  reason?: string;
}

export interface Ctx {
  el: HTMLElement;
  rng: Rng;
  /** 0 = leicht, 1 = schwer (gemischte Modi) */
  level: number;
  /** Stufe im Minigame-Lauf (1, 2, 3 …). Gesetzt = die Stufen-Werte gelten. */
  stage?: number;
  finish: (o: Outcome) => void;
  sfx: Sfx;
  /** Nur für automatische Tests – im echten Spiel ein No-op */
  expose: (info: Record<string, unknown>) => void;
}

export interface Mounted {
  limit: number;
  cleanup?: () => void;
  hideTimer?: boolean;
}

/** So lange (ms) wird ein Minispiel in den gemischten Modi vor jeder Aufgabe erklärt. */

/** Kennzahlen einer Stufe (nur Zahlen, damit sie sich vergleichen und testen lassen). */
export type StageParams = Record<string, number>;

export interface MicroGame {
  id: string;
  title: string;
  hint: string;
  /** Ausführliche Erklärung (2–3 kurze Sätze) */
  howto: string;
  emoji: string;
  bg: string;
  /**
   * Orientierungszeit in ms: Die Aufgabe ist sichtbar, aber Eingaben zählen noch nicht und die
   * Zeitmessung startet erst danach. 0 = das Spiel hat schon eine eigene Vorlaufphase
   * (z. B. Reaktionstest, Takt, Memory), die nicht verfälscht werden darf.
   */
  prep: number;
  /** Grenzen für den Trophäen-Tempobonus (ms ab Ende der Vorbereitung bzw. vom Spiel gemeldete ms). */
  speed: { veryFast: number; fast: number };
  /** Werte für Stufe n (1, 2, 3 …) im Minigame-Modus */
  stage(n: number): StageParams;
  /**
   * Richtung jeder Kennzahl über die Stufen: +1 = darf nur steigen, −1 = darf nur sinken.
   * (Für die Tests: So wird geprüft, dass es nie leichter wird.)
   */
  monotone: Record<string, 1 | -1>;
  /** „So wird's schwerer" – Stichpunkte für die Minigame-Detailseite */
  progressionText: string[];
  mount(ctx: Ctx): Mounted;
}

import { lerp, st, h, onPress, scatter, spread } from "./gameKit";
import { GAMES_WAVE3 } from "./games2";
import { GAMES_WAVE4 } from "./games3";

export const PALETTE = ["#ff3d8b", "#3d7bff", "#2fd17a", "#ffd23d", "#ff8a3d", "#a45cff", "#25d9e8"];

// =====================================================================
// 1) Finde das eine Feld, das anders aussieht
// =====================================================================
const odd: MicroGame = {
  id: "odd",
  title: "Finde den Anderen",
  hint: "Ein Feld ist anders. Tippen!",
  howto: "Du siehst lauter Felder in fast derselben Farbe. Genau eins ist ein kleines bisschen heller oder dunkler. Tipp genau dieses Feld an – je schneller, desto mehr Punkte.",
  emoji: "👁️",
  bg: "linear-gradient(160deg,#6a2cff,#b83dff)",
  prep: 1200,
  speed: { veryFast: 900, fast: 1700 },
  stage: (n) => {
    n = st(n);
    return {
      side: Math.min(8, 3 + Math.floor((n - 1) / 3)),
      diff: Math.max(4, 24 - (n - 1)),
      limit: Math.max(2500, 3800 - (n - 1) * 65),
    };
  },
  monotone: { side: 1, diff: -1, limit: -1 },
  progressionText: ["Mehr Felder: von 3×3 bis 8×8", "Der Farbunterschied wird immer kleiner", "Weniger Zeit pro Stufe"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? odd.stage(stage) : null;
    const n = P ? P.side : level < 0.3 ? 3 : level < 0.7 ? 4 : 5;
    const hue = rng.int(0, 359);
    const sat = rng.int(72, 92);
    const L = rng.int(50, 60);
    const d = P ? P.diff : Math.round(lerp(22, 9, level));
    const dir = rng.bool() ? 1 : -1;
    const oddIdx = rng.int(0, n * n - 1);
    const grid = h("div", "odd-grid");
    grid.style.setProperty("--n", String(n));
    if (n >= 6) grid.classList.add("dense");
    const tiles: HTMLElement[] = [];
    for (let i = 0; i < n * n; i++) {
      const t = h("button", "odd-tile");
      t.setAttribute("aria-label", "Feld");
      t.style.background = `hsl(${hue} ${sat}% ${i === oddIdx ? L + dir * d : L}%)`;
      t.style.animationDelay = `${i * (n > 5 ? 5 : 12)}ms`;
      onPress(t, () => {
        if (i === oddIdx) {
          t.classList.add("hit");
          finish({ ok: true });
        } else {
          t.classList.add("miss");
          tiles[oddIdx].classList.add("reveal");
          finish({ ok: false, reason: "Daneben!" });
        }
      });
      tiles.push(t);
      grid.append(t);
    }
    el.append(grid);
    expose({ target: tiles[oddIdx] });
    return { limit: P ? P.limit : 3800 };
  },
};

// =====================================================================
// 2) Stoppe die Nadel im Feld
// =====================================================================
const stop: MicroGame = {
  id: "stop",
  title: "Stopp im Feld",
  hint: "Tippen, wenn der Strich im Feld ist",
  howto: "Ein Strich saust auf einem Balken hin und her. Irgendwo auf dem Balken ist ein hellgrünes Feld. Tipp genau dann, wenn der Strich mitten in diesem Feld ist.",
  emoji: "🎯",
  bg: "linear-gradient(160deg,#ff3d6e,#ff8a3d)",
  prep: 1000,
  speed: { veryFast: 250, fast: 550 },
  stage: (n) => {
    n = st(n);
    return {
      // Zeit für einmal hin und zurück: pro Stufe 6 % schneller, nie unter 420 ms
      period: Math.max(420, Math.round(1500 / Math.pow(1.06, n - 1))),
      width: Math.max(7, Math.round((22 - (n - 1) * 0.8) * 10) / 10),
      reverse: n >= 8 ? 1 : 0,
      jump: n >= 12 ? 1 : 0,
    };
  },
  monotone: { period: -1, width: -1, reverse: 1, jump: 1 },
  progressionText: ["Der Strich wird mit jeder Stufe schneller", "Das grüne Feld wird schmaler", "Ab Stufe 8 dreht der Strich plötzlich um", "Ab Stufe 12 springt das Feld nach jedem Durchlauf"],
  mount({ el, rng, level, stage, finish, expose }) {
    if (stage) return mountStopStage({ el, rng, finish, expose }, stop.stage(stage));
    const width = lerp(30, 13, level);
    const zoneStart = rng.int(6, Math.floor(94 - width));
    const period = lerp(1500, 820, level);
    const phase = rng.next();
    const wrap = h("div", "stop-wrap");
    const bar = h("div", "stop-bar");
    const zone = h("div", "stop-zone");
    const needle = h("div", "stop-needle");
    zone.style.left = `${zoneStart}%`;
    zone.style.width = `${width}%`;
    bar.append(zone, needle);
    wrap.append(bar, h("div", "big-hint", "TIPP!"));
    el.append(wrap);
    const t0 = performance.now();
    let pos = 0;
    let raf = 0;
    const loop = () => {
      const t = ((performance.now() - t0) / period + phase) % 1;
      pos = (t < 0.5 ? t * 2 : 2 - t * 2) * 100;
      needle.style.left = `${pos}%`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    const inZone = () => pos >= zoneStart && pos <= zoneStart + width;
    onPress(el, () => {
      cancelAnimationFrame(raf);
      if (inZone()) {
        const center = zoneStart + width / 2;
        const rating = Math.max(0, 1 - Math.abs(pos - center) / (width / 2));
        zone.classList.add("hit");
        // ms = Abstand zur Mitte (0 = perfekt, 1000 = Rand) – für den Tempobonus im Trophäen-Modus
        finish({ ok: true, rating: 0.35 + rating * 0.65, ms: Math.round((1 - rating) * 1000) });
      } else {
        needle.classList.add("miss");
        finish({ ok: false, reason: "Knapp daneben!" });
      }
    });
    expose({ inZone });
    return { limit: Math.round(period * 2.6 + 400), cleanup: () => cancelAnimationFrame(raf) };
  },
};

/** Stopp im Feld als Stufe: Strich mit echter Geschwindigkeit, optional Richtungswechsel und springendes Feld. */
function mountStopStage(
  { el, rng, finish, expose }: Pick<Ctx, "el" | "rng" | "finish" | "expose">,
  P: StageParams,
): Mounted {
  const width = P.width;
  let zoneStart = rng.int(6, Math.floor(94 - width));
  const wrap = h("div", "stop-wrap");
  const bar = h("div", "stop-bar");
  const zone = h("div", "stop-zone");
  const needle = h("div", "stop-needle");
  const place = () => {
    zone.style.left = `${zoneStart}%`;
    zone.style.width = `${width}%`;
  };
  place();
  bar.append(zone, needle);
  wrap.append(bar, h("div", "big-hint", "TIPP!"));
  el.append(wrap);
  const speed = 200 / P.period; // % pro ms
  let pos = rng.int(0, 100);
  let dir = rng.bool() ? 1 : -1;
  let nextFlip = P.reverse ? rng.int(450, 1100) : Infinity;
  let last = performance.now();
  let elapsed = 0;
  let raf = 0;
  const loop = (now: number) => {
    const dt = Math.min(50, now - last);
    last = now;
    elapsed += dt;
    pos += dir * speed * dt;
    let bounced = false;
    if (pos >= 100) {
      pos = 200 - pos;
      dir = -1;
      bounced = true;
    } else if (pos <= 0) {
      pos = -pos;
      dir = 1;
      bounced = true;
    }
    if (elapsed >= nextFlip) {
      dir = -dir;
      nextFlip = elapsed + rng.int(450, 1100);
    }
    if (bounced && P.jump) {
      zoneStart = rng.int(6, Math.floor(94 - width));
      place();
      zone.classList.remove("jump");
      void zone.offsetWidth;
      zone.classList.add("jump");
    }
    needle.style.left = `${pos}%`;
    raf = requestAnimationFrame(loop);
  };
  needle.style.left = `${pos}%`;
  raf = requestAnimationFrame(loop);
  const inZone = () => pos >= zoneStart && pos <= zoneStart + width;
  onPress(el, () => {
    cancelAnimationFrame(raf);
    if (inZone()) {
      const center = zoneStart + width / 2;
      const rating = Math.max(0, 1 - Math.abs(pos - center) / (width / 2));
      zone.classList.add("hit");
      finish({ ok: true, rating: 0.35 + rating * 0.65, ms: Math.round((1 - rating) * 1000) });
    } else {
      needle.classList.add("miss");
      finish({ ok: false, reason: "Knapp daneben!" });
    }
  });
  expose({ inZone });
  // Genug Zeit für gut zwei Durchläufe (bei Richtungswechseln etwas mehr)
  return { limit: Math.round(P.period * (P.reverse ? 3.4 : 2.6) + 500), cleanup: () => cancelAnimationFrame(raf) };
}

// =====================================================================
// 3) Reaktionstest: erst bei Grün tippen
// =====================================================================
const wait: MicroGame = {
  id: "wait",
  title: "Warte auf Grün",
  hint: "Zu früh tippen = raus",
  howto: "Der Bildschirm ist erst rot – jetzt nicht tippen! Sobald er grün wird, tippst du so schnell du kannst. Wer zu früh tippt, hat verloren.",
  emoji: "🚦",
  bg: "#1c1530",
  prep: 0,
  speed: { veryFast: 300, fast: 420 },
  stage: (n) => {
    n = st(n);
    return {
      maxReaction: Math.max(380, 700 - (n - 1) * 20),
      // Höchstzahl gelber Fake-Signale vor dem echten Grün
      fakes: n < 6 ? 0 : Math.min(4, 1 + Math.floor((n - 6) / 4)),
    };
  },
  monotone: { maxReaction: -1, fakes: 1 },
  progressionText: ["Du musst immer schneller reagieren (bis 0,38 s)", "Die Wartezeit ist jedes Mal anders", "Ab Stufe 6 blinkt es gelb – nicht drauf reinfallen!", "Später kommen mehrere Fake-Signale hintereinander"],
  mount({ el, rng, stage, finish, sfx, expose }) {
    if (stage) return mountWaitStage({ el, rng, finish, sfx, expose }, wait.stage(stage));
    const delay = rng.int(900, 2300);
    const box = h("div", "wait-box red");
    const label = h("div", "wait-label", "Warte…");
    box.append(label);
    el.append(box);
    let goAt: number | null = null;
    const timer = window.setTimeout(() => {
      goAt = performance.now();
      box.classList.replace("red", "green");
      label.textContent = "JETZT!";
      sfx.go();
    }, delay);
    onPress(el, () => {
      if (goAt === null) {
        clearTimeout(timer);
        box.classList.add("early");
        label.textContent = "Zu früh!";
        finish({ ok: false, reason: "Zu früh! 🫣" });
        return;
      }
      const rt = performance.now() - goAt;
      label.textContent = `${Math.round(rt)} ms`;
      finish({ ok: true, rating: Math.max(0, Math.min(1, 1 - (rt - 200) / 500)), ms: Math.round(rt) });
    });
    expose({ isGo: () => goAt !== null });
    return { limit: delay + 1400, hideTimer: true, cleanup: () => clearTimeout(timer) };
  },
};

function mountWaitStage({ el, rng, finish, sfx, expose }: Pick<Ctx, "el" | "rng" | "finish" | "sfx" | "expose">, P: StageParams): Mounted {
  const delay = rng.int(1000, 4000);
  const fakeCount = P.fakes ? rng.int(Math.max(0, P.fakes - 1), P.fakes) : 0;
  // Fake-Signale zufällig vor dem echten Grün verteilen (mit Abstand)
  const fakeAt: number[] = [];
  for (let i = 0; i < fakeCount; i++) fakeAt.push(rng.int(350, Math.max(400, delay - 450)));
  fakeAt.sort((a, b) => a - b);
  const box = h("div", "wait-box red");
  const label = h("div", "wait-label", "Warte…");
  const limitTag = h("div", "wait-limit", `Grenze: ${(P.maxReaction / 1000).toLocaleString("de-DE")} s`);
  box.append(label, limitTag);
  el.append(box);
  let goAt: number | null = null;
  const timers: number[] = [];
  fakeAt.forEach((t) => {
    timers.push(
      window.setTimeout(() => {
        if (goAt !== null) return;
        box.classList.add("fake");
        label.textContent = "Noch nicht!";
        timers.push(
          window.setTimeout(() => {
            box.classList.remove("fake");
            if (goAt === null) label.textContent = "Warte…";
          }, 260),
        );
      }, t),
    );
  });
  timers.push(
    window.setTimeout(() => {
      goAt = performance.now();
      box.classList.remove("fake");
      box.classList.replace("red", "green");
      label.textContent = "JETZT!";
      sfx.go();
    }, delay),
  );
  onPress(el, () => {
    if (goAt === null) {
      timers.forEach(clearTimeout);
      box.classList.add("early");
      label.textContent = "Zu früh!";
      finish({ ok: false, reason: box.classList.contains("fake") ? "Das war Gelb! 🟡" : "Zu früh! 🫣" });
      return;
    }
    const rt = performance.now() - goAt;
    label.textContent = `${Math.round(rt)} ms`;
    if (rt > P.maxReaction) {
      finish({ ok: false, reason: `Zu langsam (${Math.round(rt)} ms)` });
      return;
    }
    finish({ ok: true, rating: Math.max(0, Math.min(1, 1 - (rt - 200) / 500)), ms: Math.round(rt) });
  });
  expose({ isGo: () => goAt !== null });
  return { limit: delay + P.maxReaction + 40, hideTimer: true, cleanup: () => timers.forEach(clearTimeout) };
}

// =====================================================================
// 4) Welche Seite hat mehr Punkte?
// =====================================================================
const more: MicroGame = {
  id: "more",
  title: "Wo sind mehr?",
  hint: "Tipp die Seite mit mehr Punkten",
  howto: "Links und rechts liegen Punkte. Tipp die Seite, auf der mehr Punkte sind. Nicht zählen, einfach schätzen – sonst wird die Zeit knapp.",
  emoji: "⚖️",
  bg: "linear-gradient(160deg,#0fb39a,#25d9e8)",
  prep: 1300,
  speed: { veryFast: 800, fast: 1500 },
  stage: (n) => {
    n = st(n);
    const fields = n >= 14 ? 3 : 2;
    return {
      // Unterschied der Punktzahlen in Prozent
      diffPct: Math.max(6, Math.round((40 - (n - 1) * 2.6) * 10) / 10),
      base: Math.min(fields === 3 ? 18 : 26, 6 + n),
      mixedSizes: n >= 8 ? 1 : 0,
      fields,
    };
  },
  // base sinkt kurz beim Wechsel auf 3 Felder (weniger Platz) – dafür gibt es ein Feld mehr
  monotone: { diffPct: -1, mixedSizes: 1, fields: 1 },
  progressionText: ["Die Unterschiede werden immer knapper", "Es liegen immer mehr Punkte da", "Ab Stufe 8 sind die Punkte unterschiedlich groß", "Ab Stufe 14 drei Felder statt zwei"],
  mount({ el, rng, level, stage, finish, expose }) {
    if (stage) return mountMoreStage({ el, rng, finish, expose }, more.stage(stage));
    const base = rng.int(5, 10);
    const diff = Math.max(1, Math.round(lerp(4, 1, level) + rng.next() * 0.6));
    const moreLeft = rng.bool();
    const counts = moreLeft ? [base + diff, base] : [base, base + diff];
    const wrap = h("div", "more-wrap");
    const sides: HTMLElement[] = [];
    counts.forEach((count, side) => {
      const s = h("button", "more-side");
      s.setAttribute("aria-label", side === 0 ? "Links" : "Rechts");
      const isMore = side === (moreLeft ? 0 : 1);
      // Gemein ab mittlerem Level: Die Seite mit weniger Punkten bekommt größere Punkte.
      const size = level > 0.4 && !isMore ? 30 : 22;
      scatter(rng, count, 4, 5, 10).forEach((p, i) => {
        const d = h("span", "dot");
        d.style.left = `${p.x}%`;
        d.style.top = `${p.y}%`;
        d.style.width = d.style.height = `${size + rng.int(-4, 4)}px`;
        d.style.animationDelay = `${i * 15}ms`;
        s.append(d);
      });
      onPress(s, () => {
        if (isMore) {
          s.classList.add("hit");
          finish({ ok: true });
        } else {
          s.classList.add("miss");
          finish({ ok: false, reason: `${counts[0]} vs ${counts[1]}` });
        }
      });
      sides.push(s);
      wrap.append(s);
    });
    el.append(wrap);
    expose({ target: sides[moreLeft ? 0 : 1] });
    return { limit: 3400 };
  },
};

function mountMoreStage({ el, rng, finish, expose }: Pick<Ctx, "el" | "rng" | "finish" | "expose">, P: StageParams): Mounted {
  const fields = P.fields;
  const base = P.base + rng.int(0, 2);
  const most = Math.max(base + 1, Math.round(base * (1 + P.diffPct / 100)));
  const winner = rng.int(0, fields - 1);
  // Andere Felder: knapp darunter (bei 3 Feldern liegt eins zwischendrin)
  const counts = Array.from({ length: fields }, (_, i) => (i === winner ? most : base - (fields === 3 && i !== winner && rng.bool() ? 1 : 0)));
  const cols = fields === 3 ? 3 : 4;
  const rows = fields === 3 ? 8 : 7;
  const dotSize = Math.max(12, 24 - Math.max(0, most - 8));
  const wrap = h("div", `more-wrap${fields === 3 ? " three" : ""}`);
  const sides: HTMLElement[] = [];
  const names = fields === 3 ? ["Links", "Mitte", "Rechts"] : ["Links", "Rechts"];
  counts.forEach((count, side) => {
    const s = h("button", "more-side");
    s.setAttribute("aria-label", names[side]);
    const isMore = side === winner;
    scatter(rng, Math.min(count, cols * rows), cols, rows, 8).forEach((p, i) => {
      const d = h("span", "dot");
      d.style.left = `${p.x}%`;
      d.style.top = `${p.y}%`;
      // Ab Stufe 8: gemischte Größen, die Felder mit weniger Punkten bekommen eher größere
      const extra = P.mixedSizes ? rng.int(-5, isMore ? 3 : 9) : rng.int(-2, 2);
      d.style.width = d.style.height = `${Math.max(8, dotSize + extra)}px`;
      d.style.animationDelay = `${i * 10}ms`;
      s.append(d);
    });
    onPress(s, () => {
      if (isMore) {
        s.classList.add("hit");
        finish({ ok: true });
      } else {
        s.classList.add("miss");
        sides[winner].classList.add("reveal");
        finish({ ok: false, reason: counts.join(" vs ") });
      }
    });
    sides.push(s);
    wrap.append(s);
  });
  el.append(wrap);
  expose({ target: sides[winner] });
  return { limit: 3400 };
}

// =====================================================================
// 5) Alle Blasen zerplatzen lassen
// =====================================================================
const pop: MicroGame = {
  id: "pop",
  title: "Alle zerplatzen",
  hint: "Tipp jede Blase weg",
  howto: "Auf dem Bildschirm tauchen Blasen auf. Tipp jede einzelne Blase weg, bis keine mehr übrig ist. Die Zeit läuft oben im Balken ab.",
  emoji: "🫧",
  bg: "radial-gradient(120% 90% at 50% 0%,#4a2a7a,#1c1530)",
  prep: 900,
  speed: { veryFast: 1400, fast: 2300 },
  stage: (n) => {
    n = st(n);
    return {
      bubbles: Math.min(16, 3 + n),
      msPerBubble: Math.max(360, 650 - (n - 1) * 15),
      moving: n >= 6 ? 1 : 0,
      red: n < 11 ? 0 : Math.min(4, 1 + Math.floor((n - 11) / 4)),
    };
  },
  monotone: { bubbles: 1, msPerBubble: -1, moving: 1, red: 1 },
  progressionText: ["Jede Stufe eine Blase mehr (bis 16)", "Weniger Zeit pro Blase", "Ab Stufe 6 bewegen sich die Blasen", "Ab Stufe 11 gibt es rote Blasen – NICHT antippen!"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    if (stage) return mountPopStage({ el, rng, finish, sfx, expose }, pop.stage(stage));
    const k = 3 + Math.round(level * 3);
    let left = k;
    const field = h("div", "pop-field");
    const bubbles: HTMLElement[] = [];
    scatter(rng, k, 3, 4, 12).forEach((p, i) => {
      const b = h("button", "bubble");
      b.setAttribute("aria-label", "Blase");
      const size = rng.int(66, 88);
      b.style.cssText = `left:${p.x}%;top:${p.y}%;width:${size}px;height:${size}px;--c:${rng.pick(PALETTE)};animation-delay:${i * 40}ms,${rng.int(0, 600)}ms`;
      onPress(b, () => {
        if (b.classList.contains("popped")) return;
        b.classList.add("popped");
        sfx.pop(k - left);
        left -= 1;
        if (left === 0) finish({ ok: true });
      });
      bubbles.push(b);
      field.append(b);
    });
    el.append(field);
    expose({ targets: bubbles });
    return { limit: 2400 + k * 420 };
  },
};

function mountPopStage({ el, rng, finish, sfx, expose }: Pick<Ctx, "el" | "rng" | "finish" | "sfx" | "expose">, P: StageParams): Mounted {
  const k = P.bubbles;
  const total = k + P.red;
  let left = k;
  const field = h("div", "pop-field");
  const bubbles: HTMLElement[] = [];
  // Viele Blasen: kleinere Blasen und weniger Schweben – und ein Mindestabstand, damit sich nichts überlappt
  const dense = total > 12;
  const mid = total > 8;
  const maxSize = dense ? 54 : mid ? 66 : 86;
  const size = () => (dense ? rng.int(46, 54) : mid ? rng.int(56, 66) : rng.int(66, 86));
  const dr = dense ? 10 : 16;
  const drift0 = P.moving ? dr : 0;
  const spots = spread(rng, total, maxSize + drift0 * 1.6 + 6, maxSize / 2 + drift0 + 6);
  spots.forEach((p, i) => {
    const bad = i >= k;
    const b = h("button", bad ? "bubble bad" : "bubble");
    b.setAttribute("aria-label", bad ? "Rote Blase – nicht antippen" : "Blase");
    const s = size();
    const drift = P.moving ? `;--dx:${rng.int(-dr, dr)}px;--dy:${rng.int(-dr, dr)}px` : "";
    b.style.cssText = `left:${p.x}%;top:${p.y}%;width:${s}px;height:${s}px;--c:${bad ? "#ff2d3d" : rng.pick(PALETTE)};animation-delay:${i * 30}ms,${rng.int(0, 600)}ms${drift}`;
    if (P.moving) b.classList.add("drift");
    onPress(b, () => {
      if (b.classList.contains("popped")) return;
      if (bad) {
        b.classList.add("miss");
        finish({ ok: false, reason: "Rote Blase! 🔴" });
        return;
      }
      b.classList.add("popped");
      sfx.pop(k - left);
      left -= 1;
      if (left === 0) finish({ ok: true });
    });
    bubbles.push(b);
    field.append(b);
  });
  el.append(field);
  expose({ targets: bubbles.slice(0, k) });
  return { limit: 1200 + k * P.msPerBubble };
}

// =====================================================================
// 6) Stimmt die Rechnung?
// =====================================================================
const sum: MicroGame = {
  id: "sum",
  title: "Stimmt das?",
  hint: "✓ oder ✗ – schnell!",
  howto: "Du siehst eine Rechnung mit Ergebnis, zum Beispiel 7 + 5 = 12. Stimmt das Ergebnis, tippst du ✓. Ist es falsch, tippst du ✗.",
  emoji: "🧮",
  bg: "linear-gradient(160deg,#2f6bff,#6a2cff)",
  prep: 1500,
  speed: { veryFast: 1200, fast: 2100 },
  stage: (n) => {
    n = st(n);
    return {
      // 1 = kleines Plus, 2 = Plus/Minus bis 50, 3 = Mal, 4 = zwei Rechenschritte
      tier: n <= 4 ? 1 : n <= 8 ? 2 : n <= 12 ? 3 : 4,
      // So weit liegt ein falsches Ergebnis höchstens daneben
      maxOff: Math.max(1, 10 - Math.floor((n - 1) / 2)),
      limit: Math.max(2200, 3400 - (n - 1) * 60),
    };
  },
  monotone: { tier: 1, maxOff: -1, limit: -1 },
  progressionText: ["Stufe 1–4: kleine Plus-Aufgaben", "Stufe 5–8: Plus und Minus bis 50", "Stufe 9–12: Mal-Aufgaben, ab 13: zwei Rechenschritte", "Falsche Ergebnisse liegen immer knapper am richtigen"],
  mount({ el, rng, level, stage, finish, expose }) {
    let a: number, b: number, real: number;
    let text: string;
    let truth: boolean;
    let shown: number;
    let limit = 3400;
    if (stage) {
      const P = sum.stage(stage);
      limit = P.limit;
      if (P.tier === 1) {
        a = rng.int(2, 9 + stage);
        b = rng.int(2, 9 + stage);
        real = a + b;
        text = `${a} + ${b}`;
      } else if (P.tier === 2) {
        if (rng.bool()) {
          a = rng.int(8, 30);
          b = rng.int(5, 50 - a);
          real = a + b;
          text = `${a} + ${b}`;
        } else {
          a = rng.int(15, 50);
          b = rng.int(3, a - 2);
          real = a - b;
          text = `${a} − ${b}`;
        }
      } else if (P.tier === 3) {
        a = rng.int(3, 9);
        b = rng.int(3, 12);
        real = a * b;
        text = `${a} × ${b}`;
      } else {
        a = rng.int(2, 9);
        b = rng.int(3, 9);
        const c = rng.int(2, 15);
        const plus = rng.bool();
        real = plus ? a * b + c : a * b - c;
        if (real < 0) real = a * b + c;
        text = `${a} × ${b} ${real === a * b + c ? "+" : "−"} ${c}`;
      }
      truth = rng.bool();
      shown = real;
      if (!truth) {
        const off = rng.int(1, P.maxOff);
        shown = real + (rng.bool() ? off : -off);
        if (shown < 0) shown = real + off;
      }
    } else {
      const op = level < 0.35 ? "+" : rng.pick(["+", "−", "×"] as const);
      if (op === "+") {
        a = rng.int(2, 9 + Math.round(level * 30));
        b = rng.int(2, 9 + Math.round(level * 12));
        real = a + b;
      } else if (op === "−") {
        a = rng.int(12, 40);
        b = rng.int(3, a - 2);
        real = a - b;
      } else {
        a = rng.int(2, 9);
        b = rng.int(3, 9);
        real = a * b;
      }
      text = `${a} ${op} ${b}`;
      truth = rng.bool();
      shown = real;
      if (!truth) {
        const offs = op === "×" ? [-a, a, -1, 1, 10] : [-10, -2, -1, 1, 2, 10];
        shown = real + rng.pick(offs);
        if (shown < 0 || shown === real) shown = real + 1;
      }
    }
    const wrap = h("div", "sum-wrap");
    const eq = h("div", "sum-eq", `${text} = ${shown}`);
    if (text.length > 9) eq.classList.add("long");
    wrap.append(eq);
    const row = h("div", "sum-row");
    const yes = h("button", "sum-btn yes", "✓");
    const no = h("button", "sum-btn no", "✗");
    yes.setAttribute("aria-label", "Stimmt");
    no.setAttribute("aria-label", "Stimmt nicht");
    const answer = (said: boolean, btn: HTMLElement) => {
      if (said === truth) {
        btn.classList.add("hit");
        finish({ ok: true });
      } else {
        btn.classList.add("miss");
        finish({ ok: false, reason: `Richtig wäre ${real}` });
      }
    };
    onPress(yes, () => answer(true, yes));
    onPress(no, () => answer(false, no));
    row.append(yes, no);
    wrap.append(row);
    el.append(wrap);
    expose({ target: truth ? yes : no });
    return { limit };
  },
};

// =====================================================================
// 7) Farbe, nicht Wort (Stroop)
// =====================================================================
const INKS = [
  { n: "ROT", c: "#ff3d5a" },
  { n: "BLAU", c: "#3d7bff" },
  { n: "GRÜN", c: "#22c36b" },
  { n: "GELB", c: "#ffc61a" },
  { n: "LILA", c: "#a45cff" },
] as const;
/** Für die Minigame-Stufen: bis zu 6 gut unterscheidbare Farben */
const INKS_STAGE = [...INKS, { n: "TÜRKIS", c: "#25d9e8" }] as const;

const ink: MicroGame = {
  id: "ink",
  title: "Farbe, nicht Wort!",
  hint: "Welche FARBE hat das Wort?",
  howto: "Ein Farbwort steht da, zum Beispiel ROT – aber in einer anderen Farbe geschrieben. Tipp die Farbe, in der das Wort geschrieben ist. Was da steht, ist egal!",
  emoji: "🎨",
  bg: "linear-gradient(160deg,#ffd23d,#ff8a3d)",
  prep: 1300,
  speed: { veryFast: 900, fast: 1600 },
  stage: (n) => {
    n = st(n);
    return {
      colors: Math.min(6, 3 + Math.floor((n - 1) / 3)),
      limit: Math.max(1800, 3400 - (n - 1) * 80),
      shuffle: n >= 10 ? 1 : 0,
    };
  },
  monotone: { colors: 1, limit: -1, shuffle: 1 },
  progressionText: ["Mehr Farben zur Auswahl: von 3 bis 6", "Immer weniger Zeit (bis 1,8 s)", "Ab Stufe 10 wechseln die Knöpfe jedes Mal den Platz"],
  mount({ el, rng, level, stage, finish, expose }) {
    let pool: readonly { n: string; c: string }[];
    let inkColor: { n: string; c: string };
    let word: { n: string; c: string };
    let order: readonly { n: string; c: string }[];
    let limit = 3400;
    if (stage) {
      const P = ink.stage(stage);
      limit = P.limit;
      // Feste Reihenfolge erleichtert die ersten Stufen, ab Stufe 10 wird gemischt
      const chosen = rng.shuffle(INKS_STAGE).slice(0, P.colors);
      pool = INKS_STAGE.filter((x) => chosen.includes(x));
      inkColor = rng.pick(pool);
      word = rng.pick(pool.filter((x) => x !== inkColor));
      order = P.shuffle ? rng.shuffle(pool) : pool;
    } else {
      pool = rng.shuffle(INKS).slice(0, 4);
      inkColor = pool[0];
      word = level < 0.2 && rng.bool(0.3) ? inkColor : pool[rng.int(1, 3)];
      order = rng.shuffle(pool);
    }
    const wrap = h("div", "ink-wrap");
    const card = h("div", "ink-card");
    const w = h("div", "ink-word", word.n);
    w.style.color = inkColor.c;
    card.append(w);
    const row = h("div", "ink-row");
    row.style.setProperty("--cols", String(order.length <= 4 ? order.length : 3));
    let target: HTMLElement | null = null;
    order.forEach((p) => {
      const b = h("button", "ink-swatch");
      b.style.background = p.c;
      b.setAttribute("aria-label", p.n);
      if (p === inkColor) target = b;
      onPress(b, () => {
        if (p === inkColor) {
          b.classList.add("hit");
          finish({ ok: true });
        } else {
          b.classList.add("miss");
          finish({ ok: false, reason: "Das war das Wort 😉" });
        }
      });
      row.append(b);
    });
    wrap.append(card, row);
    el.append(wrap);
    expose({ target });
    return { limit };
  },
};

// =====================================================================
// 8) Wisch in Pfeilrichtung (oder genau andersrum)
// =====================================================================
type Dir = "up" | "down" | "left" | "right";
const OPP: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const ROT: Record<Dir, number> = { right: 0, down: 90, left: 180, up: 270 };

const swipe: MicroGame = {
  id: "swipe",
  title: "Wisch den Pfeil",
  hint: "In Pfeilrichtung wischen",
  howto: "Ein Pfeil zeigt in eine Richtung. Wisch mit dem Finger genau in diese Richtung. Steht GEGENTEIL! darüber, wischst du genau andersrum.",
  emoji: "👉",
  bg: "linear-gradient(160deg,#22c36b,#0fb39a)",
  prep: 900,
  speed: { veryFast: 650, fast: 1200 },
  stage: (n) => {
    n = st(n);
    return {
      invert: n >= 3 ? 1 : 0,
      arrows: n >= 14 ? 3 : n >= 8 ? 2 : 1,
      msPerArrow: Math.max(1100, 2900 - (n - 1) * 90),
    };
  },
  monotone: { invert: 1, arrows: 1, msPerArrow: -1 },
  progressionText: ["Ab Stufe 3 kommt GEGENTEIL! dazu", "Ab Stufe 8 zwei Pfeile hintereinander", "Ab Stufe 14 sogar drei", "Pro Pfeil immer weniger Zeit"],
  mount({ el, rng, level, stage, finish, expose }) {
    let steps: { dir: Dir; invert: boolean }[];
    let limit = 2900;
    if (stage) {
      const P = swipe.stage(stage);
      steps = Array.from({ length: P.arrows }, () => {
        const dir = rng.pick(["up", "down", "left", "right"] as const);
        return { dir, invert: P.invert === 1 && rng.bool(0.5) };
      });
      limit = P.arrows * P.msPerArrow;
    } else {
      const dir = rng.pick(["up", "down", "left", "right"] as const);
      steps = [{ dir, invert: level > 0.3 && rng.bool(0.5) }];
    }
    const expected = steps.map((s) => (s.invert ? OPP[s.dir] : s.dir));
    let idx = 0;
    const wrap = h("div", "swipe-wrap");
    const flag = h("div", "swipe-flag", "GEGENTEIL!");
    const arrow = h("div", "swipe-arrow", "➜");
    const dots = h("div", "swipe-dots");
    const dotEls = steps.map(() => dots.appendChild(h("i")));
    const show = () => {
      const s = steps[idx];
      flag.style.visibility = s.invert ? "visible" : "hidden";
      arrow.className = `swipe-arrow${s.invert ? " inv" : ""}`;
      arrow.style.setProperty("--rot", `${ROT[s.dir]}deg`);
      dotEls.forEach((d, i) => d.classList.toggle("on", i < idx));
      dotEls.forEach((d, i) => d.classList.toggle("now", i === idx));
    };
    if (steps.length === 1 && !steps[0].invert) flag.remove();
    wrap.append(flag, arrow);
    if (steps.length > 1) wrap.append(dots);
    show();
    el.append(wrap);
    let sx = 0,
      sy = 0,
      down = false,
      over = false;
    const judge = (d: Dir) => {
      if (over) return;
      if (d === expected[idx]) {
        idx += 1;
        if (idx === steps.length) {
          over = true;
          arrow.classList.add("hit");
          finish({ ok: true });
        } else {
          show();
          arrow.classList.remove("next");
          void arrow.offsetWidth;
          arrow.classList.add("next");
        }
      } else {
        over = true;
        arrow.classList.add("miss");
        finish({ ok: false, reason: steps[idx].invert ? "Gegenteil vergessen!" : "Falsche Richtung" });
      }
    };
    const pd = (e: PointerEvent) => {
      e.preventDefault();
      down = true;
      sx = e.clientX;
      sy = e.clientY;
    };
    const pu = (e: PointerEvent) => {
      if (!down) return;
      down = false;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.hypot(dx, dy) < 28) return;
      judge(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
    };
    const kd = (e: KeyboardEvent) => {
      const m: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
      if (m[e.key]) {
        e.preventDefault();
        judge(m[e.key]);
      }
    };
    el.addEventListener("pointerdown", pd);
    window.addEventListener("pointerup", pu);
    window.addEventListener("keydown", kd);
    expose({ dir: expected[0], dirs: expected, step: () => idx });
    return {
      limit,
      cleanup: () => {
        el.removeEventListener("pointerdown", pd);
        window.removeEventListener("pointerup", pu);
        window.removeEventListener("keydown", kd);
      },
    };
  },
};

// =====================================================================
// 9) Suchbild: das gesuchte Emoji im Gewimmel finden
// =====================================================================
const FAMILIES = [
  ["🐸", "🐢", "🐍", "🦎", "🐊", "🐲", "🦖", "🐛"],
  ["😀", "😃", "😄", "😁", "😆", "😅", "🙂", "😊"],
  ["🍎", "🍅", "🍒", "🍓", "🍉", "🌶️", "🍑", "🥕"],
  ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼"],
  ["⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🎱", "🥎"],
  ["🌸", "🌺", "🌷", "🌹", "🌼", "🌻", "💐", "🏵️"],
] as const;

const find: MicroGame = {
  id: "find",
  title: "Wo ist es?",
  hint: "Finde das Emoji von oben",
  howto: "Oben siehst du ein Emoji. Darunter ist ein wildes Gewimmel aus vielen Emojis. Finde dasselbe Emoji darin und tipp es an.",
  emoji: "🔍",
  bg: "linear-gradient(160deg,#25d9e8,#3d7bff)",
  prep: 1800,
  speed: { veryFast: 1300, fast: 2400 },
  stage: (n) => {
    n = st(n);
    return {
      count: Math.min(48, 12 + 3 * (n - 1)),
      similar: n >= 7 ? 1 : 0,
      limit: Math.max(3000, 4200 - (n - 1) * 60),
    };
  },
  monotone: { count: 1, similar: 1, limit: -1 },
  progressionText: ["Jede Stufe 3 Emojis mehr (bis 48)", "Ab Stufe 7 sehen sich die Emojis zum Verwechseln ähnlich", "Immer weniger Zeit (bis 3 s)"],
  mount({ el, rng, level, stage, finish, expose }) {
    const fam = rng.pick(FAMILIES);
    const target = rng.pick(fam);
    let others: string[] = fam.filter((e) => e !== target);
    let cols: number;
    let count: number;
    let limit: number;
    if (stage) {
      const P = find.stage(stage);
      count = P.count;
      cols = count <= 16 ? 4 : count <= 25 ? 5 : count <= 36 ? 6 : 7;
      limit = P.limit;
      // Leichte Stufen: Ablenkung aus anderen Familien (gut zu unterscheiden)
      if (!P.similar) others = FAMILIES.filter((f) => f !== fam).flatMap((f) => [...f]);
    } else {
      cols = level < 0.3 ? 4 : level < 0.7 ? 5 : 6;
      count = cols * (level < 0.3 ? 4 : level < 0.7 ? 5 : 6);
      limit = 4200 + Math.round(level * 1200);
    }
    const at = rng.int(0, count - 1);
    const wrap = h("div", "find-wrap");
    const head = h("div", "find-target");
    head.append(h("span", "", "Finde"), h("b", "", target));
    const grid = h("div", "find-grid");
    grid.style.setProperty("--cols", String(cols));
    if (cols >= 7) grid.classList.add("dense");
    let targetEl: HTMLElement | null = null;
    for (let i = 0; i < count; i++) {
      const isT = i === at;
      const b = h("button", "find-cell", isT ? target : rng.pick(others));
      b.setAttribute("aria-label", isT ? "Gesuchtes Emoji" : "Emoji");
      b.style.animationDelay = `${i * (count > 30 ? 4 : 8)}ms`;
      b.style.setProperty("--tilt", `${rng.int(-14, 14)}deg`);
      if (isT) targetEl = b;
      onPress(b, () => {
        if (isT) {
          b.classList.add("hit");
          finish({ ok: true });
        } else {
          b.classList.add("miss");
          targetEl?.classList.add("reveal");
          finish({ ok: false, reason: "Falsches Emoji!" });
        }
      });
      grid.append(b);
    }
    wrap.append(head, grid);
    el.append(wrap);
    expose({ target: targetEl });
    return { limit };
  },
};

// =====================================================================
// 10) Blitz-Memory: Reihenfolge merken und nachtippen
// =====================================================================
const memory: MicroGame = {
  id: "memory",
  title: "Merk dir's!",
  hint: "Schau zu – dann in gleicher Reihenfolge tippen",
  howto: "Ein paar Felder leuchten nacheinander auf. Schau genau hin und merk dir die Reihenfolge. Danach tippst du die Felder genau so nach.",
  emoji: "🧠",
  bg: "linear-gradient(160deg,#a45cff,#ff3d8b)",
  prep: 0,
  speed: { veryFast: 350, fast: 600 },
  stage: (n) => {
    n = st(n);
    return {
      side: n >= 10 ? 5 : n >= 5 ? 4 : 3,
      length: Math.min(40, 2 + n),
      on: Math.max(300, 600 - (n - 1) * 25),
      gap: n < 15 ? 200 : Math.max(120, 200 - (n - 14) * 10),
    };
  },
  monotone: { side: 1, length: 1, on: -1, gap: -1 },
  progressionText: ["Stufe 1: 3 Felder leuchten im 3×3-Feld", "Jede Stufe leuchtet ein Feld mehr", "Ab Stufe 5 ein 4×4-Feld, ab Stufe 10 sogar 5×5", "Die Lichter werden immer schneller"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    const P = stage ? memory.stage(stage) : null;
    const side = P ? P.side : 3;
    const cellsN = side * side;
    const len = P ? P.length : level < 0.4 ? 3 : level < 0.75 ? 4 : 5;
    const seq: number[] = [];
    while (seq.length < len) {
      const n = rng.int(0, cellsN - 1);
      if (n !== seq[seq.length - 1]) seq.push(n);
    }
    const wrap = h("div", "mem-wrap");
    const label = h("div", "mem-label", "Schau genau hin…");
    const grid = h("div", "mem-grid");
    grid.style.setProperty("--side", String(side));
    if (side >= 4) grid.classList.add(side >= 5 ? "s5" : "s4");
    const cells: HTMLElement[] = [];
    for (let i = 0; i < cellsN; i++) {
      const c = h("button", "mem-cell");
      c.setAttribute("aria-label", `Feld ${i + 1}`);
      cells.push(c);
      grid.append(c);
    }
    const progress = h("div", "mem-progress");
    wrap.append(label, grid);
    if (P) wrap.append(progress);
    el.append(wrap);

    const ON = P ? P.on : 380,
      GAP = P ? P.gap : 140,
      START = 350;
    const timers: number[] = [];
    seq.forEach((n, i) => {
      timers.push(
        window.setTimeout(() => {
          cells[n].classList.add("lit");
          sfx.beat(false);
        }, START + i * (ON + GAP)),
        window.setTimeout(() => cells[n].classList.remove("lit"), START + i * (ON + GAP) + ON),
      );
    });
    const showEnd = START + len * (ON + GAP);
    let ready = false;
    let inputStart = 0;
    let pos = 0;
    const setProgress = () => (progress.textContent = `${pos} / ${len}`);
    timers.push(
      window.setTimeout(() => {
        ready = true;
        inputStart = performance.now();
        label.textContent = "Jetzt du!";
        grid.classList.add("ready");
        setProgress();
      }, showEnd),
    );
    cells.forEach((c, i) =>
      onPress(c, () => {
        if (!ready) return;
        if (i === seq[pos]) {
          c.classList.remove("tap");
          void c.offsetWidth;
          c.classList.add("tap");
          sfx.pop(pos);
          pos += 1;
          setProgress();
          if (pos === len) {
            const t = performance.now() - inputStart;
            finish({ ok: true, rating: Math.max(0, Math.min(1, 1 - (t - len * 280) / (len * 700))), ms: Math.round(t / len) });
          }
        } else {
          c.classList.add("miss");
          cells[seq[pos]].classList.add("reveal");
          finish({ ok: false, reason: "Falsche Reihenfolge" });
        }
      }),
    );
    expose({ sequence: seq.map((n) => cells[n]), isReady: () => ready });
    return { limit: showEnd + len * 900 + 1400, cleanup: () => timers.forEach(clearTimeout) };
  },
};

// =====================================================================
// 11) Im Takt: Schläge hören, den nächsten selbst tippen
// =====================================================================
const beat: MicroGame = {
  id: "beat",
  title: "Im Takt!",
  hint: "Tipp den 4. Schlag genau im Takt",
  howto: "Es kommen drei Schläge im gleichen Takt – du siehst und hörst sie. Den vierten Schlag tippst du selbst, genau im Takt. Zu früh oder zu spät kostet Punkte.",
  emoji: "🥁",
  bg: "radial-gradient(120% 90% at 50% 0%,#2a3fa0,#121633)",
  prep: 0,
  speed: { veryFast: 45, fast: 100 },
  stage: (n) => {
    n = st(n);
    return {
      bpm: Math.min(180, 90 + 5 * (n - 1)),
      // Erlaubte Abweichung in ms (vor oder nach dem Schlag)
      window: Math.max(70, 180 - (n - 1) * 6),
      lead: n >= 10 ? 4 : 3,
    };
  },
  monotone: { bpm: 1, window: -1, lead: 1 },
  progressionText: ["Das Tempo steigt jede Stufe (90 bis 180 BPM)", "Du musst immer genauer treffen", "Ab Stufe 10: vier Vorgabe-Schläge, du tippst den fünften"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    const P = stage ? beat.stage(stage) : null;
    const interval = P ? Math.round(60000 / P.bpm) : Math.round(lerp(640, 430, level) + rng.int(-30, 30));
    const lead = P ? P.lead : 3;
    const START = 450;
    const wrap = h("div", "beat-wrap");
    const ring = h("div", "beat-ring");
    const core = h("div", "beat-core", "♪");
    ring.append(core);
    const dots = h("div", "beat-dots");
    const dotEls: HTMLElement[] = [];
    for (let i = 0; i <= lead; i++) {
      const d = h("span", i === lead ? "beat-dot you" : "beat-dot", i === lead ? "DU" : String(i + 1));
      dotEls.push(d);
      dots.append(d);
    }
    wrap.append(ring, dots);
    el.append(wrap);
    ring.style.setProperty("--beat", `${interval}ms`);

    const t0 = performance.now();
    const target = t0 + START + lead * interval;
    const timers: number[] = [];
    for (let i = 0; i < lead; i++) {
      timers.push(
        window.setTimeout(() => {
          ring.classList.remove("pulse");
          void ring.offsetWidth;
          ring.classList.add("pulse");
          dotEls[i].classList.add("on");
          sfx.beat(i === 0);
        }, START + i * interval),
      );
    }
    const window_ = P ? P.window : interval * 0.42;
    onPress(el, () => {
      const err = performance.now() - target;
      if (err < -window_ || err > window_) {
        dotEls[lead].classList.add("miss");
        finish({ ok: false, reason: err < 0 ? "Zu früh! 🥁" : "Zu spät! 🥁" });
        return;
      }
      ring.classList.remove("pulse");
      void ring.offsetWidth;
      ring.classList.add("pulse", "hit");
      dotEls[lead].classList.add("on");
      core.textContent = `${err > 0 ? "+" : ""}${Math.round(err)} ms`;
      finish({ ok: true, rating: Math.max(0, 1 - Math.abs(err) / window_), ms: Math.round(Math.abs(err)) });
    });
    expose({ targetAt: target });
    return {
      limit: Math.round(START + lead * interval + window_ + 60),
      hideTimer: true,
      cleanup: () => timers.forEach(clearTimeout),
    };
  },
};

// =====================================================================
// 12) Muster: Welche Form kommt als Nächstes?
// =====================================================================
const SHAPES = ["🔴", "🟦", "⭐", "💜", "🔶", "🍀", "⚡", "🌙"] as const;
/** Größerer Vorrat für die Minigame-Stufen */
const SHAPES_STAGE = [...SHAPES, "🔺", "🟢", "💎", "🍩"] as const;
const UNITS: Record<number, number[][]> = {
  2: [[0, 1]],
  3: [
    [0, 1, 2],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ],
  4: [
    [0, 1, 2, 3],
    [0, 0, 1, 1],
    [0, 1, 1, 2],
    [0, 1, 2, 1],
    [0, 1, 0, 2],
    [0, 0, 1, 2],
  ],
};

const pattern: MicroGame = {
  id: "pattern",
  title: "Was kommt dann?",
  hint: "Setz das Muster fort",
  howto: "Oben steht eine Reihe Symbole, die sich nach einem Muster wiederholt. Am Ende ist ein Fragezeichen. Tipp unten das Symbol, das als Nächstes kommt.",
  emoji: "🧩",
  bg: "linear-gradient(160deg,#c6ff3d,#22c36b)",
  prep: 1600,
  speed: { veryFast: 1200, fast: 2100 },
  stage: (n) => {
    n = st(n);
    return {
      period: n >= 9 ? 4 : n >= 4 ? 3 : 2,
      pool: Math.min(SHAPES_STAGE.length, 6 + Math.floor((n - 1) / 3)),
      options: n >= 12 ? 4 : 3,
      limit: Math.max(2800, 4200 - (n - 1) * 70),
    };
  },
  monotone: { period: 1, pool: 1, options: 1, limit: -1 },
  progressionText: ["Das Muster wird länger: 2, dann 3 (ab Stufe 4), dann 4 Teile (ab Stufe 9)", "Mehr verschiedene Symbole", "Ab Stufe 12 vier Antworten statt drei", "Weniger Zeit (bis 2,8 s)"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? pattern.stage(stage) : null;
    const p = P ? P.period : level < 0.35 ? 2 : level < 0.7 ? rng.pick([2, 3]) : 3;
    const shapes: readonly string[] = P ? SHAPES_STAGE.slice(0, P.pool) : SHAPES;
    const unitIdx = rng.pick(UNITS[p]);
    const symbols = rng.shuffle(shapes).slice(0, Math.max(...unitIdx) + 1 < 3 ? 3 : Math.max(...unitIdx) + 1);
    const unit = unitIdx.map((i) => symbols[i]);
    const shown = 2 * p + rng.int(0, p - 1);
    const seq = Array.from({ length: shown }, (_, i) => unit[i % p]);
    const answer = unit[shown % p];
    const used = Array.from(new Set(unit)).filter((x) => x !== answer);
    const extra = shapes.filter((x) => !unit.includes(x));
    const nOpts = P ? P.options : 3;
    const opts = rng.shuffle([answer, ...used.slice(0, nOpts - 1), ...rng.shuffle(extra)].slice(0, nOpts));

    const wrap = h("div", "pat-wrap");
    const row = h("div", "pat-row");
    // Höchstens 2 volle Durchläufe + 1 zeigen, damit die Reihe auf jedes Handy passt
    const visible = seq.slice(-Math.min(seq.length, 2 * p + 1));
    if (visible.length >= 8) row.classList.add("long");
    visible.forEach((x, i) => {
      const c = h("span", "pat-item", x);
      c.style.animationDelay = `${i * 40}ms`;
      row.append(c);
    });
    row.append(h("span", "pat-item q", "?"));
    const choices = h("div", "pat-choices");
    choices.style.setProperty("--cols", String(nOpts));
    let target: HTMLElement | null = null;
    opts.forEach((o) => {
      const b = h("button", "pat-btn", o);
      b.setAttribute("aria-label", "Antwort");
      if (o === answer) target = b;
      onPress(b, () => {
        if (o === answer) {
          b.classList.add("hit");
          finish({ ok: true });
        } else {
          b.classList.add("miss");
          target?.classList.add("reveal");
          finish({ ok: false, reason: `Richtig wäre ${answer}` });
        }
      });
      choices.append(b);
    });
    wrap.append(row, choices);
    el.append(wrap);
    expose({ target });
    return { limit: P ? P.limit : 4200 };
  },
};

export const GAMES: MicroGame[] = [odd, stop, wait, more, pop, sum, ink, swipe, find, memory, beat, pattern, ...GAMES_WAVE3, ...GAMES_WAVE4];
export const GAME_BY_ID: Record<string, MicroGame> = Object.fromEntries(GAMES.map((g) => [g.id, g]));
