// Konto & Rechtliches: Altersangabe + Zustimmung, Sperr-/Verwarn-Hinweise, Daten herunterladen, Konto löschen.

import { esc, modal, toast } from "./ui";
import { acceptTerms, exportMyData, SocialError, type MyTerms } from "./social";
import { deleteAccount } from "./auth";

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : "Da ist etwas schiefgelaufen.");

// ---------- Felder für die Registrierung ----------

/** Alter + Häkchen. Wird ins Registrierungsformular eingebaut. */
export function termsFieldsHtml(): string {
  return `
    <label class="lbl" for="auth-age">Wie alt bist du?</label>
    <input id="auth-age" name="age" type="number" inputmode="numeric" min="6" max="120" required placeholder="z. B. 14" enterkeyhint="next">
    <label class="check" id="auth-parent-row" hidden>
      <input type="checkbox" id="auth-parent"> <span>Ich bin unter 16 und <b>meine Eltern sind einverstanden</b>, dass ich ZWIP nutze.</span>
    </label>
    <label class="check">
      <input type="checkbox" id="auth-terms"> <span>Ich akzeptiere die <a href="#/rechtliches/regeln" target="_blank" rel="noopener">Nutzungsbedingungen</a> und habe die <a href="#/rechtliches/datenschutz" target="_blank" rel="noopener">Datenschutzerklärung</a> gelesen.</span>
    </label>`;
}

export function bindTermsFields(root: HTMLElement) {
  const age = root.querySelector<HTMLInputElement>("#auth-age");
  const row = root.querySelector<HTMLElement>("#auth-parent-row");
  age?.addEventListener("input", () => {
    const n = Number(age.value);
    if (row) row.hidden = !(n > 0 && n < 16);
  });
}

export interface TermsInput {
  age: number;
  parentOk: boolean;
}

/** Prüft die Felder; gibt eine Fehlermeldung oder die Werte zurück */
export function readTermsFields(root: HTMLElement): { error: string; field?: HTMLInputElement } | TermsInput {
  const ageEl = root.querySelector<HTMLInputElement>("#auth-age")!;
  const age = Math.floor(Number(ageEl.value));
  if (!age || age < 6 || age > 120) return { error: "Bitte gib dein Alter an.", field: ageEl };
  const parent = root.querySelector<HTMLInputElement>("#auth-parent")!;
  if (age < 16 && !parent.checked) return { error: "Unter 16 brauchst du das Einverständnis deiner Eltern.", field: parent };
  const terms = root.querySelector<HTMLInputElement>("#auth-terms")!;
  if (!terms.checked) return { error: "Bitte akzeptiere die Nutzungsbedingungen.", field: terms };
  return { age, parentOk: age < 16 && parent.checked };
}

// Wenn nach der Registrierung erst die E-Mail bestätigt werden muss, merken wir uns die Angaben bis zur ersten Anmeldung.
const PENDING = "zwip:pendingTerms";
export function rememberTerms(t: TermsInput) {
  try {
    localStorage.setItem(PENDING, JSON.stringify(t));
  } catch {
    /* egal */
  }
}
export function takeRememberedTerms(): TermsInput | null {
  try {
    const v = localStorage.getItem(PENDING);
    localStorage.removeItem(PENDING);
    return v ? (JSON.parse(v) as TermsInput) : null;
  } catch {
    return null;
  }
}

// ---------- Zustimmung nachholen (bestehende Konten) ----------

/** Nicht wegklickbares Fenster: Alter + Zustimmung. Ruft `done` nach Erfolg. */
export function openTermsGate(done: (t: MyTerms) => void) {
  modal(
    `<form class="terms-gate" novalidate>
      <h2 class="modal-title">Kurz bestätigen 👋</h2>
      <p class="muted">Damit ZWIP für alle sicher bleibt, brauchen wir einmalig dein Alter und deine Zustimmung zu den Regeln.</p>
      ${termsFieldsHtml()}
      <div class="inline-error" id="tg-err" role="alert" hidden></div>
      <button class="btn primary" type="submit">Weiter</button>
    </form>`,
    (el, close) => {
      // Dieses Fenster lässt sich nicht durch Tippen daneben schließen
      const bg = el.parentElement!;
      bg.classList.add("locked");
      bg.addEventListener(
        "click",
        (e) => {
          if (e.target === bg) e.stopImmediatePropagation();
        },
        true,
      );
      const form = el.querySelector<HTMLFormElement>("form")!;
      bindTermsFields(form);
      form.querySelectorAll<HTMLAnchorElement>("a[href^='#/rechtliches']").forEach((a) =>
        a.addEventListener("click", (e) => {
          e.preventDefault();
          window.open(`${location.pathname}${location.search}${a.getAttribute("href")}`, "_blank", "noopener");
        }),
      );
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = form.querySelector<HTMLElement>("#tg-err")!;
        const r = readTermsFields(form);
        if ("error" in r) {
          err.textContent = r.error;
          err.hidden = false;
          return;
        }
        try {
          const t = await acceptTerms(r.age, r.parentOk);
          close();
          done(t);
        } catch (ex) {
          err.textContent = ex instanceof SocialError ? ex.message : errMsg(ex);
          err.hidden = false;
        }
      });
    },
  );
}

// ---------- Hinweise: gesperrt / verwarnt ----------

export function noticeHtml(t: MyTerms | null): string {
  if (!t) return "";
  if (t.banned_until) {
    const forever = new Date(t.banned_until).getFullYear() - new Date().getFullYear() > 50;
    return `<div class="notice ban" role="alert"><b>🚫 Dein Konto ist ${forever ? "dauerhaft" : `bis ${new Date(t.banned_until).toLocaleString("de-DE", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`} gesperrt.</b>
      ${t.ban_reason ? `<span>Grund: ${esc(t.ban_reason)}</span>` : ""}<span>Du kannst weiter spielen, aber nicht chatten und keine Ranglisten-Werte einreichen.</span></div>`;
  }
  if (t.warning) {
    return `<div class="notice warn" role="status"><b>⚠️ Verwarnung</b><span>${esc(t.warning)}</span><span>Bitte halte dich an die <a href="#/rechtliches/regeln">Regeln</a>, sonst wird dein Konto gesperrt.</span></div>`;
  }
  return "";
}

// ---------- Profil: Daten & Konto ----------

export function accountSectionHtml(isAdmin: boolean): string {
  return `<section class="card-sec account-sec">
    <h2 class="sec-title">Deine Daten</h2>
    <button class="btn sm" type="button" data-acc="export">📦 Meine Daten herunterladen</button>
    <button class="btn sm danger" type="button" data-acc="delete">🗑️ Konto löschen</button>
    ${isAdmin ? `<a class="btn sm" href="#/admin">🛡️ Moderation (Admin)</a>` : ""}
    <nav class="legal-links"><a href="#/rechtliches/impressum">Impressum</a> · <a href="#/rechtliches/datenschutz">Datenschutz</a> · <a href="#/rechtliches/regeln">Nutzungsbedingungen</a></nav>
  </section>`;
}

export function bindAccountSection(root: HTMLElement, onDeleted: () => void) {
  root.querySelector('[data-acc="export"]')?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `zwip-meine-daten-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("Deine Daten wurden heruntergeladen 📦");
    } catch (ex) {
      toast(ex instanceof SocialError ? ex.message : errMsg(ex));
    } finally {
      b.disabled = false;
    }
  });
  root.querySelector('[data-acc="delete"]')?.addEventListener("click", () => openDeleteDialog(onDeleted));
}

function openDeleteDialog(onDeleted: () => void) {
  modal(
    `<h2 class="modal-title">Konto löschen?</h2>
     <p>Das kann man <b>nicht rückgängig</b> machen. Gelöscht werden dein Konto, dein Profil, deine Trophäen, Highscores, Freunde und deine Clan-Mitgliedschaft. Deine Clan-Nachrichten bleiben ohne Namen stehen.</p>
     <p class="muted small">Tipp: Lade vorher deine Daten herunter, wenn du sie behalten willst.</p>
     <label class="field"><span class="field-label">Zum Bestätigen <b>LÖSCHEN</b> eintippen</span><input id="del-confirm" autocomplete="off" autocapitalize="characters"></label>
     <div class="inline-error" id="del-err" role="alert" hidden></div>
     <div class="modal-actions">
       <button class="btn danger" type="button" id="del-go" disabled>Konto endgültig löschen</button>
       <button class="btn ghost" type="button" data-close>Abbrechen</button>
     </div>`,
    (el, close) => {
      const inp = el.querySelector<HTMLInputElement>("#del-confirm")!;
      const go = el.querySelector<HTMLButtonElement>("#del-go")!;
      inp.addEventListener("input", () => (go.disabled = inp.value.trim().toUpperCase() !== "LÖSCHEN"));
      go.addEventListener("click", async () => {
        go.disabled = true;
        go.textContent = "Wird gelöscht…";
        try {
          await deleteAccount();
          close();
          toast("Dein Konto wurde gelöscht. Tschüss 👋");
          onDeleted();
        } catch (ex) {
          const err = el.querySelector<HTMLElement>("#del-err")!;
          err.textContent = `Das hat nicht geklappt: ${errMsg(ex)}`;
          err.hidden = false;
          go.disabled = false;
          go.textContent = "Konto endgültig löschen";
        }
      });
    },
  );
}
