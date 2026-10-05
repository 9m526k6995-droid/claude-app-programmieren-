# ZWIP – Konzept

## Die Marktlücke

**Daily Games** sind riesig, aber fast alle sind Wort- oder Logikrätsel für Erwachsene. Wordle, Connections, Strands, die LinkedIn-Puzzles (Queens, Zip, Tango): langsam, textlastig, eher 2–5 Minuten Grübeln. Die New York Times meldet für 2025 über 11 Milliarden Puzzle-Runden, Wordle allein rund 11,5 Millionen am Tag. Das Format „ein Rätsel pro Tag, für alle gleich, Ergebnis teilen“ funktioniert also nachweislich.

**Virale Browser-Games auf TikTok** sind dagegen schnell, chaotisch und visuell, haben aber meist keine tägliche Struktur, keinen Grund zum Wiederkommen und kein faires Vergleichsformat unter Freunden.

**Der Mobile-Markt** verschiebt sich weg von reinen Hypercasual-Spielen. Arcade stagniert, und Spiele konkurrieren direkt mit TikTok und Instagram um dieselben Minuten.

**Die Lücke:** Ein *Daily-Skill-Game*. Kein Grübeln, sondern Reflexe, Wahrnehmung und Kopfrechnen in 30 Sekunden. Täglich identisch für alle, damit Vergleichen fair ist, und mit Duell-Links als eingebautem Wachstumsmotor. Das passt zur Aufmerksamkeitsspanne von Jugendlichen, die zwischen zwei TikToks spielen.

## Warum die Mechaniken funktionieren

| Mechanik | Warum sie wirkt | Wie ZWIP sie nutzt |
|---|---|---|
| **Tägliche Challenge** | Knappheit (nur eine pro Tag) macht jede Runde bedeutsam. Alle reden über dasselbe Rätsel | Daily #N, nur erster Versuch zählt, Countdown bis zur nächsten |
| **Gleich für alle** | Faire Vergleichbarkeit. „Wie viel hattest du?“ wird Gesprächsthema | Seed pro Tag: identische Reihenfolge, Felder und Wartezeiten |
| **Streaks** | Kleine tägliche Gewohnheit, sichtbarer Fortschritt | 🔥-Zähler und Wochenleiste, ohne Bestrafung oder Druck-Push |
| **Teilbares Ergebnis** | Spoilerfreies Emoji-Raster macht neugierig, ohne die Lösung zu verraten | 🟪🟩🟨🟥-Raster, Story-Bild für TikTok/Insta |
| **Freundes-Bestenliste** | Gegen Freunde zu gewinnen motiviert stärker als ein anonymer Weltrang | Crew-Liste aus Duell-Links, optional Weltliste |
| **Schnelle Skill-Games** | Sofort verständlich, keine Regeln lesen, „nur noch einmal“-Gefühl | 8 Mini-Challenges à 1–3 Sekunden, Training & Endlos ohne Limit |
| **Asynchrone Duelle** | Kein gleichzeitiges Online-Sein nötig, ein Link reicht | Ergebnis steckt im Link, Vergleich Runde für Runde |

## Was ZWIP bewusst *nicht* macht

- Keine Lootboxen, keine Zufalls-Belohnungen, kein Glücksspiel
- Keine künstlichen Wartezeiten oder Energie-Systeme
- Keine Streak-Erpressung („Kauf dir einen Streak-Retter!“)
- Kein Account-Zwang, keine Werbung im MVP
- Keine Dark Patterns bei Benachrichtigungen

## Aufbau seit Oktober 2026

- **Klare Navigation** mit fünf Tabs (Start, Spielen, Ranglisten, Freunde, Profil). Pro Bildschirm gibt es genau einen Hauptknopf, alles andere tritt zurück.
- **Erklärkarte vor jeder Aufgabe** (4 Sekunden) in den gemischten Modi – niemand verliert, weil er ein Spiel nicht verstanden hat.
- **Minigames als Einzelspiele**: Jedes der 22 Spiele hat einen Stufen-Lauf, der endlos schwerer wird, und eine eigene Rangliste. Das gibt Spielern mit einem Lieblingsspiel ein langfristiges Ziel („Stufe 20 in Merk dir's!“) und macht neue Rekorde teilbar. Die genaue Progression jedes Spiels steht in der README.

- **Trophäen mit Liga-Einsatz**: Pro Runde wird je nach Liga ein Einsatz abgezogen. Unten kommt man schnell voran, oben muss man liefern – Meister und Legende sind ultra schwer, aber machbar. Dadurch bleibt die Weltrangliste spannend und Top-Plätze sind etwas wert.
- **22 Minispiele** in allen Modi (die dritte Welle ab Daily #6).

## Roadmap (Ideen für weitere Modi)

1. **Themenwochen** – z. B. nur Farb-Challenges, nur Mathe, „Chaos-Woche“ mit doppeltem Tempo
2. **Live-Duell** – zwei Handys, gleiche Runde, gleichzeitig (WebSocket über Supabase Realtime)
3. **Gruppen/Klassen-Ligen** – private Bestenliste per Einladungscode, Wochensieger
4. **Creator-Challenges** – Creator erstellen eine eigene Runde und teilen sie mit ihrer Community
5. **Neue Mini-Challenges** – weitere Spiele für Daily und Minigames
6. **Archiv** – vergangene Dailies nachspielen
7. **Minigame-Wochenranglisten** – jede Woche ein „Spiel der Woche“ mit eigener Wertung

## Geld verdienen – ohne Manipulation

1. **ZWIP+ (Abo, ca. 2–3 €/Monat):** Daily-Archiv, Bonus-Modi, eigene Privat-Ligen, Statistiken. Das Hauptspiel bleibt komplett kostenlos.
2. **Kosmetik zum Festpreis:** Themes, Farbpaletten, Sound-Packs, Profil-Rahmen. Man sieht vor dem Kauf genau, was man bekommt. Kein Gameplay-Vorteil.
3. **Gebrandete Daily-Challenges:** Marken, Festivals, Vereine oder Sender sponsern eine Themen-Daily („Die Festival-Daily“). Das ist für Werbekunden attraktiv und für Spieler nicht störend.
4. **Schulen, Vereine, Firmen:** Private Ligen für Klassen, Teams oder Events als bezahlte Lizenz.
5. **Später, wenn überhaupt:** Freiwillige Werbung nur im Training-Modus. Bei Minderjährigen ist personalisierte Werbung in der EU (DSA) ohnehin verboten. Deshalb eher kontextbezogene Werbung oder Sponsoring.

## Quellen

- Azur Games: Hypercasual und Hybrid Casual 2026 – https://azurgames.com/blog/hypercasual-and-hybrid-casual-in-2026-full-report/
- Riddle: Mini-Games-Retention-Playbook 2026 (NYT-Zahlen) – https://www.riddle.com/blog/use-cases/mini-games-retention-playbook/
- Aliteq: Warum LinkedIn Daily Games anbietet – https://aliteq.com/games-on-linkedin-this-will-be-a-new-promise-for-games-being-born
- Nodes: Daily Puzzle Games 2026 – https://www.nodes-game.com/daily-puzzle-games
- Otter Games: Virale Browser-Games auf TikTok – https://ottergames.org/blog/most-viral-browser-games-on-tiktok/
- SQ Magazine: Gen Z Gaming-Statistiken – https://sqmagazine.co.uk/gen-z-gaming-platform-preferences-statistics/
