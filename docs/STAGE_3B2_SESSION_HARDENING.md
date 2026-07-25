# Stage 3B2: Session Hardening

Geprüfter Ausgangs-Commit: `974531f` (main, PR #16 "Merge... feature/stage-3b1-account-self-service"), Branch `feature/stage-3b2-session-hardening`. Diese Phase ersetzt den reinen zustandslosen Access-JWT-Flow aus Stage 3A/3B1 durch serverseitig widerrufbare Authentifizierungssitzungen mit rotierenden, einmalig verwendbaren Refresh Tokens, vollständigem Logout/Logout-All, CSRF- und Origin-Schutz für Cookie-basierte Auth-Endpunkte, sowie einer Schließung des Login-Timing-Seitenkanals aus Stage 3A — vollständig lokal, ohne Cloud-Infrastruktur, ohne Redis, ohne Zwei-Faktor-Authentifizierung.

---

## 1. Ausgangsarchitektur (analysiert vor Implementierung)

| Aspekt | Zustand vor Stage 3B2 |
|---|---|
| Access Token Speicherort (Frontend) | `localStorage.fittrack_token` (persistiert über Reloads/Tabs) |
| Access Token Lebensdauer | statisch `8h`, keine Rotation, keine serverseitige Widerrufsmöglichkeit außer `auth_version`-Inkrement (Stage 3B1) |
| Token-ausstellende Endpunkte | ausschließlich `POST /api/users/login` |
| Stage-3B1-`authVersion`-Prüfung | ein einziger `SELECT auth_version FROM users WHERE id=?` pro authentifizierter Anfrage in `authMiddleware.js` |
| Logout | rein lokal (`localStorage.removeItem` + Zustands-Reset), kein serverseitiger Aufruf, kein "Sitzung beenden" |
| CORS/Cookies | `cors`-Middleware ohne `credentials`-Flag, kein `cookie-parser`, keine Cookies überhaupt im Einsatz |
| E2E-Testauthentifizierung | `attachAuth()` seedete `localStorage` per `page.addInitScript` vor dem ersten App-Start |

Diese Analyse (Abschnitt 4 des Auftrags) ergab: Der reine `localStorage`-Token ist XSS-persistenzanfällig, hat keine serverseitige Widerrufsmöglichkeit außer dem groben `auth_version`-Hammer (widerruft *alle* Sitzungen gleichzeitig), und ermöglicht keine gezielte "diese eine Sitzung/dieses eine Gerät abmelden"-Funktion.

---

## 2. Zielarchitektur im Überblick

```
Login/Refresh
   │
   ├─ Access Token (JWT, 15 min, NUR im Frontend-Speicher/RAM)
   │    Claims: { id, authVersion, sessionId, iat, exp }
   │
   └─ Refresh Token (opak, 256-Bit-Zufall, 7 Tage, HttpOnly-Cookie)
        + CSRF Token (opak, 256-Bit-Zufall, lesbares Cookie)
        → serverseitig: user_auth_sessions + user_refresh_tokens
```

Jede Sitzung ist eine Zeile in `user_auth_sessions`; jeder Refresh Token ist eine Zeile in `user_refresh_tokens`, die genau einer Sitzung zugeordnet ist. Ein Refresh **rotiert** den Token (altes Token → `rotated`, neues Token → `active`) statt ihn wiederzuverwenden — das ist die Grundlage der Reuse Detection (Abschnitt 9).

---

## 3. Migration 010 (`010_auth_sessions`)

Zwei neue Tabellen, `database/migrations/010_auth_sessions.js`, Guard-then-throw-Konvention (`AUTH_SESSIONS_SCHEMA_ALREADY_EXISTS`) wie alle vorherigen Migrationen.

### `user_auth_sessions`

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | `INT AUTO_INCREMENT PK` | interner Schlüssel |
| `public_id` | `CHAR(36)`, `UNIQUE` | die `sessionId`, die im JWT steht |
| `user_id` | `INT`, FK → `users.id` `ON DELETE CASCADE` | Besitzer |
| `auth_version` | `INT` | **Schnappschuss** von `users.auth_version` zum Zeitpunkt der Anmeldung |
| `status` | `VARCHAR(16)`, `CHECK IN ('active','revoked','expired','compromised')` | Lebenszyklus |
| `created_at`, `last_seen_at`, `expires_at` | `TIMESTAMP(3)` | Zeitstempel |
| `revoked_at`, `revocation_reason` | nullable | Audit-Spur (`logout`, `logout_all`, `session_limit`, `refresh_reuse_detected`, `password_change`, `email_change`) |

Indizes: `UNIQUE(public_id)`, `(user_id, status)`, `(expires_at)`.

### `user_refresh_tokens`

| Spalte | Typ | Zweck |
|---|---|---|
| `id`, `public_id` | wie oben | — |
| `session_id` | FK → `user_auth_sessions.id` `ON DELETE CASCADE` | Zugehörigkeit |
| `token_hash` | `BINARY(32)`, `UNIQUE` | SHA-256 des rohen Tokens — **niemals Klartext** |
| `csrf_token_hash` | `BINARY(32)` | SHA-256 des zugehörigen CSRF-Tokens |
| `status` | `CHECK IN ('active','rotated','revoked','expired','compromised')` | Lebenszyklus |
| `created_at`, `expires_at`, `consumed_at` | Zeitstempel | — |
| `replaced_by_token_id` | FK → `user_refresh_tokens.id` `ON DELETE SET NULL` (selbstreferenzierend) | Rotationskette |
| `revoked_at` | nullable | — |

Genau ein `active`-Token pro Sitzung wird durch Anwendungslogik (nicht durch einen DB-Constraint — MySQL hat keine partiellen Unique-Indizes) sichergestellt, analog zur bereits etablierten "eine offene Anfrage pro Nutzer"-Konvention aus Stage 3B1.

`backend/migrations/schemaContract.js` um einen Block `010_auth_sessions` erweitert (36 Prüfungen: 2 Tabellen, 10+11 Spalten, 8 Indizes, 3 Fremdschlüssel, 2 Check-Constraints), verifiziert durch `Stage 3B2 schema contract covers every auth-session column...`-Test. Migration Doctor meldet nach Anwendung `state: ready`, `applied: 10`.

Getestet: leere DB (voller `001`–`010`-Durchlauf), Aufstieg von bereits vorhandenen `001`–`009`-Daten (`unversionierte Bestandsdaten`-Testfamilie), sowie ein vollständiger verschlüsselter Backup-/Restore-Drill gegen die 10-Migrationen-Datenbank.

---

## 4. Token- und Cookie-Vertrag

### Access Token (JWT)

- Claims: `{ id, authVersion, sessionId, iat, exp }`.
- Lebensdauer: `AUTH_ACCESS_TOKEN_TTL_MINUTES`, Default `15`, Grenzen `5–60`.
- Signatur: `HS256`, derselbe `JWT_SECRET` wie zuvor.
- Speicherort Frontend: **ausschließlich** eine In-Memory-`ref()` in `utils/auth.js` — nie `localStorage`, `sessionStorage`, ein per JS lesbares Cookie oder eine URL.

### Refresh Token

- 256-Bit-Zufall (`crypto.randomBytes(32)`), base64url-kodiert (43 Zeichen), SHA-256-gehasht als `BINARY(32)` gespeichert (`backend/security/sessionTokens.js`).
- Lebensdauer: `AUTH_REFRESH_TOKEN_TTL_DAYS`, Default `7`, Grenzen `1–30`.
- Cookie: `AUTH_REFRESH_COOKIE_NAME` (Default `fittrack_refresh`), **HttpOnly**, `Path=/api/auth` (nur an die drei Auth-Endpunkte gesendet), `SameSite`/`Secure` aus der Session-Konfiguration, kein `Domain`-Attribut.
- Einmalig verwendbar: jede erfolgreiche Verwendung rotiert ihn (Abschnitt 9).

### CSRF Token

- Gleiches Format wie der Refresh Token, eigener Hash (`csrf_token_hash`) auf derselben `user_refresh_tokens`-Zeile.
- Cookie: `AUTH_CSRF_COOKIE_NAME` (Default `fittrack_csrf`), **nicht** HttpOnly (muss von JS lesbar sein), `Path=/`.
- Wird vom Frontend per `document.cookie` gelesen und als `X-CSRF-Token`-Header auf mutierende Cookie-Endpunkte gespiegelt (Double-Submit-Cookie-Muster).

### Session-Konfiguration (`backend/config/sessionConfig.js`)

Mirrort exakt `config/auth.js`s Vertrag: reine `readSessionConfig(env)`-Funktion, einmalig beim Modul-Require aufgerufen (Fail-Fast). Geprüfte Regeln:

- `AUTH_COOKIE_SECURE` darf in Produktion nie `false` sein (Startfehler `INVALID_SESSION_CONFIG`, kein stiller Fallback).
- `AUTH_COOKIE_SAME_SITE=none` erfordert `AUTH_COOKIE_SECURE=true`.
- Cookie-Namen: 1–64 Zeichen `[A-Za-z0-9_]`, bekannte Platzhalter (`cookie`, `token`, `session`, leer) abgelehnt, Refresh- und CSRF-Name müssen sich unterscheiden.
- Alle Werte injizierbar für Tests; sichere Defaults in `backend/.env.example`.

---

## 5. CSRF- und Origin-Schutz

Zwei unabhängige, sich ergänzende Schichten für `POST /api/auth/refresh|logout|logout-all`:

1. **Double-Submit-Cookie** (`backend/security/csrfGuard.js`): `X-CSRF-Token`-Header muss dem `fittrack_csrf`-Cookie-Wert exakt entsprechen, Vergleich per `crypto.timingSafeEqual`. Ein Angreifer kann das Cookie zwar automatisch mitsenden lassen (klassisches CSRF), aber den Wert wegen Same-Origin-Policy nicht auslesen, um einen passenden Header zu fälschen.
2. **Serverseitige Bindung an das Refresh Token** (nur beim Refresh, `sessionService.rotateRefreshToken`): der Hash des Headers wird zusätzlich gegen `csrf_token_hash` der *konkreten* präsentierten Refresh-Token-Zeile geprüft — stärker als reines Double-Submit, da unabhängig von einer eventuellen Cookie-Manipulation.
3. **Origin-Schutz** (`backend/security/originGuard.js`): ein *vorhandener* `Origin`-Header muss der `CORS_ORIGIN`-Allowlist oder dem Host der Anfrage entsprechen, sonst `403 AUTH_ORIGIN_NOT_ALLOWED`. Ein *fehlender* `Origin`-Header wird bewusst durchgelassen — echte Browser-`fetch()`-Aufrufe senden ihn immer für zustandsändernde Anfragen; sein Fehlen kennzeichnet einen kontrollierten CLI-/Testaufruf (dokumentierte Ausnahme, kein Sicherheitsloch, da ein Angreifer den Header nicht *entfernen* kann, nur fälschen).

`backend/startup/app.js`s CORS-Konfiguration wurde zusätzlich korrigiert: `Access-Control-Allow-Credentials: true` wird jetzt nur reflektiert, wenn die Origin bereits verifiziert erlaubt ist — nie zusammen mit einem unbedingten Allow (sonst ein echtes Credential-Leak).

---

## 6. Login-Timing-Härtung

`backend/routes/users.js`: ein bei Modul-Load **einmalig** vorab erzeugter Dummy-Bcrypt-Hash (`LOGIN_TIMING_DUMMY_HASH`, Kostenfaktor 10, identisch zum realen Passwort-Hash-Kostenfaktor) wird für unbekannte E-Mail-Adressen anstelle eines echten `password_hash` verwendet:

```js
const isMatch = await bcrypt.compare(input.password, user ? user.password_hash : LOGIN_TIMING_DUMMY_HASH)
if (!user || !isMatch) throw new AuthenticationError('Invalid email or password.')
```

Beide Pfade (unbekannter Nutzer, falsches Passwort) durchlaufen **strukturell exakt einen** `bcrypt.compare`-Aufruf mit demselben Kostenfaktor und enden in derselben Fehlerklasse mit identischer Nachricht — nicht als instabile Millisekunden-Messung getestet, sondern strukturell: `authSessionApi.test.js` patcht `bcrypt.compare` und zählt Aufrufe/prüft, dass der Dummy-Hash über mehrere unbekannte Logins hinweg **identisch** bleibt (nie pro Anfrage neu erzeugt).

---

## 7. Sitzungserstellung beim Login

`sessionService.startSession(userId, { authVersion })`, aufgerufen aus der Login-Route nach erfolgreicher Passwortprüfung, vollständig transaktional:

1. `AUTH_MAX_ACTIVE_SESSIONS` (Default 10) durchsetzen: sind bereits `≥ limit` aktive Sitzungen vorhanden, werden die **ältesten** automatisch verdrängt (`revocation_reason='session_limit'`, inklusive ihrer Refresh Tokens) — eine neue Anmeldung auf einem neuen Gerät wird nie durch die eigene Historie auf anderen Geräten blockiert. `AUTH_SESSION_LIMIT_REACHED` ist ein reiner Verteidigungs-Fallback für den (unter `FOR UPDATE`-Sperrung praktisch unerreichbaren) Fall, dass die Verdrängung selbst nicht ausreicht.
2. `user_auth_sessions`-Zeile einfügen, `auth_version` als Schnappschuss.
3. Erstes Refresh Token + CSRF Token erzeugen und einfügen.
4. Route signiert den Access-JWT (`security/accessTokens.js`) und setzt beide Cookies.

---

## 8. Zugriffsprüfung (`authMiddleware.js`)

Erweitert die Stage-3B1-`authVersion`-Prüfung um `sessionId`, **eine** kombinierte Abfrage (`LEFT JOIN user_auth_sessions`) statt zwei getrennter Round-Trips:

```sql
SELECT u.auth_version AS user_auth_version,
       s.status AS session_status, s.expires_at AS session_expires_at,
       s.auth_version AS session_auth_version
FROM users u
LEFT JOIN user_auth_sessions s ON s.public_id = ? AND s.user_id = u.id
WHERE u.id = ?
```

Geprüft wird: JWT-Signatur/Ablauf, `id`, `authVersion`-Claim vorhanden, `sessionId`-Claim ein wohlgeformter UUID, Nutzer existiert, `users.auth_version === JWT.authVersion`, Sitzung existiert, Sitzung `active`, Sitzung nicht abgelaufen, Sitzungs-`auth_version === users.auth_version`. **Jede** dieser Ursachen führt zum identischen `401 AUTH_SESSION_INVALIDATED` — bewusst undifferenziert (Fortführung der Stage-3B1-Philosophie), damit kein Rückschluss auf die genaue Ursache möglich ist. Ein Token ohne `sessionId`-Claim (jedes vor dieser Phase ausgestellte Token) wird ohne Datenbankzugriff sofort abgelehnt.

**Einmalige Neuanmeldung nach Deployment**: wie bei Stage 3B1s `auth_version`-Einführung akzeptiert und dokumentiert — jedes vor Migration 010 ausgestellte Token hat keinen `sessionId`-Claim und wird beim ersten Request nach dem Deployment abgelehnt.

---

## 9. Refresh-Endpunkt, Rotation, Reuse Detection

`POST /api/auth/refresh` (`backend/routes/authSessionRouter.js` → `sessionService.rotateRefreshToken`):

1. Origin-Guard, dann CSRF-Doppel-Submit-Guard (beide vor jeglichem DB-Zugriff).
2. Refresh Token ausschließlich aus dem HttpOnly-Cookie gelesen (nie Body/Query).
3. Transaktion mit konsistenter Sperr-Reihenfolge: unverriegeltes Peek auf die Token-Zeile (um `session_id` zu ermitteln) → `SELECT ... FOR UPDATE` auf `user_auth_sessions ⋈ users` → `SELECT ... FOR UPDATE` auf die konkrete Token-Zeile.
4. Sitzungs-`auth_version` gegen `users.auth_version` geprüft (Spiegel der `authMiddleware`-Prüfung — schließt eine Lücke, in der ein Refresh eine bereits durch Passwortänderung entwertete Sitzung sonst noch einmal hätte verlängern können).
5. CSRF-Hash gegen `csrf_token_hash` der *konkreten* Zeile geprüft (siehe Abschnitt 5).
6. **Status `rotated`** (bereits einmal verwendet) → **Reuse Detection**: die gesamte Sitzung wird `compromised`, alle ihre Refresh Tokens `compromised`, **kein** neuer Access Token, Cookies gelöscht, `401 AUTH_REFRESH_REUSE_DETECTED`, strukturierter Sicherheits-Log-Eintrag ohne Tokenwert.
7. Status `active` + nicht abgelaufen → neues Token+CSRF erzeugen, altes Token atomar auf `rotated` mit `replaced_by_token_id` setzen (`UPDATE ... WHERE id=? AND status='active'`-Guard, `affectedRows≠1` → Fallback-Fehler statt stillschweigend zwei aktive Nachfolger zuzulassen), `last_seen_at` aktualisieren.
8. Neue Cookies setzen, neuen Access-JWT mit **derselben** `sessionId` signieren (die Sitzung überlebt die Rotation; nur der Refresh Token wechselt).

### Gleichzeitige Refresh-Aufrufe (Backend-Verhalten)

Getestet (`authSessionApi.test.js`, "two genuinely concurrent refresh calls"): zwei parallele Aufrufe mit demselben Token unter derselben `FOR UPDATE`-Sperre — genau einer gewinnt (`200`), der andere sieht nach Freigabe der Sperre den bereits `rotated`-Status und wird korrekt als Reuse behandelt (`401 AUTH_REFRESH_REUSE_DETECTED`). Kein doppelter aktiver Nachfolger entsteht; verifiziert per direkter DB-Abfrage (`COUNT(*) WHERE status='active'` nach dem Wettlauf = 0, da Reuse Detection die gesamte Sitzung kompromittiert).

**Ein während der Implementierung gefundener echter Bug**: der ursprüngliche Reuse-Detection-Zweig committete und gab die DB-Verbindung frei, bevor er den Fehler warf — der äußere `catch`-Block versuchte anschließend, dieselbe (bereits an den Pool zurückgegebene) Verbindung ein zweites Mal zurückzurollen/freizugeben, was unter echter Nebenläufigkeit die Verbindung einer *anderen*, tatsächlich parallel laufenden Anfrage korrumpieren konnte. Behoben durch ein `transactionSettled`-Flag, das die äußere Fehlerbehandlung anweist, eine bereits abgeschlossene Transaktion nicht erneut anzufassen. Ohne den "zwei gleichzeitige Refreshes"-Test wäre dieser Bug nicht aufgefallen.

### Multi-Tab-Verhalten (echtes Cross-Tab-Verhalten vs. Test-Fixture-Fehler)

Zwei kategorisch verschiedene Fälle wurden während der Härtung unterschieden:

1. **Ein Test-Fixture-Fehler** (`workoutSessions.spec.js`): ein `memberAuth`-Objekt, dessen Cookies bei einem frühen Login eingefangen wurden, wurde später erneut in zwei frische Browser-Kontexte injiziert — nachdem die *echte* Browser-Sitzung (`page`) durch mehrere zwischenzeitliche harte Navigationen ihren Refresh Token bereits mehrfach rotiert hatte. Das injizierte, veraltete Cookie war damit serverseitig bereits `rotated`, bevor es überhaupt zum ersten Mal in den neuen Kontexten verwendet wurde — eine künstliche Reuse-Situation, kein Produktfehler. Behoben, indem der zweite Tab jetzt korrekt als *echter zweiter Tab derselben Browsersitzung* modelliert wird (`page.context().newPage()`, das den *aktuellen*, geteilten Cookie-Speicher automatisch erbt), statt zwei unabhängige Kontexte mit einem veralteten Credential-Objekt zu erzeugen.
2. **Ein echtes Produktverhalten**: zwei Tabs *desselben* Browser-Kontexts (echtes gemeinsames Cookie-Jar), die nahezu gleichzeitig einen harten Reload auslösen, würden ohne Koordination beide unabhängig `POST /api/auth/refresh` mit demselben, noch nicht rotierten Cookie aufrufen — serverseitig ununterscheidbar von einem gestohlenen, wiederverwendeten Token, sodass der unterlegene Tab fälschlich als Diebstahl behandelt und die Sitzung für *beide* Tabs kompromittiert würde. Für einen völlig legitimen Anwendungsfall (derselbe Nutzer, zwei Tabs) ist das nicht akzeptabel.

**Lösung — tokenfreie Cross-Tab-Koordination** (`frontend/src/utils/api.js`):

- Ein `localStorage`-Mutex (`fittrack_refresh_lock`, enthält **ausschließlich** eine zufällige, nicht mit dem Session-System verbundene Opaque-ID plus Zeitstempel — nie einen Token- oder Cookiewert) stellt sicher, dass zu einem Zeitpunkt nur ein Tab tatsächlich `POST /api/auth/refresh` aufruft.
- Ein wartender Tab lauscht auf eine `BroadcastChannel`-Nachricht (`fittrack-refresh-coordination`, Nachrichtentyp `refresh-settled`, ebenfalls ohne jeglichen Tokeninhalt) statt zu pollen, mit einem Timeout (4 s) als Sicherheitsnetz.
- Nach Ablauf der Wartezeit ruft der wartende Tab **selbst** `POST /api/auth/refresh` auf — verwendet dabei automatisch das inzwischen im geteilten Cookie-Jar aktualisierte, gültige Cookie (kein Tokenaustausch zwischen Tabs nötig, da Cookies bereits browserseitig geteilt werden) und rotiert es dadurch legitim ein weiteres Mal.
- Ein veralteter Lock (z. B. von einem abgestürzten/geschlossenen Tab) verfällt nach 5 Sekunden und blockiert nachfolgende Tabs nicht dauerhaft.
- Bewusst **kein** formal atomarer verteilter Lock (ein Write-dann-Readback-Muster, keine echte Compare-and-Swap-Semantik) — ausreichend, da alle Tabs demselben legitimen Nutzer gehören, keine feindlichen Prozesse; ein verbleibendes Restrisiko exakt gleichzeitiger Schreibvorgänge ist nicht schlechter als der Zustand ganz ohne Koordination.

Verifiziert sowohl unit- (`refreshCoordination.test.js`: Lock-Erwerb, Warten, Freigabe, Stale-Lock-Verfall, keine Tokenwerte im Lock) als auch E2E-seitig (`authSession.spec.js`: "two tabs of the same browser context refreshing at nearly the same moment never treat a legitimate user as token theft" — zwei echte Tabs, echter gleichzeitiger Reload via `Promise.all`, alle `/auth/refresh`-Aufrufe erfolgreich, kein Tab landet auf der Login-Seite).

**Verbleibende Grenze**: die Koordination wirkt nur innerhalb *eines* Browser-Kontexts (echte Tabs desselben Fensters/derselben Profil-Instanz). Zwei völlig unabhängige Browser-Kontexte oder Geräte (z. B. Desktop + Handy) haben systembedingt getrennte Cookie-Jars und damit unabhängige Sitzungen — das ist beabsichtigtes, korrektes Verhalten (Abschnitt 12), kein Koordinationsfall.

---

## 10. Logout und Logout-All

- `POST /api/auth/logout`: widerruft die *eine* aktuelle Sitzung (`sessionId` aus dem Access Token) und ihre aktiven Refresh Tokens, löscht beide Cookies. Bearer-Token-authentifiziert (nicht Cookie-authentifiziert), zusätzlich CSRF-/Origin-geprüft (Verteidigung in der Tiefe, siehe Abschnitt 5). Wiederholtes Logout ist sicher: eine bereits widerrufene Sitzung erneut zu widerrufen, betrifft (`WHERE status='active'`) null Zeilen und meldet weiterhin Erfolg — *echte* Gleichzeitigkeit (zwei Aufrufe mit demselben, zum Zeitpunkt beider Aufrufe noch gültigen Token) ist idempotent (`200`/`200`); ein *sequenzieller* zweiter Aufruf nach vollzogenem Logout scheitert konsistent an der Authentifizierung selbst (`401 AUTH_SESSION_INVALIDATED`, da der Access Token durch das erste Logout bereits ungültig ist) — beides dokumentiertes, stabiles Verhalten, kein Sonderfall.
- `POST /api/auth/logout-all`: widerruft **alle** Sitzungen/Refresh Tokens des Nutzers und erhöht zusätzlich atomar `users.auth_version` (zweite, unabhängige Verteidigungsebene zur reinen Sitzungs-Statusprüfung — identisch zur bereits etablierten Stage-3B1-Garantie bei Passwort-/E-Mail-Änderung). Aktuelles Passwort nicht erforderlich — die Autorisierung kommt aus dem gültigen Access Token + CSRF-/Origin-Prüfung. Andere Nutzer sind nachweislich unberührt (`authSessionApi.test.js`: "logout-all invalidates every session for the user, but leaves other users' sessions untouched").

---

## 11. Integration mit Stage 3B1

`accountService.js`s `changePassword` und `confirmEmailChange` rufen jetzt zusätzlich `sessionService.revokeAllSessionsInTransaction(connection, userId, reason)` **in derselben Transaktion** wie den bestehenden `auth_version`-Inkrement auf (nicht `logoutAll`, um den Zähler nicht doppelt zu erhöhen). Getestet: Passwortänderung aus einer aktiven Sitzung widerruft alle Sitzungen; E-Mail-Bestätigung in einem anderen Browser widerruft ebenfalls alle Sitzungen; ein Refresh unmittelbar während einer Passwort-/E-Mail-Änderung (`Promise.all`-Wettlauf) hinterlässt nie einen widersprüchlichen Zustand — unabhängig davon, wer den Wettlauf gewinnt, ist der *alte* Access Token danach in jedem Fall ungültig, und ein eventuell noch gewonnener *neuer* Token wird durch die Sitzungs-Widerrufung ebenfalls sofort entwertet.

---

## 12. Frontend: Bootstrap, Single-Flight, Mehrere Tabs

### Speicherung

`frontend/src/utils/auth.js`: `authToken`/`authUser` sind reine In-Memory-`ref()`s, mit `null` initialisiert. Ein einmaliger Migrationsschritt entfernt beim ersten Laden etwaige Alt-Schlüssel (`fittrack_token`, `fittrack_user`) aus `localStorage`/`sessionStorage`, ohne sie je zu lesen oder zu verwenden.

### Auth-Bootstrap

`ensureAuthBootstrap()` — memoisiert, vom Router-Guard vor der **ersten** Navigationsentscheidung abgewartet (`router/index.js`). Ein harter Reload startet immer mit `authToken.value === null`; Bootstrap versucht **genau einen** stillen Refresh (über den HttpOnly-Cookie) und lädt bei Erfolg zusätzlich `GET /api/users/me`, um `authUser` wiederherzustellen (die Refresh-Antwort enthält bewusst nur `{accessToken}`, kein Nutzerprofil — Trennung von Belangen). Ist bereits ein Token im Speicher vorhanden (z. B. direkt nach einem frischen Login), wird der Netzwerk-Roundtrip übersprungen.

### Single-Flight (innerhalb eines Tabs)

`apiRequest()` mit `token`: bei `401` genau ein Refresh-Versuch, danach genau ein Wiederholungsversuch der ursprünglichen Anfrage; parallele Anfragen im selben Tab teilen sich dasselbe In-Flight-Refresh-Promise (`refreshAccessToken()`). `/api/auth/refresh` selbst wird **nie** über `apiRequest()` aufgerufen (eigener `performRefresh()`-Pfad) — Endlosschleifen sind bereits strukturell ausgeschlossen, nicht nur durch ein Retry-Flag.

### Cross-Tab-Koordination

Siehe Abschnitt 9 für die Refresh-spezifische Koordination. Zusätzlich synchronisiert ein `BroadcastChannel('fittrack-session')` (`auth.js`) reine Ereignistypen zwischen Tabs — `logout`, `logout-all`, `session-invalidated`, `login` —, **niemals** einen Tokenwert. Bei `login` in einem anderen Tab versucht dieser Tab sein eigenes Bootstrap erneut (holt die neue Sitzung ohne manuellen Reload nach); bei den drei Invalidierungs-Ereignissen wird lokal aufgeräumt.

### Bekannte Grenze

Zwei unterschiedliche *Browser-Kontexte* oder Geräte werden absichtlich **nicht** in Echtzeit benachrichtigt — ein Logout-All in Tab/Gerät A wird von Gerät B erst bei dessen nächster eigener Anfrage/Navigation bemerkt (kein Server-Push, kein WebSocket in dieser Phase). Das ist dokumentiertes, akzeptiertes Verhalten (siehe `authSession.spec.js`s Logout-All-Test), keine Fehlfunktion.

---

## 13. Fehlercodes

| Code | Status | Bedeutung |
|---|---|---|
| `AUTH_SESSION_INVALIDATED` | 401 | Access Token strukturell ungültig, aus jedem in Abschnitt 8 genannten Grund (undifferenziert) |
| `AUTH_REFRESH_TOKEN_INVALID` | 401 | Refresh Token nicht gefunden/nicht `active`/Sitzung nicht `active` |
| `AUTH_REFRESH_TOKEN_EXPIRED` | 401 | Refresh Token oder Sitzung über die TTL hinaus |
| `AUTH_REFRESH_REUSE_DETECTED` | 401 | ein bereits rotierter (verwendeter) Refresh Token wurde erneut präsentiert — Sitzung kompromittiert |
| `AUTH_CSRF_INVALID` | 403 | Double-Submit- oder Token-Bindungs-Prüfung fehlgeschlagen |
| `AUTH_ORIGIN_NOT_ALLOWED` | 403 | vorhandener `Origin`-Header außerhalb der Allowlist |
| `AUTH_SESSION_LIMIT_REACHED` | 409 | Verteidigungs-Fallback, praktisch unerreichbar (siehe Abschnitt 7) |

Keine internen JWT-/SQL-/Cookie-/Crypto-Fehler werden je direkt durchgereicht — `httpFoundation.js`s bestehender Error-Normalizer bleibt unverändert zuständig.

---

## 14. Konfiguration (lokal, `backend/.env.example`)

```
AUTH_ACCESS_TOKEN_TTL_MINUTES=15   # 5–60
AUTH_REFRESH_TOKEN_TTL_DAYS=7      # 1–30
AUTH_MAX_ACTIVE_SESSIONS=10        # 1–100
AUTH_REFRESH_COOKIE_NAME=fittrack_refresh
AUTH_CSRF_COOKIE_NAME=fittrack_csrf
# AUTH_COOKIE_SECURE=false         # Default = NODE_ENV===production; Produktion erzwingt true
AUTH_COOKIE_SAME_SITE=strict       # strict | lax | none (none erfordert Secure=true)
```

---

## 15. Deployment-Anforderungen

- **Neuanmeldung nach Deployment**: einmalig für alle bestehenden Sitzungen (siehe Abschnitt 8), identisch zur bereits akzeptierten Stage-3B1-Erfahrung.
- **Produktion erzwingt** `AUTH_COOKIE_SECURE=true` (Startfehler sonst) — echtes HTTPS ist damit *vorausgesetzt*, aber Stage 3B2 richtet selbst **keine** TLS-Terminierung, keine Cloud-Infrastruktur und keinen echten S3-Bucket ein (unverändert außerhalb des Scopes).
- `CORS_ORIGIN` muss weiterhin die exakte(n) Produktions-Frontend-Origin(s) enthalten, da Cookie-Credentials nur für verifiziert erlaubte Origins reflektiert werden (Abschnitt 5).
- Keine neue Infrastrukturabhängigkeit: kein Redis, kein externer Sitzungsspeicher — `user_auth_sessions`/`user_refresh_tokens` leben in derselben MySQL-Datenbank wie der Rest der Anwendung.

---

## 16. Verbleibende Grenzen (bewusst außerhalb des Scopes)

- **Rate Limiter bleibt prozesslokal** (In-Memory), unverändert seit Stage 3A — bereits dokumentierte, hier nicht behobene Einschränkung; ein verteilter Limiter (Redis o. Ä.) ist explizit auf eine spätere Phase verschoben.
- **Keine vollständige Geräteverwaltung**: kein "meine Geräte"-Übersichtsbildschirm, keine Geräte-Fingerabdrücke, keine Speicherung vollständiger IP-Adressen — nur das für Sicherheit/Nachvollziehbarkeit Notwendige (Status, Zeitstempel, Widerrufsgrund).
- **Keine Zwei-Faktor-Authentifizierung, keine Passkeys, kein Social Login, keine Passwort-Reset-Flows, keine Kontolöschung** — alle unverändert außerhalb des Scopes dieser Phase.
- **Stage 2B2B bleibt verschoben** bis zum ersten zahlenden Kunden bzw. einer echten Produktionsbereitstellung — durch Stage 3B2 nicht berührt.
- **Cross-Tab-Koordination wirkt nur innerhalb eines Browser-Kontexts** (Abschnitt 9/12) — mehrere unabhängige Geräte/Profile bleiben unabhängige Sitzungen, wie beabsichtigt.
- **Keine Cloud-Infrastruktur** wurde für diese Phase eingerichtet oder vorausgesetzt; alle Tests laufen gegen die lokale MySQL-Instanz und den lokalen Playwright-Webserver.

---

## 17. Nachtrag: Dependency-Security-Gates im PR-CI (2026-07-25)

Der PR-CI für PR #17 fand zwei `npm audit --audit-level=high`-Funde, die den
Backend- und den Frontend-Job jeweils vor den eigentlichen Tests abbrachen
(Chromium-E2E/Axe waren bereits grün, betroffen war nur der Audit-Schritt).

**Backend:** `brace-expansion <=5.0.7` (High, [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)) über die rein transitive Kette `nodemon@3.1.14 → minimatch@10.2.4 → brace-expansion@5.0.7` (Dev-Abhängigkeit, nie im Laufzeit-Codepfad). Zusätzlich `body-parser 2.0.0–2.2.2` (Low, [GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6)) über `express@^5.2.1 → body-parser@2.2.2`. Beide Advisories wurden erst **nach** dem funktionalen Stage-3B2-Abschluss veröffentlicht/indiziert — zum Zeitpunkt der letzten lokalen Verifikation gab es noch keinen High-Fund. Behoben mit einem einfachen `npm audit fix` (kein `--force`): `body-parser 2.2.2 → 2.3.0`, `brace-expansion 5.0.7 → 5.0.8`, beide innerhalb der bereits von `express`/`nodemon` erlaubten Semver-Bereiche — **`backend/package.json` bleibt dabei unverändert**, nur `package-lock.json` wurde aktualisiert.

**Frontend:** dieselbe `brace-expansion <=5.0.7`-Advisory, aber über eine tiefere, ausschließlich Dev-Test-Abhängigkeitskette: `@vue/test-utils@2.4.11 → js-beautify@1.15.4 → editorconfig@1.0.7`/`glob@10.5.0 → minimatch@9.0.9 → brace-expansion@2.1.2` (die Advisory deckt mehrere Major-Linien von `brace-expansion` bis `5.0.7` ab). `@vue/test-utils@2.4.11` ist bereits die neueste verfügbare Version; `js-beautify`, `editorconfig` und `glob` haben jeweils nur ein Major-Upgrade verfügbar (keine kompatible Patch-/Minor-Version, die die Kette entschärft). `npm audit fix --force` hätte `@vue/test-utils` auf `2.2.7` **heruntergestuft** — ein Breaking-Downgrade, ausdrücklich nicht zulässig. Stattdessen wurde ein gezielter `overrides`-Eintrag in `frontend/package.json` ergänzt:

```json
"overrides": {
  "minimatch": "^10.2.4"
}
```

`minimatch` ist an dieser Stelle eine rein transitive Abhängigkeit (in keinem eigenen Code importiert), kommt im gesamten Frontend-Baum ausschließlich über genau diese eine Kette vor (`npm ls minimatch --all` bestätigt keine zweite, unabhängige Verwendung), und `minimatch@10.x` erfordert Node `18 || 20 || >=22` — vollständig innerhalb der bereits deklarierten Projekt-Engine (`^20.19.0 || >=22.12.0`). Die Override-Version erzwingt `minimatch@10.2.5`, was intern bereits `brace-expansion@^5.0.2` (aufgelöst zu `5.0.8`) verlangt — dieselbe Ziel-Range wie beim Backend-Fix. Kompatibilität wurde nicht nur angenommen, sondern durch die volle Regressionssuite (Abschnitt unten) empirisch bestätigt.

**Ergebnis:** Backend `npm audit --audit-level=high` vorher 2 Funde (1 low, 1 high) → nachher 0 Funde. Frontend vorher 6 High-Funde → nachher 0 Funde. Beide `npm ci`-reproduzierbar (Lockfiles frisch aus `node_modules`-Neuinstallation regeneriert und verifiziert). Vollständige Regression nach der Änderung: Backend Unit 405/405, Integration **194/194 (inklusive aller MinIO-Off-host-Tests, MinIO-Testcontainer für diese Verifikation aktiv gestartet)**, Migrationen 32/32, Syntax-Check 196/196, Migration Doctor `ready`/`applied:10`, Restore-Drill 15/15; Frontend Unit/Komponenten 305/305, Produktionsbuild erfolgreich; Chromium-E2E/Axe 37/37, keine übersprungenen Tests, keine Refresh-Reuse- oder CSRF-Regression. `.github/workflows/ci.yml` wurde nicht verändert — das Security-Gate (`--audit-level=high`, kein `continue-on-error`, kein `|| true`) bleibt exakt wie zuvor.
