# Stage 1B.2B2A – Member-Workout-Ausführung und Session-Historie

Diese Phase liefert eine Benutzeroberfläche für die in Stage 1B.2B1
geschaffenen Backend-Fähigkeiten (Studio-Workout-Sessions: starten,
Sätze/Übungen protokollieren, abschließen, abbrechen, eigene Historie lesen).
Es wird **keine** neue Migration, **keine** neue Tabelle und **keine**
Coach-Ergebnisansicht eingeführt; die UI verwendet ausschließlich den
bestehenden Stage-1B.2B1-API-Vertrag zuzüglich einer einzigen minimalen
Lese-Ergänzung (siehe „API-Abhängigkeiten und Backend-Ergänzung"). Persönliche
Workouts (`workouts`/`workout_exercises`/`progress_entries`) bleiben davon
vollständig unberührt.

## Seiten und Routen

| Route | Name | Komponente | Sichtbar für |
| --- | --- | --- | --- |
| `/studios/:studioId/my-training-plan` | `studio-my-training-plan` | `MyTrainingPlanView.vue` (erweitert) | jedes aktive Studio-Mitglied |
| `/studios/:studioId/workout-sessions` | `studio-workout-sessions` | `WorkoutSessionHistoryView.vue` | jedes aktive Studio-Mitglied |
| `/studios/:studioId/workout-sessions/:sessionId` | `studio-workout-session-detail` | `WorkoutSessionView.vue` | jedes aktive Studio-Mitglied |

Die Navigation (`AppSidebar.vue`) blendet „Meine Trainings" nur für die Rolle
`member` (`isStudioMemberRole`) direkt nach „Mein Trainingsplan" ein. Das ist
ausschließlich Bedienkomfort: Jede Route bleibt auch ohne Sidebar-Eintrag über
die URL erreichbar, und jede Aktion wird serverseitig über die bestehende
Stage-1B.2B1-Permission `WORKOUT_SESSION_MANAGE_SELF` sowie strikte
`member_membership_id = actor`-Filterung durchgesetzt. Es gibt in dieser Phase
bewusst **keine** Coach-Ergebnisnavigation.

## Ein vereinheitlichter View für Ausführung und Nachbetrachtung

`WorkoutSessionView.vue` bedient sowohl den aktiven, veränderbaren Zustand
(`status === 'in_progress'`) als auch den schreibgeschützten Endzustand
(`completed`/`aborted`) – bewusst **ein** Component statt zwei getrennter
Views. Grund: Der Backend-Vertrag selbst liefert für beide Zustände denselben
Endpunkt (`GET .../workout-sessions/:sessionId`) mit identischer Struktur;
zwei separate Views hätten denselben Rendering-Code dupliziert und wären bei
Statuswechseln (Abschluss/Abbruch während des Betrachtens) inkonsistent
geworden. Steuerung erfolgt über `isMutable()`: Terminal-Sessions verlieren
sämtliche Mutations-Controls (nicht nur `disabled`, sondern aus dem
interaktiven Baum entfernt bzw. per `<fieldset disabled>` strukturell
gesperrt) und zeigen einen Hinweistext.

## Idempotenter Sessionstart

„Training starten" in `MyTrainingPlanView.vue` ruft `startWorkoutSession()`
aus `workoutSessionState.js` auf:

- Ein `clientStartKey` (`crypto.randomUUID()`) wird pro `studioId:assignmentId:programDayId`-Tripel
  in `sessionStorage` gehalten (**nie** `localStorage`) und bei
  Wiederholung desselben Klicks wiederverwendet, bis der Start erfolgreich
  war – dann wird der Schlüssel entfernt. Bei Fehlern bleibt er erhalten,
  damit ein Retry denselben Schlüssel sendet statt eine neue Session
  anzustoßen.
- Ein modul-globales `startsInFlight`-Dictionary dedupliziert echte
  Doppelklicks: Ein zweiter Aufruf für dasselbe Tripel während ein Request
  bereits läuft erhält dasselbe Promise, keinen zweiten Request.
- Antwortet das Backend mit `WORKOUT_START_KEY_CONFLICT` (derselbe Schlüssel
  wurde für eine andere Zuweisung/einen anderen Tag verwendet), wird das
  verständlich angezeigt statt eine Session zu erraten.
- Existiert für das Tripel bereits eine laufende Session, navigiert der Start
  direkt zu dieser (serverseitiges Verhalten, kein Duplikat).

Die deterministische, benutzersichtbare Seite dieser Garantie – ein zweiter
Startversuch für denselben Tag konvergiert auf dieselbe Session – ist Teil des
E2E-Tests; die feingranulare Race-/Dedup-Logik ist in
`workoutSessionState.test.js` auf Unit-Ebene abgedeckt.

### „Fortsetzen" statt „Starten"

`MyTrainingPlanView.vue` lädt zusätzlich zu den Zuweisungen einmalig
`listOwnWorkoutSessions(studioId, {page: 1, limit: 100})` und baut daraus eine
`${assignmentId}:${programDayId}` → Session-ID-Zuordnung ausschließlich für
Sessions mit `status === 'in_progress'`. Gibt es einen Treffer, zeigt der Tag
„Fortsetzen" statt „Training starten". Das ist **best-effort**, kein
garantierter Lookup: Der Sessions-Endpunkt kennt keinen Statusfilter und keine
direkte „gibt es eine Session für genau diese Zuweisung+diesen Tag"-Abfrage,
daher der begrenzte, nach Aktualität sortierte Scan (siehe „bekannte
Einschränkungen"). `dayAvailability()` spiegelt zusätzlich die
Backend-Regeln aus `canStartWorkoutSession` (aktive Zuweisung, Datum
innerhalb `[startsOn, endsOn]`) rein clientseitig, um verständliche
Begründungstexte zu zeigen – das Backend bleibt in jedem Fall die einzige
Autorität, jede Anfrage wird dort unabhängig erneut geprüft.

## Zustandsschicht (`workoutSessionState.js`)

Zentrales Composable `useWorkoutSession()` kapselt Laden, Mutieren,
Warteschlange und Konfliktbehandlung, damit keine View direkte `fetch`-Logik
enthält:

- **Revisionsmodell:** Jede Session, jede Übung und jeder Satz trägt eine
  serverseitige `revision`. Jede Mutation sendet `expectedRevision`; eine
  erfolgreiche Antwort ersetzt Daten **und** Revision vollständig. Es wird nie
  eine Revision geraten und nie „last write wins" angewendet.
- **Pro-Ressource-Mutationswarteschlange:** `createMutationQueue()` verwaltet
  je Ressource (`session`, `exercise:<id>`, `set:<id>`) höchstens eine
  aktive Anfrage. Trifft während einer laufenden Anfrage eine neue lokale
  Änderung ein, wird sie in `pendingPatch` gemerged statt einen parallelen
  Request auszulösen; nach Antwort wird verglichen, ob zwischenzeitlich eine
  neuere Änderung eingetroffen ist – falls ja, wird nur die `revision`
  übernommen (nie veraltete Feldwerte), und der nächste, aktuellere Patch wird
  gesendet. Eine bereits vom Server bestätigte Antwort wird dadurch nie durch
  eine spätere, aber aus einer älteren Anfrage stammende Antwort überschrieben.
- **Konfliktsperre:** Bei `409` (`WORKOUT_SESSION_CONFLICT` /
  `WORKOUT_EXERCISE_CONFLICT` / `WORKOUT_SET_CONFLICT`) wird die betroffene
  Ressource als `blocked` markiert – weitere automatische Sendeversuche für
  genau diese Ressource werden angehalten, bis der Nutzer explizit „Aktuellen
  Stand laden" auslöst (`reloadSession()`, setzt die Warteschlange vollständig
  zurück). Der lokale Eingabewert bleibt dabei sichtbar erhalten, wird nie
  automatisch verworfen oder überschrieben.

### Speichermodell: explizites Speichern statt vollständigem Autosave

Der Auftrag erlaubt explizites Speichern anstelle von Autosave, „wenn es
angesichts des tatsächlichen API-Vertrags objektiv sicherer oder klarer ist" –
diese Option wurde bewusst gewählt und wird hier dokumentiert: Jedes
Zahlen-/Text-/Notizfeld in `SetRow.vue`/`ExercisePanel.vue` speichert bei
`blur` bzw. `Enter` (nicht bei jedem Tastendruck). Begründung: Der
Backend-Vertrag verlangt bei jeder PATCH-Anfrage sowohl `expectedRevision` als
auch mindestens ein Inhaltsfeld – tastaturereignisgetriebenes Autosave hätte
pro Zeichen eine revisionsfragile Anfrage erzeugt und die
Konfliktwahrscheinlichkeit unnötig erhöht. Der Sichtbarkeitszustand
(`SaveStatusIndicator.vue`, `role="status" aria-live="polite"`) zeigt
`idle`/`dirty`/`saving`/`saved`/`error`/`conflict` und ist automatisiert
getestet (`workoutSessionState.test.js`, `WorkoutSessionView.test.js`).

## Statusübergänge und Vollständigkeitsprüfung

Set- und Übungsstatus (`pending`/`completed`/`skipped`) werden immer als
Text **und** Badge dargestellt, nie ausschließlich über Farbe. Ein Satz kann
clientseitig nur dann auf `completed` gesetzt werden, wenn mindestens ein
Ist-Wert vorhanden ist (`hasAnyResultMetric()`, exakt gespiegelt aus
`workoutSessionDomain.js` inklusive „0 zählt als vorhanden"); das Backend
prüft dieselbe Regel erneut und bleibt autoritativ. Eine übersprungene Übung
mit bereits abgeschlossenen Sätzen zeigt einen Warnhinweis, statt die
Inkonsistenz stillschweigend zu übernehmen. Ungültige Backend-Übergänge (z. B.
Mutation auf einer bereits terminalen Session) laden den aktuellen Zustand neu
und zeigen die verständliche Fehlermeldung.

### Abschluss

„Session abschließen" ist nur aktiv, wenn die Session `in_progress` ist **und**
keine unerledigten Speichervorgänge/Konflikte offen sind
(`hasUnsettledWork()`). Ein Bestätigungsdialog geht jedem Abschluss voraus.
Antwortet das Backend mit `WORKOUT_SESSION_INCOMPLETE`, wird der Dialog
geschlossen, eine verständliche Zusammenfassung angezeigt, und die Ansicht
scrollt automatisch zur ersten offenen Übung bzw. zum ersten offenen Satz
(`firstIncompleteLocation()`, spiegelt exakt die Backend-Scan-Reihenfolge) und
setzt den Fokus dorthin – **keine** automatische Selbstvervollständigung.
Nach erfolgreichem Abschluss wird die Session vollständig schreibgeschützt,
zeigt Status, Abschlusszeitpunkt und eine Erfolgsbestätigung; die Historie
wird beim nächsten Aufruf neu geladen.

### Abbruch

„Session abbrechen" zeigt einen Bestätigungsdialog mit Konsequenztext
(bereits gespeicherte Werte bleiben erhalten, die Session wird
schreibgeschützt, das Training kann nicht fortgesetzt werden). Nach
erfolgreichem Abbruch: Status `aborted`, keine Eingabe-/Mutations-Controls
mehr, gespeicherte Ergebnisse bleiben sichtbar.

## Historie

`WorkoutSessionHistoryView.vue` zeigt ausschließlich eigene Sessions
(`GET .../workout-sessions/me`, serverseitig auf `member_membership_id =
actor` gefiltert) mit Datum, Programm, Trainingstag, Status,
Start-/Abschluss-/Abbruchzeitpunkt und einem Link in die schreibgeschützte
Detailansicht. Lade-, Leer- und Fehlerzustand vorhanden; Pagination folgt dem
bestehenden `Pagination.vue`-Muster. Der Status-Filter (Tabs) wirkt
**ausschließlich auf die aktuell geladene Seite** – identisch zum bereits in
`ProgramAssignmentsView.vue` etablierten Präzedenzfall aus Stage 1B.2A, da der
Sessions-Endpunkt keinen serverseitigen Statusfilter kennt. Ein Hinweistext
macht das transparent. Es werden keine erfundenen Kennzahlen (z. B.
Erfolgsquoten) angezeigt.

## Validierung

`workoutSessionLimits.js` bildet die Backend-Grenzen exakt nach (Wiederholungen,
Gewicht, Dauer, Distanz, RPE-Bereich, Notizlänge) und verhindert `NaN`,
`Infinity`, negative Werte sowie das Senden leerer Strings als Zahl oder
unbekannter Felder. Fehlermeldungen erscheinen feldnah und verständlich
(`studios.workoutSessions.validation.*`). Die Backend-Validierung bleibt in
jedem Fall die eigentliche Autorität.

## Sicherheit und Datenschutz

- Ausschließlich öffentliche UUIDs im Frontend; keine internen numerischen IDs.
- Keine Ergebniswerte in `console.log`, kein Logging von Request-/Response-Bodies.
- Keine dauerhafte Speicherung von Ergebnisdaten in `localStorage`; ein
  `clientStartKey` liegt ausschließlich temporär in `sessionStorage` und wird
  nach erfolgreichem Start entfernt.
- Fremde Session-URLs liefern `404 WORKOUT_SESSION_NOT_FOUND` ohne
  Existenzoffenlegung (identische Fehlermeldung wie „nicht gefunden"), `403`
  löscht die globale Session nicht, nur `401` löst (bestehendes
  `apiRequest`-Muster) einen Logout aus.
- Ein Studio-/Session-Wechsel (Routenparameterwechsel) setzt den lokalen
  Session-State synchron zurück, bevor neu geladen wird
  (`watch([studioId, sessionId], ...)`), sodass Komponenten nie kurzzeitig
  fremde Daten weiterzeigen; `onUnmounted(reset)` räumt beim Verlassen der
  Ansicht vollständig auf.
- Diese Oberfläche gewährt Owner/Admin/Trainer **keinen** neuen Zugriff auf
  Mitglieder-Ergebnisse; alle neuen Routen sind ausschließlich
  `WORKOUT_SESSION_MANAGE_SELF` (Eigenzugriff).

## API-Abhängigkeiten und Backend-Ergänzung

`frontend/src/utils/workoutSessionApi.js` bildet den vollständigen
Stage-1B.2B1-Vertrag ab und wurde **nicht erweitert** – der bestehende Vertrag
deckt sämtliche Anforderungen dieser Phase ab.

**Eine minimale, objektiv erforderliche Backend-Ergänzung:**
`workoutSessionService.js`s `publicSession()` gab die zugehörige
Zuweisungs-ID nicht zurück, obwohl `sessionFromRow()` sie bereits per SQL-Join
lädt. Ohne dieses Feld kann das Frontend „gibt es für diese konkrete Zuweisung
+ diesen Tag bereits eine laufende Session" nicht zuverlässig unterscheiden,
wenn ein Mitglied mehrere Zuweisungen desselben Programms/Tages hat (ein vom
Schema explizit unterstütztes, testbelegtes Szenario). Ergänzt wurde daher ein
einzelnes Feld:

```js
assignmentId: session.assignmentPublicId,
```

Keine neue Migration, keine neue Tabelle, keine erweiterte Permission,
einzeiliger Diff. Automatisiert getestet (4 neue Assertions in
`workoutSessionApi.test.js`); alle 22 Integrationstests dieser Datei grün.

## Tests

- **Unit:** `workoutSessionLimits.test.js`, `workoutSessionStartKeys.test.js`,
  `workoutSessionErrors.test.js`, `workoutSessionState.test.js` (23 Szenarien,
  u. a. Start-Dedup, Revisionsmodell inkl. „späte Antwort überschreibt nie
  neuere lokale Eingabe", Konfliktsperre, Abschluss-/Abbruch-Übergänge,
  `firstIncompleteLocation`, Reset bei Workspace-Wechsel).
- **Komponenten:** `WorkoutSessionView.test.js` (16 Szenarien: Laden, Zielwerte,
  Feldsichtbarkeit, Bearbeiten, Client-Guard gegen leere Abschlüsse, Satz
  hinzufügen, terminale Session sperrt Controls strukturell, Abbruch bewahrt
  Werte, blockierter Abschluss bei offenen Saves, Abschluss-/Abbruch-Dialoge,
  Unvollständig-Highlight, Konfliktbanner mit Reload-Aktion, Reset beim
  Unmount), `WorkoutSessionHistoryView.test.js` (10 Szenarien: Laden,
  Ladezustand, Zeilen-Rendering, Fortsetzen- vs. Detail-Link, „—" ohne
  Abschlusszeit, Leerzustand, Fehlerzustand, seitenscoped Filter, Pagination,
  Reset bei Studio-Wechsel), plus angepasste `AppSidebar.test.js` und
  `MyTrainingPlanView.test.js` für die neue Navigation/Start-/Fortsetzen-Logik.
  Insgesamt 224 grüne Frontend-Unit-/Komponententests.
- **E2E (Chromium):** `frontend/e2e/workoutSessions.spec.js` deckt den
  vollständigen Mitgliedsfluss in einem seriellen Szenario ab: Plan öffnen,
  gültigen Tag starten, zweiter Startversuch konvergiert auf dieselbe Session
  (Idempotenz-Garantie), Snapshot inkl. Zielwerten sichtbar, vorbefüllte
  (leere) Sätze, unvollständiger Abschluss wird abgelehnt und hebt die offene
  Übung hervor, Wiederholungen/Gewicht speichern, Satz hinzufügen, Satz und
  Übung abschließen, vollständiger Abschluss, abgeschlossene Session
  schreibgeschützt, aus der Historie geöffnet, zweite Session gestartet und
  abgebrochen (bereits gespeicherte Werte bleiben erhalten), fremdes Mitglied
  erhält `404` ohne Existenzoffenlegung, echter `409`-Konflikt über zwei
  Browser-Tabs desselben Mitglieds wird verständlich angezeigt und über
  „Aktuellen Stand laden" aufgelöst, persönliche Workouts bleiben unverändert
  funktionsfähig, Axe-Smoke auf allen drei neuen Ansichten. Negativfälle laufen
  über eigene, unabhängige Browserkontexte (fremdes Mitglied, zwei parallele
  Tabs). Alle 13 Chromium-E2E-Spezifikationen der Suite (inkl. bestehender
  Axe-/Studio-/Training-Specs) sind grün.
- **Backend:** Keine neuen Backend-Tests über die 4 ergänzten Assertions
  hinaus nötig; alle 22 `workoutSessionApi`-Integrationstests grün. Die volle
  Backend-Suite und die Migration-/Doctor-Gates wurden nicht erneut
  ausgeführt, da außer der einzeiligen `publicSession()`-Ergänzung kein
  Backend- oder Migrationscode verändert wurde.
- **Weitere Regressionsgates:** vollständige Frontend-Unit-/Komponentensuite
  grün, Produktionsbuild (`vite build`) erfolgreich, `npm audit
  --audit-level=high` ohne Befunde in Frontend und Backend.

## Accessibility

- Gruppierte Satzwerte stehen in einem `<fieldset>` mit `<legend
  class="visually-hidden">`; jedes Eingabefeld trägt eine `<label for>`-Bindung.
- Terminale Sessions sperren Eingaben strukturell über
  `<fieldset :disabled="!mutable">`, nicht nur visuell.
- Status wird nie ausschließlich über Farbe vermittelt (Text + `Badge` in
  jedem Fall).
- Speicherstatus, Fehler und Konflikte laufen über `role="status"`/`role="alert"`
  mit `aria-live="polite"`/`"assertive"`.
- Bestätigungsdialoge (Abschluss, Abbruch) nutzen das bestehende
  `ConfirmDialog`/`Modal`-Fokus-Management (Fokus-Falle, Escape schließt,
  Fokus kehrt zurück).
- Nach `WORKOUT_SESSION_INCOMPLETE` wird der Fokus programmatisch auf die
  erste offene Übung/den ersten offenen Satz gesetzt
  (`scrollIntoView` + `.focus()` auf ein `tabindex="-1"`-Element).
- Automatisiert geprüft: `frontend/e2e/accessibility.spec.js` bleibt
  unverändert grün; `workoutSessions.spec.js` läuft zusätzlich Axe gegen Plan-,
  Ausführungs- und Historienansicht ohne „serious"/„critical" Verstöße.

## Responsives Verhalten

Geprüft bei 1440, 1024, 768 und 390 px: automatisiert über horizontale
Overflow-Prüfungen im E2E-Flow sowie durch echte, visuell inspizierte
Screenshots aller drei neuen Ansichten (inkl. eines absichtlich
überdurchschnittlich langen Programm-/Tag-/Übungsnamens) an allen vier
Breakpoints. Mobile-first: Satzfelder stehen in einem
`repeat(auto-fit, minmax(110px, 1fr))`-Grid, das unterhalb 480 px auf zwei
Spalten mit mindestens 44×44 px großen Status-Buttons wechselt; lange
Übungs-/Tagesnamen brechen über `overflow-wrap: anywhere`; die Historie nutzt
das bestehende `table-stack`-Muster (Karten unterhalb des Tabellen-Breakpoints);
Dialoge sind über das bestehende `Modal.vue` (`max-height: calc(100dvh - 2rem)`,
`overflow-y: auto`) für kleine Viewports ausgelegt; es gibt keine sticky
Elemente, die Inhalte verdecken könnten – das Speichermodell ist bewusst
explizit statt tastatur-getrieben, daher besteht auch keine Kollision mit der
mobilen Bildschirmtastatur.

## Bekannte Einschränkungen

- Die „Fortsetzen"-Erkennung in `MyTrainingPlanView.vue` ist ein
  best-effort-Scan der letzten 100 eigenen Sessions, kein garantierter
  Lookup (kein Backend-Query-Parameter für „Session zu Zuweisung+Tag"
  existiert; eine Ergänzung wäre für dieses rein darstellerische Bedürfnis
  unverhältnismäßig gewesen).
- Der Status-Filter in der Historie wirkt nur auf die aktuell geladene Seite
  (identischer, bereits etablierter Präzedenzfall wie in
  `ProgramAssignmentsView.vue`).
- ~~Der aus Stage 1B.1/1B.2B1 bekannte, dokumentierte kosmetische
  Datum/Zeitzonen-Anzeigefehler bei `DATE_FORMAT`-Vergleichen in der
  Zuweisungs-API besteht unverändert fort und wurde in dieser Phase nicht
  behoben (außerhalb des Auftragsumfangs).~~ **Nachtrag (2026-07-20):** Dieser
  Punkt war zum Zeitpunkt der Erstdokumentation zutreffend, ist aber
  inzwischen überholt. Der direkte Folgecommit `08310cf` ("Stabilize member
  workout continuation and date handling") hat den gemeinsam genutzten
  `ASSIGNMENT_SELECT` in `programAssignmentService.js` auf
  `DATE_FORMAT(starts_on, '%Y-%m-%d')`/`DATE_FORMAT(ends_on, '%Y-%m-%d')`
  umgestellt. Verifiziert im Zuge der Stage-1B.2B2B-Release-Gate-Prüfung: Alle
  sechs Zuweisungs-Endpunkte (create/list/get/update/listOwn/getOwnDetail)
  nutzen denselben Query- und Mapper-Pfad und liefern `startsOn`/`endsOn`
  ausschließlich als `null` oder exaktes `YYYY-MM-DD`, nie mit Zeit- oder
  Zeitzonenanteil — bestätigt durch den bestehenden, weiterhin grünen
  Regressionstest „startsOn/endsOn are returned as plain calendar dates,
  never a timestamp or timezone-shifted value" in
  `backend/test/integration/workoutSessionApi.test.js`.

## Klare Grenze zu Stage 1B.2B2B

Nicht enthalten und nicht begonnen: Coach-Ergebnisansicht/-liste,
Kommentare/Feedback-Threads, Trainer-Bewertungen, Timer/Rest-Timer,
Offline-Modus/PWA/Push, Check-ins, Körpergewicht/Fotos, Analytics/Churn-Risk,
Buchungen/Zahlungen/Verträge, Community/Challenges sowie alle weiteren im
Auftrag ausgeschlossenen Themen. Stage 1B.2B2B beginnt auf Basis dieser
Oberfläche mit neuer, expliziter Freigabe.
