// Die Mini-Challenges. Jede ist in unter 1 Sekunde verstanden und dauert max. ~3 Sekunden.
// Neue Challenges = neues Objekt in GAMES. Mehr braucht es nicht.

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
  /** 0 = leicht, 1 = schwer */
  level: number;
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

/** So lange (ms) wird ein Minispiel beim ersten Mal erklärt, bevor es losgeht. */
export const EXPLAIN_MS = 10_000;

export interface MicroGame {
  id: string;
  title: string;
  hint: string;
  /** Ausführliche Erklärung (2–3 kurze Sätze), wird beim ersten Mal mindestens EXPLAIN_MS lang gezeigt. */
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
  mount(ctx: Ctx): Mounted;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function onPress(el: HTMLElement, fn: (e: PointerEvent) => void) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn(e);
  });
}

/** Zufällige, sich kaum überlappende Positionen in einem Raster (in %). */
function scatter(rng: Rng, count: number, cols: number, rows: number, pad = 8) {
  const cells: [number, number][] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cells.push([c, r]);
  return rng
    .shuffle(cells)
    .slice(0, count)
    .map(([c, r]) => {
      const w = (100 - pad * 2) / cols;
      const hh = (100 - pad * 2) / rows;
      return {
        x: pad + c * w + w * (0.25 + rng.next() * 0.5),
        y: pad + r * hh + hh * (0.25 + rng.next() * 0.5),
      };
    });
}

export const PALETTE = ["#ff3d8b", "#3d7bff", "#2fd17a", "#ffd23d", "#ff8a3d", "#a45cff", "#25d9e8"];

// 1) Finde das eine Feld, das anders aussieht
const odd: MicroGame = {
  id: "odd",
  title: "Finde den Anderen",
  hint: "Ein Feld ist anders. Tippen!",
  howto: "Du siehst lauter Felder in fast derselben Farbe. Genau eins ist ein kleines bisschen heller oder dunkler. Tipp genau dieses Feld an – je schneller, desto mehr Punkte.",
  emoji: "👁️",
  bg: "linear-gradient(160deg,#6a2cff,#b83dff)",
  prep: 1200,
  speed: { veryFast: 900, fast: 1700 },
  mount({ el, rng, level, finish, expose }) {
    const n = level < 0.3 ? 3 : level < 0.7 ? 4 : 5;
    const hue = rng.int(0, 359);
    const sat = rng.int(72, 92);
    const L = rng.int(50, 60);
    const d = Math.round(lerp(22, 9, level));
    const dir = rng.bool() ? 1 : -1;
    const oddIdx = rng.int(0, n * n - 1);
    const grid = h("div", "odd-grid");
    grid.style.setProperty("--n", String(n));
    const tiles: HTMLElement[] = [];
    for (let i = 0; i < n * n; i++) {
      const t = h("button", "odd-tile");
      t.setAttribute("aria-label", "Feld");
      t.style.background = `hsl(${hue} ${sat}% ${i === oddIdx ? L + dir * d : L}%)`;
      t.style.animationDelay = `${i * 12}ms`;
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
    return { limit: 3800 };
  },
};

// 2) Stoppe die Nadel im Feld
const stop: MicroGame = {
  id: "stop",
  title: "Stopp im Feld",
  hint: "Tippen, wenn der Strich im Feld ist",
  howto: "Ein Strich saust auf einem Balken hin und her. Irgendwo auf dem Balken ist ein hellgrünes Feld. Tipp genau dann, wenn der Strich mitten in diesem Feld ist.",
  emoji: "🎯",
  bg: "linear-gradient(160deg,#ff3d6e,#ff8a3d)",
  prep: 1000,
  speed: { veryFast: 250, fast: 550 },
  mount({ el, rng, level, finish, expose }) {
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

// 3) Reaktionstest: erst bei Grün tippen
const wait: MicroGame = {
  id: "wait",
  title: "Warte auf Grün",
  hint: "Zu früh tippen = raus",
  howto: "Der Bildschirm ist erst rot – jetzt nicht tippen! Sobald er grün wird, tippst du so schnell du kannst. Wer zu früh tippt, hat verloren.",
  emoji: "🚦",
  bg: "#1c1530",
  prep: 0,
  speed: { veryFast: 300, fast: 420 },
  mount({ el, rng, finish, sfx, expose }) {
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

// 4) Welche Seite hat mehr Punkte?
const more: MicroGame = {
  id: "more",
  title: "Wo sind mehr?",
  hint: "Tipp die Seite mit mehr Punkten",
  howto: "Links und rechts liegen Punkte. Tipp die Seite, auf der mehr Punkte sind. Nicht zählen, einfach schätzen – sonst wird die Zeit knapp.",
  emoji: "⚖️",
  bg: "linear-gradient(160deg,#0fb39a,#25d9e8)",
  prep: 1300,
  speed: { veryFast: 800, fast: 1500 },
  mount({ el, rng, level, finish, expose }) {
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

// 5) Alle Blasen zerplatzen lassen
const pop: MicroGame = {
  id: "pop",
  title: "Alle zerplatzen",
  hint: "Tipp jede Blase weg",
  howto: "Auf dem Bildschirm tauchen Blasen auf. Tipp jede einzelne Blase weg, bis keine mehr übrig ist. Die Zeit läuft oben im Balken ab.",
  emoji: "🫧",
  bg: "radial-gradient(120% 90% at 50% 0%,#4a2a7a,#1c1530)",
  prep: 900,
  speed: { veryFast: 1400, fast: 2300 },
  mount({ el, rng, level, finish, sfx, expose }) {
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

// 6) Stimmt die Rechnung?
const sum: MicroGame = {
  id: "sum",
  title: "Stimmt das?",
  hint: "✓ oder ✗ – schnell!",
  howto: "Du siehst eine Rechnung mit Ergebnis, zum Beispiel 7 + 5 = 12. Stimmt das Ergebnis, tippst du ✓. Ist es falsch, tippst du ✗.",
  emoji: "🧮",
  bg: "linear-gradient(160deg,#2f6bff,#6a2cff)",
  prep: 1500,
  speed: { veryFast: 1200, fast: 2100 },
  mount({ el, rng, level, finish, expose }) {
    const op = level < 0.35 ? "+" : rng.pick(["+", "−", "×"] as const);
    let a: number, b: number, real: number;
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
    const truth = rng.bool();
    let shown = real;
    if (!truth) {
      const offs = op === "×" ? [-a, a, -1, 1, 10] : [-10, -2, -1, 1, 2, 10];
      shown = real + rng.pick(offs);
      if (shown < 0 || shown === real) shown = real + 1;
    }
    const wrap = h("div", "sum-wrap");
    wrap.append(h("div", "sum-eq", `${a} ${op} ${b} = ${shown}`));
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
    return { limit: 3400 };
  },
};

// 7) Farbe, nicht Wort (Stroop)
const INKS = [
  { n: "ROT", c: "#ff3d5a" },
  { n: "BLAU", c: "#3d7bff" },
  { n: "GRÜN", c: "#22c36b" },
  { n: "GELB", c: "#ffc61a" },
  { n: "LILA", c: "#a45cff" },
] as const;

const ink: MicroGame = {
  id: "ink",
  title: "Farbe, nicht Wort!",
  hint: "Welche FARBE hat das Wort?",
  howto: "Ein Farbwort steht da, zum Beispiel ROT – aber in einer anderen Farbe geschrieben. Tipp die Farbe, in der das Wort geschrieben ist. Was da steht, ist egal!",
  emoji: "🎨",
  bg: "linear-gradient(160deg,#ffd23d,#ff8a3d)",
  prep: 1300,
  speed: { veryFast: 900, fast: 1600 },
  mount({ el, rng, level, finish, expose }) {
    const pool = rng.shuffle(INKS).slice(0, 4);
    const inkColor = pool[0];
    const word = level < 0.2 && rng.bool(0.3) ? inkColor : pool[rng.int(1, 3)];
    const wrap = h("div", "ink-wrap");
    const card = h("div", "ink-card");
    const w = h("div", "ink-word", word.n);
    w.style.color = inkColor.c;
    card.append(w);
    const row = h("div", "ink-row");
    let target: HTMLElement | null = null;
    rng.shuffle(pool).forEach((p) => {
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
    return { limit: 3400 };
  },
};

// 8) Wisch in Pfeilrichtung (oder genau andersrum)
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
  mount({ el, rng, level, finish, expose }) {
    const dir = rng.pick(["up", "down", "left", "right"] as const);
    const invert = level > 0.3 && rng.bool(0.5);
    const expected: Dir = invert ? OPP[dir] : dir;
    const wrap = h("div", "swipe-wrap");
    if (invert) wrap.append(h("div", "swipe-flag", "GEGENTEIL!"));
    const arrow = h("div", `swipe-arrow${invert ? " inv" : ""}`, "➜");
    arrow.style.setProperty("--rot", `${ROT[dir]}deg`);
    wrap.append(arrow);
    el.append(wrap);
    let sx = 0,
      sy = 0,
      down = false;
    const judge = (d: Dir) => {
      arrow.classList.add(d === expected ? "hit" : "miss");
      if (d === expected) finish({ ok: true });
      else finish({ ok: false, reason: invert ? "Gegenteil vergessen!" : "Falsche Richtung" });
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
    expose({ dir: expected });
    return {
      limit: 2900,
      cleanup: () => {
        el.removeEventListener("pointerdown", pd);
        window.removeEventListener("pointerup", pu);
        window.removeEventListener("keydown", kd);
      },
    };
  },
};

// 9) Suchbild: das gesuchte Emoji im Gewimmel finden
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
  mount({ el, rng, level, finish, expose }) {
    const fam = rng.pick(FAMILIES);
    const target = rng.pick(fam);
    const others = fam.filter((e) => e !== target);
    const cols = level < 0.3 ? 4 : level < 0.7 ? 5 : 6;
    const count = cols * (level < 0.3 ? 4 : level < 0.7 ? 5 : 6);
    const at = rng.int(0, count - 1);
    const wrap = h("div", "find-wrap");
    const head = h("div", "find-target");
    head.append(h("span", "", "Finde"), h("b", "", target));
    const grid = h("div", "find-grid");
    grid.style.setProperty("--cols", String(cols));
    let targetEl: HTMLElement | null = null;
    for (let i = 0; i < count; i++) {
      const isT = i === at;
      const b = h("button", "find-cell", isT ? target : rng.pick(others));
      b.setAttribute("aria-label", isT ? "Gesuchtes Emoji" : "Emoji");
      b.style.animationDelay = `${i * 8}ms`;
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
    return { limit: 4200 + Math.round(level * 1200) };
  },
};

// 10) Blitz-Memory: Reihenfolge merken und nachtippen
const memory: MicroGame = {
  id: "memory",
  title: "Merk dir's!",
  hint: "Schau zu – dann in gleicher Reihenfolge tippen",
  howto: "Ein paar Felder leuchten nacheinander auf. Schau genau hin und merk dir die Reihenfolge. Danach tippst du die Felder genau so nach.",
  emoji: "🧠",
  bg: "linear-gradient(160deg,#a45cff,#ff3d8b)",
  prep: 0,
  speed: { veryFast: 350, fast: 600 },
  mount({ el, rng, level, finish, sfx, expose }) {
    const len = level < 0.4 ? 3 : level < 0.75 ? 4 : 5;
    const seq: number[] = [];
    while (seq.length < len) {
      const n = rng.int(0, 8);
      if (n !== seq[seq.length - 1]) seq.push(n);
    }
    const wrap = h("div", "mem-wrap");
    const label = h("div", "mem-label", "Schau genau hin…");
    const grid = h("div", "mem-grid");
    const cells: HTMLElement[] = [];
    for (let i = 0; i < 9; i++) {
      const c = h("button", "mem-cell");
      c.setAttribute("aria-label", `Feld ${i + 1}`);
      cells.push(c);
      grid.append(c);
    }
    wrap.append(label, grid);
    el.append(wrap);

    const ON = 380,
      GAP = 140,
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
    timers.push(
      window.setTimeout(() => {
        ready = true;
        inputStart = performance.now();
        label.textContent = "Jetzt du!";
        grid.classList.add("ready");
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

// 11) Im Takt: drei Schläge hören, den vierten selbst tippen
const beat: MicroGame = {
  id: "beat",
  title: "Im Takt!",
  hint: "Tipp den 4. Schlag genau im Takt",
  howto: "Es kommen drei Schläge im gleichen Takt – du siehst und hörst sie. Den vierten Schlag tippst du selbst, genau im Takt. Zu früh oder zu spät kostet Punkte.",
  emoji: "🥁",
  bg: "radial-gradient(120% 90% at 50% 0%,#2a3fa0,#121633)",
  prep: 0,
  speed: { veryFast: 45, fast: 100 },
  mount({ el, rng, level, finish, sfx, expose }) {
    const interval = Math.round(lerp(640, 430, level) + rng.int(-30, 30));
    const START = 450;
    const wrap = h("div", "beat-wrap");
    const ring = h("div", "beat-ring");
    const core = h("div", "beat-core", "♪");
    ring.append(core);
    const dots = h("div", "beat-dots");
    const dotEls: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) {
      const d = h("span", i === 3 ? "beat-dot you" : "beat-dot", i === 3 ? "DU" : String(i + 1));
      dotEls.push(d);
      dots.append(d);
    }
    wrap.append(ring, dots);
    el.append(wrap);
    ring.style.setProperty("--beat", `${interval}ms`);

    const t0 = performance.now();
    const target = t0 + START + 3 * interval;
    const timers: number[] = [];
    for (let i = 0; i < 3; i++) {
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
    const window_ = interval * 0.42;
    onPress(el, () => {
      const err = performance.now() - target;
      if (err < -window_ || err > window_) {
        dotEls[3].classList.add("miss");
        finish({ ok: false, reason: err < 0 ? "Zu früh! 🥁" : "Zu spät! 🥁" });
        return;
      }
      ring.classList.remove("pulse");
      void ring.offsetWidth;
      ring.classList.add("pulse", "hit");
      dotEls[3].classList.add("on");
      core.textContent = `${err > 0 ? "+" : ""}${Math.round(err)} ms`;
      finish({ ok: true, rating: Math.max(0, 1 - Math.abs(err) / window_), ms: Math.round(Math.abs(err)) });
    });
    expose({ targetAt: target });
    return {
      limit: Math.round(START + 3 * interval + window_ + 60),
      hideTimer: true,
      cleanup: () => timers.forEach(clearTimeout),
    };
  },
};

// 12) Muster: Welche Form kommt als Nächstes?
const SHAPES = ["🔴", "🟦", "⭐", "💜", "🔶", "🍀", "⚡", "🌙"] as const;
const UNITS: Record<number, number[][]> = {
  2: [[0, 1]],
  3: [
    [0, 1, 2],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
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
  mount({ el, rng, level, finish, expose }) {
    const p = level < 0.35 ? 2 : level < 0.7 ? rng.pick([2, 3]) : 3;
    const unitIdx = rng.pick(UNITS[p]);
    const symbols = rng.shuffle(SHAPES).slice(0, 3);
    const unit = unitIdx.map((i) => symbols[i]);
    const shown = 2 * p + rng.int(0, p - 1);
    const seq = Array.from({ length: shown }, (_, i) => unit[i % p]);
    const answer = unit[shown % p];
    const used = Array.from(new Set(unit)).filter((x) => x !== answer);
    const extra = SHAPES.filter((x) => !unit.includes(x));
    const opts = rng.shuffle([answer, ...used.slice(0, 2), ...rng.shuffle(extra)].slice(0, 3));

    const wrap = h("div", "pat-wrap");
    const row = h("div", "pat-row");
    // Höchstens 2 volle Durchläufe + 1 zeigen, damit die Reihe auf jedes Handy passt
    seq.slice(-Math.min(seq.length, 2 * p + 1)).forEach((x, i) => {
      const c = h("span", "pat-item", x);
      c.style.animationDelay = `${i * 40}ms`;
      row.append(c);
    });
    row.append(h("span", "pat-item q", "?"));
    const choices = h("div", "pat-choices");
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
    return { limit: 4200 };
  },
};

export const GAMES: MicroGame[] = [odd, stop, wait, more, pop, sum, ink, swipe, find, memory, beat, pattern];
export const GAME_BY_ID: Record<string, MicroGame> = Object.fromEntries(GAMES.map((g) => [g.id, g]));
