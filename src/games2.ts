// Die zweite Welle: 10 weitere Minispiele.
// Gleiche Regeln wie in games.ts: `level` 0..1 für die gemischten Modi, `stage(n)` für die Minigame-Läufe.

import type { MicroGame } from "./games";
import { lerp, st, h, onPress, scatter } from "./gameKit";
import type { Rng } from "./rng";

/** Rückgabe für Spiele mit eigener Vorlaufphase: misst die Antwortzeit ab dem Moment, ab dem getippt werden darf. */
function ready(): { at: number; set: () => void; ms: () => number } {
  const r = { at: 0, set: () => (r.at = performance.now()), ms: () => Math.round(performance.now() - r.at) };
  return r;
}

const fmtNum = (v: number, digits = 0) => v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// =====================================================================
// 13) Zähl schnell
// =====================================================================
const COUNT_ITEMS = ["⭐", "🍎", "🐸", "⚽", "🎈", "🍩", "🦆", "💎"] as const;

const count: MicroGame = {
  id: "count",
  title: "Zähl schnell",
  hint: "Wie viele waren es?",
  howto: "Ein paar gleiche Dinge blitzen ganz kurz auf und verschwinden dann. Merk dir, wie viele es waren, und tipp danach die richtige Zahl an.",
  emoji: "🔢",
  bg: "linear-gradient(160deg,#ff8a3d,#ffd23d)",
  prep: 0,
  speed: { veryFast: 700, fast: 1300 },
  stage: (n) => {
    n = st(n);
    return {
      base: Math.min(20, 4 + Math.floor((n - 1) * 0.8)),
      showMs: Math.max(450, 1400 - (n - 1) * 40),
      options: n >= 8 ? 4 : 3,
      answerMs: Math.max(1800, 3200 - (n - 1) * 50),
    };
  },
  monotone: { base: 1, showMs: -1, options: 1, answerMs: -1 },
  progressionText: ["Es werden immer mehr Dinge (bis 20)", "Sie sind immer kürzer zu sehen", "Ab Stufe 8 vier Antworten statt drei", "Weniger Zeit zum Antworten"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? count.stage(stage) : { base: Math.round(lerp(4, 8, level)), showMs: Math.round(lerp(1300, 750, level)), options: 3, answerMs: 3000 };
    const n = P.base + rng.int(0, 2);
    const item = rng.pick(COUNT_ITEMS);
    const wrap = h("div", "cnt-wrap");
    const field = h("div", "cnt-field");
    const cols = n > 12 ? 6 : 5;
    const rows = Math.ceil(n / cols) + 2;
    scatter(rng, n, cols, rows, 6).forEach((p, i) => {
      const d = h("span", "cnt-item", item);
      d.style.left = `${p.x}%`;
      d.style.top = `${p.y}%`;
      d.style.animationDelay = `${i * 6}ms`;
      if (n > 12) d.classList.add("small");
      field.append(d);
    });
    const opts = new Set<number>([n]);
    while (opts.size < P.options) {
      const d = rng.int(1, 3) * (rng.bool() ? 1 : -1);
      if (n + d > 0) opts.add(n + d);
    }
    const choices = h("div", "cnt-choices");
    choices.style.setProperty("--cols", String(P.options));
    let target: HTMLElement | null = null;
    const R = ready();
    let isReady = false;
    [...opts].sort((a, b) => a - b).forEach((v) => {
      const b = h("button", "cnt-btn", String(v));
      b.setAttribute("aria-label", `${v}`);
      if (v === n) target = b;
      onPress(b, () => {
        if (!isReady) return;
        if (v === n) {
          b.classList.add("hit");
          finish({ ok: true, ms: R.ms() });
        } else {
          b.classList.add("miss");
          target?.classList.add("reveal");
          field.classList.remove("gone");
          finish({ ok: false, reason: `Es waren ${n}` });
        }
      });
      choices.append(b);
    });
    wrap.append(field, choices);
    el.append(wrap);
    const START = 350;
    const t = window.setTimeout(() => {
      field.classList.add("gone");
      choices.classList.add("on");
      isReady = true;
      R.set();
    }, START + P.showMs);
    expose({ target, isReady: () => isReady });
    return { limit: START + P.showMs + P.answerMs, cleanup: () => clearTimeout(t) };
  },
};

// =====================================================================
// 14) Hau den Maulwurf
// =====================================================================
const mole: MicroGame = {
  id: "mole",
  title: "Hau den Maulwurf",
  hint: "Maulwurf tippen – Bombe nicht!",
  howto: "Aus den Löchern schauen Maulwürfe 🐹 heraus. Tipp jeden an, bevor er wieder verschwindet. Aber Vorsicht: Bomben 💣 auf keinen Fall antippen!",
  emoji: "🔨",
  bg: "linear-gradient(160deg,#22c36b,#8a5a2b)",
  prep: 0,
  speed: { veryFast: 380, fast: 560 },
  stage: (n) => {
    n = st(n);
    return {
      moles: Math.min(10, 3 + Math.floor(n / 2)),
      upMs: Math.max(420, 1100 - (n - 1) * 30),
      bombPct: n < 4 ? 0 : Math.min(40, 10 + (n - 4) * 3),
      side: n >= 12 ? 4 : 3,
    };
  },
  monotone: { moles: 1, upMs: -1, bombPct: 1, side: 1 },
  progressionText: ["Immer mehr Maulwürfe pro Stufe", "Sie bleiben immer kürzer oben", "Ab Stufe 4 tauchen Bomben auf – immer öfter", "Ab Stufe 12 ein 4×4-Feld"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    const P = stage
      ? mole.stage(stage)
      : { moles: Math.round(lerp(3, 5, level)), upMs: Math.round(lerp(1100, 750, level)), bombPct: level > 0.5 ? 20 : 0, side: 3 };
    const holesN = P.side * P.side;
    const grid = h("div", "mole-grid");
    grid.style.setProperty("--side", String(P.side));
    const holes = Array.from({ length: holesN }, () => {
      const hole = h("div", "mole-hole");
      const btn = h("button", "mole-pop");
      btn.setAttribute("aria-label", "Loch");
      hole.append(btn);
      grid.append(hole);
      return btn;
    });
    el.append(grid);
    // Ablauf festlegen: Maulwürfe und dazwischen Bomben
    const events: { hole: number; bomb: boolean; at: number }[] = [];
    let t = 600;
    let moles = 0;
    let last = -1;
    while (moles < P.moles) {
      const bomb = rng.int(1, 100) <= P.bombPct;
      let hole = rng.int(0, holesN - 1);
      if (hole === last) hole = (hole + 1) % holesN;
      last = hole;
      events.push({ hole, bomb, at: t });
      if (!bomb) moles += 1;
      t += Math.round(P.upMs * (bomb ? 0.75 : 0.85));
    }
    const endAt = t + P.upMs;
    let hits = 0;
    let over = false;
    const reactions: number[] = [];
    const timers: number[] = [];
    // Jedes Auftauchen ist ein eigenes Ereignis – so stört ein alter Timer nie einen neuen Maulwurf
    const showing = new Map<HTMLElement, { id: number; bomb: boolean; shown: number; hit: boolean }>();
    events.forEach((ev, id) => {
      timers.push(
        window.setTimeout(() => {
          if (over) return;
          const btn = holes[ev.hole];
          const me = { id, bomb: ev.bomb, shown: performance.now(), hit: false };
          showing.set(btn, me);
          btn.textContent = ev.bomb ? "💣" : "🐹";
          btn.className = `mole-pop up${ev.bomb ? " bomb" : ""}`;
          timers.push(
            window.setTimeout(() => {
              if (over || showing.get(btn) !== me) return;
              showing.delete(btn);
              btn.className = "mole-pop";
              btn.textContent = "";
              if (!ev.bomb && !me.hit) {
                over = true;
                btn.classList.add("missed");
                finish({ ok: false, reason: "Verpasst! 🐹" });
              }
            }, P.upMs),
          );
        }, ev.at),
      );
    });
    holes.forEach((btn) =>
      onPress(btn, () => {
        const me = showing.get(btn);
        if (over || !me || me.hit) return;
        if (me.bomb) {
          over = true;
          btn.classList.add("boom");
          finish({ ok: false, reason: "Bombe! 💥" });
          return;
        }
        me.hit = true;
        showing.delete(btn);
        btn.classList.add("bonk");
        sfx.pop(hits);
        reactions.push(performance.now() - me.shown);
        hits += 1;
        window.setTimeout(() => {
          if (showing.has(btn)) return;
          btn.className = "mole-pop";
          btn.textContent = "";
        }, 160);
        if (hits >= P.moles) {
          over = true;
          const avg = reactions.reduce((a, b) => a + b, 0) / Math.max(1, reactions.length);
          finish({ ok: true, ms: Math.round(avg), rating: Math.max(0, Math.min(1, 1 - (avg - 300) / 700)) });
        }
      }),
    );
    expose({
      nextMole: () => holes.find((b) => showing.get(b) && !showing.get(b)!.bomb) ?? null,
      done: () => over,
    });
    return { limit: endAt + 300, hideTimer: false, cleanup: () => timers.forEach(clearTimeout) };
  },
};

// =====================================================================
// 15) Richtig geschrieben?
// =====================================================================
/** [richtig, falsch, Schwierigkeit 1–3] */
const SPELL: [string, string, number][] = [
  ["Fahrrad", "Farrad", 1], ["Schule", "Schuhle", 1], ["Freund", "Freunt", 1], ["Wasser", "Waser", 1], ["Fenster", "Fänster", 1],
  ["Kaffee", "Kafee", 1], ["Telefon", "Telefohn", 1], ["Familie", "Familje", 1], ["Ferien", "Ferrien", 1], ["Bahnhof", "Banhof", 1],
  ["Zimmer", "Zimer", 1], ["Sommer", "Somer", 1], ["Wetter", "Weter", 1], ["Sonne", "Sone", 1], ["Spiel", "Spiehl", 1],
  ["Mädchen", "Mätchen", 1], ["Schokolade", "Schockolade", 1], ["Fußball", "Fusball", 1], ["Geburtstag", "Geburztag", 1], ["Pizza", "Pitza", 1],
  ["Gitarre", "Gitare", 1], ["Banane", "Bannane", 1], ["Musik", "Musick", 1], ["Nummer", "Numer", 1], ["Zucker", "Zuker", 1],
  ["Butter", "Buter", 1], ["Mittwoch", "Mitwoch", 1], ["Donnerstag", "Donerstag", 1], ["Brötchen", "Brötschen", 1], ["Kamera", "Kammera", 1],
  ["Rhythmus", "Rythmus", 2], ["Maschine", "Maschiene", 2], ["Paket", "Packet", 2], ["nämlich", "nähmlich", 2], ["endlich", "entlich", 2],
  ["Lineal", "Linial", 2], ["Reparatur", "Reperatur", 2], ["Interesse", "Interresse", 2], ["Kommentar", "Komentar", 2], ["Termin", "Thermin", 2],
  ["Batterie", "Baterie", 2], ["Karussell", "Karusell", 2], ["Theater", "Teater", 2], ["Apotheke", "Apoteke", 2], ["Mathematik", "Matematik", 2],
  ["Physik", "Fysik", 2], ["Tomate", "Tommate", 2], ["Krokodil", "Krokodiel", 2], ["eigentlich", "eigendlich", 2], ["ziemlich", "ziehmlich", 2],
  ["vielleicht", "vieleicht", 2], ["wahrscheinlich", "warscheinlich", 2], ["tatsächlich", "tatsächlig", 2], ["Februar", "Febuar", 2], ["Kapitän", "Kapitähn", 2],
  ["Gymnasium", "Gymnasieum", 2], ["Ananas", "Annanas", 2], ["Hobby", "Hobbie", 2], ["Detektiv", "Detektief", 2], ["Ziffer", "Zifer", 2],
  ["Standard", "Standart", 3], ["Labyrinth", "Labyrint", 3], ["Satellit", "Satelit", 3], ["Akkordeon", "Akordeon", 3], ["Rhabarber", "Rabarber", 3],
  ["Konkurrenz", "Konkurenz", 3], ["Hypothese", "Hipothese", 3], ["Galerie", "Gallerie", 3], ["Rhetorik", "Retorik", 3], ["Sympathie", "Symphatie", 3],
  ["Silhouette", "Silouette", 3], ["Zylinder", "Zillinder", 3], ["Psychologie", "Psüchologie", 3], ["Apostroph", "Apostrof", 3], ["Toleranz", "Tolleranz", 3],
  ["aggressiv", "agressiv", 3], ["Lizenz", "Lizens", 3], ["Billard", "Biljard", 3], ["Dilettant", "Dillettant", 3], ["Reflex", "Reflecks", 3],
  ["Entgelt", "Entgeld", 3], ["Kolibri", "Kollibri", 3], ["Atmosphäre", "Athmosphäre", 3], ["Ingenieur", "Ingeneur", 3], ["Accessoire", "Accesoire", 3],
];

const spell: MicroGame = {
  id: "spell",
  title: "Richtig geschrieben?",
  hint: "✓ wenn richtig, ✗ wenn falsch",
  howto: "Ein Wort erscheint. Ist es richtig geschrieben, tippst du ✓. Hat sich ein Fehler eingeschlichen, tippst du ✗. Genau hinschauen lohnt sich!",
  emoji: "✍️",
  bg: "linear-gradient(160deg,#3d7bff,#25d9e8)",
  prep: 1100,
  speed: { veryFast: 900, fast: 1600 },
  stage: (n) => {
    n = st(n);
    return {
      tier: n <= 4 ? 1 : n <= 9 ? 2 : 3,
      limit: Math.max(1600, 3200 - (n - 1) * 60),
    };
  },
  monotone: { tier: 1, limit: -1 },
  progressionText: ["Stufe 1–4: einfache Alltagswörter", "Ab Stufe 5 kniffligere Wörter", "Ab Stufe 10 richtig schwere Fremdwörter", "Immer weniger Zeit (bis 1,6 s)"],
  mount({ el, rng, level, stage, finish, expose }) {
    const tier = stage ? spell.stage(stage).tier : level < 0.35 ? 1 : level < 0.75 ? 2 : 3;
    const pool = SPELL.filter((x) => x[2] <= tier && x[2] >= Math.max(1, tier - 1));
    const [right, wrong] = rng.pick(pool);
    const truth = rng.bool();
    const word = truth ? right : wrong;
    const wrap = h("div", "sum-wrap");
    const w = h("div", "spell-word", word);
    if (word.length > 10) w.classList.add("long");
    wrap.append(w);
    const row = h("div", "sum-row");
    const yes = h("button", "sum-btn yes", "✓");
    const no = h("button", "sum-btn no", "✗");
    yes.setAttribute("aria-label", "Richtig geschrieben");
    no.setAttribute("aria-label", "Falsch geschrieben");
    const answer = (said: boolean, btn: HTMLElement) => {
      if (said === truth) {
        btn.classList.add("hit");
        finish({ ok: true });
      } else {
        btn.classList.add("miss");
        finish({ ok: false, reason: `Richtig: ${right}` });
      }
    };
    onPress(yes, () => answer(true, yes));
    onPress(no, () => answer(false, no));
    row.append(yes, no);
    wrap.append(row);
    el.append(wrap);
    expose({ target: truth ? yes : no });
    return { limit: stage ? spell.stage(stage).limit : 3400 };
  },
};

// =====================================================================
// 16) Stoppuhr
// =====================================================================
const clock: MicroGame = {
  id: "clock",
  title: "Stoppuhr",
  hint: "Genau bei der Zielzeit tippen",
  howto: "Oben steht eine Zielzeit, zum Beispiel 2,00 Sekunden. Die Uhr läuft los – tipp genau dann, wenn sie die Zielzeit erreicht. Später wird die Uhr unterwegs unsichtbar.",
  emoji: "⏱️",
  bg: "linear-gradient(160deg,#121633,#3d7bff)",
  prep: 0,
  speed: { veryFast: 40, fast: 90 },
  stage: (n) => {
    n = st(n);
    return {
      // erlaubte Abweichung in ms
      tolerance: Math.max(40, 220 - (n - 1) * 8),
      // Ab diesem Anteil der Zielzeit ist die Uhr unsichtbar (100 = nie)
      hidePct: n < 4 ? 100 : Math.max(30, 80 - (n - 4) * 5),
    };
  },
  monotone: { tolerance: -1, hidePct: -1 },
  progressionText: ["Du musst immer genauer treffen (bis ±0,04 s)", "Ab Stufe 4 wird die Uhr kurz vor dem Ziel unsichtbar", "Sie verschwindet immer früher"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? clock.stage(stage) : { tolerance: Math.round(lerp(220, 120, level)), hidePct: level > 0.6 ? 70 : 100 };
    const target = rng.int(15, 30) * 100; // 1,50 s … 3,00 s
    const START = 700;
    const wrap = h("div", "clock-wrap");
    const goal = h("div", "clock-goal", `Ziel: ${fmtNum(target / 1000, 2)} s`);
    const face = h("div", "clock-face", "0,00");
    const tip = h("div", "clock-tip", "Bereit…");
    wrap.append(goal, face, tip);
    el.append(wrap);
    const t0 = performance.now() + START;
    const targetAt = t0 + target;
    let raf = 0;
    let stopped = false;
    const loop = () => {
      const now = performance.now();
      const e = Math.max(0, now - t0);
      if (now >= t0) tip.textContent = "Tipp bei der Zielzeit!";
      if (e >= (target * P.hidePct) / 100) face.classList.add("hidden-time");
      face.textContent = fmtNum(e / 1000, 2);
      if (!stopped) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    onPress(el, () => {
      if (stopped || performance.now() < t0) return;
      stopped = true;
      cancelAnimationFrame(raf);
      const err = performance.now() - targetAt;
      face.classList.remove("hidden-time");
      face.textContent = fmtNum((target + err) / 1000, 2);
      if (Math.abs(err) > P.tolerance) {
        face.classList.add("miss");
        finish({ ok: false, reason: `${err > 0 ? "+" : "−"}${fmtNum(Math.abs(err) / 1000, 2)} s daneben` });
        return;
      }
      face.classList.add("hit");
      finish({ ok: true, rating: Math.max(0, 1 - Math.abs(err) / P.tolerance), ms: Math.round(Math.abs(err)) });
    });
    expose({ targetAt });
    return { limit: START + target + P.tolerance + 500, hideTimer: true, cleanup: () => cancelAnimationFrame(raf) };
  },
};

// =====================================================================
// 17) Größte Zahl
// =====================================================================
const FRACTIONS: [string, number][] = [
  ["½", 1 / 2], ["⅓", 1 / 3], ["⅔", 2 / 3], ["¼", 1 / 4], ["¾", 3 / 4], ["⅕", 1 / 5], ["⅖", 2 / 5], ["⅗", 3 / 5], ["⅘", 4 / 5],
  ["⅙", 1 / 6], ["⅚", 5 / 6], ["⅛", 1 / 8], ["⅜", 3 / 8], ["⅝", 5 / 8], ["⅞", 7 / 8],
];

function makeNumber(rng: Rng, kind: number, anchor: number): { label: string; value: number } {
  switch (kind) {
    case 1: {
      const v = rng.int(1, 99);
      return { label: String(v), value: v };
    }
    case 2: {
      const v = anchor + rng.int(-9, 9);
      return { label: String(v), value: v };
    }
    case 3: {
      // Mal mit einer, mal mit zwei Nachkommastellen – der Wert passt immer genau zur Anzeige
      const digits = rng.bool() ? 1 : 2;
      const f = digits === 1 ? 10 : 100;
      const v = Math.round((anchor / 100 + rng.int(-40, 40) / 100) * f) / f;
      return { label: fmtNum(v, digits), value: v };
    }
    case 4: {
      const v = rng.int(-60, 60);
      return { label: v < 0 ? `−${Math.abs(v)}` : String(v), value: v };
    }
    default: {
      if (rng.bool(0.6)) {
        const [l, v] = rng.pick(FRACTIONS);
        return { label: l, value: v };
      }
      const v = rng.int(1, 99) / 100;
      return { label: fmtNum(v, 2), value: v };
    }
  }
}

const big: MicroGame = {
  id: "big",
  title: "Größte Zahl",
  hint: "Tipp die größte Zahl",
  howto: "Mehrere Zahlen liegen nebeneinander. Tipp die größte davon an. Achtung: Später kommen Kommazahlen, Minuszahlen und Brüche dazu.",
  emoji: "🔝",
  bg: "linear-gradient(160deg,#ff3d8b,#a45cff)",
  prep: 1000,
  speed: { veryFast: 900, fast: 1600 },
  stage: (n) => {
    n = st(n);
    return {
      // 1 = Zahlen bis 99, 2 = dreistellig und knapp, 3 = Kommazahlen, 4 = Minus, 5 = Brüche
      kind: n <= 3 ? 1 : n <= 7 ? 2 : n <= 11 ? 3 : n <= 15 ? 4 : 5,
      options: Math.min(6, 3 + Math.floor((n - 1) / 4)),
      limit: Math.max(2000, 3600 - (n - 1) * 60),
    };
  },
  monotone: { kind: 1, options: 1, limit: -1 },
  progressionText: ["Erst einfache Zahlen, dann dreistellige, die knapp beieinander liegen", "Ab Stufe 8 Kommazahlen, ab 12 Minuszahlen", "Ab Stufe 16 Brüche wie ¾ und ⅝", "Mehr Zahlen zur Auswahl (bis 6)"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? big.stage(stage) : { kind: level < 0.35 ? 1 : level < 0.7 ? 2 : 3, options: level < 0.5 ? 3 : 4, limit: 3400 };
    const anchor = P.kind === 2 ? rng.int(120, 980) : P.kind === 3 ? rng.int(150, 950) : 0;
    let nums: { label: string; value: number }[] = [];
    for (let tries = 0; tries < 50; tries++) {
      nums = Array.from({ length: P.options }, () => makeNumber(rng, P.kind, anchor));
      const vals = nums.map((x) => x.value);
      const max = Math.max(...vals);
      const uniqueValues = new Set(vals.map((v) => v.toFixed(4))).size === vals.length;
      if (uniqueValues && vals.filter((v) => Math.abs(v - max) < 1e-9).length === 1) break;
    }
    const max = Math.max(...nums.map((x) => x.value));
    const grid = h("div", "big-grid");
    grid.style.setProperty("--cols", String(P.options <= 4 ? 2 : 3));
    let target: HTMLElement | null = null;
    nums.forEach((x) => {
      const b = h("button", "big-btn", x.label);
      if (x.label.length > 4) b.classList.add("long");
      b.setAttribute("aria-label", x.label);
      const isMax = Math.abs(x.value - max) < 1e-9;
      if (isMax) target = b;
      onPress(b, () => {
        if (isMax) {
          b.classList.add("hit");
          finish({ ok: true });
        } else {
          b.classList.add("miss");
          target?.classList.add("reveal");
          finish({ ok: false, reason: "Nicht die größte" });
        }
      });
      grid.append(b);
    });
    el.append(grid);
    expose({ target });
    return { limit: P.limit };
  },
};

// =====================================================================
// 18) Gleiche Form (gedreht, nicht gespiegelt)
// =====================================================================
type Cells = [number, number][];
const norm = (c: Cells): Cells => {
  const mx = Math.min(...c.map((p) => p[0])),
    my = Math.min(...c.map((p) => p[1]));
  return c.map(([x, y]) => [x - mx, y - my] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
};
const key = (c: Cells) => norm(c).map((p) => p.join(",")).join(";");
const rot = (c: Cells): Cells => c.map(([x, y]) => [-y, x] as [number, number]);
const mirror = (c: Cells): Cells => c.map(([x, y]) => [-x, y] as [number, number]);
const rotations = (c: Cells): Cells[] => {
  const out: Cells[] = [c];
  for (let i = 0; i < 3; i++) out.push(rot(out[out.length - 1]));
  return out.map(norm);
};

function randomShape(rng: Rng, k: number, side: number): Cells {
  for (let tries = 0; tries < 200; tries++) {
    const cells: Cells = [[rng.int(0, side - 1), rng.int(0, side - 1)]];
    while (cells.length < k) {
      const [x, y] = rng.pick(cells);
      const [dx, dy] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
      if (cells.some((p) => p[0] === nx && p[1] === ny)) continue;
      cells.push([nx, ny]);
    }
    // Nur „chirale“ Formen: Das Spiegelbild darf keine Drehung der Form sein
    const rk = new Set(rotations(cells).map(key));
    if (!rk.has(key(mirror(cells))) && rk.size === 4) return norm(cells);
  }
  return norm([[0, 0], [1, 0], [2, 0], [2, 1]]); // L-Form als sichere Rückfalloption
}

function shapeEl(c: Cells, cls: string): HTMLElement {
  const n = norm(c);
  const w = Math.max(...n.map((p) => p[0])) + 1;
  const hh = Math.max(...n.map((p) => p[1])) + 1;
  const size = Math.max(w, hh);
  const g = h("span", cls);
  g.style.setProperty("--s", String(size));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const on = n.some((p) => p[0] === x && p[1] === y);
      g.append(h("i", on ? "on" : ""));
    }
  return g;
}

const shape: MicroGame = {
  id: "shape",
  title: "Gleiche Form",
  hint: "Gleiche Form – nur gedreht",
  howto: "Oben siehst du eine Form. Unten sind mehrere Formen. Nur eine davon ist genau dieselbe, nur gedreht. Gespiegelte Formen zählen nicht – nicht reinlegen lassen!",
  emoji: "🔄",
  bg: "linear-gradient(160deg,#25d9e8,#22c36b)",
  prep: 1500,
  speed: { veryFast: 1300, fast: 2300 },
  stage: (n) => {
    n = st(n);
    return {
      cells: Math.min(8, 4 + Math.floor((n - 1) / 3)),
      options: n >= 6 ? 4 : 3,
      limit: Math.max(2600, 4400 - (n - 1) * 70),
    };
  },
  monotone: { cells: 1, options: 1, limit: -1 },
  progressionText: ["Die Formen bestehen aus immer mehr Kästchen (4 bis 8)", "Ab Stufe 6 vier Formen zur Auswahl", "Gespiegelte Formen als Falle", "Weniger Zeit (bis 2,6 s)"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? shape.stage(stage) : { cells: level < 0.5 ? 4 : 5, options: 3, limit: 4200 };
    const side = P.cells <= 5 ? 3 : 4;
    const base = randomShape(rng, P.cells, side);
    const correct = rotations(base)[rng.int(1, 3)];
    const wrongs: Cells[] = [rotations(mirror(base))[rng.int(0, 3)]];
    const baseKeys = new Set(rotations(base).map(key));
    for (let tries = 0; wrongs.length < P.options - 1 && tries < 100; tries++) {
      const o = randomShape(rng, P.cells, side);
      if (!baseKeys.has(key(o)) && !wrongs.some((w) => rotations(w).map(key).includes(key(o)))) wrongs.push(o);
    }
    while (wrongs.length < P.options - 1) wrongs.push(rotations(mirror(base))[(wrongs.length + 1) % 4]);
    const all = rng.shuffle([correct, ...wrongs]);
    const wrap = h("div", "shape-wrap");
    const ref = h("div", "shape-ref");
    ref.append(shapeEl(base, "shape-grid big"));
    const opts = h("div", "shape-opts");
    opts.style.setProperty("--cols", String(P.options));
    let target: HTMLElement | null = null;
    all.forEach((c) => {
      const b = h("button", "shape-btn");
      b.setAttribute("aria-label", "Form");
      b.append(shapeEl(c, "shape-grid"));
      const ok = c === correct;
      if (ok) target = b;
      onPress(b, () => {
        if (ok) {
          b.classList.add("hit");
          finish({ ok: true });
        } else {
          b.classList.add("miss");
          target?.classList.add("reveal");
          finish({ ok: false, reason: "Nicht dieselbe Form" });
        }
      });
      opts.append(b);
    });
    wrap.append(ref, opts);
    el.append(wrap);
    expose({ target });
    return { limit: P.limit };
  },
};

// =====================================================================
// 19) Der Reihe nach
// =====================================================================
const order: MicroGame = {
  id: "order",
  title: "Der Reihe nach",
  hint: "Von klein nach groß tippen",
  howto: "Zahlen liegen wild verteilt. Tipp sie der Reihe nach an – von der kleinsten bis zur größten. Ein falscher Tipp und es ist vorbei.",
  emoji: "1️⃣",
  bg: "linear-gradient(160deg,#a45cff,#3d7bff)",
  prep: 900,
  speed: { veryFast: 1800, fast: 3000 },
  stage: (n) => {
    n = st(n);
    return {
      count: Math.min(12, 3 + n),
      // 0 = 1, 2, 3 …   1 = Lücken (z. B. 3, 8, 15)   2 = auch Minuszahlen
      mode: n >= 14 ? 2 : n >= 8 ? 1 : 0,
      msPerNum: Math.max(380, 700 - (n - 1) * 15),
    };
  },
  monotone: { count: 1, mode: 1, msPerNum: -1 },
  progressionText: ["Jede Stufe eine Zahl mehr (bis 12)", "Ab Stufe 8 Zahlen mit Lücken (z. B. 3, 8, 15)", "Ab Stufe 14 auch Minuszahlen", "Weniger Zeit pro Zahl"],
  mount({ el, rng, level, stage, finish, sfx, expose }) {
    const P = stage ? order.stage(stage) : { count: Math.round(lerp(4, 7, level)), mode: level > 0.7 ? 1 : 0, msPerNum: 700 };
    let values: number[];
    if (P.mode === 0) values = Array.from({ length: P.count }, (_, i) => i + 1);
    else {
      const set = new Set<number>();
      const lo = P.mode === 2 ? -30 : 1;
      while (set.size < P.count) set.add(rng.int(lo, lo + 60));
      values = [...set];
    }
    const sorted = [...values].sort((a, b) => a - b);
    const field = h("div", "order-field");
    const cols = P.count > 9 ? 4 : 3;
    const rows = Math.ceil(P.count / cols) + 1;
    // Feste Zellen mit wenig Wackeln → Kreise überlappen nie
    const cellsXY = rng.shuffle(Array.from({ length: cols * rows }, (_, i) => [i % cols, Math.floor(i / cols)] as const)).slice(0, P.count);
    const spots = cellsXY.map(([c, r]) => ({
      x: 8 + ((c + 0.5) * 84) / cols + (rng.next() - 0.5) * (18 / cols),
      y: 8 + ((r + 0.5) * 84) / rows + (rng.next() - 0.5) * (18 / rows),
    }));
    const btns = new Map<number, HTMLElement>();
    let pos = 0;
    values.forEach((v, i) => {
      const b = h("button", "order-btn", v < 0 ? `−${Math.abs(v)}` : String(v));
      b.style.left = `${spots[i].x}%`;
      b.style.top = `${spots[i].y}%`;
      b.style.animationDelay = `${i * 25}ms`;
      b.setAttribute("aria-label", String(v));
      btns.set(v, b);
      onPress(b, () => {
        if (b.classList.contains("done")) return;
        if (v === sorted[pos]) {
          b.classList.add("done");
          sfx.pop(pos);
          pos += 1;
          if (pos === sorted.length) finish({ ok: true });
        } else {
          b.classList.add("miss");
          btns.get(sorted[pos])?.classList.add("reveal");
          finish({ ok: false, reason: `Erst ${sorted[pos] < 0 ? "−" + Math.abs(sorted[pos]) : sorted[pos]}` });
        }
      });
      field.append(b);
    });
    el.append(field);
    expose({ sequence: sorted.map((v) => btns.get(v)), isReady: () => true });
    return { limit: 800 + P.count * P.msPerNum };
  },
};

// =====================================================================
// 20) Was ist neu?
// =====================================================================
const NEW_POOL_EASY = ["🍎", "🚗", "⚽", "🎸", "🐶", "🌵", "🍕", "🚀", "🎩", "🐙", "🌈", "📚", "🦄", "🍉", "🎧", "🧊", "🔑", "🎁", "🐝", "🍔"] as const;
const NEW_POOL_SIMILAR = ["😀", "😃", "😄", "😁", "😆", "😅", "🙂", "😊", "😉", "😌", "😍", "😎", "🤓", "😏", "🤩", "🥳", "😺", "😸", "😹", "😻"] as const;

const newone: MicroGame = {
  id: "newone",
  title: "Was ist neu?",
  hint: "Finde das neue Emoji",
  howto: "Ein paar Emojis sind kurz zu sehen. Dann wird kurz alles verdeckt und ein neues Emoji kommt dazu. Tipp genau das Emoji an, das vorher noch nicht da war.",
  emoji: "🕵️",
  bg: "linear-gradient(160deg,#6a2cff,#25d9e8)",
  prep: 0,
  speed: { veryFast: 900, fast: 1600 },
  stage: (n) => {
    n = st(n);
    return {
      count: Math.min(14, 3 + n),
      showMs: Math.max(700, 2000 - (n - 1) * 60),
      similar: n >= 6 ? 1 : 0,
      shuffle: n >= 10 ? 1 : 0,
    };
  },
  monotone: { count: 1, showMs: -1, similar: 1, shuffle: 1 },
  progressionText: ["Jede Stufe ein Emoji mehr (bis 14)", "Du siehst sie immer kürzer", "Ab Stufe 6 sehen sich die Emojis sehr ähnlich", "Ab Stufe 10 wechseln alle den Platz"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? newone.stage(stage) : { count: Math.round(lerp(3, 6, level)), showMs: Math.round(lerp(1800, 1200, level)), similar: level > 0.6 ? 1 : 0, shuffle: 0 };
    const pool = rng.shuffle(P.similar ? NEW_POOL_SIMILAR : NEW_POOL_EASY);
    const old = pool.slice(0, P.count);
    const fresh = pool[P.count];
    const side = P.count + 1 > 9 ? 4 : 3;
    const cells = side * side;
    const slots1 = rng.shuffle(Array.from({ length: cells }, (_, i) => i)).slice(0, P.count);
    const free = Array.from({ length: cells }, (_, i) => i).filter((i) => !slots1.includes(i));
    const newSlot = rng.pick(free);
    const slots2 = P.shuffle ? rng.shuffle([...slots1, newSlot]) : [...slots1, newSlot];
    const wrap = h("div", "new-wrap");
    const label = h("div", "mem-label", "Merk dir alles…");
    const grid = h("div", "new-grid");
    grid.style.setProperty("--side", String(side));
    const cellEls = Array.from({ length: cells }, () => {
      const b = h("button", "new-cell");
      grid.append(b);
      return b;
    });
    old.forEach((e, i) => (cellEls[slots1[i]].textContent = e));
    wrap.append(label, grid);
    el.append(wrap);
    const R = ready();
    let isReady = false;
    let targetEl: HTMLElement | null = null;
    let wrongEl: HTMLElement | null = null;
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        grid.classList.add("covered");
        label.textContent = "…";
      }, 300 + P.showMs),
      window.setTimeout(() => {
        cellEls.forEach((c) => (c.textContent = ""));
        [...old, fresh].forEach((e, i) => (cellEls[slots2[i]].textContent = e));
        targetEl = cellEls[slots2[P.count]];
        wrongEl = cellEls[slots2[0]];
        grid.classList.remove("covered");
        grid.classList.add("ready");
        label.textContent = "Was ist neu?";
        isReady = true;
        R.set();
      }, 300 + P.showMs + 450),
    );
    cellEls.forEach((c) =>
      onPress(c, () => {
        if (!isReady || !c.textContent) return;
        if (c === targetEl) {
          c.classList.add("hit");
          finish({ ok: true, ms: R.ms() });
        } else {
          c.classList.add("miss");
          targetEl?.classList.add("reveal");
          finish({ ok: false, reason: `Neu war ${fresh}` });
        }
      }),
    );
    // Ziel steht erst nach dem Verdecken fest → als Funktion für die Tests
    expose({ target: () => targetEl, wrong: () => wrongEl, isReady: () => isReady });
    const answerMs = stage ? Math.max(2200, 3600 - stage * 50) : 3200;
    return { limit: 300 + P.showMs + 450 + answerMs, cleanup: () => timers.forEach(clearTimeout) };
  },
};

// =====================================================================
// 21) Hütchenspiel
// =====================================================================
const cups: MicroGame = {
  id: "cups",
  title: "Hütchenspiel",
  hint: "Wo ist der Ball?",
  howto: "Unter einem Becher liegt ein Ball. Dann werden die Becher gemischt. Folg dem richtigen Becher mit den Augen und tipp ihn an, wenn sie stillstehen.",
  emoji: "🥤",
  bg: "linear-gradient(160deg,#ff3d6e,#a45cff)",
  prep: 0,
  speed: { veryFast: 700, fast: 1300 },
  stage: (n) => {
    n = st(n);
    return {
      cups: n >= 10 ? 4 : 3,
      swaps: Math.min(20, 2 + n),
      swapMs: Math.max(170, 480 - (n - 1) * 15),
    };
  },
  monotone: { cups: 1, swaps: 1, swapMs: -1 },
  progressionText: ["Jede Stufe wird einmal mehr gemischt", "Das Mischen wird immer schneller", "Ab Stufe 10 vier Becher statt drei"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? cups.stage(stage) : { cups: 3, swaps: Math.round(lerp(3, 6, level)), swapMs: Math.round(lerp(460, 300, level)) };
    const wrap = h("div", "cups-wrap");
    const label = h("div", "mem-label", "Schau, wo der Ball ist…");
    const table = h("div", "cups-table");
    table.style.setProperty("--n", String(P.cups));
    table.style.setProperty("--swap", `${P.swapMs}ms`);
    const ballAt = rng.int(0, P.cups - 1);
    const els = Array.from({ length: P.cups }, (_, i) => {
      const c = h("button", "cup");
      c.setAttribute("aria-label", `Becher ${i + 1}`);
      c.style.setProperty("--slot", String(i));
      c.dataset.slot = String(i);
      c.append(h("span", "cup-body"));
      if (i === ballAt) c.append(h("span", "cup-ball", "⚽"));
      table.append(c);
      return c;
    });
    wrap.append(label, table);
    el.append(wrap);
    const ballCup = els[ballAt];
    const timers: number[] = [];
    const SHOW = 300;
    const LIFT = 900;
    timers.push(window.setTimeout(() => ballCup.classList.add("lift"), SHOW));
    timers.push(window.setTimeout(() => ballCup.classList.remove("lift"), SHOW + LIFT));
    const startSwaps = SHOW + LIFT + 350;
    for (let i = 0; i < P.swaps; i++) {
      timers.push(
        window.setTimeout(() => {
          label.textContent = "Gut aufpassen!";
          const a = rng.int(0, P.cups - 1);
          let b = rng.int(0, P.cups - 2);
          if (b >= a) b += 1;
          const ca = els.find((e) => e.dataset.slot === String(a))!;
          const cb = els.find((e) => e.dataset.slot === String(b))!;
          ca.dataset.slot = String(b);
          cb.dataset.slot = String(a);
          ca.style.setProperty("--slot", String(b));
          cb.style.setProperty("--slot", String(a));
        }, startSwaps + i * (P.swapMs + 40)),
      );
    }
    const readyAt = startSwaps + P.swaps * (P.swapMs + 40) + 120;
    const R = ready();
    let isReady = false;
    timers.push(
      window.setTimeout(() => {
        isReady = true;
        R.set();
        table.classList.add("ready");
        label.textContent = "Wo ist der Ball?";
      }, readyAt),
    );
    els.forEach((c) =>
      onPress(c, () => {
        if (!isReady || table.classList.contains("over")) return;
        table.classList.add("over");
        ballCup.classList.add("lift");
        if (c === ballCup) {
          c.classList.add("hit");
          finish({ ok: true, ms: R.ms() });
        } else {
          c.classList.add("miss", "lift");
          finish({ ok: false, reason: "Leer! 🫥" });
        }
      }),
    );
    expose({ target: ballCup, isReady: () => isReady });
    return { limit: readyAt + 2600, cleanup: () => timers.forEach(clearTimeout) };
  },
};

// =====================================================================
// 22) Das Paar
// =====================================================================
const PAIR_POOL = [
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦉",
  "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🥕", "🌽", "🌶️",
  "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🎱", "🏓", "🎯", "🎮", "🎲", "🧩", "🎸", "🎺", "🎻", "🥁", "🎤", "🎧", "📷", "💡",
] as const;
const PAIR_SIMILAR = [
  "😀", "😃", "😄", "😁", "😆", "😅", "🙂", "😊", "😉", "😌", "😍", "😎", "🤓", "😏", "🤩", "🥳", "😺", "😸", "😹", "😻",
  "😼", "😽", "🙀", "😿", "😾", "🤗", "🤭", "🫢", "🫣", "🤔", "🤨", "😐", "😑", "😶", "🙄", "😬",
] as const;

const pair: MicroGame = {
  id: "pair",
  title: "Das Paar",
  hint: "Finde die zwei Gleichen",
  howto: "Viele verschiedene Emojis – aber genau zwei davon sind gleich. Finde das Paar und tipp eins der beiden an.",
  emoji: "👯",
  bg: "linear-gradient(160deg,#ffd23d,#ff3d8b)",
  prep: 1500,
  speed: { veryFast: 1300, fast: 2400 },
  stage: (n) => {
    n = st(n);
    return {
      count: Math.min(36, 8 + 2 * (n - 1)),
      similar: n >= 6 ? 1 : 0,
      limit: Math.max(3000, 4600 - (n - 1) * 60),
    };
  },
  monotone: { count: 1, similar: 1, limit: -1 },
  progressionText: ["Jede Stufe zwei Emojis mehr (bis 36)", "Ab Stufe 6 sehen sich alle Emojis sehr ähnlich", "Weniger Zeit (bis 3 s)"],
  mount({ el, rng, level, stage, finish, expose }) {
    const P = stage ? pair.stage(stage) : { count: Math.round(lerp(9, 16, level)), similar: level > 0.7 ? 1 : 0, limit: 4400 };
    const pool: readonly string[] = P.similar ? PAIR_SIMILAR : PAIR_POOL;
    const count = Math.min(P.count, pool.length + 1);
    const distinct = rng.shuffle(pool).slice(0, count - 1);
    const twin = distinct[0];
    const items = rng.shuffle([...distinct, twin]);
    const cols = count <= 9 ? 3 : count <= 16 ? 4 : count <= 25 ? 5 : 6;
    const grid = h("div", "pair-grid");
    grid.style.setProperty("--cols", String(cols));
    if (cols >= 6) grid.classList.add("dense");
    const twins: HTMLElement[] = [];
    let wrong: HTMLElement | null = null;
    items.forEach((e, i) => {
      const b = h("button", "pair-cell", e);
      b.style.animationDelay = `${i * 6}ms`;
      b.setAttribute("aria-label", "Emoji");
      if (e === twin) twins.push(b);
      else wrong ??= b;
      onPress(b, () => {
        if (e === twin) {
          twins.forEach((t) => t.classList.add("hit"));
          finish({ ok: true });
        } else {
          b.classList.add("miss");
          twins.forEach((t) => t.classList.add("reveal"));
          finish({ ok: false, reason: `Das Paar war ${twin}` });
        }
      });
      grid.append(b);
    });
    el.append(grid);
    expose({ target: twins[0], wrong });
    return { limit: P.limit };
  },
};

export const GAMES_WAVE3: MicroGame[] = [count, mole, spell, clock, big, shape, order, newone, cups, pair];
