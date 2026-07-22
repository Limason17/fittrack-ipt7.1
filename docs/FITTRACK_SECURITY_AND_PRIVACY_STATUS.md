# FitTrack Sicherheits- und Datenschutzstatus

Stand: 2026-07-19, geprüfter Commit `8a8da30` (main), ergänzt am 2026-07-20 um den neuen Abschnitt „Coach-Feedback (Stage 1B.2B2B)" sowie eine neue Zeile in der Datenschutzklassifikation, und erneut ergänzt (selbes Datum) um den SMTP-Adapter-Status in „Einladungen" und Punkt 6 der Lückenliste (Stage 2A) — der übrige Bestand wurde nicht rückwirkend umgeschrieben. Klassifikationslegende: **[GETESTET]** implementiert und automatisiert getestet (Testdatei zitiert) · **[MANUELL]** implementiert, nur durch Code-Lesen nachvollziehbar · **[DOKU]** nur dokumentiert, kein Code · **[OFFEN]** fehlt komplett.

## Auth

- JWT HS256, Payload ausschließlich `{ id }` — keine Rolle, keine Studio-Zugehörigkeit im Token; Rolle wird bei **jedem** Request live aus der DB gelesen und geprüft. **[GETESTET]** `backend/test/unit/authMiddleware.test.js`, `backend/test/integration/trainingApi.test.js:115-122`.
- Token-Ablauf fix 8h, Ablauf via `jwt.verify` erzwungen. **[MANUELL]** kein Test mit gemocktem abgelaufenem Token gefunden.
- `JWT_SECRET` ≥32 Zeichen in Produktion, bekannte Platzhalter abgelehnt. **[GETESTET]** `backend/test/unit/authConfig.test.js`.
- Passwort: bcrypt Kostenfaktor 10, Login 6-128 Zeichen ohne Komplexitätsanforderung. **[GETESTET]** `backend/test/unit/userValidation.test.js`.
- Identische Fehlermeldung für unbekannte E-Mail und falsches Passwort. **[MANUELL]**. **Risiko:** `bcrypt.compare` wird nur bei existierendem Benutzer aufgerufen — messbarer Zeitkanal zur Konto-Enumeration trotz gleicher Fehlermeldung.
- Rate Limiting: In-Memory, pro Prozess (kein geteilter Zähler bei mehreren Instanzen). Login 10/15min, Registrierung 5/60min. **[GETESTET]** `backend/test/unit/rateLimiter.test.js`. **Risiko bei horizontaler Skalierung** (dokumentiert in `docs/DEPLOYMENT.md:365`).

## Tenant-Isolation

- Public-UUIDs vs. interne Auto-Increment-IDs; numerische/interne IDs in der URL werden sofort abgelehnt. **[GETESTET]** `backend/test/integration/studioApi.test.js:266-267`.
- Fremdes/suspendiertes/ausgeschiedenes Studio-Verhältnis → identisch 404 `STUDIO_NOT_FOUND`, nie 403 (verhindert Existenz-Enumeration von Studios/Mitgliedschaften). **[GETESTET]** `backend/test/unit/studioMiddleware.test.js:13-39`, `backend/test/integration/studioApi.test.js:258-306`.
- Jede mutierende Operation sperrt Studio+Akteur-Mitgliedschaft per `SELECT...FOR UPDATE` in derselben Transaktion, bevor die Berechtigung geprüft wird — kein Vertrauen auf zwischengespeicherten Kontext. **[GETESTET]** Konkurrenz-Tests `backend/test/integration/studioApi.test.js:700,897`.
- Letzter aktiver Owner kann nicht herabgestuft/suspendiert werden, race-sicher. **[GETESTET]** `backend/test/integration/studioApi.test.js:897-927`.

## RBAC

- Zentrale Policy-Datei (`backend/domain/studioPolicy.js`) mit Default-Deny (`hasStudioPermission` verlangt `status==='active'`, unabhängig von der Rolle — auch ein suspendierter Owner verliert alles). **[GETESTET]** `backend/test/unit/studioPolicy.test.js`, `backend/test/integration/studioApi.test.js:503-513`.
- Selbstbeförderungsschutz gilt für jede Rolle. **[GETESTET]** `backend/test/unit/studioPolicy.test.js:77-82`.
- **Bestätigte Owner/Admin-Bypässe** (Rolle schlägt granularen Check): Sichtbarkeit aller Coaching-Beziehungen/Zuweisungen im Studio (statt nur eigener); Zuweisung über jede aktive Beziehung im Studio, auch ohne selbst Coach zu sein; keine Zielrollenbeschränkung bei Mitgliederverwaltung (nur Admin hat `ADMIN_TARGET_FORBIDDEN`); erweiterter Datenumfang (Status/E-Mail) in der Mitgliederliste. Alle mit Integrationstest-Nachweis belegt (Details: `docs/adr/002-coach-member-training-ownership.md` und Rollenmatrix in `FITTRACK_CURRENT_STATUS.md`).
- **Bestätigt OHNE Bypass — zentrale Stage-1B.2B1-Grenze:** `workoutResultReadEligibility` verlangt für **jede** Rolle (owner, admin, trainer) identisch eine eigene aktive Coaching-Beziehung, um Trainingsergebnisse eines Mitglieds zu lesen. **[GETESTET]** explizit benannt in `backend/test/unit/workoutSessionPolicy.test.js:188-212` ("no owner/admin bypass") und `backend/test/integration/workoutSessionApi.test.js` (Owner/Admin ohne Beziehung → identischer 404 wie ein fremder Trainer).
- **Toter Code mit irreführender Bypass-Semantik:** `coachActionEligibility` (`studioPolicy.js:186-197`) definiert einen Owner/Admin-Bypass, wird aber von **keiner** Route/keinem Service aufgerufen — die tatsächliche Logik liegt redundant in `programAssignmentService.js:92-122`. Drift-Risiko bei künftigen Änderungen, sollte bereinigt oder verdrahtet werden.

## Einladungen

- Token: `crypto.randomBytes(32)` (256 Bit), nur SHA-256-Digest gespeichert, nie das Rohtoken. **[GETESTET]** `backend/test/unit/studioSecurity.test.js:31-42`.
- Lebensdauer fix 7 Tage, lazy Ablaufprüfung. **[GETESTET]** `backend/test/integration/studioApi.test.js:685`.
- Replay-Schutz: genau einmal annehmbar, race-sicher. **[GETESTET]** `backend/test/integration/studioApi.test.js:622-627,700-724`.
- E-Mail-Bindung gegen Konto-E-Mail, identische Fehlermeldung wie unbekanntes Token. **[MANUELL]** kein dedizierter Test für "falscher Benutzer nimmt fremde Einladung an".
- **Produktion fail-closed ohne Provider**: Ohne verdrahteten Zustellprovider verweigert das System jede Einladungserstellung in Produktion (503), bevor irgendetwas persistiert wird. **[GETESTET]** `backend/test/unit/studioSecurity.test.js:136-193`.
- **Seit Stage 2A: validierter SMTP-Adapter vorhanden** (`backend/delivery/smtpInvitationProvider.js`, `backend/config/smtpConfig.js`), opt-in über `INVITATION_EMAIL_PROVIDER=smtp`. TLS ausnahmslos erzwungen (SMTPS oder STARTTLS, Zertifikatsprüfung nie deaktiviert), Platzhalter-Credentials in jeder Umgebung abgelehnt, keine Secrets/Token/URLs in Logs oder Audit. **[GETESTET]** 44 neue Unit- + 4 neue Integrationstests, siehe `STAGE_2A_PRODUCTION_INVITATION_EMAIL.md`. Ein echter Versand wurde in dieser Umgebung mangels Zugangsdaten nicht nachgewiesen — reale Provider-Verbindung bleibt ein dokumentierter, offener manueller Schritt.
- Token-Redaktion in Logs/Audit via Regex-Muster. **[GETESTET]** `backend/test/unit/startupLogger.test.js`, `backend/test/unit/studioSecurity.test.js:44-74`.

## Coaching und Programme

- Zuweisung erfordert explizite, aktive Coaching-Beziehung — kein automatisches "letzte aktive Beziehung"-Verhalten (Stage-1B.1-Nachbesserung). **[GETESTET]** `backend/test/integration/trainingProgramApi.test.js`.
- Veröffentlichte Versionen sind für **jede** Rolle unveränderlich, auch für den Owner. **[GETESTET]** `backend/test/integration/trainingProgramApi.test.js:326-330`.
- Snapshot-Trennung: `exercise_name_snapshot` etc. sind Text-Snapshots ohne FK zur persönlichen `exercises`-Tabelle. **[GETESTET]** Migrationstest `backend/test/migrationDatabase.test.js`.

## Workout-Ergebnisse (Stage 1B.2B1)

- Ownership einmalig bei Session-Start aufgelöst und gesperrt, nie neu aufgelöst (Snapshot-Prinzip). **[GETESTET]** `backend/test/integration/workoutSessionApi.test.js`.
- Member-Self-Access strukturell hart auf `member_membership_id = actor.internalId` verriegelt — keine Rolle kann je die Session einer anderen Person mutieren. **[GETESTET]** `backend/test/unit/workoutSessionPolicy.test.js`, Integrationstest.
- Coach-Zugriff erfordert eigene aktive Beziehung, **kein** Owner-/Admin-Bypass (siehe RBAC oben) — die härteste Zugriffsregel im gesamten System.
- Zugriff endet sofort bei Beziehungsende oder Suspendierung der eigenen Mitgliedschaft, ohne den Eigenzugriff des Mitglieds zu berühren. **[GETESTET]**.
- Revisionskonflikte (`WORKOUT_SESSION_CONFLICT`/`_EXERCISE_CONFLICT`/`_SET_CONFLICT`) und Idempotenz über `clientStartKey`. **[GETESTET]**.
- Terminale Session (completed/aborted) ist für jede weitere Mutation unveränderlich. **[GETESTET]**.
- Keine Trainingsmetrik erscheint je im Audit-Log (`workout_session.*`-Events haben eine strikte Allowlist ohne Gewicht/Wiederholungen/RPE/Distanz/Dauer/Notiz). **[GETESTET]** `backend/test/unit/workoutSessionAudit.test.js`, `backend/test/integration/workoutSessionApi.test.js`.
- Keine persönlichen Workout-Daten werden von Studio-Workout-Sessions berührt (separate Tabellenbäume, siehe Datenmodell). **[GETESTET]**.

## Coach-Feedback (Stage 1B.2B2B)

- Zugriffs-Pinning gehärtet: Coach-Resultat-/Feedback-Zugriff verlangt zusätzlich, dass die Session zur **exakt** aktuell aktiven Beziehung gehört (`session.coaching_relationship_id === relationship.internalId`) — eine neue, spätere Beziehung mit demselben Mitglied gewährt keinen automatischen Zugriff auf Sessions einer früheren Beziehung. Dies ist eine bewusste Härtung des bereits produktiven Stage-1B.2B1-Modells, gefunden vor jeder Fehlermeldung während des Designs dieser Phase. **[GETESTET]** `backend/test/integration/workoutFeedbackApi.test.js` ("a new coach for the same member gains no automatic access to a session from the earlier, now-ended relationship"), analog auch für `listCoachedMemberSessions`/`getCoachedMemberSession` in `workoutSessionApi.test.js`.
- Feedback-Erstellung: identisch **kein** Owner-/Admin-Bypass (`WORKOUT_RESULT_READ_COACHED`-Permission ist owner/admin/trainer zugeordnet, doch die konkrete Beziehungsprüfung bleibt auf die eigene Mitgliedschaft des Akteurs gepinnt) — Owner/Admin ohne eigene Beziehung erhalten identisch `404`. **[GETESTET]** `backend/test/integration/workoutFeedbackApi.test.js`.
- Nur auf terminalen Sessions (`completed`/`aborted`) erstellbar; `in_progress` liefert `409 WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL`. **[GETESTET]**.
- Append-only durch Weglassen von PATCH/DELETE erzwungen (keine DB-Trigger, konsistent mit der bestehenden Audit-Append-only-Konvention oben). **[GETESTET]** kein Update-/Delete-Pfad im Router, Migrationstest bestätigt CHECK/Unique-Constraints.
- Idempotenz über `client_feedback_key` (Unique zusammen mit `workout_session_id`/`coach_membership_id`); gleicher Schlüssel mit abweichendem Text → `409 WORKOUT_FEEDBACK_KEY_CONFLICT`, inkl. Race-Zweig (`ER_DUP_ENTRY`). **[GETESTET]** Unit-, Integrations- und E2E-Ebene (Mehrfachklick-Test).
- Feedbacktext ist von jedem Audit-Detail, Request-/Fehlerlog und Frontend-Debug-Log ausgeschlossen — Audit-Allowlist für `workout_feedback.created` enthält ausschließlich `{feedbackId, sessionId}`. **[GETESTET]** `backend/test/unit/workoutSessionAudit.test.js`.
- Nach Beziehungsende: ehemaliger Coach verliert sofort Lese- und Schreibzugriff; das Mitglied behält bereits erhaltenes Feedback dauerhaft (kein Hard-Delete-Pfad). **[GETESTET]** E2E-Test „Beziehungsende entzieht dem Coach sofort den Zugriff; das Mitglied behält sein Feedback dauerhaft".
- Bewusst **nicht** eingeführt: ein feedback-spezifischer Not-Found-Code oder `WORKOUT_FEEDBACK_NOT_ALLOWED` — jede Zugriffsverweigerung kollabiert weiterhin auf den bestehenden einheitlichen `WorkoutSessionNotFoundError` (Fortführung von ADR 003), siehe `STAGE_1B2B2B_COACH_RESULTS_FEEDBACK.md`.

## Audit

- Zweistufige Redaktion: generische Regex-Redaktion (`password|secret|token|...`, 43-Zeichen-Token-Muster) plus strengere, ereignistyp-spezifische **Allowlist** (unbekannte Detail-Schlüssel werfen einen Fehler statt nur redigiert zu werden). **[GETESTET]** `backend/test/unit/studioSecurity.test.js`, `backend/test/unit/trainingProgramAudit.test.js`, `backend/test/unit/workoutSessionAudit.test.js`.
- Append-only-Verhalten ist eine **Anwendungskonvention**, keine DB-erzwungene Eigenschaft — kein GRANT/REVOKE, Trigger oder Constraint verhindert `UPDATE`/`DELETE` auf `studio_audit_events` auf Datenbankebene. **[MANUELL]**.

## Logging

- Einheitliches Fehler-Envelope, niemals Stacktraces/SQL-Fragmente im Response-Body (auch nicht bei 5xx). **[GETESTET]** `backend/test/unit/errorHandling.test.js`, `backend/test/integration/trainingApi.test.js:135`.
- Request-Logging enthält ausschließlich `requestId, method, route, status, durationMs` — **keine** Bodies, **keine** Query-Strings. **[GETESTET]** `backend/test/unit/requestLogging.test.js`.
- Security-Header (nosniff, DENY, no-referrer, CSP, Permissions-Policy) gesetzt. **[GETESTET]** (nosniff/DENY/no-referrer explizit geprüft; CSP/Permissions-Policy nicht separat assertiert).
- CORS-Konfiguration (`allowedOrigins`/`createCorsOptions`) hat **keinen** automatisierten Test. **[MANUELL]** — Same-Host-Requests werden dabei immer erlaubt, unabhängig von `CORS_ORIGIN`.

## Backups

- Automatisierter täglicher Lauf (Stage 0C, im Code unverändert): komprimiert, Integritätsmanifest (SHA-256 für Roh- und komprimierte Datei), Lock, Zielidentitätsprüfung, UTC-GFS-Retention (7 täglich/4 wöchentlich/3 monatlich). **[GETESTET]** `backend/test/unit/backupAutomation.test.js`, `backend/test/unit/backupPolicy.test.js`. Dieser Pfad (`db:backup`/`db:backup:daily`) produziert weiterhin unverschlüsselte `.sql`/`.sql.gz`-Artefakte. **Seit der Stage-2B1-Release-Gate-Härtung ist er in Produktion (`NODE_ENV=production`) ausnahmslos gesperrt, ohne Override**, und überall sonst standardmäßig ebenfalls gesperrt (`ALLOW_LEGACY_UNENCRYPTED_BACKUP=true` nötig, aufgerufen als erste Prüfung vor jeder Verzeichnis-/Docker-Operation) — er bleibt nur für historische Regressionstests/lokale Läufe erreichbar. **[GETESTET]** `backend/test/unit/backupAutomation.test.js` (Produktionssperre, fehlender Override, kein Datei-Anlegen vor der Prüfung).
- **Verschlüsselung im Ruhezustand: seit Stage 2B1 verfügbar und seit der Release-Gate-Härtung der einzige produktionsfähige Pfad** — `db:backup:create` erzeugt ein authentifiziert AES-256-GCM-verschlüsseltes `.ftbackup` (`node:crypto`, 32-Byte-Schlüssel, zufälliger IV pro Backup, GCM-Tag zwingend geprüft, Header als AAD). Kein Klartext-SQL-Dump entsteht dabei zu irgendeinem Zeitpunkt auf Disk — direkt bewiesen (Live-Dateisystemüberwachung plus statische Quelltext-Prüfung), nicht nur indirekt geschlussfolgert. **[GETESTET]** `backend/test/unit/encryptedBackupFormat.test.js`, `backend/test/unit/backupCryptoConfig.test.js`, `backend/test/unit/encryptedBackupNoPlaintextStaticCheck.test.js`, `backend/test/integration/encryptedBackupRestoreDrill.test.js` (echter End-to-End-Drill gegen die lokale MySQL-Instanz, inkl. zweier kritischer GCM-Tamper-Tests, die beweisen, dass die Zieldatenbank bei einem manipulierten oder mit falschem Schlüssel verschlüsselten Backup nie angelegt wird). Siehe `STAGE_2B1_ENCRYPTED_BACKUP_RESTORE.md`.
- **Off-host-Speicherung: Mechanik seit Stage 2B2A vorhanden, kein echter externer Bucket verbunden** — ein providerneutraler, S3-kompatibler Upload-/Download-/Verifikationspfad (`db:backup:remote:upload/list/download/verify/drill`, `config/backupRemoteConfig.js`, AWS SDK v3) lädt ausschließlich bereits verschlüsselte `.ftbackup`-Dateien hoch, nie eine implizite AWS-Credential-Chain, HTTPS in Produktion zwingend. **Seit einer Release-Gate-Härtung:** Veröffentlichung über einen einzelnen, serverseitig atomar-bedingten `PutObject` (`IfNoneMatch: "*"`) statt einer race-anfälligen `HeadObject`-Vorabprüfung — ein bestehendes Objekt kann nachweislich nie überschrieben werden, auch nicht bei zwei echt gleichzeitigen Upload-Versuchen auf denselben Schlüssel. **[GETESTET]** `backend/test/unit/backupRemoteConfig.test.js`, `backupRemoteObjectKey.test.js`, `backupRemoteStorage.test.js`, `backupRemoteRetention.test.js`, `encryptedBackupRemoteUpload.test.js`, `backend/test/integration/backupRemoteMinio.test.js` (22 Tests, echter Upload/Download/Remote-Restore-Drill sowie ein echter Zwei-gleichzeitige-Uploads-Wettlauf gegen eine lokale MinIO-Testinstanz, inkl. manipulierter Remote-Metadaten/-Objekte und falscher Key-ID). Siehe `STAGE_2B2A_S3_OFFHOST_BACKUPS.md`. **Weiterhin offen:** Es ist kein echtes externes Cloud-Konto verbunden — das bleibt Stufe 2B2B. **[DOKU]** für den verbleibenden Teil.
- Restore-Pfad ausschließlich für Wegwerf-Testdatenbanken, kein Produktions-Restore-Codepfad. **[GETESTET]** `backend/test/unit/backupAutomation.test.js:163-212` (unverschlüsselter Pfad, weiterhin `NODE_ENV=test` plus Loopback-Host), `backend/test/integration/encryptedBackupRestoreDrill.test.js` (verschlüsselter Pfad) — der verschlüsselte Restore verlangt seit der Härtung eine von `NODE_ENV` unabhängige, explizite Freigabe (`BACKUP_RESTORE_ENABLED=true`), Loopback-Host, ein streng gemustertes Wegwerfziel sowie eine an den exakten Zielnamen gebundene Bestätigung (`FITTRACK_RESTORE_ACK=restore:<Ziel>`, statt einer festen Phrase); ein explizites Zieldatenbank-Argument ist zwingend, darf nie implizit der Quelle entsprechen, und eine bereits existierende Zieldatenbank wird ohne explizite Bestätigung abgelehnt. Zusätzlich erzwingen konfigurierbare Timeouts (`BACKUP_DUMP_TIMEOUT_MS`/`BACKUP_RESTORE_TIMEOUT_MS`/`BACKUP_DOCKER_OPERATION_TIMEOUT_MS`) eine garantierte Beendigung hängender oder Signale ignorierender `mysqldump`/`mysql`/Docker-Prozesse, einschließlich des im Container laufenden entfernten Prozesses.
- **Automatisierter, verifizierter Restore-Drill seit Stage 2B1**
  (`db:backup:drill`): erstellt ein echtes verschlüsseltes Backup, verifiziert
  es vollständig, restauriert es in eine disposable Datenbank, prüft
  Migration Doctor (`ready`/`applied:8`) sowie Tabellen-/Zeilenzahlvergleich
  gegen die Quelle, räumt danach vollständig auf. **[GETESTET]**. RPO/RTO als
  quantifizierte Planungsannahmen für einen echten Produktionsbetrieb bleiben
  weiterhin offen — der Drill beweist die Mechanik, nicht einen geplanten
  Zeitrahmen.

## Secrets

- `.env` korrekt via `.gitignore` ausgeschlossen, keine committeten Echtsecrets bestätigt.
- **Eine einzige DB-Rolle für Runtime, Migration und Restore-Admin-Operationen** — die dokumentierte Trennung (Runtime- vs. DDL-Nutzer) ist rein organisatorisch, nicht technisch erzwungen. **[DOKU]** für die Absicht, **[MANUELL]** für die tatsächliche Single-User-Nutzung im Code.
- TLS explizit an Reverse-Proxy delegiert, kein TLS-Code im Repository (bewusst Infrastrukturaufgabe). **[DOKU]**
- Kein echtes Monitoring/Alerting-System im Repository — nur Health-Endpunkte plus dokumentierte Prozesse. **[GETESTET]** für Health-Endpunkte, **[DOKU]** für Alerting.

---

## Datenschutzklassifikation

| Datum | Wer darf lesen | Speicherort | In Logs? | Im Audit? | Im Backup? | Aufbewahrung/Löschung | Bemerkung |
|---|---|---|---|---|---|---|---|
| Globale Kontodaten (username, email, password_hash) | Nur der Benutzer selbst (API-seitig) | `users` | Nein (Body-Logging aus) | Nein | Ja, unverschlüsselt | Kein Lösch-/Anonymisierungspfad im Code gefunden | Kein `deleted_at`; Hard-Delete nur möglich, wenn keine RESTRICT-FK-Historie existiert |
| Studio-Mitgliedschaftsdaten (Rolle, Status) | Studio-Mitglieder gemäß Rollenmatrix | `studio_memberships` | Nein | Ja (allowlisted: role/status) | Ja | Statustransition (`left`), kein Hard-Delete | — |
| Einladungs-E-Mails | Owner/Admin des Studios | `studio_invitations.email_normalized` | Nein | Ja (nur role/expiresAt, nicht die E-Mail selbst) | Ja, unverschlüsselt | 7 Tage TTL, danach `expired`, kein Hard-Delete | Betrifft ggf. eine noch nicht registrierte Person |
| Auditdaten | Owner/Admin | `studio_audit_events` | Nein | — (ist selbst das Audit) | Ja | Kein Lösch-/Retention-Mechanismus im Code gefunden | Append-only nur Konvention, s.o. |
| Coaching-Beziehungen | Owner/Admin (alle), Trainer (nur eigene) | `studio_coaching_relationships` | Nein | Ja (nur Membership-IDs) | Ja | Statustransition (`ended`), kein Hard-Delete | — |
| Programmzuweisungen | Owner/Admin/Trainer (Coachees), Mitglied (eigene) | `studio_program_assignments` | Nein | Ja (Member-ID, Versionsnummer) | Ja | Statustransition, kein Hard-Delete | — |
| Session-Metadaten (Status, Zeitstempel) | Mitglied selbst, Coach mit aktiver Beziehung | `studio_workout_sessions` | Nein | Ja (nur Assignment-/Tag-ID beim Start, sonst leer) | Ja, unverschlüsselt | Statustransition, kein Hard-Delete | — |
| **Satzresultate (Gewicht, Wiederholungen, RPE, Distanz, Dauer)** | Mitglied selbst, Coach **nur** mit eigener aktiver Beziehung, **kein** Owner-/Admin-Bypass | `studio_workout_session_sets` | **Nein — explizit ausgeschlossen und getestet** | **Nein — nie, auch nicht als redigierter Wert** | Ja, siehe Fußnote¹ | Kein Hard-Delete-Pfad; laut ADR 003 das sensibelste personenbezogene Datum der Anwendung | Höchste Schutzstufe im System; profitiert am stärksten davon, dass der produktionsfähige Backup-Pfad seit Stage 2B1 verschlüsselt ist |
| Member-Notizen (Session/Übung/Satz) | Wie Satzresultate | `studio_workout_session*.member_note` | Nein | Nein | Ja, unverschlüsselt | Kein Hard-Delete | — |
| **Trainer-Feedback zu Sessions** | Mitglied selbst (dauerhaft, auch nach Beziehungsende), Coach **nur** mit eigener aktiver, session-pinnender Beziehung, **kein** Owner-/Admin-Bypass | `studio_workout_session_feedback` (Migration 008) | Nein | Nur `{feedbackId, sessionId}`, nie der Text | Ja, unverschlüsselt | Kein Hard-Delete, kein Update — append-only per Schema-Design (kein PATCH/DELETE-Endpunkt) | Neu in Stage 1B.2B2B; erbt die P4-Schutzstufe der Satzresultate |

¹ „Ja, unverschlüsselt" in dieser Tabelle bezieht sich auf die MySQL-Tabelle
selbst (keine Verschlüsselung im Ruhezustand innerhalb der Datenbank). Für
den **Backup-Artefakt-Pfad** gilt seit Stage 2B1: Der einzige in Produktion
zulässige Weg (`db:backup:create`) erzeugt ein authentifiziert
AES-256-GCM-verschlüsseltes `.ftbackup`; der alte, unverschlüsselte
`db:backup`/`db:backup:daily`-Pfad ist in Produktion seit der
Release-Gate-Härtung ausnahmslos gesperrt (siehe „Backups" oben).

**Technischer Ist-Zustand, keine Rechtsauskunft:** Es existiert kein Recht-auf-Löschung-/Anonymisierungs-Mechanismus für Benutzer- oder Trainingsdaten im gesamten Code (weder `DELETE`-Endpunkt für den eigenen Account noch eine Anonymisierungsroutine). Für einen produktiven Betrieb mit echten Nutzerdaten ist das ein offener Punkt, unabhängig von Sicherheits- oder Funktionsreife.

## Auffällige Lücken (Zusammenfassung)

1. ~~Kein Off-host-Backup implementiert~~ — Mechanik seit Stage 2B2A vorhanden (S3-kompatibler Upload/Download/Retention-Pfad, siehe oben), aber noch kein echter externer Bucket verbunden (Stufe 2B2B).
2. ~~Keine Verschlüsselung von Backup-Artefakten im Ruhezustand~~ — seit Stage 2B1 behoben und seit der Release-Gate-Härtung der einzige produktionsfähige Backup-Pfad (siehe oben); betraf insbesondere die P4-Trainingsleistungsdaten.
3. Eine einzige DB-Rolle für Runtime/Migration/Restore statt getrennter Privilegien.
4. Timing-Seitenkanal bei Login-Enumeration.
5. Audit-Append-only ist reine Anwendungskonvention, nicht DB-erzwungen.
6. ~~Kein Produktions-E-Mail-Provider verdrahtet~~ — seit Stage 2A behoben: validierter, opt-in SMTP-Adapter vorhanden (siehe oben). Weiterhin offen: kein Bounce-/Complaint-Handling, keine Zustell-Warteschlange, und ein echter Versand wurde in dieser Umgebung mangels Zugangsdaten nicht real nachgewiesen.
7. CORS-Konfiguration ungetestet.
8. Rate Limiter ist pro Prozess, nicht zentral (Skalierungsgrenze).
9. ~~Kein abgeschlossener/nachgewiesener Restore-Drill~~ — seit Stage 2B1 behoben: automatisierter Drill (`db:backup:drill`) und ein manueller Lauf mit synthetischem Schlüssel, beide gegen die lokale MySQL-Instanz, siehe oben.
10. Kein Recht-auf-Löschung-/Anonymisierungspfad für Benutzerdaten.
11. `coachActionEligibility` ist toter Code mit irreführender Bypass-Semantik (Drift-Risiko).
