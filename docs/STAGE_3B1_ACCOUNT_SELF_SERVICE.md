# Stage 3B1: Account Self-Service

Geprüfter Ausgangs-Commit: `50acd07` (main, PR #15 "Merge... audit/stage-3a-local-pilot-readiness"), Branch `feature/stage-3b1-account-self-service`. Diese Phase implementiert sichere Konto-Selbstverwaltung: Passwortänderung, verifizierte E-Mail-Änderung, und zuverlässige Invalidierung bestehender Authentifizierungstokens nach beiden Vorgängen — vollständig lokal, ohne Cloud-Infrastruktur, ohne echte Produktions-SMTP-Zugangsdaten.

---

## 1. Architektur

### 1.1 Backend — wiederverwendete Muster, keine Parallelarchitektur

Jede neue Komponente folgt exakt einem bereits etablierten Muster aus der Studio-Domäne, statt eigene Konventionen einzuführen:

| Neue Komponente | Mirrort |
|---|---|
| `backend/security/accountTokens.js` | `backend/security/invitationTokens.js` (32 Zufallsbytes, base64url, SHA-256-Hash als `BINARY(32)`) |
| `backend/errors/AccountErrors.js` | `backend/errors/StudioErrors.js` (feste Status/Code/Message-Klassen) |
| `backend/services/accountService.js` | `backend/services/studioService.js`s Transaktions-Idiom (`begin`/`rollbackAndRelease`, `FOR UPDATE`-Sperren, lazy-expire-on-read, `postCommitError`-Muster, `ER_DUP_ENTRY`-Abfangen) |
| `backend/delivery/accountEmailTemplates.js`, `smtpAccountEmailProvider.js`, `accountEmailDelivery.js` | `invitationEmailTemplate.js`, `smtpInvitationProvider.js`, `invitationDelivery.js` (dieselbe Fail-Closed-Logik in Produktion, derselbe Dev/Test-Preview-Vertrag `{delivered:false, confirmUrl}`, derselbe `forbidRealTransportInTest`-Schutz) |
| `backend/routes/accountRouter.js` | `backend/routes/studioV1.js` (Factory-Funktion mit injizierbarem `service`/`authenticate`) |

Neu und **nicht** aus der Studio-Domäne kopiert: die `auth_version`-Prüfung in `authMiddleware.js` (siehe Abschnitt 4) — dies ist eine echte, neue Fähigkeit des Systems.

### 1.2 Routen

Alle unter `/api/account/...`, ein neuer, eigener Mount-Punkt in `backend/startup/app.js` (analog zu `/api/users`, nicht unter `/api/v1`, da diese Routen konzeptionell direkt zur Konto-/Auth-Domäne gehören):

| Methode | Pfad | Auth | Zweck |
|---|---|---|---|
| `POST` | `/api/account/change-password` | ja | Passwort ändern |
| `POST` | `/api/account/email-change-requests` | ja | E-Mail-Änderung anfordern |
| `GET` | `/api/account/email-change-requests/current` | ja | Status der eigenen offenen Anfrage |
| `DELETE` | `/api/account/email-change-requests/current` | ja | Eigene offene Anfrage widerrufen |
| `POST` | `/api/account/email-change-confirmations` | **nein (öffentlich)** | E-Mail-Änderung per Token bestätigen |

### 1.3 Frontend

- `frontend/src/utils/accountApi.js` — dünner Client, exakt im Stil von `studioApi.js`.
- `frontend/src/views/ProfileView.vue` — neuer dritter Tab „Sicherheit" neben „Konto"/„Anzeige": Passwort-Formular + E-Mail-Änderungs-Bereich (Formular oder Status-Karte der offenen Anfrage).
- `frontend/src/views/EmailChangeConfirmView.vue` — neue Route `/account/email-change/:token`, öffentlich erreichbar (kein `requiresAuth`), erfordert einen expliziten Klick vor der Bestätigung (siehe Abschnitt 2, Bot-Vorabruf-Schutz).

---

## 2. Threat Model

Explizit geprüfte und abgedeckte Bedrohungen (mit Fundstelle):

| Bedrohung | Gegenmaßnahme | Nachweis |
|---|---|---|
| Gestohlenes altes JWT bleibt nach Passwort-/E-Mail-Änderung gültig | `auth_version`-Inkrement + Prüfung bei jeder Anfrage (Abschnitt 4) | `accountApi.test.js` „invalidates the old token" |
| Passwortänderung ohne aktuelles Passwort | `bcrypt.compare(currentPassword, ...)` zwingend vor jeder Änderung | `CURRENT_PASSWORD_INVALID`-Tests |
| E-Mail-Änderung ohne aktuelles Passwort | identische Prüfung vor Token-Erzeugung | dito |
| Token-Replay (E-Mail-Bestätigung) | `status`-Zustandsautomat (`pending→confirmed`, `WHERE status='pending'`-Guard, `affectedRows`-Check) | „replaying an already-confirmed token is rejected" |
| Token-Bruteforce | 256-Bit-Token (SHA-256-Hash indiziert, kein linearer Vergleich) + `emailChangeConfirm`-Rate-Limit | `accountTokens.test.js`, `rateLimiter.test.js` |
| Timing-Seitenkanal | `bcrypt.compare` für Passwortvergleich (bereits konstant-zeit-verhalten wie beim Login) | unverändert vom bestehenden Login-Verhalten |
| Parallele Bestätigungen desselben Tokens | `SELECT ... FOR UPDATE` auf der Anfrage-Zeile serialisiert konkurrierende Transaktionen | „two concurrent confirmations of the same token: exactly one succeeds" |
| E-Mail-Race zwischen zwei Benutzern | Vorab-Prüfung + `UNIQUE`-Index auf `users.email` (`ER_DUP_ENTRY`-Abfangen) als eigentliches Sicherheitsnetz | „an e-mail claimed by another account ... is rejected at confirmation time" |
| Token-Leaks in Logs | strukturiertes Logging protokolliert nie Body-Inhalte; SMTP-Provider loggt nur Erfolg/Fehlerklasse, nie Token/Text | bestehende Logger-Redaktion (unverändert) + `password change never appears in the structured request log` |
| Token-Leaks in Browser-History | Bestätigungsseite erfordert `sensitiveHistory`-Meta (versteckt Sidebar/Header, analog zu Einladungen), `router.replace` nach Annahme wo zutreffend | `App.vue`s `sensitiveRoute`-Erweiterung |
| Offene Anfrage an bereits belegte E-Mail | Vorab-Prüfung bei Anfrage-Erstellung (`EMAIL_ALREADY_IN_USE`), erneute Prüfung bei Bestätigung | „requesting a change to an e-mail address already used ... is rejected" |
| Mailversandfehler hinterlässt unbestätigbare Anfrage | Kompensationstransaktion widerruft die Anfrage bei Zustellfehler (Saga-Muster wie bei Einladungen) | „a delivery failure ... revokes the request" |
| Mass Assignment | Validierungsschicht (`validateChangePasswordPayload` etc.) whitelisted exakt die erwarteten Felder | `userValidation.test.js` |
| Studio-Tenancy-Nebenwirkungen | Konto-Selbstverwaltung berührt keine Studio-Tabellen; `user_id`-FK mit `ON DELETE CASCADE` ist die einzige Verbindung | E2E: „Studio bleibt erhalten" |
| Account Enumeration | Login bleibt unverändert generisch; Passwort-/E-Mail-Änderungsfehler verraten nie, ob eine andere E-Mail-Adresse einem Konto gehört, außer der bereits vorher etablierten `EMAIL_ALREADY_IN_USE`-Semantik (identisch zur Registrierung) | — |
| **Bot-Vorabruf verbraucht Bestätigungslink** | Bestätigungsseite bestätigt **nicht automatisch** beim Laden, sondern erst nach explizitem Klick — ein Mail-Sicherheits-Scanner, der die reine Frontend-URL vorab abruft (GET), löst dadurch keine POST-Bestätigung aus | `EmailChangeConfirmView.vue`-Kommentar + Test „requires an explicit click before calling the confirmation endpoint" |

CSRF: nicht zusätzlich behandelt, da das bestehende Modell (Bearer-Token im `Authorization`-Header, kein Cookie-basierter Session-State) strukturell CSRF-resistent ist — unverändert vom Rest der Anwendung.

---

## 3. Migration 009

`database/migrations/009_account_self_service.js`:

- `ALTER TABLE users ADD COLUMN auth_version INT NOT NULL DEFAULT 1, ADD COLUMN email_changed_at TIMESTAMP(3) NULL, ADD COLUMN password_changed_at TIMESTAMP(3) NULL`
- `CREATE TABLE user_email_change_requests` mit `id`, `public_id` (UUID), `user_id` (FK → `users.id`, `ON DELETE CASCADE`), `new_email_normalized`, `token_hash BINARY(32)`, `status` (`pending`/`confirmed`/`revoked`/`expired`, `CHECK`-Constraint), `expires_at`, `created_at`, `confirmed_at`, `revoked_at`.
- Eindeutigkeit: `UNIQUE` auf `public_id` und auf `token_hash`; „nur eine offene Anfrage pro Benutzer" ist **anwendungsseitig** erzwungen (dieselbe Konvention wie bei `studio_invitations` — MySQL hat keine partiellen Unique-Indizes), nicht als DB-Constraint.
- Folgt der etablierten Migrations-Konvention: guard-then-throw (`ACCOUNT_SELF_SERVICE_SCHEMA_ALREADY_EXISTS`) statt `IF NOT EXISTS`, `uq_`/`idx_`/`fk_`/`chk_`-Namenskonvention.
- `backend/migrations/schemaContract.js` um einen neuen Block `009_account_self_service` erweitert (20 Prüfungen: 3 Spalten auf `users`, 1 Tabelle + 10 Spalten + 4 Indizes + 1 FK + 1 Check-Constraint auf `user_email_change_requests`), alle mit `pendingMissingAllowed: false`.
- Bestehende Zeilen: `auth_version` erhält den Spalten-Default `1` für alle bereits existierenden Benutzer — kein Datenverlust, keine manuelle Migration nötig.

---

## 4. JWT-Invalidierung (`auth_version`)

- JWT-Payload ist jetzt `{ id, authVersion, iat, exp }` (vorher nur `{ id }`). Nur `POST /api/users/login` stellt Tokens aus; `authVersion` wird aus der frisch gelesenen `users.auth_version`-Spalte übernommen.
- `backend/middleware/authMiddleware.js` ist jetzt asynchron und führt bei **jeder** authentifizierten Anfrage einen zusätzlichen, indizierten Primärschlüssel-Lookup (`SELECT auth_version FROM users WHERE id = ?`) durch. Dies ist der einzige spürbare Architektur-Kompromiss dieser Phase: eine zusätzliche DB-Anfrage pro authentifizierter Anfrage, gegen die Fähigkeit, alte Tokens serverseitig ohne Sitzungsspeicher zuverlässig zu invalidieren.
- Vertrag: `JWT.authVersion === users.auth_version` → gültig. Bei Ungleichheit **oder** fehlendem/ungültigem `authVersion`-Claim **oder** nicht mehr existierendem Benutzer → einheitlich `401 AUTH_SESSION_INVALIDATED` — bewusst **ein** Code für alle drei Ursachen, um weder die genaue Ursache noch die Existenz des Benutzerkontos preiszugeben. Dies ist ein bewusst anderer Code als das bestehende `401 AUTHENTICATION_REQUIRED` (weiterhin für kaputte/abgelaufene/falsch signierte Tokens), nicht weil unterschiedliche Information preisgegeben werden soll, sondern weil eine Sitzungs-Invalidierung durch eine legitime Sicherheitsaktion (Passwortänderung) eine bessere, spezifischere Frontend-Meldung verdient als ein generischer Auth-Fehler.
- Ein Token ohne `authVersion`-Claim (jedes vor dieser Phase ausgestellte Token) wird **ohne Datenbankzugriff** sofort als ungültig erkannt (Zahlentyp-Prüfung vor der Abfrage) — spart eine unnötige Anfrage für den garantiert ungültigen Fall.
- **Verhalten bestehender Tokens nach dem Deployment dieser Migration:** Jedes vor Migration 009 ausgestellte Token wird beim ersten nachfolgenden Request abgelehnt (`AUTH_SESSION_INVALIDATED`), da es keinen `authVersion`-Claim trägt. Alle eingeloggten Benutzer müssen sich einmalig neu anmelden. **Dies ist ein bewusst akzeptiertes, einmaliges Verhalten** (siehe Auftrag), keine Fehlfunktion.
- Passwortänderung und bestätigte E-Mail-Änderung erhöhen `auth_version` atomar in derselben Transaktion wie die eigentliche Änderung (`WHERE id = ? AND auth_version = ?`-Guard als zusätzliche Verteidigungsebene, obwohl die Zeile bereits per `FOR UPDATE` gesperrt ist).

---

## 5. Passwortänderung

`POST /api/account/change-password` — Ablauf in `accountService.changePassword`:

1. Confirmation-Mismatch-Prüfung **vor** jeder Datenbank-/bcrypt-Operation (reine Eingabeprüfung, spart unnötige bcrypt-Kosten bei offensichtlichem Client-Fehler).
2. Transaktion: `SELECT ... FOR UPDATE` auf die eigene `users`-Zeile.
3. `bcrypt.compare(currentPassword, ...)` → `401 CURRENT_PASSWORD_INVALID` bei Fehlschlag.
4. `bcrypt.compare(newPassword, ...)` gegen den **aktuellen** Hash → `400 NEW_PASSWORD_SAME_AS_CURRENT`, falls identisch.
5. `bcrypt.hash(newPassword, 10)` (derselbe Kostenfaktor wie Registrierung), `UPDATE ... SET password_hash=?, password_changed_at=NOW(3), auth_version=auth_version+1 WHERE id=? AND auth_version=?`.
6. Commit. Antwort: `{ message }` — kein neues Token, keine Passwort-/Hash-Werte.

**Passwort-Policy:** bewusst dieselbe zentrale `validatePassword()`-Funktion wie Registrierung (jetzt aus `userValidation.js` exportiert), **kein** separater `PASSWORD_POLICY_VIOLATION`-Code — eine Verletzung ergibt denselben `VALIDATION_ERROR`, den Registrierung auch für eine zu kurze Passworteingabe liefert. Diese Entscheidung weicht bewusst von der Beispiel-Fehlercode-Liste im Auftrag ab, um **keine** zweite, parallele Passwort-Regel-Vertragsebene für dieselbe zugrunde liegende Policy einzuführen.

---

## 6. E-Mail-Änderung anfordern

`POST /api/account/email-change-requests` — Ablauf in `accountService.requestEmailChange`:

1. Passwortprüfung (identisch zu Abschnitt 5).
2. `EMAIL_UNCHANGED`, falls neue E-Mail (normalisiert) der aktuellen entspricht.
3. Frühe Eindeutigkeitsprüfung (`EMAIL_ALREADY_IN_USE`) — reiner UX-Vorteil; das eigentliche Sicherheitsnetz ist der `UNIQUE`-Index auf `users.email`, geprüft erneut unmittelbar vor der Bestätigungs-`UPDATE` (Abschnitt 7).
4. **Atomarer Ersatz** einer bestehenden offenen Anfrage: `SELECT ... FOR UPDATE` auf alle `pending`-Zeilen des Benutzers, jede wird — je nach Ablaufzeitpunkt — entweder als `expired` (lazy-expire-on-read, wie bei Einladungen) oder als `revoked` markiert, **bevor** die neue Zeile eingefügt wird.
5. Tokenerzeugung (siehe Abschnitt 8 unten), Einfügen, Commit.
6. **Nach** dem Commit (separat, wie bei Einladungen): Zustellversuch. Bei Fehlschlag: Kompensationstransaktion widerruft die soeben erstellte Anfrage, Antwort `502 EMAIL_CHANGE_DELIVERY_FAILED` (oder `503 EMAIL_CHANGE_DELIVERY_RECOVERY_FAILED`, falls selbst die Kompensation fehlschlägt).
7. **Optionale Sicherheitsbenachrichtigung an die alte Adresse** (`sendNotificationBestEffort`): best-effort, ihr Fehlschlagen beeinflusst die Antwort nicht — die SMTP-Provider-Schicht loggt einen etwaigen Fehlschlag bereits strukturiert, daher kein zusätzliches Logging im Service selbst.

Response (Dev/Test ohne konfigurierten Provider): `{ emailChangeRequest: {...}, delivery: { delivered: false, confirmUrl } }` — identischer Vertrag wie bei Einladungen.

`GET /api/account/email-change-requests/current` liefert `{ emailChangeRequest: null | {...} }` (nie ein 404 für „keine Anfrage" — vereinfacht die Frontend-Logik). `DELETE .../current` ist **nicht idempotent**: kein offener Antrag → `404 EMAIL_CHANGE_REQUEST_NOT_FOUND`, bewusst analog zum bestehenden Einladungs-Widerruf-Verhalten.

---

## 7. E-Mail-Bestätigung

`POST /api/account/email-change-confirmations` — **öffentlich, kein Bearer-Token nötig** (Body: `{ token }`). Ablauf in `accountService.confirmEmailChange`:

1. Token-Hashing; jeder Format-/Hashfehler → `404 EMAIL_CHANGE_TOKEN_INVALID` (keine Unterscheidung zwischen „kaputt" und „unbekannt").
2. Sperrreihenfolge (konsistent mit Anfrage-Erstellung, verhindert Deadlocks): `user_email_change_requests` unverriegelt „gepeekt", um den Besitzer zu finden → `users`-Zeile `FOR UPDATE` gesperrt → Anfrage-Zeile erneut `FOR UPDATE` gesperrt und auf Token-Übereinstimmung geprüft.
3. Zustandsautomat (`emailChangeRequestStateError`): `confirmed`→`409 EMAIL_CHANGE_TOKEN_USED`, `revoked`→`409 EMAIL_CHANGE_TOKEN_REVOKED`, `expired`→`410 EMAIL_CHANGE_TOKEN_EXPIRED`, sonst→`409 EMAIL_CHANGE_REQUEST_NOT_PENDING`.
4. Lazy-Expire-Prüfung (analog Einladungen): abgelaufen → Zeile wird durabel als `expired` markiert und committet, **danach** wird der Fehler (`postCommitError`-Muster) an den Aufrufer geworfen — der Ablauf-Zustand geht nie verloren, auch wenn die Gesamtanfrage fehlschlägt.
5. Erneute Eindeutigkeitsprüfung unmittelbar vor der Änderung; `UPDATE users SET email=?, email_changed_at=NOW(3), auth_version=auth_version+1 WHERE id=? AND auth_version=?`, `ER_DUP_ENTRY`-Abfangen als letztes Sicherheitsnetz gegen eine echte Wettlaufsituation.
6. `UPDATE user_email_change_requests SET status='confirmed', ... WHERE id=? AND status='pending'`, `affectedRows`-Prüfung als zusätzliche Verteidigungsebene gegen eine parallele Bestätigung (die `FOR UPDATE`-Sperre serialisiert dies bereits strukturell).
7. Response: `{ message }` — kein Token, kein automatischer Login (das Frontend meldet den Benutzer nach erfolgreicher Bestätigung explizit ab, siehe Abschnitt 9).

---

## 8. Tokenformat und Hashing

Identisch zu Einladungstokens (`backend/security/accountTokens.js`, mirrort `invitationTokens.js`):

- `crypto.randomBytes(32)` → 256 Bit Entropie.
- Base64url-kodiert → exakt 43 Zeichen, validiert per Regex `^[A-Za-z0-9_-]{43}$`.
- Gespeicherter Hash: SHA-256 des UTF-8-Tokens, als roher 32-Byte-`Buffer` in `BINARY(32)` — nie das Klartext-Token.
- Lookup erfolgt per exaktem `WHERE token_hash = ?` (Index-Lookup), nicht per Fetch-dann-Vergleich — dieselbe Konvention wie bei Einladungen.

---

## 9. Frontend-Abläufe

**Passwort ändern** (`ProfileView.vue`, Tab „Sicherheit"): Formular mit aktuellem Passwort, neuem Passwort, Bestätigung, Show/Hide-Umschalter (neu eingeführt, da bisher kein bestehendes Muster dafür existierte). Client-seitige Prüfung nur als UX (Pflichtfelder, Mindestlänge, Übereinstimmung) — der Server bleibt in jedem Fall autoritativ. Nach Erfolg: Toast, `logout()`, Weiterleitung zu `/login`.

**E-Mail-Adresse ändern**: Zeigt entweder das Anfrage-Formular (falls keine offene Anfrage existiert) oder eine Status-Karte (neue E-Mail, Ablaufzeit über `formatDate`, „Anfrage widerrufen"-Button mit `ConfirmDialog`). Im Dev/Test-Vorschau-Modus (kein konfigurierter Provider) wird der Bestätigungslink — analog zur bestehenden Einladungs-Vorschau in `StudioInvitationsView.vue` — sichtbar mit Kopier-Button angezeigt, niemals in `localStorage` persistiert.

**Bestätigungsseite** (`EmailChangeConfirmView.vue`, Route `/account/email-change/:token`): öffentlich (kein `requiresAuth`), da der Link in einem Browser geöffnet werden kann, der nicht bei FitTrack angemeldet ist. Erfordert einen expliziten Klick vor der Bestätigung (Bot-Vorabruf-Schutz, siehe Abschnitt 2). `sensitiveHistory`-Meta versteckt die App-Chrome, `App.vue`s `sensitiveRoute`-Erkennung um das neue Pfadpräfix erweitert.

Alle neuen UI-Texte sind vollständig zweisprachig (de/en) in `frontend/src/utils/i18n.js` unter `profile.security.*` und `accountEmailChangeConfirm.*` ergänzt.

---

## 10. Lokale Testkonfiguration

- Kein echter SMTP-Versand nötig: Dev/Test-Vorschau-Modus liefert `{ delivered: false, confirmUrl }` direkt in der API-Antwort, exakt wie bei Einladungen.
- E2E-Test (`frontend/e2e/accountSelfService.spec.js`) liest den Bestätigungslink direkt aus der UI (`.studio-delivery a`) und öffnet ihn in einem **frischen, nicht angemeldeten** Browser-Kontext — beweist, dass die Bestätigung ohne bestehende Sitzung funktioniert.
- Backend-Integrationstest (`backend/test/integration/accountApi.test.js`) nutzt einen zweiten, isolierten App-Server mit einer absichtlich fehlschlagenden E-Mail-Zustellung, um den Kompensationspfad ohne echten SMTP-Ausfall zu beweisen.
- Alle Testkonten folgen der bestehenden `@example.test`-Konvention; `INVITATION_EMAIL_PROVIDER` wird in jeder Testumgebung explizit geleert, um ein Leck echter SMTP-Konfiguration aus einer lokalen `backend/.env` zu verhindern (bestehende Konvention, unverändert übernommen).

---

## 11. Betriebshinweise

- **SMTP-Transport-Sharing:** `backend/startup/app.js` löst einen einzigen, gemeinsam genutzten Nodemailer-Transport auf (`resolveSharedSmtpTransportFactory`) und reicht ihn an beide Composition-Roots (Einladungen, Konto-Selbstverwaltung) weiter. Ohne dies hätte `defaultRouters()` zwei unabhängige SMTP-Verbindungspools zum selben Server aufgebaut — der bestehende Regressionstest `invitationDeliveryComposition.test.js` („constructs exactly one SMTP transport") deckt dies ab und bestand nach dieser Änderung erneut vollständig.
- **Kein neuer Umgebungsvariablen-Name für die Bestätigungs-Basis-URL:** `EMAIL_CHANGE_CONFIRM_BASE_URL` wurde bewusst verworfen zugunsten der Wiederverwendung von `INVITATION_ACCEPT_BASE_URL` — beide Links zeigen auf dasselbe Frontend, nur mit anderem Pfad.
- **Zusätzliche DB-Last:** jede authentifizierte Anfrage führt jetzt einen zusätzlichen indizierten Primärschlüssel-Lookup gegen `users` aus (siehe Abschnitt 4) — bei der aktuellen Konfiguration (Connection-Pool, indizierter PK-Zugriff) vernachlässigbar, aber ein bewusster, dokumentierter Kompromiss.
- **Rate-Limits** (`AUTH_PASSWORD_CHANGE_RATE_LIMIT_*`, `AUTH_EMAIL_CHANGE_RATE_LIMIT_*`, `AUTH_EMAIL_CHANGE_CONFIRM_RATE_LIMIT_*`) sind wie alle bestehenden Auth-Limiter In-Memory und pro Prozess — bei horizontaler Skalierung nicht geteilt (bereits bekannte, dokumentierte Einschränkung des gesamten Systems, siehe `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`).

## 12. Verbleibende Grenzen

- Kein Refresh-Token-Mechanismus (explizit außerhalb des Scopes dieser Phase).
- Keine Geräte-/Sitzungsübersicht — eine Passwort-/E-Mail-Änderung meldet **alle** Sitzungen ab, es gibt keine granulare „nur dieses Gerät"-Option.
- Keine Zwei-Faktor-Authentifizierung.
- Keine „Passwort vergessen"/Reset-Funktion (im gesamten Code weiterhin nicht vorhanden — außerhalb des Scopes dieser Phase, wie beauftragt).
- Keine Kontolöschung, kein Datenexport.
- Der Login-Timing-Seitenkanal (bereits vor dieser Phase in `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` dokumentiert) bleibt unverändert bestehen — außerhalb des Scopes dieser Phase.
- Rate-Limiter bleiben pro Prozess (siehe Abschnitt 11) — dieselbe bereits dokumentierte Skalierungsgrenze wie Login/Registrierung.
