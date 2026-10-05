// Minigames als Einzelspiele: Übersicht, Detailseite mit Rangliste, Lauf-HUD, Startkarte,
// „Stufe geschafft“-Einblendung und Ergebnis. Der Spielablauf selbst steckt in main.ts.

import { esc, sleep } from "./ui";
import { GAMES, GAME_BY_ID, type MicroGame } from "./games";
import { leagueById } from "./trophies";
import type { MinigameBest, MinigameBoard, MinigameEntry } from "./social";

/** 12345 ms → „12,3 s“ */
export function fmtMs(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${s.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

export type BestMap = Map<string, MinigameBest>;

// ---------- Übersicht ----------

export function minigameGridHtml(bests: BestMap | null): string {
  return `<div class="mg-grid">${GAMES.map((g) => {
    const b = bests?.get(g.id);
    const stage = b?.best_stage ?? 0;
    return `<a class="mg-card" href="#/minigames/${g.id}" data-mg="${g.id}" style="--bg:${g.bg}">
      <span class="mg-emoji" aria-hidden="true">${g.emoji}</span>
      <b class="mg-name">${esc(g.title)}</b>
      <small class="mg-best">${stage ? `Bestes: Stufe ${stage}` : bests ? "Noch nicht gespielt" : "&nbsp;"}</small>
      ${b?.rank ? `<span class="mg-rank">#${b.rank}</span>` : ""}
    </a>`;
  }).join("")}</div>`;
}

// ---------- Rangliste eines Minigames ----------

function entryRow(e: MinigameEntry, me: boolean): string {
  const l = leagueById(e.league);
  return `<button class="row-item trow mrow ${me ? "me" : ""}" data-player="${esc(e.username)}">
      <span class="rk">${["🥇", "🥈", "🥉"][e.rank - 1] ?? e.rank}</span>
      <span class="nm">${esc(e.username)}${me ? " (du)" : ""}<small style="--lc:${l.color}">${l.emoji} ${l.name} · ${fmtMs(e.ms)}</small></span>
      <b>Stufe ${e.stage}</b>
    </button>`;
}

export function minigameBoardHtml(b: MinigameBoard): string {
  const inTop = b.top.some((r) => r.is_me);
  const rows = b.top.map((r) => entryRow(r, Boolean(r.is_me))).join("");
  const outside =
    b.me && !inTop
      ? `<div class="wr-gap" aria-hidden="true">⋯</div>
         ${b.above ? entryRow(b.above, false) : ""}
         ${entryRow(b.me, true)}
         ${b.below ? entryRow(b.below, false) : ""}`
      : "";
  return rows
    ? `<div class="list">${rows}${outside}</div>
       <p class="muted center small">${b.total} ${b.total === 1 ? "Spieler" : "Spieler:innen"} · höchste Stufe zuerst, bei Gleichstand zählt die Zeit</p>`
    : `<div class="empty">Noch niemand in dieser Rangliste.<br>Sei die/der Erste!</div>`;
}

// ---------- Detailseite ----------

export function minigameDetailHtml(g: MicroGame, best: MinigameBest | undefined): string {
  return `
    <section class="mg-hero" style="--bg:${g.bg}">
      <span class="mg-hero-emoji" aria-hidden="true">${g.emoji}</span>
      <h2>${esc(g.title)}</h2>
      <p>${esc(g.howto)}</p>
    </section>
    <section class="card-sec">
      <h2 class="sec-title">So wird's schwerer</h2>
      <ul class="mg-prog">${g.progressionText.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </section>
    <section class="mg-stats" aria-label="Deine Werte">
      <div><span>Bestleistung</span><b>${best?.best_stage ? `Stufe ${best.best_stage}` : "–"}</b>${best?.best_stage ? `<small>${fmtMs(best.best_ms)}</small>` : ""}</div>
      <div><span>Dein Rang</span><b>${best?.rank ? `#${best.rank}` : "–"}</b></div>
      <div><span>Gespielt</span><b>${best?.plays ?? 0}×</b></div>
    </section>
    <button class="btn primary big" data-act="mgplay" data-game="${g.id}">▶ Spielen</button>
    <section>
      <h2 class="sec-title">Rangliste</h2>
      <div id="mg-board"><div class="empty">Lädt…</div></div>
    </section>`;
}

// ---------- Lauf ----------

export function minigameRunHtml(g: MicroGame, best: number): string {
  return `
  <div class="screen play mg-play">
    <div class="hud mg-hud">
      <button class="icon-btn quit" data-act="mgquit" aria-label="Lauf beenden">✕</button>
      <div class="mg-hud-mid"><b>${g.emoji} ${esc(g.title)}</b><span>Stufe <b id="mg-stage">1</b></span></div>
      <div class="mg-hud-best" id="mg-best">${best ? `Rekord<b>${best}</b>` : `Rekord<b>–</b>`}</div>
    </div>
    <div class="timer"><div class="timer-fill" id="timer"></div></div>
    <div class="stage-holder" id="holder"></div>
  </div>`;
}

/** Kurze Startkarte: Name · 3 · 2 · 1 (ca. 1,5 s) – keine lange Erklärung. */
export async function startCard(holder: HTMLElement, g: MicroGame, isAborted: () => boolean, tick: () => void) {
  const card = document.createElement("div");
  card.className = "intro mg-start";
  card.style.background = g.bg;
  card.innerHTML = `<div class="intro-emoji">${g.emoji}</div><div class="intro-title">${esc(g.title)}</div><div class="mg-count" aria-live="polite">3</div>`;
  holder.replaceChildren(card);
  const n = card.querySelector<HTMLElement>(".mg-count")!;
  for (const t of ["3", "2", "1"]) {
    if (isAborted()) return;
    n.textContent = t;
    n.classList.remove("pop");
    void n.offsetWidth;
    n.classList.add("pop");
    tick();
    await sleep(420);
  }
  if (isAborted()) return;
  n.textContent = "Los!";
  await sleep(240);
}

/** „Stufe 4 ✓“ – kurze Einblendung zwischen zwei Stufen (~0,6 s). */
export async function stageClear(holder: HTMLElement, stage: number, record: boolean) {
  const el = document.createElement("div");
  el.className = "mg-clear";
  el.innerHTML = `<b>Stufe ${stage} ✓</b>${record ? `<span>Neuer Rekord!</span>` : ""}`;
  holder.append(el);
  await sleep(600);
  el.remove();
}

// ---------- Ergebnis ----------

export interface MgResultView {
  game: MicroGame;
  stage: number;
  totalMs: number;
  record: boolean;
  prevBest: number;
  rank: number | null;
  totalPlayers: number | null;
  saving?: boolean;
  error?: string;
  canRetry?: boolean;
}

export function minigameResultHtml(v: MgResultView): string {
  const g = v.game;
  return `
  <div class="screen mg-result">
    <header class="topbar">
      <button class="icon-btn" data-act="mgback" aria-label="Zurück">←</button>
      <span class="mode-tag">${esc(g.title)}</span>
      <span class="icon-btn ghost-slot"></span>
    </header>
    <section class="mg-res-card" style="--bg:${g.bg}">
      <span class="mg-hero-emoji" aria-hidden="true">${g.emoji}</span>
      <div class="mg-res-kicker">${v.stage ? "Geschafft" : "Diesmal leider"}</div>
      <div class="mg-res-stage">${v.stage ? `Stufe <b id="mg-res-n">${v.stage}</b>` : `<b>Stufe 0</b>`}</div>
      <div class="mg-res-time">${v.stage ? `in ${fmtMs(v.totalMs)} Spielzeit` : "Gleich nochmal!"}</div>
      ${v.record ? `<div class="mg-res-badge">🎉 Neuer Rekord!</div>` : v.prevBest ? `<div class="mg-res-sub">Dein Rekord: Stufe ${v.prevBest}</div>` : ""}
    </section>
    ${
      v.saving
        ? `<div class="tr-status">Wird gespeichert…</div>`
        : v.error
          ? `<div class="inline-error" role="alert">Konnte nicht gespeichert werden. ${esc(v.error)}${v.canRetry ? ` <button class="link-btn" data-act="mgretry">Nochmal senden</button>` : ""}</div>`
          : v.rank
            ? `<div class="mg-res-rank">Platz <b>#${v.rank}</b>${v.totalPlayers ? ` von ${v.totalPlayers}` : ""} in der ${esc(g.title)}-Rangliste</div>`
            : ""
    }
    <div class="actions">
      <button class="btn primary" data-act="mgplay" data-game="${g.id}">Nochmal ▶</button>
      <div class="actions-row">
        <button class="btn" data-act="mgboard" data-game="${g.id}">Rangliste</button>
        <button class="btn" data-act="mgshare" data-game="${g.id}">Teilen 📤</button>
      </div>
      <button class="btn ghost" data-act="mgoverview">Zur Übersicht</button>
    </div>
  </div>`;
}

export function minigameShareText(g: MicroGame, stage: number, link: string): string {
  return `ZWIP ${g.emoji} ${g.title}: Stufe ${stage} – schaffst du mehr?\n${link}`;
}

export { GAME_BY_ID };
