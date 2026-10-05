// Die vierte Welle: 5 Minispiele nach den Mechaniken der Spiele, die 10- bis 16-Jährige gerade am meisten zocken
// (Block Blast, Subway Surfers, Stack, Fruit Ninja, „Rotes Licht, Grünes Licht“ aus Roblox/Squid Game).
// Gleiche Regeln wie in games.ts: `level` 0..1 für die gemischten Modi, `stage(n)` für die Minigame-Läufe.

import type { MicroGame } from "./games";
import { lerp, st, h, onPress } from "./gameKit";

// =====================================================================
// 23) Block-Lücke (wie Block Blast)
// =====================================================================
type Cell = [number, number];

const BLOCK_BASE: Cell[][] = [
  [[0, 0], [0, 1]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [0, 3]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 1]],
  [[0, 1], [0, 2], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]],
  [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
];

interface Piece {
  cells: Cell[];
  key: string;
  base: number;
  rows: number;
  cols: number;
}

function normalize(cells: Cell[]): Cell[] {
  const r0 = Math.min(...cells.map((c) => c[0]));
  const c0 = Math.min(...cells.map((c) => c[1]));
  return cells.map(([r, c]) => [r - r0, c - c0] as Cell).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Alle Drehungen und Spiegelungen jeder Grundform, ohne Doppelte. */
const PIECES: Piece[] = (() => {
  const out: Piece[] = [];
  const seen = new Set<string>();
  BLOCK_BASE.forEach((base, bi) => {
    let cur = base;
    for (let m = 0; m < 2; m++) {
      for (let r = 0; r < 4; r++) {
        const n = normalize(cur);
        const key = n.map((c) => c.join(",")).join(";");
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ cells: n, key, base: bi, rows: Math.max(...n.map((c) => c[0])) + 1, cols: Math.max(...n.map((c) => c[1])) + 1 });
        }
        cur = cur.map(([a, b]) => [b, -a] as Cell);
      }
      cur = base.map(([a, b]) => [a, -b] as Cell);
    }
  });
  return out;
})();

const BLOCK_COLORS = ["#ff3d8b", "#3d7bff", "#2fd17a", "#ffd23d", "#ff8a3d", "#a45cff", "#25d9e8"];

function pieceEl(p: Piece, color: string, cls: string): HTMLButtonElement {
  const b = h("button", cls);
  b.style.setProperty("--r", String(p.rows));
  b.style.setProperty("--c", String(p.cols));
  b.style.setProperty("--col", color);
  const set = new Set(p.cells.map((c) => c.join(",")));
  for (let r = 0; r < p.rows; r++)
    for (let c = 0; c < p.cols; c++) b.append(h("i", set.has(`${r},${c}`) ? "on" : ""));
  b.setAttribute("aria-label", "Block");
  return b;
}

const blocks: MicroGame = {
  id: "blocks",
  title: "Block-Lücke",
  hint: "Welcher Block füllt die Lücke?",
  howto: "Im Spielfeld ist eine Lücke – wie bei Block Blast. Darunter liegen ein paar Blöcke. Tipp genau den Block an, der perfekt in die Lücke passt. Achtung: Gedreht oder gespiegelt passt er nicht!",
  emoji: "🧩",
  bg: "linear-gradient(160deg,#2b1a6e,#3d7bff)",
  prep: 900,
  speed: { veryFast: 900, fast: 1600 },
  stage: (n) => {
    n = st(n);
    return {
      cells: Math.min(5, 2 + Math.ceil(n / 3)),
      options: n >= 5 ? 4 : 3,
      similar: n >= 6 ? 1 : 0,
      limit: Math.max(1800, 4200 - (n - 1) * 110),
    };
  },
  monotone: { cells: 1, options: 1, similar: 1, limit: -1 },
  progressionText: ["Die Lücken werden größer (bis 5 Felder)", "Ab Stufe 5 vier Blöcke zur Auswahl", "Ab Stufe 6 sind gedrehte und gespiegelte Fallen dabei", "Immer weniger Zeit (bis 1,8 s)"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage
      ? blocks.stage(stage)
      : { cells: Math.round(lerp(3, 5, level)), options: level > 0.5 ? 4 : 3, similar: level > 0.6 ? 1 : 0, limit: 4200 };
    const size = (p: Piece) => p.cells.length;
    const pool = PIECES.filter((p) => size(p) <= P.cells && size(p) >= Math.max(2, P.cells - 1));
    const right = rng.pick(pool);
    // Falsche Blöcke: zuerst gedrehte/gespiegelte Varianten (ab „similar“), dann andere Formen ähnlicher Größe
    const wrongs: Piece[] = [];
    const used = new Set([right.key]);
    const take = (list: Piece[]) => {
      for (const p of rng.shuffle(list)) {
        if (wrongs.length >= P.options - 1) return;
        if (!used.has(p.key)) {
          used.add(p.key);
          wrongs.push(p);
        }
      }
    };
    if (P.similar) take(PIECES.filter((p) => p.base === right.base));
    take(PIECES.filter((p) => Math.abs(size(p) - size(right)) <= 1));
    take(PIECES);

    // Spielfeld: 7×6, die Reihen ab der Lücke sind voll – bis auf genau die Lücke
    const COLS = 7;
    const ROWS = 6;
    const r0 = ROWS - right.rows;
    const c0 = rng.int(0, COLS - right.cols);
    const hole = new Set(right.cells.map(([r, c]) => `${r + r0},${c + c0}`));
    const board = h("div", "blk-board");
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const key = `${r},${c}`;
        const cell = h("i", "blk-cell");
        if (hole.has(key)) cell.classList.add("hole");
        else if (r >= r0 || rng.next() < 0.18) {
          cell.classList.add("full");
          cell.style.setProperty("--col", rng.pick(BLOCK_COLORS));
        }
        board.append(cell);
      }
    const color = rng.pick(BLOCK_COLORS);
    const opts = h("div", "blk-opts");
    opts.style.setProperty("--n", String(P.options));
    let target: HTMLElement | null = null;
    let wrong: HTMLElement | null = null;
    rng.shuffle([right, ...wrongs]).forEach((p) => {
      const b = pieceEl(p, color, "blk-piece");
      if (p === right) target = b;
      else wrong ??= b;
      onPress(b, () => {
        if (p === right) {
          b.classList.add("hit");
          board.classList.add("filled");
          finish({ ok: true });
        } else {
          b.classList.add("miss");
          target?.classList.add("reveal");
          finish({ ok: false, reason: "Passt nicht! 🧩" });
        }
      });
      opts.append(b);
    });
    const wrap = h("div", "blk-wrap");
    wrap.append(board, opts);
    el.append(wrap);
    expose({ target, wrong });
    return { limit: P.limit };
  },
};

// =====================================================================
// 24) Ausweichen (wie Subway Surfers)
// =====================================================================
const OBSTACLES = ["🚧", "🚂", "🪨", "🚗"] as const;

const dodge: MicroGame = {
  id: "dodge",
  title: "Ausweichen",
  hint: "Tipp auf eine freie Spur!",
  howto: "Du rennst auf einer von mehreren Spuren. Von oben kommen Hindernisse 🚧 auf dich zu. Tipp rechtzeitig auf eine freie Spur, damit du ausweichst – wer crasht, ist raus.",
  emoji: "🏃",
  bg: "linear-gradient(180deg,#3a3f5c,#6b4a2b)",
  prep: 0,
  speed: { veryFast: 450, fast: 750 },
  stage: (n) => {
    n = st(n);
    return {
      rows: Math.min(16, 4 + n),
      fallMs: Math.max(650, 1500 - (n - 1) * 45),
      gapMs: Math.max(360, 900 - (n - 1) * 30),
      doublePct: n < 3 ? 0 : Math.min(85, 25 + (n - 3) * 6),
      lanes: n >= 10 ? 4 : 3,
    };
  },
  monotone: { rows: 1, fallMs: -1, gapMs: -1, doublePct: 1, lanes: 1 },
  progressionText: ["Jede Stufe ein Hindernis mehr", "Die Hindernisse werden schneller und kommen dichter", "Ab Stufe 3 sind oft zwei Spuren gleichzeitig gesperrt", "Ab Stufe 10 vier Spuren"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    const P = stage
      ? dodge.stage(stage)
      : { rows: Math.round(lerp(4, 7, level)), fallMs: Math.round(lerp(1500, 1100, level)), gapMs: Math.round(lerp(900, 650, level)), doublePct: level > 0.4 ? 40 : 0, lanes: 3 };
    const L = P.lanes;
    const LINE = 0.82; // Höhe des Läufers (Anteil am Feld)
    const field = h("div", "dodge-field");
    field.style.setProperty("--lanes", String(L));
    const laneEls = Array.from({ length: L }, (_, i) => {
      const b = h("button", "dodge-lane");
      b.setAttribute("aria-label", `Spur ${i + 1}`);
      field.append(b);
      return b;
    });
    const runner = h("div", "dodge-runner", "🏃");
    field.append(runner);
    let lane = Math.floor((L - 1) / 2);
    const setLane = (i: number) => {
      lane = i;
      runner.style.setProperty("--lane", String(i));
    };
    setLane(lane);

    const rows: { at: number; blocked: Set<number>; el: HTMLElement; resolved: boolean; gone: boolean }[] = [];
    let t = 450;
    for (let k = 0; k < P.rows; k++) {
      const count = rng.int(1, 100) <= P.doublePct ? L - 1 : rng.int(1, Math.max(1, L - 2));
      let blocked = new Set(rng.shuffle([...Array(L).keys()]).slice(0, count));
      // Das erste Hindernis steht immer genau auf deiner Spur – du musst gleich reagieren
      if (k === 0 && !blocked.has(lane)) blocked = new Set([lane, ...[...blocked].slice(1)]);
      const row = h("div", "dodge-row");
      for (let i = 0; i < L; i++) row.append(h("span", blocked.has(i) ? "dodge-ob" : "", blocked.has(i) ? rng.pick(OBSTACLES) : ""));
      field.append(row);
      rows.push({ at: t, blocked, el: row, resolved: false, gone: false });
      t += P.gapMs;
    }
    const endAt = rows[rows.length - 1].at + P.fallMs;
    el.append(field);

    const t0 = performance.now();
    let over = false;
    let passed = 0;
    const reactions: number[] = [];
    const nearest = (now: number) => rows.find((r) => !r.resolved && now >= r.at);
    let raf = 0;
    const loop = () => {
      const now = performance.now() - t0;
      for (const r of rows) {
        if (r.gone) continue;
        const p = (now - r.at) / P.fallMs;
        if (p < 0) continue;
        r.el.style.top = `${p * LINE * 100 - 6}%`;
        r.el.classList.add("on");
        if (p >= 1 && !r.resolved && !over) {
          r.resolved = true;
          if (r.blocked.has(lane)) {
            over = true;
            runner.classList.add("crash");
            r.el.classList.add("crash");
            finish({ ok: false, reason: "Crash! 💥" });
            return;
          }
          passed += 1;
          sfx.pop(passed);
          if (passed >= rows.length) {
            over = true;
            const avg = reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : 400;
            finish({ ok: true, ms: Math.round(avg), rating: Math.max(0, Math.min(1, 1 - (avg - 250) / 900)) });
            return;
          }
        }
        if (p > 1.35) {
          r.gone = true;
          r.el.remove();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    laneEls.forEach((b, i) =>
      onPress(b, () => {
        if (over || i === lane) return;
        const now = performance.now() - t0;
        const r = nearest(now);
        if (r && r.blocked.has(lane) && !r.blocked.has(i)) reactions.push(now - r.at);
        setLane(i);
      }),
    );
    expose({
      need: () => {
        const r = nearest(performance.now() - t0);
        if (!r || !r.blocked.has(lane)) return null;
        return laneEls[[...Array(L).keys()].find((i) => !r.blocked.has(i))!];
      },
      wrongLane: () => {
        const r = rows.find((x) => !x.resolved);
        return r ? laneEls[[...r.blocked][0]] : null;
      },
      done: () => over,
    });
    return { limit: endAt + 600, cleanup: () => cancelAnimationFrame(raf) };
  },
};

// =====================================================================
// 25) Stapelturm (wie Stack)
// =====================================================================
const stack: MicroGame = {
  id: "stack",
  title: "Stapelturm",
  hint: "Tippen, wenn der Block genau drüber ist",
  howto: "Ein Block gleitet hin und her. Tipp, um ihn fallen zu lassen – was übersteht, wird abgeschnitten und der Turm wird schmaler. Triffst du gar nicht mehr, kippt alles. Bau den Turm bis oben!",
  emoji: "🏗️",
  bg: "linear-gradient(180deg,#ff8a3d,#a45cff)",
  prep: 0,
  speed: { veryFast: 40, fast: 90 },
  stage: (n) => {
    n = st(n);
    return {
      blocks: Math.min(12, 3 + Math.floor(n / 2)),
      speed: Math.min(190, 70 + (n - 1) * 7),
      startW: Math.max(30, 60 - (n - 1) * 2),
    };
  },
  monotone: { blocks: 1, speed: 1, startW: -1 },
  progressionText: ["Der Turm muss immer höher werden (bis 12 Blöcke)", "Die Blöcke gleiten immer schneller", "Der Startblock wird schmaler"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    const P = stage ? stack.stage(stage) : { blocks: Math.round(lerp(3, 5, level)), speed: Math.round(lerp(70, 110, level)), startW: Math.round(lerp(60, 50, level)) };
    const BH = 9; // Blockhöhe in % des Felds
    const VISIBLE = 6;
    const field = h("div", "stack-field");
    const hue = rng.int(0, 359);
    const placed: { x: number; w: number; el: HTMLElement }[] = [];
    const color = (i: number) => `hsl(${(hue + i * 22) % 360} 90% 60%)`;
    const blockEl = (x: number, w: number, i: number) => {
      const b = h("div", "stack-block");
      b.style.left = `${x}%`;
      b.style.width = `${w}%`;
      b.style.background = color(i);
      field.append(b);
      return b;
    };
    const layout = () => {
      const shift = Math.max(0, placed.length - VISIBLE);
      placed.forEach((p, i) => (p.el.style.bottom = `${(i - shift) * BH + 4}%`));
      mover.style.bottom = `${(placed.length - shift) * BH + 4}%`;
    };
    const base = blockEl((100 - P.startW) / 2, P.startW, 0);
    base.classList.add("base");
    placed.push({ x: (100 - P.startW) / 2, w: P.startW, el: base });
    const mover = blockEl(0, P.startW, 1);
    mover.classList.add("moving");
    const counter = h("div", "stack-count", `0 / ${P.blocks}`);
    field.append(counter);
    el.append(field);
    layout();

    let over = false;
    let moving = false;
    let startAt = 0;
    let fromRight = rng.bool();
    let offset = 0;
    let stacked = 0;
    const errors: number[] = [];
    const top = () => placed[placed.length - 1];
    const amp = () => top().w * 1.3;
    const startMove = () => {
      moving = true;
      startAt = performance.now();
      fromRight = !fromRight;
      mover.style.width = `${top().w}%`;
      mover.style.background = color(placed.length);
      mover.classList.remove("hidden");
      layout();
    };
    let raf = 0;
    const loop = () => {
      if (moving) {
        const A = amp();
        const d = (((performance.now() - startAt) * P.speed) / 1000) % (4 * A);
        offset = (d < 2 * A ? -A + d : 3 * A - d) * (fromRight ? -1 : 1);
        mover.style.left = `${top().x + offset}%`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const timers: number[] = [window.setTimeout(startMove, 350)];

    onPress(field, () => {
      if (over || !moving) return;
      moving = false;
      const t = top();
      let o = offset;
      if (Math.abs(o) <= Math.max(1, t.w * 0.04)) o = 0; // fast perfekt → rastet ein
      const overlap = t.w - Math.abs(o);
      if (overlap <= 0) {
        over = true;
        mover.classList.add("fall");
        finish({ ok: false, reason: "Daneben! Der Turm kippt 🏗️" });
        return;
      }
      const nx = t.x + Math.max(o, 0);
      // Abgeschnittenes Stück fällt runter
      if (o !== 0) {
        const cut = blockEl(o > 0 ? t.x + t.w : t.x + o, Math.abs(o), placed.length);
        cut.style.bottom = mover.style.bottom;
        cut.classList.add("cut", o > 0 ? "right" : "left");
        timers.push(window.setTimeout(() => cut.remove(), 600));
      } else {
        field.classList.remove("perfect");
        void field.offsetWidth;
        field.classList.add("perfect");
      }
      const b = blockEl(nx, overlap, placed.length);
      placed.push({ x: nx, w: overlap, el: b });
      mover.classList.add("hidden");
      errors.push((Math.abs(o) / P.speed) * 1000);
      stacked += 1;
      sfx.pop(stacked);
      counter.textContent = `${stacked} / ${P.blocks}`;
      layout();
      if (stacked >= P.blocks) {
        over = true;
        const avg = errors.reduce((a, b) => a + b, 0) / errors.length;
        finish({ ok: true, ms: Math.round(avg), rating: Math.max(0, Math.min(1, 1 - avg / 250)) });
        return;
      }
      timers.push(window.setTimeout(startMove, 160));
    });
    expose({
      aligned: () => moving && Math.abs(offset) < Math.max(1.2, top().w * 0.06),
      missing: () => moving && Math.abs(offset) >= top().w + 2,
      done: () => over,
    });
    return {
      limit: 600 + P.blocks * Math.round(((4 * 1.3 * P.startW) / P.speed) * 1000 * 0.75 + 600),
      cleanup: () => {
        cancelAnimationFrame(raf);
        timers.forEach(clearTimeout);
      },
    };
  },
};

// =====================================================================
// 26) Schnippeln (wie Fruit Ninja)
// =====================================================================
const FRUITS = ["🍉", "🍎", "🍊", "🍋", "🍍", "🥝", "🍑", "🍇", "🍓", "🥥"] as const;

const slice: MicroGame = {
  id: "slice",
  title: "Schnippeln",
  hint: "Früchte durchwischen – keine Bombe!",
  howto: "Früchte fliegen hoch. Wisch mit dem Finger durch jede Frucht, bevor sie wieder runterfällt – einfach antippen reicht nicht! Wischst du durch eine Bombe 💣, ist es vorbei.",
  emoji: "🍉",
  bg: "linear-gradient(180deg,#3b2414,#7a4a24)",
  prep: 0,
  speed: { veryFast: 650, fast: 950 },
  stage: (n) => {
    n = st(n);
    return {
      fruits: Math.min(12, 3 + Math.floor(n / 2)),
      airMs: Math.max(1100, 2000 - (n - 1) * 50),
      bombPct: n < 3 ? 0 : Math.min(40, 12 + (n - 3) * 3),
      gapMs: Math.max(260, 750 - (n - 1) * 30),
    };
  },
  monotone: { fruits: 1, airMs: -1, bombPct: 1, gapMs: -1 },
  progressionText: ["Immer mehr Früchte", "Sie fliegen schneller und kommen dichter hintereinander", "Ab Stufe 3 fliegen Bomben mit – immer mehr"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    const P = stage
      ? slice.stage(stage)
      : { fruits: Math.round(lerp(3, 5, level)), airMs: Math.round(lerp(2000, 1600, level)), bombPct: level > 0.5 ? 15 : 0, gapMs: Math.round(lerp(720, 560, level)) };
    const field = h("div", "slice-field");
    el.append(field);
    interface Item {
      el: HTMLElement;
      bomb: boolean;
      x0: number;
      x1: number;
      peak: number;
      at: number;
      cut: boolean;
      px: number;
      py: number;
      p: number;
    }
    const items: Item[] = [];
    let t = 350;
    let fruits = 0;
    let lastBomb = false;
    while (fruits < P.fruits) {
      const bomb: boolean = !lastBomb && fruits > 0 && rng.int(1, 100) <= P.bombPct;
      lastBomb = bomb;
      const x0 = rng.int(15, 85);
      const x1 = Math.max(10, Math.min(90, x0 + rng.int(-18, 18)));
      const e = h("span", `slice-item${bomb ? " bomb" : ""}`, bomb ? "💣" : rng.pick(FRUITS));
      field.append(e);
      items.push({ el: e, bomb, x0, x1, peak: rng.int(58, 80) / 100, at: t, cut: false, px: -999, py: -999, p: -1 });
      if (!bomb) fruits += 1;
      t += P.gapMs;
    }
    const endAt = items[items.length - 1].at + P.airMs;
    const R = 36; // Trefferradius in px
    const t0 = performance.now();
    let over = false;
    let hits = 0;
    const times: number[] = [];
    let raf = 0;
    const loop = () => {
      const now = performance.now() - t0;
      const W = field.clientWidth;
      const H = field.clientHeight;
      for (const it of items) {
        const p = (now - it.at) / P.airMs;
        it.p = p;
        if (p < 0 || p > 1.05) {
          it.el.classList.remove("on");
          continue;
        }
        const x = it.x0 + (it.x1 - it.x0) * p;
        const y = 112 - (112 - (1 - it.peak) * 100) * 4 * p * (1 - p);
        it.px = (x / 100) * W;
        it.py = (y / 100) * H;
        if (!it.cut) {
          it.el.classList.add("on");
          it.el.style.transform = `translate(${it.px}px, ${it.py}px) translate(-50%,-50%) rotate(${Math.round(p * 300)}deg)`;
        }
        if (p >= 1 && !it.bomb && !it.cut && !over) {
          over = true;
          finish({ ok: false, reason: "Verpasst! 🍉" });
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    let down = false;
    let lx = 0;
    let ly = 0;
    const pos = (e: PointerEvent) => {
      const b = field.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    };
    const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
    };
    onPress(field, (e) => {
      down = true;
      [lx, ly] = pos(e);
    });
    const move = (e: PointerEvent) => {
      if (!down || over) return;
      const [x, y] = pos(e);
      const len = Math.hypot(x - lx, y - ly);
      if (len < 3) return;
      if (len > 8) {
        const dot = h("i", "slice-trail");
        dot.style.transform = `translate(${x}px, ${y}px)`;
        field.append(dot);
        window.setTimeout(() => dot.remove(), 260);
      }
      const now = performance.now() - t0;
      for (const it of items) {
        if (it.cut || it.p < 0 || it.p > 1) continue;
        if (segDist(it.px, it.py, lx, ly, x, y) > R) continue;
        if (it.bomb) {
          over = true;
          it.el.classList.add("boom");
          finish({ ok: false, reason: "Bombe! 💥" });
          return;
        }
        it.cut = true;
        it.el.classList.add("cut");
        hits += 1;
        times.push(now - it.at);
        sfx.pop(hits);
        if (hits >= P.fruits) {
          over = true;
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          finish({ ok: true, ms: Math.round(avg), rating: Math.max(0, Math.min(1, 1 - (avg - 400) / 1000)) });
          return;
        }
      }
      lx = x;
      ly = y;
    };
    const up = () => (down = false);
    field.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    expose({
      // Für die Tests: eine Frucht, die gerade gut erreichbar ist und keine Bombe in der Nähe hat
      nextFruit: () => {
        const b = field.getBoundingClientRect();
        const f = items.find(
          (it) =>
            !it.bomb && !it.cut && it.p > 0.2 && it.p < 0.8 &&
            !items.some((o) => o.bomb && o.p > -0.15 && o.p < 1.05 && Math.abs(o.px - it.px) < 110),
        );
        return f ? { x: b.left + f.px, y: b.top + f.py } : null;
      },
      done: () => over,
    });
    return {
      limit: endAt + 500,
      cleanup: () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      },
    };
  },
};

// =====================================================================
// 27) Rotes Licht, Grünes Licht
// =====================================================================
const ampel: MicroGame = {
  id: "ampel",
  title: "Rotes Licht",
  hint: "Halten = laufen. Bei Rot loslassen!",
  howto: "Halt den Knopf gedrückt, dann läuft deine Figur Richtung Ziel 🏁 – aber nur bei Grün. Springt die Ampel auf Rot, musst du sofort loslassen. Wer bei Rot noch drückt, wird erwischt!",
  emoji: "🚦",
  bg: "linear-gradient(180deg,#1b6e3a,#d8b56a)",
  prep: 0,
  speed: { veryFast: 250, fast: 380 },
  stage: (n) => {
    n = st(n);
    return {
      need: Math.min(4200, 2200 + (n - 1) * 120),
      graceMs: Math.max(180, 450 - (n - 1) * 18),
      greenMin: Math.max(300, 900 - (n - 1) * 40),
      greenMax: Math.max(700, 1700 - (n - 1) * 60),
    };
  },
  monotone: { need: 1, graceMs: -1, greenMin: -1, greenMax: -1 },
  progressionText: ["Der Weg zum Ziel wird länger", "Du hast immer weniger Zeit zum Loslassen (bis 0,18 s)", "Die grünen Phasen werden kürzer und unberechenbarer"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    const P = stage
      ? ampel.stage(stage)
      : { need: Math.round(lerp(2200, 3000, level)), graceMs: Math.round(lerp(450, 300, level)), greenMin: Math.round(lerp(900, 600, level)), greenMax: Math.round(lerp(1700, 1300, level)) };
    // Ablauf: kurz „Bereit“, dann abwechselnd Grün und Rot
    const READY = 350;
    const phases: { green: boolean; from: number; to: number }[] = [];
    let t = READY;
    let greenSum = 0;
    let reachAt = 0;
    while (greenSum < P.need + 4000) {
      const g = rng.int(P.greenMin, P.greenMax);
      phases.push({ green: true, from: t, to: t + g });
      if (!reachAt && greenSum + g >= P.need) reachAt = t + (P.need - greenSum);
      greenSum += g;
      t += g;
      const r = rng.int(600, 1200);
      phases.push({ green: false, from: t, to: t + r });
      t += r;
    }
    const wrap = h("div", "amp-wrap");
    const light = h("div", "amp-light ready");
    const track = h("div", "amp-track");
    const goal = h("span", "amp-goal", "🏁");
    const fig = h("span", "amp-fig", "🏃");
    track.append(goal, fig);
    const pad = h("button", "amp-pad", "HALTEN");
    pad.setAttribute("aria-label", "Gedrückt halten zum Laufen");
    wrap.append(light, track, pad);
    el.append(wrap);

    const t0 = performance.now();
    let pressed = false;
    let over = false;
    let progress = 0;
    let last = 0;
    let phaseIdx = -1;
    let redAt = 0;
    let heldAtRed = false;
    const reactions: number[] = [];
    const state = (now: number): "ready" | "green" | "red" => {
      if (now < READY) return "ready";
      while (phaseIdx + 1 < phases.length && now >= phases[phaseIdx + 1].from) {
        phaseIdx += 1;
        const ph = phases[phaseIdx];
        if (!ph.green) {
          redAt = ph.from;
          heldAtRed = pressed;
        }
        light.className = `amp-light ${ph.green ? "green" : "red"}`;
        pad.textContent = ph.green ? "LOS!" : "STOPP!";
        if (ph.green) sfx.go();
        else sfx.tick();
      }
      return phaseIdx >= 0 && phases[phaseIdx].green ? "green" : phaseIdx >= 0 ? "red" : "ready";
    };
    const caught = () => {
      over = true;
      fig.classList.add("caught");
      pad.classList.add("miss");
      finish({ ok: false, reason: "Erwischt! 🚨" });
    };
    let raf = 0;
    const loop = () => {
      const now = performance.now() - t0;
      const s = state(now);
      const dt = Math.min(100, now - last);
      last = now;
      if (s === "green" && pressed) progress += dt;
      if (s === "red" && pressed && now - redAt > P.graceMs) return caught();
      fig.style.bottom = `${Math.min(100, (progress / P.need) * 100) * 0.82}%`;
      fig.classList.toggle("run", pressed && s === "green");
      if (progress >= P.need && !over) {
        over = true;
        const avg = reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : 300;
        finish({ ok: true, ms: Math.round(avg), rating: Math.max(0, Math.min(1, 1 - (avg - 150) / 400)) });
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    onPress(pad, () => {
      if (over) return;
      pressed = true;
      pad.classList.add("down");
      const now = performance.now() - t0;
      if (state(now) === "red" && now - redAt > P.graceMs) caught();
    });
    const release = () => {
      if (!pressed) return;
      pressed = false;
      pad.classList.remove("down");
      const now = performance.now() - t0;
      if (!over && state(now) === "red" && heldAtRed) {
        reactions.push(now - redAt);
        heldAtRed = false;
      }
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    expose({
      pad,
      light: () => (over ? "over" : state(performance.now() - t0)),
      done: () => over,
    });
    return {
      limit: reachAt + 3500,
      cleanup: () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
      },
    };
  },
};

export const GAMES_WAVE4: MicroGame[] = [blocks, dodge, stack, slice, ampel];
