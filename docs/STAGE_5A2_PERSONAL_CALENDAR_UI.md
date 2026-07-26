# Stage 5A2: Personal Calendar UI — gemeinsamer Trainingskalender für persönliche und Studio-Workouts

Geprüfter Ausgangs-Commit: `3413261` (main, PR #21 "Merge... feature/stage-5a1-unified-calendar-backend"), Branch `feature/stage-5a2-personal-calendar-ui`. Diese Phase liefert die persönliche Kalender-Oberfläche auf Basis des in Stage 5A1 gebauten Backends: eine einzige Ansicht, in der ein Member persönliche geplante Trainings, persönliche abgeschlossene Workouts, vom Coach geplante Studio-Trainings, laufende und abgeschlossene Studio-Workouts, überfällige unbestätigte Trainings, übersprungene und abgesagte Trainings sieht — ohne zwischen persönlichem Bereich und Studio-Bereich wechseln zu müssen. **Es gibt in dieser Phase keine Coach-Planungsoberfläche** (Stage 5A3, bewusst nicht begonnen) und **keine Migration 013**.

---

## 1. Backend-Vertrag verifiziert — und zwei echte Lücken gefunden und behoben

Vor der Implementierung wurde der tatsächliche Stage-5A1-API-Vertrag direkt am Code verifiziert (Routen, Response-Mapper, Fehlerklassen), nicht nur anhand der Dokumentation. Dabei wurden zwei reproduzierbare, echte Vertragslücken gefunden, die die geforderte Oberfläche ohne Behebung unmöglich gemacht hätten (Abschnitt 29 des Auftrags erlaubt und verlangt genau das):

### 1.1 `revision` fehlte in jeder Antwort

Jeder Mutationsendpunkt verlangt `expectedRevision` im Request-Body, aber **keine** Antwort — weder die Kalenderliste noch eine Mutationsantwort — gab den aktuellen `revision`-Wert je zurück. Ein echter HTTP-Client hatte keine Möglichkeit, ihn zu erfahren; Stage 5A1s eigene Integrationstests umgingen das nur durch direkte Datenbankabfragen, was für die Oberfläche keine Option ist. Behoben durch Ergänzen von `e.revision` in beiden SQL-Abfragen (`getCalendar`, `loadEntryDetail`) und `revision` im `publicCalendarEntry`-Rückgabeobjekt (`null` für die synthetisierten Legacy-Workout-Zeilen, die keine echte Kalenderzeile sind). Keine Migration nötig (Spalte existierte bereits). Zwei neue Integrationstests beweisen den vollständigen Round-Trip ausschließlich über die API (nie eine direkte SQL-Abfrage).

### 1.2 `assignmentId` fehlte für Studio-Einträge

Die `START`-Aktion wird für Studio-Einträge über `availableActions` angeboten, aber das Starten einer Session verlangt die Zuweisungs-`public_id` in der URL (`POST /v1/studios/:studioId/program-assignments/:assignmentId/workout-sessions`) — ein Wert, den die Kalenderantwort nie lieferte, obwohl `studio_program_assignments` bereits für Programm-/Tagesdaten gejoint wurde. Behoben durch Ergänzen von `pa.public_id AS assignment_public_id` und `assignmentId` im Rückgabeobjekt (`null` für persönliche/Legacy-Einträge). Ein neuer Integrationstest startet eine echte Session ausschließlich mit dem aus der GET-Antwort gelesenen `assignmentId` (nie dem der Testfixtur bekannten Wert).

Beide Fixes sind rein additiv (neue Response-Felder, keine geänderte Semantik bestehender Felder), erfordern keine Migration und wurden mit insgesamt 4 neuen Backend-Integrationstests abgesichert (Kalender-API-Suite danach 22/22, zweimal stabil bestätigt).

---

## 2. Navigation

Neuer Sidebar-Eintrag „Kalender" (`nav.calendar`) direkt nach „Workouts" in der bestehenden `PERSÖNLICH`-Gruppe (`AppSidebar.vue`), Route `/calendar` (`meta.personalContext: true`, wie `/workouts`/`/progress`). Keine zweite Kalendernavigation im Studio-Bereich — der Kalender ist benutzerbezogen (`user_id`-Schlüssel im Backend), nicht studio-scoped; ein Mitglied mehrerer Studios sieht alle eigenen zulässigen Ereignisse in einer gemeinsamen Ansicht, ohne Studio-Auswahl.

---

## 3. Desktop-Monatsansicht

`CalendarMonthGrid.vue`, mirrored an der bestehenden Kalendergrid-Konvention aus `WorkoutsView.vue` (Montag-first, `weekday-grid`/`calendar-grid`-CSS-Klassen), aber bewusst erweitert: Der Raster zeigt **echte** Tage angrenzender Monate an den Rändern (nicht leere Platzhalter wie `WorkoutsView.vue`), damit Ereignisse an Monatsgrenzen sichtbar bleiben. `buildMonthGrid()` (`utils/calendarDate.js`) berechnet den Bereich vom Montag der ersten sichtbaren Woche bis zum Sonntag der letzten — natürlich 4 bis 6 Wochen (28–42 Tage), nie künstlich auf 6 Wochen aufgefüllt. Vorheriger/Nächster Monat, Heute-Schaltfläche, Monats-/Jahresbezeichnung über `formatDate()`/`weekdayNames()` aus `utils/i18n.js` (Intl-basiert, keine doppelt gepflegten Namenslisten). Jede Tageszelle hat eine `overflow-y:auto`-begrenzte Event-Liste (max. 108–148px Höhe) — stabile Rasterhöhe, mehrere Events pro Tag bleiben durch Scrollen erreichbar, keine „+N weitere"-Krücke nötig.

**Wichtige Korrektur während der Implementierung:** Ursprünglich wurde ein leerer Monat durch eine komplette `EmptyState`-Ersetzung dargestellt, die auch die Monatsnavigation entfernte — das hätte einen Nutzer mit leerem Juli ohne jede Möglichkeit gelassen, zu einem Monat mit Ereignissen zu navigieren. Gefunden im manuellen Browser-Test, behoben: Raster und Navigation bleiben **immer** sichtbar; die Leer-/Gefiltert-Leer-Meldung erscheint als nicht blockierendes Banner oberhalb des weiterhin voll funktionsfähigen Kalenders.

Der abgefragte API-Zeitraum (`GET /api/v1/training-calendar?from&to`) entspricht exakt dem sichtbaren Raster (`monthGridRange()`), maximal 42 Tage — sicher unter dem 93-Tage-Limit.

---

## 4. Mobile Agenda-Ansicht

`CalendarAgendaList.vue`, chronologisch gruppiert nach Tag, zeigt nur Tage mit tatsächlichen Ereignissen (kein 30+-Zeilen-Raster mit leeren Tagen). Gleiche Monatsnavigation (Vorheriger/Nächster Zeitraum, Heute) wie die Desktop-Ansicht, da beide Ansichten **denselben** geladenen Zeitraum/dieselben Daten anzeigen — umgeschaltet ausschliesslich über CSS-Medienabfrage (`@media (max-width: 767px)`, `.calendar-desktop-view`/`.calendar-mobile-view`), beide Komponenten sind im DOM immer vorhanden. Das garantiert **einen** Kalender-Read-Request pro sichtbarem Zeitraum unabhängig von der Bildschirmgrösse — nie einen separaten mobilen Request.

---

## 5. Statusfarben und Statuskennzeichnung unabhängig von Farbe

Zwei neue zentrale Design-Tokens in `assets/main.css` (`--calendar-due-today*` violett, `--calendar-in-progress*` indigo) ergänzen die vier bestehenden semantischen Tokens (`--success`/`--warning`/`--danger`/`--info`); `Badge.vue`s Tone-Validator um `due-today`/`in-progress` erweitert. Zentrale Zuordnung in `utils/calendarStatus.js`:

| displayStatus | Tone/Token | Icon |
|---|---|---|
| PLANNED | info (blau) | ○ |
| DUE_TODAY | due-today (violett) | ◆ |
| OVERDUE | warning (orange) | ▲ |
| IN_PROGRESS | in-progress (indigo) | ▶ |
| COMPLETED | success (grün) | ✓ |
| SKIPPED | danger (rot) | ⤫ |
| CANCELLED | danger (rot) | ✕ |

SKIPPED und CANCELLED teilen bewusst dieselbe rote Farbfamilie, sind aber durch unterschiedlichen Text („Übersprungen"/„Abgesagt") und unterschiedliches Icon eindeutig unterscheidbar.

**Während des manuellen Browser-Tests gefundene und behobene Lücke:** In der kompakten Desktop-Rasteransicht wurde der Statustext ursprünglich nur im `aria-label` mitgegeben, nicht sichtbar gerendert (nur Icon + Farbe sichtbar) — das erfüllt zwar die Screenreader-Anforderung, nicht aber „Jedes Event benötigt zusätzlich mindestens: lesbaren Statusnamen" (Abschnitt 6). Behoben: `CalendarEventItem.vue` zeigt den übersetzten Statustext jetzt in **beiden** Varianten (Grid und Agenda) sichtbar an; nur die zusätzliche Quellenzeile bleibt aus Platzgründen der Agenda-Variante vorbehalten.

Jeder Event-Button hat zusätzlich einen zusammengesetzten `aria-label` aus Titel, Datum und Statustext (`calendar.eventAriaLabel`).

---

## 6. Quellen

Persönliche Einträge zeigen „Persönlich"; Studio-Einträge zeigen Studioname (optional `· Programmname`), z. B. „FitTrack Studio · Upper/Lower Plan". Kein Coach-Name wird angezeigt — der aktuelle Backend-Vertrag liefert keine Coach-Daten auf dem Kalendereintrag, und es werden bewusst **keine** Coach-Informationen aus anderen API-Antworten zusammengesetzt (Abschnitt 7 des Auftrags verbietet das explizit). Unbekannte `sourceType`-Werte fallen auf einen neutralen, klar als „Unbekannte Quelle" markierten Text zurück, nie stillschweigend auf einen der beiden bekannten Werte.

---

## 7. Filter

`CalendarFilters.vue`: Quelle über die bestehende `Tabs.vue`-Komponente (Alle/Persönlich/Studio), Status über ein natives `<select>` (alle 7 Anzeige-Stati plus „Alle"). Beide Filter werden **ausschliesslich clientseitig** auf die bereits geladenen Einträge angewendet (`filteredEntries`-Computed in `CalendarView.vue`) — keine zusätzliche Backend-Abfrage pro Filterwechsel. „Filter zurücksetzen"-Schaltfläche, deaktiviert wenn bereits beide Filter auf „Alle" stehen.

---

## 8. Date-only- und Zeitzonenvertrag

Neues zentrales Modul `utils/calendarDate.js`: `parseLocalDate`/`formatLocalDate` (nie `new Date("YYYY-MM-DD")`, nie `toISOString().slice(0,10)`), `todayInTimezone()` (Intl-`en-CA`-Formatierung, identisch zum Backend-Muster aus `trainingCalendarDomain.js`), `resolveBrowserTimezone()` (`Intl.DateTimeFormat().resolvedOptions().timeZone`, Fallback `Europe/Zurich` bei ungültiger/fehlender Erkennung — identisch zum dokumentierten Backend-Fallback), `buildMonthGrid`/`monthGridRange`/`addMonths`/`startOfMonth`, `addDaysToDateOnly`/`compareDateOnly`/`isPast|Future|TodayDateOnly`. Die Browser-Zeitzone wird bei jedem Kalender-API-Aufruf als `timezone`-Parameter mitgesendet.

Unit-getestet: Monatswechsel, Jahreswechsel, Schaltjahr (2028) und Nicht-Schaltjahr (2026), ein echter CET→CEST-DST-Übergang (2026-03-29), eine spätabendliche UTC-Verschiebung (bereits nächster Tag lokal), sowie angrenzende Monatstage im Raster.

---

## 9. API-Client und `availableActions`

`utils/calendarApi.js` folgt exakt der bestehenden Konvention (`utils/studioApi.js`/`utils/accountApi.js`): ein `authenticated()`-Wrapper über `apiRequest`, eine Funktion pro Endpunkt, keine abweichenden Feldnamen in einzelnen Komponenten. `resolveLinkedWorkoutRoute()` bestimmt die Zielroute für `VIEW_WORKOUT` ausschliesslich aus `linkedWorkoutType`/`linkedWorkoutPublicId`/`studio.id` — nie aus internen numerischen IDs. Studio-Workout-Start verwendet **den bestehenden** `startWorkoutSession()`-Vertrag aus `workoutSessionApi.js` direkt (kein zweiter, paralleler Start-Endpunkt).

`availableActions` aus der Backend-Antwort ist die alleinige Grundlage für angezeigte Aktionen (`CalendarEventDetailDialog.vue` rendert ausschliesslich Aktionen aus diesem Array, in fester Reihenfolge START→COMPLETE→VIEW_WORKOUT→RESCHEDULE→SKIP→CANCEL). Eine zusätzliche „Bearbeiten"-Schaltfläche für den Titel wird gezeigt, wenn `RESCHEDULE` verfügbar UND die Quelle persönlich ist — es gibt keinen eigenen `EDIT`-Aktionscode im Backend-Vertrag, daher wird das nächstliegende serverseitig abgeleitete Signal wiederverwendet, nie eine eigene Datums-/Statuslogik erfunden.

`utils/calendarErrors.js` (mirrored an `utils/workoutSessionErrors.js`) bildet alle 11 dokumentierten Fehlercodes plus `VALIDATION_ERROR` auf übersetzte, nicht-technische Meldungen ab; unbekannte Codes fallen auf eine generische Meldung zurück, nie auf einen rohen Code oder SQL-Detail.

---

## 10. Persönliche Erstellung, Heute-/Vergangenheit-/Zukunft-Regeln

`CalendarCreateDialog.vue`: Titel, Datum, optionale Notiz. Der Server bestimmt den endgültigen Status (`resolvePersonalCreationStatus`, Stage 5A1) — die UI bietet **keinen** Status-Dropdown an. Client-seitige Hinweistexte erklären die Regel im Voraus, ersetzen aber nie die Serverautorität:

- **Zukunft**: Hinweis „wird als geplant gespeichert", keine `planAsUpcoming`-Option sichtbar.
- **Heute**: Standard „wird als abgeschlossen gespeichert"; zusätzliche Checkbox „Als geplantes Training speichern" (`planAsUpcoming: true`) nur für dieses Datum sichtbar.
- **Vergangenheit**: Hinweis „wird als abgeschlossen gespeichert", keine Checkbox.

Client-seitige Validierung spiegelt die Backend-Grenzen exakt (Titel ≤160 Zeichen, Notiz ≤255 Zeichen — identisch zur zugrundeliegenden `workouts.notes`-Spalte), mit übersetzten Inline-Fehlermeldungen. Nach Erfolg: Dialog schliesst, Erfolgsmeldung über das bestehende Toast-System, sichtbarer Bereich wird neu geladen; der Absende-Button ist während der Anfrage deaktiviert (kein Doppel-Eintrag bei wiederholtem Klick).

---

## 11. Bearbeiten und Verschieben

Beide nur sichtbar, wenn `availableActions`/das abgeleitete Signal es erlaubt (Abschnitt 9). Verschieben sendet `scheduledDate` + `expectedRevision` an `/reschedule`; der Server bleibt massgeblich für den resultierenden Status (nur `PLANNED→PLANNED` erlaubt) — die UI setzt nie eigenständig `COMPLETED`, auch wenn auf heute oder in die Vergangenheit verschoben wird; der Eintrag erscheint nach dem Neuladen korrekt als `DUE_TODAY`/`OVERDUE`.

**Während des manuellen Browser-Tests gefundener und behobener Bug:** Nach erfolgreichem Bearbeiten/Verschieben blieb der Detaildialog geöffnet und „hing" über der Seite — bei einer nachfolgenden Monatsnavigation blockierte sein Hintergrund-Overlay jede weitere Interaktion. Behoben: beide Erfolgspfade schliessen den Dialog jetzt explizit (`closeDetail()`), analog zum bereits korrekten Verhalten von Complete/Skip/Cancel.

---

## 12. Complete, Skip, Cancel

Für `COMPLETE`/`SKIP`/`CANCEL` öffnet `CalendarView.vue` einen `ConfirmDialog` (wiederverwendet, nicht neu gebaut) mit einer konkreten, Titel und Datum nennenden Beschreibung, bevor die Mutation ausgeführt wird — nie eine sofortige Aktion ohne Bestätigung. Genau ein `Modal` ist zu jedem Zeitpunkt sichtbar: Öffnen des Bestätigungsdialogs schliesst den Detaildialog (`:entry="pendingConfirm ? null : detailEntry"`), vermeidet gestapelte Fokus-Traps. `expectedRevision` wird aus dem zuletzt geladenen Eintrag mitgesendet; der Bestätigen-Button ist während der Anfrage deaktiviert (idempotent gegen Doppelklick). Persönliche Complete nutzt `completeCalendarEntry` (verknüpft serverseitig einen minimalen `workouts`-Datensatz, Stage 5A1); Studio-Einträge zeigen `COMPLETE` serverseitig ohnehin nie an — die primäre Aktion bleibt „Training starten". Skip und Cancel führen zu klar unterschiedlichem Text („Übersprungen"/„Abgesagt") trotz gemeinsamer roter Farbe; keine Undo-Funktion (Reaktivierung ist laut Stage 5A1 nicht unterstützt).

---

## 13. Training starten (Studio)

Nutzt ausschliesslich den bestehenden Session-Start-Vertrag (`startWorkoutSession`/`workoutSessionApi.js`) mit `studio.id`, `assignmentId` (Abschnitt 1.2) und `programDay.id` aus der Kalenderantwort selbst. Bei Erfolg navigiert die Anwendung zur bestehenden `studio-workout-session-detail`-Route — keine zweite, parallele Startlogik. Der Kalenderstatus aktualisiert sich beim nächsten Laden der `/calendar`-Seite (die Seite wird beim Verlassen nicht `keep-alive` gehalten, ein erneuter Besuch lädt serverseitig bereits korrekt aktualisierte Daten — Stage 5A1s serverseitige Verknüpfung von Session-Start/-Abschluss mit dem Kalendereintrag macht eine eigene Client-seitige Nachbereitung überflüssig). Ein 409-Konflikt (Doppelstart) wird über dieselbe zentrale Fehlerbehandlung wie jede andere Mutation abgefangen und verständlich angezeigt.

---

## 14. Verknüpfte Workouts öffnen

`VIEW_WORKOUT` navigiert über `resolveLinkedWorkoutRoute()`: persönliche Workouts zur bestehenden `/workouts`-Liste (es gibt in dieser Anwendung keine separate Detailroute für ein einzelnes persönliches Workout — die Liste selbst ist die Detailfläche; eine neue parallele Detailseite wurde bewusst **nicht** gebaut, wie vom Auftrag gefordert), Studio-Workouts zur bestehenden `studio-workout-session-detail`-Route. Ein nicht auflösbares Ziel (fehlender Link, unbekannter Typ) liefert `null` und unterlässt die Navigation, statt zu raten oder abzustürzen.

---

## 15. Konfliktbehandlung

Bei `409 CALENDAR_ENTRY_CONFLICT` (`isCalendarConflictError()`) zeigt die zentrale Mutationsbehandlung in `CalendarView.vue` **keine** lokale Erfolgsmeldung, lädt den sichtbaren Bereich neu (wodurch jeder offene Dialog automatisch die aktuellen Daten zeigt, da `detailEntry` aus der aktuellen `entries`-Liste abgeleitet wird) und zeigt die exakt geforderte Meldung „Der Kalendereintrag wurde zwischenzeitlich geändert. Die aktuellen Daten wurden neu geladen." Alle 11 übrigen dokumentierten Fehlercodes werden gezielt auf übersetzte, nicht-technische Meldungen abgebildet (Abschnitt 9); keine SQL- oder Serverdetails erscheinen je in der Oberfläche.

---

## 16. Lade-, Fehler- und Leerzustände sowie Request-Verhalten

Initialer Skeleton-Zustand (`.skeleton`-Klassen, bestehende Konvention), separater Hintergrund-Ladezustand bei Monatswechsel (`isRangeLoading`, live-Region, Raster bleibt sichtbar), Netzwerkfehler mit übersetzter Meldung und „Erneut versuchen"-Schaltfläche, leerer Monat und leeres Filterresultat als nicht blockierendes Banner (Abschnitt 3). Ein monoton steigender `requestSequence`-Zähler in `CalendarView.vue` verwirft jede Antwort, die nicht mehr der aktuellsten Anfrage entspricht — bewiesen durch einen dedizierten Component-Test, der eine langsame und eine schnellere Anfrage gegeneinander laufen lässt. Kein Polling, kein Watcher, der eine Endlosschleife erzeugen könnte; höchstens ein Request pro sichtbarem Zeitraum, nie einer pro Tag oder Event.

---

## 17. Responsive Design

Verifiziert bei 390×844 (mobile Agenda, kein horizontaler Overflow), 768×1024 (Desktop-Rasteransicht bleibt aktiv, Breakpoint liegt bei 767px), 1440×900 (volles Desktop-Raster). Lange Titel/Studio-/Programmnamen brechen korrekt um (`overflow-wrap: anywhere` im Detaildialog) bzw. werden in der kompakten Rasteransicht abgeschnitten (`text-overflow: ellipsis`) und bleiben über den vollständigen `aria-label` sowie den Detaildialog zugänglich.

---

## 18. Accessibility

Event-Buttons sind echte `<button>`-Elemente (volle Tastaturbedienung, kein halb implementiertes ARIA-Grid) mit zusammengesetztem `aria-label` (Titel, Datum, Status). Der heutige Tag ist im Raster durch eine zusätzliche, für Screenreader sichtbare „Heute"-Kennzeichnung markiert. Alle drei Dialoge (Erstellen, Detail, Bestätigen) nutzen die bestehenden `Modal.vue`/`ConfirmDialog.vue`-Komponenten mit bereits vollständiger Fokus-Falle, Escape-Schliessung und Fokus-Rückgabe. Formularfehler sind über `aria-invalid`/`aria-describedby` korrekt referenziert. Mutationserfolg/-fehler nutzt die bestehende `ToastHost.vue`-Live-Region (`aria-live="polite"`) statt einer neuen. Kein kritischer oder schwerwiegender Axe-Befund auf Desktop, Mobil, in allen drei Dialogen sowie im gefüllten und leeren Zustand (siehe Testabschnitt).

---

## 19. Internationalisierung

Vollständige DE/EN-Übersetzung unter dem neuen `calendar`-Schlüssel in `utils/i18n.js` (Navigation, Titel, Status, Quellen, Filter, Aktionen, Formulare, Bestätigungen, Leerzustände, Fehler, Erfolgsmeldungen, Accessibility-Labels). Monats- und Wochentagsnamen werden über die bestehenden `formatDate()`/`weekdayNames()`-Helfer (Intl-basiert) formatiert, nie als zweite, hart codierte Namensliste gepflegt.

---

## 20. Tests

### 20.1 Backend (Ergänzung zu Stage 5A1)

4 neue Integrationstests für die beiden Vertragsfixes (Abschnitt 1), Kalender-API-Suite danach 22/22 (vorher 18/18), zweimal unabhängig stabil bestätigt. Unit-Suite unverändert 39/39.

### 20.2 Frontend Unit (44 neue Tests)

`calendarDate.test.js` (27), `calendarStatus.test.js` (9), `calendarErrors.test.js` (7), `calendarApi.test.js` (6, `resolveLinkedWorkoutRoute`) — Date-only-Parsen, Monatsraster, Montag-Wochenbeginn, Range-Berechnung, Monats-/Jahreswechsel, Schaltjahr, CET/CEST, Status-/Farb-/Label-Mapping, unbekannter Status/unbekannte Quelle, Fehlercode-Mapping, 409-Erkennung, Route zu verknüpften Workouts.

### 20.3 Frontend Component (73 neue Tests)

`CalendarEventItem` (15), `CalendarFilters` (6), `CalendarCreateDialog` (13), `CalendarEventDetailDialog` (14), `CalendarMonthGrid` (8), `CalendarAgendaList` (6), `CalendarView` (12, volle Orchestrierung inkl. Request-Race-Schutz, 409-Konfliktbehandlung, Studio-Start-Navigation). Gesamte Frontend-Suite danach 458/458 (vorher 341).

### 20.4 E2E (7 neue Szenarien in `e2e/calendar.spec.js`)

Persönlicher Ablauf (erstellen/verschieben/bestätigen/Workout öffnen), Heute-Default vs. `planAsUpcoming`, Vergangenheit, Studio-Workout (Seed über Schedule-Rule-API, Start über echte Kalender-UI, Abschluss über die **unveränderte** bestehende Session-Ausführungsseite, Rückkehr als abgeschlossen, kein doppelter persönlicher Eintrag), Skip/Cancel mit unterscheidbaren roten Zuständen, Overdue (vergangenes, unbestätigtes Coach-Event bleibt `PLANNED`/orange, nie automatisch abgeschlossen), Filter. Zweimal im vollen 56-Test-Chromium-Lauf stabil bestätigt.

### 20.5 Axe (1 neue dedizierte Suite plus 3 erweiterte Routen-Listen)

`/calendar` zur bestehenden Kernseiten-Axe-Schleife und beiden Viewport-Overflow-Schleifen hinzugefügt (deckt leeren Kalender, Desktop, mehrere Viewports ab); neue dedizierte Prüfung für Create-Dialog, gefüllten Kalender, Event-Detaildialog, Bestätigungsdialog und die mobile Agenda-Ansicht — keine kritischen oder schwerwiegenden Befunde.

---

## 21. Während dieser Phase gefundene und behobene Probleme (Zusammenfassung)

1. Zwei echte Backend-Vertragslücken (`revision`, `assignmentId` nie exponiert) — Abschnitt 1.
2. UX-Bug: leerer Monat entfernte die gesamte Navigation — Abschnitt 3.
3. Accessibility-Lücke: Statustext in der Desktop-Rasteransicht nur im `aria-label`, nicht sichtbar — Abschnitt 5.
4. UI-Bug: Detaildialog schloss nach erfolgreichem Bearbeiten/Verschieben nicht — Abschnitt 11.

Alle vier wurden über einen echten, browserbasierten manuellen Testlauf (nicht nur durch automatisierte Tests) gefunden, behoben und anschliessend durch automatisierte Tests dauerhaft abgesichert.

---

## 22. Bekannte Einschränkungen und Folgeschritte (nicht Teil dieser Phase)

- **Keine Coach-Planungsoberfläche** — Stage 5A3, bewusst nicht begonnen.
- **Keine Massenplanung** oder Serienbearbeitung mehrerer zukünftiger Vorkommnisse auf einmal.
- **Kein „+N weitere"-Mechanismus** für sehr volle Tage — stattdessen eine scrollbare, feste Zellhöhe; für die meisten realistischen Trainingsdichten ausreichend, könnte bei Bedarf durch eine Tagesdetailansicht ergänzt werden.
- **`CALENDAR_WORKOUT_ALREADY_LINKED`** bleibt (wie in Stage 5A1 dokumentiert) an keiner Aufrufstelle ausgelöst — es gibt keine UI-Aktion, die diesen Fehler in dieser Phase auslösen könnte.
- **Kein persönliches Benutzer-Zeitzonenfeld** (Stage-5A1-Entscheidung unverändert) — die Browser-Zeitzone wird pro Anfrage übermittelt, mit dokumentiertem Fallback.
- **Kein Tageszellen-Klick zum Vorausfüllen des Erstellungsdatums** — die „Training eintragen"-Aktion füllt immer das heutige Datum vor; eine künftige Phase könnte das Klicken einer leeren Tageszelle mit dem Erstellungsdialog verknüpfen.
