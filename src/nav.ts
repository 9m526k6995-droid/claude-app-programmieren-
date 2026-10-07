// Navigation: Hash-Routen (#/start, #/spielen, #/minigames/memory …) und die untere Tab-Leiste.
// Der Zurück-Knopf des Handys funktioniert, und nach dem Neuladen bleibt man auf demselben Bildschirm.

// Vier Tabs: Spielen (Start + alle Modi), Ranglisten, Freunde & Clan, Profil.
// "spielen", "freunde" und "clan" sind weiterhin gültige Seiten, gehören aber zu einem dieser vier Tabs.
export type TabId = "start" | "spielen" | "ranglisten" | "social" | "clan" | "freunde" | "profil";
type MainTab = "start" | "ranglisten" | "social" | "profil";

export const TABS: { id: MainTab; icon: string; label: string }[] = [
  { id: "start", icon: "🎮", label: "Spielen" },
  { id: "ranglisten", icon: "🏆", label: "Ranglisten" },
  { id: "social", icon: "👥", label: "Freunde & Clan" },
  { id: "profil", icon: "👤", label: "Profil" },
];

/** Zu welchem der vier Tabs gehört eine Seite? */
export function mainTab(t: TabId | null): MainTab | null {
  if (!t) return null;
  if (t === "spielen") return "start";
  if (t === "freunde" || t === "clan") return "social";
  return t as MainTab;
}

/** Rote Zahlen an den Tabs (z. B. neue Freundesanfragen). Wird von badges.ts aktualisiert. */
export const TAB_BADGES: Partial<Record<TabId, number>> = {};

/** Aktuelle Route als Teile, z. B. ["minigames", "memory"]. Leer/unbekannt → ["start"]. */
export function routeParts(hash: string = location.hash): string[] {
  const parts = hash
    .replace(/^#\/?/, "")
    .split("/")
    .map((p) => decodeURIComponent(p.trim()))
    .filter(Boolean);
  return parts.length ? parts : ["start"];
}

/** Welcher Tab gehört zu einer Route? (Minigames liegen unter „Spielen“) */
export function tabFor(parts: string[]): TabId | null {
  const top = parts[0];
  if (top === "minigames" || top === "spielen") return "start";
  if (top === "pfad") return null;
  if (top === "freunde" || top === "clan") return "social";
  if (top === "einstellungen") return "profil";
  return (TABS.find((t) => t.id === top)?.id ?? "start") as TabId;
}

/** Zu einer Route wechseln. Ist man schon dort, wird der Bildschirm einfach neu gezeichnet. */
export function go(path: string, rerender: () => void) {
  const target = `#/${path.replace(/^#?\/?/, "")}`;
  if (location.hash === target) rerender();
  else location.hash = target;
}

/** Ersetzt die aktuelle Route ohne neuen Eintrag in der Zurück-Liste. */
export function replaceRoute(path: string) {
  try {
    history.replaceState(null, "", `${location.pathname}${location.search}#/${path.replace(/^#?\/?/, "")}`);
  } catch {
    location.hash = `#/${path}`;
  }
}

export function tabBarHtml(activeTab: TabId | null): string {
  const active = mainTab(activeTab);
  return `<nav class="tabbar" aria-label="Hauptmenü">
    ${TABS.map(
      (t) => `<a class="tab${t.id === active ? " on" : ""}" href="#/${t.id}" data-tab="${t.id}"${t.id === active ? ` aria-current="page"` : ""}>
        <span class="tab-ico" aria-hidden="true">${t.icon}</span>${(TAB_BADGES[t.id] ?? 0) > 0 ? `<b class="tab-badge">${(TAB_BADGES[t.id] ?? 0) > 99 ? "99+" : TAB_BADGES[t.id]}</b>` : ""}<span class="tab-label">${t.label}</span>
      </a>`,
    ).join("")}
  </nav>`;
}

/**
 * Seitengerüst für alle Tab-Bildschirme: schlanke Kopfzeile (Titel + Trophäen-Flamme),
 * Inhalt und die Tab-Leiste unten.
 */
export function shellHtml(opts: {
  tab: TabId | null;
  title: string;
  titleHtml?: string;
  /** Trophäenstand (Text) */
  flame: string;
  /** Streak: Anzahl Tage und Zustand (none = keine, risk = heute noch nicht gespielt, done = heute gespielt) */
  streak?: { n: number; state: "none" | "risk" | "done" };
  body: string;
  cls?: string;
  /** Route für den Zurück-Pfeil oben links (z. B. "spielen") */
  back?: string;
  /** Zusätzlicher Knopf oben rechts (z. B. ⚙️ im Profil) */
  action?: string;
}): string {
  return `
  <div class="shell ${opts.cls ?? ""}">
    <header class="pagebar">
      ${opts.back ? `<button class="icon-btn back-btn" data-act="go" data-to="${opts.back}" aria-label="Zurück">←</button>` : ""}
      <h1 class="page-title">${opts.titleHtml ?? opts.title}</h1>
      <div class="hud-chips">
        ${opts.action ?? ""}
        ${streakChipHtml(opts.streak)}
        <button class="trophy-pill" data-act="path" aria-label="Trophäen: ${opts.flame} – Trophäenpfad öffnen">
          <span class="tp-cup" aria-hidden="true">🏆</span><b id="trophy-count">${opts.flame}</b>
        </button>
      </div>
    </header>
    <main class="page" id="page">${opts.body}</main>
  </div>
  ${tabBarHtml(opts.tab)}`;
}

/** 🔥 = Streak. Grau: keine Streak. Flackert: heute noch nicht gespielt (Streak in Gefahr). Hell: heute erledigt. */
export function streakChipHtml(st?: { n: number; state: "none" | "risk" | "done" }): string {
  if (!st) return "";
  const label =
    st.state === "done"
      ? `${st.n} ${st.n === 1 ? "Tag" : "Tage"} am Stück – heute erledigt`
      : st.state === "risk"
        ? `${st.n} ${st.n === 1 ? "Tag" : "Tage"} am Stück – spiel heute die Daily, sonst ist die Streak weg`
        : "Noch keine Streak – spiel die Daily";
  return `<button class="streak-chip s-${st.state}" data-act="streak" aria-label="Streak: ${label}" title="${label}">
    <span class="fire" aria-hidden="true">🔥</span><b>${st.n}</b>
  </button>`;
}
