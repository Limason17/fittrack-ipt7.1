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

`INVITATION_NOT_RESENDABLE` bleibt als generischer Default-Zweig für jeden
Status außerhalb der vier bekannten Werte reserviert (aktuell durch das
`INVITATION_STATUSES`-Enum unerreichbar, gleiche defensive Konvention wie
`invitationStateError`s Default-Zweig).

**Bewusst nicht verwendet:** `INVITATION_ALREADY_PENDING`. Der Code bleibt
für Create reserviert, wo er einen echten Konflikt (zweite Einladung neben
einer bestehenden pendenten) beschreibt. Bei Resend ist „pending" der
erwartete Zielzustand, kein Konfliktfall - eine Wiederverwendung des Codes
wäre semantisch falsch gewesen.

## 4. Tokenwechsel

Wiederverwendet: `security/invitationTokens.js#createInvitationToken` (32
zufällige Bytes, SHA-256-Hash, Base64url, exakt dieselbe Funktion wie bei
Create). **Der alte Token wird beim Commit der Transaktion unbedingt
ungültig** - unabhängig vom Ausgang des anschließenden Mailversands, da
`token_hash` bereits überschrieben ist, sobald die DB-Transaktion committet.
Kein Token verlässt den Server in Logs oder API-Response (nur
`role`/`expiresAt` im Audit-Detail, keine Zeile im Servicecode loggt den
Klartext-Token).

## 5. Parallelitätsverhalten

Der `SELECT ... FOR UPDATE` auf die Einladungszeile serialisiert konkurrierende
Resend-Aufrufe auf derselben Einladung: jeder Aufruf überschreibt
`token_hash` vollständig, sodass am Ende **genau ein** Token gültig ist -
egal wie viele Aufrufe parallel starteten (durch Integrationstest
empirisch verifiziert, drei parallele Resends → genau ein gültiger Token
und drei Audit-Events). Ein Rate-Limiter (siehe unten) begrenzt zusätzlich,
wie oft dasselbe Aktor-Einladung-Paar das überhaupt versuchen darf.

## 6. Mailfehlerverhalten

Da der alte Token bereits beim Commit unbedingt invalidiert ist, gibt es bei
einem anschließenden Zustellfehler keinen sinnvollen „alten Zustand", zu dem
zurückgekehrt werden könnte. Resend nutzt daher **dieselbe Kompensation wie
Create** (`compensateInvitationDeliveryFailure`): die (jetzt unzustellbare)
Einladung wird auf `revoked` gesetzt, ein `invitation.delivery_failed`
Audit-Event geschrieben, und der Client erhält `502
INVITATION_DELIVERY_FAILED` bzw. `503
INVITATION_DELIVERY_RECOVERY_FAILED`, falls sogar die Kompensation
fehlschlägt. Es entsteht **nie** ein Zustand, der wie ein erfolgreicher
Resend aussieht, obwohl die Zustellung fehlgeschlagen ist.

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
