# Stage 5A1: Unified Training Calendar — Backend Foundation und Scheduling Domain

Geprüfter Ausgangs-Commit: `52849a4` (main, PR #20 "Merge... feature/stage-4a-final-local-acceptance"), Branch `feature/stage-5a1-unified-calendar-backend`. Diese Phase liefert ausschliesslich das Backend-Fundament für einen vereinheitlichten persönlichen Trainingskalender — Datenmodell, Domänenlogik, Terminierungsregeln, Lese-API, Mutations-APIs und die Verknüpfung mit der bestehenden Workout-Session-Ausführung. **Es gibt in dieser Phase keine Kalender-UI** (Stage 5A2, bewusst nicht begonnen).

---

## 1. Ausgangslage und analysierte Architektur

Vor der Implementierung wurden folgende bestehende Bausteine analysiert (Repository-Durchsicht plus gezielte Recherche):

| Bereich | Befund |
|---|---|
| Persönliche Workouts | `workouts` (Stage-0-Ära, kein `public_id`, roher Integer-`id` über `GET/PUT/DELETE /workouts/:id`), `trainingService.js`, `progress_entries` als abgeleitete, unveränderliche Historie |
| Studio-Programme | `studio_training_programs` → `studio_training_program_versions` → `studio_training_program_days` → `studio_training_program_exercises`, mit Snapshot-Semantik pro veröffentlichter Version |
| Zuweisungen | `studio_program_assignments` (Mitglied ↔ Programmversion ↔ Coaching-Beziehung), Start-/Enddatum bereits vorhanden, `status` (`active`/…) |
| Workout-Ausführung | `studio_workout_sessions` (Start/Complete/Abort, `clientStartKey`-Idempotenz, `revision`-CAS), `workoutSessionService.js` |
| RBAC/Tenancy | `studioPolicy.js` (`PERMISSIONS`, Rollen owner/admin/trainer/member), `createStudioContextMiddleware`/`requireStudioPermission`, jede Studio-Ressource strikt über `studio_id` isoliert |
| Coach-Zuständigkeit | kein zentraler Mechanismus — jeder Service prüft die aktive Coaching-Beziehung des Akteurs selbst inline (ad hoc), z. B. `programAssignmentService.js`; die vorhandene `coachActionEligibility()` in `studioPolicy.js` ist unbenutzter, toter Code |
| Zeitzonen | `studios.default_timezone` existiert (Stage 1A), **kein** persönliches Benutzer-Zeitzonenfeld irgendwo im Schema |
| UUID-Konvention | `crypto.randomUUID()` über `domain/studioDomain.js` (`createPublicId`, `isPublicId`, `PUBLIC_ID_PATTERN`), `CHAR(36)`-Spalten, durchgängig für alles ausser dem alten `workouts` |
| Audit | `audit/studioAudit.js`, `SAFE_DETAIL_KEYS`-Allowlist pro Event-Typ, ausschliesslich Studio-Kontext (kein Audit für rein persönliche Aktionen) |
| Migrationssystem | nummerierte Dateien unter `database/migrations/`, Guard-then-throw-Idempotenz, `backend/migrations/schemaContract.js`, Migration Doctor, Restore-Drill |
| Routen-Muster | zwei Konventionen koexistieren: älterer eager-instanziierter Stil (`routes/workouts.js`) und neuerer Factory-Stil `createXRouter({service, authenticate})` (`routes/studioV1.js` u. a.), verdrahtet über `startup/app.js#defaultRouters()` |

Ergebnis: Es existiert kein Konzept "was ist für wen an welchem Tag geplant" — nur "was wurde tatsächlich getan" (`workouts`, `progress_entries`, `studio_workout_sessions`). Stage 5A1 fügt genau diese fehlende Schicht hinzu, ohne die bestehenden Ausführungsdaten zu duplizieren oder zu verändern.

---

## 2. Architekturentscheidung: Scheduling Rules + lazy materialisierte Occurrences

Gewählt wurde **"Scheduling Rules + idempotent materialisierte Occurrences"** (eine der beiden im Auftrag vorgeschlagenen Varianten), gegenüber "Scheduling Rules + rein virtuelle Occurrences + persistierte Overrides":

- Eine kleine, durch die Anzahl menschlich konfigurierter Muster begrenzte Tabelle `studio_assignment_schedule_rules` (eine Zeile pro wiederkehrendem Muster: "dieser Programmtag, dieser Wochentag, ab diesem Datum, optional bis, optional jede n-te Woche").
- Konkrete Kalendertage werden **nicht** im Voraus für die gesamte Zukunft erzeugt, sondern **on demand beim Lesen** materialisiert, begrenzt auf das angefragte, auf `MAX_CALENDAR_RANGE_DAYS = 93` Tage gedeckelte Intervall — pro Aufruf also höchstens ~93 Iterationen pro Regel, nie unbegrenzt.
- Idempotenz über `INSERT IGNORE` plus `UNIQUE INDEX (schedule_rule_id, scheduled_date)` auf `training_calendar_entries`: zwei parallele Requests, die dieselbe Regel+Datum materialisieren, kollabieren immer auf dieselbe Zeile.
- Einmal materialisiert, ist eine Zeile **unveränderlich gegenüber späteren Regeländerungen** — eine Regeländerung fügt nur neue, noch nicht materialisierte Zeilen für zukünftige Daten hinzu und rührt nie eine bereits existierende Zeile an. Das erfüllt direkt die Anforderung "zukünftige Regeländerungen verändern nie bereits abgeschlossene historische Events".
- Kein täglicher Scheduler nötig (Anforderung aus Abschnitt 9/Betrieb): Materialisierung passiert transparent innerhalb der ohnehin stattfindenden Lese-Transaktion (`getCalendar`) bzw. beim Start einer Studio-Session (`findOrMaterializeTodayCalendarEntry`).

Gegen die rein virtuelle Variante entschieden, weil eine laufende Session (`IN_PROGRESS`), ein abgeschlossener Status oder eine Verknüpfung zu einer `studio_workout_sessions`-Zeile einen **echten, stabilen Primärschlüssel** braucht, auf den zuverlässig referenziert, gesperrt (`FOR UPDATE`) und optimistisch versioniert (`revision`) werden kann — mit rein virtuellen Objekten wäre das nur über eine parallele Override-Tabelle mit im Grunde derselben Komplexität nachbildbar.

---

## 3. Migration 012 (`012_unified_training_calendar`)

Guard-then-throw-Idempotenz wie alle vorherigen Migrationen (`UNIFIED_CALENDAR_SCHEMA_ALREADY_EXISTS`), geprüft auf leerer DB, Upgrade von 011, wiederholtem Lauf (No-op) und der echten lokalen Entwicklungsdatenbank mit Bestandsdaten.

### 3.1 `workouts.public_id` (Nachrüstung)

Die vor-UUID-Ära-Tabelle `workouts` erhält eine `public_id CHAR(36)`-Spalte: zunächst `NULL`, dann pro Zeile per `UPDATE workouts SET public_id = UUID() WHERE public_id IS NULL` befüllt (MySQL wertet `UUID()` pro Zeile aus, nicht einmal für das ganze Statement — jede Zeile bekommt einen eigenen Wert), danach auf `NOT NULL` plus `UNIQUE INDEX` verschärft. Das bestehende `GET/PUT/DELETE /workouts/:id`-Vertrag (roher Integer) bleibt unverändert; nur die neue Kalender-Lese-API referenziert historische persönliche Workouts über `linkedWorkoutPublicId`, ohne den internen Integer preiszugeben.

### 3.2 `studio_assignment_schedule_rules`

| Spalte | Zweck |
|---|---|
| `public_id` | UUID v4, extern sichtbar |
| `studio_id`, `assignment_id`, `program_day_id` | FKs, `ON DELETE CASCADE` |
| `weekday` | `TINYINT`, 0=Montag..6=Sonntag (siehe Abschnitt 7) |
| `week_interval` | `INT`, Standard 1, 1–52 |
| `anchor_date` | Referenzdatum für "Woche 0" der Intervallrechnung; muss selbst auf `weekday` fallen |
| `active_from` / `active_until` | Gültigkeitsfenster, `active_until` optional (offenes Ende) |
| `status` | `active` / `disabled` |
| `created_by_user_id` | FK auf `users` |

Check Constraints: `weekday BETWEEN 0 AND 6`, `week_interval BETWEEN 1 AND 52`, `active_until IS NULL OR active_until >= active_from`, `status IN ('active','disabled')`. Indizes: eindeutige `public_id`, `assignment_id`, `(studio_id, status)`.

### 3.3 `training_calendar_entries`

Eine Zeile pro konkretem Kalendertag — sowohl persönliche Einträge (`source_type='personal'`, `schedule_rule_id NULL`) als auch materialisierte Studio-Occurrences (`source_type='studio'`, `schedule_rule_id NOT NULL`).

| Spalte | Zweck |
|---|---|
| `public_id` | UUID v4 — stabile externe Identität jeder Occurrence |
| `user_id` | Eigentümer (FK `users`, `ON DELETE CASCADE`) |
| `scheduled_date` | `DATE` — reines Kalenderdatum, keine Uhrzeit/UTC-Instanz (siehe Abschnitt 8) |
| `status` | `PLANNED`/`IN_PROGRESS`/`COMPLETED`/`SKIPPED`/`CANCELLED` |
| `source_type` | `personal`/`studio` |
| `title_snapshot` | Anzeige-Titel zum Materialisierungs-/Erstellzeitpunkt — keine Live-Kopplung an spätere Programmtag-Umbenennungen |
| `studio_id`, `program_assignment_id`, `program_day_id`, `schedule_rule_id` | nur für `source_type='studio'` gesetzt (erzwungen per Check Constraint), `ON DELETE CASCADE` |
| `personal_workout_id` | FK auf `workouts`, `ON DELETE SET NULL` |
| `studio_workout_session_id` | FK auf `studio_workout_sessions`, `ON DELETE SET NULL` |
| `completed_at` / `skipped_at` / `cancelled_at` | jeweils exakt dann gesetzt, wenn der zugehörige Status aktiv ist (Check Constraints) |
| `revision` | optimistischer Zähler (CAS), Konvention aus `007_studio_workout_execution.js` übernommen |

Unique Index `(schedule_rule_id, scheduled_date)` — die gesamte Idempotenzgarantie für Materialisierung; MySQL behandelt jeden `NULL`-Wert in `schedule_rule_id` als eigenständig, wodurch persönliche Einträge (`schedule_rule_id = NULL`) nie über diesen Index miteinander kollidieren.

**Bewusst keine CHECK-Constraint** für "genau ein verknüpfter Workout" (`personal_workout_id` XOR `studio_workout_session_id`): MySQL 8 verbietet, dieselbe Spalte gleichzeitig in einer CHECK-Klausel und einer `ON DELETE SET NULL`-FK-Aktion zu verwenden (`ER_CHECK_CONSTRAINT_CLAUSE_USING_FK_REFER_ACTION_COLUMN`) — real gegen die Entwicklungsdatenbank getestet und bestätigt. Beide Verknüpfungsspalten benötigen `SET NULL` (das Löschen eines alten Workouts oder einer Session darf nie den Kalendereintrag selbst mitlöschen). Das Invariant wird stattdessen ausschliesslich auf Service-Ebene (`trainingCalendarService.js`) durchgesetzt, mit dedizierter Testabdeckung; siehe Kommentar direkt in der Migrationsdatei.

Übrige Check Constraints: `status`-Werte, `source_type`-Werte, `source_shape` (persönlich ⇒ alle Studio-FKs NULL; studio ⇒ alle Studio-FKs NOT NULL), je ein Constraint pro Zeitstempel/Status-Paar, `revision >= 0`.

Schema Contract (`backend/migrations/schemaContract.js`) um Abschnitt `012_unified_training_calendar` erweitert (Tabellen, Spalten, Indizes, FKs — bewusst ohne den nicht existierenden Single-Link-Check). Migration Doctor auf Scratch-DB und echter Entwicklungs-DB bestätigt: `ready:true, applied:12, pending:0, dirty:0, drift:0, unknown:0, schemaIssues:0, ledgerIssues:0`.

---

## 4. Statusmodell

Persistierte Stati (`CALENDAR_ENTRY_STATUSES`): `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `SKIPPED`, `CANCELLED`.

Abgeleitete Anzeige-Stati (`CALENDAR_DISPLAY_STATUSES`, **nie in die DB zurückgeschrieben**): zusätzlich `DUE_TODAY`, `OVERDUE`. Ableitung (`deriveDisplayStatus`, `trainingCalendarDomain.js`):

```
status !== 'PLANNED'        → status unverändert
status === 'PLANNED' und scheduledDate === today  → DUE_TODAY
status === 'PLANNED' und scheduledDate < today    → OVERDUE
status === 'PLANNED' und scheduledDate > today    → PLANNED
```

`today` wird pro Eintrag serverseitig frisch berechnet (nie im Client), siehe Abschnitt 8.

### 4.1 Zentrale Transitionsmatrix (`ALLOWED_TRANSITIONS`)

| Von \ Nach | PLANNED | IN_PROGRESS | COMPLETED | SKIPPED | CANCELLED |
|---|---|---|---|---|---|
| **PLANNED** | ✔ (Reschedule) | ✔ | ✔ | ✔ | ✔ |
| **IN_PROGRESS** | ✔ (Abort) | – | ✔ | – | – |
| **COMPLETED** | – | – | – | – | – |
| **SKIPPED** | – | – | – | – | – |
| **CANCELLED** | – | – | – | – | – |

`COMPLETED`/`SKIPPED`/`CANCELLED` sind in dieser Phase terminal — kein "verschobenen/abgesagten Eintrag reaktivieren" (der Auftrag erlaubt das nur optional, "nur falls ausdrücklich unterstützt"; diese Phase baut das nicht). `IN_PROGRESS → PLANNED` bildet exakt den Session-Abbruch ab (Abschnitt 9). Durchgesetzt von `canTransitionCalendarStatus()`, vollständig unit-getestet (jede erlaubte und jede verbotene Zelle der Matrix).

---

## 5. Persönliche Standardregeln (Erstellung)

`resolvePersonalCreationStatus({scheduledDate, today, planAsUpcoming})`:

- **Zukunft** (`scheduledDate > today`) → immer `PLANNED`, unabhängig von jedem Client-Flag.
- **Heute** (`scheduledDate === today`) → `COMPLETED`, **ausser** der Client setzt explizit `planAsUpcoming: true` → dann `PLANNED`.
- **Vergangenheit** (`scheduledDate < today`) → immer `COMPLETED`.

Die Zukunft kann serverseitig nie direkt auf `COMPLETED` gezwungen werden — das ist keine Client-Option, sondern eine reine Serverregel. Ein persönlicher Eintrag durchläuft nie `IN_PROGRESS` (kein Session-Konzept für manuell erfasste Einträge).

**Erzeugung eines minimalen `workouts`-Datensatzes statt kontraktloser "Completed ohne Workout"**: Wenn ein persönlicher Eintrag direkt als `COMPLETED` erstellt wird (oder später über `completePersonalEntry` nachträglich abgeschlossen wird), legt der Service eine reguläre, minimale Zeile in `workouts` an (Titel, Datum, optional Notizen — keine Übungen erforderlich, da `workouts` keinen entsprechenden NOT-NULL-Zwang hat) und verknüpft sie über `personal_workout_id`. Das erhält den bestehenden `/workouts`-/`progress_entries`-Vertrag als **einzige** Quelle für "was wurde tatsächlich getan" und vermeidet eine zweite, widersprüchliche Repräsentation eines abgeschlossenen Trainings.

---

## 6. Coach-Terminierungsregeln (`scheduleRuleService.js`)

Eine Regel bindet **einen Programmtag** an **einen Wochentag** für **eine bestehende, aktive Zuweisung**. Minimalumfang gemäss Auftrag erfüllt:

- Wöchentliche Planung, mehrere Programmtage pro Woche (mehrere Regeln pro Zuweisung, je eine pro Programmtag+Wochentag-Kombination).
- `week_interval` erlaubt "jede n-te Woche" (n=1..52), verankert an `anchor_date`.
- Bearbeiten zukünftiger Regeln (`updateScheduleRule` — PATCH) und Deaktivieren (`status: 'disabled'`) — beides ändert **nie** bereits materialisierte Zeilen in `training_calendar_entries` (siehe Abschnitt 2).
- Validierung: Programmtag muss zur Programmversion der Zuweisung gehören (`CalendarProgramDayInvalidError`), `anchor_date` muss selbst auf `weekday` fallen, Zuweisung muss `active` sein (`CalendarAssignmentInactiveError`), keine zweite aktive Regel für dieselbe Programmtag+Wochentag-Kombination (`CalendarScheduleRuleConflictError`, per `SELECT ... FOR UPDATE` gegen echte Nebenläufigkeit abgesichert).

### 6.1 Rechte

| Rolle | Lesen (`SCHEDULE_RULE_READ`) | Verwalten (`SCHEDULE_RULE_MANAGE`) |
|---|---|---|
| Owner | ✔ (alle Zuweisungen des eigenen Studios) | ✔ |
| Admin | ✔ | ✔ |
| Trainer | ✔, aber nur für Zuweisungen der **eigenen aktiven Coaching-Beziehung** | ✔, gleiche Einschränkung |
| Member | ✔ (eigene Zuweisung) | – |

Die Trainer-Einschränkung folgt dem bestehenden Ad-hoc-Muster (`lockAssignmentForActor`, gespiegelt von `programAssignmentService.js`): unlocked Lookup zur Ermittlung der Coaching-Beziehung, danach Sperren in kanonischer Reihenfolge ("peek-then-lock", bereits etabliertes Muster aus `accountService.js#confirmEmailChange`). Kein Cross-Tenant-Zugriff möglich — jede Abfrage filtert zusätzlich auf `studio_id`.

---

## 7. Zeitzonenvertrag

Kalenderdaten sind **lokale Trainingstage**, keine UTC-Instanzen:

- `scheduled_date` ist `DATE` (kein `DATETIME`/`TIMESTAMP`) — es gibt bewusst keine Uhrzeitkomponente zu interpretieren.
- "Heute" wird nie über `new Date().toISOString().slice(0, 10)` bestimmt (liefert das UTC-Kalenderdatum, das nahe Mitternacht in jeder Nicht-UTC-Zone falsch ist) — stattdessen über `Intl.DateTimeFormat("en-CA", {timeZone, year, month, day}).format(now)` (`todayInTimezone()`), was direkt im `YYYY-MM-DD`-Format liefert und DST/Offset korrekt über die eingebaute IANA-Zeitzonendatenbank auflöst.
- **Studio-Events**: "heute" wird anhand von `studios.default_timezone` bestimmt (bereits vorhandenes Feld, Stage 1A) — pro Studio einmal pro Leseanfrage berechnet und gecacht (`studioTimezoneCache` in `getCalendar`).
- **Persönliche Events**: mangels persistiertem Benutzer-Zeitzonenfeld (bewusst **nicht** in dieser Phase eingeführt — der Auftrag verbietet explizit den Bau einer grossen neuen Konto-Zeitzonenfunktion) entweder die vom Client optional mitgegebene, validierte IANA-Zeitzone (`timezone`-Query-/Body-Parameter) oder als sicherer Fallback `DEFAULT_PERSONAL_TIMEZONE = "Europe/Zurich"` (identisch mit `studios.default_timezone`s eigenem Standardwert, damit ein persönliches und ein Studio-Event derselben Person am selben physischen Tag standardmässig auf dasselbe Kalenderdatum fallen).
- DST- und Tagesgrenzverhalten direkt gegen zwei reale Instanzen verifiziert: einen echten DST-Übergang (`2026-03-29T01:30:00Z`, Europe/Zurich CET→CEST) und einen spät-UTC/lokal-bereits-nächster-Tag-Fall — beide mit dedizierten Unit-Tests abgesichert.
- Ungültige Zeitzonen-Strings werden serverseitig zurückgewiesen (`CALENDAR_TIMEZONE_INVALID` bzw. generischer `VALIDATION_ERROR` je nach Aufrufpfad), nie stillschweigend akzeptiert.

Wochentagkonvention: `0=Montag..6=Sonntag`, identisch zur bereits bestehenden `frontend/src/views/WorkoutsView.vue`-Kalenderkachel (`(firstDay.getDay() + 6) % 7`) — bewusst beibehalten, damit eine künftige gemeinsame Frontend-Kalenderkomponente nie zwei unterschiedliche Wochentagszählungen für dasselbe Produkt versöhnen muss.

---

## 8. Keine Datenduplizierung

- Studio-Workout-Sessions werden **nicht** in `workouts` kopiert; personal-Workouts werden **nicht** in Studio-Tabellen kopiert.
- Sets/Übungsergebnisse werden nirgends dupliziert — `training_calendar_entries` verlinkt nur per Fremdschlüssel auf die jeweils bestehende Tabelle (`personal_workout_id` → `workouts.id`, `studio_workout_session_id` → `studio_workout_sessions.id`).
- Programmdefinitionen werden nicht in Kalenderzeilen kopiert — nur `title_snapshot` (ein reiner Anzeige-String zum Materialisierungszeitpunkt) und Fremdschlüssel auf `program_day_id`/`program_assignment_id`.
- Bestehende historische persönliche Workouts erscheinen im Kalender **ohne Datenmigration**, über ein vereinigtes Lesemodell (`UNION`-artiges Zusammenführen in `getCalendar`): eine `NOT EXISTS`-Unterabfrage liefert genau die `workouts`-Zeilen im angefragten Zeitraum, die **noch keinen** verknüpften `training_calendar_entries`-Eintrag haben, und rendert sie clientseitig identisch als `COMPLETED`/`source_type='personal'`. Sobald ein solcher Workout später (z. B. über `completePersonalEntry`) tatsächlich verlinkt wird, verschwindet er aus diesem Synthese-Pfad und erscheint nur noch als echte Kalenderzeile — nie doppelt.
- `workouts` und `progress_entries` bleiben durch diese Phase komplett unverändert in ihrer bestehenden Bedeutung; das Datum in Kalendereinträgen folgt exakt dem bestehenden `workout_date`-Vertrag.

---

## 9. Studio-Workout-Integration (`workoutSessionService.js`)

- **Start** (`startSession`): An allen drei Rückgabepunkten (idempotenter Replay über `clientStartKey`, `ER_DUP_ENTRY`-Race, neu erzeugte Session) ruft ein gemeinsamer Abschluss `linkCalendarForSessionStart()` `findOrMaterializeTodayCalendarEntry()` auf — findet die zur Zuweisung+Programmtag+heute passende Regel, materialisiert die heutige Occurrence bei Bedarf (falls noch nie besucht) und verknüpft sie atomar per CAS (`UPDATE ... WHERE id = ? AND status = 'PLANNED'`) auf `IN_PROGRESS`. Ist die Occurrence bereits an eine andere Session verlinkt, wird `CalendarEntryConflictError` (409) geworfen — verhindert doppelten Start. Schreibt `calendar.studio_workout.started`. Existiert keine passende aktive Regel (Ad-hoc-Start ohne Terminierung), bleibt das gesamte bestehende Session-Start-Verhalten unverändert (kein Kalender-Seiteneffekt).
- **Abschluss** (`completeSession`): sucht die verknüpfte Occurrence über `studio_workout_session_id` mit `status='IN_PROGRESS'`, setzt sie atomar auf `COMPLETED` mit `completed_at`, schreibt `calendar.studio_workout.completed`. Ein 0-Zeilen-Treffer (keine verknüpfte Occurrence) ist erwartet und kein Fehler. Keine zusätzliche manuelle Bestätigung nötig — der Session-Abschluss allein genügt.
- **Abbruch** (`abortSession`): eine verknüpfte, noch `IN_PROGRESS`-Occurrence wird zurück auf `PLANNED` gesetzt, `studio_workout_session_id` wird auf `NULL` gelöscht (`revision` erhöht) — bewusste, dokumentierte Entscheidung: kein "für immer stecken bleiben" bei `IN_PROGRESS`, ein neuer Start (neuer `clientStartKey`) verlinkt sich erneut mit derselben, jetzt wieder `PLANNED`-Occurrence. Kein eigenes Kalender-Audit-Ereignis für den Abbruch selbst (`workout_session.aborted` deckt die Aktion bereits ab; `PLANNED` ist kein in Abschnitt 16 des Auftrags gelistetes Terminal-Ereignis).

---

## 10. Lese-API

`GET /api/v1/training-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=IANA` (optional `timezone`, Default `Europe/Zurich`). Nur `authenticateToken` — **nicht** studio-scoped, da ein persönlicher Kalender rollenübergreifend über alle Studios/eigene Einträge hinweg gilt (Schlüssel ist allein `user_id`).

- `from`/`to` Pflicht, `from <= to`, maximal `MAX_CALENDAR_RANGE_DAYS = 93` Tage (`CALENDAR_DATE_RANGE_INVALID` / `CALENDAR_RANGE_TOO_LARGE`).
- Sortierung: `scheduledDate` aufsteigend, dann `sourceType`, dann `title`, dann `id` als stabiler letzter Tie-Breaker.
- Vereint materialisierte Studio-Occurrences, persönliche Einträge und die per `NOT EXISTS` gefundenen historischen `workouts` ohne Verknüpfung (Abschnitt 8) — ohne Duplikate.
- Antwortfelder pro Eintrag: `id` (public), `scheduledDate`, `persistedStatus`, `displayStatus`, `sourceType`, `title`, `studio` (falls zutreffend), `program`/`programDay` (falls zutreffend), `linkedWorkoutType`, `linkedWorkoutPublicId`, `availableActions`. Keine internen numerischen IDs, keine fremden Daten, keine unnötig sensiblen Coach-Daten (kein Coach-Name/keine Coach-Details in dieser Phase exponiert).

`availableActions` wird ausschliesslich serverseitig aus `displayStatus`/`sourceType`/`hasLinkedWorkout` abgeleitet (`deriveAvailableActions`) — nie vom Client vorgegeben, keine reine UI-Berechtigungslogik als Schutzschicht:

| displayStatus | studio | personal |
|---|---|---|
| PLANNED/DUE_TODAY/OVERDUE | START, SKIP, CANCEL | COMPLETE, SKIP, CANCEL, RESCHEDULE |
| IN_PROGRESS | COMPLETE, VIEW_WORKOUT | (kein persönliches Äquivalent) |
| COMPLETED | VIEW_WORKOUT (falls verlinkt), sonst leer | VIEW_WORKOUT (falls verlinkt), sonst leer |
| SKIPPED / CANCELLED | leer | leer |

---

## 11. Mutations-APIs (persönlicher Kalender)

Alle unter `/api/v1/training-calendar`, nur `authenticateToken`, jede Operation ausschliesslich auf eigene Einträge (`WHERE user_id = ?`):

| Route | Zweck |
|---|---|
| `POST /training-calendar` | Neuen persönlichen Eintrag erstellen (Statuslogik Abschnitt 5) |
| `PATCH /training-calendar/:entryId` | Titel eines noch `PLANNED`-Eintrags ändern (nur `personal`) |
| `POST /training-calendar/:entryId/reschedule` | Datum eines `PLANNED`-Eintrags ändern (nur `personal`) |
| `POST /training-calendar/:entryId/complete` | Direkter Abschluss eines persönlichen Eintrags (erzeugt bei Bedarf einen minimalen `workouts`-Datensatz, Abschnitt 5) |
| `POST /training-calendar/:entryId/skip` | Überspringen (persönlich oder studio) |
| `POST /training-calendar/:entryId/cancel` | Absagen (persönlich oder studio) |

Konsistenzgarantien:
- Jede schreibende Operation sperrt die Zeile per `SELECT ... FOR UPDATE` und verlangt ein passendes `expectedRevision` (`UPDATE ... WHERE id = ? AND revision = ?`) — 0 betroffene Zeilen ⇒ `CalendarEntryConflictError` (409, stabiler Code `CALENDAR_ENTRY_CONFLICT`). Optimistische Nebenläufigkeitskontrolle, keine impliziten Zuletzt-gewinnt-Überschreibungen.
- Illegale Statuswechsel werden zentral über `canTransitionCalendarStatus()` abgewiesen (`CALENDAR_INVALID_TRANSITION`, 409) — z. B. kann ein bereits `COMPLETED`-Eintrag nie unkontrolliert zurück auf `PLANNED`.
- `SKIPPED` und `CANCELLED` sind klar unterschiedliche, beide terminale Endzustände.
- Direkter Abschluss (`completePersonalEntry`) ist für Studio-Quellen abgelehnt (`CalendarInvalidTransitionError`) — ein Studio-Vorkommnis wird ausschliesslich über die Session-Kaskade (Abschnitt 9) abgeschlossen, auch wenn die HTTP-Schicht `COMPLETE` für Studio-Einträge ohnehin nie als `availableAction` ausweist (keine alleinige UI-Schutzschicht).
- `Notes` sind auf 255 Zeichen begrenzt (identisch zur zugrundeliegenden `workouts.notes VARCHAR(255)`-Spalte, in die ein abgeschlossener persönlicher Eintrag letztlich schreibt) — ein höheres Limit hätte Validierung bestehen lassen und wäre erst beim Insert fehlgeschlagen oder stillschweigend abgeschnitten worden.

---

## 12. Fehlercodes

`backend/errors/TrainingCalendarErrors.js`, alle `AppError`-Subklassen mit stabilem `code`+`status`:

| Code | Status | Verwendung |
|---|---|---|
| `CALENDAR_DATE_RANGE_INVALID` | 400 | `from`/`to` ungültig oder invertiert |
| `CALENDAR_RANGE_TOO_LARGE` | 400 | Intervall > 93 Tage |
| `CALENDAR_ENTRY_NOT_FOUND` | 404 | Eintrag existiert nicht **oder** gehört einer anderen Person/manipulierte UUID — bewusst identisch, kein Existenz-Leak |
| `CALENDAR_ENTRY_FORBIDDEN` | 403 | legitime Mitgliedschaft, aber Rolle/Beziehung reicht nicht |
| `CALENDAR_INVALID_TRANSITION` | 409 | verbotener Statuswechsel laut Matrix |
| `CALENDAR_ENTRY_CONFLICT` | 409 | `expectedRevision` stimmt nicht mehr (CAS-Konflikt) |
| `CALENDAR_WORKOUT_ALREADY_LINKED` | 409 | reserviert für Doppel-Verlinkung eines Workouts |
| `CALENDAR_SCHEDULE_RULE_CONFLICT` | 409 | zweite aktive Regel für dieselbe Programmtag+Wochentag-Kombination |
| `CALENDAR_SCHEDULE_RULE_NOT_FOUND` | 404 | über die Auftragsliste hinaus ergänzt — Regel existiert nicht/fremdes Studio |
| `CALENDAR_ASSIGNMENT_INACTIVE` | 409 | Zuweisung nicht `active` |
| `CALENDAR_PROGRAM_DAY_INVALID` | 409 | Programmtag gehört nicht zur Programmversion der Zuweisung, oder `anchorDate`/Wochentag passen nicht zusammen |
| `CALENDAR_TIMEZONE_INVALID` | 400 | keine gültige IANA-Zeitzone |

Keine Existenz-Leaks über Studiogrenzen oder auf fremde Kalendereinträge — durchgängig getestet (manipulierte UUID, Cross-Tenant, Cross-User).

---

## 13. Audit-Ereignisse

Nur Studio-Terminierung wird auditiert (rein persönliche Kalenderaktionen erscheinen bewusst **nicht** im Studio-Audit-Log — kein Zugriff sensibler Dritter auf private Trainingsdaten):

| Event | Details (Allowlist) |
|---|---|
| `assignment.schedule_rule.created` | `assignmentId`, `weekday` |
| `assignment.schedule_rule.updated` | `assignmentId` |
| `assignment.schedule_rule.disabled` | `assignmentId` |
| `calendar.studio_workout.started` | – |
| `calendar.studio_workout.completed` | – |
| `calendar.studio_workout.skipped` | – |
| `calendar.studio_workout.cancelled` | – |

Erweitert `SAFE_DETAIL_KEYS` in `audit/studioAudit.js` plus einen neuen `weekday`-Detail-Validator (Ganzzahl 0–6). Keine privaten Workout-Inhalte oder Leistungsdaten in irgendeinem Detail-Objekt.

---

## 14. RBAC und Tenant-Isolation

- **Persönlicher Kalender**: ausschliesslich `authenticateToken`, jede Abfrage/jedes Update zusätzlich `WHERE user_id = ?` — kein Studio-Kontext nötig oder vorhanden.
- **Terminierungsregeln**: `createStudioContextMiddleware` + `requireStudioPermission(PERMISSIONS.SCHEDULE_RULE_MANAGE|READ)`, Owner/Admin uneingeschränkt innerhalb ihres Studios, Trainer nur innerhalb der eigenen aktiven Coaching-Beziehung (Abschnitt 6.1), Member nur lesend. Keine Cross-Tenant-Regelverwaltung — jede Abfrage filtert zusätzlich auf `studio_id`.
- Manipulierte/fremde UUIDs führen durchgängig zu `404` (nie `403`, wo Existenz sonst preisgegeben würde) bzw. zu den studiospezifischen 403/404-Konventionen der bestehenden Middleware.

---

## 15. Tests

### 15.1 Unit (neu: 39 Tests in 2 Dateien, gesamt Backend-Unit-Suite jetzt 59 Dateien)

- `test/unit/trainingCalendarDomain.test.js` (28 Tests): Vokabulare, Zeitzonen-/DST-Korrektheit (echte Fixtures), Display-Status-Ableitung, persönliche Default-Logik, vollständige Transitionsmatrix (erlaubt/verboten/keine Selbst-Transition bei Terminalzuständen), `availableActions` pro Zustand/Quelle, Wochentag-/Intervallrechnung, Datumshilfsfunktionen.
- `test/unit/trainingCalendarValidation.test.js` (11 Tests): Bereichsvalidierung inkl. Fehlercodes, Payload-Grenzen, Terminierungsregel-Payload-Validierung.

### 15.2 Integration (neu: 18 Tests in `test/integration/trainingCalendarApi.test.js`, gesamt jetzt 18 Integrationsdateien)

RBAC (Owner/Admin/Trainer/Member/Cross-Tenant), Materialisierung inklusive Duplikatfreiheit und paralleler Race-Sicherheit, Session-Start/-Abschluss/-Abbruch-Integration mit Kalenderverknüpfung und Audit-Ereignissen, persönliche Mutationen (Default-Status bei Erstellung, Reschedule/Skip/Cancel/ungültige Transition, veraltete-Revision-Konflikt), Cross-User-Isolation, manipulierte UUID, Legacy-Workout-Union ohne Duplikate, Bereichsvalidierung/-limit, historische Unveränderlichkeit unter Regeländerung. Zweimal unabhängig als stabil bestätigt (18/18 beide Male).

### 15.3 Vollständige Regression

- `npm run test:unit`: **508/508** bestanden.
- `npm run test:integration`: **249/249** bestanden (231 bestehend + 18 neu) — inklusive einer während dieser Phase gefundenen und behobenen Regression in einem **bestehenden** Test (siehe Abschnitt 16).
- `npm run test:migrations`: bestanden (leere DB, Upgrade, No-op, Doctor, Drift).
- `npm run test:syntax`: bestanden.
- `npm run audit:security` (Backend): **0 Schwachstellen** ab Schweregrad "high".
- Encrypted Backup/Restore-Drill gegen die reale lokale Entwicklungsdatenbank: bestanden (siehe Abschlussbericht für den vollständigen Report).
- Frontend: `test:run` **341/341** bestanden, Produktions-Build erfolgreich, `npm audit --audit-level=high` **0 Schwachstellen** — alle drei unverändert grün, da Stage 5A1 keine Frontend-Änderungen vornimmt.
- Chromium-E2E-/Axe-Suite: unverändert grün (siehe Abschlussbericht für die genaue Testanzahl).

---

## 16. Während dieser Phase gefundene und behobene Regressionen in bestehendem Code

1. **`trainingService.js#createWorkout`**: Nach Hinzufügen der NOT-NULL-Spalte `workouts.public_id` (Migration 012) schlug die bestehende, unveränderte `POST /workouts`-Route fehl (`ER_NO_DEFAULT_FOR_FIELD`), da ihr INSERT nie `public_id` befüllte. Gefunden über den eigenen manuellen End-to-End-Smoke-Test vor Erstellung der formalen Testsuite. Behoben durch Import von `createPublicId` aus `domain/studioDomain.js` und Ergänzung im INSERT.
2. **`encryptedBackupRestoreDrill.test.js`**: Eine bestehende Assertion hatte die erwartete Anzahl angewendeter Migrationen fest auf `11` codiert (zuletzt bei Stage 3D aktualisiert). Nach Migration 012 schlug dieser Test mit `12 !== 11` fehl. Gefunden über die vollständige Regressionssuite (`npm test`), behoben durch Aktualisierung der Assertion auf `12` samt aktualisiertem erklärendem Kommentar.

Beide Funde sind exakt die Art von "bestehender Code durch Schemaänderung betroffen"-Regression, die eine vollständige Regressionssuite aufdecken soll — in dieser Phase gefunden und behoben, bevor sie das Ergebnis verfälschen konnten.

---

## 17. Bekannte Einschränkungen und Follow-ups (nicht Teil dieser Phase)

- **Kein Kalender-UI** — Stage 5A2, bewusst nicht begonnen.
- **Kein "verschobenen/abgesagten Eintrag reaktivieren"** (`SKIPPED`/`CANCELLED` → `PLANNED`) — vom Auftrag nur optional vorgesehen, hier nicht gebaut; die Transitionsmatrix ist so vorbereitet, dass eine spätere Phase das gezielt ergänzen kann.
- **Kein persönliches Benutzer-Zeitzonenfeld** — bewusste Entscheidung dieser Phase (Abschnitt 7); eine zukünftige Phase könnte ein solches Feld ergänzen, ohne das Domänenmodul (`todayInTimezone` nimmt bereits eine beliebige Zeitzone entgegen) ändern zu müssen.
- **`CALENDAR_WORKOUT_ALREADY_LINKED`** ist als Fehlerklasse vorhanden, aber (noch) an keiner konkreten Aufrufstelle ausgelöst — reserviert für eine zukünftige Phase, die eine explizite "verknüpfe bestehenden Workout mit Kalendereintrag"-Mutation einführt.
- **Keine zentrale Trainer-Coaching-Scoping-Funktion** — folgt bewusst der bestehenden Ad-hoc-Konvention statt die vorhandene, aber unbenutzte `coachActionEligibility()` zu reaktivieren (ausserhalb des Auftragsumfangs dieser Phase).
- **Kein Massen-Reschedule/keine Serienänderung** für mehrere zukünftige Occurrences auf einmal — jede Mutation wirkt auf genau einen Kalendereintrag.
