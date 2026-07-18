# FitTrack Migration Recovery

Dieses Runbook beschreibt die kontrollierte Diagnose und Wiederherstellung nach einer fehlgeschlagenen, als `running` oder `failed` markierten beziehungsweise durch Checksum- oder Schema-Drift inkonsistenten MySQL-Migration. Es gilt für den frühen FitTrack-Einzelinstanz-Pilot.

Es gibt bewusst keine automatische Down-Migration und keine automatische Ledger-Reparatur. Ein Dirty-Eintrag kann trotz scheinbar vollständigem Schema auf unvollständige Backfills oder verletzte Datenintegrität hinweisen.

## Erkennung und Stop-Bedingungen

Folgende Signale stoppen ein Deployment:

- `npm run db:migrate:doctor` endet mit Exitcode 3 und `MIGRATION_RECOVERY_REQUIRED`;
- das Doctor-Resultat enthält `MIGRATION_DIRTY`, `MIGRATION_CHECKSUM_DRIFT`, `MIGRATION_UNKNOWN`, `MIGRATION_LEDGER_INVALID`, `MIGRATION_SCHEMA_MISMATCH` oder `MIGRATION_SCHEMA_PARTIAL`;
- `/api/health/ready` bleibt wegen Dirty-, Drift-, Unknown- oder Pending-Status auf HTTP 503;
- der Backendstart endet vor dem Listener mit einem Migrationsfehler;
- wiederholte Startversuche melden denselben Migrationsfehler.

Doctor-Exitcodes:

| Exit | Zustand | Reaktion |
| ---: | --- | --- |
| 0 | `ready` | Ledger und erwartetes Schema sind sauber |
| 2 | `pending` | kontrolliertes Migrationsfenster erforderlich |
| 3 | `recovery_required` | Deployment stoppen und dieses Runbook ausführen |
| 1 | `failed` | Konfiguration, Verbindung oder Diagnose reparieren; keine Migration starten |

Der Doctor ist read-only. Er führt ausschließlich Diagnoseabfragen aus, erwirbt keinen Migrations-Lock und verändert weder Schema, Ledger noch Geschäftsdaten.

## 1. Anwendung und Migration Owner stoppen

1. Load Balancer beziehungsweise Traffic-Umschaltung stoppen.
2. Backend, Watcher, IDE-Run-Konfigurationen, Cronjobs und Deployment-Retries beenden.
3. Sicherstellen, dass genau ein Incident Owner die weitere Datenbankarbeit koordiniert.
4. Keine weiteren `npm start`, `npm run dev`, `db:migrate` oder manuellen DDL-Befehle ausführen.

Der Doctor erwirbt absichtlich keinen Lock. Ein quieszenter Betrieb ist deshalb Voraussetzung für einen konsistenten Diagnose-Snapshot.

## 2. Beweise sichern

Ohne Credentials oder Dump-Inhalte zu protokollieren:

- UTC-Zeitpunkt, Release-/Commit-Hash und verantwortliche Person;
- sicherer Ziel-Descriptor aus Environment, Host, Port und Datenbankname;
- vollständige JSON-Ausgabe von `npm run db:migrate:doctor`;
- Ausgabe von `npm run db:migrate:status`;
- Migrations-ID, Ledgerstatus, `started_at`, `applied_at` und sicherer `failure_code`;
- relevante Startup-/Readiness-Ereignisse und Request-ID;
- aktuelle Tabellen-, Spalten-, Index-, Foreign-Key- und Check-Constraint-Metadaten.

Keine Passwörter, Tokens, Connection Strings, vollständigen Gesundheits-/Trainingsdaten oder Dump-Inhalte in Incident-Tickets kopieren.

## 3. Aktuellen Dirty-Zustand sichern

Vor jeder Reparatur ein neues logisches Backup des aktuellen Zustands erstellen. Dieses Backup ist ein Incident-Artefakt und ersetzt das letzte bekannte gute Backup nicht.

Mindestens erfassen:

- komprimiertes Artefakt und Manifest;
- SHA-256 des komprimierten Artefakts und des logischen Dumps;
- Datenbankname und Server-UUID;
- UTC-Zeitpunkt und Dateigröße;
- Exitcode und maschinenlesbaren Backupstatus.

Das Backup muss außerhalb des Repositorys liegen. Bei fehlgeschlagenem Backup keine Reparatur auf der betroffenen Datenbank beginnen.

## 4. Backup in separate Datenbank wiederherstellen

Eine neue, eindeutig benannte Wegwerf-Datenbank verwenden, beispielsweise:

```text
fittrack_restore_recovery_20260718
```

Den Ablauf aus `docs/BACKUP_RESTORE.md` verwenden. Vor dem destruktiven Erstellen des Restore-Ziels:

1. Manifest und SHA-256 prüfen.
2. Sicherstellen, dass das Ziel nicht Entwicklungs- oder Produktionsdatenbank ist.
3. Loopback-, Test- und Acknowledgement-Guards aktivieren.
4. Datenbankname und Server-UUID zwischen Hostverbindung und Container vergleichen.

Das ursprüngliche Dirty-System bleibt bis zum bestätigten Recovery-Plan unverändert.

## 5. Tatsächliches Schema vergleichen

Auf der Restore-Kopie ausführen:

```powershell
cd backend
$env:NODE_ENV = 'test'
$env:FITTRACK_MIGRATION_EXPECTED_DATABASE = $env:DB_NAME
npm run db:migrate:doctor
npm run db:migrate:status
```

`FITTRACK_MIGRATION_EXPECTED_DATABASE` muss vor jedem mutierenden
`db:migrate`-Lauf exakt dem expliziten `DB_NAME` der Restore-Kopie
entsprechen. Der read-only Doctor benötigt diese Bestätigung nicht.

Anschließend die tatsächlichen Elemente der betroffenen Migration mit dem exakten veröffentlichten Commit vergleichen:

- Tabellen und Spalten einschließlich Datentyp und Nullability;
- Primär- und Unique-Indizes einschließlich Spaltenreihenfolge;
- Foreign Keys einschließlich Delete-Regel;
- Check-Constraints;
- Ledgerzeile und erwartete Migration-Checksum;
- migrationsspezifische Backfills und Datenverknüpfungen.

Eine veröffentlichte Migrationsdatei niemals ändern, um Drift zu beseitigen.

## 6. Teilweise ausgeführte Statements identifizieren

Für jede Anweisung der betroffenen Migration festhalten:

| Statement/Schritt | Erwartet | Tatsächlich | Datenwirkung | Reparatur nötig |
| --- | --- | --- | --- | --- |
| DDL/Backfill | ja/nein | vorhanden/fehlend/abweichend | geprüft | ja/nein |

MySQL kann DDL implizit committen. Eine `failed`-Ledgerzeile bedeutet deshalb nicht, dass alle vorherigen Statements zurückgerollt wurden.

### Besondere Reihenfolge von Migration 004

Bei Migration 004 mindestens in dieser Reihenfolge prüfen:

1. Snapshot-Spalten in `workout_exercises` und `progress_entries`;
2. Snapshot-Backfills;
3. temporäre Zuordnung von Workout-Übungen;
4. `source_type` und `workout_exercise_id` samt Backfill;
5. NOT-NULL-Änderungen;
6. Unique-Indizes;
7. zusammengesetzter Foreign Key;
8. Source-Link- und Metrik-Check-Constraints.

Eine temporäre Tabelle kann nach Prozessabbruch verschwunden sein, obwohl frühere DDL- und Datenänderungen bereits committed wurden.

## 7. Manuelle Reparatur nur auf der Kopie entwickeln

- Reparatur-SQL in einem separaten, reviewbaren Incident-Dokument erstellen.
- Jede Anweisung mit erwarteter Rowcount- und Schemawirkung versehen.
- Idempotenz beziehungsweise sichere Abbruchbedingungen explizit prüfen.
- Kein `DROP DATABASE`, keine Wildcards und keine pauschale Ledger-Aktualisierung verwenden.
- Reparatur mindestens einmal auf einer frisch wiederhergestellten zweiten Kopie wiederholen.

Die Reparatur darf erst nach Peer Review gegen die betroffene Instanz geplant werden.

## 8. Integrität prüfen

Mindestens folgende Prüfungen müssen auf der reparierten Kopie jeweils erfolgreich sein:

- erwartete Counts für Benutzer, Übungen, Workouts, Workout-Übungen und Fortschritt;
- keine verwaisten Workouts, Workout-Übungen oder Progress-Einträge;
- keine verwaisten Quelllinks;
- keine doppelten Progress-Einträge pro Workout-Übung;
- abgeleitete Einträge besitzen Quelle und historischen Übungs-Snapshot;
- Gewicht, Sätze, Wiederholungen, Datum und 1RM stimmen mit der Quelle überein;
- Foreign Keys, Unique-Indizes und Check-Constraints entsprechen dem veröffentlichten Schema;
- die transaktionale Workout-/Progress-Probe hinterlässt nach Rollback keine Testdaten.

## 9. Ledger nur nach bestätigter Schemaübereinstimmung reparieren

Eine Ledger-Reparatur ist eine explizite manuelle Incident-Aktion. Voraussetzungen:

- Schema und Backfills entsprechen vollständig der veröffentlichten Migration;
- Doctor meldet keine ungeklärte Schemaabweichung mehr;
- erwartete Checksum wurde aus dem unveränderten Repository bestimmt;
- genau eine bekannte Migration und ein erlaubter Ausgangsstatus sind betroffen;
- Update-Bedingung enthält Migrations-ID, alten Status und erwartete Checksum;
- betroffene Rowcount ist exakt 1;
- Backup-Hash, Review und Verantwortliche sind dokumentiert.

Checksum-Drift niemals dadurch „lösen“, dass die Ledger-Checksum ungeprüft auf den neuen Dateiwert gesetzt wird.

## 10. Kopie vollständig testen

Nach Schema- und gegebenenfalls Ledger-Reparatur:

```powershell
$env:NODE_ENV = 'test'
$env:FITTRACK_MIGRATION_EXPECTED_DATABASE = $env:DB_NAME
npm run db:migrate:doctor
npm run db:migrate
npm run db:migrate:status
npm run db:migrate
npm run db:migrate:status
```

Erwartet:

- Doctor Exit 0;
- kein Dirty, Drift oder Unknown;
- beide Migrationsläufe `applied: []`;
- Backend startet gegen die Kopie;
- `/api/health/live` und `/api/health/ready` liefern HTTP 200;
- Registrierung/Login mit eigenem Incident-Testkonto funktionieren;
- Workout-Lesen und ein begrenzter Workout-/Progress-Smoke funktionieren;
- vollständige relevante Test-Suite ist grün.

## 11. Kontrollierte Produktionswiederherstellung

Erst nach bestandenem Kopienachweis:

1. Change-Fenster und Rollback-Entscheid bestätigen.
2. Neues unmittelbar vorheriges Backup der betroffenen Instanz erstellen.
3. Reparatur oder Restore exakt wie auf der geprüften Kopie ausführen.
4. Migration Doctor erneut ausführen.
5. Anwendung starten und Readiness mindestens zwei Minuten beobachten.
6. Smoke-Tests durchführen und Error-/Migrationlogs überwachen.
7. Bei erneutem Fehler stoppen; keinen weiteren Blindstart versuchen.

## 12. Abschluss und Auditprotokoll

Dokumentieren:

- Ursache und betroffene Migration;
- Start-/Endzeit und gemessene RTO;
- alle Backup-/Restore-Hashes;
- ausgeführte, reviewte SQL-Anweisungen;
- Doctor-, Integritäts-, Readiness- und Testergebnisse;
- verantwortliche und reviewende Personen;
- verbleibende Risiken und Folgemaßnahmen.

Nach dem Incident einen neuen automatisierten Regressionstest ergänzen. Wegwerf-Datenbanken erst nach gesichertem Abschlussprotokoll über den geschützten Drop-Befehl entfernen.

## Alarmbedingungen

| Ereignis | Schwere | Reaktion |
| --- | --- | --- |
| Dirty Migration | kritisch | Deployment stoppen, dieses Runbook starten |
| Checksum-Drift | kritisch | Deployment stoppen; veröffentlichte Datei und Ledger nicht verändern |
| Readiness länger als 2 Minuten 503 | kritisch | Rollback-/Recovery-Entscheid auslösen |
| Wiederholte Migrationfehler | kritisch | kein weiterer Startversuch ohne Analyse |
| Backup fehlgeschlagen | kritisch | Recovery-Arbeit stoppen und Backupursache beheben |
| Kein erfolgreiches Backup seit 24 Stunden | hoch | am selben Tag beheben |
