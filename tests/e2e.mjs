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
  for (const f of ["tests/sql/supabase-shim.sql", "supabase/profiles.sql", "supabase/schema.sql", "supabase/trophies.sql", "supabase/profile.sql", "supabase/minigames.sql"]) psqlFile(f);
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
  if (p === "/auth/v1/user" && req.method === "PUT") {
    const u = mock.access.get((req.headers.authorization || "").replace("Bearer ", ""));
    if (!u) return json(res, 401, { code: 401, msg: "invalid JWT" });
    const { password, email } = await readBody(req);
    if (email) {
      if (mock.users.has(email)) return json(res, 422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
      mock.emailChanges = (mock.emailChanges || []).concat(email);
      if (mock.confirmMode) return json(res, 200, { id: u.id, email: u.email, new_email: email });
      mock.users.delete(u.email);
      u.email = email;
      mock.users.set(email, u);
      return json(res, 200, { id: u.id, email });
    }
    if (password === u.password) return json(res, 422, { code: 422, error_code: "same_password", msg: "New password should be different from the old password." });
    u.password = password;
    mock.passwordChanges = (mock.passwordChanges || 0) + 1;
    return json(res, 200, { id: u.id, email: u.email });
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
  // Abgebrochene Anfragen beim Seitenwechsel (ERR_ABORTED) sind harmlos und werden ignoriert
  page.on("requestfailed", (r) => !/fonts\.(googleapis|gstatic)/.test(r.url()) && !/ERR_ABORTED/.test(r.failure()?.errorText ?? "") && errors.push(`request: ${r.url()}`));
  // navigator.share gibt es im Headless-Browser nicht zuverlässig → Clipboard-Pfad wird getestet
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  return { ctx, page };
}

/** Profil-Tab öffnen (dort sind jetzt Konto, Abmelden und Einstellungen) */
async function openSettings(page) {
  await page.click('[data-tab="profil"]', { force: true });
  await page.waitForSelector('[data-pf="logout"]');
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
    let el = new Function("r", `return (${fnSrc})(r)`)(window.__zwip.round);
    if (typeof el === "function") el = el();
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, handleFn.toString());
}

async function stageCenterOf(page, sel) {
  const b = await page.locator(sel).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function stageCenter(page) {
  const b = await page.locator(".stage").boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Löst die aktuelle Runde wie ein echter Mensch (Klick/Swipe). fail=true: absichtlich falsch. */
const solvedLog = [];
async function solveRound(page, lastN, fail = false) {
  await page.waitForFunction((n) => window.__zwip.round && window.__zwip.round.n > n, lastN, { timeout: 15000 }).catch(async (e) => {
    await page.screenshot({ path: `${SHOTS}/zz-timeout.png` });
    console.log("Zuletzt gelöst:", solvedLog.slice(-16).join(" "));
    console.log("Hängt bei:", await page.evaluate(() => document.querySelector(".stage, .intro")?.className + " | " + document.querySelector(".t-task, .hud")?.textContent));
    throw e;
  });
  const r = await page.evaluate(() => ({ id: window.__zwip.round.gameId, n: window.__zwip.round.n, dir: window.__zwip.round.dir }));
  solvedLog.push(`${r.id}:${r.n}`);
  const waitReady = () => page.waitForFunction(() => !window.__zwip.round?.isReady || window.__zwip.round.isReady(), null, { polling: "raf", timeout: 15000 });
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
    } else if (r.id === "mole") {
      // nichts tun → Maulwurf verschwindet → verpasst
    } else if (r.id === "clock") {
      await page.waitForTimeout(800);
      const c = await stageCenter(page);
      await page.mouse.click(c.x, c.y); // viel zu früh
    } else if (r.id === "stack") {
      await page.waitForFunction((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.missing(); }, r.n, { polling: "raf", timeout: 8000 });
      const c = await stageCenter(page);
      await page.mouse.click(c.x, c.y);
    } else if (r.id === "ampel") {
      // Einfach festhalten – bei Rot wird man erwischt
      const p = await center(page, (round) => round.pad);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForFunction((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done(); }, r.n, { polling: "raf", timeout: 10000 });
      await page.mouse.up();
    } else if (r.id === "order") {
      const p = await page.evaluate(() => {
        const b = window.__zwip.round.sequence[1].getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      await page.mouse.click(p.x, p.y);
    } else if (["odd", "more", "sum", "ink", "find", "pattern", "count", "spell", "big", "shape", "newone", "cups", "pair", "blocks"].includes(r.id)) {
      await waitReady();
      // Ein falsches Feld derselben Sorte tippen
      const p = await page.evaluate(() => {
        const R = window.__zwip.round;
        let t = R.target;
        if (typeof t === "function") t = t();
        let wrong = typeof R.wrong === "function" ? R.wrong() : R.wrong;
        wrong ??= [...t.parentElement.children].find((e) => e !== t);
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
    // pop, dodge, slice: nichts tun → Zeit läuft ab / Crash / Frucht fällt runter
    return r;
  }
  switch (r.id) {
    case "odd":
    case "more":
    case "sum":
    case "ink":
    case "find":
    case "pattern":
    case "count":
    case "spell":
    case "big":
    case "shape":
    case "newone":
    case "cups":
    case "pair":
    case "blocks": {
      await waitReady();
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
    case "memory":
    case "order": {
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
    case "mole": {
      for (let k = 0; k < 40; k++) {
        const st = await page
          .waitForFunction((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done() || R.nextMole(); }, r.n, { polling: "raf", timeout: 5000 })
          .then((h) => h.jsonValue().catch(() => true), () => true);
        const done = await page.evaluate((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done(); }, r.n);
        if (done) break;
        const p = await page.evaluate(() => {
          const m = window.__zwip.round?.nextMole?.();
          if (!m) return null;
          const b = m.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        });
        if (p) await page.mouse.click(p.x, p.y);
        void st;
      }
      break;
    }
    case "clock":
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
    case "dodge": {
      for (let k = 0; k < 80; k++) {
        await page.waitForFunction((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done() || R.need(); }, r.n, { polling: "raf", timeout: 8000 });
        const p = await page.evaluate((n) => {
          const R = window.__zwip.round;
          if (!R || R.n !== n || R.done()) return "done";
          const el = R.need();
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height * 0.6 };
        }, r.n);
        if (p === "done") break;
        if (p) await page.mouse.click(p.x, p.y);
      }
      break;
    }
    case "stack": {
      for (let k = 0; k < 30; k++) {
        await page.waitForFunction((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done() || R.aligned(); }, r.n, { polling: "raf", timeout: 10000 });
        const done = await page.evaluate((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done(); }, r.n);
        if (done) break;
        const c = await stageCenter(page);
        await page.mouse.click(c.x, c.y);
        await page.waitForTimeout(120);
      }
      break;
    }
    case "slice": {
      for (let k = 0; k < 80; k++) {
        await page.waitForFunction((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done() || R.nextFruit(); }, r.n, { polling: "raf", timeout: 8000 });
        const p = await page.evaluate((n) => {
          const R = window.__zwip.round;
          if (!R || R.n !== n || R.done()) return "done";
          return R.nextFruit();
        }, r.n);
        if (p === "done") break;
        if (!p) continue;
        const sb = await page.locator(".stage").boundingBox();
        const y0 = Math.max(sb.y + 6, p.y - 75);
        const y1 = Math.min(sb.y + sb.height - 6, p.y + 75);
        await page.mouse.move(p.x, y0);
        await page.mouse.down();
        await page.mouse.move(p.x, y1, { steps: 4 });
        await page.mouse.up();
      }
      break;
    }
    case "ampel": {
      const p = await center(page, (round) => round.pad);
      await page.mouse.move(p.x, p.y);
      for (let k = 0; k < 40; k++) {
        await page.waitForFunction((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done() || R.light() === "green"; }, r.n, { polling: "raf", timeout: 8000 });
        const done = await page.evaluate((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done(); }, r.n);
        if (done) break;
        await page.mouse.down();
        await page.waitForFunction((n) => { const R = window.__zwip.round; return !R || R.n !== n || R.done() || R.light() !== "green"; }, r.n, { polling: "raf", timeout: 8000 });
        await page.mouse.up();
      }
      break;
    }
    case "swipe": {
      const dirs = await page.evaluate(() => window.__zwip.round.dirs ?? [window.__zwip.round.dir]);
      for (const dir of dirs) {
        const c = await stageCenter(page);
        const d = { up: [0, -140], down: [0, 140], left: [-140, 0], right: [140, 0] }[dir];
        await page.mouse.move(c.x, c.y);
        await page.mouse.down();
        await page.mouse.move(c.x + d[0], c.y + d[1], { steps: 5 });
        await page.mouse.up();
      }
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
  check((await A.page.textContent(".account-mail")).trim() === "lena@test.de", "Profil-Tab zeigt angemeldete E-Mail");
  await A.page.screenshot({ path: `${SHOTS}/5b-settings.png` });
  await A.page.click('[data-pf="logout"]', { force: true });
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
  await D.page.click('[data-pf="logout"]', { force: true });
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
  await B.page.click('[data-tab="spielen"]', { force: true });
  await B.page.click('[data-act="endless"]', { force: true });
  let n = 0;
  for (let i = 0; i < 3; i++) n = (await solveRound(B.page, n, i === 2)).n;
  await B.page.waitForSelector(".endless-res", { timeout: 8000 });
  const er = await B.page.textContent(".endless-res");
  check(/\d+ Runden geschafft/.test(er), `Endlos endet nach Fehler: "${er}"`);

  // 8b) Die vier neuen Challenges im Training, mit echten Taps gelöst
  await B.page.goto(`${BASE}?e2e=1&only=find,memory,beat,pattern#/spielen`);
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

  // 8c) Die 10 Spiele der dritten Welle im Training: einmal richtig, einmal absichtlich falsch
  await B.page.goto(`${BASE}?e2e=1&only=count,mole,spell,clock,big,shape,order,newone,cups,pair#/spielen`);
  await B.page.waitForSelector('[data-act="free"]', { timeout: 5000 });
  await B.page.click('[data-act="free"]', { force: true });
  const w3 = [];
  let w3n = 0;
  for (let i = 0; i < 10; i++) {
    const r = await solveRound(B.page, w3n);
    w3n = r.n;
    w3.push(r.id);
    await B.page.screenshot({ path: `${SHOTS}/w3-${i + 1}-${r.id}.png` });
  }
  await B.page.waitForSelector(".score-big", { timeout: 15000 });
  const w3Pts = await B.page.evaluate(() => [...document.querySelectorAll(".tile b")].map((b) => Number(b.textContent)));
  check(new Set(w3).size === 10, `Alle 10 neuen Spiele kommen vor: ${w3.join(", ")}`);
  check(w3Pts.every((p) => p > 0), `Alle 10 neuen Spiele per echtem Tap lösbar (Punkte ${w3Pts.join("/")})`);
  await B.page.click('.actions-2 [data-act="free"]', { force: true });
  w3n = 0;
  const w3fail = [];
  for (let i = 0; i < 10; i++) {
    const r = await solveRound(B.page, w3n, true);
    w3n = r.n;
    w3fail.push(r.id);
  }
  await B.page.waitForSelector(".score-big", { timeout: 25000 });
  const w3F = await B.page.evaluate(() => [...document.querySelectorAll(".tile b")].map((b) => Number(b.textContent)));
  check(w3F.every((p) => p === 0), `Neue Spiele erkennen Fehler (${w3fail.join(", ")} → ${w3F.join("/")})`);

  // 8d) Die 5 Spiele der vierten Welle im Training: zweimal richtig, einmal absichtlich falsch
  await B.page.goto(`${BASE}?e2e=1&only=blocks,dodge,stack,slice,ampel#/spielen`);
  await B.page.waitForSelector('[data-act="free"]', { timeout: 5000 });
  await B.page.click('[data-act="free"]', { force: true });
  const w4 = [];
  let w4n = 0;
  for (let i = 0; i < 10; i++) {
    const r = await solveRound(B.page, w4n);
    w4n = r.n;
    w4.push(r.id);
    await B.page.screenshot({ path: `${SHOTS}/w4-${i + 1}-${r.id}.png` });
  }
  await B.page.waitForSelector(".score-big", { timeout: 15000 });
  const w4Pts = await B.page.evaluate(() => [...document.querySelectorAll(".tile b")].map((b) => Number(b.textContent)));
  check(new Set(w4).size === 5, `Alle 5 Spiele der 4. Welle kommen vor: ${w4.join(", ")}`);
  check(w4Pts.every((p) => p > 0), `Block-Lücke, Ausweichen, Stapelturm, Schnippeln, Rotes Licht per echtem Tap/Wisch lösbar (Punkte ${w4Pts.join("/")})`);
  await B.page.click('.actions-2 [data-act="free"]', { force: true });
  w4n = 0;
  const w4fail = [];
  for (let i = 0; i < 10; i++) {
    const r = await solveRound(B.page, w4n, true);
    w4n = r.n;
    w4fail.push(r.id);
  }
  await B.page.waitForSelector(".score-big", { timeout: 30000 });
  const w4F = await B.page.evaluate(() => [...document.querySelectorAll(".tile b")].map((b) => Number(b.textContent)));
  check(w4F.every((p) => p === 0), `4. Welle erkennt Fehler (${w4fail.join(", ")} → ${w4F.join("/")})`);

  // 9) Erklärkarte vor JEDER Aufgabe: läuft durch, lässt sich nicht wegtippen (Dauer im Test verkürzt)
  await B.page.goto(`${BASE}?e2e=1&explain=3000#/spielen`);
  await B.page.waitForSelector('[data-act="free"]');
  await B.page.click('[data-act="free"]', { force: true });
  await B.page.waitForSelector(".intro.explain");
  const exText = await B.page.textContent(".explain-text");
  check(exText.length >= 60, `Ausführliche Erklärung wird gezeigt („${exText.slice(0, 40)}…“)`);
  const exStart = Number(await B.page.textContent(".explain-n"));
  check(exStart === 3, `Countdown startet bei der eingestellten Dauer (${exStart} s)`);
  const ic = await stageCenterOf(B.page, ".intro");
  await B.page.mouse.click(ic.x, ic.y);
  await B.page.waitForTimeout(1300);
  check(await B.page.isVisible(".intro.explain"), "Erklärung lässt sich nicht vorzeitig wegtippen");
  check(Number(await B.page.textContent(".explain-n")) < exStart, "Countdown läuft herunter");
  await B.page.screenshot({ path: `${SHOTS}/2-explain.png` });
  await B.page.waitForSelector(".intro.explain", { state: "detached", timeout: 4000 });
  check(true, "Nach Ablauf startet die Aufgabe automatisch");
  await solveRound(B.page, 0);
  await B.page.waitForSelector(".intro.explain", { timeout: 4000 });
  check((await B.page.textContent(".intro-round")).includes("2 / 10"), "Auch vor der zweiten Aufgabe kommt die Erklärkarte");

  // Training abbrechen → zurück auf „Spielen“
  await B.page.click('[data-act="quit"]', { force: true });
  await B.page.waitForSelector(".mode-list", { timeout: 4000 });
  check(true, "Training lässt sich abbrechen (zurück auf „Spielen“)");

  // ================= NAVIGATION =================
  await B.page.goto(`${BASE}?e2e=1#/spielen`);
  await B.page.waitForSelector(".mode-list");
  check((await B.page.locator(".tabbar .tab").count()) === 5, "Tab-Leiste mit 5 Bereichen");
  check((await B.page.getAttribute('.tab[data-tab="spielen"]', "aria-current")) === "page", "Aktiver Tab ist markiert");
  check((await B.page.locator(".mode-card").count()) === 5, "„Spielen“ zeigt 5 Modi");
  await B.page.screenshot({ path: `${SHOTS}/n1-spielen.png` });
  await B.page.click('[data-tab="ranglisten"]', { force: true });
  await B.page.waitForSelector(".seg");
  check(B.page.url().endsWith("#/ranglisten"), "Tab wechselt die Adresse (#/ranglisten)");
  await B.page.goBack();
  await B.page.waitForSelector(".mode-list", { timeout: 4000 });
  check(true, "Zurück-Knopf führt zum vorherigen Tab");
  await B.page.click('.mode-card[href="#/minigames"]', { force: true });
  await B.page.waitForSelector(".mg-grid");
  check((await B.page.locator(".mg-card").count()) === 27, "Minigames-Übersicht mit 27 Spielen");
  await B.page.reload();
  await B.page.waitForSelector(".mg-grid", { timeout: 5000 });
  check(true, "Neuladen bleibt auf demselben Bildschirm");
  await B.page.screenshot({ path: `${SHOTS}/n2-minigames.png` });
  for (const t of ["start", "freunde", "profil"]) {
    await B.page.click(`[data-tab="${t}"]`, { force: true });
    await B.page.waitForFunction((t) => location.hash === `#/${t}`, t);
    await B.page.waitForSelector(`.tab.on[data-tab="${t}"]`);
  }
  await B.page.waitForSelector('[data-pf="logout"]');
  check(true, "Alle Tabs erreichbar (Start, Freunde, Profil)");
  check(!(await B.page.locator('[data-act="settings"]').count()), "Kein extra Einstellungs-Popup mehr");

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
  check(new Set(seenT).size === 15, `15 verschiedene Minispiele in der Trophäen-Runde (${seenT.join(", ")})`);
  check(seenT.every((g, i) => i === 0 || g !== seenT[i - 1]), "Nie dasselbe Spiel direkt hintereinander");
  await tP.waitForSelector(".tr-rows", { timeout: 30000 });
  await tP.waitForFunction(() => !document.querySelector(".tr-status"), null, { timeout: 30000 });
  await tP.waitForTimeout(1200);
  if (await tP.isVisible(".league-up")) await tP.click(".league-up button", { force: true });
  const shownDelta = (await tP.textContent("#tr-delta")).replace(/[^\d−-]/g, "").replace("−", "-");
  const dbTrophies = Number(dbVal("select trophies from public.profiles where username = 'Lena'"));
  check(dbTrophies > 60 && Number(shownDelta) === dbTrophies, `Server hat ${dbTrophies} Trophäen gutgeschrieben, Anzeige stimmt (${shownDelta})`);
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
  await tP.waitForSelector('[data-tab="ranglisten"]');
  await tP.click('[data-tab="ranglisten"]', { force: true });
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
  await fB.waitForSelector('[data-tab="freunde"]');
  await fB.click('[data-tab="freunde"]', { force: true });
  await fB.waitForSelector(".friends .name-banner");
  await fB.click(".friends .name-banner", { force: true });
  await fB.fill("#un-input", "Tom");
  await fB.click("#un-save", { force: true });
  await fB.waitForSelector("#fr-q");
  await fB.fill("#fr-q", "le");
  await fB.waitForSelector('[data-add="Lena"]', { timeout: 5000 });
  check(true, "Spieler über den Namen gefunden");
  await fB.click('[data-add="Lena"]', { force: true });
  const sentOk = await fB
    .waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Anfrage gesendet"), null, { timeout: 5000 })
    .then(() => true, () => false);
  check(sentOk, "Freundschaftsanfrage gesendet");
  await fB.waitForSelector('[data-cancel="Lena"]');
  check(true, "Gesendete Anfrage sichtbar");
  await fB.fill("#fr-q", "lena");
  await fB.waitForFunction(() => document.querySelector("#fr-results")?.textContent.includes("Angefragt"), null, { timeout: 5000 });
  check(true, "Doppelte Anfrage nicht möglich (Status „Angefragt“)");
  await fB.screenshot({ path: `${SHOTS}/f1-search.png` });

  await tP.click('[data-tab="freunde"]', { force: true });
  await tP.waitForSelector('[data-accept="Tom"]', { timeout: 5000 });
  check(true, "Eingehende Anfrage bei Lena sichtbar");
  await tP.screenshot({ path: `${SHOTS}/f2-incoming.png` });
  await tP.click('[data-accept="Tom"]', { force: true });
  await tP.waitForSelector('[data-friend="Tom"]', { timeout: 5000 });
  check(dbVal("select status from public.friendships") === "accepted", "Freundschaft in der Datenbank: accepted");
  psql("update public.profiles set trophies = 9000, best_trophies = 9000 where username = 'Tom'");
  await tP.goto(`${BASE}?e2e=1#/start`);
  await tP.click('[data-tab="freunde"]', { force: true });
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

  // ================= PROFIL =================
  await tP.goto(`${BASE}?e2e=1`);
  await tP.waitForSelector('[data-tab="profil"]');
  await tP.click('[data-tab="profil"]', { force: true });
  await tP.waitForFunction(() => document.querySelector(".pf-head h3")?.textContent === "Lena", null, { timeout: 5000 });
  check(true, "Profil-Tab zeigt Spielername");
  const profLink = (await tP.textContent(".pf-url-text")).trim();
  check(profLink.endsWith("?p=Lena"), `Profil zeigt Direktlink (${profLink})`);
  check((await tP.textContent(".pf-stats")).includes("Höchststand"), "Profil zeigt Statistiken");
  await tP.click('[data-pf="copy"]', { force: true });
  await tP.waitForSelector(".toast");
  const clip = await tP.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check(clip === `${BASE}?p=Lena`, `Link kopiert: ${clip}`);
  await tP.screenshot({ path: `${SHOTS}/p1-profile.png` });

  // Profilbild aus der Mediathek (Dateiauswahl)
  const photo = await tP.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 600;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 900, 600);
    g.addColorStop(0, "#ff3d8b");
    g.addColorStop(1, "#3d7bff");
    x.fillStyle = g;
    x.fillRect(0, 0, 900, 600);
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(450, 300, 160, 0, Math.PI * 2);
    x.fill();
    return c.toDataURL("image/png").split(",")[1];
  });
  await tP.setInputFiles("#pf-file", { name: "IMG_0042.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
  await tP.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Profilbild gespeichert"), null, { timeout: 8000 });
  check(dbVal("select left(avatar, 23) from public.profiles where username = 'Lena'") === "data:image/jpeg;base64,", "Profilbild als kleines JPEG in der Datenbank");
  const avLen = Number(dbVal("select length(avatar) from public.profiles where username = 'Lena'"));
  check(avLen > 1000 && avLen < 150000, `Profilbild ist klein (${Math.round(avLen / 1024)} KB)`);
  check((await tP.locator(".pf-avatar img").count()) === 1, "Profilbild erscheint sofort im Profil");
  check((await tP.locator('[data-pf="remove"]').count()) === 1, "Profilbild kann wieder entfernt werden");
  await tP.screenshot({ path: `${SHOTS}/p2-profile-photo.png` });

  // Kaputte Datei
  await tP.setInputFiles("#pf-file", { name: "notiz.txt", mimeType: "text/plain", buffer: Buffer.from("hallo") });
  await tP.waitForSelector(".pf .inline-error", { timeout: 5000 });
  check((await tP.textContent(".pf .inline-error")).includes("Foto"), "Keine Bilddatei → verständliche Meldung");

  // Passwort ändern
  await tP.click('[data-pf="password"]', { force: true });
  await tP.waitForSelector("#pw-current");
  await tP.fill("#pw-current", "falsch123");
  await tP.fill("#pw-new", "neuesPasswort1");
  await tP.fill("#pw-new2", "neuesPasswort1");
  await tP.click("#pw-save", { force: true });
  await tP.waitForSelector(".pf-pw .auth-error:not([hidden])");
  check((await tP.textContent(".pf-pw .auth-error")).includes("aktuelles Passwort"), "Falsches aktuelles Passwort wird erkannt");
  await tP.fill("#pw-current", "geheim123");
  await tP.fill("#pw-new2", "neuesPasswort2");
  await tP.click("#pw-save", { force: true });
  await tP.waitForFunction(() => document.querySelector(".pf-pw .auth-error")?.textContent.includes("stimmen nicht"), null, { timeout: 5000 });
  check(true, "Neue Passwörter müssen übereinstimmen");
  await tP.screenshot({ path: `${SHOTS}/p3-password.png` });
  await tP.fill("#pw-new2", "neuesPasswort1");
  await tP.click("#pw-save", { force: true });
  await tP.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Passwort geändert"), null, { timeout: 5000 });
  check(mock.users.get("lena@test.de").password === "neuesPasswort1", "Passwort beim Auth-Server geändert");
  await tP.reload();
  await tP.waitForSelector(".pf-avatar img", { timeout: 5000 });
  check(true, "Profilbild bleibt nach Neuladen im Profil");
  await tP.screenshot({ path: `${SHOTS}/p4-profile-tab.png`, fullPage: true });

  // E-Mail ändern: mit Bestätigungs-Mail (Standard bei Supabase)
  await tP.waitForSelector(".pf-since"); // Profil-Daten vom Server sind da
  await tP.waitForSelector('[data-pf="email"]');
  check((await tP.textContent('[data-pf="email"]')).includes("lena@test.de"), "Profil zeigt aktuelle E-Mail");
  await tP.click('[data-pf="email"]', { force: true });
  await tP.waitForSelector("#em-new");
  await tP.fill("#em-new", "kaputt");
  await tP.fill("#em-pw", "neuesPasswort1");
  await tP.click("#em-save", { force: true });
  await tP.waitForSelector(".pf-pw .auth-error:not([hidden])");
  check((await tP.textContent(".pf-pw .auth-error")).includes("gültige E-Mail"), "E-Mail ändern: ungültige Adresse wird erkannt");
  await tP.fill("#em-new", "max@test.de");
  await tP.click("#em-save", { force: true });
  await tP.waitForFunction(() => document.querySelector(".pf-pw .auth-error")?.textContent.includes("anderen Account"), null, { timeout: 5000 });
  check(true, "E-Mail ändern: vergebene Adresse wird erkannt");
  await tP.fill("#em-new", "lena.neu@test.de");
  await tP.fill("#em-pw", "falsch999");
  await tP.click("#em-save", { force: true });
  await tP.waitForFunction(() => document.querySelector(".pf-pw .auth-error")?.textContent.includes("aktuelles Passwort"), null, { timeout: 5000 });
  check(true, "E-Mail ändern: falsches Passwort wird erkannt");
  await mockCall("/__mock/confirm-mode?on=1");
  await tP.fill("#em-pw", "neuesPasswort1");
  await tP.click("#em-save", { force: true });
  await tP.waitForFunction(() => document.querySelector(".pf-pw")?.textContent.includes("Fast geschafft"), null, { timeout: 5000 });
  check((await tP.textContent(".pf-pw")).includes("lena.neu@test.de"), "E-Mail ändern: Hinweis auf Bestätigungs-Mail");
  await tP.screenshot({ path: `${SHOTS}/p6-email-pending.png` });
  await tP.click(".pf-pw [data-close]", { force: true });
  await mockCall("/__mock/confirm-mode?on=0");
  // Ohne Bestätigung (sofort gültig)
  await tP.click('[data-pf="email"]', { force: true });
  await tP.waitForSelector("#em-new");
  await tP.fill("#em-new", "lena2@test.de");
  await tP.fill("#em-pw", "neuesPasswort1");
  await tP.click("#em-save", { force: true });
  await tP.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("E-Mail geändert"), null, { timeout: 5000 });
  await tP.waitForFunction(() => document.querySelector('[data-pf="email"]')?.textContent.includes("lena2@test.de"), null, { timeout: 5000 });
  check(mock.users.has("lena2@test.de"), "E-Mail beim Auth-Server geändert und im Profil angezeigt");
  psql("update auth.users set email = 'lena2@test.de' where email = 'lena@test.de'");

  // Mit neuem Passwort anmelden
  await openSettings(tP);
  await tP.click('[data-pf="logout"]', { force: true });
  await tP.waitForSelector('[data-auth="login"]', { timeout: 5000 });
  await tP.click('[data-auth="login"]', { force: true });
  await fillAuth(tP, "lena2@test.de", "geheim123");
  check((await authError(tP)).includes("falsch"), "Altes Passwort funktioniert nicht mehr");
  await fillAuth(tP, "lena2@test.de", "neuesPasswort1");
  await tP.waitForSelector('[data-tab="profil"]', { timeout: 5000 });
  check(true, "Anmeldung mit neuem Passwort");

  // Direktlink öffnen (Tom öffnet Lenas Link)
  await fB.goto(`${BASE}?e2e=1&p=Lena`);
  await fB.waitForFunction(() => document.querySelector(".pf-head h3")?.textContent === "Lena", null, { timeout: 6000 });
  check(true, "Direktlink öffnet das Profil von Lena");
  check(!fB.url().includes("p=Lena"), "Link-Parameter verschwindet aus der Adresszeile");
  check((await fB.locator(".pf-avatar img").count()) === 1, "Fremdes Profil zeigt das Profilbild");
  check(!(await fB.content()).includes("lena@test.de"), "Fremdes Profil zeigt keine E-Mail");
  await fB.screenshot({ path: `${SHOTS}/p5-link-profile.png` });
  await fB.click('[data-pp="add"]', { force: true });
  await fB.waitForSelector(".pf-state", { timeout: 5000 });
  check((await fB.textContent(".pf-state")).includes("Anfrage gesendet"), "Freund direkt aus dem Profil-Link hinzufügen");
  await fB.goto(`${BASE}?e2e=1&p=Gibtsnicht`);
  await fB.waitForSelector(".pf .inline-error", { timeout: 5000 });
  check((await fB.textContent(".pf")).includes("nicht gefunden"), "Unbekannter Profil-Link → freundliche Meldung");

  // Eigener Link öffnet das eigene Profil
  await tP.goto(`${BASE}?e2e=1&p=lena`);
  await tP.waitForSelector('[data-pf="password"]', { timeout: 6000 });
  check(true, "Eigener Link öffnet das eigene Profil");

  // ================= MINIGAMES =================
  // Jedes Spiel lässt sich auf jeder Stufe 1–60 fehlerfrei aufbauen
  const mountProblems = await tP.evaluate(() => {
    const bad = [];
    for (const id of ["odd", "stop", "wait", "more", "pop", "sum", "ink", "swipe", "find", "memory", "beat", "pattern", "count", "mole", "spell", "clock", "big", "shape", "order", "newone", "cups", "pair"])
      for (let n = 1; n <= 60; n++) {
        try {
          const r = window.__zwip.mountStage(id, n);
          if (!(r.limit > 0)) bad.push(`${id}@${n}: limit ${r.limit}`);
        } catch (e) {
          bad.push(`${id}@${n}: ${e.message}`);
        }
      }
    return bad;
  });
  check(mountProblems.length === 0, `Alle 22 Minigames bauen auf Stufe 1–60 fehlerfrei auf${mountProblems.length ? ": " + mountProblems.slice(0, 5).join(" | ") : ""}`);

  await tP.goto(`${BASE}?e2e=1#/minigames`);
  await tP.waitForSelector('.mg-card[data-mg="memory"]');
  await tP.click('.mg-card[data-mg="memory"]', { force: true });
  await tP.waitForSelector('[data-act="mgplay"]');
  check((await tP.locator(".mg-prog li").count()) >= 3, "Detailseite zeigt „So wird's schwerer“");
  check((await tP.textContent(".mg-hero p")).includes("Reihenfolge"), "Detailseite zeigt die Erklärung");
  await tP.screenshot({ path: `${SHOTS}/m1-detail.png`, fullPage: true });
  await tP.click('[data-act="mgplay"]', { force: true });
  await tP.waitForSelector(".mg-start");
  check((await tP.locator(".intro.explain").count()) === 0, "Minigame startet ohne lange Erklärkarte, nur mit 3-2-1");
  await tP.screenshot({ path: `${SHOTS}/m2-start.png` });
  let mn = 0;
  for (let i = 0; i < 4; i++) {
    const r = await solveRound(tP, mn);
    mn = r.n;
    check(r.id === "memory", `Stufe ${i + 1}: immer dasselbe Spiel`);
    if (i === 3) await tP.screenshot({ path: `${SHOTS}/m3-run-stage4.png` });
  }
  await tP.waitForFunction(() => document.getElementById("mg-stage")?.textContent === "5", null, { timeout: 5000 });
  const memLen = await tP.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 50));
    return document.querySelectorAll(".mem-cell").length;
  });
  check(memLen === 16, `Ab Stufe 5 ein 4×4-Feld (${memLen} Felder)`);
  await solveRound(tP, mn, true);
  await tP.waitForSelector(".mg-result", { timeout: 8000 });
  await tP.waitForFunction(() => !document.querySelector(".mg-result .tr-status"), null, { timeout: 8000 });
  check((await tP.textContent("#mg-res-n")) === "4", "Ergebnis zeigt Stufe 4");
  check(dbVal("select best_stage || '/' || plays from public.minigame_bests b join public.profiles p on p.id = b.user_id where p.username = 'Lena' and b.game_id = 'memory'") === "4/1", "Stufe 4 steht in der Datenbank");
  check((await tP.textContent(".mg-result")).includes("Neuer Rekord"), "Erster Lauf = neuer Rekord");
  check((await tP.textContent(".mg-res-rank")).includes("#1"), "Rang in der Spiel-Rangliste wird angezeigt");
  await tP.screenshot({ path: `${SHOTS}/m4-result.png` });

  // Spieler mit besserem Wert steht davor
  psql(`insert into public.minigame_bests (user_id, game_id, best_stage, best_ms, plays) values ('11111111-2222-3333-4444-555555555555', 'memory', 9, 30000, 3)`);
  await tP.click('[data-act="mgboard"]', { force: true });
  await tP.waitForSelector(".mrow", { timeout: 5000 });
  const mrows = await tP.$$eval(".mrow", (els) => els.map((e) => ({ name: e.dataset.player, me: e.classList.contains("me") })));
  check(mrows[0]?.name === "Profi" && mrows[1]?.name === "Lena" && mrows[1].me, `Spiel-Rangliste: Profi (Stufe 9) vor mir (${mrows.map((r) => r.name).join(", ")})`);
  check(tP.url().endsWith("#/ranglisten/minigames/memory"), "Rangliste öffnet den Minigames-Tab mit dem richtigen Spiel");
  await tP.screenshot({ path: `${SHOTS}/m5-board.png` });

  // Drei weitere Minigames: zwei Stufen schaffen, dann Fehler
  for (const id of ["odd", "sum", "pattern", "count", "cups", "order"]) {
    await tP.goto(`${BASE}?e2e=1#/minigames/${id}`);
    await tP.waitForSelector('[data-act="mgplay"]');
    await tP.click('[data-act="mgplay"]', { force: true });
    let k = 0;
    for (let i = 0; i < 2; i++) k = (await solveRound(tP, k)).n;
    await solveRound(tP, k, true);
    await tP.waitForSelector(".mg-result", { timeout: 8000 });
    await tP.waitForFunction(() => !document.querySelector(".mg-result .tr-status"), null, { timeout: 8000 });
    const got = await tP.textContent("#mg-res-n");
    const db = dbVal(`select best_stage from public.minigame_bests b join public.profiles p on p.id = b.user_id where p.username = 'Lena' and b.game_id = '${id}'`);
    check(got === "2" && db === "2", `${id}: Stufe 2 geschafft und gespeichert`);
  }

  // Übersicht zeigt Bestwerte und Ränge
  await tP.goto(`${BASE}?e2e=1#/minigames`);
  await tP.waitForFunction(() => document.querySelector('.mg-card[data-mg="memory"] .mg-best')?.textContent.includes("Stufe 4"), null, { timeout: 5000 });
  check((await tP.textContent('.mg-card[data-mg="memory"]')).includes("#2"), "Übersicht zeigt Bestleistung und Rang");
  await tP.screenshot({ path: `${SHOTS}/m6-overview.png` });

  // Zurück-Knopf während eines Laufs beendet den Lauf und zeigt die vorige Seite
  await tP.click('.mg-card[data-mg="ink"]', { force: true });
  await tP.waitForSelector('[data-act="mgplay"]');
  await tP.click('[data-act="mgplay"]', { force: true });
  await solveRound(tP, 0);
  await tP.goBack();
  await tP.waitForSelector(".mg-grid", { timeout: 6000 });
  await tP.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 800));
  check(dbVal("select plays from public.minigame_bests b join public.profiles p on p.id = b.user_id where p.username = 'Lena' and b.game_id = 'ink'") === "1", "Zurück-Knopf beendet den Lauf, er wird trotzdem gewertet");

  // ================= SCHMALE HANDYS (360 px) =================
  await tP.setViewportSize({ width: 360, height: 740 });
  const overflow = [];
  for (const r of ["start", "spielen", "minigames", "minigames/memory", "ranglisten/welt", "ranglisten/minigames/memory", "ranglisten/crew", "freunde", "profil"]) {
    await tP.goto(`${BASE}?e2e=1#/${r}`);
    await tP.waitForSelector(".tabbar");
    await tP.waitForTimeout(500);
    const w = await tP.evaluate(() => document.documentElement.scrollWidth);
    if (w > 361) overflow.push(`${r}: ${w}px`);
    await tP.screenshot({ path: `${SHOTS}/w360-${r.replace(/\//g, "-")}.png` });
  }
  check(overflow.length === 0, `Kein waagrechtes Scrollen bei 360 px${overflow.length ? ": " + overflow.join(", ") : ""}`);
  // Schwere Stufen ansehen (Layout bei vielen Feldern)
  for (const [id, n] of [["odd", 20], ["memory", 12], ["find", 14], ["pattern", 12], ["pop", 13], ["more", 15], ["ink", 12], ["swipe", 14], ["beat", 12], ["sum", 14], ["wait", 8], ["stop", 12],
    ["count", 18], ["mole", 14], ["spell", 12], ["clock", 10], ["big", 17], ["big", 9], ["shape", 14], ["order", 15], ["newone", 12], ["cups", 12], ["pair", 15], ["pair", 3],
    ["blocks", 3], ["blocks", 12], ["dodge", 12], ["stack", 10], ["slice", 12], ["ampel", 10]]) {
    await tP.evaluate(([id, n]) => window.__zwip.previewStage(id, n), [id, n]);
    await tP.waitForTimeout(450);
    const ow = await tP.evaluate(() => {
      const st = document.querySelector(".e2e-preview .stage").getBoundingClientRect();
      return [...document.querySelectorAll(".e2e-preview .stage *")].filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && (b.right > st.right + 2 || b.left < st.left - 2) && !e.closest(".bubble") && !e.classList.contains("stack-block");
      }).length;
    });
    check(ow === 0, `${id} Stufe ${n}: alles passt auf ein 360-px-Handy`);
    if (["newone", "count", "cups", "dodge", "slice", "stack", "ampel"].includes(id)) await tP.waitForTimeout(1600);
    await tP.screenshot({ path: `${SHOTS}/s360-${id}-${n}.png` });
  }
  await tP.evaluate(() => document.querySelector(".e2e-preview")?.remove());
  await tP.setViewportSize({ width: 390, height: 844 });

  // 10) Kaputter Link wird abgefangen
  const C = await newPage();
  await C.page.goto(`${BASE}?c=kaputt123&e2e=1`);
  await C.page.waitForSelector(".toast");
  check((await C.page.textContent(".toast")).includes("kaputt"), "Kaputter Duell-Link → freundliche Meldung");
  await C.page.goto(`${BASE}?p=Lena&e2e=1`);
  await C.page.waitForSelector(".duel-card");
  check((await C.page.textContent(".duel-card")).includes("Profil von Lena"), "Profil-Link ohne Anmeldung: Hinweis im Startmenü");

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
