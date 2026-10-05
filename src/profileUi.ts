// Profil-Popups: das eigene Profil (Bild, Link, Konto) und fremde Profile (per Direktlink oder aus Listen).

import { esc, modal, toast } from "./ui";
import { changePassword, changeEmail, currentUser, AuthError, MIN_PASSWORD } from "./auth";
import { formatTrophies, leagueById } from "./trophies";
import { leagueBadge } from "./trophyUi";
import {
  getMyProfileCard,
  setAvatar,
  getPlayerProfile,
  sendFriendRequest,
  respondFriendRequest,
  SocialError,
  type ProfileCard,
} from "./social";
import { flag, countryName } from "./countries";
import { avatarHtml, profileLink, shareLink, copyLink, memberSince, fileToAvatar, AvatarError } from "./profileKit";

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : "Da ist etwas schiefgelaufen.");

function statsHtml(p: ProfileCard): string {
  return `<dl class="pm-stats pf-stats">
    <div><dt>Trophäen</dt><dd>${formatTrophies(p.trophies ?? 0)} 🏆</dd></div>
    <div><dt>Weltrang</dt><dd>${p.world_rank ? `#${p.world_rank}` : "–"}</dd></div>
    <div><dt>Höchststand</dt><dd>${formatTrophies(Math.max(p.best_trophies ?? 0, p.trophies ?? 0))}</dd></div>
    <div><dt>Beste Serie</dt><dd>🔥 ${p.best_streak ?? 0}</dd></div>
  </dl>`;
}

function headHtml(p: ProfileCard, avatarSlot: string, title: string): string {
  const l = leagueById(p.league);
  const since = memberSince(p.member_since);
  return `<div class="pm-head pf-head" style="--lc:${l.color}">
      ${avatarSlot}
      <h3>${p.country ? `<span class="flag" title="${esc(countryName(p.country))}">${flag(p.country)}</span> ` : ""}${title}</h3>
      ${leagueBadge(l)}
      ${since ? `<small class="muted pf-since">${esc(since)}${p.trophy_rounds ? ` · ${p.trophy_rounds} Trophäen-Runden` : ""}</small>` : ""}
      ${p.username ? `<div class="pf-clan" data-clan-for="${esc(p.username)}"></div>` : ""}
    </div>`;
}

function linkBox(username: string, label: string): string {
  const url = profileLink(username);
  return `<section class="pf-link">
      <span class="lbl">${label}</span>
      <div class="pf-url" title="${esc(url)}"><span aria-hidden="true">🔗</span><span class="pf-url-text">${esc(url.replace(/^https?:\/\//, ""))}</span></div>
      <div class="actions-row">
        <button class="btn primary sm" type="button" data-pf="share">Link senden 📤</button>
        <button class="btn sm" type="button" data-pf="copy">Kopieren</button>
      </div>
    </section>`;
}

function bindLink(el: HTMLElement, username: string, text: string) {
  const url = profileLink(username);
  el.querySelector('[data-pf="share"]')?.addEventListener("click", () => void shareLink(url, text));
  el.querySelector('[data-pf="copy"]')?.addEventListener("click", () => void copyLink(url));
}

// =====================================================================
// Eigenes Profil
// =====================================================================

export interface MyProfileHandlers {
  email: string;
  /** Sofort anzeigbarer Stand (Cache), bevor der Server antwortet */
  initial: ProfileCard | null;
  onAvatar: (avatar: string | null) => void;
  onRename: (then: () => void) => void;
  onSignOut: () => void;
}

/** Eigenes Profil als Popup */
export function openMyProfile(h: MyProfileHandlers) {
  modal(`<div class="pf" aria-busy="true"><div class="empty">Lädt…</div></div>`, (el, close) => {
    mountMyProfile(el.querySelector<HTMLElement>(".pf")!, h, close);
  });
}

/**
 * Eigenes Profil in ein Element einbauen – als eigener Bildschirm (ohne `close`)
 * oder im Popup (mit `close`).
 */
export function mountMyProfile(root: HTMLElement, h: MyProfileHandlers, close?: () => void) {
  {
    let card: ProfileCard | null = h.initial;
    let busy = false;

    const render = (error?: string) => {
      const p: ProfileCard = card ?? { username: "", trophies: 0, league: "anfaenger", avatar: null };
      const named = Boolean(p.username);
      root.removeAttribute("aria-busy");
      root.innerHTML = `
        ${headHtml(
          p,
          `<button class="pf-avatar-btn" type="button" data-pf="pick" aria-label="Profilbild ändern">
             ${avatarHtml(p.username || h.email, p.avatar, "pm-avatar pf-avatar")}
             <span class="pf-cam" aria-hidden="true">📷</span>
           </button>
           <input type="file" accept="image/*" id="pf-file" class="visually-hidden" tabindex="-1" aria-hidden="true">`,
          named ? esc(p.username) : `<span class="muted">Noch kein Spielername</span>`,
        )}
        ${error ? `<div class="inline-error" role="alert">${esc(error)}</div>` : ""}
        ${statsHtml(p)}
        ${
          named
            ? linkBox(p.username, "Dein Profil-Link")
            : `<button class="name-banner" type="button" data-pf="rename"><b>Wähle deinen Spielernamen</b><span>Dann bekommst du deinen eigenen Profil-Link →</span></button>`
        }
        <section class="pf-account">
          <span class="lbl">Konto</span>
          <div class="pf-list">
            <button class="pf-row" type="button" data-pf="pick"><span aria-hidden="true">🖼️</span><b>Profilbild ${p.avatar ? "ändern" : "hinzufügen"}</b><i aria-hidden="true">›</i></button>
            ${p.avatar ? `<button class="pf-row" type="button" data-pf="remove"><span aria-hidden="true">🗑️</span><b>Profilbild entfernen</b><i aria-hidden="true">›</i></button>` : ""}
            <button class="pf-row" type="button" data-pf="rename"><span aria-hidden="true">✏️</span><b>Spielername ${named ? "ändern" : "wählen"}</b><i aria-hidden="true">›</i></button>
            <button class="pf-row" type="button" data-pf="password"><span aria-hidden="true">🔒</span><b>Passwort ändern</b><i aria-hidden="true">›</i></button>
            <button class="pf-row" type="button" data-pf="email"><span aria-hidden="true">✉️</span><b>E-Mail ändern</b><em class="account-mail">${esc(currentUser()?.email || h.email)}</em><i aria-hidden="true">›</i></button>
          </div>
        </section>
        ${
          close
            ? `<div class="actions-row">
          <button class="btn ghost danger sm" type="button" data-pf="logout">Abmelden</button>
          <button class="btn ghost sm" type="button" data-close>Schließen</button>
        </div>`
            : `<button class="btn ghost danger sm" type="button" data-pf="logout">Abmelden</button>`
        }`;
      bind();
    };

    const setAvatarBusy = (on: boolean) => {
      busy = on;
      root.querySelector(".pf-avatar-btn")?.classList.toggle("loading", on);
    };

    const saveAvatar = async (avatar: string | null, ok: string) => {
      setAvatarBusy(true);
      try {
        card = await setAvatar(avatar);
        h.onAvatar(card.avatar);
        render();
        toast(ok);
      } catch (e) {
        render(errMsg(e));
      } finally {
        setAvatarBusy(false);
      }
    };

    const bind = () => {
      const file = root.querySelector<HTMLInputElement>("#pf-file")!;
      root.querySelectorAll('[data-pf="pick"]').forEach((b) =>
        b.addEventListener("click", () => {
          if (busy) return;
          file.value = "";
          file.click(); // öffnet auf dem Handy die Foto-Mediathek
        }),
      );
      file.addEventListener("change", async () => {
        const f = file.files?.[0];
        if (!f) return;
        setAvatarBusy(true);
        let data: string;
        try {
          data = await fileToAvatar(f);
        } catch (e) {
          setAvatarBusy(false);
          render(e instanceof AvatarError ? e.message : "Das Foto konnte nicht geladen werden.");
          return;
        }
        // Sofort zeigen, dann speichern
        const slot = root.querySelector(".pf-avatar");
        if (slot) slot.outerHTML = avatarHtml("", data, "pm-avatar pf-avatar");
        await saveAvatar(data, "Profilbild gespeichert 📸");
      });
      root.querySelector('[data-pf="remove"]')?.addEventListener("click", () => {
        if (!busy) void saveAvatar(null, "Profilbild entfernt");
      });
      root.querySelectorAll('[data-pf="rename"]').forEach((b) =>
        b.addEventListener("click", () => {
          if (close) {
            close();
            h.onRename(() => openMyProfile({ ...h, initial: card }));
          } else {
            h.onRename(() => root.isConnected && mountMyProfile(root, { ...h, initial: card }));
          }
        }),
      );
      root.querySelector('[data-pf="password"]')!.addEventListener("click", () => openChangePassword(currentUser()?.email || h.email));
      root.querySelector('[data-pf="email"]')!.addEventListener("click", () =>
        openChangeEmail(currentUser()?.email || h.email, () => render()),
      );
      root.querySelector('[data-pf="logout"]')!.addEventListener("click", () => {
        close?.();
        h.onSignOut();
      });
      if (card?.username) bindLink(root, card.username, `Das ist mein ZWIP-Profil – adde mich! ⚡`);
    };

    if (card) render();
    getMyProfileCard()
      .then((c) => {
        card = c;
        h.onAvatar(c.avatar);
        if (root.isConnected && !busy) render();
      })
      .catch((e) => {
        if (root.isConnected && !busy) render(errMsg(e));
      });
  }
}

// =====================================================================
// Passwort ändern
// =====================================================================

export function openChangePassword(email: string) {
  modal(
    `<form class="pf-pw" novalidate>
       <h3>Passwort ändern</h3>
       <p class="muted modal-text">Zur Sicherheit erst dein aktuelles Passwort, dann das neue mit mindestens ${MIN_PASSWORD} Zeichen.</p>
       <input type="email" name="username" autocomplete="username" value="${esc(email)}" class="visually-hidden" tabindex="-1" aria-hidden="true" readonly>
       <label class="lbl" for="pw-current">Aktuelles Passwort</label>
       <input id="pw-current" type="password" autocomplete="current-password" required enterkeyhint="next">
       <label class="lbl" for="pw-new">Neues Passwort</label>
       <div class="pw-row">
         <input id="pw-new" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required enterkeyhint="next">
         <button class="pw-toggle" type="button" data-pw="toggle" aria-label="Passwörter anzeigen" aria-pressed="false">👁️</button>
       </div>
       <label class="lbl" for="pw-new2">Neues Passwort wiederholen</label>
       <input id="pw-new2" type="password" autocomplete="new-password" required enterkeyhint="go">
       <div class="auth-error" role="alert" aria-live="assertive" hidden></div>
       <button class="btn primary" type="submit" id="pw-save">Passwort ändern</button>
       <button class="btn ghost" type="button" data-close>Abbrechen</button>
     </form>`,
    (el, close) => {
      const form = el.querySelector<HTMLFormElement>("form")!;
      const err = el.querySelector<HTMLElement>(".auth-error")!;
      const btn = el.querySelector<HTMLButtonElement>("#pw-save")!;
      const cur = el.querySelector<HTMLInputElement>("#pw-current")!;
      const nw = el.querySelector<HTMLInputElement>("#pw-new")!;
      const nw2 = el.querySelector<HTMLInputElement>("#pw-new2")!;
      const toggle = el.querySelector<HTMLButtonElement>('[data-pw="toggle"]')!;
      toggle.addEventListener("click", () => {
        const show = nw.type === "password";
        for (const i of [cur, nw, nw2]) i.type = show ? "text" : "password";
        toggle.setAttribute("aria-pressed", String(show));
        toggle.textContent = show ? "🙈" : "👁️";
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.hidden = true;
        btn.disabled = true;
        btn.textContent = "Wird geändert…";
        try {
          await changePassword(cur.value, nw.value, nw2.value);
          close();
          toast("Passwort geändert 🔒");
        } catch (x) {
          err.textContent = x instanceof AuthError ? x.message : "Da ist etwas schiefgelaufen.";
          err.hidden = false;
          btn.disabled = false;
          btn.textContent = "Passwort ändern";
          const code = x instanceof AuthError ? x.code : "";
          (code === "wrong_password" ? cur : code === "password_mismatch" ? nw2 : nw).focus();
        }
      });
      cur.focus();
    },
  );
}

// =====================================================================
// E-Mail ändern
// =====================================================================

export function openChangeEmail(current: string, onChanged: () => void) {
  modal(
    `<form class="pf-pw" novalidate>
       <h3>E-Mail ändern</h3>
       <p class="muted modal-text">Aktuell: <b>${esc(current)}</b></p>
       <input type="email" name="username" autocomplete="username" value="${esc(current)}" class="visually-hidden" tabindex="-1" aria-hidden="true" readonly>
       <label class="lbl" for="em-new">Neue E-Mail-Adresse</label>
       <input id="em-new" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required enterkeyhint="next">
       <label class="lbl" for="em-pw">Dein Passwort</label>
       <input id="em-pw" type="password" autocomplete="current-password" required enterkeyhint="go">
       <p class="hint muted">Zur Sicherheit fragen wir dein Passwort ab.</p>
       <div class="auth-error" role="alert" aria-live="assertive" hidden></div>
       <button class="btn primary" type="submit" id="em-save">E-Mail ändern</button>
       <button class="btn ghost" type="button" data-close>Abbrechen</button>
     </form>`,
    (el, close) => {
      const form = el.querySelector<HTMLFormElement>("form")!;
      const err = el.querySelector<HTMLElement>(".auth-error")!;
      const btn = el.querySelector<HTMLButtonElement>("#em-save")!;
      const mail = el.querySelector<HTMLInputElement>("#em-new")!;
      const pw = el.querySelector<HTMLInputElement>("#em-pw")!;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.hidden = true;
        btn.disabled = true;
        btn.textContent = "Wird geändert…";
        try {
          const r = await changeEmail(mail.value, pw.value);
          if (!r.pending) {
            close();
            toast("E-Mail geändert ✉️");
            onChanged();
            return;
          }
          form.innerHTML = `
            <div class="pm-head"><div class="big-emoji" aria-hidden="true">📬</div><h3>Fast geschafft!</h3></div>
            <p class="modal-text">Wir haben dir einen Bestätigungs-Link an <b>${esc(r.email)}</b> geschickt. Schau auch im Spam-Ordner nach.</p>
            <p class="muted modal-text">Erst nach dem Klick auf den Link gilt die neue Adresse. Je nach Einstellung kommt auch an deine alte Adresse eine Mail, die du bestätigen musst. Bis dahin meldest du dich weiter mit <b>${esc(current)}</b> an.</p>
            <button class="btn primary" type="button" data-close>Alles klar</button>`;
        } catch (x) {
          err.textContent = x instanceof AuthError ? x.message : "Da ist etwas schiefgelaufen.";
          err.hidden = false;
          btn.disabled = false;
          btn.textContent = "E-Mail ändern";
          (x instanceof AuthError && x.code === "wrong_password" ? pw : mail).focus();
        }
      });
      mail.focus();
    },
  );
}

// =====================================================================
// Fremdes Profil (Direktlink ?p=Name)
// =====================================================================

export interface PlayerProfileHandlers {
  hasName: () => boolean;
  askName: (then: () => void) => void;
  openSelf: () => void;
}

export function openPlayerProfile(username: string, h: PlayerProfileHandlers) {
  modal(`<div class="pf" aria-busy="true"><div class="empty">Profil von <b>${esc(username)}</b> lädt…</div></div>`, (el, close) => {
    const root = el.querySelector<HTMLElement>(".pf")!;

    const render = (p: ProfileCard, note?: string) => {
      root.removeAttribute("aria-busy");
      const action =
        p.relation === "friend"
          ? `<div class="pf-state">✓ Ihr seid befreundet</div>`
          : p.relation === "outgoing"
            ? `<div class="pf-state">✉️ Anfrage gesendet</div>`
            : p.relation === "incoming"
              ? `<button class="btn primary" type="button" data-pp="accept">Anfrage annehmen</button>`
              : `<button class="btn primary" type="button" data-pp="add">Freund hinzufügen ➕</button>`;
      root.innerHTML = `
        ${headHtml(p, avatarHtml(p.username, p.avatar, "pm-avatar pf-avatar"), esc(p.username))}
        ${note ? `<div class="inline-error" role="alert">${esc(note)}</div>` : ""}
        ${statsHtml(p)}
        ${action}
        ${linkBox(p.username, "Profil-Link")}
        <button class="btn ghost" type="button" data-close>Schließen</button>`;
      bindLink(root, p.username, `Schau dir ${p.username} auf ZWIP an ⚡`);
      const run = async (fn: () => Promise<{ status: string }>, ok: (s: string) => string) => {
        root.querySelectorAll<HTMLButtonElement>("[data-pp]").forEach((b) => (b.disabled = true));
        try {
          const r = await fn();
          toast(ok(r.status));
          load();
        } catch (e) {
          render(p, e instanceof SocialError ? e.message : errMsg(e));
        }
      };
      root.querySelector('[data-pp="add"]')?.addEventListener("click", () => {
        const go = () =>
          void run(
            () => sendFriendRequest(p.username),
            (s) => (s === "accepted" ? `Ihr seid jetzt Freunde 🎉` : "Anfrage gesendet ✉️"),
          );
        if (h.hasName()) go();
        else {
          close();
          h.askName(() => openPlayerProfile(username, h));
        }
      });
      root.querySelector('[data-pp="accept"]')?.addEventListener("click", () =>
        void run(() => respondFriendRequest(p.username, true), () => `${p.username} ist jetzt dein Freund 🎉`),
      );
    };

    const load = () =>
      getPlayerProfile(username)
        .then((p) => {
          if (!root.isConnected) return;
          if (p.relation === "self") {
            close();
            h.openSelf();
          } else render(p);
        })
        .catch((e) => {
          if (!root.isConnected) return;
          root.removeAttribute("aria-busy");
          root.innerHTML = `<div class="pm-head"><div class="big-emoji" aria-hidden="true">🤷</div><h3>Profil nicht gefunden</h3></div>
            <div class="inline-error" role="alert">${esc(e instanceof SocialError ? e.message : errMsg(e))}</div>
            <button class="btn ghost" type="button" data-close>Schließen</button>`;
        });
    load();
  });
}
