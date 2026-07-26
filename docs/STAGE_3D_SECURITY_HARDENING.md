# Stage 3D: Security Hardening

Geprüfter Ausgangs-Commit: `5a2ecb7` (main, PR #18 "Merge... feature/stage-3c-pilot-ux-polish"), Branch `feature/stage-3d-security-hardening`. Diese Phase schliesst die letzten bekannten technischen Sicherheitslücken für den lokalen Pilotbetrieb: einen gemeinsam nutzbaren, atomaren MySQL-basierten Rate-Limit-Store anstelle des rein prozesslokalen In-Memory-Limiters, eine vollständig validierte CORS-Konfiguration, sichere Proxy-/Client-IP-Behandlung, konsistente Security Header, Request-Grössen- und Content-Type-Grenzen, ein stabiler 429-Fehlervertrag und produktionsnahe Konfigurationsvalidierung — vollständig lokal, ohne Redis, ohne Cloud-Rate-Limit-Dienst, ohne WAF, ohne CDN.

---

## 1. Ausgangsbefunde (Analyse vor Implementierung)

| Aspekt | Zustand vor Stage 3D |
|---|---|
| Rate-Limit-Speicherort | reine In-Memory-`Map` pro Node-Prozess (`middleware/rateLimiter.js`, `createFixedWindowRateLimiter`) — bei mehreren App-Instanzen hat jede ihr eigenes, unabhängiges Kontingent |
| Geschützte Endpunkte | Login, Registrierung, Passwortänderung, E-Mail-Änderung (Anfrage/Bestätigung), Einladung erneut senden |
| **Ungeschützte** Endpunkte | `POST /auth/refresh`, `POST /auth/logout-all`, Einladung erstellen, Einladung annehmen — kein Limit überhaupt |
| Schlüsselbildung | roh `req.ip` (Login/Registrierung) bzw. `${userId}:${invitationId}` als Klartext im Prozessspeicher — nie persistiert |
| CORS | `config/corsOrigins.js` akzeptierte `CORS_ORIGIN`, parste vollständige Origins, aber ohne Produktions-Sonderregeln (HTTP/localhost), ohne `CORS_ALLOW_CREDENTIALS`/`CORS_MAX_AGE_SECONDS`, ohne explizite minimale Methoden/Header |
| Trust Proxy | `TRUST_PROXY_HOPS` (0–10), aber implizit aktivierbar allein durch einen Zahlenwert — keine explizite Modus-Bestätigung, kein Produktionszwang |
| Client-IP-Normalisierung | keine — `req.ip` wurde roh als Schlüssel verwendet, IPv4-mapped IPv6 und IPv6-Klammerform wurden nicht vereinheitlicht |
| Security Header | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP bereits vorhanden (`middleware/httpFoundation.js`); **HSTS fehlte vollständig**; kein `Cache-Control: no-store` auf Auth-/Account-Antworten |
| Body-Limits | `express.json({ limit: '1mb' })`, fest verdrahtet, nicht konfigurierbar; kein Content-Type-Zwang — ein falscher Content-Type wurde von `express.json()` stillschweigend übersprungen statt abgelehnt |
| Konfigurationsvalidierung | jede Config-Datei validierte sich selbst beim ersten Zugriff (`config/auth.js`, `config/sessionConfig.js` eager; `config/corsOrigins.js` lazy) — keine zentrale, gebündelte Prüfung |
| Migration 011 | noch nicht vorhanden |

Diese Analyse (Abschnitt 4 des Auftrags) ergab: Der In-Memory-Rate-Limiter ist bei mehreren Instanzen wirkungslos (jede Instanz zählt für sich), Refresh und Logout-All hatten überhaupt kein Limit, und mehrere produktionsrelevante HTTP-Härtungen (HSTS, Content-Type-Erzwingung, konfigurierbare Body-Grössen, explizite Proxy-Bestätigung) fehlten vollständig.

---

## 2. Migration 011 (`011_security_rate_limits`)

Eine neue Tabelle, `database/migrations/011_security_rate_limits.js`, Guard-then-throw-Konvention (`SECURITY_RATE_LIMITS_SCHEMA_ALREADY_EXISTS`) wie alle vorherigen Migrationen.

### `security_rate_limit_buckets`

| Spalte | Typ | Zweck |
|---|---|---|
| `id` | `INT AUTO_INCREMENT PK` | interner Schlüssel |
| `policy_id` | `VARCHAR(64)` | stabile Policy-ID, z. B. `auth.login` |
| `key_hash` | `BINARY(32)` | HMAC-SHA-256 über den normalisierten Schlüssel — **nie** die rohe IP/E-Mail/Benutzer-ID |
| `window_started_at` | `DATETIME(3)` | Beginn des aktuellen Fensters |
| `request_count` | `INT UNSIGNED` | Zähler im aktuellen Fenster |
| `blocked_until` | `DATETIME(3)`, nullable | gesetzt, sobald `request_count > max`; sonst `NULL` |
| `expires_at` | `DATETIME(3)` | Fensterende (`window_started_at + windowMs`) |
| `created_at`, `updated_at` | `DATETIME(3)` | Buchführung — immer explizit von der Anwendung gesetzt, nie einem DB-Default überlassen |

**Bewusste Abweichung vom Schema-Standard:** Alle Zeitspalten sind `DATETIME(3)`, nicht `TIMESTAMP(3)` wie im Rest des Schemas. `TIMESTAMP`-Spalten werden von MySQL bei jedem Lesen/Schreiben anhand der Session-`time_zone` konvertiert; `DATETIME` speichert und liefert den gegebenen Wert wörtlich zurück, ohne jede implizite Konvertierung. Da diese Tabelle ausschliesslich von `rateLimiting/mysqlRateLimitStore.js` beschrieben wird — jeder Wert kommt explizit aus der injizierten Uhr, formatiert als eindeutiger UTC-String — eliminiert das jede Abhängigkeit von der Host- oder Server-Zeitzone. Das war kein theoretisches Risiko: ein früher Entwurf, der `TIMESTAMP` mit unverändertem mysql2-Standardverhalten kombinierte, zeigte auf diesem (mitteleuropäischen, UTC+2) Entwicklungsrechner einen realen, durch den eigenen Parallel-Request-Test aufgedeckten Zwei-Stunden-Versatz beim Lesen (siehe Abschnitt 4).

Eindeutiger Schlüssel: `UNIQUE INDEX (policy_id, key_hash)`. Index für Cleanup: `INDEX (expires_at)`. Check Constraints: `policy_id` nicht leer, `request_count >= 0`, `expires_at >= window_started_at`, `blocked_until IS NULL OR blocked_until <= expires_at`.

Geprüft: leere Datenbank, Upgrade von 010, wiederholter Lauf (No-op), Schema Contract (`backend/migrations/schemaContract.js`), Migration Doctor, Drift-Erkennung, Restore-Drill — siehe Abschnitt 24 des Berichts.

---

## 3. Rate-Limit-Datenmodell und Architektur

Austauschbarer Store hinter einem gemeinsamen Interface `consume({ policyId, keyHash, windowMs, max, now }) → { allowed, remaining, retryAfterSeconds, resetAt }`:

- **`rateLimiting/mysqlRateLimitStore.js`** — die einzige Implementierung, die die echte Anwendung verwendet (`startup/app.js`, `routes/users.js`).
- **`rateLimiting/memoryRateLimitStore.js`** — ausschliesslich für isolierte Unit-Tests; nirgends in der Produktions-Kompositionswurzel verdrahtet.
- **`middleware/rateLimiter.js`** — `createRateLimiters({ store, env })` baut aus einem Store und den zentralen Policies (`rateLimiting/rateLimitPolicies.js`) fertige Express-Middleware; **kein parameterloser Default mehr** — jeder Aufrufer (Kompositionswurzel, jeder Test) muss den Store explizit übergeben.

## 4. Atomaritätsmechanismus

`consume()` öffnet eine explizite Transaktion und sperrt die Zeile per `SELECT ... FOR UPDATE`, bevor über Reset/Inkrement entschieden wird — **nicht** ein einzelnes `INSERT ... ON DUPLICATE KEY UPDATE` gefolgt von einem ungesperrten `SELECT`. Letzteres war der erste Entwurf und wurde durch den eigenen Parallel-Request-Test (`test/integration/rateLimitStore.test.js`) als fehlerhaft entlarvt: Unter echter Nebenläufigkeit konnte das ungesperrte Folge-`SELECT` jedes wettstreitenden Aufrufers das bereits committete Inkrement eines *später* gestarteten Geschwisteraufrufs sehen — ein ganzer Schwung legitimer gleichzeitiger Aufrufer sah dadurch einen bereits über dem Limit liegenden Zähler und wurde fälschlich blockiert (0 von 30 statt der erwarteten 10 durchgelassen).

Der endgültige Ablauf pro `consume()`-Aufruf:
1. `INSERT IGNORE` legt bei Bedarf eine leere Zeile an (Duplikate bei echtem Wettlauf um einen brandneuen Schlüssel werden von der eindeutigen Spalte selbst verworfen).
2. `BEGIN`
3. `SELECT ... FOR UPDATE` sperrt exakt diese Zeile exklusiv bis zum Commit — ein zweiter gleichzeitiger Aufrufer für **denselben** Schlüssel blockiert an genau dieser Stelle, bis der erste committet oder zurückrollt, und sieht danach dessen bereits angewandte Aktualisierung. Unterschiedliche Schlüssel blockieren einander nie.
4. Anwendungscode entscheidet: Fenster abgelaufen → Reset auf 1; sonst → Zähler + 1.
5. `UPDATE` schreibt Zähler, Fenstergrenzen, `blocked_until`.
6. `COMMIT`.

Kein Scheduler nötig, keine negative Zeit (Retry-After wird als `Math.max(1, …)` berechnet), keine dauerhaft gesperrten Buckets (jedes Fenster läuft von selbst ab und wird beim nächsten Treffer zurückgesetzt).

## 5. Key-HMAC und Datenschutz

`rateLimiting/rateLimitKeys.js`: `hashRateLimitKey(secret, rawKey)` = HMAC-SHA-256, 32 Byte, passend zu `key_hash BINARY(32)`. **HMAC, nicht ein einfacher Hash** — ein einfacher SHA-256 über den kleinen, gut erratbaren IP-Adressraum wäre durch Brute-Force umkehrbar; die serverseitige geheime Schlüsselung (`RATE_LIMIT_KEY_SECRET`, `config/rateLimitConfig.js`) macht das praktisch unmöglich.

`RATE_LIMIT_KEY_SECRET`-Vertrag (spiegelt `config/auth.js`s Muster exakt):
- mindestens 32 Zeichen in Produktion, bekannte Platzhalter werden abgelehnt;
- **muss sich von `JWT_SECRET` unterscheiden** — geprüft direkt gegen dasselbe `env`-Objekt (nicht gegen das bereits aufgelöste Modul-Singleton von `config/auth.js`, was die Funktion unrein und schwer testbar gemacht hätte — ein Fehler, der beim Schreiben der eigenen Unit-Tests entdeckt und korrigiert wurde);
- niemals geloggt;
- sicherer Entwicklungs-Default (`DEVELOPMENT_SECRET`, garantiert verschieden vom analogen JWT-Default) ausserhalb der Produktion.

Normalisierung vor dem Hashing: `normalizeEmail` (trim + lowercase), `normalizeIp` (`security/clientIp.js` — IPv4-mapped IPv6 → IPv4, IPv6-Zonen-ID und Klammern entfernt).

Schlüsselstrategien pro Policy — siehe Tabelle in Abschnitt 6. Keine rohe E-Mail, IP oder Benutzerkennung landet je in der Tabelle; die öffentliche Token-Bestätigung (`email-change-confirmations`) verwendet die Client-IP als Schlüssel, nie das Bestätigungstoken selbst.

## 6. Policy-Inventar

Zentral in `rateLimiting/rateLimitPolicies.js`. Zehn Policies, davon vier neu (Refresh, Logout-All, Einladung erstellen, Einladung annehmen hatten zuvor **kein** Limit):

| Policy-ID | Limit | Fenster | Schlüssel | Code | Begründung |
|---|---|---|---|---|---|
| `auth.login` | 10 | 15 min | E-Mail + Client-IP | `RATE_LIMIT_EXCEEDED` | unverändertes Limit aus Stage 1/3B; Schlüsselstrategie exakt wie in der Aufgabenstellung vorgegeben |
| `auth.registration` | 5 | 60 min | Client-IP | `RATE_LIMIT_EXCEEDED` | unverändert |
| `auth.refresh` | 30 | 5 min | Client-IP | `RATE_LIMIT_EXCEEDED` | **neu** — grosszügig bemessen, damit der Stage-3C-Cross-Tab-Lock normale Refresh-Last (inkl. `--repeat-each=20`) nie auslöst |
| `auth.logoutAll` | 10 | 15 min | Benutzer-ID | `RATE_LIMIT_EXCEEDED` | **neu** |
| `account.passwordChange` | 5 | 60 min | Benutzer-ID | `RATE_LIMIT_EXCEEDED` | unverändert |
| `account.emailChangeRequest` | 5 | 60 min | Benutzer-ID | `RATE_LIMIT_EXCEEDED` | unverändert |
| `account.emailChangeConfirm` | 20 | 15 min | Client-IP | `RATE_LIMIT_EXCEEDED` | unverändert; öffentlicher Token-Endpunkt, Schlüssel ist die IP, nie das Token |
| `invitation.create` | 50 | 60 min | Actor-ID + Studio-ID | `RATE_LIMIT_EXCEEDED` | **neu** |
| `invitation.resend` | 5 | 15 min | Actor-ID + Invitation-ID | `INVITATION_RESEND_RATE_LIMITED` | unverändert aus Stage 3C |
| `invitation.accept` | 20 | 60 min | Benutzer-ID | `RATE_LIMIT_EXCEEDED` | **neu** |

Alle Limits/Fenster sind über Umgebungsvariablen überschreibbar (`AUTH_LOGIN_RATE_LIMIT_MAX`, `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS`, usw. — siehe `backend/.env.example`). Keine bestehende Policy wurde verschärft.

**Bekannter Kompromiss (Login-Schlüssel):** `auth.login` ist wie vorgegeben nach E-Mail **und** IP geschlüsselt, nicht mehr rein nach IP. Das bedeutet, ein Angreifer könnte theoretisch viele **verschiedene** E-Mail-Adressen von **einer** IP aus angreifen, ohne je das (nun pro E-Mail+IP-Kombination geführte) Limit zu treffen — ein reines Pro-IP-Limit hätte das verhindert, würde aber im Gegenzug einen verteilten Angriff auf **eine** Zieladresse begünstigen können. Da die Aufgabenstellung diese Schlüsselstrategie explizit vorgibt, wurde sie unverändert übernommen; die Login-Timing-Härtung aus Stage 3A (keine unterschiedlichen Antworten für "unbekannte E-Mail" vs. "falsches Passwort") bleibt davon unberührt.

## 7. Verhalten bei Rate-Limit-Store-Ausfall

`RateLimitStoreUnavailableError` (intern) → `middleware/rateLimiter.js` fängt sie und wandelt sie in `RateLimitBackendUnavailableError` (503, Code `RATE_LIMIT_BACKEND_UNAVAILABLE`, keine SQL-/Treiber-Details in der Antwort) — **fail closed**, nie ein stiller Durchlass, nie ein Fallback auf In-Memory. Da der Store dieselbe MySQL-Infrastruktur wie die Anwendung nutzt, ist ein echter Store-Ausfall bereits über den bestehenden Readiness-Check (`db.verifyConnection`) sichtbar; eine separate, redundante Readiness-Prüfung nur für die Rate-Limit-Tabelle wäre unnötige Komplexität ohne zusätzlichen Nutzen.

Bewiesen mit zwei echten, unabhängigen Express-App-Instanzen (`test/integration/rateLimitMultiInstance.test.js`): ein Store-Ausfall auf einer frischen Instanz liefert 503 mit dem dokumentierten Code, nie einen unbegrenzten Durchlass.

## 8. Retry-After

Immer als ganzzahlige Sekunden im `Retry-After`-Header bei jeder 429-Antwort; zusätzlich `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` (RFC-ähnliche Konvention, unverändert aus dem alten In-Memory-Limiter übernommen). Nie negativ (`Math.max(1, …)`). Frontend liest `Retry-After` einheitlich über `frontend/src/utils/api.js`s `apiRequest()` (`error.retryAfterSeconds`, `null` wenn abwesend/ungültig) und zeigt einen Countdown (`frontend/src/utils/retryCountdown.js`) — siehe Abschnitt 15.

## 9. Cleanup

`rateLimiting/rateLimitCleanup.js`: `cleanupExpiredBuckets({ database, now, batchSize, maxBatches })` löscht ausschliesslich Buckets mit `expires_at < now`, in begrenzten Batches (`LIMIT`), nie eine lange globale Sperre. Zwei Aufrufwege:
- **Lazy:** ~1 % jedes `consume()`-Aufrufs löst zusätzlich einen kleinen, unabhängigen (`fire-and-forget`, Fehler werden geloggt, nie propagiert) Cleanup-Batch aus.
- **Manuell:** `npm run security:rate-limits:cleanup` (`backend/scripts/rateLimitCleanup.js`).

Kein Scheduler, idempotent (ein zweiter Lauf findet nichts mehr zu löschen), sicher unter parallelem Betrieb (jede Löschung ist eine eigenständige, gewöhnliche `DELETE`-Anweisung).

## 10. Trust Proxy und Client-IP-Behandlung

`config/proxyConfig.js`: `TRUST_PROXY_MODE` = `"disabled"` (Standard; `X-Forwarded-For` wird nie konsultiert, `req.ip` ist immer die rohe TCP-Peer-Adresse) oder `"hops"` (verlangt ein explizites, begrenztes `TRUST_PROXY_HOPS`, 1–10). Produktion muss den Modus explizit setzen. Nie `app.set('trust proxy', true)` — immer eine konkrete Ganzzahl.

`security/clientIp.js`: `normalizeIp` vereinheitlicht IPv4-mapped IPv6 (`::ffff:127.0.0.1` → `127.0.0.1`), IPv6-Zonen-ID und Klammerform; `resolveClientIp(req)` liest ausschliesslich, was Express bereits als `req.ip` entschieden hat — liest **nie selbst** `X-Forwarded-For`. `maskIpForLogging` liefert eine verlustbehaftete, nicht umkehrbare Kurzform (IPv4 `/16`, IPv6 erste zwei Hextets) für eine mögliche künftige Anzeige; aktuell wird ohnehin nirgends eine IP geloggt.

Bewiesen mit zwei echten App-Instanzen: ohne Trust-Proxy-Konfiguration ändert ein client-seitig gesetztes `X-Forwarded-For` den Rate-Limit-Schlüssel nicht; mit explizitem `TRUST_PROXY_MODE=hops`/`TRUST_PROXY_HOPS=1` werden zwei unterschiedliche weitergeleitete Adressen korrekt als zwei unterschiedliche Clients behandelt.

## 11. CORS-Vertrag

`config/corsOrigins.js`, umbenannt von `CORS_ORIGIN` zu `CORS_ALLOWED_ORIGINS` (keine externe Produktion existiert noch — ein sauberer Umbenennung wurde einer doppelten Variable vorgezogen; alle Referenzen in `.env.example`, CI, Playwright-Konfiguration, README, Tests wurden mitgezogen).

**Origin-Parsing** — strukturell geprüft (`pathname === '/'`, `search === ''`, `hash === ''`, keine Zugangsdaten), nicht per Ganzstring-Vergleich gegen `.origin` (Letzteres hätte auch harmlose Gross-/Kleinschreibung oder einen expliziten Standard-Port fälschlich abgelehnt — ein Fehler, der beim Schreiben der eigenen Unit-Tests gefunden und korrigiert wurde). `.origin` selbst normalisiert Standard-Ports weg und schreibt den Host klein, was einen Verwechslungsangriff wie `https://example.com.evil.test` gegen `https://example.com` strukturell unmöglich macht — beide werden als exakt zwei verschiedene Strings verglichen, nie als Teilstring/Suffix/Regex. Duplikate werden entfernt.

**Produktionsregeln:** kein `http:`-Origin, kein `localhost`/`127.*`/`::1` — beides ausnahmslos.

**Credentials/Preflight/Header** (`startup/app.js`): `CORS_ALLOW_CREDENTIALS` (Standard `true`) und `CORS_MAX_AGE_SECONDS` (Standard 600) sind jetzt explizite Konfiguration. `Access-Control-Allow-Credentials: true` wird ausschliesslich reflektiert, wenn die Origin sowohl der Allowlist entspricht **als auch** `CORS_ALLOW_CREDENTIALS` es erlaubt. Minimale, explizite `methods`/`allowedHeaders` (`GET, POST, PUT, PATCH, DELETE` bzw. `Content-Type, Authorization, X-CSRF-Token`) statt der freizügigen Standardwerte des `cors`-Pakets. `exposedHeaders` gibt der Browser-JS gezielt Zugriff auf die Rate-Limit-Buchführungsheader und `X-Request-ID`. `Vary: Origin` wird vom `cors`-Paket automatisch gesetzt, sobald die Origin-Option eine Funktion ist (hier immer der Fall) — durch `test/integration/corsHeaders.test.js` direkt geprüft.

**Origin `null`:** wird nie als erlaubt behandelt (keine Sonderbehandlung nötig — der String `"null"` matcht schlicht keinen konfigurierten Origin-Eintrag).

**Same-Host-Ausnahme** (unverändert aus Stage 3B2 übernommen): eine Anfrage, deren `Origin`-Host exakt dem `Host`-Header entspricht, gilt als same-origin und wird unabhängig von der Allowlist erlaubt — ein Server, der sich selbst anspricht, ist kein Cross-Origin-Fall.

**Fehlender Origin-Header:** weiterhin dokumentiert zulässig für Nicht-Browser-Aufrufer (Curl, Backend-Integrationstests); der Stage-3B2-Origin-Guard für Cookie-Endpunkte (`security/originGuard.js`) bleibt unverändert und unabgeschwächt.

Bewiesen sowohl per HTTP (`test/integration/corsHeaders.test.js` — exakte Header, Preflight, keine Header für abgelehnte/lookalike/`null`-Origin, kein Wildcard) als auch **echt im Browser** (`frontend/e2e/corsSecurity.spec.js` — Section 14 verlangt ausdrücklich mehr als Supertest, da nur ein echter Browser `fetch()` selbst blockiert): erlaubter credentialed Request inkl. echtem Preflight, abgelehnte Evil-Origin (einfach und credentialed), abgelehnter Header ausserhalb der minimalen Liste, `Origin: null` (via `data:`-URL), sowie `localhost` vs. `127.0.0.1` als zwei tatsächlich unterschiedliche, unabhängig konfigurierte Origins.

## 12. Security Header

`middleware/httpFoundation.js`, `createSecurityHeaders({ env })`: bestehende Header (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP) unverändert, **plus** `Strict-Transport-Security` — ausschliesslich wenn `NODE_ENV=production`. Nicht über TLS-Erkennung auf der Verbindung, sondern weil `config/sessionConfig.js` Produktion bereits zwingt, `AUTH_COOKIE_SECURE=true` zu setzen — "dieser Prozess läuft als Produktion" impliziert dort bereits "dieses Deployment ist HTTPS-terminiert". `X-Powered-By` war bereits deaktiviert (`app.disable('x-powered-by')`).

`Cache-Control: no-store` auf jeder Antwort der Auth-Session-, Account- und User-Router (`noStoreCache`-Middleware, `router.use()` an der Spitze von `authSessionRouter.js`, `accountRouter.js`, `routes/users.js`) — Login/Registrierung/`/me`, Refresh/Logout/Logout-All, Passwort-/E-Mail-Änderung sind nie cachebar.

Keine neue CSP eingeführt — die bestehende (`default-src 'none'`) ist für eine reine JSON-API bereits maximal restriktiv und bricht nichts am Vue-Frontend, das ohnehin nie von diesem Server ausgeliefert wird.

## 13. Body-Limits und Content-Type

`config/requestLimitsConfig.js`: `REQUEST_JSON_LIMIT` (Standard `256kb`, war zuvor fest `1mb`), Format eagerly geprüft (Startfehler bei ungültigem Wert). **Kein** `REQUEST_FORM_LIMIT` — diese API hat keinen `express.urlencoded()`/Multipart-Parser überhaupt eingebunden; ein Limit dafür würde einen nicht existierenden Parser konfigurieren.

`createJsonContentTypeGuard()` (`middleware/httpFoundation.js`): für mutierende Methoden (POST/PUT/PATCH/DELETE) wird ein **vorhandener, aber falscher** Content-Type mit 415 `UNSUPPORTED_MEDIA_TYPE` abgelehnt, **bevor** `express.json()` überhaupt läuft. Ein **fehlender** Content-Type wird unverändert durchgelassen — `POST /auth/refresh`, `/auth/logout`, `/auth/logout-all` werden vom Frontend bewusst ohne Body und ohne Content-Type aufgerufen (`frontend/src/utils/api.js`s `performRefresh()`). GET/HEAD/OPTIONS sind von der Prüfung ausgenommen, Health-Endpunkte bleiben unangetastet.

Ein zu grosser Body liefert weiterhin 413 `PAYLOAD_TOO_LARGE` (unverändert aus dem bestehenden `errorHandler`, jetzt mit dem konfigurierbaren statt fest verdrahteten Limit). Beide Fehlerpfade geben keine internen Parser-/Bibliotheksdetails preis.

## 14. Konfigurationsvalidierung

`config/startupConfig.js`: `validateStartupConfig(env)` führt alle produktionsrelevanten Config-Reader gebündelt aus (`JWT_SECRET`, `RATE_LIMIT_KEY_SECRET`, Session/Cookie, CORS, Trust Proxy, Request-Grössen, Datenbankverbindung) und sammelt **alle** gefundenen Probleme statt beim ersten abzubrechen — aufgerufen an erster Stelle in `server.js`s `main()`.

**Ehrliche Einschränkung:** `config/auth.js`, `config/sessionConfig.js` und `config/rateLimitConfig.js` (alle aus früheren Phasen) validieren bereits eigenständig beim Modul-Top-Level — beim echten Prozessstart kann daher weiterhin eines davon über die normale `require()`-Kette als Erstes werfen, bevor `validateStartupConfig()` überhaupt läuft. Das schwächt die eigentliche Garantie nicht ab (ungültige Konfiguration ist immer noch ausnahmslos ein Startfehler, nie eine Überraschung zur Laufzeit) — es bedeutet nur, dass der eigentliche Mehrwert dieser Funktion im gebündelten, vollständigen Prüfen und Melden liegt, nicht darin, buchstäblich die erste ausgeführte Codezeile zu sein.

## 15. Frontend-429-UX

`frontend/src/utils/api.js`: `apiRequest()` liest den `Retry-After`-Header aus jeder Fehlerantwort und hängt `retryAfterSeconds` (Ganzzahl oder `null`) an den geworfenen `Error` — der eine Sammelpunkt, durch den jeder Aufrufer bereits läuft.

`frontend/src/utils/retryCountdown.js`: `createRetryCountdown()` liefert einen reaktiven Sekunden-Countdown; zählt herunter, deaktiviert nie automatisch erneut den Request (kein aggressiver Auto-Retry) — nur der jeweilige Submit-Button wird während des Countdowns deaktiviert und danach wieder freigegeben.

Verdrahtet in: `LoginView.vue`, `RegisterView.vue` (beide neu — hatten zuvor gar keine 429-spezifische Meldung, jeder Fehlerstatus kollabierte auf dieselbe generische Meldung), `ProfileView.vue` (Passwortänderung und E-Mail-Änderungsanfrage — bestehende `status === 429`-Erkennung erweitert um den Countdown, unverändert in der Fehlermeldung selbst), `StudioInvitationsView.vue` (erneut senden — bestehende `INVITATION_RESEND_RATE_LIMITED`-Zuordnung erweitert um den Countdown). Neue gemeinsame i18n-Schlüssel `common.rateLimited`/`common.retryAfter` (DE+EN) für die beiden neuen Formulare; die bestehenden, feature-spezifischen Meldungen (`profile.security.rateLimited`, `studios.invitations.resendRateLimited`) blieben unverändert, um keine bestehende Testerwartung zu berühren.

**Bewusst unverändert gelassen:** `logoutAll()` (`frontend/src/utils/auth.js`) verschluckt weiterhin jeden Fehler einschliesslich eines 429 — das ist eine bestehende, getestete Stage-3B2-Garantie ("Logout muss aus Nutzersicht immer funktionieren"), die Abschnitt 22 explizit unverändert verlangt ("Session-Verhalten bleibt unverändert"). Eine rate-limitierte Logout-All-Anfrage löscht weiterhin den lokalen Zustand und leitet zum Login weiter, revoziert aber die Sitzung serverseitig nicht — ein bewusster, dokumentierter Kompromiss, keine Unterlassung.

## 16. Logging und Redaction

Rate-Limit-Logs enthalten ausschliesslich Policy-ID, Ergebnis, Retry-After, Request-ID — nie E-Mail, rohe IP, Token, Cookie, Authorization-Header, den vollständigen Key-Hash oder das Rate-Limit-Secret. Ein erwartetes 429 wird auf `info`-Level geloggt (nicht `warn`/`error`) — es ist die Limiterfunktion, die wie vorgesehen greift, kein Alarmsignal. Explizit getestet (`test/unit/rateLimiter.test.js`, Abschnitt "Section 18").

## 17. Tests

**Backend-Unit:** Policy-Konfiguration, HMAC-Schlüsselbildung, IP-Normalisierung, Origin-Parsing/CORS-Matching, Proxy-Konfiguration, Retry-After, Security Header (inkl. HSTS nur Produktion), Content-Type-/Body-Limit-Fehlerpfade, Startkonfiguration (gebündelt, mehrere Probleme gleichzeitig), Log-Redaction.

**Backend-Integration:** Store-Ebene direkt (Fensterwechsel, echte Parallelität — der Test, der den ursprünglichen Zwei-Stunden-Zeitzonenfehler und den Read-after-Write-Race fand —, kein Klartext-Schlüssel, Cleanup, Store-Ausfall); **zwei echte, unabhängige Express-App-Instanzen** (`rateLimitMultiInstance.test.js`) für geteiltes Kontingent, Parallelität über beide Instanzen, Fensterwechsel, Store-Ausfall, X-Forwarded-For-Spoofing ohne/mit expliziter Proxy-Konfiguration; CORS-Header-Vertrag per HTTP; Request-Grössen/Content-Type/`Cache-Control` per HTTP; alle bestehenden Auth-/Account-/Studio-Integrationstests liefen nach dem Umbau grün — bis auf einen echten, vorbestehenden Deadlock, der dabei erst gefunden wurde (siehe Abschnitt 18).

**Frontend-Unit:** neue 429-Pfade in Login/Register/Profile/Invitations, `retryCountdown.js` isoliert (Countdown, Rundung, Mehrfachstart, `clear()`), `api.js`s neue `retryAfterSeconds`-Erfassung.

**Browser-E2E:** `corsSecurity.spec.js` (Abschnitt 11), `rateLimitSecurity.spec.js` (Login-429 mit Countdown und Fensterwechsel über eine testspezifische, kurze Login-Policy für die E2E-Backend-Instanz — **nicht** eine verkleinerte Produktionsvorgabe, siehe Kommentar in `playwright.config.js`; Einladung-Resend-429 über die reale, unveränderte Produktionsrichtlinie; 413/415; Security Header; Axe-Smoke auf dem ratenlimitierten Fehlerzustand).

## 18. Nebenbefund: Lock-Order-Deadlock in `rotateRefreshToken`

Die volle Backend-Integrationssuite (Abschnitt 17) deckte einen echten, vorbestehenden Deadlock zwischen `POST /api/auth/refresh` und `POST /api/account/change-password` (bzw. der E-Mail-Bestätigung) für denselben Nutzer auf, sichtbar als sporadisches `500 INTERNAL_ERROR` statt `200` im dafür vorgesehenen Race-Test (`authSessionApi.test.js`: "a refresh racing immediately against a password change …").

**Ursache:** `sessionService.js`s `rotateRefreshToken()` sperrte `user_auth_sessions` und `users` bisher über ein einziges `JOIN ... FOR UPDATE`, dessen Sperrreihenfolge vom MySQL-Optimizer abhängt und in der Praxis zuerst `user_auth_sessions`, dann `users` sperrte. `accountService.js`s `changePassword`/`confirmEmailChange` und `sessionService.js`s eigenes `logoutAll` sperren dagegen — bereits seit Stage 3B1/3B2 und mit explizitem Code-Kommentar dokumentiert — konsequent zuerst `users`, dann `user_auth_sessions`. Zwei Transaktionen mit umgekehrter Sperrreihenfolge sind ein klassischer ABBA-Deadlock; InnoDB erkennt das und bricht eine der beiden Transaktionen mit `ER_LOCK_DEADLOCK` ab, was unbehandelt als generischer 500er nach aussen durchschlug.

**Warum jetzt sichtbar:** Der Fehler war nicht neu, aber selten — das enge Zeitfenster, in dem beide Transaktionen tatsächlich gegenläufig interleaven, wurde durch die zusätzliche, echte Latenz des neuen MySQL-Rate-Limit-Stores (Abschnitt 3) vor jeder der beiden Anfragen spürbar breiter, wodurch der Deadlock im vollen Regressionslauf reproduzierbar auftrat statt (wie zuvor vermutlich) nur theoretisch zu existieren.

**Fix:** `rotateRefreshToken()` ermittelt den Besitzer der Session jetzt über einen ungesperrten Lookup (die Zuordnung Session→Nutzer ist nach Anlage unveränderlich), sperrt anschliessend explizit zuerst `users`, dann `user_auth_sessions` — exakt das bereits etablierte Muster aus `confirmEmailChange` ("peek-then-lock-in-order"). Damit gilt für alle Transaktionen, die beide Tabellen anfassen, dieselbe globale Sperrreihenfolge; ein ABBA-Zyklus ist damit strukturell ausgeschlossen, nicht nur unwahrscheinlicher gemacht. Verifiziert durch 5 isolierte Wiederholungen des Race-Tests sowie zwei vollständige, saubere Läufe der gesamten Backend-Integrationssuite (231/231) und der Unit-Suite (469/469) danach.

Diese Änderung liegt ausserhalb des ursprünglichen Stage-3D-Scopes (Rate-Limiting/CORS/Security-Header), war aber notwendig, um die von Abschnitt 25 geforderte, vollständig grüne Regression ehrlich zu erreichen, statt den Befund zu ignorieren oder den Test zu schwächen.

## 19. Bekannte Grenzen

- Der beschriebene Login-Schlüssel-Kompromiss (Abschnitt 6).
- `logoutAll()`s bewusst unverändertes "verschluckt jeden Fehler"-Verhalten (Abschnitt 15).
- `validateStartupConfig()`s ehrliche Grenze, nicht notwendigerweise die erste ausgeführte Codezeile beim Start zu sein (Abschnitt 14).
- Kein `REQUEST_FORM_LIMIT` (keine Notwendigkeit, siehe Abschnitt 13).
- Zwei E2E-Tests mit vielen aufeinanderfolgenden Hard-Reloads derselben Identität (`accessibility.spec.js`s 17-Routen-Schleife, `coachFeedback.spec.js`s Zwei-Reload-Fall) liefen nach Einführung des MySQL-Rate-Limit-Stores gelegentlich in den Standard-Testtimeout (45s), weil jeder Reload einen eigenen Silent-Refresh-Bootstrap auslöst und Refresh jetzt einen echten, notwendigen MySQL-Roundtrip für seinen Rate-Limit-Bucket macht — bei 17 Reloads plus Axe-Analyse je Route summiert sich das auf über eine Minute. Ein erster Verdacht auf eine echte Race-Bedingung (untermauert durch unterschiedliche Fehlerbilder zwischen Testläufen) erwies sich bei genauerer Diagnose als Nebenwirkung des zu knappen Zeitbudgets, nicht als Logikfehler: Ein zeitinstrumentierter Nachbau der exakten 17-Routen-Sequenz zeigte, dass bereits Route 15 nach ~59s erreicht wurde, deutlich über dem 45s-Budget. Behoben durch `test.setTimeout(180_000)` (`accessibility.spec.js`) bzw. die bereits vorhandenen `test.setTimeout(120_000)` (`coachFeedback.spec.js`), bei unverändertem `networkidle`-Warten; beide Tests liefen danach je 3/3 stabil in Isolation. Die aus Stage 3B2/3C bereits dokumentierte, dort als Restrisiko akzeptierte Race-Klasse zwischen aufeinanderfolgenden Hard-Reloads selbst wurde durch Stage 3D nicht verändert und ihre Behebung war nicht Gegenstand dieser Phase.
