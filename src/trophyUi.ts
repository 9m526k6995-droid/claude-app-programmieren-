// Trophäen-Bildschirme: Trophäenpfad, Liga-Aufstieg, Ergebnis, Weltrangliste, Spielerprofil, Spielername.

import { flag, countryName } from "./countries";
import { esc, modal } from "./ui";
import { confetti } from "./fx";
import {
  LEAGUES,
  MILESTONES,
  MAX_TROPHIES,
  TROPHY_TASKS,
  leagueFor,
  leagueById,
  milestoneProgress,
  formatTrophies,
  formatDelta,
  difficultyLabel,
  leagueFee,
  type League,
  type RoundScore,
} from "./trophies";
import { setUsername, getPlayerProfile, SocialError, type MyProfile, type PlayerInfo, type RoundFinish, type TrophyBoard } from "./social";
import { avatarHtml, profileLink, shareLink, memberSince } from "./profileKit";

export function leagueBadge(id: string | League, cls = ""): string {
  const l = typeof id === "string" ? leagueById(id) : id;
  return `<span class="league-badge ${cls}" style="--lc:${l.color}">${l.emoji} ${l.name}</span>`;
}

// ---------- Spielername ----------

export function suggestUsername(fromName: string): string {
  const map: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };
  const s = fromName
    .replace(/[äöüÄÖÜß]/g, (c) => map[c])
    .replace(/[^A-Za-z0-9_]/g, "")
    .slice(0, 16);
  return s.length >= 3 ? s : "";
}

export function askUsername(opts: { suggestion: string; reason?: string; onSaved: (p: MyProfile) => void }) {
  modal(
    `<h3>Dein Spielername</h3>
     <p class="muted modal-text">${esc(opts.reason ?? "Unter diesem Namen erscheinst du in der Weltrangliste und können dich Freunde finden.")} Deine E-Mail-Adresse bleibt privat.</p>
     <label class="lbl" for="un-input">Spielername</label>
     <input id="un-input" maxlength="16" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(opts.suggestion)}" enterkeyhint="done">
     <p class="hint muted">3–16 Zeichen: Buchstaben (ohne Umlaute), Zahlen und _</p>
     <div class="auth-error" role="alert" hidden></div>
     <button class="btn primary" id="un-save" type="button">Speichern</button>
     <button class="btn ghost" data-close type="button">Später</button>`,
    (el, close) => {
      const input = el.querySelector<HTMLInputElement>("#un-input")!;
      const err = el.querySelector<HTMLElement>(".auth-error")!;
      const btn = el.querySelector<HTMLButtonElement>("#un-save")!;
      const save = async () => {
        err.hidden = true;
        btn.disabled = true;
        btn.textContent = "Speichern…";
        try {
          const p = await setUsername(input.value.trim());
          close();
          opts.onSaved(p);
        } catch (e) {
          err.textContent = e instanceof SocialError ? e.message : "Da ist etwas schiefgelaufen.";
          err.hidden = false;
          btn.disabled = false;
          btn.textContent = "Speichern";
          input.focus();
        }
      };
      btn.addEventListener("click", save);
      input.addEventListener("keydown", (e) => e.key === "Enter" && save());
      input.focus();
      input.select();
    },
  );
}

// ---------- Trophäenpfad ----------

export interface PathHandlers {
  onBack: () => void;
  onPlay: () => void;
  onBoard: () => void;
  onSetName: () => void;
}

const STEP = 96;
const PAD = 80;

interface Pt {
  x: number; // 0..100 (%)
  y: number; // px
}

function nodePoint(i: number, H: number): Pt {
  return { x: 50 + 27 * Math.sin(i * 0.85), y: H - PAD - i * STEP };
}

/** Kontrollpunkte für ein weich geschwungenes Segment zwischen zwei Meilensteinen. */
function seg(a: Pt, b: Pt): [Pt, Pt, Pt, Pt] {
  return [a, { x: a.x, y: a.y - STEP * 0.5 }, { x: b.x, y: b.y + STEP * 0.5 }, b];
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** De-Casteljau: vorderer Teil einer Bézierkurve bis t, plus Punkt bei t. */
function splitBezier([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number): { part: [Pt, Pt, Pt, Pt]; at: Pt } {
  const a = lerpPt(p0, p1, t),
    b = lerpPt(p1, p2, t),
    c = lerpPt(p2, p3, t);
  const d = lerpPt(a, b, t),
    e = lerpPt(b, c, t);
  const f = lerpPt(d, e, t);
  return { part: [p0, a, d, f], at: f };
}

const cmd = (s: [Pt, Pt, Pt, Pt]) => `C ${s[1].x} ${s[1].y}, ${s[2].x} ${s[2].y}, ${s[3].x} ${s[3].y}`;

export function renderPath(app: HTMLElement, p: MyProfile | null, state: { error?: string }, h: PathHandlers) {
  const trophies = p?.trophies ?? 0;
  const league = leagueFor(trophies);
  const prog = milestoneProgress(trophies);
  const n = MILESTONES.length;
  const H = (n - 1) * STEP + PAD * 2;
  const pts = MILESTONES.map((_, i) => nodePoint(i, H));

  // Linien: kompletter Pfad (gedimmt) und erreichter Teil (leuchtend)
  let full = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) full += ` ${cmd(seg(pts[i], pts[i + 1]))}`;
  const k = MILESTONES.indexOf(prog.from);
  let done = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < k; i++) done += ` ${cmd(seg(pts[i], pts[i + 1]))}`;
  let marker = pts[k];
  if (k < n - 1 && prog.ratio > 0) {
    const sp = splitBezier(seg(pts[k], pts[k + 1]), prog.ratio);
    done += ` ${cmd(sp.part)}`;
    marker = sp.at;
  }

  // Liga-Bereiche
  const bands = LEAGUES.map((l, li) => {
    const i0 = MILESTONES.indexOf(l.min);
    const next = LEAGUES[li + 1];
    const bottom = li === 0 ? H : pts[i0].y + STEP / 2;
    const top = next ? pts[MILESTONES.indexOf(next.min)].y + STEP / 2 : 0;
    const reached = trophies >= l.min;
    return `<div class="band ${reached ? "reached" : "locked"} ${l.id === league.id ? "current" : ""}" style="top:${top}px;height:${bottom - top}px;--lc:${l.color}">
        <span class="band-label">${l.emoji} ${l.name.toUpperCase()}<small>${l.min ? `ab ${formatTrophies(l.min)}` : "Start"}</small></span>
      </div>`;
  }).join("");

  const nextIdx = MILESTONES.findIndex((m) => m > trophies);
  const nodes = MILESTONES.map((m, i) => {
    const reached = trophies >= m;
    const isLeague = LEAGUES.find((l) => l.min === m);
    const cls = reached ? "reached" : i === nextIdx ? "next" : "locked";
    const label = m === 0 ? "Start" : formatTrophies(m);
    const lc = (isLeague ?? leagueFor(m)).color;
    return `<div class="pnode ${cls} ${isLeague ? "league" : ""}" style="left:${pts[i].x}%;top:${pts[i].y}px;--lc:${lc}" aria-label="${label} Trophäen${reached ? ", erreicht" : ", gesperrt"}">
        <span class="pn-dot">${isLeague ? isLeague.emoji : reached ? "✓" : "🔒"}</span>
        <span class="pn-label ${pts[i].x > 50 ? "left" : "right"}">${label}</span>
      </div>`;
  }).join("");

  const toNext =
    trophies >= MAX_TROPHIES
      ? `Du hast das Ziel erreicht: <b>20.000</b> 🏆`
      : `Du bist zwischen <b>${formatTrophies(prog.from)}</b> und <b>${formatTrophies(prog.to)}</b> · noch <b>${formatTrophies(prog.to - trophies)}</b>`;
  const nextLeague = LEAGUES.find((l) => l.min > trophies);

  app.innerHTML = `
  <div class="screen path-screen">
    <header class="topbar">
      <button class="icon-btn" data-p="back" aria-label="Zurück">←</button>
      <span class="mode-tag">Trophäenpfad</span>
      <button class="icon-btn" data-p="board" aria-label="Weltrangliste">🏆</button>
    </header>
    <div class="path-summary">
      <div class="ps-row">
        <div class="ps-count"><span class="flame" aria-hidden="true">🔥</span><b id="ps-trophies">${formatTrophies(trophies)}</b></div>
        ${leagueBadge(league)}
      </div>
      <div class="ps-next">${toNext}</div>
      ${nextLeague ? `<div class="ps-league muted">${nextLeague.emoji} ${nextLeague.name} ab ${formatTrophies(nextLeague.min)}${p?.world_rank ? ` · Weltrang #${p.world_rank}` : ""}</div>` : p?.world_rank ? `<div class="ps-league muted">Weltrang #${p.world_rank}</div>` : ""}
    </div>
    ${state.error ? `<div class="inline-error" role="alert">${esc(state.error)}</div>` : ""}
    ${p && !p.username ? `<button class="name-banner" data-p="name"><b>Wähle deinen Spielernamen</b><span>Damit du in der Weltrangliste erscheinst →</span></button>` : ""}
    <div class="path-scroll" id="path-scroll">
      <div class="path" style="height:${H}px">
        ${bands}
        <svg class="path-svg" viewBox="0 0 100 ${H}" preserveAspectRatio="none" width="100%" height="${H}" aria-hidden="true">
          <path class="path-line-bg" d="${full}" vector-effect="non-scaling-stroke"/>
          <path class="path-line-done" d="${done}" vector-effect="non-scaling-stroke"/>
        </svg>
        ${nodes}
        <div class="you-marker" style="left:${marker.x}%;top:${marker.y}px">
          <span class="you-ring"></span>
          <span class="you-bubble">Du · ${formatTrophies(trophies)}</span>
        </div>
      </div>
    </div>
    <div class="path-cta">
      <button class="btn primary big" data-p="play">🏆 Trophäen-Modus spielen</button>
      <small class="muted">${TROPHY_TASKS} Aufgaben · ${difficultyLabel(trophies)} · richtig +6, falsch −10${leagueFee(trophies) ? ` · Liga-Einsatz −${leagueFee(trophies)}` : ""}</small>
    </div>
  </div>`;

  const scroll = app.querySelector<HTMLElement>("#path-scroll")!;
  // Direkt zur eigenen Position springen (Pfad läuft von unten nach oben)
  const jump = () => scroll.scrollTo({ top: Math.max(0, marker.y - scroll.clientHeight * 0.55), behavior: "instant" as ScrollBehavior });
  jump();
  requestAnimationFrame(jump);
  app.querySelector('[data-p="back"]')!.addEventListener("click", h.onBack);
  app.querySelector('[data-p="board"]')!.addEventListener("click", h.onBoard);
  app.querySelector('[data-p="play"]')!.addEventListener("click", h.onPlay);
  app.querySelector('[data-p="name"]')?.addEventListener("click", h.onSetName);
}

// ---------- Liga-Aufstieg ----------

export function leagueUp(leagueId: string, trophies: number): Promise<void> {
  const l = leagueById(leagueId);
  const wrap = document.createElement("div");
  wrap.className = "league-up";
  wrap.style.setProperty("--lc", l.color);
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-label", `Neue Liga erreicht: ${l.name}`);
  wrap.innerHTML = `
    <div class="lu-rays" aria-hidden="true"></div>
    <div class="lu-card">
      <div class="lu-kicker">NEUE LIGA ERREICHT!</div>
      <div class="lu-emoji">${l.emoji}</div>
      <div class="lu-name">${l.name.toUpperCase()}</div>
      <div class="lu-sub">${formatTrophies(Math.max(trophies, l.min))} TROPHÄEN</div>
      <button class="btn primary" type="button">Weiter</button>
    </div>`;
  document.body.append(wrap);
  confetti(140);
  return new Promise((res) => {
    const close = () => {
      wrap.classList.add("out");
      setTimeout(() => wrap.remove(), 250);
      res();
    };
    wrap.querySelector("button")!.addEventListener("click", close);
    wrap.querySelector<HTMLButtonElement>("button")!.focus();
  });
}

// ---------- Ergebnis ----------

export interface ResultHandlers {
  again: () => void;
  path: () => void;
  board: () => void;
  home: () => void;
  retry: () => void;
}

export function renderTrophyResult(
  app: HTMLElement,
  d: { server: RoundFinish | null; local: RoundScore; startTrophies: number; error?: string; saving?: boolean },
  h: ResultHandlers,
) {
  const s = d.server;
  const base = s?.base ?? d.local.base;
  const speed = s?.speed_bonus ?? d.local.speed;
  const streak = s?.streak_bonus ?? d.local.streakBonus;
  const penalty = s?.penalty ?? d.local.penalty;
  const fee = s?.league_fee ?? d.local.fee;
  const feeLeague = leagueFor(d.startTrophies);
  const oldL = s ? leagueById(s.old_league) : null;
  const newL = s ? leagueById(s.new_league) : null;
  const relegated = Boolean(oldL && newL && LEAGUES.indexOf(newL) < LEAGUES.indexOf(oldL));
  const raw = s?.raw_delta ?? d.local.raw;
  const applied = s?.delta ?? raw;
  const oldT = s?.old_trophies ?? d.startTrophies;
  const newT = s?.new_trophies ?? Math.max(0, Math.min(MAX_TROPHIES, d.startTrophies + raw));
  const correct = s?.correct ?? d.local.correct;
  const wrong = s?.wrong ?? d.local.wrong;
  const bestStreak = s?.best_streak ?? d.local.bestStreak;
  const capped = s && applied !== raw;
  const sign = (n: number) => (n > 0 ? "pos" : n < 0 ? "neg" : "");

  app.innerHTML = `
  <div class="screen trophy-result">
    <header class="topbar">
      <button class="icon-btn" data-r="home" aria-label="Hauptmenü">←</button>
      <span class="mode-tag">Trophäen-Modus</span>
      <span class="icon-btn ghost-slot"></span>
    </header>
    <div class="tr-head">
      <div class="tr-kicker">TROPHÄEN-RUNDE BEENDET</div>
      <div class="tr-total ${sign(applied)}"><span id="tr-delta">${formatDelta(applied)}</span> 🏆</div>
      ${capped ? `<div class="muted tr-cap">${newT === 0 ? "Weniger als 0 geht nicht." : "Maximum von 20.000 erreicht!"}</div>` : ""}
      ${
        d.saving
          ? `<div class="tr-status">Wird gespeichert…</div>`
          : d.error
            ? `<div class="inline-error" role="alert">${esc(d.error)} <button class="link-btn" data-r="retry">Erneut senden</button></div>`
            : ""
      }
    </div>
    <div class="tr-stand">
      <div><span>Alter Stand</span><b>${formatTrophies(oldT)}</b></div>
      <div class="tr-arrow" aria-hidden="true">→</div>
      <div><span>Neuer Stand</span><b id="tr-new">${formatTrophies(s ? oldT : newT)}</b></div>
    </div>
    ${relegated ? `<div class="tr-down" role="status">Abgestiegen: ${newL!.emoji} ${newL!.name}. Hol dir die Liga zurück!</div>` : ""}
    <div class="tr-league">${leagueBadge(leagueFor(newT))}${s?.world_rank ? `<span class="muted">Weltrang #${s.world_rank}</span>` : ""}</div>
    <dl class="tr-rows">
      <div><dt>Richtige Antworten</dt><dd>${correct} / ${TROPHY_TASKS}</dd></div>
      <div><dt>Falsche Antworten</dt><dd>${wrong}</dd></div>
      <div><dt>Beste Serie</dt><dd>🔥 ${bestStreak}</dd></div>
      <div class="sep"><dt>Basis-Trophäen</dt><dd class="pos">${formatDelta(base)}</dd></div>
      <div><dt>Geschwindigkeitsbonus</dt><dd class="pos">${formatDelta(speed)}</dd></div>
      <div><dt>Serienbonus</dt><dd class="pos">${formatDelta(streak)}</dd></div>
      <div><dt>Abzüge für Fehler</dt><dd class="neg">${penalty ? formatDelta(-penalty) : "0"}</dd></div>
      <div><dt>Liga-Einsatz (${feeLeague.name})</dt><dd class="neg">${fee ? formatDelta(-fee) : "0"}</dd></div>
      <div class="total"><dt>GESAMT</dt><dd class="${sign(applied)}">${formatDelta(applied)} TROPHÄEN</dd></div>
    </dl>
    <div class="actions">
      <button class="btn primary" data-r="again">Nochmal spielen</button>
      <button class="btn" data-r="path">Zum Trophäenpfad</button>
      <div class="actions-row">
        <button class="btn ghost" data-r="board">Weltrangliste</button>
        <button class="btn ghost" data-r="home">Hauptmenü</button>
      </div>
    </div>
  </div>`;

  const bind = (k: keyof ResultHandlers) => app.querySelectorAll(`[data-r="${k}"]`).forEach((b) => b.addEventListener("click", h[k]));
  (["again", "path", "board", "home", "retry"] as const).forEach(bind);
  if (s && newT !== oldT) {
    const el = app.querySelector<HTMLElement>("#tr-new")!;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      el.textContent = formatTrophies(oldT + (newT - oldT) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// ---------- Spielerprofil ----------

export function playerModal(
  p: PlayerInfo,
  opts: { action?: { label: string; danger?: boolean; confirm?: string; run: () => Promise<void> | void } } = {},
) {
  const l = leagueById(p.league);
  modal(
    `<div class="pm-head" style="--lc:${l.color}">
       ${avatarHtml(p.username, null)}
       <h3>${esc(p.username)}</h3>
       ${leagueBadge(l)}
       <small class="muted pf-since" hidden></small>
     </div>
     <dl class="pm-stats">
       <div><dt>Trophäen</dt><dd>${formatTrophies(p.trophies)} 🏆</dd></div>
       <div><dt>Weltrang</dt><dd>${p.world_rank ? `#${p.world_rank}` : "–"}</dd></div>
       <div><dt>Beste Serie</dt><dd>🔥 ${p.best_streak ?? 0}</dd></div>
       <div><dt>Trophäen-Runden</dt><dd>${p.trophy_rounds ?? 0}</dd></div>
     </dl>
     ${opts.action ? `<button class="btn ${opts.action.danger ? "ghost danger" : "primary"}" id="pm-action" type="button">${esc(opts.action.label)}</button>` : ""}
     <div class="actions-row">
       <button class="btn sm" id="pm-share" type="button">Profil teilen 🔗</button>
       <button class="btn ghost sm" data-close type="button">Schließen</button>
     </div>`,
    (el, close) => {
      el.querySelector("#pm-share")!.addEventListener("click", () =>
        void shareLink(profileLink(p.username), `Schau dir ${p.username} auf ZWIP an ⚡`),
      );
      // Profilbild und "Dabei seit" nachladen (Listen liefern bewusst keine Bilder mit)
      getPlayerProfile(p.username)
        .then((full) => {
          if (!el.isConnected) return;
          if (full.avatar) el.querySelector(".pm-avatar")!.outerHTML = avatarHtml(full.username, full.avatar);
          const since = el.querySelector<HTMLElement>(".pf-since")!;
          since.textContent = memberSince(full.member_since);
          since.hidden = !since.textContent;
        })
        .catch(() => {
          /* ohne Bild ist auch okay */
        });
      const btn = el.querySelector<HTMLButtonElement>("#pm-action");
      let armed = !opts.action?.confirm;
      btn?.addEventListener("click", async () => {
        if (!armed) {
          armed = true;
          btn.textContent = opts.action!.confirm!;
          btn.classList.add("armed");
          return;
        }
        btn.disabled = true;
        await opts.action!.run();
        close();
      });
    },
  );
}

// ---------- Weltrangliste ----------

function boardRow(p: PlayerInfo & { rank?: number }, me: boolean): string {
  const rank = p.rank ?? p.world_rank ?? 0;
  const l = leagueById(p.league);
  return `<button class="row-item trow ${me ? "me" : ""}" data-player="${esc(p.username)}">
      <span class="rk">${["🥇", "🥈", "🥉"][rank - 1] ?? rank}</span>
      <span class="nm">${p.country ? `<span class="flag" aria-label="${esc(countryName(p.country))}">${flag(p.country)}</span> ` : ""}${esc(p.username)}${me ? " (du)" : ""}<small style="--lc:${l.color}">${l.emoji} ${l.name}</small></span>
      <b>${formatTrophies(p.trophies)} <span aria-hidden="true">🏆</span></b>
    </button>`;
}

export function renderWorldBoard(list: HTMLElement, b: TrophyBoard, opts: { onSetName: () => void }) {
  const me = b.me;
  const inTop = b.top.some((r) => r.is_me);
  const region = b.country ?? null;
  const myRank = region ? ((me as (PlayerInfo & { rank?: number }) | null)?.rank ?? null) : me?.world_rank;
  const summary = me
    ? `<div class="wr-me">
        <div class="wr-rank"><span>${region ? `Dein Rang in ${flag(region)} ${esc(countryName(region))}` : "Dein Weltrang"}</span><b>#${myRank}</b><small>von ${formatTrophies(b.total)}${region && me.world_rank ? ` · #${me.world_rank} weltweit` : ""}</small></div>
        <div class="wr-info">
          <b>${formatTrophies(me.trophies)} 🏆</b> ${leagueBadge(me.league)}
          ${b.above ? `<div class="muted">Vor dir: <b>${esc(b.above.username)}</b> · ${formatTrophies(b.above.trophies)}</div>` : `<div class="muted">Niemand vor dir 👑</div>`}
          ${b.below ? `<div class="muted">Hinter dir: <b>${esc(b.below.username)}</b> · ${formatTrophies(b.below.trophies)}</div>` : ""}
        </div>
      </div>`
    : region
      ? `<div class="wr-note muted center">Du bist nicht in der Rangliste von ${flag(region)} ${esc(countryName(region))}.</div>`
      : `<button class="name-banner" data-w="name"><b>Wähle deinen Spielernamen</b><span>Dann erscheinst du in der Weltrangliste →</span></button>`;

  const rows = b.top.map((r) => boardRow(r, r.is_me)).join("");
  const outside =
    me && !inTop
      ? `<div class="wr-gap" aria-hidden="true">⋯</div>
         ${b.above ? boardRow(b.above, false) : ""}
         ${boardRow(me, true)}
         ${b.below ? boardRow(b.below, false) : ""}`
      : "";
  list.innerHTML =
    summary +
    `<p class="wr-note muted">${region ? `${flag(region)} ${esc(countryName(region))} · ` : "Weltweit · "}sortiert nach Trophäen – die meisten stehen oben.</p>` +
    (rows
      ? rows + outside
      : region
        ? `<div class="empty">In ${flag(region)} ${esc(countryName(region))} ist noch niemand in der Rangliste.</div>`
        : `<div class="empty">Noch niemand in der Rangliste. Spiel den Trophäen-Modus und sei die/der Erste!</div>`);

  list.querySelector('[data-w="name"]')?.addEventListener("click", opts.onSetName);
  const all = new Map<string, PlayerInfo>();
  [...b.top, b.me, b.above, b.below].forEach((p) => p && all.set(p.username, { ...p, world_rank: p.world_rank ?? (p as { rank?: number }).rank }));
  list.querySelectorAll<HTMLElement>("[data-player]").forEach((el) =>
    el.addEventListener("click", () => {
      const p = all.get(el.dataset.player!);
      if (p) playerModal(p);
    }),
  );
}
