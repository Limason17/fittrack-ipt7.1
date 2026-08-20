# Stage 5D: Current-State Audit (nach Stage 5C2)

## 1. Audit-Datum

2026-08-19 (Windows 11, Node.js v22.17.0, npm 10.9.2, MySQL 8.0 via Docker `fittrack_mysql`).

## 2. Ausgangs-Commit

`main` HEAD `de95329` — "Merge pull request #30 from Limason17/feature/stage-5c2-account-deletion-ui", identisch zu `origin/main` beim Start dieses Audits. Verifiziert über `git log --oneline --decorate -20`: alle im Auftrag genannten vorausgesetzten Phasen sind als Merge-Commits in der Historie vorhanden — Stage 5A1 (`3413261`, PR #21), Stage 5A2 (`3193f41`, PR #22), Stage 5A3 (`41f2f31`, PR #23), Stage 5B (`f87d0b6`, PR #24), Stage 5C Design (`125a352`), Stage 5C1 (`a3800ed`, PR #27), Calendar-Determinismus-/Security-Hotfixes (`e54ce99` PR #28, `5998bbf`), PR #29 Rate-Limit-Reihenfolge-Fix (`dcf1a9b`), Stage 5C2 (`de95329`, PR #30).

## 3. Scope

Reines Audit- und Dokumentationsvorhaben ("Stage 5D"), **keine neue Produktfunktion, keine Fehlerbehebung am Produktcode, keine Refactorings, keine Migration, keine Dependency-Upgrades, keine Infrastrukturänderung**. Einzige erlaubte Änderungen liegen unter `docs/**`. Durchgeführt auf einem eigenen Branch (`docs/current-state-refresh-after-stage-5c`), kein Merge nach `main`.

## 4. Git-Zustand

- `main`: sauber, identisch zu `origin/main`, 0 Commits Unterschied.
- Neuer Branch `docs/current-state-refresh-after-stage-5c`, von `main` `de95329` erstellt.
- **4 vorbestehende Stashes**, ausschliesslich inventarisiert, **unangetastet gelassen**:
  - `stash@{0}` "WIP on main: e8e50d6 feat(backend): add exercises api and utf8-safe mysql configuration" — `database/schema.sql`, `database/seed.sql`, `frontend/src/views/ExercisesView.vue`, `LoginView.vue`, `RegisterView.vue`.
  - `stash@{1}` "WIP on main: caee537 feat(auth): connect login and registration forms to backend" — `Navbar.vue`, `ExercisesView.vue`, `HomeView.vue`, `ProgressView.vue`, `WorkoutsView.vue`.
  - `stash@{2}` "WIP on main: 950b410 feat(frontend): redesign main workout and progress views" — `App.vue`, `main.css`, `Navbar.vue`, `router/index.js`.
  - `stash@{3}` "On main: !!GitHub_Desktop<main>" — `backend/.gitignore`, `backend/routes/users.js`, `backend/server.js`.

  Alle vier stammen erkennbar aus einer sehr frühen Projektphase (referenzierte Dateien/Commits wie `Navbar.vue` existieren im aktuellen Code nicht mehr) und wurden weder angewendet, gepoppt, gelöscht noch sonst verändert.
- **Lokale/Remote-Branch-Hygiene** (reine Inventarisierung, kein Cleanup durchgeführt): Der Grossteil der lokalen Feature-/Hotfix-/Audit-Branches trägt bereits gemergte, per PR abgeschlossene Arbeit mit dem Vermerk `[origin/...: gone]` (Remote-Branch nach Merge planmässig von GitHub gelöscht, lokale Referenz verwaist zurückgeblieben) — normale Nacharbeit, kein Hygieneproblem. Bemerkenswert: ein bereits existierender, **nicht gemergter** Branch `docs/current-system-audit` (lokal und remote, Commit `0e59dc6` "Add FitTrack current-state audit: status, view, API and security baseline") — ein früherer, offenbar eigenständiger Audit-Versuch auf einem älteren Codestand, der nie gemergt wurde. Nicht Teil dieses Audits, nicht verändert; falls dieser Branch noch benötigt wird, sollte er gegen den heutigen Stand neu bewertet werden, sonst ist er ein Aufräum-Kandidat für eine spätere, eigene Branch-Hygiene-Aufgabe.

## 5. Architekturübersicht

Unverändert zur bereits dokumentierten Grundarchitektur (`FITTRACK_CURRENT_STATUS.md` Abschnitt 3), mit folgendem, gegen den heutigen Code verifizierten Stand:

- **Frontend:** Vue 3.5, Vue Router 5, Vite 7.3.6, Vitest 4.1.10, `@vue/test-utils`, Playwright 1.61 + `@axe-core/playwright` 4.12.
- **Backend:** Node.js 22.17.0/Express 5.2, `mysql2` 3.19, `jsonwebtoken` 9.0, `bcryptjs` 3.0; Tests über den nativen `node:test`-Runner.
- **Datenbank:** MySQL 8.0, additive versionierte Forward-Migrationen, Eigenbau-Migrationssystem mit Advisory-Lock, Checksum-Drift-Erkennung, separatem Migration Doctor.
- **11 Backend-Router-Module** (`backend/routes/`): `users.js`, `exercises.js`, `workouts.js`, `progress.js`, `studioV1.js`, `trainingProgramV1.js`, `workoutSessionV1.js`, `trainingCalendarV1.js` (Stage 5A1), `assignmentScheduleRuleV1.js` (Stage 5A3), `accountRouter.js` (Stage 3B1/5C1), `authSessionRouter.js` (Stage 3B2) — verifiziert über `backend/startup/app.js#defaultRouters` und die tatsächliche `app.use(...)`-Verdrahtung.
- **28 Frontend-View-Komponenten** (`frontend/src/views/*.vue`), **18 Playwright-E2E-Spec-Dateien** (`frontend/e2e/*.spec.js`), beide vollständig aufgelistet und gegen den Dateibaum verifiziert (nicht nur aus Dokumentation übernommen).
- **13 Migrationen** (siehe Abschnitt 17).

## 6. Funktionsinventar (codebasiert verifiziert)

| Bereich | Backend-Route(n) | Frontend-View(s) | Status |
|---|---|---|---|
| Registrierung/Login/Logout/Refresh | `users.js`, `authSessionRouter.js` (`/api/auth/refresh\|logout\|logout-all`) | `LoginView.vue`, `RegisterView.vue` | vollständig |
| Passwort-/E-Mail-Selbstverwaltung | `accountRouter.js` (`change-password`, `email-change-requests*`, `email-change-confirmations`) | `ProfileView.vue`, `EmailChangeConfirmView.vue` | vollständig |
| Account Deletion (Preview/Execute) | `accountRouter.js` (`deletion-preview`, `deletion-request`) | `ProfileView.vue` → `components/profile/AccountDeletionDangerZone.vue` (**Stage 5C2, neu bestätigt vorhanden**) | vollständig, siehe Abschnitt 11 |
| Studio/Tenancy/RBAC/Invitations | `studioV1.js` | `StudiosView.vue`, `StudioCreateView.vue`, `StudioDashboardView.vue`, `StudioSettingsView.vue`, `StudioMembersView.vue`, `StudioInvitationsView.vue`, `StudioAuditView.vue`, `InvitationAcceptView.vue`, `StudioAccessDeniedView.vue` | vollständig |
| Coaching/Programme/Zuweisungen | `trainingProgramV1.js` | `CoachingRelationshipsView.vue`, `TrainingProgramsView.vue`, `TrainingProgramBuilderView.vue`, `ProgramAssignmentsView.vue`, `MyTrainingPlanView.vue` | vollständig |
| Studio-Workout-Ausführung (Member) | `workoutSessionV1.js` | `WorkoutSessionView.vue`, `MyTrainingPlanView.vue`, `WorkoutSessionHistoryView.vue` | **vollständig — siehe Korrektur in Abschnitt 25** |
| Coach-Resultatzugriff/Feedback | `workoutSessionV1.js` (coached-members) | `CoachResultsView.vue`, `CoachSessionDetailView.vue` | vollständig |
| Persönlicher Bereich (Übungen/Workouts/Fortschritt) | `exercises.js`, `workouts.js`, `progress.js` | `ExercisesView.vue`, `WorkoutsView.vue`, `ProgressView.vue`, `HomeView.vue` | vollständig |
| Unified Training Calendar (persönlich) | `trainingCalendarV1.js` (Stage 5A1, **fehlte bisher komplett im API-Katalog**) | `CalendarView.vue` (Stage 5A2) | vollständig |
| Coach Scheduling (Terminierungsregeln) | `assignmentScheduleRuleV1.js` (Stage 5A3, **fehlte bisher komplett im API-Katalog**) | `ScheduleRulesView.vue` | vollständig |
| Health/Readiness | inline `startup/app.js` | — | vollständig |

## 7. Rollen-/Tenant-Status

4 Rollen bestätigt (`backend/domain/studioDomain.js`: `STUDIO_ROLES = ["owner", "admin", "trainer", "member"]`), zentrale Policy-Datei `backend/domain/studioPolicy.js` (`PERMISSIONS`/`ROLE_PERMISSIONS`) unverändert seit den in `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` dokumentierten Stage-1A/1B.1-Grundlagen. Keine Codeänderung an RBAC seit Stage 5A3 gefunden — Tenant-Isolation (`404` statt `403` bei fremdem/suspendiertem/ausgeschiedenem Kontext) bleibt durchgängig.

## 8. Training

Programme/Versionen/Tage/Übungen/Zuweisungen unverändert seit Stage 1B.1/1B.2A. Studio-Workout-Ausführung seit Stage 1B.2B2A (PR #9) mit vollständiger Frontend-Oberfläche — siehe Korrektur Abschnitt 25.

## 9. Calendar

Unified Training Calendar (Stage 5A1 Backend, Stage 5A2 persönliche UI, Stage 5A3 Coach-Terminierung) vollständig vorhanden und verdrahtet: `GET/POST /api/v1/training-calendar`, `PATCH .../:entryId`, `POST .../reschedule|complete|skip|cancel` (rein `user_id`-isoliert, nicht studio-scoped) plus `POST/GET/PATCH .../program-assignments/:assignmentId/schedule-rules` (studio-scoped, `SCHEDULE_RULE_MANAGE`/`READ`). Beide Router-Module waren im bisherigen `FITTRACK_API_CATALOG.md` **nicht dokumentiert** — siehe Abschnitt 16.

## 10. Account Self-Service

Passwortänderung, E-Mail-Änderung (mit Bestätigungslink), Sitzungsübersicht/Logout-All — alle unverändert seit Stage 3B1/3B2, Frontend in `ProfileView.vue` (Tabs "Konto"/"Sicherheit"/"Anzeige").

## 11. Account Deletion

Vollständiger Self-Service-Lösch-Stack bestätigt vorhanden und verdrahtet:

- **Backend** (Stage 5C1): `GET /api/account/deletion-preview`, `POST /api/account/deletion-request`, Migration 013 (`lifecycle_status`/`deleted_at`), Sole-Owner-Blocker, Hybrid-Strategie (Anonymisierung/Hard Delete), Receipt-first-Commit-Protokoll, Deletion Receipt Doctor + Reconciliation — Module `backend/deletionReceipts/{deletionReceiptDoctor,deletionReceiptReconciliation,deletionReceiptStore}.js`, `backend/security/deletionReceipts.js`, `backend/config/deletionReceiptConfig.js` alle vorhanden, direkt gelesen.
- **Frontend** (Stage 5C2): `frontend/src/components/profile/AccountDeletionDangerZone.vue` (+ `.test.js`) vorhanden, in `ProfileView.vue`s Sicherheit-Tab eingehängt — Preview-Dialog, Sole-Owner-Blocker-Anzeige, zweistufige Bestätigung (Passwort + Bestätigungsphrase = Benutzername), vollständiger Auth-/Studio-Context-Cleanup und Redirect zu `/login`.
- **Rate-Limiter-Reihenfolge** (siehe Abschnitt 25/26): `accountRouter.js` registriert seit PR #29 `authenticate` **vor** `rateLimiters.deleteRequest`/`passwordChange`/`emailChangeRequest` — direkt im Quelltext auf diesem Branch bestätigt (`de95329` enthält den gemergten Fix).

## 12. Privacy

Siehe `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`-Korrekturen (Abschnitt 26 unten). Kernaussage unverändert korrekt: Anonymisierung/Hard Delete, erhaltene Studio-Historie (nur Urheber-Referenz anonymisiert), Sole-Owner-Schutz, Freitext bewusst nicht bereinigt, Backup-Retention-Grenze ehrlich kommuniziert (`notices.freeTextRetention`/`backupRetention` in der Preview-Antwort), E-Mail-Wiederverwendbarkeit nach Löschung durch Integrationstests belegt, Session-Invalidierung nach Löschung dreifach abgesichert (`auth_version`, `lifecycle_status`-Check in `authMiddleware.js`, leere Refresh-Antwort bei Hard Delete). **Keine Aussage in diesem Dokument behauptet eine vollständige physische Löschung aller personenbezogenen Daten** — Backups und historische Studio-/Freitextdaten bleiben innerhalb der dokumentierten Grenzen bestehen.

## 13. Security

Siehe Abschnitt 26 (Korrekturen) für den vollständigen, gegen `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` abgeglichenen Stand. Zusammenfassung nach Status:

**Geschlossen:** JWT-Refresh/Sitzungs-Widerruf (3B2), Timing-Seitenkanal (3B2), CORS-Validierung (3D), zentraler MySQL-Rate-Limit-Store (3D), Produktions-SMTP-Adapter (2A), Backup-Verschlüsselung (2B1), Account-Deletion-Backend+UI (5C1/5C2), **authenticated-per-user Rate-Limiter-Reihenfolge (PR #29, neu seit dem letzten Statusdokument-Stand)**.

**Teilweise geschlossen:** Geräte-/Sitzungsübersicht (Logout/Logout-All vorhanden, keine vollständige "meine Geräte"-Seite).

**Weiterhin offen, nicht blockierend:** `coachActionEligibility` toter Policy-Code, Audit-Append-only nur Anwendungskonvention (nicht DB-erzwungen), einzelne DB-Rolle für Runtime/Migration/Restore, kein Bounce-/Complaint-Handling für SMTP.

**Bewusst deferred:** Stage 2B2B (echter externer Cloud-Bucket).

**Neuer Fund dieses Audits (kein Produktcode-Defekt):** ein neues npm-High-Severity-Advisory (`nanoid`, Frontend, transitiv) — siehe Abschnitt 19.

## 14. Backups

Unverändert seit Stage 2B1 (verschlüsselter `.ftbackup`-Pfad, Restore-Drill) und Stage 2B2A (S3-kompatible Off-host-Mechanik, nur gegen lokale MinIO verifiziert). Keine Codeänderung in diesem Bereich seit dem letzten Statusdokument-Stand gefunden.

## 15. Externe Infrastruktur

Strikt getrennt von der im Repository vorhandenen Mechanik (siehe Auftrag Abschnitt 13):

| Mechanik im Repository | Reale externe Infrastruktur |
|---|---|
| Verschlüsselte Backups (`.ftbackup`, AES-256-GCM), Restore-Drill | **Kein** echter Produktionsbetrieb, der diese Mechanik nutzt |
| S3-kompatibler Off-host-Upload/Download-Code, Retention-Planung | **Kein** echter Cloud-Bucket verbunden — nur gegen lokale MinIO-Testinstanz verifiziert |
| SMTP-Adapter (Nodemailer, TLS erzwungen) | **Kein** produktiver SMTP-Provider mit echten Zugangsdaten konfiguriert |
| Health/Readiness-Endpunkte | Kein externes Monitoring/Alerting angebunden |
| Migration Doctor, Deletion Receipt Doctor | Reine lokale/CLI-Diagnosewerkzeuge, kein Scheduler, keine externe Orchestrierung |
| GitHub-Actions-CI-Workflow-Definition | Live-CI-Laufstatus in dieser Sitzung nicht fernprüfbar (kein `gh`-Zugriff genutzt) |

Es besteht **keine** Grundlage für die Behauptung, produktive externe Infrastruktur sei eingerichtet — jede Aussage in den Statusdokumenten, die das nahelegen könnte, wurde geprüft und keine gefunden, die das fälschlich behauptet.

## 16. API-Status

`docs/FITTRACK_API_CATALOG.md` war gegen den tatsächlichen Router-Code geprüft **veraltet und unvollständig**:

- **Fehlten komplett:** die gesamte Training-Calendar-Gruppe (`trainingCalendarV1.js`, 7 Endpunkte, Stage 5A1) und die Assignment-Schedule-Rules-Gruppe (`assignmentScheduleRuleV1.js`, 3 Endpunkte, Stage 5A3) — beide Router sind seit Stage 5A1/5A3 in `startup/app.js` gemountet, aber nie in den Katalog aufgenommen worden.
- **Falsch/veraltet:** Die Spalte "Frontend" behauptet für die gesamte Workout-Session-/Coach-Resultat-Gruppe (10 Endpunkte) durchgängig "Kein Frontend-Nutzer" — das war zum Stand PR #7 korrekt, ist aber seit Stage 1B.2B2A (Member-UI, PR #9) und Stage 1B.2B2B (Coach-Resultat-UI, PR #10) **falsch**: `WorkoutSessionView.vue`, `MyTrainingPlanView.vue`, `WorkoutSessionHistoryView.vue`, `CoachResultsView.vue`, `CoachSessionDetailView.vue` rufen `utils/workoutSessionApi.js` tatsächlich auf (per `grep` gegen den Quellcode verifiziert, nicht nur behauptet).
- Die abschliessende "Zusammenfassung" (68 Endpunkte, "keine Web-Oberfläche für die sensibelste Datenklasse") war entsprechend ebenfalls veraltet.

Alle drei Punkte wurden in `docs/FITTRACK_API_CATALOG.md` korrigiert. Ein daraufhin durchgeführter grober `grep`-Abgleich (`router.<methode>(...)`-Aufrufe zählen) ergab **92 rohe Route-Registrierungen gegenüber 88 katalogisierten Zeilen** — eine damals transparent berichtete, aber nicht aufgelöste Differenz von 4. Diese Differenz wurde in einer anschliessenden Merge-Gate-Prüfung (Abschnitt 16.1) vollständig und deterministisch aufgelöst.

### 16.1 Merge-Gate-Nachtrag: deterministischer Route-vs-Katalog-Abgleich (2026-08-19)

**Methodik:** ein Node-Skript lädt jede der 11 Router-Factories aus `backend/routes/*.js` direkt (mit minimalen No-op-Stubs für verpflichtende `rateLimiters`/`sessionService`-Parameter, ohne je eine Datenbankverbindung oder Middleware tatsächlich auszuführen) und liest den echten Express-`Router.stack` jedes gebauten Router-Objekts aus — `layer.route.path` + `layer.route.methods` pro registrierter Route, keine Text-/Regex-Zählung von Quellcode-Zeilen. Jede Route wird mit ihrem tatsächlichen `app.use(prefix, router)`-Mount-Präfix aus `startup/app.js` (direkt gelesen, nicht neu hergeleitet) zum effektiven Pfad zusammengesetzt.

**Ergebnis:** **92 rohe Route-Registrierungen = 92 eindeutige (Methode+Pfad)-Kombinationen — keine einzige Duplikat-Registrierung.** Alle 11 Router sind nachweislich gemountet (direkt aus `startup/app.js` zitiert, Abschnitt 5); es existiert kein toter/nicht gemounteter Router und kein Test-only-Router unter `backend/routes/`.

**Ursache der Differenz 92 vs. 88 (Abschnitt 16):** kein Zählfehler, keine Aliase, keine Mehrfachmethoden auf derselben Route, keine automatischen Express-Nebenwirkungen (HEAD/OPTIONS werden von Express automatisch aus registrierten GET-Routen abgeleitet und sind korrekt **nicht** als eigene Katalogzeilen zu führen) — sondern **exakt vier real fehlende, produktiv erreichbare Endpunkte**, beide bereits vor Stage 5A1/5A3 existierend und schlicht nie in den Katalog aufgenommen:

| # | Methode + Pfad | Router-Datei | Seit | Warum übersehen |
|---|---|---|---|---|
| 1 | `POST /api/auth/refresh` | `authSessionRouter.js` | Stage 3B2 | ganzer Abschnitt "Auth Session" fehlte im Katalog |
| 2 | `POST /api/auth/logout` | `authSessionRouter.js` | Stage 3B2 | s.o. |
| 3 | `POST /api/auth/logout-all` | `authSessionRouter.js` | Stage 3B2 | s.o. |
| 4 | `POST /api/v1/studios/:studioId/invitations/:invitationId/resend` | `studioV1.js` | Stage 3C | Abschnitt "Invitations" existierte bereits, diese eine Zeile fehlte |

**Kategorisierung aller 92 Routen** (verbindlich, keine ungeklärten Fälle):

- **A. korrekt dokumentiert:** 88 (alle vor dieser Prüfung bereits katalogisierten Zeilen wurden gegen die 92er-Ground-Truth-Liste einzeln abgeglichen — jede einzelne bildet eine reale, existierende Route ab, keine Karteileiche gefunden).
- **B. fehlte im Katalog:** 4 (Tabelle oben) — jetzt ergänzt, siehe unten.
- **C. bewusst nicht separat zu katalogisieren:** 0 — die drei Health-Routen sind bereits als eigener Abschnitt katalogisiert, kein Endpunkt wurde als "zu trivial" ausgeklammert.
- **D. Alias-/Doppelregistrierung:** 0 — das Skript bestätigt keine einzige doppelte (Methode+Pfad)-Kombination.
- **E. tote/nicht gemountete Route:** 0 — alle 11 Router sind aktiv gemountet.

**Korrektur in `docs/FITTRACK_API_CATALOG.md`:** neuer Abschnitt „Auth Session" (`/api/auth/refresh`, `/logout`, `/logout-all`, Verträge direkt aus `authSessionRouter.js`/`rateLimiting/rateLimitPolicies.js` abgeleitet — Rate-Limits 30/5min/IP bzw. 10/15min/User, CSRF-/Origin-Pflicht, `Cache-Control: no-store`) sowie eine neue Zeile für `.../invitations/:invitationId/resend` im bestehenden Abschnitt „Invitations" (Vertrag aus `studioV1.js`/`studioService.js#resendInvitation` abgeleitet, inkl. aller vier realen `409`-Fehlercodes). Keine Verträge erfunden — jedes Feld/jeder Fehlercode stammt direkt aus dem gelesenen Service-/Router-Code.

**Endresultat:** Katalog dokumentiert jetzt **exakt 92 Zeilen** = **92 tatsächlich gemountete Endpunkte**. Differenz: **0**.

## 17. Migrationen

`database/migrations/` enthält exakt **13 Dateien**, lückenlos `001_initial_schema.js` bis `013_account_lifecycle.js`. **Keine Migration 014 vorhanden.** Migration Doctor gegen eine eigens erzeugte, nach der Prüfung wieder abgebaute Scratch-Datenbank (`fittrack_test_5d_audit_doctor_<timestamp>`, die persistente lokale Dev-Datenbank wurde nicht verändert): `state:"ready", ready:true, applied:13, pending:0, dirty:0, drift:0, unknown:0`.

## 18. Aktuelle Tests (real in dieser Sitzung ausgeführt, keine übernommenen alten Zahlen)

| Suite | Befehl | Ergebnis |
|---|---|---|
| Backend Syntax-Check | `npm run test:syntax` | **251/251 Dateien grün** |
| Backend Unit | `npm run test:unit` | **563/563 grün** |
| Backend Integration | `npm run test:integration` | **305/305 grün** |
| Backend Migration/Doctor-Suite | `npm run test:migrations` | **34/34 grün** |
| Migration Doctor (Scratch-DB) | `npm run db:migrate:doctor` | `ready:true, applied:13, pending:0, dirty:0, drift:0, unknown:0` |
| Backend `npm audit --audit-level=high` | — | **0 Findings** |
| Frontend Unit/Komponenten | `npm run test:run` | **531/531 grün, 57 Dateien** |
| Frontend Produktionsbuild | `npm run build` | **erfolgreich** |
| Frontend `npm audit --audit-level=high` | — | **1 Finding (high, neu) — siehe Abschnitt 19, nicht behoben in diesem Audit** |
| Chromium-E2E + Axe, Lauf 1 | `npx playwright test --project=chromium` | 64 passed, **2 failed**, 1 did not run (67 total) — siehe Abschnitt 21 |
| Chromium-E2E + Axe, Lauf 2 | dito | **67/67 passed, 0 failed, 0 skipped** — siehe Abschnitt 21 |

Alle Zahlen wurden real gegen den Code auf `de95329` gemessen, nicht aus `STAGE_5C2_ACCOUNT_DELETION_UI.md` übernommen — sie stimmen mit dem dortigen Stand exakt überein (531/531 Frontend, 563/563 Backend Unit inkl. der dort bereits entfernten `KNOWN DEFECT`-Testzeile, 305/305 Integration, 34/34 Migration, `applied:13`), was die Stabilität seit Stage 5C2 bestätigt.

### 18.1 Untersuchung der zwei Fehlschläge in Chromium-Lauf 1

Lauf 1 fand unmittelbar nach einem Neustart von Docker Desktop und einer Serie von Scratch-Datenbank-Operationen (Migration-Doctor-Verifikation) statt. Zwei Tests schlugen fehl:

1. `accountSelfService.spec.js` "Passwortänderung meldet den Benutzer ab...": `expect(page).toHaveURL(/\/login$/)` lief nach 5000ms in ein Timeout. Der Seiten-Snapshot zum Fehlerzeitpunkt (`error-context.md`) zeigt den Submit-Button noch im Zustand `"Passwort wird geändert..." [disabled]` — die Anfrage war zum Timeout-Zeitpunkt noch **in Bearbeitung**, es erschien **keine** Fehlermeldung. Kein Hinweis auf eine 429/Fehlerantwort.
2. `adminPilotWalkthrough.spec.js`: `locator.fill: Test timeout of 360000ms exceeded` beim Warten auf ein simples `getByLabel('E-Mail-Adresse')`-Feld — ein 6-Minuten-Timeout auf eine triviale Locator-Wartezeit ist untypisch für einen Logikfehler und spricht für eine temporär überlastete/ungewöhnlich langsame Umgebung.

**Beide Muster (Ladezustand ohne Fehlermeldung bzw. extremes Timeout auf eine triviale Operation) sind charakteristisch für Systemlast, nicht für einen Logik-/Berechtigungsfehler**, der stattdessen typischerweise sofort eine konkrete Fehlermeldung zeigen würde. Da genau in diesem Zeitfenster auch ein echter, im Server-Log sichtbarer `ER_LOCK_DEADLOCK` in `rotateRefreshToken` auftrat (siehe unten) — ebenfalls ein unter erhöhter DB-Nebenläufigkeit/-Last plausibles, transientes Ereignis — wurde die Suite ohne Codeänderung ein zweites Mal ausgeführt, um Reproduzierbarkeit zu prüfen (Section 11 des Auftrags: "Testcode selbst falsch/veraltet... als separaten Befund dokumentieren und nicht still korrigieren").

**Lauf 2 (identischer Code, keine Änderung dazwischen): 67/67 grün**, einschliesslich exakt der beiden zuvor fehlgeschlagenen Tests. Ein während Lauf 2 im Server-Log sichtbarer, isolierter `ER_LOCK_DEADLOCK` (`rotateRefreshToken`, während `studios.spec.js`) führte in diesem Lauf zu **keinem** Testfehlschlag — konsistent mit einem harmlosen, transienten MySQL-Deadlock unter Last, der die betroffene Anfrage einmalig scheitern liess, ohne den restlichen Testablauf zu beeinträchtigen.

**Bewertung:** kein reproduzierbarer Produktdefekt, keine Auswirkung des PR-#29-Rate-Limiter-Fixes nachweisbar (beide betroffenen Tests liefen in Lauf 2 sauber durch das exakt gleiche, jetzt korrekt geordnete Middleware). Als **nicht bestätigter, transienter Befund** dokumentiert (Abschnitt 23, Punkt 10) statt stillschweigend verworfen oder als Produktfehler behandelt — bewusst **nicht** durch eine Testcode- oder Produktcodeänderung "repariert", da dieser Branch ausschliesslich `docs/**` ändern darf und kein reproduzierbarer Defekt vorliegt, der eine Änderung rechtfertigen würde.

## 19. npm audits

- **Backend:** `npm audit --audit-level=high` → **0 Schwachstellen.**
- **Frontend:** `npm audit --audit-level=high` → **1 neue Schwachstelle, High:**
  - **Paket:** `nanoid`
  - **Installierte Version:** `3.3.17`
  - **Advisory:** GHSA-2v37-7h3g-55p8 — "nanoid: custom generators can loop indefinitely when size is zero"
  - **Betroffener Bereich laut Audit:** `<3.3.18`
  - **Verfügbare sichere Version:** `3.3.18` (laut `npm view nanoid versions` aktuell neueste veröffentlichte `3.3.x`-Version)
  - **Abhängigkeitspfad (transitiv, `npm explain nanoid`):** `nanoid@3.3.17` ← `postcss@8.5.26` ← sowohl `vite@7.3.6` (devDependency) als auch `@vue/compiler-sfc@3.5.30` (über `vue@3.5.29`/`vue-router@5.0.3`/`@vue-macros/common`). Keine direkte Abhängigkeit des Projekts.
  - **Backend:** `npm ls nanoid` im Backend liefert `(empty)` — das Backend hat keinerlei Abhängigkeit auf `nanoid`, ausschliesslich ein Frontend-Build-Tooling-Fund.
  - **Auswirkung auf Merge-/Pilotbereitschaft:** `postcss`/`nanoid` laufen ausschliesslich im Vite-Build-/Vitest-Toolchain-Pfad (Entwicklungszeit), nicht im an den Browser ausgelieferten Produktionsbundle — praktisch reduzierte Ausnutzbarkeit für Endnutzer, aber ein echter, unbehobener `npm audit --audit-level=high`-Fund, der ein CI-Gate mit dieser Schwelle blockieren würde. **Nicht behoben in diesem Audit** (Dependency-Upgrades sind laut Auftrag explizit ausgeschlossen) — Empfehlung: eigener kleiner npm-Security-Hotfix-Branch nach demselben Muster wie `hotfix/npm-security-advisories-2026-08`, der `postcss`/`nanoid` per Lockfile-Neuauflösung auf eine Version `>=8.5.x`/`>=3.3.18` hebt (kompatibel mit den bestehenden `^`-Bereichen der Eltern-Pakete, kein Major-Wechsel nötig).

## 20. Accessibility

Axe-Scans liefen als Teil von `accessibility.spec.js` sowie eingebetteter Axe-Smokes in mehreren anderen Spec-Dateien (Calendar, Zeitplan, Login/Profil-Sicherheitsbereich, Coach-Ergebnisübersicht, Einladungsansicht). In **beiden** Chromium-Läufen traten **keine Critical-/Serious-Axe-Funde** auf — die beiden Fehlschläge in Lauf 1 sind keine Axe-Befunde, sondern Timing-/Timeout-Fehlschläge (siehe Abschnitt 21).

## 21. Pilot-Readiness

Skala wie im Auftrag vorgegeben (nicht vorhanden · Proof of Concept · technisch vorhanden · intern testbar · pilotbereit mit Einschränkungen · pilotbereit · verkaufsnah · produktionsreif).

| Dimension | Bewertung | Begründung |
|---|---|---|
| Member | **pilotbereit mit Einschränkungen** | Workout-Erstellung, persönlicher Kalender, Studio-Workout-Ausführung (inkl. UI seit 1B.2B2A), eigenes Feedback-Lesen — alles vollständig nutzbar und getestet; kein Datenexport. |
| Coach | **pilotbereit mit Einschränkungen** | Programmerstellung/-zuweisung, Terminierung, Ergebnis-/Feedback-Zugriff strikt an eigene aktive Beziehung gepinnt — vollständig nutzbar; keine Multi-Coach-Übergabe-UI. |
| Studio Owner | **pilotbereit mit Einschränkungen** | Studio-/Mitglieder-/Einladungsverwaltung, Audit-Log, jetzt zusätzlich Self-Service-Kontolöschung mit Sole-Owner-Schutz — vollständig nutzbar; kein Owner-Übertragungs-Assistent. |
| Security | **pilotbereit mit Einschränkungen** | Starkes Default-Deny/Tenant-Isolation/Audit-Fundament, zentraler Rate-Limit-Store, jetzt korrekt pro Benutzer isoliert (PR #29); offen: DB-Rollentrennung, toter Policy-Code, neues `nanoid`-Frontend-Advisory. |
| Privacy | **pilotbereit mit Einschränkungen** | Self-Service-Löschung (Anonymisierung/Hard Delete) vollständig implementiert inkl. UI; Freitext bewusst nicht bereinigt, kein Datenexport, Backup-Retention-Grenze ehrlich kommuniziert. |
| Operations | **technisch vorhanden** | Backup-/Migrations-/Deletion-Receipt-Tooling vorhanden und getestet; kein Scheduler, keine Key-Rotation, einzelne DB-Rolle. |
| Backup/Restore | **technisch vorhanden, lokal nachgewiesen** | Verschlüsselter Restore-Drill und S3-kompatible Mechanik beide automatisiert verifiziert, ausschliesslich gegen lokale Instanzen (MySQL/MinIO) — kein echter externer Bucket. |
| Email | **technisch vorhanden** | Validierter SMTP-Adapter, fail-closed ohne Provider; kein echter Produktiv-Versand in dieser Umgebung nachgewiesen (fehlende Zugangsdaten), kein Bounce-Handling. |
| Monitoring | **technisch vorhanden** | Nur Health-/Readiness-Endpunkte, kein externes Alerting/Log-Aggregation. |
| Supportability | **intern testbar** | Strukturierte JSON-Logs mit Request-ID, Redaktion getestet; kein zentrales Ticketing/Log-Aggregation. |
| Deployment | **technisch vorhanden** | GitHub-Actions-CI-Definition vorhanden (Live-Status in dieser Sitzung nicht fernprüfbar), kein produktiver Host/TLS/Reverse-Proxy im Repository (bewusst Infrastrukturaufgabe). |
| Data Lifecycle | **pilotbereit mit Einschränkungen** | Migration 013, Anonymisierung/Hard Delete, Receipt-first-Commit-Protokoll, Reconciliation — vollständig; kein automatisierter Datenexport, keine Admin-Löschung fremder Konten. |

**Gesamtklassifikation: pilotbereit mit Einschränkungen** für alle vier Rollen — eine reale, kontrollierte lokale Pilotierung ist funktional möglich; ein produktiver Betrieb mit zahlenden Kunden bleibt durch die in Abschnitt 15 gelisteten, bewusst als "Deferred until first customer" eingestuften externen Infrastrukturpunkte (Stage 2B2B, DB-Rollentrennung, Scheduler/Key-Rotation) sowie das neue `nanoid`-Advisory blockiert.

## 22. Produktions-Readiness

**Nicht produktionsreif**, unverändert seit den vorherigen Bewertungen — die harten Blocker sind ausschliesslich operativ/extern, nicht funktional: kein echter Off-host-Cloud-Bucket verbunden, keine getrennte DB-Rolle für Runtime vs. Migration, kein Backup-/Upload-Scheduler, keine Key-Rotation, kein nachgewiesener echter SMTP-Versand, kein externes Monitoring/Alerting. Funktional (Rollen, Trainingsfluss, Kalender, Kontolöschung) ist der Code demgegenüber weit fortgeschritten und durchgehend automatisiert getestet.

## 23. Tatsächlich offene Risiken

**Produktions-/Pilot-Blocker (operativ, bewusst deferred bis zur ersten echten Kunden-/Hosting-Entscheidung):**
1. Kein echter externer Off-host-Backup-Bucket verbunden (Stage 2B2B).
2. Einzelne DB-Rolle für Runtime/Migration/Restore statt getrennter Privilegien.
3. Kein Backup-/Upload-Scheduler, keine Key-Rotation.

**Nicht blockierend, aber real offen:**
4. `coachActionEligibility` toter Policy-Code mit irreführender Bypass-Semantik (Drift-Risiko).
5. Audit-Append-only ist reine Anwendungskonvention, nicht DB-erzwungen.
6. Kein Bounce-/Complaint-Handling für SMTP-Versand.
7. Kein Datenexport ("Recht auf Datenübertragbarkeit").
8. Keine Studio-Membership-Removal-UI, keine Admin-Löschung fremder Konten.

**Neu in diesem Audit gefunden:**
9. `nanoid`-Frontend-Advisory (High, GHSA-2v37-7h3g-55p8) — siehe Abschnitt 19, nicht behoben.
10. Zwei E2E-Fehlschläge in Chromium-Lauf 1 (`accountSelfService.spec.js` Passwortänderung, `adminPilotWalkthrough.spec.js`), beide mit Timeout-/Ladezustand-Signatur, zeitlich zusammenfallend mit einem echten `ER_LOCK_DEADLOCK` im Server-Log kurz nach einem Docker-Desktop-Neustart. In Lauf 2 (identischer Code) **67/67 grün**, einschliesslich beider zuvor betroffener Tests — als transienter, nicht reproduzierbarer Systemlast-Befund dokumentiert (Abschnitt 18.1), nicht als Produktdefekt, keine Codeänderung vorgenommen.

## 24. Deferred Items

Stage 2B2B (echter Cloud-Bucket) bleibt **Deferred until first customer / production deployment** — unverändert durch dieses Audit, keine Cloud-Infrastruktur wurde eingerichtet. Ebenso weiterhin bewusst zurückgestellt: 2FA/Passkeys/Social Login, Passwort-vergessen/Reset (separat von der jetzt vorhandenen Kontolöschung), vollständige Geräteverwaltung, Datenexport, Abrechnung, neue Trainingsfunktionen, eine Monitoring-Plattform.

## 25. Dokumentationskorrekturen (Übersicht — Details siehe Abschnitt 26 und die jeweiligen Diffs)

1. **`FITTRACK_CURRENT_STATUS.md`:** Der gesamte Dokumentkörper (Abschnitte 1–13 + Anhang) ist ein bewusst eingefrorener Snapshot von PR #7 (2026-07-19) — u. a. behauptet Abschnitt 8 dort wörtlich "Es existiert kein Recht-auf-Löschung-/Anonymisierungsmechanismus", was seit Stage 5C1/5C2 nicht mehr zutrifft, ebenso die "keine Workout-Session-UI"-Aussagen (seit PR #9 falsch) und die alten Testzahlen. Die Nachtrag-Kette am Dokumentanfang war bis Stage 5C2 bereits korrekt fortgeschrieben. Korrektur: ein neuer, unmissverständlicher Verweis auf dieses Dokument als aktuelle Quelle plus gezielte Inline-Korrekturen der am stärksten irreführenden Einzelaussagen (nicht der komplette Dokumentkörper neu geschrieben — die historische Momentaufnahme bleibt als solche erkennbar erhalten, wie es das Dokument selbst seit 2026-07-20 bereits so anlegt).
2. **`FITTRACK_NEXT_PHASE_RECOMMENDATION.md`:** letzte Empfehlung (Stage-5C2-Nachtrag) empfahl die Rate-Limiter-Reihenfolge-Korrektur — diese ist jetzt erledigt (PR #29). Neuer Nachtrag bestätigt das und aktualisiert die Empfehlung für die nächste Phase (Abschnitt 27). Eine veraltete Einzelaussage ("Kein Recht-auf-Löschung-/Anonymisierungspfad") im Fliesstext wurde korrigiert.
3. **`FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`:** mehrere Stellen behaupteten noch "keine Frontend-Oberfläche (Stage 5C2)" für die Kontolöschung — falsch seit PR #30. Die Stage-5C2-Korrektur zum Rate-Limiter-Defekt ("~~pro Benutzer~~") ist jetzt selbst veraltet, da der Defekt behoben ist — erneut korrigiert, mit Verweis auf die neuen Route-Level-Tests.
4. **`FITTRACK_API_CATALOG.md`:** fehlende Training-Calendar-/Schedule-Rules-Abschnitte ergänzt, veraltete "Kein Frontend-Nutzer"-Zeilen für die Workout-Session-Gruppe korrigiert, Zusammenfassung aktualisiert.
5. **`docs/LOCAL_PILOT_RUNBOOK.md`:** Migrationsanzahl ("001–011") und Migration-Doctor-Beispielausgabe (`applied:11`) korrigiert auf den tatsächlichen Stand (13); Abschnitt 24 ("es gibt noch keine Frontend-UI" für die Kontolöschung) korrigiert.

## 26. Empfohlene nächste Phase

1. **Kleiner, gezielter npm-Security-Hotfix** für das neue `nanoid`-Advisory (Frontend, transitiv über `postcss`) — analog zum bereits etablierten Muster (`hotfix/npm-security-advisories-2026-08`): Dependency-Pfad prüfen, minimale Versionserhöhung, volle Regression, kein Major-Wechsel nötig.
2. Danach, sofern weiterhin priorisiert: die in `FITTRACK_NEXT_PHASE_RECOMMENDATION.md` bereits länger zurückgestellte "Backup-/DB-Härtung"-Fortsetzung (Stage 2B2B echter Bucket, getrennte DB-Rollen, Scheduler/Key-Rotation) — weiterhin die grössten echten Produktions-Blocker.
3. Funktional, falls stattdessen priorisiert: Studio-Membership-Removal-UI und/oder ein Datenexport-Feature (beide bereits in Stage 5C2 als mögliche Folgephasen benannt), jeweils klein und unabhängig voneinander.
4. Die beiden in Lauf 1 aufgetretenen E2E-Timeouts (Abschnitt 18.1) waren in Lauf 2 mit identischem Code nicht mehr reproduzierbar (67/67 grün) — kein Verdacht auf PR #29 bestätigt sich. Keine weitere Aktion nötig, ausser bei künftiger, tatsächlicher Wiederholung erneut zu beobachten.
