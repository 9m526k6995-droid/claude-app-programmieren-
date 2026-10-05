// Freunde: Spieler suchen, Anfragen senden/annehmen/ablehnen, Freunde ansehen und entfernen.

import { esc, toast } from "./ui";
import { formatTrophies, leagueById } from "./trophies";
import {
  getFriends,
  searchPlayers,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  SocialError,
  type FriendsData,
  type PlayerInfo,
  type SearchHit,
} from "./social";
import { playerModal } from "./trophyUi";

export interface FriendsHandlers {
  /** Ohne onBack wird die Liste ohne eigene Kopfzeile eingebaut (Tab „Freunde“) */
  onBack?: () => void;
  hasName: () => boolean;
  askName: (then: () => void) => void;
}

const errMsg = (e: unknown) => (e instanceof SocialError ? e.message : "Da ist etwas schiefgelaufen.");

function who(p: PlayerInfo, extra = ""): string {
  const l = leagueById(p.league);
  return `<span class="nm">${esc(p.username)}<small style="--lc:${l.color}">${l.emoji} ${l.name} · ${formatTrophies(p.trophies)} 🏆${extra}</small></span>`;
}

export function renderFriends(app: HTMLElement, h: FriendsHandlers) {
  app.innerHTML = `
  <div class="${h.onBack ? "screen " : ""}friends">
    ${
      h.onBack
        ? `<header class="topbar">
      <button class="icon-btn" data-f="back" aria-label="Zurück">←</button>
      <span class="mode-tag">Freunde</span>
      <span class="icon-btn ghost-slot"></span>
    </header>`
        : ""
    }
    ${h.hasName() ? "" : `<button class="name-banner" data-f="name"><b>Wähle zuerst deinen Spielernamen</b><span>Damit dich Freunde finden können →</span></button>`}
    <div class="fr-search">
      <h2 class="sec-title"><label for="fr-q">Spieler suchen</label></h2>
      <input id="fr-q" type="search" placeholder="Spielername eingeben" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      <div id="fr-results" class="list" aria-live="polite"></div>
    </div>
    <div id="fr-body" class="fr-body"><div class="empty">Lädt…</div></div>
  </div>`;

  const body = app.querySelector<HTMLElement>("#fr-body")!;
  const results = app.querySelector<HTMLElement>("#fr-results")!;
  const q = app.querySelector<HTMLInputElement>("#fr-q")!;
  if (h.onBack) app.querySelector('[data-f="back"]')!.addEventListener("click", h.onBack);
  app.querySelector('[data-f="name"]')?.addEventListener("click", () => h.askName(() => renderFriends(app, h)));

  const needName = (then: () => void) => {
    if (h.hasName()) then();
    else h.askName(() => renderFriends(app, h));
  };

  // ----- Liste laden -----
  const load = async () => {
    let d: FriendsData;
    try {
      d = await getFriends();
    } catch (e) {
      body.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
      return;
    }
    const incoming = d.incoming
      .map(
        (p) => `<div class="row-item fr-row">${who(p)}
          <span class="fr-actions">
            <button class="btn sm primary" data-accept="${esc(p.username)}">Annehmen</button>
            <button class="btn sm ghost" data-decline="${esc(p.username)}" aria-label="Ablehnen">✕</button>
          </span></div>`,
      )
      .join("");
    const friends = d.friends
      .map(
        (p, i) => `<button class="row-item fr-row fr-friend" data-friend="${esc(p.username)}">
          <span class="rk">${i + 1}</span>${who(p, p.world_rank ? ` · Welt #${p.world_rank}` : "")}
          <b>${formatTrophies(p.trophies)}</b></button>`,
      )
      .join("");
    const outgoing = d.outgoing
      .map(
        (p) => `<div class="row-item fr-row">${who(p)}
          <span class="fr-actions"><button class="btn sm ghost" data-cancel="${esc(p.username)}">Zurückziehen</button></span></div>`,
      )
      .join("");
    body.innerHTML = `
      ${incoming ? `<section><h4>Anfragen <span class="pill-count">${d.incoming.length}</span></h4><div class="list">${incoming}</div></section>` : ""}
      <section><h4>Deine Freunde <span class="muted">(${d.friends.length})</span></h4>
        <div class="list">${friends || `<div class="empty">Noch keine Freunde. Such oben nach einem Spielernamen und schick eine Anfrage!</div>`}</div>
      </section>
      ${outgoing ? `<section><h4>Gesendete Anfragen</h4><div class="list">${outgoing}</div></section>` : ""}`;

    body.querySelectorAll<HTMLElement>("[data-accept]").forEach((b) =>
      b.addEventListener("click", () => act(() => respondFriendRequest(b.dataset.accept!, true), `${b.dataset.accept} ist jetzt dein Freund 🎉`)),
    );
    body.querySelectorAll<HTMLElement>("[data-decline]").forEach((b) =>
      b.addEventListener("click", () => act(() => respondFriendRequest(b.dataset.decline!, false), "Anfrage abgelehnt")),
    );
    body.querySelectorAll<HTMLElement>("[data-cancel]").forEach((b) =>
      b.addEventListener("click", () => act(() => removeFriend(b.dataset.cancel!), "Anfrage zurückgezogen")),
    );
    body.querySelectorAll<HTMLElement>("[data-friend]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = d.friends.find((f) => f.username === b.dataset.friend)!;
        playerModal(p, {
          action: {
            label: "Freund entfernen",
            confirm: "Wirklich entfernen? Nochmal tippen",
            danger: true,
            run: () => act(() => removeFriend(p.username), `${p.username} entfernt`),
          },
        });
      }),
    );
  };

  const act = async <T>(fn: () => Promise<T>, ok: string | ((r: T) => string)) => {
    try {
      const r = await fn();
      toast(typeof ok === "function" ? ok(r) : ok);
    } catch (e) {
      toast(errMsg(e));
    }
    await load();
    if (q.value.trim().length >= 2) await search();
  };

  // ----- Suche -----
  let searchTimer = 0;
  let searchSeq = 0;
  const search = async () => {
    const term = q.value.trim();
    const seq = ++searchSeq;
    if (term.length < 2) {
      results.innerHTML = term ? `<p class="muted hint">Mindestens 2 Zeichen eingeben.</p>` : "";
      return;
    }
    let hits: SearchHit[];
    try {
      hits = await searchPlayers(term);
    } catch (e) {
      if (seq === searchSeq) results.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
      return;
    }
    if (seq !== searchSeq) return;
    results.innerHTML = hits.length
      ? hits
          .map((p) => {
            const btn =
              p.relation === "friend"
                ? `<span class="fr-state">Freund ✓</span>`
                : p.relation === "outgoing"
                  ? `<span class="fr-state">Angefragt</span>`
                  : p.relation === "incoming"
                    ? `<button class="btn sm primary" data-accept-hit="${esc(p.username)}">Annehmen</button>`
                    : `<button class="btn sm primary" data-add="${esc(p.username)}">Hinzufügen</button>`;
            return `<div class="row-item fr-row">${who(p)}<span class="fr-actions">${btn}</span></div>`;
          })
          .join("")
      : `<p class="muted hint">Keinen Spieler gefunden.</p>`;
    results.querySelectorAll<HTMLElement>("[data-add]").forEach((b) =>
      b.addEventListener("click", () =>
        needName(() =>
          act(
            () => sendFriendRequest(b.dataset.add!),
            (r) => (r.status === "accepted" ? `${b.dataset.add} hatte dich schon angefragt – ihr seid jetzt Freunde 🎉` : "Anfrage gesendet ✉️"),
          ),
        ),
      ),
    );
    results.querySelectorAll<HTMLElement>("[data-accept-hit]").forEach((b) =>
      b.addEventListener("click", () => act(() => respondFriendRequest(b.dataset.acceptHit!, true), `${b.dataset.acceptHit} ist jetzt dein Freund 🎉`)),
    );
  };
  q.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(search, 300);
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      void search();
    }
  });

  void load();
}
