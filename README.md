# ⚡ ZWIP

**10 Blitz-Challenges. 30 Sekunden. Jeden Tag neu. Für alle gleich.**

ZWIP ist ein Mobile-first Web-Game für Jugendliche und junge Erwachsene. App öffnen, einmal tippen, spielen. Kein Login, keine Installation, keine Werbung, keine Lootboxen.

## Was man macht

Eine Runde besteht aus 10 Mini-Challenges, die jeweils nur 1–3 Sekunden dauern:

| | Challenge | Was zu tun ist |
|---|---|---|
| 👁️ | Finde den Anderen | Ein Feld hat eine minimal andere Farbe – tippen |
| 🎯 | Stopp im Feld | Tippen, wenn der Strich im grünen Feld ist |
| 🚦 | Warte auf Grün | Erst bei Grün tippen – zu früh = raus |
| ⚖️ | Wo sind mehr? | Die Seite mit mehr Punkten tippen |
| 🫧 | Alle zerplatzen | Alle Blasen wegtippen |
| 🧮 | Stimmt das? | Rechnung prüfen: ✓ oder ✗ |
| 🎨 | Farbe, nicht Wort! | Die Schriftfarbe tippen, nicht das Wort |
| 👉 | Wisch den Pfeil | In Pfeilrichtung wischen – oder genau andersrum |

Schnell und richtig gibt bis zu 100 Punkte pro Challenge, maximal 1000. Die Schwierigkeit steigt innerhalb der Runde.

### Spielmodi

- **Daily** – jeden Tag eine neue Runde, für alle exakt gleich (gleiche Reihenfolge, gleiche Felder, gleiche Wartezeiten). Nur der erste Versuch zählt.
- **Training** – unbegrenzt, jedes Mal zufällig.
- **Endlos** – so lange, bis der erste Fehler passiert.
- **Duell** – per Link: Die andere Person spielt genau deine Runde, danach gibt es den Vergleich Challenge für Challenge.

### Social-Funktionen

- **Teilen** als Emoji-Raster (perfekt für WhatsApp-Gruppen und Kommentare):
  ```
  ZWIP #4 ⚡ 812/1000
  🟪🟩🟩🟥🟪
  🟨🟪🟩🟩🟪
  🔥 5 Tage am Stück
  Schlag mich: https://…
  ```
- **Story-Bild** 1080×1920 für TikTok und Instagram Stories
- **Duell-Links** – funktionieren ganz ohne Server, das Ergebnis steckt im Link
- **Crew-Bestenliste** – alle, deren Duell-Links du gespielt hast
- **Weltweite Tages-Bestenliste** – optional über Supabase (Free Tier)
- **Streaks** und Wochenübersicht

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm run dev
```

Dann <http://localhost:5173> öffnen. Zum Testen auf dem Handy: Handy ins selbe WLAN, dann `http://<IP-deines-Rechners>:5173` aufrufen.

## Befehle

| Befehl | Was passiert |
|---|---|
| `npm run dev` | Lokaler Server mit automatischem Neu-Bauen |
| `npm run build` | Fertige App nach `dist/` (zum Hochladen) |
| `npm run build:single` | Die ganze App in **einer** HTML-Datei (`dist-single/index.html`) |
| `npm test` | Typprüfung, Logik-Tests, Bestenlisten-Test |
| `npm run test:e2e` | Echter Browser-Test auf Handy-Größe: spielt eine Daily, Duell, Endlos, Teilen (vorher einmal `npx playwright install chromium`) |

## Technik

Bewusst schlank, damit die App in unter einer Sekunde startet (~55 KB insgesamt):

- TypeScript ohne Framework, gebündelt mit esbuild
- Sounds werden live per Web Audio erzeugt (keine Audiodateien)
- Animationen per CSS, Konfetti per Canvas
- Spielstand im `localStorage` des Geräts
- Tägliche Runde aus einem Seed (`zwip-daily-<Tag>`) → für alle gleich, ohne Server
- Installierbar als Web-App (PWA) mit Offline-Cache
- Optional: Supabase (Postgres) für die weltweite Bestenliste, abgesichert über Row Level Security

```
src/
  main.ts         Screens, Spielablauf, Teilen, Bestenliste
  games.ts        Die 8 Mini-Challenges
  run.ts          Rundenaufbau, Punkte, Bewertung
  rng.ts          Seed-Zufall, Daily-Nummer
  state.ts        Spielstand, Streaks, Crew
  share.ts        Teilen-Text, Duell-Links, Story-Bild
  leaderboard.ts  Supabase-Anbindung
  sound.ts        Sounds
  fx.ts           Konfetti & Effekte
  style.css       Design
supabase/schema.sql   Datenbank für die Online-Bestenliste
tests/                Logik-, Bestenlisten- und Browser-Tests
```

### Neue Challenge hinzufügen

In `src/games.ts` ein neues `MicroGame`-Objekt anlegen, in `GAMES` eintragen und die ID in `GAME_IDS` (`src/run.ts`) ergänzen. Fertig – die Challenge taucht automatisch in Daily, Training und Endlos auf.

## Deployment

Siehe [DEPLOYMENT.md](DEPLOYMENT.md). Kurzfassung: `npm run build` und den Ordner `dist/` bei Cloudflare Pages, Netlify, Vercel oder GitHub Pages hochladen – alles kostenlos.

## Konzept & Marktanalyse

Siehe [docs/KONZEPT.md](docs/KONZEPT.md).
