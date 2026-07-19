# FitTrack Backup und Restore

Diese Anleitung beschreibt den lokalen Backup- und Restore-Weg für die einzelne MySQL-8-Instanz des FitTrack-Piloten. Stage 0B stellte einen bewusst manuellen Dump-/Restore-Nachweis bereit. Stage 0C ergänzt einen täglich planbaren, überwachten Backup-Lauf mit Integritätsmanifest und GFS-Retention. Das ist noch kein Produktions-Runbook und keine Aussage darüber, dass ein bestimmter Lauf bereits ausgeführt wurde.

## Pilotziele und Geltungsbereich

- Recovery Point Objective (RPO): höchstens 24 Stunden Datenverlust.
- Recovery Time Objective (RTO): höchstens 4 Stunden bis zu einer geprüften, betriebsbereiten Instanz.
- Die Ziele sind Planungsannahmen des Piloten und keine vertraglich garantierten Service Level Agreements (SLA).
- Das RPO setzt mindestens einen erfolgreichen Backup-Lauf pro 24 Stunden, eine funktionierende Überwachung und eine zweite, vom Anwendungsrechner unabhängige Kopie voraus.
- Das RTO muss monatlich sowie nach wesentlichen Schema-, Restore- oder Infrastrukturänderungen in einer Restore-Übung gemessen werden.

Die Skripte sind absichtlich auf ein lokales Docker-/Loopback-Szenario begrenzt. Sie dürfen nicht durch Abschwächen der Guards für eine entfernte oder produktive Datenbank umfunktioniert werden.

## Zwei getrennte Backup-Wege

| Zweck | Befehl | Ergebnis | Geeignet für den täglichen Pilotbetrieb |
| --- | --- | --- | --- |
| Manueller Stage-0B-Dump | `npm run db:backup` | Eine geprüfte, unkomprimierte `.sql`-Datei mit `bytes` und `sha256` im JSON-Ergebnis | Nein; Ad-hoc-Diagnose und manueller Nachweis |
| Automatisierter Stage-0C-Lauf | `npm run db:backup:daily` | Ein verifiziertes `.sql.gz`-/Manifest-Paar, Identitätsprüfung, Lock und UTC-GFS-Retention | Ja, sobald Scheduler, Monitoring und Off-host-Kopie eingerichtet sind |

Der manuelle Lauf besitzt kein Completion-Manifest, keinen Parallelitäts-Lock, keine Host-/Container-UUID-Prüfung und keine automatische Retention. Ein manueller Dump allein erfüllt deshalb den automatisierten Pilotprozess nicht.

## Gemeinsame Voraussetzungen

1. Eine von `backend/package.json` erlaubte Node.js-Version, npm 10 und installierte Backend-Abhängigkeiten (`cd backend`, danach `npm ci`).
2. Docker mit einem laufenden MySQL-8-Container; der lokale Standard des manuellen Restore-Pfads ist `fittrack_mysql`.
3. Ein dediziertes Betriebssystemkonto mit minimalen Rechten auf Repository, Docker, Backup- und Log-Verzeichnis.
4. Ein zugriffsgeschütztes Backup-Verzeichnis ausserhalb des Repositorys. Für den automatisierten Lauf muss der Pfad absolut sein und darf nicht auf ein Dateisystem-Root zeigen.
5. `DB_PASSWORD` wird über eine geschützte Environment-/Secret-Konfiguration bereitgestellt. Es gehört weder in Befehlsargumente noch in Scheduler-Definitionen, Logs oder das Repository.

Vor einem manuellen Eingriff read-only prüfen:

```powershell
docker compose ps
cd backend
npm run db:check
npm run db:migrate:status
npm run db:migrate:doctor
```

Dirty-, Drift-, Unknown- oder partielle Schema-Zustände sind Stop-Bedingungen. Der Migration Doctor verändert die Datenbank nicht; seine Exitcodes und die Recovery-Schritte stehen in `MIGRATION_RECOVERY.md`.

## Manuellen Stage-0B-Dump erstellen

Die Werte sind Platzhalter. Das Passwort muss bereits sicher im Prozess-Environment verfügbar sein.

```powershell
cd backend
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3306'
$env:DB_USER = '<datenbankbenutzer>'
$env:DB_NAME = 'fittrack'
$env:FITTRACK_DB_CONTAINER = 'fittrack_mysql'
$env:FITTRACK_BACKUP_DIR = '<absolutes Verzeichnis ausserhalb des Repositorys>'
npm run db:backup
```

Der manuelle Lauf akzeptiert nur `localhost`, `127.0.0.1` oder `::1`, verlangt ein Ziel ausserhalb des Repositorys und verwendet `mysqldump --single-transaction` aus dem Container. Er schreibt exklusiv nach `.partial`, prüft Mindestgrösse, MySQL-Dump-Header und mindestens eine Tabellendefinition, berechnet SHA-256 und benennt die Datei danach atomar um:

```text
<datenbank>-<UTC-Zeitstempel>.sql
```

Erfolg bedeutet Exitcode `0` und ein JSON-Ergebnis mit `database`, `path`, `createdAt`, `bytes` und `sha256`. Eine `.partial`-Datei, ein fehlendes Ergebnis oder Exitcode ungleich `0` gilt als fehlgeschlagen. Das Passwort wird dem Docker-Unterprozess als `MYSQL_PWD` übergeben und nicht als Prozessargument.

## Automatisierten täglichen Lauf konfigurieren

Für `npm run db:backup:daily` müssen alle folgenden Werte explizit gesetzt sein:

| Variable | Bedingung |
| --- | --- |
| `DB_HOST` | Muss explizit gesetzt sein und auf `localhost`, `127.0.0.1` oder `::1` zeigen |
| `DB_PORT` | Optional; Standard `3306`; muss bei Angabe eine gültige Portnummer sein |
| `DB_USER` | Muss explizit und nicht leer gesetzt sein |
| `DB_PASSWORD` | Muss explizit und nicht leer aus geschützter Secret-Konfiguration kommen |
| `DB_NAME` | Muss explizit sein; erlaubt sind nur Buchstaben, Ziffern, `_`, `$` und `-` |
| `FITTRACK_BACKUP_EXPECTED_DATABASE` | Muss exakt mit dem expliziten `DB_NAME` übereinstimmen |
| `FITTRACK_BACKUP_ACK` | Muss exakt `backup:<DB_NAME>` sein, zum Beispiel `backup:fittrack` |
| `FITTRACK_DB_CONTAINER` | Muss explizit sein; erlaubt sind nur Buchstaben, Ziffern, `_`, `.`, `-` |
| `FITTRACK_BACKUP_DIR` | Absoluter Pfad ausserhalb des Repositorys; weder Repositorypfad noch Dateisystem-Root |

Beispiel für eine interaktive, nicht als Scheduler-Konfiguration zu übernehmende Vorbereitung:

```powershell
cd backend
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3306'
$env:DB_USER = '<datenbankbenutzer>'
# DB_PASSWORD vorher aus der geschützten lokalen Secret-Quelle laden.
$env:DB_NAME = 'fittrack'
$env:FITTRACK_BACKUP_EXPECTED_DATABASE = 'fittrack'
$env:FITTRACK_BACKUP_ACK = 'backup:fittrack'
$env:FITTRACK_DB_CONTAINER = 'fittrack_mysql'
$env:FITTRACK_BACKUP_DIR = 'D:\FitTrackBackups'
npm run db:backup:daily
```

Der Pfad wird vor und nach dem Erstellen beziehungsweise Auflösen geprüft. Symlink-/Pfadauflösungen dürfen nicht in das Repository zurückführen. Das Skript erstellt keine Backups auf einem Remote-DB-Host.

## Zielidentität, Lock und Veröffentlichungsgrenze

Vor `mysqldump` liest der tägliche Lauf parallel:

- über die konfigurierte Host-Verbindung `SELECT DATABASE(), @@server_uuid`;
- über den expliziten Container und dessen MySQL-Socket dieselben beiden Werte.

Konfigurierte Datenbank, Container-Datenbank und `FITTRACK_BACKUP_EXPECTED_DATABASE` müssen gleich sein; zusätzlich müssen Host-Verbindung und Container dieselbe MySQL-Server-UUID liefern. Bei jeder Abweichung bricht der Lauf mit `BACKUP_TARGET_MISMATCH` ab, bevor ein Dump veröffentlicht wird.

Im Backup-Verzeichnis schützt `.fittrack-backup.lock` mit exklusiver Dateierstellung vor parallelen Läufen. Ein vorhandener Lock führt zu `BACKUP_LOCKED`. Einen nach Prozessabsturz verbliebenen Lock erst entfernen, wenn eindeutig kein Backup-Prozess mehr läuft, Owner und Ursache dokumentiert sind und das Verzeichnis auf `.partial`-/unvollständige Dateien geprüft wurde.

Ein erfolgreicher Lauf erzeugt das Paar:

```text
<datenbank>-<YYYYMMDD>T<HHMMSS>Z.sql.gz
<datenbank>-<YYYYMMDD>T<HHMMSS>Z.sql.gz.manifest.json
```

Der Ablauf ist:

1. Unkomprimierten Dump exklusiv als `.sql.partial` erzeugen, strukturell prüfen und Rohgrösse sowie Roh-SHA-256 ermitteln.
2. Nach `.sql.gz.partial` komprimieren und die Datei vollständig wieder dekomprimieren.
3. Komprimierte Grösse/SHA-256 und dekomprimierte Grösse/SHA-256 gegeneinander prüfen.
4. Ein exklusives Manifest als `.manifest.json.partial` schreiben. Es enthält `schemaVersion: 1`, `kind: fittrack.mysql.logical-backup`, `state: complete`, UTC-Zeiten, Datenbank, Server-UUID, gzip-Metadaten sowie Rohdump-Metadaten.
5. Zuerst gzip-Artefakt und danach Manifest atomar auf ihre endgültigen Namen umbenennen. Erst das endgültige Manifest mit `state: complete` ist der Completion Marker.
6. Den temporären Rohdump entfernen und anschliessend die Retention anwenden.

Der Status- und Restore-Pfad akzeptiert nur ein vollständig validiertes Paar. Dateiname, Manifestformat, Datenbank, Grössen, beide SHA-256-Werte, gzip-Dekodierung, Dump-Header und Tabellendefinitionen werden geprüft. Symbolische Links, aus dem Backup-Verzeichnis ausbrechende Artefakte und unvollständige Manifeste werden abgelehnt.

## Maschinenlesbarer Ergebnisvertrag

`db:backup:daily` und `db:backup:status` schreiben genau ein JSON-Resultat pro Lauf. Erfolgs-/Statusresultate gehen nach stdout, abgefangene Fehler nach stderr. Monitoring muss sowohl den Prozess-Exitcode als auch `status`, `code` und `exitCode` des JSON prüfen.

| Lauf | `event` | `status` | `code` | Exitcode |
| --- | --- | --- | --- | --- |
| Backup vollständig erstellt und Retention erfolgreich | `database_backup_completed` | `ok` | `BACKUP_CREATED` | `0` |
| Status: jüngstes vollständiges Backup höchstens 24 Stunden alt | `database_backup_status` | `ok` | `BACKUP_OK` | `0` |
| Status: jüngstes vollständiges Backup älter als 24 Stunden | `database_backup_status` | `stale` | `BACKUP_STALE` | `22` |
| Backup-Fehler | `database_backup_failed` | `failed` | Fehlercode aus der folgenden Tabelle | Gemäss Tabelle |
| Status-Fehler | `database_backup_status` | `failed` | Fehlercode aus der folgenden Tabelle | Gemäss Tabelle |

Der gemeinsame Exitcode-Vertrag lautet exakt:

| Exitcode | Zugeordnete Codes/Bedeutung |
| --- | --- |
| `0` | `BACKUP_CREATED` oder `BACKUP_OK` |
| `10` | Unsichere Konfiguration: `BACKUP_CONFIG_UNSAFE`, `BACKUP_LOCATION_REQUIRED`, `BACKUP_LOCATION_FORBIDDEN`, `BACKUP_TARGET_FORBIDDEN`, `BACKUP_TARGET_MISMATCH`, `BACKUP_ACK_INVALID`, `DATABASE_TOOL_CONFIG_INVALID` |
| `20` | Sonstiger Betriebsfehler, insbesondere `BACKUP_FAILED`, `DATABASE_TOOL_FAILED` oder `DATABASE_TOOL_UNAVAILABLE` |
| `21` | `BACKUP_MISSING`: kein vollständiges, eigenes Manifest-Paar vorhanden |
| `22` | `BACKUP_STALE`: jüngstes vollständiges Backup ist älter als 24 Stunden |
| `23` | `BACKUP_INTEGRITY_FAILED` oder `BACKUP_VERIFICATION_FAILED` |
| `24` | `BACKUP_RETENTION_FAILED` |
| `25` | `BACKUP_LOCKED` |

Der Statuslauf erzeugt im normalen Prüfpfad `0`, `10`, `20`, `21`, `22` oder `23`; `24` und `25` stammen aus dem täglichen Erstellungs-/Retention-Pfad, gehören aber in dasselbe Alarmrouting. Scheitert nur die Retention, nachdem das neue Paar bereits veröffentlicht wurde, enthält das Fehler-JSON zusätzlich `backupCreated: true`. Das ist weiterhin ein fehlgeschlagener Lauf mit Exitcode `24`, nicht ein vollständig erfolgreicher Zyklus.

## Backupstatus und 24-Stunden-Grenze

Der Statusbefehl benötigt keine Datenbankverbindung und verändert weder Datenbank noch Backup-Dateien:

```powershell
cd backend
$env:DB_NAME = 'fittrack'
$env:FITTRACK_BACKUP_EXPECTED_DATABASE = 'fittrack'
$env:FITTRACK_BACKUP_ACK = 'backup:fittrack'
$env:FITTRACK_BACKUP_DIR = 'D:\FitTrackBackups'
npm run db:backup:status
```

Er prüft alle zum Datenbanknamen passenden Manifeste und Artefakte inklusive gzip- und SHA-256-Integrität. Das jüngste `completedAt` ist bei einem Alter **grösser als** 86'400 Sekunden stale; exakt 24 Stunden ist noch innerhalb der Grenze. Eine Zeit mehr als fünf Minuten in der Zukunft gilt als Integritätsfehler. Das Erfolgs-JSON enthält unter `latest` Artefaktname, Completion-Zeit, Alter in Sekunden, komprimierte Grösse und SHA-256 sowie `maximumAgeSeconds: 86400`.

Mindestens täglich nach dem Erstellerlauf und zusätzlich in einem unabhängigen Monitoring-Zeitfenster ausführen. Ein Scheduler-Erfolg ohne anschliessenden Statusnachweis genügt nicht.

## UTC-GFS-Retention

Nach einem erfolgreich veröffentlichten Backup gilt die feste UTC-Policy:

- 7 neueste unterschiedliche UTC-Tages-Buckets (`daily`);
- 4 neueste unterschiedliche ISO-Wochen-Buckets (`weekly`);
- 3 neueste unterschiedliche UTC-Monats-Buckets (`monthly`);
- zusätzlich immer das insgesamt jüngste Backup.

Die tatsächlich behaltenen Dateien sind die Vereinigung dieser Buckets; ein Backup kann mehrere Buckets abdecken. Vor jeder Löschung werden alle Löschkandidaten erneut vollständig verifiziert. Automatisch gelöscht werden ausschliesslich eigene, zum exakten Datenbanknamen und Namensschema passende `.sql.gz`-/`.manifest.json`-Paare. Unbekannte Dateien, Legacy-`.sql`, fremde Datenbanknamen, verwaiste Artefakte und Manifeste ausserhalb des eigenen Musters werden nicht automatisch gelöscht. Ein ungültiges passendes Manifest oder ein Fehler beim Löschen stoppt die Retention mit Exitcode `24`; es gibt kein rekursives Verzeichnislöschen.

Managed `.sql.gz`-/Manifest-Paare nicht manuell auseinandernehmen. Legacy-Dateien dürfen erst nach dokumentierter Frist, bestätigter Off-host-Kopie und erfolgreichem Restore-Nachweis einzeln per exakt aufgelöstem Pfad entfernt werden; keine Wildcards verwenden.

## Scheduler-Prozess

Für Cron und Windows Task Scheduler gilt derselbe Betriebsprozess:

1. Einen namentlichen technischen Owner und eine Vertretung festlegen. Der Owner verantwortet Zeitplan, Secret-Rotation, Logprüfung, Alarmquittierung und Restore-Drills.
2. Unter einem dedizierten, nicht interaktiv genutzten Konto täglich in UTC zuerst `npm run db:backup:daily` und danach `npm run db:backup:status` ausführen. Zeitzone und Verhalten bei Sommerzeitwechsel dokumentieren und testen.
3. Einen nicht versionierten, nur für das Dienstkonto lesbaren Wrapper verwenden. Er setzt das Backend-Arbeitsverzeichnis, lädt die Variablen aus einem ACL-geschützten Secret Store beziehungsweise Environment-File und ruft npm auf.
4. `DB_PASSWORD`, Acknowledgements und andere sensible Werte niemals in die Cron-Zeile, Task-Argumente oder Kommandozeile schreiben. Logs dürfen nur die JSON-Resultate und Scheduler-Metadaten enthalten.
5. stdout/stderr in ein zugriffsgeschütztes JSONL-/Scheduler-Log schreiben, Rotation und Aufbewahrung festlegen und Exitcodes an das Alarmrouting übergeben.
6. Laufzeit und Lock beobachten, damit kein zweiter Zeitplan denselben Lauf überlappt. Nach jedem Fehler den unabhängigen Statuslauf beibehalten.

Beispielhafte Cron-Struktur, sofern die eingesetzte Cron-Variante `CRON_TZ` unterstützt:

```cron
CRON_TZ=UTC
15 2 * * * /opt/fittrack/ops/run-fittrack-backup >> /var/log/fittrack/backup.jsonl 2>&1
```

`run-fittrack-backup` ist ein lokal zu erstellender, geschützter Wrapper und kein Bestandteil des Repositorys. Er darf keine Secrets ausgeben. Bei einer Cron-Variante ohne `CRON_TZ` muss die Host-Zeitzone oder eine äquivalente UTC-Planung explizit dokumentiert werden.

Im Windows Task Scheduler zeigt die Action beispielsweise auf `powershell.exe` mit `-NoProfile -NonInteractive -File C:\FitTrack\ops\Run-FitTrackBackup.ps1`. Das Passwort steht nicht in `Arguments`; das ACL-geschützte Skript lädt es aus dem freigegebenen lokalen Secret-Verfahren. Die Aufgabe läuft unabhängig von einer Benutzeranmeldung unter dem dedizierten Konto, besitzt ein festes Working Directory, schreibt ein geschütztes Log und behandelt jeden Exitcode ungleich `0` als Fehler. Nach Anlage und nach Passwortrotation sind ein manueller Trigger und die Log-/Alarmzustellung zu prüfen.

## Off-host-Kopie als nachgelagerter Adapter

Der aktuelle Stage-0C-Code erstellt und verwaltet lokale externe Backup-Paare; ein Upload-Adapter ist noch nicht implementiert. Der dokumentierte nächste Schritt beginnt **erst nach** lokalem Exitcode `0`, `BACKUP_CREATED`, vollständigem Manifest-/Hash-Nachweis und erfolgreichem `db:backup:status`:

1. Genau das neue `.sql.gz` und sein `.manifest.json` als unveränderliches Paar auswählen.
2. Beide Objekte in privaten, verschlüsselten Object Storage hochladen; öffentliche Leserechte und anonyme URLs sind verboten.
3. Server-side encryption (SSE, vorzugsweise mit verwaltetem kundenspezifischem Schlüssel), Versioning und eine mit RPO/Datenschutz abgestimmte Lifecycle-/Löschpolicy aktivieren.
4. Eine separate Upload-Rolle mit Schreibrecht nur auf den vorgesehenen Bucket/Prefix verwenden. Restore-Leserechte liegen bei einer getrennten Recovery-Rolle; die Anwendung selbst erhält keine Bucket-Rechte.
5. Region, Datenresidenz, Datenschutzklassifikation, Schlüsselstandort, Anbieter-Backups und Löschfristen vor Aktivierung freigeben.
6. Übertragene Objektgrösse und Checksumme gegen das lokale Manifest prüfen, Objektversion/Remote-ID protokollieren und Uploadfehler alarmieren. Ein fehlgeschlagener Upload darf keinen lokalen Erfolg vortäuschen.
7. Regelmässig eine konkrete Objektversion in ein isoliertes Verzeichnis herunterladen, Manifest und beide Hashes lokal prüfen und sie im monatlichen Restore-Drill verwenden.

Dieser Adapter muss als eigener, getesteter und beobachteter Schritt implementiert werden. Object-Storage-Lifecycle und lokale 7/4/3-Retention sind getrennte Policies; keine von beiden darf stillschweigend die andere ersetzen.

## Restore in eine neue Wegwerf-Datenbank

Ein Restore löscht und erstellt die explizit benannte Zieldatenbank neu. Er ist nur zulässig, wenn alle Guards erfüllt sind:

- `NODE_ENV=test`;
- `ALLOW_TEST_DB_RESET=true`;
- `DB_HOST` ist `localhost`, `127.0.0.1` oder `::1`;
- `DB_NAME` beginnt mit `fittrack_test`, `fittrack_e2e` oder `fittrack_restore` und enthält danach nur klar begrenzte alphanumerische `_`-Segmente;
- `FITTRACK_RESTORE_ACK=restore-local-test-database`;
- `FITTRACK_RESTORE_FILE` zeigt auf eine lesbare `.sql.gz`- oder Legacy-`.sql`-Datei.

Beispiel:

```powershell
cd backend
$env:NODE_ENV = 'test'
$env:ALLOW_TEST_DB_RESET = 'true'
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3306'
$env:DB_USER = '<datenbankbenutzer>'
$env:DB_NAME = 'fittrack_restore_drill202607'
$env:FITTRACK_DB_CONTAINER = 'fittrack_mysql'
$env:FITTRACK_RESTORE_FILE = 'D:\FitTrackBackups\fittrack-<UTC-Zeitstempel>.sql.gz'
$env:FITTRACK_RESTORE_ACK = 'restore-local-test-database'
npm run db:restore:test
```

Für `.sql.gz` ist das benachbarte Manifest mit dem Namen `<dump>.manifest.json` zwingend. **Vor `DROP DATABASE`** prüft das Skript Completion Marker, Datenbank-/Dateinamensbindung, komprimierte Grösse und SHA-256, vollständige gzip-Dekodierung, Rohgrösse und Roh-SHA-256 sowie Dump-Header und Tabellendefinitionen. Erst danach erstellt es das begrenzte Testziel neu und streamt den dekomprimierten Dump über `mysql` in den Container.

Ein Legacy-`.sql` bleibt unterstützt. Vor dem Drop werden Mindestgrösse, Header, Tabellendefinitionen und SHA-256 berechnet; da kein Stage-0C-Manifest vorhanden ist, muss dieser Hash zusätzlich gegen den beim manuellen Backup sicher protokollierten Sollwert verglichen werden. Für neue automatisierte Backups ist immer `.sql.gz` plus Manifest zu verwenden.

Ein erfolgreicher Restore meldet unter anderem `sourceBytes`, `sourceSha256`, `logicalBytes`, `logicalSha256`, `compression` und `restoredTables`. Exitcode `0` allein genügt nicht: Hashes müssen zur Quelle passen, `restoredTables` muss plausibel sein und die folgenden Integritäts-/Anwendungstests müssen bestehen.

## Migration und Datenintegrität nach Restore

Vor Änderungen Zeilenzahlen und Foreign Keys read-only erfassen, mindestens:

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

Zunächst nur diagnostizieren:

```powershell
npm run db:migrate:status
npm run db:migrate:doctor
```

Nur wenn der erwartete Zustand tatsächlich `pending` ist und keine Dirty-/Drift-/Unknown-/Schemafehler vorliegen, die Migration explizit für die Wegwerf-Datenbank bestätigen:

```powershell
$env:FITTRACK_MIGRATION_EXPECTED_DATABASE = $env:DB_NAME
npm run db:migrate
npm run db:migrate:doctor
npm run db:migrate
npm run db:migrate:doctor
```

Der zweite Migrationslauf muss ein No-op sein und der abschliessende Doctor muss `ready` mit Exitcode `0` melden. Bei Dirty, Drift, Unknown oder partiellem Schema nicht weiter migrieren; `MIGRATION_RECOVERY.md` verwenden.

Danach dieselben Counts und Foreign Keys erneut erfassen und mindestens prüfen:

- keine verwaisten Workouts, Workout-Übungen oder Fortschrittseinträge;
- keine verwaisten Quellverknüpfungen zwischen Fortschritt und Workout-Übung;
- keine doppelten Fortschrittseinträge pro Workout-Übung;
- alle abgeleiteten Fortschrittseinträge besitzen Quelle und Übungs-Snapshot;
- Gewicht, Sätze, Wiederholungen, Datum und 1RM stimmen mit der Quelle überein;
- Anwendung startet gegen die Kopie; `/api/health/live` und `/api/health/ready` liefern HTTP 200;
- Login sowie das Lesen eines bestehenden Workouts funktionieren, ohne Passwörter aus dem Dump zu extrahieren oder offenzulegen.

## Monatlicher Restore-Drill

Der Owner führt monatlich sowie nach wesentlichen Backup-, Restore-, Schema- oder Infrastrukturänderungen folgenden kontrollierten Drill aus:

1. Jüngstes erfolgreiches Backup anhand Status-JSON bestimmen und die dokumentierte Off-host-Objektversion in ein isoliertes Verzeichnis herunterladen. Lokale und Remote-Grösse/Checksumme protokollieren.
2. Das `.sql.gz`-/Manifest-Paar vorab validieren und die Manifestwerte für komprimierten und logischen SHA-256 in das Drill-Protokoll übernehmen.
3. Einen neuen, bisher nicht existierenden Namen wie `fittrack_restore_drill202607` verwenden; nie eine bestehende Test-, Entwicklungs- oder Produktivdatenbank wiederverwenden.
4. Mit den Restore-Guards `npm run db:restore:test` ausführen. Start-/Endzeit messen und Restore-JSON samt Hashvergleich erfassen.
5. `npm run db:migrate:doctor` ausführen. Falls kontrolliert Migrationen nötig sind, nur mit exakt passendem `FITTRACK_MIGRATION_EXPECTED_DATABASE` migrieren, No-op wiederholen und Doctor bis `ready`/Exitcode `0` prüfen.
6. Counts, Foreign Keys und Integritätsbedingungen vergleichen.
7. Die Anwendung mit `FITTRACK_AUTO_MIGRATE=false` gegen die Kopie starten, Live- und Readiness-Endpunkt prüfen, sich über einen genehmigten Testzugang anmelden und mindestens ein vorhandenes Workout read-only abrufen. Keine produktiven Aktionen oder Benachrichtigungen auslösen.
8. RPO-Alter, gesamte RTO-Dauer, Owner, Backup-/Objektversion, beide SHA-256-Werte, Doctor-/Readiness-/Login-/Workout-Ergebnis und Abweichungen protokollieren.
9. Erst nach vollständiger Beweissicherung die exakt benannte Kopie kontrolliert löschen:

```powershell
cd backend
$env:NODE_ENV = 'test'
$env:ALLOW_TEST_DB_RESET = 'true'
$env:DB_HOST = '127.0.0.1'
$env:DB_NAME = 'fittrack_restore_drill202607'
npm run db:test:drop
```

Der Drop unterliegt demselben Loopback-, Environment- und Namensschutz. Container, Named Volume, Quelldatenbank und Backup-Dateien werden dabei nicht gelöscht.

## Alarme und Reaktion

| Signal | Priorität | Reaktion |
| --- | --- | --- |
| `BACKUP_MISSING` / Exit `21` | Kritisch | Scheduler, Pfad und letzte erfolgreiche Kopie sofort prüfen; RPO-Risiko eröffnen |
| `BACKUP_STALE` / Exit `22` oder Alter > 24 h | Kritisch | RPO-Verletzung alarmieren, Backup-Ursache beheben und Status nach erfolgreichem Lauf erneut prüfen |
| `BACKUP_INTEGRITY_FAILED` oder `BACKUP_VERIFICATION_FAILED` / Exit `23` | Kritisch | Artefakt nicht restaurieren oder löschen; unveränderte Kopie sichern, Storage/Transfer untersuchen, neues Backup erzeugen |
| Konfigurations-/Targetfehler / Exit `10` | Hoch | Automation stoppen; erwartete DB, ACK, Container, Loopback und externen Pfad korrigieren; Guards nicht umgehen |
| `BACKUP_RETENTION_FAILED` / Exit `24` | Hoch | Bei `backupCreated: true` neues Paar sichern, Retention separat analysieren; keine manuelle Massenlöschung |
| `BACKUP_LOCKED` / Exit `25` | Hoch | Parallel-/hängenden Prozess prüfen; Lock nur nach dokumentierter Prozessprüfung behandeln |
| `DATABASE_TOOL_FAILED`, `DATABASE_TOOL_UNAVAILABLE` oder sonstiger Exit `20` | Hoch | Docker, Container, MySQL-Tool, Berechtigungen, freien Speicher und geschützte stderr-Details prüfen |
| Lokaler Backup-Erfolg, aber Off-host-Upload/Checksumme fehlgeschlagen | Kritisch | Lauf als nicht RPO-fähig behandeln; lokale Kopie schützen, Upload wiederholen und Remote-Verifikation dokumentieren |
| Doctor nicht `ready`, Readiness ungleich 200 oder Login/Workout-Smoke fehlgeschlagen | Kritisch | Keine Umschaltung/Freigabe; Restore-Kopie erhalten, Migration-Recovery und Anwendungslogs untersuchen |
| Monatlicher Drill überfällig oder RTO > 4 h | Hoch | Owner und Pilotverantwortung alarmieren, Drill nachholen beziehungsweise Recovery-Plan verbessern |

Monitoring erfasst mindestens letzten erfolgreichen Completion-Zeitpunkt, Alter, Artefaktgrösse und SHA-256, lokalen und Off-host-Status, Retentionresultat, Restore-/RTO-Dauer, Doctor-/Readiness-Ergebnis, zuständigen Owner und Alarmquittierung. Secrets, Dump-Inhalte und Zugangsdaten dürfen nie als Metrik oder Logfeld erscheinen.

Vor einem produktiven Einsatz sind ein freigegebener Off-host-Adapter, verschlüsselter und versionierter Storage, getrennte Least-Privilege-Rollen, Secret Store, Alarmrouting, Datenschutz-/Löschfreigabe sowie ein vollständig gemessener Disaster-Recovery-Test zwingend.

## Ergänzung für Stufe 1A

Logische Backups enthalten nach Migration 005 zusätzlich die Tabellen
`studios`, `studio_memberships`, `studio_invitations` und
`studio_audit_events`. Einladungsträger selbst sind nicht enthalten: Die
Datenbank speichert ausschließlich 32-Byte-SHA-256-Digests. Ein Dump ist dennoch
personenbezogen und enthält E-Mail-Adressen aus noch offenen Einladungen; Zugriff,
Verschlüsselung und Aufbewahrung bleiben entsprechend streng.

Vor und nach einem Stage-1A-Backup/Restore mindestens diese Counts erfassen:

```sql
SELECT COUNT(*) FROM studios;
SELECT COUNT(*) FROM studio_memberships;
SELECT COUNT(*) FROM studio_invitations;
SELECT COUNT(*) FROM studio_audit_events;
```

Zusätzliche Restore-Invarianten:

```sql
-- keine doppelte Mitgliedschaft pro Benutzer und Studio
SELECT studio_id, user_id, COUNT(*) AS total
FROM studio_memberships
GROUP BY studio_id, user_id
HAVING COUNT(*) > 1;

-- jedes Studio besitzt mindestens einen aktiven Owner
SELECT s.public_id
FROM studios s
LEFT JOIN studio_memberships sm
  ON sm.studio_id = s.id
 AND sm.role = 'owner'
 AND sm.status = 'active'
GROUP BY s.id, s.public_id
HAVING COUNT(sm.id) = 0;

-- keine verwaisten tenantbezogenen Zeilen
SELECT 'memberships' AS source, COUNT(*) AS total
FROM studio_memberships sm LEFT JOIN studios s ON s.id = sm.studio_id
WHERE s.id IS NULL
UNION ALL
SELECT 'invitations', COUNT(*)
FROM studio_invitations si LEFT JOIN studios s ON s.id = si.studio_id
WHERE s.id IS NULL
UNION ALL
SELECT 'audit', COUNT(*)
FROM studio_audit_events sae LEFT JOIN studios s ON s.id = sae.studio_id
WHERE s.id IS NULL;
```

Alle Abfragen müssen null Zeilen beziehungsweise `total = 0` liefern. Zusätzlich
müssen offene Token-Hashes genau 32 Byte lang sein, Rollen/Statuswerte den Checks
entsprechen und ein fremder Testbenutzer darf über öffentliche oder erratene
interne IDs keine Studiodaten lesen.

Ein Stage-1A-Restore-Drill umfasst nach Doctor/Readiness mindestens:

1. Login eines bestehenden persönlichen Testbenutzers und read-only Abruf eines
   bestehenden persönlichen Workouts;
2. Abruf der autorisierten Studioliste;
3. read-only Abruf einer bekannten eigenen Studio-Mitgliedschaft;
4. negative Abfrage derselben Studio-ID durch einen fremden Testbenutzer;
5. Vergleich eines bekannten Audit-Ereignisses ohne Ausgabe von Token- oder
   vollständigen Requestdaten.

Im Restore-Drill werden keine Einladungen versendet oder angenommen. Development-
Outbox, E-Mail-Provider und sonstige externe Benachrichtigungen bleiben deaktiviert.
Die monatliche Drill-Dokumentation nimmt zusätzlich Migration-005-Status,
Studio-/Membership-/Invitation-/Audit-Counts, Owner-Invariante und Ergebnis des
negativen Tenant-Smokes auf.

## Ergänzung für Stufe 1B.1

Logische Backups enthalten nach Migration 006 zusätzlich die Tabellen
`studio_coaching_relationships`, `studio_training_programs`,
`studio_training_program_versions`, `studio_training_program_days`,
`studio_training_program_exercises` und `studio_program_assignments`. Migration 006
ist additiv: Sie legt ausschließlich neue Tabellen an und verändert weder die
Stage-0/1A-Tabellen noch deren Zeilen. Personendaten aus persönlichen Trainings
(`workouts`, `workout_exercises`, `progress_entries`) bleiben unverändert und von
Stage-1B.1-Tabellen vollständig entkoppelt; Übungsnamen in Trainingsprogrammen sind
Text-Snapshots (`exercise_name_snapshot`) ohne Fremdschlüssel auf die persönliche
`exercises`-Tabelle. Ein Dump ist weiterhin personenbezogen: Er enthält u. a.
Trainer-/Mitglied-Zuordnungen (Coaching-Beziehungen) und deren Zeitstempel; Zugriff,
Verschlüsselung und Aufbewahrung bleiben entsprechend streng.

Vor und nach einem Stage-1B.1-Backup/Restore mindestens diese Counts erfassen:

```sql
SELECT COUNT(*) FROM studio_coaching_relationships;
SELECT COUNT(*) FROM studio_training_programs;
SELECT COUNT(*) FROM studio_training_program_versions;
SELECT COUNT(*) FROM studio_training_program_days;
SELECT COUNT(*) FROM studio_training_program_exercises;
SELECT COUNT(*) FROM studio_program_assignments;
```

Zusätzliche Restore-Invarianten:

```sql
-- höchstens eine aktive Coaching-Beziehung pro Coach-Mitglied-Paar
SELECT coach_membership_id, member_membership_id, COUNT(*) AS total
FROM studio_coaching_relationships
WHERE status = 'active'
GROUP BY coach_membership_id, member_membership_id
HAVING COUNT(*) > 1;

-- Coach und Mitglied einer Beziehung dürfen nie dieselbe Mitgliedschaft sein
SELECT COUNT(*) AS total
FROM studio_coaching_relationships
WHERE coach_membership_id = member_membership_id;

-- Versionsnummern sind pro Programm eindeutig und ab 1 fortlaufend positiv
SELECT program_id, version_number, COUNT(*) AS total
FROM studio_training_program_versions
GROUP BY program_id, version_number
HAVING COUNT(*) > 1;

-- veröffentlichte Versionen besitzen einen Veröffentlichungszeitpunkt,
-- Entwürfe keinen
SELECT id, public_id FROM studio_training_program_versions
WHERE (status = 'published' AND published_at IS NULL)
   OR (status = 'draft' AND published_at IS NOT NULL);

-- Positionen sind pro Version bzw. pro Tag eindeutig
SELECT program_version_id, position, COUNT(*) AS total
FROM studio_training_program_days
GROUP BY program_version_id, position
HAVING COUNT(*) > 1;
SELECT program_day_id, position, COUNT(*) AS total
FROM studio_training_program_exercises
GROUP BY program_day_id, position
HAVING COUNT(*) > 1;

-- jede Zuweisung ist an eine aktive oder beendete Coaching-Beziehung gebunden,
-- die zur selben Studio-ID gehört wie die Zuweisung selbst
SELECT pa.id
FROM studio_program_assignments pa
INNER JOIN studio_coaching_relationships cr ON cr.id = pa.coaching_relationship_id
WHERE cr.studio_id <> pa.studio_id;

-- keine verwaisten Stage-1B.1-Zeilen unterhalb eines Studios
SELECT 'coaching_relationships' AS source, COUNT(*) AS total
FROM studio_coaching_relationships cr LEFT JOIN studios s ON s.id = cr.studio_id
WHERE s.id IS NULL
UNION ALL
SELECT 'training_programs', COUNT(*)
FROM studio_training_programs tp LEFT JOIN studios s ON s.id = tp.studio_id
WHERE s.id IS NULL
UNION ALL
SELECT 'program_assignments', COUNT(*)
FROM studio_program_assignments pa LEFT JOIN studios s ON s.id = pa.studio_id
WHERE s.id IS NULL
UNION ALL
SELECT 'program_versions', COUNT(*)
FROM studio_training_program_versions pv
LEFT JOIN studio_training_programs tp ON tp.id = pv.program_id
WHERE tp.id IS NULL
UNION ALL
SELECT 'program_days', COUNT(*)
FROM studio_training_program_days d
LEFT JOIN studio_training_program_versions pv ON pv.id = d.program_version_id
WHERE pv.id IS NULL
UNION ALL
SELECT 'program_exercises', COUNT(*)
FROM studio_training_program_exercises e
LEFT JOIN studio_training_program_days d ON d.id = e.program_day_id
WHERE d.id IS NULL;

-- persönliche Trainingsdaten bleiben unverändert und ohne Bezug zu
-- Stage-1B.1-Tabellen (Snapshot statt Fremdschlüssel)
SELECT COUNT(*) FROM workouts;
SELECT COUNT(*) FROM workout_exercises;
SELECT COUNT(*) FROM progress_entries;
```

Alle Abfragen müssen null Zeilen beziehungsweise `total = 0` liefern und die beiden
Zeilenzahlen-Blöcke vor und nach dem Restore müssen für alle sechs Stage-1B.1-Tabellen
sowie für `workouts`, `workout_exercises` und `progress_entries` identisch sein.
Zusätzlich muss `npm run db:migrate:doctor` nach dem Restore weiterhin `ready` mit
Exitcode `0` melden und dabei auch die Migration `006_coach_member_training`
abdecken.

Ein Stage-1B.1-Restore-Drill ergänzt den Stage-1A-Drill um mindestens:

1. read-only Abruf der eigenen Coaching-Beziehungen durch einen bekannten
   Trainer-Testbenutzer;
2. read-only Abruf der eigenen Programmzuweisungen (`/program-assignments/me`)
   durch einen bekannten Mitglied-Testbenutzer;
3. negative Abfrage derselben Trainingsprogramm- bzw. Zuweisungs-ID durch einen
   fremden Testbenutzer aus einem anderen Studio;
4. Vergleich eines bekannten `training_program_version.published`-Audit-Ereignisses
   ohne Ausgabe von Trainingsergebnissen, Gewichten oder Wiederholungen.

Die monatliche Drill-Dokumentation nimmt zusätzlich Migration-006-Status, die sechs
Stage-1B.1-Counts, das Ergebnis der Coaching-/Zuweisungs-Invarianten und das Ergebnis
des negativen Tenant-Smokes für Trainingsprogramme auf.

## Ergänzung für Stufe 1B.2B1

Logische Backups enthalten nach Migration 007 zusätzlich die Tabellen
`studio_workout_sessions`, `studio_workout_session_exercises` und
`studio_workout_session_sets`. Migration 007 ist additiv: Sie legt ausschließlich
neue Tabellen an und verändert weder die Stage-0/1A/1B.1-Tabellen noch deren Zeilen.
Personendaten aus persönlichen Trainings (`workouts`, `workout_exercises`,
`progress_entries`) bleiben unverändert und von den Stage-1B.2B1-Tabellen vollständig
entkoppelt; eine Studio-Workout-Session schreibt zu keinem Zeitpunkt in eine dieser
drei persönlichen Tabellen.

**Schutzbedarf höher als bei Stage 1B.1.** Die Sätze in
`studio_workout_session_sets` (`actual_reps`, `actual_weight`,
`actual_duration_minutes`, `actual_distance_km`, `actual_rpe`) sind die einzigen
tatsächlichen Trainingsleistungsdaten außerhalb der rein persönlichen Tabellen und
sind laut ADR 003 als das sensibelste personenbezogene Datum der gesamten Anwendung
einzustufen. Zugriff, Verschlüsselung und Aufbewahrung eines Dumps mit diesen Tabellen
müssen mindestens so streng gehandhabt werden wie bei Stage 1B.1, im Zweifel strenger.
Ein Restore-Zielsystem für diese Tabellen darf nie weniger geschützt sein als die
Produktionsumgebung.

Vor und nach einem Stage-1B.2B1-Backup/Restore mindestens diese Counts erfassen:

```sql
SELECT COUNT(*) FROM studio_workout_sessions;
SELECT COUNT(*) FROM studio_workout_session_exercises;
SELECT COUNT(*) FROM studio_workout_session_sets;
```

Zusätzliche Restore-Invarianten:

```sql
-- Status und die zugehörigen Zeitstempel müssen konsistent sein
SELECT id FROM studio_workout_sessions
WHERE (status = 'completed' AND completed_at IS NULL)
   OR (status <> 'completed' AND completed_at IS NOT NULL)
   OR (status = 'aborted' AND aborted_at IS NULL)
   OR (status <> 'aborted' AND aborted_at IS NOT NULL);

-- der Idempotenzschlüssel ist pro Mitglied und Zuweisung eindeutig
SELECT member_membership_id, assignment_id, client_start_key, COUNT(*) AS total
FROM studio_workout_sessions
GROUP BY member_membership_id, assignment_id, client_start_key
HAVING COUNT(*) > 1;

-- Positionen sind pro Session bzw. pro Session-Übung eindeutig
SELECT workout_session_id, position, COUNT(*) AS total
FROM studio_workout_session_exercises
GROUP BY workout_session_id, position
HAVING COUNT(*) > 1;
SELECT session_exercise_id, position, COUNT(*) AS total
FROM studio_workout_session_sets
GROUP BY session_exercise_id, position
HAVING COUNT(*) > 1;

-- revision ist auf jeder mutierbaren Zeile nie negativ
SELECT 'sessions' AS source, COUNT(*) AS total FROM studio_workout_sessions WHERE revision < 0
UNION ALL
SELECT 'session_exercises', COUNT(*) FROM studio_workout_session_exercises WHERE revision < 0
UNION ALL
SELECT 'session_sets', COUNT(*) FROM studio_workout_session_sets WHERE revision < 0;

-- keine verwaisten Stage-1B.2B1-Zeilen unterhalb eines Studios bzw. einer Session
SELECT 'workout_sessions' AS source, COUNT(*) AS total
FROM studio_workout_sessions ws LEFT JOIN studios s ON s.id = ws.studio_id
WHERE s.id IS NULL
UNION ALL
SELECT 'session_exercises', COUNT(*)
FROM studio_workout_session_exercises e
LEFT JOIN studio_workout_sessions ws ON ws.id = e.workout_session_id
WHERE ws.id IS NULL
UNION ALL
SELECT 'session_sets', COUNT(*)
FROM studio_workout_session_sets st
LEFT JOIN studio_workout_session_exercises e ON e.id = st.session_exercise_id
WHERE e.id IS NULL;

-- persönliche Trainingsdaten bleiben unverändert und ohne Bezug zu
-- Stage-1B.2B1-Tabellen (Snapshot statt Fremdschlüssel, keine gemeinsame Zeile)
SELECT COUNT(*) FROM workouts;
SELECT COUNT(*) FROM workout_exercises;
SELECT COUNT(*) FROM progress_entries;
```

Alle Abfragen müssen null Zeilen beziehungsweise `total = 0` liefern und die beiden
Zeilenzahlen-Blöcke vor und nach dem Restore müssen für alle drei
Stage-1B.2B1-Tabellen sowie für `workouts`, `workout_exercises` und
`progress_entries` identisch sein. Zusätzlich muss `npm run db:migrate:doctor` nach
dem Restore weiterhin `ready` mit Exitcode `0` melden und dabei auch die Migration
`007_studio_workout_execution` abdecken.

Ein Stage-1B.2B1-Restore-Drill ergänzt den Stage-1B.1-Drill um mindestens:

1. read-only Abruf der eigenen, laufenden oder abgeschlossenen Workout-Session
   (`/workout-sessions/me`) durch einen bekannten Mitglied-Testbenutzer, ohne dass
   Trainingsergebnisse eines anderen Mitglieds sichtbar werden;
2. read-only Abruf derselben Session durch den zugeordneten Trainer-Testbenutzer über
   `/coached-members/:memberMembershipId/workout-sessions`, solange die
   Coaching-Beziehung aktiv ist;
3. negative Probe: derselbe Trainer-Testbenutzer erhält nach Beenden der
   Coaching-Beziehung (oder ohne je eine gehabt zu haben) exakt denselben
   Not-Found-Fehler wie bei einer nicht existierenden Session — kein Bypass über die
   Rolle Owner/Admin;
4. Vergleich eines bekannten `workout_session.started`-Audit-Ereignisses sowie eines
   `workout_session.completed`- bzw. `workout_session.aborted`-Ereignisses: Keines
   davon darf Gewichte, Wiederholungen, RPE, Dauer, Distanz, Notizen oder sonstige
   Leistungsdaten enthalten.

Die monatliche Drill-Dokumentation nimmt zusätzlich Migration-007-Status, die drei
Stage-1B.2B1-Counts, das Ergebnis der Session-/Übungs-/Satz-Invarianten und das
Ergebnis der negativen Coach-Zugriffsprobe auf.
