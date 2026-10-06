// Kurze Einführung beim ersten Öffnen und Hinweise für den Gast-Modus.

import { modal } from "./ui";

const STEPS: { icon: string; title: string; text: string }[] = [
  { icon: "⚡", title: "Jeden Tag eine Daily", text: "10 Blitz-Aufgaben, für alle gleich. Schnell und richtig gibt die meisten Punkte – danach kannst du dein Ergebnis teilen." },
  { icon: "🎮", title: "Minigames", text: "Such dir ein Spiel aus und schaff so viele Stufen wie möglich. Ein Fehler, und der Lauf ist vorbei. Jedes Spiel hat seine eigene Rangliste." },
  { icon: "🏆", title: "Trophäen & Ranglisten", text: "Im Trophäen-Modus steigst du in Ligen auf. Vergleich dich weltweit, in deinem Land oder nur mit Freunden." },
  { icon: "🛡️", title: "Freunde & Clans", text: "Fordere Freunde per Link heraus, gründe einen Clan oder tritt einem bei und knackt zusammen die Wochen-Challenges." },
];

/** Zeigt die Einführung (4 Schritte). `done` wird beim Schließen aufgerufen – auch beim Überspringen. */
export function openTour(done: () => void) {
  let i = 0;
  modal(`<div class="tour" role="group" aria-roledescription="Einführung"></div>`, (el, close) => {
    const root = el.querySelector<HTMLElement>(".tour")!;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      close();
      done();
    };
    // Auch Tippen daneben beendet die Einführung sauber
    const obs = new MutationObserver(() => {
      if (!el.isConnected) {
        obs.disconnect();
        if (!finished) {
          finished = true;
          done();
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    const draw = () => {
      const s = STEPS[i];
      const last = i === STEPS.length - 1;
      root.innerHTML = `
        <div class="tour-ico" aria-hidden="true">${s.icon}</div>
        <h2 class="modal-title">${s.title}</h2>
        <p>${s.text}</p>
        <div class="tour-dots" aria-label="Schritt ${i + 1} von ${STEPS.length}">${STEPS.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
        <div class="modal-actions">
          <button class="btn primary" type="button" data-tour="next">${last ? "Los geht's 🚀" : "Weiter"}</button>
          ${last ? "" : `<button class="btn ghost" type="button" data-tour="skip">Überspringen</button>`}
        </div>`;
      root.querySelector('[data-tour="next"]')!.addEventListener("click", () => {
        if (last) finish();
        else {
          i++;
          draw();
        }
      });
      root.querySelector('[data-tour="skip"]')?.addEventListener("click", finish);
    };
    draw();
  });
}

/** Platzhalter für Bereiche, die ein Konto brauchen */
export function guestWallHtml(what: string): string {
  return `<div class="guest-wall">
    <div class="big-emoji" aria-hidden="true">🔒</div>
    <h2>${what} gibt's mit Konto</h2>
    <p class="muted">Mit einem kostenlosen Konto landest du in den Ranglisten, sammelst Trophäen, findest Freunde und kannst Clans beitreten. Nur E-Mail und Passwort.</p>
    <button class="btn primary" type="button" data-act="guest-register">Konto erstellen</button>
    <button class="link-btn" type="button" data-act="guest-login">Ich habe schon ein Konto</button>
  </div>`;
}

export function guestBannerHtml(): string {
  return `<div class="notice guest" role="status"><b>👋 Du spielst als Gast</b><span>Deine Ergebnisse bleiben nur auf diesem Gerät. <button class="link-btn inline" type="button" data-act="guest-register">Konto erstellen</button>, um in die Ranglisten zu kommen.</span></div>`;
}
