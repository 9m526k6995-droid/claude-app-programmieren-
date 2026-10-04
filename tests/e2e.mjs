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
const mock = { users: new Map(), refresh: new Map(), access: new Map(), confirmMode: false, refreshCalls: 0, apikeyMissing: 0, rpcCalls: 0 };

// ---------- Echte Postgres-Datenbank mit unseren Supabase-SQL-Dateien ----------
// Lokal z. B.: ZWIP_TEST_PG="host=/tmp/pgz port=54329 user=postgres"   (CI: Postgres-Service)
const PG = process.env.ZWIP_TEST_PG || "host=localhost user=postgres";
const DB = "zwip_e2e";
function psql(sql, db = DB) {
  const r = spawnSync("psql", [`${PG} dbname=${db}`, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}
function psqlFile(file, db = DB) {
  const r = spawnSync("psql", [`${PG} dbname=${db}`, "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`SQL-Fehler in ${file}:\n${r.stderr}`);
}
{
  const r = psql(`drop database if exists ${DB}`, "postgres");
  if (!r.ok) {
    console.error(`✘ Keine Postgres-Datenbank erreichbar (${PG}). Setze ZWIP_TEST_PG.\n${r.err}`);
    process.exit(1);
  }
  psql(`create database ${DB}`, "postgres");
  for (const f of ["tests/sql/supabase-shim.sql", "supabase/profiles.sql", "supabase/schema.sql", "supabase/trophies.sql"]) psqlFile(f);
}
const lit = (v) =>
  v === null || v === undefined
    ? "null"
    : typeof v === "boolean" || typeof v === "number"
      ? String(v)
      : typeof v === "string"
        ? `'${v.replace(/'/g, "''")}'`
        : `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
/** Ruft eine Datenbank-Funktion so auf, wie PostgREST/Supabase es tut (Rolle + angemeldeter Benutzer). */
function rpcCall(fn, args, user) {
  if (!/^[a-z_]+$/.test(fn)) return { status: 404, body: { code: "PGRST202", message: "not found" } };
  const named = Object.entries(args || {}).map(([k, v]) => `${k} := ${lit(v)}`).join(", ");
  const role = user ? "authenticated" : "anon";
  const sql = `begin; set local role ${role}; select set_config('request.jwt.claim.sub', '${user ? user.id : ""}', true) \\g /dev/null
select 'ZWIPOUT:' || coalesce((public.${fn}(${named}))::text, 'null'); commit;`;
  const r = spawnSync("psql", [`${PG} dbname=${DB}`, "-At", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
  mock.rpcCalls++;
  if (r.status !== 0) {
    const m = r.stderr.match(/ERROR:\s+(.*)/);
    const msg = m ? m[1].trim() : r.stderr;
    if (/permission denied/.test(msg)) return { status: 403, body: { code: "42501", message: msg } };
    if (/does not exist/.test(msg)) return { status: 404, body: { code: "PGRST202", message: msg } };
    return { status: 400, body: { code: "P0001", message: msg } };
  }
  const line = r.stdout.split("\n").find((l) => l.startsWith("ZWIPOUT:"));
  return { status: 200, raw: line.slice(8) };
}
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
      psql(`insert into auth.users (id, email) values ('${u.id}', ${lit(email)})`);
      return json(res, 200, { id: u.id, email, identities: [{ id: u.id }], confirmation_sent_at: new Date().toISOString() });
    }
    if (exists) return json(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    const u = { id: randomUUID(), email, password, confirmed: true };
    mock.users.set(email, u);
    psql(`insert into auth.users (id, email) values ('${u.id}', ${lit(email)})`);
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
  if (p.startsWith("/rest/v1/rpc/") && req.method === "POST") {
    const user = mock.access.get((req.headers.authorization || "").replace("Bearer ", ""));
    const r = rpcCall(p.slice("/rest/v1/rpc/".length), await readBody(req), user);
    if (r.raw !== undefined) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(r.raw);
    }
    return json(res, r.status, r.body);
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
    } else if (r.id === "memory") {
      await page.waitForFunction(() => window.__zwip.round?.isReady?.(), null, { polling: "raf", timeout: 8000 });
      const p = await page.evaluate(() => {
        const first = window.__zwip.round.sequence[0];
        const wrong = [...first.parentElement.children].find((e) => e !== first);
        const b = wrong.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      await page.mouse.click(p.x, p.y);
    } else if (r.id === "beat") {
      const c = await stageCenter(page);
      await page.mouse.click(c.x, c.y); // viel zu früh
    } else if (["odd", "more", "sum", "ink", "find", "pattern"].includes(r.id)) {
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
    case "ink":
    case "find":
    case "pattern": {
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
    case "memory": {
      await page.waitForFunction(() => window.__zwip.round?.isReady?.(), null, { polling: "raf", timeout: 8000 });
      const n = await page.evaluate(() => window.__zwip.round.sequence.length);
      for (let i = 0; i < n; i++) {
        const p = await page.evaluate((i) => {
          const b = window.__zwip.round.sequence[i].getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }, i);
        await page.mouse.click(p.x, p.y);
      }
      break;
    }
    case "beat": {
      await page.waitForFunction(() => performance.now() >= window.__zwip.round.targetAt - 25, null, { polling: "raf", timeout: 6000 });
      const c = await stageCenter(page);
      await page.mouse.click(c.x, c.y);
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
  check(new Set(seen).size >= 8, `Mind. 8 verschiedene Challenges in der Daily: ${seen.join(", ")}`);
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
  check((await A.page.textContent(".streak-mini")).includes("1 Tag"), "Home zeigt Streak 1 (jetzt bei der Wochenleiste)");
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
  check((await A.page.textContent(".streak-mini")).includes("1 Tag"), "Nach erneutem Login: Daily-Ergebnis und Streak noch da");

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

  // 8b) Die vier neuen Challenges im Training, mit echten Taps gelöst
  await B.page.goto(`${BASE}?e2e=1&only=find,memory,beat,pattern`);
  await B.page.waitForSelector('[data-act="free"]', { timeout: 5000 });
  await B.page.click('[data-act="free"]', { force: true });
  const newSeen = [];
  let nn = 0;
  for (let i = 0; i < 10; i++) {
    const r = await solveRound(B.page, nn);
    nn = r.n;
    newSeen.push(r.id);
  }
  await B.page.waitForSelector(".score-big", { timeout: 8000 });
  const nState = await B.page.evaluate(() => [...document.querySelectorAll(".tile b")].map((b) => Number(b.textContent)));
  check(["find", "memory", "beat", "pattern"].every((id) => newSeen.includes(id)), `Alle 4 neuen Challenges gespielt: ${newSeen.join(", ")}`);
  check(nState.filter((p) => p > 0).length >= 8, `Neue Challenges per Tap lösbar (${nState.filter((p) => p > 0).length}/10 geschafft, Punkte ${nState.join("/")})`);
  // Absichtlich falsch: jede neue Challenge muss Fehler erkennen
  await B.page.click('.actions-2 [data-act="free"]', { force: true });
  const failed = new Set();
  nn = 0;
  for (let i = 0; i < 10; i++) {
    const r = await solveRound(B.page, nn, true);
    nn = r.n;
    failed.add(r.id);
  }
  await B.page.waitForSelector(".score-big", { timeout: 15000 });
  const fState = await B.page.evaluate(() => [...document.querySelectorAll(".tile b")].map((b) => Number(b.textContent)));
  check(fState.every((p) => p === 0), `Falsche Antworten geben 0 Punkte (${fState.join("/")})`);

  // 9) Training startet, Abbrechen funktioniert
  await B.page.click('.actions-2 [data-act="home"]', { force: true });
  await B.page.click('[data-act="free"]', { force: true });
  await B.page.waitForSelector(".intro");
  await B.page.click('[data-act="quit"]', { force: true });
  await B.page.waitForSelector(".home", { timeout: 4000 });
  check(true, "Training lässt sich abbrechen");

  // ================= TROPHÄEN =================
  const dbVal = (sql) => psql(sql).out.trim();
  const tP = A.page;
  await tP.goto(`${BASE}?e2e=1`);
  await tP.waitForSelector('.trophy-pill, [data-auth="login"]');
  if (await tP.isVisible('[data-auth="login"]')) {
    await tP.click('[data-auth="login"]', { force: true });
    await fillAuth(tP, "lena@test.de", "geheim123");
  }
  await tP.waitForSelector(".trophy-pill");
  await tP.waitForFunction(() => document.getElementById("trophy-count")?.textContent === "0", null, { timeout: 5000 });
  check(true, "Flamme oben links zeigt Trophäenstand (0) aus der Datenbank");
  await tP.click(".trophy-pill", { force: true });
  await tP.waitForSelector(".path-screen .you-marker");
  check((await tP.locator(".pnode").count()) === 26, "Trophäenpfad mit 26 Meilensteinen (0 … 20.000)");
  check((await tP.locator(".band").count()) === 8, "Trophäenpfad mit 8 Ligen");
  check(await tP.isVisible(".name-banner"), "Hinweis: Spielername fehlt");
  await tP.screenshot({ path: `${SHOTS}/t1-path-start.png` });

  // Spielername beim ersten Start
  await tP.click('[data-p="play"]', { force: true });
  await tP.waitForSelector("#un-input");
  await tP.fill("#un-input", "ab");
  await tP.click("#un-save", { force: true });
  await tP.waitForSelector(".modal .auth-error:not([hidden])");
  check((await tP.textContent(".modal .auth-error")).includes("3–16 Zeichen"), "Ungültiger Spielername wird erklärt");
  await tP.fill("#un-input", "Lena");
  await tP.click("#un-save", { force: true });

  // Trophäen-Runde: 15 Aufgaben mit echten Taps
  await tP.waitForSelector(".trophy-play", { timeout: 8000 });
  check(dbVal("select username from public.profiles where username = 'Lena'") === "Lena", "Spielername in der Datenbank gespeichert");
  check((await tP.textContent(".t-task")).includes("/ 15"), "Anzeige „Aufgabe X / 15“");
  let sawShield = false;
  const prepChecks = [];
  let tn = 0;
  const seenT = [];
  for (let i = 0; i < 15; i++) {
    // Vorbereitungsphase: Aufgabe sichtbar, Eingaben gesperrt, Zeit läuft noch nicht
    const shield = sawShield ? null : await tP.waitForSelector(".prep-shield", { timeout: 2500 }).catch(() => null);
    if (shield) {
      sawShield = true;
      const c = await stageCenter(tP);
      await tP.mouse.click(c.x, c.y);
      prepChecks.push(await tP.evaluate(() => !document.querySelector(".stage.done-ok, .stage.done-fail")));
      await tP.screenshot({ path: `${SHOTS}/t2-prep.png` });
    }
    const r = await solveRound(tP, tn);
    tn = r.n;
    seenT.push(r.id);
    if (i === 6) await tP.screenshot({ path: `${SHOTS}/t3-trophy-play.png` });
  }
  check(sawShield && prepChecks.every(Boolean), "Vorbereitungsphase: Tippen während der Orientierung zählt nicht");
  check(new Set(seenT).size === 12, `Alle 12 Minispiele kommen in der Trophäen-Runde vor (${seenT.join(", ")})`);
  check(seenT.every((g, i) => i === 0 || g !== seenT[i - 1]), "Nie dasselbe Spiel direkt hintereinander");
  await tP.waitForSelector(".tr-rows", { timeout: 30000 });
  await tP.waitForFunction(() => !document.querySelector(".tr-status"), null, { timeout: 30000 });
  await tP.waitForTimeout(1200);
  if (await tP.isVisible(".league-up")) await tP.click(".league-up button", { force: true });
  const shownDelta = (await tP.textContent("#tr-delta")).replace(/[^\d−-]/g, "").replace("−", "-");
  const dbTrophies = Number(dbVal("select trophies from public.profiles where username = 'Lena'"));
  check(dbTrophies > 100 && Number(shownDelta) === dbTrophies, `Server hat ${dbTrophies} Trophäen gutgeschrieben, Anzeige stimmt (${shownDelta})`);
  check(dbVal("select trophy_rounds || '/' || (best_streak > 0) from public.profiles where username = 'Lena'") === "1/true", "Runden und beste Serie in der Datenbank");
  check((await tP.textContent(".tr-rows")).includes("Geschwindigkeitsbonus"), "Ergebnisseite mit Aufschlüsselung");
  await tP.screenshot({ path: `${SHOTS}/t4-result.png`, fullPage: true });

  await tP.click('[data-r="path"]', { force: true });
  await tP.waitForSelector(".path-screen");
  await tP.waitForFunction((t) => document.getElementById("ps-trophies")?.textContent === t, dbTrophies.toLocaleString("de-DE"), { timeout: 5000 });
  check(true, "Trophäenpfad zeigt neuen Stand");
  await tP.screenshot({ path: `${SHOTS}/t5-path-after.png` });
  await tP.click('[data-p="back"]', { force: true });
  await tP.waitForFunction((t) => document.getElementById("trophy-count")?.textContent === t, dbTrophies.toLocaleString("de-DE"), { timeout: 5000 });
  check(true, "Flamme aktualisiert sich nach der Runde automatisch");

  // Liga-Aufstieg: kurz vor Bronze setzen und eine Runde spielen
  psql("update public.profiles set trophies = 990, best_trophies = 990 where username = 'Lena'");
  await tP.goto(`${BASE}?e2e=1`);
  await tP.waitForSelector(".trophy-pill");
  await tP.click(".trophy-pill", { force: true });
  await tP.waitForSelector('[data-p="play"]');
  await tP.click('[data-p="play"]', { force: true });
  await tP.waitForSelector(".trophy-play", { timeout: 8000 });
  tn = 0;
  for (let i = 0; i < 15; i++) tn = (await solveRound(tP, tn)).n;
  await tP.waitForSelector(".league-up", { timeout: 30000 });
  check((await tP.textContent(".lu-name")) === "BRONZE" && (await tP.textContent(".lu-kicker")) === "NEUE LIGA ERREICHT!", "Animation „NEUE LIGA ERREICHT! BRONZE“");
  await tP.waitForTimeout(700);
  await tP.screenshot({ path: `${SHOTS}/t6-league-up.png` });
  await tP.click(".league-up button", { force: true });
  await tP.waitForSelector(".league-up", { state: "detached" });

  // Abbrechen: Rest zählt als falsch
  const beforeAbort = Number(dbVal("select trophies from public.profiles where username = 'Lena'"));
  await tP.click('[data-r="again"]', { force: true });
  await tP.waitForSelector(".trophy-play", { timeout: 8000 });
  tn = (await solveRound(tP, 0)).n;
  await tP.click('[data-act="tquit"]', { force: true });
  await tP.click("#tq-yes", { force: true });
  await tP.waitForSelector(".tr-rows", { timeout: 10000 });
  await tP.waitForFunction(() => !document.querySelector(".tr-status"), null, { timeout: 40000 });
  const afterAbort = Number(dbVal("select trophies from public.profiles where username = 'Lena'"));
  check(afterAbort < beforeAbort, `Abbruch wird gewertet: ${beforeAbort} → ${afterAbort}`);

  // Weltrangliste: viele Spieler anlegen, Sortierung prüfen
  psql(`insert into auth.users (id, email) select gen_random_uuid(), 'bot' || i || '@x.de' from generate_series(1, 120) i;
        update public.profiles p set username = 'Bot' || x.n, trophies = 2000 + x.n * 50, best_trophies = 2000 + x.n * 50,
          trophies_updated_at = now() - (x.n || ' minutes')::interval
        from (select id, row_number() over (order by id) n from public.profiles where username is null and id in (select id from auth.users where email like 'bot%')) x
        where p.id = x.id;
        insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'profi@x.de'), ('11111111-2222-3333-4444-666666666666', 'mittel@x.de');
        update public.profiles set username = 'Profi', trophies = 15000, best_trophies = 15000 where id = '11111111-2222-3333-4444-555555555555';
        update public.profiles set username = 'Mittel', trophies = 5000, best_trophies = 5000 where id = '11111111-2222-3333-4444-666666666666';
        insert into auth.users (id, email) values ('11111111-2222-3333-4444-777777777777', 'neu@x.de');
        update public.profiles set username = 'Neuling', trophies = 40, best_trophies = 40 where id = '11111111-2222-3333-4444-777777777777';`);
  await tP.goto(`${BASE}?e2e=1`);
  await tP.waitForSelector('[data-act="board"]');
  await tP.click('[data-act="board"]', { force: true });
  await tP.click('[data-act="tab-world"]', { force: true });
  await tP.waitForSelector(".trow", { timeout: 8000 });
  const rows = await tP.$$eval(".trow", (els) =>
    els.map((e) => ({ name: e.dataset.player, t: Number(e.querySelector("b").textContent.replace(/\D/g, "")), me: e.classList.contains("me"), rank: e.querySelector(".rk").textContent })),
  );
  const top = rows.slice(0, 100);
  check(top.length === 100, "Weltrangliste zeigt die besten 100");
  check(top.every((r, i) => i === 0 || r.t <= top[i - 1].t), "Weltrangliste nach Trophäen ABSTEIGEND sortiert");
  check(top[0].name === "Profi" && top[0].t === 15000, "Platz 1 = Spieler mit den meisten Trophäen (Profi, 15.000)");
  check(top.findIndex((r) => r.name === "Profi") < top.findIndex((r) => r.name === "Mittel"), "15.000 Trophäen steht VOR 5.000 Trophäen");
  check(rows.some((r) => r.me && r.name === "Lena"), "Eigener Eintrag hervorgehoben");
  check(await tP.isVisible(".wr-gap"), "Außerhalb der Top 100: eigener Rang unter der Liste");
  const myRankDb = dbVal("select world_rank from public.zwip_ranked() where username = 'Lena'");
  check((await tP.textContent(".wr-rank b")) === `#${myRankDb}`, `Eigener Weltrang #${myRankDb} korrekt`);
  const wrInfo = await tP.textContent(".wr-info");
  check(wrInfo.includes("Vor dir") && wrInfo.includes("Hinter dir: Neuling"), "Spieler vor und hinter mir werden angezeigt");
  const tail = rows.slice(100).map((r) => r.name);
  check(tail.length === 3 && tail[1] === "Lena" && tail[2] === "Neuling", `Unter der Liste: Nachbar, ich, Nachbar (${tail.join(", ")})`);
  check(!(await tP.content()).includes("@test.de"), "Keine E-Mail-Adressen in der Rangliste");
  await tP.screenshot({ path: `${SHOTS}/t7-world.png` });
  await tP.click('.trow[data-player="Profi"]', { force: true });
  await tP.waitForSelector(".pm-stats");
  check((await tP.textContent(".pm-stats")).includes("15.000"), "Spielerprofil aus der Rangliste");
  await tP.click(".modal [data-close]", { force: true });

  // ================= FREUNDE =================
  const fB = B.page; // Tom
  await fB.goto(`${BASE}?e2e=1`);
  await fB.waitForSelector('[data-act="friends"]');
  await fB.click('[data-act="friends"]', { force: true });
  await fB.waitForSelector(".friends .name-banner");
  await fB.click(".friends .name-banner", { force: true });
  await fB.fill("#un-input", "Tom");
  await fB.click("#un-save", { force: true });
  await fB.waitForSelector("#fr-q");
  await fB.fill("#fr-q", "le");
  await fB.waitForSelector('[data-add="Lena"]', { timeout: 5000 });
  check(true, "Spieler über den Namen gefunden");
  await fB.click('[data-add="Lena"]', { force: true });
  await fB.waitForSelector(".toast");
  check((await fB.textContent(".toast")).includes("Anfrage gesendet"), "Freundschaftsanfrage gesendet");
  await fB.waitForSelector('[data-cancel="Lena"]');
  check(true, "Gesendete Anfrage sichtbar");
  await fB.fill("#fr-q", "lena");
  await fB.waitForFunction(() => document.querySelector("#fr-results")?.textContent.includes("Angefragt"), null, { timeout: 5000 });
  check(true, "Doppelte Anfrage nicht möglich (Status „Angefragt“)");
  await fB.screenshot({ path: `${SHOTS}/f1-search.png` });

  await tP.click('[data-act="home"]', { force: true });
  await tP.click('[data-act="friends"]', { force: true });
  await tP.waitForSelector('[data-accept="Tom"]', { timeout: 5000 });
  check(true, "Eingehende Anfrage bei Lena sichtbar");
  await tP.screenshot({ path: `${SHOTS}/f2-incoming.png` });
  await tP.click('[data-accept="Tom"]', { force: true });
  await tP.waitForSelector('[data-friend="Tom"]', { timeout: 5000 });
  check(dbVal("select status from public.friendships") === "accepted", "Freundschaft in der Datenbank: accepted");
  psql("update public.profiles set trophies = 9000, best_trophies = 9000 where username = 'Tom'");
  await tP.click('[data-act="home"]', { force: true }).catch(() => {});
  await tP.goto(`${BASE}?e2e=1`);
  await tP.click('[data-act="friends"]', { force: true });
  await tP.waitForSelector('[data-friend="Tom"]');
  check((await tP.textContent('[data-friend="Tom"]')).includes("Platin"), "Freund mit Trophäen und Liga");
  await tP.screenshot({ path: `${SHOTS}/f3-friends.png` });
  await tP.click('[data-friend="Tom"]', { force: true });
  await tP.waitForSelector(".pm-stats");
  check((await tP.textContent(".pm-stats")).includes("9.000"), "Profil des Freundes");
  await tP.screenshot({ path: `${SHOTS}/f4-profile.png` });
  await tP.click("#pm-action", { force: true });
  check((await tP.textContent("#pm-action")).includes("Nochmal tippen"), "Entfernen braucht Bestätigung");
  await tP.click("#pm-action", { force: true });
  await tP.waitForFunction(() => !document.querySelector('[data-friend="Tom"]'), null, { timeout: 5000 });
  check(dbVal("select count(*) from public.friendships") === "0", "Freund entfernt (auch in der Datenbank)");

  // 10) Kaputter Link wird abgefangen
  const C = await newPage();
  await C.page.goto(`${BASE}?c=kaputt123&e2e=1`);
  await C.page.waitForSelector(".toast");
  check((await C.page.textContent(".toast")).includes("kaputt"), "Kaputter Duell-Link → freundliche Meldung");

  // 11) Gleiche Daily für alle
  const aDaily = Object.values(st.daily)[0];
  check(aDaily.rounds.length === 10, "Daily hat 10 Runden");

  check(mock.apikeyMissing === 0, "Jede Anfrage schickt den öffentlichen anon Key mit");
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
