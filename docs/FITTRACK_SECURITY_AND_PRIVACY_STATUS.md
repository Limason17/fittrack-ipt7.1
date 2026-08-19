# FitTrack Sicherheits- und Datenschutzstatus

Stand: 2026-07-19, geprüfter Commit `8a8da30` (main), ergänzt am 2026-07-20 um den neuen Abschnitt „Coach-Feedback (Stage 1B.2B2B)" sowie eine neue Zeile in der Datenschutzklassifikation, und erneut ergänzt (selbes Datum) um den SMTP-Adapter-Status in „Einladungen" und Punkt 6 der Lückenliste (Stage 2A) — der übrige Bestand wurde nicht rückwirkend umgeschrieben. Klassifikationslegende: **[GETESTET]** implementiert und automatisiert getestet (Testdatei zitiert) · **[MANUELL]** implementiert, nur durch Code-Lesen nachvollziehbar · **[DOKU]** nur dokumentiert, kein Code · **[OFFEN]** fehlt komplett.

> **Nachtrag (2026-07-22, Stage 3A Local Pilot Readiness Audit, Commit `dc12b10`):** Alle unten dokumentierten Kernaussagen wurden in dieser Sitzung durch frische, eigene API-Proben gegen den laufenden lokalen Server erneut bestätigt (nicht nur aus Code-Lektüre übernommen): Tenant-Isolation (fremdes/nicht-existierendes Studio identisch `404`, keine numerische ID im Payload), Einladungssicherheit (Doppel-Einladung `409`, Replay-Annahme `409`, fremdes-Studio-Widerruf `404`, kaputtes Token `404`, keine Stacktraces), RBAC-Default-Deny (Mitglied ohne Berechtigung `403` auf Mitgliederliste/Audit-Events). Die 22 MinIO-Off-host-Integrationstests wurden in dieser Sitzung erneut real gegen eine lokale MinIO-Testinstanz ausgeführt und bestanden vollständig (148/148 Backend-Integrationstests insgesamt). Volle Details, inklusive der neu identifizierten P1-Punkte (kein Passwort-/E-Mail-Self-Service, kein JWT-Refresh/Logout-Revocation, Rate-Limiting weiterhin nur auf Login/Registrierung), siehe `STAGE_3A_LOCAL_PILOT_READINESS_AUDIT.md`. Kein hier dokumentierter Befund wurde durch dieses Audit widerlegt oder relativiert.
>
> **Nachtrag (2026-07-22, Stage 3B1 Account Self-Service):** Zwei der oben genannten P1-Punkte sind jetzt geschlossen. JWTs tragen einen neuen `authVersion`-Claim (`{ id, authVersion }`), geprüft bei **jeder** authentifizierten Anfrage gegen `users.auth_version` (ein zusätzlicher indizierter Primärschlüssel-Lookup pro Request) — Passwortänderung und bestätigte E-Mail-Änderung erhöhen `auth_version` atomar und invalidieren dadurch zuverlässig jedes zuvor ausgestellte Token, ohne Sitzungsspeicher. Ein Token ohne (oder mit falschem) `authVersion`-Claim wird einheitlich als `401 AUTH_SESSION_INVALIDATED` abgelehnt — bewusst ein einziger Code für „Version veraltet", „Claim fehlt" und „Benutzer existiert nicht mehr", um keine dieser drei Ursachen voneinander oder von einer echten Kontoexistenz zu unterscheiden. Passwortänderung erfordert zwingend das aktuelle Passwort (`bcrypt.compare`, `401 CURRENT_PASSWORD_INVALID` sonst) und lehnt ein identisches neues Passwort ab. E-Mail-Änderung erfordert ebenfalls das aktuelle Passwort, nutzt ein 256-Bit-Bestätigungstoken (identisches Erzeugungs-/Hashing-Schema wie Einladungstokens, SHA-256 als `BINARY(32)`, nie Klartext gespeichert) mit einer festen 60-Minuten-Lebensdauer, ist replay-sicher (`FOR UPDATE`-Sperre + `WHERE status='pending'`-Guard, per Integrationstest mit echter Nebenläufigkeit bewiesen: „two concurrent confirmations of the same token: exactly one succeeds") und schließt eine E-Mail-Race zwischen zwei Benutzern über den bestehenden `UNIQUE`-Index auf `users.email`. Der Bestätigungsendpunkt ist bewusst öffentlich (kein Bearer-Token nötig, da der Link an die neue Adresse geht) und erfordert einen expliziten Klick statt Auto-Bestätigung beim Laden — schützt gegen Mail-Sicherheits-Scanner, die die Seite vorab abrufen und sonst den Einmal-Token verbrauchen würden. Neue Rate-Limits: `AUTH_PASSWORD_CHANGE_RATE_LIMIT_MAX` (Default 5/h), `AUTH_EMAIL_CHANGE_RATE_LIMIT_MAX` (Default 5/h), `AUTH_EMAIL_CHANGE_CONFIRM_RATE_LIMIT_MAX` (Default 20/15min) — dieselbe In-Memory-pro-Prozess-Einschränkung wie die bestehenden Login-/Registrierungs-Limiter (Punkt 8 der Lückenliste unten gilt jetzt auch für diese drei). Volle Details siehe `STAGE_3B1_ACCOUNT_SELF_SERVICE.md`. Weiterhin offen: JWT-Refresh, Geräte-/Sitzungsübersicht, 2FA, Passwort-vergessen/Reset, Kontolöschung/Datenexport — alle explizit außerhalb des Scopes dieser Phase.
>
> **Nachtrag (2026-07-25, Stage 3B2 Session Hardening):** Der oben genannte Punkt "JWT-Refresh" ist jetzt geschlossen, "Geräte-/Sitzungsübersicht" teilweise. Der reine zustandslose Access-JWT ist durch serverseitig widerrufbare Authentifizierungssitzungen ersetzt (Migration 010, `user_auth_sessions`/`user_refresh_tokens`): Access Token 15 Minuten, nur im Frontend-Arbeitsspeicher (nie mehr `localStorage`); Refresh Token 256-Bit-Zufall, 7 Tage, HttpOnly-Cookie, SHA-256-gehasht gespeichert, rotierend und einmalig verwendbar (jede Wiederverwendung eines bereits rotierten Tokens kompromittiert die gesamte Sitzung — `AUTH_REFRESH_REUSE_DETECTED`, alle Refresh Tokens der Sitzung werden widerrufen). CSRF-Schutz für die drei neuen Cookie-Endpunkte (`POST /api/auth/refresh|logout|logout-all`) über Double-Submit-Cookie **plus** serverseitige Bindung des CSRF-Hashes an die konkrete Refresh-Token-Zeile (stärker als reines Double-Submit); Origin-Schutz lässt einen *fehlenden* `Origin`-Header bewusst durch (dokumentierte CLI-/Testausnahme, ein *vorhandener* falscher Origin wird immer abgelehnt). `Access-Control-Allow-Credentials` wird jetzt korrekt nur für verifiziert erlaubte Origins reflektiert (vorher gar nicht gesetzt — kein Credential-Leak, aber auch keine funktionierenden Cookie-Endpunkte ohne diese Korrektur). Logout widerruft die aktuelle Sitzung; Logout-All widerruft alle Sitzungen des Nutzers und erhöht zusätzlich `auth_version`; Passwortänderung und bestätigte E-Mail-Änderung widerrufen jetzt zusätzlich zum bestehenden `auth_version`-Inkrement alle Sitzungen explizit. Ein während der Härtung gefundener und behobener echter Bug: ein doppeltes Freigeben derselben Datenbankverbindung im Reuse-Detection-Zweig konnte unter echter Nebenläufigkeit die Verbindung einer anderen, parallel laufenden Anfrage korrumpieren (siehe `STAGE_3B2_SESSION_HARDENING.md` Abschnitt 9). Der oben unter Punkt 4 gelistete Timing-Seitenkanal ist ebenfalls seit dieser Phase behoben. Weiterhin offen: vollständige Geräteübersicht mit einzeln benennbaren Sitzungen, 2FA, Passwort-vergessen/Reset, Kontolöschung/Datenexport, sowie der bereits mehrfach dokumentierte prozesslokale Rate Limiter (Punkt 8 unten) — alle weiterhin explizit außerhalb des Scopes. Volle Details siehe `STAGE_3B2_SESSION_HARDENING.md`.
>
> **Nachtrag (2026-07-25, Stage 3C Pilot-UX-Politur):** Neuer Endpunkt `POST /api/v1/studios/:studioId/invitations/:invitationId/resend` (Owner/Admin, neue Permission `invitation.resend`, Trainer explizit ausgeschlossen — das bestehende Permission-Modell erlaubte Trainern nie eine Einladungs-Aktion). Sicherheitseigenschaften: alter Token wird beim Commit unbedingt ungültig, unabhängig vom Zustellergebnis; neuer Token 256-Bit-Zufall/SHA-256, identisches Erzeugungsschema wie bei Create; widerrufene Einladungen werden nie reaktiviert (`409 INVITATION_REVOKED` vor jeder Mutation geprüft); bereits aktive Mitgliedschaften blockieren Resend (`409 INVITATION_EMAIL_ALREADY_MEMBER`); fremdes Studio liefert ununterscheidbar `404 INVITATION_INVALID`; `SELECT ... FOR UPDATE` auf die Einladungszeile serialisiert konkurrierende Resend-Aufrufe, sodass empirisch (Integrationstest mit drei parallelen Aufrufen) immer genau ein Token gültig bleibt; Zustellfehler kompensieren wie bei Create durch Widerruf, nie ein irreführend erfolgreicher Zustand. Neuer eigener Rate-Limiter (`INVITATION_RESEND_RATE_LIMIT_MAX`, Default 5/15min, geschlüsselt pro Aktor **und** Einladung, eigener Fehlercode `INVITATION_RESEND_RATE_LIMITED` statt des bisher einzigen generischen `RATE_LIMIT_EXCEEDED`) — dieselbe In-Memory-pro-Prozess-Einschränkung wie alle bestehenden Limiter (Punkt 8 unten gilt jetzt auch dafür). Volle Details siehe `STAGE_3C_PILOT_UX_POLISH.md`. Weiterhin offen und unverändert: Rate-Limiting bleibt auf Login/Registrierung/Account-Aktionen/Invitation-Resend beschränkt, keine generelle Ausweitung auf alle mutierenden Endpunkte (Stage 3D vorbehalten), CORS-Same-Host-Regel weiterhin ungetestet gegen ein reales Ziel-Deployment, toter Policy-Code (`coachActionEligibility`) weiterhin unbereinigt.
>
> **Nachtrag (2026-07-26, Stage 3D Security Hardening):** Die Punkte 7 und 8 unten sind jetzt geschlossen. Rate Limiting ist nicht mehr pro Prozess: ein gemeinsamer, atomarer MySQL-Store (Migration 011, `security_rate_limit_buckets`) wird von jeder Anwendungsinstanz geteilt, bewiesen mit zwei echten unabhängigen Express-App-Instanzen (`test/integration/rateLimitMultiInstance.test.js`). Neu abgedeckt: Refresh und Logout-All (zuvor **ganz ohne** Limit), Einladung erstellen und Einladung annehmen (ebenfalls zuvor ganz ohne Limit). Schlüssel sind immer ein HMAC-SHA-256 über den normalisierten Wert (`RATE_LIMIT_KEY_SECRET`, verschieden von `JWT_SECRET`) — nie die rohe IP/E-Mail/Benutzer-ID. Ein Store-Ausfall schlägt fehl-geschlossen (503 `RATE_LIMIT_BACKEND_UNAVAILABLE`), nie ein stiller Fallback. CORS ist jetzt vollständig validiert (`CORS_ALLOWED_ORIGINS`, umbenannt von `CORS_ORIGIN`; Produktion verbietet HTTP und localhost/127.\*/::1 ausnahmslos; keine Wildcards; ein Verwechslungsangriff wie `example.com.evil.test` gegen `example.com` ist strukturell unmöglich) und sowohl per HTTP (`test/integration/corsHeaders.test.js`) als auch echt im Browser (`frontend/e2e/corsSecurity.spec.js`) getestet — die Same-Host-Regel eingeschlossen. Trust-Proxy-Konfiguration ist jetzt explizit (`TRUST_PROXY_MODE`, nie ein pauschales `trust proxy: true`) und fail-closed. Neu: HSTS (nur Produktion), `Cache-Control: no-store` auf Auth-/Account-/User-Antworten, konfigurierbares JSON-Body-Limit (`REQUEST_JSON_LIMIT`, Default 256kb, war zuvor fest 1mb), Content-Type-Erzwingung (415 bei falschem, aber vorhandenem Content-Type) sowie eine gebündelte Startkonfigurationsprüfung (`config/startupConfig.js`). Volle Details siehe `STAGE_3D_SECURITY_HARDENING.md`. Weiterhin offen: toter Policy-Code (`coachActionEligibility`), 2FA, Passwort-vergessen/Reset, Kontolöschung, vollständige Geräteverwaltung — alle explizit ausserhalb des Scopes dieser Phase.
>
> **Nachtrag (2026-07-26, Stage 4A Final Local Acceptance):** Keine der oben dokumentierten Sicherheitseigenschaften wurde durch die abschliessende lokale Abnahme verändert — Stage 4A führte keine neue Sicherheitsfunktion ein, sondern verifizierte den bestehenden Stand erneut vollständig: Tenant-Isolation (inkl. Audit-Log-Cross-Tenant-Lesbarkeit, strukturell über die geteilte Studio-Kontext-Middleware garantiert, nicht routenspezifisch), das Optimistic-Concurrency-Muster bei parallelen Einladungs-Resends (Token-Hash als Compare-and-Swap, bestätigt exakt ein Mailversand/ein Audit-Event pro echt konkurrierender Gruppe), alle zehn Rate-Limit-Policies, die vollständige CORS-/Proxy-/Security-Header-Konfiguration sowie ein synthetischer Production-Config-Smoke-Test (elf von zwölf geprüften Szenarien exakt wie erwartet abgelehnt/akzeptiert; das zwölfte — eine leere `CORS_ALLOWED_ORIGINS` in Produktion — als bewusst gültige, dokumentierte Same-Origin-Konfiguration bestätigt, kein Fehler). Ein während der wiederholten vollständigen Regression reproduzierter Lock-Order-Deadlock zwischen Refresh und Passwort-/E-Mail-Änderung war bereits am Ende von Stage 3D behoben und blieb stabil. Zusätzlich real verifiziert: ein verschlüsselter Backup-/Restore-Drill (falscher Schlüssel und beschädigtes Backup beide kontrolliert und sicher abgelehnt, keine Secrets im Dateinamen/Log, keine zurückgelassenen Klartextdateien, Quelldatenbank nachweislich unverändert). Volle Details siehe `STAGE_4A_FINAL_LOCAL_ACCEPTANCE.md`. Keine neue offene Sicherheitslücke gefunden.
>
> **Nachtrag (2026-07-26, Stage 5A1 Unified Training Calendar — Backend Foundation):** Neue Fläche, aber keine neue Sicherheitsklasse: der persönliche Kalender folgt exakt dem bestehenden `user_id`-Isolationsmuster (wie `/workouts`, `/progress`), die Terminierungsregeln folgen exakt dem bestehenden Studio-Kontext-/Rollen-/Tenant-Isolationsmuster. Alle neuen Fehlerpfade (manipulierte UUID, fremdes Studio, fremder Kalendereintrag) liefern durchgängig `404`, nie einen unterscheidbaren `403` oder eine Existenz-Preisgabe. `availableActions` wird ausschliesslich serverseitig abgeleitet, nie vom Client vorgegeben — keine reine UI-Berechtigungslogik als einzige Schutzschicht. Optimistische Nebenläufigkeitskontrolle (`revision`-CAS) auf jeder schreibenden Kalenderoperation, atomare `SELECT ... FOR UPDATE`-Sperren gegen Terminierungsregel-Konflikte und doppelten Session-Start. Neue Audit-Ereignisse ausschliesslich für Studio-Terminierung (`assignment.schedule_rule.*`, `calendar.studio_workout.*`) — rein persönliche Kalenderaktionen erscheinen bewusst **nicht** im Studio-Audit-Log, keine privaten Trainingsdaten Dritter zugänglich. Keine neue Konfigurationsvariable, kein neuer Zeitzonen-Datenspeicher für Benutzerkonten (bewusst nicht Teil dieser Phase). Volle Details siehe `STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md`. Keine neue offene Sicherheitslücke gefunden.
>
> **Nachtrag (2026-07-26, Stage 5A2 Personal Calendar UI):** Reine Frontend-Phase, keine neue Sicherheitsklasse und kein geändertes Berechtigungsmodell. `availableActions` aus der Backend-Antwort bleibt die alleinige Grundlage für angezeigte Aktionen — die Oberfläche schaltet nie eine Aktion allein anhand des Datums oder einer selbst gebauten Statusmatrix frei, und jede Mutation wird serverseitig erneut mit derselben Autorisierung wie zuvor geprüft (keine UI-Berechtigungslogik als alleinige Schutzschicht). Die beiden während der Vertragsverifikation gefundenen Backend-Lücken (`revision`, `assignmentId` fehlten in der Kalenderantwort, siehe `STAGE_5A2_PERSONAL_CALENDAR_UI.md` Abschnitt 1) sind rein additive Response-Erweiterungen ohne Sicherheitsauswirkung — kein zusätzliches Datenfeld wird über die bereits bestehende `user_id`-Isolation hinaus offengelegt, keine neue Angriffsfläche. Konfliktbehandlung (409) lädt bei Bedarf serverseitig aktuelle Daten neu, statt lokal einen falschen Erfolg vorzutäuschen. Keine neue Konfigurationsvariable, keine neue Abhängigkeit. Volle Details siehe `STAGE_5A2_PERSONAL_CALENDAR_UI.md`. Keine neue offene Sicherheitslücke gefunden.
>
> **Nachtrag (2026-07-27, Stage 5A3 Coach Scheduling UI):** Neue Fläche (Coach-Terminierungsregel-Verwaltung), aber kein geändertes Berechtigungsmodell — die neue Route ist zusätzlich clientseitig auf `owner`/`admin`/`trainer` beschränkt, das Backend bleibt in jedem Fall die eigentliche Schutzschicht (`SCHEDULE_RULE_READ`/`MANAGE`, pro-Trainer-Coaching-Beziehung serverseitig geprüft). Eine manipulierte Zuweisungs-ID liefert für Trainer wie für Owner/Admin durchgängig `404`, nie eine unterscheidbare `403` oder eine Existenz-Preisgabe — per E2E mit einem zweiten, absichtlich nicht coachenden Trainer bewiesen (`e2e/coachScheduling.spec.js`). Kein Coach-Name wird angezeigt, da der zugrundeliegende Zuweisungs-Endpunkt keine Coaching-Beziehungsdaten liefert — keine Zusammensetzung aus anderen Endpunkten. Die einzige Backend-Änderung dieser Phase betrifft **keine** Berechtigungslogik: `workoutSessionService.js#startSession()` bestimmte "heute" für die bereits bestehende Kalenderverknüpfung über die Zeitzone des Datenbankservers statt der Studio-Zeitzone (siehe `STAGE_5A3_COACH_SCHEDULING_UI.md` Abschnitt 1) — ein Korrektheits-, kein Zugriffskontrollfehler; behoben durch Wiederverwendung der bereits vorhandenen, getesteten `todayInTimezone()`-Funktion, keine neue Konfigurationsvariable, keine neue Abhängigkeit, keine geänderte Antwortstruktur. Keine neue offene Sicherheitslücke gefunden.
>
> **Nachtrag (2026-07-27, Stage 5B Product & Pilot Readiness Audit):** Ein
> vollständiges Audit (kein neuer Code) hat zwei Punkte der untenstehenden
> Lückenliste als **Dokumentationsfehler** identifiziert: Punkt 7 (CORS
> ungetestet) und Punkt 8 (Rate Limiter pro Prozess) waren trotz der oben
> bereits seit Stage 3D (2026-07-26) dokumentierten Behebung nicht
> durchgestrichen — inzwischen in diesem Dokument korrigiert. Alle übrigen
> Punkte der Lückenliste (einzelne DB-Rolle, Audit-Append-only nur
> Konvention, kein Löschungs-/Anonymisierungspfad, totes
> `coachActionEligibility`) wurden gegen den aktuellen Code erneut bestätigt
> und sind weiterhin real offen — keiner davon ist neu. **Neu eingestuft:**
> Punkt 10 (kein Löschungs-/Anonymisierungspfad) gilt seit diesem Audit
> explizit als **P1-Befund vor Aufnahme echter Pilotteilnehmer:innen**
> (bislang nur als generelles „vor Produktion offen“ geführt) — nicht, weil
> sich der technische Zustand geändert hätte, sondern weil ein realer
> Pilotbetrieb mit echten, nicht-anonymen Personen (statt interner
> Testkonten) tatsächlich geplant ist und Schweizer Datenschutzrecht dafür
> unabhängig vom „Pilot“-Status gilt. Empfehlung: vor Pilotstart mindestens
> einen manuellen, dokumentierten Löschprozess definieren (kein
> automatisierter Self-Service nötig, siehe
> `STAGE_5B_PRODUCT_PILOT_READINESS_AUDIT.md` Befund P1-1). Volle Details
> und die vollständige, real ausgeführte Regression siehe dort.
>
> **Nachtrag (2026-07-28, Stage 5C1 Account Deletion Backend & Deletion
> Receipt Foundation):** Der oben unter Punkt 10 (unten in der Lückenliste)
> beschriebene P1-Befund ist jetzt **technisch geschlossen** — siehe den
> neuen Abschnitt „Account-Löschung und Deletion Receipts" weiter unten
> sowie `STAGE_5C1_ACCOUNT_DELETION_BACKEND.md` für die vollständigen
> Details. Migration 013 fügt `users.lifecycle_status`/`deleted_at` hinzu;
> ein Self-Service-Löschendpunkt (Passwort + Bestätigungsphrase) anonymisiert
> ein Konto mit Studio-Historie unwiderruflich (zufälliger, nicht ableitbarer
> Platzhaltername/-E-Mail/-Passworthash) oder löscht es vollständig, falls
> nie eine Studio-Mitgliedschaft existierte. Die zuvor in Zeile 147/166
> dieses Dokuments dokumentierte Aussage „kein Lösch-/Anonymisierungspfad im
> Code gefunden" ist damit **nicht mehr zutreffend** und in diesem Dokument
> entsprechend korrigiert. **Weiterhin offen:** Es gibt noch **keine
> Frontend-Oberfläche** für diesen Endpunkt (Stage 5C2, nicht begonnen) —
> ein Endbenutzer kann sein Konto aktuell nur über einen direkten API-Aufruf
> löschen, nicht über die Weboberfläche. Freitext (Coach-Feedback, Notizen)
> wird bewusst nicht durchsucht/bereinigt — siehe `notices.freeTextRetention`
> in der Vorschau-Antwort für die ehrliche Kommunikation dieser Grenze.
>
> **Nachtrag (2026-07-28, Stage 5C1 Merge-Gate-Review):** Vor dem Merge
> deckte eine gezielte Prüfung fünf Befunde auf, alle behoben — volle
> Details in `STAGE_5C1_ACCOUNT_DELETION_BACKEND.md` Abschnitt 0 und ADR
> 004s Abschnitt „Amendment". Sicherheits-/Datenschutzrelevant: (1) ein
> echter Privat-zu-global-Leak — `exercises.user_id`s `ON DELETE SET NULL`
> hätte die persönlichen Übungen eines hart gelöschten Kontos in die
> globale Übungsbibliothek durchsickern lassen (behoben: explizite Löschung
> vor jedem Hard Delete, in beiden Modi); (2) der No-CSRF-Entscheid für
> `/api/account/deletion-request` wurde als endgültige, verifizierte
> Architekturentscheidung bestätigt (Cookie-only-Request und Cross-Site-
> Origin beide per Integrationstest widerlegt, siehe Abschnitt „Account-
> Löschung und Deletion Receipts" unten); (3) der Deletion Receipt Doctor
> meldet jetzt bei jedem fehlenden Receipt sofort `ready:false`, nicht nur
> bei einem beschädigten. Die zu diesem Zeitpunkt noch bekannte Restriktion
> (Receipt-Schreibfehler auf dem Hard-Delete-Pfad seien strukturell
> unentdeckbar) stellte sich bei genauerer Prüfung als **echter
> Merge-Blocker** heraus — siehe den nachfolgenden Nachtrag.
>
> **Nachtrag (2026-07-28, Receipt-first-Commit-Protokoll — Merge-Blocker-Fix):**
> Reproduziert und behoben: die ursprüngliche Reihenfolge committete die
> DB-Transaktion **vor** der (Best-Effort-)Receipt-Publikation — ein
> Receipt-Schreibfehler nach einem erfolgreichen Hard Delete hinterliess
> weder eine `users`-Zeile noch ein Receipt, ein für den Deletion Receipt
> Doctor vollständig unsichtbarer Zustand; ein späterer Restore hätte das
> Konto reaktivieren können, ohne dass irgendein Mechanismus dies je
> erkannt hätte. Korrigiert durch ein **Receipt-first-Commit-Protokoll**:
> das Receipt wird innerhalb der noch offenen Transaktion aufgelöst
> (bestehendes gültiges Receipt für dieses Konto wiederverwendet, oder neu
> erzeugt und atomar publiziert) und **erst danach** wird committet.
> Schlägt die Publikation fehl, rollt die gesamte Transaktion zurück (kein
> HTTP 200, keine Kontoänderung). Schlägt der Commit **nach** erfolgreicher
> Publikation fehl, bleibt das Receipt unangetastet bestehen, und der
> Doctor erkennt den Zustand — jetzt auch für Hard-Delete-Konten
> zuverlässig — über denselben Mechanismus wie einen echten Backup-Restore
> (gültiges Receipt gegen eine Zeile, die noch `active` ist statt
> `deleted`); Reconciliation vervollständigt die Löschung unter
> Wiederverwendung desselben Receipts (nie ein zweites für denselben
> Vorgang). Volle Details in `STAGE_5C1_ACCOUNT_DELETION_BACKEND.md`
> Abschnitt 0b.

> **Nachtrag (2026-08-09, Stage 5C2 Account Deletion UI — Korrektur einer
> bestehenden Aussage):** Beim Bau des Frontend-E2E-Flows für die
> Kontolöschung wurde entdeckt, dass die weiter unten unter "Account
> Deletion" gelistete Aussage "Eigener Rate-Limiter (`account.deleteRequest`,
> 3/60min, **pro Benutzer**). **[GETESTET]**" in der Praxis **nicht**
> zutrifft: `accountRouter.js` registriert `rateLimiters.deleteRequest`
> **vor** `authenticate` auf `POST /account/deletion-request` — zum
> Zeitpunkt, an dem der Limiter-Schlüssel (`userKey("account-delete")`,
> liest `req.user?.id`) tatsächlich berechnet wird, ist `req.user` also
> immer `undefined`, und jeder Aufruf kollabiert auf einen einzigen,
> geteilten `"account-delete|user:anon"`-Bucket statt pro Benutzer isoliert
> zu sein. Der zitierte "**[GETESTET]**"-Verweis
> (`backend/test/unit/rateLimiter.test.js`) prüft das nicht wirklich: der
> bestehende Test setzt `req.user` manuell **vor** dem Limiter-Aufruf, was
> nicht der echten Route-Reihenfolge entspricht. Dasselbe Registrierungsmuster
> (Rate Limiter vor `authenticate`) gilt ebenso für `change-password` und
> `email-change-requests` — der Befund ist also nicht auf den
> Löschendpunkt beschränkt. **Praktische Auswirkung:** ein einzelner
> Benutzer (oder ein einzelner falscher Versuch) kann das jeweilige
> Kontingent für alle anderen Benutzer im selben Zeitfenster mit
> erschöpfen. Nicht in Stage 5C2 behoben (reines Frontend-Scope, keine
> Backend-Routing-Änderung) — stattdessen mit einem minimalen,
> reproduzierbaren Regressionstest dokumentiert
> (`backend/test/unit/rateLimiter.test.js`, Test "KNOWN DEFECT..."). Volle
> Herleitung in `STAGE_5C2_ACCOUNT_DELETION_UI.md` Abschnitt 13. Empfehlung:
> `authenticate` projektweit vor jeden benutzer-geschlüsselten Rate Limiter
> stellen, danach den bestehenden "pro Benutzer"-Unit-Test so erweitern,
> dass er die reale Middleware-Kette über den echten Router prüft statt
> `req.user` vorab zu setzen.

> **Nachtrag (2026-08-09, PR #29 — Rate-Limiter-Reihenfolge behoben):** Die
> im vorherigen Nachtrag beschriebene Empfehlung ist umgesetzt.
> `accountRouter.js` registriert `authenticate` jetzt vor allen drei
> betroffenen Limitern (`deleteRequest`, `passwordChange`,
> `emailChangeRequest`); der Schlüssel sieht dadurch immer die reale
> `req.user.id`, kein geteilter `"...|user:anon"`-Bucket mehr möglich. Belegt
> durch neue Route-Level-Integrationstests
> (`backend/test/integration/accountRateLimitIsolation.test.js`): zwei
> verschiedene Benutzer haben nachweislich getrennte Buckets, derselbe
> Benutzer bleibt korrekt limitiert, ein unauthentifizierter Aufruf bleibt
> `401` und kann nie einen Bucket für einen echten Benutzer mitverbrauchen —
> vor dem Fix reproduzierten alle neun Fälle den Defekt, danach grün. Der auf
> Stage 5C2 hinzugefügte `KNOWN DEFECT`-Unit-Test wurde entfernt statt auf
> eine falsche Erwartung umgeschrieben, da die Route-Level-Tests dieselbe
> Garantie stärker und realitätsnäher belegen. Damit ist die weiter unten
> unter "Account-Löschung und Deletion Receipts" stehende
> **[KORRIGIERT, Stage 5C2]**-Anmerkung ("tatsächlich ein einziger geteilter
> Bucket") ihrerseits veraltet — siehe die entsprechende Korrektur dort.
>
> **Nachtrag (2026-08-19, Stage 5D Current-State Audit):** Vollständiges,
> rein dokumentarisches Audit — keine neue Sicherheitsfunktion, kein
> Produktcode geändert. Alle unten dokumentierten Kernaussagen wurden gegen
> den heutigen Code erneut stichprobenartig verifiziert (Rate-Limiter-
> Reihenfolge in `accountRouter.js`, RBAC-Rollen/-Permissions in
> `domain/studioDomain.js`/`studioPolicy.js`, Deletion-Receipt-Module).
> Ausserdem korrigiert: zwei weitere Stellen in diesem Dokument behaupteten
> noch "keine Frontend-Oberfläche (Stage 5C2)" für die Kontolöschung — seit
> PR #30 falsch, siehe die jeweiligen Korrekturen unten. **Neuer, nicht
> sicherheitskritischer Fund:** ein High-Severity-`npm audit`-Advisory im
> Frontend (`nanoid@3.3.17`, GHSA-2v37-7h3g-55p8, transitiv über `postcss`,
> reiner Build-Tooling-Pfad ohne Backend-Betroffenheit) — bewusst nicht
> behoben (Dependency-Upgrade ausserhalb des Scopes dieses Doku-Audits).
> Volle Details: `docs/STAGE_5D_CURRENT_STATE_AUDIT.md`.

## Auth

- JWT HS256, Payload ausschließlich `{ id }` — keine Rolle, keine Studio-Zugehörigkeit im Token; Rolle wird bei **jedem** Request live aus der DB gelesen und geprüft. **[GETESTET]** `backend/test/unit/authMiddleware.test.js`, `backend/test/integration/trainingApi.test.js:115-122`.
- Token-Ablauf fix 8h, Ablauf via `jwt.verify` erzwungen. **[MANUELL]** kein Test mit gemocktem abgelaufenem Token gefunden.
- `JWT_SECRET` ≥32 Zeichen in Produktion, bekannte Platzhalter abgelehnt. **[GETESTET]** `backend/test/unit/authConfig.test.js`.
- Passwort: bcrypt Kostenfaktor 10, Login 6-128 Zeichen ohne Komplexitätsanforderung. **[GETESTET]** `backend/test/unit/userValidation.test.js`.
- Identische Fehlermeldung für unbekannte E-Mail und falsches Passwort. **[MANUELL]**. **Risiko:** `bcrypt.compare` wird nur bei existierendem Benutzer aufgerufen — messbarer Zeitkanal zur Konto-Enumeration trotz gleicher Fehlermeldung.
- Rate Limiting: In-Memory, pro Prozess (kein geteilter Zähler bei mehreren Instanzen). Login 10/15min, Registrierung 5/60min. **[GETESTET]** `backend/test/unit/rateLimiter.test.js`. **Risiko bei horizontaler Skalierung** (dokumentiert in `docs/DEPLOYMENT.md:365`).

## Tenant-Isolation

- Public-UUIDs vs. interne Auto-Increment-IDs; numerische/interne IDs in der URL werden sofort abgelehnt. **[GETESTET]** `backend/test/integration/studioApi.test.js:266-267`.
- Fremdes/suspendiertes/ausgeschiedenes Studio-Verhältnis → identisch 404 `STUDIO_NOT_FOUND`, nie 403 (verhindert Existenz-Enumeration von Studios/Mitgliedschaften). **[GETESTET]** `backend/test/unit/studioMiddleware.test.js:13-39`, `backend/test/integration/studioApi.test.js:258-306`.
- Jede mutierende Operation sperrt Studio+Akteur-Mitgliedschaft per `SELECT...FOR UPDATE` in derselben Transaktion, bevor die Berechtigung geprüft wird — kein Vertrauen auf zwischengespeicherten Kontext. **[GETESTET]** Konkurrenz-Tests `backend/test/integration/studioApi.test.js:700,897`.
- Letzter aktiver Owner kann nicht herabgestuft/suspendiert werden, race-sicher. **[GETESTET]** `backend/test/integration/studioApi.test.js:897-927`.

## RBAC

- Zentrale Policy-Datei (`backend/domain/studioPolicy.js`) mit Default-Deny (`hasStudioPermission` verlangt `status==='active'`, unabhängig von der Rolle — auch ein suspendierter Owner verliert alles). **[GETESTET]** `backend/test/unit/studioPolicy.test.js`, `backend/test/integration/studioApi.test.js:503-513`.
- Selbstbeförderungsschutz gilt für jede Rolle. **[GETESTET]** `backend/test/unit/studioPolicy.test.js:77-82`.
- **Bestätigte Owner/Admin-Bypässe** (Rolle schlägt granularen Check): Sichtbarkeit aller Coaching-Beziehungen/Zuweisungen im Studio (statt nur eigener); Zuweisung über jede aktive Beziehung im Studio, auch ohne selbst Coach zu sein; keine Zielrollenbeschränkung bei Mitgliederverwaltung (nur Admin hat `ADMIN_TARGET_FORBIDDEN`); erweiterter Datenumfang (Status/E-Mail) in der Mitgliederliste. Alle mit Integrationstest-Nachweis belegt (Details: `docs/adr/002-coach-member-training-ownership.md` und Rollenmatrix in `FITTRACK_CURRENT_STATUS.md`).
- **Bestätigt OHNE Bypass — zentrale Stage-1B.2B1-Grenze:** `workoutResultReadEligibility` verlangt für **jede** Rolle (owner, admin, trainer) identisch eine eigene aktive Coaching-Beziehung, um Trainingsergebnisse eines Mitglieds zu lesen. **[GETESTET]** explizit benannt in `backend/test/unit/workoutSessionPolicy.test.js:188-212` ("no owner/admin bypass") und `backend/test/integration/workoutSessionApi.test.js` (Owner/Admin ohne Beziehung → identischer 404 wie ein fremder Trainer).
- **Toter Code mit irreführender Bypass-Semantik:** `coachActionEligibility` (`studioPolicy.js:186-197`) definiert einen Owner/Admin-Bypass, wird aber von **keiner** Route/keinem Service aufgerufen — die tatsächliche Logik liegt redundant in `programAssignmentService.js:92-122`. Drift-Risiko bei künftigen Änderungen, sollte bereinigt oder verdrahtet werden.

## Einladungen

- Token: `crypto.randomBytes(32)` (256 Bit), nur SHA-256-Digest gespeichert, nie das Rohtoken. **[GETESTET]** `backend/test/unit/studioSecurity.test.js:31-42`.
- Lebensdauer fix 7 Tage, lazy Ablaufprüfung. **[GETESTET]** `backend/test/integration/studioApi.test.js:685`.
- Replay-Schutz: genau einmal annehmbar, race-sicher. **[GETESTET]** `backend/test/integration/studioApi.test.js:622-627,700-724`.
- E-Mail-Bindung gegen Konto-E-Mail, identische Fehlermeldung wie unbekanntes Token. **[MANUELL]** kein dedizierter Test für "falscher Benutzer nimmt fremde Einladung an".
- **Produktion fail-closed ohne Provider**: Ohne verdrahteten Zustellprovider verweigert das System jede Einladungserstellung in Produktion (503), bevor irgendetwas persistiert wird. **[GETESTET]** `backend/test/unit/studioSecurity.test.js:136-193`.
- **Seit Stage 2A: validierter SMTP-Adapter vorhanden** (`backend/delivery/smtpInvitationProvider.js`, `backend/config/smtpConfig.js`), opt-in über `INVITATION_EMAIL_PROVIDER=smtp`. TLS ausnahmslos erzwungen (SMTPS oder STARTTLS, Zertifikatsprüfung nie deaktiviert), Platzhalter-Credentials in jeder Umgebung abgelehnt, keine Secrets/Token/URLs in Logs oder Audit. **[GETESTET]** 44 neue Unit- + 4 neue Integrationstests, siehe `STAGE_2A_PRODUCTION_INVITATION_EMAIL.md`. Ein echter Versand wurde in dieser Umgebung mangels Zugangsdaten nicht nachgewiesen — reale Provider-Verbindung bleibt ein dokumentierter, offener manueller Schritt.
- Token-Redaktion in Logs/Audit via Regex-Muster. **[GETESTET]** `backend/test/unit/startupLogger.test.js`, `backend/test/unit/studioSecurity.test.js:44-74`.

## Coaching und Programme

- Zuweisung erfordert explizite, aktive Coaching-Beziehung — kein automatisches "letzte aktive Beziehung"-Verhalten (Stage-1B.1-Nachbesserung). **[GETESTET]** `backend/test/integration/trainingProgramApi.test.js`.
- Veröffentlichte Versionen sind für **jede** Rolle unveränderlich, auch für den Owner. **[GETESTET]** `backend/test/integration/trainingProgramApi.test.js:326-330`.
- Snapshot-Trennung: `exercise_name_snapshot` etc. sind Text-Snapshots ohne FK zur persönlichen `exercises`-Tabelle. **[GETESTET]** Migrationstest `backend/test/migrationDatabase.test.js`.

## Workout-Ergebnisse (Stage 1B.2B1)

- Ownership einmalig bei Session-Start aufgelöst und gesperrt, nie neu aufgelöst (Snapshot-Prinzip). **[GETESTET]** `backend/test/integration/workoutSessionApi.test.js`.
- Member-Self-Access strukturell hart auf `member_membership_id = actor.internalId` verriegelt — keine Rolle kann je die Session einer anderen Person mutieren. **[GETESTET]** `backend/test/unit/workoutSessionPolicy.test.js`, Integrationstest.
- Coach-Zugriff erfordert eigene aktive Beziehung, **kein** Owner-/Admin-Bypass (siehe RBAC oben) — die härteste Zugriffsregel im gesamten System.
- Zugriff endet sofort bei Beziehungsende oder Suspendierung der eigenen Mitgliedschaft, ohne den Eigenzugriff des Mitglieds zu berühren. **[GETESTET]**.
- Revisionskonflikte (`WORKOUT_SESSION_CONFLICT`/`_EXERCISE_CONFLICT`/`_SET_CONFLICT`) und Idempotenz über `clientStartKey`. **[GETESTET]**.
- Terminale Session (completed/aborted) ist für jede weitere Mutation unveränderlich. **[GETESTET]**.
- Keine Trainingsmetrik erscheint je im Audit-Log (`workout_session.*`-Events haben eine strikte Allowlist ohne Gewicht/Wiederholungen/RPE/Distanz/Dauer/Notiz). **[GETESTET]** `backend/test/unit/workoutSessionAudit.test.js`, `backend/test/integration/workoutSessionApi.test.js`.
- Keine persönlichen Workout-Daten werden von Studio-Workout-Sessions berührt (separate Tabellenbäume, siehe Datenmodell). **[GETESTET]**.

## Coach-Feedback (Stage 1B.2B2B)

- Zugriffs-Pinning gehärtet: Coach-Resultat-/Feedback-Zugriff verlangt zusätzlich, dass die Session zur **exakt** aktuell aktiven Beziehung gehört (`session.coaching_relationship_id === relationship.internalId`) — eine neue, spätere Beziehung mit demselben Mitglied gewährt keinen automatischen Zugriff auf Sessions einer früheren Beziehung. Dies ist eine bewusste Härtung des bereits produktiven Stage-1B.2B1-Modells, gefunden vor jeder Fehlermeldung während des Designs dieser Phase. **[GETESTET]** `backend/test/integration/workoutFeedbackApi.test.js` ("a new coach for the same member gains no automatic access to a session from the earlier, now-ended relationship"), analog auch für `listCoachedMemberSessions`/`getCoachedMemberSession` in `workoutSessionApi.test.js`.
- Feedback-Erstellung: identisch **kein** Owner-/Admin-Bypass (`WORKOUT_RESULT_READ_COACHED`-Permission ist owner/admin/trainer zugeordnet, doch die konkrete Beziehungsprüfung bleibt auf die eigene Mitgliedschaft des Akteurs gepinnt) — Owner/Admin ohne eigene Beziehung erhalten identisch `404`. **[GETESTET]** `backend/test/integration/workoutFeedbackApi.test.js`.
- Nur auf terminalen Sessions (`completed`/`aborted`) erstellbar; `in_progress` liefert `409 WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL`. **[GETESTET]**.
- Append-only durch Weglassen von PATCH/DELETE erzwungen (keine DB-Trigger, konsistent mit der bestehenden Audit-Append-only-Konvention oben). **[GETESTET]** kein Update-/Delete-Pfad im Router, Migrationstest bestätigt CHECK/Unique-Constraints.
- Idempotenz über `client_feedback_key` (Unique zusammen mit `workout_session_id`/`coach_membership_id`); gleicher Schlüssel mit abweichendem Text → `409 WORKOUT_FEEDBACK_KEY_CONFLICT`, inkl. Race-Zweig (`ER_DUP_ENTRY`). **[GETESTET]** Unit-, Integrations- und E2E-Ebene (Mehrfachklick-Test).
- Feedbacktext ist von jedem Audit-Detail, Request-/Fehlerlog und Frontend-Debug-Log ausgeschlossen — Audit-Allowlist für `workout_feedback.created` enthält ausschließlich `{feedbackId, sessionId}`. **[GETESTET]** `backend/test/unit/workoutSessionAudit.test.js`.
- Nach Beziehungsende: ehemaliger Coach verliert sofort Lese- und Schreibzugriff; das Mitglied behält bereits erhaltenes Feedback dauerhaft (kein Hard-Delete-Pfad). **[GETESTET]** E2E-Test „Beziehungsende entzieht dem Coach sofort den Zugriff; das Mitglied behält sein Feedback dauerhaft".
- Bewusst **nicht** eingeführt: ein feedback-spezifischer Not-Found-Code oder `WORKOUT_FEEDBACK_NOT_ALLOWED` — jede Zugriffsverweigerung kollabiert weiterhin auf den bestehenden einheitlichen `WorkoutSessionNotFoundError` (Fortführung von ADR 003), siehe `STAGE_1B2B2B_COACH_RESULTS_FEEDBACK.md`.

## Audit

- Zweistufige Redaktion: generische Regex-Redaktion (`password|secret|token|...`, 43-Zeichen-Token-Muster) plus strengere, ereignistyp-spezifische **Allowlist** (unbekannte Detail-Schlüssel werfen einen Fehler statt nur redigiert zu werden). **[GETESTET]** `backend/test/unit/studioSecurity.test.js`, `backend/test/unit/trainingProgramAudit.test.js`, `backend/test/unit/workoutSessionAudit.test.js`.
- Append-only-Verhalten ist eine **Anwendungskonvention**, keine DB-erzwungene Eigenschaft — kein GRANT/REVOKE, Trigger oder Constraint verhindert `UPDATE`/`DELETE` auf `studio_audit_events` auf Datenbankebene. **[MANUELL]**.

## Logging

- Einheitliches Fehler-Envelope, niemals Stacktraces/SQL-Fragmente im Response-Body (auch nicht bei 5xx). **[GETESTET]** `backend/test/unit/errorHandling.test.js`, `backend/test/integration/trainingApi.test.js:135`.
- Request-Logging enthält ausschließlich `requestId, method, route, status, durationMs` — **keine** Bodies, **keine** Query-Strings. **[GETESTET]** `backend/test/unit/requestLogging.test.js`.
- Security-Header (nosniff, DENY, no-referrer, CSP, Permissions-Policy) gesetzt. **[GETESTET]** (nosniff/DENY/no-referrer explizit geprüft; CSP/Permissions-Policy nicht separat assertiert).
- CORS-Konfiguration (`allowedOrigins`/`createCorsOptions`) hat **keinen** automatisierten Test. **[MANUELL]** — Same-Host-Requests werden dabei immer erlaubt, unabhängig von `CORS_ORIGIN`.

## Backups

- Automatisierter täglicher Lauf (Stage 0C, im Code unverändert): komprimiert, Integritätsmanifest (SHA-256 für Roh- und komprimierte Datei), Lock, Zielidentitätsprüfung, UTC-GFS-Retention (7 täglich/4 wöchentlich/3 monatlich). **[GETESTET]** `backend/test/unit/backupAutomation.test.js`, `backend/test/unit/backupPolicy.test.js`. Dieser Pfad (`db:backup`/`db:backup:daily`) produziert weiterhin unverschlüsselte `.sql`/`.sql.gz`-Artefakte. **Seit der Stage-2B1-Release-Gate-Härtung ist er in Produktion (`NODE_ENV=production`) ausnahmslos gesperrt, ohne Override**, und überall sonst standardmäßig ebenfalls gesperrt (`ALLOW_LEGACY_UNENCRYPTED_BACKUP=true` nötig, aufgerufen als erste Prüfung vor jeder Verzeichnis-/Docker-Operation) — er bleibt nur für historische Regressionstests/lokale Läufe erreichbar. **[GETESTET]** `backend/test/unit/backupAutomation.test.js` (Produktionssperre, fehlender Override, kein Datei-Anlegen vor der Prüfung).
- **Verschlüsselung im Ruhezustand: seit Stage 2B1 verfügbar und seit der Release-Gate-Härtung der einzige produktionsfähige Pfad** — `db:backup:create` erzeugt ein authentifiziert AES-256-GCM-verschlüsseltes `.ftbackup` (`node:crypto`, 32-Byte-Schlüssel, zufälliger IV pro Backup, GCM-Tag zwingend geprüft, Header als AAD). Kein Klartext-SQL-Dump entsteht dabei zu irgendeinem Zeitpunkt auf Disk — direkt bewiesen (Live-Dateisystemüberwachung plus statische Quelltext-Prüfung), nicht nur indirekt geschlussfolgert. **[GETESTET]** `backend/test/unit/encryptedBackupFormat.test.js`, `backend/test/unit/backupCryptoConfig.test.js`, `backend/test/unit/encryptedBackupNoPlaintextStaticCheck.test.js`, `backend/test/integration/encryptedBackupRestoreDrill.test.js` (echter End-to-End-Drill gegen die lokale MySQL-Instanz, inkl. zweier kritischer GCM-Tamper-Tests, die beweisen, dass die Zieldatenbank bei einem manipulierten oder mit falschem Schlüssel verschlüsselten Backup nie angelegt wird). Siehe `STAGE_2B1_ENCRYPTED_BACKUP_RESTORE.md`.
- **Off-host-Speicherung: Mechanik seit Stage 2B2A vorhanden, kein echter externer Bucket verbunden** — ein providerneutraler, S3-kompatibler Upload-/Download-/Verifikationspfad (`db:backup:remote:upload/list/download/verify/drill`, `config/backupRemoteConfig.js`, AWS SDK v3) lädt ausschließlich bereits verschlüsselte `.ftbackup`-Dateien hoch, nie eine implizite AWS-Credential-Chain, HTTPS in Produktion zwingend. **Seit einer Release-Gate-Härtung:** Veröffentlichung über einen einzelnen, serverseitig atomar-bedingten `PutObject` (`IfNoneMatch: "*"`) statt einer race-anfälligen `HeadObject`-Vorabprüfung — ein bestehendes Objekt kann nachweislich nie überschrieben werden, auch nicht bei zwei echt gleichzeitigen Upload-Versuchen auf denselben Schlüssel. **[GETESTET]** `backend/test/unit/backupRemoteConfig.test.js`, `backupRemoteObjectKey.test.js`, `backupRemoteStorage.test.js`, `backupRemoteRetention.test.js`, `encryptedBackupRemoteUpload.test.js`, `backend/test/integration/backupRemoteMinio.test.js` (22 Tests, echter Upload/Download/Remote-Restore-Drill sowie ein echter Zwei-gleichzeitige-Uploads-Wettlauf gegen eine lokale MinIO-Testinstanz, inkl. manipulierter Remote-Metadaten/-Objekte und falscher Key-ID). Siehe `STAGE_2B2A_S3_OFFHOST_BACKUPS.md`. **Weiterhin offen:** Es ist kein echtes externes Cloud-Konto verbunden — das bleibt Stufe 2B2B. **[DOKU]** für den verbleibenden Teil.
- Restore-Pfad ausschließlich für Wegwerf-Testdatenbanken, kein Produktions-Restore-Codepfad. **[GETESTET]** `backend/test/unit/backupAutomation.test.js:163-212` (unverschlüsselter Pfad, weiterhin `NODE_ENV=test` plus Loopback-Host), `backend/test/integration/encryptedBackupRestoreDrill.test.js` (verschlüsselter Pfad) — der verschlüsselte Restore verlangt seit der Härtung eine von `NODE_ENV` unabhängige, explizite Freigabe (`BACKUP_RESTORE_ENABLED=true`), Loopback-Host, ein streng gemustertes Wegwerfziel sowie eine an den exakten Zielnamen gebundene Bestätigung (`FITTRACK_RESTORE_ACK=restore:<Ziel>`, statt einer festen Phrase); ein explizites Zieldatenbank-Argument ist zwingend, darf nie implizit der Quelle entsprechen, und eine bereits existierende Zieldatenbank wird ohne explizite Bestätigung abgelehnt. Zusätzlich erzwingen konfigurierbare Timeouts (`BACKUP_DUMP_TIMEOUT_MS`/`BACKUP_RESTORE_TIMEOUT_MS`/`BACKUP_DOCKER_OPERATION_TIMEOUT_MS`) eine garantierte Beendigung hängender oder Signale ignorierender `mysqldump`/`mysql`/Docker-Prozesse, einschließlich des im Container laufenden entfernten Prozesses.
- **Automatisierter, verifizierter Restore-Drill seit Stage 2B1**
  (`db:backup:drill`): erstellt ein echtes verschlüsseltes Backup, verifiziert
  es vollständig, restauriert es in eine disposable Datenbank, prüft
  Migration Doctor (`ready`/`applied:8`) sowie Tabellen-/Zeilenzahlvergleich
  gegen die Quelle, räumt danach vollständig auf. **[GETESTET]**. RPO/RTO als
  quantifizierte Planungsannahmen für einen echten Produktionsbetrieb bleiben
  weiterhin offen — der Drill beweist die Mechanik, nicht einen geplanten
  Zeitrahmen.

## Secrets

- `.env` korrekt via `.gitignore` ausgeschlossen, keine committeten Echtsecrets bestätigt.
- **Eine einzige DB-Rolle für Runtime, Migration und Restore-Admin-Operationen** — die dokumentierte Trennung (Runtime- vs. DDL-Nutzer) ist rein organisatorisch, nicht technisch erzwungen. **[DOKU]** für die Absicht, **[MANUELL]** für die tatsächliche Single-User-Nutzung im Code.
- TLS explizit an Reverse-Proxy delegiert, kein TLS-Code im Repository (bewusst Infrastrukturaufgabe). **[DOKU]**
- Kein echtes Monitoring/Alerting-System im Repository — nur Health-Endpunkte plus dokumentierte Prozesse. **[GETESTET]** für Health-Endpunkte, **[DOKU]** für Alerting.

## Account-Löschung und Deletion Receipts (Stage 5C1)

- Self-Service-Kontolöschung (`POST /api/account/deletion-request`) verlangt zwingend das aktuelle Passwort **und** eine Bestätigungsphrase (der eigene Benutzername) — keine Einzelbestätigung genügt. **[GETESTET]** `backend/test/integration/accountDeletionApi.test.js`.
- Sole-Owner-Blocker: ein Konto kann sich nicht löschen, solange es in irgendeinem Studio der einzige aktive Owner ist (`409 ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED`); die Fehlerantwort listet ausschließlich die **eigenen** betroffenen Studios, nie Daten Dritter. **[GETESTET]**.
- Hybride Löschstrategie: Anonymisierung (Konto mit Studio-Historie — Zeile bleibt wegen `RESTRICT`-Fremdschlüsseln bestehen, Benutzername/E-Mail/Passworthash werden durch kryptographisch zufällige, **nicht ableitbare** Platzhalter ersetzt) oder vollständiger Hard Delete (Konto ohne jede je existierende Studio-Mitgliedschaft). Welcher Pfad greift, wird ausschließlich serverseitig anhand der tatsächlichen Mitgliedschaftshistorie entschieden. **[GETESTET]**.
- Auth-Invalidierung dreifach abgesichert: `auth_version`-Inkrement bei Anonymisierung, `authMiddleware.js`s kombinierte Session-Abfrage prüft zusätzlich `lifecycle_status` (kollabiert auf denselben generischen `AUTH_SESSION_INVALIDATED` wie jede andere Ungültigkeitsursache — keine Unterscheidbarkeit „gelöscht" vs. „abgelaufen"), und ein Hard Delete liefert beim Refresh-Versuch strukturell null Zeilen. Login eines gelöschten Kontos scheitert **identisch im Timing** zu einem unbekannten Konto (`bcrypt.compare` läuft immer gegen einen echten Hash, der Lifecycle-Check erfolgt erst danach). **[GETESTET]**.
- Extern signierte Deletion Receipts (HMAC-SHA256, kanonisches JSON) belegen jede Löschung außerhalb der Datenbank — nie die ursprüngliche E-Mail/den Benutzernamen, nur die interne Konto-Referenz. Atomare Dateipublikation (`link()` statt `rename()` — strukturell nie überschreibbar). Ein Receipt-**Schreib**fehler nach erfolgreichem Commit lässt die HTTP-Antwort nie scheitern (nur Log); eine **unsichere Konfiguration** blockiert dagegen den Start der Löschung selbst (Pre-Flight-Check). Kein stiller Produktionsfallback — alle drei Konfigurationsvariablen sind in Produktion Pflicht. **[GETESTET]** `backend/test/unit/deletionReceipts*.test.js`, `deletionReceiptConfig.test.js`, `deletionReceiptStore.test.js`.
- Deletion Receipt Doctor (rein lesend) und eine dreifach-acknowledgement-gated Restore-Reconciliation behandeln den Fall, dass ein Backup-Restore ein bereits gelöschtes Konto versehentlich auf `active` zurücksetzt — kein Acknowledgement darf ein bloßes `"true"` sein, jedes muss exakt Datenbankname/Receipt-Verzeichnis referenzieren. Der Doctor meldet `ready:false` sofort bei **jedem** fehlenden Receipt, nicht nur bei einem beschädigten. Seit dem Receipt-first-Commit-Protokoll (Merge-Blocker-Fix) gilt das jetzt zuverlässig auch für hart gelöschte Konten: das Receipt wird publiziert, **bevor** die Transaktion committet — ein Commit-Fehler danach lässt die Kontenzeile (per Rollback) bestehen, was der Doctor über denselben Mechanismus wie einen echten Restore erkennt; ein Receipt-Schreibfehler selbst lässt die Transaktion nie committen. **[GETESTET]** `backend/test/unit/deletionReceiptDoctor.test.js`, `backend/test/unit/deletionReceiptStore.test.js` (`findValidReceiptForAccount`), sowie die dedizierten Anonymisierungs-/Hard-Delete-/Retry-/Konkurrenz-Tests in `accountDeletionApi.test.js`.
- Eigener Rate-Limiter (`account.deleteRequest`, 3/60min, pro Benutzer — ~~zwischenzeitlich (Stage 5C2) tatsächlich ein einziger geteilter Bucket~~ **[ERNEUT KORRIGIERT, PR #29]** seit `authenticate` vor dem Limiter läuft, wieder echt pro Benutzer isoliert, siehe Nachtrag 2026-08-09 "Rate-Limiter-Reihenfolge behoben" oben). **[GETESTET, jetzt auf echter Route-Ebene]** `backend/test/integration/accountRateLimitIsolation.test.js`.
- Terminierungsregel-Deaktivierung deckt die Vereinigung aus Mitglied-Scope (Assignment, dessen Mitglied das gelöschte Konto ist, unabhängig vom Regel-Ersteller) und Ersteller-Scope (vom Konto selbst erstellte Regeln) ab — verhindert sowohl eine „Phantom-Coach"-Materialisierung als auch eine stale aktive Regel für ein bereits abgesagtes Assignment. Persönliche Übungen werden in beiden Löschmodi explizit gelöscht (nie über `ON DELETE SET NULL` global sichtbar). Kein dediziertes CSRF-Mittel für `/api/account/deletion-request` — verifiziert als endgültige, sichere Architekturentscheidung (Bearer-only, keine Cookie-Authentifizierung möglich). **[GETESTET]** dedizierte Integrationstests in `accountDeletionApi.test.js`.
- **Weiterhin offen:** ~~keine Frontend-Oberfläche (Stage 5C2)~~ **[KORRIGIERT]** seit Stage 5C2 vorhanden (Profil → Sicherheit → Gefahrenbereich); keine Freitextbereinigung (bewusst, siehe Nachtrag oben), keine Admin-Löschung fremder Konten, kein Datenexport. Volle Details in `STAGE_5C1_ACCOUNT_DELETION_BACKEND.md` und `STAGE_5C2_ACCOUNT_DELETION_UI.md`.

---

## Datenschutzklassifikation

| Datum | Wer darf lesen | Speicherort | In Logs? | Im Audit? | Im Backup? | Aufbewahrung/Löschung | Bemerkung |
|---|---|---|---|---|---|---|---|
| Globale Kontodaten (username, email, password_hash) | Nur der Benutzer selbst (API-seitig) | `users` | Nein (Body-Logging aus) | Nein | Ja, unverschlüsselt | Seit Stage 5C1: Self-Service-Löschung — Anonymisierung (Konto mit Studio-Historie) oder Hard Delete (keine Historie), `deleted_at`/`lifecycle_status` seit Migration 013 | Nur API-erreichbar, noch keine UI (Stage 5C2); Backup-Artefakte vor der Löschung behalten die Originaldaten bis zum Ablauf der dokumentierten Backup-Retention |
| Studio-Mitgliedschaftsdaten (Rolle, Status) | Studio-Mitglieder gemäß Rollenmatrix | `studio_memberships` | Nein | Ja (allowlisted: role/status) | Ja | Statustransition (`left`), kein Hard-Delete | — |
| Einladungs-E-Mails | Owner/Admin des Studios | `studio_invitations.email_normalized` | Nein | Ja (nur role/expiresAt, nicht die E-Mail selbst) | Ja, unverschlüsselt | 7 Tage TTL, danach `expired`, kein Hard-Delete | Betrifft ggf. eine noch nicht registrierte Person |
| Auditdaten | Owner/Admin | `studio_audit_events` | Nein | — (ist selbst das Audit) | Ja | Kein Lösch-/Retention-Mechanismus im Code gefunden | Append-only nur Konvention, s.o. |
| Coaching-Beziehungen | Owner/Admin (alle), Trainer (nur eigene) | `studio_coaching_relationships` | Nein | Ja (nur Membership-IDs) | Ja | Statustransition (`ended`), kein Hard-Delete | — |
| Programmzuweisungen | Owner/Admin/Trainer (Coachees), Mitglied (eigene) | `studio_program_assignments` | Nein | Ja (Member-ID, Versionsnummer) | Ja | Statustransition, kein Hard-Delete | — |
| Session-Metadaten (Status, Zeitstempel) | Mitglied selbst, Coach mit aktiver Beziehung | `studio_workout_sessions` | Nein | Ja (nur Assignment-/Tag-ID beim Start, sonst leer) | Ja, unverschlüsselt | Statustransition, kein Hard-Delete | — |
| **Satzresultate (Gewicht, Wiederholungen, RPE, Distanz, Dauer)** | Mitglied selbst, Coach **nur** mit eigener aktiver Beziehung, **kein** Owner-/Admin-Bypass | `studio_workout_session_sets` | **Nein — explizit ausgeschlossen und getestet** | **Nein — nie, auch nicht als redigierter Wert** | Ja, siehe Fußnote¹ | Kein Hard-Delete-Pfad; laut ADR 003 das sensibelste personenbezogene Datum der Anwendung | Höchste Schutzstufe im System; profitiert am stärksten davon, dass der produktionsfähige Backup-Pfad seit Stage 2B1 verschlüsselt ist |
| Member-Notizen (Session/Übung/Satz) | Wie Satzresultate | `studio_workout_session*.member_note` | Nein | Nein | Ja, unverschlüsselt | Kein Hard-Delete | — |
| **Trainer-Feedback zu Sessions** | Mitglied selbst (dauerhaft, auch nach Beziehungsende), Coach **nur** mit eigener aktiver, session-pinnender Beziehung, **kein** Owner-/Admin-Bypass | `studio_workout_session_feedback` (Migration 008) | Nein | Nur `{feedbackId, sessionId}`, nie der Text | Ja, unverschlüsselt | Kein Hard-Delete, kein Update — append-only per Schema-Design (kein PATCH/DELETE-Endpunkt) | Neu in Stage 1B.2B2B; erbt die P4-Schutzstufe der Satzresultate |

¹ „Ja, unverschlüsselt" in dieser Tabelle bezieht sich auf die MySQL-Tabelle
selbst (keine Verschlüsselung im Ruhezustand innerhalb der Datenbank). Für
den **Backup-Artefakt-Pfad** gilt seit Stage 2B1: Der einzige in Produktion
zulässige Weg (`db:backup:create`) erzeugt ein authentifiziert
AES-256-GCM-verschlüsseltes `.ftbackup`; der alte, unverschlüsselte
`db:backup`/`db:backup:daily`-Pfad ist in Produktion seit der
Release-Gate-Härtung ausnahmslos gesperrt (siehe „Backups" oben).

**Technischer Ist-Zustand, keine Rechtsauskunft:** Seit Stage 5C1 (2026-07-28) existiert ein Recht-auf-Löschung-/Anonymisierungs-Mechanismus für das eigene Konto (`POST /api/account/deletion-request`) — Anonymisierung mit kryptographisch zufälligen, nicht ableitbaren Platzhaltern oder vollständiger Hard Delete, je nach Studio-Historie. Historische Studio-/Trainingsdaten Dritter (Coaching-Beziehungen, Programmzuweisungen, Session-/Feedback-Historie) bleiben davon unverändert erhalten, nur der Verweis auf den Urheber wird anonymisiert. Freitext (Coach-Feedback, Notizen) wird bewusst nicht durchsucht/bereinigt. **Weiterhin offen:** keine Frontend-Oberfläche (Stage 5C2, nur API erreichbar), kein Datenexport, keine Admin-Löschung fremder Konten. Details in `STAGE_5C1_ACCOUNT_DELETION_BACKEND.md`.

## Auffällige Lücken (Zusammenfassung)

1. ~~Kein Off-host-Backup implementiert~~ — Mechanik seit Stage 2B2A vorhanden (S3-kompatibler Upload/Download/Retention-Pfad, siehe oben), aber noch kein echter externer Bucket verbunden (Stufe 2B2B).
2. ~~Keine Verschlüsselung von Backup-Artefakten im Ruhezustand~~ — seit Stage 2B1 behoben und seit der Release-Gate-Härtung der einzige produktionsfähige Backup-Pfad (siehe oben); betraf insbesondere die P4-Trainingsleistungsdaten.
3. Eine einzige DB-Rolle für Runtime/Migration/Restore statt getrennter Privilegien.
4. ~~Timing-Seitenkanal bei Login-Enumeration~~ — seit Stage 3B2 behoben: ein zentraler, einmalig bei Modul-Load vorab erzeugter Dummy-Bcrypt-Hash (nie pro Anfrage neu erzeugt) sorgt dafür, dass ein unbekanntes Konto denselben strukturellen `bcrypt.compare`-Aufwand verursacht wie ein falsches Passwort für ein echtes Konto, siehe `STAGE_3B2_SESSION_HARDENING.md` Abschnitt 6.
5. Audit-Append-only ist reine Anwendungskonvention, nicht DB-erzwungen.
6. ~~Kein Produktions-E-Mail-Provider verdrahtet~~ — seit Stage 2A behoben: validierter, opt-in SMTP-Adapter vorhanden (siehe oben). Weiterhin offen: kein Bounce-/Complaint-Handling, keine Zustell-Warteschlange, und ein echter Versand wurde in dieser Umgebung mangels Zugangsdaten nicht real nachgewiesen.
7. ~~CORS-Konfiguration ungetestet~~ — seit Stage 3D behoben: `CORS_ALLOWED_ORIGINS` wird als exakte Origin-Allowlist validiert und sowohl per HTTP-Test (`corsHeaders.test.js`) als auch echt im Browser (`corsSecurity.spec.js`) geprüft. Diese Zeile war bis zum Stage-5B-Audit (2026-07-27) versehentlich nicht durchgestrichen worden, obwohl der Stage-3D-Nachtrag oben die Behebung bereits beschreibt — ein reiner Dokumentationsfehler (Liste nicht mit eigenem Nachtrag synchronisiert), kein fortbestehender Produktmangel; siehe `STAGE_5B_PRODUCT_PILOT_READINESS_AUDIT.md` Abschnitt 3.
8. ~~Rate Limiter ist pro Prozess, nicht zentral~~ — seit Stage 3D behoben: ein gemeinsamer, atomarer MySQL-Store (Migration 011, `security_rate_limit_buckets`) wird von jeder Anwendungsinstanz geteilt. Gleicher Korrekturhinweis wie Punkt 7 — bis zum Stage-5B-Audit nicht durchgestrichen, siehe dort Abschnitt 3.
9. ~~Kein abgeschlossener/nachgewiesener Restore-Drill~~ — seit Stage 2B1 behoben: automatisierter Drill (`db:backup:drill`) und ein manueller Lauf mit synthetischem Schlüssel, beide gegen die lokale MySQL-Instanz, siehe oben.
10. ~~Kein Recht-auf-Löschung-/Anonymisierungspfad für Benutzerdaten~~ — seit Stage 5C1 (2026-07-28) **backendseitig behoben**: Self-Service-Kontolöschung mit Anonymisierung/Hard-Delete, siehe Abschnitt „Account-Löschung und Deletion Receipts" oben. **Weiterhin offen:** keine Frontend-Oberfläche (Stage 5C2), keine Freitextbereinigung (bewusst).
11. `coachActionEligibility` ist toter Code mit irreführender Bypass-Semantik (Drift-Risiko).
