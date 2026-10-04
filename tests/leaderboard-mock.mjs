// Testet die Online-Bestenliste gegen einen nachgebauten Supabase-REST-Server (PostgREST-Format).
import * as esbuild from "esbuild";
import http from "node:http";
import fs from "node:fs";
import assert from "node:assert/strict";

const rows = [];
const seen = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  seen.push(`${req.method} ${url.pathname}`);
  assert.equal(req.headers.apikey, "test-anon-key");
  assert.equal(req.headers.authorization, "Bearer test-anon-key");
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body);
      if (rows.some((x) => x.day === r.day && x.device_id === r.device_id)) {
        res.writeHead(409).end();
        return;
      }
      rows.push({ ...r, created_at: Date.now() });
      res.writeHead(201).end();
    });
    return;
  }
  const day = Number(url.searchParams.get("day").replace("eq.", ""));
  let list = rows.filter((r) => r.day === day);
  const gt = url.searchParams.get("score");
  if (gt) list = list.filter((r) => r.score > Number(gt.replace("gt.", "")));
  if (req.method === "HEAD") {
    res.writeHead(200, { "Content-Range": `0-0/${list.length}` }).end();
    return;
  }
  list.sort((a, b) => b.score - a.score || a.created_at - b.created_at);
  const fields = url.searchParams.get("select").split(",");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(list.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])))));
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

fs.mkdirSync(".tmp", { recursive: true });
await esbuild.build({
  entryPoints: ["src/leaderboard.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".tmp/leaderboard.mjs",
  logLevel: "warning",
  define: { __ZWIP_CONFIG__: JSON.stringify({ supabaseUrl: base, supabaseAnonKey: "test-anon-key", publicUrl: "" }) },
});
const lb = await import(`../.tmp/leaderboard.mjs?${Date.now()}`);

const mk = (dev, score) => ({ day: 4, name: `P${score}`, deviceId: dev, player: dev.slice(0, 8), score, rounds: Array(10).fill(score / 10) });
assert.equal(await lb.submitScore(mk("aaaaaaaa-1", 700)), true);
assert.equal(await lb.submitScore(mk("bbbbbbbb-2", 900)), true);
assert.equal(await lb.submitScore(mk("cccccccc-3", 500)), true);
assert.equal(await lb.submitScore(mk("aaaaaaaa-1", 999)), true, "Zweiter Versuch: 409 wird als ok gewertet");
const board = await lb.fetchBoard(4);
assert.deepEqual(board.map((r) => r.score), [900, 700, 500], "sortiert, Zweitversuch nicht gezählt");
assert.ok(!("device_id" in board[0]), "Geheime Geräte-ID wird nie abgefragt");
assert.deepEqual(await lb.fetchRank(4, 700), { rank: 2, total: 3 });
assert.deepEqual(await lb.fetchBoard(5), []);
server.close();
console.log("✔ Online-Bestenliste: Eintragen, Doppelt-Schutz, Sortierung, Platzierung –", seen.length, "Requests ok");
