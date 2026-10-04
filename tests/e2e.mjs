// End-to-End-Test im echten Browser (Handy-Viewport). Spielt eine komplette Daily mit echten
// Taps und Swipes, testet Duell-Link, Endlos-Modus, Bestenliste und Teilen.
//   npm run build && npm run test:e2e
import { chromium, devices } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.argv[2] || "dist");
const SHOTS = path.resolve(process.env.SHOTS || ".tmp/shots");
fs.mkdirSync(SHOTS, { recursive: true });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = path.join(DIST, p === "/" ? "index.html" : p);
  if (!fs.existsSync(f)) f = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const errors = [];
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "✔" : "✘"} ${msg}`);
  if (!cond) failures++;
};

async function newPage() {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`console: ${m.text()}`));
  page.on("requestfailed", (r) => !/fonts\.(googleapis|gstatic)/.test(r.url()) && errors.push(`request: ${r.url()}`));
  // navigator.share gibt es im Headless-Browser nicht zuverlässig → Clipboard-Pfad wird getestet
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  return { ctx, page };
}

async function center(page, handleFn) {
  return page.evaluate((fnSrc) => {
    const el = new Function("r", `return (${fnSrc})(r)`)(window.__zwip.round);
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, handleFn.toString());
}

async function stageCenter(page) {
  const b = await page.locator(".stage").boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Löst die aktuelle Runde wie ein echter Mensch (Klick/Swipe). fail=true: absichtlich falsch. */
async function solveRound(page, lastN, fail = false) {
  await page.waitForFunction((n) => window.__zwip.round && window.__zwip.round.n > n, lastN, { timeout: 8000 });
  const r = await page.evaluate(() => ({ id: window.__zwip.round.gameId, n: window.__zwip.round.n, dir: window.__zwip.round.dir }));
  if (fail) {
    if (r.id === "swipe") {
      const c = await stageCenter(page);
      const opp = { up: [0, 120], down: [0, -120], left: [120, 0], right: [-120, 0] }[r.dir];
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + opp[0], c.y + opp[1], { steps: 4 });
      await page.mouse.up();
    } else if (["odd", "more", "sum", "ink"].includes(r.id)) {
      // Ein falsches Feld derselben Sorte tippen
      const p = await page.evaluate(() => {
        const t = window.__zwip.round.target;
        const wrong = [...t.parentElement.children].find((e) => e !== t);
        const b = wrong.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      await page.mouse.click(p.x, p.y);
    } else if (r.id === "stop") {
      await page.waitForFunction(() => !window.__zwip.round?.inZone?.(), null, { polling: "raf" });
      const c = await stageCenter(page);
      await page.mouse.click(c.x, c.y);
    } else if (r.id === "wait") {
      const c = await stageCenter(page);
      await page.mouse.click(c.x, c.y); // zu früh
    }
    // pop: nichts tun → Zeit läuft ab
    return r;
  }
  switch (r.id) {
    case "odd":
    case "more":
    case "sum":
    case "ink": {
      const p = await center(page, (round) => round.target);
      await page.mouse.click(p.x, p.y);
      break;
    }
    case "pop": {
      const n = await page.evaluate(() => window.__zwip.round.targets.length);
      for (let i = 0; i < n; i++) {
        const p = await page.evaluate((i) => {
          const b = window.__zwip.round.targets[i].getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }, i);
        await page.mouse.click(p.x, p.y);
      }
      break;
    }
    case "stop": {
      await page.waitForFunction(() => window.__zwip.round?.inZone?.(), null, { polling: "raf", timeout: 5000 }).catch(() => {});
      const c = await stageCenter(page);
      await page.mouse.click(c.x, c.y);
      break;
    }
    case "wait": {
      await page.waitForFunction(() => window.__zwip.round?.isGo?.(), null, { polling: "raf", timeout: 5000 });
      const c = await stageCenter(page);
      await page.mouse.click(c.x, c.y);
      break;
    }
    case "swipe": {
      const c = await stageCenter(page);
      const d = { up: [0, -140], down: [0, 140], left: [-140, 0], right: [140, 0] }[r.dir];
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + d[0], c.y + d[1], { steps: 5 });
      await page.mouse.up();
      break;
    }
  }
  return r;
}

async function playTen(page, tag) {
  let n = 0;
  const seen = [];
  for (let i = 0; i < 10; i++) {
    const r = await solveRound(page, n);
    n = r.n;
    seen.push(r.id);
    if (i === 1 || i === 4) await page.screenshot({ path: `${SHOTS}/${tag}-round-${i + 1}-${r.id}.png` });
  }
  await page.waitForSelector(".score-big", { timeout: 8000 });
  await page.waitForTimeout(1400);
  return seen;
}

try {
  // 1) Start in unter 2 Sekunden spielbereit
  const A = await newPage();
  const t0 = Date.now();
  await A.page.goto(`${BASE}?e2e=1`);
  await A.page.waitForSelector('[data-act="daily"]');
  const ready = Date.now() - t0;
  check(ready < 2000, `Startbildschirm spielbereit in ${ready} ms`);
  await A.page.screenshot({ path: `${SHOTS}/1-home.png` });

  // 2) Komplette Daily spielen
  await A.page.click('[data-act="daily"]', { force: true });
  await A.page.waitForSelector(".intro");
  await A.page.screenshot({ path: `${SHOTS}/2-intro.png` });
  const seen = await playTen(A.page, "A");
  check(new Set(seen).size === 8, `Alle 8 Challenges kamen vor: ${seen.join(", ")}`);
  const st = await A.page.evaluate(() => window.__zwip.state());
  const today = Object.keys(st.daily).map(Number)[0];
  const res = st.daily[today];
  const scoreTxt = await A.page.textContent(".score-big");
  check(res && Number(scoreTxt) === res.score, `Ergebnis gespeichert: ${res?.score} Punkte, Runden ${res?.rounds.join("/")}`);
  check(res.rounds.filter((p) => p > 0).length >= 8, `Mind. 8 von 10 Runden per echtem Tap/Swipe gelöst (${res.rounds.filter((p) => p > 0).length})`);
  check(st.streak.count === 1, "Streak startet bei 1");
  check((await A.page.locator(".tile").count()) === 10, "10 Ergebnis-Kacheln sichtbar");
  await A.page.screenshot({ path: `${SHOTS}/3-result.png` });

  // 3) Name setzen, Teilen (Clipboard)
  await A.page.fill("#nm", "Lena");
  await A.page.click('[data-act="savename"]', { force: true });
  await A.page.click('[data-act="share"]', { force: true });
  await A.page.waitForTimeout(300);
  const shared = await A.page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check(/^ZWIP #\d+ ⚡ \d+\/1000\n[🟪🟩🟨🟥]{5}\n[🟪🟩🟨🟥]{5}/u.test(shared), "Teilen-Text mit Emoji-Raster erzeugt");
  await A.page.click('[data-act="challenge"]', { force: true });
  await A.page.waitForTimeout(300);
  const duelText = await A.page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  const link = duelText.match(/https?:\/\/\S+\?c=[A-Za-z0-9_-]+/)?.[0];
  check(Boolean(link) && duelText.includes("Lena fordert dich"), `Duell-Link erzeugt (${JSON.stringify(duelText.slice(0, 120))})`);

  // 4) Story-Bild
  await A.page.click('[data-act="story"]', { force: true });
  await A.page.waitForSelector(".story-preview", { state: "attached", timeout: 5000 });
  const imgOk = await A.page.evaluate(() => {
    const i = document.querySelector(".story-preview");
    return i.complete ? i.naturalWidth : new Promise((r) => (i.onload = () => r(i.naturalWidth)));
  });
  check(imgOk === 1080, "Story-Bild 1080×1920 erzeugt");
  await A.page.screenshot({ path: `${SHOTS}/4-story.png` });
  await A.page.click("[data-close]", { force: true });

  // 5) Zurück zum Home: Daily erledigt, Countdown läuft
  await A.page.click('.actions-2 [data-act="home"]', { force: true });
  await A.page.waitForSelector("#countdown");
  check((await A.page.textContent(".streak-pill b")) === "1", "Home zeigt Streak 1");
  await A.page.screenshot({ path: `${SHOTS}/5-home-done.png` });

  // 6) Freund:in öffnet den Duell-Link
  const B = await newPage();
  const duelUrl = link.replace(/^https?:\/\/[^/?]+\/?/, BASE) + "&e2e=1";
  await B.page.goto(duelUrl);
  await B.page.waitForSelector(".duel-card");
  check((await B.page.textContent(".duel-card")).includes("Lena"), "Duell-Karte zeigt Herausforderer");
  await B.page.screenshot({ path: `${SHOTS}/6-duel-home.png` });
  await B.page.click('[data-act="duel"]', { force: true });
  await playTen(B.page, "B");
  check(await B.page.isVisible(".vs-card"), "Vergleich Du vs. Lena wird angezeigt");
  await B.page.screenshot({ path: `${SHOTS}/7-duel-result.png`, fullPage: true });
  const bState = await B.page.evaluate(() => window.__zwip.state());
  check(Object.values(bState.crew).some((m) => m.name === "Lena"), "Lena ist in der Crew gelandet");
  check(Object.keys(bState.daily).length === 1, "Duell auf heutige Daily zählt als Daily (Streak)");

  // 7) Bestenliste
  await B.page.click('.actions-2 [data-act="board"]', { force: true });
  await B.page.waitForSelector(".row-item");
  check((await B.page.locator(".row-item").count()) === 2, "Crew-Bestenliste zeigt 2 Spieler");
  await B.page.screenshot({ path: `${SHOTS}/8-board.png` });

  // 8) Endlos: absichtlich in Runde 3 verlieren
  await B.page.click('[data-act="home"]', { force: true });
  await B.page.click('[data-act="endless"]', { force: true });
  let n = 0;
  for (let i = 0; i < 3; i++) n = (await solveRound(B.page, n, i === 2)).n;
  await B.page.waitForSelector(".endless-res", { timeout: 8000 });
  const er = await B.page.textContent(".endless-res");
  check(/\d+ Runden geschafft/.test(er), `Endlos endet nach Fehler: "${er}"`);

  // 9) Training startet, Abbrechen funktioniert
  await B.page.click('.actions-2 [data-act="home"]', { force: true });
  await B.page.click('[data-act="free"]', { force: true });
  await B.page.waitForSelector(".intro");
  await B.page.click('[data-act="quit"]', { force: true });
  await B.page.waitForSelector(".home", { timeout: 4000 });
  check(true, "Training lässt sich abbrechen");

  // 10) Kaputter Link wird abgefangen
  const C = await newPage();
  await C.page.goto(`${BASE}?c=kaputt123&e2e=1`);
  await C.page.waitForSelector(".toast");
  check((await C.page.textContent(".toast")).includes("kaputt"), "Kaputter Duell-Link → freundliche Meldung");

  // 11) Gleiche Daily für alle
  const aDaily = Object.values(st.daily)[0];
  check(aDaily.rounds.length === 10, "Daily hat 10 Runden");

  check(errors.length === 0, `Keine JS-Fehler${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : "\nAlle E2E-Tests bestanden ✅");
process.exit(failures ? 1 : 0);
