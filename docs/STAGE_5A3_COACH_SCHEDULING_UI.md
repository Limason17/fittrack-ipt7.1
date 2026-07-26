# Stage 5A3: Coach Scheduling UI — Trainingspläne nach Wochentagen terminieren

Geprüfter Ausgangs-Commit: `3193f41` (main, PR #22 "Merge... feature/stage-5a2-personal-calendar-ui"), Branch `feature/stage-5a3-coach-scheduling-ui`. Diese Phase liefert die Coach-/Admin-Oberfläche, mit der eine bestehende Programmzuweisung nach Wochentagen terminiert wird: welcher Programmtag an welchem Wochentag, ab welchem Datum, mit welcher Wiederholung und optional bis wann stattfindet. Die daraus entstehenden Termine sind immer zunächst `PLANNED` und erscheinen automatisch im persönlichen Kalender des Members (Stage 5A2) — es gibt **keine neue Kalender-Datenmodell-Änderung**, **keine Migration 013**, **keine Massenterminierung über mehrere Mitglieder** und **keine Drag-and-drop-Kalenderoberfläche** in dieser Phase.

---

## 1. Backend-Vertrag verifiziert — und ein echter, reproduzierbarer Blocker gefunden und behoben

Vor der Implementierung wurde der tatsächliche Schedule-Rule-API-Vertrag direkt am Code verifiziert (`assignmentScheduleRuleV1.js`, `scheduleRuleService.js`, `trainingCalendarValidation.js`, `studioPolicy.js`), nicht nur anhand der Dokumentation: exakte Feldmengen für Create (`programDayId, weekday, weekInterval, anchorDate, activeFrom, activeUntil`) und Patch (**ohne** `programDayId`), Berechtigungsmodell (`SCHEDULE_RULE_READ`/`MANAGE`, Trainer nur mit eigener aktiver Coaching-Beziehung, ad-hoc pro Service geprüft — die vorhandene, aber ungenutzte `coachActionEligibility()` bleibt bewusst unangetastet, wie bereits in Stage 5A1 dokumentiert), sowie das tatsächliche Deaktivierungsverhalten (reines `UPDATE ... SET status='disabled'`, ohne Kaskade auf bereits materialisierte Zeilen).

### 1.1 Echter Blocker: `startSession()` verwendete die Zeitzone des DB-Servers statt der Studio-Zeitzone

Beim Aufbau des Pflicht-E2E-Szenarios „Member startet und schliesst ein automatisch generiertes Studio-Training ab" (Abschnitt 21) schlug der bereits **bestehende** Kalender-Test `calendar.spec.js` „Studio-Workout: erscheint im Kalender, wird gestartet, …" reproduzierbar fehl — unabhängig von jeder Stage-5A3-Änderung (verifiziert durch Reproduktion auf einem sauberen `git worktree` von `main`, Commit `3193f41`, ganz ohne Stage-5A3-Code). Ursache: `backend/services/workoutSessionService.js#startSession()` bestimmte „heute" für die Kalender-Verknüpfung per `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d')` — das ist die Zeitzone des **MySQL-Servers** (hier: `UTC`, per `SELECT @@system_time_zone`), nicht die des Studios (`Europe/Zurich`). In den rund 1–2 Stunden nach lokaler Mitternacht (CEST: 00:00–02:00 Europe/Zurich, während UTC noch am Vortag ist) wich dieses „heute" vom „heute" ab, das der Rest der Kalender-Domäne konsequent über `todayInTimezone()` (`trainingCalendarDomain.js`) berechnet — inklusive des bereits laufenden Materialisierungspfads für Studio-Termine. Ergebnis: `findOrMaterializeTodayCalendarEntry()` suchte/erzeugte die Verknüpfung für den falschen Kalendertag, die Sitzung startete zwar korrekt, aber der im UI sichtbare „heutige" Termin blieb dauerhaft `PLANNED`/„Heute fällig", auch nach vollständigem Abschluss der Trainingseinheit.

**Sechs-Schritte-Prozess (wie im Auftrag verlangt):**
1. **Reproduziert:** eigenständiges Debug-Skript gegen eine frische, isolierte Backend-Instanz (`e2eServer.js`-Muster) — Session-Start ändert den Kalendereintrag-Status **nicht** auf `IN_PROGRESS`.
2. **Auf sauberem `main` bestätigt:** `git worktree` von Commit `3193f41`, identischer Fehlschlag ganz ohne jede Stage-5A3-Änderung — kein durch diese Phase eingeführter Regressionsfehler.
3. **Ursache lokalisiert:** `CURDATE()` (Serverzeitzone `UTC`) statt `todayInTimezone(studio.default_timezone)` an genau einer Stelle, `workoutSessionService.js:302` (alt).
4. **Minimal behoben:** eine zusätzliche, leichte `SELECT default_timezone FROM studios WHERE id = ?`-Abfrage (dieselbe bereits über `withLockedStudioAccess` gesperrte Zeile, kein neuer Lock) plus `todayInTimezone(...)` aus `trainingCalendarDomain.js` (bereits vorhandene, getestete Funktion — kein neuer Code, keine neue Migration, keine neue Route). Betrifft sowohl die Kalender-Verknüpfung als auch die bereits vorhandene `canStartWorkoutSession`-Datumsprüfung, die denselben (bisher falschen) Wert verwendete.
5. **Regressionsschutz:** dieselbe Debug-Sequenz nach dem Fix erneut ausgeführt — Kalendereintrag wechselt korrekt zu `IN_PROGRESS`; anschliessend die vollständige Backend-Integrationssuite (253/253) und die vollständige E2E-Suite erneut grün, inklusive des zuvor fehlschlagenden `calendar.spec.js`-Tests (isoliert und im Gesamtlauf).
6. **Hier dokumentiert**, inklusive der genauen Codestelle, des Zeitfensters, in dem der Fehler auftritt, und der Verifikationsschritte — keine stillschweigende Änderung.

Dies ist die **einzige** Backend-Änderung dieser Phase; sie betrifft ausschliesslich die bereits bestehende Session-Start-Kalenderverknüpfung, keinen neuen Endpunkt, keine neue Migration, keine geänderte Response-Struktur.

---

## 2. Einstiegsort

Neue Aktion „Zeitplan" in der bestehenden Zuweisungstabelle (`ProgramAssignmentsView.vue`), sichtbar für **jede** Zuweisung unabhängig vom Status (aktiv, abgeschlossen, abgebrochen) — Regeln bleiben für nicht mehr aktive Zuweisungen lesbar, Erstellen/Bearbeiten wird ausschliesslich durch die Backend-Antwort begrenzt (kein clientseitiger Statusfilter, der über das Backend hinausgeht). Kein neuer globaler Navigationseintrag.

---

## 3. Route und Berechtigungen

`/studios/:studioId/program-assignments/:assignmentId/schedule` (`studio-assignment-schedule`), `studioRoles: ['owner','admin','trainer']` — identisch zur bestehenden `TRAINING_MANAGEMENT_ROLES`-Konvention. Mitglieder erhalten für diese Route keinerlei Verwaltungsoberfläche (Router-Redirect zu `studio-access-denied`); das Backend bleibt in jedem Fall die eigentliche Schutzschicht (`SCHEDULE_RULE_READ`/`MANAGE`, pro-Trainer-Coaching-Beziehung serverseitig geprüft — verifiziert per E2E, Abschnitt 21). Eine manipulierte Zuweisungs-ID (fremde Zuweisung, eigene Studio-Mitgliedschaft) liefert `404 PROGRAM_ASSIGNMENT_NOT_FOUND`, dargestellt als „Diese Zuweisung wurde nicht gefunden." — nie die echten Daten.

---

## 4. Assignment-Kopfbereich

Mitglied, Programm, Version (`versionLabel`-Konvention wiederverwendet), Status-Badge, Beginn/Ende (`—` bei fehlendem Wert), Studioname. **Kein Coach-Name**: die Zuweisungs-Antwort (`programAssignmentService.js#publicAssignment`) liefert weder eine Coaching-Beziehungs-ID noch Coach-Daten — es wird bewusst **nichts** aus anderen Endpunkten zusammengesetzt (identische Entscheidung wie Stage 5A2 zu Coach-Infos auf dem Kalendereintrag). Verpflichtender Hinweistext exakt wie gefordert:

> „Geplante Trainingstage erscheinen automatisch im persönlichen Kalender des Members. Sie gelten erst nach Abschluss oder ausdrücklicher Bestätigung als abgeschlossen."

Lange Namen (Mitglied, Programm, Studio) brechen per `overflow-wrap: break-word` um, kein horizontaler Overflow (verifiziert bei 1440/768/390 px, Axe-Test Abschnitt 20, sowie manuell mit einem absichtlich langen Studio-/Programmnamen).

---

## 5. Regelübersicht

Sortierung: aktiv vor deaktiviert, dann Wochentag (Montag→Sonntag), dann Position des referenzierten Programmtags innerhalb der Version, dann stabil nach Regel-ID (`utils/scheduleRuleFormat.js#sortScheduleRules`, unit-getestet). Leerer Zustand: „Für diese Zuweisung sind noch keine Trainingstage terminiert." mit CTA „Trainingstag planen" — Header-Schaltfläche und Leerzustands-CTA erscheinen im leeren Zustand bewusst doppelt (identische Aktion, keine Verwirrung, siehe E2E-Test). Mobile: bestehende `table-stack`-Konvention (Karten mit `data-label`), keine separate Komponente nötig.

---

## 6. Regel erstellen

Formular: Programmtag (nur Tage der zugewiesenen, veröffentlichten Version, Anzeige `Position. Name (N Übungen)` bzw. ohne Klammer bei fehlenden Übungen), Wochentag (native `<select>`, gespeist aus `weekdayNames('long')` — keine zweite hartkodierte Wochentagsliste), Startdatum (Default: heute), optionales Enddatum, Wiederholung (Jede Woche / Alle 2 / 3 / 4 Wochen / Benutzerdefiniert 1–52). Da die Programmtag-Liste am Zuweisungsobjekt fehlt (kein Versions-Public-ID auf der Zuweisung), wird sie über einen client-seitigen Cross-Reference aufgelöst: `listProgramVersions(studioId, program.id)` → passende `versionNumber` finden → `getProgramVersion(...)` für die eingebetteten Tage — derselbe Ansatz, den `TrainingProgramBuilderView.vue` bereits verwendet, kein Backend-Blocker.

**Ankerdatum-Berechnung (kein Backend-seitiges Feld in der Oberfläche):** Der Nutzer wählt Wochentag und Startdatum unabhängig voneinander; das Backend verlangt aber `isoWeekdayOf(anchorDate) === weekday`. Die Oberfläche berechnet `anchorDate` daher immer als das erste Datum ab dem gewählten Startdatum, das auf den gewählten Wochentag fällt (`rollForwardToWeekday()`, unit-getestet inkl. Monatsgrenze) — der Nutzer sieht „Ankerdatum" nie als eigenes Konzept.

Bei Konflikt (`CALENDAR_SCHEDULE_RULE_CONFLICT`, aktive Regel für denselben Programmtag+Wochentag existiert bereits) wird die Regelliste neu geladen und eine übersetzte Konfliktmeldung gezeigt — nie ein stiller Fehlschlag oder eine falsche Erfolgsmeldung.

---

## 7. Regel bearbeiten

Nur die tatsächlich vom PATCH-Vertrag unterstützten Felder (`weekday, weekInterval, anchorDate, activeFrom, activeUntil, status`) — **kein** Feld zum Ändern des Programmtags, da der Backend-Vertrag das nicht vorsieht. Bei jedem Speichern wird `anchorDate` konsequent aus dem aktuellen (ggf. geänderten) Wochentag+Startdatum neu berechnet und immer mit gesendet — das vermeidet eine latente Inkonsistenz-Lücke: würde nur `weekday` ohne ein dazu passendes `anchorDate` gesendet, prüft der Server die Konsistenz zwar (`CalendarProgramDayInvalidError` bei Abweichung), aber ein *nicht* mitgesendetes `anchorDate` bliebe unverändert und könnte mit dem neuen Wochentag inkonsistent werden, sobald `weekInterval > 1` ist. Pflicht-Warntext vor dem Speichern exakt wie gefordert:

> „Änderungen betreffen zukünftige geplante Trainings. Bereits abgeschlossene Trainings bleiben unverändert."

Nach Erfolg: Dialog schliesst, Regelliste wird gezielt neu geladen (kein voller Seiten-Reload), Fokus kehrt zur bearbeiteten Zeile zurück, Erfolgsmeldung über das bestehende Toast-System. Historische, bereits abgeschlossene Vorkommen werden **nie** lokal verändert — sie werden schlicht nicht angefasst, da die Oberfläche keine eigene Kalenderlogik führt (siehe Abschnitt 21, Historien-Testfall).

---

## 8. Regel deaktivieren

Kein Hard-Delete. `ConfirmDialog` mit dem exakt geforderten Text:

> „Diese Regel wird deaktiviert. Bereits abgeschlossene Trainings bleiben erhalten. Zukünftige, noch nicht materialisierte Termine werden nicht mehr aus dieser Regel erzeugt."

**Verifiziertes tatsächliches Backend-Verhalten** (direkt am Code von `scheduleRuleService.js#updateScheduleRule` gelesen, nicht angenommen): Das Deaktivieren ist ein reines `UPDATE studio_assignment_schedule_rules SET status='disabled' ...` ohne jede Kaskade auf `training_calendar_entries`. Da Vorkommen ausschliesslich lazy beim tatsächlichen Lesen eines Kalenderbereichs materialisiert werden (`WHERE r.status='active'` in `findOrMaterializeTodayCalendarEntry`/dem Bereichs-Materialisierungspfad), betrifft die Deaktivierung **nur** Datumsbereiche, die die Regel noch nie erzeugt hat — bereits materialisierte Zeilen (egal ob terminal oder noch `PLANNED`) bleiben unangetastet, weil kein weiterer Schreibzugriff je auf sie erfolgt. Der oben zitierte Text ist damit exakt zutreffend und wurde nicht angepasst. Deaktivierte Regeln bleiben sichtbar, farblich/textlich klar als „Deaktiviert" markiert (Badge-Ton `neutral`, nie nur Farbe), ohne Reaktivierungsoption (vom Backend nicht unterstützt).

---

## 9. Terminvorschau

Rein informativ, nie Grundlage des echten Kalenders. Portiert `scheduleRuleOccursOn`/`scheduleRuleDatesInRange` aus `trainingCalendarDomain.js` **zeilengetreu** nach `utils/scheduleRuleFormat.js` (Datumsarithmetik über die bestehenden Stage-5A2-Date-only-Helfer, kein UTC-Parsing) — dieselbe, bereits gegen die Backend-Tests bewiesene Wochentag-/Intervall-Logik, keine Annäherung. Da vollständige Übereinstimmung mit der Backend-Domäne so nachweisbar war (eigene Unit-Tests decken dieselben Szenarien wie die Backend-Domäne ab: wöchentlich, alle 2/3 Wochen, Enddatum exakt auf einem Vorkommen, Schaltjahr, CET/CEST-Übergang), wurde die Vorschau **nicht** weggelassen. Max. 6 Termine, klar als „Nächste Termine (Vorschau)" mit Gewährleistungsausschluss-Hinweis beschriftet, live aktualisiert während der Nutzer das Formular ausfüllt (Erstellen **und** Bearbeiten), niemals ein Datenbank-Schreibzugriff.

---

## 10. Wiederholungszusammenfassung

Zentraler Formatierer `formatScheduleRuleSummary()` (`utils/scheduleRuleFormat.js`), zeigt in der Regelübersicht statt roher technischer Felder immer einen lesbaren Satz:

| Fall | Deutsch | Englisch |
|---|---|---|
| wöchentlich, offen | „Jede Woche am Montag, ab 10.08.2026" | „Every week on Monday, starting 08/10/2026" |
| wöchentlich, mit Ende | „Jede Woche am Montag, 10.08.2026 bis 30.11.2026" | „Every week on Monday, 08/10/2026 to 11/30/2026" |
| alle N Wochen, offen | „Alle 2 Wochen am Mittwoch, ab 12.08.2026" | „Every 2 weeks on Wednesday, starting 08/12/2026" |
| alle N Wochen, mit Ende | „Alle 3 Wochen am Mittwoch, 12.08.2026 bis 02.12.2026" | „Every 3 weeks on Wednesday, 08/12/2026 to 12/02/2026" |

Wochentagsnamen über die bereits bestehende, Monday-first, Intl-basierte `weekdayNames('long')` (`utils/i18n.js`) — keine zweite Liste. Datumsformat über die bestehende `formatDate()`-Konvention, locale-sensitiv, nie manuell zusammengesetzt. Unit-getestet für beide Sprachen und alle vier Fälle.

---

## 11. Date-only- und Zeitzonenvertrag

Ausschliesslich Wiederverwendung der in Stage 5A2 gebauten Helfer (`utils/calendarDate.js`: `parseLocalDate`, `formatLocalDate`, `addDaysToDateOnly`, `compareDateOnly`, `todayInTimezone`, `resolveBrowserTimezone`) — keine zweite Datumsbibliothek, keine neuen `new Date("YYYY-MM-DD")`/`toISOString().slice(0,10)`-Vorkommen. Pflicht-Testszenarien abgedeckt: Monats-/Jahreswechsel, Schaltjahr (2024-02-29), CET/CEST-Übergang (2026-03-29, Abstände unabhängig von der Host-Zeitzone per `Date.UTC` in den Tests selbst verifiziert), Zuweisungsstart an einem Sonntag (per echtem `Date.getDay()` unabhängig vom Code unter Test ermittelt), alle 2 Wochen, optionales Enddatum, Enddatum exakt auf einem Vorkommen.

---

## 12. API-Client

Erweiterung von `utils/studioTrainingApi.js` (nicht ein neuer, paralleler Client — Schedule-Rules liegen thematisch und URL-seitig direkt unter den bestehenden Programmzuweisungs-Endpunkten): `getProgramAssignment`, `listScheduleRules`, `createScheduleRule`, `updateScheduleRule`. Ausschliesslich Public-IDs (bestehende `publicId()`-Konvention), zentrale Fehlerbehandlung über das bereits vorhandene `calendarErrors.js` (siehe Abschnitt 13 — keine zweite Fehler-Zuordnungstabelle nötig, die Codes waren dort bereits vollständig hinterlegt).

---

## 13. Fehler- und Konfliktbehandlung

`utils/calendarErrors.js` enthielt bereits **alle** in dieser Phase relevanten Codes (`CALENDAR_SCHEDULE_RULE_CONFLICT`, `CALENDAR_SCHEDULE_RULE_NOT_FOUND`, `CALENDAR_ASSIGNMENT_INACTIVE`, `CALENDAR_PROGRAM_DAY_INVALID`, `CALENDAR_TIMEZONE_INVALID`, `CALENDAR_ENTRY_FORBIDDEN`, `VALIDATION_ERROR`, generische 401/403/404/Fallback) — direkt am Code verifiziert, nicht neu gebaut. Bei 409 (Konflikt) wird nie eine falsche Erfolgsmeldung gezeigt: die Regelliste wird neu geladen, der offene Dialog bleibt offen und zeigt die übersetzte Konfliktmeldung, der Nutzer kann sofort korrigieren.

---

## 14. Anfrageverhalten

Ein Ladevorgang beim Öffnen (Zuweisung, Programmtage, Regeln — Zuweisung zuerst, dann Programmtage und Regeln parallel), keine Pro-Regel-Einzelanfragen. `generation`-Zähler-Muster (identisch zu `ProgramAssignmentsView.vue`/`CalendarView.vue`) schützt gegen veraltete Antworten bei schnellem Studio-/Zuweisungswechsel. Absende-Buttons sind während einer laufenden Anfrage deaktiviert (kein Doppel-Submit, per Test bewiesen). Nach jeder Mutation: gezieltes Nachladen nur der Regelliste, nie ein voller Seiten-Reload.

---

## 15. Responsive

Geprüft bei 390×844 (mobil), 768×1024 (Tablet) und 1440×900 (Desktop): Kopfbereich als responsives Grid, Regelübersicht als Tabelle (Desktop) bzw. Karten (`table-stack`, Mobile), Formulardialoge in einem `Modal.vue` mit angemessener Breite auf beiden Formfaktoren. Kein horizontaler Overflow bei langen Mitglieds-/Programm-/Studionamen (Axe-Test Abschnitt 20 sowie manueller Test mit einem absichtlich langen Namen).

---

## 16. Accessibility

Vollständige Tastaturbedienbarkeit (native `<select>`/`<input type="date">`/Buttons, kein eigenes ARIA-Grid). Bearbeiten-/Deaktivieren-Schaltflächen erhalten einen zusammengesetzten `aria-label` aus Aktion, Programmtagname **und Wochentag** — notwendig, weil derselbe Programmtag mehrfach mit unterschiedlichem Wochentag terminiert sein kann und sonst zwei Schaltflächen mit identischem Namen entstünden (während der E2E-Testerstellung selbst gefunden und in `ScheduleRulesView.vue` korrigiert, bevor es ausgeliefert wurde). `Modal.vue`/`ConfirmDialog.vue` (bestehende Komponenten) liefern Fokus-Bindung, Escape-Schliessen und Fokus-Rückgabe unverändert. Aktiv/Deaktiviert wird über Text **und** Badge-Ton unterschieden, nie nur Farbe. Live-Region für Erfolgs-/Fehlermeldungen über das bestehende Toast-System. Sieben dedizierte Axe-Prüfpunkte (Abschnitt 20).

---

## 17. i18n

Vollständiger `studios.schedule.*`-Baum in DE/EN (`utils/i18n.js`): Kopfbereich, Regelübersicht, Formular (inkl. aller Wiederholungsoptionen), Vorschau, Deaktivieren-Dialog. Wochentagsnamen und Datumsformate ausschliesslich über die bestehenden Intl-basierten Helfer — keine zweite hartkodierte Liste.

---

## 18. Während des manuellen Browser-Tests gefundener und behobener UI-Bug

Die „Zeitraum"-Spalte der Regelübersicht zeigte für Regeln ohne Enddatum fälschlich den wörtlichen Platzhaltertext „Bitte auswählen" (`t('common.noSelection')`, eigentlich für Dropdown-Platzhalter gedacht) statt eines einfachen Gedankenstrichs — sichtbar erst im echten, mit drei realen Regeln gefüllten Browser-Screenshot, nicht in den (dort nicht auf den exakten Zeitraum-Text prüfenden) automatisierten Tests. Behoben: `'—'` statt `t('common.noSelection')`, konsistent mit der bestehenden Konvention in `ProgramAssignmentsView.vue`s eigener „Ende"-Spalte. Nach dem Fix erneut per Screenshot verifiziert.

---

## 19. Vorbestehender, unabhängiger Flaky-Test entdeckt (nicht Teil dieser Phase, dokumentiert statt repariert)

Der bestehende Test `calendar.spec.js` „Persönlicher Ablauf: erstellen, verschieben, bestätigen, verknüpftes Workout öffnen" schlägt in dieser Umgebung wiederholt fehl (Element wird nach dem Verschieben nicht mehr gefunden/aus dem DOM entfernt). **Verifiziert als unabhängig von Stage 5A3**: identischer Fehlschlag reproduziert auf einem sauberen `git worktree` von `main` (Commit `3193f41`), ganz ohne jede Stage-5A3-Änderung. Der Test betrifft ausschliesslich den rein persönlichen Kalender-Verschiebe-Ablauf (keine Programmzuweisung, keine Terminierungsregel) und liegt damit ausserhalb des Auftragsumfangs dieser Phase. Nicht repariert, um keinen unautorisierten Scope-Creep in eine bereits laufende, unabhängige Baustelle zu betreiben — hier transparent dokumentiert statt stillschweigend übergangen oder das Gate geschwächt (z. B. per `test.skip`).

---

## 20. Tests

**Unit** (`utils/scheduleRuleFormat.test.js`, 21 Tests): Wochentag-Zuordnung, Ankerdatum-Vorwärtsrollung (inkl. Monatsgrenze), wöchentlich/alle N Wochen/Enddatum-exakt-auf-Vorkommen/Sonntag-Start/Schaltjahr/Jahresgrenze/CET-CEST, Terminvorschau (Begrenzung, Enddatum, bereits abgelaufen), Wochentagsnamen DE/EN, Wiederholungszusammenfassung alle vier Fälle × beide Sprachen, Sortierung inkl. stabilem Tiebreak.

**Component** (`views/ScheduleRulesView.test.js`, 19 Tests; `views/ProgramAssignmentsView.test.js`, +1 Test): Kopfbereich inkl. Pflichttext, Programmtag-Auflösung nur über die veröffentlichte Version, leerer Zustand mit CTA, lesbare Zusammenfassung statt roher Felder, Sortierung, Deaktiviert-Badge ohne Reaktivierungsoption, Regel erstellen mit korrektem Ankerdatum, Live-Vorschau, Regel bearbeiten ohne Programmtag-Feld, Pflicht-Warntext, PATCH nur mit unterstützten Feldern, Deaktivieren mit exaktem Text, historische Unveränderlichkeit (genau ein Nachladevorgang), 409-Konfliktbehandlung, Fehlercode-Zuordnung, Doppel-Submit-Schutz, Nicht-gefunden-Zustand, eindeutige a11y-Labels, „Zeitplan"-Link für jede Zuweisung unabhängig vom Status.

**E2E** (`e2e/coachScheduling.spec.js`, 2 Szenarien): (1) vollständiger Coach-zu-Member-Ablauf — drei Regeln über drei Wochentage setzen, Regelübersicht und Zusammenfassungen prüfen, eine Regel bearbeiten (Pflichtwarnung), eine Regel deaktivieren (bleibt sichtbar, verliert Deaktivieren-Aktion), Member-Kalender zeigt den automatisch generierten „Heute fällig"-Termin, Start und Abschluss der Trainingseinheit über die bestehende Session-Ausführungsoberfläche, Rückkehr zeigt „Abgeschlossen" ohne doppelten persönlichen Eintrag, abschliessend Beweis der Historien-Unveränderlichkeit (Regel-Wochentag später geändert, der bereits abgeschlossene historische Termin bleibt unverändert abgeschlossen); (2) Rollen/Berechtigungen — Trainer mit eigener Coaching-Beziehung hat vollen Zugriff, ein zweiter Trainer ohne Beziehung erhält bei manipulierter Zuweisungs-ID „nicht gefunden" (nie die echten Daten) und sieht die Zuweisung auch in der eigenen, trainer-skopierten Liste nicht, ein Mitglied wird bei direkter Navigation zur Schedule-URL auf „Zugriff verweigert" umgeleitet.

**Axe** (`e2e/accessibility.spec.js`, +1 dediziertes Szenario, 7 Prüfpunkte): leerer Zustand (Desktop), Erstellen-Dialog, gefüllte Liste (Desktop), Bearbeiten-Dialog, Deaktivieren-Bestätigungsdialog, mobile Ansicht (390×844), Desktop 1440×900 — jeweils ohne schwere/kritische Verstösse, kein horizontaler Overflow.

---

## 21. Regression

Backend: `npm test` (Unit 508/508, Integration 253/253 inkl. der zuvor MinIO-abhängigen Remote-Backup-Suite nach Start des lokalen MinIO-Testcontainers, Migrations 32/32, Syntax 230 Dateien), `npm run audit:security` (0 Schwachstellen). Frontend: `npx vitest run` (499/499), `npm run build` (erfolgreich), `npm audit` (0 Schwachstellen). E2E: vollständiger Lauf über alle Spezifikationsdateien — 52 bestanden, 1 vorbestehender, unabhängiger Fehlschlag (Abschnitt 19), 6 aufgrund des seriellen Testmodus derselben Datei übersprungen und einzeln nachweislich grün verifiziert; beide neuen Coach-Scheduling-Szenarien sowie der neue Axe-Test grün, mehrfach reproduziert.

---

## 22. Migration Doctor

Unverändert: `ready:true, applied:12, pending:0, dirty:0, drift:0, unknown:0, schemaIssues:0, ledgerIssues:0` — Migration `012_unified_training_calendar` bleibt die letzte, **keine** Migration 013 wurde erstellt.

---

## 23. Abgrenzung

Nicht Teil dieser Phase: neues Kalender-Datenmodell, Migration 013, Massenterminierung über mehrere Mitglieder gleichzeitig, Drag-and-drop-Kalenderoberfläche, Reaktivierung deaktivierter Regeln, Cloud-Infrastruktur, externe Kalenderintegration, Push-Benachrichtigungen, E-Mail-Erinnerungen. Nach Stage 5A3 wurde keine weitere Phase begonnen.
