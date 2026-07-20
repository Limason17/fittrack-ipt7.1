# Stage 2A – Produktionsfähiger Einladungs-E-Mail-Versand

Diese Phase liefert einen konkreten, providerneutralen SMTP-Adapter für den
bereits bestehenden Invitation-Delivery-Vertrag aus Stage 1A. Sie ändert
weder das Datenmodell noch führt sie eine neue Migration ein — Migration 008
bleibt der aktuelle Stand. Kein zweiter, paralleler Einladungsfluss wurde
gebaut; der bestehende Fluss (validieren → Token erzeugen → nur den Hash
speichern → Akzeptanz-URL bauen → Provider versendet → Kompensation bei
Fehler) ist unverändert, nur der bisher fehlende Produktions-Provider wurde
ergänzt.

## Architektur

Der bestehende Vertrag (`backend/outbox/invitationOutbox.js` →
`backend/delivery/invitationDelivery.js#createInvitationDelivery({env,
provider})`) blieb strukturell unverändert:

- Ohne `provider`: Produktion verweigert mit `503
  INVITATION_DELIVERY_UNAVAILABLE`, bevor irgendetwas persistiert wird;
  Development/Test liefern weiterhin `{delivered:false, acceptUrl}`.
- Mit `provider`: baut die Akzeptanz-URL, ruft
  `provider.sendInvitation({email, studioName, role, expiresAt, locale,
  requestId, acceptanceUrl})`, gibt `{delivered:true}` zurück — **kein**
  `acceptUrl` im Response.

Neu ist ausschließlich, **woher** `provider` stammt: `createInvitationDelivery`
löst einen fehlenden `provider` jetzt über `resolveDefaultProvider(env)` auf
(`backend/delivery/invitationDelivery.js`). Diese Funktion liest
`INVITATION_EMAIL_PROVIDER` aus der Umgebung:

- nicht `"smtp"` (der Standard in jeder Umgebung) → `undefined`, exakt das
  bisherige Verhalten, keine Seiteneffekte, kein Unterschied zu vorher;
- `"smtp"` → validiert die SMTP-Konfiguration (`backend/config/smtpConfig.js`)
  und konstruiert den SMTP-Provider (`backend/delivery/smtpInvitationProvider.js`).

Diese Auflösung läuft als Default-Parameter-Ausdruck genau einmal, beim
ersten Aufruf von `createInvitationDelivery()` ohne expliziten Provider — im
echten Prozess passiert das, während `routes/studioV1.js` beim Serverstart
geladen wird (dort steht bereits `const defaultRouter =
createStudioV1Router();`), also **vor** der ersten bedienten Anfrage. Jeder
bestehende Test, der einen eigenen `provider`/`delivery` injiziert (das
etablierte DI-Muster aus `studioSecurity.test.js`/`studioApi.test.js`),
bleibt davon komplett unberührt, da ein explizit übergebenes Argument den
Default-Ausdruck gar nicht erst auswertet.

Zusätzlich wurde die Nachricht an den Outbox minimal um zwei Felder
erweitert: `locale` (das bereits vorhandene, validierte
`studio.default_locale` — keine erfundene oder aus unsicheren Daten
abgeleitete Sprache) und `requestId` (aus `req.requestId`, für
Log-Korrelation). Beide fließen bis zum Provider durch.

## SMTP-Adapter (`backend/delivery/smtpInvitationProvider.js`)

`createSmtpInvitationProvider({config, transportFactory, logger})` liefert
`{sendInvitation, close}`. Ein **einziger, wiederverwendbarer**
Nodemailer-Transport wird bei der Provider-Erstellung gebaut und über die
gesamte Prozesslaufzeit für jeden Versand wiederverwendet — es wird nie ein
Transport pro Empfänger neu erzeugt. Es gibt **keine** automatische
Mehrfachwiederholung eines Sendevorgangs: Ein Fehlschlag wirft einmalig,
sodass die bestehende Outbox-Kompensation (Einladung → `revoked`) greift,
statt das Risiko einer doppelten E-Mail einzugehen.

Providerfehler werden intern klassifiziert (`config` / `connection` / `tls` /
`auth` / `timeout` / `recipient_rejected` / `unknown`, siehe
`classifyError()`) — ausschließlich für strukturiertes Logging. Nach außen
wirft der Adapter immer denselben stabilen `INVITATION_PROVIDER_UNAVAILABLE`-
Fehler ohne SMTP-Servertext, Host, Benutzername oder Stacktrace; der
bestehende Aufrufer (`studioService.js`) behandelt jeden Delivery-Fehler
ohnehin identisch (Kompensation + generischer `502
INVITATION_DELIVERY_FAILED`).

## Konfiguration (`backend/config/smtpConfig.js`)

`readSmtpConfig(env)` spiegelt bewusst das bestehende Muster aus
`config/auth.js`/`config/db.js` (klare `INVALID_*_CONFIG`-Fehlercodes,
`integerSetting`/`booleanSetting`-Helfer mit festen Grenzen). Eine Abweichung
vom `auth.js`-Vorbild ist bewusst: `readSmtpConfig` ist eine **reine
Funktion ohne eager Top-Level-Singleton** (`auth.js` exportiert einen bereits
ausgewerteten `JWT_SECRET`, weil dieser Wert *immer* gebraucht wird).
SMTP-Konfiguration ist dagegen *optional* — ein eager Singleton hätte bei
jedem `require()` dieses Moduls unnötig ausgewertet werden müssen, obwohl das
Feature in der overwhelmenden Mehrheit aller Fälle (Tests, Dev, jedes nicht
opt-in Deployment) deaktiviert ist. Der eigentliche „früh erkannt"-Effekt
entsteht stattdessen dort, wo die Funktion tatsächlich gebraucht wird (siehe
oben).

Erforderlich, sobald `INVITATION_EMAIL_PROVIDER=smtp`:

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `SMTP_HOST` | ja | Hostname; keine Platzhalter (`smtp.example.com` etc. werden abgelehnt) |
| `SMTP_PORT` | ja | 1–65535 |
| `SMTP_SECURE` | ja | exakt `"true"` oder `"false"` |
| `SMTP_USER` / `SMTP_PASSWORD` | zusammen optional | beide gesetzt oder beide leer, nie nur eines |
| `SMTP_FROM_EMAIL` | ja | syntaktisch gültige Adresse |
| `SMTP_FROM_NAME` | ja | nicht leer, höchstens 100 Zeichen, kein Platzhalter |
| `SMTP_REPLY_TO` | optional | syntaktisch gültig, falls gesetzt |
| `SMTP_CONNECTION_TIMEOUT_MS` | optional (Default 10000) | 1000–60000 |
| `SMTP_GREETING_TIMEOUT_MS` | optional (Default 10000) | 1000–60000 |
| `SMTP_SOCKET_TIMEOUT_MS` | optional (Default 20000) | 1000–120000 |

Bekannte Platzhalterwerte (`changeme`, `your-smtp-user`, `smtp.example.com`,
`test`, `placeholder`, …) werden in **jeder** Umgebung abgelehnt, nicht nur in
Produktion — ein Platzhalter ist nie eine gültige Konfiguration.

## TLS

Immer verschlüsselt, ausnahmslos, in jeder Umgebung — nicht nur in
Produktion: `SMTP_SECURE=true` (SMTPS) **oder** `SMTP_SECURE=false` mit
serverseitig erzwungenem `requireTLS:true` (STARTTLS). Es gibt keinen
unverschlüsselten Modus. Zertifikatsprüfung bleibt immer der
Nodemailer-Standard (`rejectUnauthorized` wird nirgends überschrieben, kein
`tls`-Objekt wird gesetzt) — keine Deaktivierung, kein unsicherer Fallback.

## Fail-Closed-Verhalten

Unverändert streng: In Produktion verweigert eine fehlende oder ungültige
SMTP-Konfiguration (`INVITATION_EMAIL_PROVIDER` nicht gesetzt, oder gesetzt
aber mit ungültigen `SMTP_*`-Werten) die Einladungserstellung vollständig,
bevor irgendetwas in die Datenbank geschrieben wird — unverändert derselbe
`503 INVITATION_DELIVERY_UNAVAILABLE`. Ein bereits committeter, aber nicht
zustellbarer Versand kompensiert (siehe unten). Es gibt keinen
Konsolen-Fallback in Produktion und niemals ein `acceptUrl`/Rohtoken im
Response, sobald ein Provider aktiv ist.

## Development/Test

Der bestehende sichere Preview-Vertrag (`{delivered:false, acceptUrl}` ohne
`INVITATION_EMAIL_PROVIDER=smtp`) bleibt vollständig erhalten und ist
weiterhin der Standard in jeder nicht-produktiven Umgebung — er wird durch
diese Phase nicht verändert und kann nicht versehentlich in Produktion aktiv
sein (die Weiche liegt ausschließlich an `INVITATION_EMAIL_PROVIDER=smtp`,
nicht an `NODE_ENV`). Preview-URLs werden nach wie vor nicht geloggt.

## Kompensation

Unverändert: Wirft `provider.sendInvitation()`, revoked
`compensateInvitationDeliveryFailure` die bereits committete `pending`-
Einladung atomar zu `revoked` (Audit `invitation.delivery_failed`, ohne
Feedbacktext/E-Mail/Token), der Client erhält `502
INVITATION_DELIVERY_FAILED`. Eine derart kompensierte Einladung kann nicht
mehr akzeptiert werden (`404 INVITATION_INVALID`, identisch zu einer nie
existierenden Einladung — automatisiert geprüft).

## Fehlerklassifikation und Logging

Intern unterschieden (`smtpInvitationProvider.js#classifyError`): ungültige
Konfiguration (bereits vorher durch `readSmtpConfig` verhindert),
DNS-/Verbindungsfehler (`ENOTFOUND`/`ECONNREFUSED`/…), TLS-Fehler
(Zertifikats-/SSL-Meldungen), Authentifizierungsfehler (`EAUTH`/`AUTH`-
Kommando), Timeout (`ETIMEDOUT`), vom Server abgelehnter Empfänger
(`RCPT TO`/`DATA`), allgemeiner Providerfehler. Extern immer derselbe
stabile `INVITATION_PROVIDER_UNAVAILABLE`.

Logs (`invitation_email_send_succeeded`/`_failed`) enthalten ausschließlich:
`requestId`, `provider: "smtp"`, `errorClass` (nur bei Fehlschlag),
`durationMs`. **Nie**: Empfängeradresse, Passwort, Benutzername, vollständige
Akzeptanz-URL, Einladungstoken, E-Mail-Body, SMTP-Rohantwort. Der Logger ist
standardmäßig der bestehende `startup/logger.js#createStructuredLogger()`
mit seiner bereits vorhandenen generischen Redaktion (Schlüsselmuster
`password|secret|token|…`, 43-Zeichen-Tokens, `Bearer`, JWTs,
URL-Credentials) als zusätzliches Sicherheitsnetz — automatisiert geprüft,
dass Passwort/Token/URL/Empfängeradresse in keinem geloggten Feld erscheinen.

## Audit

Keine neuen Audit-Ereignistypen. Die bestehende Allowlist für
`invitation.created`/`invitation.delivery_failed` (`{role, expiresAt}` bzw.
`{role}`) deckt den SMTP-Pfad identisch ab — Token und E-Mail-Body waren
dort nie enthalten und sind es weiterhin nicht.

## E-Mail-Inhalt (`backend/delivery/invitationEmailTemplate.js`)

Text- **und** HTML-Version, beide erzeugt. Enthält höchstens: Studio-Name,
lokalisierter Rollenbegriff, Akzeptanz-URL (als Button **und** als
vollständiger Text-Link in beiden Versionen), Ablaufhinweis, „falls
unerwartet, ignorieren"-Hinweis, neutraler „FitTrack"-Absender. Kein
internes ID, keine Mitgliederdaten außer der Empfängeradresse (die nur als
Envelope-/Header-Empfänger dient, nie im Body). HTML-Werte
(`studioName`, Rollenbezeichnung, URL) werden vollständig escaped
(`escapeHtml()`, automatisiert gegen `<img onerror=…>`-artige Payloads
getestet) — kein `v-html`-Äquivalent, kein Ausführen von Studio-Namen als
Markup. Kein extern geladenes Bild, kein Tracking-Pixel, kein Script, keine
externe Schriftart/CSS, keine Marketing-Inhalte, kein vertrauliches Datum im
Betreff.

### Locale

Deutsch/Englisch entsprechend `studio.default_locale` — dem bereits
vorhandenen, validierten (`'de'|'en'`), beim Laden des Studios ohnehin
geladenen Feld; keine erfundene oder aus unsicheren Daten (z. B. der
Empfänger-E-Mail-Domain) abgeleitete Sprache. Fehlt oder ist der Wert
unbekannt, fällt die Vorlage auf Deutsch als klar dokumentierte neutrale
Standardsprache zurück (`resolveLocale()`).

## Produktionsverhalten (Frontend)

Kein neuer Code für den bestehenden Erfolgsfall nötig:
`StudioInvitationsView.vue` zeigte bereits vorher `deliveryLink` nur, wenn
`result.delivery.acceptUrl` als String vorhanden ist — bei
`{delivered:true}` (kein `acceptUrl`) bleibt die Vorschau-Box unsichtbar,
automatisch, ohne Änderung. Eine gezielte, kleine Verbesserung wurde
trotzdem vorgenommen: Die Erfolgsmeldung unterscheidet jetzt explizit
zwischen „wurde erstellt" (Dev-Preview) und „wurde per E-Mail versendet"
(`result.delivery.delivered === true`), um die im Auftrag geforderte „klare
Bestätigung, dass die Einladung versendet wurde" wörtlich zu erfüllen, statt
nur implizit über das Fehlen der Vorschau-Box. Fehlerzustände (403 vs. jeder
andere Code inkl. 502/503) waren bereits sicher/generisch und das
E-Mail-Formularfeld wurde bei Fehlern nie geleert — beides unverändert
korrekt, jetzt zusätzlich mit dedizierten Tests abgesichert.

## Manueller SMTP-Smoke-Test

**In dieser Umgebung sind keine echten SMTP-Zugangsdaten vorhanden — es
wurde keine echte E-Mail versendet.** Die folgende Anleitung ist
providerneutral und funktioniert mit jedem SMTP-fähigen Dienst (eigener
Test-Account, transaktionaler E-Mail-Anbieter, kontrollierter
Firmen-SMTP-Server). Keine echten Zugangsdaten in Repository, Tests,
Dokumentation, Screenshots oder Commits verwenden.

1. **Benötigte Environment-Variablen** (in `backend/.env`, niemals committen):
   ```
   INVITATION_EMAIL_PROVIDER=smtp
   SMTP_HOST=<Ihr SMTP-Host>
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=<Ihr Benutzername, falls erforderlich>
   SMTP_PASSWORD=<Ihr Passwort, falls erforderlich>
   SMTP_FROM_EMAIL=<eine bei Ihrem Provider erlaubte Absenderadresse>
   SMTP_FROM_NAME=FitTrack
   INVITATION_ACCEPT_BASE_URL=https://<Ihre Frontend-Domain>
   ```
2. **Serverstart:** `npm start` (oder `npm run dev`) im Verzeichnis
   `backend/`. Bei ungültiger, aber aktivierter Konfiguration bricht der
   Start sofort mit `INVALID_SMTP_CONFIG` ab — das ist das gewünschte
   Fail-Closed-Verhalten, kein Fehler im Adapter.
3. **Testeinladung:** Als angemeldeter Owner/Admin/Trainer eine Einladung
   über die Studio-Einladungsansicht (oder direkt `POST
   /api/v1/studios/:studioId/invitations`) an eine Adresse senden, auf die
   Sie tatsächlich Zugriff haben.
4. **Erwartete E-Mail:** Betreff „Einladung zu <Studio> auf FitTrack",
   Klartext-Absendername „FitTrack", ein Button „Einladung annehmen" sowie
   der vollständige Link als Text darunter, ein Ablaufhinweis, kein Anhang,
   keine Bilder.
5. **Akzeptanzlink:** Der Link muss exakt auf
   `<INVITATION_ACCEPT_BASE_URL>/invitations/<Token>` zeigen und im Browser
   zur Annahme-Seite führen.
6. **Sichere Logprüfung:** In den Server-Logs nach `invitation_email_send_succeeded`
   suchen und bestätigen, dass **kein** Passwort, keine E-Mail-Adresse,
   keine vollständige URL und kein Token im Log-Eintrag erscheint —
   ausschließlich `requestId`, `provider`, `durationMs`.
7. **Rücksetzen:** `INVITATION_EMAIL_PROVIDER` aus `backend/.env` wieder
   entfernen (oder auskommentieren) und den Server neu starten, um in den
   sicheren Standardzustand (Fail-Closed in Produktion, Preview in
   Dev/Test) zurückzukehren. Verwendete Test-Zugangsdaten beim Provider
   widerrufen/rotieren, falls sie nur für diesen Test angelegt wurden.

**Klare Abgrenzung des Nachweisstands dieser Phase:**
- **Implementiert:** vollständiger SMTP-Adapter, Konfigurationsvalidierung, TLS-Erzwingung, E-Mail-Vorlagen, Fehlerklassifikation, Kompensation, Frontend-Anpassung.
- **Automatisiert mit Fake-Transport getestet:** alle Unit- und Integrationsszenarien aus Abschnitt „Tests" unten, vollständig ohne echten Netzwerkzugriff.
- **Reale Provider-Verbindung:** in dieser Umgebung **nicht möglich** (keine Zugangsdaten vorhanden) — bleibt ein offener, manueller Schritt gemäß obiger Anleitung.

## Tests

- **Unit** (`backend/test/unit/smtpConfig.test.js`, 17 Tests;
  `invitationEmailTemplate.test.js`, 14 Tests;
  `smtpInvitationProvider.test.js`, 13 Tests): gültige/ungültige
  Konfiguration in jeder Kombination, Platzhaltererkennung,
  Timeout-Grenzen, STARTTLS/SMTPS, Zertifikatsprüfung nie deaktiviert,
  Text-/HTML-Erzeugung, HTML-Escaping, kein Tracking-Pixel/externes Bild,
  Fehlernormalisierung, Fake-Transport-Injektion, Transport-Wiederverwendung,
  keine automatische Wiederholung, Secrets/Token/URL nie in Logs.
- **Integration** (4 neue Tests in `backend/test/integration/studioApi.test.js`,
  direkt im Anschluss an den bestehenden Kompensationstest): gültiger
  Fake-SMTP-Provider liefert korrekt und ohne `acceptUrl`/interne IDs;
  Produktionskonfiguration ohne Provider bleibt fail-closed, ohne dass
  etwas persistiert wird; ein simulierter SMTP-Fehler kompensiert zu
  `revoked`, der Client sieht keine SMTP-Details, eine kompensierte
  Einladung kann nicht akzeptiert werden (`404 INVITATION_INVALID`), das
  Audit-Detail bleibt exakt `{role}`; parallele Einladungserstellung an
  zwei unterschiedliche Adressen bleibt sicher und jeder Provider-Aufruf
  erhält den korrekten, eigenen Empfänger. Bestehende Replay-/Expiry-/
  Revocation-Tests liefen unverändert mit (13/13 grün in dieser Datei).
- **Frontend** (4 neue Tests in `StudioInvitationsView.test.js`): Erfolg
  ohne Preview-Link mit „versendet"-Bestätigung; Zustellfehler mit sicherer
  Meldung und erhaltenem Formularfeld ohne Logout (502 und 503 separat
  geprüft); bestehende Einladungsliste bleibt funktionsfähig.
- **E2E** (`frontend/e2e/invitationEmail.spec.js`, 4 Szenarien, Chromium):
  produktionsförmige Erfolgsantwort per `page.route()`-Mock zeigt
  Bestätigung ohne Token/URL; gemockter Zustellfehler zeigt sichere Meldung
  ohne Logout; der reale, ungemockte Dev-Preview-Fluss wird weiterhin
  End-to-End erstellt und angenommen; Axe-Smoke auf der Einladungsansicht
  ohne „serious"/„critical" Befunde. **Bewusste Designentscheidung:** kein
  echter externer SMTP-Provider und kein zweiter Backend-Prozess für
  E2E — die serverseitige Provider-Injektion/Kompensation ist bereits über
  dieselbe DI-Naht auf Integrationstest-Ebene bewiesen; die Browser-Ebene
  validiert stattdessen das Frontend-Verhalten gegen die exakte reale
  Response-Form. Die vollständige bestehende E2E-Suite (26/26 inkl. dieser
  4) blieb dabei unverändert grün, insbesondere der bereits bestehende
  Einladungs-Akzeptanz-Fluss in `studios.spec.js`.
- **Weitere Regressionsgates:** vollständige Backend-Suite (342 Tests: 221
  Unit, 92 Integration, 29 Migration/Doctor) grün; vollständige
  Frontend-Suite (280 Tests) grün; Produktionsbuild erfolgreich; `npm audit
  --audit-level=high` in Backend und Frontend je 0 Befunde; Migration
  Doctor weiterhin `ready`, `applied:8`, keine neue Migration nötig.

## Bekannte Einschränkungen

- Kein echter Versand in dieser Umgebung nachgewiesen (siehe oben) — nur
  automatisiert mit Fake-Transport getestet.
- Kein Bounce-/Complaint-Handling (Webhooks des Providers) — ein
  abgelehnter Empfänger wird nur beim synchronen Sendeversuch selbst
  erkannt, nicht bei asynchronem Bounce nach erfolgreichem `sendMail()`.
  Der SMTP-Server kann die Annahme bestätigen, obwohl die spätere
  tatsächliche Zustellung an den Empfänger danach trotzdem scheitert
  (z. B. Bounce, Spam-Ablage, volle Mailbox) — das erkennt dieses
  synchrone Modell grundsätzlich nicht.
- Prozessabsturz zwischen erfolgreicher SMTP-Annahme
  (`transport.sendMail()` ist zurückgekehrt) und der finalen
  Applikationsantwort an den Client ist ein inhärentes Risiko des
  synchronen Modells: Die E-Mail wurde vom SMTP-Server bereits
  angenommen, aber der Client könnte theoretisch keine Erfolgsbestätigung
  mehr erhalten. Das ist keine Dateninkonsistenz auf Serverseite (die
  Einladung bleibt korrekt `pending`, exakt wie bei einer normal
  bestätigten Zustellung), sondern ausschließlich ein potenziell
  irreführender Zustand für den anfragenden Client selbst. Keine
  Queue-/Outbox-Worker-Architektur wurde dafür eingeführt (bewusst
  außerhalb des Auftragsumfangs).
- Keine Zustell-Warteschlange/Retry-Queue — bewusst außerhalb des
  Auftragsumfangs (Abschnitt 17: keine E-Mail-Queues, kein Message
  Broker).
- `requestId`-Korrelation ist auf den Einladungs-Versandpfad beschränkt
  (nicht generisch durch jede Service-Schicht gezogen) — ausreichend für
  dieses Feature, keine breitere Refaktorierung vorgenommen.
- Diese Einschränkungen sind bewusste, benannte Grenzen des synchronen
  SMTP-Modells, keine Bugs.

## Nachtrag: unabhängige Release-Gate-Prüfung (2026-07-20)

Eine zweite, unabhängige, kritische Prüfung der bereits implementierten
Stage 2A wurde durchgeführt, ohne die Architektur neu zu entwerfen. Dabei
gefunden und minimal behoben: `SMTP_FROM_NAME` besaß keine Längenbegrenzung
(jetzt 100 Zeichen, wie oben in der Variablentabelle vermerkt). Zusätzlich
empirisch (nicht nur durch Code-Lesen) verifiziert und mit neuen, realistisch
geformten Regressionstests abgesichert:

- Der reale Produktionsprozess (`server.js`) schlägt bei explizit
  aktivierter, aber ungültiger SMTP-Konfiguration nachweislich schon beim
  Start fehl, nicht erst bei der ersten Anfrage — geprüft durch tatsächliches
  Starten des Prozesses, nicht nur durch einen isolierten Unit-Test.
- Der reale Produktionsprozess startet nachweislich erfolgreich mit einem
  syntaktisch gültigen, aber unerreichbaren SMTP-Host, ohne beim Start eine
  echte Verbindung aufzubauen — bestätigt „kein echter E-Mail-Versand beim
  normalen Start" empirisch, nicht nur durch Code-Lesen.
- Ein CRLF-/Header-Injection-Versuch über `SMTP_FROM_NAME`, `SMTP_REPLY_TO`
  und den Studio-Namen (der in die Betreffzeile einfließt) wurde gegen die
  **echte** Nodemailer-Nachrichtenkomposition getestet (nicht nur gegen die
  von diesem Modul aufgerufenen `mailOptions`): Die installierte Version
  (9.0.3) faltet/neutralisiert eingebettete `\r\n`-Sequenzen zuverlässig,
  es entsteht nie eine zusätzliche rohe Header-Zeile. `SMTP_REPLY_TO` wird
  zusätzlich bereits durch die Konfigurationsvalidierung selbst
  zurückgewiesen, bevor ein Provider überhaupt konstruiert wird. Kein
  Produktcode musste hierfür geändert werden.
- Realistisch geformte Nodemailer-Fehlerobjekte (mit `response`,
  `responseCode`, `command`, `rejected`, `rejectedErrors`, `cause`) wurden
  gezielt gegen die Logging-Pipeline getestet: Keines dieser Felder erreicht
  jemals den Logger oder den an den Client zurückgegebenen Fehler — nur die
  intern abgeleitete, sichere Klassifikationszeichenkette.

## Abgrenzung zu Backup-/DB-Härtung

Nicht enthalten und nicht begonnen: Backup-Verschlüsselung, Off-host-
Backups, getrennte Datenbankrollen für Runtime/Migration/Restore — diese
bleiben, wie im Auftrag festgelegt, unverändert offene, separate Punkte
(siehe `FITTRACK_NEXT_PHASE_RECOMMENDATION.md`). Keine weiteren
Produktfunktionen, keine Member-Antworten auf Feedback, keine neue
Einladungsverwaltungs-UI wurden gebaut.
