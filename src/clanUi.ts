// Clans: gründen, suchen, beitreten, einladen, Übersicht mit Level/XP und Wochen-Challenges,
// Chat (frei + Schnellnachrichten, Filter, Melden, Stummschalten), Mitglieder und Einstellungen.

import { esc, toast, modal } from "./ui";
import { myEmotes } from "./passUi";
import { formatTrophies, leagueById } from "./trophies";
import { fmtScore } from "./score";
import {
  getMyClan,
  createClan,
  updateClan,
  searchClans,
  getClan,
  joinClan,
  cancelClanRequest,
  inviteToClan,
  respondClanInvite,
  respondClanRequest,
  leaveClan,
  kickClanMember,
  transferClanLeader,
  getClanBoard,
  getClanContrib,
  getClanMessages,
  sendClanMessage,
  reportClanMessage,
  hideClanMessage,
  muteClanMember,
  getFriends,
  getClanInvite,
  resetClanInvite,
  clanByInvite,
  joinClanByInvite,
  getClanLeague,
  SocialError,
  type MyClan,
  type ClanInfo,
  type ClanMessage,
  type JoinMode,
} from "./social";
import { EMBLEMS, COLORS, FRAMES, QUICK_MESSAGES, JOIN_MODES, CLAN_MAX, emblemHtml, joinModeLabel, nextRewards, chatTime, clanLeague, clanLeagueFor, clanInviteUrl, CLAN_LEAGUES } from "./clanKit";

export interface ClanHandlers {
  hasName: () => boolean;
  askName: (then: () => void) => void;
  openPlayer: (name: string) => void;
  /** Bildschirm neu zeichnen (gleiche Route) */
  rerender: () => void;
  /** Zu einer Route wechseln, z. B. "clan/chat" */
  go: (path: string) => void;
  /** Intervall registrieren, das beim Seitenwechsel automatisch gestoppt wird */
  every: (ms: number, fn: () => void) => void;
  /** Badges neu laden (z. B. nach dem Lesen des Chats) */
  refreshBadges: () => void;
  /** Öffentliche Basis-Adresse der App (für Einladungslinks) */
  publicBase: () => string;
  /** Text teilen (Teilen-Menü oder Zwischenablage) */
  share: (text: string) => Promise<void>;
}

const errMsg = (e: unknown) => (e instanceof SocialError ? e.message : "Da ist etwas schiefgelaufen.");

/** Zweimal tippen zum Bestätigen (ohne Browser-Dialog) */
function confirmTap(btn: HTMLElement, label: string, run: () => void) {
  if (btn.dataset.armed === "1") {
    run();
    return;
  }
  const old = btn.textContent ?? "";
  btn.dataset.armed = "1";
  btn.textContent = label;
  btn.classList.add("armed");
  window.setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.armed = "";
    btn.textContent = old;
    btn.classList.remove("armed");
  }, 3000);
}

// ---------- persönliche Stummschaltung (nur auf diesem Gerät) ----------
const MUTE_KEY = "zwip:mutes";
function loadMutes(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(MUTE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveMutes(s: Set<string>) {
  try {
    localStorage.setItem(MUTE_KEY, JSON.stringify([...s]));
  } catch {
    /* egal */
  }
}

// =====================================================================
// Einstieg
// =====================================================================

export async function renderClan(page: HTMLElement, sub: string | undefined, arg: string | undefined, h: ClanHandlers) {
  page.innerHTML = `<div class="empty">Lädt…</div>`;
  if (sub === "c" && arg) return renderPublicClan(page, arg, h);
  let data: MyClan;
  try {
    data = await getMyClan();
  } catch (e) {
    page.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    return;
  }
  if (!page.isConnected) return;
  if (!data.clan) return renderNoClan(page, data, h);
  const tab = sub === "chat" || sub === "mitglieder" || sub === "einstellungen" ? sub : "start";
  page.innerHTML = `${clanHeaderHtml(data.clan, true)}${clanTabsHtml(tab, data)}<div id="clan-body"></div>`;
  const body = page.querySelector<HTMLElement>("#clan-body")!;
  if (tab === "chat") return renderChat(body, data, h);
  if (tab === "mitglieder") return renderMembers(body, data, h);
  if (tab === "einstellungen") return renderSettings(body, data, h);
  return renderOverview(body, data, h);
}

function clanHeaderHtml(c: ClanInfo, mine: boolean): string {
  const span = c.next_level_xp ? c.next_level_xp - c.level_xp : 1;
  const pct = c.next_level_xp ? Math.max(2, Math.min(100, ((c.xp - c.level_xp) / span) * 100)) : 100;
  return `<section class="clan-head" style="--cc:${esc(c.color)}">
    ${emblemHtml(c, "l")}
    <div class="clan-head-txt">
      <h2 class="clan-name">${esc(c.name)}</h2>
      <div class="clan-meta"><span class="clan-lvl">Level ${c.level}</span><span>👥 ${c.members}/${c.max_members ?? CLAN_MAX}</span><span>🏆 Platz ${c.rank}</span></div>
      <div class="clan-xp" role="progressbar" aria-label="Clan-XP" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
        <i style="width:${pct}%"></i>
      </div>
      <small class="muted">${c.next_level_xp ? `${fmtScore(c.xp)} / ${fmtScore(c.next_level_xp)} XP bis Level ${c.level + 1}` : `${fmtScore(c.xp)} XP · Höchstes Level!`}</small>
    </div>
    ${c.description ? `<p class="clan-desc">${esc(c.description)}</p>` : ""}
    ${mine ? "" : `<p class="clan-desc small muted">${esc(joinModeLabel(c.join_mode))}${c.leader ? ` · Leitung: ${esc(c.leader)}` : ""}</p>`}
  </section>`;
}

function clanTabsHtml(tab: string, d: MyClan): string {
  const items: [string, string, string][] = [
    ["start", "clan", "Übersicht"],
    ["chat", "clan/chat", `Chat${d.unread ? ` <b class="seg-badge">${d.unread > 99 ? "99+" : d.unread}</b>` : ""}`],
    ["mitglieder", "clan/mitglieder", `Mitglieder${d.role === "leader" && d.requests?.length ? ` <b class="seg-badge">${d.requests.length}</b>` : ""}`],
    ["einstellungen", "clan/einstellungen", "⚙️"],
  ];
  return `<nav class="seg seg-4 clan-tabs" aria-label="Clan-Bereiche">${items
    .map(([id, href, label]) => `<a href="#/${href}" class="${id === tab ? "on" : ""}"${id === tab ? ` aria-current="page"` : ""}${id === "einstellungen" ? ` aria-label="Einstellungen"` : ""}>${label}</a>`)
    .join("")}</nav>`;
}

// =====================================================================
// Ohne Clan: Einladungen, gründen, suchen
// =====================================================================

function renderNoClan(page: HTMLElement, d: MyClan, h: ClanHandlers) {
  const invites = d.invites ?? [];
  page.innerHTML = `
    ${h.hasName() ? "" : `<button class="name-banner" data-c="name"><b>Wähle zuerst deinen Spielernamen</b><span>Ohne Namen kannst du keinem Clan beitreten →</span></button>`}
    <section class="clan-intro">
      <span class="clan-intro-ico" aria-hidden="true">🛡️</span>
      <div><h2>Spiel zusammen im Clan</h2><p class="muted">Jedes Minigame bringt deinem Clan XP. Steigt im Level, schaltet Wappen frei und schlagt andere Clans in der Rangliste.</p></div>
    </section>
    ${
      invites.length
        ? `<section><h2 class="sec-title">Einladungen</h2><div class="list">${invites
            .map(
              (c) => `<div class="row-item clan-row">${emblemHtml(c, "s")}<span class="nm">${esc(c.name)}<small>Level ${c.level} · 👥 ${c.members} · von ${esc(c.invited_by ?? "?")}</small></span>
              <span class="row-actions"><button class="btn small primary" data-c="inv-yes" data-id="${c.id}">Beitreten</button><button class="btn small ghost" data-c="inv-no" data-id="${c.id}" aria-label="Ablehnen">✕</button></span></div>`,
            )
            .join("")}</div></section>`
        : ""
    }
    <section class="card-sec">
      <button class="btn primary big" data-c="create-open">＋ Eigenen Clan gründen</button>
      <div id="clan-create" hidden></div>
    </section>
    <section>
      <h2 class="sec-title"><label for="clan-q">Clan suchen</label></h2>
      <input id="clan-q" type="search" placeholder="Clan-Name eingeben" autocomplete="off" enterkeyhint="search" maxlength="20">
      <div id="clan-results" class="list" aria-live="polite"><div class="empty">Lädt…</div></div>
    </section>`;

  const needName = (then: () => void) => (h.hasName() ? then() : h.askName(then));
  const results = page.querySelector<HTMLElement>("#clan-results")!;
  const q = page.querySelector<HTMLInputElement>("#clan-q")!;
  let seq = 0;
  const search = async () => {
    const my = ++seq;
    try {
      const list = await searchClans(q.value.trim());
      if (my !== seq || !results.isConnected) return;
      results.innerHTML = list.length
        ? list.map((c) => clanSearchRow(c)).join("")
        : `<div class="empty">${q.value.trim() ? "Kein Clan mit diesem Namen." : "Noch gibt es keine Clans – gründe den ersten!"}</div>`;
    } catch (e) {
      if (results.isConnected) results.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    }
  };
  let t = 0;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = window.setTimeout(search, 250);
  });
  void search();

  page.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-c]");
    if (!btn) return;
    const id = btn.dataset.id ?? "";
    try {
      switch (btn.dataset.c) {
        case "name":
          return h.askName(() => h.rerender());
        case "inv-yes":
          return needName(async () => {
            await respondClanInvite(id, true);
            toast("Willkommen im Clan! 🛡️");
            h.refreshBadges();
            h.rerender();
          });
        case "inv-no":
          await respondClanInvite(id, false);
          h.refreshBadges();
          return h.rerender();
        case "create-open": {
          const box = page.querySelector<HTMLElement>("#clan-create")!;
          box.hidden = !box.hidden;
          if (!box.hidden && !box.childElementCount) mountCreateForm(box, h);
          btn.textContent = box.hidden ? "＋ Eigenen Clan gründen" : "Abbrechen";
          return;
        }
        case "open":
          return h.go(`clan/c/${id}`);
        case "join":
          return needName(async () => {
            btn.setAttribute("disabled", "");
            const r = await joinClan(id);
            if (r.status === "joined") {
              toast("Willkommen im Clan! 🛡️");
              h.rerender();
            } else {
              toast("Anfrage gesendet ✉️");
              void search();
            }
          });
        case "unrequest":
          await cancelClanRequest(id);
          toast("Anfrage zurückgezogen");
          return void search();
      }
    } catch (e) {
      btn.removeAttribute("disabled");
      toast(errMsg(e));
    }
  });
}

function clanSearchRow(c: ClanInfo): string {
  const full = c.members >= (c.max_members ?? CLAN_MAX);
  const action = c.invited
    ? `<button class="btn small primary" data-c="join" data-id="${c.id}">Beitreten</button>`
    : c.requested
      ? `<button class="btn small ghost" data-c="unrequest" data-id="${c.id}">Angefragt ✕</button>`
      : full
        ? `<span class="pill">Voll</span>`
        : c.join_mode === "open"
          ? `<button class="btn small primary" data-c="join" data-id="${c.id}">Beitreten</button>`
          : c.join_mode === "request"
            ? `<button class="btn small" data-c="join" data-id="${c.id}">Anfragen</button>`
            : `<span class="pill">Nur Einladung</span>`;
  return `<div class="row-item clan-row">
    <button class="clan-open" data-c="open" data-id="${c.id}" aria-label="${esc(c.name)} ansehen">${emblemHtml(c, "s")}<span class="nm">${esc(c.name)}<small>Level ${c.level} · 👥 ${c.members}/${c.max_members ?? CLAN_MAX} · ${esc(joinModeLabel(c.join_mode))}</small></span></button>
    <span class="row-actions">${action}</span>
  </div>`;
}

function pickerHtml(level: number, sel: { emblem: string; color: string; frame: string }, withFrames: boolean): string {
  return `
    <div class="field"><span class="field-label">Wappen</span>
      <div class="emblem-grid">${EMBLEMS.map(
        (x) => `<button type="button" class="emblem-opt ${x.e === sel.emblem ? "on" : ""}" data-emblem="${x.e}" ${x.lvl > level ? `disabled aria-label="${x.e} ab Level ${x.lvl}"` : `aria-label="${x.e}"`}>${x.e}${x.lvl > level ? `<small>Lv ${x.lvl}</small>` : ""}</button>`,
      ).join("")}</div>
    </div>
    <div class="field"><span class="field-label">Farbe</span>
      <div class="color-grid">${COLORS.map(
        (x) => `<button type="button" class="color-opt ${x.c === sel.color ? "on" : ""}" style="--cc:${x.c}" data-color="${x.c}" ${x.lvl > level ? `disabled aria-label="${x.name} ab Level ${x.lvl}"` : `aria-label="${x.name}"`}>${x.lvl > level ? `<small>Lv ${x.lvl}</small>` : ""}</button>`,
      ).join("")}</div>
    </div>
    ${
      withFrames
        ? `<div class="field"><span class="field-label">Rahmen</span>
      <div class="frame-grid">${FRAMES.map(
        (x) => `<button type="button" class="frame-opt ${x.f === sel.frame ? "on" : ""}" data-frame="${x.f}" ${x.lvl > level ? "disabled" : ""}>${x.name}${x.lvl > level ? ` <small>Lv ${x.lvl}</small>` : ""}</button>`,
      ).join("")}</div>
    </div>`
        : ""
    }`;
}

function modeHtml(sel: JoinMode): string {
  return `<div class="field"><span class="field-label">Wer darf beitreten?</span><div class="mode-grid">${JOIN_MODES.map(
    (m) => `<label class="mode-opt"><input type="radio" name="jm" value="${m.m}" ${m.m === sel ? "checked" : ""}><b>${m.label}</b><small>${m.hint}</small></label>`,
  ).join("")}</div></div>`;
}

function bindPicker(root: HTMLElement, sel: { emblem: string; color: string; frame: string }, onChange: () => void) {
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-emblem],[data-color],[data-frame]");
    if (!b || b.disabled) return;
    const key = b.dataset.emblem ? "emblem" : b.dataset.color ? "color" : "frame";
    sel[key] = (b.dataset.emblem ?? b.dataset.color ?? b.dataset.frame)!;
    root.querySelectorAll(`[data-${key}]`).forEach((x) => x.classList.toggle("on", x === b));
    onChange();
  });
}

function mountCreateForm(box: HTMLElement, h: ClanHandlers) {
  const sel = { emblem: "🛡️", color: "#a45cff", frame: "none" };
  box.innerHTML = `
    <form class="clan-form" novalidate>
      <div class="clan-preview" id="cp">${emblemHtml(sel, "l")}<b id="cp-name">Dein Clan</b></div>
      <label class="field"><span class="field-label">Clan-Name</span><input id="cf-name" maxlength="20" autocomplete="off" placeholder="z. B. Die Blitze" required></label>
      ${pickerHtml(1, sel, false)}
      <label class="field"><span class="field-label">Beschreibung (optional)</span><textarea id="cf-desc" maxlength="160" rows="2" placeholder="Worum geht's in eurem Clan?"></textarea></label>
      ${modeHtml("request")}
      <p class="muted small">Weitere Wappen, Farben und Rahmen schaltet ihr mit höherem Clan-Level frei.</p>
      <div class="inline-error" id="cf-err" role="alert" hidden></div>
      <button class="btn primary big" type="submit" id="cf-go">Clan gründen 🚀</button>
    </form>`;
  const name = box.querySelector<HTMLInputElement>("#cf-name")!;
  const preview = () => {
    box.querySelector("#cp")!.innerHTML = `${emblemHtml(sel, "l")}<b id="cp-name">${esc(name.value.trim() || "Dein Clan")}</b>`;
  };
  name.addEventListener("input", preview);
  bindPicker(box, sel, preview);
  box.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!h.hasName()) return h.askName(() => h.rerender());
    const err = box.querySelector<HTMLElement>("#cf-err")!;
    const go = box.querySelector<HTMLButtonElement>("#cf-go")!;
    err.hidden = true;
    go.disabled = true;
    try {
      const jm = (box.querySelector<HTMLInputElement>('input[name="jm"]:checked')?.value ?? "request") as JoinMode;
      await createClan(name.value.trim(), sel.emblem, sel.color, box.querySelector<HTMLTextAreaElement>("#cf-desc")!.value, jm);
      toast("Clan gegründet! Jetzt Freunde einladen 🎉");
      h.go("clan/mitglieder");
    } catch (ex) {
      err.textContent = errMsg(ex);
      err.hidden = false;
      go.disabled = false;
    }
  });
}

// =====================================================================
// Öffentliche Clan-Ansicht
// =====================================================================

async function renderPublicClan(page: HTMLElement, id: string, h: ClanHandlers) {
  try {
    const c = await getClan(id);
    if (!page.isConnected) return;
    const full = c.members >= (c.max_members ?? CLAN_MAX);
    const action = c.is_member
      ? `<a class="btn primary big" href="#/clan">Zu deinem Clan</a>`
      : c.invited
        ? `<button class="btn primary big" data-c="join">Einladung annehmen & beitreten</button>`
        : c.requested
          ? `<button class="btn big ghost" data-c="unrequest">Anfrage zurückziehen</button>`
          : full
            ? `<div class="empty">Dieser Clan ist voll.</div>`
            : c.join_mode === "invite"
              ? `<div class="empty">Nur mit Einladung. Frag ein Mitglied!</div>`
              : `<button class="btn primary big" data-c="join">${c.join_mode === "open" ? "Beitreten" : "Beitritt anfragen"}</button>`;
    page.innerHTML = `${clanHeaderHtml(c, false)}${action}
      <section><h2 class="sec-title">Mitglieder (${c.members})</h2>
      <div class="list">${c.member_list
        .slice(0, 100)
        .map((m, i) => {
          const l = leagueById(m.league);
          return `<button class="row-item trow" data-player="${esc(m.username)}"><span class="rk">${i + 1}</span><span class="nm">${m.role === "leader" ? "👑 " : ""}${esc(m.username)}<small style="--lc:${l.color}">${l.emoji} ${l.name}</small></span><b class="score-cell">${fmtScore(m.xp_week)}<small>XP Woche</small></b></button>`;
        })
        .join("")}</div></section>`;
    page.addEventListener("click", async (e) => {
      const p = (e.target as HTMLElement).closest<HTMLElement>("[data-player]");
      if (p) return h.openPlayer(p.dataset.player!);
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
      if (!b) return;
      try {
        if (b.dataset.c === "join") {
          if (!h.hasName()) return h.askName(() => h.rerender());
          const r = await joinClan(id);
          toast(r.status === "joined" ? "Willkommen im Clan! 🛡️" : "Anfrage gesendet ✉️");
          if (r.status === "joined") h.go("clan");
          else h.rerender();
        } else if (b.dataset.c === "unrequest") {
          await cancelClanRequest(id);
          h.rerender();
        }
      } catch (ex) {
        toast(errMsg(ex));
      }
    });
  } catch (e) {
    page.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
  }
}

// =====================================================================
// Übersicht: meine XP, Wochen-Challenges, wer trägt bei, Belohnungen
// =====================================================================

function renderOverview(body: HTMLElement, d: MyClan, h: ClanHandlers) {
  const c = d.clan!;
  const ch = d.challenges;
  const daysLeft = ch ? Math.max(0, Math.ceil((new Date(ch.week_end).getTime() - Date.now()) / 86400000)) : 0;
  const rewards = nextRewards(c.level, 3);
  body.innerHTML = `
    <section class="clan-mine">
      <div><span>Deine XP diese Woche</span><b>${fmtScore(d.my_xp_week ?? 0)}</b></div>
      <div><span>Insgesamt</span><b>${fmtScore(d.my_xp_total ?? 0)}</b></div>
      <a class="btn primary" href="#/minigames">🎮 XP sammeln</a>
    </section>
    <p class="muted small center">Jeder Punkt aus einem Minigame wird 1:1 zu Clan-XP.</p>
    <section id="clan-league" class="clan-league" aria-live="polite"></section>
    ${
      ch
        ? `<section><div class="board-head"><h2 class="sec-title">Wochen-Challenges</h2><span class="pill">noch ${daysLeft} ${daysLeft === 1 ? "Tag" : "Tage"}</span></div>
      <div class="chal-list">${ch.items
        .map((x) => {
          const pct = Math.min(100, (x.progress / x.goal) * 100);
          return `<div class="chal ${x.done ? "done" : ""}">
            <div class="chal-top"><b>${x.done ? "✅ " : ""}${esc(x.title)}</b><span class="chal-rew">+${fmtScore(x.reward)} XP</span></div>
            <div class="chal-bar"><i style="width:${pct}%"></i></div>
            <small class="muted">${fmtScore(x.progress)} / ${fmtScore(x.goal)}</small>
          </div>`;
        })
        .join("")}</div></section>`
        : ""
    }
    <section>
      <div class="board-head"><h2 class="sec-title">Wer trägt am meisten bei?</h2></div>
      <div class="chips" id="contrib-per">${[
        ["week", "Woche"],
        ["month", "Monat"],
        ["all", "Gesamt"],
      ]
        .map(([k, l]) => `<button class="chip ${k === "week" ? "on" : ""}" data-per="${k}">${l}</button>`)
        .join("")}</div>
      <div id="contrib" class="list"><div class="empty">Lädt…</div></div>
    </section>
    ${
      rewards.length
        ? `<section class="card-sec"><h2 class="sec-title">Als Nächstes freigeschaltet</h2>
      <ul class="reward-list">${rewards.map((r) => `<li><b>Level ${r.level}</b><span>${r.items.map(esc).join(" · ")}</span></li>`).join("")}</ul></section>`
        : ""
    }
    <a class="btn ghost" href="#/ranglisten/clans">🏆 Clan-Rangliste ansehen</a>`;

  void mountLeague(body.querySelector<HTMLElement>("#clan-league")!);
  const contrib = body.querySelector<HTMLElement>("#contrib")!;
  const load = async (per: string) => {
    contrib.innerHTML = `<div class="empty">Lädt…</div>`;
    try {
      const rows = await getClanContrib(per);
      if (!contrib.isConnected) return;
      contrib.innerHTML = rows
        .slice(0, 100)
        .map((r) => {
          const l = leagueById(r.league);
          return `<button class="row-item trow ${r.is_me ? "me" : ""}" data-player="${esc(r.username)}"><span class="rk">${["🥇", "🥈", "🥉"][r.rank - 1] ?? r.rank}</span><span class="nm">${r.role === "leader" ? "👑 " : ""}${esc(r.username)}${r.is_me ? " (du)" : ""}<small style="--lc:${l.color}">${l.emoji} ${l.name} · ${r.rounds} ${r.rounds === 1 ? "Runde" : "Runden"}</small></span><b class="score-cell">${fmtScore(r.points)}<small>XP</small></b></button>`;
        })
        .join("");
    } catch (e) {
      if (contrib.isConnected) contrib.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    }
  };
  void load("week");
  body.querySelector("#contrib-per")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-per]");
    if (!b) return;
    body.querySelectorAll("#contrib-per .chip").forEach((x) => x.classList.toggle("on", x === b));
    void load(b.dataset.per!);
  });
  contrib.addEventListener("click", (e) => {
    const p = (e.target as HTMLElement).closest<HTMLElement>("[data-player]");
    if (p) h.openPlayer(p.dataset.player!);
  });
}

// =====================================================================
// Chat
// =====================================================================

function renderChat(body: HTMLElement, d: MyClan, h: ClanHandlers) {
  const muted = d.muted_until && new Date(d.muted_until).getTime() > Date.now();
  const leader = d.role === "leader";
  const mutes = loadMutes();
  body.innerHTML = `
    <div class="chat">
      <p class="chat-rules muted small">Sei fair 🤝 Beleidigungen, Links und Telefonnummern werden automatisch gefiltert. Tipp auf eine Nachricht, um sie zu melden.</p>
      <div class="chat-list" id="chat-list" aria-live="polite"><div class="empty">Lädt…</div></div>
      <div class="chat-quick" role="group" aria-label="Schnellnachrichten">${QUICK_MESSAGES.map((q, i) => `<button class="chip" data-quick="${i + 1}">${esc(q)}</button>`).join("")}</div>
      ${
        muted
          ? `<div class="inline-error">Du bist bis ${new Date(d.muted_until!).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" })} stummgeschaltet.</div>`
          : `<form class="chat-form" id="chat-form" autocomplete="off"><input id="chat-in" maxlength="200" placeholder="Nachricht an den Clan…" enterkeyhint="send" aria-label="Nachricht"><button class="btn primary" type="submit" aria-label="Senden">➤</button></form>`
      }
    </div>`;
  const list = body.querySelector<HTMLElement>("#chat-list")!;
  let last = 0;
  const msgs = new Map<number, ClanMessage>();
  const draw = () => {
    const arr = [...msgs.values()].sort((a, b) => a.id - b.id);
    if (!arr.length) {
      list.innerHTML = `<div class="empty">Noch keine Nachrichten.<br>Sag Hallo 👋</div>`;
      return;
    }
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.innerHTML = arr
      .map((m) => {
        if (m.kind === "system") return `<div class="msg sys">${esc(m.body ?? "")}</div>`;
        if (m.username && mutes.has(m.username) && !m.is_me) return `<div class="msg sys small">Nachricht von ${esc(m.username)} ausgeblendet (stummgeschaltet)</div>`;
        if (m.hidden) return `<div class="msg sys small">🚫 Nachricht wurde ausgeblendet</div>`;
        return `<button class="msg ${m.is_me ? "me" : ""} ${m.kind === "quick" ? "quick" : ""}" data-msg="${m.id}">
          ${m.is_me ? "" : `<b class="msg-name">${esc(m.username ?? "?")}</b>`}<span class="msg-body">${esc(m.body ?? "")}</span><small class="msg-time">${chatTime(m.at)}</small>
        </button>`;
      })
      .join("");
    if (atBottom || last === 0) list.scrollTop = list.scrollHeight;
  };
  const pull = async () => {
    try {
      const fresh = await getClanMessages(last);
      if (!list.isConnected) return;
      const before = msgs.size;
      fresh.forEach((m) => msgs.set(m.id, m));
      const max = fresh.reduce((a, m) => Math.max(a, m.id), last);
      const changed = msgs.size !== before || last === 0;
      last = max;
      if (changed) {
        draw();
        h.refreshBadges();
      }
    } catch (e) {
      if (!msgs.size && list.isConnected) list.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    }
  };
  void pull().then(() => (list.scrollTop = list.scrollHeight));
  h.every(4000, () => void pull());

  const send = async (text: string | null, quick: number | null) => {
    try {
      await sendClanMessage(text, quick);
      await pull();
      list.scrollTop = list.scrollHeight;
      return true;
    } catch (e) {
      toast(errMsg(e));
      return false;
    }
  };
  body.querySelector<HTMLFormElement>("#chat-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = body.querySelector<HTMLInputElement>("#chat-in")!;
    const v = inp.value.trim();
    if (!v) return;
    if (await send(v, null)) inp.value = "";
  });
  body.querySelector(".chat-quick")!.addEventListener("click", (e) => {
    const em = (e.target as HTMLElement).closest<HTMLElement>("[data-emote]");
    if (em) {
      if (muted) return toast("Du bist gerade stummgeschaltet.");
      void send(em.dataset.emote!, null);
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-quick]");
    if (!b || muted) return muted ? toast("Du bist gerade stummgeschaltet.") : undefined;
    void send(null, Number(b.dataset.quick));
  });
  // Emotes aus dem Season Pass / Shop als extra Schnellknöpfe
  void myEmotes().then((list) => {
    const bar = body.querySelector(".chat-quick");
    if (!bar || !list.length) return;
    bar.insertAdjacentHTML(
      "beforeend",
      list.map((x) => `<button class="chip sp-emote-chip" data-emote="${esc(`${x.e} ${x.t}`.trim())}" title="Emote">${esc(x.e)}</button>`).join(""),
    );
  });
  list.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-msg]");
    if (!b) return;
    const m = msgs.get(Number(b.dataset.msg));
    if (!m) return;
    openMsgMenu(m, leader, mutes, () => {
      saveMutes(mutes);
      void pull().then(draw);
    }, h);
  });
}

function openMsgMenu(m: ClanMessage, leader: boolean, mutes: Set<string>, done: () => void, h: ClanHandlers) {
  const name = m.username ?? "";
  const isMuted = mutes.has(name);
  modal(
    `<h2 class="modal-title">Nachricht</h2>
     <p class="msg-quote">„${esc(m.body ?? "")}“<br><small class="muted">${esc(name)} · ${chatTime(m.at)}</small></p>
     <div class="modal-actions">
       ${m.is_me ? "" : `<button class="btn" data-m="profile">👤 Profil von ${esc(name)}</button>`}
       ${m.is_me ? "" : `<button class="btn" data-m="report">🚩 Melden</button>`}
       ${m.is_me ? "" : `<button class="btn" data-m="ignore">${isMuted ? "🔊 Nicht mehr ausblenden" : `🔇 ${esc(name)} für mich stummschalten`}</button>`}
       ${m.is_me || leader ? `<button class="btn" data-m="delete">🗑️ Löschen</button>` : ""}
       ${leader && !m.is_me ? `<button class="btn" data-m="mute1">⏳ Im Clan stummschalten (1 Std.)</button><button class="btn" data-m="mute24">⏳ Im Clan stummschalten (24 Std.)</button>` : ""}
       <button class="btn ghost" data-close>Abbrechen</button>
     </div>`,
    (el, close) => {
      el.addEventListener("click", async (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
        if (!b) return;
        try {
          switch (b.dataset.m) {
            case "profile":
              close();
              return h.openPlayer(name);
            case "report": {
              const r = await reportClanMessage(m.id, "chat");
              toast(r.hidden ? "Gemeldet – die Nachricht ist ausgeblendet." : "Danke! Die Nachricht wurde gemeldet.");
              break;
            }
            case "ignore":
              if (isMuted) mutes.delete(name);
              else mutes.add(name);
              toast(isMuted ? `${name} wird wieder angezeigt` : `${name} ist für dich stummgeschaltet`);
              break;
            case "delete":
              await hideClanMessage(m.id);
              toast("Nachricht gelöscht");
              break;
            case "mute1":
            case "mute24":
              await muteClanMember(name, b.dataset.m === "mute1" ? 1 : 24);
              toast(`${name} ist im Clan-Chat stummgeschaltet`);
              break;
          }
          close();
          done();
        } catch (ex) {
          toast(errMsg(ex));
        }
      });
    },
  );
}

// =====================================================================
// Mitglieder, Einladen, Anfragen
// =====================================================================

function renderMembers(body: HTMLElement, d: MyClan, h: ClanHandlers) {
  const leader = d.role === "leader";
  const members = d.members ?? [];
  const invited = new Set((d.invited ?? []).map((x) => x.toLowerCase()));
  body.innerHTML = `
    <section class="card-sec">
      <h2 class="sec-title"><label for="inv-name">Spieler einladen</label></h2>
      <form class="inv-form" id="inv-form"><input id="inv-name" placeholder="Spielername" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="16"><button class="btn primary" type="submit">Einladen</button></form>
      <div id="inv-friends"></div>
      <div class="inv-link" id="inv-link">
        <p class="field-label">Oder per Link – wer ihn öffnet, kann direkt beitreten</p>
        <div class="row"><button class="btn sm primary" type="button" data-c="link-share">🔗 Einladungslink teilen</button>${leader ? `<button class="btn sm ghost" type="button" data-c="link-reset">Neuer Link</button>` : ""}</div>
        <p class="muted small" id="inv-link-url"></p>
      </div>
    </section>
    ${
      leader && d.requests?.length
        ? `<section><h2 class="sec-title">Beitrittsanfragen (${d.requests.length})</h2><div class="list">${d.requests
            .map((r) => {
              const l = leagueById(r.league);
              return `<div class="row-item"><span class="nm">${esc(r.username)}<small style="--lc:${l.color}">${l.emoji} ${l.name} · ${formatTrophies(r.trophies)} 🏆</small></span>
                <span class="row-actions"><button class="btn small primary" data-c="req-yes" data-name="${esc(r.username)}">Annehmen</button><button class="btn small ghost" data-c="req-no" data-name="${esc(r.username)}" aria-label="Ablehnen">✕</button></span></div>`;
            })
            .join("")}</div></section>`
        : ""
    }
    <section>
      <h2 class="sec-title">Mitglieder (${members.length}/${d.clan!.max_members ?? CLAN_MAX})</h2>
      <div class="list">${members
        .map((m) => {
          const l = leagueById(m.league);
          return `<div class="row-item member ${m.is_me ? "me" : ""}">
            <button class="nm-btn" data-player="${esc(m.username)}"><span class="nm">${m.role === "leader" ? "👑 " : ""}${esc(m.username)}${m.is_me ? " (du)" : ""}${m.muted ? " 🔇" : ""}<small style="--lc:${l.color}">${l.emoji} ${l.name} · ${fmtScore(m.xp_week)} XP diese Woche</small></span></button>
            ${leader && !m.is_me ? `<button class="icon-btn small" data-c="manage" data-name="${esc(m.username)}" aria-label="${esc(m.username)} verwalten">⋯</button>` : ""}
          </div>`;
        })
        .join("")}</div>
      ${d.invited?.length ? `<p class="muted small">Eingeladen: ${d.invited.map(esc).join(", ")}</p>` : ""}
    </section>`;

  // Freunde, die noch in keinem Clan sind, direkt einladen
  void (async () => {
    const box = body.querySelector<HTMLElement>("#inv-friends")!;
    try {
      const f = await getFriends();
      const memberNames = new Set(members.map((m) => m.username.toLowerCase()));
      const cand = f.friends.filter((x) => !memberNames.has(x.username.toLowerCase()));
      if (!box.isConnected || !cand.length) return;
      box.innerHTML = `<p class="field-label">Deine Freunde</p><div class="list">${cand
        .slice(0, 30)
        .map(
          (x) => `<div class="row-item"><span class="nm">${esc(x.username)}</span>${
            invited.has(x.username.toLowerCase())
              ? `<span class="pill">Eingeladen</span>`
              : `<button class="btn small" data-c="invite" data-name="${esc(x.username)}">Einladen</button>`
          }</div>`,
        )
        .join("")}</div>`;
    } catch {
      /* Freunde sind optional */
    }
  })();

  const invite = async (name: string, btn?: HTMLElement) => {
    try {
      const r = await inviteToClan(name);
      toast(r.status === "joined" ? `${name} ist jetzt im Clan 🎉` : `${name} wurde eingeladen ✉️`);
      if (btn) btn.outerHTML = `<span class="pill">Eingeladen</span>`;
      if (r.status === "joined") h.rerender();
      return true;
    } catch (e) {
      toast(errMsg(e));
      return false;
    }
  };
  body.querySelector<HTMLFormElement>("#inv-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = body.querySelector<HTMLInputElement>("#inv-name")!;
    if (inp.value.trim() && (await invite(inp.value.trim()))) inp.value = "";
  });
  body.addEventListener("click", async (e) => {
    const p = (e.target as HTMLElement).closest<HTMLElement>("[data-player]");
    if (p) return h.openPlayer(p.dataset.player!);
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-c]");
    if (!b) return;
    const name = b.dataset.name ?? "";
    try {
      switch (b.dataset.c) {
        case "invite":
          return void invite(name, b);
        case "req-yes":
          await respondClanRequest(name, true);
          toast(`${name} ist jetzt im Clan 🎉`);
          h.refreshBadges();
          return h.rerender();
        case "req-no":
          await respondClanRequest(name, false);
          h.refreshBadges();
          return h.rerender();
        case "manage":
          return openManage(name, members.find((m) => m.username === name)?.muted ?? false, h);
        case "link-share": {
          const inv = await getClanInvite();
          const url = clanInviteUrl(h.publicBase(), inv.code);
          body.querySelector("#inv-link-url")!.textContent = url;
          await h.share(`Komm in meinen ZWIP-Clan „${d.clan!.name}“ 🛡️ ${url}`);
          return;
        }
        case "link-reset":
          return confirmTap(b, "Sicher? Alter Link geht dann nicht mehr", async () => {
            try {
              const inv = await resetClanInvite();
              body.querySelector("#inv-link-url")!.textContent = clanInviteUrl(h.publicBase(), inv.code);
              toast("Neuer Link erstellt – der alte gilt nicht mehr 🔒");
              b.textContent = "Neuer Link";
              delete b.dataset.armed;
            } catch (ex) {
              toast(errMsg(ex));
            }
          });
      }
    } catch (ex) {
      toast(errMsg(ex));
    }
  });
}

function openManage(name: string, muted: boolean, h: ClanHandlers) {
  modal(
    `<h2 class="modal-title">${esc(name)}</h2>
     <div class="modal-actions">
       <button class="btn" data-m="profile">👤 Profil ansehen</button>
       <button class="btn" data-m="leader">👑 Zum Leiter machen</button>
       ${muted ? `<button class="btn" data-m="unmute">🔊 Stummschaltung aufheben</button>` : `<button class="btn" data-m="mute24">🔇 24 Std. stummschalten</button><button class="btn" data-m="mute168">🔇 7 Tage stummschalten</button>`}
       <button class="btn danger" data-m="kick">Aus dem Clan entfernen</button>
       <button class="btn ghost" data-close>Abbrechen</button>
     </div>`,
    (el, close) => {
      el.addEventListener("click", async (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
        if (!b) return;
        try {
          switch (b.dataset.m) {
            case "profile":
              close();
              return h.openPlayer(name);
            case "leader":
              return confirmTap(b, "Wirklich? Nochmal tippen", async () => {
                await transferClanLeader(name);
                toast(`${name} leitet jetzt den Clan 👑`);
                close();
                h.rerender();
              });
            case "kick":
              return confirmTap(b, "Wirklich entfernen? Nochmal tippen", async () => {
                await kickClanMember(name);
                toast(`${name} wurde entfernt`);
                close();
                h.rerender();
              });
            case "unmute":
            case "mute24":
            case "mute168":
              await muteClanMember(name, b.dataset.m === "unmute" ? 0 : b.dataset.m === "mute24" ? 24 : 168);
              toast(b.dataset.m === "unmute" ? "Stummschaltung aufgehoben" : `${name} ist stummgeschaltet`);
              close();
              return h.rerender();
          }
        } catch (ex) {
          toast(errMsg(ex));
        }
      });
    },
  );
}

// =====================================================================
// Einstellungen (Leiter) + Verlassen
// =====================================================================

function renderSettings(body: HTMLElement, d: MyClan, h: ClanHandlers) {
  const c = d.clan!;
  const leader = d.role === "leader";
  const sel = { emblem: c.emblem, color: c.color, frame: c.frame };
  body.innerHTML = `
    ${
      leader
        ? `<form class="clan-form card-sec" id="cs-form" novalidate>
      <h2 class="sec-title">Clan gestalten</h2>
      <div class="clan-preview" id="cp">${emblemHtml(sel, "l")}<b>${esc(c.name)}</b></div>
      ${pickerHtml(c.level, sel, true)}
      <label class="field"><span class="field-label">Beschreibung</span><textarea id="cs-desc" maxlength="160" rows="2">${esc(c.description)}</textarea></label>
      ${modeHtml(c.join_mode)}
      <button class="btn primary big" type="submit">Speichern</button>
    </form>`
        : `<section class="card-sec"><p class="muted">Nur ${esc(c.leader ?? "der Leiter")} kann Wappen, Farbe und Beitritt einstellen.</p><p class="muted small">Beitritt: ${esc(joinModeLabel(c.join_mode))}</p></section>`
    }
    <section class="card-sec">
      <h2 class="sec-title">Clan verlassen</h2>
      <p class="muted small">${leader ? (c.members > 1 ? "Als Leiter gibst du die Leitung automatisch an das aktivste Mitglied ab." : "Du bist das letzte Mitglied – der Clan wird aufgelöst.") : "Deine gesammelten XP bleiben beim Clan."}</p>
      <button class="btn danger" data-c="leave">Clan verlassen</button>
    </section>`;
  const form = body.querySelector<HTMLFormElement>("#cs-form");
  if (form) {
    bindPicker(form, sel, () => (form.querySelector("#cp")!.innerHTML = `${emblemHtml(sel, "l")}<b>${esc(c.name)}</b>`));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const jm = (form.querySelector<HTMLInputElement>('input[name="jm"]:checked')?.value ?? c.join_mode) as JoinMode;
        await updateClan(sel.emblem, sel.color, sel.frame, form.querySelector<HTMLTextAreaElement>("#cs-desc")!.value, jm);
        toast("Gespeichert ✓");
        h.rerender();
      } catch (ex) {
        toast(errMsg(ex));
      }
    });
  }
  body.querySelector<HTMLElement>('[data-c="leave"]')!.addEventListener("click", (e) => {
    confirmTap(e.currentTarget as HTMLElement, "Wirklich verlassen? Nochmal tippen", async () => {
      try {
        await leaveClan();
        toast("Du hast den Clan verlassen");
        h.go("clan");
      } catch (ex) {
        toast(errMsg(ex));
      }
    });
  });
}

// =====================================================================
// Clan-Rangliste (für den Ranglisten-Tab)
// =====================================================================

export const CLAN_PERIODS: [string, string][] = [
  ["day", "Heute"],
  ["week", "Woche"],
  ["month", "Monat"],
  ["season", "Saison"],
  ["all", "Gesamt"],
];

export async function renderClanBoard(list: HTMLElement, period: string, h: Pick<ClanHandlers, "go">) {
  list.innerHTML = `<div class="empty">Lädt…</div>`;
  try {
    const b = await getClanBoard(period);
    if (!list.isConnected) return;
    if (!b.rows.length) {
      list.innerHTML = `<div class="empty">Noch keine Clans.<br><a class="link-btn" href="#/clan">Gründe den ersten ›</a></div>`;
      return;
    }
    const top = b.rows.filter((r) => r.rank <= 50);
    const extra = b.rows.filter((r) => r.rank > 50);
    const row = (r: (typeof b.rows)[number]) =>
      `<button class="row-item trow ${r.is_mine ? "me" : ""}" data-clan="${r.id}"><span class="rk">${["🥇", "🥈", "🥉"][r.rank - 1] ?? r.rank}</span>${emblemHtml(r, "s")}<span class="nm">${esc(r.name)}${r.is_mine ? " (dein Clan)" : ""}<small>Level ${r.level} · 👥 ${r.members}</small></span><b class="score-cell">${fmtScore(r.points)}<small>XP</small></b></button>`;
    list.innerHTML = `<div class="list">${top.map(row).join("")}${extra.length ? `<div class="wr-gap" aria-hidden="true">⋯</div>${extra.map(row).join("")}` : ""}</div>
      <p class="muted center small">${b.total} ${b.total === 1 ? "Clan" : "Clans"} · gezählt werden die XP aus Minigames und Challenges im Zeitraum</p>`;
    list.querySelectorAll<HTMLElement>("[data-clan]").forEach((el) => el.addEventListener("click", () => h.go(`clan/c/${el.dataset.clan}`)));
  } catch (e) {
    if (list.isConnected) list.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
  }
}

// =====================================================================
// Clan-Liga (XP pro aktivem Mitglied)
// =====================================================================

async function mountLeague(box: HTMLElement) {
  try {
    const lg = await getClanLeague();
    if (!box.isConnected) return;
    const cur = clanLeague(lg.league);
    const next = clanLeague(lg.next_league);
    const idx = CLAN_LEAGUES.findIndex((l) => l.id === cur.id);
    const up = CLAN_LEAGUES[idx + 1];
    const trend =
      next.id === cur.id
        ? up
          ? `Noch <b>${fmtScore(Math.max(0, up.min - lg.per_member))} XP pro Mitglied</b> bis ${up.emoji} ${up.name}`
          : "Ihr seid ganz oben 🔥"
        : CLAN_LEAGUES.findIndex((l) => l.id === next.id) > idx
          ? `Auf Kurs: nächste Woche ${next.emoji} <b>${next.name}</b> 🚀`
          : `Achtung: nächste Woche droht ${next.emoji} ${next.name}`;
    box.innerHTML = `<button class="league-card" type="button" style="--lc:${cur.color}">
        <span class="league-emo" aria-hidden="true">${cur.emoji}</span>
        <span class="league-txt"><small>Clan-Liga diese Woche</small><b>${cur.name}-Liga · Platz ${lg.my_rank} von ${lg.clans_in_league}</b>
        <small>${fmtScore(lg.per_member)} XP pro aktivem Mitglied (${lg.active} aktiv) · ${trend}</small></span>
        <i class="mc-go" aria-hidden="true">›</i>
      </button>`;
    box.querySelector("button")!.addEventListener("click", () => openLeagueTable(lg));
  } catch {
    box.innerHTML = "";
  }
}

function openLeagueTable(lg: Awaited<ReturnType<typeof getClanLeague>>) {
  const cur = clanLeague(lg.league);
  modal(
    `<h2 class="modal-title">${cur.emoji} ${cur.name}-Liga</h2>
     <p class="muted small">Gezählt werden die XP pro aktivem Mitglied in dieser Woche – so haben kleine und große Clans die gleiche Chance. Am Montag geht es je nach Wert auf oder ab.</p>
     <div class="list league-list">${lg.rows
       .map((r) => {
         const tgt = clanLeagueFor(r.per_member);
         return `<div class="row-item ${r.is_mine ? "me" : ""}"><span class="rk">${["🥇", "🥈", "🥉"][r.rank - 1] ?? r.rank}</span>${emblemHtml(r, "s")}<span class="nm">${esc(r.name)}<small>👥 ${r.active} aktiv · Level ${r.level}${tgt.id !== cur.id ? ` · → ${tgt.emoji}` : ""}</small></span><b class="score-cell">${fmtScore(r.per_member)}<small>XP/Kopf</small></b></div>`;
       })
       .join("")}</div>
     <p class="muted small">Ligen: ${CLAN_LEAGUES.map((l) => `${l.emoji} ${l.name} ab ${fmtScore(l.min)}`).join(" · ")}</p>
     <div class="modal-actions"><button class="btn primary" type="button" data-close>Schließen</button></div>`,
  );
}

// =====================================================================
// Beitritt über Einladungslink (?clan=CODE)
// =====================================================================

export async function openClanInvite(code: string, h: Pick<ClanHandlers, "hasName" | "askName" | "go">) {
  let c: Awaited<ReturnType<typeof clanByInvite>>;
  try {
    c = await clanByInvite(code);
  } catch (e) {
    toast(errMsg(e));
    return;
  }
  if (c.in_this_clan) {
    toast(`Du bist schon im Clan „${c.name}“ 🛡️`);
    h.go("clan");
    return;
  }
  modal(
    `<div class="clan-invite">
      ${emblemHtml(c, "l")}
      <h2 class="modal-title">Einladung in „${esc(c.name)}“</h2>
      <p class="muted">Level ${c.level} · 👥 ${c.members}/${c.max_members}${c.leader ? ` · 👑 ${esc(c.leader)}` : ""}</p>
      ${c.description ? `<p>${esc(c.description)}</p>` : ""}
      ${c.in_a_clan ? `<p class="notice warn">Du bist schon in einem anderen Clan. Verlass ihn zuerst, wenn du wechseln willst.</p>` : ""}
      <div class="inline-error" id="ci-err" role="alert" hidden></div>
      <div class="modal-actions">
        ${c.in_a_clan ? `<button class="btn primary" type="button" data-ci="mine">Zu meinem Clan</button>` : `<button class="btn primary" type="button" data-ci="join">Beitreten 🛡️</button>`}
        <button class="btn ghost" type="button" data-close>Später</button>
      </div>
    </div>`,
    (el, close) => {
      el.parentElement!.dataset.keep = "1";
      el.querySelector('[data-ci="mine"]')?.addEventListener("click", () => {
        close();
        h.go("clan");
      });
      const join = el.querySelector<HTMLButtonElement>('[data-ci="join"]');
      join?.addEventListener("click", () => {
        const go = async () => {
          join.disabled = true;
          try {
            await joinClanByInvite(code);
            close();
            toast(`Willkommen bei „${c.name}“ 🎉`);
            h.go("clan");
          } catch (e) {
            const err = el.querySelector<HTMLElement>("#ci-err")!;
            err.textContent = errMsg(e);
            err.hidden = false;
            join.disabled = false;
          }
        };
        if (h.hasName()) void go();
        else h.askName(() => void go());
      });
    },
  );
}
