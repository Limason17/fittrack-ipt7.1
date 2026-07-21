# Stage 2B1 – Verschlüsselte Datenbank-Backups mit verifiziertem Restore-Drill

Diese Phase liefert eine produktionsnahe, providerneutrale Backup-Pipeline für
die FitTrack-MySQL-Datenbank: ein klar versioniertes, authentifiziertes
Verschlüsselungsformat (`.ftbackup`), sichere Create-/Verify-/Restore-Befehle
und einen automatisierten Restore-Drill, der Backup, Verify, Restore,
Migration Doctor und Zeilenzahlvergleich gegen eine disposable Datenbank
end-to-end beweist. **Kein** Off-host-Speicherort, keine Cloud-Credentials,
kein Object-Lock, kein Scheduler, keine DB-Rollentrennung und keine neue
Migration sind Teil dieser Phase.

## Threat Model

Das Backup enthält den vollständigen logischen Inhalt der FitTrack-Datenbank
— Benutzerkonten (bcrypt-Hashes, keine Klartextpasswörter, aber dennoch
hochsensibel), Trainings- und Fortschrittsdaten, Studio-Mitgliedschaften,
Coaching-Beziehungen, Einladungs-Metadaten (Token nur als Hash) und
Audit-Ereignisse. Angenommene Bedrohungen:

- **Verlust oder Kopieren der Backup-Datei** (USB-Stick, falscher Upload,
  kompromittierter Backup-Host, Diebstahl): Die Datei muss ohne den
  Schlüssel wertlos sein — deshalb Verschlüsselung, nicht nur Zugriffskontrolle.
- **Manipulation oder Beschädigung der Datei** (Bitflip auf Platte,
  absichtliche Veränderung durch einen Angreifer mit Schreibzugriff): Muss
  erkannt werden, bevor irgendein Byte als vertrauenswürdig behandelt wird.
- **Falscher Schlüssel** (Verwechslung, Rotation, Tippfehler): Muss
  fail-closed mit einem stabilen Fehler abbrechen, nie stillschweigend
  Datenmüll produzieren.
- **Unvollständige Schreibvorgänge** (Absturz, volle Disk, Stromausfall
  während des Dumps): Darf niemals eine scheinbar gültige, aber tatsächlich
  unvollständige Datei hinterlassen.
- **Versehentliches Committen** ins Repository: `.gitignore`-Regeln plus die
  Pflicht, `BACKUP_OUTPUT_DIRECTORY` außerhalb des Repositorys zu setzen.
- **Secrets in Logs oder Prozessargumenten**: DB-Passwort und
  Backup-Schlüssel dürfen nie in `ps`/Task-Manager, Shell-Historie oder
  strukturierten Logs erscheinen.
- **Restore in die produktive Quelldatenbank**: Ein Restore muss ein
  explizites, von der Quelle verschiedenes, eng gemustertes Wegwerfziel
  verlangen — niemals implizit `DB_NAME`.
- **Unkontrolliertes Überschreiben einer bestehenden Datenbank**: Eine
  bereits existierende Zieldatenbank wird standardmäßig abgelehnt, nicht
  stillschweigend gedroppt.
- **Temporäre unverschlüsselte Dumps auf dem Dateisystem**: mysqldump-Ausgabe
  darf zu keinem Zeitpunkt unverschlüsselt auf Disk landen — weder beim
  Erstellen noch beim Restore.

**Explizit außerhalb dieses Threat Models:** Kompromittierter Docker-Host
oder Container selbst (der Angreifer hätte dann ohnehin direkten
DB-Zugriff), Kompromittierung des Schlüsselspeichers/Secret Stores, physische
Angriffe auf laufenden Prozessspeicher (Schlüssel liegt zwangsläufig
zeitweise im RAM des Backup-Prozesses), sowie alles, was Off-host-Speicherung
oder Objekt-Storage betrifft (siehe Abgrenzung unten).

## Backup-Containerformat (`.ftbackup`)

Binärlayout, implementiert in `backend/scripts/encryptedBackupFormat.js`:

```text
Offset   Größe   Feld
0        8       Magic Bytes, ASCII "FTBACKUP"
8        1       Formatversion (uint8), aktuell 1
9        4       Headerlänge L, unsigned big-endian uint32
13       L       Header: kanonisches UTF-8-JSON — dies ist die GCM
                  Additional Authenticated Data (AAD)
13+L     …       AES-256-GCM-Ciphertext des gzip-komprimierten
                  mysqldump-Streams
Ende-16  16      GCM Authentication Tag (letzte 16 Bytes der Datei)
```

Der Ciphertext-Bereich hat kein eigenes Längenfeld — er ist implizit „alles
zwischen Header und den letzten 16 Tag-Bytes", ermittelt über die tatsächliche
Dateigröße. Das hält das Format beim Schreiben vollständig streambar, da die
Gesamtlänge des Dumps vorher nicht bekannt sein muss.

Der Header ist niemals geheim, aber immer authentifiziert — jede Manipulation
an ihm ungültig genauso wie eine Manipulation am Ciphertext. Inhalt:

```json
{
  "formatVersion": 1,
  "kind": "fittrack.mysql.encrypted-backup",
  "createdAt": "2026-07-22T10:00:00.000Z",
  "algorithm": "aes-256-gcm",
  "compression": "gzip",
  "ivBase64": "…",
  "keyId": "local-dev-2026",
  "database": "fittrack",
  "schema": {
    "appliedMigrations": ["001_initial_schema", "…", "008_studio_workout_session_feedback"],
    "migrationCount": 8
  }
}
```

Explizit **niemals** im Header: der Schlüssel selbst, DB-Passwort, JWT-Secret,
SMTP-Zugangsdaten, Benutzer- oder Trainingsdaten. Automatisiert geprüft
(`encryptedBackupFormat.test.js`).

## Kryptografie

- **AES-256-GCM** über `node:crypto`, kein selbst gebautes Kryptoprimitiv.
- **32-Byte-Schlüssel**, ausschließlich aus `BACKUP_ENCRYPTION_KEY_B64`
  (Base64), nie fest im Code, nie mit Fallback.
- **Zufälliger 12-Byte-IV pro Backup** (`crypto.randomBytes(12)`) — zwei
  Backups derselben Datenbank teilen nie IV oder Ciphertext-Bytes
  (automatisiert geprüft).
- **Authentication Tag wird zwingend geprüft**: `decipher.setAuthTag()` plus
  `final()` — jede Manipulation an Header, Ciphertext oder Tag lässt die
  Operation werfen, bevor der Aufrufer die Daten als gültig behandeln kann.
- **Header als AAD**: `cipher.setAAD(headerBytes)`/`decipher.setAAD(headerBytes)`
  binden Metadaten kryptografisch an genau diesen Ciphertext.
- Keine feste IV, kein ECB/CBC-ohne-Authentifizierung, keine
  selbstentworfene Kryptografie — ausschließlich `node:crypto`s
  AES-256-GCM-Implementierung.

### Das „Verify-vor-Trust"-Muster für Restore

Eine einzelne GCM-Authentifizierung über den gesamten (potenziell großen)
Ciphertext bedeutet: Der Tag ist erst nach dem *letzten* Byte bekannt. Ein
naives einzelnes Streaming vom Ciphertext direkt in den `mysql`-Client würde
deshalb bereits unauthentifizierte Daten an MySQL weiterreichen, bevor ein
Manipulationsversuch überhaupt erkannt werden könnte. Restore fährt deshalb
**immer zwei Durchläufe**:

1. **Pass 1 (Verify):** Datei vollständig entschlüsseln/dekomprimieren,
   Ausgabe verwerfen — identisch zum eigenständigen Verify-Befehl. Erst wenn
   dieser Durchlauf ohne Fehler durchläuft, gilt die Datei als authentisch.
2. **Pass 2 (Restore):** Erst danach ein zweiter Durchlauf, der denselben,
   bereits als authentisch bewiesenen Ciphertext erneut entschlüsselt und
   direkt in den `mysql`-Client streamt.

Das kostet einen zusätzlichen vollständigen Lese-/Entschlüsselungsdurchgang,
ist aber für die in dieser Phase realistische Datengröße vernachlässigbar und
verhindert zuverlässig, dass je ein einziges unauthentifiziertes Byte den
MySQL-Client erreicht.

## Key-Konfiguration (`backend/config/backupCryptoConfig.js`)

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `BACKUP_ENCRYPTION_KEY_B64` | ja, für alle vier Befehle | Base64, muss exakt 32 Byte ergeben; leer, ungültiges Base64 oder bekannte Platzhalter (`changeme`, ein Beispielwert aus `.env.example`, ein Nur-Nullen-Schlüssel …) werden abgelehnt |
| `BACKUP_ENCRYPTION_KEY_ID` | ja, für alle vier Befehle | 1–64 Zeichen, nur Buchstaben/Ziffern/`_`/`-`; bekannte Platzhalter (`changeme`, `example`, `test`, …) abgelehnt |
| `BACKUP_OUTPUT_DIRECTORY` | ja, nur für `create`/`drill` | Muss außerhalb des Repositorys liegen (`assertExternalBackupDirectory`, wiederverwendet aus Stufe 0C). `readBackupCryptoConfig` selbst verlangt diese Variable bewusst **nicht** — `verify`/`restore` benennen ihre Eingabedatei bereits explizit über `FITTRACK_BACKUP_VERIFY_FILE`/`FITTRACK_RESTORE_FILE` und hätten sonst eine für sie bedeutungslose Variable erzwungen bekommen. |

Kein Fallback-Schlüssel, keine impliziten Produktionsdefaults. Ein
fehlender, leerer, falsch geformter oder nicht genau 32 Byte langer Schlüssel
bricht sofort mit `INVALID_BACKUP_CRYPTO_CONFIG` ab — vor jedem Docker- oder
Datenbankzugriff. Der Schlüssel wird nirgends geloggt und erscheint nie im
Backup selbst (nur die nicht-geheime `keyId` steht im Header).

### Key-Erzeugung

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Kein anderer Erzeugungsweg (kein Passwort-basiertes KDF, kein
Klartext-Passphrase-Fallback) ist in dieser Phase vorgesehen — der Schlüssel
ist ein zufälliges 32-Byte-Secret, kein merkbares Passwort.

### Key-Aufbewahrung

Der Schlüssel gehört in einen Secret Store der Zielplattform (z. B. einen
Passwort-/Secrets-Manager, eine verschlüsselte Umgebungsvariablen-Injektion
des Deployment-Systems) — niemals in `backend/.env` in einem geteilten
Repository-Klon, niemals in Klartext-Dateien im Backup-Verzeichnis selbst,
niemals im selben Speicherort wie die Backup-Dateien (sonst kompensiert der
Zugriffsschutz des einen Ortes den anderen nicht mehr). `.env.example`
enthält ausschließlich einen abgelehnten Platzhalter.

### Key-Verlust

Ein verlorener `BACKUP_ENCRYPTION_KEY_B64` macht **jedes** damit erstellte
Backup dauerhaft unlesbar — es gibt keine Wiederherstellungshintertür, kein
Master-Secret, keinen Zweitschlüssel in dieser Phase. Das ist eine bewusste
Konsequenz „echter" Verschlüsselung, keine Lücke. Operative Konsequenz: Der
Schlüssel selbst benötigt seine eigene, vom Backup-Speicherort getrennte
Aufbewahrungs- und Wiederherstellungsstrategie, bevor diese Pipeline für
echte Produktionsdaten eingesetzt wird.

### Key-Rotation (spätere Phase)

Diese Phase liefert eine `keyId` im Header genau deshalb, damit eine
zukünftige Rotation mehrere gültige Schlüssel gleichzeitig unterstützen kann
(Verify/Restore könnten dann anhand der `keyId` den richtigen von mehreren
konfigurierten Schlüsseln auswählen). **Nicht implementiert**: Es gibt aktuell
nur genau einen aktiven Schlüssel/eine `keyId` pro Prozessaufruf; ein
Rotationsmechanismus (mehrere gleichzeitig gültige Schlüssel, automatisches
Re-Encrypt alter Backups, Ablauf-/Übergangsfristen) ist ausdrücklich einer
späteren Phase vorbehalten.

## Sicheres Dump-Verfahren

`backend/scripts/encryptedBackupCreate.js` nutzt **denselben** bereits
etablierten Weg wie die bestehenden Stufe-0B/0C-Backup-Skripte:
`docker exec <container> mysqldump …` über
`scripts/databaseTools.js#runDockerDatabaseTool` — `spawn`, Argumentarray,
`shell:false`, kein Shell-String. Das löst „sicherste plattformübergreifende
Credential-Übergabe" identisch für Windows-Entwicklung, Linux-/Produktions-
betrieb und das bestehende Docker-Setup: Es wird **keine lokale
`mysqldump`-Installation vorausgesetzt** — das Werkzeug läuft immer im
MySQL-Container selbst, der es ohnehin mitbringt.

Verwendete `mysqldump`-Flags: `--single-transaction`, `--quick`,
`--routines`, `--triggers`, `--events`, `--hex-blob`,
`--set-gtid-purged=OFF`, `--no-tablespaces`, `--skip-lock-tables`,
`--default-character-set=utf8mb4`.

### Credential-Übergabe

Das DB-Passwort wird dem Docker-Unterprozess ausschließlich über die
Prozessumgebungsvariable `MYSQL_PWD` übergeben (`spawn(..., { env: {
...process.env, MYSQL_PWD: password } })`) — **niemals** als
Kommandozeilenargument, sichtbar über `docker ps`/`ps`/Task-Manager. Es gibt
in dieser Phase keinen Bedarf für eine temporäre MySQL-Optionsdatei, da der
Docker-exec-Weg dieses Problem bereits ohne eine solche Datei löst; sollte
ein zukünftiger Nicht-Docker-Weg nötig werden, gilt dieselbe Regel wie überall
sonst im Projekt: nur im System-Temp-Verzeichnis, zufälliger Name, Löschung
in `finally`, nie ins Repository.

## Kein Klartext-Dump auf Disk (Beweis)

Datenfluss beim Erstellen:

```text
docker exec mysqldump (stdout)
  → gzip (node:zlib, im selben Docker-Tool-Aufruf als outputTransform verkettet)
  → AES-256-GCM (node:crypto, dieselbe Verkettung)
  → <backup>.ftbackup.partial
```

`runDockerDatabaseTool()` wurde um `outputTransforms` erweitert (symmetrisch
zum bereits bestehenden `inputTransforms`), sodass `child.stdout` **in einer
einzigen** `stream.pipeline()`-Kette direkt durch Gzip und Cipher bis in die
Zieldatei fließt — nirgendwo dazwischen entsteht eine Zwischendatei. Beim
Restore (`encryptedBackupRestore.js`) fließt der umgekehrte Weg ebenso als
eine Pipeline direkt in `child.stdin` des `mysql`-Clients:

```text
<backup>.ftbackup (Ciphertext-Bereich)
  → AES-256-GCM-Entschlüsselung
  → gunzip
  → docker exec mysql (stdin)
```

Automatisiert bewiesen (nicht nur behauptet): Der Restore-Test mit
absichtlich zerstörtem SQL-Inhalt (`encryptedBackupRestoreDrill.test.js`)
zeigt, dass der `mysql`-Import selbst fehlschlägt, obwohl die Verschlüsselung
gültig war — das ist nur möglich, wenn der Inhalt tatsächlich direkt
gestreamt und nicht aus einer zuvor geschriebenen Klartextdatei gelesen
wurde. Kein Test- oder Produktionscode dieser Phase schreibt den
mysqldump-Klartext an irgendeiner Stelle auf die Festplatte.

## Atomarer Schreibvorgang

1. `<finalname>.ftbackup.partial` wird exklusiv (`flags: "wx"`, `mode:
   0o600`) angelegt.
2. Header-Präfix wird zuerst geschrieben.
3. mysqldump → gzip → AES-256-GCM fließen in dieselbe Datei.
4. Nach vollständigem, fehlerfreiem Abschluss wird der GCM-Tag ermittelt und
   per positioniertem Schreibvorgang ans Dateiende angehängt, gefolgt von
   `filehandle.sync()`.
5. **Erst danach** wird die Datei atomar (`fsPromises.rename`) auf ihren
   endgültigen Namen umbenannt — das ist der einzige Moment, in dem ein
   Restore/Verify sie als vollständig ansehen könnte.
6. Bei jedem Fehler auf dem Weg: Write-Stream wird zerstört, `.partial`-Datei
   wird entfernt (`rm({force:true})`) — automatisiert geprüft, auch für den
   Fall eines fehlschlagenden Dump-Prozesses (nicht erreichbarer
   Docker-Container).

**Bekannte Grenze:** Ein Fehler auf JS-Seite (z. B. ein Schreibfehler
downstream) zerstört die beteiligten Node-Streams sofort, tötet aber den
`docker exec mysqldump`-Kindprozess nicht zwingend aktiv per Signal — dieser
bemerkt die geschlossene Pipe in der Regel selbst zeitnah (EPIPE) und beendet
sich. Dieses Verhalten ist identisch zum bereits bestehenden
Stufe-0B/0C-Backup-Code und wurde in dieser Phase nicht neu konstruiert.

## CLI-Kommandos

| Befehl | Script | Zweck |
| --- | --- | --- |
| `npm run db:backup:create` | `scripts/encryptedBackupCreate.js` | Erstellt ein verschlüsseltes `.ftbackup` |
| `npm run db:backup:verify` | `scripts/encryptedBackupVerify.js` | Authentifiziert, entschlüsselt, dekomprimiert vollständig, ohne Diskschreiben |
| `npm run db:backup:restore` | `scripts/encryptedBackupRestore.js` | Restauriert in eine explizite Wegwerf-Zieldatenbank |
| `npm run db:backup:drill` | `scripts/encryptedBackupDrill.js` | Orchestriert Create → Verify → Restore → Doctor → Vergleich → Cleanup |

### Create — Ausgabe

```json
{
  "result": "ok",
  "filename": "fittrack-20260722T100000Z-a1b2c3d4.ftbackup",
  "bytes": 12345,
  "formatVersion": 1,
  "keyId": "local-dev-2026",
  "createdAt": "2026-07-22T10:00:00.000Z",
  "durationMs": 842,
  "ciphertextSha256": "…"
}
```

Keine Secrets, kein SQL-Inhalt, keine Empfänger-/Benutzerdaten.

### Verify

Parst Magic Bytes, Formatversion und Header, authentifiziert den GCM-Tag,
entschlüsselt und dekomprimiert **vollständig** in einen zählenden/hashenden
Discard-Sink (`node:stream.Writable`, schreibt nie auf Disk) — ein bloßer
Dateihash allein genügt bewusst nicht, da er weder Schlüssel noch
Kompressions-/Dekryptionsintegrität prüft. Meldet `logicalBytes` und
`logicalSha256` des entschlüsselten Klartexts, niemals dessen Inhalt.

### Restore

Siehe „Verify-vor-Trust" oben sowie die Guards im nächsten Abschnitt.

## Restore-Guards (`encryptedBackupRestore.js`, `databaseSafety.js`)

Alle folgenden Prüfungen laufen **vor** jedem `DROP`/`CREATE DATABASE` und vor
dem eigentlichen Import:

1. `NODE_ENV=test` ist zwingend.
2. Der DB-Host muss Loopback sein (`isLoopbackHost`).
3. `FITTRACK_RESTORE_ACK=restore-local-test-database` ist zwingend
   (wiederverwendet aus Stufe 0C).
4. `FITTRACK_RESTORE_TARGET_DATABASE` ist zwingend explizit — es gibt
   **keinen** impliziten Fallback auf `DB_NAME`.
5. Die Backup-Datei wird **vollständig** authentifiziert (Pass 1, siehe
   oben), bevor irgendetwas an der Zieldatenbank passiert.
6. Der Zielname muss dem strikten Wegwerfmuster entsprechen
   (`isDisposableDatabaseName`: `fittrack_(test|e2e|restore)…`).
7. Der Zielname darf **niemals** eine MySQL-Systemdatenbank sein (`mysql`,
   `information_schema`, `performance_schema`, `sys`) — geprüft unabhängig
   vom Wegwerfmuster-Check.
8. Der Zielname darf **niemals** der Quelldatenbank aus dem authentifizierten
   Header entsprechen, und **niemals** dem aktuell konfigurierten `DB_NAME`.
9. Eine bereits existierende Zieldatenbank wird standardmäßig abgelehnt
   (`RESTORE_TARGET_ALREADY_EXISTS`) — ein Neuerstellen ist nur mit der
   expliziten, eindeutigen Bestätigung `FITTRACK_RESTORE_ALLOW_RECREATE=
   recreate-disposable-restore-target` erlaubt.
10. `DROP`/`CREATE DATABASE` verwenden `mysql2#escapeId()` zusätzlich zum
    bereits durch das Wegwerfmuster begrenzten Namen — kein
    SQL-Identifier-Injection-Pfad.

Jede dieser Prüfungen ist automatisiert getestet, unter anderem mit einer
bereits existierenden Zieldatenbank, fehlender Bestätigung und fehlendem
explizitem Zielnamen.

## Automatisierter Restore-Drill

`db:backup:drill` (`runRestoreDrill()`):

1. Verwendet die bereits konfigurierte, in diesem Prozess aktive Datenbank
   als Quelle (lokaler Entwicklungs- oder Testbestand — keine separate
   synthetische Quelle nötig).
2. Erstellt ein echtes verschlüsseltes Backup davon.
3. Verifiziert es vollständig.
4. Erzeugt einen eindeutigen Wegwerfnamen `fittrack_restore_stage2b1_<hex>`.
5. Restauriert den Backupstream dorthin (echter `docker exec mysql`-Import).
6. Führt Migration Doctor gegen die restaurierte Datenbank aus — **ohne**
   den `process.exitCode` des aufrufenden Prozesses zu verändern
   (`setExitCode: () => {}`), da der Doctor sonst den Drill-eigenen Exitcode
   überschreiben würde.
7. Vergleicht Tabellenliste und Zeilenzahlen zwischen Quelle und restaurierter
   Kopie (`information_schema.TABLES` plus `SELECT COUNT(*)` je Tabelle,
   Tabellen-/Datenbanknamen zusätzlich mit `escapeId()` abgesichert).
8. Löscht in einem **immer** ausgeführten `finally`-Block: die restaurierte
   Zieldatenbank, den erstellten `.ftbackup`-Testartefakt — unabhängig davon,
   ob der Drill erfolgreich war oder nicht. Fehler während des Cleanups
   selbst werden gesammelt und sicher geloggt (`backup_restore_drill_
   cleanup_incomplete`), verhindern aber nicht, dass die übrigen
   Cleanup-Schritte trotzdem versucht werden.

Die bereits existierende Quelldatenbank wird zu keinem Zeitpunkt verändert
oder gelöscht — der Drill liest sie nur.

## Restore-Verifikation im Drill

Geprüft wird mindestens:

- restaurierte Datenbank ist über einen frischen Pool erreichbar;
- Migration Doctor `state: "ready"`, `summary.applied: 8`, `pending: 0`,
  `dirty: 0`, `drift: 0`, `unknown: 0`, `schemaIssues: 0`, `ledgerIssues: 0`;
- alle in der Quelle vorhandenen Tabellen existieren auch im Ziel;
- Zeilenzahlen pro Tabelle stimmen exakt zwischen Quelle und Ziel überein;
- nach Abschluss verbleibt keine unverschlüsselte SQL-Datei — nur der
  `.ftbackup`-Testartefakt existierte kurzzeitig und wird im Cleanup
  entfernt, nie eine `.sql`-Datei.

Zeilenzahlen werden geloggt/verglichen, niemals einzelne Datensätze oder
personenbezogene Daten.

## Fehlerbehandlung

Automatisiert getestet (`encryptedBackupFormat.test.js`,
`backupCryptoConfig.test.js`, `databaseSafety.test.js`,
`encryptedBackupRestoreDrill.test.js`):

- fehlender Schlüssel, ungültiges Base64, Schlüssel ≠ 32 Byte, bekannte
  Platzhalter (Schlüssel und Key-ID);
- falscher Schlüssel (Tag-Verifikation schlägt fehl);
- falsche Key-ID (expliziter Vorab-Check, bevor überhaupt entschlüsselt wird);
- manipulierte Headerdaten, Bitflip im Ciphertext, manipuliertes
  Authentication Tag, abgeschnittene Datei — alle über dieselbe
  GCM-Authentifizierung erkannt;
- unbekannte Formatversion, ungültige Magic Bytes — jeweils eigener,
  stabiler Fehlercode;
- beschädigter gzip-Stream innerhalb einer sonst gültig verschlüsselten
  Datei (Dekompressionsfehler nach erfolgreicher Authentifizierung);
- Dump-Prozess schlägt fehl (nicht erreichbarer Docker-Container) — kein
  `.partial`/`.ftbackup` bleibt zurück;
- Restore-Prozess schlägt fehl (authentische, aber inhaltlich kaputte
  SQL-Nutzlast) — der reale `mysql`-Import selbst meldet den Fehler;
- Output-Verzeichnis nicht erstellbar (Pfadkomponente ist eine Datei, kein
  Verzeichnis);
- Ziel entspricht Quelldatenbank, Systemdatenbank als Ziel, bestehende
  Zieldatenbank, fehlende Bestätigung, fehlender expliziter Zielname,
  ungültiger Datenbankname — jeweils vor jedem `DROP`/`CREATE DATABASE`.

## Logging und Datenschutz

Sichere Events (`createStructuredLogger`, bereits bestehende generische
Redaktion für `password|secret|token|…`-Schlüsselnamen, 43-Zeichen-Tokens,
`Bearer`, JWTs, URL-Credentials als zusätzliches Sicherheitsnetz):
`backup_create_failed`, `backup_verify_failed`, `backup_restore_failed`,
`backup_restore_drill_failed`, `restore_drill_succeeded`,
`backup_restore_drill_cleanup_incomplete`. Enthalten ausschließlich
`requestId`-artige/technische Metadaten, niemals DB-Passwort,
Backup-Schlüssel, JWT-Secret, SMTP-Zugangsdaten, SQL-Payload oder
personenbezogene Daten. CLI-Erfolgsausgaben (stdout) enthalten ausschließlich
die in den jeweiligen Abschnitten oben aufgeführten sicheren Felder.

## Dateiberechtigungen

- **Linux:** `.ftbackup`-Dateien werden mit Modus `0o600` (nur Owner
  lesbar/schreibbar) angelegt, identisch zum bestehenden
  Stufe-0B/0C-Backup-Code.
- **Windows:** Node/NTFS setzen den POSIX-Modus `0o600` nicht durchgängig um
  — Windows-ACLs sind das eigentliche Zugriffskontrollmittel und müssen
  separat (Dateisystemrechte auf dem Backup-Verzeichnis) konfiguriert werden.
- **Dateiberechtigungen ergänzen die Verschlüsselung, ersetzen sie nicht:**
  Selbst mit vollkommen offenen Dateirechten bleibt der Inhalt ohne den
  separat aufbewahrten Schlüssel unlesbar. Umgekehrt ersetzt eine restriktive
  Berechtigung nicht die Notwendigkeit der Verschlüsselung, sobald die Datei
  das kontrollierte System verlässt (Kopie, Backup-Transport, Diebstahl).

## Docker

Alle Docker-Interaktionen laufen über das bereits bestehende, getestete
`scripts/databaseTools.js#runDockerDatabaseTool` — `docker exec <container>
mysqldump|mysql …`, `spawn`, Argumentarray, `shell:false`,
`MYSQL_PWD`-Umgebungsvariable statt CLI-Argument. Es wird kein neuer
Docker-Interaktionsweg eingeführt.

## Produktionsbetrieb

Diese Phase liefert die Backup-/Restore-**Mechanik**, keinen
Produktions-Runbook-Ersatz. Vor echtem Produktionseinsatz zusätzlich nötig
(explizit außerhalb dieser Phase, siehe Abgrenzung):

- Off-host-Speicherung mit eigenem, getestetem Upload-/Download-Adapter
  (siehe bestehende Lücke in `docs/BACKUP_RESTORE.md`, die diese Phase nicht
  schließt);
- ein Scheduler (Cron/Task Scheduler) für `db:backup:create`, analog zum
  bestehenden `db:backup:daily`-Muster, aber für den verschlüsselten Pfad;
- ein dokumentierter, überwachter Schlüssel-Lebenszyklus (Erzeugung,
  Aufbewahrung, Rotation, Verlustszenario) im Secret Store der
  Zielplattform;
- ein regelmäßiger, protokollierter Restore-Drill in einer produktionsnahen
  Umgebung, nicht nur lokal/CI.

## Verbleibende Grenzen

- Kein Off-host-Speicherort, keine Cloud-Credentials, kein Object Lock —
  bewusst nicht Teil dieser Phase.
- Kein Backup-Scheduler für den verschlüsselten Pfad.
- Keine DB-Rollentrennung (ein einzelner konfigurierter DB-Benutzer dient
  sowohl Dump als auch Restore, wie im übrigen Projekt auch).
- Keine Key-Rotation-Mechanik — nur die `keyId`-Grundlage dafür.
- Kein explizites Timeout/Abbruch-Handling für den `docker exec`-Kindprozess
  über die bereits bestehende Fehlerbehandlung hinaus — identisch zum
  bereits bestehenden Stufe-0B/0C-Backup-Code, in dieser Phase nicht neu
  konstruiert.
- Ein Restore verlangt genau eine, vorab bekannte Zieldatenbank pro Aufruf —
  kein Massen-/Parallel-Restore-Feature.
- Bounce-/Zustellungs-Themen (Stufe 2A) sind hiervon unberührt.

## Tests

- **Unit** (`backend/test/unit/backupCryptoConfig.test.js`,
  `encryptedBackupFormat.test.js`, erweitertes `databaseSafety.test.js`):
  Key-/Format-/Header-/Krypto-Validierung, alle Manipulationsszenarien aus
  „Fehlerbehandlung" oben, Restore-Guard-Funktionen isoliert.
- **Integration** (`backend/test/integration/encryptedBackupRestoreDrill.test.js`):
  ein echter End-to-End-Drill gegen die reale lokale MySQL-Instanz (kein
  Mock, kein Fake), plus gezielte Fehlerfalltests (nicht erreichbarer
  Container, bestehende Zieldatenbank, fehlende Bestätigung, fehlender
  Zielname, authentische aber inhaltlich kaputte SQL-Nutzlast,
  nicht erstellbares Ausgabeverzeichnis).
- Keine externen Netzwerkzugriffe, keine echten Produktionssecrets — der
  Verschlüsselungsschlüssel in jedem Test ist ein frisch generierter,
  zufälliger Wert, der nie das Testverzeichnis verlässt.
