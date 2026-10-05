// Land im Konto und Regions-Auswahl in den Ranglisten (🌍 Weltweit · 🇩🇪 Deutschland · 🇳🇱 Niederlande · …).

import { esc, modal, toast } from "./ui";
import { getMyCountry, setCountry, setCountryHidden, SocialError, type MyCountry } from "./social";
import { countryName, flag, isCountry, searchCountries } from "./countries";

const errMsg = (e: unknown) => (e instanceof SocialError ? e.message : "Da ist etwas schiefgelaufen.");

// ---------- eigenes Land (einmal laden, dann merken) ----------
let mine: MyCountry | null = null;
let loading: Promise<MyCountry | null> | null = null;

export function myCountryCached(): MyCountry | null {
  return mine;
}

export function loadMyCountry(force = false): Promise<MyCountry | null> {
  if (mine && !force) return Promise.resolve(mine);
  if (loading && !force) return loading;
  loading = getMyCountry()
    .then((c) => (mine = c))
    .catch(() => null)
    .finally(() => (loading = null));
  return loading;
}

export function resetMyCountry() {
  mine = null;
}

// ---------- gewählte Region in den Ranglisten (nur eine Ansichts-Einstellung auf diesem Gerät) ----------
const REGION_KEY = "zwip:region";

/** "world" oder ein Ländercode */
export function selectedRegion(): string {
  try {
    const v = localStorage.getItem(REGION_KEY);
    if (v === "world" || isCountry(v)) return v!;
  } catch {
    /* egal */
  }
  return mine?.country && !mine.hidden ? mine.country : "world";
}

export function setSelectedRegion(r: string) {
  try {
    localStorage.setItem(REGION_KEY, r);
  } catch {
    /* egal */
  }
}

export function regionLabel(r: string): string {
  return r === "world" ? "Weltweit" : countryName(r);
}

/** Datum schön: „6. November“ */
export function niceDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("de-DE", { day: "numeric", month: "long" });
}

// ---------- Länderwahl (Popup mit Suche) ----------

export function openCountryPicker(title: string, current: string | null, onPick: (code: string) => void, opts: { allowWorld?: boolean; note?: string } = {}) {
  modal(
    `<h2 class="modal-title">${esc(title)}</h2>
     ${opts.note ? `<p class="muted small">${opts.note}</p>` : ""}
     <input id="cp-q" type="search" placeholder="Land suchen…" autocomplete="off" aria-label="Land suchen">
     <div class="country-list" id="cp-list" role="listbox"></div>
     <button class="btn ghost" data-close>Abbrechen</button>`,
    (el, close) => {
      const list = el.querySelector<HTMLElement>("#cp-list")!;
      const q = el.querySelector<HTMLInputElement>("#cp-q")!;
      const draw = () => {
        const items = searchCountries(q.value);
        list.innerHTML =
          (opts.allowWorld && !q.value.trim() ? `<button class="country-opt ${current === "world" ? "on" : ""}" data-code="world" role="option">🌍 <span>Weltweit</span></button>` : "") +
          items
            .map((c) => `<button class="country-opt ${c.code === current ? "on" : ""}" data-code="${c.code}" role="option" aria-selected="${c.code === current}">${c.flag} <span>${esc(c.name)}</span></button>`)
            .join("") || `<div class="empty">Kein Land gefunden.</div>`;
      };
      draw();
      q.addEventListener("input", draw);
      list.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-code]");
        if (!b) return;
        close();
        onPick(b.dataset.code!);
      });
    },
  );
}

// ---------- Regions-Chips für Ranglisten ----------

export function regionChipsHtml(sel: string): string {
  const own = mine?.country && !mine.hidden ? mine.country : null;
  const codes = [...new Set([own, "DE", "NL", sel !== "world" ? sel : null].filter((c): c is string => Boolean(c)))];
  return `<div class="chips region-chips" role="tablist" aria-label="Region">
    <button class="chip ${sel === "world" ? "on" : ""}" data-region="world" role="tab" aria-selected="${sel === "world"}">🌍 Weltweit</button>
    ${codes.map((c) => `<button class="chip ${c === sel ? "on" : ""}" data-region="${c}" role="tab" aria-selected="${c === sel}">${flag(c)} ${esc(countryName(c))}</button>`).join("")}
    <button class="chip" data-region="more" aria-label="Weiteres Land wählen">🌐 Weitere…</button>
  </div>`;
}

/** Klicks auf die Regions-Chips; `onChange` bekommt "world" oder den Ländercode */
export function bindRegionChips(root: HTMLElement, onChange: (region: string) => void) {
  root.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-region]");
    if (!b) return;
    const r = b.dataset.region!;
    if (r === "more") {
      openCountryPicker("Rangliste von welchem Land?", selectedRegion(), (code) => {
        setSelectedRegion(code);
        onChange(code);
      }, { allowWorld: true });
      return;
    }
    setSelectedRegion(r);
    onChange(r);
  });
}

/** Hinweis „Wähl dein Land“, solange keins gewählt ist */
export function countryHintHtml(): string {
  if (!mine || mine.country) return "";
  return `<button class="name-banner country-hint" data-country-hint><b>📍 Wähl dein Land</b><span>Dann erscheinst du auch in der Rangliste deines Landes →</span></button>`;
}

export function bindCountryHint(root: HTMLElement, after: () => void) {
  root.querySelector("[data-country-hint]")?.addEventListener("click", () => pickMyCountry(after));
}

/** Eigenes Land wählen (mit Hinweis auf „einmal im Monat“) */
export function pickMyCountry(after: () => void) {
  const c = mine;
  if (c && !c.can_change) {
    toast(`Dein Land kannst du erst wieder ab ${niceDate(c.next_change_at)} ändern.`);
    return;
  }
  openCountryPicker("Dein Land", c?.country ?? null, async (code) => {
    if (code === "world") return;
    try {
      mine = await setCountry(code);
      setSelectedRegion(code);
      toast(`${flag(code)} ${countryName(code)} gespeichert`);
      after();
    } catch (e) {
      toast(errMsg(e));
    }
  }, { note: "Du kannst dein Land <b>einmal im Monat</b> ändern. Direkt nach der Wahl hast du 15 Minuten Zeit, dich zu korrigieren. Dein echter Standort wird nicht benutzt." });
}

// ---------- Bereich „Land“ in den Einstellungen ----------

export function countrySettingsHtml(): string {
  return `<section class="card-sec country-set" id="country-set">
    <h2 class="sec-title">Land für Ranglisten</h2>
    <div class="empty small">Lädt…</div>
  </section>`;
}

export async function mountCountrySettings(root: HTMLElement) {
  const box = root.querySelector<HTMLElement>("#country-set");
  if (!box) return;
  const c = await loadMyCountry(true);
  if (!box.isConnected) return;
  const draw = () => {
    const m = mine;
    if (!m) {
      box.innerHTML = `<h2 class="sec-title">Land für Ranglisten</h2><div class="inline-error">Konnte nicht geladen werden.</div>`;
      return;
    }
    const lockInfo = m.country
      ? m.can_change
        ? m.fix_until && new Date(m.fix_until).getTime() > Date.now()
          ? `Du kannst dich noch bis ${new Date(m.fix_until).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr korrigieren, danach erst wieder in einem Monat.`
          : "Du kannst dein Land jetzt ändern – danach wieder in einem Monat."
        : `Nächste Änderung möglich ab <b>${niceDate(m.next_change_at)}</b>. Das Land lässt sich einmal im Monat ändern.`
      : "Wähl dein Land, um in der Länder-Rangliste zu erscheinen. Das Land lässt sich einmal im Monat ändern.";
    box.innerHTML = `
      <h2 class="sec-title">Land für Ranglisten</h2>
      <button class="country-current" data-cs="pick" ${m.can_change ? "" : "aria-disabled=\"true\""}>
        <span class="country-flag">${m.country ? flag(m.country) : "🌍"}</span>
        <span><b>${m.country ? esc(countryName(m.country)) : "Kein Land gewählt"}</b><small>${m.can_change ? "Tippen zum Ändern" : "Gesperrt bis " + niceDate(m.next_change_at)}</small></span>
      </button>
      <p class="muted small country-lock">${lockInfo}</p>
      <label class="toggle"><input type="checkbox" id="cs-hide" ${m.hidden ? "checked" : ""}> Land verbergen (nur in der Weltrangliste erscheinen)</label>
      <p class="muted small">Dein echter Standort wird nie benutzt – du wählst dein Land selbst.</p>`;
    box.querySelector('[data-cs="pick"]')!.addEventListener("click", () => pickMyCountry(draw));
    box.querySelector<HTMLInputElement>("#cs-hide")!.addEventListener("change", async (e) => {
      const want = (e.target as HTMLInputElement).checked;
      try {
        mine = await setCountryHidden(want);
        toast(want ? "Land wird nicht mehr angezeigt" : "Land wird wieder angezeigt");
      } catch (ex) {
        toast(errMsg(ex));
        (e.target as HTMLInputElement).checked = !want;
      }
    });
  };
  void c;
  draw();
}
