// Admin: Season Pass & Shop verwalten (#/admin/shop/…). Der Server prüft bei jeder Aktion selbst, ob das Konto Admin ist.

import { esc, toast } from "./ui";
import {
  adminPassOverview,
  adminPassRewards,
  adminPassSetReward,
  adminPassCreateSeason,
  adminPassUpdateSeason,
  adminPassSaveItem,
  adminPassSetShop,
  adminPassSetProduct,
  adminPassSetSetting,
  SocialError,
  type AdminPassOverview,
  type AdminReward,
} from "./social";
import { KIND_LABEL, KIND_ORDER, RARITY_LABEL, euro, itemIcon, num, type Item, type ItemKind, type Rarity } from "./passKit";

const errMsg = (e: unknown) => (e instanceof SocialError ? e.message : "Da ist etwas schiefgelaufen.");
const SUBS = [
  ["season", "Seasons"],
  ["belohnungen", "Belohnungen"],
  ["items", "Items"],
  ["shop", "Shop"],
  ["preise", "Preise"],
] as const;
type Sub = (typeof SUBS)[number][0];

/** datetime-local Wert (Ortszeit) aus ISO */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmt = (iso: string) => new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export async function renderPassAdmin(body: HTMLElement, sub: string | undefined, extra: string | undefined) {
  const s: Sub = (SUBS.map((x) => x[0]) as string[]).includes(sub ?? "") ? (sub as Sub) : "season";
  body.innerHTML = `<div class="chips adm-sp-subs">${SUBS.map(([id, l]) => `<a class="chip${id === s ? " on" : ""}" href="#/admin/shop/${id}">${l}</a>`).join("")}</div>
    <div id="adm-sp"><div class="empty">Lädt…</div></div>`;
  const el = body.querySelector<HTMLElement>("#adm-sp")!;
  let o: AdminPassOverview;
  try {
    o = await adminPassOverview();
  } catch (e) {
    el.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    return;
  }
  if (!el.isConnected) return;
  const again = () => void renderPassAdmin(body, s, extra);
  if (s === "belohnungen") return void renderRewards(el, o, Number(extra) || o.current);
  if (s === "items") return renderItems(el, o, again);
  if (s === "shop") return renderShopAdmin(el, o, again);
  if (s === "preise") return renderPrices(el, o, again);
  return renderSeasons(el, o, again);
}

// ---------- Seasons & Einstellungen ----------

function renderSeasons(el: HTMLElement, o: AdminPassOverview, again: () => void) {
  const cur = o.seasons.find((x) => x.id === o.current);
  const nextStart = o.seasons.reduce((m, x) => (new Date(x.ends_at) > m ? new Date(x.ends_at) : m), new Date(cur?.ends_at ?? Date.now()));
  el.innerHTML = `
    <section class="card-sec">
      <h2 class="sec-title">Testkäufe (Echtgeld simuliert)</h2>
      <p class="muted small">Solange die App nicht in den Stores ist, werden Käufe nur simuliert und gespeichert – es wird kein Geld abgebucht.</p>
      <select id="adm-test" class="adm-input">
        <option value="admins"${o.settings.test_purchases === "admins" ? " selected" : ""}>Nur Admins dürfen testkaufen</option>
        <option value="all"${o.settings.test_purchases === "all" ? " selected" : ""}>Alle Spieler dürfen testkaufen</option>
        <option value="off"${o.settings.test_purchases === "off" ? " selected" : ""}>Aus (niemand)</option>
      </select>
      <p class="muted small">Testkäufe bisher: ${num(o.stats.test_purchases)} · echte Käufe: ${num(o.stats.real_purchases)} (${euro(o.stats.real_revenue_cents)})</p>
    </section>
    <section class="card-sec">
      <h2 class="sec-title">Seasons</h2>
      ${o.seasons
        .map(
          (x) => `<div class="adm-card${x.id === o.current ? " adm-cur" : ""}">
          <div class="adm-head"><b>${esc(x.name)}</b>${x.id === o.current ? ` <span class="pill">läuft</span>` : new Date(x.starts_at) > new Date() ? ` <span class="pill">geplant</span>` : ""}
            <small>${fmt(x.starts_at)} – ${fmt(x.ends_at)} · ${x.levels} Stufen à ${num(x.level_xp)} XP · ${num(x.players)} Spieler · ${num(x.premium)} mit Pass</small></div>
          ${
            new Date(x.ends_at) > new Date()
              ? `<form class="adm-row adm-season-form" data-id="${x.id}">
                  <input name="name" class="adm-input" maxlength="40" value="${esc(x.name)}" aria-label="Name">
                  <input name="ends" class="adm-input" type="datetime-local" value="${toLocalInput(x.ends_at)}" aria-label="Ende">
                  <button class="btn small" type="submit">Speichern</button>
                  <a class="btn small" href="#/admin/shop/belohnungen/${x.id}">Belohnungen</a>
                </form>`
              : ""
          }
        </div>`,
        )
        .join("")}
      <p class="muted small">Läuft eine Season ab und ist keine neue geplant, startet automatisch die nächste (gleiche Länge, gleiche Belohnungen, neuer exklusiver Skin).</p>
    </section>
    <section class="card-sec">
      <h2 class="sec-title">Neue Season planen</h2>
      <form id="adm-new-season" class="adm-form">
        <label class="lbl">Name<input name="name" class="adm-input" maxlength="40" placeholder="z. B. Winter-Season"></label>
        <label class="lbl">Start<input name="start" class="adm-input" type="datetime-local" value="${toLocalInput(nextStart.toISOString())}"></label>
        <label class="lbl">Dauer (Wochen)<input name="weeks" class="adm-input" type="number" min="1" max="26" value="6"></label>
        <button class="btn sm primary" type="submit">Season anlegen</button>
        <p class="muted small">Die Belohnungen der laufenden Season werden übernommen und können danach geändert werden.</p>
      </form>
    </section>`;

  el.querySelector<HTMLSelectElement>("#adm-test")!.addEventListener("change", async (e) => {
    try {
      await adminPassSetSetting("test_purchases", (e.target as HTMLSelectElement).value);
      toast("Gespeichert ✓");
    } catch (err) {
      toast(errMsg(err));
    }
  });
  el.querySelectorAll<HTMLFormElement>(".adm-season-form").forEach((f) =>
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await adminPassUpdateSeason(Number(f.dataset.id), String(fd.get("name")), new Date(String(fd.get("ends"))).toISOString());
        toast("Season gespeichert ✓");
        again();
      } catch (err) {
        toast(errMsg(err));
      }
    }),
  );
  el.querySelector<HTMLFormElement>("#adm-new-season")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await adminPassCreateSeason(String(fd.get("name") ?? ""), new Date(String(fd.get("start"))).toISOString(), Number(fd.get("weeks")));
      toast("Season angelegt ✓");
      again();
    } catch (err) {
      toast(errMsg(err));
    }
  });
}

// ---------- Belohnungen pro Stufe ----------

async function renderRewards(el: HTMLElement, o: AdminPassOverview, seasonId: number) {
  const season = o.seasons.find((x) => x.id === seasonId) ?? o.seasons.find((x) => x.id === o.current);
  if (!season) {
    el.innerHTML = `<p class="muted">Keine Season.</p>`;
    return;
  }
  let rows: AdminReward[];
  try {
    rows = await adminPassRewards(season.id);
  } catch (e) {
    el.innerHTML = `<div class="inline-error">${esc(errMsg(e))}</div>`;
    return;
  }
  if (!el.isConnected) return;
  const items = [...o.items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
  const by = new Map(rows.map((r) => [`${r.level}:${r.track}`, r]));
  const opts = (sel: string | null) =>
    `<option value="">– nur Coins/Gems –</option>${items
      .map((i) => `<option value="${esc(i.id)}"${i.id === sel ? " selected" : ""}>${esc(KIND_LABEL[i.kind])}: ${esc(i.name)}${i.exclusive ? " (exklusiv)" : ""}</option>`)
      .join("")}`;
  const line = (l: number, track: "free" | "premium") => {
    const r = by.get(`${l}:${track}`);
    return `<form class="adm-rw" data-l="${l}" data-t="${track}">
        <span class="adm-rw-t">${track === "free" ? "Gratis" : "Premium ⭐"}</span>
        <select name="item" class="adm-input">${opts(r?.item_id ?? null)}</select>
        <label>🪙<input name="coins" class="adm-input" type="number" min="0" max="100000" value="${r?.coins ?? 0}"></label>
        <label>💎<input name="gems" class="adm-input" type="number" min="0" max="10000" value="${r?.gems ?? 0}"></label>
      </form>`;
  };
  el.innerHTML = `
    <div class="adm-row"><label class="lbl">Season
      <select id="adm-rw-season" class="adm-input">${o.seasons
        .filter((x) => new Date(x.ends_at) > new Date())
        .map((x) => `<option value="${x.id}"${x.id === season.id ? " selected" : ""}>${esc(x.name)}</option>`)
        .join("")}</select></label></div>
    <p class="muted small">Änderungen werden sofort gespeichert. Alles leer/0 = keine Belohnung auf dieser Stufe.</p>
    ${Array.from({ length: season.levels }, (_, i) => i + 1)
      .map((l) => `<div class="adm-card adm-rw-card"><div class="adm-head"><b>Stufe ${l}</b></div>${line(l, "free")}${line(l, "premium")}</div>`)
      .join("")}`;
  el.querySelector<HTMLSelectElement>("#adm-rw-season")?.addEventListener("change", (e) => {
    location.hash = `#/admin/shop/belohnungen/${(e.target as HTMLSelectElement).value}`;
  });
  el.querySelectorAll<HTMLFormElement>(".adm-rw").forEach((f) => {
    f.addEventListener("submit", (e) => e.preventDefault());
    f.addEventListener("change", async () => {
      const fd = new FormData(f);
      try {
        await adminPassSetReward(season.id, Number(f.dataset.l), f.dataset.t!, String(fd.get("item") || "") || null, Number(fd.get("coins") || 0), Number(fd.get("gems") || 0));
        f.classList.add("saved");
        setTimeout(() => f.classList.remove("saved"), 900);
      } catch (err) {
        toast(errMsg(err));
      }
    });
  });
}

// ---------- Items ----------

const FIELDS: Record<ItemKind, [string, string][]> = {
  skin: [["a", "Farbe 1"], ["b", "Farbe 2"]],
  frame: [["c1", "Farbe 1"], ["c2", "Farbe 2"]],
  avatar: [["e", "Emoji"], ["bg", "Hintergrund"]],
  title: [["t", "Titel-Text"]],
  namecolor: [["c1", "Farbe 1"], ["c2", "Farbe 2 (optional)"]],
  emote: [["e", "Emoji"], ["t", "Text"]],
  victory: [["e", "Emojis (mit Leerzeichen getrennt)"]],
};

function renderItems(el: HTMLElement, o: AdminPassOverview, again: () => void) {
  let editing: (Item & { active: boolean }) | null = null;
  const draw = () => {
    const kind: ItemKind = editing?.kind ?? (el.querySelector<HTMLSelectElement>("#it-kind")?.value as ItemKind) ?? "skin";
    const d = editing?.data ?? {};
    el.innerHTML = `
      <section class="card-sec">
        <h2 class="sec-title">${editing ? `Item bearbeiten: ${esc(editing.id)}` : "Neues Item"}</h2>
        <form id="it-form" class="adm-form">
          <label class="lbl">ID (a–z, 0–9, _)<input name="id" class="adm-input" pattern="[a-z0-9_]{2,40}" required value="${esc(editing?.id ?? "")}"${editing ? " readonly" : ""}></label>
          <label class="lbl">Art<select id="it-kind" name="kind" class="adm-input"${editing ? " disabled" : ""}>${KIND_ORDER.map(
            (k) => `<option value="${k}"${k === kind ? " selected" : ""}>${KIND_LABEL[k]}</option>`,
          ).join("")}</select></label>
          <label class="lbl">Name<input name="name" class="adm-input" maxlength="40" required value="${esc(editing?.name ?? "")}"></label>
          <label class="lbl">Seltenheit<select name="rarity" class="adm-input">${(Object.keys(RARITY_LABEL) as Rarity[])
            .map((r) => `<option value="${r}"${r === (editing?.rarity ?? "common") ? " selected" : ""}>${RARITY_LABEL[r]}</option>`)
            .join("")}</select></label>
          ${FIELDS[kind]
            .map(([k, l]) => {
              const v = d[k as keyof typeof d];
              const val = Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : "";
              const color = ["a", "b", "c1", "c2", "bg"].includes(k);
              return `<label class="lbl">${l}<input name="d_${k}" class="adm-input" ${color ? `type="color" value="${esc(val || "#a45cff")}"` : `value="${esc(val)}" maxlength="${k === "t" ? 24 : 40}"`}></label>`;
            })
            .join("")}
          ${["skin", "frame"].includes(kind) ? `<label class="toggle"><input type="checkbox" name="d_anim"${d.anim ? " checked" : ""}> animiert</label>` : ""}
          ${kind === "namecolor" ? `<label class="toggle"><input type="checkbox" name="no_c2"${editing && !d.c2 ? " checked" : ""}> nur eine Farbe (kein Verlauf)</label>` : ""}
          <label class="toggle"><input type="checkbox" name="active"${editing?.active === false ? "" : " checked"}> aktiv</label>
          <div class="actions-row"><button class="btn sm primary" type="submit">Speichern</button>${editing ? `<button class="btn sm ghost" type="button" data-new>Neu</button>` : ""}</div>
        </form>
      </section>
      ${KIND_ORDER.map((k) => {
        const list = o.items.filter((i) => i.kind === k);
        return list.length
          ? `<section class="card-sec"><h2 class="sec-title">${KIND_LABEL[k]} (${list.length})</h2><div class="adm-items">${list
              .map(
                (i) => `<button class="adm-item${i.active ? "" : " off"}" type="button" data-edit="${esc(i.id)}">${itemIcon(i)}<span><b>${esc(i.name)}</b><small>${esc(i.id)} · ${RARITY_LABEL[i.rarity]}${i.exclusive ? " · exklusiv" : ""} · ${num(i.owners)}× im Besitz${i.active ? "" : " · inaktiv"}</small></span></button>`,
              )
              .join("")}</div></section>`
          : "";
      }).join("")}`;
    el.querySelector("#it-kind")?.addEventListener("change", () => draw());
    el.querySelector("[data-new]")?.addEventListener("click", () => {
      editing = null;
      draw();
    });
    el.querySelectorAll<HTMLElement>("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        editing = o.items.find((i) => i.id === b.dataset.edit) ?? null;
        draw();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }),
    );
    el.querySelector<HTMLFormElement>("#it-form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const fd = new FormData(f);
      const data: Record<string, unknown> = {};
      for (const [k] of FIELDS[kind]) {
        const v = String(fd.get(`d_${k}`) ?? "").trim();
        if (!v) continue;
        if (kind === "namecolor" && k === "c2" && fd.get("no_c2")) continue;
        data[k] = kind === "victory" && k === "e" ? v.split(/\s+/).filter(Boolean).slice(0, 6) : v;
      }
      if (fd.get("d_anim")) data.anim = true;
      try {
        o = await adminPassSaveItem(String(fd.get("id") ?? editing?.id), kind, String(fd.get("name")), String(fd.get("rarity")), data, Boolean(fd.get("active")));
        toast("Item gespeichert ✓");
        editing = null;
        draw();
      } catch (err) {
        toast(errMsg(err));
      }
    });
  };
  void again;
  draw();
}

// ---------- Shop-Katalog ----------

function renderShopAdmin(el: HTMLElement, o: AdminPassOverview, again: () => void) {
  const items = new Map(o.items.map((i) => [i.id, i]));
  const free = o.items.filter((i) => !i.exclusive && !o.shop.some((s) => s.item_id === i.id));
  el.innerHTML = `
    <p class="muted small">Jeden Tag zeigt der Shop 6 zufällige Items aus dieser Liste (für alle gleich) plus alle „Immer da“-Items. Preis leer = nicht mit dieser Währung kaufbar. Beide leer + Speichern = aus dem Shop entfernen.</p>
    <section class="card-sec">
      <h2 class="sec-title">Item in den Shop</h2>
      <form id="sh-add" class="adm-row">
        <select name="item" class="adm-input">${free.map((i) => `<option value="${esc(i.id)}">${esc(KIND_LABEL[i.kind])}: ${esc(i.name)}</option>`).join("")}</select>
        <label>🪙<input name="coins" class="adm-input" type="number" min="1" placeholder="Coins"></label>
        <label>💎<input name="gems" class="adm-input" type="number" min="1" placeholder="Gems"></label>
        <button class="btn small" type="submit"${free.length ? "" : " disabled"}>Hinzufügen</button>
      </form>
    </section>
    <section class="card-sec">
      <h2 class="sec-title">Shop-Katalog (${o.shop.length})</h2>
      ${o.shop
        .map((r) => {
          const it = items.get(r.item_id);
          return `<form class="adm-card adm-shop-row" data-item="${esc(r.item_id)}">
            <div class="adm-head">${it ? itemIcon(it) : ""}<b>${esc(it?.name ?? r.item_id)}</b>${r.today ? ` <span class="pill">heute im Shop</span>` : ""}<small>${it ? KIND_LABEL[it.kind] : ""}</small></div>
            <div class="adm-row">
              <label>🪙<input name="coins" class="adm-input" type="number" min="1" value="${r.price_coins ?? ""}"></label>
              <label>💎<input name="gems" class="adm-input" type="number" min="1" value="${r.price_gems ?? ""}"></label>
              <label class="toggle"><input type="checkbox" name="always"${r.always ? " checked" : ""}> immer da</label>
              <label class="toggle"><input type="checkbox" name="active"${r.active ? " checked" : ""}> aktiv</label>
              <button class="btn small" type="submit">Speichern</button>
            </div>
          </form>`;
        })
        .join("")}
    </section>`;
  const n = (v: FormDataEntryValue | null) => (v == null || String(v).trim() === "" ? null : Number(v));
  el.querySelector<HTMLFormElement>("#sh-add")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await adminPassSetShop(String(fd.get("item")), n(fd.get("coins")), n(fd.get("gems")), false, true);
      toast("Im Shop ✓");
      again();
    } catch (err) {
      toast(errMsg(err));
    }
  });
  el.querySelectorAll<HTMLFormElement>(".adm-shop-row").forEach((f) =>
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await adminPassSetShop(f.dataset.item!, n(fd.get("coins")), n(fd.get("gems")), Boolean(fd.get("always")), Boolean(fd.get("active")));
        toast("Gespeichert ✓");
        again();
      } catch (err) {
        toast(errMsg(err));
      }
    }),
  );
}

// ---------- Echtgeld-Preise ----------

function renderPrices(el: HTMLElement, o: AdminPassOverview, again: () => void) {
  el.innerHTML = `
    <p class="muted small">Preise in Euro. Für echte Käufe müssen dieselben Produkte später auch im App Store / bei Google Play angelegt werden.</p>
    ${o.products
      .map(
        (p) => `<form class="adm-card adm-prod" data-id="${esc(p.id)}">
        <div class="adm-head"><b>${esc(p.name)}</b><small>${esc(p.id)}${p.once ? " · nur einmal kaufbar" : ""}${p.item_ids.length ? ` · Items: ${esc(p.item_ids.join(", "))}` : ""}</small></div>
        <div class="adm-row">
          <label class="lbl">Name<input name="name" class="adm-input" maxlength="40" value="${esc(p.name)}"></label>
          <label class="lbl">Preis (€)<input name="price" class="adm-input" type="number" min="0" max="999.99" step="0.01" value="${(p.price_cents / 100).toFixed(2)}"></label>
          ${p.id === "pass" ? "" : `<label class="lbl">💎 Gems<input name="gems" class="adm-input" type="number" min="0" value="${p.gems}"></label>
          <label class="lbl">🪙 Coins<input name="coins" class="adm-input" type="number" min="0" value="${p.coins}"></label>`}
          <label class="toggle"><input type="checkbox" name="active"${p.active ? " checked" : ""}> aktiv</label>
          <button class="btn small" type="submit">Speichern</button>
        </div>
      </form>`,
      )
      .join("")}`;
  el.querySelectorAll<HTMLFormElement>(".adm-prod").forEach((f) =>
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await adminPassSetProduct(
          f.dataset.id!,
          String(fd.get("name")),
          Math.round(Number(fd.get("price")) * 100),
          Number(fd.get("gems") ?? 0),
          Number(fd.get("coins") ?? 0),
          Boolean(fd.get("active")),
        );
        toast("Preis gespeichert ✓");
        again();
      } catch (err) {
        toast(errMsg(err));
      }
    }),
  );
}
