# FitTrack Deployment

Diese Anleitung beschreibt den Betriebsvertrag nach Stufe 0C. `docker-compose.yml` stellt weiterhin nur eine lokale MySQL-Instanz bereit und ist keine Produktionsarchitektur.

## Festgelegte Toolchain

- Node.js: `22.17.0` aus `.nvmrc`
- npm: `10.9.2` beziehungsweise kompatibles npm 10
- Datenbank: MySQL 8.0
- reproduzierbare Installation: `npm ci`, nicht `npm install`

CI verwendet Node 22.17.0 und MySQL 8.0. Vor einem Release müssen alle verbindlichen Remote-CI-Jobs für den exakten Commit erfolgreich sein.

## Backend-Umgebung

Produktionswerte gehören in den Secret Store der Zielplattform und nicht in Git, Images oder Build-Logs.

| Variable | Erforderlich | Bedeutung und Grenze |
| --- | --- | --- |
| `NODE_ENV` | ja | Exakt `development`, `test` oder `production`; fehlende, anders geschriebene und unbekannte Werte brechen einen echten Server- oder Migrationsstart ab |
| `PORT` | nein | API-Port, Standard 3001, gültig 1–65535 |
| `DB_HOST` | ja in Produktion | Hostname der MySQL-8-Instanz |
| `DB_USER` | ja in Produktion | Runtime-Nutzer beim status-only Start; DDL-Nutzer nur im kontrollierten Migrationsschritt |
| `DB_PASSWORD` | ja in Produktion | Eindeutiges Secret; niemals das lokale `root`-Beispiel |
| `DB_NAME` | ja vor jeder Mutation | Explizites Ziel; nur Buchstaben, Ziffern, `_`, `$` und `-` |
| `DB_PORT` | nein | MySQL-Port, Standard 3306 |
| `DB_CONNECT_TIMEOUT_MS` | nein | 100–120000, Standard 10000 |
| `DB_CONNECTION_LIMIT` | nein | Poolgröße 1–100, Standard 10 |
| `DB_QUEUE_LIMIT` | nein | Warteschlangenlimit 0–100000, Standard 100; 0 = unbegrenzt |
| `FITTRACK_AUTO_MIGRATE` | nein | Exakt `true` oder `false`, Standard `false`; `true` nur für einen kontrollierten Migrations-Owner |
| `FITTRACK_MIGRATION_EXPECTED_DATABASE` | bei jeder Migration | Muss vor `db:migrate`, `db:dev:init` und Auto-Migrate exakt dem expliziten `DB_NAME` entsprechen |
| `JWT_SECRET` | ja in Produktion | Eindeutig, mindestens 32 Zeichen; bekannte Platzhalter werden abgelehnt |
| `CORS_ORIGIN` | ja in Produktion | Kommaseparierte HTTP(S)-Origins ohne Pfad |

Beispiel ohne echte Secrets:

```env
NODE_ENV=production
PORT=3001
DB_HOST=mysql.internal
DB_USER=fittrack_runtime
DB_PASSWORD=<secret-store-reference>
DB_NAME=fittrack
DB_PORT=3306
DB_CONNECT_TIMEOUT_MS=10000
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=100
FITTRACK_AUTO_MIGRATE=false
FITTRACK_MIGRATION_EXPECTED_DATABASE=fittrack
JWT_SECRET=<unique-random-secret-at-least-32-characters>
CORS_ORIGIN=https://app.example.ch
```

### Deterministische `.env`-Auflösung

Lokale Backend-Konfiguration wird immer aus `backend/.env` geladen, unabhängig davon, ob der Prozess aus dem Repository-Root, aus `backend` oder über eine IDE gestartet wird. Eine `.env` im aktuellen Arbeitsverzeichnis wird nicht als alternative Backend-Konfiguration verwendet. Bereits gesetzte Prozess-/Plattformvariablen haben Vorrang. Die Datei `backend/.env` bleibt ignoriert und darf weder echte Secrets noch Produktionswerte ins Repository bringen.

Der Datenbankpool wird lazy erzeugt. Ein reiner Import von `server.js`, DB-Konfiguration, Migrations-CLI oder Migrationsdefinitionen startet weder Listener noch DB-Verbindung, Statusabfrage oder Migration.

## Startup- und Migrationsvertrag

### Standard: status-only

`FITTRACK_AUTO_MIGRATE` ist standardmäßig `false`. `npm start` und `npm run dev` verändern in diesem Modus weder Schema noch Ledger. Der Prozess:

```text
Prozessstart
→ backend/.env deterministisch laden
→ NODE_ENV, DB-, Port-, Auth-, CORS-, Proxy- und Rate-Limit-Konfiguration validieren
→ sicheres migration_target-Event loggen
→ Datenbankverbindung prüfen
→ Migrationsstatus read-only lesen
→ bei pending, dirty, drift oder unknown Start blockieren
→ Readiness aktivieren
→ Server Listener öffnen
```

Die vollständige Anwendungskonfiguration wird vor DB- oder Migrations-I/O validiert. Eine ungültige Auth-, CORS- oder sonstige Runtime-Konfiguration kann deshalb nicht zuerst das Schema verändern und erst danach den Start abbrechen.

### Kontrolliertes Auto-Migrate

Auto-Migrate ist nur aktiv, wenn alle folgenden Bedingungen erfüllt sind:

- `FITTRACK_AUTO_MIGRATE=true`;
- `NODE_ENV` ist gültig;
- `DB_NAME` ist explizit gesetzt;
- `FITTRACK_MIGRATION_EXPECTED_DATABASE` entspricht exakt `DB_NAME`;
- der Prozess ist der bewusst ausgewählte einzelne Migrations-Owner.

Dann lautet der zusätzliche Pfad:

```text
DB-Ping
→ erwartetes Ziel gegen SELECT DATABASE() bestätigen
→ MySQL Advisory Lock erwerben
→ Ledger und Migrationsstatus prüfen
→ ausschließlich ausstehende Forward-Migrationen anwenden
→ finalen Status prüfen
→ erst danach Listener öffnen
```

Bei Abweichung zwischen bestätigtem und tatsächlich selektiertem Datenbanknamen bricht der Runner vor Lock, Ledger-DDL und Anwendungsmigrationen mit `MIGRATION_TARGET_MISMATCH` ab.

Auto-Migrate ist kein Ersatz für einen kontrollierten Deployment-Schritt. Für Produktion ist der unten beschriebene explizite Migrationslauf mit anschließendem status-only Start der Standard.

### Sicheres Ziel-Logging

Vor jeder kontrollierten Migration wird `migration_target` als strukturiertes JSON-Ereignis ausgegeben. Es enthält ausschließlich:

- `environment`;
- `host`;
- `port`;
- `database`.

DB-Benutzer, Passwort, JWT-, Token- und Connection-String-Werte gehören nicht in dieses Ereignis. Der Runner bestätigt danach zusätzlich den von MySQL tatsächlich selektierten Datenbanknamen.

## Kommandomatrix und Seiteneffekte

| Befehl/Einstieg | DB-Verbindung | Migration/DDL | Zielschutz |
| --- | --- | --- | --- |
| Backend `npm start` | ja | standardmäßig nein; nur bei explizitem Auto-Migrate | gültiges `NODE_ENV`; bei Mutation erwartetes und tatsächliches DB-Ziel |
| Backend `npm run dev` | ja, bei jedem Nodemon-Restart | wie `npm start` | wie `npm start` |
| `npm run db:migrate:status` | ja | nein; Ledger/Registry read-only | konfigurierte DB |
| `npm run db:migrate:doctor` | ja | nein; vollständig read-only | konfiguriertes gegen selektiertes Ziel |
| `npm run db:migrate` | ja | ja | gültiges `NODE_ENV`, explizites `DB_NAME`, exakte erwartete DB und tatsächliche DB-Bestätigung |
| `npm run db:dev:init` | ja | DB bei Bedarf erstellen, danach migrieren | in Produktion gesperrt; dieselbe Zielbestätigung wie `db:migrate` |
| `npm run db:test:reset` | ja | Test-DB droppen, erstellen und migrieren | `NODE_ENV=test`, explizite Freigabe, Loopback und Wegwerf-DB-Name |
| `npm run db:test:drop` | ja | Test-DB droppen | dieselben Wegwerfguards |
| `npm run e2e:server` | ja | geschützter Reset/Migrationslauf; Server danach status-only | feste isolierte E2E-DB plus Wegwerfguards |
| Backend `npm run test:unit` / `test:coverage` | nein für Unit-Kernlogik | nein | Imports bleiben DB-I/O-frei |
| Backend `npm run test:integration` | ja | ja, nur in zufälliger API-Wegwerf-DB | pro Prozess isolierter Name |
| Backend `npm run test:migrations` | ja | ja, nur in zufälligen Migrations-Wegwerf-DBs | `fittrack_migration_test_<hex>` |
| Backend `npm run test:syntax` | nein | nein; `node --check` führt Module nicht aus | — |
| Frontend `npm run dev`, `build`, `preview`, `test:run` | nein | nein | Frontend lädt kein Backend-Migrationsmodul |
| Frontend `npm run test:e2e*` | ja, über den Playwright-Backend-Webserver | geschützter E2E-Reset/Migrationslauf | feste Loopback-/E2E-Konfiguration |
| `docker compose up` | nur MySQL | keine FitTrack-Versionierung; bei leerem Volume nur `MYSQL_DATABASE` | Compose ist lokal |
| Reiner Modulimport | nein | nein | `require.main`-Guards und lazy DB-Pool |

`npm ci`, Frontend-Build, Frontend-Unit-Tests und Syntaxprüfung dürfen keine FitTrack-Migration auslösen. Migrationen sind ausschließlich in den in der Matrix markierten Pfaden erlaubt.

## Frontend-Umgebung

| Variable | Zeitpunkt | Bedeutung |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Build | Standard `/api`; alternativ vollständige öffentliche HTTPS-API-URL |
| `API_PROXY_TARGET` | Entwicklung | Ziel des lokalen Vite-Proxys, Standard `http://localhost:3001` |

`VITE_API_BASE_URL` wird in das statische Bundle kompiliert. Produktion akzeptiert nur einen root-relativen Pfad ohne Query/Fragment oder eine absolute HTTPS-URL ohne eingebettete Zugangsdaten. Localhost-, Loopback-, Klartext-HTTP- und ungültige Produktionsziele brechen den Build ab. Bei `/api` muss der Reverse Proxy diesen Pfad an das Backend weiterleiten.

## Versionierte Migrationen

Die aktive Registry liegt in `database/migrations`:

1. `001_initial_schema`: nichtdestruktives Basisschema
2. `002_legacy_schema_upgrade`: unterstützte unversionierte FitTrack-Schemas additiv aktualisieren
3. `003_seed_global_exercises`: globale Übungen idempotent einfügen
4. `004_training_history_consistency`: Workout-Fortschritt verknüpfen und historische Übungs-Snapshots sichern

Der Runner verwendet:

- das Ledger `schema_migrations`;
- SHA-256-Prüfsummen gegen nachträglich veränderte Migrationen;
- Zustände für angewendet, laufend und fehlgeschlagen;
- einen MySQL Advisory Lock gegen parallele Migrationen;
- die tatsächliche Datenbankbestätigung vor DDL;
- einen zweiten Lauf als No-op.

Bereits veröffentlichte Migrationsdateien dürfen nicht umgeschrieben werden. Änderungen erfolgen immer in einer neuen, aufsteigend nummerierten Datei.

## Migration Doctor

Im Ordner `backend`:

```sh
npm run db:migrate:doctor
```

Der Doctor ist strikt read-only. Er erwirbt keinen Migrations-Lock und verändert weder Schema, Ledger noch Geschäftsdaten. Er prüft insbesondere:

- konfiguriertes und tatsächlich selektiertes Datenbankziel ohne Credentials;
- Ledger-Struktur und Ledger-Datensätze;
- pending, dirty, Checksum-Drift und unbekannte Migrationen;
- erwartete Tabellen, Spalten, Indizes, Foreign Keys und Check-Constraints;
- teilweise vorhandene oder abweichende Schemaelemente.

Das Ergebnis ist ein strukturiertes `migration_doctor_result`-Ereignis mit maschinenlesbarem Zustand, Fehlercodes und sicheren Zielmetadaten.

| Exit | Zustand | Bedeutung und Reaktion |
| ---: | --- | --- |
| 0 | `ready` | Ledger, Registry und erwartetes Schema sind sauber |
| 2 | `pending` | kontrolliertes Migrationsfenster erforderlich; kein normaler Serverstart |
| 3 | `recovery_required` | Dirty, Drift, Unknown, ungültiges Ledger oder Schemaabweichung; Deployment stoppen |
| 1 | `failed` | Konfigurations-, Verbindungs-, Ziel- oder Diagnosefehler beheben; keine Migration starten |

Bei Exit 3 oder wiederholtem Exit 1 gilt das Runbook [MIGRATION_RECOVERY.md](MIGRATION_RECOVERY.md). Der Doctor repariert niemals automatisch Ledger oder Schema.

`npm run db:migrate:status` bleibt die kleinere read-only Ledger-/Registry-Prüfung. Sie endet mit Exit 1, solange pending, dirty, drift oder unknown vorliegt. Der Doctor liefert darüber hinaus den Schema- und Recovery-Befund mit den differenzierten Exitcodes oben.

## Explizite Migrationsbefehle

Vor einem mutierenden Lauf müssen `DB_NAME` und die Bestätigung gesetzt sein:

```env
DB_NAME=fittrack
FITTRACK_MIGRATION_EXPECTED_DATABASE=fittrack
```

Danach im Ordner `backend`:

```sh
npm run db:migrate:doctor
npm run db:migrate
npm run db:migrate:doctor
npm run db:migrate:status
```

Ein Doctor-Exit 2 vor dem geplanten Lauf darf ausschließlich die erwarteten ausstehenden Migrationen enthalten. Exit 3 oder 1 ist eine Stop-Bedingung. Nach dem Lauf müssen Doctor und Status erfolgreich sein.

`db:migrate` verändert Schema und gegebenenfalls Bestandsdaten. Vor jeder Produktionsmigration sind ein aktuelles verifiziertes Backup, ein geprüfter Restore-Weg, ein Change-Fenster und eine Rollback-/Recovery-Entscheidung erforderlich.

Es gibt keine automatischen Down-Migrationen. Bei Dirty-, Drift-, Unknown- oder Schemafehlern das Ledger nicht manuell umschreiben, keine Blindstarts wiederholen und `docs/MIGRATION_RECOVERY.md` ausführen.

## Deutlich destruktive Befehle

### Testdatenbank zurücksetzen

`npm run db:test:reset` droppt und erstellt exakt `DB_NAME` neu. Der Befehl verweigert die Ausführung, wenn nicht alle Bedingungen erfüllt sind:

- `NODE_ENV=test`;
- `ALLOW_TEST_DB_RESET=true`;
- `DB_HOST` ist Loopback (`localhost`, `127.0.0.1` oder `::1`);
- `DB_NAME` entspricht dem streng begrenzten Wegwerfmuster `fittrack_test_*`, `fittrack_e2e_*` oder `fittrack_restore_*`.

Beispiel:

```powershell
$env:NODE_ENV = 'test'
$env:ALLOW_TEST_DB_RESET = 'true'
$env:DB_HOST = '127.0.0.1'
$env:DB_NAME = 'fittrack_test_local'
npm run db:test:reset
```

### Legacy-SQL und Docker-Volume

> **Nicht in Produktion ausführen:** `database/schema.sql` enthält `DROP TABLE`. Die Datei ist kein Teil des aktiven Migrationssystems.

> **Niemals für einen normalen Neustart verwenden:** `docker compose down -v` löscht das lokale MySQL-Volume vollständig.

Die Legacy-SQL-Dateien werden in `docker-compose.yml` nicht in den MySQL-Initialisierungsordner gemountet. Ein neues Volume erhält nur die über `MYSQL_DATABASE` benannte leere Datenbank; Tabellen und Seeds entstehen über die versionierten Migrationen.

## Lokale und Test-Datenbanken

`npm run db:dev:init` ist der lokale Initialisierungsweg:

- ein gültiges `NODE_ENV` ist erforderlich; vorgesehen ist `development`;
- in `production` gesperrt;
- `DB_NAME` und `FITTRACK_MIGRATION_EXPECTED_DATABASE` müssen explizit identisch sein;
- erstellt ausschließlich die konfigurierte fehlende Datenbank;
- droppt keine Datenbank;
- wendet danach alle Migrationen an.

Danach startet `npm run dev` standardmäßig status-only. Ein liegen gebliebener Watcher kann deshalb nicht ohne das zusätzliche explizite Auto-Migrate-Opt-in die Entwicklungsdatenbank verändern.

API-Integrationstests und Migrationstests verwenden ausschließlich eigene zufällige Wegwerf-Datenbanknamen und löschen sie im Cleanup. `FITTRACK_RUN_DB_INTEGRATION=false` überspringt die realen Migrationsszenarien nur für einen bewusst DB-losen lokalen Teilcheck; das ist kein vollständiges Release-Gate.

## Produktionsablauf

1. Remote-CI für den exakten Commit vollständig grün abwarten.
2. Release-Artefakt und Commit-SHA festhalten.
3. Datenbankbackup erstellen, Hash und Status prüfen sowie Restore-Verfügbarkeit bestätigen.
4. `NODE_ENV=production`, DB-Ziel, Secrets, `FITTRACK_AUTO_MIGRATE=false` und `FITTRACK_MIGRATION_EXPECTED_DATABASE=DB_NAME` im Secret-/Deployment-System validieren.
5. Sicherstellen, dass genau ein privilegierter Migrations-Owner aktiv ist und normale Runtime-Instanzen noch keinen Traffic erhalten.
6. Backend-Abhängigkeiten reproduzierbar installieren und Diagnose ausführen:

```sh
cd backend
npm ci --omit=dev
npm run db:migrate:doctor
```

7. Nur bei Doctor Exit 0 oder erwartbarem Exit 2 im freigegebenen Change-Fenster explizit migrieren:

```sh
npm run db:migrate
npm run db:migrate:doctor
npm run db:migrate:status
```

Nach der Migration müssen Doctor Exit 0 und Status Exit 0 liefern.

8. DDL-Rechte beziehungsweise den privilegierten Migrationskontext entfernen und das Backend status-only starten:

```sh
npm start
```

Der Server validiert die gesamte Runtime-Konfiguration, loggt das sichere Ziel, prüft Verbindung und Migrationsstatus und lauscht nur bei einem vollständig sauberen Zustand. Er migriert mit `FITTRACK_AUTO_MIGRATE=false` nicht.

9. Frontend bauen:

```sh
cd frontend
npm ci
VITE_API_BASE_URL=/api npm run build
```

10. `frontend/dist` unverändert über einen statischen Hoster ausliefern, SPA-Fallback konfigurieren, `/api` an das Backend routen und TLS terminieren.
11. Readiness erst nach erfolgreicher Prüfung für Traffic freigeben und mindestens zwei Minuten beobachten.

Der gezeigte Inline-Frontend-Environment-Befehl ist POSIX-Syntax. In PowerShell wird die Variable vor dem Build über `$env:VITE_API_BASE_URL = '/api'` gesetzt.

## Health und Prozesssteuerung

| Endpunkt | Erfolg | Zweck |
| --- | --- | --- |
| `/api/health/live` | 200 `{ "status": "live" }` | Prozess lebt; keine DB-Prüfung |
| `/api/health/ready` | 200 ready, sonst 503 | DB-Ping, Lifecycle und sauberer Migrationsstatus |
| `/api/health` | wie `/ready` | rückwärtskompatibler Readiness-Alias |

Readiness bleibt bei pending, dirty, drift oder unknown auf 503. `SIGTERM` und `SIGINT` markieren die Instanz nicht bereit, schließen den HTTP-Server und danach den DB-Pool.

## CI-Gates

`.github/workflows/ci.yml` läuft auf Pull Requests, Pushes nach `main` und manuell.

Der Backend-Job benötigt für sein isoliertes Ziel mindestens:

```env
NODE_ENV=test
DB_NAME=fittrack_test_ci
FITTRACK_MIGRATION_EXPECTED_DATABASE=fittrack_test_ci
FITTRACK_AUTO_MIGRATE=false
```

Damit bleibt der Server status-only, während der explizite CI-Schritt `npm run db:migrate` sein Ziel doppelt bestätigt. Der Backend-Job umfasst MySQL-Healthcheck, geschützten Reset, expliziten Migrations-No-op, Doctor-/Statusprüfung, vollständige Tests, Syntax, Coverage und Dependency-Audit. Zusätzlich erstellt er mit der MySQL-Service-Container-ID ein komprimiertes Wegwerf-Backup im Runner-Temp, prüft Manifest, Hash und Backupstatus und lädt dieses kurzlebige Artefakt nicht hoch.

Der Frontend-Job führt Installation, Audit, Unit-/Komponententests und Produktionsbuild aus, aber keine Migration. Der Browser-Job verwendet eine isolierte Loopback-E2E-Datenbank, den geschützten Reset/Migrationspfad und Chromium/Axe; erfolgreiche Läufe behalten keine DB-Dumps.

CI-Zugangsdaten wie `root/root` existieren ausschließlich im isolierten, kurzlebigen MySQL-Service des Runners und sind keine Produktionswerte.

## Release-Checkliste

- [ ] Remote-CI für den exakten Release-Commit grün
- [ ] keine Security-Befunde ab `high`
- [ ] Backup aktuell, Hash vorhanden und Restore-Weg bestätigt
- [ ] `NODE_ENV`, `JWT_SECRET`, DB-Secrets und CORS-Origin geprüft
- [ ] `FITTRACK_AUTO_MIGRATE=false` für normale Runtime-Instanzen
- [ ] erwartete Datenbank entspricht exakt `DB_NAME`
- [ ] sicherer Ziel-Log geprüft, keine Credentials enthalten
- [ ] Migration Doctor nach Migration Exit 0
- [ ] Migrationsstatus sauber und zweiter Lauf No-op
- [ ] Backend-Readiness liefert 200
- [ ] Registrierung/Login und Zwei-Nutzer-Isolation geprüft
- [ ] Workout-/Progress-Smokes erfolgreich
- [ ] Rollback-/Recovery-Entscheid und verantwortliche Person festgehalten

## Grenzen nach Stufe 0C

- Keine automatischen Down-Migrationen und keine automatische Ledger-Reparatur.
- MySQL-DDL ist nicht vollständig transaktional; Dirty-Recovery bleibt ein kontrollierter manueller Incident-Prozess.
- Kein automatischer Datenbank-Rollback und keine produktionsfertige Deployment-Orchestrierung.
- Auto-Migrate ist technisch verfügbar, aber ein einzelner Owner muss betrieblich sichergestellt werden.
- Readiness prüft API, MySQL und Migrationsstatus, aber nicht Frontend, Reverse Proxy oder externe Plattformdienste.
- Der Rate Limiter ist pro Prozess; mehrere Instanzen teilen keinen zentralen Zähler.
- Chromium-E2E/Axe ist das verbindliche Browser-Gate; Firefox, WebKit und ein vollständiger manueller Screenreader-Test bleiben zusätzliche Nachweise.
- Keine Last-, Failover- oder Replikationstests.
- Ein grüner Dependency-Audit ersetzt weder Penetrationstest noch manuelle Security-Prüfung.

Weitere Betriebs- und Recovery-Regeln stehen in `docs/BACKUP_RESTORE.md`, `docs/MIGRATION_RECOVERY.md`, `docs/STAGE_0B.md` und `docs/STAGE_0C.md`.

## Ergänzung für Stufe 1A

Stufe 1A ergänzt Migration `005_studio_tenancy_and_rbac`. Sie erstellt
`studios`, `studio_memberships`, `studio_invitations` und
`studio_audit_events`, verändert aber keine persönlichen Trainingsdatentabellen.
Vor der Migration müssen deshalb sowohl die fünf persönlichen Tabellen als auch
die noch nicht vorhandenen vier Studiotabellen im Preflight dokumentiert werden.

Der kontrollierte Produktionsablauf bleibt unverändert: aktuelles verifiziertes
Backup, Doctor, explizites Migrationsziel, genau ein Migrations-Owner, Migration,
Doctor/Status und ein zweiter No-op-Lauf. Nach 005 muss der Doctor zusätzlich alle
Studio-Spalten, Indizes, Foreign Keys und benannten Checks als sauber melden.

Zusätzliche Stage-1A-Smokes nach Freigabe:

- bestehender Benutzer kann sich anmelden und persönliche Workouts unverändert
  lesen;
- Benutzer ohne Studio erhält von `GET /api/v1/studios` eine leere Liste;
- Studioerstellung erzeugt atomar eine aktive Owner-Mitgliedschaft und ein
  Audit-Ereignis;
- ein fremder Benutzer erhält für die öffentliche Studio-ID denselben
  `STUDIO_NOT_FOUND`-Vertrag wie für eine unbekannte ID;
- der letzte aktive Owner kann nicht suspendiert, auf `left` gesetzt oder
  herabgestuft werden;
- Einladungstoken erscheinen weder in Runtime-Logs noch Audit-Datensätzen.

### Einladungsauslieferung

`INVITATION_ACCEPT_BASE_URL` muss die kanonische HTTPS-URL des Frontends sein,
beispielsweise `https://app.example.ch`. Development und Test dürfen den Link über
den einmaligen lokalen Delivery-Adapter an den aufrufenden Entwickler/Test
zurückgeben. Dieser Link ist ein Bearer Secret und darf nicht persistiert,
protokolliert oder in Tickets kopiert werden.

Der Standard-Produktionspfad enthält bewusst keinen improvisierten SMTP-Versand.
Ohne einen explizit verdrahteten, getesteten Provider verweigert die API die
Einladungserstellung mit `INVITATION_DELIVERY_UNAVAILABLE`, bevor eine Einladung
persistiert wird. Ein realer Provider mit sichtbarem Fehler-/Retry-Vertrag ist
damit zwingende Pilotvoraussetzung; das Setzen einer URL allein aktiviert keinen
Versand.

**Seit Stufe 2A** existiert dieser Provider konkret: ein validierter
SMTP-Adapter, aktivierbar über `INVITATION_EMAIL_PROVIDER=smtp` plus die
`SMTP_*`-Variablen (siehe `backend/.env.example` und „Ergänzung für Stufe 2A"
unten sowie `STAGE_2A_PRODUCTION_INVITATION_EMAIL.md`). Der oben beschriebene
Fail-Closed-Standard bleibt exakt so bestehen, solange dieser nicht explizit
aktiviert wird.

Statisches Frontend und Reverse Proxy müssen für alle SPA-Seiten einschließlich
`/invitations/:token` `Referrer-Policy: no-referrer`, TLS, keine URL-Query-Logs und
keine Analysewerkzeuge mit vollständigen Pfaden erzwingen. Nach erfolgreicher
Annahme ersetzt der Client die tokenhaltige Route.

### Datenschutzbetrieb

Normale Listen geben bei `left`-Mitgliedschaften keine vollständige Identität und
bei abgeschlossenen/widerrufenen/abgelaufenen Einladungen keine E-Mail mehr aus.
Vor einem Pilot müssen zusätzlich eine freigegebene Aufbewahrungsfrist (technische
Vorgabe: höchstens 90 Tage nach Abschluss/Widerruf/Ablauf), ein regelmäßig
überwachter Anonymisierungs- oder Löschjob und ein Prozess für ausgeschiedene
Mitglieder festgelegt werden. Audit-Ereignisse behalten nur minimale, token- und
trainingsdatenfreie Metadaten. Stufe 1A liefert keine vollständigen Rechtsdokumente.

### Zusätzliche Release-Checks

- [ ] Migration 005 auf leerer und bestehender Stage-0C-Datenbank grün
- [ ] persönliche Tabellen-Counts und Verknüpfungen vor/nach 005 unverändert
- [ ] negative Zwei-Studio-Isolationstests grün
- [ ] Rollen-, Last-Owner-, Einladungs-Replay- und Audit-Tests grün
- [ ] Chromium-/Axe-Studiofluss grün
- [ ] Produktions-Delivery-Provider vorhanden oder Einladungsfunktion bewusst
      als nicht pilotfähig blockiert
- [ ] Einladungs-/Left-Member-Retention und verantwortlicher Owner festgehalten

## Ergänzung für Stufe 1B.1

Stufe 1B.1 ergänzt Migration `006_coach_member_training`. Sie erstellt
`studio_coaching_relationships`, `studio_training_programs`,
`studio_training_program_versions`, `studio_training_program_days`,
`studio_training_program_exercises` und `studio_program_assignments`, verändert
aber weder die fünf persönlichen Trainingstabellen noch die vier Stage-1A-Tabellen.
Vor der Migration müssen deshalb sowohl die fünf persönlichen als auch die vier
Stage-1A-Tabellen als bereits vorhanden und die sechs neuen Tabellen als noch nicht
vorhanden im Preflight dokumentiert werden.

Der kontrollierte Produktionsablauf bleibt unverändert: aktuelles verifiziertes
Backup, Doctor, explizites Migrationsziel, genau ein Migrations-Owner, Migration,
Doctor/Status und ein zweiter No-op-Lauf. Nach 006 muss der Doctor zusätzlich alle
neuen Tabellen, Spalten, Indizes, Foreign Keys und benannten Checks als sauber
melden.

Zusätzliche Stage-1B.1-Smokes nach Freigabe:

- Owner/Admin können eine Coaching-Beziehung anlegen; ein Trainer kann keine
  eigene Beziehung anlegen (`INSUFFICIENT_STUDIO_ROLE`);
- ein Trainer sieht in der Liste ausschließlich eigene Coaching-Beziehungen;
- Beenden einer Coaching-Beziehung entzieht dem Trainer sofort den Zugriff auf die
  Zuweisungen des betroffenen Mitglieds;
- ein veröffentlichter Programm-Entwurf kann nicht mehr verändert werden
  (`PROGRAM_VERSION_NOT_DRAFT`), eine neue Entwurfsversion lässt die veröffentlichte
  Version unverändert;
- eine Zuweisung erfordert eine veröffentlichte Version und eine aktive
  Coaching-Beziehung zum Zielmitglied (`PROGRAM_VERSION_NOT_PUBLISHED` bzw.
  `COACHING_RELATIONSHIP_REQUIRED`);
- ein Mitglied sieht über `/program-assignments/me` ausschließlich eigene
  Zuweisungen;
- ein fremder Studio-Benutzer erhält für Coaching-/Programm-/Zuweisungs-IDs
  denselben Not-Found-Vertrag wie für eine unbekannte ID;
- persönliche Workouts/Fortschritt bleiben über die Stage-1B.1-API vollständig
  unsichtbar, auch für den zuständigen Coach.

### Zusätzliche Release-Checks

- [ ] Migration 006 auf leerer und bestehender Stage-1A-Datenbank grün
- [ ] persönliche Tabellen-Counts und Verknüpfungen vor/nach 006 unverändert
- [ ] Studio-Cascade-Delete-Test (kein Waisenrisiko über alle sechs neuen Tabellen)
      grün
- [ ] negative Zwei-Studio-Isolationstests für Coaching, Programme und Zuweisungen
      grün
- [ ] Konkurrenz-Test für gleichzeitiges Anlegen derselben aktiven
      Coaching-Beziehung grün
- [ ] Audit-Tests für alle zehn neuen Ereignistypen grün

## Ergänzung für Stufe 1B.2B1

Stufe 1B.2B1 ergänzt Migration `007_studio_workout_execution`. Sie erstellt
`studio_workout_sessions`, `studio_workout_session_exercises` und
`studio_workout_session_sets`, verändert aber weder die fünf persönlichen
Trainingstabellen noch eine der elf Stage-1A-/1B.1-Tabellen. Vor der Migration
müssen deshalb sowohl die fünf persönlichen als auch die elf bestehenden
Studio-Tabellen als bereits vorhanden und die drei neuen Tabellen als noch nicht
vorhanden im Preflight dokumentiert werden.

Der kontrollierte Produktionsablauf bleibt unverändert: aktuelles verifiziertes
Backup, Doctor, explizites Migrationsziel, genau ein Migrations-Owner, Migration,
Doctor/Status und ein zweiter No-op-Lauf. Nach 007 muss der Doctor zusätzlich alle
neuen Tabellen, Spalten, Indizes, Foreign Keys und benannten Checks als sauber
melden.

Abweichend von Stage 1B.1 sind auf `studio_workout_sessions` bewusst alle sechs
Foreign Keys außer `fk_session_exercises_source` als `ON DELETE CASCADE`
ausgelegt (statt teilweise `RESTRICT`), um die aus Stage 1B.1 bekannte
Reihenfolge-Abhängigkeit bei kaskadierendem Löschen eines Studios proaktiv zu
vermeiden. `fk_session_exercises_source` bleibt bewusst `ON DELETE SET NULL`, da
`source_program_exercise_id` nur zur Herkunftsangabe dient und der Snapshot beim
Löschen der Programm-Übung erhalten bleiben muss.

Zusätzliche Stage-1B.2B1-Smokes nach Freigabe:

- ein Mitglied kann aus einer aktiven, im Datumsfenster liegenden Zuweisung mit
  aktiver Coaching-Beziehung eine Workout-Session starten; der wiederholte Start
  mit demselben Idempotenzschlüssel und derselben Zuweisung liefert dieselbe
  Session zurück, ein Idempotenzschlüssel gegen eine andere Zuweisung liefert
  `WORKOUT_START_KEY_CONFLICT`;
- eine stornierte/abgeschlossene Zuweisung, eine noch nicht gestartete oder
  bereits beendete Zuweisung sowie eine beendete Coaching-Beziehung verhindern
  den Start (`WORKOUT_ASSIGNMENT_NOT_AVAILABLE`); ein Tag aus einer anderen
  Programmversion verhindert ihn ebenfalls (`WORKOUT_DAY_NOT_AVAILABLE`);
- das Veröffentlichen einer neuen Programmversion verändert eine bereits
  gestartete Session nicht (unveränderlicher Snapshot);
- ein Mitglied sieht ausschließlich eigene Sessions; ein Coach sieht die
  Sessions eines Mitglieds nur bei aktiver eigener Coaching-Beziehung — Owner
  und Admin haben dabei **keinen** Rollen-Bypass;
- das Beenden der Coaching-Beziehung oder das Suspendieren der eigenen
  Mitgliedschaft entzieht dem Coach sofort den Lesezugriff, ohne den
  Eigenzugriff des Mitglieds zu berühren;
- Satz-/Übungs-Aktualisierungen verlangen `expectedRevision`; ein veralteter
  Wert liefert `WORKOUT_SET_CONFLICT`/`WORKOUT_EXERCISE_CONFLICT`/
  `WORKOUT_SESSION_CONFLICT`, zwei gleichzeitige Aktualisierungen mit demselben
  erwarteten Stand lassen genau eine gewinnen;
- ein Satz kann nur mit mindestens einem plausiblen Ergebniswert als
  abgeschlossen markiert werden (`WORKOUT_RESULT_INVALID`);
- eine unvollständige Session kann nicht abgeschlossen werden
  (`WORKOUT_SESSION_INCOMPLETE`); eine abgeschlossene oder abgebrochene Session
  ist für jede weitere Mutation unveränderlich
  (`WORKOUT_SESSION_NOT_MUTABLE`/`WORKOUT_SESSION_ALREADY_TERMINAL`); ein Abbruch
  verwirft bereits erfasste Werte nicht;
- die Audit-Ereignisse `workout_session.started/completed/aborted` enthalten
  niemals Gewichte, Wiederholungen, RPE, Dauer, Distanz oder Notizen;
- persönliche Workouts/Fortschritt bleiben über die Stage-1B.2B1-API vollständig
  unsichtbar und werden durch keine Workout-Session-Operation beschrieben.

### Zusätzliche Release-Checks

- [ ] Migration 007 auf leerer und bestehender Stage-1B.1-Datenbank grün
- [ ] persönliche Tabellen-Counts und Verknüpfungen vor/nach 007 unverändert
- [ ] Studio-Cascade-Delete-Test (kein Waisenrisiko über alle drei neuen Tabellen,
      zusammen mit den bestehenden Stage-1A-/1B.1-Tabellen) grün
- [ ] negative Zwei-Studio- und Zwei-Coach-Isolationstests für Sessions grün
- [ ] Konkurrenz-Test für zwei gleichzeitige Satz-Updates mit derselben
      `expectedRevision` grün (genau ein Erfolg, eine Kollision)
- [ ] Audit-Tests für alle drei neuen Ereignistypen grün, keiner enthält
      Leistungsdaten
- [ ] Frontend liefert ausschließlich den API-Client aus; keine neue
      Session-/Set-Logger-UI, kein Coach-Dashboard für Ergebnisse
      *(Hinweis: dieser Punkt beschrieb den Stand unmittelbar nach Stufe
      1B.2B1; Stufe 1B.2B2A hat die Member-UI und Stufe 1B.2B2B das
      Coach-Ergebnis-Dashboard seither bewusst nachgeliefert, siehe unten.)*

## Ergänzung für Stufe 1B.2B2B

Stufe 1B.2B2B ergänzt Migration `008_studio_workout_session_feedback`. Sie
erstellt ausschließlich die Tabelle `studio_workout_session_feedback` und
verändert weder die drei Stage-1B.2B1-Tabellen noch eine der übrigen
bestehenden Studio- oder persönlichen Tabellen. Vor der Migration müssen
deshalb alle bisherigen Tabellen als bereits vorhanden und die neue Tabelle
als noch nicht vorhanden im Preflight dokumentiert werden.

Der kontrollierte Produktionsablauf bleibt unverändert: aktuelles
verifiziertes Backup, Doctor, explizites Migrationsziel, genau ein
Migrations-Owner, Migration, Doctor/Status und ein zweiter No-op-Lauf. Nach
008 muss der Doctor zusätzlich Tabelle, Spalten, Indizes, Foreign Keys und
den benannten Check der neuen Tabelle als sauber melden.

Alle Foreign Keys von `studio_workout_session_feedback` sind `ON DELETE
CASCADE` (Studio, Session, Beziehung, Coach-Mitgliedschaft), mit einer
bewussten Ausnahme: `fk_workout_session_feedback_author` (auf `users`) ist
`ON DELETE RESTRICT` — ein Autor-Benutzerdatensatz darf nicht verschwinden,
solange sein Feedback noch existiert (anders als bei den Stage-1B.2B1-
Tabellen, wo kein direkter Bezug zu `users` besteht).

Zusätzliche Stage-1B.2B2B-Smokes nach Freigabe:

- ein Coach mit aktiver, session-pinnender Beziehung kann auf einer
  `completed`/`aborted`-Session Feedback erstellen; auf einer `in_progress`-
  Session liefert derselbe Versuch `WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL`;
- wiederholtes Senden mit demselben `clientFeedbackKey` und identischem Text
  liefert denselben Datensatz zurück (kein Duplikat); derselbe Schlüssel mit
  abweichendem Text liefert `WORKOUT_FEEDBACK_KEY_CONFLICT`;
- Owner und Admin ohne eigene aktive Beziehung zum Mitglied erhalten
  identisch `WORKOUT_SESSION_NOT_FOUND` wie ein fremder Trainer — **kein**
  Rollen-Bypass für Feedback-Lesen oder -Erstellen;
- ein neuer Coach, der nach Ende einer früheren Beziehung erneut mit
  demselben Mitglied verknüpft wird, erhält **keinen** automatischen Zugriff
  auf Sessions oder Feedback aus der früheren Beziehung
  (`coaching_relationship_id`-Pinning);
- das Beenden der Coaching-Beziehung entzieht dem Coach sofort Lese- und
  Schreibzugriff auf Feedback, ohne bereits erhaltenes Feedback beim
  Mitglied zu löschen;
- das Audit-Ereignis `workout_feedback.created` enthält ausschließlich
  `feedbackId` und `sessionId`, niemals den Feedbacktext;
- der bestehende Footer wurde vollständig entfernt (kein `<footer>`-Element
  auf irgendeiner Route, kein horizontaler Overflow bei 1440/1024/768/390px).

### Zusätzliche Release-Checks

- [ ] Migration 008 auf leerer und bestehender Stage-1B.2B1-Datenbank grün
- [ ] Studio-Cascade-Delete-Test (kein Waisenrisiko für die neue Tabelle,
      zusammen mit allen bestehenden Tabellen) grün
- [ ] Idempotenz-/Konflikt-Test für `clientFeedbackKey` grün (inkl.
      `ER_DUP_ENTRY`-Race-Zweig)
- [ ] negative Tenant-/Beziehungs-Isolationstests für Feedback grün, inkl.
      Beziehungs-Pinning-Test (neue Beziehung erbt keinen Zugriff auf alte
      Session/altes Feedback)
- [ ] Audit-Test für `workout_feedback.created` grün, enthält nie den
      Feedbacktext
- [ ] Chromium-E2E `coachFeedback.spec.js` grün (Coach-Flow, Mitglieds-
      Ansicht, Zugriffsverweigerung, Footer-Entfernung, Axe-Smokes)
- [ ] Produktionsbuild und `npm audit --audit-level=high` in Backend und
      Frontend ohne Befunde

## Ergänzung für Stufe 2A

Stufe 2A liefert den ersten konkreten Produktions-E-Mail-Provider für die
Einladungsauslieferung (SMTP, siehe `STAGE_2A_PRODUCTION_INVITATION_EMAIL.md`).
Keine neue Migration, kein neues Datenbankschema, keine neue Einladungs-UI.

**Aktivierung ist strikt opt-in.** Ohne `INVITATION_EMAIL_PROVIDER=smtp`
bleibt das Verhalten exakt wie zuvor in diesem Dokument beschrieben
(Fail-Closed in Produktion, Preview-Link in Development/Test). Vor der
Aktivierung in einer echten Produktionsumgebung:

1. Alle `SMTP_*`-Variablen gemäß `backend/.env.example` setzen (Host, Port,
   `SMTP_SECURE`, ggf. Zugangsdaten, Absenderadresse/-name, optional
   Reply-To, drei Timeout-Grenzen).
2. Server starten. Eine explizit aktivierte, aber ungültige Konfiguration
   lässt den Prozess beim Start mit `INVALID_SMTP_CONFIG` fehlschlagen —
   das ist beabsichtigt (Fail-Closed, früh erkannt) und kein Bug.
3. Den in `STAGE_2A_PRODUCTION_INVITATION_EMAIL.md` dokumentierten manuellen
   SMTP-Smoke-Test mit einem echten, providerneutralen Testkonto
   durchführen, bevor Einladungen an echte Studios verschickt werden.
4. Bestätigen, dass `INVITATION_ACCEPT_BASE_URL` weiterhin die kanonische
   HTTPS-Frontend-URL ist — daran ändert sich durch den SMTP-Provider
   nichts.

TLS ist in jeder Umgebung ausnahmslos erzwungen (SMTPS oder STARTTLS,
Zertifikatsprüfung nie deaktiviert); es gibt keinen unverschlüsselten Modus,
den ein Operator versehentlich aktivieren könnte.

Zusätzliche Stage-2A-Smokes nach Freigabe:

- eine explizit aktivierte, aber unvollständige/ungültige SMTP-Konfiguration
  verhindert den Serverstart, bevor irgendein Request bedient wird;
- ein simulierter Zustellfehler kompensiert die betroffene Einladung
  atomar zu `revoked`; die Einladung ist danach nicht mehr akzeptierbar;
- Logs zu Versanderfolg/-fehlschlag enthalten `requestId`, `provider:
  "smtp"`, eine normalisierte Fehlerklasse und die Dauer — nie Passwort,
  Benutzername, Empfängeradresse, vollständige Akzeptanz-URL, Token oder
  SMTP-Rohantwort;
- das Audit enthält für `invitation.created`/`invitation.delivery_failed`
  unverändert nur `{role}`/`{role, expiresAt}` — kein neuer Ereignistyp,
  keine neuen Detailfelder;
- eine erfolgreiche Zustellung liefert dem Client `{delivered:true}` ohne
  `acceptUrl` und ohne Rohtoken.

### Zusätzliche Release-Checks

- [ ] `readSmtpConfig` lehnt jede unvollständige/ungültige/Platzhalter-
      Konfiguration ab, sobald `INVITATION_EMAIL_PROVIDER=smtp` gesetzt ist
- [ ] TLS ist in jedem Test-Szenario erzwungen (SMTPS oder STARTTLS mit
      `requireTLS:true`), `rejectUnauthorized` nie überschrieben
- [ ] Fake-SMTP-Provider-Integrationstests grün (Erfolg, Fehlschlag +
      Kompensation, Parallelität, keine internen IDs im Provider-Aufruf)
- [ ] Secrets/Token/Akzeptanz-URL/Empfängeradresse erscheinen in keinem
      geloggten Feld
- [ ] `backend/.env.example` enthält ausschließlich Platzhalter, keine
      echten Zugangsdaten
- [ ] vollständige bestehende E2E-Suite bleibt grün, insbesondere der
      bereits bestehende Dev-Preview-Einladungsfluss in `studios.spec.js`
- [ ] manueller SMTP-Smoke-Test durchgeführt und dokumentiert, bevor echte
      Einladungen an Studios verschickt werden

## Ergänzung für Stufe 2B1

Stufe 2B1 liefert verschlüsselte Datenbank-Backups mit verifiziertem
Restore-Drill (siehe `STAGE_2B1_ENCRYPTED_BACKUP_RESTORE.md` für das
vollständige Threat Model, Format und alle Guards). Keine neue Migration,
kein neues Anwendungsschema, kein Scheduler. Off-host-Speicherung ist seit
Stufe 2B2A als S3-kompatibler Upload/Download-Pfad vorhanden (siehe unten) —
bislang jedoch ausschließlich gegen eine lokale MinIO-Testinstanz verifiziert,
nicht gegen einen echten externen Bucket (das bleibt Stufe 2B2B).

**Release-Gate-Härtung (Folge-Commit):** Der alte, unverschlüsselte
Backup-Pfad (`db:backup`/`db:backup:daily`) ist seither in Produktion
ausnahmslos gesperrt und überall sonst standardmäßig ebenfalls gesperrt.
**In Produktion ist ausschließlich der verschlüsselte Pfad
(`db:backup:create/verify/restore/drill`) zulässig.** Restore erfordert
jetzt eine von `NODE_ENV` unabhängige, explizite Freigabe
(`BACKUP_RESTORE_ENABLED=true`) plus eine an den exakten Zielnamen
gebundene Bestätigung. Externe Prozesse (`mysqldump`/`mysql`/Docker-Hilfsoperationen) laufen jetzt mit strikten,
konfigurierbaren Timeouts inklusive garantierter Bereinigung des entfernten
Containerprozesses. Details siehe „Release-Gate-Härtung" ganz oben in
`STAGE_2B1_ENCRYPTED_BACKUP_RESTORE.md`.

**Neue Variablen, ausschließlich für `db:backup:create/verify/restore/drill`
bzw. den alten `db:backup`/`db:backup:daily`-Pfad — nie vom laufenden
Anwendungsserver gelesen:**

| Variable | Erforderlich | Bedeutung und Grenze |
| --- | --- | --- |
| `BACKUP_ENCRYPTION_KEY_B64` | ja, für Backup-Befehle | Base64, muss exakt 32 Byte ergeben; leer/Platzhalter werden abgelehnt; nie loggen, nie committen |
| `BACKUP_ENCRYPTION_KEY_ID` | ja, für Backup-Befehle | 1–64 Zeichen, nur Buchstaben/Ziffern/`_`/`-`; nie der Schlüssel selbst |
| `BACKUP_OUTPUT_DIRECTORY` | ja, für `db:backup:create` | Absoluter Pfad außerhalb des Repositorys |
| `BACKUP_DUMP_TIMEOUT_MS` | nein | Grenzen 5s–1h, Standard 5 min; Dump-Prozess wird bei Überschreitung beendet |
| `BACKUP_RESTORE_TIMEOUT_MS` | nein | Grenzen 5s–1h, Standard 10 min; Restore-Import wird bei Überschreitung beendet |
| `BACKUP_DOCKER_OPERATION_TIMEOUT_MS` | nein | Grenzen 1s–2min, Standard 15s; genereller Docker-Hilfsprozess (u. a. entfernter Kill-Vorgang) |
| `BACKUP_RESTORE_ENABLED` | ja, für Restore | Muss exakt `true` sein — **einziger** Autorisierungsschalter, `NODE_ENV` genügt nie allein |
| `FITTRACK_RESTORE_TARGET_DATABASE` | ja, für Restore | Muss dem Wegwerfmuster entsprechen und sich von der Quelldatenbank unterscheiden |
| `FITTRACK_RESTORE_ACK` | ja, für Restore | Muss exakt `restore:<FITTRACK_RESTORE_TARGET_DATABASE>` sein — an den Zielnamen gebunden |
| `FITTRACK_RESTORE_ALLOW_RECREATE` | nein | Nur exakt `recreate-disposable-restore-target` erlaubt das Neuerstellen einer bereits existierenden Zieldatenbank |
| `ALLOW_LEGACY_UNENCRYPTED_BACKUP` | nein | Nur exakt `true`; wirkt nie in Produktion (dort immer gesperrt); erlaubt den alten Klartext-Pfad nur für historische Regressionstests/lokale Läufe |

Vor Produktionseinsatz zusätzlich erforderlich (siehe „Verbleibende Grenzen"
in `STAGE_2B1_ENCRYPTED_BACKUP_RESTORE.md`): Off-host-Speicherung, ein
Scheduler für `db:backup:create`, ein dokumentierter Key-Lebenszyklus im
Secret Store der Zielplattform sowie eine DB-Rollentrennung zwischen
Dump-/Restore-Benutzer — keiner dieser Punkte ist Teil dieser Phase.

### Zusätzliche Release-Checks

- [ ] `readBackupCryptoConfig` lehnt fehlenden/leeren/ungültigen/zu kurzen/
      zu langen Schlüssel sowie bekannte Platzhalter ab
- [ ] AES-256-GCM-Authentifizierung erkennt jede Manipulation an Header,
      Ciphertext oder Tag (automatisiert mit Bitflip-/Truncation-Tests)
- [ ] der alte, unverschlüsselte Backup-Pfad ist in Produktion ausnahmslos
      gesperrt (kein Override) und überall sonst ohne
      `ALLOW_LEGACY_UNENCRYPTED_BACKUP=true` ebenfalls gesperrt, jeweils
      bevor irgendeine Datei angelegt wird
- [ ] Restore verlangt zwingend `BACKUP_RESTORE_ENABLED=true` (unabhängig von
      `NODE_ENV`), Loopback-Host, eine an den exakten Zielnamen gebundene
      Bestätigung, explizites Wegwerf-Ziel ungleich Quelle/Systemdatenbank
- [ ] eine bereits existierende Zieldatenbank wird ohne explizite
      Recreate-Bestätigung abgelehnt, nie stillschweigend überschrieben
- [ ] kein Klartext-SQL-Dump entsteht zu irgendeinem Zeitpunkt auf Disk
      (weder bei Create noch bei Verify noch bei Restore) — automatisiert
      direkt bewiesen (Live-Dateisystemüberwachung plus statische
      Quelltext-Prüfung), nicht nur indirekt geschlussfolgert
- [ ] ein manipuliertes oder mit falschem Schlüssel verschlüsseltes Backup
      führt nie zu einem tatsächlichen `mysql`-Import und legt die
      Zieldatenbank nie an (Verify-vor-Trust, zweiphasiger Restore)
- [ ] hängende oder Signale ignorierende `mysqldump`/`mysql`/Docker-Prozesse
      werden zuverlässig beendet — sowohl der lokale Client als auch der im
      Container laufende entfernte Prozess (empirisch gegen echte Prozesse
      getestet, nicht nur simuliert)
- [ ] realer Restore-Drill gegen die lokale MySQL-Instanz grün: Backup
      erstellt, verifiziert, in eine disposable Datenbank restauriert,
      Migration Doctor `ready`/`applied:8`, Tabellen- und
      Zeilenzahlvergleich stimmt, Zieldatenbank und Backup-Testartefakt
      danach vollständig entfernt
- [ ] `.env.example` enthält ausschließlich abgelehnte Platzhalter für alle
      Backup-/Restore-/Timeout-Variablen, keine echten Schlüssel

## Ergänzung für Stufe 2B2A

Stufe 2B2A liefert einen providerneutralen, S3-kompatiblen Off-host-Speicher
für bereits verschlüsselte `.ftbackup`-Dateien (siehe
`STAGE_2B2A_S3_OFFHOST_BACKUPS.md` für Threat Model, Objektpfad und alle
Guards). **Bislang ausschließlich gegen eine lokale MinIO-Testinstanz mit
synthetischen Zugangsdaten verifiziert — kein echter externer Cloud-Bucket
wurde eingerichtet oder verbunden.** Keine neue Migration, kein neues
Anwendungsschema, kein echter Scheduler, keine Key-Rotation.

**Release-Gate-Härtung (Folge-Commit):** Der Upload verwendet seither einen
einzelnen, atomar-bedingten `PutObjectCommand` (`IfNoneMatch: "*"`) statt
einer `HeadObject`-Vorabprüfung — empirisch gegen echtes MinIO bewiesen,
inklusive zweier echt gleichzeitiger Uploads auf denselben Schlüssel.
`@aws-sdk/lib-storage` wurde entfernt, das Upload-Limit auf 2 GiB gesenkt
(ausschließlich Single-`PutObject`, kein Multipart mehr). Details siehe
„Release-Gate-Härtung" ganz oben in `STAGE_2B2A_S3_OFFHOST_BACKUPS.md`.

**Neue Variablen, ausschließlich für `db:backup:remote:*` — nie vom
laufenden Anwendungsserver gelesen:**

| Variable | Erforderlich | Bedeutung und Grenze |
| --- | --- | --- |
| `BACKUP_REMOTE_ENABLED` | ja, für alle Remote-Befehle | Muss exakt `true` sein — einziger Aktivierungsschalter |
| `BACKUP_REMOTE_PROVIDER` | ja | Nur `s3` unterstützt |
| `BACKUP_S3_ENDPOINT` | ja | HTTPS in Produktion zwingend, HTTP nur für expliziten Loopback-Endpoint außerhalb Produktion |
| `BACKUP_S3_REGION` | ja | 1–32 Zeichen, Kleinbuchstaben/Ziffern/Bindestrich |
| `BACKUP_S3_BUCKET` | ja | Striktes S3-Namensschema, bekannte Platzhalter abgelehnt |
| `BACKUP_S3_PREFIX` | ja | Normalisierter Segmentpfad, kein `..`, kein Backslash |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | ja, zusammen | Nie `AWS_ACCESS_KEY_ID`-Fallback, nie einzeln gesetzt |
| `BACKUP_S3_SESSION_TOKEN` | nein | Nur bei temporären/STS-Zugangsdaten |
| `BACKUP_S3_FORCE_PATH_STYLE` | nein | Strikt `true`/`false`, Standard `false` |
| `BACKUP_S3_UPLOAD_TIMEOUT_MS` / `BACKUP_S3_DOWNLOAD_TIMEOUT_MS` | nein | Je 5s–1h, Standard 10 min |
| `BACKUP_S3_OPERATION_TIMEOUT_MS` | nein | 1s–2min, Standard 15s (Preflight/Head/List/Delete) |
| `BACKUP_S3_REQUIRE_VERSIONING` / `BACKUP_S3_REQUIRE_OBJECT_LOCK` | nein | Bei `true` fail-closed, falls Provider es nicht bestätigt |
| `BACKUP_S3_SERVER_SIDE_ENCRYPTION` | nein | `none`/`AES256`/`aws:kms`, ergänzt Stufe-2B1-Verschlüsselung, ersetzt sie nie |
| `BACKUP_S3_KMS_KEY_ID` | nur bei `aws:kms` | KMS-Schlüssel-ID, darf geloggt werden |
| `BACKUP_REMOTE_RETENTION_APPLY` | nein | Muss exakt `true` sein, um überhaupt löschen zu dürfen |
| `FITTRACK_REMOTE_RETENTION_BUCKET_ACK` / `..._PREFIX_ACK` | ja, für Retention-Apply | Müssen exakt Bucket/Prefix entsprechen |
| `FITTRACK_REMOTE_RETENTION_MAX_DELETE` | ja, für Retention-Apply | Harte Obergrenze; überschreitet der Plan sie, wird nichts gelöscht |

Vor Produktionseinsatz zusätzlich erforderlich (siehe „Verbleibende Grenzen"
in `STAGE_2B2A_S3_OFFHOST_BACKUPS.md`): ein echter, von Stufe 2B2B
eingerichteter und verifizierter Cloud-Bucket, ein Scheduler für
`db:backup:remote:upload`, ein dokumentierter Zugangsdaten-Lebenszyklus
sowie permanentes Versions-Purging bei aktivem Bucket-Versioning — keiner
dieser Punkte ist Teil dieser Phase.

### Zusätzliche Release-Checks

- [ ] `readBackupRemoteConfig` lehnt fehlende/ungültige/Platzhalter-Werte für
      Endpoint, Region, Bucket, Prefix und Credentials ab, ohne je auf
      `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` zurückzufallen
- [ ] Upload verlangt zwingend vollständige, erfolgreiche Stufe-2B1-Verifikation
      der lokalen Datei, bevor irgendein Netzwerkzugriff erfolgt
- [ ] ein bereits existierendes Remote-Objekt wird nie überschrieben — ein
      atomar-bedingter `PutObject` (`IfNoneMatch: "*"`) garantiert das auch
      bei zwei echt gleichzeitigen Upload-Versuchen auf denselben Schlüssel
      (`REMOTE_OBJECT_ALREADY_EXISTS`), empirisch gegen echtes MinIO bewiesen
- [ ] Download/Verify prüfen `ciphertext-sha256` gegen die tatsächlich
      empfangenen Bytes und führen danach die volle Stufe-2B1-GCM-Authentifizierung
      aus, bevor eine lokale Datei als vertrauenswürdig gilt
- [ ] ein manipuliertes Remote-Objekt (auch mit passend neu berechnetem Hash)
      scheitert zuverlässig an der GCM-Authentifizierung
- [ ] unerkannte Objekte im Prefix werden nie automatisch gelöscht (weder von
      der Inventarliste noch von der Retention-Planung/-Anwendung)
- [ ] Retention-Apply verlangt alle drei expliziten Bestätigungen
      (Enable-Flag, Bucket-Ack, Prefix-Ack) plus eine harte
      Maximal-Löschanzahl
- [ ] echte Upload-/Download-Timeouts greifen zuverlässig gegen einen real
      nie antwortenden Endpunkt und brechen den HTTP-Request sauber ab
      (Single-`PutObject`, kein Multipart, kein `@aws-sdk/lib-storage` mehr)
- [ ] eine lokale Datei über dem 2-GiB-Limit wird mit `REMOTE_BACKUP_TOO_LARGE`
      abgelehnt, bevor irgendein Netzwerkzugriff erfolgt
- [ ] realer Remote-Restore-Drill gegen lokale MinIO- und MySQL-Instanzen
      grün: Backup erstellt, hochgeladen, heruntergeladen, vollständig
      verifiziert, in eine disposable Datenbank restauriert, Migration Doctor
      `ready`, Tabellen-/Zeilenzahlvergleich stimmt, lokale und Remote-Artefakte
      danach vollständig entfernt — ein Cleanup-Fehler darf dabei nie als
      Erfolg gemeldet werden
- [ ] `.env.example` enthält ausschließlich abgelehnte Platzhalter für alle
      neuen S3-/Retention-Variablen, keine echten Zugangsdaten
