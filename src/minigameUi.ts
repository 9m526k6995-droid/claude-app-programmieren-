// Minigames als Einzelspiele: Übersicht, Detailseite mit Rangliste, Lauf-HUD, Startkarte,
// „Stufe geschafft“-Einblendung und Ergebnis. Der Spielablauf selbst steckt in main.ts.

import { esc, sleep } from "./ui";
import { GAMES, GAME_BY_ID, type MicroGame } from "./games";
import { leagueById } from "./trophies";
import type { MinigameBest, MinigameBoard, MinigameEntry, MinigameRanking } from "./social";
import { fmtScore, scoreFromStage } from "./score";
import { flag, countryName } from "./countries";

/** Highscore eines Bestwerts (ältere Server liefern noch keine Punkte → aus der Stufe umrechnen) */
export function bestScore(b: MinigameBest | undefined | null): number {
  if (!b) return 0;
  return b.best_score ?? scoreFromStage(b.best_stage);
}

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
    const score = bestScore(b);
    return `<a class="mg-card" href="#/minigames/${g.id}" data-mg="${g.id}" style="--bg:${g.bg}">
      <span class="mg-emoji" aria-hidden="true">${g.emoji}</span>
      <b class="mg-name">${esc(g.title)}</b>
      <small class="mg-best">${score ? `🏅 ${fmtScore(score)} · Stufe ${b!.best_stage}` : bests ? "Noch nicht gespielt" : "&nbsp;"}</small>
      ${b?.rank ? `<span class="mg-rank">#${b.rank}</span>` : ""}
    </a>`;
  }).join("")}</div>`;
}

// ---------- Rangliste eines Minigames ----------

function entryRow(e: MinigameEntry, me: boolean): string {
  const l = leagueById(e.league);
  return `<button class="row-item trow mrow ${me ? "me" : ""}" data-player="${esc(e.username)}">
      <span class="rk">${["🥇", "🥈", "🥉"][e.rank - 1] ?? e.rank}</span>
      <span class="nm">${e.country ? `<span class="flag" aria-label="${esc(countryName(e.country))}">${flag(e.country)}</span> ` : ""}${esc(e.username)}${me ? " (du)" : ""}<small style="--lc:${l.color}">${l.emoji} ${l.name} · Stufe ${e.stage}</small></span>
      <b class="score-cell">${fmtScore(e.score ?? scoreFromStage(e.stage))}<small>Punkte</small></b>
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
       <p class="muted center small">${b.total} ${b.total === 1 ? "Spieler" : "Spieler:innen"} · die meisten Punkte zuerst</p>`
    : `<div class="empty">Noch niemand in dieser Rangliste.<br>Sei die/der Erste!</div>`;
}

export type RankScope = "world" | "friends" | "clan";

export function rankScopeHtml(scope: RankScope): string {
  const items: [RankScope, string][] = [["world", "🌍 Welt"], ["friends", "👥 Freunde"], ["clan", "🛡️ Clan"]];
  return `<div class="seg seg-sm" role="tablist" aria-label="Rangliste">${items
    .map(([k, label]) => `<button class="seg-btn ${k === scope ? "on" : ""}" role="tab" aria-selected="${k === scope}" data-scope="${k}">${label}</button>`)
    .join("")}</div>`;
}

export function minigameRankingHtml(r: MinigameRanking): string {
  if (r.scope === "clan" && !r.has_clan) {
    return `<div class="empty">Du bist noch in keinem Clan.<br><a class="link-btn" href="#/clan">Clan finden oder gründen ›</a></div>`;
  }
  const top = r.rows.filter((x) => x.rank <= 50);
  const extra = r.rows.filter((x) => x.rank > 50);
  const rows = top.map((x) => entryRow(x, Boolean(x.is_me))).join("");
  const outside = extra.length ? `<div class="wr-gap" aria-hidden="true">⋯</div>${extra.map((x) => entryRow(x, Boolean(x.is_me))).join("")}` : "";
  if (!rows) {
    if (/^[A-Z]{2}$/.test(r.scope)) return `<div class="empty">In ${flag(r.scope)} ${esc(countryName(r.scope))} hat dieses Spiel noch niemand gespielt.<br>Sei die/der Erste!</div>`;
    return r.scope === "friends"
      ? `<div class="empty">Deine Freunde haben dieses Spiel noch nicht gespielt.<br>Fordere sie heraus!</div>`
      : `<div class="empty">Noch niemand in dieser Rangliste.<br>Sei die/der Erste!</div>`;
  }
  const label =
    r.scope === "world"
      ? `${r.total} ${r.total === 1 ? "Spieler" : "Spieler:innen"} weltweit`
      : r.scope === "friends"
        ? "Du und deine Freunde"
        : r.scope === "clan"
          ? "Dein Clan"
          : `${flag(r.scope)} ${countryName(r.scope)}${r.my_rank ? ` · du bist auf Platz ${r.my_rank}` : ""}`;
  return `<div class="list">${rows}${outside}</div><p class="muted center small">${label} · die meisten Punkte zuerst</p>`;
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
      <div><span>Highscore</span><b>${bestScore(best) ? fmtScore(bestScore(best)) : "–"}</b>${best?.best_stage ? `<small>beste Stufe ${best.best_stage}</small>` : ""}</div>
      <div><span>Weltrang</span><b>${best?.rank ? `#${best.rank}` : "–"}</b></div>
      <div><span>Gespielt</span><b>${best?.plays ?? 0}×</b></div>
    </section>
    <button class="btn primary big" data-act="mgplay" data-game="${g.id}">▶ Spielen</button>
    <section>
      <h2 class="sec-title">Rangliste</h2>
      <div id="mg-scope">${rankScopeHtml("world")}</div>
      <div id="mg-board"><div class="empty">Lädt…</div></div>
    </section>`;
}

// ---------- Lauf ----------

export function minigameRunHtml(g: MicroGame, best: number): string {
  return `
  <div class="screen play mg-play">
    <div class="hud mg-hud">
      <button class="icon-btn quit" data-act="mgquit" aria-label="Lauf beenden">✕</button>
      <div class="mg-hud-mid"><b>${g.emoji} ${esc(g.title)}</b><span>Stufe <b id="mg-stage">1</b> · <b id="mg-score">0</b> Pkt.</span></div>
      <div class="mg-hud-best" id="mg-best">Highscore<b>${best ? fmtScore(best) : "–"}</b></div>
    </div>
    <div class="timer"><div class="timer-fill" id="timer"></div></div>
    <div class="stage-holder" id="holder"></div>
  </div>`;
}

/** „Stufe 4 ✓ +175“ – kurze Einblendung zwischen zwei Stufen (~0,6 s). */
export async function stageClear(holder: HTMLElement, stage: number, points: number, record: boolean, bonus = "") {
  const el = document.createElement("div");
  el.className = "mg-clear";
  el.innerHTML = `<b>Stufe ${stage} ✓</b><em>+${fmtScore(points)}${bonus ? ` <small>${bonus}</small>` : ""}</em>${record ? `<span>Neuer Highscore!</span>` : ""}`;
  holder.append(el);
  await sleep(600);
  el.remove();
}

// ---------- Ergebnis ----------

export interface MgResultView {
  game: MicroGame;
  stage: number;
  totalMs: number;
  score: number;
  record: boolean;
  prevBest: number;
  clanXp?: number;
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
      <div class="mg-res-kicker">${v.stage ? "Deine Punkte" : "Diesmal leider"}</div>
      <div class="mg-res-stage"><b id="mg-res-score">${fmtScore(v.score)}</b></div>
      <div class="mg-res-time">${v.stage ? `Stufe <b id="mg-res-n">${v.stage}</b> geschafft · ${fmtMs(v.totalMs)} Spielzeit` : "Stufe 0 – gleich nochmal!"}</div>
      ${v.record ? `<div class="mg-res-badge">🎉 Neuer Highscore!</div>` : v.prevBest ? `<div class="mg-res-sub">Dein Highscore: ${fmtScore(v.prevBest)}</div>` : ""}
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
    ${v.clanXp ? `<a class="mg-res-clan" href="#/clan">🛡️ <b>+${fmtScore(v.clanXp)} XP</b> für deinen Clan</a>` : ""}
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

export function minigameShareText(g: MicroGame, stage: number, score: number, link: string): string {
  return `ZWIP ${g.emoji} ${g.title}: ${fmtScore(score)} Punkte (Stufe ${stage}) – schaffst du mehr?\n${link}`;
}

export { GAME_BY_ID };
