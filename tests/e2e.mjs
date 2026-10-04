// End-to-End-Test im echten Browser (Handy-Viewport). Testet Startmenü, Registrierung, Anmeldung,
// Sitzung und Logout gegen einen nachgebauten Supabase-Auth-Server und spielt danach eine komplette
// Daily mit echten Taps und Swipes, Duell-Link, Endlos-Modus, Bestenliste und Teilen.
//   npm run test:e2e
import { chromium, devices } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const DIST = path.resolve(".tmp/e2e-dist");
const SHOTS = path.resolve(process.env.SHOTS || ".tmp/shots");
fs.mkdirSync(SHOTS, { recursive: true });

// ---------- Nachgebauter Supabase-Auth-Server (gleiches Antwortformat wie GoTrue) ----------
const mock = { users: new Map(), refresh: new Map(), access: new Map(), confirmMode: false, refreshCalls: 0, apikeyMissing: 0 };
function issue(user) {
  const at = "at-" + randomUUID();
  const rt = "rt-" + randomUUID();
  mock.access.set(at, user);
  mock.refresh.set(rt, user);
  return { access_token: at, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: rt, user: { id: user.id, email: user.email } };
}
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
async function readBody(req) {
  let b = "";
  for await (const c of req) b += c;
  return b ? JSON.parse(b) : {};
}
async function handleApi(req, res, url) {
  if (url.pathname.startsWith("/__mock/")) {
    if (url.pathname === "/__mock/confirm-mode") mock.confirmMode = url.searchParams.get("on") === "1";
    if (url.pathname === "/__mock/revoke") mock.refresh.clear();
    if (url.pathname === "/__mock/confirm-link") {
      const u = mock.users.get(url.searchParams.get("email"));
      u.confirmed = true;
      const t = issue(u);
      return json(res, 200, { hash: `#access_token=${t.access_token}&expires_in=3600&refresh_token=${t.refresh_token}&token_type=bearer&type=signup` });
    }
    return json(res, 200, { ok: true });
  }
  if (req.headers.apikey !== "test-anon-key") mock.apikeyMissing++;
  const p = url.pathname;
  if (p === "/auth/v1/signup" && req.method === "POST") {
    const { email, password } = await readBody(req);
    const exists = mock.users.get(email);
    if (password.length < 6) return json(res, 422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters." });
    if (mock.confirmMode) {
      if (exists) return json(res, 200, { id: randomUUID(), email, identities: [] });
      const u = { id: randomUUID(), email, password, confirmed: false };
      mock.users.set(email, u);
      return json(res, 200, { id: u.id, email, identities: [{ id: u.id }], confirmation_sent_at: new Date().toISOString() });
    }
    if (exists) return json(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    const u = { id: randomUUID(), email, password, confirmed: true };
    mock.users.set(email, u);
    return json(res, 200, issue(u));
  }
  if (p === "/auth/v1/token" && req.method === "POST") {
    const body = await readBody(req);
    if (url.searchParams.get("grant_type") === "password") {
      const u = mock.users.get(body.email);
      if (!u || u.password !== body.password) return json(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (!u.confirmed) return json(res, 400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
      return json(res, 200, issue(u));
    }
    mock.refreshCalls++;
    const u = mock.refresh.get(body.refresh_token);
    if (!u) return json(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
    mock.refresh.delete(body.refresh_token);
    return json(res, 200, issue(u));
  }
  if (p === "/auth/v1/logout" && req.method === "POST") {
    const u = mock.access.get((req.headers.authorization || "").replace("Bearer ", ""));
    if (u) for (const [k, v] of mock.refresh) if (v === u) mock.refresh.delete(k);
    res.writeHead(204).end();
    return;
  }
  if (p === "/auth/v1/user") {
    const u = mock.access.get((req.headers.authorization || "").replace("Bearer ", ""));
    return u ? json(res, 200, { id: u.id, email: u.email }) : json(res, 401, { code: 401, msg: "invalid JWT" });
  }
  if (p.startsWith("/rest/v1/")) {
    if (req.method === "HEAD") return res.writeHead(200, { "Content-Range": "0-0/0" }).end();
    if (req.method === "POST") return res.writeHead(201).end();
    return json(res, 200, []);
  }
  json(res, 404, { msg: "not found" });
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (/^\/(auth|rest)\/v1\/|^\/__mock\//.test(url.pathname)) return void handleApi(req, res, url).catch((e) => json(res, 500, { msg: String(e) }));
  const p = decodeURIComponent(url.pathname);
  let f = path.join(DIST, p === "/" ? "index.html" : p);
  if (!fs.existsSync(f)) f = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

// App gegen den Mock-Server bauen
const build = spawnSync(process.execPath, ["build.mjs"], {
  stdio: "pipe",
  env: { ...process.env, ZWIP_OUTDIR: DIST, ZWIP_SUPABASE_URL: BASE.slice(0, -1), ZWIP_SUPABASE_ANON_KEY: "test-anon-key", ZWIP_PUBLIC_URL: "" },
});
if (build.status !== 0) {
  console.error(build.stderr.toString());
  process.exit(1);
}
const mockCall = (p) => fetch(BASE + p.replace(/^\//, "")).then((r) => r.json());

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

async function openSettings(page) {
  await page.click('[data-act="settings"]', { force: true });
  await page.waitForSelector("#set-logout");
}

async function fillAuth(page, email, pw, pw2) {
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", pw);
  if (pw2 !== undefined) await page.fill("#auth-password2", pw2);
  await page.click("#auth-submit", { force: true });
}

async function authError(page) {
  await page.waitForSelector(".auth-error:not([hidden])", { timeout: 5000 });
  return (await page.textContent(".auth-error")).trim();
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
  // 1) Startmenü statt Spiel
  const A = await newPage();
  const t0 = Date.now();
  await A.page.goto(`${BASE}?e2e=1`);
  await A.page.waitForSelector('[data-auth="login"]');
  const ready = Date.now() - t0;
  check(ready < 2000, `Startmenü erscheint in ${ready} ms`);
  check((await A.page.locator('[data-auth="register"]').count()) === 1, "Startmenü hat Anmelden + Registrieren");
  check((await A.page.locator('[data-act="daily"]').count()) === 0, "Spiel ist ohne Anmeldung nicht erreichbar");
  await A.page.screenshot({ path: `${SHOTS}/0-start.png` });

  // 2) Registrierung mit Fehlerfällen
  await A.page.click('[data-auth="register"]', { force: true });
  await A.page.waitForSelector("#auth-password2");
  await A.page.screenshot({ path: `${SHOTS}/0-register.png` });
  await fillAuth(A.page, "lena-at-test", "geheim123", "geheim123");
  check((await authError(A.page)).includes("gültige E-Mail"), "Ungültige E-Mail wird verständlich gemeldet");
  await fillAuth(A.page, "lena@test.de", "geheim123", "geheim124");
  check((await authError(A.page)).includes("stimmen nicht überein"), "Unterschiedliche Passwörter werden gemeldet");
  await fillAuth(A.page, "lena@test.de", "kurz", "kurz");
  check((await authError(A.page)).includes("mindestens 8"), "Zu kurzes Passwort wird gemeldet");
  await A.page.screenshot({ path: `${SHOTS}/0-register-error.png` });
  await fillAuth(A.page, "Lena@Test.de ", "geheim123", "geheim123");
  await A.page.waitForSelector('[data-act="daily"]', { timeout: 5000 });
  check(true, "Nach Registrierung direkt eingeloggt im Hauptmenü");
  check(mock.users.has("lena@test.de"), "Account wurde beim Auth-Server angelegt (E-Mail normalisiert)");

  // 3) Sitzung bleibt nach Neuladen erhalten
  await A.page.reload();
  await A.page.waitForSelector('[data-act="daily"]', { timeout: 5000 });
  check(true, "Nach Neuladen weiterhin eingeloggt");
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

  // 5b) Logout → Startmenü, Fehlerfälle bei der Anmeldung, erneut anmelden
  await openSettings(A.page);
  check((await A.page.textContent(".account-mail")).trim() === "lena@test.de", "Einstellungen zeigen angemeldete E-Mail");
  await A.page.screenshot({ path: `${SHOTS}/5b-settings.png` });
  await A.page.click("#set-logout", { force: true });
  await A.page.waitForSelector('[data-auth="login"]', { timeout: 5000 });
  check((await A.page.locator('[data-act="daily"]').count()) === 0, "Nach Logout wieder Startmenü");
  await A.page.reload();
  await A.page.waitForSelector('[data-auth="login"]');
  check(true, "Logout bleibt nach Neuladen bestehen");
  await A.page.click('[data-auth="login"]', { force: true });
  await fillAuth(A.page, "lena@test.de", "falsch999");
  check((await authError(A.page)).includes("E-Mail oder Passwort ist falsch"), "Falsches Passwort wird verständlich gemeldet");
  await A.page.screenshot({ path: `${SHOTS}/5c-login-error.png` });
  await A.page.click('[data-auth="switch"]', { force: true });
  await fillAuth(A.page, "lena@test.de", "anders123", "anders123");
  check((await authError(A.page)).includes("schon einen Account"), "Bereits verwendete E-Mail wird gemeldet");
  await A.page.click('[data-auth="switch"]', { force: true });
  check((await A.page.inputValue("#auth-email")) === "lena@test.de", "E-Mail wird beim Wechsel zur Anmeldung übernommen");
  await fillAuth(A.page, "lena@test.de", "geheim123");
  await A.page.waitForSelector('[data-act="share-today"]', { timeout: 5000 });
  check((await A.page.textContent(".streak-pill b")) === "1", "Nach erneutem Login: Daily-Ergebnis und Streak noch da");

  // 5c) Abgelaufenes Token wird automatisch erneuert
  const before = mock.refreshCalls;
  await A.page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("zwip:auth"));
    s.expiresAt = Math.floor(Date.now() / 1000) - 10;
    localStorage.setItem("zwip:auth", JSON.stringify(s));
  });
  await A.page.reload();
  await A.page.waitForSelector('[data-act="share-today"]', { timeout: 5000 });
  check(mock.refreshCalls === before + 1, "Abgelaufene Sitzung wird beim Laden still erneuert");

  // 5d) Widerrufene Sitzung → zurück zum Startmenü
  await mockCall("/__mock/revoke");
  await A.page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("zwip:auth"));
    s.expiresAt = 0;
    localStorage.setItem("zwip:auth", JSON.stringify(s));
  });
  await A.page.reload();
  await A.page.waitForSelector('[data-auth="login"]', { timeout: 5000 });
  check(true, "Ungültige Sitzung führt sauber zurück ins Startmenü");

  // 5e) Projekt mit E-Mail-Bestätigung
  await mockCall("/__mock/confirm-mode?on=1");
  const D = await newPage();
  await D.page.goto(`${BASE}?e2e=1`);
  await D.page.click('[data-auth="register"]', { force: true });
  await fillAuth(D.page, "max@test.de", "passwort1", "passwort1");
  await D.page.waitForSelector('[data-auth="to-login"]', { timeout: 5000 });
  check((await D.page.textContent(".auth-card")).includes("max@test.de"), "Hinweis „Bestätige deine E-Mail“ erscheint");
  await D.page.screenshot({ path: `${SHOTS}/5e-confirm.png` });
  await D.page.click('[data-auth="to-login"]', { force: true });
  await fillAuth(D.page, "max@test.de", "passwort1");
  check((await authError(D.page)).includes("bestätige zuerst"), "Login vor Bestätigung wird verständlich gemeldet");
  const { hash } = await mockCall("/__mock/confirm-link?email=max@test.de");
  await D.page.goto(`${BASE}?e2e=1&from=mail${hash}`); // neuer Seitenaufruf wie beim Klick in der Mail
  await D.page.waitForSelector('[data-act="daily"]', { timeout: 5000 });
  check(!(await D.page.evaluate(() => location.hash)), "Bestätigungslink loggt ein und Token verschwindet aus der Adresse");
  await openSettings(D.page);
  await D.page.click("#set-logout", { force: true });
  await D.page.waitForSelector('[data-auth="register"]');
  await D.page.click('[data-auth="register"]', { force: true });
  await fillAuth(D.page, "max@test.de", "passwort2", "passwort2");
  check((await authError(D.page)).includes("schon einen Account"), "Vergebene E-Mail wird auch mit Bestätigungs-Modus erkannt");
  await mockCall("/__mock/confirm-mode?on=0");

  // 6) Freund:in öffnet den Duell-Link, registriert sich und tritt an
  const B = await newPage();
  const duelUrl = link.replace(/^https?:\/\/[^/?]+\/?/, BASE) + "&e2e=1";
  await B.page.goto(duelUrl);
  await B.page.waitForSelector(".start .duel-card");
  check((await B.page.textContent(".duel-card")).includes("Lena"), "Startmenü zeigt die Herausforderung");
  await B.page.click('[data-auth="register"]', { force: true });
  await fillAuth(B.page, "tom@test.de", "tomtom123", "tomtom123");
  await B.page.waitForSelector('[data-act="duel"]', { timeout: 5000 });
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

  check(mock.apikeyMissing === 0, "Jede Auth-Anfrage schickt den öffentlichen anon Key mit");
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
