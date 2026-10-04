# Deployment

ZWIP ist eine statische Web-App. Nach `npm run build` liegt alles im Ordner `dist/`. Den kannst du bei jedem kostenlosen Static-Hoster veröffentlichen. Ein Server ist nicht nötig.

## Option A: Cloudflare Pages (empfohlen, kostenlos, auch für private Repos)

1. Auf [dash.cloudflare.com](https://dash.cloudflare.com) einloggen → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Dieses Repository auswählen.
3. Einstellungen:
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Optional unter **Environment variables** die Werte aus `.env.example` eintragen.
5. **Save and Deploy**. Danach bekommst du eine Adresse wie `https://zwip.pages.dev`.

Jeder Push auf `main` wird automatisch neu veröffentlicht.

## Option B: Netlify oder Vercel

Beide erkennen die Einstellungen automatisch (`netlify.toml` bzw. `vercel.json` liegen bereits im Repo).

- **Netlify:** [app.netlify.com](https://app.netlify.com) → *Add new site* → *Import from Git* → Repo wählen → *Deploy*.
- **Vercel:** [vercel.com/new](https://vercel.com/new) → Repo importieren → *Deploy*.

Umgebungsvariablen jeweils in den Projekteinstellungen eintragen.

## Option C: GitHub Pages

Der Workflow `.github/workflows/deploy-pages.yml` ist schon fertig.

1. Repo → **Settings** → **Pages** → Source: **GitHub Actions**.
2. Optional unter **Settings → Secrets and variables → Actions → Variables** die Variablen `ZWIP_PUBLIC_URL`, `ZWIP_SUPABASE_URL`, `ZWIP_SUPABASE_ANON_KEY` anlegen.
3. Auf `main` pushen oder den Workflow unter **Actions** manuell starten.

> Achtung: GitHub Pages funktioniert bei **privaten** Repos nur mit einem bezahlten GitHub-Konto. Dann lieber Option A oder B nehmen.

## Option D: Eine einzige Datei

`npm run build:single` erzeugt `dist-single/index.html`, die komplette App in einer Datei. Die kannst du überall hochladen oder direkt im Browser öffnen.

## Weltweite Bestenliste einrichten (optional, Supabase Free Tier)

Ohne diesen Schritt funktioniert alles außer dem Tab „Welt“ in der Bestenliste.

1. Kostenloses Projekt auf [supabase.com](https://supabase.com) anlegen.
2. Im Dashboard **SQL Editor** öffnen, den Inhalt von `supabase/schema.sql` einfügen und **Run** klicken.
3. Unter **Project Settings → API** die **Project URL** und den **anon public** Key kopieren.
4. Eintragen – lokal in eine `.env`-Datei (Vorlage: `.env.example`), beim Hoster als Umgebungsvariablen:
   ```
   ZWIP_SUPABASE_URL=https://xxxx.supabase.co
   ZWIP_SUPABASE_ANON_KEY=eyJ...
   ```
5. Neu bauen bzw. neu deployen.

Der anon-Key ist öffentlich gedacht. Die Datenbankregeln in `schema.sql` sorgen dafür, dass:

- nur Ergebnisse für den aktuellen Tag eingetragen werden können,
- die Gesamtpunktzahl zur Summe der Einzelrunden passen muss (0–100 pro Runde),
- pro Gerät und Tag nur ein Eintrag zählt,
- niemand Einträge ändern oder löschen kann,
- die geheime Geräte-ID nicht ausgelesen werden kann.

Diese Regeln wurden gegen eine echte Postgres-Datenbank getestet.

**Ehrlicher Hinweis:** Wer technisch versiert ist, kann trotzdem einen erfundenen Score eintragen, weil das Spiel im Browser läuft. Für den Start reicht der Schutz. Sobald die Bestenliste wichtig wird, sollte man eine serverseitige Prüfung ergänzen (z. B. per Supabase Edge Function, die die Runde aus dem Seed nachprüft und unrealistische Reaktionszeiten aussortiert).

## Umgebungsvariablen

| Variable | Wofür | Pflicht |
|---|---|---|
| `ZWIP_PUBLIC_URL` | Adresse in Teilen- und Duell-Links | nein (Standard: aktuelle Adresse) |
| `ZWIP_SUPABASE_URL` | Supabase-Projekt-URL | nein |
| `ZWIP_SUPABASE_ANON_KEY` | Supabase anon public Key | nein |
| `PORT` | Port für `npm run dev` | nein (5173) |

Die Variablen werden beim Build in die App geschrieben. Nach einer Änderung also neu bauen.

## Checkliste vor dem Launch

- [ ] Eigene Domain verbinden (bei allen Hostern kostenlos möglich)
- [ ] `ZWIP_PUBLIC_URL` auf die finale Adresse setzen, damit Duell-Links stimmen
- [ ] Impressum und Datenschutzerklärung ergänzen (Pflicht in Deutschland)
- [ ] Markenrecherche für den Namen „ZWIP“ (DPMA/EUIPO) – es gibt bereits Firmen mit ähnlichem Namen
- [ ] Bei Online-Bestenliste: Namensfilter gegen Beleidigungen einbauen
