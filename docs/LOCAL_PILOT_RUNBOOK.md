# Lokaler Pilot-Runbook

Dieses Dokument beschreibt einen vollständigen, lokal reproduzierbaren Ablauf für einen FitTrack-Pilotbetrieb: von der Erstinstallation über einen realen Demoablauf mit allen vier Rollen bis zu Backup, Restore, Cleanup und Neustart. Es ersetzt nicht `README.md` (allgemeine Übersicht) oder `docs/DEPLOYMENT.md` (vollständiger technischer Betriebsvertrag) — es ist der praktische, Schritt-für-Schritt-Leitfaden für eine Person, die FitTrack lokal für einen Piloten betreiben will.

Jeder Schritt in diesem Dokument wurde im Rahmen von Stage 4A (`docs/STAGE_4A_FINAL_LOCAL_ACCEPTANCE.md`) tatsächlich ausgeführt und verifiziert. Kein Schritt dokumentiert echte Secrets — jeder Platzhalter ist als solcher erkennbar und muss lokal durch einen selbst generierten Wert ersetzt werden.

---

## 1. Voraussetzungen

- Node.js `22.17.0` (siehe `.nvmrc`), npm `10.9.2` oder kompatibel
- Docker mit Compose v2 (oder eine lokale MySQL-8-Installation)
- Ein freier lokaler Port für Backend (Standard `3001`) und Frontend (Standard `5173`) — siehe Abschnitt 12, falls bereits belegt

```powershell
node --version   # v22.17.0 erwartet
npm --version    # 10.9.2 erwartet
docker --version
```

---

## 2. Erstinstallation

```powershell
git clone https://github.com/Limason17/fittrack-ipt7.1.git
cd fittrack-ipt7.1
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

---

## 3. Sichere lokale `.env`

`backend/.env.example` enthält für alle sicherheitsrelevanten Werte (`JWT_SECRET`, `RATE_LIMIT_KEY_SECRET`) Platzhalter, die die Anwendung bewusst ablehnt, sobald `NODE_ENV=production` gesetzt ist. Für einen reinen lokalen Piloten (`NODE_ENV=development`, Standard) reichen die Platzhalter technisch aus, sollten aber trotzdem ersetzt werden:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Zweimal ausführen, die beiden Werte in `backend/.env` als `JWT_SECRET` und `RATE_LIMIT_KEY_SECRET` eintragen — **die beiden Werte müssen unterschiedlich sein**, das prüft die Anwendung beim Start (`config/rateLimitConfig.js`). Beide Secrets niemals committen oder in einem Ticket/Chat teilen.

Für einen reinen lokalen Piloten sind die übrigen Defaults in `backend/.env.example` unverändert sinnvoll (`CORS_ALLOWED_ORIGINS=http://localhost:5173`, `TRUST_PROXY_MODE=disabled`, `AUTH_COOKIE_SAME_SITE=strict`). Details zu jeder Variable stehen direkt als Kommentar in `backend/.env.example` sowie in `docs/DEPLOYMENT.md`.

---

## 4. Docker-Dienste starten

```powershell
docker compose up -d mysql
```

Startet ausschliesslich die lokale MySQL-8-Instanz (Container `fittrack_mysql`, Volume `mysql_data`). Für die Off-host-Backup-Integrationstests (nicht für den normalen Pilotbetrieb nötig) zusätzlich:

```powershell
docker compose --profile backup-test up -d minio
```

**Bekannte lokale Einschränkung:** `docker-compose.yml` vergibt für den MySQL-Dienst einen festen `container_name: fittrack_mysql`. Zwei FitTrack-Checkouts (z. B. ein normaler Checkout und ein zusätzlicher Git-Worktree oder Zweit-Klon) können deshalb nicht gleichzeitig `docker compose up -d mysql` auf derselben Maschine ausführen — der zweite Versuch schlägt mit einem Namenskonflikt fehl. Für den normalen Ein-Checkout-Pilotbetrieb ist das folgenlos.

---

## 5. Backend installieren und Datenbank initialisieren

```powershell
cd backend
npm ci
npm run db:dev:init
```

`db:dev:init` erstellt die in `DB_NAME` konfigurierte Datenbank nur, wenn sie fehlt, und wendet danach alle versionierten Migrationen an (aktuell 001–011). Der Befehl ist additiv, lässt eine bereits vorhandene Datenbank unverändert und ist in `NODE_ENV=production` gesperrt.

---

## 6. Migration Doctor

```powershell
npm run db:migrate:doctor
```

Erwartetes Ergebnis auf einer frischen oder bereits korrekt migrierten Datenbank:

```json
{"state":"ready", ..., "summary":{"applied":11,"pending":0,"dirty":0,"drift":0,"unknown":0,"schemaIssues":0,"ledgerIssues":0}}
```

Bei jedem anderen Zustand (`pending`, `dirty`, `drift`, `unknown` jeweils `> 0`) vor dem nächsten Schritt zuerst `docs/MIGRATION_RECOVERY.md` konsultieren.

---

## 7. Backend starten

```powershell
npm run dev
```

Lauscht standardmässig auf Port `3001`. Die Anwendung startet erst, wenn die Datenbank erreichbar ist und der Migrationsstatus sauber ist (siehe Abschnitt 9).

---

## 8. Frontend starten

In einem zweiten Terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Lauscht standardmässig auf Port `5173` und leitet `/api` über den in `frontend/.env` konfigurierten `API_PROXY_TARGET` an das Backend weiter.

---

## 9. Health und Readiness prüfen

```powershell
curl http://localhost:3001/api/health/live
curl http://localhost:3001/api/health/ready
```

`live` ist immer datenbankunabhängig und muss sofort `200 {"status":"live"}` liefern. `ready` prüft zusätzlich die Datenbankverbindung und den Migrationsstatus; erst `200 {"status":"ready"}` bedeutet, dass die Anwendung tatsächlich betriebsbereit ist. Ein `503` mit einem `reason`-Feld zeigt genau an, was fehlt.

---

## 10. Ersten Owner erstellen und Studio anlegen

Über die Weboberfläche (`http://localhost:5173/register`): Konto registrieren, anschliessend unter „Neues Studio“ (`/studios/new`) das erste Studio anlegen. Der registrierende Benutzer wird automatisch dessen Owner.

Alternativ direkt per API (z. B. für ein Skript):

```powershell
curl -X POST http://localhost:3001/api/users/register `
  -H "Content-Type: application/json" `
  -d '{"username":"pilot-owner","email":"owner@example.test","password":"Ein-sicheres-lokales-Passwort-1"}'

# Login liefert einen Access-Token (JSON-Feld "token") fuer den naechsten Aufruf
curl -X POST http://localhost:3001/api/users/login `
  -H "Content-Type: application/json" `
  -d '{"email":"owner@example.test","password":"Ein-sicheres-lokales-Passwort-1"}'
```

**Achtung:** Login erwartet `email`, nicht `username` — Registrierung erwartet beide.

---

## 11. Admin, Trainer und Member einladen

Als Owner/Admin unter „Mitglieder“ → „Einladen“ (`/studios/:id/invitations`) eine E-Mail-Adresse und Rolle wählen. Owner kann Admin/Trainer/Member einladen, Admin kann Trainer/Member einladen (keine Owner-Einladung).

---

## 12. Test-Mail-Verhalten

Ohne gesetztes `INVITATION_EMAIL_PROVIDER=smtp` (Standard in Entwicklung/Test) versendet FitTrack **keine echte E-Mail**. Stattdessen liefert die API-Antwort auf „Einladen“ direkt einen `delivery.acceptUrl`-Link, der im Entwicklungsmodus zusätzlich in der Backend-Konsole geloggt wird. Diesen Link öffnen, um die Einladung als eingeladener Benutzer anzunehmen. Für echten SMTP-Versand siehe die auskommentierten `SMTP_*`-Variablen in `backend/.env.example` sowie `docs/STAGE_2A_PRODUCTION_INVITATION_EMAIL.md` — für einen rein lokalen Piloten ist das nicht nötig.

---

## 13. Pilotdaten vorbereiten

Für eine Demo empfiehlt sich mindestens:

- 2 Studios (zeigt Tenant-Trennung in der UI, z. B. im Studio-Switcher)
- je 1 Owner, Admin, Trainer, Member pro Studio
- 1 Coaching-Beziehung (Trainer ↔ Member)
- 1 Trainingsprogramm mit veröffentlichter Version (Tage, Übungen)
- 1 Programmzuweisung an den Member
- 1 abgeschlossenes Workout mit Coach-Feedback

Globale Übungen sind bereits durch Migration `003_seed_global_exercises` vorhanden (14 Einträge) — keine manuelle Seed-Aktion nötig.

---

## 14. Vollständiger Demoablauf

1. Owner erstellt Studio, lädt Trainer und Member ein.
2. Trainer nimmt Einladung an, Member nimmt Einladung an.
3. Owner (oder Admin) erstellt eine Coaching-Beziehung Trainer↔Member.
4. Trainer erstellt ein Trainingsprogramm, fügt einen Tag mit Übungen hinzu, veröffentlicht die Version.
5. Trainer weist das Programm dem Member über die Coaching-Beziehung zu.
6. Member öffnet „Mein Trainingsplan“, startet die Workout-Session, protokolliert Sätze, schliesst ab.
7. Trainer öffnet „Ergebnisse“, sieht das abgeschlossene Workout, hinterlässt Feedback.
8. Member sieht das Feedback in der eigenen Workout-Historie.
9. Owner öffnet „Audit Log“ und sieht alle obigen Aktionen protokolliert.

Dieser Ablauf ist identisch zu `frontend/e2e/studioTraining.spec.js` und `frontend/e2e/workoutSessions.spec.js` und wird bei jedem E2E-Lauf automatisiert durchlaufen.

---

## 15. Backup

```powershell
cd backend
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Den Wert temporär als `BACKUP_ENCRYPTION_KEY_B64` setzen (nie committen), zusammen mit einem `BACKUP_ENCRYPTION_KEY_ID` (freier Label-Text) und `BACKUP_OUTPUT_DIRECTORY` (absoluter Pfad **ausserhalb** des Repositories):

```powershell
$env:BACKUP_ENCRYPTION_KEY_B64 = "<generierter Wert>"
$env:BACKUP_ENCRYPTION_KEY_ID = "pilot-key-2026"
$env:BACKUP_OUTPUT_DIRECTORY = "C:\fittrack-backups"
npm run db:backup:create
npm run db:backup:verify
```

`db:backup:create` erstellt eine AES-256-GCM-verschlüsselte `.ftbackup`-Datei; `db:backup:verify` prüft Integrität und Entschlüsselbarkeit, ohne etwas wiederherzustellen. Details, Schlüsselrotation und GFS-Retention stehen in `docs/STAGE_2B1_ENCRYPTED_BACKUP_RESTORE.md`.

---

## 16. Restore

Restore ist absichtlich mehrfach abgesichert und **nie** allein durch `NODE_ENV` freigegeben:

```powershell
$env:BACKUP_RESTORE_ENABLED = "true"
$env:FITTRACK_RESTORE_FILE = "C:\fittrack-backups\<dateiname>.ftbackup"
$env:FITTRACK_RESTORE_TARGET_DATABASE = "fittrack_restore_check"
$env:FITTRACK_RESTORE_ACK = "restore:fittrack_restore_check"
npm run db:backup:restore
```

Das Ziel muss ein noch nicht existierender, als Test-/Restore-Datenbank erkennbarer Name sein (`fittrack_test_*`, `fittrack_e2e_*` oder `fittrack_restore_*`) — ein Restore **überschreibt niemals** eine bestehende Datenbank und **verändert nie** die Quelldatenbank. Für einen vollautomatisierten Drill (Backup + Verify + Restore + Migration-Doctor-Prüfung + Zeilenzahlvergleich in einem Schritt, gegen eine automatisch aufgeräumte Wegwerfdatenbank):

```powershell
npm run db:backup:drill
```

---

## 17. Rate-Limit-Cleanup

Abgelaufene Rate-Limit-Buckets werden automatisch lazy bereinigt (~1 % jedes Aufrufs). Für eine manuelle, sofortige Bereinigung (z. B. vor einem Datenbank-Export):

```powershell
npm run security:rate-limits:cleanup
```

Löscht ausschliesslich bereits abgelaufene Buckets in begrenzten Batches, ist idempotent und sicher unter parallelem Betrieb.

---

## 18. Logs

Backend und Frontend loggen strukturiert (JSON, ein Ereignis pro Zeile) auf `stdout` des jeweiligen `npm run dev`-Prozesses. Rate-Limit-Logs enthalten nie E-Mail/IP/Token (siehe `docs/STAGE_3D_SECURITY_HARDENING.md` Abschnitt 16); Backup-Logs enthalten nie den Schlüssel oder Klartextdaten.

---

## 19. Stoppen

```powershell
# In den jeweiligen Terminals: Strg+C fuer Backend und Frontend
docker compose stop mysql
```

`docker compose stop` beendet nur den Container, das Datenvolume (`mysql_data`) bleibt erhalten — ein späterer `docker compose up -d mysql` stellt denselben Datenstand wieder her.

---

## 20. Neustart

```powershell
docker compose up -d mysql
cd backend && npm run dev
# zweites Terminal:
cd frontend && npm run dev
```

Kein `db:dev:init` und keine erneute `.env`-Erstellung nötig, solange das Docker-Volume erhalten blieb.

---

## 21. Häufige Fehler

| Symptom | Ursache | Lösung |
|---|---|---|
| `EADDRINUSE: address already in use :::3001` (oder `:5173`) | Ein anderer Prozess belegt bereits den Port (eigener alter Dev-Server, andere Anwendung) | Alten Prozess beenden, oder Backend mit `$env:PORT=3011` (und `frontend/.env`s `API_PROXY_TARGET` entsprechend anpassen) auf einem freien Port starten |
| `docker compose up -d mysql` meldet einen Namenskonflikt für `fittrack_mysql` | Ein zweiter Checkout/Worktree versucht denselben festen Containernamen zu belegen (siehe Abschnitt 4) | Nur einen Checkout gleichzeitig mit laufendem `fittrack_mysql` betreiben, oder den anderen Checkout-Container vorher stoppen |
| `Database is unavailable during startup` | MySQL läuft noch nicht oder ist noch nicht bereit | `docker ps` prüfen, wenige Sekunden warten, `npm run db:migrate:doctor` erneut ausführen |
| Login liefert `VALIDATION_ERROR` auf `email` | Login-Payload verwendet `username` statt `email` | Login benötigt `{"email": ..., "password": ...}`, nicht `username` (Registrierung akzeptiert beide) |
| `AUTH_REFRESH_TOKEN_INVALID` direkt nach dem Start | Alte Refresh-Cookies aus einer vorherigen `.env`-Konfiguration mit anderem `JWT_SECRET`/`RATE_LIMIT_KEY_SECRET` | Browser-Cookies für `localhost` löschen und neu anmelden |
| Migration Doctor meldet `pending`/`dirty`/`drift` | Migrationen wurden unvollständig oder ausserhalb des Migrationssystems angewendet | `docs/MIGRATION_RECOVERY.md` befolgen, niemals manuell am Schema herumschrauben |
| Frontend-Produktionsbuild schlägt unter Git Bash mit einem Vite-Pfadfehler fehl | Git Bash (MSYS) wandelt den Wert von `VITE_API_BASE_URL=/api` automatisch in einen Windows-Dateipfad um, bevor Node ihn sieht | Produktionsbuild über PowerShell ausführen (wie in CI), nicht über Git Bash |

---

## 22. Vollständiger Reset

**Destruktiv — löscht alle lokalen Daten unwiderruflich:**

```powershell
docker compose down -v
```

Entfernt Container **und** das Datenvolume. Danach ab Abschnitt 4 neu beginnen. Niemals gegen eine Datenbank mit echten, nicht gesicherten Daten ausführen, ohne vorher ein Backup (Abschnitt 15) erstellt zu haben.

Für einen reinen Anwendungs-Reset ohne Datenverlust (z. B. nach einem fehlerhaften manuellen Test) reicht stattdessen ein Neustart der Prozesse (Abschnitt 19/20) — die Datenbank bleibt dabei unangetastet.

---

## 23. Bekannte lokale Einschränkungen

- Kein Produktions-SMTP standardmässig konfiguriert — Einladungen zeigen im lokalen Betrieb einen direkten Link statt einer echten E-Mail (Abschnitt 12), das ist beabsichtigt, kein Fehler.
- Zwei FitTrack-Checkouts können nicht gleichzeitig `docker compose up -d mysql` mit demselben Containernamen ausführen (Abschnitt 4).
- Kein externer Off-host-Backup-Bucket eingerichtet (Stage 2B2B, bewusst zurückgestellt bis zu einer konkreten Kunden-/Hosting-Entscheidung) — die S3-kompatible Mechanik existiert und ist gegen eine lokale MinIO-Instanz getestet, aber nicht mit einem echten Cloud-Konto verbunden.
- Kein Scheduler für automatische, wiederkehrende Backups — `db:backup:create`/`db:backup:daily` müssen manuell oder über eine selbst eingerichtete externe Aufgabenplanung ausgeführt werden.
- Frontend-Produktionsbuild funktioniert nicht zuverlässig unter Git Bash auf Windows (siehe Abschnitt 21) — PowerShell oder eine echte CI-Umgebung verwenden.
- Der vollständige, aktuelle Stand aller bekannten Grenzen (technisch, sicherheitsbezogen, betrieblich) steht in `docs/STAGE_4A_FINAL_LOCAL_ACCEPTANCE.md` und `docs/FITTRACK_NEXT_PHASE_RECOMMENDATION.md`.
