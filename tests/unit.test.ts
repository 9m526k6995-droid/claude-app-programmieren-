import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRng, dayIndex, daySeed, dateOfDay } from "../src/rng";
import { buildRounds, endlessRound, roundPoints, tileOf, GAME_IDS, CLASSIC_IDS, ROUNDS, idsForDay, NEW_GAMES_FROM_DAY } from "../src/run";
import { freshState, recordDaily, currentStreak, addCrewResult } from "../src/state";
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
  assert.ok(t.startsWith("ZWIP #4 ⚡ 545/1000"));
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

test("Mit allen 12 Challenges: 10 verschiedene pro Runde, neue kommen vor", () => {
  const seen = new Set<string>();
  for (let s = 0; s < 300; s++) {
    const r = buildRounds(s * 104729, ROUNDS, GAME_IDS);
    assert.equal(new Set(r.map((x) => x.gameId)).size, ROUNDS);
    r.forEach((x) => seen.add(x.gameId));
  }
  assert.equal(seen.size, GAME_IDS.length);
});

test("Neue Challenges erst ab Daily #5 – alte Dailies und Duelle bleiben identisch", () => {
  assert.deepEqual(idsForDay(4), CLASSIC_IDS);
  assert.deepEqual(idsForDay(NEW_GAMES_FROM_DAY), GAME_IDS);
  // Daily #4 muss exakt so aussehen wie vor dem Update (damals Standard = 8 Klassiker)
  const before = buildRounds(daySeed(4), ROUNDS, ["odd", "stop", "wait", "more", "pop", "sum", "ink", "swipe"]);
  assert.deepEqual(buildRounds(daySeed(4), ROUNDS, idsForDay(4)), before);
  assert.ok(buildRounds(daySeed(5), ROUNDS, idsForDay(5)).some((r) => !(CLASSIC_IDS as readonly string[]).includes(r.gameId)));
});
