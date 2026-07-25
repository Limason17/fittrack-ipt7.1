# Stage 3C: Pilot-UX-Politur

Status: abgeschlossen. Branch `feature/stage-3c-pilot-ux-polish`, ausgehend von
`main` (`102b20a`, Stage 3B2 über PR #17 integriert). Kein Merge nach `main`
in dieser Phase; keine neue Phase begonnen.

## 1. Ziel und Scope

Stage 3C behebt die verbleibenden sichtbaren Produkt- und UX-Lücken, die
einem ersten lokalen Pilotkunden auffallen würden: fehlender
Einladungs-Resend, lückenhafte Statusdarstellung, uneinheitliche
Audit-Log-Übersetzung, ein bekannter Dropdown-Textabschneidungs-Fehler und
punktuelle Loading-/Empty-/Error-State-Lücken. Es handelt sich um Politur,
keine Neugestaltung: keine neuen Geschäftsfunktionen, kein Rate-Limiting
außerhalb des neuen Resend-Endpunkts, keine CORS-Änderung, keine
Kontolöschung/Datenexport/Geräteverwaltung, kein Cloud-Hosting.

## 2. Ausgangsbefunde (Analyse vor der Implementierung)

- **Einladungs-Lebenszyklus (vorher):** `createInvitation`, `revokeInvitation`
  und `acceptInvitation` existierten bereits vollständig, inklusive
  Lazy-Expire (Status wird beim Lesen/Schreiben aus `pending` +
  abgelaufenem `expires_at` zu `expired` abgeleitet bzw. geschrieben). Es gab
  **keinen Resend-Endpunkt** und **keine Trainer-Berechtigung** für
  Einladungen (Trainer hatte nie `invitation.*`-Rechte).
- **Fehlende UI-Zustände:** Die Einladungstabelle zeigte nur E-Mail, Rolle,
  Status und einen Revoke-Button; „erstellt am“, „gültig bis" als eigene
  Spalte sowie „eingeladen durch" fehlten vollständig.
- **Audit-Log:** Nur 11 von 26 tatsächlich im Code verwendeten Event-Typen
  hatten eine Übersetzung (`src/utils/i18n.js`, `audit.events`); alle
  Coaching-, Programm-, Zuweisungs-, Workout- und Feedback-Ereignisse
  erschienen als rohe Strings wie `training_program_assignment.completed`.
  Es gab keinen definierten Fallback für unbekannte künftige Event-Typen.
- **ConfirmDialog:** Bereits durchgängig im Einsatz - `grep -r
  "window.confirm" frontend/src` ergab **null Treffer**. Der im
  Stage-3A-Audit (P2-Befund 5) genannte Rückstand in der persönlichen
  Domäne war zum Start dieser Phase bereits behoben (nicht Teil dieser
  Session).
- **Dropdown-Textabschneidung:** Der im Stage-3A-Audit konkret benannte
  Befund (Abschnitt 18, Punkt 1; Abschnitt 20, Stage 3C) betraf
  `StudioSwitcher.vue` in der Sidebar: lange Studionamen/Rollen wurden ohne
  Tooltip abgeschnitten.
- **Fehlerbehandlung beim Einladung-Annehmen:** `INVITATION_INVALID`,
  `INVITATION_EXPIRED`, `INVITATION_REVOKED` und `INVITATION_ALREADY_USED`
  fielen alle auf dieselbe generische Meldung zurück; nur der 403-Fall
  (falsches Konto) hatte eine eigene Meldung.
- **Migrationsbedarf:** Keiner. Der Resend-Endpunkt kommt vollständig ohne
  Schemaänderung aus (Token-Rotation, Status- und Ablaufzeit-Updates nutzen
  ausschließlich bereits vorhandene Spalten von `studio_invitations`).
  **Migration 011 wurde nicht eingeführt.**

## 3. Einladungs-Resend-Vertrag

**Endpunkt:** `POST /api/v1/studios/:studioId/invitations/:invitationId/resend`

**Berechtigung:** `invitation.resend` (neue Permission). Owner (automatisch,
da Owner alle Permissions besitzt) und Admin. **Trainer erhält diese
Permission nicht** - das bestehende Permission-Modell erlaubte Trainern nie
irgendeine `invitation.*`-Aktion, also gilt „nur falls ausdrücklich erlaubt"
hier als nicht erfüllt. Member: nie. Wie bei Create/Revoke wird die Rolle
zusätzlich serverseitig innerhalb der Transaktion gegen die frisch
gesperrte Actor-Zeile erneut geprüft (TOCTOU-Schutz), nicht nur einmalig
durch die Route-Middleware.

**Statusregeln** (siehe `services/studioService.js#resendInvitation`):

| Ausgangsstatus | Verhalten |
|---|---|
| `pending`, nicht abgelaufen | Token wird rotiert, Ablaufzeit erneuert, Status bleibt `pending`. |
| `pending`, abgelaufen (lazy) / `expired` | **Bewusste Design-Entscheidung:** die *gleiche* Zeile wird in-place erneuert (Token rotiert, Status zurück auf `pending`, neue Ablaufzeit) statt eine zweite, konkurrierende Einladung zu erzeugen. Es entsteht **keine Dublette**. |
| `accepted` | `409 INVITATION_ALREADY_ACCEPTED`. Keine Reaktivierung. |
| `revoked` | `409 INVITATION_REVOKED`. **Widerrufene Einladungen werden nie still reaktiviert** - dieser Zweig wird vor jeder Mutation geprüft. |
| E-Mail bereits aktives Mitglied | `409 INVITATION_EMAIL_ALREADY_MEMBER` (gleiche Prüfung wie bei `createInvitation`, gegen Race mit einer parallelen Mitgliedschaft). |
| Fremdes/unbekanntes Studio oder ID | `404 INVITATION_INVALID` - **ununterscheidbar** vom „existiert nicht"-Fall (kein Enumeration-Signal). |
| Ein anderer, gleichzeitig gestarteter Resend hat die Zeile bereits rotiert | `409 INVITATION_RESEND_CONFLICT` (neu, siehe Abschnitt 5). |

`INVITATION_NOT_RESENDABLE` bleibt als generischer Default-Zweig für jeden
Status außerhalb der vier bekannten Werte reserviert (aktuell durch das
`INVITATION_STATUSES`-Enum unerreichbar, gleiche defensive Konvention wie
`invitationStateError`s Default-Zweig).

**`INVITATION_ALREADY_PENDING`:** wird von Resend weiterhin nicht verwendet
(bei Resend ist „pending" der erwartete Zielzustand, kein Konfliktfall). Der
Code selbst ist aber **kein toter Code** - er wird von `createInvitation`
tatsächlich geworfen, wenn für dieselbe E-Mail bereits eine pendente
Einladung existiert. Diese Session hat dafür einen bisher fehlenden
Integrationstest ergänzt (`test/integration/studioApi.test.js`, „creating a
second invitation for an e-mail with an existing pending invitation is
rejected as INVITATION_ALREADY_PENDING"), damit sein Vertrag nicht nur
korrekt, sondern auch nachweislich getestet ist.

## 4. Tokenwechsel

Wiederverwendet: `security/invitationTokens.js#createInvitationToken` (32
zufällige Bytes, SHA-256-Hash, Base64url, exakt dieselbe Funktion wie bei
Create). **Der alte Token wird beim Commit der Rotations-Transaktion
unbedingt ungültig** - unabhängig vom Ausgang des anschließenden
Mailversands, da `token_hash` bereits überschrieben ist, sobald die
DB-Transaktion committet. Kein Token verlässt den Server in Logs, API-Response
oder Fehlermeldungen (nur `role`/`expiresAt` im Audit-Detail; Konflikt- und
Fehlermeldungen sind statische Texte ohne Tokenwert - durch Test verifiziert:
`doesNotMatch(..., /[A-Za-z0-9_-]{43}/)` auf jede Verlierer-Fehlermeldung).

Der bei einem fehlgeschlagenen Zustellversuch neu erzeugte Token wird
ebenfalls nie nutzbar (siehe Abschnitt 6) - `token_hash` bleibt zwar auf der
Zeile stehen (Kompensation ändert nur `status`/`expires_at`, nicht
`token_hash`), aber ein Annahmeversuch mit diesem Token liefert konsistent
`410 INVITATION_EXPIRED`, exakt dieselbe ehrliche Antwort wie bei jeder
anderen abgelaufenen Einladung - kein irreführendes „ungültiger Token" und
kein funktionierender Token.

## 5. Parallelitätsverhalten (gehärtet)

**Vorherige Fassung (unzureichend):** `SELECT ... FOR UPDATE` allein
serialisierte zwar den Datenbankzugriff, verhinderte aber nicht, dass
mehrere gleichzeitig gestartete Resend-Aufrufe nacheinander alle
erfolgreich rotierten - jeder mit eigenem Mailversand und eigenem
Audit-Event. Nur der *letzte* Token blieb am Ende gültig, aber der Weg
dorthin verschickte mehrere E-Mails und erzeugte mehrere Audit-Einträge.

**Gehärteter Mechanismus - atomares Compare-and-Swap:**

1. Vor jeder Sperre wird der aktuell persistierte `token_hash` der
   Einladung gelesen (`sql.query`, außerhalb jeder Transaktion, also nicht
   durch `lockActorMembership` blockiert) - das ist die *Baseline*, die
   alle zeitgleich gestarteten Aufrufe gemeinsam beobachten, selbst wenn
   sie anschließend durch dieselbe Aktor-Zeilensperre serialisiert werden.
2. Die eigentliche Rotation ist eine bedingte `UPDATE ... WHERE studio_id=?
   AND public_id=? AND token_hash=<Baseline>`-Anweisung. Nur wenn
   `affectedRows === 1`, hat dieser Aufruf gewonnen.
3. `affectedRows === 0` bedeutet: ein anderer, zeitgleich gestarteter
   Aufruf hat die Zeile bereits rotiert, bevor dieser Aufruf seine eigene
   Sperre erhalten hat → `409 INVITATION_RESEND_CONFLICT`. Ein echter
   Statuswechsel (z. B. zwischenzeitlicher Widerruf) wird weiterhin *vor*
   diesem Vergleich anhand des aktuell gesperrten Zustands erkannt und mit
   seinem eigenen, spezifischeren Code gemeldet (`INVITATION_REVOKED` /
   `INVITATION_ALREADY_ACCEPTED`) - der Konfliktcode ist ausschließlich für
   den reinen „ein anderer Resend war schneller"-Fall reserviert.
4. Der E-Mail-Versand (`outbox.publish`) wird **ausschließlich** vom
   Gewinner aufgerufen - Verlierer erreichen diesen Code-Pfad nie.
5. Das `invitation.resent`-Audit-Event wird **nicht** innerhalb der
   Rotations-Transaktion geschrieben, sondern erst **nach** einem
   bestätigt erfolgreichen Mailversand (siehe Abschnitt 6) - so entsteht
   nie ein Audit-Eintrag für einen Versuch, dessen Zustellung fehlschlägt.

**Empirisch bewiesene Garantien** (`test/integration/studioApi.test.js`,
drei echte parallele Aufrufe über `Promise.allSettled` gegen dieselbe
Einladung, mit einem Spy-fähigen SMTP-Provider statt des Dev-Preview-Pfads,
damit tatsächliche Provider-Aufrufe zählbar sind):

- genau 1 von 3 Aufrufen liefert Erfolg, die anderen 2 liefern `409
  INVITATION_RESEND_CONFLICT`;
- der Mailprovider wird **exakt einmal** aufgerufen;
- **genau ein** `invitation.resent`-Audit-Event entsteht für die ganze
  Gruppe;
- nur der Token aus der tatsächlich versendeten E-Mail funktioniert
  (Annahme über die reale Accept-Route verifiziert);
- kein Tokenwert in einer Verlierer-Fehlermeldung.

**Deadlock-Sonderfall:** wenn der Gewinner-Aufruf *selbst* einen
Zustellfehler hat, läuft die in Abschnitt 6 beschriebene Kompensation in
einer eigenen, späteren Transaktion. Da zu diesem Zeitpunkt die
Verlierer-Transaktionen teils noch ihre eigene (letztlich erfolglose)
CAS-Anweisung gegen dieselbe Zeile ausführen, kann InnoDB hier einen echten
`ER_LOCK_DEADLOCK` melden - dies ist kein Zeichen eines fehlerhaften
CAS-Entwurfs, sondern ein bekanntes, unter genau dieser Verschränkung
zweier unabhängiger Transaktionen normales InnoDB-Verhalten.
`compensateResendDeliveryFailure` fängt `ER_LOCK_DEADLOCK` ab und
wiederholt die Kompensation bis zu dreimal mit einer frischen Transaktion -
der bei einem Deadlock abgebrochene Vorgang ist immer sicher wiederholbar,
da die jeweils andere Transaktion zu diesem Zeitpunkt bereits
committet/zurückgerollt wurde. Durch einen dedizierten Integrationstest
(„a concurrent resend winner whose own delivery then fails...") verifiziert:
genau 1 Zustellfehler, genau 2 Konflikte, der Provider genau einmal
aufgerufen, kein `invitation.resent`-Event, und ein anschließender Retry
mit funktionierendem Transport gelingt normal.

Ein Rate-Limiter (siehe Abschnitt 7) begrenzt zusätzlich, wie oft dasselbe
Aktor-Einladung-Paar das überhaupt versuchen darf - er ersetzt die
CAS-Garantie nicht, sondern ergänzt sie um einen Schutz gegen wiederholten
Missbrauch außerhalb einer einzelnen Parallelitäts-Gruppe.

## 6. Mailfehlerverhalten (gehärtet)

**Vorherige Fassung (ungeeignet):** ein Zustellfehler beim Resend setzte die
Einladung auf `revoked` - dauerhaft, nie wieder resendbar. Ein rein
temporärer Mailausfall hätte damit eine zuvor funktionierende Einladung
endgültig unbrauchbar gemacht.

**Gehärtetes Verhalten:** `compensateResendDeliveryFailure` (getrennt von
`compensateInvitationDeliveryFailure`, das weiterhin ausschließlich von
`createInvitation` genutzt wird) setzt bei einem Zustellfehler:

- `status = 'expired'` (**nie** `revoked`);
- `expires_at` auf einen bereits abgelaufenen Zeitpunkt;
- `token_hash` bleibt unverändert (siehe Abschnitt 4 - der beim
  fehlgeschlagenen Versuch erzeugte Token bleibt auf der Zeile stehen, wird
  aber durch den Statuswechsel nie akzeptiert);
- ein `invitation.delivery_failed`-Audit-Event (unverändert gegenüber der
  bisherigen Konvention);
- **kein** `invitation.resent`-Event für den fehlgeschlagenen Versuch.

Die Kompensation ist auf `token_hash = <der von diesem Aufruf erzeugte
neue Hash>` **und** `status = 'pending'` bedingt - so kann sie niemals eine
inzwischen durch einen anderen, späteren (nicht mit diesem Versuch
konkurrierenden) Resend bereits erneut rotierte Zeile überschreiben.

Der Client erhält weiterhin `502 INVITATION_DELIVERY_FAILED` bzw. `503
INVITATION_DELIVERY_RECOVERY_FAILED`, falls sogar die Kompensation
fehlschlägt (nach den in Abschnitt 5 beschriebenen Deadlock-Retries). Da
die Einladung dabei auf denselben `expired`-Zustand fällt, den eine ganz
gewöhnlich abgelaufene Einladung auch hätte, ist sie **sofort wieder
resendbar** - ein zweiter Resend mit funktionierendem Transport rotiert
den Token erneut und gelingt normal, ohne Sonderbehandlung. Es entsteht
**nie** ein Zustand, der wie ein erfolgreicher Resend aussieht, obwohl die
Zustellung fehlgeschlagen ist, und **nie** eine dauerhaft blockierte
Einladung. Durch einen dedizierten Integrationstest verifiziert (alter
Token abgelehnt, neu erzeugter Token liefert `410 INVITATION_EXPIRED` statt
funktionsfähig zu sein, Status `expired` mit `revoked_at IS NULL`, genau
ein `delivery_failed`- und null `resent`-Events für den fehlgeschlagenen
Versuch, danach erfolgreicher Retry mit genau einem `resent`-Event).

## 7. Berechtigungen (Zusammenfassung)

| Rolle | List | Create | Revoke | Resend |
|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | ✓ |
| Admin | ✓ | ✓ | ✓ | ✓ |
| Trainer | ✗ | ✗ | ✗ | ✗ |
| Member | ✗ | ✗ | ✗ | ✗ |

Zusätzlich gilt weiterhin `invitationRoleDecision`: Admin darf nur
`trainer`/`member`-Einladungen resenden, Owner zusätzlich `admin`.

## 8. Audit-Event-Übersetzungen

Zentrale Zuordnung bleibt `src/utils/i18n.js`, Schlüssel `audit.events`
(DE und EN parallel gepflegt). 15 zuvor fehlende Event-Typen ergänzt:
`invitation.resent`, `coaching_relationship.created/ended`,
`training_program.created/updated/archived`,
`training_program_version.created/published`,
`training_program_assignment.created/completed/cancelled`,
`workout_session.started/completed/aborted`, `workout_feedback.created`.
Damit sind jetzt **alle** Event-Typen übersetzt, die
`audit/studioAudit.js`s `SAFE_DETAIL_KEYS`-Registry kennt.

**Fallback für unbekannte künftige Events:**
`StudioAuditView.vue#eventLabel` zeigt für jeden nicht in der Tabelle
gefundenen Typ `t('audit.unknownEvent', { type: eventType })` -
„Weiteres Ereignis ({type})" / „Other event ({type})" - statt den rohen
String unkommentiert auszugeben oder abzustürzen.

`details_json` wird weiterhin **nicht** ungefiltert gerendert (unverändert
gegenüber vorher) - nur `eventType`, `actor.username`, `targetType`,
`createdAt` erscheinen in der Tabelle; die serverseitige
Allowlist/Sanitisierung (`sanitizeAuditDetails`,
`allowlistedAuditDetails`) bleibt die alleinige Verteidigungslinie gegen
Token-/Secret-Leaks im Audit-Trail.

Zusätzlich: `listInvitations` liefert jetzt `invitedBy: { username } |
null` (LEFT JOIN auf `invited_by_user_id`), sichtbar nur für Owner/Admin
(einzige Rollen mit `invitation.list`), ohne neue Datenschutz-Exposition
gegenüber der bereits vorhandenen vollen Mitgliederliste.

## 9. Statusdarstellung und Einladungsliste

`StudioInvitationsView.vue`s Tabelle zeigt jetzt: E-Mail (+ „eingeladen
von" als sekundäre Zeile, falls bekannt), Rolle, Status, **Erstellt am**,
**Gültig bis** (beide neu als eigene Spalten), Aktionen. Aktionen:
`pending`/`expired` → Resend-Button (+ Revoke nur bei `pending`);
`accepted`/`revoked` → „Keine Aktion verfügbar" statt leerer Fläche oder
eines technisch unmöglichen Buttons. Resend- und Revoke-Buttons
deaktivieren sich gegenseitig während einer laufenden Anfrage der jeweils
anderen Aktion sowie bei doppeltem Klick auf sich selbst.

**Wichtige begleitende Backend-Korrektur:** Da `expired`-Einladungen jetzt
über Resend aktionabel sind, musste die serverseitige E-Mail-Maskierung in
`listInvitations` erweitert werden - vorher wurde die E-Mail nur bei
`pending AND nicht abgelaufen` mitgeliefert, wodurch ein Admin bei einer
abgelaufenen Einladung nicht mehr sehen konnte, an wen er sie erneut
sendet. Jetzt: E-Mail sichtbar für `pending` **und** `expired`, weiterhin
redigiert bei `accepted`/`revoked` (echte Terminalzustände).

Alle Statuscodes/UUIDs bleiben clientseitig unsichtbar - nur übersetzte
Badges, keine rohen Werte.

## 10. ConfirmDialog-Konvention

Resend erhält denselben Umgang wie Revoke: eigener `pendingResend`-Ref,
eigenes `ConfirmDialog` (Titel „Einladung erneut senden?", Beschreibung
nennt die betroffene E-Mail, `tone="primary"` da nicht destruktiv im Sinne
von Datenverlust, aber sicherheitsrelevant wegen der Tokenrotation -
bewusst mit Bestätigung abgesichert, wie in Abschnitt 8 der Vorgabe
gefordert). Fokus-Handling, Escape, Backdrop-Klick und
Doppel-Submit-Schutz kommen unverändert aus der bestehenden
`ConfirmDialog.vue`/`useModalFocus`-Infrastruktur - keine Änderung an der
Komponente selbst nötig. Alle bereits benannten Pilot-Flows
(Coaching-Ende, Zuweisungs-Abbruch, Logout-All) nutzten das gemeinsame
`ConfirmDialog.vue` bereits vor dieser Session; keine weitere Konvertierung
nötig.

## 11. Responsive Korrekturen

- **Stage-3A-Audit-Fund (konkret benannt):** `StudioSwitcher.vue`
  (Sidebar-Dropdown) schnitt lange Studionamen/Rollen ohne Tooltip ab.
  Behoben durch `title`-Attribut auf dem `<select>` (aktueller
  Auswahlwert) und auf jeder `<option>` (voller Wert beim Aufklappen) -
  minimaler, gezielter Fix ohne Layoutänderung.
- **Neue gemeinsame Utility-Klasse** `.studio-truncate`
  (`frontend/src/assets/studios.css`): Ellipsis mit `max-width: min(100%,
  260px)` auf breiten Viewports (echte Tabellenspalten), fällt unterhalb
  des `.table-stack`-Breakpoints (720px) automatisch auf das bestehende
  Wrap-Verhalten (`overflow-wrap: anywhere`) zurück, da dort keine feste
  Spaltenbreite mehr existiert, gegen die getrunkiert werden könnte. Jede
  Verwendung trägt ein `title`-Attribut mit dem vollständigen Wert
  (zugänglicher Volltext per Tooltip, wie gefordert). Angewendet auf:
  Einladungs-E-Mail/„eingeladen von" (`StudioInvitationsView.vue`),
  Mitgliedsname/E-Mail (`StudioMembersView.vue`), Audit-Ereignis/Akteur
  (`StudioAuditView.vue`).
- Keine globale `overflow-x: hidden`-Maskierung eingeführt oder vorgefunden
  (`grep -r "overflow-x: hidden" frontend/src` → keine Treffer). Keine
  4-10px-Breiten-Hacks.
- 390px-Abdeckung der Studio-Verwaltungsseiten (`members`, `invitations`,
  `audit`, `coaching`) war zuvor nicht Teil der dedizierten
  Overflow-E2E-Tests (nur Teil des allgemeinen Axe-Scan-Loops bei
  Desktop-Breite) - jetzt explizit in `e2e/adminPilotWalkthrough.spec.js`
  abgedeckt (siehe Abschnitt 13).

## 12. Loading-/Empty-/Error-States

Bestehende Konvention (Skeleton-Loading, `EmptyState`-Komponente,
`message-error`/`message-success`, Toasts) unverändert wiederverwendet -
kein neues UI-Pattern eingeführt. Neu abgedeckte Fälle:

- **Resend läuft:** eigener `resendingId`-Ref, Spinner im Button, Button
  während der Anfrage deaktiviert (Doppel-Klick-Schutz).
- **Resend-Fehler nach Code:** `INVITATION_ALREADY_ACCEPTED`,
  `INVITATION_REVOKED`, `INVITATION_NOT_RESENDABLE`,
  `INVITATION_EMAIL_ALREADY_MEMBER`, `INVITATION_RESEND_RATE_LIMITED`
  (siehe unten), `INVITATION_DELIVERY_FAILED`/`_RECOVERY_FAILED` haben
  jeweils eine eigene, verständliche deutsche/englische Meldung statt
  eines rohen Codes.
- **429 (Rate Limit):** `RateLimitError` unterstützt jetzt einen
  optionalen, pro Limiter konfigurierbaren `code` (Default weiterhin
  `RATE_LIMIT_EXCEEDED` für alle bestehenden Limiter, unverändert). Der
  neue Resend-Limiter setzt `INVITATION_RESEND_RATE_LIMITED`, mit eigener
  Frontend-Meldung („Zu viele Versuche. Bitte versuche es in ein paar
  Minuten erneut.").
- **Einladung annehmen - Fehler nach Code:** vorher nur 403 vs. generisch;
  jetzt zusätzlich `INVITATION_INVALID`, `INVITATION_EXPIRED`,
  `INVITATION_REVOKED`, `INVITATION_ALREADY_USED` mit je eigener Meldung
  (`InvitationAcceptView.vue`).
- 401/Session-Ungültigkeit während einer Aktion, Netzwerkfehler:
  unverändert über die bestehende, app-weite Refresh-und-Retry-Logik in
  `utils/api.js` sowie die bereits vorhandene `reconcileStudioAccess`-
  Behandlung von 403/404 in jeder Studio-Ansicht abgedeckt - kein neuer
  Code nötig, durch die neuen Tests mitverifiziert.

## 13. Admin-Live-Durchlauf

`e2e/adminPilotWalkthrough.spec.js` führt den vollständigen, im Auftrag
genannten 20-Schritte-Ablauf **real gegen den lokalen Dev-Stack** aus (echter
Chromium-Browser, echtes Backend, echte MySQL-Datenbank) - nicht nur
Code-Review wie im Stage-3A-Audit:

Owner erstellt Studio → Admin eingeladen → Admin nimmt an → Mitgliederliste
öffnen → Trainer einladen → Mitglied einladen → Resend auslösen → Einladung
widerrufen (Wegwerf-Einladung) → Coaching-Beziehung erstellen (Admin als
Coach, damit die Ergebnis-/Feedback-Berechtigung für Admin real greift) →
Programm erstellen → Entwurfsversion + Trainingstag + Übung bearbeiten →
veröffentlichen → Mitglied zuweisen → Mitglied absolviert die Einheit
(API) → Admin sieht Resultate → Admin gibt Feedback → Audit-Log zeigt
übersetzte Labels → Owner-exklusive Funktion (Slug-Änderung) ist für Admin
sowohl UI-seitig deaktiviert als auch serverseitig mit `403
INSUFFICIENT_STUDIO_ROLE` verboten → ein zweites, fremdes Studio bleibt für
Admin mit `404 STUDIO_NOT_FOUND` vollständig isoliert → Mobile-Smoke bei
390px auf vier Kernseiten ohne horizontalen Overflow und ohne
serious/critical Axe-Befund.

**Owner-/Admin-Abweichungen:** keine funktionalen Abweichungen gefunden
außer der bereits im Permission-Modell dokumentierten (Admin darf keine
Owner-Rolle vergeben/entziehen, keinen Slug ändern, keine
`STUDIO_SETTINGS_OWNER`-Felder bearbeiten). Keine Rollenlogik wurde in
dieser Phase erweitert oder geändert.

## 14. Mobile und Accessibility

390×844-Abdeckung für `/members`, `/invitations`, `/audit`, `/coaching`
neu in `adminPilotWalkthrough.spec.js` (kein horizontaler Dokument-Overflow,
kein serious/critical Axe-Befund). Tastaturbedienung des neuen
Resend-Flows (Fokus, Enter öffnet Dialog, Escape schließt ihn) per E2E
verifiziert; Fokus-Rückgabe an den auslösenden Button nach Abbruch zusätzlich
komponentenseitig in `StudioInvitationsView.test.js` getestet. Axe-Smoke auf
der Audit-Seite in `invitationResend.spec.js` ergänzt.

## 15. Tests

**Backend:** neue Unit-Abdeckung für den Resend-Rate-Limiter
(`test/unit/rateLimiter.test.js`) und die `invitation.resent`-Audit-Detail-
Allowlist (`test/unit/studioSecurity.test.js`); neue Router-Ebene-Tests für
Berechtigung/Validierung (`test/unit/studioRouter.test.js`); sechs neue
Integrationstests gegen eine echte MySQL-Instanz
(`test/integration/studioApi.test.js`): erfolgreicher Resend inkl.
Tokenwechsel, Resend einer abgelaufenen Einladung ohne Dublette,
Ablehnung bei accepted/revoked/bereits-aktivem-Mitglied ohne
Seiteneffekt, drei parallele Resends mit genau einem gültigen
Endzustand, Rate-Limit-Grenze. Eine bestehende Test-Erwartung
(E-Mail-Sichtbarkeit in der Liste) wurde an die erweiterte
Maskierungsregel angepasst (Abschnitt 9).

**Frontend:** 15 (davon 6 neu) Tests in `StudioInvitationsView.test.js`
(Resend-Sichtbarkeit je Status, Bestätigungsdialog, Doppel-Klick-Schutz,
vier Fehlercode-Meldungen, lange Texte über `title`, Fokus-Rückgabe); 5
(davon 2 neu) in `StudioAuditView.test.js` (alle 15 neuen Event-Typen
übersetzt, sicherer Fallback für unbekannte Typen); neue Datei
`InvitationAcceptView.test.js` (4 Tests: vier Fehlercodes, Doppel-Klick-
Schutz).

**E2E:** zwei neue Spec-Dateien. `invitationResend.spec.js` (Owner→Admin→
Trainer-Einladung→Resend→alter Link tot→neuer Link funktioniert→
Zweitverwendung abgelehnt→Widerruf bleibt sicher→Audit-Log lesbar).
`adminPilotWalkthrough.spec.js` (der volle 20-Schritte-Durchlauf,
Abschnitt 13). Beide grün, gemeinsam mit der vollständigen bestehenden
Suite (39/39 Chromium-E2E-Tests insgesamt).

## 16. Bekannte Grenzen

- **`INVITATION_ALREADY_PENDING` bei Resend nicht erreichbar** - bewusst,
  siehe Abschnitt 3.
- **Persönliche Domäne (Übungen/Workouts/Fortschritt)** nutzt weiterhin
  keine `EmptyState`-Komponente für ihre Listen (nur die Studio-Domäne
  wurde in dieser und vorherigen Phasen darauf umgestellt) - der im
  Stage-3A-Audit für „Stage 3C" vorgeschlagene volle Domänen-Umzug wurde
  gemäß expliziter Vorgabe dieser Session („keine sachfremde Alt-Domäne
  vollständig refaktorieren") nicht durchgeführt. `window.confirm()` war
  in dieser Domäne bereits vor Beginn dieser Session vollständig durch
  `ConfirmDialog` ersetzt (nicht Teil dieser Session).
- **Rate-Limiting weiterhin In-Memory pro Prozess** (unverändert seit
  Stage 3A-Audit-Befund 6) - bei mehreren Backend-Instanzen nicht geteilt;
  für den Resend-Limiter genauso wie für die bestehenden Auth-Limiter.
  Ausweitung/Härtung bleibt explizit Stage 3D vorbehalten.
- **Migration 011** nicht eingeführt (nicht erforderlich).
- Stage 2B2B (echter S3-Bucket) bleibt *deferred until first customer /
  production deployment*, unverändert.

## 17. Bezug zu Folgephasen

Stage 3D bleibt separat für: Rate-Limiting-Härtung auf weitere Endpunkte,
CORS-Gesamtaudit, Bereinigung von totem Policy-Code
(`coachActionEligibility`). Keine dieser Aufgaben wurde in Stage 3C
begonnen.

## 18. Nachtrag: Cross-Tab-Refresh-Race-Härtung (2026-07-25)

Der vollständige Chromium-E2E-Lauf zeigte einen echten, reproduzierbaren
Fehlschlag in `e2e/authSession.spec.js` („two tabs of the same browser
context refreshing at nearly the same moment never treat a legitimate user
as token theft"): beide Tabs wurden fälschlich als Token-Diebstahl behandelt
(`AUTH_REFRESH_REUSE_DETECTED` → `AUTH_SESSION_INVALIDATED`) und nach
`/login` umgeleitet, obwohl es sich um einen vollständig legitimen Ablauf
handelte. Dieser Abschnitt dokumentiert Ursache, Fix und Stabilitätsnachweis;
der ursprüngliche (jetzt überholte) Mechanismus bleibt in
`STAGE_3B2_SESSION_HARDENING.md` Abschnitt 9 als historischer Stand mit
Verweis hierher stehen.

### Root Cause

`frontend/src/utils/api.js`s bisheriger Cross-Tab-Mutex
(`tryAcquireRefreshLock`) folgte dem Muster „lies `localStorage`, prüfe ob
ein Lock existiert, schreibe wenn nicht, lies zur Bestätigung erneut". Das
ist **keine atomare Exklusivitätsgarantie über zwei Tab-Prozesse hinweg**:

1. Tab A liest `localStorage` → kein Lock vorhanden.
2. Tab B liest `localStorage` (bevor A geschrieben hat) → **ebenfalls** kein
   Lock vorhanden.
3. Tab A schreibt seinen Lock-Eintrag.
4. Tab B schreibt seinen Lock-Eintrag — **überschreibt A's Eintrag
   kommentarlos**.
5. Tab A's eigener Bestätigungs-Readback lief möglicherweise bereits
   *vor* Schritt 4 und hatte da noch A's eigenen, damals noch aktuellen
   Eintrag gesehen → Tab A hält sich fälschlich für den Owner.
6. Tab B's Bestätigungs-Readback (nach Schritt 4) sieht B's eigenen Eintrag
   → Tab B hält sich (korrekt für seine eigene Schreibaktion, aber ohne
   Wissen von A) ebenfalls für den Owner.

Beide Tabs rufen daraufhin **echt gleichzeitig** `POST /api/auth/refresh`
mit demselben, noch nicht rotierten Refresh-Cookie auf. Der Backend-seitige
Rotationsmechanismus ist strikt Einmalverwendung (siehe
`services/sessionService.js#rotateRefreshToken`); der zweite der beiden
tatsächlich beim Server ankommenden Aufrufe sieht einen bereits rotierten
Token und wird — korrekt und **unverändert weiterhin so** — als
Reuse-Versuch behandelt. Das Timing-Fenster ist eng, aber unter echter
Cross-Prozess-Nebenläufigkeit (zwei Tabs = zwei Renderer-Prozesse) real
und mit `--repeat-each` zuverlässig reproduzierbar.

**Warum der bisherige Lock nicht ausreichte:** `localStorage` bietet keine
Compare-and-Swap-Operation. Ein Read-then-Write-Muster kann über zwei
unabhängige Prozesse hinweg grundsätzlich nicht exklusiv sein, egal wie der
Bestätigungs-Readback im Detail gestaltet ist — er bestätigt nur „das war
mein letzter Schreibvorgang", nicht „ich bin seit meinem ersten Lesen
ununterbrochen der einzige Schreiber gewesen".

### Endgültiger Cross-Tab-Mechanismus

**Primär: `navigator.locks`** (Web Locks API). Der Browser selbst verwaltet
eine exklusive, Origin-weite Sperre über alle Tabs/Worker hinweg — es gibt
keinen Read-then-Write-Moment, den zwei Prozesse racen könnten, da die
Warteschlangen-/Exklusivitätslogik vollständig browserseitig läuft. Ein
Halter, dessen Tab geschlossen wird oder navigiert, gibt die Sperre
automatisch frei — kein manueller Stale-Lease-Mechanismus nötig.

**Fallback** (nur für Umgebungen ohne `navigator.locks`, z. B. sehr alte
Browser) in `frontend/src/utils/api.js#withFallbackRefreshLock`: eindeutige
Owner-ID, 5-Sekunden-Lease-Ablauf, Generation/Fencing-Zähler,
Kandidaten-Schreibvorgang gefolgt von einer kurzen randomisierten
Settle-Verzögerung und einem Readback zur Erkennung eines
Gleichzeitigkeits-Konflikts, Jitter-Backoff-Retry statt Spin-Loop, und —
der wichtigste zusätzliche Schutz — eine **erneute** Eigentümer-Prüfung
unmittelbar bevor der Aufrufer zum Netzwerkrequest zugelassen wird. Ohne
jegliche Storage-Möglichkeit (z. B. striktem Privacy-Modus) degradiert der
Fallback bewusst zu „direkt ausführen, keine Koordination möglich" statt
endlos zu blockieren oder zu werfen.

### Owner-Ablauf

1. `navigator.locks.request('fittrack-refresh-lock', fn)` (oder der
   Fallback-Erwerb) liefert den Zuschlag.
2. `performRefresh()` läuft: CSRF-Cookie lesen, `POST /api/auth/refresh`
   mit `credentials:'include'`, Antwort inklusive `Set-Cookie`-Verarbeitung
   vollständig abwarten (durch `await fetch(...)` plus `await
   response.json()` — der Browser wendet `Set-Cookie` als Teil der
   Response-Verarbeitung an, bevor das `fetch()`-Promise auflöst).
3. Erst wenn dieses Promise vollständig aufgelöst (oder abgelehnt) ist,
   gibt `navigator.locks` die Sperre für den nächsten Wartenden frei — es
   gibt **keinen separaten Broadcast-Schritt** für die Web-Locks-Variante,
   die Freigabe der Sperre selbst ist bereits das atomare Signal.

### Waiter-Ablauf

1. Sperre nicht sofort erhalten → der Browser reiht die Anfrage ein
   (Web Locks) bzw. der Fallback erkennt einen lebenden Lease und wartet.
2. Während der Wartezeit wird **kein** eigener Netzwerkrequest gesendet.
3. Sobald der Owner fertig ist (Sperre freigegeben), erhält der wartende
   Aufruf die Sperre neu zugeteilt bzw. gewinnt seinen eigenen
   Erwerbsversuch.
4. Er führt **danach** `performRefresh()` selbst aus — mit dem inzwischen
   im geteilten Cookie-Jar bereits rotierten Cookie, das automatisch
   browserseitig mitgeschickt wird (`credentials:'include'`) — und erhält
   dadurch sein eigenes, gültiges In-Memory-Access-Token.
5. Kein Token- oder Cookiewert wird dabei je zwischen Tabs übertragen —
   jeder Tab führt seinen eigenen Refresh-Request aus.

### Set-Cookie-/Broadcast-Reihenfolge

Für den `navigator.locks`-Pfad: die Sperre wird ausschließlich vom Browser
selbst verwaltet, und die Freigabe erfolgt erst, nachdem das `fn()`-Promise
(inklusive der bereits abgeschlossenen `Set-Cookie`-Verarbeitung) aufgelöst
ist — Reihenfolge ist dadurch strukturell garantiert, nicht durch eine
zusätzliche Nachricht erzwungen. Für den Fallback-Pfad postet
`withFallbackRefreshLock` sein `refresh-lock-released`-Broadcast ebenfalls
erst im `finally`-Block, nachdem `fn()` (also `performRefresh()` inklusive
vollständig verarbeiteter Antwort) abgeschlossen ist.

### Abbruch- und Ablaufverhalten

- **Owner-Tab wird während des Refreshs geschlossen**: `navigator.locks`
  gibt die Sperre browserseitig automatisch frei; kein anderer Tab bleibt
  blockiert. Für den Fallback: ein `finally`-Block gibt den Lock frei,
  sobald `fn()` (egal ob erfolgreich oder mit Fehler) abschließt; sollte
  ein Tab wirklich mitten im Vorgang beendet werden, verfällt sein
  Lease-Eintrag spätestens nach 5 Sekunden.
- **Owner-Refresh liefert 401/403/Netzwerkfehler**: `performRefresh()`
  wirft, die Sperre wird trotzdem freigegeben (Fallback: `finally`;
  Web Locks: automatisch bei Promise-Ablehnung), der nächste Wartende
  erhält seine Chance regulär.
- **Hängender Request**: ein `AbortController`-Timeout (8 s) in
  `performRefresh()` begrenzt, wie lange ein einzelner Versuch die Sperre
  maximal halten kann, unabhängig vom Locking-Mechanismus.
- **Veralteter Lock/veralteter Broadcast**: der Fallback prüft die
  Eigentümerschaft unmittelbar vor dem Netzwerkrequest erneut; ein
  verpasster oder verspäteter Broadcast führt höchstens zu einem
  zusätzlichen Retry-Zyklus mit Backoff, nie zu einem dauerhaften Blockieren
  (durch die 5-Sekunden-Lease-Obergrenze).
- **Drei Tabs**: durch Unit-Test verifiziert — alle drei erhalten
  nacheinander ihre eigene Ausführung, nie mehr als eine gleichzeitig aktiv.
- **Zwei unabhängige Browser-Kontexte**: unverändert getrennte
  Cookie-Jars, unverändert unabhängige Sitzungen — kein
  Koordinationsfall, kein Verhalten geändert.

### Beweis: keine Tokenübertragung zwischen Tabs

Sowohl der Fallback-Lock-Eintrag in `localStorage` (`{owner, ts,
generation}` — geprüft per Unit-Test auf exakt diese drei Felder, keine
weiteren) als auch jede `BroadcastChannel`-Nachricht (`{type: '...'}`,
ebenfalls per Unit-Test auf exakt dieses eine Feld geprüft) enthalten
nachweislich keinen Token-, Cookie- oder JWT-förmigen Wert. Jeder Tab ruft
seinen eigenen `/auth/refresh`-Request auf; das einzig „Geteilte" ist der
vom Browser selbst verwaltete HttpOnly-Cookie-Speicher, nicht JavaScript-
Zustand.

### Stabilitätsnachweis

- `authSession.spec.js`, gezielter Test, **20/20** Wiederholungen grün,
  keine `AUTH_REFRESH_REUSE_DETECTED`, kein Login-Bounce, beide Tabs
  authentifiziert, `refreshResults.length > 0` und jede Antwort `200` in
  jedem der 20 Läufe.
- Vollständige Chromium-E2E-/Axe-Suite: **zwei isolierte Läufe, je
  39/39 grün, 0 fehlgeschlagen, 0 übersprungen.**
- 17 neue/aktualisierte Frontend-Unit-Tests (`api.test.js`,
  `refreshCoordination.test.js`) decken exklusiven Erwerb bei zwei/drei
  gleichzeitigen Anfragen, Warten ohne eigenen Request, sequenziellen
  Refresh nach Owner-Erfolg, erneute Eigentümerprüfung vor dem
  Netzwerkrequest, Übernahme eines abgelaufenen Leases, Nicht-Übernahme
  eines aktiven Leases, Freigabe nach Owner-Abbruch/-Fehler, Delegation an
  `navigator.locks` und die Token-Freiheit von Storage/Broadcast ab.
- Backend-Reuse-Detection selbst wurde **nicht verändert** — die Härtung
  betrifft ausschließlich, wie viele tatsächliche Refresh-Requests ein
  legitimer Cross-Tab-Ablauf erzeugt, nicht wie das Backend einen
  wiederverwendeten Token erkennt oder behandelt.
