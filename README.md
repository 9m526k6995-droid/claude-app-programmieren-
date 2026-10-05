# ⚡ ZWIP

**10 Blitz-Challenges. Jeden Tag neu. Für alle gleich. Plus 12 Minigames mit eigenen Ranglisten.**

ZWIP ist ein Mobile-first Web-Game für Jugendliche und junge Erwachsene. Kostenlos anmelden, einmal tippen, spielen. Keine Installation, keine Werbung, keine Lootboxen.

## Was man macht

Eine Runde besteht aus 10 Mini-Challenges, die jeweils nur ein paar Sekunden dauern:

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
| 🔍 | Wo ist es? | Das gesuchte Emoji im Gewimmel finden |
| 🧠 | Merk dir's! | Aufleuchtende Felder in der gleichen Reihenfolge nachtippen |
| 🥁 | Im Takt! | Drei Schläge hören, den vierten genau im Takt tippen |
| 🧩 | Was kommt dann? | Ein Muster aus Symbolen fortsetzen |

Die letzten vier sind ab Daily #5 dabei (im Training und Endlos-Modus sofort). Jede Runde zieht 10 verschiedene Challenges.

Schnell und richtig gibt bis zu 100 Punkte pro Challenge, maximal 1000. Die Schwierigkeit steigt innerhalb der Runde.

Vor **jeder Aufgabe** zeigt eine Erklärkarte 4 Sekunden lang, was zu tun ist (Emoji, Titel, ausführliche Erklärung, Countdown). Sie lässt sich nicht wegtippen, ✕ bricht sofort ab.

### Aufbau der App

Unten sitzt eine Leiste mit fünf Bereichen. Jeder Bildschirm hat eine eigene Adresse (`#/…`), dadurch funktioniert der Zurück-Knopf am Handy und nach dem Neuladen bleibt man, wo man war.

| Tab | Inhalt |
|---|---|
| 🏠 Start (`#/start`) | Daily spielen bzw. Ergebnis mit Teilen/Duell/Countdown, Duell-Einladung, Wochen-Streak |
| 🎮 Spielen (`#/spielen`) | Alle Modi: Daily, Trophäen-Modus, **Minigames** (`#/minigames`), Training, Endlos |
| 🏆 Ranglisten (`#/ranglisten/…`) | Trophäen (Welt), Minigames (pro Spiel), Crew (Daily) |
| 👥 Freunde (`#/freunde`) | Spieler suchen, Anfragen, Freundesliste |
| 👤 Profil (`#/profil`) | Profilbild, Werte, Profil-Link, Konto (Name, E-Mail, Passwort, Abmelden), Einstellungen |

Oben rechts auf jeder Seite öffnet die **Flamme** den Trophäenpfad (`#/pfad`). Während einer Runde ist die Leiste ausgeblendet.

### Minigames – jedes Spiel einzeln

Unter **Spielen → Minigames** gibt es alle 12 Spiele einzeln. Jedes hat eine Detailseite (Erklärung, „So wird's schwerer“, Bestleistung, Rang, Rangliste) und eine **eigene Rangliste**.

- Ein Lauf geht Stufe für Stufe. Jede Stufe wird schwerer. Ein Fehler oder Zeit um = Lauf vorbei.
- Kein langes Erklären: nur eine kurze Startkarte „3 · 2 · 1“.
- Gewertet wird die **geschaffte Stufe**, bei Gleichstand die kürzere Spielzeit, danach wer es früher geschafft hat.
- Der Server vergibt den Zufalls-Seed und prüft, ob das Ergebnis realistisch ist (`supabase/minigames.sql`).

| Spiel | So wird's schwerer |
|---|---|
| 🧠 Merk dir's! | Stufe 1: 3 Felder im 3×3-Feld, jede Stufe +1 Feld; ab Stufe 5 4×4, ab Stufe 10 5×5; Leuchtdauer 600 → 300 ms, ab Stufe 15 kürzere Pausen |
| 👁️ Finde den Anderen | Raster 3×3 → 8×8 (alle 3 Stufen größer), Farbunterschied 24 % → 4 %, Zeit 3,8 → 2,5 s |
| 🎯 Stopp im Feld | Strich 6 % schneller pro Stufe, Feld 22 % → 7 % breit, ab Stufe 8 Richtungswechsel, ab 12 springt das Feld |
| 🚦 Warte auf Grün | Reaktions-Grenze 0,70 → 0,38 s, Wartezeit 1–4 s, ab Stufe 6 gelbe Fake-Signale (immer mehr) |
| ⚖️ Wo sind mehr? | Unterschied 40 % → 6 %, mehr Punkte, ab Stufe 8 verschiedene Größen, ab 14 drei Felder |
| 🫧 Alle zerplatzen | 4 → 16 Blasen, weniger Zeit pro Blase, ab Stufe 6 bewegen sie sich, ab 11 rote Blasen (nicht antippen) |
| 🧮 Stimmt das? | Plus (1–4), Plus/Minus bis 50 (5–8), Mal (9–12), zwei Rechenschritte (ab 13); falsche Ergebnisse immer knapper |
| 🎨 Farbe, nicht Wort! | 3 → 6 Farben, Zeit 3,4 → 1,8 s, ab Stufe 10 wechseln die Knöpfe den Platz |
| 👉 Wisch den Pfeil | ab Stufe 3 GEGENTEIL!, ab 8 zwei Pfeile, ab 14 drei; Zeit pro Pfeil 2,9 → 1,1 s |
| 🔍 Wo ist es? | 12 → 48 Emojis, ab Stufe 7 zum Verwechseln ähnlich, Zeit 4,2 → 3 s |
| 🥁 Im Takt! | 90 → 180 BPM, Toleranz 180 → 70 ms, ab Stufe 10 vier Vorgabe-Schläge |
| 🧩 Was kommt dann? | Muster 2 → 3 (ab Stufe 4) → 4 Teile (ab 9), mehr Symbole, ab 12 vier Antworten, Zeit 4,2 → 2,8 s |

Alle Werte stehen in `src/games.ts` (`stage(n)` pro Spiel) und werden in den Tests für die Stufen 1–60 geprüft: Es wird nie leichter, und es gibt feste Grenzen, damit es nie unmöglich wird.

### Anmeldung

Beim Öffnen erscheint ein Startmenü mit **Anmelden** und **Registrieren** (E-Mail + Passwort, echte Authentifizierung über Supabase Auth). Das Spiel ist erst nach der Anmeldung erreichbar. Die Sitzung bleibt nach dem Neuladen erhalten und wird automatisch erneuert. Abmelden geht über den Tab **Profil** → **Abmelden**.

### Trophäen, Weltrangliste und Freunde

- **Flamme oben rechts** zeigt den Trophäenstand (z. B. 🔥 2.460) und öffnet den **Trophäenpfad**: ein geschwungener Pfad von 0 bis 20.000 mit Meilensteinen und 8 Ligen (Anfänger, Bronze, Silber, Gold, Platin, Diamant, Meister, Legende).
- **Trophäen-Modus**: 15 Aufgaben aus allen Minispielen. Richtig +10, schnell +2, sehr schnell +3, falsch oder Zeit um −8, Serienbonus bei 5/10/15 richtigen am Stück. Schwierigkeit steigt mit dem Trophäenstand.
- **Weltrangliste** (Ranglisten → „Trophäen (Welt)“): ausschließlich nach Trophäen absteigend, Top 100, eigener Rang und Nachbarn.
- **Freunde**: Spieler über den Namen suchen, Anfragen senden/annehmen/ablehnen, Freunde ansehen und entfernen.
- Die Trophäen rechnet der **Server** aus (Supabase-Funktionen in `supabase/trophies.sql`), nicht das Handy.
- Jede Aufgabe hat eine kurze **Orientierungsphase** (0,9–1,8 s), in der die Zeit noch nicht läuft.

### Profil

Der Tab **Profil** zeigt das eigene Profil:

- **Profilbild** aus der eigenen Foto-Mediathek (oder Kamera). Die App schneidet es quadratisch zu und verkleinert es auf ein kleines JPEG (meist unter 30 KB).
- **Statistiken**: Trophäen, Weltrang, Höchststand, beste Serie, „Dabei seit“.
- **Profil-Link** (z. B. `https://zwip.app/?p=Lena`) zum Senden über WhatsApp & Co. oder zum Kopieren. Wer den Link öffnet, sieht nach der Anmeldung das Profil und kann direkt eine Freundschaftsanfrage schicken.
- **Konto**: Spielername ändern, **E-Mail ändern** (mit Bestätigungs-Link an die neue Adresse), **Passwort ändern** (beides mit Abfrage des Passworts), Abmelden.
- Profile anderer Spieler (aus Rangliste und Freundesliste) zeigen ebenfalls Profilbild und einen Teilen-Knopf. Die E-Mail-Adresse ist nie öffentlich.

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

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20 und ein kostenloses Supabase-Projekt (Einrichtung siehe [DEPLOYMENT.md](DEPLOYMENT.md#supabase-einrichten-anmeldung--bestenliste)).

```bash
npm install
cp .env.example .env   # Supabase-URL und publishable Key eintragen
npm run dev
```

Dann <http://localhost:5173> öffnen. Zum Testen auf dem Handy: Handy ins selbe WLAN, dann `http://<IP-deines-Rechners>:5173` aufrufen.

## Befehle

| Befehl | Was passiert |
|---|---|
| `npm run dev` | Lokaler Server mit automatischem Neu-Bauen |
| `npm run build` | Fertige App nach `dist/` (zum Hochladen) |
| `npm run build:single` | Die ganze App in **einer** HTML-Datei (`dist-single/index.html`) |
| `npm test` | Typprüfung und Logik-Tests |
| `npm run test:sql` | Datenbank-Tests gegen echte Postgres (`ZWIP_TEST_PG` setzen) |
| `npm run test:e2e` | Echter Browser-Test (braucht Postgres über `ZWIP_TEST_PG`) auf Handy-Größe gegen einen nachgebauten Supabase-Auth-Server: Startmenü, Registrierung, Login, Fehlerfälle, Sitzung, Logout, dann Daily, Duell, Endlos, Teilen (vorher einmal `npx playwright install chromium`) |

## Technik

Bewusst schlank, damit die App in unter einer Sekunde startet (~55 KB insgesamt):

- TypeScript ohne Framework, gebündelt mit esbuild
- Sounds werden live per Web Audio erzeugt (keine Audiodateien)
- Animationen per CSS, Konfetti per Canvas
- Anmeldung über Supabase Auth (E-Mail + Passwort), direkt über die Auth-REST-API ohne Zusatzpaket
- Spielstand im `localStorage` des Geräts
- Tägliche Runde aus einem Seed (`zwip-daily-<Tag>`) → für alle gleich, ohne Server
- Installierbar als Web-App (PWA) mit Offline-Cache
- Supabase (Postgres) für Profile und die weltweite Bestenliste, abgesichert über Row Level Security

```
src/
  main.ts         Screens, Spielablauf, Teilen, Bestenliste
  auth.ts         Anmeldung, Registrierung, Sitzung, Logout (Supabase Auth)
  startmenu.ts    Startmenü, Anmelde- und Registrierungsformular
  games.ts        Die 12 Mini-Challenges (zentrale Liste inkl. Vorbereitungszeit und Tempo-Grenzen)
  trophies.ts     Trophäen-Logik: Ligen, Meilensteine, Berechnung, Schwierigkeit
  social.ts       Verbindung zu Trophäen, Weltrangliste und Freunden (Supabase-Funktionen)
  trophyUi.ts     Trophäenpfad, Liga-Aufstieg, Ergebnis, Weltrangliste, Spielerprofil
  friendsUi.ts    Freunde-Bereich
  ui.ts           Kleine UI-Helfer
  run.ts          Rundenaufbau, Punkte, Bewertung
  rng.ts          Seed-Zufall, Daily-Nummer
  state.ts        Spielstand, Streaks, Crew
  share.ts        Teilen-Text, Duell-Links, Story-Bild
  leaderboard.ts  Supabase-Anbindung
  sound.ts        Sounds
  fx.ts           Konfetti & Effekte
  style.css       Design
supabase/profiles.sql Benutzerprofile (Grundlage für Highscores, Fortschritt usw.)
supabase/trophies.sql Trophäen, Weltrangliste, Freunde (Funktionen + Sicherheitsregeln)
supabase/profile.sql  Profilbild und öffentliches Profil (Profil-Links)
supabase/minigames.sql Minigame-Läufe und Ranglisten pro Spiel
supabase/schema.sql   Alte Tages-Punkteliste (wird nicht mehr genutzt)
tests/                Logik-, Bestenlisten- und Browser-Tests
```

### Neue Challenge hinzufügen

In `src/games.ts` ein neues `MicroGame`-Objekt anlegen (mit `prep` = Orientierungszeit in ms, `speed` = Grenzen für den Tempobonus, `stage(n)` + `monotone` + `progressionText` für den Minigame-Modus), in `GAMES` eintragen und die ID in `GAME_IDS` (`src/run.ts`) ergänzen. Im Training, Endlos- und Trophäen-Modus ist es dann automatisch dabei. Damit schon gespielte Dailies (und Duelle darauf) unverändert bleiben, `NEW_GAMES_FROM_DAY` bzw. `idsForDay` so anpassen, dass die neue Challenge erst ab der nächsten Daily dabei ist.

## Deployment

Siehe [DEPLOYMENT.md](DEPLOYMENT.md). Kurzfassung: `npm run build` und den Ordner `dist/` bei Cloudflare Pages, Netlify, Vercel oder GitHub Pages hochladen – alles kostenlos.

## Konzept & Marktanalyse

Siehe [docs/KONZEPT.md](docs/KONZEPT.md).
