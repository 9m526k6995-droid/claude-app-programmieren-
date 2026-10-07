// Rote Zahlen an der Tab-Leiste (Freunde, später Clan). Fragt alle 30 s beim Server nach,
// außerdem beim Zurückkehren in die App und nach jedem Seitenwechsel (höchstens alle 8 s).

import { TAB_BADGES, type TabId } from "./nav";
import { getBadges, markFriendsSeen, type Badges } from "./social";
import { toast } from "./ui";

let iv = 0;
let last = 0;
let busy = false;
let knownAccepted = -1;

export function applyBadges() {
  // Freunde & Clan teilen sich einen Tab – dort steht die Summe, im Umschalter die einzelnen Zahlen
  TAB_BADGES.social = (TAB_BADGES.freunde ?? 0) + (TAB_BADGES.clan ?? 0);
  document.querySelectorAll<HTMLElement>(".social-seg [data-seg]").forEach((a) => {
    const n = TAB_BADGES[a.dataset.seg as TabId] ?? 0;
    let b = a.querySelector<HTMLElement>(".seg-badge");
    if (n > 0) {
      if (!b) {
        b = document.createElement("b");
        b.className = "seg-badge";
        a.append(b);
      }
      b.textContent = n > 99 ? "99+" : String(n);
    } else b?.remove();
  });
  document.querySelectorAll<HTMLElement>(".tabbar .tab[data-tab]").forEach((t) => {
    const n = TAB_BADGES[t.dataset.tab as TabId] ?? 0;
    let b = t.querySelector<HTMLElement>(".tab-badge");
    if (n > 0) {
      if (!b) {
        b = document.createElement("b");
        b.className = "tab-badge";
        t.append(b);
      }
      b.textContent = n > 99 ? "99+" : String(n);
      t.setAttribute("aria-label", `${t.querySelector(".tab-label")?.textContent ?? ""} – ${n} neu`);
    } else {
      b?.remove();
      t.removeAttribute("aria-label");
    }
  });
}

function onFriendsTab() {
  return location.hash.startsWith("#/freunde");
}

export async function refreshBadges(force = false) {
  if (busy || (!force && Date.now() - last < 8000)) return;
  busy = true;
  last = Date.now();
  try {
    const b: Badges = await getBadges();
    if (onFriendsTab() && b.friends > 0) {
      await markFriendsSeen().catch(() => {});
      TAB_BADGES.freunde = 0;
    } else {
      // Kurzer Hinweis, wenn gerade jemand eine Anfrage angenommen hat
      if (knownAccepted >= 0 && b.friends_accepted > knownAccepted && b.accepted_names[0]) {
        toast(`🎉 ${b.accepted_names[0]} hat deine Freundschaftsanfrage angenommen`);
      }
      TAB_BADGES.freunde = b.friends;
    }
    knownAccepted = b.friends_accepted;
    if (typeof b.clan === "number") TAB_BADGES.clan = b.clan;
    applyBadges();
  } catch {
    /* offline oder abgemeldet – Badges bleiben wie sie sind */
  } finally {
    busy = false;
  }
}

/** Freunde-Tab geöffnet → Badge sofort weg und beim Server als gesehen markieren. */
export function friendsOpened() {
  if (TAB_BADGES.freunde) {
    TAB_BADGES.freunde = 0;
    applyBadges();
  }
  knownAccepted = -1;
  void markFriendsSeen().catch(() => {});
}

const onVisible = () => {
  if (document.visibilityState === "visible") void refreshBadges(true);
};

export function startBadges() {
  stopBadges();
  void refreshBadges(true);
  iv = window.setInterval(() => void refreshBadges(true), 30_000);
  document.addEventListener("visibilitychange", onVisible);
}

export function stopBadges() {
  clearInterval(iv);
  document.removeEventListener("visibilitychange", onVisible);
  for (const k of Object.keys(TAB_BADGES)) TAB_BADGES[k as TabId] = 0;
  knownAccepted = -1;
}
