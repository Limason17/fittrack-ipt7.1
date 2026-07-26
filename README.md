# FitTrack

FitTrack ist eine mehrsprachige Web-Applikation, mit der Nutzer Übungen verwalten, Workouts planen und ihren Trainingsfortschritt verfolgen können. Das Repository enthält ein Vue-Frontend, eine Express-API und eine MySQL-Datenbank mit versionierten Migrationen.

## Funktionen

- Account erstellen und mit JWT anmelden
- Deutsch/Englisch sowie kg/lb und km/mi pro Nutzer speichern
- Globale und eigene Übungen anzeigen, filtern und verwalten
- Workouts mit Kraft- und Cardio-Werten speichern, bearbeiten und löschen
- Workouts im Kalender anzeigen
- Manuellen und automatisch aus Workouts abgeleiteten Fortschritt verfolgen
- Historische Übungsdaten in Workouts und Fortschritt unverändert erhalten

## Architektur

- `frontend`: Vue 3, Vue Router, Vite und Vitest
- `backend`: Node.js, Express, MySQL2 und der integrierte Node-Test-Runner
- `database/migrations`: additive, versionierte Forward-Migrationen
- `docker-compose.yml`: lokale MySQL-8-Instanz; kein Produktions-Deployment
- `.github/workflows/ci.yml`: reproduzierbare Backend-, DB-, Frontend- und Audit-Gates

Die API lauscht erst, wenn die Datenbank erreichbar ist, alle Migrationen angewendet sind und der Migrationsstatus sauber ist.

## Voraussetzungen

- Node.js `22.17.0` aus `.nvmrc`
- npm `10.9.2` oder eine kompatible npm-10-Version
- Docker mit Compose v2 oder eine lokale MySQL-8-Installation

Mit nvm:

```sh
nvm install 22.17.0
nvm use 22.17.0
node --version
npm --version
```

Erwartet werden `v22.17.0` und npm `10.9.2`. Die Pakete akzeptieren zusätzlich die in ihren `engines`-Feldern genannten kompatiblen Node-Versionen; CI und Abgabe sind jedoch auf 22.17.0 festgelegt.

## Lokal starten

1. Beispielkonfigurationen kopieren:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

2. Lokale MySQL-Instanz starten:

```sh
docker compose up -d mysql
```

3. Backend reproduzierbar installieren, Datenbank sicher initialisieren und starten:

```sh
cd backend
npm ci
npm run db:dev:init
npm run dev
```

`db:dev:init` erstellt die in `DB_NAME` konfigurierte Datenbank nur, wenn sie fehlt, und wendet danach die versionierten Migrationen an. Der Befehl ist in `NODE_ENV=production` gesperrt und löscht keine Datenbank.

4. In einem zweiten Terminal das Frontend starten:

```sh
cd frontend
npm ci
npm run dev
```

Das Frontend verwendet standardmäßig `/api`. Der Vite-Entwicklungsserver leitet diesen Pfad über `API_PROXY_TARGET` an `http://localhost:3001` weiter.

## Umgebungsvariablen

Backend, minimale lokale Konfiguration:

```env
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=fittrack
DB_PORT=3306
JWT_SECRET=replace-with-a-local-secret-of-at-least-16-characters
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

Frontend:

```env
VITE_API_BASE_URL=/api
API_PROXY_TARGET=http://localhost:3001
```

In Produktion müssen `JWT_SECRET` und `RATE_LIMIT_KEY_SECRET` eindeutig, voneinander verschieden und mindestens 32 Zeichen lang sein. `CORS_ALLOWED_ORIGINS` akzeptiert eine kommaseparierte Liste vollständiger HTTP(S)-Origins ohne Pfad; Produktion verlangt zusätzlich HTTPS und verbietet localhost/127.\*/::1. Alle Variablen und Grenzen sind in `docs/DEPLOYMENT.md` beschrieben.

## Datenbankbefehle und Sicherheit

| Befehl im Ordner `backend` | Wirkung | Sicherheitsstufe |
| --- | --- | --- |
| `npm run db:migrate:status` | Liest Ledger und Registry; Exit 1 bei pending, dirty, drift oder unknown | read-only |
| `npm run db:migrate` | Wendet ausstehende Forward-Migrationen unter MySQL-Lock an | verändert Schema/Daten; vorher Backup |
| `npm run db:dev:init` | Erstellt eine fehlende Entwicklungs-DB und migriert sie | additiv, in Produktion gesperrt |
| `npm run db:test:reset` | Drop, Neuerstellung und Migration exakt der konfigurierten Test-DB | **destruktiv**, dreifach geschützt |

`db:test:reset` läuft nur mit `NODE_ENV=test`, `ALLOW_TEST_DB_RESET=true` und einem `DB_NAME`, der ein separates `test`-Segment enthält.

> **Destruktiv:** `database/schema.sql` droppt Tabellen und ist nur ein Legacy-Artefakt für eine ausdrücklich gewünschte lokale Neuinitialisierung. Es ist kein Produktions-Migrationsweg. Auch `docker compose down -v` löscht das lokale MySQL-Volume vollständig.

## Tests und Qualitätsgates

Backend, mit laufendem MySQL 8:

```sh
cd backend
npm test
npm run test:coverage
npm run audit:security
```

Weitere gezielte Befehle:

| Befehl | Abdeckung |
| --- | --- |
| `npm run test:unit` | Konfiguration, Auth, Validierung, Fehlerformat, Rate Limit, Logger, Metriken und Startup-Health |
| `npm run test:integration` | Reale API- und DB-Flows mit zwei Nutzern und Isolation |
| `npm run test:migrations` | Registry-/Planungstests sowie reale Empty-/Legacy-/No-op-Szenarien in Wegwerf-DBs |
| `npm run test:syntax` | Syntax aller Backend-JavaScript-Dateien |
| `npm run test:coverage` | Coverage für die DB-unabhängige Kernlogik |

Die realen Migrationstests laufen standardmäßig und benötigen MySQL 8. Nur für einen bewusst DB-losen Teilcheck können sie übersprungen werden:

```powershell
$env:FITTRACK_RUN_DB_INTEGRATION = 'false'
npm run test:migrations
Remove-Item Env:FITTRACK_RUN_DB_INTEGRATION
```

Der übersprungene Lauf enthält weiterhin die Migrations-Planungstests, ist aber kein vollständiges Gate. Der Standardlauf erzeugt ausschließlich zufällige Datenbanken mit dem Präfix `fittrack_migration_test_`, prüft leere und unterstützte Legacy-Schemas sowie einen zweiten No-op-Lauf und löscht die Datenbanken anschließend.

Frontend:

```sh
cd frontend
npm run test:run
npm run build
npm audit --audit-level=high
```

## Health-Endpunkte

- `GET /api/health/live`: Prozess-Liveness, immer DB-unabhängig
- `GET /api/health/ready`: Readiness inklusive DB-Ping und sauberem Migrationsstatus
- `GET /api/health`: kompatibler Alias für Readiness

Readiness liefert bei einem Problem HTTP 503 und einen stabilen `reason`; erst HTTP 200 darf für Traffic-Freigabe verwendet werden.

## CI und Deployment

GitHub Actions führt bei Pull Requests und Pushes auf `main` mit Node 22.17.0 aus:

- reproduzierbares `npm ci` in Backend und Frontend;
- Security-Audits mit Fehler-Gate ab Schweregrad `high`;
- Backend-Suite gegen MySQL 8 einschließlich Zwei-Nutzer-Isolation, Empty-/Legacy-Migrationen und No-op;
- Coverage- und Syntaxprüfung;
- Frontend-Tests und Produktionsbuild.

Der Produktionsablauf, die Migrationsregeln, Healthchecks und Rollback-Grenzen stehen in `docs/DEPLOYMENT.md`. Der genaue Umfang und die bekannten Grenzen von Stufe 0A stehen in `docs/STAGE_0A.md`.

## Projekt

FitTrack wurde im Rahmen von IPT 7.1 von Liam Bruno, Fabio Erculiani und Noël Wenger erstellt.
