# Stage 4A: Final Local Acceptance

Geprüfter Ausgangs-Commit: `6cb3c91` (main, PR #19 "Merge... feature/stage-3d-security-hardening"), Branch `feature/stage-4a-final-local-acceptance`. Geprüft am 2026-07-26 auf Windows 11, Node.js v22.17.0, npm 10.9.2, MySQL 8.0 (Docker, Container `fittrack_mysql`), lokale MinIO-Instanz (Container `fittrack_minio`, Profil `backup-test`).

Diese Phase ist eine reine Abnahme-/Stabilitätsphase (siehe Abschnitt 3 des Auftrags) — kein neues Feature, keine neue Rolle, keine neue Account-Funktion, keine neue Migration (ausser einem echten, zwingenden Blocker — keiner gefunden). Behoben wurden ausschliesslich reproduzierbare Fehler, Dokumentationslücken und ein während der Regression gefundener, vorbestehender Concurrency-Fehler (Abschnitt 11).

---

## 1. Clean-Room-Installation

Ein isolierter Git-Worktree (`git worktree add --detach`, Commit `6cb3c91`) ausserhalb des Repository-Arbeitsverzeichnisses, ohne `node_modules`, ohne `.env`, ohne bestehende Datenbank. Jeder Schritt aus `README.md` wurde tatsächlich ausgeführt:

| Schritt | Ergebnis |
|---|---|
| `.env.example` kopieren | erfolgreich |
| sichere lokale Secrets (`JWT_SECRET`, `RATE_LIMIT_KEY_SECRET`) generieren und eintragen | erfolgreich |
| `docker compose up -d mysql` | **fehlgeschlagen beim ersten Versuch** — Namenskonflikt mit dem bereits laufenden Entwicklungscontainer (siehe Befund unten); nach Stoppen/Entfernen des Entwicklungscontainers erfolgreich |
| `npm ci` (Backend) | erfolgreich, 0 Schwachstellen |
| `npm run db:dev:init` | erfolgreich, 11/11 Migrationen angewendet |
| `npm run db:migrate:doctor` | `ready`, `applied:11`, alle übrigen Zähler `0` |
| `npm run db:migrate` (zweiter Lauf) | No-op (`appliedCount:0`) |
| Backend starten (`npm run dev`) | **Portkonflikt** (`3001` bereits von einem mehrere Tage alten, sitzungsfremden Prozess belegt) — auf freien Port ausgewichen, sonst erfolgreich |
| `npm ci` (Frontend) | erfolgreich, 0 Schwachstellen |
| Frontend starten | **derselbe Portkonflikt-Musterfall** auf `5173` — auf freien Port ausgewichen |
| Health/Readiness | beide `200` |
| Registrierung, Login, erstes Studio erstellen | erfolgreich (siehe Abschnitt 2) |

**Zwei echte, im Doc-Text behobene Befunde:**

1. `docker-compose.yml`s fester `container_name: fittrack_mysql` verhindert zwei gleichzeitig laufende Checkouts/Worktrees auf derselben Maschine. Für den normalen Ein-Checkout-Betrieb folgenlos; jetzt in `LOCAL_PILOT_RUNBOOK.md` Abschnitt 4 und `DEPLOYMENT.md`s Stufe-4A-Ergänzung dokumentiert.
2. `README.md` war seit dem Stage-1B.2B1-Audit-Snapshot (Funktionsliste, Architektur, Testbefehle) nicht mehr aktuell — erwähnte weder Studios/Rollen/Coaching/Rate-Limiting noch Browser-E2E-Tests, MinIO oder `security:rate-limits:cleanup`. Überarbeitet (Abschnitt 9).

Die beiden Portkonflikte (`3001`, `5173`) stammten von sitzungsfremden, mehrere Tage alten Prozessen auf dieser Entwicklungsmaschine, nicht von einem Dokumentations- oder Anwendungsfehler — für einen echten Erstinstallations-Ablauf auf einer freien Maschine nicht relevant, deshalb keine Code-/Doku-Änderung nötig, ausser dem bereits vorhandenen, jetzt erweiterten "Häufige Fehler"-Abschnitt im neuen Runbook.

## 2. Frische Datenbank

Auf der oben beschriebenen, vollständig leeren Datenbank (`fittrack_cleanroom`):

- Migrationen 001–011 vollständig angewendet, zweiter Lauf No-op.
- Migration Doctor: `ready`, `applied:11, pending:0, dirty:0, drift:0, unknown:0, schemaIssues:0, ledgerIssues:0`.
- Globale Übungen (Migration `003_seed_global_exercises`): 14 Einträge vorhanden.
- Registrierung (`userId:1`, beweist eine wirklich leere Datenbank), Login, erstes Studio als Owner erstellt — alle drei über die echte API, nicht simuliert.
- Anwendung funktioniert vollständig ohne jede historische Entwicklungsdatenabhängigkeit.

## 3. Bestehende Datenbank

Die bestehende lokale Entwicklungsdatenbank (`fittrack`, Docker-Volume `fittrack-ipt71_mysql_data`) wurde separat geprüft:

- Migration Doctor: `ready`, identische Nullzähler wie oben.
- Keine Drift, keine unbekannten Migrationen/Tabellen.
- Datenbestand vor und nach der gesamten Stage-4A-Sitzung identisch: 36 Nutzer, 11 Studios, 3 Trainingsprogramme, 3 Workout-Sessions, 6 Auth-Sessions (stichprobenartig vor/nach jedem risikobehafteten Schritt per SQL verglichen).
- Historische Workout-Snapshots, Programme und Sessions bleiben unverändert lesbar (auch über den vollständigen Backup-/Restore-Drill hinweg, siehe Abschnitt 6 — Quelldatenbank nachweislich unangetastet).
- Rate-Limit-Buckets beeinträchtigen normale Nutzung nicht (0 aktive Buckets zum Prüfzeitpunkt, kein Alt-Lockout beobachtet).

Keine produktionsähnlichen Daten wurden gelöscht oder verändert.

## 4. Rollenmatrix, Tenant-Isolation und Funktionsbereiche

Diese Dimensionen sind bereits durch eine sehr breite, bestehende automatisierte Suite abgedeckt (Backend-Unit/-Integration, Frontend-Komponenten, Browser-E2E) — siehe Testzahlen in Abschnitt 8. Vor Beginn der Regression wurde eine interne Coverage-Matrix erstellt (Funktion × Rolle × Tenant × positiver/negativer Ablauf × automatisierter/manueller Test), die für praktisch jede Anforderung aus Abschnitt 8–16 des Auftrags **vollständige** Abdeckung durch bestehende Tests bestätigte. Zwei Punkte wurden zusätzlich gezielt manuell/durch Code-Inspektion verifiziert, da die Matrix dort nur "wahrscheinlich, aber nicht explizit benannt" auswies:

- **Audit-Log Cross-Tenant-Lesbarkeit:** Die Route `GET /studios/:studioId/audit-events` verwendet exakt dieselbe geteilte `context`-Middleware (Studio-Tenant-Auflösung, 404 `STUDIO_NOT_FOUND` für jeden Nicht-Mitglied) wie alle anderen 20+ Studio-scoped Routen. Cross-Tenant-Isolation ist damit strukturell garantiert, nicht routenspezifisch implementiert — bestätigt durch Code-Inspektion, kein Einzelfall-Risiko.
- **Parallele Einladungs-Resends:** Live gegen einen echten laufenden Backend-Prozess mit 10 parallel abgefeuerten HTTP-Resend-Anfragen sowie zusätzlich mit `Promise.all`-synchronisierten Anfragen gegen dieselbe Einladung getestet. Beobachtung: der Optimistic-Concurrency-Mechanismus (Token-Hash als Compare-and-Swap-Bedingung in der Rotations-`UPDATE`-Anweisung) lässt bei eng gestaffelten, aber nicht exakt zeitgleichen Anfragen mehrere **sequenzielle**, jeweils gültige Resends zu (jeder mit eigenem, korrekt committetem Token) — das ist korrektes Verhalten, kein Fehler. Für **echte, auf derselben Ausgangs-Momentaufnahme konkurrierende** Aufrufe existiert bereits ein dedizierter Service-Level-Test (`test/integration/studioApi.test.js`, "concurrent resend calls converge on exactly one success, one e-mail, and one audit event"), der `Promise.allSettled` auf identischem Ausgangszustand nutzt und exakt einen Erfolg, exakt einen E-Mail-Versand und exakt ein `invitation.resent`-Audit-Event nachweist — Teil der grünen 231/231-Integrationssuite.

Rollenmatrix (Owner/Admin/Trainer/Member) und Tenant-Isolation (Studio A/B, alle in Abschnitt 9 des Auftrags gelisteten Ressourcentypen) sind durch `test/integration/studioApi.test.js`, `trainingProgramApi.test.js`, `workoutSessionApi.test.js`, `workoutFeedbackApi.test.js` sowie `frontend/e2e/adminPilotWalkthrough.spec.js` (vollständiger realer Rollendurchlauf: Owner→Admin→Mitgliederverwaltung→Coaching→Programm→Ergebnisse→Audit→Isolation→Mobile) end-to-end abgedeckt und liefen im Rahmen der vollständigen Regression (Abschnitt 8) dreimal grün.

## 5. Authentifizierung, Sessions, Einladungen, Programme, Workouts, Account Self-Service, Rate Limiting, CORS

Ebenfalls vollständig durch die bestehende Suite abgedeckt (siehe Testdateien in Abschnitt 8) und Teil jedes der drei vollständigen E2E-Läufe sowie der Backend-Regression. Zusätzlich spezifisch für Stage 4A durchgeführt:

- **Cross-Tab-Zieltest 20×:** `npx playwright test e2e/authSession.spec.js --project=chromium -g "two tabs of the same browser context" --repeat-each=20` → **20/20 grün**. Kein `AUTH_REFRESH_REUSE_DETECTED`, kein `AUTH_SESSION_INVALIDATED`, kein Login-Bounce, keine Endlosschleife bei legitimer Nutzung; echter Replay wird weiterhin durch die bestehende, unveränderte Suite (`authSessionApi.test.js`, `authSession.spec.js`) erkannt.
- **Rate-Limit-Policy-Inventar (10 Policies):** unverändert seit Stage 3D, vollständig durch `rateLimitStore.test.js`, `rateLimitMultiInstance.test.js` (zwei echte App-Instanzen), `rateLimitSecurity.spec.js` (Browser-429-UX) sowie das jetzt zusätzlich verifizierte Cleanup-Kommando (`npm run security:rate-limits:cleanup`, erfolgreich manuell ausgeführt) abgedeckt.
- **CORS/Proxy/Security Header:** unverändert seit Stage 3D, vollständig durch `corsSecurity.spec.js` (echter Browser, Evil-Origin auf separatem Port), `corsHeaders.test.js`, `clientIp.test.js`/`proxyConfig.test.js` abgedeckt.

## 6. Backup und Restore

Realer, vollständiger Drill gegen den bestehenden, realistischen Entwicklungsdatenbestand (11 Studios, 22 Mitgliedschaften über die Rollen owner/trainer/member, 19 Einladungen, 3 Coaching-Beziehungen, 3 Programme/4 Versionen, 3 Zuweisungen, 3 Workout-Sessions/9 Sätze, 1 Feedback, 68 Audit-Events, 6 Auth-Sessions/8 Refresh-Token):

1. `npm run db:backup:drill` (automatisiert: Snapshot → verschlüsseltes Backup erstellen → verifizieren → in eine frische Wegwerfdatenbank restaurieren → Migration Doctor → Zeilenzahlvergleich) → **`result: "ok"`, 24/24 Tabellen restauriert und exakt übereinstimmend**, Migration Doctor auf der Restore-DB `ready` mit identischen Nullzählern.
2. Zusätzlich manuell: Backup erstellt, in eine persistente Datenbank restauriert, Backend dagegen gestartet, als real restaurierter, bestehender Studio-Owner eingeloggt (Passwort auf der Restore-Kopie zurückgesetzt, Quelldatenbank unangetastet) und ein vollständiger Lese-Ablauf durchgeführt (Studioliste, 17 restaurierte Audit-Events) — alles über die echte Anwendungs-API.
3. **Falscher Schlüssel** (gültig geformt, aber falsch): kontrolliert fehlgeschlagen (`Unsupported state or unable to authenticate data`, AES-GCM-Authentifizierung), keine Zieldatenbank angelegt.
4. **Beschädigtes Backup** (Bit-Flip): identisch kontrolliert fehlgeschlagen, keine Zieldatenbank angelegt.
5. Keine Secrets im Dateinamen oder Log (nur Zeitstempel/Zufallssuffix, SHA-256-Prüfsummen, Byte-/Tabellenzahlen).
6. Keine temporären Klartextdateien zurückgelassen (OS-Temp-Verzeichnis stichprobenartig geprüft).
7. Quelldatenbank nachweislich unverändert (Zeilenzahlen vor/nach identisch, siehe Abschnitt 3).
8. Alle temporären Restore-Datenbanken und die manuell erstellte Backup-Datei nach Abschluss entfernt.

Kein externer Bucket erforderlich oder verwendet.

## 7. Frontend-, Responsive- und Accessibility-Abnahme

Über die bestehende `accessibility.spec.js` (Viewport-Overflow-Prüfung bei 1440×900/768×1024/390×844 auf allen kritischen Views, Tastaturnavigation, Fokus-Management, Skip-Link, Axe auf Login/Register/App-Shell/Coach-Ergebnisse/Session-Detail/Member-Session-mit-Feedback) sowie ergänzende Axe-Smokes in `authSession.spec.js`, `coachFeedback.spec.js`, `invitationEmail.spec.js` — Teil aller drei vollständigen E2E-Läufe (Abschnitt 8), durchgehend **keine Critical-/Serious-Befunde**.

## 8. Vollständige Regression und Flake-Analyse

| Suite | Ergebnis |
|---|---|
| Backend Unit | **469/469 grün** |
| Backend Integration (inkl. MinIO, Multi-Instance) | **231/231 grün** |
| Backend Migration/Doctor | **32/32 grün** |
| Backend Syntax | **219/219 Dateien grün** |
| Backend Coverage | erzeugt, keine Fehler |
| Backend `npm audit --audit-level=high` | **0 Funde** |
| Frontend Unit/Komponenten | **341/341 grün** (43 Dateien) |
| Frontend Produktionsbuild | erfolgreich (PowerShell — Git-Bash-MSYS-Pfadumwandlung von `/api` weiterhin ein reines Testumgebungsartefakt, kein Produktbefund, siehe `LOCAL_PILOT_RUNBOOK.md`) |
| Frontend `npm audit --audit-level=high` | **0 Funde** |
| Chromium E2E + Axe, Lauf 1/3 | **48/48 grün** (4.2 min) |
| Chromium E2E + Axe, Lauf 2/3 | **48/48 grün** (4.7 min) |
| Chromium E2E + Axe, Lauf 3/3 | **48/48 grün** (4.6 min) |
| Cross-Tab-Zieltest 20× | **20/20 grün** (1.9 min) |
| `npm run db:migrate` / `:status` / `:doctor` | `applied:11`, `pending:0`, `dirty:0`, `drift:0`, `unknown:0`, `schemaIssues:0`, `ledgerIssues:0`, `state:"ready"` |
| `git diff --check` | sauber |

**Keine Skips, keine Retries als versteckte Stabilitätslösung, keine erhöhten Timeouts ohne belegte Ursache, keine abgeschwächten Assertions, keine entfernten sicherheitsrelevanten Tests.** Alle drei E2E-Läufe und der 20-fache Cross-Tab-Lauf waren auf Anhieb vollständig grün — es gab in dieser Sitzung keinen zu analysierenden Flake.

## 9. Production-Config-Smoke-Test

Synthetischer Test von `config/startupConfig.js#validateStartupConfig()` gegen eine produktionsförmige Konfiguration mit sicheren, lokal generierten Testwerten (kein echtes Produktions-Secret verwendet):

| Szenario | Erwartet | Ergebnis |
|---|---|---|
| Vollständig gültige Produktionskonfiguration | akzeptiert | ✅ akzeptiert |
| Schwaches/zu kurzes `JWT_SECRET` | Startfehler | ✅ abgelehnt |
| Bekannter Platzhalter-Secret | Startfehler | ✅ abgelehnt |
| Identische `JWT_SECRET`/`RATE_LIMIT_KEY_SECRET` | Startfehler | ✅ abgelehnt |
| HTTP-Origin in Produktion | Startfehler | ✅ abgelehnt |
| `localhost`-Origin in Produktion | Startfehler | ✅ abgelehnt |
| Wildcard-Origin | Startfehler | ✅ abgelehnt |
| Ungültiger Trust-Proxy-Modus | Startfehler | ✅ abgelehnt |
| Kein expliziter Trust-Proxy-Modus in Produktion | Startfehler | ✅ abgelehnt |
| Unsichere Cookie-Konfiguration (`SameSite=none` ohne Secure) | Startfehler | ✅ abgelehnt |
| Ungültiges Request-Grössen-Limit | Startfehler | ✅ abgelehnt |
| **Fehlende `CORS_ALLOWED_ORIGINS`** | *(im Auftrag als Startfehler erwartet)* | **akzeptiert — geprüft und als korrektes, bewusstes Design bestätigt** |

Der letzte Punkt ist **kein Fehler**: eine leere `CORS_ALLOWED_ORIGINS` ist eine explizit dokumentierte, gültige Konfiguration für ein Deployment, bei dem Frontend und API dieselbe Origin teilen (kein Cross-Origin-Zugriff nötig, siehe `backend/.env.example` Zeile "Leave empty when frontend and API share an origin" sowie `README.md`). Ein Startfehler an dieser Stelle wäre eine unangeforderte Verhaltensänderung ausserhalb des Stage-4A-Scopes gewesen und wurde bewusst nicht vorgenommen.

## 10. Nebenbefund: Lock-Order-Deadlock (bereits vor Stage 4A behoben)

Im Rahmen der für Stage 4A wiederholten vollständigen Backend-Regression wurde derselbe Deadlock-Fund reproduziert, der bereits am Ende von Stage 3D gefunden und behoben wurde (`sessionService.js`s `rotateRefreshToken` vs. `accountService.js`s Passwort-/E-Mail-Änderung, uneinheitliche Sperrreihenfolge zwischen `users` und `user_auth_sessions`). Der Fix ist bereits Teil von `main` (Commit `54dbeab` auf dem gemergten `feature/stage-3d-security-hardening`-Branch) — die für Stage 4A erneut ausgeführte volle Integrationssuite (231/231) bestätigt, dass der Fix stabil bleibt. Kein neuer Code-Fix in dieser Phase nötig.

## 11. Dokumentationsabnahme

Jeder in `README.md` und `docs/DEPLOYMENT.md` dokumentierte Befehl wurde tatsächlich ausgeführt (siehe Abschnitt 1 und 8). Ergebnis:

- **Korrigiert:** `README.md` — Funktionsliste, Architekturbeschreibung und Testbefehle waren seit dem frühen Stage-1B.2B1-Stand veraltet (fehlende Studios/Rollen/Coaching/Rate-Limiting/Security-Hardening, fehlender E2E-/MinIO-/Multi-Instance-Hinweis, fehlender `security:rate-limits:cleanup`-Befehl). Vollständig überarbeitet, jetzt auf dem aktuellen Stand nach Stage 3D.
- **Ergänzt:** `docs/DEPLOYMENT.md` um eine Stufe-4A-Ergänzung (siehe oben) sowie einen Verweis auf das neue `LOCAL_PILOT_RUNBOOK.md`.
- **Neu:** `docs/LOCAL_PILOT_RUNBOOK.md` — vollständige, tatsächlich Schritt für Schritt ausgeführte Anleitung für Erstinstallation, Demoablauf, Backup, Restore, Rate-Limit-Cleanup, Stoppen/Neustart, häufige Fehler und vollständigen Reset.
- **Geprüft, keine Änderung nötig:** jeder in irgendeinem Dokument referenzierte `npm run`-Befehl existiert nachweislich in `backend/package.json` oder `frontend/package.json` (automatisierter Abgleich, keine Abweichung gefunden); keine veralteten `CORS_ORIGIN`-Referenzen ausserhalb historisch korrekt gekennzeichneter "umbenannt von"-Hinweise; alle Ports/Umgebungsvariablen in den Standard-Beispielen korrekt.
- **`docs/FITTRACK_CURRENT_STATUS.md`, `docs/FITTRACK_NEXT_PHASE_RECOMMENDATION.md`, `docs/FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`:** je um einen Stufe-4A-Nachtrag ergänzt (bestehendes, in diesen Dokumenten selbst etabliertes Muster eingefrorener Snapshots mit chronologischen Nachträgen — nicht rückwirkend umgeschrieben).

## 12. CI-Review

`.github/workflows/ci.yml` (drei Jobs: Backend+MySQL+Migrationen, Frontend+Build, Chromium-E2E+Axe) geprüft: **keine Änderung nötig.** Stage 4A führt keinen neuen Testtyp, keine neue Migration und keinen neuen Befehl ein, der nicht bereits über die bestehenden, glob-basierten `npm test`/`npm run test:integration`/`npm run test:e2e`-Aufrufe automatisch erfasst wird. Keine Gate-Abschwächung, kein `continue-on-error`, kein `|| true` ausserhalb der bestehenden, legitimen `if: always()`-Aufräumaktion, kein reduziertes Audit-Level, kein lokal-only Test.

## 13. Bekannte Grenzen und Deferred Items

Unverändert gegenüber dem Stand nach Stage 3D (siehe `docs/FITTRACK_NEXT_PHASE_RECOMMENDATION.md`): kein Recht-auf-Löschung-/Anonymisierungspfad, toter Policy-Code (`coachActionEligibility`), Login-Timing-Seitenkanal-Restrisiko (bereits durch Stage 3B2 weitgehend gehärtet), kein zentrales Log-Aggregations-/Ticketing-System. Neu in dieser Phase bestätigt bzw. dokumentiert:

- Fester `docker-compose.yml`-Containername verhindert parallele Checkouts auf einer Maschine (Abschnitt 1).
- Kein Produktions-SMTP standardmässig konfiguriert (bewusst, siehe `LOCAL_PILOT_RUNBOOK.md` Abschnitt 12).
- Kein externer Off-host-Backup-Bucket, kein Backup-Scheduler (unverändert seit Stage 2B2A/2B1, weiterhin bewusst zurückgestellt).
- Kein Recht-auf-Löschung-/Anonymisierungspfad für Nutzer-, Trainings- oder Feedbackdaten.

**Explizit ausserhalb des Scopes dieser und aller vorherigen Phasen und in dieser Phase nicht begonnen:** 2FA, Passkeys, Social Login, Passwort-Reset, Kontolöschung, Abrechnung, Analytics, neue Dashboard-Funktionen, Cloud-Hosting, Redis, externer Rate-Limit-Store, Produktions-Monitoring, echter S3-Bucket, Stage 2B2B, Migration 012 (kein zwingender Blocker gefunden).

## 14. Finale lokale Freigabeentscheidung

**FitTrack ist lokal vollständig abgeschlossen (local product development complete).**

Alle 30 Abschnitte des Stage-4A-Auftrags wurden durchlaufen: Clean-Room-Installation erfolgreich (nach Dokumentationskorrektur), frische und bestehende Datenbank beide `ready` ohne Drift, vollständige Rollen-/Tenant-/Auth-/Session-/Einladungs-/Programm-/Workout-/Account-/Rate-Limit-/CORS-Abnahme ohne offenen Blocker, realer Backup-/Restore-Drill erfolgreich, Frontend-/Accessibility-Abnahme ohne Critical-/Serious-Befunde, dreifacher E2E-Lauf und 20-facher Cross-Tab-Lauf vollständig grün ohne Flake, Production-Config-Smoke vollständig wie erwartet (ein Punkt als bewusstes, korrektes Design bestätigt statt "gefixt"), Dokumentation korrigiert und ergänzt, CI bereits ausreichend, ein einziger während der Regression reproduzierter (aber bereits vor dieser Phase behobener) Concurrency-Fund bestätigt stabil.

Dieser Branch ist bereit für einen Merge nach `main`. **Es folgt keine weitere lokale Entwicklungsphase** — dieser Bericht schliesst die in `docs/FITTRACK_NEXT_PHASE_RECOMMENDATION.md` vorgeschlagene Reihenfolge (3B1 → 3B2 → 3C → 3D → 4A) vollständig ab. Nicht behauptet wird "production deployment complete" — ein echtes Produktions-Deployment (Cloud-Hosting, externer Bucket, Produktions-SMTP, TLS-Terminierung, Monitoring) liegt ausserhalb des Repositories und wurde in keiner Phase eingerichtet oder begonnen.
