# FitTrack Stufe 0C – Remote-CI, Backup-Automatisierung und Migrationssicherheit

Stand nach dem erfolgreichen Stage-0C-Remote-Lauf: 18. Juli 2026. Dieses Dokument ist der kanonische technische Nachweis für Stufe 0C. Deploymentdetails stehen in [DEPLOYMENT.md](DEPLOYMENT.md), Backup-/Restore-Betrieb in [BACKUP_RESTORE.md](BACKUP_RESTORE.md) und Dirty-Recovery in [MIGRATION_RECOVERY.md](MIGRATION_RECOVERY.md).

Kennzeichnung:

- **Ausgeführt:** tatsächlich gegen Git, GitHub, Docker, MySQL oder die Anwendung gelaufen.
- **Automatisiert getestet:** durch einen reproduzierbaren Test abgedeckt.
- **Manuell geprüft:** read-only inspiziert oder durch einen gezielten Smoke bestätigt.
- **Dokumentiert:** betrieblicher Ablauf vorhanden, aber nicht als dauerhafter Dienst eingerichtet.
- **Offen:** noch kein belastbarer Nachweis.

## 1. Scope und Stop-Bedingung

Stufe 0C stabilisiert ausschließlich Remote-CI, Migrationsbetrieb, Backup/Restore und die bestehende Einzelinstanz-Infrastruktur. Es wurden keine Studios, Standorte, Tenants, Rollen, Trainerkonten, Buchungen, Payments, SaaS-, Community-, KI- oder Native-App-Funktionen und keine vorbereitenden Studio-/Rollentabellen angelegt.

## 2. Verifizierter Ausgangszustand

**Ausgeführt:** Der Startzustand wurde auf `stabilization/stage-0b` mit exakt `576af35ae291247df0222aa8d6e9399d5be65caf` und sauberem Arbeitsbaum bestätigt. Die vier vorhandenen Stashes blieben unverändert, es gab nur den erwarteten Haupt-Worktree, und `origin` zeigte auf `https://github.com/Limason17/fittrack-ipt7.1.git`.

**Manuell geprüft:** Im Tracking befanden sich weder `.env`, Dumps, komprimierte Backups, Playwright-/Buildartefakte noch hochwahrscheinliche Secrets. Die einzigen getrackten SQL-Dateien waren `database/schema.sql` und `database/seed.sql`.

## 3. Stage-0B-Remote-Nachweis

**Ausgeführt:** `stabilization/stage-0b` wurde ohne Force-Push mit Upstream gepusht. Pull Request [#1](https://github.com/Limason17/fittrack-ipt7.1/pull/1) von `stabilization/stage-0b` nach `main` ist offen und wurde nicht gemergt.

Der erste GitHub-Actions-Lauf [29650667165](https://github.com/Limason17/fittrack-ipt7.1/actions/runs/29650667165) verwendete exakt `576af35ae291247df0222aa8d6e9399d5be65caf`. Frontend sowie Chromium/Axe waren grün. Der Backend-Job scheiterte vor Migration/Tests, weil `fittrack_ci_test` den absichtlich engen Wegwerf-DB-Guard nicht erfüllte. Das war eine Environment-/CI-Konfigurationsinkonsistenz und kein MySQL-, Timing-, Linux- oder Produktcodefehler.

**Automatisiert reproduziert und minimal korrigiert:** Ein Regressionstest koppelt den CI-Datenbanknamen an denselben destruktiven Guard. Das CI-Ziel wurde auf `fittrack_test_ci` geändert; der Guard wurde nicht abgeschwächt. Korrekturcommit `7b81bc52c04aebdb851f72c775c4c49b7c5a939c` wurde normal gepusht.

Der zweite Lauf [29650890444](https://github.com/Limason17/fittrack-ipt7.1/actions/runs/29650890444) war für Backend/MySQL/Migrationen, Frontend/Build und Chromium/Axe vollständig erfolgreich. **Manuell geprüft:** Er enthielt keine hochgeladenen Artefakte; PR #1 blieb offen, ungemergt und mergebar.

## 4. Stage-0C-Branch und lokale Commits

**Ausgeführt:** `stabilization/stage-0c` wurde vom korrigierten grünen Stage-0B-Commit `7b81bc5…` erstellt.

- `91d259b` – `Add migration recovery diagnostics`
- `33de6fd` – `Add pilot backup automation and status checks`
- `c8290b2` – `Extend remote CI and Stage 0C operations guide`

Stage-0C wurde nicht direkt nach `main` gepusht und nicht automatisch gemergt.

## 5. Auto-Migrationsanalyse und wahrscheinlichste frühere Ursache

**Codehistorie:** Vor Commit `6494734` existierten ein top-level `ensureTrainingSchema`-/Runtime-DDL-Pfad und DB-I/O beim Import. Dieser echte historische Fehler war bereits vor Stufe 0C entfernt. Der aktuelle Importtest bestätigt, dass ein Import von `server.js` weder Listener noch DB- oder Migrations-I/O auslöst.

**Wahrscheinlich, aber nicht forensisch bewiesen:** Die ignorierte IDE-Konfiguration enthält einen zuletzt verwendeten Backend-`npm start`. Die damalige Backend-`.env` zielte auf `127.0.0.1:3306/fittrack`; das damalige Server-Startup migrierte standardmäßig. Die Ledger-Zeitpunkte liegen unmittelbar in demselben Startfenster. Der wahrscheinlichste Pfad war daher IDE-Run → `npm start` → `node server.js` → automatischer Runner gegen die Entwicklungsdatenbank. Prozesslogs für einen gerichtsfesten Kausalnachweis existieren nicht.

**Vor Stufe 0C noch real problematisch:** dotenv hing vom aktuellen Arbeitsverzeichnis ab, `NODE_ENV` war nicht zwingend explizit, und jeder normale Serverstart führte Migrationen aus. Eine falsch aufgelöste `.env` oder ein liegen gebliebener Watcher konnte deshalb die Entwicklungsdatenbank migrieren.

## 6. Neuer Startup- und Call-Path-Vertrag

**Implementiert und getestet:** `backend/.env` wird unabhängig vom CWD deterministisch geladen, der Default-Pool ist lazy, und `NODE_ENV` muss bei einem echten Server-/Migrationsstart exakt `development`, `test` oder `production` sein.

Standardstart:

```text
npm start / npm run dev
→ Runtime- und vollständige App-Konfiguration validieren
→ sicheren migration_target loggen
→ DB-Ping
→ Migrationsstatus read-only
→ pending/dirty/drift/unknown blockieren
→ Readiness aktivieren
→ Listener
```

Auto-Migrate:

```text
FITTRACK_AUTO_MIGRATE=true
→ FITTRACK_MIGRATION_EXPECTED_DATABASE exakt gegen explizites DB_NAME prüfen
→ DB-Ping
→ SELECT DATABASE() gegen erwartetes Ziel prüfen
→ Advisory Lock
→ Ledger/Status
→ Forward-Migrationen
→ finaler Status
→ Listener
```

Auto-Migration ist standardmäßig aus. `db:migrate`, `db:dev:init` und Auto-Migrate verlangen die explizite Zielbestätigung; der Runner prüft das tatsächlich selektierte Ziel vor Lock, Ledger-DDL und Anwendungsmigration. Frontend-, Build-, Syntax- und reine Importbefehle können keine Migration auslösen. Integration, Migration und E2E verändern ausschließlich ihre benannten Wegwerf-Datenbanken.

## 7. Migration Doctor

**Implementiert:** `npm run db:migrate:doctor` ist strikt SELECT-only und prüft Ziel, Ledger, Registry, Checksums sowie den Tabellen-/Spalten-/Index-/Foreign-Key-/Check-Constraint-Vertrag für Migrationen 001–004. Er erstellt kein Ledger, erwirbt keinen Lock und repariert nichts automatisch.

| Exit | Zustand | Bedeutung |
| ---: | --- | --- |
| 0 | `ready` | Ledger, Registry und Schema sauber |
| 2 | `pending` | kontrolliertes Migrationsfenster nötig |
| 3 | `recovery_required` | Dirty, Drift, Unknown, Ledger- oder Schemafehler |
| 1 | `failed` | Konfiguration, Verbindung, Ziel oder Diagnose fehlgeschlagen |

Dirty-Ausgaben enthalten sichere Migrations-ID, Status, ISO-Zeitpunkt und allowlist-validierten Failure-Code, aber keine Credentials. **Ausgeführt:** Die reale lokale FitTrack-Datenbank meldete 4 angewandt, 0 pending/dirty/drift/unknown, 0 Schema- und 0 Ledgerfehler.

## 8. Dirty-Recovery

**Dokumentiert und durch Doctor-Szenarien getestet:** `MIGRATION_RECOVERY.md` stoppt Anwendung, Watcher und weitere Startversuche, sichert den Dirty-Zustand, restauriert in eine separate DB, vergleicht tatsächliches Schema/Backfills, entwickelt manuelle Reparatur ausschließlich auf Kopien und erlaubt eine Ledger-Reparatur erst nach nachgewiesener vollständiger Schema- und Datenübereinstimmung.

Es gibt absichtlich keine automatische Down-Migration und keine automatische Ledger-Reparatur. Migration 004 besitzt eine explizite Prüfsequenz für Snapshot-Spalten, Backfills, Links, Indizes, Foreign Key und Check-Constraints.

## 9. Backup-Automatisierung

**Implementiert:** `npm run db:backup:daily` verlangt Loopback, absoluten externen Pfad, expliziten Container, `FITTRACK_BACKUP_EXPECTED_DATABASE=DB_NAME` und `FITTRACK_BACKUP_ACK=backup:<DB_NAME>`. Vor `mysqldump` müssen Datenbankname und `@@server_uuid` der Hostverbindung und des Container-Sockets übereinstimmen.

Ein exklusiver Lock verhindert Parallelstarts. Der Lauf erzeugt ein `.sql.gz` und veröffentlicht das zugehörige Manifest zuletzt als Completion Marker. Manifest und Verifikation enthalten komprimierte und logische Größe sowie jeweils SHA-256. Rohdump und `.partial`-Dateien werden nach Erfolg entfernt; Dateinamen und Logs enthalten keine Credentials.

## 10. Retention, Status und Alarmierung

**Implementiert und automatisiert getestet:** UTC-GFS behält die Vereinigung aus 7 Tages-, 4 ISO-Wochen- und 3 Monatsgenerationen sowie immer das jüngste Backup. Automatisch gelöscht werden nur erneut vollständig verifizierte eigene Manifest-/Artefaktpaare. Legacy-, fremde, unbekannte oder verwaiste Dateien werden nicht automatisch gelöscht.

`npm run db:backup:status` benötigt kein DB-I/O und prüft letztes Completion-Datum, Alter, Größe, Manifest und Hash. Exakt 24 Stunden ist noch gültig; darüber endet der Status mit Exit 22.

| Ereignis | Exit/Signal | Schwere | Reaktion |
| --- | --- | --- | --- |
| Backup erfolgreich/aktuell | 0 | Information | protokollieren und Off-host-Schritt prüfen |
| unsichere Backupkonfiguration | 10 | hoch | Guards nicht umgehen; Ziel korrigieren |
| Backup fehlgeschlagen | 20 | kritisch | sofort untersuchen |
| kein Backup vorhanden | 21 | kritisch | Scheduler/Storage sofort prüfen |
| kein Backup seit mehr als 24 h | 22 | hoch | am selben Tag beheben |
| Hash-/Manifestfehler | 23 | kritisch | Artefakt sperren, nicht restaurieren/löschen |
| Retention fehlgeschlagen | 24 | hoch | neues Paar sichern, keine Massenlöschung |
| Backup-Lock aktiv | 25 | hoch | Prozess prüfen, Lock nicht blind löschen |
| Dirty Migration | Doctor 3 | kritisch | Deployment stoppen |
| Checksum-Drift | Doctor 3 | kritisch | Deployment stoppen |
| Readiness länger als 2 Minuten 503 | HTTP 503 | kritisch | Rollback-/Recovery-Entscheid |
| wiederholte Migrationfehler | wiederholtes Signal | kritisch | kein weiterer Start ohne Analyse |

## 11. Tatsächlich ausgeführte Backup-/Restore-Drills

**Erster Funktionsdrill:** Eine migrierte Wegwerf-DB wurde täglich gesichert, gzip/Manifest/Hash und Status (Alter 4 Sekunden) waren gültig, in eine neue DB restauriert, Doctor war sauber, Readiness 200, Registrierung 201, Login 200 und Workout-Read 200.

**Strenger datenhaltiger Drill:** Vor dem Backup wurden über die API ein Testkonto und `Stage 0C restore workout` mit einer Übungszeile angelegt und gelesen. Das Daily-Backup bestätigte die Host-/Containeridentität und veröffentlichte ein 3165-Byte-gzip mit SHA-256 `59352f3a77bbc0c92a28f08fd862ea0f554f6c77355f8c90ce8fc6c2246c7f7a`; der logische Dump hatte 13238 Bytes und SHA-256 `aa30f49f61177d64299ca0c16b72b6e4ff5a722124a83c2e6624217e5ea936ef`.

Nach Restore in eine neue Datenbank waren 6 Tabellen vorhanden, Doctor Exit 0, Readiness 200, Login des bereits vor dem Backup angelegten Kontos 200 und das bereits vor dem Backup angelegte Workout samt Übungszeile read-only verfügbar. **Ausgeführt:** Beide Quell-/Restore-DBs, beide neuen Drill-Verzeichnisse und temporären Serverlogs wurden danach über exakt validierte Pfade entfernt. Die neuen Drill-Artefakte sind nicht wiederherstellbar; die zwei bestehenden externen Stage-0B-Nachweisdumps blieben unverändert erhalten.

## 12. Scheduler und Off-host-Konzept

**Nur dokumentiert, nicht eingerichtet:** Das Runbook beschreibt Cron und Windows Task Scheduler mit dediziertem Konto, Owner/Vertretung, geschützter Secret-Quelle, JSONL-Logs und Exitcode-Alarmrouting. Auf dieser Entwicklungsmaschine wurde kein dauerhafter Scheduler installiert.

**Nur dokumentiert, nicht implementiert:** Der nachgelagerte Adapter lädt erst nach lokalem Erfolg gzip plus Manifest in privaten verschlüsselten Object Storage. Gefordert sind SSE, Versionierung, Lifecycle, getrennte Upload-/Restore-Rollen, Checksum-Verifikation, freigegebene Region/Datenresidenz und regelmäßiger Download-/Restore-Test. Es wurden keine Cloud-Credentials angelegt oder verwendet.

## 13. Compose- und Containerprüfung

**Manuell read-only geprüft:** Aktuelle Compose-Konfiguration und laufender Container verwenden `mysql:8.0`, Port 3306, Projekt `fittrack-ipt71`, Netzwerk `fittrack-ipt71_default`, Restart-Policy `always` und das korrekte Named Volume `fittrack-ipt71_mysql_data` auf `/var/lib/mysql`. DB-Check, Migrationsstatus und Doctor waren sauber. Environment-Werte wurden nicht ausgegeben.

Der laufende Container besitzt noch zwei alte Init-Bind-Mounts für `database/schema.sql` und `database/seed.sql`, während die aktuelle Compose-Datei nur das Named Volume definiert. Laufender Config-Hash `28e2c184…` und aktueller Service-Hash `c01d4196…` unterscheiden sich; weder aktuelle noch laufende Konfiguration besitzt einen Healthcheck. Image, Port, Volume, Projekt, Netzwerk und Restart-Policy stimmen.

**Entscheidung:** Kein Recreate in Stufe 0C. Das persistente Volume ist korrekt, die Datenbank ist gesund, und die veralteten Init-Mounts wirken bei dem initialisierten Volume nicht erneut. Ein Recreate hätte ohne akuten Nutzen zusätzliches Betriebsrisiko erzeugt. Beim nächsten geplanten Wartungsfenster: frisches Backup, Volume erneut bestätigen, kontrolliert ohne `-v` recreaten, Doctor/Readiness/Tests ausführen. Es wurde kein Volume gelöscht und `docker compose down -v` wurde nicht verwendet.

## 14. Lokale Tests, Build und Audits

| Gate | Ergebnis | Art |
| --- | --- | --- |
| Backend Unit | 68/68 | ausgeführt |
| Backend Integration | 6/6 | ausgeführt, isolierte MySQL-DBs |
| Migration/Doctor | 19/19 | ausgeführt, inklusive realer MySQL-Szenarien |
| Backend gesamt | 93/93 | ausgeführt |
| Backend Syntax | 74 Dateien | ausgeführt |
| Coverage | 81 Tests; 71,90 % Lines | ausgeführt, kein Mindestgate |
| Backup-/Restore-Zielgruppe | 21/21 | ausgeführt |
| Frontend | 53/53 | ausgeführt |
| Produktionsbuild | erfolgreich, 61 Module | ausgeführt |
| Chromium-E2E/Axe | 9/9 | ausgeführt |
| Backend Audit | 0 Schwachstellen | ausgeführt |
| Frontend Audit | 0 Schwachstellen | ausgeführt |
| Compose config | gültig | ausgeführt |

Der erste lokale Chromium-Versuch konnte das nicht installierte gebündelte `chromium_headless_shell` nicht starten. Das war eine lokale Browser-Dependency, kein Testfehler. Der unveränderte Lauf über den bereits vorgesehenen System-Chrome-Fallback war 9/9 grün.

## 15. CI-Erweiterung für Stufe 0C

**Lokal implementiert und getestet:** Der Backend-Job setzt `FITTRACK_AUTO_MIGRATE=false`, bestätigt `FITTRACK_MIGRATION_EXPECTED_DATABASE=fittrack_test_ci`, führt nach Reset/No-op den Doctor aus und erstellt danach ein kurzlebiges Daily-Backup im `${{ runner.temp }}` gegen die MySQL-Service-Container-ID. Hash und Status werden geprüft; es gibt keinen Upload und keine externen Storage-Credentials. Ein lokaler Regressionstest hält CI-DB und Migrationsbestätigung identisch.

Dirty-/Drift-/Partial- und Backupfehler werden durch die neue Testlogik simuliert; die vollständigen bestehenden Backend-, Frontend-, Build-, Audit- und Chromium/Axe-Gates bleiben erhalten.

## 16. Remote-Status von Stufe 0C

**Ausgeführt:** `stabilization/stage-0c` wurde ohne Force-Push mit Upstream gepusht. Pull Request [#2](https://github.com/Limason17/fittrack-ipt7.1/pull/2) ist als klarer Stack von `stabilization/stage-0c` nach `stabilization/stage-0b` offen. Er ist kein Draft, nicht gemergt und wurde von GitHub als mergebar mit Zustand `clean` gemeldet. PR #1 bleibt unabhängig davon offen und ungemergt; es gab keinen Push nach `main`.

**Ausgeführt:** GitHub-Actions-Run [29652881622](https://github.com/Limason17/fittrack-ipt7.1/actions/runs/29652881622) verwendete exakt Implementierungscommit `c8290b265fb656bc64fb46c793714a11d128c242` und endete vollständig mit `success`:

- Backend/MySQL/Migrationen: MySQL-Service, Install, Syntax, Audit, geschützter Reset, expliziter No-op, Status, Migration Doctor, neues gzip-Wegwerf-Backup samt Hash/Status, vollständige Backend-Suite und Coverage erfolgreich;
- Frontend: Install, Audit, 53 Tests und Produktionsbuild erfolgreich;
- Browser: Playwright-Installation und 9 Chromium-E2E-/Axe-Tests erfolgreich;
- Fehlerartefakt-Upload wurde übersprungen; die Run-Artefaktliste enthielt 0 Artefakte.

Der vorliegende Nachtrag ändert nur den dokumentierten Remote-Nachweis. Sein nachfolgender, unveränderter CI-Lauf wird im PR und Abschlussbericht festgehalten, damit nicht durch jeden reinen Ergebnis-Nachtrag eine endlose Folge weiterer Nachtragscommits entsteht.

## 17. Cleanup, Tracking und lokale Konfiguration

**Ausgeführt:** Keine Stage-0C-Test-DB, kein neuer Dump, kein `dist`, kein Playwright-Fehlerartefakt und kein temporäres Serverlog blieb zurück. Der finale Tracking-Scan fand keine `.env`, `.sql.gz`, Manifeste, `.partial`, Build- oder Browserartefakte und keine hochwahrscheinliche Secret-Signatur.

**Manuelle lokale Aktion vor dem nächsten echten Entwicklungsstart:** Die ignorierte `backend/.env` enthält noch kein explizites `NODE_ENV`, `FITTRACK_AUTO_MIGRATE` oder `FITTRACK_MIGRATION_EXPECTED_DATABASE`. Sie wurde nicht automatisch verändert. Mindestens `NODE_ENV=development` ist für den neuen echten Serverstart erforderlich; normale Runtime soll `FITTRACK_AUTO_MIGRATE=false` verwenden. Die erwartete DB ist vor mutierenden Migrationsbefehlen explizit zu setzen.

## 18. Verbleibende Risiken

- PR #1 und PR #2 bleiben absichtlich offen und ungemergt; Review und geordnete Integration stehen noch aus.
- Scheduler, Off-host-Upload, Alarmzustellung und deren Betriebs-Owner sind dokumentiert, aber nicht auf einer Pilotplattform eingerichtet.
- Compose-Hash und alte Init-Bind-Mounts bleiben bis zum kontrollierten Wartungs-Recreate bestehen; ein Healthcheck fehlt.
- Firefox, WebKit und ein vollständiger manueller Screenreader-Test wurden nicht ausgeführt. Chromium/Axe bleibt das verbindliche Gate.
- Die historische ungeplante Migration ist mit hoher Plausibilität erklärt, aber mangels damaliger Prozesslogs nicht forensisch bewiesen.
- MySQL-DDL bleibt nicht vollständig transaktional; Recovery ist bewusst manuell und reviewpflichtig.
- Runtime- und Migrationsnutzer sind betrieblich zu trennen; die Anwendung erzwingt diese Infrastrukturrolle nicht selbst.

## 19. Freigabeempfehlung

Die lokalen technischen Abnahmekriterien und der verbindliche Stage-0C-Remote-Lauf sind erfüllt. Nach grünem CI-Lauf des reinen Remote-Nachtrags ist die technische Grundlage aus Sicht von Stufe 0C ausreichend stabil für die Planung von Stufe 1A. PR #1 und danach PR #2 müssen weiterhin reviewt und in dieser Reihenfolge kontrolliert integriert werden; dieses Dokument autorisiert keinen Merge.

Auch nach Abschluss dieser Phase gilt die Stop-Bedingung: keine Studio-, Tenant-, Rollen- oder sonstige SaaS-Implementierung ohne ausdrückliche Freigabe.
