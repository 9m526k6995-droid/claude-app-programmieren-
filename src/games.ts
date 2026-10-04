// Die Mini-Challenges. Jede ist in unter 1 Sekunde verstanden und dauert max. ~3 Sekunden.
// Neue Challenges = neues Objekt in GAMES. Mehr braucht es nicht.

import type { Rng } from "./rng";
import type { Sfx } from "./sound";

export interface Outcome {
  ok: boolean;
  /** 0..1 – ersetzt die Zeitwertung, wenn die Challenge selbst Präzision misst */
  rating?: number;
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

export interface MicroGame {
  id: string;
  title: string;
  hint: string;
  emoji: string;
  bg: string;
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
  emoji: "👁️",
  bg: "linear-gradient(160deg,#6a2cff,#b83dff)",
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
  emoji: "🎯",
  bg: "linear-gradient(160deg,#ff3d6e,#ff8a3d)",
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
        finish({ ok: true, rating: 0.35 + rating * 0.65 });
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
  emoji: "🚦",
  bg: "#1c1530",
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
      finish({ ok: true, rating: Math.max(0, Math.min(1, 1 - (rt - 200) / 500)) });
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
  emoji: "⚖️",
  bg: "linear-gradient(160deg,#0fb39a,#25d9e8)",
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
  emoji: "🫧",
  bg: "radial-gradient(120% 90% at 50% 0%,#4a2a7a,#1c1530)",
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
  emoji: "🧮",
  bg: "linear-gradient(160deg,#2f6bff,#6a2cff)",
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
  emoji: "🎨",
  bg: "linear-gradient(160deg,#ffd23d,#ff8a3d)",
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
  emoji: "👉",
  bg: "linear-gradient(160deg,#22c36b,#0fb39a)",
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

export const GAMES: MicroGame[] = [odd, stop, wait, more, pop, sum, ink, swipe];
export const GAME_BY_ID: Record<string, MicroGame> = Object.fromEntries(GAMES.map((g) => [g.id, g]));
