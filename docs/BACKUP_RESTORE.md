# FitTrack Backup und Restore

Diese Anleitung beschreibt den lokalen, bewusst begrenzten Wiederherstellungsweg aus Stufe 0B. Er ist ein Pilotnachweis für eine einzelne MySQL-8-Instanz im Docker-Container und noch kein Produktions-Runbook.

## Pilotziele

- Recovery Point Objective (RPO): höchstens 24 Stunden Datenverlust.
- Recovery Time Objective (RTO): höchstens 4 Stunden bis zu einer geprüften, betriebsbereiten Instanz.

Das sind anfängliche Planungsannahmen, keine vertraglich garantierten SLA. Um das RPO zu erreichen, muss mindestens täglich ein erfolgreicher, extern gespeicherter Dump erstellt und überwacht werden. Das RTO muss nach jeder wesentlichen Schema- oder Infrastrukturänderung erneut in einer Restore-Übung gemessen werden.

## Sicherheitsgrenzen

Die Skripte brechen ab, wenn ihre Sicherheitsbedingungen nicht erfüllt sind:

- Backup und Restore akzeptieren nur eine Datenbank auf `localhost`, `127.0.0.1` oder `::1`.
- Das Backup-Verzeichnis muss ausserhalb des Repositorys liegen.
- Ein Restore ist nur mit `NODE_ENV=test` und `ALLOW_TEST_DB_RESET=true` erlaubt.
- Der Zielname muss mit `fittrack_test`, `fittrack_e2e` oder `fittrack_restore` beginnen und darf danach nur klar begrenzte alphanumerische Segmente enthalten.
- Der Restore verlangt zusätzlich `FITTRACK_RESTORE_ACK=restore-local-test-database`.
- Die Zieldatenbank wird beim Restore vollständig neu erstellt. Niemals eine produktive oder anderweitig benötigte Datenbank als Ziel angeben.
- Das Datenbankpasswort wird nicht als Prozessargument übergeben. Das Skript reicht es nur im Environment des Docker-Unterprozesses als `MYSQL_PWD` weiter.
- Dump-Dateien, Passwörter und andere Secrets werden nicht committed oder in Logs ausgegeben.

Diese Grenzen ersetzen keine Produktionskontrollen. Ein Produktionsrestore benötigt ein genehmigtes Change-Fenster, eindeutig benannte Verantwortliche, getrennte Rollen, verschlüsselten Storage, Zugriffskontrollen und einen geprüften Rollback-Plan.

## Voraussetzungen

1. Node.js 22.17.0 oder eine von `package.json` erlaubte Version und npm 10.
2. Docker mit einem laufenden MySQL-8-Container, standardmässig `fittrack_mysql`.
3. Installierte Backend-Abhängigkeiten: `cd backend` und `npm ci`.
4. Die üblichen Variablen `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` und `DB_NAME` stammen aus der lokalen Secret-/Environment-Konfiguration. Secrets nicht in die Shell-History kopieren.
5. Ein existierendes, zugriffsgeschütztes Backup-Verzeichnis ausserhalb des Repositorys.

Vor dem Start read-only prüfen:

```powershell
docker compose ps
cd backend
npm run db:check
npm run db:migrate:status
```

Bei einer absichtlich unversionierten Legacy-Datenbank darf `db:migrate:status` die Migrationen 001–004 als ausstehend melden. Dirty-, Drift- oder unbekannte Ledger-Einträge sind dagegen Stop-Bedingungen.

## Backup erstellen

Die Environmentwerte werden hier nur als Platzhalter gezeigt. `DB_PASSWORD` muss bereits sicher im Prozess-Environment verfügbar sein.

```powershell
cd backend
$env:DB_HOST = '127.0.0.1'
$env:DB_NAME = 'fittrack'
$env:FITTRACK_DB_CONTAINER = 'fittrack_mysql'
$env:FITTRACK_BACKUP_DIR = '<absolutes Verzeichnis ausserhalb des Repositorys>'
npm run db:backup
```

Das Skript verwendet `mysqldump` aus dem Container mit konsistentem Single-Transaction-Dump. Es schreibt zuerst eine exklusive `.partial`-Datei, prüft Mindestgrösse, Dump-Header und Tabellendefinitionen, berechnet SHA-256 und benennt die Datei erst danach atomar in folgendes Format um:

```text
<datenbank>-<UTC-Zeitstempel>.sql
```

Erfolg ist ausschliesslich ein Exitcode 0 plus ein JSON-Resultat mit `path`, `bytes` und `sha256`. Eine verbliebene `.partial`-Datei oder ein fehlendes Resultat gilt als fehlgeschlagen.

## In eine Wegwerf-Datenbank wiederherstellen

Der folgende Vorgang löscht und erstellt ausschliesslich die explizit benannte Restore-Datenbank neu:

```powershell
cd backend
$env:NODE_ENV = 'test'
$env:ALLOW_TEST_DB_RESET = 'true'
$env:DB_HOST = '127.0.0.1'
$env:DB_NAME = 'fittrack_restore_drill'
$env:FITTRACK_DB_CONTAINER = 'fittrack_mysql'
$env:FITTRACK_RESTORE_FILE = '<absoluter Pfad zum geprüften .sql-Dump>'
$env:FITTRACK_RESTORE_ACK = 'restore-local-test-database'
npm run db:restore:test
```

Das Restore-Skript wiederholt die strukturelle Plausibilitätsprüfung der Dump-Datei, berechnet ihren SHA-256, erstellt das klar begrenzte Testziel neu, streamt den Dump über `mysql` aus dem Container und meldet anschliessend Verbindung und Tabellenanzahl. Vor dem Restore muss der Datei-Hash separat berechnet und mit dem beim Backup protokollierten Sollwert verglichen werden; das Skript kennt diesen Sollwert nicht und gibt `sourceSha256` erst nach dem Lauf aus. Ein Exitcode 0 allein reicht ebenfalls nicht: `restoredTables` muss grösser als 0 sein und der erwarteten Struktur entsprechen. Ein Restore gegen `fittrack`, einen entfernten Host oder einen unklaren Namen wird verweigert.

## Restore und Migration verifizieren

Vor einer Migration die erwarteten Zeilenzahlen und Foreign Keys read-only erfassen. Mindestens prüfen:

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM exercises;
SELECT COUNT(*) FROM workouts;
SELECT COUNT(*) FROM workout_exercises;
SELECT COUNT(*) FROM progress_entries;

SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
```

Zuerst den erwarteten Migrationszustand bestimmen und dann gegen die Restore-Datenbank ausführen:

```powershell
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:status
```

Bei einem unversionierten Legacy-Dump muss der erste Status die erwarteten Migrationen 001–004 als ausstehend melden und der erste Migrationslauf sie anwenden. Bei einem bereits versionierten Dump müssen 001–004 schon mit den bekannten Checksums erfolgreich vorliegen und bereits der erste Migrationslauf ein No-op sein. In beiden Fällen müssen `dirty`, `drift` und `unknown` leer bleiben; der abschliessende zweite Migrationslauf muss `applied: []` beziehungsweise `appliedCount: 0` melden.

Anschliessend dieselben Counts und Foreign Keys erneut erfassen und mindestens folgende Integritätsbedingungen prüfen:

- keine verwaisten Workouts, Workout-Übungen oder Fortschrittseinträge;
- keine verwaisten Quellverknüpfungen zwischen Fortschritt und Workout-Übung;
- keine doppelten Fortschrittseinträge pro Workout-Übung;
- alle abgeleiteten Fortschrittseinträge besitzen Quelle und Übungs-Snapshot;
- Gewicht, Sätze, Wiederholungen, Datum und 1RM der abgeleiteten Einträge stimmen mit der Quelle überein;
- Anwendung startet gegen die Kopie, `/api/health/live` und `/api/health/ready` liefern HTTP 200;
- Registrierung/Login sowie ein kleiner Workout-/Progress-Smoke funktionieren mit eigens erzeugten Testdaten.

Ein Login mit einem bestehenden Konto wird nur geprüft, wenn die Zugangsdaten über einen sicheren Kanal verfügbar sind. Niemals Passwörter aus Dumps extrahieren oder offenlegen.

Für einen echten Restore-Nachweis den gesamten Restore-, Migrations- und Smoke-Ablauf in einer zweiten leeren Wegwerf-Datenbank wiederholen. Erst danach darf ein geplanter Eingriff in eine benötigte Datenbank freigegeben werden.

## Testdatenbank sicher entfernen

Nach dokumentiertem Erfolg nur das explizite Wegwerfziel löschen:

```powershell
cd backend
$env:NODE_ENV = 'test'
$env:ALLOW_TEST_DB_RESET = 'true'
$env:DB_HOST = '127.0.0.1'
$env:DB_NAME = 'fittrack_restore_drill'
npm run db:test:drop
```

Der gleiche Loopback- und Namensschutz gilt beim Löschen. Vorher sicherstellen, dass alle benötigten Prüfergebnisse erfasst wurden.

## Alte Dumps sicher löschen

Backups zuerst nach Aufbewahrungsregel, Restore-Nachweis und Replikation in den vorgesehenen geschützten Speicher bewerten. Keine Wildcards und kein rekursives Löschen verwenden. Unter PowerShell einen einzelnen Pfad auflösen, gegen das erwartete Backup-Verzeichnis prüfen und erst dann entfernen:

```powershell
$backupRoot = (Resolve-Path -LiteralPath '<Backup-Verzeichnis>').Path
$dump = (Resolve-Path -LiteralPath '<einzelner alter Dump.sql>').Path
$insideRoot = $dump.StartsWith($backupRoot + [IO.Path]::DirectorySeparatorChar,
  [StringComparison]::OrdinalIgnoreCase)
if (-not $insideRoot -or [IO.Path]::GetExtension($dump) -ne '.sql') {
  throw 'Abbruch: Datei liegt nicht als .sql im erwarteten Backup-Verzeichnis.'
}
Remove-Item -LiteralPath $dump
```

Für den frühen Pilot ist eine Ausgangsregel von sieben täglichen und vier wöchentlichen geprüften Backups sinnvoll. Sie ist vor Pilotstart mit Speicher-, Datenschutz- und Löschvorgaben verbindlich festzulegen. Ein Backup ist erst belastbar, wenn es verschlüsselt, zugriffsgeschützt, ausserhalb des Anwendungsservers gespeichert und regelmässig wiederhergestellt wurde.

## Typische Fehler und Reaktion

| Fehlercode/Symptom | Bedeutung | Reaktion |
| --- | --- | --- |
| `BACKUP_LOCATION_REQUIRED` | Kein externes Backupziel gesetzt | Absoluten externen Pfad setzen |
| `BACKUP_LOCATION_FORBIDDEN` | Ziel liegt im Repository | Geschütztes Verzeichnis ausserhalb des Repositorys wählen |
| `BACKUP_TARGET_FORBIDDEN` | Datenbankhost ist nicht Loopback | Pilot-Skript nicht umgehen; Produktionsprozess separat planen |
| `BACKUP_VERIFICATION_FAILED` | Dump ist leer, zu klein oder strukturell unplausibel | Dump verwerfen, Container/Storage prüfen und neu erstellen |
| `TEST_DB_OPERATION_FORBIDDEN` | Environment, Host, Zielname oder Bestätigung ist unsicher | Konfiguration korrigieren; Schutz nicht abschwächen |
| `RESTORE_FILE_REQUIRED` / `RESTORE_FILE_INVALID` | Quelle fehlt oder ist keine lesbare `.sql`-Datei | Exakten geprüften Dump angeben |
| `DATABASE_TOOL_UNAVAILABLE` | Docker oder Container-Tool nicht startbar | Docker, Containername und MySQL-Image prüfen |
| Dirty-/Drift-/Unknown-Status | Migration unvollständig oder Ledger inkonsistent | Nicht weiter migrieren; Backup sichern und Ursache analysieren |
| Readiness bleibt ungleich 200 | DB, Migration oder Runtime nicht betriebsbereit | Keine Umschaltung; Logs per Request-ID und Startup-Ereignis auswerten |

## Monitoring und Verantwortlichkeit

- Backupalter über 24 Stunden: Alarm und RPO-Verletzung untersuchen.
- Jeder fehlgeschlagene Backup- oder Restore-Lauf: sofortiger Alarm.
- Monatliche Restore-Übung im frühen Pilot; zusätzlich nach Schema-/Tooländerungen.
- Dashboard: letzter erfolgreicher Backup-Zeitpunkt, Alter, Grösse, SHA-256-Erfassung, Restore-Dauer, Migrationsdauer, Integritätsresultat und verantwortliche Person.
- Ein Owner muss täglich den automatisierten Backupstatus und nach jeder Übung das signierte Restore-Protokoll prüfen.

Vor Produktion sind Automatisierung, verschlüsselter Off-host-Storage, Secret Store, Retention/Löschung, Least-Privilege-Konten, Alarmrouting und ein gemessener vollständiger Disaster-Recovery-Test zwingend nachzuziehen.
