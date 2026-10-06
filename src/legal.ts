// Rechtliche Seiten: Impressum, Datenschutzerklärung, Nutzungsbedingungen (Community-Regeln).
// Platzhalter in [ECKIGEN KLAMMERN] müssen vor dem öffentlichen Start mit echten Angaben ersetzt werden.
// Hinweis: Die Texte sind eine sorgfältige Vorlage, ersetzen aber keine Rechtsberatung.

export type LegalPage = "impressum" | "datenschutz" | "regeln";

export const LEGAL_TITLES: Record<LegalPage, string> = {
  impressum: "Impressum",
  datenschutz: "Datenschutz",
  regeln: "Nutzungsbedingungen",
};

/** Angaben des Betreibers – hier eintragen (gilt für Impressum und Datenschutzerklärung) */
export const OPERATOR = {
  name: "[VOR- UND NACHNAME]",
  street: "[STRASSE UND HAUSNUMMER]",
  city: "[PLZ ORT]",
  country: "Deutschland",
  email: "[E-MAIL-ADRESSE]",
};

const STAND = "Oktober 2026";

const ph = (s: string) => (s.startsWith("[") ? `<mark class="ph">${s}</mark>` : s);

function operatorBlock(): string {
  return `<p>${ph(OPERATOR.name)}<br>${ph(OPERATOR.street)}<br>${ph(OPERATOR.city)}<br>${OPERATOR.country}</p>
    <p>E-Mail: ${ph(OPERATOR.email)}</p>`;
}

export function legalHtml(page: LegalPage): string {
  if (page === "impressum") return impressum();
  if (page === "datenschutz") return datenschutz();
  return regeln();
}

export function legalNavHtml(active?: LegalPage): string {
  return `<nav class="legal-nav" aria-label="Rechtliches">${(Object.keys(LEGAL_TITLES) as LegalPage[])
    .map((p) => `<a href="#/rechtliches/${p}" class="${p === active ? "on" : ""}">${LEGAL_TITLES[p]}</a>`)
    .join("")}</nav>`;
}

function impressum(): string {
  return `<article class="legal">
    <h2>Impressum</h2>
    <p class="muted small">Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)</p>
    <h3>Betreiber</h3>
    ${operatorBlock()}
    <h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3>
    <p>${ph(OPERATOR.name)}, Anschrift wie oben</p>
    <h3>Streitschlichtung</h3>
    <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
    <h3>Haftung für Inhalte und Links</h3>
    <p>Wir erstellen die Inhalte dieser App mit Sorgfalt, übernehmen aber keine Gewähr für Richtigkeit, Vollständigkeit und Aktualität. Für Inhalte, die Spielerinnen und Spieler selbst einstellen (z. B. Spielernamen, Profilbilder, Clan-Namen und Chat-Nachrichten), sind diese selbst verantwortlich. Sobald uns Rechtsverletzungen bekannt werden, entfernen wir solche Inhalte umgehend – melde sie gern direkt in der App oder per E-Mail.</p>
    <h3>Schrift</h3>
    <p>„Bricolage Grotesque“ unter der SIL Open Font License 1.1 – die Schrift wird von unserem eigenen Server geladen.</p>
    <p class="muted small">Stand: ${STAND}</p>
  </article>`;
}

function datenschutz(): string {
  return `<article class="legal">
    <h2>Datenschutzerklärung</h2>
    <p>Hier steht in einfachen Worten, welche Daten ZWIP speichert, wofür und welche Rechte du hast. ZWIP zeigt <b>keine Werbung</b>, verkauft <b>keine Daten</b> und benutzt <b>kein Tracking</b>.</p>

    <h3>1. Wer ist verantwortlich?</h3>
    ${operatorBlock()}

    <h3>2. Welche Daten speichern wir – und wofür?</h3>
    <ul>
      <li><b>Konto:</b> E-Mail-Adresse und Passwort (verschlüsselt gespeichert), damit du dich anmelden kannst.</li>
      <li><b>Profil:</b> Spielername, freiwillig ein Profilbild, freiwillig dein Land (nur der Ländercode, kein Standort), dein ungefähres Geburtsjahr (aus der Altersangabe) und ob deine Eltern zugestimmt haben.</li>
      <li><b>Spielstände:</b> Trophäen, Minigame-Ergebnisse (Stufen, Punkte, Antwortzeiten), Runden – für Ranglisten und Fortschritt.</li>
      <li><b>Freunde und Clans:</b> Freundschaften, Clan-Mitgliedschaft, Clan-XP und Clan-Chat-Nachrichten.</li>
      <li><b>Meldungen und Moderation:</b> Meldungen, die du abschickst oder die andere über dich abschicken, Verwarnungen und Sperren – damit die App für alle sicher bleibt.</li>
      <li><b>Auf deinem Gerät:</b> Einstellungen (Ton, Vibration, gewählte Rangliste), deine Daily-Ergebnisse und deine Anmeldung werden im Speicher deines Browsers abgelegt. Das sind keine Werbe- oder Tracking-Cookies.</li>
    </ul>

    <h3>3. Rechtsgrundlagen</h3>
    <ul>
      <li>Art. 6 Abs. 1 lit. b DSGVO – um dir die App und dein Konto bereitzustellen (Nutzungsvertrag).</li>
      <li>Art. 6 Abs. 1 lit. f DSGVO – berechtigtes Interesse an einer sicheren App (Moderation, Schutz vor Betrug und Schummeln).</li>
      <li>Art. 6 Abs. 1 lit. a DSGVO – Einwilligung, z. B. für Push-Benachrichtigungen (jederzeit widerrufbar).</li>
    </ul>

    <h3>4. Kinder und Jugendliche</h3>
    <p>ZWIP richtet sich an Jugendliche. Wer jünger als 16 Jahre ist, darf ein Konto nur mit Zustimmung der Eltern bzw. Erziehungsberechtigten anlegen (Art. 8 DSGVO). Das bestätigst du bei der Registrierung. Wir fragen nur nach dem Alter, nicht nach dem Geburtstag.</p>

    <h3>5. Wer bekommt die Daten?</h3>
    <ul>
      <li><b>Supabase</b> (Supabase Inc., USA) betreibt unsere Datenbank und die Anmeldung. Die Server stehen in der EU (Irland). Mit Supabase besteht ein Vertrag zur Auftragsverarbeitung.</li>
      <li><b>Cloudflare</b> (Cloudflare Inc., USA) liefert die App aus (Hosting). Dabei werden technisch notwendige Verbindungsdaten wie die IP-Adresse kurz verarbeitet.</li>
      <li>Soweit Daten in die USA gelangen können, erfolgt das auf Grundlage des EU-US Data Privacy Framework bzw. der EU-Standardvertragsklauseln.</li>
      <li>Andere Spielerinnen und Spieler sehen nur, was öffentlich ist: Spielername, Profilbild, Liga, Trophäen, Ranglisten-Plätze, Land (wenn nicht verborgen), Clan und Chat-Nachrichten im eigenen Clan. <b>Deine E-Mail-Adresse sieht niemand.</b></li>
    </ul>

    <h3>6. Wie lange speichern wir?</h3>
    <p>Solange du dein Konto hast. Wenn du es löschst, werden Konto, Profil, Spielstände, Freundschaften und Meldungen über dich gelöscht. Deine Clan-Nachrichten bleiben ohne deinen Namen im Clan-Verlauf. Server-Protokolle unserer Dienstleister werden nach kurzer Zeit automatisch gelöscht.</p>

    <h3>7. Push-Benachrichtigungen</h3>
    <p>Nur wenn du zustimmst. Dafür speichern wir die technische Adresse deines Geräts für Benachrichtigungen. Du kannst Push in den Einstellungen oder im Browser jederzeit ausschalten.</p>

    <h3>8. Deine Rechte</h3>
    <ul>
      <li><b>Auskunft und Kopie:</b> Im Profil unter „Meine Daten herunterladen“ bekommst du alle Daten als Datei.</li>
      <li><b>Löschung:</b> Im Profil unter „Konto löschen“.</li>
      <li><b>Berichtigung, Einschränkung, Widerspruch, Datenübertragbarkeit</b> – schreib uns einfach eine E-Mail.</li>
      <li><b>Beschwerde</b> bei einer Datenschutz-Aufsichtsbehörde, z. B. der deines Bundeslandes.</li>
    </ul>
    <p class="muted small">Stand: ${STAND}</p>
  </article>`;
}

function regeln(): string {
  return `<article class="legal">
    <h2>Nutzungsbedingungen & Community-Regeln</h2>
    <h3>1. ZWIP</h3>
    <p>ZWIP ist ein kostenloses Spiel ohne Werbung und ohne Käufe. Es gibt keinen Anspruch darauf, dass die App immer verfügbar ist oder Funktionen unverändert bleiben.</p>
    <h3>2. Konto und Alter</h3>
    <p>Für Ranglisten, Freunde und Clans brauchst du ein Konto. Unter 16 Jahren nur mit Zustimmung deiner Eltern. Pro Person ein Konto. Halte dein Passwort geheim.</p>
    <h3>3. Fair bleiben – das gilt für alle</h3>
    <ul>
      <li>Keine Beleidigungen, kein Mobbing, keine Drohungen, keine Hetze.</li>
      <li>Keine Kontaktdaten im Chat (Telefonnummer, Adresse, Social-Media-Namen) – zu deinem eigenen Schutz.</li>
      <li>Keine unpassenden Spielernamen, Clan-Namen oder Profilbilder.</li>
      <li>Kein Schummeln: keine Bots, Skripte oder manipulierte Ergebnisse.</li>
      <li>Triff dich nie allein mit Leuten, die du nur aus dem Internet kennst.</li>
    </ul>
    <h3>4. Melden und Moderation</h3>
    <p>Du kannst Nachrichten, Spielernamen, Profilbilder und verdächtige Highscores melden. Wir prüfen Meldungen und können Inhalte entfernen, Namen zurücksetzen, verwarnen oder Konten zeitweise bzw. dauerhaft sperren. Verdächtige Ergebnisse werden nicht gewertet.</p>
    <h3>5. Deine Inhalte</h3>
    <p>Für Spielernamen, Profilbilder, Clan-Namen und Nachrichten bist du selbst verantwortlich. Du erlaubst uns, sie in der App anzuzeigen.</p>
    <h3>6. Konto löschen</h3>
    <p>Du kannst dein Konto jederzeit im Profil löschen.</p>
    <h3>7. Haftung</h3>
    <p>Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit sowie bei Verletzung von Leben, Körper und Gesundheit, sonst nur nach den gesetzlichen Vorschriften.</p>
    <h3>8. Änderungen</h3>
    <p>Wenn sich diese Regeln wesentlich ändern, sagen wir in der App Bescheid.</p>
    <h3>Kontakt</h3>
    <p>${ph(OPERATOR.email)}</p>
    <p class="muted small">Stand: ${STAND}</p>
  </article>`;
}
