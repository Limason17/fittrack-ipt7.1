# Stage 1B.2A – Coach- und Programmverwaltungsoberfläche

Diese Phase liefert eine Benutzeroberfläche für die in Stage 1B.1 geschaffenen
Backend-Fähigkeiten (Coaching-Beziehungen, Trainingsprogramme,
Programmversionen, Trainingstage/-übungen, Programmzuweisungen). Es werden
keine neuen Trainingstabellen eingeführt und keine Workout-Ausführung
implementiert; die UI verwendet ausschließlich den bestehenden
Stage-1B.1-API-Vertrag zuzüglich einer einzigen minimalen Lese-Ergänzung (siehe
„API-Abhängigkeiten und Backend-Ergänzung").

## Seiten und Routen

| Route | Name | Komponente | Sichtbar für |
| --- | --- | --- | --- |
| `/studios/:studioId/coaching` | `studio-coaching` | `CoachingRelationshipsView.vue` | Owner, Admin, Trainer |
| `/studios/:studioId/training-programs` | `studio-training-programs` | `TrainingProgramsView.vue` | Owner, Admin, Trainer |
| `/studios/:studioId/training-programs/:programId` | `studio-training-program-detail` | `TrainingProgramBuilderView.vue` | Owner, Admin, Trainer |
| `/studios/:studioId/assignments` | `studio-program-assignments` | `ProgramAssignmentsView.vue` | Owner, Admin, Trainer |
| `/studios/:studioId/my-training-plan` | `studio-my-training-plan` | `MyTrainingPlanView.vue` | jedes aktive Studio-Mitglied |

Die Navigation (`AppSidebar.vue`) blendet die ersten vier Einträge nur für
Owner/Admin/Trainer ein (`canAccessTrainingManagement`) und „Mein
Trainingsplan" nur für die Rolle `member` (`isStudioMemberRole`). Das ist
ausschließlich Bedienkomfort: Jede Route bleibt auch ohne passenden
Sidebar-Eintrag über die URL erreichbar, und jede Aktion wird serverseitig
über die bestehenden Stage-1B.1-Permissions (`COACHING_MANAGE`,
`PROGRAM_MANAGE`, `PROGRAM_PUBLISH`, `ASSIGNMENT_MANAGE`,
`ASSIGNMENT_READ_SELF`) durchgesetzt.

## Rollenverhalten

- **Owner/Admin:** volle Coaching-Verwaltung (erstellen/beenden), volle
  Programmverwaltung, beliebige aktive Coaching-Beziehung eines Mitglieds bei
  Zuweisungen wählbar.
- **Trainer:** sieht in der Coaching-Liste ausschließlich eigene Beziehungen
  (serverseitig gefiltert), kann keine Beziehungen erstellen/beenden (Formular
  und Beenden-Aktion sind für diese Rolle ausgeblendet), kann Programme
  verwalten/veröffentlichen und Zuweisungen ausschließlich über die eigene
  aktive Coaching-Beziehung erstellen.
- **Member:** sieht ausschließlich „Mein Trainingsplan" mit den eigenen
  Zuweisungen; keine Coaching-, Programm- oder Zuweisungsverwaltung.
- **Verlorene Berechtigung/Mitgliedschaft:** Ein `403`/`404` während des Ladens
  löst `reconcileStudioAccess()` aus (identisches Muster wie in Stage 1A):
  Studio-Kontext wird neu geladen; bei fehlender Mitgliedschaft erfolgt ein
  Redirect zu `/studios`, bei unzureichender Rolle zu
  `studio-access-denied`. Die globale Session (`authToken`/`authUser`) bleibt
  in allen Fällen unangetastet – nur `401` löst (wie im bestehenden
  `apiRequest`-Muster) einen Logout aus.

## Coaching-Beziehungsoberfläche

`CoachingRelationshipsView.vue` listet aktive und beendete Beziehungen mit
Coach, Mitglied, Status-Badge, Start-/Enddatum. Owner/Admin erhalten ein
Formular mit zwei aus `listMemberships()` gespeisten Auswahlfeldern (Coach:
Rolle owner/admin/trainer + aktiv; Mitglied: Rolle member + aktiv) sowie eine
Beenden-Aktion je aktiver Zeile mit Bestätigungsdialog. Die
Auswahlfilterung ist reine Bedienhilfe; die tatsächliche Eignungsprüfung
(`coachingRelationshipEligibility`) bleibt serverseitig.

## Programmliste

`TrainingProgramsView.vue` zeigt Programme als Karten mit Name, Beschreibung
und Status-Badge (`draft`/`active`/`archived`), inline-Formular zum Erstellen
(Name, optionale Beschreibung) und verlinkt jede Karte in den Program
Builder.

## Program Builder

`TrainingProgramBuilderView.vue` implementiert den vollständigen Flow:
Programm öffnen → Entwurfsversion erstellen → Versionsnotizen bearbeiten →
Trainingstage hinzufügen/umbenennen/entfernen → Übungen
hinzufügen/bearbeiten/entfernen → Version veröffentlichen. Programmarchivierung
ist als separate Aktion am Programmkopf verfügbar (mit Bestätigungsdialog).

### Versionsverwaltung

Versionen werden als Tab-Leiste mit Versionsnummer und Status-Badge
dargestellt. Nur `draft`-Versionen sind editierbar
(`canMutateProgramVersion`-Äquivalent clientseitig über `version.status`
gespiegelt, serverseitig bleibt die Autorität bestehen). Veröffentlichte und
zurückgezogene Versionen zeigen einen deutlichen Hinweistext („Diese Version
ist veröffentlicht und daher unveränderlich…"), das Notizfeld wird `readonly`,
und sämtliche Mutations-Controls (Tag/Übung hinzufügen, bearbeiten, sortieren,
entfernen) werden vollständig aus dem DOM entfernt statt nur deaktiviert – für
Screenreader ist der Read-only-Zustand damit strukturell erkennbar, nicht nur
visuell. Publizieren erfordert eine Bestätigung im Dialog. Eine neue
Entwurfsversion lässt jede zuvor veröffentlichte Version unverändert (reiner
Lesezugriff über eine separate Version-ID).

### Sortierung von Tagen und Übungen

Entsprechend der Vorgabe „bevorzugt zugängliche Sortiercontrols" wurde
**kein Drag-and-Drop** implementiert. Jede Zeile (Tag bzw. Übung) im
Draft-Zustand erhält drei Controls in einer `role="group"` mit
beschreibendem `aria-label`: „Nach oben", „Nach unten" (deaktiviert an den
Rändern der Liste) und eine Positionsauswahl (`<select>` mit allen gültigen
Positionen 1..n). Alle drei rufen denselben PATCH-Endpunkt mit `{ position }`
auf; die Serverantwort wird nicht lokal verrechnet, sondern die komplette
Version wird neu geladen (`getProgramVersion`), sodass die serverseitige
Zwei-Phasen-Umnummerierung immer die sichtbare Wahrheit ist – es kann keine
lokale Inkonsistenz zwischen UI und Datenbank entstehen.

## Programmzuweisungen

`ProgramAssignmentsView.vue` listet Zuweisungen mit Status-Badges
(`active`/`completed`/`cancelled`) und einem clientseitigen Tabs-Filter über
die aktuell geladene Seite (siehe „bekannte Einschränkungen"). Das
Erstell-Formular verknüpft vier Auswahlfelder kaskadierend: Mitglied →
Programm (nur `status=active`, also Programme mit mindestens einer
veröffentlichten Version) → Version (nur `status=published` des gewählten
Programms) → Coaching-Beziehung (nur `status=active` UND
`member.membershipId` des aktuell gewählten Mitglieds). Abschließen/Abbrechen
je aktiver Zuweisung erfordert eine Bestätigung.

## Explizite Coaching-Beziehung bei Zuweisungen

`POST /program-assignments` verlangt seit der vorherigen Phase zwingend eine
öffentliche `coachingRelationshipId`. Die UI wählt diese **niemals**
automatisch: Das Auswahlfeld „Coaching-Beziehung wählen" listet ausschließlich
die Beziehungen, die (a) `status === 'active'` sind und (b)
`member.membershipId` exakt dem aktuell gewählten Mitglied entsprechen. Für
Owner/Admin kann das mehrere Optionen ergeben (mehrere Coaches desselben
Mitglieds); für einen Trainer liefert `listCoachingRelationships()` serverseitig
ohnehin nur die eigenen Beziehungen, sodass eine fremde Beziehung in der Liste
gar nicht erst erscheinen kann. Gibt es für das gewählte Mitglied keine
nutzbare Beziehung (z. B. weil sie gerade beendet wurde), zeigt die UI den
Hinweis „Für dieses Mitglied besteht keine aktive Coaching-Beziehung, die du
verwenden kannst." statt eine ungültige Option anzubieten oder zu erraten.

## Member-Ansicht „Mein Trainingsplan"

`MyTrainingPlanView.vue` ruft `listOwnProgramAssignments()`
(`GET .../program-assignments/me`) auf und zeigt je Zuweisung Programmname,
-beschreibung, Versionsnummer/-status, Status-Badge sowie Start-/Enddatum.
Tage und Übungen werden **verzögert** nachgeladen: Erst ein Klick auf
„Details anzeigen" löst `getOwnProgramAssignmentDetail()` aus (siehe
Backend-Ergänzung unten); ein erneuter Klick blendet nur aus, ohne
nachzuladen. Es gibt bewusst **keinen** „Training starten"-Button und keine
Möglichkeit, Sätze/Wiederholungen/Gewichte zu erfassen; ein Hinweistext
kommuniziert explizit, dass die Trainingsausführung erst in einer späteren
Phase folgt.

## API-Abhängigkeiten und Backend-Ergänzung

Der neue Frontend-Client `frontend/src/utils/studioTrainingApi.js` bildet den
vollständigen Stage-1B.1-Vertrag ab (Coaching-Beziehungen, Programme,
Versionen, Tage, Übungen, Zuweisungen) nach demselben Muster wie
`studioApi.js` (öffentliche UUIDs, `authenticated()`-Wrapper,
`withPagination()`).

**Eine minimale Backend-Ergänzung war objektiv erforderlich:** Die Member-Rolle
besitzt `ASSIGNMENT_READ_SELF`, aber nicht `PROGRAM_READ` – sie kann also
weder `listProgramVersions` noch `getVersion` aufrufen, um Tage/Übungen der
eigenen Zuweisung zu sehen, und `listOwnAssignments` liefert nur eine
Zusammenfassung ohne Versions-ID. Ergänzt wurde daher
`GET /api/v1/studios/:studioId/program-assignments/me/:assignmentId`
(`programAssignmentService.getOwnAssignmentDetail`), das
- ausschließlich über `ASSIGNMENT_READ_SELF` gesichert ist,
- zusätzlich `member_membership_id = actor.internalId` filtert (identisches
  `PROGRAM_ASSIGNMENT_NOT_FOUND` für fremde/erratene IDs, keine
  Existenzoffenlegung),
- Tage/Übungen über dieselben, aus `trainingProgramService.js`
  wiederverwendeten reinen Mapper-Funktionen (`dayFromRow`, `exerciseFromRow`,
  `publicDay`) zusammensetzt.

Keine neue Migration, keine neue Tabelle, keine neue Permission. Automatisiert
getestet (4 neue Integrationstests) und Teil der 179 grünen Backend-Tests.

## Accessibility

- Alle neuen Formulare verwenden `<label for>`-Bindung; Positions-Controls
  tragen `role="group"` mit `aria-label`, der die betroffene Zeile benennt.
- Alle Bestätigungsaktionen laufen über `ConfirmDialog`/`Modal` mit
  bestehendem Fokus-Management (Fokus-Falle, Escape schließt, Fokus kehrt
  zurück – unverändertes `useModalFocus`-Muster aus Stage 1A).
- Erfolg/Fehler laufen über `ToastHost` (`aria-live="polite"`) sowie
  `role="alert"`/`role="status"` Inline-Meldungen.
- Status wird nie ausschließlich über Farbe vermittelt: jedes `Badge` trägt
  den übersetzten Statustext als sichtbaren Inhalt.
- Read-only-Zustand einer veröffentlichten Version ist strukturell (fehlende
  Controls, `readonly`-Attribut, Hinweistext), nicht nur visuell erkennbar.
- Automatisiert geprüft: `frontend/e2e/accessibility.spec.js` läuft Axe gegen
  alle fünf neuen Hauptseiten (inklusive einer echten Program-Builder-Instanz)
  und meldet keine „serious"/„critical" Verstöße; ein dedizierter Test prüft
  zusätzlich alle fünf Seiten bei 1440/1024/768/390 px auf horizontalen
  Overflow.

## Responsives Verhalten

Getestet bei 1440, 1024, 768 und 390 px (E2E, siehe oben). Tabellen nutzen das
bestehende `table-wrap table-stack`-Muster (Karten-Darstellung unterhalb der
Breakpoints aus `main.css`/`studios.css`), Formulare stapeln über
`studio-form-grid`, lange Programm-/Übungsnamen brechen über
`overflow-wrap: anywhere` (`studio-identity`, `studio-details`) kontrolliert
um. Der Program Builder wurde mit einem Tag- und Übungsnamen von bewusst
überdurchschnittlicher Länge geprüft.

## Lade-, Leer- und Fehlerzustände

Jede Liste zeigt: Skeleton während des initialen Ladens, `EmptyState` bei
keinen Ergebnissen, `message message-error` bei Ladefehlern
(`403` → „Deine aktuelle Rolle erlaubt diese Aktion nicht.", andere Fehler →
seitenspezifische Meldung), Spinner auf allen laufenden Mutationsaktionen.

## Bekannte Einschränkungen

- Der Status-Filter (Tabs) in `ProgramAssignmentsView` wirkt nur auf die
  aktuell geladene Seite, nicht seitenübergreifend über die gesamte
  Zuweisungsliste (kein neuer Backend-Query-Parameter wurde für dieses rein
  darstellerische Bedürfnis ergänzt). Ein Hinweistext macht das transparent.
- Auswahllisten für Mitglieder/Coaching-Beziehungen/Programme laden bis zu
  100 Einträge auf einmal (kein Infinite-Scroll/keine Suche); für sehr grosse
  Studios ist das ein UX-Limit, keine Sicherheitslücke.
- Kein Drag-and-Drop für Sortierung (bewusste Entscheidung, siehe oben).

## Klare Grenze zu Stage 1B.2B

Nicht enthalten und nicht begonnen: Workout-Ausführung, Satz-für-Satz-Logging,
gespeicherte Ist-Werte, Coach-Feedback/-Kommentare, Check-ins, Analytics,
Buchungen, Zahlungen und alle weiteren in der Auftragsbeschreibung
ausgeschlossenen Themen. Stage 1B.2B beginnt auf Basis dieser Oberfläche mit
neuer, expliziter Freigabe.
