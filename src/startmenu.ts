// Startmenü, Registrierung und Anmeldung. Eigene Datei, damit das Spiel selbst unberührt bleibt.

import { signIn, signUp, authConfigured, authMessage, AuthError, MIN_PASSWORD } from "./auth";
import { termsFieldsHtml, bindTermsFields, readTermsFields, rememberTerms } from "./accountUi";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const LOGO = `<h1 class="logo" aria-label="ZWIP"><span>Z</span><span>W</span><span>I</span><span>P</span></h1>`;

export interface StartMenuHooks {
  /** Nach erfolgreicher Anmeldung bzw. Registrierung mit direkter Anmeldung */
  onSignedIn: (fresh: boolean) => void;
  /** Kurzer Hinweis über dem Spiel (z. B. "Ein Freund fordert dich heraus") */
  banner?: string;
  /** Symbol und Unterzeile für das Banner (Standard: Duell) */
  bannerIcon?: string;
  bannerSub?: string;
  /** „Ohne Konto spielen“ – wenn gesetzt, wird der Knopf angezeigt */
  onGuest?: () => void;
}

export function renderStart(app: HTMLElement, hooks: StartMenuHooks) {
  app.innerHTML = `
  <div class="screen start">
    <div class="start-hero">
      ${LOGO}
      <p class="tagline">10 Blitz-Challenges · jeden Tag neu</p>
    </div>
    ${hooks.banner ? `<div class="duel-card pop-in"><div class="duel-ico">${hooks.bannerIcon ?? "⚔️"}</div><div>${hooks.banner}<br><span class="muted">${hooks.bannerSub ?? "Melde dich an, um anzutreten."}</span></div></div>` : ""}
    <div class="start-actions">
      <button class="btn primary big" data-auth="login" type="button">Anmelden</button>
      <button class="btn big" data-auth="register" type="button">Registrieren</button>
    </div>
    ${
      authConfigured
        ? `<p class="start-note muted">Kostenlos. Nur E-Mail und Passwort.</p>`
        : `<p class="start-note warn" role="status">${esc(authMessage("not_configured"))}</p>`
    }
    ${hooks.onGuest ? `<button class="link-btn guest-btn" data-auth="guest" type="button">Erst mal <b>ohne Konto spielen</b> →</button>` : ""}
    <nav class="legal-links start-legal"><a href="#/rechtliches/impressum">Impressum</a> · <a href="#/rechtliches/datenschutz">Datenschutz</a> · <a href="#/rechtliches/regeln">Nutzungsbedingungen</a></nav>
  </div>`;
  app.querySelector('[data-auth="guest"]')?.addEventListener("click", () => hooks.onGuest?.());
  app.querySelector('[data-auth="login"]')!.addEventListener("click", () => renderAuthForm(app, "login", hooks));
  app.querySelector('[data-auth="register"]')!.addEventListener("click", () => renderAuthForm(app, "register", hooks));
}

export function renderAuthForm(app: HTMLElement, mode: "login" | "register", hooks: StartMenuHooks, prefillEmail = "") {
  const reg = mode === "register";
  app.innerHTML = `
  <div class="screen auth">
    <header class="topbar">
      <button class="icon-btn" data-auth="back" type="button" aria-label="Zurück zum Startmenü">←</button>
      <span class="mode-tag">ZWIP</span>
      <span class="icon-btn ghost-slot"></span>
    </header>
    <form class="auth-card" novalidate>
      <h2>${reg ? "Account erstellen" : "Willkommen zurück"}</h2>
      <p class="muted">${reg ? "Damit deine Punkte und Streaks dir gehören." : "Melde dich an und spiel die Daily."}</p>

      <label class="lbl" for="auth-email">E-Mail-Adresse</label>
      <input id="auth-email" name="email" type="email" inputmode="email" autocomplete="email"
        autocapitalize="off" spellcheck="false" required value="${esc(prefillEmail)}" enterkeyhint="next">

      <label class="lbl" for="auth-password">Passwort</label>
      <div class="pw-row">
        <input id="auth-password" name="password" type="password" required
          autocomplete="${reg ? "new-password" : "current-password"}" ${reg ? `minlength="${MIN_PASSWORD}"` : ""}
          enterkeyhint="${reg ? "next" : "go"}">
        <button class="pw-toggle" type="button" data-auth="toggle" aria-label="Passwort anzeigen" aria-pressed="false">👁️</button>
      </div>
      ${reg ? `<p class="hint muted">Mindestens ${MIN_PASSWORD} Zeichen.</p>` : ""}

      ${
        reg
          ? `<label class="lbl" for="auth-password2">Passwort bestätigen</label>
             <input id="auth-password2" name="password2" type="password" required autocomplete="new-password" enterkeyhint="next">
             ${termsFieldsHtml()}`
          : ""
      }

      <div class="auth-error" role="alert" aria-live="assertive" hidden></div>

      <button class="btn primary" type="submit" id="auth-submit">${reg ? "Registrieren" : "Anmelden"}</button>
      <button class="link-btn" type="button" data-auth="switch">
        ${reg ? "Schon einen Account? <b>Anmelden</b>" : "Noch keinen Account? <b>Registrieren</b>"}
      </button>
    </form>
  </div>`;

  const form = app.querySelector("form")!;
  const email = app.querySelector<HTMLInputElement>("#auth-email")!;
  const pw = app.querySelector<HTMLInputElement>("#auth-password")!;
  const pw2 = app.querySelector<HTMLInputElement>("#auth-password2");
  const errBox = app.querySelector<HTMLElement>(".auth-error")!;
  const submit = app.querySelector<HTMLButtonElement>("#auth-submit")!;

  const showError = (msg: string, field?: HTMLInputElement) => {
    errBox.textContent = msg;
    errBox.hidden = false;
    [email, pw, pw2].forEach((f) => f?.removeAttribute("aria-invalid"));
    if (field) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
    }
  };

  if (reg) bindTermsFields(app);
  app.querySelector('[data-auth="back"]')!.addEventListener("click", () => renderStart(app, hooks));
  app.querySelector('[data-auth="switch"]')!.addEventListener("click", () =>
    renderAuthForm(app, reg ? "login" : "register", hooks, email.value),
  );
  const toggle = app.querySelector<HTMLButtonElement>('[data-auth="toggle"]')!;
  toggle.addEventListener("click", () => {
    const show = pw.type === "password";
    [pw, pw2].forEach((f) => f && (f.type = show ? "text" : "password"));
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Passwort verbergen" : "Passwort anzeigen");
    toggle.textContent = show ? "🙈" : "👁️";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    if (reg) {
      const t = readTermsFields(app);
      if ("error" in t) {
        showError(t.error, t.field);
        return;
      }
      // Wird nach der ersten Anmeldung an den Server übertragen
      rememberTerms(t);
    }
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = reg ? "Account wird erstellt…" : "Anmelden…";
    try {
      if (reg) {
        const { needsConfirmation } = await signUp(email.value, pw.value, pw2!.value);
        if (needsConfirmation) renderConfirmNotice(app, email.value.trim(), hooks);
        else hooks.onSignedIn(true);
      } else {
        await signIn(email.value, pw.value);
        hooks.onSignedIn(false);
      }
    } catch (err) {
      const code = err instanceof AuthError ? err.code : "unknown";
      const msg = err instanceof AuthError ? err.message : authMessage("unknown");
      const field =
        code === "invalid_email" || code === "email_taken"
          ? email
          : code === "password_mismatch"
            ? pw2!
            : code === "weak_password" || code === "invalid_credentials"
              ? pw
              : undefined;
      showError(msg, field);
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  if (!prefillEmail) email.focus({ preventScroll: true });
  else pw.focus({ preventScroll: true });
}

function renderConfirmNotice(app: HTMLElement, email: string, hooks: StartMenuHooks) {
  app.innerHTML = `
  <div class="screen auth">
    <div class="auth-card center-card">
      <div class="big-emoji">📬</div>
      <h2>Fast geschafft!</h2>
      <p>Wir haben dir eine E-Mail an <b>${esc(email)}</b> geschickt. Tipp auf den Link darin, um deinen Account zu bestätigen.</p>
      <p class="muted">Nichts angekommen? Schau auch im Spam-Ordner nach.</p>
      <button class="btn primary" type="button" data-auth="to-login">Zur Anmeldung</button>
    </div>
  </div>`;
  app.querySelector('[data-auth="to-login"]')!.addEventListener("click", () => renderAuthForm(app, "login", hooks, email));
}
