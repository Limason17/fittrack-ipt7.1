# Stage 2B1 – Verschlüsselte Datenbank-Backups mit verifiziertem Restore-Drill

Diese Phase liefert eine produktionsnahe, providerneutrale Backup-Pipeline für
die FitTrack-MySQL-Datenbank: ein klar versioniertes, authentifiziertes
Verschlüsselungsformat (`.ftbackup`), sichere Create-/Verify-/Restore-Befehle
und einen automatisierten Restore-Drill, der Backup, Verify, Restore,
Migration Doctor und Zeilenzahlvergleich gegen eine disposable Datenbank
end-to-end beweist. **Kein** Off-host-Speicherort, keine Cloud-Credentials,
kein Object-Lock, kein Scheduler, keine DB-Rollentrennung und keine neue
Migration sind Teil dieser Phase.

## Release-Gate-Härtung (Folge-Commit)

Eine zweite, kritische Release-Gate-Prüfung des bereits implementierten
Stage 2B1 wurde durchgeführt, ohne die Architektur neu zu entwerfen. Dabei
gefunden und behoben:

1. **Der alte unverschlüsselte Backup-Pfad lief bisher uneingeschränkt in
   Produktion.** `dbBackup.js`/`dbBackupDaily.js` hatten **keine**
   `NODE_ENV`-Prüfung — ein Operator hätte versehentlich (oder ein
   Scheduler automatisiert) ein unverschlüsseltes `.sql`/`.sql.gz`-Backup
   in einer produktionskonfigurierten Umgebung erzeugen können, und
   `docs/BACKUP_RESTORE.md` empfahl diesen Pfad selbst weiterhin aktiv als
   Pilotbetrieb-tauglich. **Behoben:** `assertLegacyUnencryptedBackupAllowed()`
   — in Produktion ausnahmslos verboten (kein Override), außerhalb davon nur
   mit explizitem `ALLOW_LEGACY_UNENCRYPTED_BACKUP=true`, geprüft **vor**
   jeder Verzeichnis-/Lock-/Docker-Operation. Siehe „Alter Klartext-Pfad"
   unten.
2. **Kein Timeout für mysqldump/mysql/docker exec.** Jeder externe Prozess
   konnte zuvor unbegrenzt laufen. **Behoben:** `BACKUP_DUMP_TIMEOUT_MS`/
   `BACKUP_RESTORE_TIMEOUT_MS`/`BACKUP_DOCKER_OPERATION_TIMEOUT_MS`, jeweils
   streng validiert mit Min-/Max-Grenzen; SIGTERM, danach SIGKILL nach fester
   Gnadenfrist. **Dabei empirisch gefunden:** Das Beenden des *lokalen*
   `docker exec`-Client-Prozesses beendet den *entfernten* Prozess im
   Container nicht zuverlässig — bestätigt durch einen absichtlich
   hängenden Testprozess, der in `docker top` weit nach Ende des lokalen
   Clients noch sichtbar war. Behoben durch eine zusätzliche, gezielte
   Direkttötung des entfernten Prozesses über eine Umgebungsvariablen-Marke
   (`FTBACKUP_OP_ID`) und einen `/proc`-Scan — siehe „Prozess-Timeouts"
   unten für Details und Belege.
3. **Restore-Autorisierung war an `NODE_ENV=test` gekoppelt.** Ein echter
   Recovery-Lauf hätte fälschlich `NODE_ENV=test` vortäuschen müssen.
   **Behoben:** `BACKUP_RESTORE_ENABLED=true` als einziger expliziter
   Autorisierungsschalter, zusätzlich eine an den exakten Zieldatenbanknamen
   gebundene Bestätigung (`FITTRACK_RESTORE_ACK=restore:<Ziel>`) statt einer
   festen Phrase. Siehe „Restore-Freigabemodell" unten.
4. **Zwei reale Bugs beim Schreiben der neuen Tests gefunden:** Ein nicht
   gecleartes `setTimeout` im Timeout-Race hielt den Node-Prozess bis zu
   10 Minuten nach Testende am Leben (siehe „Prozess-Timeouts"); ein nicht
   abgefangenes `"error"`-Event auf dem Ausgabe-Stream (z. B. bei `EEXIST`)
   führte zu einer unabgefangenen Exception statt einer sauberen
   Promise-Ablehnung, in sowohl `encryptedBackupCreate.js` als auch
   `encryptedBackupStream.js`. Beide behoben, beide jetzt automatisiert
   regressionsgeprüft.

Composition/Format/Kryptografie aus dem ursprünglichen Commit blieben
unverändert korrekt — siehe „Kryptografie- und Containerformat-Review"
unten für die erneute, explizite Bestätigung.

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

### Prozess-Timeouts

Jeder externe `docker exec`-Aufruf (`scripts/databaseTools.js#runDockerDatabaseTool`)
erhält ein explizites Zeitlimit — kein Prozess kann unbegrenzt laufen:

| Variable | Standard | Grenzen |
| --- | --- | --- |
| `BACKUP_DUMP_TIMEOUT_MS` | 300 000 (5 min) | 5 000–3 600 000 |
| `BACKUP_RESTORE_TIMEOUT_MS` | 600 000 (10 min) | 5 000–3 600 000 |
| `BACKUP_DOCKER_OPERATION_TIMEOUT_MS` | 15 000 | 1 000–120 000 |

Ablauf bei Überschreitung: `SIGTERM` an den lokalen `docker exec`-Client,
danach eine feste Gnadenfrist (`gracePeriodMs`, intern, nicht konfigurierbar),
dann `SIGKILL` falls der lokale Client noch läuft. Danach wird
**zusätzlich** der Fehler `DATABASE_TOOL_TIMEOUT` geworfen — nach, nicht
statt, dem Aufräumversuch.

**Empirisch gefundenes und behobenes Problem:** Das Beenden des *lokalen*
`docker exec`-Client-Prozesses beendet den *entfernten*, im Container
laufenden Prozess (z. B. `mysqldump`) **nicht zuverlässig**. Nachgewiesen
durch einen absichtlich hängenden Testprozess (`sleep 9999` bzw. ein
Prozess mit `trap '' TERM`), der über `docker top` — von außerhalb des
Containers, unabhängig von im Container fehlenden Werkzeugen wie `ps` —
noch lange nach Beendigung des lokalen Clients sichtbar war. Deshalb wird
bei einem Timeout **zusätzlich** eine gezielte Direkttötung des entfernten
Prozesses ausgeführt:

1. Jeder `docker exec`-Aufruf erhält eine zufällige, einmalige Marke
   (`FTBACKUP_OP_ID`), übergeben als `--env FTBACKUP_OP_ID` (Docker
   reicht dabei den aktuellen Wert aus der lokalen Prozessumgebung durch —
   dasselbe bereits etablierte Muster wie bei `MYSQL_PWD`).
2. Bei Timeout wird ein separater, kurzer `docker exec <container> sh -c
   …`-Aufruf gestartet, der `/proc/*/environ` nach genau dieser Marke
   durchsucht und den Treffer per `kill -9` direkt im PID-Namespace des
   Containers beendet.
3. Das eingebettete Shell-Skript ist fest und unveränderlich; die einzige
   variable Eingabe (die Operation-ID) wird als Positionsargument (`$1`)
   übergeben, nie in den Skripttext eingefügt — dadurch bleibt dies frei
   von Shell-Injection trotz `sh -c`.
4. Dieser Aufräum-Aufruf selbst trägt ein Flag, das eine erneute,
   potenziell unbegrenzte Rekursion verhindert (er darf sich nicht selbst
   per Marke aufräumen, falls auch er timeout-bedingt scheitert).

Automatisiert bewiesen (`backend/test/integration/databaseToolsTimeout.test.js`,
echte Prozesse gegen den echten Container, kein Mock): ein hängender
Prozess wird erkannt und beendet; ein Prozess, der `SIGTERM` per `trap`
ignoriert, ist dennoch danach nachweislich nicht mehr vorhanden (per
`/proc`-Scan, nicht per `ps`, da dieses Basisimage kein `ps`/`pkill`
mitbringt); ein schneller, unproblematischer Aufruf wird von der Eskalation
nicht berührt.

**Windows-Hinweis:** `child.kill("SIGTERM")` ist unter Windows kein echtes
Signal — Node bildet es auf eine bedingungslose Beendigung ab, es gibt dort
also keine echte „graceful"-Phase. Die Gnadenfrist-/Hard-Kill-Eskalation ist
unter Windows dadurch faktisch ein No-op, aber harmlos, und der
Code-Pfad bleibt auf beiden Plattformen identisch.

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

### Exit-Codes (`scripts/backupExitCodes.js`)

Alle vier Kommandos beenden sich mit einem stabilen, skriptbaren Exit-Code
statt pauschal `1`:

| Exit-Code | Bedeutung | Beispiel-Fehlercodes |
| --- | --- | --- |
| `0` | Erfolg | — |
| `10` | Konfiguration/Vorbedingung unsicher, nichts wurde ausgeführt | `INVALID_BACKUP_CRYPTO_CONFIG`, `INVALID_BACKUP_TIMEOUT_CONFIG`, `BACKUP_LOCATION_FORBIDDEN`, `RESTORE_NOT_ENABLED`, `RESTORE_ACK_INVALID`, `RESTORE_TARGET_ALREADY_EXISTS`, `LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN` |
| `20` | Operativer Fehler (Docker/mysqldump/mysql schlugen fehl) | `DATABASE_TOOL_FAILED` |
| `23` | Integritäts-/Authentifizierungsfehler der Backup-Datei | `BACKUP_INTEGRITY_FAILED`, `BACKUP_INVALID_MAGIC`, `BACKUP_UNSUPPORTED_VERSION`, `BACKUP_KEY_ID_MISMATCH` |
| `24` | Ein externer Prozess wurde wegen Zeitüberschreitung beendet | `DATABASE_TOOL_TIMEOUT` |

Jeder nicht explizit zugeordnete oder fehlende Fehlercode fällt auf den
Exit-Code `20` zurück — nie auf `0`. Alle fünf Werte sind paarweise
verschieden, damit Monitoring/CI zuverlässig zwischen Fehlerklassen
unterscheiden kann.

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

## Restore-Freigabemodell

**Seit der Release-Gate-Härtung ersetzt, bewusst nicht mehr an `NODE_ENV`
gekoppelt:** Ein früherer Entwurf verlangte `NODE_ENV=test` als
Restore-Voraussetzung — das hätte einen echten Recovery-Lauf in einer
echten Incident-/Wiederherstellungsumgebung gezwungen, ein falsches
`NODE_ENV` vorzutäuschen, nur um das Werkzeug benutzen zu können.
`BACKUP_RESTORE_ENABLED=true` ist jetzt der einzige explizite
Autorisierungsschalter; `NODE_ENV` wird für die Restore-Autorisierung an
keiner Stelle mehr gelesen.

## Restore-Guards (`encryptedBackupRestore.js`, `databaseSafety.js`)

Alle folgenden Prüfungen laufen **vor** jedem `DROP`/`CREATE DATABASE` und vor
dem eigentlichen Import:

1. `BACKUP_RESTORE_ENABLED=true` ist zwingend — der einzige
   Autorisierungsschalter, unabhängig von `NODE_ENV`.
2. Der DB-Host muss Loopback sein (`isLoopbackHost`).
3. `FITTRACK_RESTORE_TARGET_DATABASE` ist zwingend explizit — es gibt
   **keinen** impliziten Fallback auf `DB_NAME`.
4. `FITTRACK_RESTORE_ACK` muss exakt `restore:<FITTRACK_RESTORE_TARGET_DATABASE>`
   sein — an den **exakten** Zielnamen gebunden, nicht nur eine feste Phrase,
   damit ein Copy-Paste-Fehler nicht versehentlich eine andere Datenbank
   bestätigt.
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
10. Eine nicht-disposable Datenbank wird nie automatisch gelöscht — die
    Wegwerfmuster-Prüfung (Punkt 6) ist eine harte Voraussetzung, nicht nur
    eine Empfehlung.

Der automatisierte Drill verwendet intern dieselbe, aber eng begrenzte
Freigabe: `BACKUP_RESTORE_ENABLED=true` plus eine an den selbst erzeugten,
eindeutigen Wegwerfnamen gebundene Bestätigung (siehe
`encryptedBackupDrill.js`).
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

Zusätzlich aus der Release-Gate-Härtung (`databaseTools.test.js`,
`databaseToolsTimeout.test.js`, `backupAutomation.test.js`,
`backupExitCodes.test.js`, `encryptedBackupRestoreDrill.test.js`):

- `LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN` — der alte Klartext-Pfad
  (`db:backup`/`db:backup:daily`) ist in Produktion ohne Override und
  überall sonst ohne explizites `ALLOW_LEGACY_UNENCRYPTED_BACKUP=true`
  gesperrt; die Prüfung läuft vor jeder Verzeichnis-/Docker-Operation, es
  wird keine Datei angelegt;
- `RESTORE_NOT_ENABLED` — `BACKUP_RESTORE_ENABLED` fehlt oder ist nicht
  exakt `"true"`; `NODE_ENV` allein genügt an keiner Stelle;
- `RESTORE_ACK_INVALID` — `FITTRACK_RESTORE_ACK` fehlt oder entspricht nicht
  exakt `restore:<Zieldatenbank>`;
- `DATABASE_TOOL_TIMEOUT` — ein `mysqldump`/`mysql`/Docker-Hilfsprozess
  überschritt sein konfiguriertes Zeitlimit; der lokale `docker exec`-Client
  wird per SIGTERM/SIGKILL beendet, und zusätzlich wird der entfernte,
  im Container laufende Prozess über eine `/proc`-Marker-Suche gezielt
  beendet (siehe „Prozess-Timeouts" oben) — beide Cleanup-Schritte laufen
  auch dann vollständig, wenn der Timeout während eines Cleanup-Laufs selbst
  erneut auftritt (Rekursionsschutz).

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
  Stufe-0B/0C-Backup-Code. Das Ausgabeverzeichnis wird, falls es neu
  angelegt werden muss, mit Modus `0o700` erstellt
  (`fs.mkdir(..., { recursive: true, mode: 0o700 })`); ein bereits
  bestehendes Verzeichnis wird nie nachträglich verändert oder geweitet.
- **Windows:** Node/NTFS setzen den POSIX-Modus `0o600`/`0o700` nicht
  durchgängig um — Windows-ACLs sind das eigentliche Zugriffskontrollmittel
  und müssen separat (Dateisystemrechte auf dem Backup-Verzeichnis)
  konfiguriert werden. Das ist eine ehrliche Plattformgrenze, keine Lücke im
  Code: Die Datei wird mit den striktesten Node/`fs`-Mitteln angelegt, die
  unter Windows verfügbar sind.
- **Exklusives Anlegen, kein stilles Überschreiben:** Die `.ftbackup`- und
  `.ftbackup.partial`-Dateien werden ausschließlich mit dem exklusiven
  `wx`-Flag geöffnet (`fs.createWriteStream(..., { flags: "wx", mode: 0o600
  })`). Existiert die Zieldatei bereits, schlägt das Schreiben mit `EEXIST`
  fehl, statt den bestehenden Inhalt zu überschreiben. Das
  `"error"`-Event des Schreibstreams wird dafür explizit abgefangen
  (`once("error", reject)`), da es unabhängig vom Callback der
  `.write()`-Aufrufe feuert — ohne diesen Listener würde ein `EEXIST`-Fehler
  als unbehandelte Exception statt als sauber behandelter Fehler auftreten.
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

## Alter Klartext-Pfad (Legacy)

Der ursprüngliche, unverschlüsselte Backup-Pfad aus Stufe 0B/0C
(`npm run db:backup`, `scripts/dbBackup.js`, sowie der automatisierte
`npm run db:backup:daily`, `scripts/dbBackupDaily.js`) blieb im Code
erhalten — er wird von bestehenden Tests weiterhin regressionsgeprüft und
war nie funktional kaputt. Die Release-Gate-Härtung hat jedoch eine echte
Produktionslücke geschlossen: Vor der Härtung gab es **keine** Prüfung, die
diesen Pfad in einer Produktionsumgebung verhindert hätte — jeder mit
Zugriff auf die Konfiguration hätte in Produktion versehentlich oder
absichtlich ein vollständig unverschlüsseltes SQL-Backup erzeugen können.

Seit der Härtung gilt (`assertLegacyUnencryptedBackupAllowed`,
`databaseSafety.js`, aufgerufen als erste Prüfung in `dbBackup.js` und
`dbBackupDaily.js`, vor jeder Verzeichnis- oder Docker-Operation):

- **In Produktion (`NODE_ENV=production`) ist der Pfad ausnahmslos
  gesperrt** — es gibt keinen Override, keine Umgebungsvariable, kein
  Konfigurationsflag, das dies aufhebt.
- In jeder anderen Umgebung ist der Pfad standardmäßig ebenfalls gesperrt
  und erfordert das explizite `ALLOW_LEGACY_UNENCRYPTED_BACKUP=true`, um
  weiterhin für historische Regressionstests oder einen lokalen
  Stufe-0-artigen Testlauf nutzbar zu sein.
- Beide Fälle scheitern mit dem stabilen Fehlercode
  `LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN`, **bevor** irgendein Verzeichnis
  angelegt, eine Sperre erworben oder ein Docker-Prozess gestartet wird —
  es entsteht nie eine Datei, die anschließend wieder gelöscht werden
  müsste.
- Es wurden keine historischen Dateien oder Tests dieses Pfades entfernt;
  die Härtung fügt ausschließlich eine vorgelagerte Sperre hinzu.

**Für den Produktivbetrieb ist ausschließlich der in diesem Dokument
beschriebene verschlüsselte Pfad (`db:backup:create`/`verify`/`restore`/
`drill`) zulässig.** Der alte Klartext-Pfad ist ab sofort nicht mehr
produktionsfähig und darf in keiner produktionsnahen Betriebsanleitung mehr
als Option dargestellt werden (siehe Korrektur in `docs/BACKUP_RESTORE.md`).

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
  `encryptedBackupFormat.test.js` (18 Tests), erweitertes
  `databaseSafety.test.js`, `backupExitCodes.test.js` (5 Tests, neu),
  `encryptedBackupNoPlaintextStaticCheck.test.js` (4 Tests, neu),
  aktualisiertes `databaseTools.test.js`, erweitertes
  `backupAutomation.test.js`): Key-/Format-/Header-/Krypto-Validierung,
  alle Manipulationsszenarien aus „Fehlerbehandlung" oben,
  Restore-Guard-Funktionen isoliert, Exit-Code-Mapping, statische
  Quelltext-Prüfung gegen `writeFile`/`createWriteStream`/`mkdtemp`/Shell-
  Umleitung, Legacy-Pfad-Sperre (Produktion, fehlender Override, kein
  Datei-Anlegen vor der Prüfung).
- **Integration** (`backend/test/integration/encryptedBackupRestoreDrill.test.js`,
  `databaseToolsTimeout.test.js` (5 Tests, neu)):
  ein echter End-to-End-Drill gegen die reale lokale MySQL-Instanz (kein
  Mock, kein Fake), plus gezielte Fehlerfalltests (nicht erreichbarer
  Container, bestehende Zieldatenbank, fehlende/falsche Freigabe, fehlender
  Zielname, authentische aber inhaltlich kaputte SQL-Nutzlast,
  nicht erstellbares Ausgabeverzeichnis), die beiden kritischen
  GCM-Tamper-Tests (Zieldatenbank wird bei manipuliertem/falschem Schlüssel
  nie angelegt), der Live-Beweis „kein Klartextartefakt irgendwo" via
  `fs.watch` plus Vorher/Nachher-Snapshots von Ausgabe- und
  Temp-Verzeichnis, der Dump-Timeout-End-to-End-Test, der
  POSIX-Berechtigungstest (0700/0600), sowie fünf echte Prozess-Timeout-Tests
  gegen den laufenden `fittrack_mysql`-Container (hängender Prozess wird
  beendet, entfernter Prozess über `/proc`-Scan nachweislich beendet,
  SIGTERM-ignorierender Prozess wird trotzdem beendet, ein schneller Prozess
  bleibt unberührt, ein explizit gesetztes Timeout greift weiterhin).
- Gesamtergebnis der Release-Gate-Härtung: Backend 432/432 Tests grün
  (278 Unit + 125 Integration + 29 Migrations-Tests), Syntax-Check über 146
  Dateien grün, `npm audit` ohne Befunde; Frontend 280/280 Unit-Tests grün,
  Produktionsbuild erfolgreich, `npm audit` ohne Befunde, 26 E2E-Szenarien
  (inkl. Axe-Smokes) grün, nach Bestätigung eines einzelnen isolierten Flakes
  in `coachFeedback.spec.js` (bestand bei isolierter Wiederholung
  aller 7 Tests der Datei) als unabhängig von den Backend-Änderungen
  eingestuft.
- Keine externen Netzwerkzugriffe, keine echten Produktionssecrets — der
  Verschlüsselungsschlüssel in jedem Test ist ein frisch generierter,
  zufälliger Wert, der nie das Testverzeichnis verlässt.
