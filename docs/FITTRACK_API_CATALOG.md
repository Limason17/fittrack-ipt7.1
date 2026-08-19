# FitTrack API-Katalog

Stand: 2026-07-20, Branch `feature/stage-1b2b2b-coach-results-feedback` (Stage 1B.2B2B). Ergänzt um `GET .../coaching-relationships/me`, den Statusfilter auf `.../coached-members/:membershipId/workout-sessions` sowie die neuen Feedback-Routen; alle übrigen Zeilen unverändert aus dem vorherigen Stand übernommen.

**Ergänzung Stage 5C1 (2026-07-24)**: neuer Abschnitt „Account" für `backend/routes/accountRouter.js` (`/api/account`, seit Stage 3B1 gemountet, bislang nicht in diesem Katalog erfasst) inklusive der beiden neuen Deletion-Endpunkte. Alle übrigen Abschnitte unverändert aus dem vorherigen Stand übernommen — sie spiegeln nicht jede seither gemergte Stage (2A–5B); nur der für diese Phase erforderliche Abschnitt wurde ergänzt.

**Korrektur Stage 5D (2026-08-19, `docs/STAGE_5D_CURRENT_STATE_AUDIT.md`)**: zwei vollständige, seit Stage 5A1/5A3 gemountete Router-Module fehlten in diesem Katalog komplett — Abschnitte „Training Calendar" (`trainingCalendarV1.js`) und „Assignment Schedule Rules" (`assignmentScheduleRuleV1.js`) unten neu ergänzt, direkt gegen den Router-Quellcode verifiziert. Ausserdem war die Spalte „Frontend" für die gesamte Workout-Session-/Coach-Resultat-Gruppe seit Stage 1B.2B2A/1B.2B2B veraltet (behauptete durchgängig „Kein Frontend-Nutzer") — korrigiert. Alle übrigen Zeilen unverändert aus dem vorherigen Stand übernommen; dies ist weiterhin kein vollständiger Neuabgleich jeder einzelnen Zelle gegen jede seither gemergte Stage.

## Globale Konventionen

- **Fehler-Envelope** (`backend/middleware/httpFoundation.js`): jede Fehlerantwort ist `{ "error": { "code", "message", "requestId", "fields"? } }`. `fields` nur bei `ValidationError`. Unbekannte/5xx-Fehler werden zu `code: "INTERNAL_ERROR"` maskiert — keine Stacktraces, keine SQL-Fragmente im Response-Body.
- **Auth**: `Authorization: Bearer <JWT>`, HS256, gegen `JWT_SECRET` verifiziert. Fehlt/ungültig/abgelaufen → 401 `AUTHENTICATION_REQUIRED`. Das JWT enthält ausschließlich `{ id }` — keine Rolle, keine Studio-Zugehörigkeit; Rolle wird bei jedem Request live aus der DB gelesen.
- **Studio-Tenant-Kontext**: `:studioId` muss eine UUIDv4 Public-ID sein, sonst 404 `STUDIO_NOT_FOUND`. Der Kontext wird über einen INNER JOIN geladen, der `studio.status='active' AND membership.status='active'` verlangt — ein fremder, suspendierter oder ausgeschiedener Benutzer erhält identisch 404, nie 403. `requireStudioPermission(...)` prüft danach `hasStudioPermission()`; Fehlschlag → 403 `INSUFFICIENT_STUDIO_ROLE`.
- **Pagination**: `page` (Default 1, max 1.000.000), `limit` (Default 20, max 100); jeder andere Query-Key → 400 `VALIDATION_ERROR`. Antwort enthält `pagination: { page, limit, total, totalPages }`.
- **Bekannter Befund**: `coachActionEligibility` in `studioPolicy.js` ist definiert und unit-getestet, wird aber von keiner Route/keinem Service aufgerufen — die tatsächliche Coach-Eligibility läuft über einen separaten, redundanten Codepfad in `programAssignmentService.js`. Siehe `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`.

## Privacy-Klassen (für die Spalte "Datenschutzklasse" je Gruppe)

| Klasse | Bedeutung | Betroffene Gruppen |
|---|---|---|
| **P0 – Öffentlich/technisch** | Keine personenbezogenen Daten | Health |
| **P1 – Konto/Identität** | Account-Metadaten, Einstellungen | Auth/Users, Account |
| **P2 – Persönliche Trainingsdaten** | Eigene, private Trainingsleistungen | Exercises, Workouts, Progress, Training Calendar |
| **P3 – Studio-Geschäftsdaten** | Organisatorische Metadaten ohne Leistungsdaten | Studios, Memberships, Invitations, Audit, Coaching, Trainingsprogramme, Versionen, Tage, Übungen (Vorgaben), Assignments, Assignment Schedule Rules |
| **P4 – Studio-Leistungsdaten (höchste Schutzstufe)** | Tatsächliche Trainingsergebnisse einer identifizierbaren Person | Workout-Sessions, Session-Exercises, Session-Sets, Coach-Resultatzugriff, Trainings-Feedback |

---

## Auth/Users — `backend/routes/users.js`, mounted at `/api/users`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Wichtige Request-Felder | Response (Top-Level) | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/users/register` | keine (5/h/IP) | n/a | n/a | Registrierung | username, email, password, language_preference, weight_unit, distance_unit | message, userId | Nein | 400, 409 `USER_ALREADY_EXISTS`, 429 | P1 | RegisterView.vue | Unit+Integration+E2E |
| POST | `/api/users/login` | keine (10/15min/IP) | n/a | n/a | Login, JWT (8h) | email, password | message, token, user{...} | Nein | 400, 401, 429 | P1 | LoginView.vue | Unit+Integration+E2E |
| GET | `/api/users/me` | JWT | any | n/a | Eigenes Profil | — | id, username, email, ... | Nein | 401, 404 | P1 | ProfileView.vue | Integration |
| PUT | `/api/users/language` | JWT | any | n/a | Sprache setzen | language_preference | message, language_preference | Nein | 400, 401, 404 | P1 | ProfileView.vue | Component+Integration |
| PUT | `/api/users/weight-unit` | JWT | any | n/a | Gewichtseinheit setzen | weight_unit | message, weight_unit | Nein | 400, 401, 404 | P1 | ProfileView.vue | Component+Integration |
| PUT | `/api/users/distance-unit` | JWT | any | n/a | Distanzeinheit setzen | distance_unit | message, distance_unit | Nein | 400, 401, 404 | P1 | ProfileView.vue | Component+Integration |

## Account — `backend/routes/accountRouter.js`, mounted at `/api/account` (Stage 3B1 self-service, erweitert um Deletion in Stage 5C1)

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Wichtige Request-Felder | Response (Top-Level) | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/account/change-password` | JWT (5/60min/User) | any | n/a | Passwort ändern, alle Sessions widerrufen | currentPassword, newPassword, confirmNewPassword | message | Nein | 400, 401, 429 | P1 | ProfileView.vue | Unit+Integration |
| POST | `/api/account/email-change-requests` | JWT (5/60min/User) | any | n/a | E-Mail-Änderung anfragen (Bestätigungslink) | currentPassword, newEmail | message, delivery | Nein | 400, 401, 409, 429 | P1 | ProfileView.vue | Unit+Integration |
| GET | `/api/account/email-change-requests/current` | JWT | any | n/a | Eigenen offenen Antrag ansehen | — | emailChangeRequest | Nein | 401 | P1 | ProfileView.vue | Integration |
| DELETE | `/api/account/email-change-requests/current` | JWT | any | n/a | Eigenen offenen Antrag widerrufen | — | message | Nein | 401, 404 | P1 | ProfileView.vue | Integration |
| POST | `/api/account/email-change-confirmations` | keine, Token-Besitz (20/15min/IP) | n/a | n/a | E-Mail-Änderung per Token bestätigen | token | message | Nein | 400, 404, 409, 429 | P1 | EmailChangeConfirmView.vue | Unit+Integration |
| GET | `/api/account/deletion-preview` | JWT | any | n/a | Vorschau der eigenen Kontolöschung (Modus, Blocker, Impact) | — | deletionPreview{mode, studios, blockers, impact, personalDataCounts, preservedHistoryCounts, confirmationPhrase, notices} | Nein | 401 | P1 | *noch keine UI (Stage 5C2)* | Integration |
| POST | `/api/account/deletion-request` | JWT (3/60min/User) | any | n/a | Eigenes Konto unwiderruflich löschen (anonymisieren oder hard-delete) | currentPassword, confirmationPhrase | accountDeletion{completedAt, studiosAffected} | Nein | 400 `ACCOUNT_DELETION_PHRASE_MISMATCH`, 401, 403, 409 `ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED`/`ACCOUNT_ALREADY_DELETED`, 429, 503 `ACCOUNT_DELETION_SERVICE_UNAVAILABLE` | P1 | *noch keine UI (Stage 5C2)* | Unit+Integration |

## Exercises — `backend/routes/exercises.js`, mounted at `/api/exercises`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/exercises` | JWT | any | n/a | Eigene+globale Übungen, Filter | category, muscle_group | Array | Nein | 400, 401 | P2 | ExercisesView.vue, WorkoutsView.vue, ProgressView.vue | Integration |
| POST | `/api/exercises` | JWT | any | n/a | Eigene Übung erstellen | name, description, category, muscle_group, image_url | message, exerciseId | Nein | 400, 401 | P2 | ExercisesView.vue | Integration |
| PUT | `/api/exercises/:id` | JWT | any (Owner der Zeile) | n/a | Eigene Übung ändern | wie POST | message | Nein | 400, 401, 404 | P2 | ExercisesView.vue | Integration |
| DELETE | `/api/exercises/:id` | JWT | any (Owner der Zeile) | n/a | Eigene Übung löschen | — | message | Nein | 400, 401, 404, 409 `EXERCISE_IN_USE` | P2 | ExercisesView.vue | Integration |

## Workouts — `backend/routes/workouts.js`, mounted at `/api/workouts`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/workouts` | JWT | any | n/a | Eigene Workouts mit Übungen | — | Array | Nein | 401 | P2 | WorkoutsView.vue, HomeView.vue | Component+Integration+E2E |
| POST | `/api/workouts` | JWT | any | n/a | Workout anlegen (+Progress-Spiegel) | title, workout_date, notes, exercises[] | message, workoutId | Nein | 400, 401 | P2 | WorkoutsView.vue | Component+Integration+E2E |
| PUT | `/api/workouts/:id` | JWT | any (Owner) | n/a | Workout ersetzen | wie POST | message | Nein | 400, 401, 404 | P2 | WorkoutsView.vue | Component+Integration |
| DELETE | `/api/workouts/:id` | JWT | any (Owner) | n/a | Workout löschen | — | message | Nein | 400, 401, 404 | P2 | WorkoutsView.vue | Component+Integration |

## Progress — `backend/routes/progress.js`, mounted at `/api/progress`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/progress` | JWT | any | n/a | Eigene Progress-Einträge (max 150) | — | Array | Nein (hart 150) | 401 | P2 | ProgressView.vue | Component+Integration |
| GET | `/api/progress/summary` | JWT | any | n/a | Aggregierte PRs/1RM pro Übung | — | Array | Nein | 401 | P2 | ProgressView.vue | Component+Integration |
| POST | `/api/progress` | JWT | any | n/a | Manuellen Eintrag anlegen | exercise_id, metrics, entry_date | message, progressId | Nein | 400, 401 | P2 | ProgressView.vue | Component+Integration |
| DELETE | `/api/progress/:id` | JWT | any (Owner) | n/a | Manuellen Eintrag löschen | — | message | Nein | 400, 401, 404, 409 `DERIVED_PROGRESS_IMMUTABLE` | P2 | ProgressView.vue | Component+Integration |

## Training Calendar — `backend/routes/trainingCalendarV1.js`, mounted at `/api/v1` (Stage 5A1 Backend, Stage 5A2 UI — bislang nicht in diesem Katalog erfasst, Stage-5D-Ergänzung)

Bewusst **nicht** studio-scoped: jede Route nutzt ausschliesslich `authenticateToken`, keinen Studio-Tenant-Kontext — der persönliche Kalender ist rein `user_id`-isoliert, exakt wie `/api/workouts`/`/api/progress` (siehe Kommentar in `trainingCalendarV1.js`). Studio-Workout-Termine erscheinen im selben Lesemodell, werden aber über die bestehende Workout-Session-/Assignment-Autorisierung befüllt, nicht über eine eigene Tenant-Prüfung dieser Route.

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/v1/training-calendar` | JWT | any | n/a (`user_id`-isoliert) | Kalenderbereich lesen (persönlich + Studio-Termine vereinheitlicht) | from, to (Query) | entries: [...] | Nein | 400, 401 | P2 | CalendarView.vue | Integration+E2E |
| POST | `/api/v1/training-calendar` | JWT | any | n/a | Persönlichen Kalendereintrag anlegen | title, scheduledDate, ... | calendarEntry{...} | Nein | 400, 401 | P2 | CalendarView.vue | Integration+E2E |
| PATCH | `/api/v1/training-calendar/:entryId` | JWT | any (Owner der Zeile) | n/a | Persönlichen Eintrag bearbeiten | wie POST (Teilmenge) | calendarEntry{...} | Nein | 400, 401, 404, 409 | P2 | CalendarView.vue | Integration+E2E |
| POST | `.../training-calendar/:entryId/reschedule` | JWT | any (Owner der Zeile) | n/a | Persönlichen Eintrag verschieben | scheduledDate | calendarEntry{...} | Nein | 400, 401, 404, 409 | P2 | CalendarView.vue | Integration+E2E |
| POST | `.../training-calendar/:entryId/complete` | JWT | any (Owner der Zeile) | n/a | Eintrag als abgeschlossen bestätigen | — | calendarEntry{...} | Nein | 401, 404, 409 | P2 | CalendarView.vue | Integration+E2E |
| POST | `.../training-calendar/:entryId/skip` | JWT | any (Owner der Zeile) | n/a | Eintrag überspringen | — | calendarEntry{...} | Nein | 401, 404, 409 | P2 | CalendarView.vue | Integration+E2E |
| POST | `.../training-calendar/:entryId/cancel` | JWT | any (Owner der Zeile) | n/a | Eintrag absagen | — | calendarEntry{...} | Nein | 401, 404, 409 | P2 | CalendarView.vue | Integration+E2E |

## Studios — `backend/routes/studioV1.js`, mounted at `/api/v1`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `/api/v1/studios` | JWT | any (wird Owner) | keiner (neu) | Studio erstellen | name, slug, defaultLocale, defaultTimezone, defaultWeightUnit | studio{...,membership} | Nein | 400, 401, 409 `STUDIO_SLUG_TAKEN` | P3 | StudioCreateView.vue | Component+Integration+E2E |
| GET | `/api/v1/studios` | JWT | any | implizit (eigene Mitgliedschaften) | Eigene Studios listen | — | studios: [...] | Nein | 401 | P3 | StudiosView.vue | Integration+E2E |
| POST | `/api/v1/invitations/:token/accept` | JWT | any | token-scoped | Einladung annehmen | — | studio, membership | Nein | 401, 404, 409, 410 | P3 | InvitationAcceptView.vue | Component+Integration+E2E |
| GET | `/api/v1/studios/:studioId` | JWT | owner/admin/trainer/member | Studio-Kontext | Studio lesen | — | studio{...,membership} | Nein | 401, 403, 404 | P3 | StudioDashboardView.vue | Integration+E2E |
| PATCH | `/api/v1/studios/:studioId` | JWT | owner (alle Felder), admin (ohne slug) | Studio-Kontext | Studio-Einstellungen ändern | name, slug, defaultLocale, defaultTimezone, defaultWeightUnit | studio{...} | Nein | 400, 401, 403, 404, 409 | P3 | StudioSettingsView.vue | Component+Integration+E2E |

## Memberships — `backend/routes/studioV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `.../memberships/me` | JWT | alle | Studio-Kontext | Eigene Mitgliedschaft | — | membership{...} | Nein | 401, 403, 404 | P3 | StudioDashboardView.vue | Integration |
| GET | `.../memberships` | JWT | owner/admin/trainer | Studio-Kontext (Trainer nur aktive, reduzierte Felder) | Mitglieder listen | page, limit | memberships, pagination | Ja | 401, 403, 404 | P3 | StudioMembersView.vue, weitere (Auswahllisten) | Component+Integration+E2E |
| PATCH | `.../memberships/:membershipId` | JWT | owner (frei), admin (nur trainer/member-Ziele) | Studio-Kontext | Rolle/Status ändern | role, status | membership{...} | Nein | 400, 401, 403, 404, 409 `LAST_OWNER_REQUIRED` | P3 | StudioMembersView.vue | Component+Integration+E2E |

## Invitations — `backend/routes/studioV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `.../invitations` | JWT | owner (admin/trainer/member), admin (trainer/member) | Studio-Kontext | Einladung erstellen+versenden | email, role | invitation{...}, delivery{...} | Nein | 400, 401, 403, 404, 409, 502, 503 | P3 (E-Mail = PII) | StudioInvitationsView.vue | Component+Integration+E2E |
| GET | `.../invitations` | JWT | owner/admin | Studio-Kontext | Einladungen listen | page, limit | invitations, pagination | Ja | 401, 403, 404 | P3 | StudioInvitationsView.vue | Component+Integration |
| DELETE | `.../invitations/:invitationId` | JWT | owner/admin | Studio-Kontext | Einladung widerrufen | — | invitation{...} | Nein | 401, 403, 404, 409, 410 | P3 | StudioInvitationsView.vue | Component+Integration |

**Seit Stage 2A** ist `delivery{...}` in der POST-Response eine von zwei Formen, abhängig vom serverseitig konfigurierten Provider — nie von einem Client-Parameter steuerbar: ohne konfigurierten Provider (Development/Test-Standard) `{delivered:false, acceptUrl}`; mit konfiguriertem SMTP-Provider (`INVITATION_EMAIL_PROVIDER=smtp`) `{delivered:true}` ohne `acceptUrl`. In Produktion ohne konfigurierten Provider liefert die Route stattdessen `503 INVITATION_DELIVERY_UNAVAILABLE`, bevor irgendetwas persistiert wird. Details: `STAGE_2A_PRODUCTION_INVITATION_EMAIL.md`.

## Audit — `backend/routes/studioV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `.../audit-events` | JWT | owner/admin | Studio-Kontext | Audit-Log lesen | page, limit | auditEvents, pagination | Ja | 401, 403, 404 | P3 | StudioAuditView.vue | Component+Integration |

## Coaching — `backend/routes/trainingProgramV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `.../coaching-relationships` | JWT | owner/admin/trainer | Studio-Kontext (Trainer nur eigene, Owner/Admin ungefiltert) | Beziehungen listen | page, limit | coachingRelationships, pagination | Ja | 401, 403, 404 | P3 | CoachingRelationshipsView.vue | Component+Integration |
| POST | `.../coaching-relationships` | JWT | owner/admin | Studio-Kontext | Beziehung erstellen | coachMembershipId, memberMembershipId | coachingRelationship{...} | Nein | 400, 401, 403, 404, 409 | P3 | CoachingRelationshipsView.vue | Component+Integration |
| PATCH | `.../coaching-relationships/:id` | JWT | owner/admin | Studio-Kontext | Beziehung beenden | status="ended" | coachingRelationship{...} | Nein | 400, 401, 403, 404, 409 | P3 | CoachingRelationshipsView.vue | Component+Integration |
| GET | `.../coaching-relationships/me` | JWT | owner/admin/trainer | Studio-Kontext, **immer `coach_membership_id = actor`, kein Rollen-Bypass** | Eigene Coaching-Beziehungen listen (Stage 1B.2B2B) | page, limit, status (active\|ended, Default active) | coachingRelationships, pagination | Ja | 400, 401, 403, 404 | P3 | CoachResultsView.vue | Unit+Integration+Component+E2E |

## Trainingsprogramme — `backend/routes/trainingProgramV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `.../training-programs` | JWT | owner/admin/trainer | Studio-Kontext | Programme listen | page, limit | trainingPrograms, pagination | Ja | 401, 403, 404 | P3 | TrainingProgramsView.vue | Component+Integration |
| POST | `.../training-programs` | JWT | owner/admin/trainer | Studio-Kontext | Programm erstellen (draft) | name, description | trainingProgram{...} | Nein | 400, 401, 403, 404 | P3 | TrainingProgramsView.vue | Component+Integration+E2E |
| GET | `.../training-programs/:id` | JWT | owner/admin/trainer | Studio-Kontext | Programm lesen | — | trainingProgram{...} | Nein | 401, 403, 404 | P3 | TrainingProgramBuilderView.vue | Component+Integration |
| PATCH | `.../training-programs/:id` | JWT | owner/admin/trainer | Studio-Kontext | Umbenennen/Archivieren | name, description, status="archived" | trainingProgram{...} | Nein | 400, 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration |

## Versionen — `backend/routes/trainingProgramV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `.../versions` | JWT | owner/admin/trainer | Studio-Kontext | Draft-Version erstellen | notes | programVersion{...} | Nein | 400, 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration+E2E |
| GET | `.../versions` | JWT | owner/admin/trainer | Studio-Kontext | Versionen listen | page, limit | programVersions, pagination | Ja | 401, 403, 404 | P3 | TrainingProgramBuilderView.vue | Component+Integration |
| GET | `.../versions/:id` | JWT | owner/admin/trainer | Studio-Kontext | Version mit Tagen/Übungen | — | programVersion{...,days} | Nein | 401, 403, 404 | P3 | TrainingProgramBuilderView.vue | Component+Integration+E2E |
| PATCH | `.../versions/:id` | JWT | owner/admin/trainer | Studio-Kontext | Notizen ändern (nur draft) | notes | programVersion{...} | Nein | 400, 401, 403, 404, 409 `PROGRAM_VERSION_NOT_DRAFT` | P3 | TrainingProgramBuilderView.vue | Component+Integration+E2E |
| POST | `.../versions/:id/publish` | JWT | owner/admin/trainer | Studio-Kontext | Version veröffentlichen | — | programVersion{...,status:'published'} | Nein | 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration+E2E |

## Tage — `backend/routes/trainingProgramV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `.../days` | JWT | owner/admin/trainer | Studio-Kontext | Tag hinzufügen (nur draft) | name, instructions | programDay{...} | Nein | 400, 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration+E2E |
| PATCH | `.../days/:id` | JWT | owner/admin/trainer | Studio-Kontext | Tag ändern/umsortieren | name, instructions, position | programDay{...} | Nein | 400, 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration |
| DELETE | `.../days/:id` | JWT | owner/admin/trainer | Studio-Kontext | Tag löschen (nur draft) | — | { id } | Nein | 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration |

## Übungen (Programmvorgaben) — `backend/routes/trainingProgramV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `.../exercises` | JWT | owner/admin/trainer | Studio-Kontext | Übung zu Tag hinzufügen | exerciseNameSnapshot, targetSets, targetReps*, targetWeight, ... | programExercise{...} | Nein | 400, 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration+E2E |
| PATCH | `.../exercises/:id` | JWT | owner/admin/trainer | Studio-Kontext | Übung ändern/umsortieren | wie POST + position | programExercise{...} | Nein | 400, 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration |
| DELETE | `.../exercises/:id` | JWT | owner/admin/trainer | Studio-Kontext | Übung löschen (nur draft) | — | { id } | Nein | 401, 403, 404, 409 | P3 | TrainingProgramBuilderView.vue | Component+Integration |

## Assignments — `backend/routes/trainingProgramV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `.../program-assignments/me` | JWT | alle | Studio-Kontext | Eigene Zuweisungen | page, limit | programAssignments, pagination | Ja | 401, 403, 404 | P3 | MyTrainingPlanView.vue | Component+Integration+E2E |
| GET | `.../program-assignments/me/:id` | JWT | alle | Studio-Kontext | Eigene Zuweisung im Detail | — | programAssignment{...,days} | Nein | 401, 403, 404 | P3 | MyTrainingPlanView.vue | Component+Integration+E2E |
| GET | `.../program-assignments` | JWT | owner/admin/trainer (Trainer nur eigene Coachees) | Studio-Kontext | Alle Zuweisungen | page, limit | programAssignments, pagination | Ja | 401, 403, 404 | P3 | ProgramAssignmentsView.vue | Component+Integration |
| POST | `.../program-assignments` | JWT | owner/admin (jede Beziehung), trainer (nur eigene) | Studio-Kontext | Version über Coaching-Beziehung zuweisen | programVersionId, memberMembershipId, coachingRelationshipId, startsOn, endsOn | programAssignment{...} | Nein | 400, 401, 403, 404, 409 | P3 | ProgramAssignmentsView.vue | Component+Integration+E2E |
| GET | `.../program-assignments/:id` | JWT | owner/admin/trainer (Coachees) | Studio-Kontext | Zuweisung im Detail (mit Mitglied) | — | programAssignment{...,member} | Nein | 401, 403, 404 | P3 | — (nicht im Frontend verwendet) | Integration |
| PATCH | `.../program-assignments/:id` | JWT | owner/admin/trainer (Coachees) | Studio-Kontext | Abschließen/Abbrechen | status | programAssignment{...} | Nein | 400, 401, 403, 404, 409 | P3 | ProgramAssignmentsView.vue | Component+Integration |

## Assignment Schedule Rules — `backend/routes/assignmentScheduleRuleV1.js` (Stage 5A3 — bislang nicht in diesem Katalog erfasst, Stage-5D-Ergänzung)

Terminierungsregeln für eine Programmzuweisung (welcher Programmtag an welchem Wochentag, ab wann, mit welcher Wiederholung stattfindet) — verdrahtet die in Stage 5A1 bereits bestehende Domänenlogik an eine Owner-/Admin-/Trainer-Oberfläche. `SCHEDULE_RULE_MANAGE` (erstellen/ändern) haben owner/admin/trainer; `SCHEDULE_RULE_READ` (lesen) zusätzlich auch member (`domain/studioPolicy.js`).

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `.../program-assignments/:assignmentId/schedule-rules` | JWT | owner/admin/trainer (`SCHEDULE_RULE_MANAGE`) | Studio-Kontext | Terminierungsregel erstellen | weekday, intervalWeeks, activeFrom, activeUntil? | scheduleRule{...} | Nein | 400, 401, 403, 404, 409 | P3 | ScheduleRulesView.vue | Component+Integration+E2E |
| GET | `.../program-assignments/:assignmentId/schedule-rules` | JWT | owner/admin/trainer/member (`SCHEDULE_RULE_READ`) | Studio-Kontext | Terminierungsregeln listen | — | scheduleRules: [...] | Nein | 401, 403, 404 | P3 | ScheduleRulesView.vue | Component+Integration+E2E |
| PATCH | `.../program-assignments/:assignmentId/schedule-rules/:ruleId` | JWT | owner/admin/trainer (`SCHEDULE_RULE_MANAGE`) | Studio-Kontext | Regel ändern/deaktivieren | wie POST (Teilmenge), status | scheduleRule{...} | Nein | 400, 401, 403, 404, 409 | P3 | ScheduleRulesView.vue | Component+Integration+E2E |

## Workout-Sessions — `backend/routes/workoutSessionV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `.../program-assignments/:id/workout-sessions` | JWT | alle (nur eigene Zuweisung) | Studio-Kontext | Session starten, idempotent | programDayId, clientStartKey | workoutSession{...,exercises} | Nein | 400, 401, 403, 404, 409 | **P4** | MyTrainingPlanView.vue | Unit+Integration+E2E |
| GET | `.../workout-sessions/me` | JWT | alle (nur eigene) | Studio-Kontext | Eigene Sessions listen | page, limit | workoutSessions, pagination | Ja | 401, 403, 404 | **P4** | WorkoutSessionHistoryView.vue, MyTrainingPlanView.vue | Integration+E2E |
| GET | `.../workout-sessions/:id` | JWT | alle (nur eigene) | Studio-Kontext | Eigene Session im Detail | — | workoutSession{...,exercises} | Nein | 401, 403, 404 | **P4** | WorkoutSessionView.vue (über `utils/workoutSessionState.js`) | Integration+E2E |
| PATCH | `.../workout-sessions/:id` | JWT | alle (nur eigene) | Studio-Kontext | Notiz autosave, Revision-Guard | memberNote, expectedRevision | workoutSession{...} | Nein | 400, 401, 403, 404, 409 | **P4** | WorkoutSessionView.vue | Unit+Integration+E2E |
| POST | `.../workout-sessions/:id/complete` | JWT | alle (nur eigene) | Studio-Kontext | Session abschließen | — | workoutSession{...,status:'completed'} | Nein | 401, 403, 404, 409 | **P4** | WorkoutSessionView.vue | Integration+E2E |
| POST | `.../workout-sessions/:id/abort` | JWT | alle (nur eigene) | Studio-Kontext | Session abbrechen | — | workoutSession{...,status:'aborted'} | Nein | 401, 403, 404, 409 | **P4** | WorkoutSessionView.vue | Integration+E2E |

## Session-Exercises — `backend/routes/workoutSessionV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PATCH | `.../exercises/:id` | JWT | alle (nur eigene Session) | Studio-Kontext | Übungsstatus/Notiz, Revision-Guard | status, memberNote, expectedRevision | workoutExercise{...} | Nein | 400, 401, 403, 404, 409 | **P4** | WorkoutSessionView.vue (über `utils/workoutSessionState.js`) | Unit+Integration+E2E |

## Session-Sets — `backend/routes/workoutSessionV1.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| POST | `.../exercises/:id/sets` | JWT | alle (nur eigene Session) | Studio-Kontext | Zusätzlichen Satz anlegen | `{}` (leer) | workoutSet{...} | Nein | 400, 401, 403, 404, 409 | **P4** | WorkoutSessionView.vue (über `utils/workoutSessionState.js`) | Integration+E2E |
| PATCH | `.../exercises/:id/sets/:setId` | JWT | alle (nur eigene Session) | Studio-Kontext | Ist-Werte erfassen, Revision-Guard | status, actualReps, actualWeight, actualDurationMinutes, actualDistanceKm, actualRpe, memberNote, expectedRevision | workoutSet{...} | Nein | 400 (auch `WORKOUT_RESULT_INVALID`), 401, 403, 404, 409 | **P4** | WorkoutSessionView.vue (über `utils/workoutSessionState.js`) | Unit+Integration+E2E |

**Korrektur Stage 5D:** die neun Zeilen oben behaupteten zuvor durchgängig „Kein Frontend-Nutzer" — das war zum Stand PR #7 (vor Stage 1B.2B2A/B) korrekt, ist aber seit `WorkoutSessionView.vue`/`MyTrainingPlanView.vue`/`WorkoutSessionHistoryView.vue` (jeweils über `utils/workoutSessionApi.js` bzw. dessen State-Wrapper `utils/workoutSessionState.js`) falsch — per `grep` gegen den Frontend-Quellcode verifiziert, nicht nur behauptet.

## Coach-Resultatzugriff — `backend/routes/workoutSessionV1.js`

Zugriff erfordert immer: Akteur-Mitgliedschaft aktiv, Rolle owner/admin/trainer, Akteur ist exakt der Coach der Beziehung, Beziehung aktiv, Mitglied-Mitgliedschaft aktiv, **und** (Stage 1B.2B2B) die Session gehört zu genau dieser Coaching-Beziehung (`coaching_relationship_id`-Pinning — eine spätere, andere aktive Beziehung mit demselben Mitglied gewährt keinen Zugriff auf Sessions einer früheren Beziehung). Owner/Admin haben **keinen** automatischen Zugriff; jede Verweigerung liefert identisch 404 `WORKOUT_SESSION_NOT_FOUND`.

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `.../coached-members/:membershipId/workout-sessions` | JWT | owner/admin/trainer **mit eigener aktiver, session-pinnender Coaching-Beziehung, kein Rollen-Bypass** | Studio-Kontext | Sessions eines gecoachten Mitglieds listen, Statusfilter (Stage 1B.2B2B) | page, limit, status (in_progress\|completed\|aborted) | workoutSessions, pagination | Ja | 400, 401, 403, 404 (auch bei fehlender Beziehung) | **P4** | CoachResultsView.vue | Unit+Integration+Component+E2E |
| GET | `.../coached-members/:membershipId/workout-sessions/:id` | JWT | wie oben | Studio-Kontext | Session eines gecoachten Mitglieds im Detail | — | workoutSession{...,member,exercises} | Nein | 401, 403, 404 | **P4** | CoachSessionDetailView.vue | Unit+Integration+Component+E2E |

## Trainings-Feedback — `backend/routes/workoutSessionV1.js` (Stage 1B.2B2B, Migration 008)

Feedback ist **append-only**: keine PATCH-/DELETE-Route existiert. `clientFeedbackKey` (Client-UUID) macht wiederholtes Senden derselben Nutzeraktion idempotent (`UNIQUE(workout_session_id, coach_membership_id, client_feedback_key)`); derselbe Schlüssel mit abweichendem Text liefert `409 WORKOUT_FEEDBACK_KEY_CONFLICT`. Erstellung nur auf terminalen Sessions (`completed`/`aborted`), sonst `409 WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL`.

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Request-Felder | Response | Pagination | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `.../workout-sessions/:sessionId/feedback` | JWT | eigenes Mitglied der Session **oder** aktuell autorisierter, session-pinnender Coach | Studio-Kontext | Feedback einer Session chronologisch listen | page, limit | workoutSessionFeedback, pagination | Ja | 401, 403, 404 | **P4** | CoachSessionDetailView.vue, WorkoutSessionView.vue | Unit+Integration+Component+E2E |
| POST | `.../workout-sessions/:sessionId/feedback` | JWT | ausschließlich aktuell autorisierter, session-pinnender Coach, **kein Owner/Admin-Bypass** | Studio-Kontext | Feedback zu einer terminalen Session erstellen, idempotent | clientFeedbackKey, body (max. 2000 Zeichen) | workoutSessionFeedback{...} | Nein | 400, 401, 403, 404, 409 `WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL`/`WORKOUT_FEEDBACK_KEY_CONFLICT` | **P4** | CoachSessionDetailView.vue | Unit+Integration+Component+E2E |

## Health — inline in `backend/startup/app.js`

| Methode | Pfad | Auth | Rollen | Tenant | Zweck | Response | Fehlercodes | Datenschutz | Frontend | Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/api/health/live` | keine | n/a | n/a | Liveness (immer 200) | status:"live" | keine | P0 | — | Integration |
| GET | `/api/health/ready` | keine | n/a | n/a | Readiness (DB-Ping + Migrationsstatus) | status:"ready" / 503 | 503 | P0 | — | Integration |
| GET | `/api/health` | keine | n/a | n/a | Alias von `/ready` | wie oben | wie oben | P0 | — | Integration |

---

## Zusammenfassung

~~**68 Endpunkte** über 7 Router-Module plus 3 Inline-Health-Routen... Auffälligster Befund: Die komplette **Workout-Session-Gruppe (10 Endpunkte, Datenschutzklasse P4, die sensibelste Datenklasse im System) hat keinen einzigen Frontend-Aufrufer.**~~

**[KORRIGIERT, Stage 5D, 2026-08-19]** Beide Aussagen waren zum Stand PR #7 (2026-07-19) zutreffend und sind es seit Stage 1B.2B2A/B, 5A1 und 5A3 nicht mehr:

- **Dieser Katalog dokumentiert nach den Stage-5D-Ergänzungen 88 Endpunkte** über **11 Router-Module** (`users`, `accountRouter`, `exercises`, `workouts`, `progress`, `trainingCalendarV1`, `studioV1`, `trainingProgramV1`, `assignmentScheduleRuleV1`, `workoutSessionV1`) plus 3 Inline-Health-Routen. Ein grober Quellcode-Abgleich (`grep` über alle `router.<methode>(...)`-Aufrufe in `backend/routes/*.js`) zählt **89** tatsächliche Route-Registrierungen plus die 3 Health-Routen = **92** — die verbleibende kleine Differenz zu den 88 dokumentierten Zeilen wurde in diesem Audit nicht bis zur letzten Zeile aufgelöst (dieses Audit hat gezielt die zwei **vollständig fehlenden** Gruppen ergänzt und die eine bekannte falsche Zeilen-Behauptung korrigiert, aber keinen erschöpfenden Zeile-für-Zeile-Neuabgleich jeder bereits vorher dokumentierten Route durchgeführt).
- Die Workout-Session-Gruppe (10 Endpunkte, weiterhin Datenschutzklasse P4) hat **seit Stage 1B.2B2A** (Member-Ausführungs-UI, PR #9) und **Stage 1B.2B2B** (Coach-Resultat-/Feedback-UI, PR #10) reale Frontend-Aufrufer — `WorkoutSessionView.vue`, `MyTrainingPlanView.vue`, `WorkoutSessionHistoryView.vue`, `CoachResultsView.vue`, `CoachSessionDetailView.vue` — siehe die korrigierten Frontend-Spalten oben.
- **Zusätzlich in diesem Audit ergänzt:** die komplette Training-Calendar-Gruppe (Stage 5A1/5A2, 7 Endpunkte) und die Assignment-Schedule-Rules-Gruppe (Stage 5A3, 3 Endpunkte) fehlten zuvor vollständig in diesem Katalog.

Volle Details und Methodik: `docs/STAGE_5D_CURRENT_STATE_AUDIT.md` Abschnitt 16.
