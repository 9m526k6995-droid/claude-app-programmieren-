// Moderation für die Betreiber (#/admin): Meldungen prüfen, Spieler verwarnen/sperren, Namen zurücksetzen, Filter-Wörter pflegen.
// Der Server prüft bei jeder Aktion selbst, ob das Konto Admin ist – diese Seite ist nur die Oberfläche.

import { esc, modal, toast } from "./ui";
import {
  adminOverview,
  adminReports,
  adminMessageContext,
  adminResolveMessage,
  adminResolveReport,
  adminResolveRun,
  adminBan,
  adminWarn,
  adminResetName,
  adminResetAvatar,
  adminResetClan,
  adminPlayer,
  adminSearch,
  adminWords,
  adminSetWord,
  SocialError,
  type AdminPlayer,
} from "./social";
import { GAME_BY_ID } from "./games";

const errMsg = (e: unknown) => (e instanceof SocialError ? e.message : "Da ist etwas schiefgelaufen.");
const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const KIND: Record<string, string> = { name: "Spielername", avatar: "Profilbild", highscore: "Highscore", other: "Sonstiges" };
const FLAG: Record<string, string> = {
  "hard:impossible_speed": "Unmögliche Reaktionszeit",
  "hard:too_many_runs": "Zu viele Läufe pro Stunde",
  "soft:perfect_run": "Sehr langer, perfekter Lauf",
};

export async function renderAdmin(page: HTMLElement, tab: string | undefined, go: (path: string) => void) {
  const t = tab === "spieler" || tab === "filter" ? tab : "meldungen";
  page.innerHTML = `<div id="adm-over" class="adm-over"><div class="empty">Lädt…</div></div>
    <nav class="seg" aria-label="Moderation">
      <a href="#/admin" class="${t === "meldungen" ? "on" : ""}">Meldungen</a>
      <a href="#/admin/spieler" class="${t === "spieler" ? "on" : ""}">Spieler</a>
      <a href="#/admin/filter" class="${t === "filter" ? "on" : ""}">Filter</a>
    </nav>
    <div id="adm-body"><div class="empty">Lädt…</div></div>`;
  const over = page.querySelector<HTMLElement>("#adm-over")!;
  const body = page.querySelector<HTMLElement>("#adm-body")!;
  try {
    const o = await adminOverview();
    over.innerHTML = [
      ["👥", "Spieler", o.players],
      ["🛡️", "Clans", o.clans],
      ["💬", "Chat-Meldungen", o.open_chat],
      ["🚩", "Spieler-Meldungen", o.open_players],
      ["🕵️", "Verdächtige Läufe", o.open_runs],
      ["🚫", "Gesperrt", o.banned],
    ]
      .map(([i, l, n]) => `<div class="adm-stat ${Number(n) > 0 && ["Chat-Meldungen", "Spieler-Meldungen", "Verdächtige Läufe"].includes(String(l)) ? "hot" : ""}"><span>${i}</span><b>${n}</b><small>${l}</small></div>`)
      .join("");
  } catch (e) {
    page.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div><p class="muted">Diese Seite ist nur für Admins.</p>`;
    return;
  }
  const refresh = () => renderAdmin(page, tab, go);
  if (t === "spieler") return renderPlayers(body, refresh);
  if (t === "filter") return renderWords(body);
  return renderReports(body, refresh);
}

// ---------- Meldungen ----------

async function renderReports(body: HTMLElement, refresh: () => void) {
  try {
    const r = await adminReports();
    if (!body.isConnected) return;
    body.innerHTML = `
      <section><h2 class="sec-title">Chat-Meldungen (${r.chat.length})</h2>
      ${
        r.chat.length
          ? r.chat
              .map(
                (m) => `<div class="adm-card">
          <div class="adm-head"><b>${esc(m.username ?? "?")}</b>${m.banned ? ` <span class="pill">gesperrt</span>` : ""}<small>${esc(m.clan ?? "")} · ${when(m.at)} · ${m.reports}× gemeldet${m.hidden ? " · ausgeblendet" : ""}</small></div>
          <p class="adm-quote">„${esc(m.body)}“</p>
          <div class="adm-actions">
            <button class="btn small" data-a="ctx" data-id="${m.id}">Verlauf</button>
            <button class="btn small danger" data-a="hide" data-id="${m.id}">Ausblenden ✓</button>
            <button class="btn small" data-a="keep" data-id="${m.id}">Ist ok ✓</button>
            ${m.username ? `<button class="btn small" data-a="player" data-name="${esc(m.username)}">Spieler…</button>` : ""}
          </div></div>`,
              )
              .join("")
          : `<div class="empty">Keine offenen Chat-Meldungen 🎉</div>`
      }</section>
      <section><h2 class="sec-title">Spieler-Meldungen (${r.players.length})</h2>
      ${
        r.players.length
          ? r.players
              .map(
                (p) => `<div class="adm-card">
          <div class="adm-head"><b>${esc(p.target)}</b>${p.banned ? ` <span class="pill">gesperrt</span>` : ""}<small>${KIND[p.kind] ?? p.kind}${p.game ? ` · ${esc(GAME_BY_ID[p.game]?.title ?? p.game)}` : ""} · ${when(p.at)} · von ${esc(p.reporter ?? "gelöscht")} · ${p.same_reports}× offen · ${p.warnings} Verwarnungen</small></div>
          ${p.detail ? `<p class="adm-quote">„${esc(p.detail)}“</p>` : ""}
          ${p.kind === "avatar" && p.avatar?.startsWith("data:image/") ? `<img class="adm-avatar" src="${p.avatar}" alt="Gemeldetes Profilbild">` : ""}
          <div class="adm-actions">
            <button class="btn small" data-a="player" data-name="${esc(p.target)}">Spieler…</button>
            <button class="btn small" data-a="done" data-id="${p.id}">Erledigt ✓</button>
            <button class="btn small ghost" data-a="dismiss" data-id="${p.id}">Unbegründet</button>
          </div></div>`,
              )
              .join("")
          : `<div class="empty">Keine offenen Spieler-Meldungen 🎉</div>`
      }</section>
      <section><h2 class="sec-title">Verdächtige Läufe (${r.runs.length})</h2>
      ${
        r.runs.length
          ? r.runs
              .map(
                (x) => `<div class="adm-card">
          <div class="adm-head"><b>${esc(x.username)}</b>${x.banned ? ` <span class="pill">gesperrt</span>` : ""}<small>${esc(GAME_BY_ID[x.game]?.title ?? x.game)} · Stufe ${x.stage} · ${x.score} Punkte · ${when(x.at)}</small></div>
          <p class="adm-quote">${esc(FLAG[x.flagged] ?? x.flagged)}${x.flagged.startsWith("soft:") ? " (zählt bereits)" : " (zählt noch nicht)"}</p>
          <div class="adm-actions">
            <button class="btn small" data-a="run-ok" data-id="${x.id}">Gültig ✓</button>
            <button class="btn small danger" data-a="run-bad" data-id="${x.id}">Ungültig ✗</button>
            <button class="btn small" data-a="player" data-name="${esc(x.username)}">Spieler…</button>
          </div></div>`,
              )
              .join("")
          : `<div class="empty">Keine verdächtigen Läufe 🎉</div>`
      }</section>`;
    body.onclick = async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
      if (!b) return;
      const id = b.dataset.id ?? "";
      try {
        switch (b.dataset.a) {
          case "ctx":
            return openContext(Number(id));
          case "hide":
            await adminResolveMessage(Number(id), true);
            break;
          case "keep":
            await adminResolveMessage(Number(id), false);
            break;
          case "done":
            await adminResolveReport(Number(id), "done");
            break;
          case "dismiss":
            await adminResolveReport(Number(id), "dismissed");
            break;
          case "run-ok":
            await adminResolveRun(id, true);
            break;
          case "run-bad":
            await adminResolveRun(id, false);
            break;
          case "player":
            return openPlayerAdmin(b.dataset.name!, refresh);
        }
        toast("Erledigt ✓");
        refresh();
      } catch (ex) {
        toast(errMsg(ex));
      }
    };
  } catch (e) {
    body.innerHTML = `<div class="inline-error">${esc(errMsg(e))}</div>`;
  }
}

async function openContext(id: number) {
  try {
    const rows = await adminMessageContext(id);
    modal(
      `<h2 class="modal-title">Chat-Verlauf</h2>
       <div class="adm-ctx">${rows
         .map((m) => `<div class="adm-ctx-row ${m.is_target ? "target" : ""}"><b>${esc(m.username ?? "System")}</b> <small>${when(m.at)}${m.hidden ? " · ausgeblendet" : ""}</small><br>${esc(m.body)}</div>`)
         .join("")}</div>
       <button class="btn ghost" data-close>Schließen</button>`,
    );
  } catch (e) {
    toast(errMsg(e));
  }
}

// ---------- Spieler ----------

function renderPlayers(body: HTMLElement, refresh: () => void) {
  body.innerHTML = `<input id="adm-q" type="search" placeholder="Spielername suchen…" autocomplete="off">
    <div id="adm-res" class="list"></div>`;
  const q = body.querySelector<HTMLInputElement>("#adm-q")!;
  const res = body.querySelector<HTMLElement>("#adm-res")!;
  let t = 0;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = window.setTimeout(async () => {
      try {
        const list = await adminSearch(q.value);
        res.innerHTML = list.length
          ? list
              .map((p) => `<button class="row-item trow" data-name="${esc(p.username)}"><span class="nm">${esc(p.username)}<small>${p.warnings} Verwarnungen${p.banned ? " · gesperrt" : ""}</small></span>${p.banned ? "🚫" : "›"}</button>`)
              .join("")
          : q.value.trim().length >= 2
            ? `<div class="empty">Niemand gefunden.</div>`
            : "";
      } catch (e) {
        res.innerHTML = `<div class="inline-error">${esc(errMsg(e))}</div>`;
      }
    }, 250);
  });
  res.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-name]");
    if (b) openPlayerAdmin(b.dataset.name!, refresh);
  });
}

function playerCardHtml(p: AdminPlayer): string {
  return `<h2 class="modal-title">${esc(p.username)}</h2>
    ${p.avatar?.startsWith("data:image/") ? `<img class="adm-avatar" src="${p.avatar}" alt="Profilbild">` : ""}
    <p class="muted small">Dabei seit ${new Date(p.created_at).toLocaleDateString("de-DE")} · ${p.trophies} 🏆${p.country ? ` · ${esc(p.country)}` : ""}${p.clan ? ` · Clan ${esc(p.clan.name)}` : ""}<br>
      ${p.reports} Meldungen · ${p.chat_reports} gemeldete Nachrichten · ${p.warnings} Verwarnungen${p.last_warning ? ` (zuletzt: „${esc(p.last_warning)}“)` : ""}</p>
    ${p.banned_until ? `<div class="notice ban"><b>Gesperrt bis ${new Date(p.banned_until).toLocaleString("de-DE")}</b>${p.ban_reason ? `<span>${esc(p.ban_reason)}</span>` : ""}</div>` : ""}
    <label class="field"><span class="field-label">Grund (wird dem Spieler angezeigt)</span><input id="adm-reason" maxlength="200" placeholder="z. B. Beleidigungen im Chat"></label>
    <div class="adm-actions wrap">
      <button class="btn small" data-p="warn">⚠️ Verwarnen</button>
      <button class="btn small danger" data-p="ban24">🚫 24 Std.</button>
      <button class="btn small danger" data-p="ban168">🚫 7 Tage</button>
      <button class="btn small danger" data-p="banperm">🚫 Dauerhaft</button>
      ${p.banned_until ? `<button class="btn small" data-p="unban">Sperre aufheben</button>` : ""}
      <button class="btn small" data-p="name">Name zurücksetzen</button>
      ${p.has_avatar ? `<button class="btn small" data-p="avatar">Profilbild entfernen</button>` : ""}
      ${p.clan ? `<button class="btn small" data-p="clan" data-clan="${p.clan.id}">Clan-Name zurücksetzen</button>` : ""}
    </div>
    <button class="btn ghost" data-close>Schließen</button>`;
}

async function openPlayerAdmin(name: string, refresh: () => void) {
  let p: AdminPlayer | null;
  try {
    p = await adminPlayer(name);
  } catch (e) {
    toast(errMsg(e));
    return;
  }
  if (!p) return toast("Spieler nicht gefunden");
  modal(playerCardHtml(p), (el, close) => {
    el.addEventListener("click", async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-p]");
      if (!b || !p) return;
      const reason = el.querySelector<HTMLInputElement>("#adm-reason")?.value.trim() ?? "";
      try {
        switch (b.dataset.p) {
          case "warn":
            if (!reason) return toast("Bitte einen Grund eintragen");
            p = await adminWarn(p.username, reason);
            break;
          case "ban24":
          case "ban168":
          case "banperm":
            if (!reason) return toast("Bitte einen Grund eintragen");
            p = await adminBan(p.username, b.dataset.p === "ban24" ? 24 : b.dataset.p === "ban168" ? 168 : -1, reason);
            break;
          case "unban":
            p = await adminBan(p.username, 0, "");
            break;
          case "name":
            p = await adminResetName(p.username);
            break;
          case "avatar":
            p = await adminResetAvatar(p.username);
            break;
          case "clan":
            await adminResetClan(b.dataset.clan!);
            p = await adminPlayer(p.username);
            break;
        }
        toast("Gespeichert ✓");
        if (p) el.innerHTML = playerCardHtml(p);
        refresh();
      } catch (ex) {
        toast(errMsg(ex));
      }
      void close;
    });
  });
}

// ---------- Filter-Wörter ----------

async function renderWords(body: HTMLElement) {
  const draw = (words: { word: string; active: boolean }[]) => {
    body.innerHTML = `<p class="muted small">Diese Wörter werden zusätzlich zur eingebauten Liste in Chat, Clan- und Spielernamen durch *** ersetzt. Auch mit Zahlen statt Buchstaben (z. B. „3“ für „e“).</p>
      <form class="inv-form" id="w-form"><input id="w-in" maxlength="40" placeholder="Neues Wort" autocomplete="off"><button class="btn primary" type="submit">Hinzufügen</button></form>
      <div class="list">${
        words.length
          ? words
              .map(
                (w) => `<div class="row-item"><span class="nm">${w.active ? "" : "<s>"}${esc(w.word)}${w.active ? "" : "</s>"}</span>
            <button class="btn small ${w.active ? "ghost" : ""}" data-w="${esc(w.word)}" data-on="${w.active ? "0" : "1"}">${w.active ? "Deaktivieren" : "Aktivieren"}</button></div>`,
              )
              .join("")
          : `<div class="empty">Noch keine eigenen Wörter.</div>`
      }</div>`;
    body.querySelector<HTMLFormElement>("#w-form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = body.querySelector<HTMLInputElement>("#w-in")!.value.trim();
      if (!v) return;
      try {
        draw(await adminSetWord(v, true));
        toast("Wort hinzugefügt ✓");
      } catch (ex) {
        toast(errMsg(ex));
      }
    });
    body.querySelectorAll<HTMLElement>("[data-w]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          draw(await adminSetWord(b.dataset.w!, b.dataset.on === "1"));
        } catch (ex) {
          toast(errMsg(ex));
        }
      }),
    );
  };
  try {
    draw(await adminWords());
  } catch (e) {
    body.innerHTML = `<div class="inline-error">${esc(errMsg(e))}</div>`;
  }
}
