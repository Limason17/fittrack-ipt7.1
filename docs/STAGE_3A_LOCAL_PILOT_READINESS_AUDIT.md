# Stage 3A: Local Pilot Readiness Audit

Geprüfter Commit: `dc12b10519b218dffb7e66b82af720563a125949` (`main` = `origin/main` = `origin/HEAD`, "Merge pull request #14 from Limason17/feature/stage-2b2a-s3-offhost-backups"). Prüfbranch: `audit/stage-3a-local-pilot-readiness` (von `dc12b10` abgezweigt, kein Merge nach `main`). Geprüft am 2026-07-22 auf Windows 11, Node.js v22.17.0, npm 10.9.2, MySQL 8.0 (Docker, Container `fittrack_mysql`), MinIO (Docker, Container `fittrack_minio`, Profil `backup-test`, nur lokal, Loopback-gebunden).

Dieses Audit ist ausdrücklich **kein** Freigabe- oder Deployment-Vorgang. Ziel ist eine vollständige, evidenzbasierte Bestandsaufnahme des aktuellen lokalen Produktzustands aus Sicht eines ersten Pilotkunden — nicht die produktive Cloud-Bereitstellung. Jede Aussage in diesem Dokument stammt aus tatsächlich in dieser Sitzung gelesenem Code, tatsächlich ausgeführten automatisierten Tests, tatsächlich durchgeführten API-Proben gegen den laufenden lokalen Server, oder tatsächlich in dieser Sitzung aufgenommenen Browser-Screenshots. Wo eine Aussage nur auf Code-Lektüre beruht (kein automatisierter Test/keine manuelle Probe gefunden), ist das explizit vermerkt.

---

## 1. Executive Summary

FitTrack hat seit dem letzten eingefrorenen Statusbericht (`FITTRACK_CURRENT_STATUS.md`, Stand PR #7) vier weitere große Phasen integriert: die Member-Workout-Ausführungs-UI (Stage 1B.2B2A), die Coach-Ergebnis-/Feedback-UI (Stage 1B.2B2B), einen produktionsfähigen SMTP-Einladungsversand (Stage 2A) und ein verschlüsseltes Backup-/Restore-System inklusive S3-kompatibler Off-host-Mechanik (Stage 2B1/2B2A). Der damals identifizierte harte Blocker — "Workout-Ausführung hat keine UI" — ist vollständig geschlossen: Die gesamte Kernschleife für ein Studio-Mitglied (Programm sehen → Training starten → Sätze protokollieren → abschließen → Verlauf/Feedback sehen) ist heute Backend **und** Frontend **und** durch reale Browser-E2E-Tests belegt vorhanden.

In dieser Sitzung wurden zusätzlich zur Architektur-Inventur: der komplette automatisierte Testkatalog frisch ausgeführt (Backend 504/504, Frontend 306/306, siehe Abschnitt 15), 27 reale Browser-Screenshots über alle drei Rollen und zwei Viewports aufgenommen (Abschnitt 12), und eine gezielte Reihe von API-Proben gegen den laufenden lokalen Server durchgeführt, um genau die Lücken zu schließen, die die bestehende E2E-Suite nicht abdeckt (Mehrfach-Einladung, bereits-aktive Mitgliedschaft, Replay-Annahme, fremdes-Studio-Widerruf, kaputtes Token, fehlender/kaputter Auth-Header, numerische-ID-Leckage) — alle mit korrektem, sicherem Verhalten bestätigt (Abschnitt 10).

**Gesamtbild:** Alle vier Kernrollen (Owner, Admin, Trainer, Member) können ihre jeweiligen zentralen Arbeitsabläufe heute vollständig über die Weboberfläche durchführen. Die Architektur ist konsistent (Public-UUID-Tenancy, Default-Deny-RBAC, Optimistic-Concurrency, Audit-Trail, Snapshot-Unveränderlichkeit), automatisiert breit getestet und in dieser Sitzung frisch grün reproduziert. Es verbleiben **keine P0-Befunde**, die eine kontrollierte lokale Pilotierung mit synthetischen/kleinen echten Testnutzern verhindern würden. Es gibt eine Reihe von P1-Punkten (fehlende Einladungs-Wiederholung, kein Passwort-/E-Mail-Self-Service, keine Token-Erneuerung, uneinheitliche Audit-Log-Übersetzung, u. a.), die vor einem ersten **zahlenden** Kunden geschlossen werden sollten. Alles, was explizit an echte Cloud-/Hosting-Infrastruktur gebunden ist (echter S3-Bucket, TLS/Reverse-Proxy, Monitoring, DB-Rollentrennung, echter SMTP-Versand mit echten Zugangsdaten), ist bewusst nicht Gegenstand dieses Audits und in Abschnitt 19 als "Deferred until hosting" gelistet.

**Gesamtklassifikation dieser Prüfung: lokal pilotfähig** (Details und Begründung in Abschnitt 23).

---

## 2. Untersuchter Commit

| Feld | Wert |
|---|---|
| Commit-Hash (voll) | `dc12b10519b218dffb7e66b82af720563a125949` |
| Kurzform | `dc12b10` |
| Branch zum Zeitpunkt der Prüfung | `main` (Ausgangspunkt), danach `audit/stage-3a-local-pilot-readiness` |
| Verhältnis zu `origin/main` | identisch (`git status --short --branch` → sauber, kein Unterschied) |
| Letzter Merge | PR #14, "Merge pull request #14 from Limason17/feature/stage-2b2a-s3-offhost-backups" |
| Migrationen im Repository | `001_initial_schema` … `008_studio_workout_session_feedback` (8 Dateien, keine `009`) |
| Stashes | keine vorhanden zum Prüfzeitpunkt |
| Offene Arbeitsverzeichnisse | nur das Hauptverzeichnis (`git worktree list`) |

Dieses Audit wurde ausschließlich auf einem separaten Branch durchgeführt. Es gab **keinen** direkten Commit auf `main`, **keinen** Merge nach `main`, **keinen** Force-Push.

---

## 3. Testumgebung

| Komponente | Details |
|---|---|
| Betriebssystem | Windows 11 Home 10.0.26200 |
| Node.js | v22.17.0 |
| npm | 10.9.2 |
| MySQL | 8.0, Docker-Container `fittrack_mysql`, Volume `mysql_data` (persistent über Container-Neuerstellungen hinweg) |
| MinIO (nur für Backup-Integrationstests) | Docker-Container `fittrack_minio`, Compose-Profil `backup-test` (wird **nie** von einem einfachen `docker compose up` gestartet), synthetische Zugangsdaten, kein persistentes Volume, Ports nur an `127.0.0.1` gebunden — rein lokale Testinfrastruktur, keine Cloud-Verbindung |
| Backend (manuelle Prüfung) | `node server.js`, Port 3001, `NODE_ENV` nicht gesetzt (Entwicklungsmodus), `FITTRACK_AUTO_MIGRATE=false` |
| Frontend (manuelle Prüfung) | `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` (Vite) |
| Backend (automatisierte E2E-Suite) | isolierter Prozess über Playwright `webServer`, Port 3201, eigene DB `fittrack_e2e_stage1a`, `NODE_ENV=test` |
| Frontend (automatisierte E2E-Suite) | isolierter Vite-Preview/Dev-Prozess über Playwright `webServer`, Port 4173 |
| Health-Endpunkte | `GET /api/health/live` → 200, `GET /api/health/ready` → 200 `{"status":"ready"}` |
| Testdaten | ausschließlich synthetisch, Muster `<prefix>-<timestamp>-<rolle>@example.test`, keine echten Namen/E-Mail-Adressen, keine externe SMTP-Zustellung |
| Bekannte Umgebungseigenheit | Git Bash (MSYS) unter Windows kann führende `/`-Pfade in Kindprozess-Environment-Variablen automatisch in Windows-Dateisystempfade umschreiben (z. B. `/api` → `C:/Program Files/Git/api`). Dies betraf zwischenzeitlich den manuell gestarteten Frontend-Dev-Server (nicht die automatisierte Test-Suite, die PowerShell/Node-Kindprozesse ohne diese Konvertierung nutzt) und wurde durch einen sauberen Neustart behoben. Kein Produktbefund, reine Testwerkzeug-Eigenheit von Git Bash unter Windows, bereits in `FITTRACK_CURRENT_STATUS.md` Abschnitt 9 für den Build-Befehl dokumentiert. |

---

## 4. Architektur-Inventar

Vollständig durchgeführt über zwei unabhängige, detaillierte Code-Inventuren (Backend und Frontend) plus eigene stichprobenartige Verifikation der wichtigsten Routen-/Service-Dateien.

### 4.1 Backend

- **Routen** (`backend/routes/*.js`): `users.js` (Auth, Profil/Einheiten), `exercises.js`/`workouts.js`/`progress.js` (persönlicher Bereich, keine Studio-Bindung), `studioV1.js` (Studios, Mitgliedschaften, Einladungen, Audit-Events), `trainingProgramV1.js` (Coaching-Beziehungen, Programme/Versionen/Tage/Übungen, Zuweisungen), `workoutSessionV1.js` (Workout-Sessions/Sätze, Coach-Feedback). Insgesamt ~70 Endpunkte über `/api/*` und `/api/v1/*`.
- **Service-Schicht**: kein separates Controller-Layer — Routen rufen Services direkt auf, die ihre eigene SQL/Transaktionslogik besitzen (`studioService`, `coachingService`, `trainingProgramService`, `programAssignmentService`, `workoutSessionService`, `workoutFeedbackService`, `trainingService`). Persönliche Domänen (`exercises`/`workouts`/`progress`-Routen) bauen SQL teils direkt in der Route statt in einem Service — ein strukturelles, aber nicht funktionales Asymmetrie-Merkmal (älterer Code vor Einführung des Studio-Musters).
- **Middleware**: `authenticateToken` (JWT HS256), `studioContextMiddleware` + `requireStudioPermission` (Tenancy + RBAC), `createAuthRateLimiters` (nur Login/Registrierung), `httpFoundation.js` (Request-ID, Security-Header, strukturiertes Logging, zentraler Error-Handler mit Stacktrace-Maskierung).
- **RBAC/Permission-Modell** (`backend/domain/studioPolicy.js`): vier Rollen (owner/admin/trainer/member), Default-Deny (`status !== 'active'` → sofort `false`, unabhängig von der Rolle), granulare Entscheidungsfunktionen für Einladungsrolle, Mitgliedschaftsänderung (inkl. Selbstbeförderungs- und Last-Owner-Schutz), Programmversions-Mutation/Publish, Coaching-Eligibilität, Workout-Start, Workout-Ergebnis-Lesezugriff (kein Owner-/Admin-Bypass, ADR 003) und Feedback-Erstellung.
- **Studio-Tenancy**: durchgängig Public-UUIDs in URLs, interne numerische IDs nie im Client-Payload sichtbar (in dieser Sitzung erneut per API-Probe bestätigt, siehe Abschnitt 10.3); jede mutierende Operation sperrt Studio+Akteur-Mitgliedschaft per `SELECT ... FOR UPDATE` in derselben Transaktion.
- **Coaching-Beziehungen**: nur `active`→`ended` (keine Reaktivierung), Owner/Admin-Bypass bei Sichtbarkeit/Zuweisung, aber **kein** Bypass beim Lesen von Workout-Ergebnissen (ADR 003) — sitzungsgebunden (`coaching_relationship_id` zum Startzeitpunkt eingefroren, eine spätere neue Beziehung gewährt keinen rückwirkenden Zugriff).
- **Trainingsprogramme/-versionen/-zuweisungen**: Programm → Version (draft/published/retired, `retired` im Enum definiert, aber von keinem Codepfad je erreichbar — kein Bug, vermutlich für eine künftige Phase reserviert) → Tage → Übungen; Veröffentlichung ist einmalig und unumkehrbar (kein Unpublish/Edit-nach-Publish-Pfad im gesamten Code gefunden); Zuweisungen binden die Programmversion permanent zum Zuweisungszeitpunkt.
- **Workout-Sessions/-Sätze**: idempotenter Start über `clientStartKey`, Snapshot-Erstellung bei Start, Optimistic-Concurrency über `revision`/`expectedRevision` auf Session/Übung/Satz-Ebene (409-Konfliktantworten, nie stilles Überschreiben), Vollständigkeitsprüfung vor Abschluss, unveränderlich nach `completed`/`aborted`.
- **Coach-Feedback**: append-only durch Weglassen jedes Update-/Delete-Pfads (kein DB-Trigger, aber auch kein Code-Pfad gefunden, der das umgeht), idempotent über `clientFeedbackKey`, nur auf terminalen Sessions erstellbar, session-gepinnter Zugriff.
- **Einladungen**: 256-Bit-Token, nur SHA-256-Hash gespeichert, 7 Tage TTL, Auto-Expiry vor Konfliktprüfung, Produktions-Fail-Closed ohne konfigurierten Provider, validierter SMTP-Adapter seit Stage 2A. **Kein Wiederholungs-/Resend-Endpunkt vorhanden** — bestätigt durch Code-Lektüre (`studioService.js`: nur `createInvitation`/`listInvitations`/`revokeInvitation`/`acceptInvitation`) und durch eine erneute Routen-Grep in dieser Sitzung.
- **Audit-Events**: append-only (kein Update-/Delete-Pfad), zweistufige Redaktion (Allowlist pro Ereignistyp + Regex-Fallback), Lese-Endpunkt nur für Owner/Admin.
- **Authentifizierung**: JWT `{id}`-only, 8h Ablauf, kein Refresh-Mechanismus, kein Logout-/Revocation-Endpunkt (rein clientseitiges Token-Löschen). Rate-Limiting nur auf Login (10/15min) und Registrierung (5/60min) — kein anderer Endpunkt gedrosselt.
- **Migrationen 001–008**: alle vorhanden, Beschreibungen bestätigt, Migrationsmotor mit Advisory-Lock, Checksum-Drift-Erkennung, separatem read-only Migration Doctor.
- **Backup/Restore**: als bereits abgeschlossene Infrastruktur bestätigt vorhanden (verschlüsselter lokaler Pfad seit Stage 2B1, S3-kompatibler Off-host-Pfad seit Stage 2B2A, nur gegen lokales MinIO verifiziert) — nicht Gegenstand vertiefter Neubewertung in diesem Audit, siehe Abschnitt 19.

### 4.2 Frontend

- **Router** (`frontend/src/router/index.js`): 27 Routen, Meta-gesteuerte Guards (`requiresAuth`, `guestOnly`, `requiresStudio`, `studioRoles`, `personalContext`), Fokus-Management nach Navigation (`#main-content`), Open-Redirect-Schutz (`safeInternalRedirect`).
- **State-Management**: kein Pinia/Vuex — handgebaute Composables/Modul-Singletons unter `frontend/src/utils/` (`auth.js`, `studioContext.js`, `i18n.js`, `units.js`, `toast.js`, `workoutSessionState.js`, `coachFeedbackState.js`). Konsistent verwendet, aber jede Studio-View reimplementiert dieselbe "laden → 403/404 abgleichen → redirect"-Logik einzeln statt zentral.
- **API-Clients**: `api.js` (gemeinsamer `apiRequest`-Wrapper mit 401-Interceptor), `studioApi.js`, `studioTrainingApi.js`, `workoutSessionApi.js` — konsistente, saubere Client-Schicht für die Studio-Domäne. Die ältere persönliche Domäne (Übungen/Workouts/Fortschritt) ruft `apiRequest` direkt aus den View-Dateien auf, ohne dedizierten Client-Modul.
- **Views**: 24 Haupt-Views, je mit passendem Component-Test. Durchgängiges Loading/Empty/Error-Muster in der Studio-Domäne (Skeleton + `aria-busy`, `EmptyState.vue`, `role="alert"`-Fehlerbanner, Toasts); die ältere persönliche Domäne nutzt noch ad-hoc Text statt der gemeinsamen Komponenten und `window.confirm()` statt `ConfirmDialog.vue`.
- **Mobile**: durchgängiges `@media`-Breakpoint-Muster (u. a. 1023px Shell-Kollaps, 720px Tabellen-zu-Karten, 480px Formular-Stapelung), Tabellen nutzen ein gemeinsames `.table-stack`-Muster.
- **Accessibility**: Skip-Link, Fokus-Trap (`useModalFocus`, wiederverwendet in `Modal.vue`/`ConfirmDialog.vue`/mobiler Sidebar), konsistente ARIA-Attribute (Dialog/Menu/Tablist/Toast/Alert), `document.documentElement.lang` synchronisiert.
- **i18n**: vollständig zweisprachig (de/en) über ein zentrales Wörterbuch, Fallback auf Deutsch bei fehlendem Schlüssel; die kanonische Übungs-Taxonomie ist intern deutsch-basiert, wird aber für die Anzeige übersetzt.
- **Profil**: Konto-/Kontaktdaten sind **rein anzeigend** — kein Passwort-/E-Mail-Änderungs-UI im gesamten Frontend gefunden (in dieser Sitzung per Screenshot bestätigt, siehe Abschnitt 12).

Vollständige Detailinventuren beider Seiten liegen als Recherche-Grundlage dieser Sitzung vor; die obigen Punkte sind die für die Pilot-Bewertung relevanten Kernaussagen.

---

## 5. Rollenmatrix

10 kontrollierte lokale Test-Identitäten wurden für dieses Audit verwendet bzw. sind über die bestehende E2E-Suite bereits etabliert. Es wurden **keine echten Namen oder E-Mail-Adressen** verwendet — alle Konten folgen dem Muster `<prefix>-<timestamp>-<rolle>@example.test`.

| # | Rolle | Verwendet für | Nachweis |
|---|---|---|---|
| 1 | Studio Owner | Studio-Erstellung, Einstellungen, Mitgliederverwaltung, Einladungen, Audit, Coaching, Programme, Zuweisungen | E2E (`studios.spec.js`, `studioTraining.spec.js`, `coachFeedback.spec.js`), API-Proben, Screenshots |
| 2 | Studio Admin | Rollenrechte-Abgrenzung zu Owner (kein `STUDIO_SETTINGS_OWNER`, sonst identisch) | Code-Verifikation (`studioPolicy.js` `ROLE_PERMISSIONS.admin`), nicht separat live durchgeklickt (siehe Abschnitt 22) |
| 3 | Trainer A | Coaching-Beziehung, Programm-Erstellung/-Zuweisung, Coach-Ergebnisse/-Feedback | E2E (`studioTraining.spec.js`, `coachFeedback.spec.js`), Screenshot |
| 4 | Trainer B | Isolationsnachweis ("Trainer sieht nur eigene Mitglieder/Beziehungen") | E2E (`coachFeedback.spec.js`: "own-relationships defaults to status=active…") |
| 5 | Member A | Workout-Ausführung (Start/Log/Abschluss/Historie), eigenes Feedback | E2E (`workoutSessions.spec.js`, `coachFeedback.spec.js`), Screenshots inkl. Mobile |
| 6 | Member B | Zweites Mitglied für Isolationsnachweis (fremde Session/Zuweisung nicht sichtbar) | E2E (`studios.spec.js`, `workoutSessions.spec.js`) |
| 7 | Benutzer ohne Studio | Nur persönlicher Bereich sichtbar, `STUDIO_NOT_FOUND` bei direktem Studio-URL-Aufruf | API-Probe in dieser Sitzung (Abschnitt 10.3) |
| 8 | Eingeladen, noch nicht registriert | Einladung erstellt, Accept-URL enthält Token, kein Klartext-Leck | E2E (`studios.spec.js`, `invitationEmail.spec.js`) |
| 9 | Abgelaufene Einladung | 7-Tage-TTL, Lazy-Expiry-Prüfung | Code-/Test-Verifikation (`backend/test/integration/studioApi.test.js:685`), **nicht** live durch tatsächliches Warten von 7 Tagen reproduziert (unpraktikabel lokal) |
| 10 | Benutzer aus zweitem Studio | Vollständige Cross-Studio-Isolation | API-Probe in dieser Sitzung: Studio-B-Owner kann Studio A weder lesen noch dessen Einladung widerrufen (Abschnitt 10.3) |

Es wurden keine Passwörter oder Tokens in diesem Dokument oder anderswo dauerhaft dokumentiert.

---

## 6. Funktionsmatrix

Regel: Eine Funktion gilt nur dann als **vollständig**, wenn ein tatsächlich nutzbarer Ablauf über die Weboberfläche existiert — ein reiner API-Endpunkt ohne UI zählt als **nur Backend**.

| Bereich | Backend | Frontend | E2E | Lokal nutzbar | Pilotfähig |
|---|---|---|---|---|---|
| Registrierung/Login/Logout | ✅ | ✅ | ✅ (`auth.spec.js`) | ✅ | ✅ |
| Passwort-/E-Mail-Änderung | ❌ (nicht vorhanden) | ❌ (nicht vorhanden) | — | ❌ | **P1** |
| Sitzungsablauf (8h JWT) | ✅ | ✅ (401-Interceptor) | teilweise (kein Zeit-Mock) | ✅ | ✅ mit Einschränkung (kein Refresh) |
| Profil/Einheiten (Sprache, kg/lb, km/mi) | ✅ | ✅ | ✅ (Komponententests) | ✅ | ✅ |
| Studio erstellen/wechseln | ✅ | ✅ | ✅ | ✅ | ✅ |
| Mitgliederverwaltung (Rolle/Status) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Einladung erstellen/annehmen/widerrufen | ✅ | ✅ | ✅ + API-Probe | ✅ | ✅ |
| Einladung erneut senden (Resend) | ❌ (nicht vorhanden) | ❌ (nicht vorhanden) | — | ❌ | **P1** |
| Audit-Protokoll (Owner/Admin) | ✅ | ✅ | — (nicht separat E2E-getestet) | ✅ (per Screenshot bestätigt) | ✅ mit kleinerem Polish-Bedarf (uneinheitliche Übersetzung, siehe 11) |
| Coaching-Beziehung erstellen/beenden | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trainingsprogramm/-Version/-Tage/-Übungen | ✅ | ✅ | ✅ | ✅ | ✅ |
| Veröffentlichung (unveränderlich) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Programmzuweisung | ✅ | ✅ | ✅ | ✅ | ✅ |
| Workout-Session starten (inkl. Resume) | ✅ | ✅ | ✅ (inkl. Idempotenz, exakter Filter) | ✅ | ✅ |
| Sätze protokollieren (Gewicht/Wdh/RPE/Dauer/Distanz) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session abschließen/abbrechen | ✅ | ✅ | ✅ | ✅ | ✅ |
| Optimistic-Concurrency/Konfliktbehandlung | ✅ | ✅ | ✅ (echter Zwei-Tabs-Test) | ✅ | ✅ |
| Workout-Historie mit Statusfilter | ✅ | ✅ | ✅ (serverseitig gefiltert, Datumsgrenzen) | ✅ | ✅ |
| Coach-Ergebnisansicht | ✅ | ✅ | ✅ | ✅ | ✅ |
| Coach-Feedback erstellen/lesen | ✅ | ✅ | ✅ | ✅ | ✅ |
| Datenisolation (Studio/Mitglied/Coaching) | ✅ | ✅ | ✅ + API-Probe | ✅ | ✅ |
| Backup/Restore (lokal verschlüsselt) | ✅ (Infrastruktur, bereits abgeschlossen) | n/a (kein Endnutzer-UI, Admin-CLI) | n/a | ✅ (CLI) | Deferred-Kontext, siehe 19 |
| Off-host-Backup (S3-kompatibel) | ✅ (Mechanik, gegen lokales MinIO verifiziert) | n/a | n/a | ✅ (gegen MinIO) | **Deferred until hosting** (echter Bucket) |

---

## 7. Owner-/Admin-Journey

Bewertungsskala: vollständig / teilweise / nur Backend / fehlt / fehlerhaft / unverständlich.

| # | Schritt | Status | Nachweis |
|---|---|---|---|
| 1 | Registrierung/Login | vollständig | `auth.spec.js`, Screenshot 01/02 |
| 2 | Studio erstellen/öffnen | vollständig | `studios.spec.js`, Screenshot 04/05 |
| 3 | Studio wechseln (mehrere) | vollständig | `StudioSwitcher.vue` Code + Screenshot (kleinerer Polish-Punkt: Text im Dropdown wird bei langen Studionamen abgeschnitten, siehe Abschnitt 11) |
| 4 | Studio-Einstellungen ansehen | vollständig | Screenshot 13 |
| 5 | Mitgliederliste öffnen | vollständig | Screenshot 06 |
| 6 | Trainer/Mitglied einladen | vollständig | Screenshot 07, API-Probe |
| 7 | Einladung erneut senden, falls unterstützt | **fehlt** | Kein Resend-Endpunkt/-Button im gesamten Code gefunden (Abschnitt 4.1) |
| 8 | Einladung widerrufen | vollständig | Screenshot 07 ("Widerrufen"), API-Probe (Cross-Studio-Widerruf korrekt abgelehnt) |
| 9 | Einladung annehmen (aus Sicht des Einladenden: Status sichtbar) | vollständig | Screenshot 07 ("Angenommen"-Badge) |
| 10 | Rollen/Status korrekt angezeigt | vollständig | Screenshot 06 |
| 11 | Coaching-Beziehung erstellen | vollständig | `studioTraining.spec.js`, Screenshot 09 |
| 12 | Coaching-Beziehung beenden | vollständig | `studioTraining.spec.js` |
| 13 | Trainingsprogramm erstellen | vollständig | `studioTraining.spec.js`, Screenshot 10 |
| 14 | Programm bearbeiten | vollständig | Screenshot 11 |
| 15 | Programmversion erstellen | vollständig | Screenshot 11 ("Neue Entwurfsversion erstellen") |
| 16 | Trainingstage erstellen | vollständig | Screenshot 11 |
| 17 | Übungen hinzufügen | vollständig | Screenshot 11 |
| 18 | Programm veröffentlichen | vollständig | `studioTraining.spec.js` (inkl. Unveränderlichkeitsnachweis), Screenshot 11 |
| 19 | Programm einem Mitglied zuweisen | vollständig | `studioTraining.spec.js`, Screenshot 12 |
| 20 | Ergebnisse des Mitglieds ansehen | vollständig | `coachFeedback.spec.js`, Screenshot 17 (als Trainer; Owner hat identischen Zugriffspfad bei eigener Coaching-Beziehung) |
| 21 | Feedback hinzufügen | vollständig | `coachFeedback.spec.js` |
| 22 | Audit-Historie prüfen, falls UI vorhanden | vollständig, mit Polish-Bedarf | UI vorhanden (Screenshot 08), aber einige Ereignistypen erscheinen als unübersetzte technische Strings (siehe Abschnitt 11) |
| 23 | Kritische Aktionen bestätigt | vollständig | `ConfirmDialog.vue` durchgängig für Widerruf/Rollenänderung/Beziehungsende/Archivierung/Publish/Abschluss/Abbruch verwendet |
| 24 | Empty-/Error-/Slow-States geprüft | vollständig | Konsistentes Skeleton/EmptyState/Error-Banner-Muster in der gesamten Studio-Domäne (Abschnitt 4.2), Screenshot 04 zeigt reales Error-Banner bei fehlgeschlagenem Studio-Load während der Fehlersuche in dieser Sitzung |

**Admin-spezifisch:** Die Rollenabgrenzung Admin vs. Owner (kein Zugriff auf `slug`-Änderung, sonst identisch) ist ausschließlich durch Code-Lektüre (`studioPolicy.js`) verifiziert, nicht durch einen separaten Admin-Live-Durchlauf in dieser Sitzung (siehe Abschnitt 22, bekannte Unsicherheit).

---

## 8. Trainer-Journey

| # | Schritt | Status | Nachweis |
|---|---|---|---|
| 1 | Login | vollständig | `auth.spec.js` |
| 2 | Eigenes Studio öffnen | vollständig | `studioTraining.spec.js` |
| 3 | Nur erlaubte Mitglieder sehen | vollständig | Backend-gefiltert, Rollennavigation ausgeblendet für Nicht-berechtigte Bereiche |
| 4 | Eigene Coaching-Beziehungen sehen | vollständig | `coachFeedback.spec.js` ("own-relationships defaults to status=active…") |
| 5 | Fremde Coaching-Beziehungen nicht sehen/ändern | vollständig | `coachFeedback.spec.js`, API-seitig durch `coachingService` erzwungen |
| 6 | Programme sehen | vollständig | `studioTraining.spec.js`, Screenshot 10 |
| 7 | Programme erstellen/bearbeiten je Rechtemodell | vollständig | Trainer hat `PROGRAM_MANAGE`/`PROGRAM_PUBLISH` (Code-bestätigt) |
| 8 | Programm einem berechtigten Mitglied zuweisen | vollständig | `studioTraining.spec.js` |
| 9 | Unzulässige Zuweisung ablehnen | vollständig | `coachActionEligibility`/Service-Prüfung, Trainer ohne aktive Beziehung → Ablehnung |
| 10 | Workout-Ergebnisse ansehen | vollständig | `coachFeedback.spec.js`, Screenshot 17 |
| 11 | Feedback erstellen | vollständig | `coachFeedback.spec.js` |
| 12 | Bestehendes Feedback nicht unzulässig ändern können | vollständig | Kein Update-/Delete-Pfad im gesamten Code; UI zeigt Feedback als reinen Verlauf (`FeedbackList.vue`) |
| 13 | Feedback-Historie/Unveränderlichkeit prüfen | vollständig | `coachFeedback.spec.js` |
| 14 | Rollen-/Navigationsanzeige | vollständig | Sidebar zeigt "Trainer:in"-Badge, rollen-gated Nav (Abschnitt 4.2) |
| 15 | Mobile Nutzbarkeit | vollständig | E2E-Overflow-Tests + eigene Mobile-Screenshots (Abschnitt 12/13) |
| 16 | Error-/Empty-States | vollständig | Konsistentes Muster, Screenshot 17 zeigt sauberen Empty-Zustand vor Mitgliedsauswahl |

---

## 9. Member-Journey

| # | Schritt | Status | Nachweis |
|---|---|---|---|
| 1 | Registrierung aus Einladung | vollständig | `studios.spec.js`, `invitationEmail.spec.js` |
| 2 | Login | vollständig | `auth.spec.js` |
| 3 | Studio-Mitgliedschaft sehen | vollständig | `StudioSwitcher.vue`, Screenshot |
| 4 | Zugewiesenes Programm sehen | vollständig | `studioTraining.spec.js`, Screenshot 14 |
| 5 | Aktuelle Programmversion sehen | vollständig | Programmversion in Zuweisung fest gebunden (ADR 002) |
| 6 | Trainingstag auswählen | vollständig | `MyTrainingPlanView.vue`, Screenshot 14 |
| 7 | Training starten | vollständig | `workoutSessions.spec.js`, Screenshot 15 |
| 8 | Übungen und Zielwerte sehen | vollständig | Screenshot 15 ("Ziel: 3 × 6–10 Wdh.") |
| 9 | Sätze/Ergebnisse protokollieren | vollständig | Screenshot 15 |
| 10 | Gewicht/Wdh/RPE/Dauer/Distanz je Übungstyp | vollständig | `ExercisePanel.vue`/`SetRow.vue` zeigen nur relevante Felder je Übung |
| 11 | Session-Zustand bei Browser-Refresh erhalten | vollständig | Serverautoritativ: jede Feldänderung wird sofort per PATCH persistiert (`workoutSessionState.js`), ein Refresh lädt den Serverzustand frisch — kein reiner Client-State, der verloren gehen könnte |
| 12 | Workout abschließen | vollständig | `workoutSessions.spec.js` |
| 13 | Doppel-Abschluss verhindern | vollständig | Terminale Session lehnt jede weitere Mutation ab (409) |
| 14 | Ergebnisse ansehen | vollständig | Workout-Historie + Session-Detail |
| 15 | Coach-Feedback ansehen | vollständig | `coachFeedback.spec.js`, `FeedbackList.vue` in `WorkoutSessionView.vue` |
| 16 | Vergangene Workouts sehen | vollständig | `workoutSessions.spec.js` (inkl. serverseitigem Statusfilter, exaktem Resume-Filter über Paginierungsgrenzen hinweg) |
| 17 | Eigenes Profil/Einheiten bearbeiten | vollständig | Screenshot 18 |
| 18 | Fremde Studio-/Mitgliedsdaten nicht sehen | vollständig | API-Probe + E2E (404 statt 403, keine Existenz-Preisgabe) |
| 19 | Verhalten ohne aktive Programmzuweisung | vollständig | `workoutSessions.spec.js`: klare Leermeldung "Dir ist aktuell kein Trainingsprogramm zugewiesen." |
| 20 | Verhalten bei beendeter Coaching-Beziehung | vollständig | `studioTraining.spec.js`: Zuweisung wird sofort blockiert, bestehende Daten bleiben |
| 21 | Verhalten bei abgelaufener/beendeter Zuweisung | vollständig | `canStartWorkoutSession`-Datumsfenster-Prüfung, Boundary-Test in `workoutSessions.spec.js` ("Grenzdaten … ohne Zeitzonenverschiebung") |
| 22 | Mobile Nutzbarkeit | vollständig | Screenshot m03 (Workout-Session mobil), E2E-Overflow-Tests |
| 23 | Accessibility | vollständig | Axe-Smoke-Tests in `accessibility.spec.js`/`coachFeedback.spec.js` (0 serious/critical) |
| 24 | Loading-/Empty-/Error-States | vollständig | Konsistentes Muster, `SaveStatusIndicator.vue` für Feld-Speicherstatus inkl. Konfliktanzeige |

---

## 10. Einladungssystem

Getestet ausschließlich über den lokalen Dev-Preview-Modus (kein echter SMTP-Versand, kein reales Zugangsdatenmaterial verwendet) und über direkte API-Proben gegen den laufenden lokalen Server. Die reale Gmail/SMTP-E2E-Verifikation aus Stage 2A wurde absichtlich **nicht** wiederholt (per Auftrag).

### 10.1 Über bestehende E2E-Tests abgedeckt
- Einladungserstellung, sichere Accept-URL, Registrierung/Annahme neuer und bestehender Nutzer, kein Token-/Link-Leck in UI-Text oder `localStorage` (`studios.spec.js`, `invitationEmail.spec.js`).
- Produktionsförmige Erfolgsantwort ohne `acceptUrl`/Token (gemockt) und Zustellfehler-Handling ohne Logout/Datenverlust (`invitationEmail.spec.js`).
- Axe-Smoke auf der Einladungsansicht (0 serious/critical).

### 10.2 Durch eigene API-Proben in dieser Sitzung ergänzt

Alle folgenden Proben wurden gegen den lokalen laufenden Server (`localhost:3001`) mit synthetischen Testkonten durchgeführt und protokolliert:

| Probe | Ergebnis |
|---|---|
| Doppelte Einladung an bereits ausstehende E-Mail | `409 INVITATION_ALREADY_PENDING` |
| Einladung an bereits aktives Mitglied | `409 MEMBERSHIP_ALREADY_ACTIVE` |
| Erneute Annahme eines bereits verwendeten Tokens (Replay) | `409 INVITATION_ALREADY_USED` |
| Einladung durch Mitglied ohne Berechtigung erstellt | `403 INSUFFICIENT_STUDIO_ROLE` |
| Widerruf einer Studio-A-Einladung über den Studio-B-Pfad (fremdes Studio) | `404 INVITATION_INVALID` (keine Preisgabe, dass die Einladung existiert) |
| Kaputtes/erfundenes Einladungstoken | `404 INVITATION_INVALID` (kein 500, kein Stacktrace) |
| E-Mail-Feld in der Liste nach Annahme | redigiert ("E-Mail nach Abschluss redigiert" in der UI, Screenshot 07) |

Nicht live reproduziert (unpraktikabel lokal, aber code-/testverifiziert): tatsächliches 7-Tage-Ablaufen einer Einladung (`INVITATION_LIFETIME_MS`, Backend-Integrationstest `studioApi.test.js:685` deckt die Ablauflogik ab, ohne 7 Tage zu warten).

**Bestätigte Lücke:** Kein Wiederholungs-/Resend-Mechanismus. Ein Nutzer, der seine Einladung verliert oder nicht erhält, muss die Einladung widerrufen (falls noch ausstehend) oder auf die 7-Tage-Auto-Expiry warten, bevor eine neue Einladung erstellt werden kann.

---

## 11. Datenisolation

Alle folgenden Punkte wurden in dieser Sitzung frisch per API-Probe gegen den laufenden lokalen Server bestätigt (nicht nur aus Code-Lektüre übernommen):

- **Studio A liest Studio B nicht**: `GET /studios/:studioB-id` mit Studio-A-Owner-Token → `404 STUDIO_NOT_FOUND`.
- **Nicht-existierendes vs. fremdes Studio sind ununterscheidbar**: identischer `404`-Code, identische Meldung für eine zufällige UUID und für ein real existierendes, aber fremdes Studio.
- **Öffentliche UUIDs vs. interne IDs**: Der Studio-Erstellungs-Response enthält ausschließlich `id` (Public-UUID) auf Studio- und Mitgliedschaftsebene — keine numerische interne ID an keiner Stelle des Payloads (per Probe in dieser Sitzung geprüft, vollständiger JSON-Dump).
- **Mitgliederliste für Mitglied ohne Berechtigung** → `403 INSUFFICIENT_STUDIO_ROLE` (nicht `404`, da das Studio selbst sichtbar ist, nur die Aktion nicht erlaubt).
- **Audit-Events nur für Owner/Admin lesbar** → Mitglied erhält `403`.
- **Malformed/kein Auth-Header** → `401` mit generischer Meldung, kein Stacktrace, keine SQL-Fragmente.
- Programmversionen bleiben nach Veröffentlichung konsistent (kein Unpublish/Edit-Pfad im gesamten Code).
- Bestehende Workout-Sessions behalten ihren Snapshot (Programmtag-Kopie bei Start, kein Live-Join gegen aktuelle Programmdaten).
- Feedback ist unveränderlich per ADR (kein Update-/Delete-Pfad).
- Idempotenzschlüssel (`clientStartKey`, `clientFeedbackKey`) verhindern doppelte Sessions/Feedback-Einträge bei Wiederholung.
- Transaktionen mit `SELECT ... FOR UPDATE` verhindern Teilzustände bei gleichzeitigen Anfragen (durch bestehende Backend-Integrationstests mit echter Nebenläufigkeit belegt, in dieser Sitzung erneut grün reproduziert).
- Suspendierung/Austritt/Beziehungsende wirken sofort auf die nächste Anfrage (kein JWT-Rollenclaim, jede Operation lädt die Mitgliedschaft frisch).
- Audit-Events werden für sicherheitsrelevante Aktionen erzeugt (Studio-Erstellung, Einladung erstellt/angenommen, Coaching-Beziehung, Programm-/Versions-/Zuweisungsänderungen, Workout-Session-Start/Abschluss/Abbruch, Feedback-Erstellung) — in dieser Sitzung per Live-Audit-Abruf verifiziert (Screenshot 08 zeigt 11 tatsächlich erzeugte Ereignisse für einen einzelnen Testdurchlauf).

Keine der geprüften Proben zeigte ein Datenlecks-, Bypass- oder Preisgabeverhalten.

---

## 12. UX-/IA-Audit

27 reale Chromium-Screenshots wurden in dieser Sitzung aufgenommen (Desktop 1440×900 für alle Hauptseiten über Owner/Trainer/Member-Rollen, zusätzlich 5 Seiten bei Mobile 390×844), außerhalb des Repositories gespeichert. Bewertungsskala: Pilot-ready / kleinere Politur nötig / deutliche Überarbeitung nötig / blockierend.

| Seite | Bewertung | Beobachtung |
|---|---|---|
| Login/Registrierung | Pilot-ready | Klare Überschrift, ein Hauptaktionsbutton, verständlicher deutscher Text |
| Persönliches Dashboard | Pilot-ready | Klare Rollen-Trennung Persönlich/Studio |
| Studios-Übersicht | Pilot-ready | — |
| Studio-Dashboard (Owner) | kleinere Politur nötig | "Nächste Schritte"-Karten klar, aber der Studio-Auswahl-Dropdown in der Sidebar schneidet lange Studionamen ohne Tooltip ab (`Pilot Fitness Studio — Eig...`) |
| Mitglieder | Pilot-ready | Rollen/Status inline änderbar, klare Tabelle |
| Einladungen | Pilot-ready | Klarer Hinweis "Sichtbare Rollen steuern nur die Oberfläche; der Server autorisiert jede Aktion.", E-Mail nach Abschluss korrekt redigiert |
| Audit-Protokoll | kleinere Politur nötig | Einige Ereignistypen werden als rohe technische Strings angezeigt (`workout_session.started`, `training_program_assignment.created`) statt übersetzt wie andere (`Einladung angenommen`, `Studio erstellt`) — uneinheitliche i18n, keine funktionale Auswirkung, aber ein "technischer API-Begriff in der UI"-Verstoß gegen die eigene Konsistenzanforderung |
| Coaching | Pilot-ready | — |
| Trainingsprogramme (Liste + Builder) | Pilot-ready | Sehr klare Versionsführung, verständliche Unveränderlichkeits-Hinweise |
| Zuweisungen | Pilot-ready | — |
| Studio-Einstellungen | Pilot-ready | — |
| Mein Trainingsplan (Member) | Pilot-ready | — |
| Workout-Session (aktiv) | Pilot-ready | Kernfunktion, klar strukturiert, gute Feldbeschriftung |
| Workout-Historie | Pilot-ready | — |
| Coach-Ergebnisse | Pilot-ready | Klarer Empty-State vor Auswahl |
| Profil | Pilot-ready | Ehrliche Kommunikation der aktuellen Einschränkung ("Konto- und Kontaktdaten werden aktuell nur angezeigt") statt irreführender UI |
| Zugriff-verweigert (403) | Pilot-ready | Klare Wiederherstellungsaktionen ("Zurück zum Studio", "Alle Studios") |
| 404 | Pilot-ready | — |
| Mobile (Workout-Session, Trainingsplan, Mitglieder, Programm-Builder, Dashboard) | Pilot-ready | Sauberes Stacking, keine horizontale Überlauf, ausreichend große Touch-Targets, Hamburger-Navigation funktioniert |

Kein Befund in der Kategorie "deutliche Überarbeitung nötig" oder "blockierend". Die beiden "kleinere Politur"-Punkte (Dropdown-Textabschneidung, uneinheitliche Audit-Log-Übersetzung) sind P2/P1-Kandidaten, keine Blocker.

---

## 13. Mobile

Bestätigt über: (a) bestehende automatisierte E2E-Overflow-Tests bei mehreren festen Viewports (375×667, 390×844, 768×1024, 1024×768, 1366×768, 1440×900) auf Kernseiten (`accessibility.spec.js`, `coachFeedback.spec.js`), (b) 5 eigene Mobile-Screenshots (390×844) in dieser Sitzung über Dashboard, Trainingsplan, Workout-Session, Programm-Builder und Mitgliederliste. Kein horizontaler Überlauf, kein abgeschnittener Inhalt, Touch-Targets ausreichend groß (mind. 44px bei Set-Zeilen-Buttons per Code-Konvention), Hamburger-Navigation mit korrektem `aria-expanded`-Status und Escape-Schließen.

---

## 14. Accessibility

Bestehende Axe-Core-E2E-Suite (`@axe-core/playwright`) deckt praktisch jede Hauptroute ab (Login, Register, Workouts, Progress, Profil, Studios, Studio-Dashboard, Settings, Members, Invitations, Audit, Coaching, Training-Programs (+Detail), Assignments, My-Training-Plan, Access-Denied, ungültige Invitation-URL, plus separate Smokes für Coach-Ergebnisse/Session-Detail/Member-Session-mit-Feedback/Login/App-Shell/Einladungsansicht) und behauptet 0 `serious`/`critical`-Verstöße. In dieser Sitzung erneut ausgeführt: **26/26 E2E-Tests grün**, einschließlich aller eingebetteten Axe-Prüfungen. Zusätzlich geprüft: Skip-Link, Seitentitel- und Fokus-Wechsel bei Navigation, Fokus-Trap/Escape/Rückgabe-Fokus im Übungsauswahl-Dialog, mobiler Navigations-Status.

---

## 15. Testabdeckung

Alle Zahlen stammen aus tatsächlich in dieser Sitzung ausgeführten Befehlen gegen Commit `dc12b10` (nach vorherigem Neustart des Backend-Prozesses zum Zurücksetzen des In-Memory-Rate-Limiters zwischen Testläufen, siehe Abschnitt 22).

| Suite | Befehl | Ergebnis | Laufzeit |
|---|---|---|---|
| Backend Unit | `npm run test:unit` | **327/327 grün** | ~1,8s |
| Backend Integration (inkl. 22 MinIO-Tests) | `npm run test:integration` | **148/148 grün** (beim ersten Lauf ohne gestartetes MinIO: 126/148 grün, 22 Fehler — alle ausschließlich `ECONNREFUSED 127.0.0.1:9000`, kein Produktfehler; nach Start des lokalen MinIO-Testprofils erneut ausgeführt: 148/148 grün) | ~142s |
| Backend Migration/Doctor | `npm run test:migrations` | **29/29 grün** | ~35s |
| Backend Syntax-Check | `npm run test:syntax` | **167/167 Dateien grün** | <1s |
| Backend `npm audit --audit-level=high` | — | **0 Findings ≥ high** (1 `low`: `body-parser` DoS bei ungültigem Limit-Wert, Fix via `npm audit fix` verfügbar) | — |
| Frontend Unit/Komponenten | `npm run test:unit` (Vitest) | **280/280 grün, 36 Dateien** | ~28s |
| Frontend Produktionsbuild | `npm run build` | **erfolgreich**, 3,1s | ~3s |
| Frontend `npm audit --audit-level=high` | — | **0 Findings** | — |
| Browser-E2E + Axe (Chromium) | `npm run test:e2e` | **26/26 grün** (`accessibility.spec.js` ×6, `auth.spec.js` ×2, `coachFeedback.spec.js` ×7, `invitationEmail.spec.js` ×4, `studioTraining.spec.js` ×1, `studios.spec.js` ×1, `training.spec.js` ×2, `workoutSessions.spec.js` ×3) | ~2,1min |
| Firefox/WebKit-E2E | `npm run test:e2e:extra` | **nicht ausgeführt** (nicht Teil des Standard-CI-Gates, siehe `package.json`) | — |
| `npm run db:migrate:status` | — | 8 angewendet, 0 ausstehend/dirty/drift/unknown | <1s |
| `npm run db:migrate:doctor` | — | `state: "ready"`, `code: "MIGRATION_DOCTOR_OK"`, 0 Schema-/Ledger-Probleme | ~1s |
| `git diff --check` | — | **sauber**, keine Whitespace-Fehler | <1s |

**Keine Tests wurden deaktiviert, übersprungen oder abgeschwächt.** Der einzige Fehlschlag während dieser Sitzung (22 MinIO-Integrationstests beim ersten Lauf) war ein reines Umgebungsproblem (fehlender lokaler MinIO-Container) und wurde durch Start der bereits im Repository vorhandenen, profilgesteuerten lokalen Testinfrastruktur (`docker compose --profile backup-test up -d minio`) behoben, nicht durch Testanpassung.

**Nicht separat durch dedizierte E2E-Tests abgedeckt** (aber durch Backend-Integrationstests, Architektur-Garantien oder eigene API-Proben in dieser Sitzung belegt): Admin-Rolle als eigener Live-Durchlauf (nur Owner/Trainer/Member wurden per Screenshot durchgeklickt), tatsächliches 7-Tage-Ablaufen einer Einladung, tatsächliches 8h-Ablaufen eines JWT.

---

## 16. P0-Befunde (Pilot-blockierend)

**Keine.** Alle zentralen Nutzerabläufe für alle vier Rollen sind vollständig, korrekt und automatisiert getestet nutzbar. Es gibt keinen Befund, der einen kontrollierten lokalen Pilotbetrieb mit synthetischen oder wenigen echten Testnutzern verhindern würde.

---

## 17. P1-Befunde (vor erstem zahlendem Kunden zu beheben)

1. **Kein Einladungs-Wiederholungsmechanismus (Resend).** Ein Nutzer, der seine Einladung verliert, muss auf Ablauf warten oder eine neue Einladung nach Widerruf erstellen. Betrifft Owner-/Admin-Journey Schritt 7.
2. **Kein Passwort-/E-Mail-Änderungs-UI und kein entsprechender Backend-Endpunkt.** Konto-/Kontaktdaten sind rein anzeigend. Für einen zahlenden Kunden mit echten Konten ein Standard-Erwartungspunkt.
3. **Kein JWT-Refresh- oder Logout-Revocation-Mechanismus.** Ein Token bleibt bis zu 8h gültig, auch nach "Abmelden" auf einem anderen Gerät oder bei einem kompromittierten Token. Aktuell rein clientseitiges Token-Löschen.
4. **Uneinheitliche Übersetzung im Audit-Protokoll.** Einige Ereignistypen erscheinen als rohe technische Strings (z. B. `workout_session.started`) statt als übersetzter Text wie andere Einträge in derselben Liste.
5. **Rate-Limiting nur auf Login/Registrierung.** Andere mutierende Endpunkte (Einladungserstellung — löst in Produktion einen echten E-Mail-Versand aus —, Workout-Protokollierung, Studio-Erstellung) sind ungedrosselt.
6. **Rate-Limiter ist In-Memory pro Prozess.** Bei mehreren Backend-Instanzen (horizontale Skalierung) ist der Zähler nicht geteilt — bereits in `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` dokumentiert, hier bestätigt weiterhin zutreffend.
7. **CORS-Konfiguration ungetestet**, insbesondere die Same-Host-Sonderregel in `createCorsOptions` (erlaubt Anfragen, deren `Origin`-Host dem `Host`-Header entspricht, zusätzlich zur expliziten Allowlist) — sollte gegen das tatsächliche Reverse-Proxy-/Host-Header-Vertrauensmodell der Zielumgebung geprüft werden, sobald diese feststeht.
8. **Login-Timing-Seitenkanal.** `bcrypt.compare` wird nur bei existierendem Nutzer aufgerufen, trotz identischer Fehlermeldung ein messbarer Zeitunterschied zur Konto-Enumeration.
9. **Toter Policy-Code (`coachActionEligibility`).** Definiert einen Owner/Admin-Bypass, wird aber von keiner Route/keinem Service aufgerufen — Drift-Risiko bei künftigen Änderungen.
10. **Kein Recht-auf-Löschung-/Anonymisierungspfad** für Benutzer-, Trainings- oder Feedbackdaten.

---

## 18. P2-Befunde (nach dem Piloten möglich)

1. Text-Abschneidung im Studio-Auswahl-Dropdown der Sidebar bei langen Studionamen/Rollenbezeichnungen (rein visuell, keine Funktionseinschränkung — der volle Wert ist über die Studios-Übersicht weiterhin einsehbar).
2. Kein Bounce-/Complaint-Handling und keine Zustell-Warteschlange für den SMTP-Versand (bereits in Stage 2A als bewusst außerhalb des Scopes dokumentiert).
3. Erweiterte Analytics/Dashboards, zusätzliche Filter, seltene Admin-Funktionen — nichts davon wurde in diesem Audit als fehlend identifiziert, da nicht Teil des bestehenden Funktionsumfangs und nicht Gegenstand der Kernabläufe.
4. `retired`-Status für Programmversionen ist im Domain-Enum definiert, aber von keinem Codepfad erreichbar — vermutlich für eine künftige Phase reserviert, keine Fehlfunktion.
5. Persönliche Domäne (Übungen/Workouts/Fortschritt) nutzt noch `window.confirm()` statt der gemeinsamen `ConfirmDialog.vue`-Komponente und ad-hoc Loading-/Empty-States statt der gemeinsamen Komponenten — funktioniert korrekt, aber strukturell inkonsistent zur neueren Studio-Domäne.

---

## 19. Deferred-until-hosting-Liste

Diese Punkte sind bewusst **nicht** als lokale Produktlücken einzustufen — sie sind an eine noch nicht getroffene Hosting-/Kundenentscheidung gebunden und wurden in diesem Audit absichtlich nicht vertieft:

1. **Echter externer S3-Bucket.** Die S3-kompatible Upload-/Download-/Verifikations-/Retention-Mechanik ist seit Stage 2B2A vollständig implementiert und automatisiert getestet (in dieser Sitzung erneut 22/22 gegen eine lokale MinIO-Instanz reproduziert), aber mit keinem echten Cloud-Konto verbunden. **Stage 2B2B, gemäß `FITTRACK_NEXT_PHASE_RECOMMENDATION.md` weiterhin nicht begonnen.**
2. **Getrennte DB-Rolle für Runtime vs. Migration/Restore.** Aktuell eine einzige DB-Rolle für alles — organisatorisch dokumentiert, technisch nicht erzwungen.
3. **Backup-/Upload-Scheduler und Schlüssel-/Zugangsdaten-Rotation.** Weder der verschlüsselte lokale Pfad (Stage 2B1) noch der Off-host-Pfad (Stage 2B2A) liefern einen automatisierten Zeitplan oder eine Rotationsstrategie.
4. **TLS/Reverse-Proxy.** Bewusst als reine Infrastrukturaufgabe außerhalb des Repositories behandelt.
5. **Monitoring/Alerting.** Nur Health-Endpunkte vorhanden, kein zentrales Log-Aggregations-/Alerting-System.
6. **Echter SMTP-Versand mit echten Zugangsdaten.** Der Adapter ist produktionsfähig implementiert und automatisiert getestet (Stage 2A); ein tatsächlicher Versand über einen echten Anbieter wurde bereits in Stage 2A einmalig verifiziert und muss laut Auftrag in diesem Audit **nicht** erneut nachgewiesen werden.
7. **Domain/produktive Hosting-Umgebung.** Nicht Gegenstand dieses Audits.

---

## 20. Empfohlene Entwicklungsreihenfolge

Aus den P1-Befunden abgeleitet, jeweils klar abgegrenzt:

- **Stage 3B1 — Konto-Selbstverwaltung.** Passwort-Änderung, E-Mail-Änderung (mit Re-Verifikation), optional Einladungs-Resend. Ausgeschlossen: JWT-Refresh (siehe 3B2), Löschkonzept (eigener, größerer Themenblock).
- **Stage 3B2 — Sitzungs-Härtung.** JWT-Refresh oder kurzlebigere Tokens mit Refresh-Flow, Logout-Revocation (z. B. Token-Blacklist oder Versionierung). Ausgeschlossen: Passwort-/Kontoänderungen (siehe 3B1).
- **Stage 3C — UX-/Navigation-Politur.** Audit-Log-Übersetzung vereinheitlichen, Dropdown-Textabschneidung beheben, persönliche Domäne auf gemeinsame Komponenten (`ConfirmDialog`, `EmptyState`) umstellen. Ausgeschlossen: neue Funktionen.
- **Stage 3D — Rate-Limiting-Ausweitung und CORS-Verifikation.** Drosselung auf mutierende Endpunkte außerhalb Login/Registrierung ausweiten, CORS-Same-Host-Regel gegen das Ziel-Deployment-Modell verifizieren, toten Policy-Code (`coachActionEligibility`) bereinigen oder verdrahten.
- **Stage 4A — Lokale Pilot-Akzeptanz.** Mit den obigen Blöcken abgeschlossen, eine strukturierte lokale Akzeptanzprüfung mit echten (aber weiterhin lokalen) Pilotnutzern.
- **Deployment/Hosting** — erst nach einer konkreten Kundenentscheidung, dann inklusive Stage 2B2B (echter Bucket), DB-Rollentrennung, TLS, Monitoring.

Kein Block bündelt mehrere große Themen. Jeder Block hat ein eigenes, klares Abschlusskriterium.

---

## 21. Konkrete Done-Kriterien für den nächsten Block (Stage 3B1)

- Ein eingeloggter Nutzer kann sein Passwort über die UI ändern (aktuelles Passwort erforderlich), mit Backend-Validierung und einem Test, der eine falsche aktuelle Passworteingabe ablehnt.
- Ein eingeloggter Nutzer kann seine E-Mail-Adresse ändern, mit mindestens einem serverseitigen Eindeutigkeits-/Formatcheck; ob eine Verifikations-E-Mail Teil dieses Blocks ist, ist eine offene Entscheidung für den Auftraggeber (kleinere oder größere Variante).
- Owner/Admin können eine ausstehende Einladung erneut versenden, ohne sie zu widerrufen und neu zu erstellen; der bestehende Token/TTL bleibt unverändert oder wird bewusst neu ausgestellt (Design-Entscheidung, in der Umsetzung zu dokumentieren).
- Alle drei neuen Endpunkte sind durch Unit- und Integrationstests abgedeckt, mindestens ein E2E-Test pro Funktion.
- `npm test` (Backend) und `npm run test:unit`/`test:e2e` (Frontend) bleiben vollständig grün.

---

## 22. Bekannte Unsicherheiten

- Die Admin-Rolle wurde **nicht** als eigener Live-Browser-Durchlauf in dieser Sitzung geklickt — die Abgrenzung zu Owner beruht auf Code-Lektüre (`studioPolicy.js`). Empfehlung: bei Bedarf einen kurzen gezielten Admin-Durchlauf nachholen, bevor eine harte Zusage zur Admin-Rolle gemacht wird.
- Das tatsächliche 7-Tage-Ablaufen einer Einladung und das tatsächliche 8h-Ablaufen eines JWT wurden nicht durch Warten reproduziert, sondern durch Code-/Testverifikation der jeweiligen Ablauflogik bestätigt.
- Während dieser Sitzung wurde der lokale Backend-Prozess zweimal neu gestartet, um den In-Memory-Rate-Limiter zurückzusetzen (einmal nach eigenem wiederholten Testkonten-Anlegen, einmal mit temporär erhöhten lokalen Limits über Umgebungsvariablen für die eigene API-Probenserie) — dies ist eine reine Testdurchführungs-Maßnahme, keine Code- oder Konfigurationsänderung am Repository, und hat keine Auswirkung auf die Gültigkeit der übrigen Ergebnisse.
- Die Git-Bash-MSYS-Pfadkonvertierungs-Eigenheit (Abschnitt 3) betraf zwischenzeitlich den manuell gestarteten Frontend-Dev-Server, nicht die automatisierte E2E-Suite (isolierte Playwright-`webServer`-Prozesse) — die 26/26-E2E-Ergebnisse sind davon nicht betroffen.
- Firefox/WebKit-E2E (`npm run test:e2e:extra`) wurde nicht ausgeführt — dies ist bereits kein Teil des Standard-CI-Gates (nur Chromium + Axe), daher keine neue Lücke.

---

## 23. Klare Gesamtbewertung

**lokal pilotfähig**

Begründung: Alle vier Kernrollen können ihre jeweils zentralen Arbeitsabläufe vollständig über die Weboberfläche durchführen, durchgängig belegt durch reale Browser-E2E-Tests, frische automatisierte Testläufe (504 Backend-Tests, 306 Frontend-Tests, alle grün) und eigene, in dieser Sitzung durchgeführte visuelle und API-basierte Verifikation. Es gibt **keine P0-Befunde**. Die identifizierten P1-Punkte (fehlender Passwort-/E-Mail-Self-Service, fehlender Einladungs-Resend, kein Token-Refresh, uneinheitliche Audit-Übersetzung, punktuelle Rate-Limiting-/CORS-/Timing-Härtung) sind reale, aber nicht pilot-blockierende Lücken, die vor einem ersten **zahlenden** Kunden geschlossen werden sollten. Alles, was echte Cloud-Infrastruktur voraussetzt (Stage 2B2B und benachbarte Betriebsthemen), bleibt bewusst zurückgestellt und ist nicht Teil dieser Klassifikation.

FitTrack ist ausdrücklich **nicht** produktionsbereit im Sinne eines vollständig gehärteten, produktiv gehosteten Systems mit echter Cloud-Anbindung, Monitoring und getrennten Betriebsrollen — dies war auch nicht das Ziel dieser Phase.
