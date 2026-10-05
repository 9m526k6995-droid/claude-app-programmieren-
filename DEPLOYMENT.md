# Deployment

ZWIP ist eine statische Web-App. Nach `npm run build` liegt alles im Ordner `dist/`. Den kannst du bei jedem kostenlosen Static-Hoster veröffentlichen. Ein Server ist nicht nötig.

## Option A: Cloudflare Pages (empfohlen, kostenlos, auch für private Repos)

1. Auf [dash.cloudflare.com](https://dash.cloudflare.com) einloggen → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Dieses Repository auswählen.
3. Einstellungen:
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Unter **Environment variables** `ZWIP_SUPABASE_URL` und `ZWIP_SUPABASE_ANON_KEY` eintragen (siehe unten „Supabase einrichten“).
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
2. Repo → **Settings → Secrets and variables → Actions → Variables**: Variable `ZWIP_PAGES` mit Wert `true` anlegen (schaltet den Workflow ein).
3. Optional unter **Settings → Secrets and variables → Actions → Variables** die Variablen `ZWIP_PUBLIC_URL`, `ZWIP_SUPABASE_URL`, `ZWIP_SUPABASE_ANON_KEY` anlegen.
4. Auf `main` pushen oder den Workflow unter **Actions** manuell starten.

> Achtung: GitHub Pages funktioniert bei **privaten** Repos nur mit einem bezahlten GitHub-Konto. Dann lieber Option A oder B nehmen.

## Option D: Eine einzige Datei

`npm run build:single` erzeugt `dist-single/index.html`, die komplette App in einer Datei. Die kannst du überall hochladen oder direkt im Browser öffnen.

## Supabase einrichten (Anmeldung + Bestenliste)

Ohne Supabase zeigt die App nur das Startmenü mit einem Hinweis, dass die Anmeldung noch nicht eingerichtet ist. Das Spiel ist erst nach der Anmeldung erreichbar.

### 1. Projekt anlegen
1. Auf [supabase.com](https://supabase.com) kostenlos registrieren → **New project**.
2. Name z. B. `zwip`, ein Datenbank-Passwort vergeben (gut aufheben, die App braucht es nicht), Region **Central EU (Frankfurt)**.
3. Warten, bis das Projekt bereit ist (1–2 Minuten).

### 2. Datenbank-Tabellen anlegen
1. Links **SQL Editor** → **New query**.
2. Inhalt von `supabase/profiles.sql` einfügen → **Run**. (Benutzerprofile, die automatisch bei jeder Registrierung entstehen.)
3. Neue Query, Inhalt von `supabase/schema.sql` einfügen → **Run**. (Alte Tages-Bestenliste, optional.)
4. Neue Query, Inhalt von `supabase/trophies.sql` einfügen → **Run**. (Trophäen, Weltrangliste, Freunde.)
5. Neue Query, Inhalt von `supabase/profile.sql` einfügen → **Run**. (Profilbild und öffentliches Profil für Profil-Links.)
6. Neue Query, Inhalt von `supabase/minigames.sql` einfügen → **Run**. (Minigames als Einzelspiele mit Rangliste pro Spiel.)
7. Neue Query, Inhalt von `supabase/social.sql` einfügen → **Run**. (Badges für Freundesanfragen.)
8. Neue Query, Inhalt von `supabase/clans.sql` einfügen → **Run**. (Highscores in Punkten und Clans. Muss nach `social.sql` laufen.)
9. Neue Query, Inhalt von `supabase/regions.sql` einfügen → **Run**. (Land im Konto und Länder-Ranglisten.)

### 3. Anmeldung einstellen
1. Links **Authentication** → **Sign In / Providers** → **Email**: muss **aktiviert** sein (Standard).
2. Dort **Minimum password length** auf **8** setzen (die App verlangt ebenfalls 8).
3. **Confirm email**:
   - **Aus** = Nach der Registrierung ist man sofort angemeldet. Am einfachsten zum Testen.
   - **An** (Standard, empfohlen für den echten Start) = Supabase schickt eine Bestätigungs-Mail. Die App zeigt dann „Fast geschafft – bestätige deine E-Mail“. Der Link in der Mail führt zurück in die App und meldet direkt an.
4. **Authentication** → **URL Configuration**:
   - **Site URL** = Adresse deiner App, z. B. `https://zwip.pages.dev`
   - Unter **Redirect URLs** zusätzlich eintragen: `https://zwip.pages.dev/**` und zum lokalen Testen `http://localhost:5173/**`

> Hinweis: Supabase verschickt im Gratis-Tarif nur wenige Mails pro Stunde. Für den echten Start unter **Authentication → Emails → SMTP Settings** einen eigenen Mail-Dienst eintragen (z. B. Resend oder Brevo, beide mit Gratis-Kontingent).

### 4. Zugangsdaten kopieren
**Project Settings** → **API Keys**:
- **Publishable key** (`sb_publishable_…`) kopieren. Bei älteren Projekten heißt er **anon public** (`eyJ…`) unter „Legacy API keys“. Beide funktionieren.
- **Nicht** den **Secret key** bzw. **service_role** Key nehmen. Der gibt vollen Zugriff auf die Datenbank. Der Build bricht ab, falls er versehentlich eingetragen wird.

Die **Project URL** (`https://xxxx.supabase.co`) steht unter **Project Settings → Data API** bzw. oben im Projekt-Dashboard unter **Connect**.

### 5. Werte eintragen

**Aktuell schon erledigt:** Die öffentlichen Werte für die Live-App stehen in `.env.production` im Repo. Cloudflare baut damit automatisch, es müssen keine Variablen beim Hoster eingetragen werden. Variablen beim Hoster oder eine lokale `.env` haben Vorrang, falls man mal ein anderes Supabase-Projekt nutzen will.

**Lokal:** `.env.example` zu `.env` kopieren und ausfüllen:
```
ZWIP_SUPABASE_URL=https://xxxx.supabase.co
ZWIP_SUPABASE_ANON_KEY=sb_publishable_...
```
Dann `npm run dev`. Die `.env` wird nicht ins Repo hochgeladen.

**Beim Hoster** (Cloudflare Pages / Netlify / Vercel): dieselben zwei Werte unter **Environment variables** eintragen und neu deployen.
**GitHub Pages:** unter **Settings → Secrets and variables → Actions → Variables** anlegen.

### Warum der Key öffentlich sein darf
Der publishable/anon Key steht zwangsläufig im Browser-Code, das ist bei Supabase so vorgesehen. Geschützt werden die Daten durch die Regeln in der Datenbank (Row Level Security):

- Jeder sieht und ändert nur das **eigene Profil**. Profile entstehen automatisch und können nicht direkt angelegt oder gelöscht werden.
- Bestenliste: nur Ergebnisse für den aktuellen Tag, Gesamtpunktzahl muss zur Summe der Runden passen, ein Eintrag pro Gerät und Tag, kein Ändern oder Löschen, die geheime Geräte-ID ist nicht lesbar.

Beide Regelwerke wurden gegen eine echte Postgres-Datenbank getestet.

**Hinweis zur Bestenliste:** Wer technisch versiert ist, kann trotzdem einen erfundenen Score eintragen, weil das Spiel im Browser läuft. Sobald die Bestenliste wichtig wird, sollte eine serverseitige Prüfung dazukommen (z. B. per Supabase Edge Function).

### Benutzer-ID für spätere Funktionen
Jeder Account hat eine feste ID (UUID). In der App: `currentUser().id` aus `src/auth.ts`. In der Datenbank: `auth.uid()` bzw. `public.profiles.id`. Spätere Tabellen für Highscores, Level, Fortschritt, Statistiken, Einstellungen oder Spielmodi bekommen eine Spalte `user_id uuid references public.profiles(id) on delete cascade` und die Regel `user_id = auth.uid()`.

## Umgebungsvariablen

| Variable | Wofür | Pflicht |
|---|---|---|
| `ZWIP_SUPABASE_URL` | Supabase-Projekt-URL | ja, für Anmeldung |
| `ZWIP_SUPABASE_ANON_KEY` | Supabase publishable bzw. anon public Key | ja, für Anmeldung |
| `ZWIP_PUBLIC_URL` | Adresse in Teilen- und Duell-Links | nein (Standard: aktuelle Adresse) |
| `PORT` | Port für `npm run dev` | nein (5173) |

Die Variablen werden beim Build in die App geschrieben. Nach einer Änderung also neu bauen bzw. neu deployen.

## Checkliste vor dem Launch

- [ ] Eigene Domain verbinden (bei allen Hostern kostenlos möglich)
- [ ] `ZWIP_PUBLIC_URL` auf die finale Adresse setzen, damit Duell-Links stimmen
- [ ] Impressum und Datenschutzerklärung ergänzen (Pflicht in Deutschland)
- [ ] Markenrecherche für den Namen „ZWIP“ (DPMA/EUIPO) – es gibt bereits Firmen mit ähnlichem Namen
- [ ] Bei Online-Bestenliste: Namensfilter gegen Beleidigungen einbauen
- [ ] Supabase: „Confirm email“ an, eigener SMTP-Mailversand eingerichtet
- [ ] Datenschutzerklärung um Account-Daten (E-Mail) und Supabase als Auftragsverarbeiter ergänzen
