import "./style.css";
import { dayIndex, daySeed, msUntilNextDay, makeRng, dateOfDay, hashStr } from "./rng";
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
import { GAMES, GAME_BY_ID, type Outcome, type MicroGame } from "./games";
import { buildRounds, endlessRound, roundPoints, tileOf, verdict, ROUNDS, idsForDay, GAME_IDS, type Mode, type RoundSpec } from "./run";
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
import { publicBase, CONFIG } from "./config";
import { restoreSession, currentUser, signOut, onAuthChange } from "./auth";
import { stagePoints, fmtScore, scoreFromStage } from "./score";
import { renderClan, renderClanBoard, CLAN_PERIODS, openClanInvite } from "./clanUi";
import { legalHtml, legalNavHtml, LEGAL_TITLES, type LegalPage } from "./legal";
import { openTermsGate, takeRememberedTerms, noticeHtml, accountSectionHtml, bindAccountSection } from "./accountUi";
import { renderAdmin } from "./adminUi";
import { emblemHtml } from "./clanKit";
import {
  loadMyCountry,
  selectedRegion,
  regionChipsHtml,
  bindRegionChips,
  countryHintHtml,
  bindCountryHint,
  countrySettingsHtml,
  mountCountrySettings,
  resetMyCountry,
} from "./regionUi";
import { startBadges, stopBadges, refreshBadges, friendsOpened } from "./badges";
import { TROPHY_TASKS, scoreRound, tierFor, levelFor, formatTrophies, formatDelta, leagueFee, LEAGUES, type TaskResult } from "./trophies";
import {
  startTrophyRound,
  finishTrophyRound,
  getTrophyBoard,
  refreshProfile,
  cachedProfile,
  setCachedProfile,
  onProfileChange,
  SocialError,
  getMyProfileCard,
  cachedAvatar,
  setCachedAvatar,
  startMinigameRun,
  markDailyPlayed,
  finishMinigameRun,
  getMinigameRanking,
  getPlayerClan,
  getTrophyRegionBoard,
  getMyTerms,
  acceptTerms,
  type MyTerms,
  getMyMinigameBests,
  type MyProfile,
  type MinigameBest,
  type RoundStart,
} from "./social";
import { renderPath, renderTrophyResult, renderWorldBoard, askUsername, suggestUsername, leagueUp } from "./trophyUi";
import { renderFriends } from "./friendsUi";
import { renderStart, renderAuthForm } from "./startmenu";
import { openTour, guestWallHtml, guestBannerHtml } from "./onboarding";
import { pushSettingsHtml, mountPushSettings, dropPushOnLogout } from "./push";
import { mountMyProfile, openPlayerProfile } from "./profileUi";
import { routeParts, go, shellHtml, replaceRoute, TAB_BADGES, type TabId } from "./nav";
import { renderPass, renderShop, renderCollection, mountPassCard, seasonPing, playVictory, passAfterLogin, resetPass } from "./passUi";
import {
  minigameGridHtml,
  minigameDetailHtml,
  minigameRankingHtml,
  rankScopeHtml,
  bestScore,
  type RankScope,
  minigameRunHtml,
  minigameResultHtml,
  minigameShareText,
  stageClear,
  type BestMap,
  type MgResultView,
} from "./minigameUi";
import { esc, sleep, toast, modal } from "./ui";

declare const __ZWIP_SINGLE__: boolean;

const app = document.getElementById("app")!;
let S: State = loadState();
const sfx = createSfx(S.muted, S.vibrate);

/** Gast-Modus: spielen ohne Konto (nur lokal, keine Ranglisten) */
const isGuest = () => !currentUser() && S.guest;
const canPlay = () => Boolean(currentUser()) || S.guest;
const params = new URLSearchParams(location.search);
const E2E = params.has("e2e");
const save = () => saveState(S);
const today = () => dayIndex();

interface TestHook {
  round: (Record<string, unknown> & { gameId: string }) | null;
  state: () => State;
  /** Baut ein Minispiel auf Stufe n testweise auf und wieder ab (nur für automatische Tests) */
  mountStage?: (id: string, n: number) => { limit: number };
  /** Zeigt ein Minispiel auf Stufe n bildschirmfüllend (nur für Screenshots in Tests) */
  previewStage?: (id: string, n: number) => void;
}
const hook: TestHook = { round: null, state: () => S };
if (E2E) (window as unknown as { __zwip: TestHook }).__zwip = hook;
if (E2E)
  hook.mountStage = (id, n) => {
    const el = document.createElement("div");
    el.className = "stage";
    el.style.cssText = "position:fixed;left:-9999px;top:0;width:390px;height:600px";
    document.body.append(el);
    const m = GAME_BY_ID[id].mount({ el, rng: makeRng(n * 7919), level: 0, stage: n, finish: () => {}, sfx, expose: () => {} });
    m.cleanup?.();
    el.remove();
    return { limit: m.limit };
  };
if (E2E)
  hook.previewStage = (id, n) => {
    document.querySelector(".e2e-preview")?.remove();
    const wrap = document.createElement("div");
    wrap.className = "screen play e2e-preview";
    wrap.style.cssText = "position:fixed;inset:0;z-index:99;background:var(--ink)";
    wrap.innerHTML = `<div class="hud mg-hud"><span class="icon-btn">✕</span><div class="mg-hud-mid"><b>${GAME_BY_ID[id].emoji} ${GAME_BY_ID[id].title}</b><span>Stufe <b>${n}</b></span></div><div class="mg-hud-best">Rekord<b>–</b></div></div><div class="timer"><div class="timer-fill" style="width:70%"></div></div><div class="stage-holder"><div class="stage g-${id}" style="background:${GAME_BY_ID[id].bg}"></div></div>`;
    document.body.append(wrap);
    const el = wrap.querySelector<HTMLElement>(".stage")!;
    GAME_BY_ID[id].mount({ el, rng: makeRng(n * 31), level: 0, stage: n, finish: () => {}, sfx, expose: () => {} });
  };

let roundCounter = 0;
let timers: number[] = [];
function clearTimers() {
  timers.forEach((t) => clearInterval(t));
  timers = [];
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

// ---------- Profil-Direktlinks (?p=Spielername) ----------

let pendingProfile: string | null = null;
{
  const name = params.get("p")?.trim();
  if (name) {
    if (/^[A-Za-z0-9_]{3,16}$/.test(name)) pendingProfile = name;
    else toast("Dieser Profil-Link ist kaputt 🤔");
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* in Sandbox egal */
    }
  }
}

// ---------- Clan-Einladungslinks (?clan=CODE) ----------

let pendingClan: string | null = null;
{
  const code = params.get("clan")?.trim().toUpperCase();
  if (code) {
    if (/^[A-Z0-9]{6,12}$/.test(code)) pendingClan = code;
    else toast("Dieser Clan-Link ist kaputt 🤔");
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* in Sandbox egal */
    }
  }
}

/** Nach der Anmeldung: Einladung aus einem geöffneten Clan-Link zeigen. */
function openPendingClan() {
  if (!pendingClan || !currentUser()) return;
  const code = pendingClan;
  pendingClan = null;
  void openClanInvite(code, {
    hasName: () => Boolean(myProfile?.username),
    askName: (then) => {
      if (myProfile) askName(then);
      else void loadProfile().then(() => (myProfile?.username ? then() : askName(then)));
    },
    go: (path) => navigate(path),
  });
}

/** Nach der Anmeldung: Profil aus einem geöffneten Direktlink zeigen. */
function openPendingProfile() {
  if (!pendingProfile) return;
  const name = pendingProfile;
  pendingProfile = null;
  openPlayerProfile(name, {
    hasName: () => Boolean(myProfile?.username),
    askName: (then) => {
      if (myProfile) askName(then);
      else void loadProfile().then(() => (myProfile?.username ? then() : askName(then)));
    },
    openSelf: () => navigate("profil"),
  });
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
      specs: buildRounds(daySeed(p.d!), ROUNDS, idsForDay(p.d!)),
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

// ---------- Navigation ----------

/** Läuft gerade eine Runde oder ein Minigame-Lauf? Dann beendet der Zurück-Knopf den Lauf. */
let running = false;
/** Wurde der laufende Lauf durch Navigation (Zurück-Knopf, Tab) beendet? */
let navAbort = false;
/** Letzte Tab-Route – dorthin führt „Zurück“ vom Trophäenpfad */
let lastRoute = "start";

function navigate(path: string) {
  go(path, renderRoute);
}

/** Seitengerüst mit Kopfzeile und Tab-Leiste zeichnen, liefert den Inhaltsbereich. */
function shell(tab: TabId | null, title: string, body: string, opts: { back?: string; titleHtml?: string; cls?: string; above?: string; action?: string } = {}): HTMLElement {
  clearTimers();
  const { above, ...rest } = opts;
  app.innerHTML = shellHtml({ tab, title, flame: myTrophyLabel(), streak: streakInfo(), body, ...rest });
  const page = document.getElementById("page")!;
  // Feste Leiste über dem Inhalt (z. B. Umschalter Freunde/Clan) – wird von nachladenden Seiten nicht überschrieben
  if (above) page.insertAdjacentHTML("beforebegin", above);
  // Hinweis (Gast, Sperre, Verwarnung) über dem Inhalt – Seiten, die später nachladen, überschreiben ihn so nicht
  const notice = isGuest() ? guestBannerHtml() : noticeHtml(myTerms);
  if (notice) page.insertAdjacentHTML("beforebegin", notice);
  return page;
}

/** Streak für die 🔥-Anzeige oben rechts */
function streakInfo(): { n: number; state: "none" | "risk" | "done" } {
  const t = today();
  const n = currentStreak(S, t);
  return { n, state: S.daily[t] ? "done" : n > 0 ? "risk" : "none" };
}

/** Name der Daily ohne Nummer: heute „Daily“, sonst mit Datum */
function dailyName(day: number): string {
  const t = today();
  if (day === t) return "Daily";
  if (day === t - 1) return "Daily von gestern";
  return `Daily vom ${dateOfDay(day).toLocaleDateString("de-DE", { day: "numeric", month: "short" })}`;
}

// ---------- Freunde & Clan: gemeinsamer Tab mit Umschalter ----------

let lastSocial: "freunde" | "clan" = "freunde";

function socialSegHtml(active: "freunde" | "clan"): string {
  lastSocial = active;
  const item = (id: "freunde" | "clan", icon: string, label: string) => {
    const n = TAB_BADGES[id] ?? 0;
    return `<a href="#/${id}" class="seg-btn ${id === active ? "on" : ""}" data-seg="${id}" ${id === active ? `aria-current="page"` : ""}>${icon} ${label}${n > 0 ? `<b class="seg-badge">${n > 99 ? "99+" : n}</b>` : ""}</a>`;
  };
  return `<nav class="social-seg" aria-label="Freunde oder Clan">${item("freunde", "👥", "Freunde")}${item("clan", "🛡️", "Clan")}</nav>`;
}

// ---------- Nutzungsbedingungen, Alter, Sperren ----------

let myTerms: MyTerms | null = null;

/** Nach jeder Anmeldung: Zustimmung + Alter vorhanden? Sonst nachholen. Holt auch Sperr-/Verwarn-Status und Admin-Rechte. */
async function ensureTerms() {
  try {
    let t = await getMyTerms();
    if (!t.accepted) {
      const pending = takeRememberedTerms();
      if (pending) t = await acceptTerms(pending.age, pending.parentOk).catch(() => t);
    }
    myTerms = t;
    // Profil schon offen, bevor die Rechte geladen waren → Admin-Link nachreichen
    if (t.is_admin && routeParts()[0] === "profil" && !document.querySelector('a[href="#/admin"]') && !document.querySelector(".modal-bg")) renderRoute();
    if (!t.accepted)
      openTermsGate((nt) => {
        myTerms = nt;
        maybeTour();
      });
    else if ((t.banned_until || t.warning) && !document.querySelector(".notice")) renderRoute();
  } catch {
    /* offline – beim nächsten Start nochmal */
  }
}

/** Rechtliche Seiten – funktionieren auch ohne Anmeldung */
function legalScreen(page: string | undefined) {
  const p = (page && page in LEGAL_TITLES ? page : "impressum") as LegalPage;
  const body = `${legalNavHtml(p)}${legalHtml(p)}`;
  if (canPlay()) {
    shell(null, LEGAL_TITLES[p], body, { back: isGuest() ? "profil" : "einstellungen" });
    return;
  }
  clearTimers();
  app.innerHTML = `<div class="screen legal-screen">
    <header class="topbar"><button class="icon-btn" data-act="legal-back" aria-label="Zurück">←</button><span class="mode-tag">${LEGAL_TITLES[p]}</span><span class="icon-btn ghost-slot"></span></header>
    ${body}</div>`;
  app.querySelector('[data-act="legal-back"]')!.addEventListener("click", () => {
    replaceRoute("start");
    showStart();
  });
}

/** Zeichnet den Bildschirm, der zur aktuellen Adresse (#/…) gehört. */
function renderRoute() {
  clearTimers();
  running = false;
  // Fenster schließen – außer solche, die einen Seitenwechsel überleben sollen (z. B. Clan-Einladung nach der Anmeldung)
  document.querySelectorAll(".modal-bg:not([data-keep])").forEach((m) => m.remove());
  const parts = routeParts();
  if (parts[0] !== "pfad") lastRoute = parts.join("/");
  window.scrollTo(0, 0);
  if (isGuest()) {
    const wall: Record<string, string> = { freunde: "Freunde", clan: "Clans", admin: "Moderation", pfad: "Der Trophäen-Modus", pass: "Der Season Pass", shop: "Der Shop", sammlung: "Deine Sammlung" };
    const w = wall[parts[0]] ?? (parts[0] === "ranglisten" && parts[1] !== "crew" ? "Die Rangliste" : "");
    if (w) {
      const tab: TabId = parts[0] === "freunde" ? "freunde" : parts[0] === "clan" ? "clan" : parts[0] === "ranglisten" ? "ranglisten" : "spielen";
      if (parts[0] === "ranglisten") shell(tab, "Ranglisten", segHtml(["welt", "minigames", "clans"].includes(parts[1]) ? parts[1] : "welt") + guestWallHtml(w));
      else shell(tab, w.replace(/^(Der|Die) /, ""), guestWallHtml(w));
      return;
    }
    if (parts[0] === "profil") return guestProfileScreen();
  }
  switch (parts[0]) {
    case "spielen":
      return startScreen();
    case "social":
      replaceRoute(lastSocial);
      return renderRoute();
    case "einstellungen":
      return isGuest() ? guestProfileScreen() : settingsScreen();
    case "minigames":
      return parts[1] && GAME_BY_ID[parts[1]] ? minigameDetailScreen(parts[1]) : minigamesScreen();
    case "ranglisten":
      return void boardsScreen(parts[1], parts[2]);
    case "freunde":
      friendsOpened();
      return friendsScreen();
    case "clan":
      return clanScreen(parts[1], parts[2]);
    case "rechtliches":
      return legalScreen(parts[1]);
    case "admin":
      return void renderAdmin(shell(null, "Moderation", "", { back: "profil" }), parts[1], (path) => navigate(path), parts[2], parts[3]);
    case "profil":
      return profileScreen();
    case "pass":
      return void renderPass(shell("start", "Season Pass", "", { back: "start", cls: "sp-shell" }), myProfile?.username ?? undefined);
    case "shop":
      return void renderShop(shell("start", "Shop", "", { back: "start", cls: "sp-shell" }));
    case "sammlung":
      return void renderCollection(
        shell("profil", "Sammlung", "", { back: "profil", cls: "sp-shell" }),
        { name: myProfile?.username ?? undefined, avatar: cachedAvatar(currentUser()?.id) },
        parts[1],
      );
    case "pfad":
      return void openPath();
    default:
      return startScreen();
  }
}

/** Nach jedem Seitenwechsel auch die Badges auffrischen (gedrosselt). */
window.addEventListener("hashchange", () => void (currentUser() && refreshBadges()));

window.addEventListener("hashchange", () => {
  if (!canPlay()) {
    // Ohne Anmeldung: nur die rechtlichen Seiten
    if (routeParts()[0] === "rechtliches") legalScreen(routeParts()[1]);
    return;
  }
  if (running) {
    // Zurück-Knopf während eines Laufs: Lauf beenden, danach wird die neue Seite gezeigt
    navAbort = true;
    aborted = true;
    return;
  }
  renderRoute();
});

// ---------- Start ----------

function startScreen() {
  const t = today();
  const played = S.daily[t];

  let main: string;
  if (pending) {
    main = `<div class="duel-card pop-in">
        <div class="duel-ico">⚔️</div>
        <div><b>${esc(pending.n)}</b> fordert dich heraus<br><span class="muted">${sumPoints(pending.r)} Punkte · ${pending.m === "d" ? dailyName(pending.d!) : "Training"}</span></div>
      </div>
      <button class="play-btn" data-act="duel"><span class="play-ico">⚔️</span><span><b>Duell starten</b><small>Gleiche Runde. Wer holt mehr?</small></span></button>`;
  } else if (played) {
    main = `<div class="done-card">
        <div class="done-top"><span>Daily von heute ✅</span><b>${played.score}</b></div>
        ${miniGrid(played.rounds)}
        <div class="done-actions">
          <button class="btn primary sm" data-act="share-today">Teilen 📤</button>
          <button class="btn sm" data-act="challenge-today">Duell ⚔️</button>
        </div>
        <div class="muted next">Neue Daily in <b id="countdown">${fmtCountdown(msUntilNextDay())}</b></div>
      </div>`;
  } else {
    main = `<button class="play-btn" data-act="daily"><span class="play-ico">▶</span><span><b>Daily spielen</b><small>10 Blitz-Aufgaben · für alle gleich · jeden Tag neu</small></span></button>`;
  }

  shell(
    "start",
    "Spielen",
    `
    <section class="start-main">${main}</section>
    ${isGuest() ? "" : `<section class="sp-start" id="sp-start"></section>`}
    <section class="week-wrap">
      <div class="week-head"><h2 class="sec-title">Diese Woche</h2></div>
      <div class="week" aria-label="Diese Woche">${weekStrip(t)}</div>
    </section>
    <section class="more-modes">
      <h2 class="sec-title">Weitere Modi</h2>
      <div class="mode-list">
        ${modeCard({ act: "tmode", icon: "🏆", title: "Trophäen-Modus", desc: "15 Aufgaben – sammle Trophäen und steig in den Ligen auf.", meta: `<b>${myTrophyLabel()}</b>`, cls: "c-trophy" })}
        ${modeCard({ href: "#/minigames", icon: "🎮", title: "Minigames", desc: "Ein Spiel, Stufe für Stufe schwerer.", meta: `<em class="tag lime">${GAMES.length}</em>`, cls: "c-mini" })}
        ${modeCard({ act: "free", icon: "🏋️", title: "Training", desc: "10 zufällige Aufgaben, so oft du willst.", meta: S.best.free ? `Best <b>${S.best.free}</b>` : "" })}
        ${modeCard({ act: "endless", icon: "♾️", title: "Endlos", desc: "Bis zum ersten Fehler.", meta: S.best.endless ? `Best <b>${S.best.endless}</b>` : "" })}
      </div>
    </section>`,
    { titleHtml: `<span class="logo small" aria-label="ZWIP"><span>Z</span><span>W</span><span>I</span><span>P</span></span>` },
  );

  const spStart = document.getElementById("sp-start");
  if (spStart) void mountPassCard(spStart);

  if (played && !pending) {
    timers.push(
      window.setInterval(() => {
        const el = document.getElementById("countdown");
        if (!el) return;
        const ms = msUntilNextDay();
        if (ms < 1000 || today() !== t) renderRoute();
        else el.textContent = fmtCountdown(ms);
      }, 1000),
    );
  }
}

// ---------- Spielen ----------

function modeCard(o: { act?: string; href?: string; icon: string; title: string; desc: string; meta: string; cls?: string }): string {
  const inner = `<span class="mc-ico" aria-hidden="true">${o.icon}</span>
      <span class="mc-text"><b>${o.title}</b><small>${o.desc}</small></span>
      <span class="mc-meta">${o.meta}</span>
      <i class="mc-go" aria-hidden="true">›</i>`;
  return o.href
    ? `<a class="mode-card ${o.cls ?? ""}" href="${o.href}">${inner}</a>`
    : `<button class="mode-card ${o.cls ?? ""}" data-act="${o.act}">${inner}</button>`;
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

/**
 * Automatische Tests: Erklärkarte startet nach ?explain=ms von selbst (Standard 400 ms), damit die Test-Bots nicht
 * jedes Mal tippen müssen. Mit ?explain=manual verhält sie sich wie für echte Spieler. Echte Spieler: nie von selbst.
 */
const AUTO_EXPLAIN = E2E && params.get("explain") !== "manual" ? Number(params.get("explain") ?? 400) : 0;

async function showIntro(holder: HTMLElement, spec: RoundSpec, label: string) {
  return explainGame(holder, GAME_BY_ID[spec.gameId], label);
}

/**
 * Erklärkarte vor jeder Aufgabe (alle Modi und Minigames): Die Aufgabe startet erst, wenn man auf „Los!“ tippt –
 * keine ablaufende Zeit davor. Abbrechen (✕) beendet sie sofort.
 */
async function explainGame(holder: HTMLElement, g: MicroGame, label: string) {
  const intro = document.createElement("div");
  intro.className = "intro explain";
  intro.style.background = g.bg;
  intro.setAttribute("role", "dialog");
  intro.setAttribute("aria-label", `So geht ${g.title}`);
  intro.innerHTML = `
    <div class="intro-round">${label}</div>
    <div class="intro-emoji">${g.emoji}</div>
    <div class="intro-title">${g.title}</div>
    <p class="explain-text">${g.howto}</p>
    <div class="intro-hint">💡 ${g.hint}</div>
    <button class="explain-ok" type="button">Los! ⚡</button>
    <div class="explain-count" aria-live="polite"><b>Die Zeit läuft erst, wenn du tippst.</b></div>`;
  holder.replaceChildren(intro);
  sfx.tick();
  const ok = intro.querySelector<HTMLButtonElement>(".explain-ok")!;
  ok.focus({ preventScroll: true });
  const t0 = performance.now();
  await new Promise<void>((res) => {
    let iv = 0;
    const done = () => {
      clearInterval(iv);
      res();
    };
    ok.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      done();
    });
    ok.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        done();
      }
    });
    iv = window.setInterval(() => {
      if (aborted || (AUTO_EXPLAIN && performance.now() - t0 >= AUTO_EXPLAIN)) done();
    }, 50);
  });
  if (aborted) return;
  ok.disabled = true;
  ok.classList.add("go");
  intro.querySelector(".explain-count")!.classList.add("hidden");
  sfx.zwip();
  await sleep(220);
}

interface RoundResult extends Outcome {
  points: number;
  /** Antwortzeit ab Ende der Vorbereitungsphase (ms) */
  elapsed: number;
  timeout: boolean;
  /** Bei Fehler/Zeitablauf wurde die richtige Lösung markiert → etwas länger zeigen */
  solution?: boolean;
}

/**
 * Spielt eine Aufgabe. Ablauf:
 *   1. Aufgabe erscheint vollständig.
 *   2. Vorbereitungsphase (game.prep ms): Eingaben werden abgefangen, keine Zeitmessung.
 *   3. Erst danach startet die Antwortzeit (t0) und der Countdown.
 * Spiele mit eigener Vorlaufphase (Reaktionstest, Takt, Memory) haben prep = 0.
 */
function playRound(holder: HTMLElement, spec: RoundSpec): Promise<RoundResult> {
  const g = GAME_BY_ID[spec.gameId];
  const stage = document.createElement("div");
  stage.className = `stage g-${g.id}`;
  stage.style.background = g.bg;
  holder.replaceChildren(stage);
  const timer = document.getElementById("timer")!;
  return new Promise((resolve) => {
    let done = false;
    let unlocked = false;
    let timedOut = false;
    let limit = 3000;
    let cleanup: (() => void) | undefined;
    let t0 = 0;
    let timeout = 0;
    let prepTimer = 0;
    let exposed: Record<string, unknown> | null = null;
    const blockKeys = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    /** Markiert bei Fehler oder Zeitablauf die richtige Lösung (jedes Spiel, das ein „target“ hat). */
    const revealSolution = (): boolean => {
      if (!exposed) return false;
      let t = exposed.target as unknown;
      if (typeof t === "function") t = (t as () => unknown)();
      const els = [t, ...((exposed.solutionAlso as unknown[]) ?? [])].filter((e): e is HTMLElement => e instanceof HTMLElement);
      els.forEach((e) => e.classList.add("solution"));
      return els.length > 0;
    };
    const finish = (o: Outcome) => {
      if (done || !unlocked) return; // Eingaben während der Vorbereitung zählen nicht
      done = true;
      clearTimeout(timeout);
      const elapsed = performance.now() - t0;
      const solution = !o.ok && revealSolution();
      cleanup?.();
      hook.round = null;
      timer.style.transition = "none";
      timer.style.width = getComputedStyle(timer).width;
      resolve({ ...o, points: roundPoints(o.ok, elapsed, limit, o.rating), elapsed, timeout: timedOut, solution });
    };
    const mounted = g.mount({
      el: stage,
      rng: makeRng(spec.seed),
      level: spec.level,
      stage: spec.stage,
      finish: (o) => {
        if (aborted) return;
        finish(o);
      },
      sfx,
      expose: (info) => (exposed = info),
    });
    limit = mounted.limit;
    cleanup = mounted.cleanup;
    const timerBox = timer.parentElement!;
    timerBox.classList.toggle("hidden", Boolean(mounted.hideTimer));

    const unlock = () => {
      if (done) return;
      unlocked = true;
      window.removeEventListener("keydown", blockKeys, true);
      holder.querySelector(".prep-shield")?.remove();
      stage.classList.remove("prepping");
      timerBox.classList.remove("prep");
      t0 = performance.now(); // ← ab hier zählt die Antwortzeit
      timer.style.transition = "none";
      timer.style.width = "100%";
      void timer.offsetWidth;
      timer.style.transition = `width ${limit}ms linear`;
      timer.style.width = "0%";
      timeout = window.setTimeout(() => {
        timedOut = true;
        finish({ ok: false, reason: "Zu langsam ⏰" });
      }, limit);
      if (E2E && exposed) hook.round = { ...exposed, gameId: g.id, n: ++roundCounter };
    };

    const prep = g.prep;
    if (prep > 0) {
      stage.classList.add("prepping");
      const shield = document.createElement("div");
      shield.className = "prep-shield";
      shield.innerHTML = `<span class="prep-pill">👀 Schau genau…</span>`;
      holder.append(shield);
      window.addEventListener("keydown", blockKeys, true);
      timerBox.classList.add("prep");
      timer.style.transition = "none";
      timer.style.width = "0%";
      void timer.offsetWidth;
      timer.style.transition = `width ${prep}ms linear`;
      timer.style.width = "100%";
      prepTimer = window.setTimeout(unlock, prep);
    } else {
      unlock();
    }

    const abortCheck = window.setInterval(() => {
      if (done) return clearInterval(abortCheck);
      if (aborted) {
        clearInterval(abortCheck);
        clearTimeout(prepTimer);
        window.removeEventListener("keydown", blockKeys, true);
        unlocked = true;
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
  await sleep(r.ok ? 520 : r.solution ? 1400 : 900);
}

async function startRun(mode: Mode, opts: RunOpts = {}) {
  clearTimers();
  sfx.unlock();
  aborted = false;
  navAbort = false;
  running = true;
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
      if (aborted) return renderRoute();
      const r = await playRound(holder, spec);
      if (aborted) return renderRoute();
      rounds.push(r.points);
      if (r.ok) {
        total += r.points;
        countUp(document.getElementById("score")!, total, 300);
      }
      await feedback(holder, r);
      if (!r.ok) break;
    }
    running = false;
    const isBest = total > S.best.endless;
    S.best.endless = Math.max(S.best.endless, total);
    save();
    return results({ mode, seed, rounds, specs, endlessBest: isBest });
  }

  // Dailies (auch als Duell) mit den Challenges ihres Tages, Training mit allen
  let ids: readonly string[] = day !== undefined ? idsForDay(day) : GAME_IDS;
  if (E2E && params.get("only")) ids = params.get("only")!.split(",").filter((id) => GAME_BY_ID[id]);
  const list = buildRounds(seed, ROUNDS, ids);
  specs.push(...list);
  playScreen(mode, ROUNDS);
  const holder = document.getElementById("holder")!;
  for (let i = 0; i < list.length; i++) {
    const spec = list[i];
    await showIntro(holder, spec, `${i + 1} / ${ROUNDS}`);
    if (aborted) return renderRoute();
    const r = await playRound(holder, spec);
    if (aborted) return renderRoute();
    rounds.push(r.points);
    total += r.points;
    const dot = document.querySelector(`[data-dot="${i}"]`);
    dot?.classList.add(`t-${tileOf(r.points)}`);
    countUp(document.getElementById("score")!, total, 300);
    await feedback(holder, r);
  }

  running = false;
  const result: DayResult = { score: total, rounds };
  if (mode === "daily") {
    recordDaily(S, t, result);
    // Server weiß dann: heute keine Erinnerung mehr nötig
    if (currentUser()) void markDailyPlayed(t, currentStreak(S, t)).then(() => seasonPing(1600)).catch(() => {});
  } else if (mode === "free") {
    S.best.free = Math.max(S.best.free, total);
  }
  if (opts.vs && opts.vs.m === "d") {
    addCrewResult(S, opts.vs.i, opts.vs.n, opts.vs.d!, { score: sumPoints(opts.vs.r), rounds: opts.vs.r });
  }
  if (opts.vs) pending = null;
  save();
  results({ mode, day, seed, rounds, specs, vs: opts.vs });
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
      ? `${dailyName(d.day)}${d.day !== t ? " (Duell)" : ""}`
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
      playVictory();
    }
  }, 1000);

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

// ---------- Ranglisten ----------

let mgBests: BestMap | null = null;

async function loadMgBests(): Promise<BestMap | null> {
  if (isGuest()) {
    mgBests = new Map(Object.entries(S.guestBests).map(([game, b]) => [game, { game, best_score: b.score, best_stage: b.stage, best_ms: b.ms, plays: b.plays, rank: null }]));
    return mgBests;
  }
  try {
    const list = await getMyMinigameBests();
    mgBests = new Map(list.map((b) => [b.game, b]));
  } catch {
    /* ohne Netz: alte Werte behalten */
  }
  return mgBests;
}

function segHtml(active: string): string {
  const seg = [
    ["welt", "Trophäen"],
    ["minigames", "Minigames"],
    ["clans", "Clans"],
    ["crew", "Crew (Daily)"],
  ];
  return `<nav class="seg seg-4" aria-label="Rangliste wählen">${seg
    .map(([id, label]) => `<a href="#/ranglisten/${id}" class="${id === active ? "on" : ""}"${id === active ? ` aria-current="page"` : ""}>${label}</a>`)
    .join("")}</nav>`;
}

function openPlayer(name: string) {
  openPlayerProfile(name, {
    hasName: () => Boolean(myProfile?.username),
    askName: (then) => askName(then),
    openSelf: () => navigate("profil"),
  });
}

async function boardsScreen(sub = "welt", gameId?: string) {
  if (!["welt", "minigames", "clans", "crew"].includes(sub)) sub = "welt";
  const t = today();

  if (sub === "clans") {
    const per = gameId && CLAN_PERIODS.some(([k]) => k === gameId) ? gameId : "week";
    const page = shell(
      "ranglisten",
      "Ranglisten",
      `${segHtml(sub)}
      <div class="chips" role="tablist" aria-label="Zeitraum">${CLAN_PERIODS.map(
        ([k, l]) => `<a href="#/ranglisten/clans/${k}" class="chip ${k === per ? "on" : ""}" role="tab" aria-selected="${k === per}">${l}</a>`,
      ).join("")}</div>
      <div id="list"></div>
      <a class="btn ghost" href="#/clan">🛡️ Mein Clan</a>`,
    );
    void renderClanBoard(page.querySelector<HTMLElement>("#list")!, per, { go: (path) => navigate(path) });
    return;
  }

  if (sub === "crew") {
    const page = shell(
      "ranglisten",
      "Ranglisten",
      `${segHtml(sub)}
      <p class="page-intro muted">Daily von heute – alle, deren Duell-Links du gespielt hast.</p>
      <div id="list" class="list"></div>
      <section class="add-card">
        <h2 class="sec-title">Crew erweitern</h2>
        <p class="muted">Schick deinen Duell-Link rum. Wer ihn spielt, schickt dir seinen zurück – und landet hier.</p>
        <button class="btn primary sm" data-act="${S.daily[t] ? "challenge-today" : "daily"}">${S.daily[t] ? "Duell-Link teilen ⚔️" : "Erst Daily spielen ▶"}</button>
        <div class="row"><input id="paste" placeholder="Link oder Code einfügen" autocomplete="off" aria-label="Duell-Link oder Code"><button class="btn sm" data-act="paste">Rein</button></div>
      </section>`,
    );
    const list = page.querySelector<HTMLElement>("#list")!;
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
          .join("") + (crewCount ? `<p class="muted center">${crewCount} in deiner Crew</p>` : "")
      : `<div class="empty">Heute noch niemand hier.<br>Spiel die Daily und fordere jemanden heraus!</div>`;
    return;
  }

  if (sub === "minigames") {
    const id = gameId && GAME_BY_ID[gameId] ? gameId : "memory";
    const g = GAME_BY_ID[id];
    const page = shell(
      "ranglisten",
      "Ranglisten",
      `${segHtml(sub)}
      <div class="chips" role="tablist" aria-label="Minigame wählen">${GAMES_ORDER.map(
        (x) =>
          `<a href="#/ranglisten/minigames/${x.id}" class="chip ${x.id === id ? "on" : ""}" role="tab" aria-selected="${x.id === id}"><span aria-hidden="true">${x.emoji}</span>${esc(x.title)}</a>`,
      ).join("")}</div>
      <div class="board-head"><h2 class="sec-title">${g.emoji} ${esc(g.title)}</h2><a class="link-btn" href="#/minigames/${id}">Spielen ›</a></div>
      <div id="mg-scope">${rankScopeHtml(mgScope)}</div>
      <div id="list"><div class="empty">Lädt…</div></div>`,
    );
    page.querySelector(".chip.on")?.scrollIntoView({ block: "nearest", inline: "center" });
    mountRanking(page.querySelector<HTMLElement>("#mg-scope")!, page.querySelector<HTMLElement>("#list")!, id);
    return;
  }

  // Trophäen-Rangliste – weltweit oder für ein Land, kommt immer aus der Datenbank
  const page = shell(
    "ranglisten",
    "Ranglisten",
    `${segHtml(sub)}<div id="country-hint"></div><div id="region"></div><div id="list" class="list"><div class="empty">Lädt…</div></div>`,
  );
  const list = page.querySelector<HTMLElement>("#list")!;
  const regionEl = page.querySelector<HTMLElement>("#region")!;
  const hintEl = page.querySelector<HTMLElement>("#country-hint")!;
  await loadMyCountry();
  if (!list.isConnected) return;
  hintEl.innerHTML = countryHintHtml();
  bindCountryHint(hintEl, () => renderRoute());
  const load = async (region: string) => {
    regionEl.innerHTML = regionChipsHtml(region);
    list.innerHTML = `<div class="empty">Lädt…</div>`;
    try {
      const b = region === "world" ? await getTrophyBoard(100) : await getTrophyRegionBoard(region, 100);
      if (!list.isConnected || region !== selectedRegion()) return;
      renderWorldBoard(list, { ...b, country: region === "world" ? null : region }, { onSetName: () => askName(() => renderRoute()) });
    } catch (e) {
      if (list.isConnected) list.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    }
  };
  bindRegionChips(regionEl, (r) => void load(r));
  void load(selectedRegion());
}

// ---------- Freunde ----------

function clanScreen(sub?: string, arg?: string) {
  const page = sub === "c" ? shell("clan", "Clan", "", { back: "ranglisten/clans" }) : shell("clan", "Freunde & Clan", "", { above: socialSegHtml("clan") });
  void renderClan(page, sub, arg, {
    hasName: () => Boolean(myProfile?.username),
    askName: (then) => askName(then),
    openPlayer: (n) => openPlayer(n),
    rerender: () => renderRoute(),
    go: (path) => navigate(path),
    every: (ms, fn) => timers.push(window.setInterval(fn, ms)),
    refreshBadges: () => void refreshBadges(true),
    publicBase: () => publicBase(),
    share: (t) => doShare(t),
  });
}

function friendsScreen() {
  const page = shell("freunde", "Freunde & Clan", "", { above: socialSegHtml("freunde") });
  renderFriends(page, {
    hasName: () => Boolean(myProfile?.username),
    askName: (then) => askName(then),
  });
  if (!myProfile) void loadProfile().then(() => document.querySelector(".friends") && routeParts()[0] === "freunde" && !myProfile?.username && renderRoute());
}

// ---------- Profil (mit Einstellungen) ----------

function profileScreen() {
  const uid = currentUser()?.id;
  const p = myProfile ?? cachedProfile(uid);
  const page = shell(
    "profil",
    "Profil",
    `<div class="pf" id="pf-root" aria-busy="true"><div class="empty">Lädt…</div></div>
    <section class="card-sec sp-profile-links">
      <h2 class="sec-title">Season Pass & Sammlung</h2>
      <div class="pf-list">
        <a class="pf-row" href="#/pass"><span aria-hidden="true">⭐</span><b>Season Pass</b><i aria-hidden="true">›</i></a>
        <a class="pf-row" href="#/sammlung"><span aria-hidden="true">🎒</span><b>Sammlung – Skins, Rahmen & mehr ausrüsten</b><i aria-hidden="true">›</i></a>
        <a class="pf-row" href="#/shop"><span aria-hidden="true">🛒</span><b>Shop</b><i aria-hidden="true">›</i></a>
      </div>
    </section>
    <a class="settings-link" href="#/einstellungen">
      <span class="sl-ico" aria-hidden="true">⚙️</span>
      <span class="sl-text"><b>Einstellungen</b><small>Ton, Vibration, Erinnerungen, Land, deine Daten</small></span>
      <i class="mc-go" aria-hidden="true">›</i>
    </a>`,
    { action: `<a class="icon-btn gear-btn" href="#/einstellungen" aria-label="Einstellungen">⚙️</a>` },
  );
  mountMyProfile(page.querySelector<HTMLElement>("#pf-root")!, {
    email: currentUser()?.email ?? "",
    initial: p ? { ...p, avatar: cachedAvatar(uid) } : null,
    onAvatar: (a) => setCachedAvatar(currentUser()?.id, a),
    onRename: (then) => askName(then),
    onSignOut: async () => {
      await dropPushOnLogout().catch(() => {});
      await signOut();
      toast("Du bist abgemeldet 👋");
    },
  });
}

/** Einstellungen: alles, was man einstellt, an einem Ort – sortiert nach Themen */
function settingsScreen() {
  const page = shell(
    "profil",
    "Einstellungen",
    `<section class="card-sec settings">
      <h2 class="sec-title">Spiel</h2>
      ${soundTogglesHtml()}
      <label class="lbl" for="set-name">Name für Duell-Links</label>
      <div class="row"><input id="set-name" maxlength="20" value="${esc(S.name)}" autocomplete="nickname"><button class="btn sm" id="set-save" type="button">Speichern</button></div>
    </section>
    ${pushSettingsHtml()}
    ${countrySettingsHtml()}
    ${accountSectionHtml(Boolean(myTerms?.is_admin))}
    <section class="card-sec how">
      <h2 class="sec-title">So geht ZWIP</h2>
      <p>Jeden Tag gibt es eine Daily mit 10 Blitz-Aufgaben – für alle gleich. Vor jeder Aufgabe kommt eine kurze Erklärung, los geht's erst, wenn du auf „Los“ tippst. Schnell + richtig = mehr Punkte (max. 1000).</p>
      <p>Im Trophäen-Modus sammelst du Trophäen für die Weltrangliste, bei den Minigames spielst du ein Spiel Stufe für Stufe – mit eigener Rangliste.</p>
      <p class="muted">Keine Werbung, keine Lootboxen.</p>
    </section>`,
    { back: "profil" },
  );
  void mountCountrySettings(page);
  void mountPushSettings(page);
  bindAccountSection(page, () => showStart());
  page.querySelector("#set-save")!.addEventListener("click", () => {
    const n = page.querySelector<HTMLInputElement>("#set-name")!.value.trim();
    if (n) {
      S.name = n.slice(0, 20);
      S.nameSet = true;
      save();
      toast("Name gespeichert ✓");
    }
  });
  bindSoundToggles(page);
}

function soundTogglesHtml(): string {
  const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  return `<label class="toggle"><input type="checkbox" id="set-sound" ${S.muted ? "" : "checked"}> Ton an <button class="link-btn inline" type="button" id="set-jingle">🔊 ZWIP-Sound anhören</button></label>
      <label class="toggle"><input type="checkbox" id="set-vibrate" ${S.vibrate ? "checked" : ""} ${canVibrate ? "" : "disabled"}> Vibration an${canVibrate ? "" : ` <small class="muted">(auf diesem Gerät nicht möglich)</small>`}</label>`;
}

function bindSoundToggles(page: HTMLElement) {
  page.querySelector("#set-jingle")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (S.muted) return toast("Erst den Ton anschalten 🔇");
    sfx.unlock();
    sfx.jingle();
  });
  page.querySelector<HTMLInputElement>("#set-sound")?.addEventListener("change", (e) => {
    S.muted = !(e.target as HTMLInputElement).checked;
    sfx.setMuted(S.muted);
    save();
  });
  page.querySelector<HTMLInputElement>("#set-vibrate")?.addEventListener("change", (e) => {
    S.vibrate = (e.target as HTMLInputElement).checked;
    sfx.setVibrate(S.vibrate);
    save();
    if (S.vibrate) navigator.vibrate?.(40);
  });
}

/** Profil im Gast-Modus: Einstellungen + Konto erstellen */
function guestProfileScreen() {
  const page = shell(
    "profil",
    "Profil",
    `${guestWallHtml("Ein eigenes Profil")}
    <section class="card-sec settings">
      <h2 class="sec-title">Einstellungen</h2>
      ${soundTogglesHtml()}
    </section>
    <section class="card-sec">
      <button class="btn sm ghost" type="button" data-act="guest-exit">Gast-Modus beenden</button>
      <nav class="legal-links"><a href="#/rechtliches/impressum">Impressum</a> · <a href="#/rechtliches/datenschutz">Datenschutz</a> · <a href="#/rechtliches/regeln">Nutzungsbedingungen</a></nav>
    </section>`,
  );
  bindSoundToggles(page);
}

// ---------- Einführung beim ersten Öffnen ----------

const TOUR_KEY = "zwip:tour";
function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === "1";
  } catch {
    return true;
  }
}
function maybeTour() {
  if (tourSeen()) return;
  const markSeen = () => {
    try {
      localStorage.setItem(TOUR_KEY, "1");
    } catch {
      /* egal */
    }
  };
  // Wer schon gespielt hat, kennt die App
  if (S.plays > 0 || Object.keys(S.daily).length) return markSeen();
  if (document.querySelector(".modal-bg")) return; // z. B. Zustimmungs-Fenster offen – später nochmal
  openTour(markSeen);
}

// ---------- Minigames ----------

const GAMES_ORDER = Object.values(GAME_BY_ID);

/** Zuletzt gewählte Minigame-Rangliste (Welt / Freunde / Clan) */
let mgScope: RankScope = "world";

/** Minigame-Rangliste mit Umschalter Welt / Freunde / Clan – bei „Welt“ zusätzlich die Region (weltweit oder ein Land) */
function mountRanking(scopeEl: HTMLElement, listEl: HTMLElement, id: string) {
  const regionEl = document.createElement("div");
  regionEl.className = "mg-region";
  scopeEl.after(regionEl);
  const load = async () => {
    scopeEl.innerHTML = rankScopeHtml(mgScope);
    const region = mgScope === "world" ? selectedRegion() : "world";
    regionEl.innerHTML = mgScope === "world" ? regionChipsHtml(region) : "";
    listEl.innerHTML = `<div class="empty">Lädt…</div>`;
    const want = mgScope === "world" && region !== "world" ? region : mgScope;
    try {
      const r = await getMinigameRanking(id, want, 50);
      const now = mgScope === "world" && selectedRegion() !== "world" ? selectedRegion() : mgScope;
      if (!listEl.isConnected || want !== now) return;
      listEl.innerHTML = minigameRankingHtml(r);
      listEl.querySelectorAll<HTMLElement>("[data-player]").forEach((el) => el.addEventListener("click", () => openPlayer(el.dataset.player!)));
    } catch (e) {
      if (listEl.isConnected) listEl.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    }
  };
  scopeEl.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-scope]");
    if (!b || b.dataset.scope === mgScope) return;
    mgScope = b.dataset.scope as RankScope;
    void load();
  });
  bindRegionChips(regionEl, () => void load());
  void loadMyCountry().then(() => load());
}

function minigamesScreen() {
  const page = shell("spielen", "Minigames", `<p class="page-intro muted">Such dir ein Spiel aus. Jede Stufe wird schwerer – ein Fehler und der Lauf ist vorbei.</p><div id="mg-grid">${minigameGridHtml(mgBests)}</div>`, { back: "start" });
  void loadMgBests().then((b) => {
    const grid = page.querySelector("#mg-grid");
    if (grid?.isConnected && b) grid.innerHTML = minigameGridHtml(b);
  });
}

function minigameDetailScreen(id: string) {
  const g = GAME_BY_ID[id];
  const page = shell("spielen", g.title, minigameDetailHtml(g, mgBests?.get(id)), { back: "minigames" });
  if (isGuest()) {
    const board = page.querySelector<HTMLElement>("#mg-board");
    page.querySelector("#mg-scope")?.remove();
    if (board) board.innerHTML = guestWallHtml("Die Rangliste");
    return;
  }
  mountRanking(page.querySelector<HTMLElement>("#mg-scope")!, page.querySelector<HTMLElement>("#mg-board")!, id);
  void loadMgBests().then((b) => {
    const best = b?.get(id);
    const stats = page.querySelector(".mg-stats");
    if (stats?.isConnected && best) stats.outerHTML = minigameDetailHtml(g, best).match(/<section class="mg-stats"[\s\S]*?<\/section>/)![0];
  });
}

/** Ergebnis eines Laufs, das noch an den Server muss (für „Nochmal senden“) */
let mgPending: { runId: string; game: string; stage: number; totalMs: number; steps: { ok: boolean; ms: number; t: number }[]; view: MgResultView } | null = null;
let mgLast: { game: string; stage: number; score: number } | null = null;

async function startMinigame(id: string) {
  const g = GAME_BY_ID[id];
  if (!g) return;
  clearTimers();
  sfx.unlock();
  aborted = false;
  navAbort = false;
  running = true;
  const prevBest = bestScore(mgBests?.get(id));
  app.innerHTML = minigameRunHtml(g, prevBest);
  const holder = document.getElementById("holder")!;

  // Lauf beim Server anmelden (liefert den Seed). Ohne Netz wird trotzdem gespielt, aber nicht gewertet.
  const guestRun = isGuest();
  const runP = guestRun ? Promise.resolve(null) : startMinigameRun(id).catch((e: unknown) => e);
  await explainGame(holder, g, prevBest ? `Minigame · Highscore: ${fmtScore(prevBest)}` : "Minigame · Stufe 1");
  const run = await runP;
  const runId = run && typeof run === "object" && "run_id" in run ? (run as { run_id: string; seed: number }) : null;
  const seed = runId?.seed ?? (Math.random() * 2 ** 31) >>> 0;

  const steps: { ok: boolean; ms: number; t: number }[] = [];
  let stage = 0;
  let totalMs = 0;
  let score = 0;
  let recordShown = false;
  for (let n = 1; !aborted; n++) {
    document.getElementById("mg-stage")!.textContent = String(n);
    const spec: RoundSpec = { gameId: id, seed: hashStr(`${seed}:mg:${n}`), level: 0, stage: n };
    const r = await playRound(holder, spec);
    if (aborted) break;
    const ms = Math.max(0, Math.round(r.elapsed));
    // Tempo-Wert für den Bonus: was das Spiel selbst misst (z. B. Abweichung beim Stapelturm), sonst die Antwortzeit
    const t = Math.max(0, Math.round(r.ms ?? r.elapsed));
    if (!r.ok) {
      steps.push({ ok: false, ms, t });
      sfx.bad();
      shake(holder);
      (holder.firstElementChild as HTMLElement | null)?.classList.add("done-fail");
      floatText(holder, r.reason || "Vorbei!", "fail");
      await sleep(r.solution ? 1400 : 1000);
      break;
    }
    steps.push({ ok: true, ms, t });
    totalMs += ms;
    stage = n;
    const pts = stagePoints(n, t, g.speed);
    score += pts;
    const scoreEl = document.getElementById("mg-score");
    if (scoreEl) scoreEl.textContent = fmtScore(score);
    (holder.firstElementChild as HTMLElement | null)?.classList.add("done-ok");
    sfx.good(90);
    const record = score > prevBest && !recordShown && prevBest > 0;
    if (record) {
      recordShown = true;
      document.getElementById("mg-best")?.classList.add("beaten");
    }
    if (score > prevBest) {
      const b = document.getElementById("mg-best");
      if (b) b.innerHTML = `Highscore<b>${fmtScore(score)}</b>`;
    }
    const bonus = t <= g.speed.veryFast ? "⚡ +50 %" : t <= g.speed.fast ? "+25 %" : "";
    await stageClear(holder, n, pts, record, bonus);
  }
  running = false;
  const leftByNav = navAbort;
  navAbort = false;
  aborted = false;
  mgLast = { game: id, stage, score };

  const view: MgResultView = { game: g, stage, totalMs, score, record: score > prevBest, prevBest, rank: null, totalPlayers: null, saving: Boolean(runId) };
  if (guestRun) {
    // Gast: Highscore nur auf diesem Gerät merken
    const old = S.guestBests[id] ?? { score: 0, stage: 0, ms: 0, plays: 0 };
    const rec = score > old.score;
    S.guestBests[id] = { score: rec ? score : old.score, stage: rec ? stage : Math.max(old.stage, stage), ms: rec ? totalMs : old.ms, plays: old.plays + 1 };
    save();
    void loadMgBests();
    view.guest = true;
    view.saving = false;
    if (!leftByNav) showMinigameResult(view);
    else renderRoute();
    return;
  }
  if (!runId) {
    view.error = "Keine Verbindung beim Start – dieser Lauf zählt nicht für die Rangliste.";
    view.saving = false;
  }
  if (!leftByNav) showMinigameResult(view);
  else renderRoute();
  if (!runId) return;
  mgPending = { runId: runId.run_id, game: id, stage, totalMs, steps, view };
  await submitMinigame(!leftByNav);
}

function showMinigameResult(v: MgResultView) {
  clearTimers();
  app.innerHTML = minigameResultHtml(v);
  if (!v.saving && v.record && v.stage > 0) {
    sfx.win();
    confetti();
    playVictory();
  }
}

async function submitMinigame(show = true) {
  const p = mgPending;
  if (!p) return;
  try {
    const res = await finishMinigameRun(p.runId, p.stage, p.totalMs, p.steps);
    mgPending = null;
    if (!res.flagged && p.stage > 0) seasonPing();
    const best: MinigameBest = {
      game: p.game,
      best_score: res.best_score ?? scoreFromStage(res.best_stage),
      best_stage: res.best_stage,
      best_ms: res.best_ms,
      plays: res.plays,
      rank: res.rank,
    };
    (mgBests ??= new Map()).set(p.game, best);
    if (show && app.querySelector(".mg-result")) {
      if (res.flagged) {
        showMinigameResult({ ...p.view, record: false, saving: false, note: "Dieser Lauf wurde zur Prüfung markiert und zählt vorerst nicht. Wenn alles in Ordnung ist, wird er nachträglich gewertet." });
        return;
      }
      showMinigameResult({
        ...p.view,
        score: res.score ?? p.view.score,
        record: res.is_record,
        rank: res.rank,
        totalPlayers: res.total_players,
        clanXp: res.clan_xp || undefined,
        saving: false,
        error: undefined,
      });
    }
  } catch (e) {
    const fatal = e instanceof SocialError && e.code !== "network";
    if (fatal) mgPending = null;
    if (show && app.querySelector(".mg-result")) showMinigameResult({ ...p.view, saving: false, error: errMsg(e), canRetry: !fatal });
  }
}

// ---------- Aktionen ----------

app.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act!;
  // Spiel nur mit Anmeldung oder als Gast
  if (act === "guest-register" || act === "guest-login") return showStart(act === "guest-register" ? "register" : "login");
  if (!canPlay()) return showStart();
  if (act !== "quit") sfx.tap();
  const t = today();
  switch (act) {
    case "go":
      return navigate(btn.dataset.to || "start");
    case "daily":
      if (S.daily[t]) return navigate("start");
      return startRun("daily");
    case "tmode":
      return navigate("pfad");
    case "mgplay":
      return void startMinigame(btn.dataset.game!);
    case "mgquit":
      aborted = true;
      return;
    case "mgback":
      return navigate(`minigames/${mgLast?.game ?? ""}`);
    case "mgoverview":
      return navigate("minigames");
    case "mgboard":
      return navigate(`ranglisten/minigames/${btn.dataset.game}`);
    case "mgretry":
      return void submitMinigame();
    case "mgshare": {
      const g = GAME_BY_ID[btn.dataset.game!];
      if (!g) return;
      let link = publicBase();
      try {
        const u = new URL(publicBase());
        u.search = "";
        u.hash = `#/minigames/${g.id}`;
        link = u.toString();
      } catch {
        /* Basis-Adresse benutzen */
      }
      await doShare(minigameShareText(g, mgLast?.game === g.id ? mgLast.stage : 0, mgLast?.game === g.id ? mgLast.score : 0, link));
      return;
    }
    case "duel":
      if (pending) acceptChallenge(pending);
      return;
    case "free":
      return startRun("free");
    case "endless":
      return startRun("endless");
    case "board":
      return navigate("ranglisten/crew");
    case "path":
      return navigate("pfad");
    case "friends":
      return navigate("freunde");
    case "tquit":
      return confirmTrophyQuit();
    case "tab-crew":
      return navigate("ranglisten/crew");
    case "tab-world":
      return navigate("ranglisten/welt");
    case "home":
      return navigate("start");
    case "quit":
      aborted = true;
      return;
    case "profile":
      return navigate("profil");
    case "streak": {
      const st = streakInfo();
      if (st.state === "done") return void toast(`🔥 ${st.n} ${st.n === 1 ? "Tag" : "Tage"} am Stück – morgen geht's weiter!`);
      if (routeParts()[0] !== "start") return navigate("start");
      toast(st.n ? `🔥 Spiel die Daily, sonst ist deine ${st.n}-Tage-Streak weg!` : "🔥 Spiel die Daily und starte deine Streak!");
      document.querySelector(".play-btn")?.classList.add("nudge");
      return;
    }
    case "guest-exit":
      S.guest = false;
      save();
      replaceRoute("start");
      return showStart();
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
      const d: ResultData = { mode: "daily", day: t, seed: daySeed(t), rounds: r.rounds, specs: buildRounds(daySeed(t), ROUNDS, idsForDay(t)) };
      await doShare(resultShareText(d, act === "challenge-today"));
      return;
    }
    case "story": {
      if (!lastResult) return;
      const d = lastResult;
      const blob = await storyImage({
        title: d.day !== undefined ? dailyName(d.day) : "Training",
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
        return navigate("ranglisten/crew");
      }
      pending = p;
      return navigate("start");
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

// ---------- Trophäen ----------

let myProfile: MyProfile | null = null;
let trophyRun: { start: RoundStart; tasks: TaskResult[] } | null = null;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Da ist etwas schiefgelaufen.");

function myTrophyLabel(): string {
  const p = myProfile ?? cachedProfile(currentUser()?.id);
  return p ? formatTrophies(p.trophies) : "–";
}

// Die Flamme aktualisiert sich automatisch, sobald sich der Trophäenstand ändert
onProfileChange((p) => {
  myProfile = p;
  const el = document.getElementById("trophy-count");
  if (el) el.textContent = p ? formatTrophies(p.trophies) : "–";
});

async function loadProfile(): Promise<MyProfile | null> {
  try {
    const uid = currentUser()?.id;
    const p = await refreshProfile(uid);
    // Profilbild im Hintergrund holen (z. B. auf einem neuen Handy)
    void getMyProfileCard()
      .then((c) => uid === currentUser()?.id && setCachedAvatar(uid, c.avatar))
      .catch(() => {});
    if (p?.username && !S.nameSet) {
      S.name = p.username;
      S.nameSet = true;
      save();
    }
    return p;
  } catch {
    return null;
  }
}

function askName(then?: () => void) {
  askUsername({
    suggestion: myProfile?.username ?? suggestUsername(S.name),
    onSaved: (p) => {
      setCachedProfile(currentUser()?.id, p);
      S.name = p.username;
      S.nameSet = true;
      save();
      toast(`Hi ${p.username}! 👋`);
      then?.();
    },
  });
}

async function openPath() {
  clearTimers();
  const uid = currentUser()?.id;
  const handlers = {
    onBack: () => navigate(lastRoute || "start"),
    onPlay: () => void startTrophyRun(),
    onBoard: () => navigate("ranglisten/welt"),
    onSetName: () => askName(() => void openPath()),
  };
  renderPath(app, myProfile ?? cachedProfile(uid), {}, handlers);
  let error: string | undefined;
  let p: MyProfile | null = null;
  try {
    p = await refreshProfile(uid);
  } catch (e) {
    error = errMsg(e);
  }
  if (app.querySelector(".path-screen")) renderPath(app, p ?? myProfile, { error }, handlers);
}

function confirmTrophyQuit() {
  if (!trophyRun) return;
  modal(
    `<h3>Runde abbrechen?</h3>
     <p class="modal-text">Die restlichen Aufgaben zählen dann als falsch (je −8 Trophäen).</p>
     <button class="btn primary" data-close type="button">Weiterspielen</button>
     <button class="btn ghost danger" id="tq-yes" type="button">Abbrechen</button>`,
    (el, close) => {
      el.querySelector("#tq-yes")!.addEventListener("click", () => {
        close();
        aborted = true;
      });
    },
  );
}

function trophyScreen() {
  app.innerHTML = `
  <div class="screen play trophy-play">
    <div class="hud">
      <button class="icon-btn quit" data-act="tquit" aria-label="Runde abbrechen">✕</button>
      <div class="t-hud">
        <span class="t-task">Aufgabe <b id="t-task">1</b> / ${TROPHY_TASKS}</span>
        <span class="t-streak" id="t-streak">🔥 Serie 0</span>
      </div>
      <div class="t-round" id="t-round">Runde: ±0</div>
    </div>
    <div class="timer"><div class="timer-fill" id="timer"></div></div>
    <div class="stage-holder" id="holder"></div>
  </div>`;
}

async function startTrophyRun() {
  if (!myProfile) await loadProfile();
  if (!myProfile?.username) {
    askName(() => void startTrophyRun());
    return;
  }
  clearTimers();
  sfx.unlock();
  aborted = false;
  navAbort = false;

  let start: RoundStart;
  try {
    start = await startTrophyRound();
  } catch (e) {
    toast(errMsg(e));
    if (e instanceof SocialError && e.code === "username_required") askName(() => void startTrophyRun());
    return;
  }
  const startedAt = performance.now();
  running = true;

  // 15 Aufgaben aus ALLEN registrierten Minispielen: jedes kommt vor, bevor sich eines wiederholt,
  // nie zweimal dasselbe direkt hintereinander. Schwierigkeit nach Trophäenstand.
  const specs = buildRounds(start.seed, TROPHY_TASKS, GAME_IDS).map((sp, i) => ({ ...sp, level: levelFor(start.trophies, i) }));
  const tasks: TaskResult[] = [];
  trophyRun = { start, tasks };
  trophyScreen();
  const holder = document.getElementById("holder")!;
  const $ = (id: string) => document.getElementById(id)!;
  // Der Liga-Einsatz steht von Anfang an in der Rundenbilanz
  const fee0 = leagueFee(start.trophies);
  if (fee0) {
    $("t-round").textContent = `Runde: ${formatDelta(-fee0)}`;
    $("t-round").className = "t-round neg";
  }

  for (let i = 0; i < specs.length && !aborted; i++) {
    const spec = specs[i];
    $("t-task").textContent = String(i + 1);
    await showIntro(holder, spec, `Aufgabe ${i + 1} / ${TROPHY_TASKS}`);
    if (aborted) break;
    const r = await playRound(holder, spec);
    if (aborted) break;
    const g = GAME_BY_ID[spec.gameId];
    const ok = r.ok && !r.timeout;
    const ms = Math.round(r.ms ?? r.elapsed);
    tasks.push({ game: g.id, ok, timeout: r.timeout, tier: ok ? tierFor(ms, g.speed) : 0, ms });
    const sc = scoreRound(tasks, start.trophies);
    const step = sc.steps[sc.steps.length - 1];
    $("t-streak").textContent = `🔥 ${step.streak ? `${step.streak}er-Serie` : "Serie 0"}`;
    $("t-streak").classList.toggle("hot", step.streak >= 3);
    const roundEl = $("t-round");
    roundEl.textContent = `Runde: ${formatDelta(sc.raw)}`;
    roundEl.className = `t-round ${sc.raw > 0 ? "pos" : sc.raw < 0 ? "neg" : ""}`;
    await trophyFeedback(holder, r.ok && !r.timeout, step, r.reason);
  }

  running = false;
  navAbort = false;
  // Abgebrochen: Rest zählt als falsch
  while (tasks.length < TROPHY_TASKS) {
    tasks.push({ game: specs[tasks.length].gameId, ok: false, timeout: true, tier: 0, ms: 0 });
  }
  aborted = false;
  // Der Server wertet nur realistisch lange Runden (mind. 20 s). Bei frühem Abbruch kurz warten.
  const wait = 20500 - (performance.now() - startedAt);
  if (wait > 0) {
    renderTrophyResult(app, { server: null, local: scoreRound(tasks, start.trophies), startTrophies: start.trophies, saving: true }, trophyResultHandlers());
    await sleep(wait);
  }
  await submitTrophyRun();
}

async function trophyFeedback(holder: HTMLElement, ok: boolean, step: { delta: number; label: string; streakBonus: number; streak: number }, reason?: string) {
  const stage = holder.firstElementChild as HTMLElement;
  stage.classList.add(ok ? "done-ok" : "done-fail");
  if (ok) {
    sfx.good(step.label ? 95 : 70);
    floatText(holder, `+${step.delta - step.streakBonus}${step.label ? ` ${step.label}` : ""}`, step.label ? "perfect t-gain" : "t-gain");
    if (step.streakBonus) {
      await sleep(260);
      floatText(holder, `🔥 ${step.streak}er-Serie! +${step.streakBonus}`, "t-streakbonus");
    }
  } else {
    sfx.bad();
    shake(holder);
    floatText(holder, `${formatDelta(step.delta)}${reason ? ` · ${reason}` : ""}`, "fail");
  }
  await sleep(ok ? (step.streakBonus ? 760 : 520) : 900);
}

function trophyResultHandlers() {
  return {
    again: () => void startTrophyRun(),
    path: () => navigate("pfad"),
    board: () => navigate("ranglisten/welt"),
    home: () => navigate("start"),
    retry: () => void submitTrophyRun(),
  };
}

async function submitTrophyRun() {
  if (!trophyRun) return;
  const { start, tasks } = trophyRun;
  const local = scoreRound(tasks, start.trophies);
  const h = trophyResultHandlers();
  renderTrophyResult(app, { server: null, local, startTrophies: start.trophies, saving: true }, h);
  try {
    const res = await finishTrophyRound(start.round_id, tasks);
    trophyRun = null;
    renderTrophyResult(app, { server: res, local, startTrophies: start.trophies }, h);
    seasonPing(1400);
    const uid = currentUser()?.id;
    if (myProfile) {
      setCachedProfile(uid, {
        ...myProfile,
        trophies: res.new_trophies,
        league: res.new_league,
        world_rank: res.world_rank ?? myProfile.world_rank,
        best_streak: Math.max(myProfile.best_streak ?? 0, res.best_streak),
        trophy_rounds: (myProfile.trophy_rounds ?? 0) + 1,
      });
    }
    void loadProfile();
    const rank = (id: string) => LEAGUES.findIndex((l) => l.id === id);
    if (rank(res.new_league) > rank(res.old_league)) {
      await sleep(500);
      sfx.jingle();
      await leagueUp(res.new_league, res.new_trophies);
    } else if (rank(res.new_league) < rank(res.old_league)) {
      sfx.bad();
    } else if (res.delta > 0) {
      sfx.win();
      if (res.delta >= 100) confetti();
      playVictory();
    } else if (res.delta < 0) {
      sfx.bad();
    }
  } catch (e) {
    if (e instanceof SocialError && e.code === "round_not_active") {
      trophyRun = null;
      void loadProfile();
    }
    renderTrophyResult(app, { server: null, local, startTrophies: start.trophies, error: errMsg(e) }, h);
  }
}

// ---------- Start: erst Anmeldung, dann Spiel ----------

function showStart(mode?: "register" | "login") {
  aborted = true;
  clearTimers();
  document.querySelector(".modal-bg")?.remove();
  const hooks: Parameters<typeof renderStart>[1] = {
    onGuest: () => {
      sfx.unlock();
      sfx.jingle();
      S.guest = true;
      save();
      if (!location.hash || routeParts()[0] === "rechtliches") replaceRoute("start");
      renderRoute();
      maybeTour();
    },
    banner: pending
      ? `<b>${esc(pending.n)}</b> fordert dich heraus (${sumPoints(pending.r)} Punkte)`
      : pendingClan
        ? `Du wurdest in einen <b>Clan</b> eingeladen`
        : pendingProfile
          ? `Du wurdest zum Profil von <b>${esc(pendingProfile)}</b> eingeladen`
          : undefined,
    bannerIcon: pending ? undefined : pendingClan ? "🛡️" : "👤",
    bannerSub: pending ? undefined : pendingClan ? "Melde dich an oder erstelle ein Konto, um beizutreten." : "Melde dich an, um das Profil zu sehen.",
    onSignedIn: (fresh) => {
      renderRoute();
      void loadProfile();
      openPendingProfile();
      openPendingClan();
      startBadges();
      void ensureTerms().then(maybeTour);
      void passAfterLogin();
      if (S.guest) {
        S.guest = false;
        save();
      }
      sfx.unlock();
      sfx.jingle();
      toast(fresh ? "Account erstellt – viel Spaß! 🎉" : "Angemeldet ✌️");
    },
  };
  if (mode) renderAuthForm(app, mode, hooks);
  else renderStart(app, hooks);
}

// Abgemeldet (Logout oder abgelaufene Sitzung) → zurück ins Startmenü
onAuthChange((s) => {
  if (!s) {
    setCachedProfile(undefined, null);
    setCachedAvatar(undefined, null);
    mgBests = null;
    stopBadges();
    resetMyCountry();
    resetPass();
    myTerms = null;
    // Nach dem Abmelden startet die nächste Anmeldung wieder auf „Start“
    if (location.hash) replaceRoute("start");
    showStart();
  }
});

// Begrüßung: Beim ersten Tippen in einer Sitzung (Browser erlauben Ton erst nach einer Berührung) kommt der ZWIP-Sound –
// außer man startet mit diesem Tippen gleich ein Spiel, dann kommt dort das „zwiiip“.
document.addEventListener(
  "pointerdown",
  (e) => {
    if (S.muted || !canPlay()) return;
    if ((e.target as HTMLElement).closest("[data-act], .explain-ok, button, a, input")) return;
    sfx.unlock();
    sfx.jingle();
  },
  { once: true, capture: true },
);

async function boot() {
  app.innerHTML = `<div class="screen boot" aria-busy="true"><h1 class="logo" aria-label="ZWIP"><span>Z</span><span>W</span><span>I</span><span>P</span></h1></div>`;
  const s = await restoreSession();
  if (s) {
    renderRoute();
    void loadProfile();
    openPendingProfile();
    openPendingClan();
    startBadges();
    void ensureTerms().then(maybeTour);
    void passAfterLogin();
  } else if (routeParts()[0] === "rechtliches") legalScreen(routeParts()[1]);
  else if (S.guest) {
    renderRoute();
    maybeTour();
  } else showStart();
}

// Clan-Abzeichen in Profilen nachladen (Profil-Popups, Profil-Tab)
new MutationObserver(() => {
  document.querySelectorAll<HTMLElement>("[data-clan-for]:not([data-done])").forEach((el) => {
    el.dataset.done = "1";
    void getPlayerClan(el.dataset.clanFor!)
      .then((c) => {
        if (!c || !el.isConnected) return;
        el.innerHTML = `<a class="pf-clan-link" href="#/clan/c/${c.id}">${emblemHtml(c, "s")}<span>${esc(c.name)}<small>${c.role === "leader" ? "👑 Leitung · " : ""}Clan-Level ${c.level}</small></span></a>`;
        el.querySelector("a")?.addEventListener("click", () => document.querySelectorAll(".modal-bg").forEach((m) => m.remove()));
      })
      .catch(() => {});
  });
}).observe(document.body, { childList: true, subtree: true });

void boot();
