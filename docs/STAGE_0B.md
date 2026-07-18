# Stufe 0B – Pilotbetriebsnachweis

Stand: 18. Juli 2026. Dieser Bericht unterscheidet folgende Nachweisarten:

- **Ausgeführt:** Der Vorgang lief in dieser Arbeitsumgebung tatsächlich.
- **Automatisiert getestet:** Ein reproduzierbarer Test prüft das Verhalten.
- **Manuell/statisch geprüft:** Code, Konfiguration oder Resultat wurde gezielt gelesen beziehungsweise verglichen.
- **Nur dokumentiert:** Eine Betriebsregel oder spätere Option wurde beschrieben, aber nicht technisch ausgerollt.
- **Offen:** Nicht ausgeführt oder noch nicht produktionsreif.

## 1. Executive Summary

**Ergebnis:** Die zwingenden und wichtigen Nachweise von Stufe 0B sind für einen lokalen Ein-Instanz-Pilot weitgehend erfüllt. Clean-Room-Installationen, Backend- und Frontendtests, Build, Audits, zwei isolierte Legacy-Restore-/Migrationsläufe, Integritätsprüfungen, Anwendungssmokes sowie neun Chromium-E2E-/Accessibility-Tests waren erfolgreich. Sichere lokale Backup-/Restore-Werkzeuge, strukturiertes Request-Logging, getrennte Auth-Rate-Limits und ein Chromium-/Axe-CI-Gate wurden ergänzt.

**Wesentliche Abweichung:** Die Entwicklungsdatenbank wurde zwischen der initialen read-only Bestandsaufnahme und dem geplanten Backup unerwartet bereits durch den Auto-Migrate-Startup auf 001–004 gebracht. Der genaue auslösende Prozess konnte nicht abschliessend bewiesen werden. Counts blieben identisch und die Datenbank ist sauber versioniert, aber die verlangte Reihenfolge „Originalbackup vor Migration“ wurde dadurch nicht erfüllt. Der Legacy-Migrationsnachweis basiert transparent auf einer aus den erhaltenen Geschäftsdaten rekonstruierten Testkopie des vorher erfassten Fünf-Tabellen-Schemas, nicht auf einem behaupteten Original-Pre-Migration-Dump.

**Grenze:** Firefox und WebKit wurden ressourcenschonend nicht ausgeführt. Monitoring-Schwellen und eine Redis-Option sind dokumentiert, aber keine externe Plattform und keine Redis-Infrastruktur wurden eingeführt. Es wurden keine Gym-/SaaS-Funktionen oder vorbereitenden Tabellen implementiert.

## 2. Ausgangszustand und Branch

- **Ausgeführt:** Start auf dem sauberen Branch `stabilization/stage-0a` bei `aea9bd2`.
- **Ausgeführt:** Die vier erwarteten Stage-0A-Commits `6494734`, `b2b2156`, `618e8d5` und `aea9bd2` waren vorhanden.
- **Ausgeführt:** `git status --short` und `git diff --check` waren leer; keine unversionierten Dateien.
- **Ausgeführt:** Vier bestehende Stashes wurden nur gelesen und blieben unverändert.
- **Ausgeführt:** Neuer lokaler Branch `stabilization/stage-0b`, ausgehend von `aea9bd2`.
- **Ausgeführt:** Kein Commit auf `main`, kein Push und kein Remote-Branch für 0A/0B.
- **Manuell/statisch geprüft:** Der Diff `main...stabilization/stage-0a` enthielt keine echten Secrets, benutzerspezifischen absoluten Pfade oder Gym-/SaaS-Vorarbeiten.

## 3. Verifikation von Stufe 0A

Die zentralen Aussagen aus Stufe 0A wurden nicht nur aus dem Vorbericht übernommen:

- **Automatisiert getestet:** kg/lb-Konvertierung und genau einmalige 1RM-Konvertierung durch Unit-/Komponententests und den Browserflow.
- **Ausgeführt und automatisiert getestet:** Migrationen 001–004, Ledger-Checksums, Dirty-/Drift-Erkennung, Legacy-Planung und zweiter No-op-Lauf.
- **Automatisiert getestet:** Fail-fast-Startup, Liveness, Readiness und Abhängigkeit der Readiness von DB/Migrationsstatus.
- **Automatisiert getestet:** zentrale Validierung, Fehler-Envelopes, Request-ID, 401/403-Verhalten und Zwei-Nutzer-Isolation.
- **Ausgeführt und automatisiert getestet:** Workout-/Progress-Konsistenz, Quellverknüpfung, Unveränderlichkeit abgeleiteter Einträge und CRUD.
- **Ausgeführt:** Backend-/Frontend-Suites, Produktionsbuild, Dependency-Audits und Docker-Compose-Konfigurationsprüfung.
- **Manuell/statisch geprüft:** Die bewusste Änderung der Compose-Initialisierung und der API-Fehlervertrag sind dokumentierte Kompatibilitätsgrenzen, keine versteckten Funktionsverluste.

## 4. Gefundene Abweichungen oder neue Fehler

1. **Ausgeführt beobachtet – ungeplante Dev-Migration:** Nach einer initialen unversionierten read-only Aufnahme war `fittrack` vor dem Backup bereits sauber auf 001–004 migriert. Ein kurzlebiger Backend-/Watcher-Prozess ist eine plausible, aber nicht bewiesene Ursache. Kein Datenverlust wurde gefunden; die vorgeschriebene Reihenfolge wurde dennoch verletzt.
2. **Manuell/statisch geprüft – partielle DDL bei Migration 004:** MySQL-DDL ist nicht vollständig transaktional. Ein Fehler nach frühen DDL-Schritten kann eine teilweise geänderte, als dirty markierte Datenbank hinterlassen. Der Runner stoppt sicher, repariert diesen Zustand aber nicht automatisch.
3. **Behoben und automatisiert getestet – gefährlicher Testreset:** Der bisherige Reset schützte nicht vor entfernten Hosts. Destruktive Testoperationen verlangen nun zusätzlich Loopback und einen streng begrenzten Wegwerf-DB-Namen.
4. **Behoben und automatisiert getestet – Proxy/Rate-Limit:** `trust proxy` war unbestimmt und konnte hinter einem Proxy globale Client-Keys erzeugen. Es ist nun explizit über `TRUST_PROXY_HOPS` (0–10, Standard 0) begrenzt; Login und Registrierung besitzen getrennte Limits und Zustände.
5. **Behoben durch RED/GREEN-Browserläufe:** Fehlender Routentitel/404, unzureichende Status-/Alert-Semantik, namenlose Dialoge, fehlende Fokusbindung/-rückgabe, unvollständige Mobile-Nav-Semantik, versteckte Kontrastprobleme und ein sichtbarer Löschknopf für unveränderliche abgeleitete Progress-Einträge.
6. **Umgebungsabweichung:** Der erste sandboxed Frontendlauf scheiterte an `EPERM` beim temporären Vite-Verzeichnis. Derselbe unveränderte Lauf ausserhalb dieser Einschränkung war erfolgreich; dies war kein Produktfehler.
7. **Vertrag präzisiert:** Fremde Ressourcen liefern absichtlich 404, um IDs nicht zu verraten; ungültige Sessions liefern 401. Das geforderte Verhalten „403 meldet nicht automatisch ab“ wird im Frontend-Unit-Test geprüft, ohne einen künstlichen 403-Fremdressourcenvertrag einzuführen.

## 5. Clean-Room-Ergebnisse

**Ausgeführt** in einem temporären detached Worktree bei `aea9bd2`, ohne vorhandene `node_modules`, Buildartefakte oder persönliche Daten:

| Bereich | Ergebnis |
| --- | --- |
| Toolchain | Node.js 22.17.0, npm 10.9.2, Docker 29.1.3, Compose 2.40.3, MySQL 8.0.45 |
| Backend `npm ci` | 119 Pakete, erfolgreich |
| Backendtests | 32 Unit + 6 Integration + 8 Migration = 46/46 erfolgreich |
| Backend-Syntax | 51 Dateien erfolgreich |
| Backend-Audit | 0 bekannte Vulnerabilities |
| Frontend `npm ci` | 189 Pakete, erfolgreich |
| Frontendtests | 53/53 erfolgreich |
| Produktionsbuild | erfolgreich, Vite 7.3.6, 58 Module |
| Frontend-Audit | 0 bekannte Vulnerabilities |
| Compose-Konfiguration | gültig |

**Warnung:** npm meldete für das transitive Entwicklungspaket `glob@10.5.0` eine Deprecation. Der Audit blieb bei 0 Vulnerabilities. Der temporäre Clean-Room-Worktree wurde nach erneuter Identitäts- und Dirty-Prüfung im kontrollierten Abschluss entfernt.

## 6. Backup-Ergebnis

- **Ausgeführt:** Initialer read-only Zustand von `fittrack`: unversioniertes Fünf-Tabellen-Schema; `users=1`, `exercises=15`, `workouts=3`, `workout_exercises=5`, `progress_entries=9`, sieben Foreign Keys; Migrationen 001–004 ausstehend; kein Dirty/Drift/Unknown.
- **Ausgeführt, mit Abweichung:** Wegen der ungeplanten Migration ist der reale Dev-Dump ein **Post-Migration-Backup**. Er hatte 14'533 Bytes und SHA-256 `13e36e30e1688df027c00fe6644dea9419100e43e80bf45598f290d6519fb4eb`.
- **Ausgeführt:** Für den explizit als rekonstruiert bezeichneten Legacy-Teststand wurde ein zweiter Dump erzeugt: 9'906 Bytes, SHA-256 `020c7d39c8759308edfccd96b23956ffbc4394ecfc86adb2c494e013d02198db`.
- **Automatisiert getestet:** Backupziel ausserhalb des Repositorys, Loopback-Grenze, sicherer Zeitstempelname, `.partial`-Datei, strukturelle Dump-Prüfung, SHA-256, sichere Docker-Argumente und keine Passwortübergabe als CLI-Argument.
- **Ausgeführt:** Beide Dumps lagen ausschliesslich im externen lokalen Pilot-Backupverzeichnis und wurden nicht Git hinzugefügt.
- **Offen für Produktion:** Verschlüsselter Off-host-Storage, automatisierte tägliche Ausführung, Retention und Alarmrouting.

## 7. Restore-Ergebnis

- **Ausgeführt:** Der reale Post-Migration-Dump liess sich in eine neue Restore-Datenbank einspielen und bestätigte seine technische Wiederherstellbarkeit; erwartungsgemäss war diese Kopie bereits versioniert.
- **Ausgeführt:** Die aus erhaltenen Daten und dem zuvor erfassten Schema rekonstruierte Legacy-Testkopie enthielt wieder exakt fünf Geschäftstabellen und dieselben Counts/FKs wie die read-only Ausgangsaufnahme.
- **Ausgeführt:** Der Legacy-Dump wurde in eine leere primäre Restore-Datenbank eingespielt: fünf Tabellen, `1/15/3/5/9` Datensätze und sieben Foreign Keys.
- **Ausgeführt:** Derselbe Dump wurde unabhängig in eine zweite leere Restore-Datenbank eingespielt; Counts und Struktur waren erneut plausibel.
- **Ausgeführt:** Beide Restore-Ziele konnten nach Migration mit Live-/Ready-HTTP 200 und identischem API-Smoke gestartet werden.
- **Nicht ausgeführt:** Login des bestehenden Dev-Kontos, weil keine Zugangsdaten offengelegt oder aus Daten extrahiert wurden. Stattdessen wurden reproduzierbare, nach dem Restore erzeugte Testkonten verwendet.

## 8. Migrationsergebnis

**Primäre Restore-Kopie, ausgeführt:**

- 001–004 vollständig angewandt; gemessene Laufzeiten 28 ms, 87 ms, 19 ms und 1'411 ms.
- Ledger danach ohne `pending`, `dirty`, `drift` oder `unknown`.
- Zweiter Lauf: `applied: []`, also No-op.

**Sekundäre Restore-Kopie, ausgeführt:**

- 001–004 erneut vollständig angewandt; Laufzeiten 32 ms, 86 ms, 26 ms und 1'661 ms.
- Zweiter Status sauber; Anwendung und API-Smoke erfolgreich.

**Geprüfte Checksums:**

| Migration | SHA-256 |
| --- | --- |
| 001 | `2661f9b72f96d520f2ed33f22053a65c468f616cb4a07363c06d9f080d657574` |
| 002 | `71d5e13c7402fcddcab76621ab14780609580ed0fcb69713557a071f0249e779` |
| 003 | `4dc354a63d703c68892cfadca374f789609da86411aef3cb933d4c058205a28e` |
| 004 | `e47af1b1f4b5323d29a2c47ec22ae52a466c75142014badb45f461188011873b` |

Die Entwicklungsdatenbank ist ebenfalls sauber auf 001–004 und behielt alle erfassten Counts. Sie wurde wegen der beschriebenen Abweichung nicht erst nach den kontrollierten Gates migriert; dies darf im Pilotprotokoll nicht als regelkonformer Dev-Migrationslauf ausgegeben werden.

## 9. Datenintegritätsvergleich

- **Ausgeführt:** Vor-/Nach-Counts auf der primären Restore-Kopie identisch: `users=1`, `exercises=15`, `workouts=3`, `workout_exercises=5`, `progress_entries=9`.
- **Ausgeführt:** 13 Integritätsabfragen ergaben jeweils 0: Orphans aller relevanten Beziehungen, ungültige Quelllinks, doppelte Progress-Einträge je Workout-Übung, fehlende Snapshots und Abweichungen der abgeleiteten Werte.
- **Ausgeführt:** Foreign Keys blieben erhalten; Migration 004 ergänzte die vorgesehene zusammengesetzte Quellkonsistenz.
- **Ausgeführt:** Transaktionsprobe: doppelter abgeleiteter Eintrag abgelehnt, Kaskade von Workout zu Workout-Übungen und Progress wirksam, Rollback hinterliess 0 Probe-Benutzer.
- **Ausgeführt:** API-Smoke auf beiden Kopien: Register, Login, Workout Create/Read/Update/Delete, 409 für Mutation abgeleiteter Progress-Einträge, manueller Progress Create/Delete und Summary. Probe-Benutzer wurden entfernt.

## 10. Browser-E2E-Ergebnisse

**Automatisiert getestet, Chromium, 9/9 erfolgreich:**

- geschützte Weiterleitung, Registrierung und Login;
- sichere und per Screenreader angekündigte Loginfehler;
- Workout Create/Read/Update/Delete;
- kg→lb→kg ohne Drift und abgeleitete Progress-Herkunft;
- 1RM im Browser korrekt (`60 kg × 8` ergibt `76 kg` nach Epley);
- manuelle Progress-Einträge löschbar, abgeleitete Einträge unveränderlich;
- zwei unabhängige Browserkontexte sehen nur eigene Daten;
- Fremd-ID liefert 404, ungültige Session 401;
- isolierte DB `fittrack_e2e_stage0b`, eigener Backend-/Frontend-Port und automatischer Drop im Global Teardown.

Der abschliessende Flow aktiviert Login, Workout-Erstellung, Übungsauswahl und Speichern per Tastatur/Enter. Trace und Screenshot werden nur bei Fehlern behalten; Video ist deaktiviert.

## 11. Accessibility-Ergebnisse

- **Automatisiert getestet:** Axe auf Login, Registrierung, Workout- und Progress-Kernseiten; keine `serious` oder `critical` Violations.
- **Automatisiert getestet:** Login-Submit und kritische Workout-Erstellung per Tastatur.
- **Automatisiert getestet:** Skip-Link, Seitentitel, Routenfokus, 404, Dialogname, Initialfokus, Escape, Fokusbindung/-rückgabe, Body-Scroll-Lock und Mobile-Menüstatus.
- **Automatisiert getestet:** Fehler als `role=alert`, Erfolg als Status; Formulare und Felder besitzen nutzbare Label-/Invalid-Semantik.
- **Behoben:** Workout-/Progress-Editoren sind echte Formulare; Dialoge nutzen eine gemeinsame Fokussteuerung; Charts besitzen Bildsemantik; Navigations-Landmarks sind benannt.
- **Manuell/statisch und per Axe nachgeprüft:** Muted-Text `#625d55` auf `#f7f4ee` ca. 5.95:1; Warning/Danger `#8f3728` auf `#fde7df` ca. 6.44:1.
- **Bekannte Grenze:** Axe blockiert in diesem Pilot nur `serious`/`critical`; moderate/minor Befunde und jede denkbare Dialogzustandskombination sind kein vollständiges WCAG-Audit.

## 12. Responsive- und Browser-Ergebnisse

- **Automatisiert getestet in Chromium:** `/workouts` und `/progress` bei 375×667, 390×844, 768×1024 und 1366×768; `document` und `body` ohne horizontalen Overflow.
- **Automatisiert getestet:** Mobile Navigation bei 390×844 inklusive `aria-expanded`, verständlichem Accessible Name, Escape und Fokusrückgabe.
- **Ausgeführt:** System-Chrome wurde lokal verwendet; CI installiert reproduzierbar Playwright Chromium.
- **Offen/Priorität 3:** Firefox- und WebKit-Smoke wurden nicht ausgeführt, da lokal keine Playwright-Binaries vorhanden waren und Chromium die verbindliche Mindestabdeckung erfüllte. Die Konfiguration enthält optionale Projekte und `npm run test:e2e:extra`.

## 13. Logging- und Security-Ergebnisse

- **Automatisiert getestet:** Abschlusslogs enthalten Zeitstempel, Level, Request-ID, Methode, normalisiertes Route-Pattern, Status und Dauer; Query und Body werden nicht aufgenommen.
- **Automatisiert getestet:** 4xx werden als `api_request_rejected`, 5xx serverseitig mit sanitisierter Error-Klassifikation/Stack geloggt. Interne Details gelangen nicht in Clientantworten.
- **Automatisiert getestet:** rekursive Redaction für `authorization`, `cookie`, `password`, `passphrase`, `token`, `jwt`, `secret`, Credentials/Refresh-Daten, Bearer-Werte, JWT-artige Werte und URL-Credentials.
- **Manuell/statisch geprüft:** Vollständige Workout-Notizen, Körperwerte, Gesundheitsdaten und Request-Bodys werden nicht in den Requestlogs erfasst.
- **Automatisiert getestet:** `TRUST_PROXY_HOPS` ist numerisch auf 0–10 begrenzt, Standard 0.
- **Automatisiert getestet:** Loginlimit 10/15 Minuten, Registrierungslimit 5/Stunde, unabhängige Client-/Limiter-Keys, 429 mit Request-ID und `Retry-After`. Werte sind per Environment konfigurierbar.
- **Nur dokumentiert:** Redis als Produktionsoption für gemeinsamen Zustand mehrerer Instanzen; im Pilot bleibt der Limiter bewusst pro Prozess und in-memory.
- **Nur dokumentierte Monitoring-Schwellen:** Readiness länger als 2 Minuten nicht 200 = kritisch; 5xx >2 % bei mindestens 10 Requests/5 Minuten = Warnung, >5 % = kritisch; Loginfehler >30 % bei mindestens 20 Versuchen/10 Minuten = Warnung, >50 % = kritisch; DB nicht erreichbar oder Migration fehlgeschlagen/dirty/drift = sofort kritisch; Backupalter >24 Stunden = kritisch; 429 >20 pro Client/5 Minuten oder >5 % global = Warnung; API-p95 >750 ms für 10 Minuten = Warnung, >1'500 ms für 5 Minuten = kritisch.
- **Nur dokumentierte Dashboard-Metriken:** Live/Ready, Requests nach Route/Status, 4xx/5xx, p50/p95/p99, Loginfehler, 429, DB-/Startup-Ereignisse, Migrationsergebnis/-dauer, letzter Backupzeitpunkt/-alter und Restore-Dauer.

## 14. CI-Änderungen

- **Implementiert und statisch geprüft:** Neuer Job `browser` mit MySQL 8, Node 22.17.0, clean `npm ci` in Backend/Frontend, Playwright-Chromium-Installation und `npm run test:e2e`.
- **Implementiert:** Das E2E-Harness setzt eine isolierte Wegwerf-DB zurück/migriert sie und entfernt sie im Global Teardown.
- **Implementiert:** Eindeutige Benutzer-Fixtures verhindern Kollisionen bei CI-Retries und optionalen Browserprojekten.
- **Implementiert:** Bei Fehlern werden `test-results` und `playwright-report` für sieben Tage hochgeladen; erfolgreiche Läufe erzeugen keine dauerhaften Testartefakte.
- **Erhalten:** Bestehende Backend-/Migrations-, Frontend-, Build- und Audit-Gates bleiben unverändert aktiv.
- **Nicht remote ausgeführt:** Die Workflowdatei wurde lokal geprüft, aber mangels Push bewusst kein GitHub-Actions-Lauf ausgelöst.

## 15. Geänderte Dateien

**Datenbanksicherheit und Werkzeuge:**

- `backend/package.json`
- `backend/scripts/databaseSafety.js`
- `backend/scripts/databaseTools.js`
- `backend/scripts/dbBackup.js`
- `backend/scripts/dbRestore.js`
- `backend/scripts/testDbReset.js`
- `backend/scripts/testDbDrop.js`
- `backend/scripts/e2eServer.js`

**Observability, Rate-Limit und Konfiguration:**

- `backend/.env.example`
- `backend/middleware/httpFoundation.js`
- `backend/middleware/rateLimiter.js`
- `backend/routes/users.js`
- `backend/startup/app.js`
- `backend/startup/logger.js`

**Browser, Accessibility und UI:**

- `frontend/package.json`, `frontend/package-lock.json`, `frontend/playwright.config.js`, `frontend/vite.config.js`
- `frontend/e2e/accessibility.spec.js`, `auth.spec.js`, `training.spec.js`, `helpers.js`, `global-teardown.js`
- `frontend/src/App.vue`, `assets/main.css`, `components/Navbar.vue`, `router/index.js`, `utils/i18n.js`, `utils/modalFocus.js`
- `frontend/src/views/LoginView.vue`, `RegisterView.vue`, `WorkoutsView.vue`, `ProgressView.vue`, `NotFoundView.vue`

**CI, Ignore und Dokumentation:**

- `.github/workflows/ci.yml`
- `.gitignore`
- `docs/BACKUP_RESTORE.md`
- `docs/STAGE_0B.md`

Testdateien sind im nächsten Kapitel separat aufgeführt.

## 16. Neue oder geänderte Tests

**Neu:**

- `backend/test/unit/databaseSafety.test.js`: Loopback-/Namensschutz, Restore-Bestätigung und externe Backupziele.
- `backend/test/unit/databaseTools.test.js`: passwortfreie CLI-Argumente, stdin, Namen und Dump-Verifikation.
- `backend/test/unit/requestLogging.test.js`: begrenzte Request-Metadaten ohne Query/Body.
- `frontend/e2e/auth.spec.js`: Registrierung, Weiterleitung/Login und sichere Loginfehler.
- `frontend/e2e/training.spec.js`: Tastaturpfad für die Workout-Erstellung, kg/lb-Rundlauf, Herkunft, Unveränderlichkeit, 1RM und Zwei-Nutzer-Isolation.
- `frontend/e2e/accessibility.spec.js`: Axe, Skip-Link, Route/Fokus/404, Dialog, Mobile-Nav und vier Viewports.

**Geändert:**

- `backend/test/unit/rateLimiter.test.js`: getrennte Clients/Limiter, 429, Request-ID und Retry-Metadaten.
- `backend/test/startupHealth.test.js`: sichere `TRUST_PROXY_HOPS`-Grenzen.
- `backend/test/unit/startupLogger.test.js`: Stack und erweiterte Secret-Redaction.
- `frontend/vite.config.js`: E2E-Dateien werden aus Vitest ausgeschlossen, die vorhandenen 53 Tests bleiben erhalten.

## 17. Ausgeführte Befehle

Secrets und einmalige Testwerte sind absichtlich ausgelassen. Tatsächlich ausgeführte Befehlsgruppen:

```text
git status --short
git branch --show-current
git log --oneline --decorate -10
git diff main...HEAD --stat
git diff --check
git stash list
git rev-list --left-right --count origin/main...HEAD

git worktree add --detach <temporärer-worktree> aea9bd2
cd backend  && npm ci && npm test && npm run audit:security
cd frontend && npm ci && npm run test:run && npm run build && npm audit
docker compose config
docker compose ps

npm run db:check
npm run db:migrate:status
npm run db:backup
npm run db:restore:test
npm run db:migrate
npm run db:test:drop

npm run test:e2e
```

Zusätzlich wurden gezielte read-only SQL-/Node-Prüfungen für Tabellen, Counts, Foreign Keys, Ledger und Integrität sowie ein API-Smoke gegen beide Restore-Kopien ausgeführt. Die vier temporären Prüfscripte enthielten keine Secrets und wurden nach dem Nachweis entfernt.

## 18. Test-, Build- und Auditresultate

| Nachweis | Resultat | Art |
| --- | --- | --- |
| Clean-Room Backend | 46/46 + 51 Syntaxdateien | ausgeführt |
| Clean-Room Frontend | 53/53 | ausgeführt |
| Clean-Room Build | erfolgreich, 58 Module | ausgeführt |
| Finales Backend nach 0B-Code | 45 Unit + 6 Integration + 8 Migration = 59/59; 60 Syntaxdateien | ausgeführt |
| Finales Frontend | 53/53 | ausgeführt |
| Finaler Produktionsbuild | erfolgreich, 61 Module | ausgeführt |
| Chromium-E2E/Axe | 9/9 | ausgeführt |
| Backend npm audit | 0 Vulnerabilities | ausgeführt |
| Frontend npm audit | 0 Vulnerabilities | ausgeführt |
| Compose-Konfiguration | gültig | ausgeführt |
| Primärer Restore/Migration/API-Smoke | erfolgreich | ausgeführt |
| Sekundärer Restore/Migration/API-Smoke | erfolgreich | ausgeführt |
| Firefox/WebKit | nicht ausgeführt | offen/Priorität 3 |
| Remote-CI | nicht ausgeführt, weil kein Push | offen |

## 19. Lokale Commits

Implementierungsstand vor dem Abschlusscommit:

```text
18cacfc Add safe local database recovery tooling
0fdd9e0 Add isolated browser and accessibility coverage
28a65fb Add pilot observability and browser CI gates
```

Die Dokumentation und der explizite Tastaturnachweis werden als lokaler Abschlusscommit hinzugefügt. Kein Commit wurde gepusht.

## 20. Finaler Git-Status

Git-Zielzustand nach Abschlussvalidierung und -commit:

- Branch `stabilization/stage-0b`.
- `git status --short` leer.
- `git diff --check` leer.
- Keine Dumps, Playwright-Fehlerartefakte, temporären Testskripte oder Testdatenbanken werden getrackt oder committed.
- Vier vorhandene Stashes unverändert.
- Kein Push; `origin/main` unverändert.

Der tatsächlich erneut ausgelesene finale Status und der Abschlusscommit werden im Übergabebericht angegeben; bei einer Abweichung gilt dieser Zielzustand nicht als erreicht. Im kontrollierten Abschluss wurden die drei Restore-Kopien über den geschützten Projektbefehl gedroppt, der temporäre Clean-Room-Worktree und die vier Nachweisskripte entfernt sowie `frontend/dist` und das ignorierte Playwright-Ausgabeverzeichnis bereinigt. Die E2E-Datenbank wurde durch den erfolgreichen Global Teardown entfernt. Die zwei verifizierten externen Dumps blieben bewusst erhalten.

## 21. Bekannte Einschränkungen

- Backup/Restore setzt einen lokalen Docker-Container mit `mysqldump`/`mysql` voraus; Produktionsrestore ist bewusst gesperrt.
- `DB_HOST` und `FITTRACK_DB_CONTAINER` werden getrennt konfiguriert. Eine Fehlkonfiguration könnte Verbindung und Docker-Tool auf unterschiedliche lokale Instanzen richten; vor jedem Lauf Container/DB explizit vergleichen.
- Restore ist für Wegwerfziele sicher begrenzt, aber nicht atomar: Nach Drop und fehlgeschlagenem Import kann eine partielle Testdatenbank verbleiben.
- E2E verwendet feste lokale Ports und einen festen DB-Namen; parallele lokale E2E-Läufe sind nicht vorgesehen.
- Chromium ist das einzige tatsächlich ausgeführte Browserprojekt.
- Axe blockiert nur schwere/kritische Findings und ersetzt kein vollständiges manuelles WCAG-Audit.
- Requestabschlusslogs hängen am `finish`-Event; hart abgebrochene Verbindungen können ohne Abschlussereignis bleiben.
- Rate Limits sind pro Prozess, verlieren Zustand bei Neustart und werden nicht zwischen Instanzen geteilt.
- Migrationen laufen beim Backendstart mit DDL-Rechten; privilegierter Migrations- und eingeschränkter Runtime-Nutzer sind noch nicht getrennt.
- Die zwei verifizierten Dumps bleiben bewusst lokal ausserhalb von Git; verschlüsselter Off-host-Storage und eine verbindliche Retention fehlen weiterhin.

## 22. Offene Risiken

1. **Hoch vor Produktion:** Die Ursache der ungeplanten Auto-Migration muss betrieblich adressiert werden: genau ein kontrollierter Migrations-Owner, Change-Fenster und keine konkurrierenden Watcher/Instanzen.
2. **Hoch vor Produktion:** Migration 004 beziehungsweise künftige MySQL-DDL benötigt ein getestetes Recovery-Runbook für partielle Dirty-Zustände.
3. **Hoch vor Produktion:** Tägliche verschlüsselte Off-host-Backups, Retention, Owner, Alarmierung und gemessene RTO-/RPO-Übungen fehlen noch.
4. **Mittel bei Skalierung:** In-memory Rate-Limits benötigen einen gemeinsamen Store wie Redis und einen korrekt konfigurierten vertrauenswürdigen Proxy-Pfad.
5. **Mittel:** Firefox/WebKit und ein vollständiger manueller Tastatur-/Screenreader-/WCAG-Test stehen aus.
6. **Mittel:** Die CI-Konfiguration ist lokal vorhanden, aber bis zu einem autorisierten Push nicht in GitHub Actions ausgeführt.
7. **Bestehende API-Grenze:** Fehler-Envelopes aus 0A sind gegenüber älteren externen Clients potenziell breaking; fremde IDs bleiben bewusst 404.
8. **Bestehende Identitätsgrenze:** Workout-Updates erzeugen abgeleitete `workout_exercises`/`progress_entries` neu; Inhalte bleiben konsistent, IDs sind nicht stabil.
9. **Lokale Umgebungsdrift:** Der bestehende MySQL-Container trägt ältere Compose-Labels für inzwischen entfernte Schema-/Seed-Bind-Mounts. Vor dem nächsten kontrollierten Container-Recreate muss die effektive Compose-Konfiguration erneut verglichen werden.

## 23. Empfehlung für den nächsten Schritt

Stufe 0B nach final grünem Regressionslauf und sauberem Git-Status als **lokalen Pilotbetriebsnachweis mit dokumentierter Migrationsabweichung** abnehmen. Vor einem echten Pilot mit schützenswerten Daten sollten zuerst Backup-Automatisierung/Off-host-Verschlüsselung, kontrollierte Migrationsverantwortung, Dirty-Recovery und ein autorisierter Remote-CI-Lauf verbindlich erledigt werden.

Danach an der Stop-Bedingung halten und auf ausdrückliche Freigabe warten. Stufe 1A (Studio-, Tenant- und Rollenfundament) wurde nicht begonnen.

## 24. Remote-Nachweis als Follow-up in Stufe 0C

Die vorstehenden Kapitel dokumentieren den lokalen Abschlusszeitpunkt von Stufe 0B. In der ausdrücklich freigegebenen Folgestufe 0C wurde der Branch anschließend normal auf den Remote gepusht und als Pull Request #1 von `stabilization/stage-0b` nach `main` geöffnet; ein Merge fand nicht statt.

- **Tatsächlich ausgeführt:** Der erste GitHub-Actions-Lauf verwendete exakt Commit `576af35ae291247df0222aa8d6e9399d5be65caf`. Frontend sowie Chromium/Axe waren erfolgreich; der Backend-Job zeigte eine reale Inkonsistenz zwischen dem CI-Ziel `fittrack_ci_test` und dem absichtlich engen Wegwerf-DB-Guard.
- **Automatisiert reproduziert und behoben:** Ein neuer Test koppelt den Backend-CI-Datenbanknamen an denselben Sicherheitsguard. Der Zielname wurde minimal auf `fittrack_test_ci` korrigiert; der Guard wurde nicht abgeschwächt.
- **Tatsächlich ausgeführt:** GitHub-Actions-Run `29650890444` auf Korrekturcommit `7b81bc52c04aebdb851f72c775c4c49b7c5a939c` war in allen drei Jobs erfolgreich: Backend/MySQL/Migrationen, Frontend/Build und Chromium/Axe.
- **Manuell geprüft:** Der erfolgreiche Lauf erzeugte keine hochgeladenen Artefakte. Pull Request #1 blieb offen, ungemergt und laut GitHub mergebar.

Die neuen Migrations-, Backup- und Betriebsmaßnahmen werden ausschließlich in `docs/STAGE_0C.md` und den dort verlinkten kanonischen Runbooks fortgeschrieben.
