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
const dbVal = (sql) => psql(sql).out.trim();
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
  for (const f of ["tests/sql/supabase-shim.sql", "supabase/profiles.sql", "supabase/schema.sql", "supabase/trophies.sql", "supabase/profile.sql", "supabase/minigames.sql", "supabase/social.sql", "supabase/clans.sql", "supabase/regions.sql", "supabase/moderation.sql", "supabase/clanplus.sql", "supabase/push.sql"]) psqlFile(f);
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
  // Edge Function „delete-account“ nachgebaut: Clan verlassen, dann Konto löschen
  if (p === "/functions/v1/delete-account" && req.method === "POST") {
    const u = mock.access.get((req.headers.authorization || "").replace("Bearer ", ""));
    if (!u) return json(res, 401, { error: "not_authenticated" });
    psql(`select public.zwip_prepare_delete('${u.id}'); delete from auth.users where id = '${u.id}';`);
    mock.users.delete(u.email);
    mock.deleted = (mock.deleted || 0) + 1;
    return json(res, 200, { deleted: true });
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
  if (/^\/(auth|rest|functions)\/v1\/|^\/__mock\//.test(url.pathname)) return void handleApi(req, res, url).catch((e) => json(res, 500, { msg: String(e) }));
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

async function newPage({ tour = false } = {}) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true });
  // Die Einführung beim ersten Öffnen wird nur im eigenen Test gezeigt
  if (!tour) await ctx.addInitScript(() => localStorage.setItem("zwip:tour", "1"));
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
/** Tab „Freunde & Clan“ öffnen und auf Freunde bzw. Clan umschalten */
async function openSocial(page, sub) {
  await page.click('[data-tab="social"]', { force: true });
  await page.waitForSelector(".social-seg");
  if (!(await page.locator(`.social-seg [data-seg="${sub}"].on`).count())) await page.click(`.social-seg [data-seg="${sub}"]`, { force: true });
  await page.waitForSelector(`.social-seg [data-seg="${sub}"].on`);
}

async function openSettings(page) {
  await page.click('[data-tab="profil"]', { force: true });
  await page.waitForSelector('[data-pf="logout"]');
}

async function fillAuth(page, email, pw, pw2, age = 20) {
  await page.fill("#auth-email", email);
  await page.fill("#auth-password", pw);
  if (pw2 !== undefined) {
    await page.fill("#auth-password2", pw2);
    await page.fill("#auth-age", String(age));
    if (age < 16) await page.check("#auth-parent", { force: true });
    await page.check("#auth-terms", { force: true });
  }
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
let hammerSeen = false;
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
        if (p) {
          await page.mouse.click(p.x, p.y);
          hammerSeen ||= await page.evaluate(() => Boolean(document.querySelector(".mole-hammer.swing")));
        }
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
  // Alter und Zustimmung
  await A.page.fill("#auth-age", "12");
  await A.page.uncheck("#auth-parent", { force: true }).catch(() => {});
  await A.page.click("#auth-submit", { force: true });
  check((await authError(A.page)).includes("Eltern"), "Unter 16 ohne Eltern-Häkchen geht nicht");
  check(await A.page.isVisible("#auth-parent-row"), "Eltern-Häkchen erscheint bei Alter unter 16");
  await A.page.fill("#auth-age", "20");
  await A.page.uncheck("#auth-terms", { force: true });
  await A.page.click("#auth-submit", { force: true });
  check((await authError(A.page)).includes("Nutzungsbedingungen"), "Ohne Zustimmung keine Registrierung");
  await fillAuth(A.page, "Lena@Test.de ", "geheim123", "geheim123");
  await A.page.waitForSelector('[data-act="daily"]', { timeout: 5000 });
  check(true, "Nach Registrierung direkt eingeloggt im Hauptmenü");
  check(mock.users.has("lena@test.de"), "Account wurde beim Auth-Server angelegt (E-Mail normalisiert)");
  await A.page.waitForFunction(() => true);
  for (let i = 0; i < 20 && dbVal("select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email = 'lena@test.de' and p.terms_accepted_at is not null") !== "1"; i++) await A.page.waitForTimeout(150);
  check(dbVal("select count(*) from public.profiles p join auth.users u on u.id = p.id where u.email = 'lena@test.de' and p.terms_accepted_at is not null and p.birth_year is not null") === "1", "Alter und Zustimmung beim Server gespeichert");

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
  check(/^ZWIP Daily \d+\. \S+ ⚡ \d+\/1000\n[🟪🟩🟨🟥]{5}\n[🟪🟩🟨🟥]{5}/u.test(shared), "Teilen-Text mit Emoji-Raster erzeugt");
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
  check((await A.page.textContent(".streak-chip")).includes("1") && (await A.page.locator(".streak-chip.s-done").count()) === 1, "Oben rechts: 🔥 Streak 1, heute erledigt");
  check((await A.page.textContent(".done-card")).includes("Daily von heute") && !(await A.page.textContent(".page")).match(/Daily #\d/), "Daily ohne Nummer im Namen");
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
  check((await A.page.textContent(".streak-chip")).includes("1"), "Nach erneutem Login: Daily-Ergebnis und Streak noch da");

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
  await B.page.click('[data-tab="start"]', { force: true });
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
  check(hammerSeen, "Hau den Maulwurf: Der Hammer schlägt sichtbar zu");

  // 8e) Zeit abgelaufen → die richtige Lösung wird markiert (Finde den Anderen, Rechnung, Farbe, Hütchen, Paar …)
  await B.page.goto(`${BASE}?e2e=1&only=odd,sum,ink,cups,pair,spell&explain=200#/spielen`);
  await B.page.waitForSelector('[data-act="free"]', { timeout: 5000 });
  await B.page.click('[data-act="free"]', { force: true });
  const solSeen = [];
  let sn = 0;
  for (let i = 0; i < 6; i++) {
    await B.page.waitForFunction((n) => window.__zwip.round && window.__zwip.round.n > n, sn, { timeout: 15000 });
    const id = await B.page.evaluate(() => window.__zwip.round.gameId);
    sn = await B.page.evaluate(() => window.__zwip.round.n);
    const ok = await B.page.waitForSelector(".stage .solution", { timeout: 12000 }).then(() => true, () => false);
    if (ok) solSeen.push(id);
    if (i === 0) await B.page.screenshot({ path: `${SHOTS}/z-timeout-solution-${id}.png` });
  }
  check(solSeen.length === 6, `Bei Zeitablauf wird die richtige Lösung markiert (${solSeen.join(", ")})`);

  // 9) Erklärkarte vor JEDER Aufgabe: nichts startet von selbst, erst „Los!“ startet die Aufgabe
  await B.page.goto(`${BASE}?e2e=1&explain=manual#/start`);
  await B.page.waitForSelector('[data-act="free"]');
  await B.page.click('[data-act="free"]', { force: true });
  await B.page.waitForSelector(".intro.explain");
  const exText = await B.page.textContent(".explain-text");
  check(exText.length >= 60, `Ausführliche Erklärung wird gezeigt („${exText.slice(0, 40)}…“)`);
  check((await B.page.textContent(".explain-count")).includes("erst, wenn du tippst"), "Hinweis: Die Zeit läuft erst nach dem Tippen");
  const ic = await stageCenterOf(B.page, ".intro .intro-title");
  await B.page.mouse.click(ic.x, ic.y);
  await B.page.waitForTimeout(2500);
  check(await B.page.isVisible(".intro.explain"), "Daneben tippen überspringt die Erklärung nicht aus Versehen");
  check(await B.page.isVisible(".intro.explain"), "Ohne Tippen startet nichts von selbst (auch nach 2,5 s nicht)");
  check(await B.page.isVisible(".explain-ok"), "Erklärkarte hat einen Los-Knopf");
  await B.page.screenshot({ path: `${SHOTS}/2-explain.png` });
  let okAt = Date.now();
  let okB = await stageCenterOf(B.page, ".explain-ok");
  await B.page.mouse.click(okB.x, okB.y);
  await B.page.waitForSelector(".intro.explain", { state: "detached", timeout: 1500 });
  check(Date.now() - okAt < 1200, `„Los!“ startet die Aufgabe sofort (${Date.now() - okAt} ms)`);
  await solveRound(B.page, 0);
  await B.page.waitForSelector(".intro.explain", { timeout: 4000 });
  check((await B.page.textContent(".intro-round")).includes("2 / 10"), "Auch vor der zweiten Aufgabe kommt die Erklärkarte");
  okAt = Date.now();
  okB = await stageCenterOf(B.page, ".explain-ok");
  await B.page.mouse.click(okB.x, okB.y);
  await B.page.waitForSelector(".intro.explain", { state: "detached", timeout: 1500 });
  await solveRound(B.page, 1);

  // Training abbrechen → zurück auf „Spielen“
  await B.page.click('[data-act="quit"]', { force: true });
  await B.page.waitForSelector(".mode-list", { timeout: 4000 });
  check(true, "Training lässt sich abbrechen (zurück auf „Spielen“)");

  // ================= NAVIGATION =================
  await B.page.goto(`${BASE}?e2e=1#/spielen`);
  await B.page.waitForSelector(".mode-list");
  check((await B.page.locator(".tabbar .tab").count()) === 4, "Tab-Leiste mit 4 Bereichen (Spielen, Ranglisten, Freunde & Clan, Profil)");
  check((await B.page.getAttribute('.tab[data-tab="start"]', "aria-current")) === "page", "Aktiver Tab ist markiert");
  check((await B.page.locator(".mode-card").count()) === 4 && (await B.page.locator('.play-btn, .done-card').count()) === 1, "„Spielen“ zeigt die Daily und 4 weitere Modi");
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
  for (const t of ["start", "social", "profil"]) {
    // Seiten zeichnen sich nach dem Laden manchmal neu – dann einfach nochmal tippen
    for (let k = 0; k < 4; k++) {
      const ok = await B.page.click(`[data-tab="${t}"]`, { force: true, timeout: 3000 }).then(() => true, () => false);
      if (ok) break;
      await B.page.waitForTimeout(400);
    }
    await B.page.waitForFunction((t) => location.hash === `#/${t === "social" ? "freunde" : t}` || (t === "social" && location.hash === "#/clan"), t);
    await B.page.waitForSelector(`.tab.on[data-tab="${t}"]`);
  }
  await B.page.waitForSelector('[data-pf="logout"]');
  check(true, "Alle Tabs erreichbar (Spielen, Freunde & Clan, Profil)");
  check(!(await B.page.locator('[data-act="settings"]').count()), "Kein extra Einstellungs-Popup mehr");

  // ================= TROPHÄEN =================
  const tP = A.page;
  await tP.goto(`${BASE}?e2e=1`);
  await tP.waitForSelector('.trophy-pill, [data-auth="login"]').catch(async (e) => {
    await tP.screenshot({ path: `${SHOTS}/zz-no-pill.png` });
    console.log("Seite nach goto:", tP.url(), (await tP.evaluate(() => document.body.innerHTML)).slice(0, 400).replace(/\n/g, " "));
    throw e;
  });
  if (await tP.isVisible('[data-auth="login"]')) {
    await tP.click('[data-auth="login"]', { force: true });
    await fillAuth(tP, "lena@test.de", "geheim123");
  }
  await tP.waitForSelector(".trophy-pill").catch(async (e) => {
    await tP.screenshot({ path: `${SHOTS}/zz-no-pill.png` });
    console.log("Kein Trophäen-Knopf:", (await tP.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, " | "));
    throw e;
  });
  await tP.waitForFunction(() => document.getElementById("trophy-count")?.textContent === "0", null, { timeout: 12000 });
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
    // Falls der Test-Bot eine Aufgabe doppelt gezählt hat, ist die Runde schon vorbei
    if (await tP.locator(".tr-rows").count()) break;
    const r = await solveRound(tP, tn).catch(async (e) => {
      if (await tP.locator(".tr-rows").count()) return null;
      throw e;
    });
    if (!r) break;
    tn = r.n;
    seenT.push(r.id);
    if (i === 6) await tP.screenshot({ path: `${SHOTS}/t3-trophy-play.png` });
  }
  check(sawShield && prepChecks.every(Boolean), "Vorbereitungsphase: Tippen während der Orientierung zählt nicht");
  check(new Set(seenT).size >= 14 && new Set(seenT).size === seenT.length, `15 verschiedene Minispiele in der Trophäen-Runde (${seenT.join(", ")})`);
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
  await fB.waitForSelector('[data-tab="social"]');
  await openSocial(fB, "freunde");
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

  // Badge: Lena sieht unten am Freunde-Symbol eine rote 1
  await fB.goto(`${BASE}?e2e=1#/start`);
  await tP.goto(`${BASE}?e2e=1#/start`);
  await tP.reload();
  const badgeIn = await tP.waitForFunction(() => document.querySelector('.tab[data-tab="social"] .tab-badge')?.textContent === "1", null, { timeout: 8000 }).then(() => true, () => false);
  check(badgeIn, "Neue Freundesanfrage → rote 1 am Freunde-Symbol");
  await tP.screenshot({ path: `${SHOTS}/f0-badge.png` });
  await openSocial(tP, "freunde");
  await tP.waitForSelector('[data-accept="Tom"]', { timeout: 5000 });
  check((await tP.locator('.tab[data-tab="social"] .tab-badge').count()) === 0, "Badge verschwindet beim Öffnen des Freunde-Tabs");
  check(true, "Eingehende Anfrage bei Lena sichtbar");
  await tP.screenshot({ path: `${SHOTS}/f2-incoming.png` });
  await tP.click('[data-accept="Tom"]', { force: true });
  await tP.waitForSelector('[data-friend="Tom"]', { timeout: 5000 });
  check(dbVal("select status from public.friendships") === "accepted", "Freundschaft in der Datenbank: accepted");
  await fB.goto(`${BASE}?e2e=1#/start`);
  await fB.reload();
  const badgeAcc = await fB.waitForFunction(() => document.querySelector('.tab[data-tab="social"] .tab-badge')?.textContent === "1", null, { timeout: 8000 }).then(() => true, () => false);
  check(badgeAcc, "Angenommene Anfrage → Badge beim Absender");
  await openSocial(fB, "freunde");
  await fB.waitForSelector('[data-friend="Lena"]', { timeout: 5000 });
  check((await fB.locator('.tab[data-tab="social"] .tab-badge').count()) === 0, "Badge beim Absender weg nach Öffnen");
  check(dbVal("select count(*) from public.profiles where username = 'Tom' and friends_seen_at > now() - interval '1 minute'") === "1", "Gesehen-Zeitpunkt in der Datenbank gespeichert");
  psql("update public.profiles set trophies = 9000, best_trophies = 9000 where username = 'Tom'");
  await tP.goto(`${BASE}?e2e=1#/start`);
  await openSocial(tP, "freunde");
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
  await tP.waitForSelector(".intro.explain .explain-ok");
  check(true, "Minigame startet mit Erklärung und OK-Knopf");
  {
    const okM = await stageCenterOf(tP, ".explain-ok");
    await tP.mouse.click(okM.x, okM.y);
  }
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
  check((await tP.textContent(".mg-result")).includes("Neuer Highscore"), "Erster Lauf = neuer Highscore");
  const resScore = Number((await tP.textContent("#mg-res-score")).replace(/\D/g, ""));
  const dbScore = Number(dbVal("select best_score from public.minigame_bests b join public.profiles p on p.id = b.user_id where p.username = 'Lena' and b.game_id = 'memory'"));
  check(resScore >= 550 && resScore === dbScore, `Punkte: Ergebnis ${resScore} = Datenbank ${dbScore} (4 Stufen, mind. 550)`);
  check((await tP.textContent(".mg-res-rank")).includes("#1"), "Rang in der Spiel-Rangliste wird angezeigt");
  await tP.screenshot({ path: `${SHOTS}/m4-result.png` });

  // Spieler mit besserem Wert steht davor
  psql(`insert into public.minigame_bests (user_id, game_id, best_stage, best_ms, plays, best_score) values ('11111111-2222-3333-4444-555555555555', 'memory', 9, 30000, 3, 5000)`);
  await tP.click('[data-act="mgboard"]', { force: true });
  await tP.waitForSelector(".mrow", { timeout: 5000 });
  const mrows = await tP.$$eval(".mrow", (els) => els.map((e) => ({ name: e.dataset.player, me: e.classList.contains("me") })));
  check(mrows[0]?.name === "Profi" && mrows[1]?.name === "Lena" && mrows[1].me, `Spiel-Rangliste: Profi (5.000 Punkte) vor mir (${mrows.map((r) => r.name).join(", ")})`);
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
  await tP.waitForFunction(() => document.querySelector('.mg-card[data-mg="memory"] .mg-best')?.textContent.includes("Stufe 4") && document.querySelector('.mg-card[data-mg="memory"] .mg-best')?.textContent.includes("🏅"), null, { timeout: 5000 });
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

  // ================= CLANS =================
  await tP.goto(`${BASE}?e2e=1#/clan`);
  await tP.waitForSelector('[data-c="create-open"]', { timeout: 8000 });
  check(true, "Clan-Tab ohne Clan: Gründen und Suchen");
  await tP.screenshot({ path: `${SHOTS}/c1-noclan.png`, fullPage: true });
  await tP.click('[data-c="create-open"]', { force: true });
  await tP.fill("#cf-name", "Blitz Crew");
  await tP.click('.emblem-opt[data-emblem="⚡"]', { force: true });
  check(await tP.isDisabled('.emblem-opt[data-emblem="👑"]'), "Gesperrte Wappen (erst ab höherem Level) sind nicht wählbar");
  await tP.fill("#cf-desc", "Wir sind schnell");
  await tP.screenshot({ path: `${SHOTS}/c2-create.png`, fullPage: true });
  await tP.click("#cf-go", { force: true });
  await tP.waitForSelector("#inv-form", { timeout: 8000 });
  check(dbVal("select emblem || name from public.clans") === "⚡Blitz Crew", "Clan gegründet (Datenbank)");
  check((await tP.textContent(".clan-head")).includes("Level 1"), "Clan-Kopf mit Level");
  await tP.fill("#inv-name", "Tom");
  await tP.click('#inv-form button[type="submit"]', { force: true });
  const invited = await tP.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("eingeladen"), null, { timeout: 5000 }).then(() => true, () => false);
  check(invited && dbVal("select count(*) from public.clan_requests where kind = 'invite'") === "1", "Tom eingeladen");

  // Tom sieht ein Badge am Clan-Tab und nimmt die Einladung an
  await fB.goto(`${BASE}?e2e=1#/start`);
  await fB.reload();
  const clanBadge = await fB.waitForFunction(() => document.querySelector('.tab[data-tab="social"] .tab-badge')?.textContent === "1", null, { timeout: 8000 }).then(() => true, () => false);
  check(clanBadge, "Einladung → Badge am Clan-Tab");
  await openSocial(fB, "clan");
  await fB.waitForSelector('[data-c="inv-yes"]', { timeout: 5000 });
  await fB.click('[data-c="inv-yes"]', { force: true });
  await fB.waitForSelector(".clan-head", { timeout: 8000 });
  check(dbVal("select member_count from public.clans") === "2", "Tom ist im Clan (2 Mitglieder)");
  await fB.screenshot({ path: `${SHOTS}/c3-overview.png`, fullPage: true });
  check((await fB.locator(".chal").count()) === 6, "Sechs Wochen-Challenges mit Fortschritt");

  // Tom spielt ein Minigame → Punkte werden Clan-XP
  await fB.goto(`${BASE}?e2e=1#/minigames/odd`);
  await fB.waitForSelector('[data-act="mgplay"]');
  await fB.click('[data-act="mgplay"]', { force: true });
  {
    let k = 0;
    for (let i = 0; i < 2; i++) k = (await solveRound(fB, k)).n;
    await solveRound(fB, k, true);
  }
  await fB.waitForSelector(".mg-res-clan", { timeout: 10000 });
  const clanXp = Number(dbVal("select xp from public.clans"));
  check(clanXp >= 225 && (await fB.textContent(".mg-res-clan")).includes("XP"), `Minigame-Punkte gehen an den Clan (${clanXp} XP)`);
  await fB.goto(`${BASE}?e2e=1#/clan`);
  await fB.waitForSelector(".league-card", { timeout: 8000 }).then(() => check(true, "Clan-Liga in der Übersicht"), () => check(false, "Clan-Liga in der Übersicht"));
  check((await fB.textContent(".league-card")).includes("pro aktivem Mitglied"), "Liga zählt XP pro aktivem Mitglied");
  await fB.click(".league-card", { force: true });
  await fB.waitForSelector(".league-list .row-item");
  check((await fB.textContent(".league-list")).includes("Blitz Crew"), "Liga-Tabelle zeigt den eigenen Clan");
  await fB.screenshot({ path: `${SHOTS}/c3b-liga.png` });
  await fB.click(".modal [data-close]", { force: true });
  check((await fB.textContent(".chal-list")).includes("10.000 Punkte"), "Challenges passen zur Clan-Größe (kleiner Clan → 10.000 Punkte)");

  // Chat: Filter und Schnellnachricht
  await fB.goto(`${BASE}?e2e=1#/clan/chat`);
  await fB.waitForSelector("#chat-in", { timeout: 8000 });
  await fB.fill("#chat-in", "Hallo du Arschloch");
  await fB.click('#chat-form button[type="submit"]', { force: true });
  const filtered = await fB.waitForFunction(() => [...document.querySelectorAll(".msg.me .msg-body")].some((m) => m.textContent === "Hallo du *********"), null, { timeout: 6000 }).then(() => true, () => false);
  check(filtered, "Chat: Schimpfwort wird ersetzt");
  await fB.waitForTimeout(2200);
  await fB.click('[data-quick="1"]', { force: true });
  const quick = await fB.waitForFunction(() => [...document.querySelectorAll(".msg.me .msg-body")].some((m) => m.textContent === "GG! 🎉"), null, { timeout: 6000 }).then(() => true, () => false);
  check(quick, "Chat: Schnellnachricht");
  await fB.screenshot({ path: `${SHOTS}/c4-chat.png` });

  // Lena: ungelesene Nachrichten als Badge, nach dem Lesen weg; Nachricht melden
  await tP.goto(`${BASE}?e2e=1#/start`);
  await tP.reload();
  const unreadBadge = await tP.waitForFunction(() => Number(document.querySelector('.tab[data-tab="social"] .tab-badge')?.textContent) >= 2, null, { timeout: 8000 }).then(() => true, () => false);
  check(unreadBadge, "Ungelesene Chat-Nachrichten → Badge am Clan-Tab");
  await tP.goto(`${BASE}?e2e=1#/clan/chat`);
  await tP.waitForSelector(".msg[data-msg]", { timeout: 8000 });
  await tP.waitForFunction(() => !document.querySelector('.social-seg [data-seg="clan"] .seg-badge'), null, { timeout: 8000 }).then(() => check(true, "Badge weg nach dem Lesen"), () => check(false, "Badge weg nach dem Lesen"));
  await tP.click(".msg[data-msg]", { force: true });
  await tP.waitForSelector('[data-m="report"]');
  await tP.click('[data-m="report"]', { force: true });
  await tP.waitForFunction(() => document.body.textContent.includes("ausgeblendet"), null, { timeout: 6000 });
  check(dbVal("select count(*) from public.clan_messages where hidden") === "1", "Leiterin meldet → Nachricht ausgeblendet");

  // Clan-Rangliste, Minigame-Rangliste „Clan“, Clan im Profil
  await tP.goto(`${BASE}?e2e=1#/ranglisten/clans/week`);
  await tP.waitForSelector("[data-clan]", { timeout: 8000 });
  check((await tP.textContent("[data-clan]")).includes("Blitz Crew"), "Clan-Rangliste der Woche");
  await tP.screenshot({ path: `${SHOTS}/c5-clanboard.png` });
  await tP.goto(`${BASE}?e2e=1#/minigames/odd`);
  await tP.waitForSelector('[data-scope="clan"]');
  await tP.click('[data-scope="clan"]', { force: true });
  await tP.waitForFunction(() => document.querySelector("#mg-board")?.textContent.includes("Tom"), null, { timeout: 6000 }).then(() => check(true, "Minigame-Rangliste „Clan“ zeigt Clan-Mitglieder"), () => check(false, "Minigame-Rangliste „Clan“ zeigt Clan-Mitglieder"));
  await tP.click('[data-scope="friends"]', { force: true });
  await tP.waitForFunction(() => document.querySelector('#mg-board')?.textContent.length > 0 && !document.querySelector('#mg-board')?.textContent.includes("Lädt"), null, { timeout: 6000 });
  check(true, "Minigame-Rangliste „Freunde“ lädt");
  await tP.click('#mg-board [data-player="Tom"], [data-player="Tom"]', { force: true }).catch(() => {});
  await tP.goto(`${BASE}?e2e=1#/clan/mitglieder`);
  await tP.waitForSelector('[data-player="Tom"]', { timeout: 8000 });
  await tP.click('[data-player="Tom"]', { force: true });
  const pfClan = await tP.waitForSelector(".pf-clan-link", { timeout: 8000 }).then(() => true, () => false);
  check(pfClan && (await tP.textContent(".pf-clan-link")).includes("Blitz Crew"), "Profil zeigt den Clan");
  await tP.screenshot({ path: `${SHOTS}/c6-profile-clan.png` });
  await tP.goto(`${BASE}?e2e=1#/clan/einstellungen`);
  await tP.waitForSelector("#cs-form");
  check(true, "Leiterin sieht die Clan-Einstellungen");
  await tP.screenshot({ path: `${SHOTS}/c7-settings.png`, fullPage: true });

  // Einladungslink
  await tP.goto(`${BASE}?e2e=1#/clan/mitglieder`);
  await tP.waitForSelector('[data-c="link-share"]');
  await tP.click('[data-c="link-share"]', { force: true });
  await tP.waitForFunction(() => document.querySelector("#inv-link-url")?.textContent.includes("?clan="), null, { timeout: 6000 });
  const inviteUrl = (await tP.textContent("#inv-link-url")).trim();
  check(/\?clan=[A-Z2-9]{8}$/.test(inviteUrl), "Einladungslink mit Code");
  const inviteClip = await tP.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  check(inviteClip.includes(inviteUrl), "Link wird zum Teilen kopiert");
  const J = await newPage();
  await J.page.goto(inviteUrl.replace(/^https?:\/\/[^/?#]+\/?/, `${BASE}`).replace("?clan=", "?e2e=1&clan="));
  await J.page.waitForSelector(".duel-card");
  check((await J.page.textContent(".duel-card")).includes("Clan"), "Clan-Link ohne Konto: Hinweis im Startmenü");
  await J.page.click('[data-auth="register"]', { force: true });
  await fillAuth(J.page, "jana@test.de", "geheim123", "geheim123", 18);
  await J.page.waitForSelector(".clan-invite", { timeout: 10000 }).then(() => check(true, "Nach der Registrierung: Einladung in den Clan"), () => check(false, "Nach der Registrierung: Einladung in den Clan"));
  check((await J.page.textContent(".clan-invite")).includes("Blitz Crew"), "Einladung zeigt den richtigen Clan");
  await J.page.screenshot({ path: `${SHOTS}/c8-invite-link.png` });
  await J.ctx.close();

  // ================= LÄNDER =================
  await tP.goto(`${BASE}?e2e=1#/ranglisten/welt`);
  await tP.waitForSelector("[data-country-hint]", { timeout: 8000 });
  check(true, "Hinweis „Wähl dein Land“ in der Rangliste");
  await tP.waitForSelector('.region-chips [data-region="world"].on');
  check(true, "Ohne Land ist „Weltweit“ gewählt");
  await tP.goto(`${BASE}?e2e=1#/einstellungen`);
  await tP.waitForSelector('[data-cs="pick"]', { timeout: 8000 });
  check((await tP.textContent("#country-set")).includes("einmal im Monat"), "Einstellungen erklären: Land einmal im Monat änderbar");
  await tP.click('[data-cs="pick"]', { force: true });
  await tP.fill("#cp-q", "deutsch");
  await tP.click('.country-opt[data-code="DE"]', { force: true });
  await tP.waitForFunction(() => document.querySelector("#country-set")?.textContent.includes("Deutschland"), null, { timeout: 6000 });
  check(dbVal("select country from public.profiles where username = 'Lena'") === "DE", "Land Deutschland gespeichert");
  psql("update public.profiles set country = 'DE' where username = 'Profi'");
  psql("update public.profiles set country = 'NL' where username = 'Tom'");
  psql("update public.profiles set country_changed_at = now() - interval '2 days' where username = 'Lena'");
  await tP.goto(`${BASE}?e2e=1#/start`);
  await tP.goto(`${BASE}?e2e=1#/einstellungen`);
  await tP.reload();
  await tP.waitForFunction(() => document.querySelector("#country-set")?.textContent.includes("Nächste Änderung möglich ab"), null, { timeout: 8000 });
  check(true, "Nach der Wahl steht da, ab wann man wieder ändern kann");
  await tP.screenshot({ path: `${SHOTS}/l1-country-settings.png`, fullPage: true });
  await tP.goto(`${BASE}?e2e=1#/ranglisten/welt`);
  await tP.reload();
  await tP.waitForSelector('.region-chips [data-region="DE"].on', { timeout: 8000 });
  await tP.waitForFunction(() => document.querySelector(".wr-rank span")?.textContent.includes("Deutschland"), null, { timeout: 8000 });
  const deNames = await tP.$$eval("#list [data-player]", (els) => [...new Set(els.map((e) => e.dataset.player))]);
  check(deNames.includes("Lena") && deNames.includes("Profi") && !deNames.includes("Tom"), `Deutschland-Rangliste: nur deutsche Spieler (${deNames.join(", ")})`);
  check((await tP.textContent(".wr-rank")).includes("weltweit"), "Platz im Land und weltweit");
  await tP.screenshot({ path: `${SHOTS}/l2-board-de.png` });
  await tP.click('.region-chips [data-region="NL"]', { force: true });
  await tP.waitForFunction(() => [...document.querySelectorAll("#list [data-player]")].some((e) => e.dataset.player === "Tom"), null, { timeout: 8000 });
  check(true, "Niederlande-Rangliste zeigt Tom");
  await tP.click('.region-chips [data-region="world"]', { force: true });
  await tP.waitForFunction(() => document.querySelector(".wr-rank span")?.textContent.includes("Weltrang"), null, { timeout: 8000 });
  check((await tP.textContent("#list")).includes("🇩🇪"), "Weltrangliste zeigt Flaggen");
  await tP.click('.region-chips [data-region="more"]', { force: true });
  await tP.fill("#cp-q", "frank");
  await tP.click('.country-opt[data-code="FR"]', { force: true });
  await tP.waitForFunction(() => document.querySelector("#list")?.textContent.includes("Frankreich"), null, { timeout: 8000 });
  check(true, "Jedes Land über „Weitere…“ wählbar");
  await tP.goto(`${BASE}?e2e=1#/minigames/memory`);
  await tP.waitForSelector('.mg-region [data-region="DE"]', { timeout: 8000 });
  await tP.click('.mg-region [data-region="DE"]', { force: true });
  await tP.waitForFunction(() => document.querySelector("#mg-board")?.textContent.includes("Deutschland"), null, { timeout: 8000 });
  check((await tP.textContent("#mg-board")).includes("Lena"), "Minigame-Rangliste nach Land");
  await tP.screenshot({ path: `${SHOTS}/l3-minigame-de.png` });

  // ================= RECHTLICHES, MELDEN, ADMIN, KONTO =================
  // Rechtliches ohne Anmeldung
  const L = await newPage();
  await L.page.goto(`${BASE}?e2e=1`);
  await L.page.waitForSelector(".start-legal a");
  await L.page.click('.start-legal a[href="#/rechtliches/impressum"]', { force: true });
  await L.page.waitForSelector(".legal h2");
  check((await L.page.textContent(".legal")).includes("§ 5"), "Impressum ohne Anmeldung erreichbar");
  check((await L.page.locator("mark.ph").count()) > 0, "Platzhalter im Impressum sind markiert");
  await L.page.click('.legal-nav a[href="#/rechtliches/datenschutz"]', { force: true });
  await L.page.waitForFunction(() => document.querySelector(".legal h2")?.textContent.includes("Datenschutz"));
  check((await L.page.textContent(".legal")).includes("Supabase"), "Datenschutzerklärung nennt die Dienste");
  await L.page.screenshot({ path: `${SHOTS}/r1-datenschutz.png`, fullPage: true });
  await L.page.click('[data-act="legal-back"]', { force: true });
  await L.page.waitForSelector('[data-auth="register"]');
  check(true, "Zurück zum Startmenü");

  // Gast-Modus + Einführung
  const G = await newPage({ tour: true });
  await G.page.goto(`${BASE}?e2e=1`);
  await G.page.waitForSelector('[data-auth="guest"]');
  await G.page.click('[data-auth="guest"]', { force: true });
  await G.page.waitForSelector(".tour");
  check(true, "Einführung erscheint beim ersten Öffnen");
  await G.page.screenshot({ path: `${SHOTS}/g0-tour.png` });
  for (let i = 0; i < 4; i++) await G.page.click('[data-tour="next"]', { force: true });
  await G.page.waitForSelector(".tour", { state: "detached" });
  check(await G.page.evaluate(() => localStorage.getItem("zwip:tour") === "1"), "Einführung wird nur einmal gezeigt");
  check(await G.page.locator(".notice.guest").isVisible(), "Gast sieht den Gast-Hinweis");
  check(await G.page.locator('[data-act="daily"]').isVisible(), "Gast kann die Daily spielen");
  await G.page.click('[data-tab="social"]', { force: true });
  await G.page.waitForSelector(".guest-wall");
  check((await G.page.textContent(".guest-wall")).includes("Konto"), "Clans brauchen ein Konto");
  await G.page.goto(`${BASE}?e2e=1#/minigames/memory`);
  await G.page.waitForSelector("#mg-board .guest-wall");
  check(await G.page.locator('[data-act="mgplay"]').count() > 0, "Gast kann Minigames spielen, Rangliste ist gesperrt");
  await G.page.click('[data-tab="profil"]', { force: true });
  await G.page.waitForSelector("#set-vibrate");
  check(true, "Vibration lässt sich in den Einstellungen umschalten");
  check((await G.page.locator("#set-music").isChecked()) && (await G.page.locator("#set-sfx").isChecked()), "Musik und Soundeffekte getrennt schaltbar (Standard: an)");
  check((await G.page.inputValue("#set-vol")) === "50", "Musik-Lautstärke standardmäßig leise (50 %)");
  await G.page.fill("#set-vol", "30");
  await G.page.dispatchEvent("#set-vol", "change");
  await G.page.uncheck("#set-music", { force: true });
  const ms = await G.page.evaluate(() => JSON.parse(localStorage.getItem("zwip:v1") || "{}"));
  check(ms.music === false && Math.abs(ms.musicVol - 0.3) < 0.01, "Musik-Einstellungen werden gespeichert");
  check(await G.page.isDisabled("#set-vol"), "Musik aus → Lautstärke-Regler gesperrt");
  await G.page.check("#set-music", { force: true });
  await G.page.screenshot({ path: `${SHOTS}/g1-gast-profil.png`, fullPage: true });
  await G.page.reload();
  await G.page.waitForSelector(".notice.guest");
  check((await G.page.locator(".tour").count()) === 0, "Gast-Modus bleibt nach Neuladen, ohne erneute Einführung");
  await G.page.click('.guest-wall [data-act="guest-register"], .notice.guest [data-act="guest-register"]', { force: true });
  await G.page.waitForSelector("#auth-age");
  check(true, "„Konto erstellen“ öffnet die Registrierung");
  await G.ctx.close();

  // Bestehendes Konto ohne Zustimmung → Fenster zum Nachholen
  psql("update public.profiles set terms_accepted_at = null, birth_year = null where username = 'Tom'");
  await fB.goto(`${BASE}?e2e=1#/start`);
  await fB.reload();
  await fB.waitForSelector(".terms-gate", { timeout: 8000 });
  check(true, "Fehlende Zustimmung wird beim Start nachgeholt");
  await fB.mouse.click(5, 5);
  check(await fB.isVisible(".terms-gate"), "Das Fenster lässt sich nicht wegtippen");
  await fB.fill(".terms-gate #auth-age", "14");
  await fB.check(".terms-gate #auth-parent", { force: true });
  await fB.check(".terms-gate #auth-terms", { force: true });
  await fB.click('.terms-gate button[type="submit"]', { force: true });
  await fB.waitForSelector(".terms-gate", { state: "detached", timeout: 5000 });
  check(dbVal("select parental_ok::text from public.profiles where username = 'Tom'") === "true", "Unter 16 mit Eltern-Zustimmung gespeichert");

  // Spieler melden
  await tP.goto(`${BASE}?e2e=1#/clan/mitglieder`);
  await tP.waitForSelector('[data-player="Tom"]', { timeout: 8000 });
  await tP.click('[data-player="Tom"]', { force: true });
  await tP.waitForSelector('[data-pp="report"]', { timeout: 8000 });
  await tP.click('[data-pp="report"]', { force: true });
  await tP.check('input[name="rr"][value="name"]', { force: true });
  await tP.fill("#rr-detail", "Testmeldung");
  await tP.click('[data-rr="send"]', { force: true });
  await tP.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Meldung"), null, { timeout: 5000 });
  check(dbVal("select count(*) from public.player_reports where kind = 'name' and detail = 'Testmeldung'") === "1", "Spieler gemeldet");
  await tP.goto(`${BASE}?e2e=1#/start`);

  // Admin (luis.hausner@web.de): Meldung sehen, Tom sperren, wieder entsperren
  const ADM = await newPage();
  await ADM.page.goto(`${BASE}?e2e=1`);
  await ADM.page.click('[data-auth="register"]', { force: true });
  await fillAuth(ADM.page, "luis.hausner@web.de", "admin12345", "admin12345");
  await ADM.page.waitForSelector('[data-act="daily"]', { timeout: 8000 });
  await ADM.page.goto(`${BASE}?e2e=1#/einstellungen`);
  await ADM.page.waitForSelector('a[href="#/admin"]', { timeout: 8000 });
  check(true, "Admin sieht den Moderations-Link im Profil");
  check((await tP.locator('a[href="#/admin"]').count()) === 0, "Normale Spieler sehen keinen Admin-Link");
  await ADM.page.click('a[href="#/admin"]', { force: true });
  await ADM.page.waitForSelector(".adm-card", { timeout: 8000 });
  check((await ADM.page.textContent("#adm-body")).includes("Testmeldung"), "Admin sieht die Meldung");
  await ADM.page.screenshot({ path: `${SHOTS}/r2-admin.png`, fullPage: true });
  await ADM.page.click('.adm-card [data-a="player"][data-name="Tom"]', { force: true });
  await ADM.page.waitForSelector("#adm-reason");
  await ADM.page.fill("#adm-reason", "Test-Sperre");
  await ADM.page.click('[data-p="ban24"]', { force: true });
  await ADM.page.waitForFunction(() => document.querySelector(".modal")?.textContent.includes("Gesperrt bis"), null, { timeout: 5000 });
  check(dbVal("select (banned_until > now())::text from public.profiles where username = 'Tom'") === "true", "Admin sperrt Tom für 24 Stunden");
  await fB.goto(`${BASE}?e2e=1#/clan`);
  await fB.reload();
  await fB.waitForSelector(".notice.ban", { timeout: 8000 });
  check((await fB.textContent(".notice.ban")).includes("Test-Sperre"), "Gesperrter Spieler sieht Sperre und Grund");
  await ADM.page.click('[data-p="unban"]', { force: true });
  await ADM.page.waitForFunction(() => !document.querySelector(".modal")?.textContent.includes("Gesperrt bis"), null, { timeout: 5000 });
  check(dbVal("select coalesce((banned_until > now())::text, 'frei') from public.profiles where username = 'Tom'") === "frei", "Sperre wieder aufgehoben");
  await ADM.page.keyboard.press("Escape").catch(() => {});
  await ADM.page.goto(`${BASE}?e2e=1#/admin/filter`);
  await ADM.page.waitForSelector("#w-in");
  await ADM.page.fill("#w-in", "testwort");
  await ADM.page.click('#w-form button[type="submit"]', { force: true });
  await ADM.page.waitForSelector('[data-w="testwort"]', { timeout: 5000 });
  check(dbVal("select public.zwip_clean_text('ein Testwort hier')") === "ein ******** hier", "Admin fügt Filter-Wort hinzu, es wird sofort gefiltert");

  // Daten herunterladen und Konto löschen (neues Konto)
  const DEL = await newPage();
  await DEL.page.goto(`${BASE}?e2e=1`);
  await DEL.page.click('[data-auth="register"]', { force: true });
  await fillAuth(DEL.page, "weg@test.de", "wegweg123", "wegweg123", 13);
  await DEL.page.waitForSelector('[data-act="daily"]', { timeout: 8000 });
  await DEL.page.goto(`${BASE}?e2e=1#/einstellungen`);
  await DEL.page.waitForSelector('[data-acc="export"]');
  const [dl] = await Promise.all([DEL.page.waitForEvent("download", { timeout: 8000 }), DEL.page.click('[data-acc="export"]', { force: true })]);
  const dlText = fs.readFileSync(await dl.path(), "utf8");
  check(dl.suggestedFilename().startsWith("zwip-meine-daten") && dlText.includes("weg@test.de"), "Eigene Daten als Datei heruntergeladen");
  await DEL.page.click('[data-acc="delete"]', { force: true });
  await DEL.page.waitForSelector("#del-confirm");
  check(await DEL.page.isDisabled("#del-go"), "Löschen erst nach Eintippen von LÖSCHEN möglich");
  await DEL.page.fill("#del-confirm", "löschen");
  await DEL.page.click("#del-go", { force: true });
  await DEL.page.waitForSelector('[data-auth="register"]', { timeout: 8000 });
  check(dbVal("select count(*) from auth.users where email = 'weg@test.de'") === "0" && mock.deleted === 1, "Konto gelöscht, zurück im Startmenü");

  // ================= SCHMALE HANDYS (360 px) =================
  await tP.setViewportSize({ width: 360, height: 740 });
  const overflow = [];
  for (const r of ["start", "spielen", "minigames", "minigames/memory", "ranglisten/welt", "ranglisten/minigames/memory", "ranglisten/crew", "ranglisten/clans", "ranglisten/welt", "clan", "clan/chat", "clan/mitglieder", "clan/einstellungen", "freunde", "profil", "rechtliches/datenschutz", "rechtliches/impressum"]) {
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
  // Ballons: Auch bewegliche Blasen (ab Stufe 6) verschwinden nach dem Antippen wirklich – geprüft bis Stufe 60
  for (const n of [3, 6, 7, 12, 20, 40, 60]) {
    await tP.evaluate((n) => window.__zwip.previewStage("pop", n), n);
    await tP.waitForTimeout(350);
    const pts = await tP.evaluate(() => [...document.querySelectorAll(".e2e-preview .bubble:not(.bad)")].map((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }));
    for (const p of pts) await tP.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest(".bubble");
      el?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    }, p);
    await tP.waitForTimeout(400);
    const visible = await tP.evaluate(() => [...document.querySelectorAll(".e2e-preview .bubble.popped")].filter((b) => Number(getComputedStyle(b).opacity) > 0.05).length);
    const popped = await tP.evaluate(() => document.querySelectorAll(".e2e-preview .bubble.popped").length);
    check(visible === 0 && popped > 0, `Blasen Stufe ${n}: alle ${popped} angetippten sind weg${visible ? ` (${visible} noch sichtbar)` : ""}`);
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
