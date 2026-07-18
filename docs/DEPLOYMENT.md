# FitTrack Deployment

Diese Anleitung beschreibt den Betriebsvertrag von Stufe 0A. `docker-compose.yml` stellt nur eine lokale MySQL-Instanz bereit und ist keine Produktionsarchitektur.

## Festgelegte Toolchain

- Node.js: `22.17.0` aus `.nvmrc`
- npm: `10.9.2` beziehungsweise kompatibles npm 10
- Datenbank: MySQL 8.0
- Reproduzierbare Installation: `npm ci`, nicht `npm install`

CI verwendet Node 22.17.0 und MySQL 8.0. Vor einem Release müssen beide CI-Jobs grün sein.

## Backend-Umgebung

Produktionswerte gehören in den Secret Store der Zielplattform und nicht in Git, Images oder Build-Logs.

| Variable | Erforderlich | Bedeutung und Grenze |
| --- | --- | --- |
| `NODE_ENV` | ja | In Produktion exakt `production` |
| `PORT` | nein | API-Port, Standard 3001, gültig 1–65535 |
| `DB_HOST` | ja | Hostname der MySQL-8-Instanz |
| `DB_USER` | ja | Datenbanknutzer; beim aktuellen Auto-Migrate-Startup mit DDL-Rechten |
| `DB_PASSWORD` | ja | Eindeutiges Produktionssecret; niemals das lokale `root`-Beispiel |
| `DB_NAME` | ja | Zieldatenbank; nur Buchstaben, Ziffern, `_`, `$` und `-` |
| `DB_PORT` | ja | MySQL-Port, üblicherweise 3306 |
| `DB_CONNECT_TIMEOUT_MS` | nein | 100–120000, Standard 10000 |
| `DB_CONNECTION_LIMIT` | nein | Poolgröße 1–100, Standard 10 |
| `DB_QUEUE_LIMIT` | nein | Warteschlangenlimit 0–100000, Standard 100; 0 = unbegrenzt |
| `JWT_SECRET` | ja | Eindeutig, mindestens 32 Zeichen; bekannte Platzhalter werden abgelehnt |
| `CORS_ORIGIN` | ja | Kommaseparierte HTTP(S)-Origins ohne Pfad, zum Beispiel `https://app.example.ch` |

Beispiel ohne echte Secrets:

```env
NODE_ENV=production
PORT=3001
DB_HOST=mysql.internal
DB_USER=fittrack_app
DB_PASSWORD=<secret-store-reference>
DB_NAME=fittrack
DB_PORT=3306
DB_CONNECT_TIMEOUT_MS=10000
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=100
JWT_SECRET=<unique-random-secret-at-least-32-characters>
CORS_ORIGIN=https://app.example.ch
```

Das aktuelle Backend wendet Migrationen beim Start an. Der Produktionsnutzer benötigt deshalb neben Laufzeitrechten auch die von den Migrationen verwendeten DDL-Rechte. Die Trennung in einen privilegierten Migrationsnutzer und einen eingeschränkten Runtime-Nutzer ist noch nicht umgesetzt.

## Frontend-Umgebung

| Variable | Zeitpunkt | Bedeutung |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Build | Standard `/api`; alternativ vollständige öffentliche HTTPS-API-URL |
| `API_PROXY_TARGET` | Entwicklung | Ziel des lokalen Vite-Proxys, Standard `http://localhost:3001` |

`VITE_API_BASE_URL` wird in das statische Bundle kompiliert. Produktion akzeptiert nur einen root-relativen Pfad ohne Query/Fragment oder eine absolute HTTPS-URL ohne eingebettete Zugangsdaten. Localhost-, Loopback-, Klartext-HTTP- und ungültige Ziele brechen den Build ab. Bei `/api` muss der Reverse Proxy diesen Pfad an das Backend weiterleiten.

## Versionierte Migrationen

Die aktive Registry liegt in `database/migrations`:

1. `001_initial_schema`: nichtdestruktives Basisschema
2. `002_legacy_schema_upgrade`: unterstützte unversionierte FitTrack-Schemas additiv aktualisieren
3. `003_seed_global_exercises`: globale Übungen idempotent einfügen
4. `004_training_history_consistency`: Workout-Fortschritt verknüpfen und historische Übungs-Snapshots sichern

Der Runner verwendet:

- das Ledger `schema_migrations`;
- SHA-256-Prüfsummen gegen nachträglich veränderte Migrationen;
- Zustände für angewendet und fehlgeschlagen;
- einen MySQL Advisory Lock gegen parallele Migrationen;
- einen zweiten Lauf als No-op.

Bereits veröffentlichte Migrationsdateien dürfen nicht umgeschrieben werden. Änderungen erfolgen immer in einer neuen, aufsteigend nummerierten Datei.

### Befehle

Im Ordner `backend`:

```sh
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:status
```

`db:migrate:status` ist read-only und beendet sich mit Exit 1, solange Migrationen ausstehen oder das Ledger `dirty`, `drift` beziehungsweise unbekannte Einträge enthält. Ein Exit 1 vor der ersten Migration kann daher erwartetes `pending` bedeuten; nach dem Migrationsschritt muss der Befehl erfolgreich sein.

`db:migrate` verändert Schema und gegebenenfalls Bestandsdaten. Vor jeder Produktionsmigration sind ein aktuelles Backup, ein geprüfter Restore-Weg und ein Wartungs-/Rollback-Entscheid erforderlich.

Bei `dirty`, Checksum-Drift, unbekannten Ledger-Einträgen oder einer fehlgeschlagenen Legacy-Datenprüfung:

1. Deployment stoppen.
2. Datenbank und strukturierte Fehlerlogs sichern.
3. Ledger nicht manuell umschreiben.
4. Ursache und Datenbestand prüfen.
5. Korrektur als neue Migration oder Restore ausführen.

Es gibt keine automatischen Down-Migrationen. Ein Anwendungs-Rollback ist nur zulässig, wenn das neue Schema rückwärtskompatibel ist; andernfalls ist der getestete Datenbank-Restore der Rückweg.

## Deutlich destruktive Befehle

### Testdatenbank zurücksetzen

`npm run db:test:reset` droppt und erstellt exakt `DB_NAME` neu. Der Befehl verweigert die Ausführung, wenn nicht alle drei Bedingungen erfüllt sind:

- `NODE_ENV=test`
- `ALLOW_TEST_DB_RESET=true`
- `DB_NAME` enthält ein getrenntes `test`-Segment

Beispiel für eine ausschließlich lokale Wegwerf-Datenbank:

```powershell
$env:NODE_ENV = 'test'
$env:ALLOW_TEST_DB_RESET = 'true'
$env:DB_NAME = 'fittrack_test_local'
npm run db:test:reset
```

Diese Sperren reduzieren Fehlbedienung, ersetzen aber keine Prüfung des tatsächlichen Hosts und Datenbanknamens.

### Legacy-SQL und Docker-Volume

> **Nicht in Produktion ausführen:** `database/schema.sql` enthält `DROP TABLE`. Die Datei ist kein Teil des aktiven Migrationssystems.

> **Löscht alle lokalen MySQL-Daten:** `docker compose down -v` entfernt das Volume `mysql_data`. Für einen normalen Neustart genügt `docker compose down` ohne `-v` oder `docker compose up -d mysql`.

Die Legacy-SQL-Dateien werden in `docker-compose.yml` bewusst nicht in den MySQL-Initialisierungsordner gemountet. Ein neues Volume erhält nur die leere, über `MYSQL_DATABASE` benannte Datenbank; Tabellen und Seeds entstehen anschließend ausschließlich über `npm run db:dev:init` und die versionierten Migrationen.

## Lokale und Test-Datenbanken

`npm run db:dev:init` ist der sichere lokale Initialisierungsweg:

- in `NODE_ENV=production` gesperrt;
- erstellt ausschließlich die konfigurierte, fehlende Datenbank;
- droppt keine Datenbank;
- wendet danach alle Migrationen an.

Die API-Integrationstests erzeugen pro Prozess eine zufällige Datenbank `fittrack_api_test_<...>`, registrieren zwei Nutzer, prüfen unter anderem Datenisolation und löschen die Datenbank im Cleanup.

Die realen Migrationstests laufen standardmäßig und benötigen MySQL 8:

```powershell
npm run test:migrations
```

Sie verwenden nur Namen nach `fittrack_migration_test_<hex>` und prüfen:

- Migration einer leeren Datenbank;
- additive Migration eines unterstützten Legacy-Schemas bei Erhalt und Verknüpfung der Daten;
- vollständiges Ledger und Prüfsummen;
- zweiten Lauf ohne Änderungen;
- automatisches Löschen der Wegwerf-Datenbanken.

`FITTRACK_RUN_DB_INTEGRATION=false` überspringt die realen Datenbankszenarien und lässt nur die Planungschecks laufen. Das ist ein lokaler Teilcheck und kein vollständiges Release-Gate. CI setzt den Wert ausdrücklich auf `true`.

## Produktionsablauf

1. CI für den exakten Commit vollständig grün abwarten.
2. Release-Artefakt und Commit-SHA festhalten.
3. Datenbankbackup erstellen und Restore-Verfügbarkeit prüfen.
4. Umgebungsvariablen und Secret-Referenzen validieren.
5. Backend-Abhängigkeiten reproduzierbar installieren:

```sh
cd backend
npm ci --omit=dev
npm run db:migrate
npm run db:migrate:status
npm start
```

Der Server prüft DB-Verbindung, migriert, kontrolliert den Status und lauscht erst danach. Bei DB- oder Migrationsfehler beendet sich der Start mit Fehler.

6. Frontend bauen:

```sh
cd frontend
npm ci
VITE_API_BASE_URL=/api npm run build
```

7. `frontend/dist` unverändert über einen statischen Hoster ausliefern.
8. SPA-Fallback konfigurieren: unbekannte Frontend-Routen müssen `index.html` liefern.
9. `/api` an das Backend routen; TLS am Reverse Proxy oder der Plattform terminieren.
10. Readiness erst nach erfolgreicher Prüfung für Traffic freigeben.

Der gezeigte Inline-Environment-Befehl ist POSIX-Syntax. In PowerShell wird die Variable vor dem Build über `$env:VITE_API_BASE_URL = '/api'` gesetzt.

## Health und Prozesssteuerung

| Endpunkt | Erfolg | Zweck |
| --- | --- | --- |
| `/api/health/live` | 200 `{ "status": "live" }` | Prozess lebt; keine DB-Prüfung |
| `/api/health/ready` | 200 ready, sonst 503 | DB-Ping, Lifecycle und sauberer Migrationsstatus |
| `/api/health` | wie `/ready` | Rückwärtskompatibler Readiness-Alias |

Empfohlene Zuordnung:

- Liveness-Probe: `/api/health/live`
- Readiness-/Load-Balancer-Probe: `/api/health/ready`

`SIGTERM` und `SIGINT` markieren die Instanz nicht bereit, schließen den HTTP-Server und danach den DB-Pool. Die Plattform muss genügend Grace-Period für diesen Ablauf gewähren.

## CI-Gates

`.github/workflows/ci.yml` läuft auf Pull Requests, Pushes nach `main` und manuell.

Backend-Job:

- Node 22.17.0 und MySQL 8 Service mit Healthcheck;
- `npm ci`;
- `npm run audit:security`, Exit-Gate ab `high`;
- streng geschützter Reset einer CI-Testdatenbank;
- Migration und anschließender Status/No-op;
- vollständiges `npm test` mit Unit-, API-, Migrations- und Syntaxchecks;
- reale Empty-/Legacy-/No-op-Migrationstests;
- `npm run test:coverage`.

Frontend-Job:

- `npm ci`;
- `npm audit --audit-level=high`;
- `npm run test:run`;
- Produktionsbuild mit `/api`.

CI-Zugangsdaten wie `root/root` existieren ausschließlich im isolierten, kurzlebigen MySQL-Service des Runners und sind keine Produktionswerte.

## Release-Checkliste

- [ ] CI für den Release-Commit grün
- [ ] Keine Security-Befunde ab `high`
- [ ] Backup erstellt und Restore-Weg bestätigt
- [ ] `JWT_SECRET`, DB-Secrets und CORS-Origin geprüft
- [ ] Migration erfolgreich und Status sauber
- [ ] Backend-Readiness liefert 200
- [ ] Registrierung und Login manuell geprüft
- [ ] Zwei Nutzer sehen keine gegenseitigen Workouts oder Fortschritte
- [ ] Workout-Erstellen/-Ändern/-Löschen und abgeleiteter Fortschritt geprüft
- [ ] Frontend-Deep-Link direkt im Browser geladen
- [ ] Browser-Konsole und strukturierte Backend-Logs ohne neue Fehler
- [ ] Rollback-Entscheid und verantwortliche Person festgehalten

## Grenzen von Stufe 0A

- Keine automatisierten echten Browser-E2E-Tests.
- Keine Last-, Failover-, Replikations- oder Restore-Automation.
- Keine Down-Migrationen und kein automatischer Datenbank-Rollback.
- Keine produktionsfertigen Container, Infrastrukturdefinition oder Deployment-Automation.
- Readiness prüft API, MySQL und Migrationen, aber nicht Frontend, Reverse Proxy oder externe Plattformdienste.
- Der Rate Limiter ist pro Prozess; mehrere Instanzen teilen keinen zentralen Zähler.
- Coverage wird erzeugt, aber noch nicht durch einen Mindestprozentsatz gegatet.
- Ein grüner Dependency-Audit ersetzt weder Penetrationstest noch manuelle Security-Prüfung.

Weitere Abnahmekriterien stehen in `docs/STAGE_0A.md`.
