# Stage 5C1: Account Deletion Backend & Deletion Receipt Foundation

Geprüfter Ausgangs-Commit: `78fc3fd` (main, PR #25 "Merge... design/stage-5c-personal-data-lifecycle"), Branch `feature/stage-5c1-account-deletion-backend`. Diese Phase liefert das vollständige **Backend** für selbstbedienten, unwiderruflichen Account-Löschung — Migration, Domänenlogik, Planer, atomare Löschtransaktion, Auth-Invalidierung, extern signierte Deletion Receipts, Receipt-Doctor und Restore-Reconciliation. **Es gibt in dieser Phase keine Frontend-UI** (weder Danger-Zone/Bestätigungsdialog noch Studio-Membership-Removal-UI — beides bewusst Stage 5C2, nicht begonnen).

Referenzdokumente: [`docs/STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md`](./STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md) (Detailvertrag) und [`docs/adr/004-personal-data-deletion-and-retention.md`](./adr/004-personal-data-deletion-and-retention.md) (Architekturentscheidung, gewinnt bei Konflikt). Beide Dokumente sind aus einer vorherigen, ausschliesslich dokumentativen Phase (Stage 5C Design) bereits gemerged und unverändert Grundlage dieser Implementierung.

---

## 0. Merge-Gate-Review (2026-07-28) — 5 Befunde behoben

Vor dem für merge-bereit erklärten Zustand deckte eine gezielte Merge-Gate-Prüfung fünf Befunde auf, alle behoben und getestet, bevor diese Phase erneut als abschlussbereit gilt. Volle Begründung je Befund direkt in den betroffenen Abschnitten unten sowie in ADR 004s neuem Abschnitt „Amendment"; hier nur die Kurzfassung:

1. **Privat-zu-global-Leak bei persönlichen Übungen (behoben):** `exercises.user_id` ist `ON DELETE SET NULL`, und `GET /exercises` behandelt jede `user_id IS NULL`-Zeile als global sichtbar — ein Hard Delete hätte die persönlichen Übungen des gelöschten Kontos in die globale Bibliothek durchsickern lassen. Behoben durch explizites Löschen persönlicher Übungen als Teil von `deletePersonalData`, in **beiden** Modi, unmittelbar nach `workouts`/`progress_entries` (Abschnitt 5/6/11).
2. **Terminierungsregel-Scope war unvollständig (behoben):** deaktivierte bisher nur Regeln, die das gelöschte Konto selbst erstellt hatte. Der endgültige Vertrag verlangt die Vereinigung aus Ersteller-Scope **und** Mitglied-Scope (aktive Regeln für Assignments, deren Member das gelöschte Konto ist) — behoben, keine Doppelzählung, Preview und Execute teilen dasselbe Prädikat (Abschnitt 5).
3. **Persönliche Kalendereinträge wurden unbedingt gelöscht (behoben):** entgegen dem bereits korrekt gemergten Design (`persönliche PLANNED-Einträge werden hart gelöscht`) löschte die Transaktion **alle** persönlichen Einträge unabhängig vom Status. Korrigiert auf `status='PLANNED'`-only im Anonymisierungsfall; im Hard-Delete-Fall bleibt die Löschung **aller** persönlichen Einträge nötig (keine überlebende Zeile, an die eine Historie geknüpft werden könnte — `training_calendar_entries.user_id` ist `ON DELETE CASCADE`). Das Preview-Feld wurde von `futurePersonalCalendarEntries` zu `personalCalendarEntriesToDelete` umbenannt, da „future" im Hard-Delete-Fall keine ehrliche Beschreibung mehr wäre (Abschnitt 4/5/9).
4. **CSRF-Vertrag explizit entschieden (Option B, No-CSRF):** verifiziert und getestet, dass `/api/account/deletion-request` niemals allein über Cookies authentifizierbar ist, fremde Origins keinen autorisierten Request erzeugen können (weder als „simple" Request noch über einen Authorization-erfordernden Preflight) und der Authorization-Header zwingend ist. In ADR 004 als endgültige Architekturentscheidung dokumentiert (Abschnitt 8).
5. **Receipt-Ausfallsicherheit verschärft (behoben):** der Deletion Receipt Doctor behandelte ein fehlendes Receipt bisher als rein selbstheilend, nicht fail-closed. Jetzt meldet er `recovery_required`/`ready:false` sofort bei jedem fehlenden Receipt, exakt wie bei einem beschädigten — Reconciliation heilt weiterhin unverändert. **Bekannte Restriktion:** für hard-delete-fähige Konten bleibt ein Receipt-Schreibfehler strukturell unentdeckbar durch den Doctor (keine überlebende Zeile zum Prüfen) — nur das strukturierte Log bleibt dort das einzige Signal (Abschnitt 14.4/17).

Alle fünf Befunde sind durch neue, gezielte Integrationstests abgesichert (`test/integration/accountDeletionApi.test.js`, siehe Abschnitt 18).

---

## 1. Produktziel und Ausgangslage

FitTrack besass bislang keinen Weg, ein Benutzerkonto endgültig zu entfernen — nur Studio-Mitgliedschaften konnten über `status` verändert werden. Stage 5C1 schliesst diese Lücke für den Self-Service-Fall ("ich möchte mein eigenes Konto löschen") mit einer hybriden Strategie:

- **Standardfall — Anonymisierung**: Die `users`-Zeile bleibt bestehen (sie wird von `RESTRICT`-Fremdschlüsseln aus historischen Studio-Daten referenziert), aber Benutzername, E-Mail und Passwort-Hash werden durch kryptographisch zufällige, nicht ableitbare Platzhalter ersetzt.
- **Ausnahmefall — Hard Delete**: Ein Konto, das **niemals** Mitglied irgendeines Studios war (`COUNT(*) FROM studio_memberships WHERE user_id=?` exakt `0`), wird vollständig aus `users` gelöscht — es gibt keine historischen Fremdschlüssel, die eine Zeile erzwingen würden.

Beide Pfade sind über dieselbe atomare Transaktion erreichbar; welcher Pfad greift, wird ausschliesslich serverseitig anhand der tatsächlichen Mitgliedschaftshistorie entschieden, nie vom Client.

---

## 2. Migration 013 (`013_account_lifecycle`)

Guard-then-throw-Idempotenz (`ACCOUNT_LIFECYCLE_SCHEMA_ALREADY_EXISTS`) wie jede vorherige Migration. Rein additiv auf `users`:

| Spalte/Objekt | Zweck |
|---|---|
| `lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'active'` | Jede bestehende Zeile wird über den Spalten-Default selbst `'active'` — kein separates UPDATE-Backfill nötig |
| `deleted_at TIMESTAMP(3) NULL` | Nur bei `lifecycle_status='deleted'` gesetzt |
| `idx_users_lifecycle_status` | Index für Auth-Query und Doctor/Reconciliation-Scans |
| `chk_users_lifecycle_status` | `lifecycle_status IN ('active','deleted')` |
| `chk_users_deleted_at` | `(status='deleted' AND deleted_at NOT NULL) OR (status='active' AND deleted_at NULL)` |

**Kein `deletion_reason`**: In einem früheren Entwurf vorgesehen, nach kritischer Durchsicht bewusst entfernt (ADR 004, "Consequences") — diese Phase kennt genau einen Auslöser (Self-Service), eine Spalte mit auf jeder Zeile identischem Wert hätte keinen Zweck. `user_auth_sessions.revocation_reason` benötigt keine Schemaänderung (bereits ungebundenes `VARCHAR(32) NULL`) — der neue Wert `'account_deletion'` ist reine Anwendungskonvention neben den bestehenden Werten.

`backend/migrations/schemaContract.js` um Abschnitt `013_account_lifecycle` erweitert (2 Spalten, 1 Index, 2 Check Constraints). Migration Doctor gegen eine frische Scratch-DB bestätigt: `ready:true, applied:13, pending:0, dirty:0, drift:0, unknown:0, schemaIssues:0, ledgerIssues:0`.

---

## 3. Lifecycle-Domäne (`backend/domain/userLifecycleDomain.js`)

Zwei Zustände, eine erlaubte Transition (`active → deleted`, terminal — kein Zurück in dieser Phase, entspricht Design Section 10). Zentrale Exporte:

- `isValidLifecycleStatus` / `isActiveLifecycleStatus` / `isDeletedLifecycleStatus` / `isTerminalLifecycleStatus` / `canTransitionLifecycleStatus`
- `hasNoStudioHistory(membershipRowCount)` / `isHardDeleteEligible` — exakter `=== 0`-Vergleich, wirft `TypeError` bei negativer/nicht-ganzzahliger Eingabe
- `classifyDeletionStrategy(table)` — reine Nachschlagetabelle (`DELETION_STRATEGY_BY_TABLE`, 18 Tabellen) für unabhängige Unit-Testbarkeit der Retention-Klassifikation; die eigentliche Transaktion dispatcht **nicht** dynamisch darauf, sondern hartcodiert jeden Schritt gemäss Abschnitt 5 — die Klassifikation muss lediglich mit dieser Sequenz konsistent bleiben
- `generateAnonymizedUsername` / `generateAnonymizedEmail` / `isAnonymizedEmail` (Details Abschnitt 6)
- `projectMemberDisplayName({lifecycleStatus}, locale)` — liefert `null` für aktive Konten (Aufrufer nutzt den echten Namen weiter), sonst ein fixes, lokalisiertes Label (`"Gelöschtes Mitglied"` / `"Deleted member"`) — nie den internen Zufalls-Platzhalter

---

## 4. Account-Deletion-Planer (`backend/services/accountDeletionPlanner.js`)

Eine einzige Funktion, `planAccountDeletion(connection, userId, {forUpdate})`, wird **identisch** von zwei Aufrufern genutzt:

- **Preview** (`GET .../deletion-preview`): `forUpdate:false`, gegen den normalen Pool.
- **Execute** (`POST .../deletion-request`, erster Teil der Transaktion): `forUpdate:true`, `SELECT ... FOR UPDATE`.

Es gibt **keinen zweiten, unabhängig gepflegten Codepfad**, der je von dem abweichen könnte, was die Vorschau zeigte — das erfüllt direkt die Designanforderung "Preview entspricht exakt der tatsächlichen Ausführung" (Blocker 6).

Der Plan berechnet:
- `mode`: `hard_delete` (keine je existierende Mitgliedschaft) oder `anonymize`.
- `blockers`: pro Studio, in dem das Konto der **einzige aktive Owner** ist (`SELECT COUNT(*) FROM studio_memberships WHERE studio_id=? AND role='owner' AND status='active'`, unter `FOR UPDATE` im Execute-Pfad) — Feld `studios` enthält ausschliesslich die eigenen Studios des Akteurs, nie Daten Dritter.
- `studios`: öffentliche Projektion (`studioId`, `studioName`, `role`, `isSoleActiveOwner`) nur der aktuell aktiven/suspendierten Mitgliedschaften.
- `impact`: `runningWorkoutSessions`, `activeAssignments`, `activeCoachingRelationships`, `activeScheduleRules`, `personalCalendarEntriesToDelete`, `futureStudioCalendarEntries`.
- `personalDataCounts` (jetzt inkl. `personalExercises`, tatsächlich gelöscht, siehe Abschnitt 6/7) / `preservedHistoryCounts`: was gelöscht wird vs. was (anonymisiert) erhalten bleibt.
- `confirmationPhrase: {type:'username'}`, `notices` (feste, mehrsprachig vorbereitete Hinweistexte zu Freitext- und Backup-Retention).

**Merge-Gate-Korrektur (Abschnitt 0, Befund #2 und #3):**
- `activeScheduleRules` zählt jetzt die Vereinigung aus Ersteller-Scope (`created_by_user_id=Konto`) **und** Mitglied-Scope (Assignment, dessen `member_membership_id` zum Konto gehört) — identisches Prädikat wie die Execute-Transaktion (Abschnitt 5), keine Doppelzählung durch einen einzelnen `JOIN`+`WHERE ... OR ...`.
- `personalCalendarEntriesToDelete` (umbenannt von der illustrativen `futurePersonalCalendarEntries` des Designdokuments) zählt im Anonymisierungsfall nur `status='PLANNED'`-Einträge (historische `COMPLETED`/`SKIPPED`/`CANCELLED`-Einträge bleiben erhalten, exakt wie ihr Studio-Pendant) — im Hard-Delete-Fall dagegen **alle** persönlichen Einträge, da `training_calendar_entries.user_id` `ON DELETE CASCADE` auf `users` ist und keine überlebende Zeile für eine "erhaltene Historie" existiert. Der neue Name behauptet nie mehr "future", wo das in einem der beiden Modi nicht mehr zuträfe — siehe ADR 004s Amendment für die volle Herleitung.

Die öffentliche Projektion (`publicDeletionPreview`) entfernt jede interne numerische ID — nur `studioId`/Membership-`public_id` verlassen den Service.

---

## 5. Die atomare Löschtransaktion (`backend/services/accountDeletionService.js`)

`executeDeletionTransaction(actorUserId, {requestId, lifecycleAction})` — der passwortlose Kern, der auch von der Restore-Reconciliation wiederverwendet wird (Abschnitt 12). `requestAccountDeletion` prüft davor Passwort/Bestätigungsphrase auf einem **ungesperrten** Read (Lock-Haltezeit minimieren) und ruft dann genau diese Funktion.

Reihenfolge innerhalb einer Transaktion (`BEGIN` … `COMMIT`):

1. **Pre-Flight** (vor Transaktionsbeginn): `assertReceiptSubsystemUsable()` — verweigert den Start, wenn das Receipt-Subsystem in Produktion unkonfiguriert ist oder die Konfiguration selbst ungültig ist (`ACCOUNT_DELETION_SERVICE_UNAVAILABLE`, 503). Dies unterscheidet sich bewusst von einem Receipt-**Schreib**fehler nach erfolgreichem Commit (Schritt 17), der die HTTP-Antwort nie scheitern lässt.
2. Konto-Zeile sperren, `planAccountDeletion(…, forUpdate:true)` — liefert zugleich den Sole-Owner-Blocker-Check.
3. Bereits gelöscht? → `commit()` + `ACCOUNT_ALREADY_DELETED` (409) — kein Rollback nötig, es wurde nichts geändert, aber die Sperren müssen sauber freigegeben werden.
4. Blocker vorhanden? → `rollback()` + `ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED` (409).
5. Laufende Studio-Workout-Sessions abbrechen (`in_progress → aborted`), verknüpfter Kalendereintrag `IN_PROGRESS → PLANNED` (Wiederverwendung des bestehenden Session-Abbruch-Effekts).
6. Aktive Zuweisungen des Kontos **als Mitglied** abbrechen (`active → cancelled`) — Zuweisungen, die das Konto selbst als Coach **erstellt** hat, bleiben unverändert.
7. Aktive Coaching-Beziehungen (als Coach oder Mitglied) beenden (`active → ended`).
8. Terminierungsregeln deaktivieren (`active → disabled`) — **Merge-Gate-Korrektur (Befund #2):** die Vereinigung aus (a) Regeln, die das Konto **erstellt** hat (verhindert, dass die Regel eines ausgeschiedenen Coaches weiterhin Trainingstage für ein fremdes, weiterhin aktives Mitglied materialisiert — "Phantom-Coach"), **und** (b) Regeln für Assignments, deren **Mitglied** das gelöschte Konto ist, unabhängig davon, wer sie erstellt hat (verhindert, dass eine fremde Regel weiterhin auf ein bereits durch Schritt 6 abgesagtes Assignment zeigt — ein „Mix aus live und stale", den ADR 004 selbst als zu vermeidendes Ziel benennt). Ein einzelner `JOIN`+`WHERE ... OR ...` verarbeitet eine Regel, die beide Bedingungen erfüllt, nie doppelt.
9. Kalendereinträge: geplante Studio-Vorkommnisse (`PLANNED → CANCELLED`, erfasst auch die gerade aus `IN_PROGRESS` zurückgesetzten Zeilen, da diese Abfrage danach läuft); persönliche Einträge — **Merge-Gate-Korrektur (Befund #3):** im Anonymisierungsfall nur `status='PLANNED'` hart gelöscht (historische `COMPLETED`/`SKIPPED`/`CANCELLED`-Einträge bleiben erhalten, exakt wie beim Design bereits spezifiziert), im Hard-Delete-Fall dagegen **alle** persönlichen Einträge unabhängig vom Status (keine überlebende Zeile, an die eine Historie geknüpft werden könnte — `user_id` ist `ON DELETE CASCADE`).
10. Persönliche Daten hart löschen: `progress_entries`, `workouts` (kaskadiert `workout_exercises`), **`exercises` (Merge-Gate-Korrektur, Befund #1)** — nur die eigenen (`user_id=Konto`), nie globale (`user_id IS NULL`) Zeilen, in **beiden** Modi und stets nach `progress_entries`/`workouts`, da genau diese beiden Tabellen die einzigen `RESTRICT`-Fremdschlüssel auf `exercises.id` sind und zu diesem Zeitpunkt bereits leer sind.
11. Alle aktiven/suspendierten Mitgliedschaften → `status='left'`, je ein `membership.left`-Audit-Ereignis pro betroffenem Studio.
12. Offene E-Mail-Änderungsanfragen löschen.
13. **Alle** Sessions/Refresh-Tokens widerrufen (`revokeAllSessionsInTransaction`, Grund `account_deletion`).
14. Anonymisieren **oder** Hard Delete der `users`-Zeile (Abschnitt 6).
15. Audit-Ereignisse einfügen (bestehende `SAFE_DETAIL_KEYS`-Allowlist, keine neuen Event-Typen nötig).
16. `COMMIT`.
17. Strukturiertes Log (`account_deletion_completed`).
18. **Best-effort** externe Deletion-Receipt-Publikation — ein Schreibfehler hier wird laut geloggt, lässt die HTTP-Antwort aber nie scheitern.

**Fehlersicherheit ohne falsche Atomaritäts-Behauptung**: Frühzeitige Ausstiegspfade (bereits gelöscht, Blocker) setzen `earlyExitError`, committen/rollbacken und geben die Verbindung frei, **bevor** sie werfen — der äussere `catch`-Block prüft `if (error !== earlyExitError)`, bevor er selbst rollback/release versucht, und verhindert damit eine doppelte Freigabe derselben Pool-Verbindung (in dieser Phase selbst gefunden und behoben, kein von aussen gemeldeter Fehler).

---

## 6. Anonymisierung (Hauptfall)

- `generateAnonymizedUsername()` → `deleted-user-<24 Hex-Zeichen>` (12 zufällige Bytes).
- `generateAnonymizedEmail()` → `deleted-<32 Hex-Zeichen>@deleted.fittrack.invalid` — `.invalid` ist die laut RFC 2606 reservierte, nie auflösbare TLD: eine echte Mailserver-Route existiert nie, und niemand kann sie je legitim registrieren, wodurch ein Platzhalter nie mit einer echten, zustellbaren Adresse kollidieren kann.
- Passwort-Hash: `bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10)` — ein echter, mit Faktor 10 (identisch zu allen übrigen Passwort-Hashes im System) berechneter bcrypt-Hash eines nie kommunizierten Zufallswerts. Das erhält identisches Timing-Verhalten bei einem künftigen (garantiert scheiternden) Login-Versuch gegenüber einem aktiven Konto.
- `auth_version` wird erhöht (invalidiert sofort jedes bestehende Access-Token unabhängig von der Session-Prüfung).
- Kollisions-Retry: bis zu 5 Versuche bei `ER_DUP_ENTRY` (astronomisch unwahrscheinlich bei 128 Bit Zufall, aber als Verteidigung in der Tiefe vorhanden) — jeder Versuch generiert neue Zufallswerte.
- Alle vier Felder werden in **derselben** `UPDATE ... WHERE id=? AND lifecycle_status='active'`-Anweisung gesetzt — ein 0-Zeilen-Ergebnis (Ausnahmefall: gleichzeitiger zweiter Löschversuch hat gewonnen) wirft `ACCOUNT_ALREADY_DELETED`.

## 7. Hard Delete (Ausnahmefall)

`DELETE FROM users WHERE id=? AND lifecycle_status='active'` — nur erreichbar, wenn `planAccountDeletion` `mode:'hard_delete'` ermittelt hat (keine je existierende `studio_memberships`-Zeile). Kein `RESTRICT`-Fremdschlüssel kann hier je greifen, da ein Konto ohne Mitgliedschaftshistorie keine referenzierenden Studio-Zeilen besitzt.

---

## 8. Auth-Invalidierung

- **Login** (`routes/users.js`): `if (!user || user.lifecycle_status !== "active" || !isMatch)` — die `bcrypt.compare` läuft in **jedem** Fall gegen einen echten Hash, der Lifecycle-Check erfolgt erst danach, sodass das Timing-Profil zwischen "unbekanntes Konto", "gelöschtes Konto" und "falsches Passwort" identisch bleibt. Alle drei Fälle werfen exakt dieselbe `AuthenticationError("Invalid email or password.")`.
- **`authMiddleware.js`** (defense in depth): die bestehende kombinierte `users LEFT JOIN user_auth_sessions`-Abfrage wurde um `u.lifecycle_status AS user_lifecycle_status` erweitert; `accountDeleted = row.user_lifecycle_status !== "active"` ist in die bestehende Invalidierungs-ODER-Kette gefaltet — kollabiert auf denselben generischen `AuthSessionInvalidatedError` wie jede andere Ungültigkeitsursache (abgelaufen, widerrufen, `auth_version`-Mismatch). Dieser Schritt fing bei der ersten vollen Regression eine **eigene, bestehende** Unit-Test-Fixture ab (`test/unit/authMiddleware.test.js`), deren gemockte "gültige Session"-Zeile die neue Spalte nicht kannte — behoben durch Ergänzen von `user_lifecycle_status: 'active'` im Test-Fixture-Helper (`sessionRow()`), plus einem neuen dedizierten Test für den gelöscht-Fall.
- **Refresh** (`sessionService.js`) benötigte **keine Codeänderung**: `rotateRefreshToken` vergleicht bereits `session_auth_version` gegen `user_auth_version` (die Anonymisierung erhöht Letzteres) und führt ohnehin ein frisches `SELECT ... FOR UPDATE` gegen `users` aus, das beim Hard-Delete-Fall null Zeilen liefert (`AuthRefreshTokenInvalidError`) — durch Codeprüfung verifiziert, nicht durch Vermutung.
- **CSRF/Origin (Merge-Gate-Befund #4, endgültig entschieden — Option B, No-CSRF):** `/api/account/*` ist Bearer-Token-authentifiziert, nicht Cookie-basiert — CSRF verteidigt spezifisch Cookie-getragene Auth und greift hier nicht (verifiziert: der bestehende `change-password`-Endpunkt hat ebenfalls keinen CSRF-Guard). `authMiddleware.js` liest ausschliesslich `req.headers["authorization"]` — nie ein Cookie — was strukturell garantiert, dass keine Cookie-only-Authentifizierung je möglich ist. Ein gefälschter Cross-Site-Request kann den Access Token (nur im Frontend-Arbeitsspeicher, nie in einem Cookie) grundsätzlich nicht mitliefern; selbst ein Versuch, den `Authorization`-Header zu setzen, erfordert einen Preflight (nicht-„simple" Header), den die globale Origin-Allowlist für jede nicht konfigurierte Origin verweigert. Zwei dedizierte Integrationstests beweisen beides: ein Cookie-only-Request mit echten, gültigen Refresh-/CSRF-Cookies aber ohne `Authorization`-Header wird mit 401 abgelehnt; ein Cross-Site-Request von einer nicht erlaubten Origin erhält weder auf den „simple" Request noch auf den Preflight einen freizügigen CORS-Header. Endgültig als Architekturentscheidung in ADR 004s Abschnitt „Amendment" festgehalten.

---

## 9. API

### 9.1 `GET /api/account/deletion-preview`

Nur `authenticateToken`, kein Rate Limiter (keine destruktive Nebenwirkung), kein CSRF (siehe oben). Antwort: `{deletionPreview: {...}}` gemäss Abschnitt 4 — oder `{deletionPreview: {alreadyDeleted: true}}`, falls das aufrufende Konto (impraktikabel, da Auth es blockieren würde) bereits gelöscht ist.

### 9.2 `POST /api/account/deletion-request`

Rate-limitiert (`account.deleteRequest`), `authenticateToken`. Body: `{currentPassword, confirmationPhrase}` (`validateAccountDeletionRequestPayload` — beide Pflichtfelder, keine unbekannten Schlüssel). Bei Erfolg: `clearSessionCookies(res)` (kein neues Session-Paar wird ausgestellt — die Transaktion hat bereits jede Session widerrufen; das Löschen der Cookies verhindert nur, dass der Browser weiterhin ein Cookie sendet, das der Server ohnehin ablehnen würde), Antwort `{accountDeletion: {completedAt, studiosAffected}}`.

---

## 10. Fehlercodes (`backend/errors/AccountDeletionErrors.js`)

| Code | Status | Verwendung |
|---|---|---|
| `ACCOUNT_DELETION_PHRASE_MISMATCH` | 400 | Bestätigungsphrase ≠ eigener Benutzername |
| `ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED` | 409 | Alleiniger aktiver Owner in ≥1 eigenem Studio; `fields.studios` enthält ausschliesslich eigene Studios |
| `ACCOUNT_ALREADY_DELETED` | 409 | Konto bereits gelöscht (Idempotenz-Fall) |
| `ACCOUNT_DELETION_SERVICE_UNAVAILABLE` | 503 | Pre-Flight: Receipt-Subsystem in Produktion unkonfiguriert/ungültig — Löschung wird nie gestartet |
| `DELETION_RECEIPT_CONFIGURATION_UNSAFE` | 503 | Receipt-Konfiguration ungültig (Doctor/Reconciliation) |
| `DELETION_RECEIPT_CORRUPTED` | 503 | Ein Receipt besteht seine Integritätsprüfung nicht |
| `DELETION_RECEIPT_RECONCILIATION_REQUIRED` | 503 | Ungelöste Restore-Inkonsistenz blockiert weitere Aktionen |

Zusätzlich wiederverwendet: `CurrentPasswordInvalidError` (bestehend, aus `AccountErrors.js`), `NotFoundError` (bestehend, aus `AppError.js`).

---

## 11. Betroffene Entitäten — Terminalzustands-Politik im Überblick

| Entität | Scope | Effekt |
|---|---|---|
| Studio-Workout-Sessions | Mitglied | `in_progress → aborted` |
| Programm-Zuweisungen | Mitglied (nicht: von diesem Konto erstellt) | `active → cancelled` |
| Coaching-Beziehungen | Coach **oder** Mitglied | `active → ended` |
| Terminierungsregeln | **Vereinigung**: von diesem Konto erstellt **oder** Mitglied des Assignments ist dieses Konto (Befund #2) | `active → disabled` |
| Studio-Kalendereinträge | Eigentümer | `PLANNED → CANCELLED` |
| Persönliche Kalendereinträge | Eigentümer | Anonymisierung: nur `status='PLANNED'` hart gelöscht, Historie erhalten; Hard Delete: alle Status hart gelöscht (Befund #3) |
| Persönliche Workouts/Progress/Übungen | Eigentümer | hart gelöscht (persönliche Übungen: Befund #1, nie globale `user_id IS NULL`-Zeilen) |
| Mitgliedschaften | Eigentümer, aktiv/suspendiert | `→ left` |
| Sessions/Refresh-Tokens | Eigentümer | vollständig widerrufen |
| E-Mail-Änderungsanfragen | Eigentümer | gelöscht |
| Studio-Audit-Ereignisse | — | unverändert erhalten |

---

## 12. Historische Daten und Freitext-Ehrlichkeit

Studio-Workout-Sessions, Programm-Zuweisungen, Coaching-Beziehungen und Audit-Ereignisse bleiben **inhaltlich unverändert** — nur der Verweis auf den Urheber zeigt danach auf ein anonymisiertes Konto. `projectMemberDisplayName()` (Abschnitt 3) sorgt dafür, dass jede API-Ansicht (z. B. eine Coaching-Beziehungsliste) ein fixes, lokalisiertes Label statt des internen Zufalls-Platzhalters zeigt.

**Freitext wird nicht bereinigt**: Coach-Feedback-Texte, Notizen und ähnliche Freitextfelder, die den ursprünglichen Namen des gelöschten Kontos enthalten könnten, werden **nicht** durchsucht oder verändert (Section 4 des Auftrags verbietet ausdrücklich den Bau einer Freitextbereinigung in dieser Phase). Der Preview-Endpunkt kommuniziert das ehrlich über `notices.freeTextRetention` statt eine Garantie zu geben, die das System nicht einhält. `notices.backupRetention` weist entsprechend auf die dokumentierte Backup-Aufbewahrungsfrist verschlüsselter Backups hin.

---

## 13. Rate Limiting

Neue Policy `account.deleteRequest`: 3 Versuche / 60 Minuten, Schlüssel `userKey("account-delete")` (authentifizierte Benutzer-ID) — grosszügiger als `passwordChange`, da ein legitimer Versuch mehrfach am Sole-Owner-Blocker scheitern kann, während der Benutzer das in einem anderen Tab behebt. Env-Override: `ACCOUNT_DELETE_RATE_LIMIT_MAX` / `ACCOUNT_DELETE_RATE_LIMIT_WINDOW_MS`.

---

## 14. Deletion Receipts

### 14.1 Format (`backend/security/deletionReceipts.js`)

```json
{
  "schemaVersion": 1,
  "receiptId": "UUID v4",
  "accountRef": 12345,
  "lifecycleAction": "deleted",
  "deletedAt": "2026-07-24T10:00:00.000Z",
  "integrity": { "algorithm": "HMAC-SHA256", "keyId": "...", "signature": "..." }
}
```

`accountRef` ist die **interne** `users.id`, nie eine öffentliche ID, E-Mail oder ein Benutzername — bedeutungslos ohne direkten Datenbankzugriff, exakt wie jede andere interne Fremdschlüssel-Referenz in diesem Schema. `lifecycleAction` ist entweder `deleted` (normale Löschtransaktion) oder `reconciliation_reapplied` (von der Restore-Reconciliation geschrieben, Abschnitt 15). Kanonisierung über eine rekursive, schlüsselsortierte `stableStringify` (kein wiederverwendbares Canonical-JSON-Hilfsmittel existierte im Code — `encryptedBackupFormat.js`s eigene Header-Kanonisierung verlässt sich auf eine feste Objekt-Literal-Reihenfolge, die hier nicht anwendbar ist), signiert per HMAC-SHA256. `verifyReceipt` scheitert bei jeder Form-, Versions- oder Signaturabweichung immer per `throw` (nie ein Boolean) — es gibt keinen teilweise-gültigen Rückgabewert, den ein Aufrufer falsch behandeln könnte.

### 14.2 Atomare Publikation (`backend/deletionReceipts/deletionReceiptStore.js`)

Schreiben in `<receiptId>.json.partial` über exklusives `wx`-Öffnen (scheitert, falls eine verwaiste Partial-Datei bereits existiert, statt sie stillschweigend zu überschreiben) plus `fsync`, dann Veröffentlichung über **`link()` statt `rename()`**: `link()` scheitert mit `EEXIST`, falls das Ziel bereits existiert — `rename()` würde es stillschweigend überschreiben. Ein einmal veröffentlichtes Receipt darf nie überschrieben werden; praktisch unerreichbar, da `receiptId` pro Aufruf eine frische zufällige UUID ist, aber diese Wahl macht die Garantie strukturell statt nur probabilistisch.

### 14.3 Konfiguration (`backend/config/deletionReceiptConfig.js`)

| Variable | Zweck |
|---|---|
| `DELETION_RECEIPT_DIR` | Muss ausserhalb sowohl des Git-Repositories als auch von `FITTRACK_BACKUP_DIR` liegen (derselbe Aussenseiter-Check wie `backupCryptoConfig.js`) |
| `DELETION_RECEIPT_HMAC_KEY_B64` | Base64, dekodiert exakt 32 Bytes, Platzhalterwerte werden abgelehnt |
| `DELETION_RECEIPT_HMAC_KEY_ID` | 1–64 Zeichen `[A-Za-z0-9_-]`, Platzhalter abgelehnt |

**Kein stiller Fallback**: In Produktion sind alle drei Variablen Pflicht (Start-Exception sonst). Ausserhalb der Produktion ist "vollständig unkonfiguriert" ein expliziter, nicht werfender Zustand (`{configured:false}`) — ein lokaler Checkout, der den Löschfluss nie ausführt, muss nicht gezwungen werden, einen Schlüssel zu erzeugen, nur um zu starten. Eine **teilweise** Konfiguration wirft dagegen immer, unabhängig von der Umgebung.

### 14.4 Deletion Receipt Doctor (`backend/deletionReceipts/deletionReceiptDoctor.js`)

`diagnoseDeletionReceipts({connection, readConfig, env})` — rein lesend, keine Mutation. Zustände: `ready` / `not_configured` (nur ausserhalb Produktion, weiterhin `ready:true`) / `recovery_required` / `configuration_unsafe`. Vergleicht jedes gültige Receipt gegen den Live-`lifecycle_status` des referenzierten Kontos:

- Zeile fehlt **oder** `lifecycle_status='deleted'` → konsistent.
- Zeile `active` → `restoredActiveAccounts` (ein Restore hat einen Vor-Löschungs-Snapshot zurückgebracht).

Getrennt erfasst: `corruptedReceipts` (HMAC/Form ungültig), `unknownReceipts` (unbekannte `schemaVersion`), `missingReceipts` (eine `deleted`-Zeile ganz ohne passendes Receipt). **Merge-Gate-Korrektur (Befund #5):** `missingReceipts` ist **selbstheilbar über Reconciliation, aber nicht mehr allein von der Fail-Closed-Meldung ausgenommen** — jedes fehlende Receipt setzt `recoveryRequired:true`/`ready:false` sofort, exakt wie ein beschädigtes oder unbekanntes. Begründung: ein einzelnes strukturiertes Log (`account_deletion_receipt_write_failed`) allein als Nachweis zu akzeptieren widerspräche der eigenen Begründung dieses gesamten Subsystems (ADR 004: „A plain structured log line alone is also insufficient"); die Readiness-Probe (Abschnitt 14.7) propagiert dieses Fail-Closed automatisch, da sie `deletionReceiptStatus()`s `ready`-Wert direkt durchreicht. **Bekannte, durch diese Korrektur nicht auflösbare Restriktion:** die zugrundeliegende Prüfung ist ein `SELECT ... WHERE lifecycle_status='deleted'` — für ein hard-delete-fähiges Konto existiert nach der Löschung **keine** Zeile mehr, gegen die geprüft werden könnte. Ein Receipt-Schreibfehler auf dem Hard-Delete-Pfad bleibt daher strukturell unentdeckbar durch den Doctor; nur das strukturierte Log bleibt dort das einzige Signal (siehe Abschnitt 17). Eigene, dichte Exit-Code-Familie (`EXIT_CODES`), bewusst **nicht** dieselbe Nummerierung wie der Migration Doctor (zwei unabhängige Werkzeuge, ein gemeinsames Schema würde riskieren, dass die Bedeutung des einen unter Änderungen des anderen driftet).

### 14.5 Restore-Reconciliation (`backend/deletionReceipts/deletionReceiptReconciliation.js`)

- `planReconciliation()` — rein lesend, nutzt dieselbe Diagnose wie der Doctor.
- `applyReconciliation()` — destruktiv, gated durch **drei unabhängige, exakte** Acknowledgements (spiegelt `databaseSafety.js`s bestehendes `assertRestoreTargetAcknowledgement`-Idiom):
  1. `FITTRACK_DELETION_RECONCILE_APPLY === "true"`
  2. `FITTRACK_DELETION_RECONCILE_DATABASE_ACK === "reconcile:<aktuelle Datenbank>"`
  3. `FITTRACK_DELETION_RECONCILE_RECEIPT_DIR_ACK === <exakt konfiguriertes DELETION_RECEIPT_DIR>`

  Ein blosses `"true"` genügt nirgends allein — ein aus einem unabhängigen Runbook kopiertes `"true"` kann nie versehentlich die falsche Datenbank oder das falsche Receipt-Verzeichnis autorisieren. `applyReconciliation` ruft `executeDeletionTransaction(accountRef, {lifecycleAction:'reconciliation_reapplied'})` — denselben passwortlosen Kern, den der normale Execute-Pfad nutzt (idempotent: die CAS-geschützte UPDATE/DELETE macht eine Wiederholung gegen eine bereits gelöschte Zeile zu einem sicheren No-op) — und heilt jeden `missingReceipts`-Fall selbst, indem es das Receipt ausschliesslich aus der Zeile eigenem `deleted_at` rekonstruiert (keine erneute Löschlogik). Verweigert bei bestehenden `corruptedReceipts`/`unknownReceipts` vollständig (müssen manuell gelöst werden, bevor irgendetwas automatisiert reappliziert wird).

### 14.6 CLI-Befehle

| Befehl | Zweck |
|---|---|
| `npm run db:deletion-receipts:doctor` | Diagnose (read-only) |
| `npm run db:deletion-receipts:reconcile:plan` | Zeigt, was ein Apply-Lauf täte, ohne es zu tun |
| `npm run db:deletion-receipts:reconcile:apply` | Destruktiv, dreifach-acknowledgement-gated |

### 14.7 Readiness-Integration

`createReadinessProbe` erhält einen optionalen `deletionReceiptStatus`-Parameter (Default: No-op `{ready:true}`, sodass bestehende Aufrufer/Tests unberührt bleiben). `server.js` verdrahtet den echten `diagnoseDeletionReceipts`-Aufruf. Bewusst — anders als der Migration Doctor, der ausdrücklich **nicht** in die Live-Readiness eingebunden ist, nur ins CLI — als günstig genug für jeden Poll akzeptiert, da das Receipt-Volumen im Pilotmassstab klein bleibt (Designbegründung, Abschnitt 21).

---

## 15. Audit-Ereignisse

Bestehende `SAFE_DETAIL_KEYS`-Allowlist (`audit/studioAudit.js`) deckte bereits alle fünf benötigten Event-Typen ab — **keine neuen Event-Typen nötig**: `workout_session.aborted`, `training_program_assignment.cancelled`, `coaching_relationship.ended`, `assignment.schedule_rule.disabled`, `membership.left`. `actor_user_id` ist in jedem Fall das gelöschte Konto selbst (eine selbst ausgelöste Entfernung).

---

## 16. Sicherheitsgrenzen (eingehalten)

- Keine manuelle Löschung aus der lokalen Entwicklungsdatenbank — jede destruktive Verifikation lief ausschliesslich gegen disponible, per Namenskonvention (`fittrack_test_*`/`fittrack_e2e_*`/`fittrack_api_test_*`) erzwungene Testdatenbanken, mit vorheriger Zielbestätigung.
- Keine echten E-Mail-Adressen als Testdaten (durchgängig `*.test`/`.invalid`-Domains in neuen Tests).
- Integrationstests ausschliesslich gegen disponible Testdatenbanken (`fittrack_api_test_deletion_<pid>_<timestamp>`, per-Testlauf erstellt und abgebaut).
- Bestehende destructive-database Guards (`assertDestructiveTestTarget`, `assertRestoreTargetAcknowledgement`) unverändert aktiv, keine Umgehung.
- Keine Löschskripte ausserhalb des kontrollierten Service-Vertrags — jede Mutation läuft über `accountDeletionService.js`, keine SQL-Kommandos direkt aus Request-Handlern (`accountRouter.js` ruft ausschliesslich Service-Funktionen auf).
- Keine teilweise abgeschlossene Kontolöschung — Abschnitt 5's Fehlersicherheitsprotokoll.
- Keine Secrets, Receipts oder Testartefakte in Git (Receipt-Verzeichnis liegt ausserhalb des Repositories und ist per Konfigurationsprüfung durchgesetzt; alle Test-Receipt-Verzeichnisse lagen in `os.tmpdir()`).
- Keine ursprüngliche E-Mail/Benutzername in Deletion Receipts — nur die interne `accountRef`.
- Keine Cloud-Ressourcen — Receipts sind lokale Dateien; die für die vollständige Regression genutzte MinIO-Instanz betrifft ausschliesslich das bestehende, unveränderte S3-Backup-Feature (Stage 2B2A) und wurde nach Abschluss der Regression wieder abgebaut.

---

## 17. Bekannte Einschränkungen und Follow-ups (nicht Teil dieser Phase)

- **Keine Frontend-UI** — weder Profil-Danger-Zone/Bestätigungsdialog noch Studio-Membership-Removal-UI. Stage 5C2, bewusst nicht begonnen.
- **Keine Admin-Löschung fremder Konten** — nur Self-Service.
- **Kein Datenexport** ("Recht auf Datenübertragbarkeit") — separat vom Löschrecht, nicht Teil dieser Phase.
- **Kein Cloud-Receipt-Speicher** — Receipts sind lokale Dateien; eine künftige Phase könnte optional S3-Offload ergänzen, ohne das Format (`buildReceipt`/`verifyReceipt`) ändern zu müssen.
- **Keine automatische Owner-Übertragung** — der Sole-Owner-Blocker verlangt manuelles Handeln des Benutzers (Owner-Wechsel) vor einer Löschung.
- **Keine Freitextbereinigung** — bewusst, siehe Abschnitt 12; über `notices.freeTextRetention` transparent kommuniziert.
- **Kein Dashboard** für Löschstatistiken — der Doctor liefert strukturierte JSON-Ausgabe, kein UI.
- **`deletion_reason`** absichtlich nicht eingeführt (Abschnitt 2) — eine künftige Phase mit einem zweiten Löschauslöser (z. B. Admin-Zwangslöschung, Inaktivitäts-Bereinigung) müsste diese Spalte nachrüsten.
- **Receipt-Schreibfehler auf dem Hard-Delete-Pfad sind für den Doctor strukturell unentdeckbar** (Merge-Gate-Befund #5, Abschnitt 14.4): die Diagnose vergleicht gegen die noch existierende `users`-Zeile — ein hard-delete-fähiges Konto hinterlässt keine. Nur das strukturierte Log (`account_deletion_receipt_write_failed`) bleibt in diesem einen Fall das einzige Signal. Eine Lösung würde eine zusätzliche, dauerhafte Spur ausserhalb von `users` erfordern (z. B. eine eigene, von der `users`-Zeile unabhängige Ledger-Tabelle) — ADR 004 lehnt eine solche Löschungs-Ledger-Tabelle bewusst ab ("A new retention-ledger database table... deliberately file-based, not a database object"), sodass dies ein bewusst akzeptierter Rest-Kompromiss bleibt, kein Versehen.

**Nächste Phase**: Stage 5C2 (Frontend-UI für Profil-Danger-Zone und Bestätigungsdialog) — nicht begonnen.

---

## 18. Tests

### 18.1 Unit (50 neue Tests: 46 in sechs neuen Dateien + 4 in drei bestehenden Dateien ergänzt)

| Datei | Tests | Inhalt |
|---|---|---|
| `test/unit/userLifecycleDomain.test.js` | 8 | Statusvokabular, Transitionen, Hard-Delete-Eligibility, Anonymisierungs-Generatoren, Display-Name-Projektion |
| `test/unit/deletionReceiptConfig.test.js` | 10 | Unkonfiguriert/Teilkonfiguriert/Vollständig, Platzhalter-Ablehnung, Aussenseiter-Verzeichnis-Check, Produktions-Fail-Closed |
| `test/unit/deletionReceipts.test.js` | 11 | `stableStringify`-Determinismus, Build/Verify-Rundreise, Signatur-Manipulation, Schema-Version, `receiptId`-Formatvalidierung |
| `test/unit/deletionReceiptStore.test.js` | 4 | Atomare Publikation, `EEXIST`-Schutz gegen Überschreiben, verwaiste Partial-Datei |
| `test/unit/deletionReceiptDoctor.test.js` | 10 | Alle vier Zustände, `restoredActiveAccounts`/`corruptedReceipts`/`unknownReceipts`/`missingReceipts`-Klassifikation |
| `test/unit/accountDeletionErrors.test.js` | 3 | Statuscodes/Felder aller sieben Fehlerklassen |
| `test/unit/authMiddleware.test.js` (ergänzt) | +1 | Gelöschtes-Konto-Token wird trotz gültiger Session/`authVersion` abgewiesen |
| `test/unit/rateLimiter.test.js` (ergänzt) | +1 | `account.deleteRequest`-Default (3/60min), pro Benutzer geschlüsselt, unabhängig von `passwordChange` |
| `test/unit/userValidation.test.js` (ergänzt) | +2 | `validateAccountDeletionRequestPayload` — Pflichtfelder, unbekannte Schlüssel |

### 18.2 Integration (32 Tests insgesamt in `test/integration/accountDeletionApi.test.js`: 23 aus der ursprünglichen Implementierung + 9 neue aus dem Merge-Gate-Review)

Vorschau-Korrektheit (Hard-Delete-Fall, Sole-Owner-Blocker, Impact-Zählung, keine Drittdaten-Leckage inkl. interner IDs), Execute-Validierung (falsches Passwort, falsche Phrase, fehlende Felder, fehlende Authentifizierung), Sole-Owner-Blocker mit Vorher/Nachher-Snapshot-Beweis keiner Teilmutation, Mehrfach-Owner-Erfolgsfall, vollständige Transaktionswirkung über alle sieben terminalisierten Entitätstypen, kreuz-Studio-Isolation (eine fremde Zuweisung bleibt unberührt), Unveränderlichkeit bereits abgeschlossener Historie, Anonymisierung (Login scheitert identisch zu unbekanntem Konto, altes Token invalidiert, E-Mail sofort wiederverwendbar), Idempotenz (zweiter Löschversuch kann sich nicht mehr authentifizieren), Hard-Delete-Fall (Zeile vollständig verschwunden), Cookie-Löschung, gültiges Receipt nach Löschung, Doctor-`ready`-Bestätigung, Restore-Simulation mit Doctor-Erkennung und Reconciliation-Reapply, Ablehnung von `applyReconciliation` ohne alle drei Acknowledgements, echte parallele Doppelanfrage (genau ein Erfolg).

**Neu aus dem Merge-Gate-Review (9 Tests):**
- Befund #1 (2 Tests): Hard-Delete-Fall — persönliche Übung wird gelöscht und erscheint nie in der globalen Bibliothek eines fremden Benutzers; Anonymisierungs-Fall — persönliche Übung wird identisch zu Workouts/Progress gelöscht, deckungsgleich mit dem Preview-Zähler.
- Befund #2 (2 Tests): Vereinigungs-Prädikat deckt Mitglied-Scope (fremder Coach) und Ersteller-Scope (Coach selbst) ab, lässt eine unrelated Regel und eine bereits deaktivierte Regel unberührt, Preview entspricht exakt Execute; Reconciliation wendet dasselbe Mitglied-Scope-Prädikat erneut an.
- Befund #3 (3 Tests): historische (`COMPLETED`/`CANCELLED`) persönliche Einträge bleiben im Anonymisierungsfall erhalten, nur `PLANNED` wird gelöscht, Preview stimmt exakt; im Hard-Delete-Fall wird auch ein historischer Eintrag entfernt (keine überlebende Zeile).
- Befund #4 (2 Tests): ein Cookie-only-Request mit echten, gültigen Refresh-/CSRF-Cookies aber ohne `Authorization`-Header wird abgelehnt; ein Cross-Site-Request von einer nicht erlaubten Origin erhält weder auf den „simple" Request noch auf den Preflight einen freizügigen CORS-Header.
- Befund #5 (1 Test, 7-Schritte-Fluss): DB-Commit erfolgreich trotz künstlich erzwungenem Receipt-Schreibfehler, HTTP-Antwort zeigt keine Teilmutation, Doctor meldet sofort `recovery_required`/`ready:false` (keine PII in der Ausgabe), eine wie in `server.js` verdrahtete Readiness-Probe scheitert ebenfalls fail-closed, Reconciliation heilt das fehlende Receipt, danach sind Doctor und Readiness wieder `ready`.

### 18.3 Migration (2 neue Tests plus 4 aktualisierte Legacy-Zähler)

Neuer Schema-Erzwingungstest (`migrationDatabase.test.js`) und neuer Schema-Contract-Abdeckungstest (`migrationDoctor.test.js`, 5 Prüfpunkte: 2 Spalten, 1 Index, 2 Check Constraints, 0 Tabellen). Vier bestehende, auf "12 Migrationen"/`012_unified_training_calendar` als letzte hartcodierte Tests (`migrationDatabase.test.js` ×2, `migrationDoctorDatabase.test.js`, `migrationPlanning.test.js`) auf `13`/`013_account_lifecycle` aktualisiert — erwartete Pflege, keine Bugs. Eine fünfte, bislang übersehene Instanz desselben Musters wurde erst während der vollen Regression in `test/integration/encryptedBackupRestoreDrill.test.js` gefunden (`report.migrationDoctor.summary.applied` fest auf `12` codiert) und ebenso aktualisiert.

### 18.4 Vollständige Regression

Zwei Durchläufe: die ursprüngliche Implementierung (Abschnitt 1-20 unten unverändert) und, nach dem Merge-Gate-Review (Abschnitt 0), eine erneute vollständige Regression mit den 5 Korrekturen. Zahlen unten sind der **finale** Stand nach dem Review:

- `npm run test:unit`: **558/558** bestanden (unverändert durch das Review — die beiden betroffenen bestehenden Unit-Tests, `userLifecycleDomain.test.js`/`deletionReceiptDoctor.test.js`, wurden inhaltlich aktualisiert, nicht neu hinzugefügt).
- `npm run test:integration`: **286/286** bestanden (254 bestehend + 23 aus der ursprünglichen Implementierung + 9 neue aus dem Merge-Gate-Review) — inklusive einer während der ursprünglichen Implementierung gefundenen und behobenen Regression in einem **bestehenden** Test (`test/integration/accountApi.test.js`, siehe Abschnitt 19).
- `npm run test:migrations`: **34/34** bestanden.
- `npm run test:syntax`: bestanden (250 Dateien).
- `npm run audit --audit-level=high` (Backend): **0 Schwachstellen**.
- Migration Doctor gegen eine disponible Scratch-Datenbank: `ready:true, applied:13, pending:0, dirty:0, drift:0, unknown:0, schemaIssues:0, ledgerIssues:0`.
- Deletion Receipt Doctor gegen dieselbe Art Scratch-Datenbank (unkonfigurierte Nicht-Produktionsumgebung): `state:not_configured, ready:true`.
- Frontend: `npm run test:unit` **499/499** bestanden, Produktions-Build erfolgreich, `npm audit --audit-level=high` **0 Schwachstellen** — unverändert grün, da Stage 5C1 (inkl. Merge-Gate-Review) keine Frontend-Änderungen vornimmt.
- Chromium-E2E-/Axe-Suite: **64/64**, nach dem Merge-Gate-Review erneut zweimal unabhängig bestätigt, 0 fehlgeschlagen, 0 übersprungen, keine unerwarteten Retries, keine kritischen/schweren Axe-Befunde.

---

## 19. Während dieser Phase gefundene und behobene Regressionen in bestehendem Code

1. **`test/integration/accountApi.test.js`**: Nachdem `createAccountRouter` einen `deleteRequest`-Rate-Limiter zwingend voraussetzt (Abschnitt 13), scheiterte die bestehende, unveränderte Konstruktion eines zweiten Router-Instanz-Fixtures (für den simulierten Zustellungsausfall-Testpfad) mit `TypeError: Account router requires passwordChange/emailChangeRequest/emailChangeConfirm/deleteRequest rate limiters.` — alle 22 Tests dieser Datei schlugen als Hook-Fehler fehl. Gefunden über die vollständige Integrationssuite, behoben durch Ergänzen von `deleteRequest: failingRateLimiters.deleteRequest` im betroffenen Fixture-Objekt.
2. **`test/integration/encryptedBackupRestoreDrill.test.js`**: Eine bestehende Assertion hatte die erwartete Anzahl angewendeter Migrationen fest auf `12` codiert (zuletzt bei Stage 5A1 aktualisiert). Nach Migration 013 schlug dieser Test mit `13 !== 12` fehl. Gefunden über die vollständige Regressionssuite, behoben durch Aktualisierung der Assertion auf `13` samt aktualisiertem erklärendem Kommentar.
3. **`test/unit/authMiddleware.test.js`**: Die bestehende, gemockte "gültige Session"-Testzeile (`sessionRow()`-Helper) kannte die neue `user_lifecycle_status`-Spalte nicht, wodurch der neue `accountDeleted`-Check sie fälschlich als ungültig einstufte. Gefunden über die volle Unit-Suite, behoben durch Ergänzen von `user_lifecycle_status: 'active'` als Default im Helper, plus einem neuen dedizierten Test für den tatsächlichen Invalidierungsfall.

Alle drei Funde sind exakt die Art von "bestehender Code durch neues Pflichtfeld/neue Spalte betroffen"-Regression, die eine vollständige Regressionssuite aufdecken soll — in dieser Phase gefunden und behoben, bevor sie das Ergebnis verfälschen konnten.

---

## 20. Betriebsanleitung (Runbook-Ergänzung)

Siehe [`docs/LOCAL_PILOT_RUNBOOK.md`](./LOCAL_PILOT_RUNBOOK.md) für die vollständige, um Stage 5C1 ergänzte Betriebsanleitung (Konfigurationsvariablen, Doctor-Aufruf, Reconciliation-Ablauf). Kurzfassung:

1. **Produktion**: `DELETION_RECEIPT_DIR`, `DELETION_RECEIPT_HMAC_KEY_B64`, `DELETION_RECEIPT_HMAC_KEY_ID` müssen vor dem ersten Start gesetzt sein (sonst startet der Prozess nicht — Fail-Closed).
2. **Laufender Betrieb**: `npm run db:deletion-receipts:doctor` regelmässig (oder über die bereits in die Readiness-Probe integrierte Prüfung) — `recovery_required` bedeutet, dass ein Restore einen Vor-Löschungs-Snapshot zurückgebracht hat oder ein Receipt beschädigt ist.
3. **Nach einem Restore, der `restoredActiveAccounts` meldet**: zuerst `npm run db:deletion-receipts:reconcile:plan` (read-only) prüfen, dann mit gesetzten drei Acknowledgements `npm run db:deletion-receipts:reconcile:apply` ausführen.
4. **Beschädigte/unbekannte Receipts** müssen manuell untersucht werden — `applyReconciliation` verweigert die Ausführung, solange sie bestehen.
