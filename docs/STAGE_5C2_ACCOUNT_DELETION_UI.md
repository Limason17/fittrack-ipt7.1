# Stage 5C2: Account Deletion UI / Profile Danger Zone

Ausgangs-Commit: `a3800ed` (main, PR #27 "Merge... feature/stage-5c1-account-deletion-backend"), Branch `feature/stage-5c2-account-deletion-ui`. Diese Phase liefert die **Frontend-Oberfläche** für die in Stage 5C1 bereits vollständig implementierte, backendseitige Self-Service-Kontolöschung: eine klar abgegrenzte "Gefahrenbereich"-Sektion im Profil, einen Preview-Dialog mit den tatsächlichen, vom Backend gelieferten Auswirkungen, einen Sole-Owner-Blocker, einen zweiten expliziten Bestätigungsschritt (Passwort + Bestätigungsphrase) und den vollständigen Erfolgs-/Auth-Cleanup-Flow. **Es wird keine neue Backend-Fachlogik eingeführt** — die UI liest ausschliesslich den bereits gemergten Stage-5C1-Vertrag (`GET /api/account/deletion-preview`, `POST /api/account/deletion-request`).

Referenzdokumente: [`STAGE_5C1_ACCOUNT_DELETION_BACKEND.md`](./STAGE_5C1_ACCOUNT_DELETION_BACKEND.md) (der tatsächliche, hier verwendete API-Vertrag), [`STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md`](./STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md), [`adr/004-personal-data-deletion-and-retention.md`](./adr/004-personal-data-deletion-and-retention.md).

---

## 1. Ziel

Im Profil (`ProfileView.vue`, Tab "Sicherheit") soll ein Benutzer sein FitTrack-Konto irreversibel selbst löschen können, ausschliesslich basierend auf Daten, die der Preview-Endpunkt tatsächlich liefert — die UI baut **keinen eigenen, zweiten Deletion Planner**.

## 2. UX-Ablauf

1. Profil öffnen, Tab "Sicherheit".
2. Neue Sektion "Gefahrenbereich" ist sichtbar, aber nicht alarmistisch (neutrale Eyebrow-Beschriftung, kein rot eingefärbter Kartenrahmen — die destruktive Farbe ist ausschliesslich den beiden tatsächlichen Lösch-Buttons vorbehalten).
3. Klick auf "Konto löschen" öffnet einen Dialog und lädt **ausschliesslich** die aktuelle Preview vom Backend — noch keine destruktive Aktion.
4. Ohne Blocker: strukturierte Anzeige der Auswirkungen, danach ein zweiter, expliziter Bestätigungsschritt (aktuelles Passwort + exakte Bestätigungsphrase).
5. Bei Blocker (alleiniger aktiver Owner): sachliche Erklärung, betroffene Studio-Namen, kein Execute-Pfad erreichbar.
6. Erfolg: lokaler Auth-/Studio-State wird geleert, Redirect zu `/login`, einmalige neutrale Erfolgsmeldung.

## 3. Danger Zone (Platzierung)

Neue Komponente `frontend/src/components/profile/AccountDeletionDangerZone.vue`, eingehängt am Ende des bestehenden `security`-Tabs in `ProfileView.vue` (nach der E-Mail-Sektion) — kein neuer Hauptnavigationspunkt, kein neuer Tab. Gewählt statt des "Konto"-Tabs, da der Sicherheits-Tab bereits alle anderen kontobezogenen, irreversiblen/destruktiven Aktionen bündelt (Logout-all, Passwortänderung), und weil Passwort-Eingabe für die Bestätigung dort thematisch erwartet wird.

Titel/Text exakt wie vorgegeben ("Gefahrenbereich" / "Konto dauerhaft löschen" / Beschreibung ohne Rechtsgarantie). Primärer Einstiegs-Button: "Konto löschen" (nicht "Jetzt endgültig löschen").

## 4. Preview-Dialog

Ein einziges, persistentes `Modal` (wiederverwendete `components/ui/Modal.vue`, `size="lg"`) hostet beide Schritte (`step: 'preview' | 'confirm'`) — kein Schliessen/Neuöffnen zwischen den Schritten, damit der Fokus-Trap durchgängig bestehen bleibt.

Beim ersten Klick: `getAccountDeletionPreview()` (neue Funktion in `utils/accountApi.js`, nutzt die zentrale `apiRequest`-Utility wie jede bestehende Account-API-Funktion), Loading-State (`aria-busy="true"`, `aria-live="polite"`), Fehler sicher angezeigt (`role="alert"`, kein Crash), kein Execute-Request.

### Impact-Gruppen

- **Wird entfernt**: `personalDataCounts` (workouts/progressEntries/personalExercises) + `impact` (personalCalendarEntriesToDelete, runningWorkoutSessions, activeAssignments, activeCoachingRelationships, activeScheduleRules, futureStudioCalendarEntries).
- **Kann erhalten bleiben**: `preservedHistoryCounts` (studioWorkoutSessions, programAssignments, coachFeedbackReceived, coachFeedbackAuthored).
- **Hinweise**: `notices.freeTextRetention` und `notices.backupRetention` **wörtlich vom Backend**, plus ein statischer, UI-eigener Hinweis zur E-Mail-Wiederverwendbarkeit (durch Stage-5C1s eigene Integrationstests belegt: Anonymisierung setzt die Original-E-Mail sofort frei, Hard Delete lässt ohnehin keine Zeile zurück).

**Zero-Count-Entscheidung (einheitlich, Abschnitt 7 der Aufgabe):** Innerhalb jeder Gruppe wird nur eine Zeile für Zählwerte `> 0` gerendert; ist eine ganze Gruppe leer, erscheint ein einziger "Keine."-Platzhalter statt einer langen Nullen-Liste. Keine erfundenen Zahlen — jede angezeigte Zahl kommt unverändert aus der Preview-Response.

`mode` (`hard_delete`/`anonymize`) wird nirgends als rohes Backend-Enum angezeigt — die UI beschreibt nur die tatsächlichen Auswirkungen, nicht die interne Strategie.

## 5. Sole-Owner-Blocker

`preview.blockers` (nicht leer) ersetzt die Impact-Gruppen durch eine sachliche, `message-warning`-gestaltete Box: feste Erklärung ("Vor der Kontolöschung muss mindestens ein weiterer aktiver Owner vorhanden sein."), Liste der betroffenen Studio-**Namen** (aus `blocker.studios[].studioName` — nie `studioId`, obwohl dieses bereits die öffentliche Projektion ist, wird es aus Abschnitt 8 der Aufgabe ausdrücklich nicht angezeigt). Kein "Weiter"-Button, kein Passwort-/Phrase-Feld erreichbar, keine automatische Owner-Übertragung angeboten. Einziger Button: "Verstanden" (schliesst den Dialog).

**Owner-Race (409 bei Execute trotz blockerfreier Preview):** `ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED` beim Execute-Aufruf lässt den Dialog offen, springt zurück auf den Preview-Schritt und lädt die Preview neu — nie eine falsche Erfolgsmeldung.

## 6. Zweistufige Bestätigung

Zweiter, expliziter Schritt: aktuelles Passwort (`type="password"`, `autocomplete="current-password"`) und Bestätigungsphrase (`type="text"`, `autocomplete="off"`, kein Autofill, kein Copy/Paste-Verbot). Die erwartete Phrase ist laut Stage-5C1-Vertrag (`confirmationPhrase: {type:'username'}`, tatsächlicher Vergleich in `accountDeletionService.js`: `input.confirmationPhrase !== user.username`) exakt der eigene Benutzername — die UI zeigt ihn explizit als Hinweistext und vergleicht **exakt, ohne Trimmen** gegen `authUser.value.username` (bereits im lokalen Auth-State vorhanden). Submit ist deaktiviert bei leerem Passwort, bei nicht exakt passender Phrase, während eines laufenden Requests und während einer aktiven Rate-Limit-Sperrfrist. Der Backend-Vergleich bleibt in jedem Fall die massgebliche, erneut geprüfte Instanz — kein Client-only-Vertrauen.

Destruktiver Button: "Konto endgültig löschen". Doppelclick-Schutz: `submitting`-Ref wird synchron vor dem `await` gesetzt und am Funktionsanfang erneut geprüft (Re-Entrancy-Guard), zusätzlich zu `:disabled`.

## 7. Fehlerzustände

| Backend | UI |
|---|---|
| `CURRENT_PASSWORD_INVALID` (401) | Feldbezogener Fehler am Passwortfeld, Passwort geleert, Phrase bleibt erhalten |
| `ACCOUNT_DELETION_PHRASE_MISMATCH` (400) | Feldbezogener Fehler an der Phrase (normalerweise clientseitig schon verhindert, Backend bleibt aber massgebend) |
| `ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED` (409) | Zurück zum Preview-Schritt, Preview neu laden |
| `ACCOUNT_ALREADY_DELETED` (409) | Wie ein lokaler Erfolg behandelt (das Konto ist in jedem Fall bereits weg — ein zweiter Tab oder ein Retry hat die Löschung bereits abgeschlossen; eine "das hat nicht geklappt"-Meldung wäre hier schlicht falsch) |
| Status 429 | Rate-Limit-Meldung + Countdown (bestehendes `createRetryCountdown()`), Submit bis dahin deaktiviert |
| Status 503 (jeder Receipt-/Service-Code) | Ausschliesslich die feste, neutrale Meldung — bewusst nach `status===503` gematcht statt jeden einzelnen `DELETION_RECEIPT_*`/`ACCOUNT_DELETION_SERVICE_UNAVAILABLE`-Code aufzuzählen, damit nie ein internes Detail (Receipt, HMAC, Doctor, Reconciliation) die Fehlerzuordnung erreichen muss |
| Genereller 401 (Session-Invalidierung) | Bereits durch die bestehende `apiRequest`-401-Behandlung abgedeckt (`utils/api.js`: Silent-Refresh-Versuch, danach `notifySessionInvalidated()` + Redirect) — keine eigene Sonderbehandlung nötig |

## 8. Erfolgsflow

Nach `2xx` von `POST /account/deletion-request`:

1. Passwort/Phrase/Preview aus Component-State entfernt (`resetDialogState()`).
2. `clearAuthState()` (aus `utils/auth.js`) — **kein** `logout()`/`logoutAll()`-Aufruf: die Löschtransaktion hat bereits jede Session serverseitig widerrufen und `clearSessionCookies(res)` in genau dieser Antwort bereits ausgeführt (`accountRouter.js`), ein weiterer authentifizierter Request wäre sinnlos gegen ein Konto, das nicht mehr existiert/authentifizieren kann.
3. `clearAuthState()` führt automatisch jeden über `registerAuthCleanup()` registrierten Handler aus — **`clearStudioContext()` ist dadurch bereits abgedeckt** (`studioContext.js` registriert sich selbst beim Modul-Load), kein zusätzlicher Aufruf nötig.
4. `router.push({name:'login'})`.
5. `toastSuccess('Dein Konto wurde gelöscht.')` — bewusst **nicht** "Alle deine Daten wurden vollständig gelöscht." (wegen historischer Retention/Backups falsch). Der bestehende, globale `ToastHost` sitzt ausserhalb des `router-view` in `App.vue` und übersteht die Client-Side-Navigation unverändert — kein neuer Query-Parameter-Mechanismus auf der Login-Seite nötig, kein `localStorage` für den Erfolgstext.

## 9. Accessibility

Wiederverwendet die bestehende, bereits getestete `Modal.vue`/`useModalFocus()`-Infrastruktur (`role="dialog"`, `aria-modal`, `aria-labelledby`, vollständiger Fokus-Trap, Fokus-Rückgabe an den auslösenden Button). Escape/Backdrop-Klick werden über den gemeinsamen `@close`-Handler geleitet, der während eines laufenden Execute-Requests (`submitting===true`) das Schliessen **ignoriert** — Escape schliesst also nur vor einem laufenden Execute, wie gefordert. Kein `data-autofocus` auf dem endgültigen Lösch-Button — der initiale Fokus landet auf dem sicheren "Abbrechen"/"Verstanden"-Button (Preview-Schritt) bzw. wird beim Wechsel in den Confirm-Schritt manuell auf das Passwortfeld gesetzt. Passwort- und Phrase-Felder haben explizite `<label for>`-Zuordnungen; Fehler sind über `aria-describedby`/`aria-invalid` programmatisch verknüpft, nie nur farblich kodiert.

## 10. Mobile/Responsive

Keine neuen Layout-Primitiven — der Dialog nutzt dieselbe `Modal.vue` (`max-width: 680px` bei `size="lg"`, `overflow-y: auto`, `max-height: min(640px, 100dvh - 2rem)`), die bereits für `CalendarEventDetailDialog.vue` bei 390px/768px/1024px/1440px verifiziert ist. Listen/Studio-Namen brechen über `overflow-wrap: anywhere`.

## 11. E2E

Neue Datei `frontend/e2e/accountDeletion.spec.js`, drei Szenarien: normaler User mit Studiohistorie (zwei Owner, keine Blockade, volle Löschung inkl. altem-Token/Silent-Refresh/altem-Login-unbrauchbar-Nachweis und erhaltener anonymisierter `left`-Mitgliedschaft), alleiniger Owner (Blocker sichtbar, kein Execute-Pfad, Konto bleibt aktiv), Hard Delete (kein Studio-Bezug, persönliche Übung bleibt nie global sichtbar, E-Mail sofort wiederverwendbar). Setup (Studio/zweiter-Owner-Erhebung über Einladung+Rollenwechsel) läuft über die reale API, nicht über eine Testdatenbank-Direktmanipulation.

## 12. Security Boundaries (eingehalten)

Keine echten Benutzerkonten gelöscht (ausschliesslich E2E-Fixture-Konten gegen die disponible E2E-Datenbank). Keine Passwort-/Phrase-Werte geloggt (durch Component-Design: Fehlerzuordnung liest ausschliesslich `error.status`/`error.data.error.code`, nie die Eingabewerte selbst). Keine Account-Deletion-Response mit sensitivem Inhalt geloggt. Kein Bestätigungsdialog wird automatisch ausgeführt. Keine Abschwächung der Backend-Owner-/Passwort-/Rate-Limit-/Origin-Prüfungen — die UI dupliziert keine Sicherheitsentscheidung, sie zeigt nur, was das Backend bereits entschieden hat.

## 13. Bekannter, entdeckter Backend-Defekt (nicht in dieser Phase behoben — Blocker)

Während der Implementierung des E2E-Flows wurde ein **echter, vorbestehender Stage-5C1-Backend-Defekt** entdeckt: `backend/routes/accountRouter.js` registriert `rateLimiters.deleteRequest` **vor** `authenticate` auf `POST /account/deletion-request`. Der Policy-Schlüssel `account.deleteRequest` (`rateLimiting/rateLimitPolicies.js`, `userKey("account-delete")`) liest `req.user?.id` — zum Zeitpunkt, an dem der Limiter tatsächlich läuft, hat `authenticate` aber noch nicht ausgeführt, `req.user` ist also **immer** `undefined`. Jeder Aufruf dieses Endpunkts kollabiert dadurch faktisch auf **einen einzigen, geteilten** `"account-delete|user:anon"`-Bucket (3 Versuche/60min), unabhängig davon, welcher echte Benutzer aufruft — statt, wie dokumentiert und vom bestehenden Unit-Test (`test/unit/rateLimiter.test.js`, "...is keyed per user...") behauptet, pro Benutzer isoliert zu sein. Jener bestehende Test prüft das nicht wirklich: er setzt `req.user` manuell **vor** dem Limiter-Aufruf, was nicht der echten Route-Reihenfolge entspricht.

**Praktische Auswirkung:** In produktivem Mehrbenutzerbetrieb kann ein einzelner Benutzer (oder ein einzelner falscher Versuch) das Lösch-Kontingent für **alle anderen** Benutzer im selben 60-Minuten-Fenster mit erschöpfen — sowohl ein Denial-of-Service-Risiko gegen die legitime Self-Service-Löschung als auch schlicht ein irreführend enges, geteiltes Kontingent bei normaler gleichzeitiger Nutzung.

**Bewusst nicht behoben in dieser Phase:** Stage 5C2 ist explizit auf das Frontend beschränkt ("Keine neue Backend-Fachlogik implementieren"); die Korrektur (Vertauschen der Middleware-Reihenfolge in `accountRouter.js`) ist eine Backend-Routing-Änderung und wird hier nicht vorgenommen. Stattdessen: minimaler, reproduzierbarer Unit-Test hinzugefügt (`backend/test/unit/rateLimiter.test.js`, Test "KNOWN DEFECT (Stage 5C1, reported not fixed - see Stage 5C2 docs): ..."), der das heutige (defekte) Verhalten exakt dokumentiert und als Regressionstest für eine künftige Korrektur bereitsteht. Als direkte, nicht-fachliche Test-Fixture-Anpassung wurde der E2E-Normalfall so umgebaut, dass er den geteilten Bucket nicht unnötig strapaziert (der bereits am Komponenten-Unit-Test abgedeckte "falsches Passwort"-Teilschritt wurde aus dem E2E-Fluss entfernt, um innerhalb eines einzigen Testlaufs nicht in den Effekt dieses Defekts zu laufen).

**Empfehlung:** In einer eigenen, kleinen Backend-Korrektur `authenticate` vor `rateLimiters.deleteRequest` in `accountRouter.js` platzieren (wie es für die übrigen bestehenden Account-Endpunkte ohnehin bereits so verdrahtet ist — `change-password`/`email-change-requests` registrieren den Rate Limiter ebenfalls vor `authenticate`, das Muster ist also **nicht** auf `deleteRequest` beschränkt und sollte projektweit geprüft werden), danach den bestehenden "is keyed per user"-Unit-Test so erweitern, dass er `req.user` **nicht** vorab setzt, sondern die reale Middleware-Kette über den echten Router exerciert.

## 14. Bekannte Einschränkungen

- Kein Datenexport, keine Admin-Löschung fremder Konten, keine Studio-Membership-Removal-UI, keine automatische Owner-Übertragung, keine Freitextbereinigung — alle bewusst ausserhalb dieser Phase (siehe Auftrag Abschnitt "Nicht implementieren").
- Keine Rechtsgarantie über eine vollständige physische Datenlöschung — die UI-Texte behaupten das an keiner Stelle; Backups können gelöschte Daten gemäss der dokumentierten Retention-Frist noch enthalten, Freitext bleibt unverändert bestehen.
- Der in Abschnitt 13 beschriebene Rate-Limit-Schlüssel-Defekt ist ein vorbestehender Stage-5C1-Fund, hier dokumentiert und mit einem Regressionstest versehen, aber nicht behoben.
- Der zentrale `apiRequest`-401-Silent-Refresh-Mechanismus (`utils/api.js`) retryt bei jedem 401 mit vorhandenem Token einmal automatisch, bevor der Fehler den Aufrufer erreicht — bei `CURRENT_PASSWORD_INVALID` (ebenfalls 401) bedeutet das, dass ein einzelner falscher Passwortversuch serverseitig als **zwei** tatsächliche `POST /deletion-request`-Aufrufe ankommt. Dieses Verhalten ist identisch zur bestehenden Passwortänderung (`change-password`, selbes Muster, selbe Ursache) und damit kein neues, durch diese Phase eingeführtes Problem — in Kombination mit dem in Abschnitt 13 beschriebenen geteilten Rate-Limit-Bucket verschärft es dessen praktische Auswirkung jedoch zusätzlich.

## 15. Nächste Phase

Empfohlen: die in Abschnitt 13 dokumentierte Rate-Limiter-Reihenfolge-Korrektur (klein, isoliert, projektweite Prüfung sinnvoll), danach optional Studio-Membership-Removal-UI und/oder ein Datenexport-Feature ("Recht auf Datenübertragbarkeit") als jeweils eigene, jeweils kleine Phasen.
