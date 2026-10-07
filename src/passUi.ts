// Season Pass (#/pass), Shop (#/shop) und Sammlung (#/sammlung) – plus kleine Extras:
// Rückmeldung nach Runden (+XP), Siegesanimation, Skin der App, Kosmetik in Profilen, Einladungen.
// Der Server rechnet alles selbst (supabase/seasonpass.sql). Nichts hier beeinflusst Trophäen oder Punkte.

import { esc, modal, toast } from "./ui";
import {
  getSeasonPass,
  claimSeasonReward,
  getSeasonPing,
  getShop,
  buyShopItem,
  buyProductTest,
  getMyCosmetics,
  equipCosmetic,
  getPlayerCosmetics,
  claimReferral,
  SocialError,
} from "./social";
import {
  KIND_LABEL,
  KIND_ORDER,
  RARITY_LABEL,
  emojiList,
  euro,
  gemsInEuro,
  itemIcon,
  nameStyle,
  num,
  rewardInner,
  safeColor,
  safeEmoji,
  timeLeft,
  type Cosmetics,
  type Equipped,
  type Item,
  type ItemKind,
  type Quest,
  type Reward,
  type SeasonPass,
  type Shop,
  type ShopItem,
  type Product,
} from "./passKit";
import { profileLink, shareLink } from "./profileKit";

const errMsg = (e: unknown) => (e instanceof SocialError ? e.message : "Da ist etwas schiefgelaufen.");

// =====================================================================
// Season Pass
// =====================================================================

let lastPass: SeasonPass | null = null;

function walletHtml(w: { coins: number; gems: number }): string {
  return `<div class="sp-wallet" aria-label="Guthaben"><span>🪙 <b>${num(w.coins)}</b></span><span>💎 <b>${num(w.gems)}</b></span></div>`;
}

function tileHtml(r: Reward | undefined, p: SeasonPass, track: "free" | "premium"): string {
  if (!r) return `<div class="sp-tile empty ${track}"></div>`;
  const reached = p.level >= r.level;
  const locked = track === "premium" && !p.premium;
  const claimable = reached && !locked && !r.claimed;
  const { icon, label } = rewardInner(r);
  const rar = r.item ? ` r-${r.item.rarity}` : "";
  return `<button class="sp-tile ${track}${rar}${r.claimed ? " claimed" : ""}${claimable ? " ready" : ""}${!reached ? " future" : ""}${locked ? " locked" : ""}"
      type="button" data-lvl="${r.level}" data-track="${track}" aria-label="Stufe ${r.level} ${track === "premium" ? "Premium" : "Gratis"}: ${label}${r.claimed ? " (abgeholt)" : ""}">
      ${icon}
      <span class="sp-tile-name">${label}</span>
      ${claimable ? `<span class="sp-claim">Abholen</span>` : r.claimed ? `<span class="sp-done">✓</span>` : locked ? `<span class="sp-lock">🔒</span>` : ""}
    </button>`;
}

function questHtml(q: Quest, invite: boolean): string {
  const pct = Math.min(100, Math.round((q.progress / q.goal) * 100));
  return `<div class="sp-quest${q.done ? " done" : ""}">
      <div class="sp-q-top"><b>${esc(q.title)}</b><span class="sp-q-xp">+${num(q.xp)} XP${q.coins ? ` · 🪙 ${num(q.coins)}` : ""}</span></div>
      <div class="sp-q-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${q.goal}" aria-valuenow="${Math.min(q.progress, q.goal)}"><i style="width:${pct}%"></i></div>
      <div class="sp-q-foot"><small class="muted">${q.done ? "Geschafft ✓" : `${num(Math.min(q.progress, q.goal))} / ${num(q.goal)}`}</small>
      ${invite && !q.done ? `<button class="btn sm sp-invite" type="button" data-sp="invite">Einladen 📤</button>` : ""}</div>
    </div>`;
}

function passHtml(p: SeasonPass): string {
  const s = p.season;
  const atMax = p.level >= s.levels;
  const inLevel = atMax ? s.level_xp : p.xp - p.level * s.level_xp;
  const pct = Math.min(100, Math.round((inLevel / s.level_xp) * 100));
  const by = new Map<string, Reward>();
  p.rewards.forEach((r) => by.set(`${r.level}:${r.track}`, r));
  const ready = p.rewards.filter((r) => p.level >= r.level && !r.claimed && (r.track === "free" || p.premium)).length;
  const cols = Array.from({ length: s.levels }, (_, i) => i + 1)
    .map(
      (l) => `<div class="sp-col${p.level >= l ? " reached" : ""}${l === Math.min(s.levels, p.level + 1) ? " current" : ""}" data-col="${l}">
        ${tileHtml(by.get(`${l}:free`), p, "free")}
        <div class="sp-num"><span>${l}</span></div>
        ${tileHtml(by.get(`${l}:premium`), p, "premium")}
      </div>`,
    )
    .join("");
  const price = p.pass_price_cents != null ? euro(p.pass_price_cents) : "";
  return `
    <section class="sp-hero">
      <div class="sp-hero-top"><div><small class="muted">Season Pass</small><h2>${esc(s.name)}</h2></div>
        <span class="sp-ends" title="Endet am ${esc(new Date(s.ends_at).toLocaleString("de-DE"))}">⏳ <b id="sp-ends">${timeLeft(s.ends_at)}</b></span></div>
      <div class="sp-lvl">
        <span class="sp-lvl-badge" aria-label="Stufe ${p.level}">${p.level}</span>
        <div class="sp-lvl-main">
          <div class="sp-xpbar"><i style="width:${pct}%"></i></div>
          <small class="muted">${atMax ? "Alle Stufen geschafft! 🎉" : `${num(inLevel)} / ${num(s.level_xp)} XP bis Stufe ${p.level + 1}`}</small>
        </div>
      </div>
      ${
        p.premium
          ? `<div class="sp-prem-on">⭐ Premium aktiv – alle Belohnungen freigeschaltet</div>`
          : p.pass_price_cents != null
            ? `<button class="btn primary sp-buy" type="button" data-sp="buy-pass">⭐ Season Pass holen · ${price}</button>`
            : ""
      }
    </section>
    <div class="sp-track-head">
      <span class="sp-lab free">Gratis</span><span class="sp-lab prem">Premium ⭐</span>
      ${ready > 0 ? `<button class="btn sm primary sp-all" type="button" data-sp="claim-all">Alle abholen (${ready})</button>` : ""}
    </div>
    <div class="sp-track" id="sp-track" tabindex="0" aria-label="Belohnungen Stufe 1 bis ${s.levels}">${cols}</div>
    <section class="card-sec sp-quests">
      <div class="sp-q-head"><h2 class="sec-title">Tägliche Aufgaben</h2><small class="muted">neu in ${timeLeft(p.quests.daily_ends).replace("noch ", "")}</small></div>
      ${p.quests.daily.map((q) => questHtml(q, q.metric === "invites")).join("") || `<p class="muted">Keine Aufgaben.</p>`}
    </section>
    <section class="card-sec sp-quests">
      <div class="sp-q-head"><h2 class="sec-title">Wochen-Aufgaben</h2><small class="muted">neu in ${timeLeft(p.quests.weekly_ends).replace("noch ", "")}</small></div>
      ${p.quests.weekly.map((q) => questHtml(q, q.metric === "invites")).join("") || `<p class="muted">Keine Aufgaben.</p>`}
    </section>
    <section class="card-sec sp-how">
      <h2 class="sec-title">So bekommst du XP</h2>
      <p>Trophäen-Runde: 120 XP (gewonnen) bzw. 60 XP · Minigame: 60 XP ab Stufe 5, sonst 30 XP · Daily: 150 XP · dazu die Aufgaben. Aus Runden gibt es höchstens 1.500 XP am Tag.</p>
      <p class="muted">Alle Belohnungen sind nur Optik – sie geben keine Trophäen und keinen Vorteil im Spiel.</p>
    </section>
    <div class="sp-links">
      <a class="btn sm" href="#/shop">🛒 Shop</a>
      <a class="btn sm" href="#/sammlung">🎒 Sammlung</a>
    </div>`;
}

export async function renderPass(page: HTMLElement, myName: string | undefined) {
  page.innerHTML = lastPass ? passHtml(lastPass) : `<div class="empty">Lädt…</div>`;
  if (lastPass) bindPass(page, lastPass, myName);
  try {
    const p = await getSeasonPass();
    if (!page.isConnected) return;
    show(page, p, myName, true);
  } catch (e) {
    if (!page.isConnected) return;
    page.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
  }
}

function show(page: HTMLElement, p: SeasonPass, myName: string | undefined, scroll: boolean) {
  const keep = page.querySelector<HTMLElement>("#sp-track")?.scrollLeft;
  lastPass = p;
  page.innerHTML = passHtml(p);
  bindPass(page, p, myName);
  const track = page.querySelector<HTMLElement>("#sp-track");
  if (track) {
    if (!scroll && keep != null) track.scrollLeft = keep;
    else {
      const cur = track.querySelector<HTMLElement>(".sp-col.current");
      if (cur) track.scrollLeft = Math.max(0, cur.offsetLeft - track.clientWidth / 2 + cur.clientWidth / 2);
    }
  }
}

function bindPass(page: HTMLElement, p: SeasonPass, myName: string | undefined) {
  const iv = window.setInterval(() => {
    const el = page.querySelector("#sp-ends");
    if (!el) return clearInterval(iv);
    el.textContent = timeLeft(p.season.ends_at);
    if (new Date(p.season.ends_at).getTime() <= Date.now()) {
      clearInterval(iv);
      void renderPass(page, myName);
    }
  }, 30000);

  page.querySelector<HTMLElement>("#sp-track")?.addEventListener("click", async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>(".sp-tile[data-lvl]");
    if (!t) return;
    const level = Number(t.dataset.lvl);
    const track = t.dataset.track as "free" | "premium";
    const r = p.rewards.find((x) => x.level === level && x.track === track);
    if (!r) return;
    if (t.classList.contains("ready")) {
      t.classList.add("busy");
      try {
        const np = await claimSeasonReward(level, track);
        toast(`🎁 ${r.item ? r.item.name : r.gems ? `${num(r.gems)} Gems` : `${num(r.coins)} Coins`} abgeholt!`);
        cosmeticsCache.clear();
        if (page.isConnected) show(page, np, myName, false);
      } catch (err) {
        t.classList.remove("busy");
        toast(errMsg(err));
      }
      return;
    }
    rewardInfo(r, p);
  });

  page.querySelector('[data-sp="claim-all"]')?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const np = await claimSeasonReward();
      toast("🎁 Alles abgeholt!");
      cosmeticsCache.clear();
      if (page.isConnected) show(page, np, myName, false);
    } catch (err) {
      b.disabled = false;
      toast(errMsg(err));
    }
  });

  page.querySelector('[data-sp="buy-pass"]')?.addEventListener("click", () =>
    buyFlow(
      { id: "pass", name: "Season Pass", price_cents: p.pass_price_cents ?? 0, gems: 0, coins: 0, items: [], once: false, owned: p.premium },
      p.can_buy,
      p.level,
      () => void renderPass(page, myName),
    ),
  );

  page.querySelectorAll('[data-sp="invite"]').forEach((b) =>
    b.addEventListener("click", () => {
      if (!myName) return toast("Wähle zuerst deinen Spielernamen im Profil.");
      void shareLink(inviteLink(myName), "Spiel ZWIP mit mir! ⚡ 10 Blitz-Challenges, jeden Tag neu.");
    }),
  );
}

function inviteLink(name: string): string {
  const u = new URL(profileLink(name));
  u.searchParams.set("ref", name);
  return u.toString();
}

function rewardInfo(r: Reward, p: SeasonPass) {
  const { icon, label } = rewardInner(r);
  const state =
    r.track === "premium" && !p.premium
      ? "Nur mit Season Pass ⭐"
      : r.claimed
        ? "Schon abgeholt ✓"
        : p.level >= r.level
          ? "Bereit zum Abholen"
          : `Ab Stufe ${r.level}`;
  modal(`<div class="sp-info">
      <div class="sp-info-ico">${icon}</div>
      <h3>${label}</h3>
      ${r.item ? `<p class="muted">${KIND_LABEL[r.item.kind]} · ${RARITY_LABEL[r.item.rarity]}${r.item.exclusive ? " · nur diese Season" : ""}</p>` : ""}
      ${r.item?.kind === "title" ? `<p class="sp-title-tag">${esc(r.item.data.t ?? r.item.name)}</p>` : ""}
      <p><b>${state}</b></p>
      <button class="btn sm" type="button" data-close>OK</button>
    </div>`);
}

// =====================================================================
// Kauf mit echtem Geld (vorerst Testmodus)
// =====================================================================

function buyFlow(prod: Product, canBuy: boolean, level: number | null, done: () => void) {
  if (prod.owned) return toast("Hast du schon ✓");
  const contents =
    prod.id === "pass"
      ? `<ul class="sp-list"><li>Premium-Spur mit Skins, Rahmen, Emotes, Siegesanimationen, Namensfarben und Titel</li>
         <li>Exklusiver Season-Skin auf Stufe 40</li>
         ${level ? `<li>Sofort alle Premium-Belohnungen bis Stufe ${level}</li>` : ""}<li>Gilt nur für diese Season</li></ul>`
      : `<ul class="sp-list">${prod.gems ? `<li>💎 ${num(prod.gems)} Gems</li>` : ""}${prod.coins ? `<li>🪙 ${num(prod.coins)} Coins</li>` : ""}${prod.items
          .map((i) => `<li>${esc(i.name)} (${KIND_LABEL[i.kind]})</li>`)
          .join("")}</ul>`;
  modal(
    `<div class="sp-buy-modal">
      <h3>${esc(prod.name)}</h3>
      ${contents}
      <div class="sp-price">${euro(prod.price_cents)}</div>
      ${
        canBuy
          ? `<p class="sp-test-note">🧪 Testmodus: Der Kauf wird nur simuliert. Es wird <b>kein Geld</b> abgebucht.</p>
             <p class="muted small">Unter 18? Frag vorher deine Eltern. Alles ist nur Optik – kein Vorteil im Spiel.</p>
             <div class="actions-row"><button class="btn primary sm" type="button" data-buy>Kaufen · ${euro(prod.price_cents)}</button><button class="btn ghost sm" type="button" data-close>Abbrechen</button></div>`
          : `<p class="muted">Käufe mit echtem Geld kommen, sobald ZWIP im App Store und bei Google Play ist.</p>
             <button class="btn sm" type="button" data-close>OK</button>`
      }
    </div>`,
    (el, close) => {
      el.querySelector<HTMLButtonElement>("[data-buy]")?.addEventListener("click", async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        b.textContent = "Einen Moment…";
        try {
          await buyProductTest(prod.id);
          close();
          toast(prod.id === "pass" ? "⭐ Season Pass freigeschaltet!" : `✓ ${prod.name} gekauft`);
          cosmeticsCache.clear();
          done();
        } catch (err) {
          b.disabled = false;
          b.textContent = `Kaufen · ${euro(prod.price_cents)}`;
          toast(errMsg(err));
        }
      });
    },
  );
}

// =====================================================================
// Shop
// =====================================================================

function shopItemHtml(it: ShopItem, shop: Shop): string {
  const buy = (cur: "coins" | "gems", price: number) =>
    `<button class="sp-pbtn ${cur}" type="button" data-buy="${esc(it.id)}" data-cur="${cur}">${cur === "coins" ? "🪙" : "💎"} ${num(price)}${cur === "gems" ? `<small>≈ ${gemsInEuro(price, shop.products)}</small>` : ""}</button>`;
  return `<div class="sp-card r-${it.rarity}${it.owned ? " owned" : ""}">
      ${it.always ? `<span class="sp-badge">Immer da</span>` : ""}
      ${itemIcon(it, "big")}
      <b class="sp-card-name">${esc(it.name)}</b>
      <small class="muted">${KIND_LABEL[it.kind]} · ${RARITY_LABEL[it.rarity]}</small>
      <div class="sp-prices">${
        it.owned
          ? `<span class="sp-owned">Hast du ✓</span>`
          : `${it.price_coins != null ? buy("coins", it.price_coins) : ""}${it.price_gems != null ? buy("gems", it.price_gems) : ""}`
      }</div>
    </div>`;
}

function productHtml(p: Product): string {
  const what =
    p.id === "pass"
      ? "Premium-Spur dieser Season"
      : [p.gems ? `💎 ${num(p.gems)} Gems` : "", p.coins ? `🪙 ${num(p.coins)} Coins` : "", ...p.items.map((i) => esc(i.name))].filter(Boolean).join(" · ");
  return `<button class="sp-prod${p.owned ? " owned" : ""}${p.id === "pass" ? " pass" : ""}" type="button" data-prod="${esc(p.id)}">
      <span class="sp-prod-ico">${p.id === "pass" ? "⭐" : p.id === "starter" ? "🎁" : "💎"}</span>
      <span class="sp-prod-txt"><b>${esc(p.name)}</b><small>${what}${p.once ? " · nur einmal" : ""}</small></span>
      <span class="sp-prod-price">${p.owned ? "✓" : euro(p.price_cents)}</span>
    </button>`;
}

function shopHtml(s: Shop): string {
  return `${walletHtml(s.wallet)}
    ${s.can_buy && s.test_mode !== "off" ? `<div class="sp-test-banner">🧪 Testmodus – Käufe mit echtem Geld werden nur simuliert.</div>` : ""}
    <section class="sp-shop-sec">
      <div class="sp-q-head"><h2 class="sec-title">Täglicher Shop</h2><small class="muted">neu in ${timeLeft(s.ends_at).replace("noch ", "")}</small></div>
      <div class="sp-grid">${s.items.map((i) => shopItemHtml(i, s)).join("") || `<p class="muted">Heute ist der Shop leer.</p>`}</div>
    </section>
    <section class="sp-shop-sec">
      <h2 class="sec-title">Season Pass, Gems & Angebote</h2>
      <div class="sp-prods">${s.products.map(productHtml).join("")}</div>
    </section>
    <p class="muted small sp-fair">Keine Lootboxen: Du siehst immer vorher genau, was du bekommst. Alles ist nur Optik – kein Vorteil im Spiel. Coins verdienst du durchs Spielen, Gems gibt es selten im Pass oder zu kaufen.</p>
    <div class="sp-links"><a class="btn sm" href="#/pass">⭐ Season Pass</a><a class="btn sm" href="#/sammlung">🎒 Sammlung</a></div>`;
}

export async function renderShop(page: HTMLElement) {
  page.innerHTML = `<div class="empty">Lädt…</div>`;
  let shop: Shop;
  try {
    shop = await getShop();
  } catch (e) {
    if (page.isConnected) page.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    return;
  }
  const draw = (s: Shop) => {
    shop = s;
    if (!page.isConnected) return;
    page.innerHTML = shopHtml(s);
  };
  draw(shop);
  page.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLButtonElement>("[data-buy]");
    if (b) {
      const it = shop.items.find((i) => i.id === b.dataset.buy);
      const cur = b.dataset.cur as "coins" | "gems";
      if (!it) return;
      const price = cur === "coins" ? it.price_coins! : it.price_gems!;
      const have = cur === "coins" ? shop.wallet.coins : shop.wallet.gems;
      modal(
        `<div class="sp-buy-modal">
          ${itemIcon(it, "big")}
          <h3>${esc(it.name)}</h3>
          <p class="muted">${KIND_LABEL[it.kind]} · ${RARITY_LABEL[it.rarity]}</p>
          <div class="sp-price">${cur === "coins" ? "🪙" : "💎"} ${num(price)}</div>
          ${cur === "gems" ? `<p class="muted small">Das sind etwa ${gemsInEuro(price, shop.products)}.</p>` : ""}
          ${
            have < price
              ? `<p class="inline-error">Du hast ${cur === "coins" ? `nur ${num(have)} Coins` : `nur ${num(have)} Gems`}.</p><button class="btn sm" type="button" data-close>OK</button>`
              : `<div class="actions-row"><button class="btn primary sm" type="button" data-ok>Kaufen</button><button class="btn ghost sm" type="button" data-close>Abbrechen</button></div>`
          }
        </div>`,
        (el, close) => {
          el.querySelector<HTMLButtonElement>("[data-ok]")?.addEventListener("click", async (ev) => {
            const ok = ev.currentTarget as HTMLButtonElement;
            ok.disabled = true;
            try {
              draw(await buyShopItem(it.id, cur));
              close();
              cosmeticsCache.clear();
              toast(`✓ ${it.name} gehört jetzt dir – in der Sammlung ausrüsten!`);
            } catch (err) {
              ok.disabled = false;
              toast(errMsg(err));
            }
          });
        },
      );
      return;
    }
    const pb = t.closest<HTMLButtonElement>("[data-prod]");
    if (pb) {
      const p = shop.products.find((x) => x.id === pb.dataset.prod);
      if (p) buyFlow(p, shop.can_buy, null, () => void getShop().then(draw).catch(() => {}));
    }
  });
}

// =====================================================================
// Sammlung (ausrüsten)
// =====================================================================

export async function renderCollection(page: HTMLElement, me: { name?: string; avatar?: string | null }, kindParam?: string) {
  const kind: ItemKind = (KIND_ORDER as string[]).includes(kindParam ?? "") ? (kindParam as ItemKind) : "skin";
  page.innerHTML = `<div class="empty">Lädt…</div>`;
  let c: Cosmetics;
  try {
    c = await getMyCosmetics();
  } catch (e) {
    if (page.isConnected) page.innerHTML = `<div class="inline-error" role="alert">${esc(errMsg(e))}</div>`;
    return;
  }
  const draw = () => {
    if (!page.isConnected) return;
    const eq = c.equipped;
    const items = c.items.filter((i) => i.kind === kind);
    const eqId = kind === "emote" ? null : eq[kind]?.id;
    page.innerHTML = `
      <section class="sp-preview pf-head" ${skinStyle(eq.skin)}>
        ${previewAvatar(me, eq)}
        <h3><span style="${nameStyle(eq.namecolor)}">${esc(me.name || "Du")}</span></h3>
        ${eq.title ? `<span class="sp-title-tag">${esc(eq.title.data.t ?? eq.title.name)}</span>` : ""}
      </section>
      <div class="chips sp-kinds" role="tablist">${KIND_ORDER.map(
        (k) => `<a class="chip${k === kind ? " on" : ""}" href="#/sammlung/${k}" role="tab" aria-selected="${k === kind}">${KIND_LABEL[k]} <small>${c.items.filter((i) => i.kind === k).length}</small></a>`,
      ).join("")}</div>
      ${kind === "emote" ? `<p class="muted small">Emotes kannst du im Clan-Chat senden – alle, die du hast.</p>` : ""}
      <div class="sp-grid">
        ${
          kind !== "emote"
            ? `<button class="sp-card sp-none${!eqId ? " on" : ""}" type="button" data-eq="">
                 <span class="it-ico big">🚫</span><b class="sp-card-name">Keins</b><small class="muted">Standard</small></button>`
            : ""
        }
        ${items
          .map(
            (i) => `<button class="sp-card r-${i.rarity}${i.id === eqId ? " on" : ""}" type="button" data-eq="${esc(i.id)}"${kind === "emote" ? " disabled" : ""}>
              ${itemIcon(i, "big")}<b class="sp-card-name">${esc(i.name)}</b>
              <small class="muted">${i.id === eqId ? "Ausgerüstet ✓" : RARITY_LABEL[i.rarity]}</small></button>`,
          )
          .join("")}
      </div>
      ${items.length ? "" : `<p class="muted sp-empty">Noch nichts davon. Hol dir ${KIND_LABEL[kind]}s im <a href="#/pass">Season Pass</a> oder im <a href="#/shop">Shop</a>.</p>`}`;
  };
  draw();
  page.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-eq]");
    if (!b || kind === "emote") return;
    const id = b.dataset.eq || null;
    try {
      c = await equipCosmetic(kind, id);
      cosmeticsCache.clear();
      if (kind === "skin") applySkin(c.equipped.skin);
      if (kind === "victory") myVictory = c.equipped.victory;
      draw();
      if (kind === "victory" && id) playVictory(true);
    } catch (err) {
      toast(errMsg(err));
    }
  });
}

function previewAvatar(me: { name?: string; avatar?: string | null }, eq: Equipped): string {
  const img = me.avatar && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(me.avatar) ? me.avatar : "";
  const inner = img
    ? `<span class="pm-avatar pf-avatar has-img"><img src="${img}" alt=""></span>`
    : eq.avatar
      ? `<span class="pm-avatar pf-avatar sp-emoji-av" style="background:${safeColor(eq.avatar.data.bg, "#2f2445")}">${safeEmoji(eq.avatar.data.e)}</span>`
      : `<span class="pm-avatar pf-avatar">${esc((me.name || "?").slice(0, 1).toUpperCase())}</span>`;
  return eq.frame ? frameWrap(inner, eq.frame) : inner;
}

function frameWrap(inner: string, f: Item): string {
  return `<span class="sp-frame${f.data.anim ? " anim" : ""}" style="--c1:${safeColor(f.data.c1)};--c2:${safeColor(f.data.c2 ?? f.data.c1)}">${inner}</span>`;
}

function skinStyle(s: Item | null): string {
  return s ? `style="--sa:${safeColor(s.data.a)};--sb:${safeColor(s.data.b, "#ff3d8b")}" data-skin="1"` : "";
}

// =====================================================================
// Start-Karte, Rückmeldung nach Runden, Siegesanimation
// =====================================================================

/** Kleine Karte auf dem Startbildschirm */
export async function mountPassCard(el: HTMLElement) {
  const draw = (p: SeasonPass) => {
    const s = p.season;
    const inLevel = p.level >= s.levels ? s.level_xp : p.xp - p.level * s.level_xp;
    const ready = p.rewards.filter((r) => p.level >= r.level && !r.claimed && (r.track === "free" || p.premium)).length;
    const q = [...p.quests.daily, ...p.quests.weekly];
    el.innerHTML = `<a class="sp-start-card" href="#/pass">
        <span class="sp-lvl-badge sm">${p.level}</span>
        <span class="sp-start-txt"><b>${esc(s.name)}${p.premium ? " ⭐" : ""}</b>
          <span class="sp-xpbar sm"><i style="width:${Math.min(100, Math.round((inLevel / s.level_xp) * 100))}%"></i></span>
          <small>${ready ? `🎁 ${ready} ${ready === 1 ? "Belohnung" : "Belohnungen"} bereit · ` : ""}Aufgaben ${q.filter((x) => x.done).length}/${q.length} · ${timeLeft(s.ends_at)}</small></span>
        <i class="mc-go" aria-hidden="true">›</i>
      </a>
      <a class="sp-shop-mini" href="#/shop" aria-label="Shop öffnen">🛒<small>Shop</small></a>`;
  };
  if (lastPass) draw(lastPass);
  try {
    const p = await getSeasonPass();
    lastPass = p;
    if (el.isConnected) draw(p);
  } catch {
    if (!lastPass) el.remove();
  }
}

/** Nach einer gewerteten Runde: "+120 XP", fertige Aufgaben, neue Stufe */
export function seasonPing(delay = 900) {
  window.setTimeout(async () => {
    try {
      const p = await getSeasonPing();
      if (!p.xp && !p.quests) return;
      lastPass = null;
      const parts: string[] = [];
      if (p.level > p.old_level) parts.push(`⭐ Stufe ${p.level} erreicht!`);
      if (p.xp) parts.push(`+${num(p.xp)} XP`);
      if (p.quests) parts.push(p.quests === 1 ? "✅ Aufgabe geschafft" : `✅ ${p.quests} Aufgaben geschafft`);
      passToast(parts.join(" · "), p.level > p.old_level ? "🎁 Belohnung im Season Pass abholen" : "");
    } catch {
      /* egal – der Pass darf das Spiel nie stören */
    }
  }, delay);
}

/** Kleiner Hinweis oben. Bewusst nicht antippbar, damit er nie aus Versehen Knöpfe darunter „klaut“. */
function passToast(text: string, cta: string) {
  document.querySelector(".sp-toast")?.remove();
  const t = document.createElement("div");
  t.className = "sp-toast";
  t.setAttribute("role", "status");
  t.innerHTML = `<span>${esc(text)}</span>${cta ? `<b>${esc(cta)}</b>` : ""}`;
  document.body.append(t);
  window.setTimeout(() => t.classList.add("out"), 3600);
  window.setTimeout(() => t.remove(), 4000);
}

let myVictory: Item | null = null;

/** Siegesanimation (nur wenn eine ausgerüstet ist – sonst bleibt alles wie bisher) */
export function playVictory(force = false) {
  const v = myVictory;
  if (!v || (!force && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  const em = emojiList(v.data.e);
  const box = document.createElement("div");
  box.className = "sp-victory";
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = Array.from({ length: 26 }, (_, i) => {
    const left = Math.round(Math.random() * 100);
    const delay = Math.round(Math.random() * 700);
    const dur = 1500 + Math.round(Math.random() * 900);
    const size = 22 + Math.round(Math.random() * 20);
    return `<i style="left:${left}%;animation-delay:${delay}ms;animation-duration:${dur}ms;font-size:${size}px">${em[i % em.length]}</i>`;
  }).join("");
  document.body.append(box);
  window.setTimeout(() => box.remove(), 3200);
}

// =====================================================================
// Skin der App, Kosmetik in Profilen
// =====================================================================

const SKIN_KEY = "zwip:skin";

export function applySkin(s: Item | null) {
  const root = document.documentElement;
  if (s) {
    root.style.setProperty("--skin-a", safeColor(s.data.a));
    root.style.setProperty("--skin-b", safeColor(s.data.b, "#ff3d8b"));
    document.body.classList.add("has-skin");
    document.body.classList.toggle("skin-anim", Boolean(s.data.anim));
  } else {
    root.style.removeProperty("--skin-a");
    root.style.removeProperty("--skin-b");
    document.body.classList.remove("has-skin", "skin-anim");
  }
  try {
    if (s) localStorage.setItem(SKIN_KEY, JSON.stringify({ a: s.data.a, b: s.data.b, anim: s.data.anim }));
    else localStorage.removeItem(SKIN_KEY);
  } catch {
    /* egal */
  }
}

/** Gespeicherten Skin sofort beim Start zeigen (ohne auf den Server zu warten) */
function restoreSkin() {
  try {
    const raw = localStorage.getItem(SKIN_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as { a?: string; b?: string; anim?: boolean };
    applySkinData(d);
  } catch {
    /* egal */
  }
}
function applySkinData(d: { a?: string; b?: string; anim?: boolean }) {
  document.documentElement.style.setProperty("--skin-a", safeColor(d.a));
  document.documentElement.style.setProperty("--skin-b", safeColor(d.b, "#ff3d8b"));
  document.body.classList.add("has-skin");
  document.body.classList.toggle("skin-anim", Boolean(d.anim));
}

/** Nach dem Abmelden: Standard-Look */
export function resetPass() {
  applySkin(null);
  myVictory = null;
  lastPass = null;
  cosmeticsCache.clear();
}

const cosmeticsCache = new Map<string, { at: number; p: Promise<Equipped | null> }>();
function cosmeticsOf(name: string): Promise<Equipped | null> {
  const key = name.toLowerCase();
  const hit = cosmeticsCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.p;
  const p = getPlayerCosmetics(name).catch(() => null);
  cosmeticsCache.set(key, { at: Date.now(), p });
  return p;
}

/** Profil-Kopf (eigenes oder fremdes Profil) mit Rahmen, Emoji-Bild, Namensfarbe, Titel und Skin schmücken */
function decorateHead(head: HTMLElement, eq: Equipped) {
  const av = head.querySelector<HTMLElement>(".pm-avatar");
  if (av && eq.avatar && !av.classList.contains("has-img")) {
    av.textContent = safeEmoji(eq.avatar.data.e);
    av.classList.add("sp-emoji-av");
    av.style.background = safeColor(eq.avatar.data.bg, "#2f2445");
  }
  if (av && eq.frame && !av.parentElement?.classList.contains("sp-frame")) {
    const w = document.createElement("span");
    w.className = `sp-frame${eq.frame.data.anim ? " anim" : ""}`;
    w.style.setProperty("--c1", safeColor(eq.frame.data.c1));
    w.style.setProperty("--c2", safeColor(eq.frame.data.c2 ?? eq.frame.data.c1));
    av.replaceWith(w);
    w.append(av);
  }
  const h3 = head.querySelector("h3");
  if (h3 && eq.namecolor) {
    const last = [...h3.childNodes].reverse().find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    if (last) {
      const span = document.createElement("span");
      span.setAttribute("style", nameStyle(eq.namecolor));
      span.textContent = last.textContent;
      last.replaceWith(span);
    }
  }
  if (h3 && eq.title && !head.querySelector(".sp-title-tag")) {
    const t = document.createElement("span");
    t.className = "sp-title-tag";
    t.textContent = eq.title.data.t ?? eq.title.name;
    h3.after(t);
  }
  if (eq.skin) {
    head.dataset.skin = "1";
    head.style.setProperty("--sa", safeColor(eq.skin.data.a));
    head.style.setProperty("--sb", safeColor(eq.skin.data.b, "#ff3d8b"));
  }
}

let observing = false;
function watchProfiles() {
  if (observing) return;
  observing = true;
  new MutationObserver(() => {
    document.querySelectorAll<HTMLElement>(".pf-head [data-clan-for]:not([data-cos])").forEach((el) => {
      el.dataset.cos = "1";
      const head = el.closest<HTMLElement>(".pf-head");
      if (!head || head.classList.contains("sp-preview")) return;
      void cosmeticsOf(el.dataset.clanFor!).then((eq) => {
        if (eq && head.isConnected) decorateHead(head, eq);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
}

/** Emotes für den Clan-Chat (alle, die man besitzt) */
export async function myEmotes(): Promise<{ e: string; t: string }[]> {
  try {
    const c = await getMyCosmetics();
    return c.items
      .filter((i) => i.kind === "emote")
      .map((i) => ({ e: safeEmoji(i.data.e), t: typeof i.data.t === "string" ? i.data.t.slice(0, 24) : "" }));
  } catch {
    return [];
  }
}

// =====================================================================
// Einladungen (?ref=Name oder Profil-Link ?p=Name)
// =====================================================================

const REF_KEY = "zwip:ref";

function captureReferral() {
  try {
    const q = new URLSearchParams(location.search);
    const name = (q.get("ref") || q.get("p") || "").trim();
    if (/^[A-Za-z0-9_]{3,16}$/.test(name)) localStorage.setItem(REF_KEY, JSON.stringify({ n: name, at: Date.now() }));
  } catch {
    /* egal */
  }
}

/** Nach jeder Anmeldung: Skin/Siegesanimation laden und eine offene Einladung einlösen */
export async function passAfterLogin() {
  watchProfiles();
  try {
    const raw = localStorage.getItem(REF_KEY);
    const v = raw ? (JSON.parse(raw) as { n: string; at: number }) : null;
    if (v && Date.now() - v.at < 7 * 86400000) {
      // Der Server zählt das nur für frisch registrierte Konten, die noch niemand eingeladen hat
      await claimReferral(v.n).catch(() => {});
    }
    localStorage.removeItem(REF_KEY);
  } catch {
    /* egal */
  }
  try {
    const c = await getMyCosmetics();
    applySkin(c.equipped.skin);
    myVictory = c.equipped.victory;
  } catch {
    /* offline oder Datenbank noch alt – dann eben Standard-Look */
  }
}

captureReferral();
restoreSkin();
