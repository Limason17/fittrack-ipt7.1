# Stage 1B.2B2B – Coach-Ergebnisansicht und kontrollierter Feedback-Flow

Diese Phase liefert (1) eine schreibgeschützte Coach-Ansicht auf die
Trainingsergebnisse der eigenen, aktuell aktiv gecoachten Mitglieder inkl.
eines kontrollierten, append-only Feedback-Flows, und (2) die vollständige
Entfernung des bestehenden Anwendungs-Footers. Aufbauend auf Stage 1B.2B1
(Backend: Workout-Sessions, Coach-Resultatzugriff) und Stage 1B.2B2A
(Frontend: Mitglieds-Ausführungs-UI). Migration 008 ist additiv; keine
bestehende Tabelle wurde verändert.

## Zugriffsmodell (serverseitig, default-deny)

Coach-Resultatzugriff (Lesen **und** Feedback erstellen) erfordert **alle**
der folgenden Bedingungen, geprüft bei jedem Request neu:

1. Akteur-Mitgliedschaft aktuell `active`.
2. Rolle owner/admin/trainer.
3. Akteur ist **exakt** der Coach der betroffenen Coaching-Beziehung
   (`coach_membership_id = actor.internalId`).
4. Diese Beziehung ist aktuell `active`.
5. Mitglied-Mitgliedschaft aktuell `active`.
6. Alle Ressourcen gehören zum aktuellen Studio.

Owner und Admin haben **keinen** automatischen Ergebniszugriff — sie sehen
nur Ergebnisse, wenn ihre **eigene** Mitgliedschaft der Coach der konkreten
Beziehung ist. Ein Trainer sieht ausschließlich seine eigenen Coaching-
Mitglieder. Jede Zugriffsverweigerung (falsche Rolle, fremde Beziehung,
beendete Beziehung, fremdes Studio, geratene UUID) liefert identisch
`404 WORKOUT_SESSION_NOT_FOUND` — nie unterscheidbar von „existiert nicht"
(Fortführung von ADR 003).

### Neu in dieser Phase: Beziehungs-Pinning (Härtung von Stage 1B.2B1)

Beim Entwurf dieser Phase wurde eine Lücke im **bereits produktiven**
Stage-1B.2B1-Modell identifiziert: `loadCoachRelationshipForRead` prüfte nur
„gibt es *irgendeine* aktuell aktive Beziehung zwischen Akteur und Mitglied",
nicht ob genau **diese** Beziehung auch die Session tatsächlich erzeugt hat.
Ein neuer Coach, der (ggf. nach Ende einer früheren Beziehung) erneut mit
demselben Mitglied verknüpft wird, hätte dadurch automatisch auch auf
Sessions aus der **früheren, fremden** Beziehung zugreifen können.

Behoben durch Pinning auf `workout_session.coaching_relationship_id`:
`listCoachedMemberSessions`, `getCoachedMemberSession`
(`workoutSessionService.js`) sowie beide Zugriffspfade in
`workoutFeedbackService.js` verlangen zusätzlich
`session.coaching_relationship_id === relationship.internalId`. Dedizierter
Integrationstest: „a new coach for the same member gains no automatic access
to a session from the earlier, now-ended relationship" — legt eine neue
Beziehung für dasselbe Mitglied mit einem anderen Coach an und bestätigt
Zugriff `0` auf die alte Session/das alte Feedback.

## Eigene Coaching-Mitglieder — `GET .../coaching-relationships/me`

Die bestehende `GET .../coaching-relationships`-Liste kann Owner/Admin
**alle** Studio-Beziehungen zeigen (Verwaltungszweck) und war daher als
Datenquelle für die Ergebnisansicht ungeeignet. Neuer, minimaler Endpunkt
statt Erweiterung der bestehenden Route (entspricht dem bereits etablierten
Muster `workout-sessions/me`): liefert ausschließlich Beziehungen mit
`coach_membership_id = actor`, optionalem Statusfilter (`active`/`ended`,
Default `active`), begrenzter Pagination, ohne interne IDs, ohne
unnötige E-Mail-Adressen.

## Coach-Session-Liste und -Detail

Nutzt den bestehenden, bereits gehärteten Stage-1B.2B1-Endpunkt
`GET .../coached-members/:membershipId/workout-sessions[/​:id]`, minimal um
einen serverseitigen Statusfilter (`in_progress`/`completed`/`aborted`)
erweitert — Filterung erfolgt **vor** der Pagination, identisch zum in
`listOwnSessions` etablierten Muster. Keine erfundenen Aggregatstatistiken.

`CoachSessionDetailView.vue` verwendet bewusst **kein** Wiederverwenden von
`ExercisePanel.vue`/`SetRow.vue` (dort an das veränderbare Mitglieds-Modell
mit `_save`-Metadaten gekoppelt, die die Coach-Response nicht liefert),
sondern eine dedizierte, einfachere „Ziel vs. Ist"-Nur-Lese-Darstellung.
Vollständig schreibgeschützt: keine Set-/Übungs-/Notiz-Mutation, kein
Abschließen/Abbrechen, keine versteckten Mutations-Controls im DOM
(automatisiert geprüft: kein `<input>`, keine Abschluss-/Abbruch-Buttons).

## Feedback-Datenmodell — Migration 008

Neue additive Tabelle `studio_workout_session_feedback`:
`id, public_id, studio_id, workout_session_id, coaching_relationship_id,
coach_membership_id, author_user_id, client_feedback_key, body (VARCHAR 2000,
CHECK 1–2000 Zeichen), created_at`. Bewusst **kein** `updated_at` — Feedback
ist nach Erstellung unveränderlich, ein „zuletzt geändert"-Feld wäre
irreführend. FKs auf studios/session/relationship/membership
(`ON DELETE CASCADE` — Studio-Löschung hinterlässt keine Waisen) und auf
`users` (`ON DELETE RESTRICT` — ein Autor-User-Datensatz darf nicht
verschwinden, solange sein Feedback noch existiert). Unique-Indizes auf
`public_id` und auf `(workout_session_id, coach_membership_id,
client_feedback_key)` für Idempotenz. Getestet: leer auf neuer DB, No-op auf
bereits angewandter DB, partiell angewandtes Schema wird vom Migration Doctor
erkannt ohne zu mutieren, vollständiger Cascade-Delete-Test bestätigt
`session_feedback: 0` Waisen nach Studio-Löschung. Schema Contract um 25
Prüfungen erweitert (1 Tabelle, 10 Spalten, 8 Indizes, 5 FKs, 1 Check).

### Unveränderlichkeit und Idempotenz

Kein PATCH-, kein DELETE-Endpunkt — bewusst durch Weglassen erzwungen (kein
DB-Trigger, konsistent mit dem Rest des Schemas). Korrekturen erfolgen über
einen neuen Eintrag, nie über Bearbeitung. `clientFeedbackKey`
(`crypto.randomUUID()`, clientseitig pro Sende-Versuch in `sessionStorage`
gehalten, nie im Text selbst) macht Wiederholung derselben Nutzeraktion
idempotent: gleicher Schlüssel + identischer Text → derselbe, bereits
existierende Datensatz wird zurückgegeben (kein Duplikat); gleicher Schlüssel
+ abweichender Text → `409 WORKOUT_FEEDBACK_KEY_CONFLICT`. Ein echter
Race-Zweig (`ER_DUP_ENTRY` bei gleichzeitigem Insert) wird identisch
behandelt. Automatisiert geprüft auf Unit-, Integrations- und
Component-Ebene sowie im E2E-Flow (zwei synchrone Klicks auf denselben
Button erzeugen nachweislich genau einen Eintrag).

## Feedback-Erstellung — Berechtigung

Nur wenn: Session `completed` oder `aborted` (sonst
`409 WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL`); Akteur hat aktuell
Resultatzugriff auf genau diese Session (Beziehungs-Pinning, siehe oben);
Beziehung aktuell aktiv; Akteur ist exakt deren Coach; beide Mitgliedschaften
aktiv; alle Ressourcen im aktuellen Studio. Nach Beziehungsende: der
ehemalige Coach kann weder neues Feedback erstellen noch die Session oder
bestehendes Feedback lesen; das Mitglied behält bereits erhaltenes Feedback
dauerhaft — es wird nicht gelöscht (automatisiert geprüft: E2E-Test
„Beziehungsende entzieht dem Coach sofort den Zugriff; das Mitglied behält
sein Feedback dauerhaft").

### Bewusst nicht implementiert: zusätzliche Fehlercodes

Der Auftrag schlägt u. a. `WORKOUT_FEEDBACK_NOT_ALLOWED` und einen
feedback-spezifischen Not-Found-Code vor. Beide wurden bewusst **nicht**
eingeführt: Die POST-Route blockt Mitglieder bereits über das bestehende
generische `403 INSUFFICIENT_STUDIO_ROLE`, bevor feedback-spezifischer Code
erreicht wird (`WORKOUT_RESULT_READ_COACHED` ist nur owner/admin/trainer
zugeordnet). Owner/Admin ohne konkrete eigene Beziehung kollabiert korrekt
auf den bestehenden, einheitlichen `WorkoutSessionNotFoundError` — identisch
zum bereits etablierten ADR-003-Prinzip „Zugriffsverweigerung nie von
Nicht-Existenz unterscheidbar". Ein separater, unterscheidender Code wäre an
dieser Stelle unerreichbarer toter Code und würde die etablierte
Einheitlichkeit brechen. Neu und tatsächlich erreichbar sind ausschließlich
`WorkoutFeedbackSessionNotTerminalError` (409) und
`WorkoutFeedbackKeyConflictError` (409); ungültige Payload-Form läuft über
den bestehenden generischen `ValidationError`/`VALIDATION_ERROR`.

## Feedback-API

`GET/POST /api/v1/studios/:studioId/workout-sessions/:sessionId/feedback`.
GET: eigenes Mitglied der Session **oder** aktuell autorisierter Coach.
POST: ausschließlich aktuell autorisierter Coach. Payload exakt
`{clientFeedbackKey, body}` (`exactKeys`, unbekannte Felder → 400); Body wird
serverseitig getrimmt, leer/whitespace-only abgelehnt, max. 2000 Zeichen;
Text wird ausschließlich als reiner Text behandelt (kein HTML-Rendering, kein
`v-html`) — sowohl im Backend (keine Auszeichnung gespeichert) als auch im
Frontend (`white-space: pre-wrap`, escapte Textinterpolation). Chronologisch
stabile Sortierung (`ORDER BY created_at ASC, id ASC`), begrenzte Pagination.

## Coach-Navigation und -Views

- Neuer Sidebar-Eintrag „Ergebnisse" (`nav.coachResults`) für
  owner/admin/trainer direkt nach „Zuweisungen", gated durch die bestehende
  `canAccessTrainingManagement`-Berechnung. Mitglieder sehen diesen Eintrag
  nie; „Mein Trainingsplan"/„Meine Trainings" bleiben unverändert für sie
  sichtbar. Navigation ist reine Bedienkomfort-Ebene, nie die
  Autorisierungsgrenze — jede Route bleibt serverseitig unabhängig
  durchgesetzt.
- `/studios/:studioId/coach-results` (`CoachResultsView.vue`):
  Mitgliederauswahl (nur eigene aktive Coaching-Beziehungen,
  Beziehungsbeginn, klarer Leerzustand ohne eigene Beziehungen) → nach
  Auswahl Session-Liste des gewählten Mitglieds mit Statusfilter-Tabs
  (server-seitig gefiltert **vor** Pagination), Link in die Detailansicht.
- `/studios/:studioId/coach-results/:memberMembershipId/sessions/:sessionId`
  (`CoachSessionDetailView.vue`): Metadaten, schreibgeschützte
  Übungen/Sätze mit „Ziel vs. Ist", Mitglied-Notizen auf Session-/Übungs-/
  Satz-Ebene, bestehendes Feedback chronologisch, Feedback-Formular nur bei
  terminaler Session (bei `in_progress`: verständlicher Hinweistext statt
  Formular).

## Mitglieds-Feedback-Anzeige

`WorkoutSessionView.vue` (bestehende Mitglieds-Detailansicht) zeigt unterhalb
der Trainingsergebnisse — nur bei terminaler Session — den Abschnitt
„Feedback deines Trainers" mit chronologischer Liste (Coach-Anzeigename,
Zeitpunkt, reiner Text), Leerzustand falls noch kein Feedback vorliegt. Kein
Antworten-/Bearbeiten-/Löschen-Control im DOM. Feedback bleibt nach
Beziehungsende dauerhaft sichtbar (reiner Lesezugriff über die bestehende,
unveränderte `WORKOUT_SESSION_MANAGE_SELF`-Eigenzugriffsprüfung — unabhängig
vom Coach-Beziehungsstatus).

**Gefundener und behobener Fehler während der Umsetzung:** Der ursprüngliche
`watch(() => session.value?.status, loadMemberFeedback)` in
`WorkoutSessionView.vue` hatte kein `{immediate: true}`. Da Watcher ohne
diese Option nur bei **Änderungen** nach ihrer Erstellung feuern, blieb das
Feedback ungeladen, wenn die Session beim Mount bereits terminal war (kein
asynchroner Statuswechsel danach) — ein echter Produktionsfehler, kein reines
Testartefakt, aufgedeckt durch zwei neue Component-Tests. Behoben durch
`{immediate: true}`.

## Sicherheit, Datenschutz und Audit

- Ausschließlich öffentliche UUIDs im Frontend.
- Studio-Audit erweitert um `workout_feedback.created` mit
  ausschließlich `{feedbackId, sessionId}` (öffentliche IDs) im Allowlist-
  geprüften `details_json` — **niemals** Feedbacktext, Mitglied-Notizen,
  Gewichte, Wiederholungen, RPE, Dauer, Distanz oder Rohkörper des Requests.
- Feedbacktext erscheint nie in normalen Request-/Fehler-Logs, Audit-
  Details, `console.log` oder Frontend-Debug-Logs.
- `clientFeedbackKey` liegt ausschließlich in `sessionStorage`
  (`fittrack_feedback_key:${studioId}:${sessionId}`), nie in `localStorage`,
  nie der Feedbacktext selbst. Bei Netzwerkfehler bleibt der Entwurfstext
  nur im lokalen Component-State sichtbar (nicht persistiert); nach Erfolg
  wird das Formular geleert.
- Studio-/Session-Wechsel setzt Mitgliederliste, Session-Liste,
  Session-Detail und Feedback-Liste synchron zurück, bevor neu geladen wird
  (`watch([...], ..., {immediate:true})`); kein Feedback-Entwurf wird über
  einen Studio-Wechsel hinweg mitgenommen. `403` löscht nie die globale
  Session; `404` deckt nie auf, ob eine fremde Session existiert.
- Feedback ist als personenbezogene, sensible Trainingskommunikation
  klassifiziert (Datenschutzklasse P4, siehe `FITTRACK_API_CATALOG.md`) und
  Teil regulärer Backups (additive Tabelle, keine Sonderbehandlung in
  `BACKUP_RESTORE.md` nötig).

## Footer-Entfernung

Der bisherige `<footer class="site-footer">` in `App.vue` wurde vollständig
entfernt (nicht nur `display:none`, kein leeres `<footer>`-Element, kein
Ersatz-Footer, keine künstliche `min-height`). Das Grid-Layout wurde von
einem 3-Zeilen- (Header/Main/Footer) auf ein 2-Zeilen-Layout
(Header/Main) umgestellt, in der Basisregel, der `.app-shell-no-sidebar`-
Variante und der Mobile-`@media`-Regel. Zugehörige CSS-Klassen
(`.site-footer`, `.site-footer-inner`, `.site-footer-meta`, `.site-footer a`
inkl. Mobile-Overrides) sowie der komplette i18n-Namespace `footer.*`
(Deutsch und Englisch) wurden entfernt. Kein Footer-Inhalt war die einzige
Erreichbarkeit einer Route oder Funktion — keine Routen mussten deshalb
angepasst werden. Kein neuer permanenter Bottom-Nav-Ersatz.

Verifiziert: `App.test.js` (neu, 3 Tests: kein `<footer>`, kein
Footer-Text im eingeloggten und ausgeloggten Zustand); E2E-Test „Footer
erscheint auf keiner Route und hinterlässt keinen Leerraum oder horizontalen
Overflow bei allen Breakpoints" prüft `footer`-Elementanzahl `0` sowie
`document.documentElement.scrollWidth <= clientWidth` auf Login, persönlichem
Workouts-Bereich, Coach-Ergebnisübersicht, Coach-Session-Detail und
Mitglieds-Session-Detail bei 1440/1024/768/390 px; manuelle Sichtprüfung
(Screenshots, nicht committed) bestätigt zusätzlich, dass die Seite nach dem
letzten Inhaltsblock natürlich endet, ohne künstlichen Leerraum.

## Bekannte Einschränkungen

- Feedback ist rein textuell (kein Markdown/Rich-Text, kein Anhang).
- Kein Antworten/Threads/Reaktionen/Push-/E-Mail-Benachrichtigungen — bewusst
  außerhalb des Auftragsumfangs.
- Der aus früheren Phasen bekannte, dokumentierte kosmetische
  Datum/Zeitzonen-Anzeigefehler in der Zuweisungs-API besteht unverändert
  fort (außerhalb dieses Auftragsumfangs).

## Klare Grenze zu späteren Phasen

Nicht enthalten und nicht begonnen: Mitglieds-Antworten auf Feedback, Chat,
Feedback-Threads, Bearbeiten/Löschen von Feedback, Reaktionen/Likes,
Push-/E-Mail-Benachrichtigungen, Coach-Bewertungen, KI-generiertes Feedback,
automatische Trainingsanpassung, Analytics-Dashboard, Churn-Risk,
Körpergewicht, Fortschrittsfotos, Check-ins, Termine, Zahlungen, Verträge,
Community, Challenges, Wearables, native Apps, Offline-Modus, PWA, White
Label, Microservices, Kubernetes. Eine spätere Phase beginnt auf Basis dieser
Oberfläche mit neuer, expliziter Freigabe.

## Tests

- **Backend:** 294 grüne Tests gesamt (177 Unit, 88 Integration, 29
  Migration/Doctor), inkl. `workoutFeedbackValidation.test.js` (6),
  `workoutFeedbackApi.test.js` (27, u. a. Beziehungs-Pinning-Härtung, Owner/
  Admin-Privacy-Grenze, Idempotenz, Konflikt, Beziehungsende, Studio-B-
  Isolation), erweiterten Migration-/Doctor-/Schema-Contract-Tests sowie
  Policy-/Audit-/Validierungs-Unit-Tests. `npm run test:syntax` grün (123
  Dateien).
- **Frontend:** 276 grüne Tests über 36 Dateien (u. a.
  `CoachResultsView.test.js`, `CoachSessionDetailView.test.js`,
  `FeedbackForm.test.js`, `FeedbackList.test.js`,
  `coachFeedbackState.test.js`, erweiterte `WorkoutSessionView.test.js` und
  `AppSidebar.test.js`, neue `App.test.js`).
- **E2E (Chromium, `frontend/e2e/coachFeedback.spec.js`):** 7 serielle
  Szenarien — Trainer sieht nur eigenes Mitglied/filtert/öffnet
  Read-Only-Detail mit Zielwerten und Notizen; Feedback auf laufender Session
  unmöglich, auf abgeschlossener erstellbar, Mehrfachklick erzeugt keinen
  Doppeleintrag, Mitglied sieht Feedback ohne Antwortmöglichkeit; Trainer B
  und Owner ohne eigene Beziehung sehen die Session nicht, Owner mit eigener
  Beziehung sieht seine eigene; Beziehungsende entzieht sofort den
  Coach-Zugriff, Mitglied behält Feedback dauerhaft; fremdes Studio bleibt
  isoliert, persönliche Workouts funktionieren unverändert; Footer auf keiner
  Route, kein horizontaler Overflow bei allen vier Breakpoints; Axe-Smokes
  auf Coach-Ergebnisübersicht, Coach-Session-Detail, Mitglieds-Session mit
  Feedback, Login, App-Shell — keine „serious"/„critical" Befunde.
- **Weitere Regressionsgates:** Produktionsbuild (`vite build`) erfolgreich;
  `npm audit --audit-level=high` ohne Befunde in Backend und Frontend;
  `git diff --check` ohne Whitespace-Fehler.
