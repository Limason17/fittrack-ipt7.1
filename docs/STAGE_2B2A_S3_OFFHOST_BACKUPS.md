# Stufe 2B2A: S3-kompatible Off-host-Speicherung für verschlüsselte Backups

Stufe 2B2A erweitert die bestehende Stufe-2B1-Pipeline
(`docs/STAGE_2B1_ENCRYPTED_BACKUP_RESTORE.md`) um einen sicheren,
providerneutralen S3-kompatiblen Remote-Speicher für bereits verschlüsselte
`.ftbackup`-Dateien. Stufe 2B1 bleibt die **einzige** Quelle für
Backup-Erstellung, Formatverifikation und Restore — diese Phase fügt
ausschließlich Upload, Remote-Verifikation, Download und
Remote-Retention-Planung hinzu. Es wird keine neue Kryptografie eingeführt.

**Wichtige Abgrenzung:** Diese Phase richtet **keinen echten externen
Cloud-Bucket** ein und verbindet sich mit keinem realen AWS-/Cloudflare-/
Backblaze-Konto. Alles, was hier als „real getestet" beschrieben wird,
lief gegen eine lokale, isolierte MinIO-Testinstanz mit synthetischen
Zugangsdaten. Die tatsächliche Einrichtung und Verifikation eines echten
Off-host-Buckets bleibt ausdrücklich Stufe 2B2B vorbehalten.

## Architektur

Kein Parallel-Backup-Pfad: Der Remote-Pfad besteht aus reinen
Transport-/Verifikationsschichten oberhalb der bestehenden Stufe-2B1-Dateien.

```
encryptedBackupCreate.js  (Stufe 2B1, unverändert)
        │  erzeugt lokale .ftbackup
        ▼
encryptedBackupRemoteUpload.js
        │  liest Datei, ruft encryptedBackupVerify.js#verifyEncryptedBackup
        │  (Stufe 2B1, unverändert) auf, berechnet ciphertext-sha256,
        │  lädt via backupRemoteStorage.js#uploadObject (AWS SDK v3) hoch
        ▼
S3-kompatibler Bucket (MinIO lokal / Stufe 2B2B: echter Bucket)
        │
        ▼
encryptedBackupRemoteDownload.js / encryptedBackupRemoteVerify.js
        │  gemeinsamer Kern: encryptedBackupRemoteFetch.js
        │  Download → Hash-Prüfung → volle Stufe-2B1-Authentifizierung
        │  (encryptedBackupStream.js#readAndProcessEncryptedBackup,
        │  dieselbe Funktion, die Stufe 2B1 lokal verwendet)
        ▼
encryptedBackupRestore.js  (Stufe 2B1, unverändert) — im Remote-Drill
```

Neue Module (`backend/scripts/` bzw. `backend/config/`):

| Datei | Zweck |
| --- | --- |
| `config/backupRemoteConfig.js` | Strikt validierte S3-Konfiguration |
| `scripts/backupRemoteStorage.js` | AWS-SDK-v3-Wrapper: Client, Timeouts, Fehlernormalisierung, Upload/Download/List/Delete-Primitiven |
| `scripts/backupRemoteObjectKey.js` | Deterministischer Objektpfad, Prefix-Escape-Schutz |
| `scripts/backupRemotePreflight.js` | Read-only Bucket-Preflight (`db:backup:remote:preflight`) |
| `scripts/encryptedBackupRemoteUpload.js` | `db:backup:remote:upload` |
| `scripts/encryptedBackupRemoteCreateUpload.js` | `db:backup:remote:create-upload` (Komposition) |
| `scripts/encryptedBackupRemoteList.js` | `db:backup:remote:list` |
| `scripts/encryptedBackupRemoteFetch.js` | Gemeinsamer Download+Verify-Kern (kein eigenes CLI) |
| `scripts/encryptedBackupRemoteDownload.js` | `db:backup:remote:download` |
| `scripts/encryptedBackupRemoteVerify.js` | `db:backup:remote:verify` |
| `scripts/encryptedBackupRemoteDrill.js` | `db:backup:remote:drill` |
| `scripts/backupRemoteRetention.js` | Plan-/Apply-Logik, reused GFS aus `databaseBackupPolicy.js` |
| `scripts/encryptedBackupRemoteRetentionPlan.js` / `...Apply.js` | zugehörige CLIs |

## Threat Model

Explizit geschützt gegen (siehe Tests in `backend/test/unit/backupRemote*.test.js`
und `backend/test/integration/backupRemoteMinio.test.js`):

- Upload einer unverschlüsselten Datei — Upload läuft ausschließlich über
  `encryptedBackupRemoteUpload.js`, das jede Datei vor dem Hochladen mit der
  **echten** Stufe-2B1-Verify-Funktion authentifiziert; ein `.sql`/`.sql.gz`
  wird bereits an der Dateiendungsprüfung abgelehnt.
- Upload einer manipulierten/nicht vollständig verifizierten Datei — GCM-Auth-Fehler
  (`BACKUP_INTEGRITY_FAILED`) verhindert den Upload vollständig; kein Objekt
  entsteht remote.
- Falscher Bucket/Endpoint — strikt validierte, injizierte Konfiguration
  ohne Fallback (`config/backupRemoteConfig.js`).
- Unverschlüsselte HTTP-Verbindung in Produktion — `BACKUP_S3_ENDPOINT` muss
  in Produktion HTTPS sein, ausnahmslos; HTTP ist nur für einen expliziten
  Loopback-Endpoint außerhalb der Produktion erlaubt.
- Versehentliches Überschreiben eines Remote-Objekts — `HeadObject`-Vorabprüfung
  lehnt einen bereits existierenden Objektschlüssel ab
  (`REMOTE_OBJECT_ALREADY_EXISTS`); Downloads überschreiben nie eine
  bestehende lokale Datei.
- Unbekannte/fremde Objekte im Backup-Prefix — werden im Inventar als
  `recognized: false` markiert, nie automatisch gelöscht (Retention wie
  Preflight fassen ausschließlich erkannte `.ftbackup`-Objekte an).
- Manipulierte Remote-Metadaten — der eigene `ciphertext-sha256`-Metadatenwert
  wird gegen die tatsächlich heruntergeladenen Bytes geprüft, bevor irgendetwas
  vertraut wird.
- Unvollständige Downloads — Byte-Zähler wird gegen `ContentLength` aus
  `HeadObject` geprüft.
- Remote-Datei mit falscher Key-ID — dieselbe `BACKUP_KEY_ID_MISMATCH`-Prüfung
  wie lokal (Stufe 2B1), angewendet auf die heruntergeladene Datei vor
  jeder Veröffentlichung.
- Secrets in Logs/Prozessargumenten — nur `bucket`/`region`/`prefix`/
  `objectKey`/Hashes werden geloggt; Zugangsdaten werden nie an
  `child_process`/CLI-Argumente übergeben (nur intern an den AWS-SDK-Client).
- Implizite Verwendung persönlicher AWS-Credentials — siehe „Credential-Modell".
- Unkontrollierte Retention-Löschung — dreifache explizite Bestätigung, Dry
  Run als Standard (siehe „Retention").
- Restore direkt aus einem ungeprüften Download — der Remote-Drill restauriert
  ausschließlich aus der bereits heruntergeladenen und **erneut vollständig
  verifizierten** Kopie, nie aus rohen Netzwerkbytes.
- Klartext-SQL auf Disk — dieser gesamte Layer transportiert ausschließlich
  bereits verschlüsselte `.ftbackup`-Bytes; keine Datei in diesem Layer
  enthält oder erzeugt jemals Klartext-SQL.
- Versehentliches Committen lokaler Remote-Testartefakte — MinIO-Daten leben
  ausschließlich im Container (kein Volume-Mount), Testverzeichnisse liegen
  in `os.tmpdir()`/außerhalb des Repositorys, `.gitignore` deckt `.ftbackup`
  bereits ab.

## Objektpfad

```
<normalisiertes-prefix>/<UTC-Jahr>/<UTC-Monat>/<backup-filename>.ftbackup
```

Beispiel: `fittrack-backups/2026/07/fittrack-20260722T010203Z-a1b2c3d4.ftbackup`

`backupRemoteObjectKey.js#buildRemoteObjectKey` erzwingt:

- ausschließlich `.ftbackup`, im exakten Stufe-2B1-Namensschema
  (`fittrack-<Zeitstempel>-<Zufallshex>.ftbackup`, `BACKUP_FILENAME_PATTERN`);
- Jahr/Monat stammen aus der **authentifizierten** `createdAt` des Backups,
  nicht aus der Uploadzeit;
- keine Quelldatenbank-Passwörter, keine Benutzer-/Studioinformationen im
  Pfad — nur Zeit + neutraler Dateiname;
- `assertObjectKeyWithinPrefix` verweigert jeden Schlüssel, der das
  konfigurierte Prefix verlässt (`..`, Backslashes, führende/doppelte
  Slashes, falsche Endung) — angewendet auf Erzeugung **und** auf jeden von
  außen übergebenen Schlüssel (Download/Verify);
- keine Überschreibung: `HeadObject`-Vorabprüfung vor jedem Upload.

## Konfiguration (`backend/config/backupRemoteConfig.js`)

| Variable | Pflicht | Bedeutung |
| --- | --- | --- |
| `BACKUP_REMOTE_ENABLED` | ja (`"true"`) | Einziger Aktivierungsschalter; ohne ihn wirft jeder Remote-Befehl sofort `INVALID_BACKUP_REMOTE_CONFIG` |
| `BACKUP_REMOTE_PROVIDER` | ja | Nur `s3` unterstützt |
| `BACKUP_S3_ENDPOINT` | ja | Gültige URL; HTTPS in Produktion zwingend, HTTP nur für expliziten Loopback-Endpoint |
| `BACKUP_S3_REGION` | ja | 1–32 Zeichen, Kleinbuchstaben/Ziffern/Bindestrich |
| `BACKUP_S3_BUCKET` | ja | Striktes S3-Namensschema, keine IP-artigen Namen, keine `..` |
| `BACKUP_S3_PREFIX` | ja | Normalisierter Segmentpfad, kein `..`, kein Backslash, keine führenden/doppelten Slashes |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | ja, zusammen | Nie einzeln gesetzt, nie `AWS_ACCESS_KEY_ID`-Fallback |
| `BACKUP_S3_SESSION_TOKEN` | nein | Nur weitergereicht, wenn gesetzt |
| `BACKUP_S3_FORCE_PATH_STYLE` | nein (`false`) | Strikt `"true"`/`"false"` |
| `BACKUP_S3_UPLOAD_TIMEOUT_MS` | nein (600000) | 5 s–1 h |
| `BACKUP_S3_DOWNLOAD_TIMEOUT_MS` | nein (600000) | 5 s–1 h |
| `BACKUP_S3_OPERATION_TIMEOUT_MS` | nein (15000) | 1 s–2 min; deckt Preflight/Head/List/Delete |
| `BACKUP_S3_REQUIRE_VERSIONING` | nein (`false`) | Preflight schlägt fail-closed fehl, wenn nicht `Enabled` |
| `BACKUP_S3_REQUIRE_OBJECT_LOCK` | nein (`false`) | Preflight schlägt fail-closed fehl, wenn Provider es nicht bestätigt |
| `BACKUP_S3_SERVER_SIDE_ENCRYPTION` | nein (`none`) | `none` \| `AES256` \| `aws:kms` |
| `BACKUP_S3_KMS_KEY_ID` | nur bei `aws:kms` | Erforderlich, wird geloggt (nie Credentials) |

Bekannte Platzhalterwerte (Bucket, Access Key, Secret Key) werden abgelehnt,
analog zu `backupCryptoConfig.js`. Die Konfiguration ist vollständig
injizierbar (`readBackupRemoteConfig(env)`), niemals nur über
`process.env` erreichbar — testbar ohne echte Umgebungsvariablen zu setzen.

## Credential-Modell

`backupRemoteStorage.js#createS3Client` übergibt **immer** ein explizites,
statisches `credentials`-Objekt aus der bereits validierten Konfiguration an
den `S3Client`. Es wird nie `fromEnv()`, `fromIni()`,
`fromInstanceMetadata()`, SSO oder ein anderer Provider aus
`@aws-sdk/credential-provider-node` verwendet — dieses Paket ist zwar eine
transitive Abhängigkeit von `@aws-sdk/client-s3`, wird aber nie erreicht,
weil `credentials` nie `undefined` bleibt. `AWS_ACCESS_KEY_ID`/
`AWS_SECRET_ACCESS_KEY`/`AWS_PROFILE` werden an keiner Stelle gelesen —
automatisiert bewiesen in `backupRemoteConfig.test.js` ("never falls back to
generic AWS_* environment variables even when they are present").

## TLS-Regeln

Siehe Konfigurationstabelle oben. Zusammengefasst: **Produktion verlangt
HTTPS ausnahmslos**; ein Loopback-HTTP-Endpoint ist ausschließlich außerhalb
von `NODE_ENV=production` erlaubt (lokale MinIO-Tests). Es gibt keinen Weg,
`rejectUnauthorized: false` oder eine vergleichbare TLS-Abschwächung zu
konfigurieren — dieser Layer bietet dafür keine Option.

## Upload (`db:backup:remote:upload`, `encryptedBackupRemoteUpload.js`)

Ablauf, in dieser Reihenfolge:

1. `FITTRACK_BACKUP_REMOTE_FILE` muss existieren, `.ftbackup`-Endung haben
   und außerhalb des Repositorys liegen (`assertExternalBackupDirectory`
   wiederverwendet).
2. **Volle Stufe-2B1-Verifikation** über `encryptedBackupVerify.js#verifyEncryptedBackup`
   (dieselbe Funktion wie `db:backup:verify`) — GCM-Authentifizierung,
   Key-ID-Abgleich, unterstützte Formatversion. Erst nach Erfolg geht es weiter.
3. Dateigröße gegen `MAX_UPLOAD_BYTES` (5 GiB, S3-Einzel-PUT-Praxisgrenze)
   geprüft.
4. `ciphertext-sha256` über die volle Datei berechnet (`sha256File`,
   wiederverwendet aus `databaseTools.js`).
5. Objektschlüssel deterministisch gebildet, `HeadObject`-Vorabprüfung gegen
   Überschreiben.
6. Upload via `@aws-sdk/lib-storage`'s `Upload`-Klasse (siehe „Remote-Publish-Semantik").
7. Post-Upload-`HeadObject`: Größe und sichere Metadaten müssen übereinstimmen,
   sonst `REMOTE_METADATA_INCONSISTENT`.

Bei jedem Fehler bleibt die lokale `.ftbackup`-Datei unangetastet — dieser
Befehl löscht sie an keiner Stelle.

## Remote-Publish-Semantik

`@aws-sdk/lib-storage`'s `Upload`-Klasse wurde bewusst gewählt: Sie
entscheidet selbst zwischen einem einzelnen `PutObject` und echtem
Multipart-Upload, und bricht bei einem Fehler während eines laufenden
Multipart-Uploads automatisch mit `AbortMultipartUploadCommand` ab — ein
fehlgeschlagener Upload hinterlässt daher kein sichtbares Teilobjekt. Ein
Remote-Objekt gilt **erst** nach erfolgreichem `Upload.done()` **und**
einem anschließenden `HeadObject`, das Größe und sichere Metadaten bestätigt,
als veröffentlicht (siehe Schritt 7 oben). Da der Dateiname
kryptografisch-zufällige Bestandteile trägt (Stufe-2B1-`createBackupFilename`),
wird der berechnete finale Schlüssel direkt verwendet — kein zusätzlicher
Zwei-Phasen-Umbenennungsschritt remote nötig, solange (a) der Upload nie
überschreibt (`HeadObject`-Vorabprüfung) und (b) der Provider bei Fehlschlag
kein sichtbares Teilobjekt zeigt (durch die `Upload`-Klasse sichergestellt).
Bei unklarem Zustand (z. B. Timeout während der Veröffentlichungsprüfung)
schlägt der Befehl fail-closed mit einem stabilen Fehlercode fehl, statt
Erfolg zu behaupten.

## Metadaten

Ausschließlich die feste Allowlist aus `backupRemoteStorage.js#METADATA_ALLOWLIST`
wird jemals als Objekt-Metadaten gesetzt: `format-version`, `key-id`,
`created-at`, `ciphertext-sha256`, `source-database` (technischer
Datenbankname aus dem authentifizierten Header), `application=fittrack`,
`backup-type=encrypted-logical`. `buildMetadata()` verwirft jedes andere
Feld stillschweigend — automatisiert getestet, dass z. B. `user-email` oder
`secretAccessKey` nie durchgereicht werden. Content-Type ist immer
`application/vnd.fittrack.backup`. Es wird nie eine ACL gesetzt (siehe
unten) — weder `public-read` noch `private` wird explizit übergeben.

## Ciphertext-SHA-256-Verifikation

Beim Upload berechnet, in den Metadaten gespeichert und `ChecksumAlgorithm:
"SHA256"` an S3 übergeben (falls der Provider das unterstützt — MinIO tut
dies teilweise, AWS S3 vollständig; unabhängig davon ist der eigene
`ciphertext-sha256`-Metadatenwert die maßgebliche, providerunabhängige
Prüfgröße). Bei jedem Download wird dieser Wert erneut gegen die
tatsächlich empfangenen Bytes geprüft, **bevor** überhaupt eine
Stufe-2B1-Verifikation versucht wird.

## Download (`db:backup:remote:download`, `db:backup:remote:verify`)

Beide Befehle teilen sich denselben Kern
(`encryptedBackupRemoteFetch.js#fetchAndVerifyRemoteBackup`); der einzige
Unterschied ist, ob die lokale Datei am Ende behalten (`download`) oder
immer wieder entfernt wird (`verify`, Erfolgs- **und** Fehlerfall).

1. `FITTRACK_BACKUP_REMOTE_KEY` muss im konfigurierten Prefix liegen und auf
   `.ftbackup` enden (`assertObjectKeyWithinPrefix`).
2. Zielverzeichnis (`FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR`) muss außerhalb des
   Repositorys liegen; wird mit Modus `0700` angelegt.
3. Existiert am Ziel bereits eine gleichnamige Datei, bricht der Befehl
   **vor** jedem Netzwerkzugriff mit `REMOTE_DOWNLOAD_TARGET_EXISTS` ab.
4. `HeadObject` liefert die erwartete Größe und den erwarteten
   `ciphertext-sha256`.
5. Download in eine exklusiv angelegte (`flags:"wx", mode:0o600`)
   `.partial`-Datei, während jedes Byte gehasht wird.
6. Byte-Anzahl gegen `ContentLength`, Hash gegen die Metadaten geprüft.
7. `fsync` auf die `.partial`-Datei.
8. **Volle Stufe-2B1-Authentifizierung** gegen die `.partial`-Datei
   (dieselben Primitiven wie `db:backup:verify`, direkt aufgerufen — nicht
   über den dateiendungs-strikten CLI-Wrapper, da die Datei zu diesem
   Zeitpunkt noch `.partial` heißt).
9. Erst danach atomares `rename()` zur finalen `.ftbackup`.
10. Bei jedem Fehler/Timeout: `.partial` und ein eventuell schon
    umbenanntes Ziel werden entfernt.

Kein Klartext-SQL entsteht an irgendeinem Punkt dieses Ablaufs — es wird
ausschließlich der verschlüsselte Container gestreamt/gehasht/authentifiziert.

## Vollständiges GCM-Verify

Identisch zur lokalen Stufe-2B1-Garantie: Der Download-Layer entschlüsselt
nie „ein bisschen", um früh zu antworten — die volle
`readAndProcessEncryptedBackup`-Pipeline (Header-Parsing, AAD, GCM-Tag-Prüfung
über den gesamten Ciphertext) muss vollständig durchlaufen, bevor die Datei
als vertrauenswürdig gilt. Ein manipuliertes Remote-Objekt (auch wenn dessen
`ciphertext-sha256`-Metadaten passend zu den manipulierten Bytes neu
berechnet wurden) scheitert an dieser Stelle mit `BACKUP_INTEGRITY_FAILED` —
automatisiert bewiesen in `backupRemoteMinio.test.js`.

## Remote-Inventar (`db:backup:remote:list`)

Vollständig paginiert (`ListObjectsV2`, Schleife über `ContinuationToken`)
bis zu einer festen Sicherheitsgrenze von 10.000 Objekten
(`LIST_SAFETY_CAP`); danach `truncatedForSafety: true` statt einer
stillschweigend unvollständigen Liste. Für jedes Objekt, dessen Schlüssel
exakt dem `<prefix>/<Jahr>/<Monat>/<Dateiname>.ftbackup`-Muster entspricht,
wird zusätzlich ein `HeadObject` für die sicheren Metadaten
(Formatversion/Key-ID/Ciphertext-SHA-256) geholt. Alles andere wird mit
`recognized: false` ausgegeben, aber **nie** automatisch entfernt. Ausgabe
enthält nur: Object Key, Größe, `LastModified`, `ETag` (ausdrücklich als
technischer, providerspezifischer Wert deklariert — **kein**
Integritätsbeweis), Storage Class, Version ID, Formatversion, Key-ID,
Ciphertext-SHA-256. Keine Credentials, keine signierten URLs.

## Versioning-Prüfung

`backupRemotePreflight.js` liest `GetBucketVersioning`; ist
`BACKUP_S3_REQUIRE_VERSIONING=true` gesetzt und der Status nicht exakt
`"Enabled"`, schlägt der Preflight fail-closed mit `REMOTE_VERSIONING_REQUIRED`
fehl — automatisiert gegen einen echten, absichtlich unversionierten
MinIO-Testbucket bewiesen.

## Object-Lock-Prüfung

`GetObjectLockConfiguration` wird ehrlich ausgewertet: `"enabled"` nur bei
explizite Bestätigung durch den Provider, `"disabled"` bei
`ObjectLockConfigurationNotFoundError`, **`"unsupported"`** bei jedem
anderen Fehler — es wird nie fälschlich behauptet, Object Lock sei aktiv,
wenn der Provider das nicht bestätigt hat. Ist
`BACKUP_S3_REQUIRE_OBJECT_LOCK=true` gesetzt, genügt nur der Status
`"enabled"`. Die lokale MinIO-Testinstanz in dieser Phase läuft **ohne**
Object-Lock-Bucket (das erfordert eine Bucket-Erstellung mit `--object-lock`,
die dieser Phase bewusst nicht Teil ist); die entsprechende Preflight-Prüfung
ist dafür automatisiert mit `REMOTE_OBJECT_LOCK_REQUIRED` als
erwartetem Fehlschlag abgedeckt. Die tatsächliche Einrichtung eines echten
Object-Lock-Buckets bleibt Stufe 2B2B vorbehalten.

## Serverseitige Verschlüsselung (SSE)

Die `.ftbackup`-Datei ist bereits clientseitig mit AES-256-GCM verschlüsselt
(Stufe 2B1) — SSE ist ausschließlich Defense-in-Depth und ersetzt diese
Verschlüsselung nie. Unterstützt: `none` (Standard), `AES256`, `aws:kms`
(erfordert `BACKUP_S3_KMS_KEY_ID`, die Key-ID darf geloggt werden, nie
Credentials). Es wird keine Annahme getroffen, dass MinIO KMS unterstützt —
die lokalen Tests laufen mit `none`.

## Retention-Plan (`db:backup:remote:retention:plan` / `:apply`)

Wiederverwendet **exakt** die bestehende, dokumentierte GFS-Bucket-Auswahl
aus `databaseBackupPolicy.js#selectRetentionBackups`
(7 täglich/4 wöchentlich/3 monatlich plus stets das neueste Backup) über
einen dünnen Adapter (`backupRemoteRetention.js#toRetentionCandidate`), der
ein Remote-Inventar-Element in dieselbe `{manifest:{completedAt,
artifact:{name}}}`-Form bringt, die diese Funktion bereits erwartet — keine
zweite Retention-Implementierung.

- `plan` ist immer ein reiner Dry Run, betrachtet ausschließlich erkannte
  `.ftbackup`-Objekte im konfigurierten Prefix, listet unerkannte Objekte
  separat als übersprungen.
- `apply` löscht nur nach **drei** unabhängigen expliziten Bestätigungen:
  `BACKUP_REMOTE_RETENTION_APPLY=true`,
  `FITTRACK_REMOTE_RETENTION_BUCKET_ACK=<exakter Bucketname>`,
  `FITTRACK_REMOTE_RETENTION_PREFIX_ACK=<exaktes Prefix>`, plus ein
  hartes Limit `FITTRACK_REMOTE_RETENTION_MAX_DELETE=<Anzahl>` — überschreitet
  der Plan dieses Limit, wird **nichts** gelöscht.
- Versionierung wird berücksichtigt: Ist Bucket-Versioning aktiv, erzeugt
  `DeleteObject` nur einen Delete-Marker, keine physische Löschung — die
  Antwort meldet das ehrlich als `deletionType: "delete-marker"` statt
  fälschlich `"permanent"` zu behaupten. Permanentes Versions-Purging ist
  nicht Teil dieser Phase.
- Ein echter Scheduler bleibt außerhalb dieser Phase.

## Timeouts

| Operation | Konfigurationsquelle |
| --- | --- |
| Preflight, HeadObject, List, Delete | `BACKUP_S3_OPERATION_TIMEOUT_MS` |
| Upload | `BACKUP_S3_UPLOAD_TIMEOUT_MS` |
| Download | `BACKUP_S3_DOWNLOAD_TIMEOUT_MS` |
| Remote-Drill | Summe der obigen plus der bestehenden Stufe-2B1-Dump-/Restore-Timeouts — kein eigener Drill-Timeout-Wert, exakt wie beim lokalen Drill |

Jede Operation nutzt einen echten `AbortController`. Bei Ablauf: der
HTTP-Request wird abgebrochen (Node zerstört den zugrunde liegenden
Socket), Streams werden zerstört, ein laufender Multipart-Upload wird von
`@aws-sdk/lib-storage` automatisch abgebrochen, lokale `.partial`-Dateien
werden entfernt. Kein Secret erscheint dabei in Logs. **Wichtige
Implementierungslektion:** `@aws-sdk/lib-storage`'s `Upload`-Klasse erwartet
eine `abortController`-Option, **nicht** `abortSignal` — Letzteres wird
stillschweigend ignoriert und hätte einen Upload erzeugt, der nie wirklich
abbricht. Dieser Fehler wurde während der Entwicklung dieser Phase durch
einen echten Integrationstest gegen einen absichtlich nie antwortenden
TCP-Endpunkt gefunden und behoben (siehe „Tests").

## Cleanup

Der Remote-Drill (`db:backup:remote:drill`) räumt in einem `finally`-Block
auf: Ziel-Pool schließen, disposable Restore-Datenbank löschen, lokales
Original **und** heruntergeladenes Artefakt entfernen, Remote-Testobjekt
löschen. **Strenger als der lokale Drill:** Schlägt einer dieser
Cleanup-Schritte fehl, meldet der Remote-Drill **niemals** Erfolg — er wirft
`REMOTE_DRILL_CLEANUP_FAILED` (Exitcode 26), selbst wenn alle Kernschritte
(Erstellen, Hochladen, Herunterladen, Restaurieren, Migration Doctor)
erfolgreich waren. Das ist strenger als der lokale Stufe-2B1-Drill (der
Cleanup-Probleme nur protokolliert), weil ein zurückgelassenes Remote-Objekt
ein echtes, potenziell kostenpflichtiges Off-host-Artefakt ist, kein rein
lokales.

## Logging und Datenschutz

Sichere Events: `remote_backup_preflight_succeeded`,
`remote_backup_upload_started/succeeded/failed`,
`remote_backup_download_succeeded`, `remote_backup_verify_succeeded`,
`remote_backup_drill_succeeded`, `remote_backup_retention_planned/applied`.
Niemals geloggt: Access Key, Secret Key, Session Token, signierte URLs,
vollständige HTTP-Header, Backup-Schlüssel, DB-Passwort, SQL,
JWT-Secret, SMTP-Credentials, personenbezogene Daten. Bucket, Region,
Prefix, Object Key und sichere Hashes dürfen begrenzt ausgegeben werden.
`normalizeRemoteError()` rekonstruiert Fehlermeldungen bewusst aus einer
kleinen Allowlist von Feldern (Fehlername, HTTP-Status) statt je das rohe
SDK-Fehlerobjekt weiterzureichen.

## Fehlercodes

Erweitert den bestehenden Exit-Code-Vertrag aus
`backend/scripts/backupExitCodes.js` um zwei neue Buckets (alle bisherigen
lokalen Codes/Zuordnungen bleiben unverändert):

| Exitcode | Bedeutung | Beispiele |
| --- | --- | --- |
| `10` (bestehend) | Konfiguration/Autorisierung unsicher | `INVALID_BACKUP_REMOTE_CONFIG`, `REMOTE_OBJECT_KEY_OUTSIDE_PREFIX`, `REMOTE_VERSIONING_REQUIRED`, `REMOTE_OBJECT_LOCK_REQUIRED`, `REMOTE_BUCKET_NOT_PRIVATE`, `REMOTE_OBJECT_ALREADY_EXISTS`, `REMOTE_UPLOAD_SIZE_LIMIT_EXCEEDED`, `REMOTE_RETENTION_NOT_AUTHORIZED`, `REMOTE_DOWNLOAD_TARGET_EXISTS` |
| `23` (bestehend) | Integrität fehlgeschlagen | `REMOTE_CIPHERTEXT_HASH_MISMATCH`, `REMOTE_METADATA_INCONSISTENT`, `REMOTE_KEY_ID_MISMATCH`, `REMOTE_DOWNLOAD_INCOMPLETE` |
| `24` (bestehend) | Timeout | `REMOTE_OPERATION_TIMEOUT` |
| `25` (**neu**) | Remote nicht erreichbar/autorisiert | `REMOTE_AUTH_FAILED`, `REMOTE_BUCKET_UNAVAILABLE`, `REMOTE_OBJECT_NOT_FOUND`, `REMOTE_OPERATION_FAILED`, `REMOTE_UPLOAD_FAILED`, `REMOTE_DOWNLOAD_FAILED` |
| `26` (**neu**) | Cleanup nach ansonsten erfolgreicher Operation fehlgeschlagen | `REMOTE_DRILL_CLEANUP_FAILED`, `REMOTE_PREFLIGHT_CLEANUP_FAILED` |

Kein roher Provider-Fehler wird je ungefiltert an den CLI-Nutzer
weitergegeben — jeder Fehler wird zuerst in einen dieser Codes normalisiert.

## Windows

Alle Pfad-/Berechtigungs-Grenzen aus Stufe 2B1 gelten unverändert: `0700`/
`0600`-Modi sind auf POSIX wirksam, unter Windows/NTFS nicht durchgängig
umgesetzt — dieselbe ehrliche, bereits dokumentierte Plattformgrenze, kein
neues Risiko. Die S3-Kommunikation selbst (HTTP/HTTPS über den AWS SDK) ist
plattformunabhängig und auf Windows genauso getestet wie auf Linux
(diese Phase wurde lokal unter Windows entwickelt und verifiziert).

## Linux

CI (`.github/workflows/ci.yml`) läuft auf `ubuntu-latest`; MinIO dort per
`docker run` (kein `services:`-Block, da dieser keine benutzerdefinierten
Startbefehle unterstützt und das `minio/minio`-Image ohne `server /data`
nicht startet). Erwartetes Verhalten ist identisch zu Linux-Produktionsservern.

## Bekannte Provider-Unterschiede

- MinIO implementiert `GetPublicAccessBlock` nicht wie AWS — der Preflight
  meldet in diesem Fall ehrlich `"unknown"` statt `"private"` zu behaupten.
- MinIO unterstützt Object Lock nur für explizit mit `--object-lock`
  erstellte Buckets; ein normaler Bucket liefert
  `ObjectLockConfigurationNotFoundError`, korrekt als `"disabled"`
  interpretiert.
- `ChecksumAlgorithm: "SHA256"` beim Upload wird von AWS S3 vollständig
  unterstützt; MinIO-Unterstützung kann je nach Version variieren — die
  eigene `ciphertext-sha256`-Metadatenprüfung ist deshalb bewusst die
  maßgebliche, providerunabhängige Instanz.
- `ETag` ist bei einem via Multipart hochgeladenen Objekt kein einfacher
  MD5-Wert mehr — deshalb ausdrücklich nur als technischer Wert behandelt,
  nie als Integritätsbeweis.

## Verbleibende Grenzen

- **Kein echter externer Cloud-Bucket** — ausschließlich lokal gegen MinIO
  verifiziert; Stufe 2B2B richtet den echten Off-host-Bucket ein und
  verifiziert ihn.
- Kein echter Scheduler für Upload oder Retention-Apply.
- Keine Key-Rotation (weder Backup-Verschlüsselung noch S3-Credentials).
- Keine DB-Rollentrennung (unverändert seit Stufe 2B1).
- Kein permanentes Versions-Purging bei aktivem Bucket-Versioning.
- Objekt-Lock wird geprüft, aber kein echter Object-Lock-Bucket in dieser
  Phase eingerichtet.
- Migration 009 wurde nicht eingeführt — kein neues Anwendungsschema.

## Tests

- **Unit** (`backend/test/unit/backupRemoteConfig.test.js`,
  `backupRemoteObjectKey.test.js`, `backupRemoteStorage.test.js`,
  `backupRemoteRetention.test.js`, erweitertes `backupExitCodes.test.js`):
  Konfigurationsvalidierung (Bucket/Prefix/Endpoint/Credentials/Timeouts/SSE),
  Objektschlüssel-Erzeugung und Prefix-Escape-Schutz, Metadaten-Allowlist,
  Credential-Wiring (nie `AWS_*`-Fallback), Fehlernormalisierung,
  Retention-Guards, Exit-Code-Zuordnung.
- **Integration** (`backend/test/integration/backupRemoteMinio.test.js`,
  21 Tests, gegen eine echte lokale MinIO-Instanz und die reale lokale
  MySQL-Instanz — kein Mock): Preflight (Erfolg, Versioning-Pflicht,
  Object-Lock-Pflicht), Upload (Erfolg, manipulierte lokale Datei,
  falscher Dateityp, Kollision), Liste mit echter Mehrseiten-Pagination
  und unerkannten Objekten, Download/Remote-Verify (Erfolg, Prefix-Flucht,
  Zielkollision, manipulierte Metadaten, manipuliertes Objekt mit
  neu berechnetem Hash, falsche Key-ID), echte Upload-/Download-Timeouts
  gegen einen absichtlich nie antwortenden TCP-Endpunkt, vollständiger
  Remote-Restore-Drill, Retention-Plan/-Apply inklusive
  Maximal-Löschanzahl-Schutz.
- Keine externen Netzwerkzugriffe außer zum lokalen MinIO-Service.
