import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, dayIndex, daySeed, dateOfDay } from "../src/rng";
import { buildRounds, endlessRound, roundPoints, tileOf, GAME_IDS, CLASSIC_IDS, WAVE2_IDS, ROUNDS, idsForDay, NEW_GAMES_FROM_DAY, WAVE3_FROM_DAY, WAVE3_IDS, WAVE4_FROM_DAY } from "../src/run";
import { freshState, recordDaily, currentStreak, addCrewResult } from "../src/state";
import { profileLink, avatarHtml, memberSince } from "../src/profileKit";
import { routeParts, tabFor } from "../src/nav";
import { fmtMs } from "../src/minigameUi";
import { encodeChallenge, decodeChallenge, extractChallengeCode, gridText, shareText, buildLink } from "../src/share";

test("gleicher Seed → gleiche Zahlenfolge", () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test("Daily-Nummer: 1. Okt 2026 = #1, Tage zählen weiter", () => {
  assert.equal(dayIndex(new Date(2026, 9, 1, 0, 5)), 1);
  assert.equal(dayIndex(new Date(2026, 9, 1, 23, 59)), 1);
  assert.equal(dayIndex(new Date(2026, 9, 4, 12)), 4);
  assert.equal(dayIndex(new Date(2027, 0, 1, 12)), 93);
  assert.equal(dayIndex(dateOfDay(57)), 57);
});

test("Daily ist für alle gleich und täglich anders", () => {
  const r1 = buildRounds(daySeed(4));
  const r2 = buildRounds(daySeed(4));
  assert.deepEqual(r1, r2);
  assert.notDeepEqual(buildRounds(daySeed(4)), buildRounds(daySeed(5)));
});

test("Runden mit 8 Klassikern: alle dabei, keine direkte Wiederholung", () => {
  for (let s = 0; s < 300; s++) {
    const r = buildRounds(s * 7919, ROUNDS, CLASSIC_IDS);
    assert.equal(r.length, ROUNDS);
    for (const id of CLASSIC_IDS) assert.ok(r.some((x) => x.gameId === id), `fehlt ${id}`);
    for (let i = 1; i < r.length; i++) assert.notEqual(r[i].gameId, r[i - 1].gameId);
    assert.equal(r[0].level, 0);
    assert.equal(r[9].level, 1);
  }
});

test("Endlos: keine direkte Wiederholung, Level steigt", () => {
  let prev: string | null = null;
  for (let i = 0; i < 40; i++) {
    const r = endlessRound(99, i, prev);
    assert.notEqual(r.gameId, prev);
    prev = r.gameId;
  }
  assert.equal(endlessRound(1, 30, null).level, 1);
});

test("Punkte: Fehler = 0, schneller = mehr, Grenzen 30–100", () => {
  assert.equal(roundPoints(false, 100, 3000), 0);
  assert.equal(roundPoints(true, 0, 3000), 100);
  assert.equal(roundPoints(true, 3000, 3000), 30);
  assert.ok(roundPoints(true, 500, 3000) > roundPoints(true, 1500, 3000));
  assert.equal(roundPoints(true, 2000, 3000, 1), 100);
  assert.equal(roundPoints(true, 2000, 3000, 7), 100);
  assert.equal(tileOf(0), "fail");
  assert.equal(tileOf(90), "perfect");
  assert.equal(tileOf(70), "good");
  assert.equal(tileOf(40), "ok");
});

test("Streak: zählt hoch, reißt nach Pause, doppeltes Daily zählt nicht", () => {
  const s = freshState();
  assert.equal(recordDaily(s, 10, { score: 500, rounds: [] }), true);
  assert.equal(recordDaily(s, 10, { score: 900, rounds: [] }), false);
  assert.equal(s.daily[10].score, 500);
  recordDaily(s, 11, { score: 600, rounds: [] });
  recordDaily(s, 12, { score: 700, rounds: [] });
  assert.equal(currentStreak(s, 12), 3);
  assert.equal(currentStreak(s, 13), 3, "heute noch nicht gespielt – Streak lebt noch");
  assert.equal(currentStreak(s, 14), 0, "gestern verpasst – Streak weg");
  recordDaily(s, 15, { score: 100, rounds: [] });
  assert.equal(s.streak.count, 1);
  assert.equal(s.streak.best, 3);
  assert.equal(s.best.daily, 700);
});

test("Duell-Code: hin und zurück, auch mit Umlauten & Emoji", () => {
  const p = { v: 1 as const, n: "Jönas 🔥", i: "ab12cd34", m: "d" as const, d: 4, r: [90, 0, 55, 100, 30, 66, 77, 88, 99, 31] };
  const code = encodeChallenge(p);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeChallenge(code), p);
  const link = buildLink("https://zwip.app/play?x=1#top", code);
  assert.equal(link, `https://zwip.app/play?c=${code}`);
  assert.equal(extractChallengeCode(`Schlag mich: ${link}`), code);
  assert.equal(extractChallengeCode(code), code);
});

test("Duell-Code: Müll und Schummelwerte werden abgelehnt", () => {
  assert.equal(decodeChallenge("nonsense"), null);
  const bad = encodeChallenge({ v: 1, n: "x", i: "y", m: "d", d: 3, r: [101] });
  assert.equal(decodeChallenge(bad), null);
  const noDay = encodeChallenge({ v: 1, n: "x", i: "y", m: "d", r: [10] } as never);
  assert.equal(decodeChallenge(noDay), null);
});

test("Teilen-Text: Emoji-Raster 2×5 und Link", () => {
  const r = [100, 90, 70, 40, 0, 86, 65, 64, 30, 0];
  assert.equal(gridText(r), "🟪🟪🟩🟨🟥\n🟪🟩🟨🟨🟥");
  const t = shareText({ mode: "daily", day: 4, score: 545, rounds: r, streak: 3, link: "https://x.y/?c=abc" });
  assert.ok(t.startsWith("ZWIP Daily 4. Okt. ⚡ 545/1000"), t.split("\n")[0]);
  assert.ok(!/#\d/.test(t.split("\n")[0]), "keine Nummer im Namen");
  assert.ok(t.includes("🔥 3 Tage"));
  assert.ok(t.endsWith("Schlag mich: https://x.y/?c=abc"));
});

test("Crew: Ergebnisse von Freunden werden pro Tag gespeichert", () => {
  const s = freshState();
  addCrewResult(s, "f1", "Mia", 4, { score: 700, rounds: [70] });
  addCrewResult(s, "f1", "Mia K.", 5, { score: 650, rounds: [65] });
  addCrewResult(s, "", "Niemand", 5, { score: 1, rounds: [1] });
  assert.equal(Object.keys(s.crew).length, 1);
  assert.equal(s.crew.f1.name, "Mia K.");
  assert.equal(s.crew.f1.days[4].score, 700);
});

test("Mit allen 27 Challenges: 10 verschiedene pro Runde, alle kommen vor", () => {
  assert.equal(GAME_IDS.length, 27);
  assert.equal(GAMES.length, 27);
  assert.deepEqual(GAMES.map((g) => g.id).sort(), [...GAME_IDS].sort(), "Registry und Spiel-IDs passen zusammen");
  const seen = new Set<string>();
  for (let s = 0; s < 300; s++) {
    const r = buildRounds(s * 104729, ROUNDS, GAME_IDS);
    assert.equal(new Set(r.map((x) => x.gameId)).size, ROUNDS);
    r.forEach((x) => seen.add(x.gameId));
  }
  assert.equal(seen.size, GAME_IDS.length);
  // Trophäen-Modus: 15 Aufgaben aus 27 → kein Spiel doppelt
  for (let s = 0; s < 200; s++) {
    const r = buildRounds(s * 7919 + 1, 15, GAME_IDS);
    assert.equal(new Set(r.map((x) => x.gameId)).size, 15);
  }
});

test("Neue Challenges erst ab ihrer Daily – alte Dailies und Duelle bleiben identisch", () => {
  assert.deepEqual(idsForDay(4), CLASSIC_IDS);
  assert.deepEqual(idsForDay(NEW_GAMES_FROM_DAY), WAVE2_IDS);
  assert.deepEqual(idsForDay(WAVE3_FROM_DAY), WAVE3_IDS);
  assert.equal(WAVE3_IDS.length, 22);
  assert.deepEqual(idsForDay(WAVE4_FROM_DAY), GAME_IDS);
  // Daily #4 muss exakt so aussehen wie vor dem Update (damals Standard = 8 Klassiker)
  const before4 = buildRounds(daySeed(4), ROUNDS, ["odd", "stop", "wait", "more", "pop", "sum", "ink", "swipe"]);
  assert.deepEqual(buildRounds(daySeed(4), ROUNDS, idsForDay(4)), before4);
  // Daily #5 (heute beim Update) bleibt bei den 12 Spielen von gestern
  const before5 = buildRounds(daySeed(5), ROUNDS, ["odd", "stop", "wait", "more", "pop", "sum", "ink", "swipe", "find", "memory", "beat", "pattern"]);
  assert.deepEqual(buildRounds(daySeed(5), ROUNDS, idsForDay(5)), before5);
  assert.ok(buildRounds(daySeed(5), ROUNDS, idsForDay(5)).some((r) => !(CLASSIC_IDS as readonly string[]).includes(r.gameId)));
  // Ab Daily #6 sind die 10 neuen dabei
  const wave3 = ["count", "mole", "spell", "clock", "big", "shape", "order", "newone", "cups", "pair"];
  let seenNew = 0;
  for (let d = WAVE3_FROM_DAY; d < WAVE3_FROM_DAY + 30; d++) seenNew += buildRounds(daySeed(d), ROUNDS, idsForDay(d)).filter((r) => wave3.includes(r.gameId)).length;
  assert.ok(seenNew > 60, `neue Spiele kommen in den Dailies vor (${seenNew})`);
  // Daily #6 bleibt bei den 22 Spielen, ab Daily #7 kommen die 5 der vierten Welle dazu
  const wave4 = ["blocks", "dodge", "stack", "slice", "ampel"];
  assert.ok(!buildRounds(daySeed(6), ROUNDS, idsForDay(6)).some((r) => wave4.includes(r.gameId)));
  let seen4 = 0;
  for (let d = WAVE4_FROM_DAY; d < WAVE4_FROM_DAY + 30; d++) seen4 += buildRounds(daySeed(d), ROUNDS, idsForDay(d)).filter((r) => wave4.includes(r.gameId)).length;
  assert.ok(seen4 > 30, `Spiele der 4. Welle kommen in den Dailies vor (${seen4})`);
});

// ---------- Trophäen ----------
import { scoreRound, leagueFee, leagueFor, milestoneProgress, MILESTONES, clampTrophies, difficultyRange, levelFor, tierFor, formatTrophies, LEAGUES } from "../src/trophies";
import { GAMES } from "../src/games";

const tasks = (ok: number, tier: 0 | 1 | 2, wrong: number) => [
  ...Array.from({ length: ok }, () => ({ game: "odd", ok: true, timeout: false, tier, ms: 500 })),
  ...Array.from({ length: wrong }, () => ({ game: "sum", ok: false, timeout: false, tier: 0 as const, ms: 900 })),
];

test("Trophäen-Berechnung identisch zum Server", () => {
  assert.equal(scoreRound(tasks(15, 2, 0)).raw, 150); // 90 + 30 + 5 + 10 + 15
  assert.equal(scoreRound(tasks(12, 1, 3)).raw, 69); // 72 + 12 + 5 + 10 − 30
  assert.equal(scoreRound(tasks(4, 0, 11)).raw, -86);
  const r = scoreRound(tasks(15, 0, 0));
  assert.deepEqual([r.base, r.speed, r.streakBonus, r.penalty, r.fee, r.bestStreak], [90, 0, 30, 0, 0, 15]);
  assert.equal(r.steps[4].delta, 11, "5. richtige Antwort: +6 und +5 Serienbonus");
});

test("Serie reißt bei Fehler, Zeit abgelaufen kostet −10", () => {
  const t = [...tasks(4, 0, 0), { game: "x", ok: false, timeout: true, tier: 0 as const, ms: 0 }, ...tasks(5, 0, 0)];
  const r = scoreRound(t);
  assert.equal(r.bestStreak, 5);
  assert.equal(r.steps[4].delta, -10);
  assert.equal(r.steps[4].label, "ZEIT UM");
  assert.equal(r.streakBonus, 5);
});

test("Liga-Einsatz: je höher, desto härter – oben nur mit (fast) perfekten Runden", () => {
  assert.deepEqual(
    [0, 1000, 2500, 5000, 8000, 12000, 16000, 20000].map(leagueFee),
    [0, 10, 20, 30, 45, 60, 90, 115],
  );
  // wie in supabase/tests: Gold 9/15 → Minus
  assert.equal(scoreRound(tasks(9, 0, 6), 6000).raw, -31);
  assert.equal(scoreRound(tasks(15, 2, 0), 6000).raw, 120);
  // Unten bringen auch mittelmäßige Runden noch kein großes Minus
  assert.ok(scoreRound(tasks(9, 1, 6), 0).raw >= 0);
  assert.ok(scoreRound(tasks(9, 1, 6), 3000).raw >= -15);
  // Mitte: ab etwa 11–12/15 kein Minus mehr
  assert.ok(scoreRound(tasks(12, 1, 3), 9000).raw > 0);
  assert.ok(scoreRound(tasks(10, 1, 5), 9000).raw < 0);
  // Meister: nur 14/15 oder besser bringt Plus
  assert.equal(scoreRound(tasks(14, 1, 1), 17000).raw, 13);
  assert.equal(scoreRound(tasks(13, 1, 2), 17000).raw, -4);
  // Legende: nur (fast) perfekt und schnell
  assert.ok(scoreRound(tasks(15, 2, 0), 20000).raw > 0);
  assert.ok(scoreRound(tasks(15, 0, 0), 20000).raw > 0);
  assert.ok(scoreRound(tasks(14, 1, 1), 20000).raw < 0);
  assert.ok(scoreRound(tasks(14, 2, 1), 20000).raw > 0, "14/15 sehr schnell reicht knapp");
});

test("Ligen an den richtigen Grenzen", () => {
  const cases: [number, string][] = [[0, "anfaenger"], [999, "anfaenger"], [1000, "bronze"], [2499, "bronze"], [2500, "silber"], [4999, "silber"], [5000, "gold"], [7999, "gold"], [8000, "platin"], [11999, "platin"], [12000, "diamant"], [15999, "diamant"], [16000, "meister"], [19999, "meister"], [20000, "legende"]];
  for (const [t, id] of cases) assert.equal(leagueFor(t).id, id, `${t}`);
  assert.equal(LEAGUES.length, 8);
});

test("Meilensteine 0–5.000 alle 500, dann bis 20.000", () => {
  assert.deepEqual(MILESTONES.slice(0, 11), [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]);
  assert.equal(MILESTONES.at(-1), 20000);
  assert.deepEqual(milestoneProgress(3270), { from: 3000, to: 3500, ratio: 0.54 });
  assert.equal(milestoneProgress(20000).ratio, 1);
  assert.equal(clampTrophies(-50), 0);
  assert.equal(clampTrophies(25000), 20000);
  assert.equal(formatTrophies(2460), "2.460");
});

test("Schwierigkeit steigt mit Trophäen", () => {
  assert.deepEqual(difficultyRange(0), [0, 0.35]);
  assert.deepEqual(difficultyRange(17000), [0.8, 1]);
  assert.ok(levelFor(0, 14) <= levelFor(9000, 14));
  assert.ok(levelFor(9000, 0) < levelFor(9000, 14));
});

test("Speed-Stufen und Registry: jedes Minispiel hat Vorbereitung + Tempo-Grenzen", () => {
  assert.equal(tierFor(200, { veryFast: 300, fast: 600 }), 2);
  assert.equal(tierFor(500, { veryFast: 300, fast: 600 }), 1);
  assert.equal(tierFor(900, { veryFast: 300, fast: 600 }), 0);
  for (const g of GAMES) {
    assert.ok(g.prep >= 0 && g.prep <= 2000, `${g.id}: prep ${g.prep}`);
    assert.ok(g.speed.veryFast < g.speed.fast, `${g.id}: speed`);
  }
  // Spiele mit eigener Reaktionsmechanik bekommen keine Vorbereitungszeit
  for (const id of ["wait", "beat", "memory"]) assert.equal(GAMES.find((g) => g.id === id)!.prep, 0);
});

test("Jedes Spiel hat eine verständliche Erklärung", () => {
  for (const g of GAMES) {
    assert.ok(g.howto.length >= 60, `${g.id}: Erklärung zu kurz`);
    assert.ok(!/[<>]/.test(g.howto), `${g.id}: kein HTML in der Erklärung`);
  }
});

test("Minigame-Stufen: gültig, werden nie leichter und bleiben in sinnvollen Grenzen (Stufe 1–60)", () => {
  for (const g of GAMES) {
    assert.ok(g.progressionText.length >= 3, `${g.id}: mind. 3 Stichpunkte „So wird's schwerer“`);
    const keys = Object.keys(g.monotone);
    assert.ok(keys.length >= 2, `${g.id}: Kennzahlen für die Progression`);
    let prev = g.stage(1);
    for (let n = 1; n <= 60; n++) {
      const p = g.stage(n);
      for (const [k, v] of Object.entries(p)) assert.ok(Number.isFinite(v), `${g.id}@${n}: ${k} = ${v}`);
      for (const k of keys) {
        const dir = g.monotone[k];
        assert.ok(dir === 1 ? p[k] >= prev[k] : p[k] <= prev[k], `${g.id}@${n}: ${k} wird leichter (${prev[k]} → ${p[k]})`);
      }
      prev = p;
    }
    // Stufe 1 ist wirklich leichter als Stufe 25 (irgendetwas ändert sich)
    const a = g.stage(1),
      b = g.stage(25);
    assert.ok(keys.some((k) => a[k] !== b[k]), `${g.id}: Stufe 25 ist schwerer als Stufe 1`);
  }
});

test("Minigame-Stufen: konkrete Vorgaben", () => {
  const G = Object.fromEntries(GAMES.map((g) => [g.id, g]));
  // Memory wie vorgegeben
  assert.deepEqual(G.memory.stage(1), { side: 3, length: 3, on: 600, gap: 200 });
  assert.equal(G.memory.stage(4).side, 3);
  assert.equal(G.memory.stage(5).side, 4);
  assert.equal(G.memory.stage(10).side, 5);
  assert.equal(G.memory.stage(5).length, 7);
  assert.equal(G.memory.stage(60).on, 300);
  assert.equal(G.memory.stage(60).gap, 120);
  // Grenzen, damit es nie unmöglich wird
  assert.equal(G.odd.stage(200).side, 8);
  assert.equal(G.odd.stage(200).diff, 4);
  assert.equal(G.wait.stage(200).maxReaction, 380);
  assert.equal(G.wait.stage(5).fakes, 0);
  assert.ok(G.wait.stage(6).fakes >= 1);
  assert.equal(G.stop.stage(7).reverse, 0);
  assert.equal(G.stop.stage(8).reverse, 1);
  assert.equal(G.stop.stage(12).jump, 1);
  assert.equal(G.stop.stage(200).width, 7);
  assert.equal(G.more.stage(13).fields, 2);
  assert.equal(G.more.stage(14).fields, 3);
  assert.equal(G.more.stage(200).diffPct, 6);
  assert.equal(G.pop.stage(1).bubbles, 4);
  assert.equal(G.pop.stage(200).bubbles, 16);
  assert.equal(G.pop.stage(10).red, 0);
  assert.equal(G.pop.stage(11).red, 1);
  assert.deepEqual([4, 5, 9, 13].map((n) => G.sum.stage(n).tier), [1, 2, 3, 4]);
  assert.equal(G.ink.stage(200).colors, 6);
  assert.equal(G.ink.stage(200).limit, 1800);
  assert.deepEqual([1, 7, 8, 14].map((n) => G.swipe.stage(n).arrows), [1, 1, 2, 3]);
  assert.equal(G.swipe.stage(200).msPerArrow, 1100);
  assert.equal(G.find.stage(200).count, 48);
  assert.equal(G.beat.stage(200).bpm, 180);
  assert.equal(G.beat.stage(200).window, 70);
  assert.equal(G.beat.stage(10).lead, 4);
  assert.deepEqual([1, 4, 9].map((n) => G.pattern.stage(n).period), [2, 3, 4]);
  assert.equal(G.pattern.stage(12).options, 4);
  // Ungültige Eingaben werden zu Stufe 1
  assert.deepEqual(G.odd.stage(0), G.odd.stage(1));
  assert.deepEqual(G.odd.stage(Number.NaN), G.odd.stage(1));
});

test("Navigation: Routen und Tabs", () => {
  assert.deepEqual(routeParts(""), ["start"]);
  assert.deepEqual(routeParts("#/minigames/memory"), ["minigames", "memory"]);
  assert.deepEqual(routeParts("#minigames"), ["minigames"]);
  assert.equal(tabFor(["minigames", "odd"]), "start");
  assert.equal(tabFor(["spielen"]), "start");
  assert.equal(tabFor(["freunde"]), "social");
  assert.equal(tabFor(["einstellungen"]), "profil");
  assert.equal(tabFor(["ranglisten", "welt"]), "ranglisten");
  assert.equal(tabFor(["pfad"]), null);
  assert.equal(tabFor(["quatsch"]), "start");
});

test("Minigame-Zeitformat", () => {
  assert.equal(fmtMs(12345), "12,3 s");
  assert.equal(fmtMs(0), "0,0 s");
});

test("Profil-Link und Profilbild-Anzeige", () => {
  (globalThis as unknown as { window: unknown }).window = { location: { protocol: "https:", href: "https://zwip.app/?c=abc#x" } };
  assert.equal(profileLink("Lena_1"), "https://zwip.app/?p=Lena_1");
  assert.match(avatarHtml("lena", null), />L</);
  const img = "data:image/jpeg;base64,AAAA";
  assert.match(avatarHtml("lena", img), /<img src="data:image\/jpeg;base64,AAAA"/);
  // Alles, was kein echtes Bild ist, wird nicht als Bild eingebaut
  assert.doesNotMatch(avatarHtml("x", 'data:image/jpeg;base64,AA"><script>'), /<img/);
  assert.doesNotMatch(avatarHtml("x", "https://evil.example/a.png"), /<img/);
  assert.equal(memberSince("2026-10-05T10:00:00Z"), "Dabei seit Oktober 2026");
  assert.equal(memberSince(undefined), "");
});

// ---------- Highscores & Clans ----------
import { readFileSync } from "node:fs";
import { stagePoints, runScore, scoreFromStage, stageBase } from "../src/score";
import { EMBLEMS, COLORS, FRAMES, QUICK_MESSAGES, clanLevel, levelXp, nextRewards } from "../src/clanKit";

const clansSql = readFileSync(new URL("../supabase/clans.sql", import.meta.url), "utf8");

test("Minigame-Punkte: gleiche Formel wie der Server", () => {
  const sp = { veryFast: 900, fast: 1700 };
  assert.equal(stageBase(1), 100);
  assert.equal(stageBase(10), 325);
  assert.equal(stagePoints(1, 5000, sp), 100);
  assert.equal(stagePoints(1, 1700, sp), 125);
  assert.equal(stagePoints(2, 900, sp), 188); // 125 · 1,5 = 187,5 → 188 (wie round() in Postgres)
  assert.equal(runScore([{ ok: true, t: 2000 }, { ok: true, t: 2000 }, { ok: false, t: 100 }], sp), 225);
  assert.equal(scoreFromStage(4), 550);
  assert.equal(scoreFromStage(0), 0);
  // Mehr Stufen geben immer mehr Punkte, auch ohne Bonus
  for (let n = 1; n < 60; n++) assert.ok(scoreFromStage(n + 1) > scoreFromStage(n));
});

test("Tempo-Grenzen in der Datenbank passen zu den Spielen", () => {
  for (const g of GAMES) {
    const m = clansSql.match(new RegExp(`when '${g.id}' then array\\[(\\d+), (\\d+)\\]`));
    assert.ok(m, `${g.id} fehlt in zwip_minigame_speed`);
    assert.equal(Number(m![1]), g.speed.veryFast, `${g.id} sehr schnell`);
    assert.equal(Number(m![2]), g.speed.fast, `${g.id} schnell`);
  }
  const minigamesSql = readFileSync(new URL("../supabase/minigames.sql", import.meta.url), "utf8");
  for (const g of GAMES) assert.match(minigamesSql, new RegExp(`when '${g.id}'\\s+then \\d+`), `${g.id} fehlt in zwip_minigame_min_ms`);
});

test("Clan-Freischaltungen und Schnellnachrichten passen zur Datenbank", () => {
  const block = (kind: string) => clansSql.slice(clansSql.indexOf(`when '${kind}' then case`), clansSql.indexOf("else null end", clansSql.indexOf(`when '${kind}' then case`)));
  for (const x of EMBLEMS) assert.match(block("emblem"), new RegExp(`'${x.e}'[^\\n]*then ${x.lvl}\\b`), `Emblem ${x.e}`);
  for (const x of COLORS) assert.match(block("color"), new RegExp(`'${x.c}'[^\\n]*then ${x.lvl}\\b`), `Farbe ${x.c}`);
  for (const x of FRAMES) assert.match(block("frame"), new RegExp(`'${x.f}' then ${x.lvl}\\b`), `Rahmen ${x.f}`);
  assert.equal(QUICK_MESSAGES.length, 7);
  for (const q of QUICK_MESSAGES) assert.ok(clansSql.includes(`'${q}'`), `Schnellnachricht ${q}`);
  assert.equal(clanLevel(0), 1);
  assert.equal(clanLevel(999), 1);
  assert.equal(clanLevel(1000), 2);
  assert.equal(clanLevel(16000), 5);
  assert.equal(clanLevel(1e12), 50);
  assert.equal(levelXp(5), 16000);
  assert.deepEqual(nextRewards(1, 1)[0].level, 2);
});

test("Clan liegt im Tab „Freunde & Clan“", () => {
  assert.equal(tabFor(["clan", "chat"]), "social");
  assert.equal(tabFor(["clan", "c", "abc"]), "social");
});

// ---------- Länder ----------
import { flag, countryName, allCountries, searchCountries, isCountry, COUNTRY_COUNT, POPULAR } from "../src/countries";

test("Länder: Flaggen, deutsche Namen, Suche", () => {
  assert.equal(flag("DE"), "🇩🇪");
  assert.equal(flag("NL"), "🇳🇱");
  assert.equal(flag("xx1"), "");
  assert.equal(countryName("DE"), "Deutschland");
  assert.equal(countryName("NL"), "Niederlande");
  assert.ok(COUNTRY_COUNT >= 240, `alle Länder (${COUNTRY_COUNT})`);
  const all = allCountries();
  assert.deepEqual(all.slice(0, POPULAR.length).map((c) => c.code), POPULAR, "Beliebte Länder zuerst");
  assert.equal(new Set(all.map((c) => c.code)).size, all.length, "keine doppelten Länder");
  assert.equal(searchCountries("osterreich")[0].code, "AT", "Suche ohne Umlaute");
  assert.equal(searchCountries("nl")[0].code, "NL", "Suche nach Code");
  assert.ok(isCountry("TR") && !isCountry("ZZ") && !isCountry(null));
});

// ---------- Season Pass & Shop (passKit) ----------
import { euro, num, gemsInEuro, levelOf, timeLeft, safeColor, safeEmoji, emojiList, itemIcon, nameStyle, rewardInner } from "../src/passKit";

test("Euro-Preise werden deutsch angezeigt", () => {
  assert.equal(euro(499).replace(/\s/g, " "), "4,99 €");
  assert.equal(euro(99).replace(/\s/g, " "), "0,99 €");
  assert.equal(num(1100), "1.100");
});

test("Gems zeigen immer ungefähr den Euro-Wert", () => {
  assert.equal(gemsInEuro(500).replace(/\s/g, " "), "4,99 €");
  assert.equal(gemsInEuro(50).replace(/\s/g, " "), "0,50 €");
  assert.equal(gemsInEuro(100, [{ id: "gems_m", gems: 1000, price_cents: 999 }]).replace(/\s/g, " "), "1,00 €");
});

test("Stufe aus XP: 0 bis 40, nie mehr", () => {
  assert.equal(levelOf(0, 1500, 40), 0);
  assert.equal(levelOf(1499, 1500, 40), 0);
  assert.equal(levelOf(1500, 1500, 40), 1);
  assert.equal(levelOf(1500 * 39 + 1, 1500, 40), 39);
  assert.equal(levelOf(10_000_000, 1500, 40), 40);
});

test("Restzeit-Text", () => {
  const now = Date.UTC(2026, 9, 7, 12, 0);
  assert.equal(timeLeft(new Date(now + 3 * 86400000 + 4 * 3600000).toISOString(), now), "noch 3 T 4 Std");
  assert.equal(timeLeft(new Date(now + 5 * 3600000 + 12 * 60000).toISOString(), now), "noch 5 Std 12 Min");
  assert.equal(timeLeft(new Date(now - 1000).toISOString(), now), "endet gleich");
});

test("Item-Daten können kein HTML/CSS einschleusen", () => {
  assert.equal(safeColor("#12abEF"), "#12abEF");
  assert.equal(safeColor("red;background:url(x)"), "#a45cff");
  assert.equal(safeEmoji("🔥"), "🔥");
  assert.equal(safeEmoji("<img src=x>"), "✨");
  assert.deepEqual(emojiList(["⭐", "<b>", "✨"]), ["⭐", "✨"]);
  const html = itemIcon({ id: "x", kind: "skin", name: "x", rarity: "rare", data: { a: "#000000;}</style>", b: "#ffffff" } });
  assert.ok(!html.includes("</style>"));
  assert.ok(!nameStyle({ id: "n", kind: "namecolor", name: "n", rarity: "rare", data: { c1: "url(javascript:x)" } }).includes("url("));
});

test("Belohnung ohne Item zeigt Coins oder Gems", () => {
  assert.match(rewardInner({ item: null, coins: 75, gems: 0 }).label, /75 Coins/);
  assert.match(rewardInner({ item: null, coins: 0, gems: 20 }).label, /20 Gems/);
  assert.match(rewardInner({ item: { id: "a", kind: "avatar", name: "Fuchs <3", rarity: "common", data: { e: "🦊" } }, coins: 0, gems: 0 }).label, /Fuchs &lt;3/);
});
