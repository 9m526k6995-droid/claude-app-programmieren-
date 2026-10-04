import "./style.css";
import { dayIndex, daySeed, msUntilNextDay, makeRng, dateOfDay } from "./rng";
import {
  loadState,
  saveState,
  currentStreak,
  recordDaily,
  addCrewResult,
  publicId,
  randomName,
  type State,
  type DayResult,
} from "./state";
import { createSfx } from "./sound";
import { GAME_BY_ID, type Outcome } from "./games";
import { buildRounds, endlessRound, roundPoints, tileOf, verdict, ROUNDS, type Mode, type RoundSpec } from "./run";
import {
  encodeChallenge,
  decodeChallenge,
  extractChallengeCode,
  shareText,
  buildLink,
  storyImage,
  sumPoints,
  type ChallengePayload,
} from "./share";
import { confetti, floatText, shake, countUp } from "./fx";
import { submitScore, fetchBoard, fetchRank } from "./leaderboard";
import { hasGlobalBoard, publicBase, CONFIG } from "./config";
import { restoreSession, currentUser, signOut, onAuthChange } from "./auth";
import { renderStart } from "./startmenu";

declare const __ZWIP_SINGLE__: boolean;

const app = document.getElementById("app")!;
let S: State = loadState();
const sfx = createSfx(S.muted);
const params = new URLSearchParams(location.search);
const E2E = params.has("e2e");
const save = () => saveState(S);
const today = () => dayIndex();

interface TestHook {
  round: (Record<string, unknown> & { gameId: string }) | null;
  state: () => State;
}
const hook: TestHook = { round: null, state: () => S };
if (E2E) (window as unknown as { __zwip: TestHook }).__zwip = hook;

let roundCounter = 0;
let timers: number[] = [];
function clearTimers() {
  timers.forEach((t) => clearInterval(t));
  timers = [];
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toast(msg: string) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

function modal(inner: string, onMount?: (el: HTMLElement, close: () => void) => void) {
  const wrap = document.createElement("div");
  wrap.className = "modal-bg";
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${inner}</div>`;
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap || (e.target as HTMLElement).closest("[data-close]")) close();
  });
  document.body.append(wrap);
  onMount?.(wrap.querySelector(".modal")!, close);
}

// ---------- Teilen ----------

async function doShare(text: string) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Kopiert! Jetzt in WhatsApp, TikTok oder Insta einfügen ✌️");
    return;
  } catch {
    /* Fallback unten */
  }
  modal(
    `<h3>Zum Kopieren</h3><textarea class="copy-area" readonly>${esc(text)}</textarea><button class="btn primary" data-close>Fertig</button>`,
    (el) => {
      const ta = el.querySelector("textarea")!;
      ta.focus();
      ta.select();
    },
  );
}

async function shareImage(blob: Blob) {
  const file = new File([blob], "zwip.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  modal(
    `<h3>Dein Story-Bild</h3><img class="story-preview" src="${url}" alt="ZWIP Ergebnis"><p class="muted">Lange drücken zum Speichern – oder:</p>${typeof __ZWIP_SINGLE__ !== "undefined" && __ZWIP_SINGLE__ ? "" : `<a class="btn primary" href="${url}" download="zwip.png">Herunterladen</a>`}<button class="btn ghost" data-close>Schließen</button>`,
  );
}

// ---------- Duell-Links ----------

let pending: ChallengePayload | null = null;
{
  const code = params.get("c");
  if (code) {
    const p = decodeChallenge(code);
    if (!p) toast("Dieser Duell-Link ist kaputt 🤔");
    else if (p.i && p.i === publicId(S)) toast("Das ist dein eigener Link 😄");
    else pending = p;
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* in Sandbox egal */
    }
  }
}

function challengeSeed(p: ChallengePayload): number {
  return p.m === "d" ? daySeed(p.d!) : p.z!;
}

/** Startet oder wertet ein Duell aus. */
function acceptChallenge(p: ChallengePayload) {
  const t = today();
  if (p.m === "d" && S.daily[p.d!]) {
    // Diese Daily schon gespielt → direkt vergleichen, kein zweiter Versuch
    addCrewResult(S, p.i, p.n, p.d!, { score: sumPoints(p.r), rounds: p.r });
    save();
    const mine = S.daily[p.d!];
    results({
      mode: p.d === t ? "daily" : "challenge",
      day: p.d,
      seed: daySeed(p.d!),
      rounds: mine.rounds,
      specs: buildRounds(daySeed(p.d!)),
      vs: p,
      replay: true,
    });
    return;
  }
  if (p.m === "d" && p.d === t) startRun("daily", { vs: p });
  else startRun("challenge", { seed: challengeSeed(p), day: p.m === "d" ? p.d : undefined, vs: p });
}

// ---------- Startbildschirm ----------

function weekStrip(t: number): string {
  const names = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  let out = "";
  for (let d = t - 6; d <= t; d++) {
    const res = S.daily[d];
    const wd = names[dateOfDay(d).getDay()];
    out += `<div class="wk ${res ? "on" : ""} ${d === t ? "today" : ""}"><i>${res ? "⚡" : ""}</i><span>${wd}</span></div>`;
  }
  return out;
}

function fmtCountdown(ms: number) {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function miniGrid(rounds: number[]) {
  return `<span class="mini-grid">${rounds.map((p) => `<i class="t-${tileOf(p)}"></i>`).join("")}</span>`;
}

function home() {
  clearTimers();
  const t = today();
  const played = S.daily[t];
  const streak = currentStreak(S, t);

  const challengeCard = pending
    ? `<div class="duel-card pop-in">
        <div class="duel-ico">⚔️</div>
        <div><b>${esc(pending.n)}</b> fordert dich heraus<br><span class="muted">${sumPoints(pending.r)} Punkte · ${pending.m === "d" ? `Daily #${pending.d}` : "Training"}</span></div>
      </div>`
    : "";

  let main: string;
  if (pending) {
    main = `<button class="play-btn" data-act="duel"><span class="play-ico">⚔️</span><span><b>Duell starten</b><small>Gleiche Runde. Wer holt mehr?</small></span></button>`;
  } else if (played) {
    main = `<div class="done-card">
        <div class="done-top"><span>Daily #${t}</span><b>${played.score}</b></div>
        ${miniGrid(played.rounds)}
        <div class="done-actions">
          <button class="btn primary sm" data-act="share-today">Teilen 📤</button>
          <button class="btn sm" data-act="challenge-today">Duell ⚔️</button>
        </div>
        <div class="muted next">Neue Daily in <b id="countdown">${fmtCountdown(msUntilNextDay())}</b></div>
      </div>`;
  } else {
    main = `<button class="play-btn" data-act="daily"><span class="play-ico">▶</span><span><b>Daily #${t} spielen</b><small>30 Sekunden · jeden Tag neu</small></span></button>`;
  }

  app.innerHTML = `
  <div class="screen home">
    <header class="topbar">
      <div class="streak-pill ${streak ? "on" : ""}" aria-label="Streak ${streak} Tage">🔥 <b>${streak}</b></div>
      <div class="top-actions">
        <button class="icon-btn" data-act="sound" aria-label="Ton an/aus">${S.muted ? "🔇" : "🔊"}</button>
        <button class="icon-btn" data-act="settings" aria-label="Einstellungen">⚙️</button>
      </div>
    </header>
    <div class="hero">
      <h1 class="logo" aria-label="ZWIP"><span>Z</span><span>W</span><span>I</span><span>P</span></h1>
      <p class="tagline">10 Blitz-Challenges · 30 Sekunden · jeden Tag neu</p>
    </div>
    ${challengeCard}
    ${main}
    <div class="modes">
      <button class="mode" data-act="free"><span>🏋️</span><b>Training</b><small>${S.best.free ? `Best ${S.best.free}` : "unbegrenzt"}</small></button>
      <button class="mode" data-act="endless"><span>♾️</span><b>Endlos</b><small>${S.best.endless ? `Best ${S.best.endless}` : "1 Fehler = Ende"}</small></button>
      <button class="mode" data-act="board"><span>🏆</span><b>Bestenliste</b><small>Crew${hasGlobalBoard ? " & Welt" : ""}</small></button>
    </div>
    <div class="week" aria-label="Diese Woche">${weekStrip(t)}</div>
  </div>`;

  if (played && !pending) {
    timers.push(
      window.setInterval(() => {
        const el = document.getElementById("countdown");
        if (!el) return;
        const ms = msUntilNextDay();
        if (ms < 1000 || today() !== t) home();
        else el.textContent = fmtCountdown(ms);
      }, 1000),
    );
  }
}

// ---------- Spielablauf ----------

interface RunOpts {
  seed?: number;
  day?: number;
  vs?: ChallengePayload;
}

let aborted = false;

function playScreen(mode: Mode, total: number) {
  app.innerHTML = `
  <div class="screen play">
    <div class="hud">
      <button class="icon-btn quit" data-act="quit" aria-label="Abbrechen">✕</button>
      ${
        mode === "endless"
          ? `<div class="endless-count">Runde <b id="ecount">1</b></div>`
          : `<div class="dots">${Array.from({ length: total }, (_, i) => `<i data-dot="${i}"></i>`).join("")}</div>`
      }
      <div class="hud-score"><b id="score">0</b></div>
    </div>
    <div class="timer"><div class="timer-fill" id="timer"></div></div>
    <div class="stage-holder" id="holder"></div>
  </div>`;
}

async function showIntro(holder: HTMLElement, spec: RoundSpec, label: string) {
  const g = GAME_BY_ID[spec.gameId];
  const first = !S.seen.includes(g.id);
  if (first) {
    S.seen.push(g.id);
    save();
  }
  const intro = document.createElement("div");
  intro.className = "intro";
  intro.style.background = g.bg;
  intro.innerHTML = `<div class="intro-round">${label}</div><div class="intro-emoji">${g.emoji}</div><div class="intro-title">${g.title}</div>${
    first ? `<div class="intro-hint">${g.hint}</div>` : ""
  }`;
  holder.replaceChildren(intro);
  sfx.tick();
  await new Promise<void>((res) => {
    const t = setTimeout(res, first ? 1150 : 680);
    intro.addEventListener("pointerdown", () => {
      clearTimeout(t);
      res();
    });
  });
}

interface RoundResult extends Outcome {
  points: number;
}

function playRound(holder: HTMLElement, spec: RoundSpec): Promise<RoundResult> {
  const g = GAME_BY_ID[spec.gameId];
  const stage = document.createElement("div");
  stage.className = `stage g-${g.id}`;
  stage.style.background = g.bg;
  holder.replaceChildren(stage);
  const timer = document.getElementById("timer")!;
  return new Promise((resolve) => {
    let done = false;
    let limit = 3000;
    let cleanup: (() => void) | undefined;
    const t0 = performance.now();
    let timeout = 0;
    const finish = (o: Outcome) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      const elapsed = performance.now() - t0;
      cleanup?.();
      hook.round = null;
      timer.style.transition = "none";
      timer.style.width = getComputedStyle(timer).width;
      resolve({ ...o, points: roundPoints(o.ok, elapsed, limit, o.rating) });
    };
    const mounted = g.mount({
      el: stage,
      rng: makeRng(spec.seed),
      level: spec.level,
      finish: (o) => {
        if (aborted) return;
        finish(o);
      },
      sfx,
      expose: E2E ? (info) => (hook.round = { ...info, gameId: g.id, n: ++roundCounter }) : () => {},
    });
    limit = mounted.limit;
    cleanup = mounted.cleanup;
    timer.parentElement!.classList.toggle("hidden", Boolean(mounted.hideTimer));
    timer.style.transition = "none";
    timer.style.width = "100%";
    void timer.offsetWidth;
    timer.style.transition = `width ${limit}ms linear`;
    timer.style.width = "0%";
    timeout = window.setTimeout(() => finish({ ok: false, reason: "Zu langsam ⏰" }), limit);
    const abortCheck = window.setInterval(() => {
      if (done) return clearInterval(abortCheck);
      if (aborted) {
        clearInterval(abortCheck);
        finish({ ok: false });
      }
    }, 100);
  });
}

async function feedback(holder: HTMLElement, r: RoundResult) {
  const stage = holder.firstElementChild as HTMLElement;
  stage.classList.add(r.ok ? "done-ok" : "done-fail");
  if (r.ok) {
    sfx.good(r.points);
    floatText(holder, r.points >= 86 ? `ZWIP! +${r.points}` : `+${r.points}`, tileOf(r.points));
  } else {
    sfx.bad();
    shake(holder);
    floatText(holder, r.reason || "Nope!", "fail");
  }
  await sleep(r.ok ? 520 : 900);
}

async function startRun(mode: Mode, opts: RunOpts = {}) {
  clearTimers();
  sfx.unlock();
  aborted = false;
  S.plays += 1;
  save();
  const t = today();
  let seed: number;
  let day: number | undefined;
  if (mode === "daily") {
    day = t;
    seed = daySeed(t);
  } else if (mode === "challenge") {
    seed = opts.seed!;
    day = opts.day;
  } else {
    seed = (Math.random() * 2 ** 32) >>> 0;
  }

  const rounds: number[] = [];
  const specs: RoundSpec[] = [];
  let total = 0;

  if (mode === "endless") {
    playScreen(mode, 0);
    const holder = document.getElementById("holder")!;
    let prev: string | null = null;
    for (let i = 0; ; i++) {
      const spec = endlessRound(seed, i, prev);
      prev = spec.gameId;
      specs.push(spec);
      document.getElementById("ecount")!.textContent = String(i + 1);
      await showIntro(holder, spec, `Runde ${i + 1}`);
      if (aborted) return home();
      const r = await playRound(holder, spec);
      if (aborted) return home();
      rounds.push(r.points);
      if (r.ok) {
        total += r.points;
        countUp(document.getElementById("score")!, total, 300);
      }
      await feedback(holder, r);
      if (!r.ok) break;
    }
    const isBest = total > S.best.endless;
    S.best.endless = Math.max(S.best.endless, total);
    save();
    return results({ mode, seed, rounds, specs, endlessBest: isBest });
  }

  const list = buildRounds(seed);
  specs.push(...list);
  playScreen(mode, ROUNDS);
  const holder = document.getElementById("holder")!;
  for (let i = 0; i < list.length; i++) {
    const spec = list[i];
    await showIntro(holder, spec, `${i + 1} / ${ROUNDS}`);
    if (aborted) return home();
    const r = await playRound(holder, spec);
    if (aborted) return home();
    rounds.push(r.points);
    total += r.points;
    const dot = document.querySelector(`[data-dot="${i}"]`);
    dot?.classList.add(`t-${tileOf(r.points)}`);
    countUp(document.getElementById("score")!, total, 300);
    await feedback(holder, r);
  }

  const result: DayResult = { score: total, rounds };
  let rankP: Promise<{ rank: number; total: number } | null> | null = null;
  if (mode === "daily") {
    const fresh = recordDaily(S, t, result);
    if (fresh && !E2E && hasGlobalBoard) {
      rankP = submitScore({ day: t, name: S.name, deviceId: S.deviceId, player: publicId(S), score: total, rounds }).then(
        () => fetchRank(t, total),
      );
    }
  } else if (mode === "free") {
    S.best.free = Math.max(S.best.free, total);
  }
  if (opts.vs && opts.vs.m === "d") {
    addCrewResult(S, opts.vs.i, opts.vs.n, opts.vs.d!, { score: sumPoints(opts.vs.r), rounds: opts.vs.r });
  }
  if (opts.vs) pending = null;
  save();
  results({ mode, day, seed, rounds, specs, vs: opts.vs, rankP });
}

// ---------- Ergebnis ----------

interface ResultData {
  mode: Mode;
  day?: number;
  seed: number;
  rounds: number[];
  specs: RoundSpec[];
  vs?: ChallengePayload;
  replay?: boolean;
  endlessBest?: boolean;
  rankP?: Promise<{ rank: number; total: number } | null> | null;
}

function payloadFor(d: ResultData): ChallengePayload {
  const base = { v: 1 as const, n: S.name, i: publicId(S), r: d.rounds.slice(0, ROUNDS) };
  return d.day !== undefined ? { ...base, m: "d", d: d.day } : { ...base, m: "t", z: d.seed };
}

function results(d: ResultData) {
  clearTimers();
  if (pending && d.vs) pending = null;
  const score = sumPoints(d.rounds);
  const t = today();
  const streak = currentStreak(S, t);
  const endless = d.mode === "endless";
  const label = endless
    ? "Endlos"
    : d.day !== undefined
      ? `Daily #${d.day}${d.day !== t ? " (Duell)" : ""}`
      : d.mode === "challenge"
        ? "Duell · Training"
        : "Training";

  let vsBlock = "";
  let won = false;
  if (d.vs) {
    const theirs = sumPoints(d.vs.r);
    won = score > theirs;
    const draw = score === theirs;
    const rows = d.rounds
      .map((p, i) => {
        const q = d.vs!.r[i] ?? 0;
        const g = GAME_BY_ID[d.specs[i]?.gameId];
        return `<div class="vs-row"><b class="${p > q ? "win" : ""}">${p}</b><span>${g?.emoji ?? ""}</span><b class="${q > p ? "win" : ""}">${q}</b></div>`;
      })
      .join("");
    vsBlock = `<div class="vs-card pop-in">
      <div class="vs-head"><span>Du</span><span class="vs-badge">${draw ? "Unentschieden" : won ? "Gewonnen! 🏆" : "Verloren 😤"}</span><span>${esc(d.vs.n)}</span></div>
      <div class="vs-totals"><b>${score}</b><i>vs</i><b>${theirs}</b></div>
      <div class="vs-rows">${rows}</div>
    </div>`;
  }

  const tiles = endless
    ? `<div class="endless-res">${d.rounds.length - (d.rounds.at(-1) === 0 ? 1 : 0)} Runden geschafft${d.endlessBest ? " · Neuer Rekord! 🎉" : ` · Rekord ${S.best.endless}`}</div>`
    : `<div class="tiles">${d.rounds
        .map((p, i) => {
          const g = GAME_BY_ID[d.specs[i]?.gameId];
          return `<div class="tile t-${tileOf(p)}" style="--i:${i}"><span>${g?.emoji ?? ""}</span><b>${p}</b></div>`;
        })
        .join("")}</div>`;

  const showName = !S.nameSet && !endless;
  const canChallenge = !endless;

  app.innerHTML = `
  <div class="screen result">
    <header class="topbar">
      <button class="icon-btn" data-act="home" aria-label="Zurück">←</button>
      <span class="mode-tag">${label}</span>
      <button class="icon-btn" data-act="sound" aria-label="Ton an/aus">${S.muted ? "🔇" : "🔊"}</button>
    </header>
    <div class="score-block">
      <div class="score-big" id="big">0</div>
      <div class="verdict">${endless ? "Punkte im Endlos-Modus" : verdict(score)}</div>
    </div>
    ${vsBlock}
    ${tiles}
    <div class="stats">
      ${d.mode === "daily" ? `<div><b>🔥 ${streak}</b><span>Streak</span></div>` : ""}
      <div><b>${endless ? S.best.endless : d.mode === "daily" || d.day !== undefined ? S.best.daily : S.best.free}</b><span>Rekord</span></div>
      <div id="rank-slot" class="${d.rankP ? "" : "hidden"}"><b>…</b><span>Platz heute</span></div>
    </div>
    ${
      showName
        ? `<div class="name-card"><label for="nm">Dein Name für Duelle</label><div class="row"><input id="nm" maxlength="20" value="${esc(S.name)}" autocomplete="nickname"><button class="btn sm primary" data-act="savename">OK</button></div></div>`
        : ""
    }
    <div class="actions">
      <button class="btn primary" data-act="share">Ergebnis teilen 📤</button>
      ${canChallenge ? `<button class="btn" data-act="challenge">Freund:in herausfordern ⚔️</button>` : ""}
      ${endless ? "" : `<button class="btn ghost" data-act="story">Story-Bild für TikTok/Insta 📸</button>`}
    </div>
    <div class="actions-2">
      <button class="link-btn" data-act="${endless ? "endless" : "free"}">${endless ? "Nochmal ♾️" : "Training 🏋️"}</button>
      <button class="link-btn" data-act="board">Bestenliste 🏆</button>
      <button class="link-btn" data-act="home">Home</button>
    </div>
  </div>`;

  const big = document.getElementById("big")!;
  countUp(big, score, 1000, () => sfx.tick());
  setTimeout(() => {
    if (d.vs ? won : score >= 680 || d.endlessBest) {
      sfx.win();
      confetti();
    }
  }, 1000);

  d.rankP?.then((r) => {
    const slot = document.getElementById("rank-slot");
    if (!slot) return;
    if (!r) return slot.classList.add("hidden");
    slot.querySelector("b")!.textContent = `${r.rank}/${r.total}`;
  });

  lastResult = d;
}

let lastResult: ResultData | null = null;

function resultShareText(d: ResultData, withChallenge: boolean): string {
  const score = sumPoints(d.rounds);
  const code = d.mode === "endless" ? undefined : encodeChallenge(payloadFor(d));
  // Ohne feste Web-Adresse (z. B. Vorschau-Datei) wird statt des Links der Code geteilt
  const codeOnly = typeof __ZWIP_SINGLE__ !== "undefined" && __ZWIP_SINGLE__ && !CONFIG.publicUrl;
  const link = codeOnly ? undefined : buildLink(publicBase(), code);
  if (withChallenge) {
    const target = codeOnly ? `Öffne ZWIP → Bestenliste → Code einfügen:\n${code}` : link;
    return `${S.name} fordert dich bei ZWIP heraus ⚔️\n${score} Punkte in 10 Blitz-Challenges. Gleiche Runde, du bist dran:\n${target}`;
  }
  return shareText({
    mode: d.mode,
    day: d.day,
    score,
    rounds: d.rounds,
    streak: d.mode === "daily" ? currentStreak(S, today()) : 0,
    endlessRounds: d.rounds.filter((p) => p > 0).length,
    link: link ?? (code ? `Duell-Code: ${code}` : undefined),
    vs: d.vs ? { name: d.vs.n, score: sumPoints(d.vs.r) } : undefined,
  });
}

// ---------- Bestenliste ----------

async function board(tab: "crew" | "world" = "crew") {
  clearTimers();
  const t = today();
  app.innerHTML = `
  <div class="screen board">
    <header class="topbar">
      <button class="icon-btn" data-act="home" aria-label="Zurück">←</button>
      <span class="mode-tag">Bestenliste · #${t}</span>
      <span class="icon-btn ghost-slot"></span>
    </header>
    ${
      hasGlobalBoard
        ? `<div class="tabs"><button class="${tab === "crew" ? "on" : ""}" data-act="tab-crew">Crew</button><button class="${tab === "world" ? "on" : ""}" data-act="tab-world">Welt</button></div>`
        : ""
    }
    <div id="list" class="list"></div>
    ${
      tab === "crew"
        ? `<div class="add-card">
            <b>Crew erweitern</b>
            <p class="muted">Schick deinen Duell-Link rum. Wer ihn spielt, schickt dir seinen zurück – und landet hier.</p>
            <button class="btn primary sm" data-act="${S.daily[t] ? "challenge-today" : "daily"}">${S.daily[t] ? "Duell-Link teilen ⚔️" : "Erst Daily spielen ▶"}</button>
            <div class="row"><input id="paste" placeholder="Link oder Code einfügen" autocomplete="off"><button class="btn sm" data-act="paste">Rein</button></div>
          </div>`
        : ""
    }
  </div>`;
  const list = document.getElementById("list")!;

  if (tab === "crew") {
    const rows: { name: string; score: number; rounds: number[]; me?: boolean }[] = [];
    if (S.daily[t]) rows.push({ name: S.name, ...S.daily[t], me: true });
    Object.values(S.crew).forEach((m) => {
      if (m.days[t]) rows.push({ name: m.name, ...m.days[t] });
    });
    rows.sort((a, b) => b.score - a.score);
    const crewCount = Object.keys(S.crew).length;
    list.innerHTML = rows.length
      ? rows
          .map(
            (r, i) =>
              `<div class="row-item ${r.me ? "me" : ""}"><span class="rk">${["🥇", "🥈", "🥉"][i] ?? i + 1}</span><span class="nm">${esc(r.name)}${r.me ? " (du)" : ""}</span>${miniGrid(r.rounds)}<b>${r.score}</b></div>`,
          )
          .join("") +
        (crewCount ? `<p class="muted center">${crewCount} in deiner Crew</p>` : "")
      : `<div class="empty">Heute noch niemand hier.<br>Spiel die Daily und fordere jemanden heraus!</div>`;
    return;
  }

  list.innerHTML = `<div class="empty">Lädt…</div>`;
  const rows = await fetchBoard(t);
  if (!rows) {
    list.innerHTML = `<div class="empty">Bestenliste gerade nicht erreichbar 📡</div>`;
    return;
  }
  const me = publicId(S);
  list.innerHTML = rows.length
    ? rows
        .map(
          (r, i) =>
            `<div class="row-item ${r.player === me ? "me" : ""}"><span class="rk">${["🥇", "🥈", "🥉"][i] ?? i + 1}</span><span class="nm">${esc(r.name)}</span><b>${r.score}</b></div>`,
        )
        .join("")
    : `<div class="empty">Sei heute die/der Erste!</div>`;
}

// ---------- Einstellungen ----------

function settings() {
  modal(
    `<h3>Einstellungen</h3>
     <label class="lbl" for="set-name">Dein Name</label>
     <input id="set-name" maxlength="20" value="${esc(S.name)}" autocomplete="nickname">
     <label class="toggle"><input type="checkbox" id="set-sound" ${S.muted ? "" : "checked"}> Sound</label>
     <div class="account-box">
       <div><span class="lbl">Angemeldet als</span><b class="account-mail">${esc(currentUser()?.email ?? "")}</b></div>
       <button class="btn ghost sm" id="set-logout" type="button">Abmelden</button>
     </div>
     <div class="how">
       <b>So geht ZWIP</b>
       <p>Jeden Tag gibt es eine Daily mit 10 Blitz-Challenges – für alle gleich. Schnell + richtig = mehr Punkte (max. 1000). Teile dein Ergebnis oder schick einen Duell-Link: Deine Freunde spielen exakt dieselbe Runde.</p>
       <p class="muted">Keine Werbung, keine Lootboxen.</p>
     </div>
     <button class="btn primary" id="set-save">Speichern</button>`,
    (el, close) => {
      el.querySelector("#set-logout")!.addEventListener("click", async () => {
        close();
        await signOut();
        toast("Du bist abgemeldet 👋");
      });
      el.querySelector("#set-save")!.addEventListener("click", () => {
        const n = (el.querySelector("#set-name") as HTMLInputElement).value.trim();
        if (n) {
          S.name = n.slice(0, 20);
          S.nameSet = true;
        }
        S.muted = !(el.querySelector("#set-sound") as HTMLInputElement).checked;
        sfx.setMuted(S.muted);
        save();
        close();
        home();
      });
    },
  );
}

// ---------- Aktionen ----------

app.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act!;
  // Spiel nur mit Anmeldung erreichbar
  if (!currentUser()) return showStart();
  if (act !== "quit") sfx.tap();
  const t = today();
  switch (act) {
    case "daily":
      if (S.daily[t]) return home();
      return startRun("daily");
    case "duel":
      if (pending) acceptChallenge(pending);
      return;
    case "free":
      return startRun("free");
    case "endless":
      return startRun("endless");
    case "board":
      return board("crew");
    case "tab-crew":
      return board("crew");
    case "tab-world":
      return board("world");
    case "home":
      return home();
    case "quit":
      aborted = true;
      return;
    case "settings":
      return settings();
    case "sound":
      S.muted = !S.muted;
      sfx.setMuted(S.muted);
      save();
      btn.textContent = S.muted ? "🔇" : "🔊";
      return;
    case "savename": {
      const inp = document.getElementById("nm") as HTMLInputElement | null;
      const n = inp?.value.trim();
      S.name = (n || randomName()).slice(0, 20);
      S.nameSet = true;
      save();
      btn.closest(".name-card")?.remove();
      toast(`Hi ${S.name}! 👋`);
      return;
    }
    case "share":
      if (lastResult) await doShare(resultShareText(lastResult, false));
      return;
    case "challenge":
      if (lastResult) await doShare(resultShareText(lastResult, true));
      return;
    case "share-today":
    case "challenge-today": {
      const r = S.daily[t];
      if (!r) return;
      const d: ResultData = { mode: "daily", day: t, seed: daySeed(t), rounds: r.rounds, specs: buildRounds(daySeed(t)) };
      await doShare(resultShareText(d, act === "challenge-today"));
      return;
    }
    case "story": {
      if (!lastResult) return;
      const d = lastResult;
      const blob = await storyImage({
        title: d.day !== undefined ? `Daily #${d.day}` : "Training",
        score: sumPoints(d.rounds),
        rounds: d.rounds,
        verdict: verdict(sumPoints(d.rounds)),
        streak: d.mode === "daily" ? currentStreak(S, t) : 0,
        url: publicBase(),
      });
      if (blob) await shareImage(blob);
      return;
    }
    case "paste": {
      const inp = document.getElementById("paste") as HTMLInputElement;
      const code = extractChallengeCode(inp.value);
      const p = code ? decodeChallenge(code) : null;
      if (!p) return toast("Das ist kein gültiger ZWIP-Link 🤔");
      if (p.i === publicId(S)) return toast("Das ist dein eigener Link 😄");
      if (p.m === "d" && S.daily[p.d!]) {
        addCrewResult(S, p.i, p.n, p.d!, { score: sumPoints(p.r), rounds: p.r });
        save();
        toast(`${p.n} ist jetzt in deiner Crew`);
        return board("crew");
      }
      pending = p;
      return home();
    }
  }
});

// Doppeltipp-Zoom & Kontextmenü im Spiel verhindern
document.addEventListener("contextmenu", (e) => {
  if ((e.target as HTMLElement).closest(".play")) e.preventDefault();
});

// Offline-fähig als installierbare Web-App
if (typeof __ZWIP_SINGLE__ !== "undefined" && !__ZWIP_SINGLE__ && "serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

// ---------- Start: erst Anmeldung, dann Spiel ----------

function showStart() {
  aborted = true;
  clearTimers();
  document.querySelector(".modal-bg")?.remove();
  renderStart(app, {
    banner: pending ? `<b>${esc(pending.n)}</b> fordert dich heraus (${sumPoints(pending.r)} Punkte)` : undefined,
    onSignedIn: (fresh) => {
      home();
      toast(fresh ? "Account erstellt – viel Spaß! 🎉" : "Angemeldet ✌️");
    },
  });
}

// Abgemeldet (Logout oder abgelaufene Sitzung) → zurück ins Startmenü
onAuthChange((s) => {
  if (!s) showStart();
});

async function boot() {
  app.innerHTML = `<div class="screen boot" aria-busy="true"><h1 class="logo" aria-label="ZWIP"><span>Z</span><span>W</span><span>I</span><span>P</span></h1></div>`;
  const s = await restoreSession();
  if (s) home();
  else showStart();
}

void boot();
