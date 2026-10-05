// Navigation: Hash-Routen (#/start, #/spielen, #/minigames/memory …) und die untere Tab-Leiste.
// Der Zurück-Knopf des Handys funktioniert, und nach dem Neuladen bleibt man auf demselben Bildschirm.

export type TabId = "start" | "spielen" | "ranglisten" | "freunde" | "profil";

export const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "start", icon: "🏠", label: "Start" },
  { id: "spielen", icon: "🎮", label: "Spielen" },
  { id: "ranglisten", icon: "🏆", label: "Ranglisten" },
  { id: "freunde", icon: "👥", label: "Freunde" },
  { id: "profil", icon: "👤", label: "Profil" },
];

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
  if (top === "minigames") return "spielen";
  if (top === "pfad") return null;
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

export function tabBarHtml(active: TabId | null): string {
  return `<nav class="tabbar" aria-label="Hauptmenü">
    ${TABS.map(
      (t) => `<a class="tab${t.id === active ? " on" : ""}" href="#/${t.id}" data-tab="${t.id}"${t.id === active ? ` aria-current="page"` : ""}>
        <span class="tab-ico" aria-hidden="true">${t.icon}</span><span class="tab-label">${t.label}</span>
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
  flame: string;
  body: string;
  cls?: string;
  /** Route für den Zurück-Pfeil oben links (z. B. "spielen") */
  back?: string;
}): string {
  return `
  <div class="shell ${opts.cls ?? ""}">
    <header class="pagebar">
      ${opts.back ? `<button class="icon-btn back-btn" data-act="go" data-to="${opts.back}" aria-label="Zurück">←</button>` : ""}
      <h1 class="page-title">${opts.titleHtml ?? opts.title}</h1>
      <button class="trophy-pill" data-act="path" aria-label="Trophäenpfad öffnen">
        <span class="flame" aria-hidden="true">🔥</span><b id="trophy-count">${opts.flame}</b>
      </button>
    </header>
    <main class="page" id="page">${opts.body}</main>
  </div>
  ${tabBarHtml(opts.tab)}`;
}
