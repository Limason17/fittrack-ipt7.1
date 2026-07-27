# Stage 5B: Product & Pilot Readiness Audit

> **Stand:** 2026-07-27 · Branch `audit/stage-5b-product-pilot-readiness` · Basis: `main`
> Merge-Commit `41f2f31` (PR #23, Stage 5A3 Coach Scheduling UI), Arbeitsbaum zum
> Zeitpunkt dieses Audits sauber (keine unversionierten Änderungen ausser diesem
> Dokument und den beiden weiter unten genannten Statusdokument-Ergänzungen).
>
> Dieses Dokument ist ein **reines Audit**. Es wurden im Rahmen dieser Arbeit
> **keine Produktionsdateien, keine Testdateien, keine Konfigurationsdateien und
> keine Migrationen** geändert, keine Cloud-Infrastruktur eingerichtet und keine
> neue Entwicklungsphase begonnen. Jede Aussage in diesem Dokument ist entweder
> durch (a) einen Verweis auf konkreten Code (Datei:Zeile), (b) einen tatsächlich
> ausgeführten Testlauf mit hier zitiertem Ergebnis, (c) eine bestehende
> Projektdokumentation, oder (d) einen tatsächlich ausgeführten, reproduzierbaren
> Browserablauf (bestehende Playwright-E2E-Spezifikationen plus ein für dieses
> Audit geschriebenes, real gegen den lokalen Stack ausgeführtes und danach
> wieder entferntes Zusatzskript) belegt. Wo eine Aussage nicht auf diese Weise
> verifiziert werden konnte, ist das explizit als Lücke vermerkt statt
> stillschweigend angenommen.

## Inhaltsverzeichnis

1. Executive Summary
2. Auftrag, Abgrenzung und Methodik
3. Dokumentenprüfung (Aktualität und Widerspruchsfreiheit)
4. Architekturaufnahme — Frontend
5. Architekturaufnahme — Backend
6. Architekturaufnahme — Datenbank
7. Lokale Testumgebung
8. Vollständige Regression — Backend
9. Vollständige Regression — Frontend
10. Migrationen und Migration Doctor
11. Vollständige Chromium-E2E-/Accessibility-Suite
12. Owner-Rollendurchlauf
13. Admin-Rollendurchlauf
14. Trainer-Rollendurchlauf und Daily-Usability
15. Member-Rollendurchlauf (inkl. Mobile 390×844)
16. Cross-Role End-to-End-Szenario
17. UX-Heuristik-Bewertung zentraler Ansichten
18. Onboarding-Bewertung
19. Daily-Operations-Audit
20. Daten- und Verlaufskonsistenz
21. Sicherheits- und Datenschutz-Audit
22. Betrieb und Support
23. Kommerzielle Glaubwürdigkeit
24. Bekannte Einschränkungen und bewusst offene Punkte
25. Befundregister — Methodik und Übersicht
26. Befunde P0 (Blocker)
27. Befunde P1 (vor Pilot erforderlich)
28. Befunde P2 (während des Pilots nützlich)
29. Befunde P3 (später)
30. Pilot Go/No-Go-Matrix
31. Zentrale Frage: Ist FitTrack pilotbereit? (17 Dimensionen)
32. Empfehlung für die nächste Entwicklungsphase
33. Artefakt-Handhabung und Bereinigung
34. Abgrenzung — was dieses Audit nicht leistet
35. Schlussfolgerung

---

## 1. Executive Summary

**Zentrale Frage: Ist FitTrack bereit, mit einem kleinen realen Pilotstudio
getestet zu werden? Antwort: Ja, mit einer Bedingung.**

Dieses Audit hat die vollständige Backend-Regression (508 Unit-, 254
Integrations- inkl. Off-host-Backup-, 32 Migrations-Tests, 0 Schwachstellen
≥ high), die vollständige Frontend-Regression (499 Tests, 0 Schwachstellen,
erfolgreicher Produktionsbuild), die vollständige Chromium-E2E-/Axe-Suite
(**59 bestanden, 0 fehlgeschlagen, 0 übersprungen**, keine „serious“/„critical“-
Axe-Funde) und die Migrationsprüfung (`ready:true, applied:12, pending:0,
dirty:0, drift:0, unknown:0, schemaIssues:0, ledgerIssues:0`) real ausgeführt
— alle mit exakt dem geforderten Zielergebnis. Zusätzlich wurde ein
vollständiges, doppelt unabhängig belegtes 18-Schritte-Cross-Role-Szenario
(Owner→Trainer→Member über Studio-Gründung, Coaching, Programm,
Terminierung, Kalender, Trainingsausführung, Feedback, Audit-Log, inklusive
expliziter Verlaufskonsistenz nach nachträglicher Regeländerung) real gegen
den lokalen Stack durchgeführt, ergänzt durch 39 echte Bildschirmfotos über
alle vier Rollen und Mobile 390×844.

**Ergebnis: 0 P0-Blocker.** Kein Datenverlust, kein Cross-Tenant-Leck, kein
kritisches Auth-Versagen, kein unmöglicher Kernablauf wurde gefunden. Ein
**P1-Befund** (kein Prozess für Löschung/Anonymisierung echter Personendaten
— vor Aufnahme realer, nicht-anonymer Teilnehmer:innen zumindest manuell zu
klären) und drei **P2-Befunde** (die Studio-Übersicht liefert für
Owner/Admin/Trainer keine operative Tagesübersicht, obwohl alle dafür nötigen
Rohdaten bereits existieren; neuere Kalender-/Terminierungs-Audit-Ereignisse
erscheinen unübersetzt; das Onboarding hat kein Bereitschaftssignal/keine
Vorlagen) sind das Kernresultat. Zehn kleinere **P3-Befunde** — überwiegend
Dokumentationsaktualität und ein kosmetisches Toast-Layout-Detail — runden
das Bild ab.

Die Prüfung deckt sich mit und aktualisiert die Vorgängerdokumente: zwei der
in `docs/FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` weiterhin als offen
gelisteten Punkte (CORS, Rate-Limiting) sind tatsächlich seit Stage 3D
gelöst — die Dokumentliste war nicht mit ihrem eigenen Nachtrag
synchronisiert; `README.md`, `FITTRACK_API_CATALOG.md` und
`FITTRACK_VIEW_CATALOG.md` sind in einzelnen Aussagen veraltet, ohne
Sicherheitsrelevanz. Die einzige empfohlene nächste Entwicklungsphase ist
**kein** weiteres Kalender-Feature, sondern ein schlankes
„Studio Operations Dashboard“ (Abschnitt 32), das genau die real
dokumentierte operative Lücke schliesst. Details, Belege und die vollständige
26-Bereiche-Go/No-Go-Matrix in den folgenden 34 Abschnitten.

---

## 2. Auftrag, Abgrenzung und Methodik

### 2.1 Auftrag

Dieses Audit beantwortet ausschliesslich eine Frage: **Ist FitTrack in seinem
aktuellen Zustand bereit, mit einem kleinen realen Pilotstudio und echten
Trainer:innen sowie Members getestet zu werden?** Es ist kein Freigabe-Gate für
eine Produktionsbereitstellung und keine Entwicklungsphase. Es wurde auf einem
dedizierten Branch (`audit/stage-5b-product-pilot-readiness`, abgezweigt von
`main` bei `41f2f31`) durchgeführt; dieser Branch enthält ausschliesslich
Dokumentationsänderungen (dieses Dokument sowie Ergänzungen an drei
bestehenden Statusdokumenten) und wird nicht nach `main` gemergt.

### 2.2 Explizite Abgrenzung während der Auditdurchführung

Im Rahmen dieses Audits wurden **nicht** durchgeführt: die Implementierung
neuer Produktfunktionen, die Reparatur bestehender Fehler (auch wenn während
der Regression welche reproduziert wurden — siehe Abschnitt 25 zur
Behandlung), das Anlegen einer neuen Migration, das Einrichten realer
Cloud-Infrastruktur (kein echter S3-Bucket, kein echter SMTP-Versand, kein
Hosting), und der Beginn einer weiteren Entwicklungsphase. Wo die Regression
von den erwarteten Ergebnissen abwich, wurde dies reproduziert, eingegrenzt
und als Befund dokumentiert statt repariert — dies kam im Rahmen der
eigentlichen Testsuiten nicht vor (siehe Abschnitte 8–11); der einzige
beobachtete Abweichungsfall war eine bewusst fail-closed greifende
Sicherheitssperre (Abschnitt 8.3) und ein umgebungsbedingter Git-Bash/Windows-
Pfadkonvertierungs-Effekt beim Frontend-Produktionsbuild (Abschnitt 9.2), kein
Produktdefekt.

### 2.3 Methodik und Beweisdisziplin

Jede Tatsachenbehauptung in diesem Dokument stützt sich auf eine von vier
Quellen, die jeweils explizit benannt wird:

- **Code** (Datei:Zeile-Referenzen aus einer gezielten Architekturaufnahme,
  nicht aus einer oberflächlichen Dateiliste),
- **Tests** (tatsächlich in dieser Sitzung ausgeführte Backend-, Frontend- und
  E2E-Suiten; Ergebnisse wörtlich zitiert),
- **Dokumentation** (bestehende Projektdokumente, mit expliziter
  Aktualitätsbewertung statt blinder Übernahme — Abschnitt 3),
- **Reproduzierbarer Browserablauf**: Dieses Projekt verfügt über keine
  interaktive Browser-Fernsteuerung als Werkzeug für diese Sitzung. Statt
  einzelne Klicks zu simulieren oder — schlimmer — Verhalten aus dem Code
  zu *behaupten*, wurden zwei Klassen von echten, gegen den lokalen Stack
  laufenden Chromium-Sitzungen als Beweismittel herangezogen:
  1. die bestehende, 59 Tests umfassende Playwright-E2E-/Axe-Suite
     (`frontend/e2e/*.spec.js`), die bereits reale, ungemockte
     Rollen-Durchläufe für Owner/Admin/Trainer/Member sowie einen
     vollständigen Coach-zu-Member-Terminierungs-Ablauf **inklusive** eines
     expliziten Verlaufskonsistenz-Tests enthält (`coachScheduling.spec.js`,
     siehe Abschnitt 16.3), und
  2. ein für dieses Audit eigens geschriebenes, temporäres Zusatzskript
     (`frontend/e2e/_stage5bAuditCapture.spec.js`), das über dieselbe
     Playwright-Server-Infrastruktur ein realistisches Pilotstudio mit
     gemischten Zuständen aufbaut (aktive/inaktive Mitglieder, offene
     Einladung, abgeschlossenes und geplantes Training) und dabei an jeder
     zentralen Ansicht einen echten Screenshot (Desktop und, wo relevant,
     Mobile 390×844) aufzeichnet. Dieses Skript wurde **nie committet** und
     nach Abschluss der Auswertung wieder gelöscht (Abschnitt 33); die
     Screenshots liegen ausserhalb des Repositories und werden ebenfalls
     nicht committet.

  Dieser methodische Kompromiss wird hier bewusst offengelegt statt
  verschwiegen: Wo eine Aussage nur auf (1) oder (2) beruht statt auf einer
  interaktiven Live-Sitzung mit einem menschlichen Tester, ist das im
  jeweiligen Abschnitt vermerkt.

Es gilt ausdrücklich **keine wohlwollende Bewertung**: Wo ein Befund negativ
ausfällt, wird er als P0–P3 klassifiziert, nicht relativiert.

---

## 3. Dokumentenprüfung (Aktualität und Widerspruchsfreiheit)

Geprüft wurden `README.md`, `docs/FITTRACK_CURRENT_STATUS.md`,
`docs/FITTRACK_NEXT_PHASE_RECOMMENDATION.md`,
`docs/FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`,
`docs/FITTRACK_API_CATALOG.md`, `docs/FITTRACK_VIEW_CATALOG.md`,
`docs/STAGE_3A_LOCAL_PILOT_READINESS_AUDIT.md`,
`docs/STAGE_4A_FINAL_LOCAL_ACCEPTANCE.md`,
`docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md`,
`docs/STAGE_5A2_PERSONAL_CALENDAR_UI.md`, `docs/DEPLOYMENT.md`,
`docs/BACKUP_RESTORE.md`, `docs/MIGRATION_RECOVERY.md`,
`docs/LOCAL_PILOT_RUNBOOK.md`, alle drei ADRs unter `docs/adr/`,
`.github/workflows/ci.yml` und `backend/.env.example`, jeweils vollständig.

| Dokument | Klassifikation | Begründung |
|---|---|---|
| `README.md` | **unvollständig** | Aktuelle Feature-Liste (Sessions, Coaching, Programme, Audit, Rate-Limiting, CORS) korrekt, aber **erwähnt den Kalender/Coach-Terminierung (Stage 5A1–5A3) nirgends** — der lokale Startbefehl und die Testbefehle sind weiterhin korrekt. |
| `docs/FITTRACK_CURRENT_STATUS.md` | **aktuell und korrekt** (mit Vorbehalt) | Gefrorener Hauptteil (Stand PR #7) plus lückenlose, datierte Nachtrag-Kette bis Stage 5A3 — inhaltlich korrekt, aber nur im Zusammenspiel aller Nachträge lesbar; ein neuer Leser muss den ganzen Nachtrag-Anhang lesen, um den echten aktuellen Stand zu bekommen (bewusste, dokumentierte Konvention, keine neue Lücke). |
| `docs/FITTRACK_NEXT_PHASE_RECOMMENDATION.md` | **aktuell und korrekt** | Letzter Nachtrag (Stage 5A3) erklärt die Kalender-Linie (Backend → persönliche UI → Coach-Terminierung) für inhaltlich abgeschlossen und empfiehlt **keinen** zwingenden nächsten Schritt, ausser dem seinerzeit noch offenen Flaky-Test — der ist seit der Merge-Readiness-Nachbereitung (Stage 5A3) tatsächlich behoben; diese eine Handlungsempfehlung ist damit gegenstandslos, der Rest des Dokuments bleibt korrekt. Abschnitt 32 dieses Audits liefert die hier fehlende, neue Empfehlung. |
| `docs/FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` | **widersprüchlich** | Die Liste „Auffällige Lücken" führt Punkt 7 (CORS ungetestet) und Punkt 8 (Rate-Limiter pro Prozess) weiterhin auf, **ohne Durchstreichung**, obwohl der eigene Stage-3D-Nachtrag im selben Dokument beide ausdrücklich als gelöst bezeichnet. Der Code bestätigt Stage 3D: CORS ist vollständig validiert (`backend/config/corsOrigins.js`, s. Abschnitt 5.3) und der Rate-Limiter ist seit Migration 011 ein gemeinsam genutzter, atomarer MySQL-Store (s. Abschnitt 5.4) — es handelt sich um einen **Dokumentationsfehler** (Liste nicht mit eigenem Nachtrag synchronisiert), nicht um einen fortbestehenden Produktmangel. Alle übrigen Einträge (kein Recht auf Löschung/Anonymisierung, `coachActionEligibility` totes Codestück, einzelne DB-Rolle) sind weiterhin real offen (Abschnitt 21). |
| `docs/FITTRACK_API_CATALOG.md` | **veraltet** | Stand 2026-07-20, Stage 1B.2B2B — die eigene Schlusszusammenfassung behauptet, die gesamte Workout-Session-Gruppe habe „keinen Frontend-Aufrufer", was seit Stage 1B.2B2A/1B.2B2B nicht mehr zutrifft; Kalender/Terminierung/Account-Selbstverwaltung/Sitzungs-Härtung fehlen komplett. War nicht Teil der vom Auftraggeber genannten Pflichtlektüre, ist aber ein Dokument mit direktem Produktbezug und wird daher als eigener Befund erfasst (P3, Abschnitt 29). |
| `docs/FITTRACK_VIEW_CATALOG.md` | **veraltet** | Stand 2026-07-19 — behauptet wörtlich, es gebe „keine Vue-Komponente oder Route für Workout Sessions", was seit Stage 1B.2B2A kategorisch falsch ist. Der darin beschriebene Router-Guard-Mechanismus (`requiresAuth`/`guestOnly`/`requiresStudio`/`studioRoles`/`personalContext`) und die Beobachtung, dass es **keinen globalen 403/404-Interceptor** gibt, sind dagegen — gegen den aktuellen Code geprüft (Abschnitt 4.2) — weiterhin korrekt. |
| `docs/STAGE_3A_LOCAL_PILOT_READINESS_AUDIT.md` | **aktuell und korrekt** | Als methodisches Vorbild für dieses Audit verwendet; alle dort als P1 klassifizierten Punkte sind laut Nachtrag-Kette in `FITTRACK_NEXT_PHASE_RECOMMENDATION.md` mittlerweile bis auf zwei bewusst offen gehaltene (totes `coachActionEligibility`, kein Löschungsrecht) geschlossen — gegen den aktuellen Code stichprobenweise bestätigt (Abschnitte 5, 21). |
| `docs/STAGE_4A_FINAL_LOCAL_ACCEPTANCE.md` | **veraltet** (Kernaussage) | Erklärt FitTrack für „lokal vollständig abgeschlossen" mit der expliziten Aussage, es folge keine weitere lokale Entwicklungsphase — durch die danach tatsächlich durchgeführten Stufen 5A1–5A3 überholt. Dies ist normale Projektentwicklung (eine neue, separat beauftragte Produktlinie wurde begonnen) und kein Fehler, aber die Kernaussage des Dokuments ist beim isolierten Lesen ohne die spätere Nachtrag-Kette irreführend. |
| `docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md` | **aktuell und korrekt** | Dokumentierte Abgrenzungen (keine UI, keine Reaktivierung von übersprungenen/abgesagten Einträgen, kein personenbezogenes Zeitzonenfeld) gegen aktuellen Code verifiziert (Abschnitt 20.2) — weiterhin zutreffend. |
| `docs/STAGE_5A2_PERSONAL_CALENDAR_UI.md` | **veraltet** (einzelne Aussage) | Sagt „Stage 5A3 bewusst nicht begonnen" — Stage 5A3 ist seither erschienen und bereits gemergt; der Rest der Beschreibung (Kalender-UI-Verhalten) ist unverändert korrekt. |
| `docs/DEPLOYMENT.md` | **aktuell und korrekt** | Bestätigt explizit, dass `docker-compose.yml` nur eine lokale MySQL-Instanz liefert und **keine Produktionsarchitektur** ist; keine stillschweigenden „es existiert bereits ein Hosting"-Behauptungen gefunden. |
| `docs/BACKUP_RESTORE.md` | **aktuell und korrekt** | Bestätigt zweimal explizit, dass Off-host-Speicherung nur gegen lokales MinIO getestet wurde, nie gegen einen echten externen Bucket — deckt sich mit `FITTRACK_NEXT_PHASE_RECOMMENDATION.md`s „Deferred until first customer". |
| `docs/MIGRATION_RECOVERY.md` | **aktuell und korrekt** | Bestätigt explizit: **kein automatischer Rollback, kein automatisches Ledger-Repair** — Wiederherstellung ist ein vollständig manueller, review-pflichtiger Prozess. Keine Übertreibung der eigenen Fähigkeiten. |
| `docs/LOCAL_PILOT_RUNBOOK.md` | **aktuell und korrekt** | Der in Abschnitt 9.2 dieses Audits tatsächlich reproduzierte Git-Bash/Windows-Pfadkonvertierungs-Effekt beim Produktionsbuild ist dort bereits als bekannte Einschränkung (Abschnitt 23) dokumentiert — Dokumentation und tatsächliches Verhalten stimmen exakt überein. |
| `docs/adr/001-003` | **aktuell und korrekt** | Alle drei Kernentscheidungen (Tenancy/RBAC getrennt von persönlichen Daten; Coaching-Beziehung statt impliziter Rollen-Berechtigung; Session-Snapshot + optimistische Nebenläufigkeit statt Last-Write-Wins) sind in der Architekturaufnahme (Abschnitte 4–6) unverändert im Code wiedergefunden worden. |
| `.github/workflows/ci.yml` | **aktuell und korrekt** | Drei Jobs (Backend/MySQL/Migrationen, Frontend-Tests+Build, Chromium-E2E+Axe) — deckt sich exakt mit den in diesem Audit lokal reproduzierten Regressionsschritten (Abschnitte 8–11). |
| `backend/.env.example` | **aktuell und korrekt** | Alle Konfigurationsgruppen (DB, Auth/Sessions, CORS, Rate-Limits, SMTP, Backup-Verschlüsselung, S3/Off-host, Sonstiges) entsprechen den in Abschnitt 5 verifizierten Mechanismen; keine verwaisten oder nicht mehr existierenden Variablen gefunden. |

**Zusammenfassung:** Von 18 geprüften Dokumenten sind 12 aktuell/korrekt
(teils mit Vorbehalt), 4 veraltet in einzelnen, klar benannten Aussagen (keine
davon sicherheitsrelevant), und 1 (`FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`)
enthält einen internen Widerspruch zwischen Fliesstext-Nachtrag und
Aufzählungsliste. Kein geprüftes Dokument behauptet fälschlich, eine
Fähigkeit sei production-ready, die es nicht ist — im Gegenteil,
`BACKUP_RESTORE.md` und `MIGRATION_RECOVERY.md` sind auffallend zurückhaltend
und korrekt in der Beschreibung ihrer eigenen Grenzen.

---

## 4. Architekturaufnahme — Frontend

**4.1 Grundgerüst.** Vue `3.5.30`, `vue-router` `5.0.3`, Build via Vite
`7.3.6`. `vite.config.js:58-72` erzwingt bei `mode === 'production'` zwei
Hard-Fail-Prüfungen für `VITE_API_BASE_URL` (`targetsLocalMachine()`,
`isValidProductionApiTarget()`) — ein Produktionsbuild mit einer
localhost-Zieladresse oder einer syntaktisch unsicheren API-URL bricht mit
Fehler ab, statt eine falsche Konfiguration stillschweigend zu bauen.

**4.2 Routing und Zugriffskontrolle.** `src/router/index.js` definiert jede
Route mit `requiresAuth`/`guestOnly`/`personalContext`/`requiresStudio`/
`studioRoles`; ein einziger `navigationGuard()` (Zeilen 271-318) wertet das
bei jeder Navigation aus. Fremde Studio-Zugriffe landen serverseitig auf 404
(Abschnitt 5.5), UI-seitig auf `studio-access-denied`, wenn `studioRoles` die
aktive Rolle ausschliesst. **Es gibt keinen globalen 403/404-Interceptor** —
neun Ansichten implementieren ein identisches `reconcileStudioAccess()`-Muster
zur Selbstheilung bei verlorenem Zugriff; `MyTrainingPlanView.vue` und
`InvitationAcceptView.vue` tun das **nicht** (bestätigt gegen aktuellen Code,
nicht nur aus altem Dokument übernommen) — bei einem 403 zeigen sie nur eine
statische Inline-Fehlermeldung ohne Re-Hydration/Redirect. Dies ist ein seit
Stage-3A-Audit bekannter, unveränderter UX-Inkonsistenz-Befund (Abschnitt 28).

**4.3 Auth- und Sitzungsmodell im Frontend.** `src/utils/auth.js` hält den
Access-Token bewusst nur im Speicher (kein localStorage/sessionStorage); ein
Seiten-Reload verlässt sich auf den stillen Refresh über das HttpOnly-Cookie
(`ensureAuthBootstrap()`). Token-Refresh ist pro Tab single-flight und über
`navigator.locks` (mit localStorage-Fallback-Lock) über mehrere Tabs
koordiniert, um die Backend-seitige Reuse-Detection bei parallelen Tabs nicht
fälschlich auszulösen. Logout broadcastet über `BroadcastChannel` an alle
offenen Tabs.

**4.4 Studio-Kontext.** `src/utils/studioContext.js` hält aktive Studios und
die aktive Rolle reaktiv; rollenabhängige Sichtbarkeits-Computeds
(`canManageActiveStudio`, `canViewActiveStudioMembers`,
`canAccessTrainingManagement`, `isStudioMemberRole`) steuern sowohl
Seitennavigation (`AppSidebar.vue`) als auch, in Kombination mit den
Router-Guards, den tatsächlichen Seitenzugriff.

**4.5 Seiteninventar (35 Views unter `src/views/`).** Auth: Login, Register.
Persönlich: Home, Exercises, Workouts, Progress, Calendar, Profile. Studios:
Liste, Erstellen, Dashboard. Verwaltung: Members, Invitations (+ separater
Invitation-Accept), Coaching-Relationships, Training-Programs (+ Builder),
Assignments (+ Schedule-Rules), My-Training-Plan, Workout-Session-History (+
Detail), Coach-Results (+ Session-Detail), Settings, Audit. Fehler/Rand:
Access-Denied, Not-Found, sowie eine öffentliche `EmailChangeConfirmView`
ausserhalb des erwarteten Katalogs (bewusst ohne `requiresAuth`, da der Link
an eine neue, möglicherweise nicht eingeloggte E-Mail-Adresse geht). Jede vom
Auftrag erwartete Kategorie ist vorhanden; keine fehlt.

**4.6 Responsivität.** Kein einheitliches Breakpoint-Token-System — jede
Komponente definiert ihre eigenen `@media`-Grenzen (meist 1023px für den
Sidebar-Kollaps, teils zusätzlich 767px/480px). Der Kalender rendert
Monatsgitter und eine mobile Agenda-Liste (`CalendarAgendaList.vue`)
gleichzeitig im DOM und blendet per CSS um, nicht per `v-if` — bewusst, damit
ein leerer Monat auf Mobile nie ohne Navigationsmöglichkeit "gefangen" wird.
Der mobile Sidebar-Zustand (`App.vue:17`, `sidebarOpen = ref(false)`) ist
standardmässig geschlossen; dies wurde sowohl durch einen echten, frischen
Seitenaufruf bei 390px (Screenshot, Abschnitt 17) als auch durch die
bestehende, grüne E2E-Prüfung „Mobile Navigation meldet Zustand und schließt
per Escape" bestätigt.

**4.7 Internationalisierung.** Kein `vue-i18n`, sondern ein handgeschriebenes
`src/utils/i18n.js` (>2500 Zeilen) mit einem `{de:{...}, en:{...}}`-Objekt und
Fallback auf Deutsch bei fehlendem Schlüssel. Stichprobe an
`ScheduleRulesView.vue` (neuere Ansicht, von einem früheren Dokument als
möglicherweise unvollständig übersetzt vermerkt): **vollständig übersetzt**,
kein hartkodierter Text ausserhalb von `t()`-Aufrufen gefunden — der frühere
Verdacht hat sich für diese Ansicht nicht bestätigt.

**4.8 Barrierefreiheit.** Eigener, abhängigkeitsfreier Fokus-Trap
(`src/utils/modalFocus.js`) für Dialoge; Skip-Link zu `#main-content`, den der
Router nach jeder Navigation automatisch fokussiert; Toasts mit
`aria-live="polite"`/`role="status"`; Formularfehler konsequent mit
`role="alert"`. Eine dedizierte Axe-Playwright-Suite deckt dies zusätzlich
automatisiert ab (Abschnitt 11).

---

## 5. Architekturaufnahme — Backend

**5.1 Express-Struktur und Versionierung.** Einstiegspunkt `server.js` →
`startup/bootstrap.js` (DB-Konnektivität, optionale Auto-Migration) →
`startup/app.js` (`createApp`). Legacy-Router (`/api/users`, `/api/exercises`,
`/api/workouts`, `/api/progress`) sind unversioniert; alle seit Stage 1A neu
hinzugekommenen Domänen-Router laufen unter `/api/v1`. Es gibt noch kein
`/api/v2` und keinen Versions-Negotiation-Mechanismus — für einen einzelnen
Piloten unkritisch, aber bei einem zweiten Kunden mit abweichenden
Anforderungen ein architektonischer Punkt, der früh geklärt werden müsste.

**5.2 Auth und Sitzungen.** Login vergleicht bei unbekannter E-Mail gegen
einen festen Dummy-Hash (Timing-Schutz), dann `sessionService.startSession()`
— Zugriffstoken (JWT, 15 Min TTL) plus ein rotierendes, einmal verwendbares
Refresh-Token in einem HttpOnly-Cookie. Refresh erkennt Wiederverwendung eines
bereits rotierten Tokens und markiert die gesamte Sitzung als `compromised`.
Jede geschützte Anfrage prüft `auth_version` sowohl im JWT als auch in der
Sitzungszeile — Logout-All, Passwortänderung und E-Mail-Änderung invalidieren
so alle anderen Sitzungen konsistent über einen einzigen Mechanismus.

**5.3 CSRF und CORS.** Klassisches Double-Submit-Cookie-Verfahren
(`security/csrfGuard.js`) plus ein Origin-Guard auf den drei mutierenden
`/api/auth/*`-Endpunkten. CORS wird aus `CORS_ALLOWED_ORIGINS` als exakte,
normalisierte Origin-Liste aufgebaut (kein Wildcard/Substring-Match), verbietet
`http`/localhost in Produktion und spiegelt `Access-Control-Allow-Credentials`
nur für erlaubte Origins. **Damit ist die in
`FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` als „ungetestet" gelistete
CORS-Konfiguration tatsächlich sowohl implementiert als auch automatisiert
getestet** (s. Abschnitt 3) — die Dokumentliste ist veraltet, nicht der Code.

**5.4 Rate-Limiting.** Migration 011 (`security_rate_limit_buckets`) plus
`rateLiming/mysqlRateLimitStore.js` — ein atomarer, gemeinsam genutzter
MySQL-Store (`INSERT IGNORE` + `SELECT...FOR UPDATE` + `UPDATE` in einer
Transaktion), fail-closed bei Store-Ausfall (kein In-Memory-Fallback). Deckt
Login, Registrierung, Refresh, Logout-All, Account-Aktionen sowie
Invitation-Create/Resend/Accept ab. **Damit ist auch die als „pro Prozess"
gelistete Rate-Limiter-Eigenschaft überholt** — real ist sie seit Migration
011 zentral und geteilt (Abschnitt 3).

**5.5 Studio-Tenancy und RBAC.** `middleware/studioContext.js` lädt den
Studio-Kontext über einen INNER JOIN auf `studio_memberships`; eine fremde
oder nicht existierende Studio-ID liefert für einen Nutzer ohne aktive
Mitgliedschaft **404** (`StudioNotFoundError`), niemals 403 — die Existenz
eines fremden Studios wird so nie verraten. Unzureichende Rolle **innerhalb**
eines Studios, dem der Nutzer angehört, liefert dagegen korrekt 403.

**5.6 Coaching-Scoping.** Kein zentraler Mechanismus, sondern ein an mehreren
Stellen wiederholtes, aber konsistentes Muster: jeder Service prüft inline die
eigene aktive `studio_coaching_relationships`-Zeile des Akteurs für das
konkrete Mitglied/die Zuweisung (`programAssignmentService.js`,
`scheduleRuleService.js`, `workoutFeedbackService.js`), jeweils mit `FOR
UPDATE`.

**5.7 Transaktionen und optimistische Nebenläufigkeit.** `revision`-Spalten
auf `workout_sessions`, `session_exercises`, `session_sets` und
`training_calendar_entries`; CAS-Updates (`WHERE id=? AND revision=?`) werfen
bei `affectedRows===0` einen spezifischen Konfliktfehler. Dies wurde in der
E2E-Suite real reproduziert (`WORKOUT_SET_CONFLICT`, s. Abschnitt 11).

**5.8 Domänen im Überblick.** Trainingsprogramme (Entwurf → Veröffentlichung →
Unveränderlichkeit), Zuweisungen (an eine konkrete Coaching-Beziehung
gebunden), Terminierungsregeln (wiederkehrend, lazy materialisiert in
`training_calendar_entries`), Workout-Ausführung (Session-Snapshot bei Start,
niemals Live-Programm-Referenz), Feedback (append-only, ein Eintrag pro
Session und Ersteller).

**5.9 Audit-Ereignisse.** `studio_audit_events` ist eine reine InnoDB-Tabelle
**ohne** DB-Trigger, GRANT-Einschränkung oder sonstige technische
Unveränderlichkeit — Append-Only ist ausschliesslich Code-Konvention
(`audit/studioAudit.js`, striktes Allow-List-Redacting). ~25 Ereignistypen.
**Neuer, in diesem Audit selbst entdeckter Befund:** Die Ereignistypen aus
Stage 5A1/5A3 (`calendar.studio_workout.*`, `assignment.schedule_rule.*`)
fehlen im Übersetzungswörterbuch des Frontends und erscheinen im Audit-Log
nur als generischer Fallback „Weitere Ereignis (calendar.studio_workout....)“
statt als lesbarer Text — siehe Abschnitt 19.3 für den Bildschirmbeweis und
Abschnitt 27 für die Klassifikation.

**5.10 E-Mail-Versand.** SMTP ist opt-in (`INVITATION_EMAIL_PROVIDER=smtp`);
ohne Konfiguration liefert der Dev-Modus den Annahme-Link direkt in der
API-Antwort zurück statt eines echten Versands — in Produktion ohne Provider
ist der Versand dagegen hart gesperrt (503), kein stiller Fallback.

**5.11 Backups und Restore.** Eigenes authentifiziertes Containerformat
(`.ftbackup`, AES-256-GCM). Restore erfordert `BACKUP_RESTORE_ENABLED=true`
**und** eine zielgebundene Bestätigungszeichenkette — bewusst unabhängig von
`NODE_ENV`. Off-host-Upload ist gegen S3-kompatible Speicher konfigurierbar,
aber (Abschnitt 3) nie gegen ein echtes externes Konto verifiziert.

**5.12 Migrationen.** 12 Dateien, advisory-lock-geschützter Runner, ein
schreibgeschützter „Doctor“, der Ledger, Schema und Prüfsummen gegen die
lebende Datenbank abgleicht und in vier Zustandsklassen (bereit, Fehler,
ausstehend, Wiederherstellung nötig) mit unterschiedlichen Exit-Codes
mündet — real ausgeführt in Abschnitt 10.

**5.13 Health/Readiness.** `/api/health/live` prüft nichts, `/api/health/ready`
prüft sowohl DB-Konnektivität als auch Migrationsstatus (kein `pending`,
`dirty`, `drift`, `unknown`) und liefert bei Abweichung 503 mit Begründung.

**5.14 Logging und Fehlervertrag.** Strukturiertes JSON-Logging mit
rekursiver Redaktion sensibler Werte (Tokens, credentialed URLs); jede Anfrage
erhält eine `X-Request-ID`. Fehlervertrag durchgängig
`{error:{code,message,requestId,fields?}}`; 5xx werden auf einen generischen
`INTERNAL_ERROR` normalisiert, nie mit internen Details.

**5.15 Totes Codestück `coachActionEligibility`.** Weiterhin vorhanden
(`domain/studioPolicy.js:195-206`, exportiert Zeile 288), weiterhin ohne
Aufrufer im Produktcode (nur durch einen eigenen Unit-Test abgedeckt), und im
eigenen Code (`scheduleRuleService.js:76-82`) explizit als „unused dead code“
kommentiert. Unverändert gegenüber Stage 3A/5A1 — siehe Abschnitt 27.

---

## 6. Architekturaufnahme — Datenbank

**6.1 Migrationen 001–012** (unter `database/migrations/`): 001 Basisschema
(persönlich: `users`, `exercises`, `workouts`, `workout_exercises`,
`progress_entries`); 002 Legacy-Schema-Upgrade (idempotente Nachrüstung); 003
Seed globaler Übungen; 004 Trainingshistorien-Konsistenz (Snapshot-Spalten,
CHECK-Constraints); 005 Studio-Tenancy/RBAC (`studios`,
`studio_memberships`, `studio_invitations`, `studio_audit_events`,
`public_id`-Konvention); 006 Coach-Member-Training (`studio_coaching_relationships`,
Programme/Versionen/Tage/Übungen, `studio_program_assignments`); 007
Workout-Ausführung (`studio_workout_sessions`, `_exercises`, `_sets`, jeweils
mit `revision`); 008 Session-Feedback (append-only, Idempotenzschlüssel); 009
Konto-Selbstverwaltung (`auth_version`, E-Mail-Änderungsanfragen); 010
Auth-Sitzungen (`user_auth_sessions`, `user_refresh_tokens`); 011
Rate-Limit-Store; 012 Vereinheitlichter Kalender (`studio_assignment_schedule_rules`,
`training_calendar_entries`, `workouts.public_id`-Nachrüstung).

**6.2 Tenant-Grenzen und Datenklassen.** Alle mit „studio_“ präfixierten
Tabellen tragen (direkt oder über die Elterntabelle) eine Studio-Zuordnung;
`users` bleibt die einzige globale Identitätstabelle. Persönliche Daten
(`workouts`, `progress_entries`, `exercises` ohne `user_id`) sind vom
Studio-Geschäftsbereich getrennt. Innerhalb eines Studios sind
Session-/Satz-/Feedback-Daten (P4-Klasse) am stärksten geschützt: kein
Owner/Admin-Bypass, Zugriff ausschliesslich über eine aktive eigene
Coaching-Beziehung.

**6.3 Historische Unveränderlichkeit.** `studio_workout_session_feedback` ist
die einzige Tabelle, die im Migrationscode selbst wörtlich als „append-only“
bezeichnet wird (Idempotenzschlüssel, kein `updated_at`). Abgeschlossene
Workout-Ergebnisse sind nicht technisch unveränderlich (kein DB-Trigger),
aber durch Anwendungslogik (Statusübergänge, Abschnitt 20) faktisch fixiert.

**6.4 Cascade-Verhalten.** Studio-Löschung kaskadiert vollständig auf alle
Kind-Tabellen (kompletter Tenant-Abbau). Mitgliedschaften können **nicht**
hart gelöscht werden, solange Coaching-Beziehungen/Zuweisungen darauf
verweisen (`RESTRICT`) — nur Status-Änderung ist möglich. Deaktivieren einer
Terminierungsregel ist ein reiner Status-Update, **kein** Löschen; bereits
materialisierte `training_calendar_entries` bleiben unangetastet, weil der
Materialisierer nach eigenem Kommentar „später nie wieder vorhandene Zeilen
anfasst, sondern nur neue für noch nicht materialisierte Daten erzeugt“.
`personal_workout_id`/`studio_workout_session_id` auf Kalendereinträgen sind
bewusst `ON DELETE SET NULL`, nicht `CASCADE` — das Löschen eines alten
Workouts darf nie den Kalendereintrag mitreissen.

**6.5 Löschung/Anonymisierung.** Über alle 12 Migrationen: **kein**
`deleted_at`, **keine** Anonymisierungs- oder Erasure-Tabelle, keine Spur von
„GDPR“/„retention“ im Schema. Deckt sich mit dem in
`FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` seit Stage 3A dokumentierten,
bewusst offen gehaltenen Punkt (Abschnitt 21, 27).

**6.6 Primärschlüssel.** Zweistufig seit Migration 005: interner
`AUTO_INCREMENT` für Joins, separater `public_id CHAR(36)` (UUID) für alles,
was über die API sichtbar wird. Ausnahme: die fünf Migration-001-Tabellen
(`users`, `exercises`, `workouts`, `workout_exercises`, `progress_entries`)
sowie `security_rate_limit_buckets` haben keinen `public_id` — bei den ersten
vier ein bewusst dokumentierter, unveränderter Altlast-Vertrag; bei Letzterer,
weil die Tabelle nie über eine öffentliche API sichtbar wird.

---

## 7. Lokale Testumgebung

Aufgebaut und tatsächlich verwendet für dieses Audit: `docker compose up -d`
(MySQL 8.0, Container `fittrack_mysql`, bereits vor diesem Audit laufend,
bestehende Entwicklungsdatenbank `fittrack` mit allen 12 Migrationen bereits
angewendet) sowie zusätzlich `docker compose --profile backup-test up -d
minio` (Container `fittrack_minio`, ausschliesslich für die
Off-host-Backup-Integrationstests, s. Abschnitt 8.2) — dieser Container wurde
nach Abschluss der Regression wieder entfernt (Abschnitt 33). `backend/.env`
und `frontend/` verwenden die bereits vorhandene lokale Entwicklungskonfiguration;
es wurden keine echten SMTP-Zugangsdaten, keine echte Cloud-Bucket-Verbindung
und keine Produktionsdaten verwendet. Die E2E-Suite betreibt zusätzlich ihre
eigene, vollständig isolierte Backend-/Frontend-Instanz (Port 3201/4173,
eigene Wegwerf-Datenbank `fittrack_e2e_stage1a`) über
`frontend/playwright.config.js` — diese Isolation wurde nicht verändert.

---

## 8. Vollständige Regression — Backend

Ausgeführt aus `backend/` gegen die lokale Entwicklungsdatenbank:

| Schritt | Ergebnis |
|---|---|
| `npm ci` | erfolgreich |
| `npm run test:syntax` | erfolgreich (Exit 0) |
| `npm run audit:security` (`npm audit --audit-level=high`) | **0 Schwachstellen** |
| `npm run db:migrate` | 0 neu angewendet (bereits vollständig) |
| `npm run db:migrate:status` | `applied: 12, pending: [], dirty: [], drift: [], unknown: []` |
| `npm run db:migrate:doctor` | `ready:true, applied:12, pending:0, dirty:0, drift:0, unknown:0, schemaIssues:0, ledgerIssues:0` — **exakt der geforderte Zielwert** |
| `npm run test:unit` | **508/508 bestanden**, 0 fehlgeschlagen, 0 übersprungen |
| `npm run test:integration` (inkl. MinIO-Backup-Tests) | **254/254 bestanden**, 0 fehlgeschlagen, 0 übersprungen |
| `npm run test:migrations` | **32/32 bestanden**, 0 fehlgeschlagen, 0 übersprungen |

**8.1 Eine bewusste Abweichung: `npm run db:test:reset`.** Dieser Schritt
schlug mit `TEST_DB_OPERATION_FORBIDDEN` fehl. Ursache: Das Skript verlangt
laut `backend/scripts/databaseSafety.js` explizit `NODE_ENV=test`,
`ALLOW_TEST_DB_RESET=true`, einen Loopback-Host **und** einen erkennbar
wegwerfbaren Datenbanknamen — die hier verwendete lokale Entwicklungs-`.env`
zeigt bewusst auf die echte Entwicklungsdatenbank `fittrack`, nicht auf eine
Wegwerf-Testdatenbank. Das ist die **korrekt greifende
Sicherheitssperre**, kein Fehler — sie wurde gemäss Auftrag nicht umgangen,
sondern als positiver Befund für den Sicherheitsabschnitt gewertet
(Abschnitt 21.10).

**8.2 MinIO-Testprofil.** Für die Dauer der Integrationstests lief
`fittrack_minio` (Profil `backup-test`); die darin enthaltenen
Off-host-Backup-Tests (`backupRemoteMinio.test.js`) sind Teil der oben
zitierten 254 bestandenen Integrationstests.

---

## 9. Vollständige Regression — Frontend

| Schritt | Ergebnis |
|---|---|
| `npm ci` | erfolgreich |
| `npm audit --audit-level=high` | **0 Schwachstellen** |
| `npm run test:run` (Vitest) | **499/499 Tests in 56/56 Dateien bestanden** |
| `npm run build` (`VITE_API_BASE_URL=/api`) | siehe 9.2 |

**9.2 Ein umgebungsbedingter, bereits dokumentierter Windows-Effekt.** Der
erste Build-Versuch schlug mit „VITE_API_BASE_URL must be a root-relative
path…“ fehl — nicht wegen eines Codefehlers, sondern weil Git Bash unter
Windows (MSYS-Pfadkonvertierung) das Argument `/api` automatisch in einen
Windows-Dateipfad (`C:/Program Files/Git/api`) umschreibt, bevor es den
Node-Prozess erreicht. Verifiziert durch direkten Vergleich:
`VITE_API_BASE_URL=/api node -e "console.log(process.env.VITE_API_BASE_URL)"`
liefert ohne Gegenmassnahme den verstümmelten Windows-Pfad, mit
`MSYS_NO_PATHCONV=1` korrekt `/api`. Mit dieser Umgebungsvariable gesetzt
**baute das Frontend erfolgreich** (alle 35 Views als eigene Chunks, Bundle
`index-*.js` 238 kB / 79,9 kB gzip). Dieser exakte Effekt ist bereits in
`docs/LOCAL_PILOT_RUNBOOK.md` Abschnitt 23 als bekannte Windows-Einschränkung
dokumentiert — die Reproduktion in diesem Audit bestätigt die Dokumentation,
statt einen neuen Befund zu begründen; er wird trotzdem als P3 in das
Befundregister übernommen, da er reale Einrichtungsreibung für Entwickler:innen
unter Windows verursacht (Abschnitt 29).

---

## 10. Migrationen und Migration Doctor

Siehe Abschnitt 8 (Tabelle) für die konkreten Zahlen. Ergänzend: Migration
Doctor prüft laut Architekturaufnahme (Abschnitt 5.12) nicht nur den
Ledger-Zustand, sondern auch einen vollständigen Schema-Vertrag (Tabellen,
Spalten, Indizes, Fremdschlüssel, Check-Constraints je Migration) gegen die
lebende Datenbank — `schemaChecksLen: 571` einzelne Prüfungen im tatsächlichen
Lauf dieses Audits, alle ohne Abweichung. Es gibt **keinen** automatischen
Rollback-Pfad (Abschnitt 3, `MIGRATION_RECOVERY.md`); dies ist eine bekannte,
dokumentierte, nicht in diesem Audit neu entdeckte Grenze.

---

## 11. Vollständige Chromium-E2E-/Accessibility-Suite

`npx playwright install --with-deps chromium` gefolgt von `npm run test:e2e`
(Projekt `chromium`, eigene isolierte Server-Instanz laut Abschnitt 7):

```
59 passed (5.1m)
0 failed, 0 skipped
```

**Methodischer Hinweis (gilt für Abschnitte 12–17):** Wie in Abschnitt 2.3
offengelegt, stand für dieses Audit keine interaktive Browser-Fernsteuerung
zur Verfügung. Die folgenden Rollendurchläufe stützen sich daher auf zwei
Beweisquellen: (a) die oben zitierte, tatsächlich ausgeführte 59-Test-Suite,
insbesondere `adminPilotWalkthrough.spec.js` (20 Schritte, Admin-Perspektive)
und `coachScheduling.spec.js` (kompletter Coach-zu-Member-Terminierungsablauf
inkl. Rollen-/Berechtigungs-Isolationstest), und (b) ein für dieses Audit
geschriebenes, einmalig ausgeführtes und danach wieder gelöschtes
Playwright-Skript (`_stage5bAuditCapture.spec.js`), das ein realistisches
Pilotstudio mit gemischten Zuständen (aktive/suspendierte Mitglieder, offene
Einladung, abgeschlossenes und geplantes Training, echtes Coach-Feedback)
aufbaut und dabei 39 echte Bildschirmfotos aufzeichnet (Desktop 1440×900 und,
wo vom Auftrag gefordert, Mobile 390×844). Beide liefen real gegen den
lokalen Stack, nicht gegen Mocks. Wo eine Aussage nur auf Code-Lektüre statt
auf einem dieser beiden Abläufe beruht, ist das explizit vermerkt.

Die 59 Tests umfassen unter anderem: vollen
Registrierungs-/Login-/Session-/Refresh-/Logout-All-Ablauf
(`authSession.spec.js`), Konto-Selbstverwaltung inkl. E-Mail-Änderung über den
lokalen Test-Transport-Link (`accountSelfService.spec.js`), CORS- und
Rate-Limit-Sicherheitsverhalten inkl. sichtbarer Rückmeldung im UI
(`corsSecurity.spec.js`, `rateLimitSecurity.spec.js`), Einladungsversand und
-Resend (`invitationEmail.spec.js`, `invitationResend.spec.js`), vollständige
Coach-/Programm-/Zuweisungs-Abläufe (`studioTraining.spec.js`), Kalender
(`calendar.spec.js`), Coach-Terminierung inklusive eines expliziten
Verlaufskonsistenz-Tests (`coachScheduling.spec.js`, s. Abschnitt 16.3),
Workout-Ausführung inkl. Konfliktverhalten (`workoutSessions.spec.js`),
Coach-Feedback (`coachFeedback.spec.js`), einen 20-Schritte-Admin-Durchlauf
(`adminPilotWalkthrough.spec.js`, s. Abschnitt 13) sowie eine dedizierte
Axe-/Mobile-Suite (`accessibility.spec.js`) mit expliziten 390px-Prüfungen auf
den Kernseiten, dem Kalender und den Terminierungsregeln — **keine** davon
meldete eine „serious“ oder „critical“ Axe-Verletzung.

---

## 12. Owner-Rollendurchlauf

Owner-Handlungen sind ein Superset der Admin-Handlungen (Abschnitt 13) plus
exklusiv: Slug/Name/Zeitzone/Sprache/Gewichtseinheit ändern
(`StudioSettingsView.vue`, real durchlaufen im Zusatzskript, Screenshot
`27-owner-settings`), sowie — im Unterschied zum Admin — kein serverseitiges
Verbot bei Studio-Metadaten-Änderungen (`adminPilotWalkthrough.spec.js` Schritt
19 beweist umgekehrt, dass der Admin genau hier mit 403
`INSUFFICIENT_STUDIO_ROLE` abgewiesen wird — die Owner/Admin-Grenze ist damit
sowohl UI- als auch API-seitig real verifiziert, nicht nur behauptet). Im
Zusatzskript real durchgeführt: Studio anlegen → fünf Einladungen
unterschiedlicher Rollen erstellen → eine Mitgliedschaft auf „suspendiert“
setzen → Mitgliederliste, Einladungsliste (inkl. redigierter E-Mail-Adresse
nach Annahme, s. Abschnitt 21.9), Coaching-Beziehung anlegen → Zuweisung
erstellen → Audit-Log (24 Ereignisse über alle Rollen hinweg sichtbar,
Abschnitt 19.3) → Einstellungen. Alle Schritte liefen ohne Fehler, ohne
unerwartete Weiterleitung und ohne sichtbaren rohen Fehlercode. Eigene
Konto-Selbstverwaltung (Passwort-/E-Mail-Änderung, Logout-All) ist nicht
rollenspezifisch und wird bereits durch die grüne `accountSelfService.spec.js`
abgedeckt (Abschnitt 11) — ein separater Owner-spezifischer Durchlauf dafür
wäre redundant gewesen.

**Befund:** Kein rollenspezifischer Blocker für den Owner gefunden. Die
Studio-Übersicht selbst bleibt aber — unabhängig von der Rolle — eine reine
Navigationsseite ohne operative Information (Abschnitt 19).

---

## 13. Admin-Rollendurchlauf

Vollständig real durchlaufen durch die bestehende, grüne
`adminPilotWalkthrough.spec.js` (20 Schritte: Einladung annehmen, Mitglieder
einsehen, Trainer/Mitglied einladen, Einladung erneut senden, Einladung
widerrufen, Coaching-Beziehung mit sich selbst als Coach anlegen, Programm
bauen (Version/Tag/Übung), veröffentlichen, zuweisen, Ergebnis einsehen,
Feedback verfassen, Audit-Log auf lesbare Übersetzung prüfen, Owner-exklusive
Aktion **korrekt verweigert** (403, UI-Feld deaktiviert), Fremdstudio-Isolation
(404), Mobile-Smoke bei 390px mit Axe-Check auf vier Kernseiten,
Tastaturbedienbarkeit). Alle 20 Schritte bestehen aktuell (Teil der 59/59 in
Abschnitt 11). Der einzige funktionale Unterschied zum Owner ist die bereits
in Abschnitt 12 belegte Settings-Sperre — sonst deckungsgleiche
Berechtigungen (Mitglieder, Einladungen, Coaching, Programme, Zuweisungen,
Ergebnisse, Audit).

**Befund:** Admin-Workflow-Grenze zum Owner ist sowohl im UI (deaktiviertes
Feld, Hinweistext) als auch serverseitig (403) konsistent durchgesetzt — genau
das vom Auftrag geforderte „identische Grenze in UI und Backend“.

---

## 14. Trainer-Rollendurchlauf und Daily-Usability

Real durchlaufen über `coachScheduling.spec.js` (eigene Coaching-Beziehung:
volle Terminierungsrechte; fremde Coaching-Beziehung: `getByText('Diese
Zuweisung wurde nicht gefunden.')`, keine Datenpreisgabe, Zuweisungsliste
zeigt fremde Zuweisung gar nicht erst an) sowie über das Zusatzskript
(Programm bauen, veröffentlichen, drei Terminierungsregeln setzen, bearbeiten,
Ergebnis einsehen, Feedback verfassen — Screenshots `06`–`12`, `23`–`24`).

**Daily-Usability-Bewertung (explizit vom Auftrag gefordert):** Der Trainer
hat **keine** dedizierte, datengetriebene Übersicht dessen, was heute zu tun
ist. `StudioDashboardView.vue` (194 Zeilen, vollständig gelesen) zeigt für
jede Rolle identisch nur statische Studio-Details plus drei
Navigations-Kacheln („Team einladen“, „Mitglieder ansehen“,
„Studio-Einstellungen“ bzw. für einen reinen Trainer nur „Mitglieder
ansehen“) — **keine** überfälligen Trainings, keine neuen Ergebnisse, keine
inaktiven Mitglieder, keine fehlenden Coaching-Beziehungen. Dies wurde nicht
nur aus dem Code geschlossen, sondern **visuell doppelt bestätigt**: Ein
Screenshot der Übersicht direkt nach Studio-Erstellung
(`01-owner-studio-dashboard-empty`) und ein zweiter nach vollständigem
Durchlauf (fünf Mitgliedschaften, Coaching-Beziehung, veröffentlichtes
Programm, Zuweisung, drei Terminierungsregeln, abgeschlossenes Workout,
Feedback, 24 Audit-Ereignisse — `28-owner-studio-dashboard-with-activity`)
sind **inhaltlich identisch**. Ein Trainer, der morgens die Studio-Übersicht
öffnet, erkennt daraus nicht, wer heute trainieren sollte, wer überfällig ist
oder wessen Ergebnis noch kein Feedback hat — er muss dafür aktiv „Ergebnisse“
und „Zuweisungen“ einzeln öffnen und selbst querlesen. Der persönliche
Kalender (`/calendar`) selbst liefert zwar korrekt „Heute fällig“/„Überfällig“-
Zustände für eine einzelne Person (Abschnitt 15), aber es gibt keine
Coach-Aggregatsicht über alle betreuten Mitglieder hinweg.

**Befund (siehe Abschnitt 19 für Details):** Das Studio-Dashboard unterstützt
in seiner jetzigen Form **keine echten täglichen Betriebsentscheidungen** —
es ist reine statische Navigation, nicht der geforderte Soll-Ist-Abgleich.

---

## 15. Member-Rollendurchlauf (inkl. Mobile 390×844)

Real durchlaufen über `workoutSessions.spec.js`, `calendar.spec.js` und das
Zusatzskript: Registrierung/Login, Einladung annehmen, persönlicher
Trainingsbereich (Home mit echten Kennzahlen — „Workouts gesamt“, „Übungen im
Katalog“, „Letzte Aktivität“, Screenshot `13-member-home`), zugewiesenes
Programm unter „Mein Trainingsplan“ einsehen, Kalender mit
Status-eingefärbtem Termin („Heute fällig“, lila Punkt, Screenshot
`14-member-calendar-due-today`), Training aus dem Kalender heraus starten,
Sätze protokollieren, Übung und Session abschliessen (schreibgeschützt danach,
klare Meldung „Diese Session ist abgeschlossen und schreibgeschützt.“,
Screenshot `16-member-workout-session-completed`), Trainingshistorie,
Feedback des Trainers am abgeschlossenen Ergebnis einsehen, persönliche
Bereiche (Übungen/Workouts/Fortschritt/Profil) unverändert nutzbar. Ein
zweiter Browserkontext bestätigt zusätzlich (`training.spec.js`,
`workoutSessions.spec.js`), dass ein fremdes Mitglied weder Trainingsdaten
noch Session-IDs eines anderen einsehen kann.

**Mobile 390×844:** Kalender und „Mein Trainingsplan“ wurden zusätzlich bei
390×844 aufgezeichnet. Der reine Seiteninhalt (Terminliste, Statuskarten) ist
bei dieser Breite lesbar und ohne horizontalen Overflow — bereits durch die
grüne `accessibility.spec.js`-Prüfung „Stage-5A2-Kalender: Desktop, mobil …“
und „Pilot-Viewports … keinen horizontalen Overflow“ automatisiert
sichergestellt. Ein methodischer Vorbehalt: Die beiden im Zusatzskript per
`page.setViewportSize()` **mitten in einer laufenden Desktop-Sitzung**
aufgenommenen Mobile-Screenshots (`14b`, `18b`) zeigen die Seitenleiste
fälschlich offen über dem Inhalt liegend. Ein direkter Test
(`sidebarOpen = ref(false)` in `App.vue:17`, ein echter frischer 390px-Aufruf
in einem älteren, in diesem Auditverzeichnis noch vorhandenen Screenshot, und
die grüne E2E-Prüfung „Mobile Navigation meldet Zustand und schließt per
Escape“) zeigt übereinstimmend, dass die Seitenleiste bei einem **frischen**
Seitenaufruf auf Mobile korrekt eingeklappt ist. Die beiden auffälligen
Screenshots sind damit ein Artefakt der eigenen Aufnahmemethode (Resize ohne
Neuladen), **kein** reproduzierter Produktfehler — wird hier aus Gründen der
Beweisehrlichkeit dennoch offengelegt statt stillschweigend verworfen.

**Befund:** Kein rollenspezifischer Blocker für den Member gefunden;
Mobile-Kernfunktionen (Kalender, Trainingsausführung, Trainingsplan) sind
real nutzbar.

---

## 16. Cross-Role End-to-End-Szenario

Das im Auftrag geforderte 18-Schritte-Szenario (Owner erstellt Studio → lädt
Trainer:in ein → lädt Mitglied ein → beide nehmen an → Owner/Trainer:in legt
Coaching-Beziehung an → erstellt Programm → Version veröffentlicht →
Mitglied zugewiesen → Trainer:in terminiert Mo/Mi/Fr → Mitglied sieht
Kalendereinträge → startet heutiges Training → protokolliert Ergebnisse →
schliesst Training ab → Trainer:in sieht Ergebnis → verfasst Feedback →
Mitglied sieht Feedback → Owner sieht relevante Audit-Ereignisse →
historische Daten bleiben nach einer späteren Regeländerung unverändert) ist
**vollständig und real belegt**, verteilt über zwei sich ergänzende, echte
Chromium-Abläufe:

**16.1** `coachScheduling.spec.js` (bestehend, Teil der grünen 59-Test-Suite)
durchläuft exakt diese Kette in einer einzigen fortlaufenden Testfunktion
(Studio → Coaching-Beziehung → Programm/Version/Tage → Veröffentlichung →
Zuweisung → drei Terminierungsregeln über drei Wochentage → Bearbeiten →
Deaktivieren → Mitglied sieht materialisierten „Heute fällig“-Termin → startet
und schliesst das Training über den Kalender ab → Status wechselt sichtbar zu
„abgeschlossen“ → **Verlaufstest**: die Wochentag-Regel wird nachträglich
geändert, der bereits abgeschlossene Kalendereintrag bleibt nachweislich
`calendar-event-success`, nicht neu berechnet).

**16.2** Das eigens für dieses Audit geschriebene Zusatzskript wiederholt
dieselbe Kette **mit getrennten Rollen** (Owner ≠ Trainer:in, plus zusätzlich
Admin und zwei weitere Mitglieder mit abweichendem Status für realistischere
Nebendaten) und ergänzt die im Originalszenario genannten, in
`coachScheduling.spec.js` nicht enthaltenen Schritte: Trainer:in sieht das
Ergebnis unter „Ergebnisse“ und verfasst echtes Feedback, das Mitglied sieht
dieses Feedback an der Session, und der Owner sieht alle 24 resultierenden
Audit-Ereignisse. Die **Verlaufskonsistenz nach Regeländerung** wurde damit in
diesem Audit **selbst ein zweites Mal, unabhängig, real reproduziert**
(Screenshot `29c-member-calendar-after-rule-change-history-intact`, Klasse
`calendar-event-success` nach Bearbeitung der Regel weiterhin vorhanden, `not
calendar-event-due-today`).

**16.3 Ergebnis:** Alle 18 geforderten Schritte sind belegt, keiner davon war
nicht funktionsfähig oder unnötig schwierig. Die einzige während dieses
Ablaufs sichtbare Reibung war die bereits in Abschnitt 5.9/19.3 benannte
fehlende Übersetzung neuerer Audit-Ereignistypen — kein blockierendes
Verhalten, aber eine sichtbare Unschönheit im sonst sehr sauberen Ablauf.

---

## 17. UX-Heuristik-Bewertung zentraler Ansichten

Bewertet anhand der 39 im Zusatzskript aufgezeichneten echten Screenshots
(Desktop 1440×900, ausgewählte Mobile 390×844) plus Code-Lektüre der
jeweiligen View-Komponente. Bewertungskriterien wie vom Auftrag vorgegeben
(klare Überschrift, primäre/sekundäre Aktion, Statusklarheit, Leer-/Lade-/
Fehlerzustand, Wiederholbarkeit, Erfolgsmeldung, Formularvalidierung,
Dialogklarheit, Rücknavigation, Mobile-Tauglichkeit, Tastaturbedienbarkeit,
Fokus, Textklarheit, DE/EN-Konsistenz, lange Namen, Overflow, redundante
Information, ungenutzter Leerraum, visuelle Hierarchie, kognitive Last).

| Ansicht | Bewertung |
|---|---|
| Login/Register | Sehr klar: eine Aufgabe pro Seite, deutliche Überschrift, Placeholder mit Schweizer E-Mail-Konvention (`name@beispiel.ch`), Wechsel-Link zwischen beiden. Keine Beanstandung. |
| Home (persönlich) | Vorbildlich: „Auf einen Blick“-Kacheln mit echten Zahlen, klare Schnellzugriffe, kein Leerraum-Problem. Dies ist der stärkste Kontrast zum Studio-Dashboard (s. u.). |
| Studio-Übersicht | Klare Überschrift, aber inhaltsarm — nur drei statische Kacheln unabhängig vom tatsächlichen Studio-Zustand (Abschnitt 19). Kein Leer-/Ladezustand-Problem, aber ein struktureller Informationsmangel. |
| Mitglieder | Klare Tabelle, Status direkt editierbar, „Suspendiert“ visuell klar unterscheidbar. Keine Paginierungs-/Leerzustands-Probleme beobachtet. |
| Einladungen | Sehr gut: Status-Badges (Offen/Angenommen), Datum, **E-Mail-Adresse nach Annahme redigiert** (Datenschutz-Detail, positiv, s. 21.9), Resend/Widerrufen inline. |
| Coaching-Beziehungen | Klarer Leerzustand mit Handlungsaufforderung; nach Anlage sofort sichtbare Tabelle. |
| Trainingsprogramme/Builder | Entwurf klar von veröffentlicht unterschieden (Badge „Aktiv“/„Veröffentlicht“), Formular pro Übung übersichtlich; Warnhinweis vor Veröffentlichung sichtbar. |
| Zuweisungen | Klare Filter-Tabs (Aktiv/Abgeschlossen), Status-Badges, Link zur Terminierung pro Zeile unabhängig vom Status. |
| Terminierungsregeln | Funktional klar (Wochentag, Wiederholung, Zeitraum, Status), aber ein **transientes Layout-Problem beobachtet**: Bei schneller Aufeinanderfolge mehrerer Regel-Erstellungen stapeln sich Erfolgs-Toasts über der Aktionsspalte der Tabelle und verdecken kurzzeitig „Bearbeiten“/„Deaktivieren“ der zuletzt erstellten Zeile (Screenshot `12-trainer-schedule-three-rules`). Rein kosmetisch, selbstauflösend (Toast-Auto-Dismiss), kein Datenverlust — dennoch als kleiner Befund aufgenommen (Abschnitt 29). |
| Persönlicher Kalender | Sehr klar: Monatsgitter, Statusfarben, „Heute fällig“-Badge, Quellen-/Statusfilter, Wochentagsköpfe lokalisiert. Vorbildliche visuelle Hierarchie. |
| Workout-Ausführung | Klarer Fortschritt (Satz → Übung → Session), explizite Schreibschutz-Meldung nach Abschluss, Feedback-Bereich mit „noch kein Feedback“-Leerzustand. |
| Trainingshistorie | Klare Liste, Status-Filter serverseitig. |
| Ergebnisse (Coach) / Session-Detail | Ziel-vs-Ist deutlich gegenübergestellt, Feedback-Formular mit Zeichenzähler und explizitem Unveränderlichkeits-Hinweis vor dem Absenden — vorbildliche Erwartungssteuerung. |
| Mein Trainingsplan | Klar, aber inhaltlich sehr schmal (nur Programmname/Version/Status/Zeitraum) — für ein Mitglied mit mehreren Programmen über die Zeit potenziell zu wenig Kontext ohne Klick auf „Details“. |
| Profil | Nicht gesondert vertieft (Konto-Selbstverwaltung bereits durch grüne E2E-Suite abgedeckt). |
| Studio-Einstellungen | Klares Formular, Speichern/Abbrechen eindeutig getrennt. |
| Audit-Log | Klare Tabelle, Paginierung sichtbar (24 Ereignisse, Seite 1/2) — **aber** neuere Ereignistypen (Kalender/Terminierung) erscheinen nur als generischer „Weiteres Ereignis (roher.code...)“-Fallback statt echter Übersetzung (s. Abschnitt 19.3/27). Dies verletzt das Kriterium „Textklarheit“ für genau diese Zeilen. |
| Admin- vs. Owner-Dashboard | Bit-identisch im Layout (rollenabhängig nur die Kachel-Auswahl) — konsistent, keine Verwirrung durch abweichende Gestaltung zwischen Rollen. |

**Zusammenfassend:** Die Ansichten mit direktem Aufgabenbezug (Login,
persönlicher Bereich, Kalender, Workout-Ausführung, Ergebnisse/Feedback) sind
durchgehend klar, konsistent und arm an Redundanz. Die beiden schwächsten
Punkte sind strukturell dieselben wie in Abschnitt 14/19 benannt
(Studio-Übersicht ohne echten Informationswert) und ein neu entdecktes,
kleines Detail (Audit-Log-Übersetzungslücke für neuere Ereignistypen) — beide
werden im Befundregister geführt (Abschnitte 27, 28).

---

## 18. Onboarding-Bewertung

**Kann ein reales Studio ohne Entwickler:innen-Hilfe starten?** Anhand des
real durchlaufenen Ablaufs (Abschnitte 12–16): grösstenteils ja, mit
Einschränkungen.

- **Registrierung → Studio anlegen:** Selbsterklärend, ein Formular
  (Name, Zeitzone), sofortige Weiterleitung ins neue Studio.
- **Team einladen:** Die „Nächste Schritte“-Kachel auf der Studio-Übersicht
  leitet Owner direkt zur Einladungsseite — das ist der einzige Ort im ganzen
  Produkt, an dem die Studio-Übersicht tatsächlich handlungsleitend ist.
- **Rollenwahl bei Einladung:** Klar (Dropdown: Mitglied/Trainer:in/
  Administration), aber **es gibt keine erklärende Kurzbeschreibung der
  Rollenunterschiede direkt im Einladungsdialog** — ein Studio-Betreiber ohne
  Vorwissen muss die genaue Owner/Admin/Trainer-Grenze aus den Auswirkungen
  erschliessen statt aus einer Erklärung im UI.
- **Coaching-Beziehung als Voraussetzung für Zuweisung:** Dieser
  Zwischenschritt (erst Coaching-Beziehung, dann erst ist eine Zuweisung für
  dieses Mitglied möglich) ist **nicht selbsterklärend aus der Navigation
  allein** — ein Owner, der direkt zu „Zuweisungen“ navigiert, bekommt zwar
  einen klaren Hinweistext im Zuweisungsdialog, wenn eine Beziehung fehlt
  („Für dieses Mitglied besteht keine aktive Coaching-Beziehung, die du
  verwenden kannst.“ — real gesehen im bestehenden E2E-Test), aber die
  Reihenfolge selbst (Coaching **vor** Programm **vor** Zuweisung **vor**
  Terminierung) wird an keiner Stelle als Ablauf/Checkliste erklärt.
- **Programm → Version → Tag → Übung → Veröffentlichung:** Funktional klar,
  aber mehrschrittig; es gibt **kein Vorlagen-/Demodaten-Angebot** — jedes
  Pilotstudio beginnt bei null Übungen im eigenen Programmkontext (nur der
  globale Übungs-Katalog mit 14 Einträgen ist vorbefüllt, s.
  Migration 003).
- **Terminierung:** Erst nach Zuweisung erreichbar, über einen klaren Link
  „Zeitplan“ direkt aus der Zuweisungsliste — gute Verkettung.
- **Erkennt ein Owner, wann das Studio „bereit“ ist?** **Nein** — es gibt
  keinen Setup-Fortschrittsindikator und keine „Studio ist startklar“-Meldung.
  Die einzige Rückmeldung ist implizit (die Nächste-Schritte-Kacheln
  verschwinden nicht, wenn sie erledigt sind — sie sind bei jedem
  Ladezustand identisch, s. Abschnitt 14).

**Fehlende Terminologie-Erklärungen:** Rollenbedeutung
(Owner/Admin/Trainer/Member), der Unterschied zwischen „Zuweisung“ und
„Terminierungsregel“, und die Bedeutung von „Version veröffentlichen“
(unveränderlich danach) werden jeweils erst im konkreten Handlungskontext
sichtbar (z. B. der Veröffentlichungs-Dialog warnt korrekt vor der
Unveränderlichkeit), nie vorab zusammengefasst.

**Würde ein Setup-Assistent/Demodaten/Vorlagen helfen?** Ja — insbesondere
für den allerersten Eindruck eines Pilotstudios ohne jede Übung/Programm
wäre eine optionale Beispielvorlage („Ganzkörper-Grundprogramm“) sinnvoll, um
den ersten Eindruck nicht an einer leeren Programmliste beginnen zu lassen.
Dies ist eine **Empfehlung, keine Implementierung** — siehe Abschnitt 32.

---

## 19. Daily-Operations-Audit

Anhand des Auftrags zu bewertende Punkte, jeweils mit dem tatsächlich
beobachteten Zustand:

| Erwarteter Betriebspunkt | Tatsächlich vorhanden? |
|---|---|
| Heutige Trainings | Nein auf Studio-Ebene — nur pro Mitglied im eigenen persönlichen Kalender. |
| Überfällige Trainings | Nein auf Studio-Ebene — `deriveDisplayStatus()` berechnet „Überfällig“ korrekt, aber nur für die eine Person, die den eigenen Kalender öffnet; kein Coach-Aggregat. |
| Neue Ergebnisse | Nein als Benachrichtigung/Zähler — nur durch manuelles Öffnen von „Ergebnisse“ und Durchsehen sichtbar. |
| Inaktive Mitglieder | Teilweise — der Status „Suspendiert“ ist in der Mitgliederliste sichtbar (Screenshot `04b`), aber es gibt **keinen** Hinweis auf schlicht **unaktive** (seit Wochen kein Training) aktive Mitgliedschaften — das Produkt unterscheidet nur Mitgliedschaftsstatus, nicht Trainingsaktivität. |
| Offene Einladungen | Ja, aber nur beim manuellen Öffnen von „Einladungen“ — kein Zähler/Hinweis auf der Übersicht. |
| Fehlende Coaching-Beziehungen | Nein — muss aktiv in „Coaching“ nachgesehen werden. |
| Zuweisungen ohne Terminierungsregel | Nein — kein Hinweis; erkennbar nur durch Öffnen jeder einzelnen Zuweisung. |
| Programme ohne veröffentlichte Version | Nein — die Programmliste zeigt zwar den Status je Version im Builder, aber keine Studio-weite Zusammenfassung „N Programme ohne veröffentlichte Version“. |
| Fehler/blockierte Abläufe | Nein zentral sichtbar — Fehler erscheinen nur lokal an der jeweiligen Aktion. |
| Warnungen | Nein. |
| Letzte Aktivität | Nein auf Studio-Ebene (im Gegensatz zum persönlichen Home, das „Letzte Aktivität“ zeigt). |
| Handlungsbedarf-Elemente | Nein. |

**Gesamtbewertung (explizit vom Auftrag gefordert):** Das aktuelle
Studio-Dashboard unterstützt **keine** echten täglichen Betriebsentscheidungen
— es ist, unverändert über den gesamten getesteten Lebenszyklus eines
Studios hinweg (leer bis stark befüllt, Screenshots `01` vs. `28` identisch),
reine statische Navigation. Alle in der Tabelle „fehlend“ markierten
Informationen **existieren als Rohdaten** im Backend (Mitgliedschaftsstatus,
Kalendereinträge mit Status, Zuweisungen, Programme, Audit-Ereignisse) — es
fehlt ausschliesslich eine aggregierende Sicht darauf. Das ist die
wesentliche Erkenntnis dieses Audits für die Ableitung der nächsten Phase
(Abschnitt 32).

---

## 20. Daten- und Verlaufskonsistenz

**20.1 Abgeschlossene Workouts sind faktisch unveränderlich.** Nach
Abschluss wechselt eine Session in einen Zustand, der laut
Workflow-Bildschirm „schreibgeschützt“ ist (real gesehen, Abschnitt 15); das
Statusübergangsmodell für Kalendereinträge
(`backend/domain/trainingCalendarDomain.js:93-99`) macht `COMPLETED`,
`SKIPPED` und `CANCELLED` **terminal** (leere Übergangsmengen) — es gibt
keinen Codepfad, der einen dieser drei Zustände zurückändert. Dies deckt sich
exakt mit der in `STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md` dokumentierten
bewussten Entscheidung, „Reaktivierung übersprungener/abgesagter Einträge“
nicht zu unterstützen.

**20.2 Programm-Snapshots bleiben historisch korrekt.** Eine gestartete
Workout-Session snapshot't ihren Plan bei Start (ADR 003) und liest nie das
aktuell möglicherweise weiterbearbeitete Programm live nach — bereits
publizierte Versionen sind zusätzlich unveränderlich (UI zeigt dies explizit
an, Abschnitt 17).

**20.3 Regeländerungen wirken nie rückwirkend.** Doppelt real reproduziert
(Abschnitt 16.1/16.2): Eine bereits materialisierte, abgeschlossene
Kalenderbelegung bleibt nach nachträglicher Bearbeitung der zugrundeliegenden
Terminierungsregel (auch bei Änderung des Wochentags) unverändert
`calendar-event-success`. Der Migrationskommentar zu `training_calendar_entries`
bestätigt dies als Architekturentscheidung: „spätere Regeländerungen fassen
bereits materialisierte Zeilen nie wieder an.“

**20.4 Deaktivierte Regeln erzeugen keine neuen, aber lassen bestehende
Termine unberührt.** Bestätigt sowohl im Code (Abschnitt 6.4) als auch real
im UI (Abschnitt 17, Status-Badge „Deaktiviert“, Aktionen der Zeile
entsprechend reduziert).

**20.5 Keine doppelten Workouts.** `training_calendar_entries` verknüpft
`personal_workout_id`/`studio_workout_session_id` mit `ON DELETE SET NULL`
statt `CASCADE` — ein gelöschtes Workout reisst nie den Kalendereintrag mit;
`calendar.spec.js` (grün, Teil der 59) prüft zusätzlich explizit „kein
doppelter persönlicher Eintrag“ bei Studio-Workouts.

**20.6 Keine Cross-Tenant-Daten.** Bestätigt durch `training.spec.js`
(„Zwei Browserkontexte sehen nur eigene Daten und fremde IDs bleiben
verborgen“, grün) sowie durch das Fremdstudio-Isolationsverfahren in
`adminPilotWalkthrough.spec.js` (404 statt Datenpreisgabe).

**20.7 Kein Owner/Admin-Bypass bei coach-spezifischen Ergebnissen.** ADR 003
und die Architekturaufnahme (Abschnitt 5.6) bestätigen: Zugriff auf
Session-/Satz-/Feedback-Daten erfordert für **jede** Rolle inklusive
Owner/Admin eine eigene aktive Coaching-Beziehung — es gibt keinen
rollenbasierten Blanko-Zugriff.

**20.8 Mitglieder sehen ausschliesslich eigene personenbezogene Daten.**
Bestätigt durch `getOwnProgramAssignmentDetail`/`listOwnProgramAssignments`
(nur „me“-Endpunkte für Mitglieder) und durch die reale
Fremdzugriffs-Prüfung in `workoutSessions.spec.js`.

**20.9 Feedback ist unveränderlich.** Migration 008 legt
`studio_workout_session_feedback` als append-only mit Idempotenzschlüssel
und ohne `updated_at` an; das UI warnt vor dem Absenden explizit „Dein
Feedback ist für das Mitglied dauerhaft sichtbar und kann danach nicht mehr
geändert werden.“ (real gesehen, Screenshot `24`).

**20.10 Revisionskonflikte werden nie still überschrieben.** CAS-Updates auf
`revision` werfen einen spezifischen Konfliktfehler bei Wettlauf — real
reproduziert in der E2E-Suite (`WORKOUT_SET_CONFLICT`, Abschnitt 11), nicht
nur behauptet.

**20.11 Datumslogik über CET/CEST.** Die in der Stage-5A3-Merge-Readiness-
Nachbereitung hinzugefügte Integrationstest (Studio-Zeitzone weicht vom
UTC-Tag des DB-Servers ab) ist Teil der 254 grünen Backend-Integrationstests
(Abschnitt 8) und deckt genau diesen Fall ab.

**Gesamtbewertung:** Alle elf geprüften Konsistenzgarantien sind sowohl im
Code als auch — wo sinnvoll möglich — durch einen tatsächlich ausgeführten
Test bestätigt. **Keine der geprüften Garantien wurde verletzt gefunden.**

---

## 21. Sicherheits- und Datenschutz-Audit

Klassifikation je Punkt: **technisch gelöst** / **teilweise gelöst** / **nur
dokumentiert** / **vor Produktion offen** / **vor Pilot offen** / **für
lokalen Pilot akzeptabel**.

| Punkt | Klassifikation | Beleg |
|---|---|---|
| Passwort-Richtlinie, Konto-Selbstverwaltung | technisch gelöst | Migration 009, grüne `accountSelfService.spec.js` |
| Login-Enumeration | technisch gelöst | fester Dummy-Hash-Vergleich bei unbekannter E-Mail (Abschnitt 5.2) |
| Sitzungsrotation, Refresh-Reuse-Detection | technisch gelöst | `sessionService.js`, grüne `authSession.spec.js` |
| Sitzungswiderruf (Logout/Logout-All) | technisch gelöst | `auth_version`-Invalidierung, real getestet |
| CSRF | technisch gelöst | Double-Submit + Origin-Guard (Abschnitt 5.3) |
| CORS | technisch gelöst — **Dokumentationsliste veraltet** | `corsOrigins.js` + grüne `corsSecurity.spec.js`; s. Abschnitt 3 |
| Rate-Limiting (geteilt, nicht pro Prozess) | technisch gelöst — **Dokumentationsliste veraltet** | Migration 011, s. Abschnitt 3 |
| Produktionskonfiguration (Trust-Proxy, HSTS, Cache-Control) | technisch gelöst | `proxyConfig.js` fail-closed, Startkonfigurationsprüfung |
| Secrets in Logs | technisch gelöst | rekursive Redaktion in `startup/logger.js` |
| PII-Klassifikation | technisch gelöst und dokumentiert | 5-stufiges Klassenmodell (P0–P4) in `FITTRACK_API_CATALOG.md`, inhaltlich weiterhin zutreffend trotz sonstiger Veraltung dieses Dokuments |
| Studio-Tenant-Isolation | technisch gelöst | 404-statt-403-Modell, real reproduziert |
| Audit-Ereignisse (inhaltlich) | technisch gelöst | striktes Allow-List-Redacting |
| Audit-Ereignisse (Unveränderlichkeit) | **nur Konvention, nicht DB-erzwungen** | kein Trigger/GRANT-Schutz (Abschnitt 5.9) |
| Account-Self-Service (E-Mail-Bestätigung, Replay-Schutz) | technisch gelöst | grüne E2E-Prüfung inkl. Replay-Ablehnung |
| Backups (Verschlüsselung, Restore-Freigabe) | technisch gelöst | AES-256-GCM, zielgebundene Bestätigung |
| Backups (Off-host, echter Cloud-Bucket) | **vor Produktion offen** | nur gegen lokales MinIO getestet (Abschnitt 3) |
| Migrations-Rollback | **nur dokumentiert, kein automatisierter Mechanismus** | `MIGRATION_RECOVERY.md`, Abschnitt 10 |
| Einzelne DB-Rolle für Runtime/Migration/Restore | **vor Produktion offen** | ein gemeinsamer `DB_USER` über `config/db.js`, unverändert seit Stage 3A |
| Recht auf Löschung/Anonymisierung | **vor Pilot offen, falls echte Personendaten pilotiert werden** | keine Spur im Schema (Abschnitt 6.5) — für einen rein internen Testpiloten mit Einverständnis der Teilnehmenden vertretbar, für einen Piloten mit echten zahlenden/schutzbedürftigen Endkund:innen ein echtes Risiko |
| Totes `coachActionEligibility` | **vor Produktion offen** (Wartungsrisiko, kein aktueller Fehlerpfad) | unverändert seit Stage 3A (Abschnitt 5.15) |
| `npm audit` Backend/Frontend | technisch gelöst | 0 Schwachstellen ≥ high in beiden (Abschnitt 8/9) |
| Health/Readiness | technisch gelöst | prüft DB **und** Migrationsstatus |
| Destruktive Aktionen (Test-DB-Reset) | technisch gelöst | real reproduziertes Fail-Closed-Verhalten (Abschnitt 8.1) |

**Gesamtbewertung:** Die für einen **lokalen** Piloten sicherheitsrelevanten
Mechanismen (Auth, Sitzungen, CSRF, CORS, Rate-Limiting, Tenant-Isolation,
Backup-Verschlüsselung) sind technisch gelöst und automatisiert getestet.
Echte, vor einer **Produktions**-Bereitstellung zu schliessende Lücken
bestehen unverändert seit Stage 3A (einzelne DB-Rolle, kein echter
Cloud-Bucket, kein Löschungsrecht, totes Policy-Codestück) — keine davon ist
neu, keine davon blockiert einen kontrollierten lokalen Pilotbetrieb mit
Teilnehmenden, die über den Testcharakter informiert sind.

---

## 22. Betrieb und Support

- **Lokaler Start:** `npm ci` (Backend/Frontend), `docker compose up -d`
  (MySQL), `npm run db:dev:init`, `npm run dev` — real in diesem Audit
  nachvollzogen (Abschnitt 7–9), funktioniert wie dokumentiert.
- **Migrationsablauf:** `db:migrate` → `db:migrate:status` →
  `db:migrate:doctor`, real ausgeführt (Abschnitt 10), liefert einen klaren,
  maschinenlesbaren Bereitschaftszustand.
- **Health-Endpunkte:** `/api/health/live` und `/api/health/ready` real
  vorhanden und funktional geprüft (Abschnitt 5.13).
- **Strukturierte Logs, Request-IDs:** vorhanden (Abschnitt 5.14) — für
  eine Fehlerdiagnose durch eine Person ohne Datenbankzugriff ausreichend.
- **Backup-Erstellung, Restore-Drill:** laut `STAGE_4A_FINAL_LOCAL_ACCEPTANCE.md`
  real gegen einen realistisch befüllten Datensatz durchgeführt (Abschnitt 3)
  — in diesem Audit nicht erneut wiederholt, da dies eine Änderung an
  Backup-Artefakten außerhalb des Repositories bedeutet hätte und der
  Auftrag ausdrücklich nur bereits vorhandene Evidenz und neue,
  nicht-destruktive Prüfungen vorsieht.
- **Off-host-Backup:** Code und Mechanik vorhanden, real nur gegen lokales
  MinIO verifiziert (Abschnitt 3/21) — kein echtes externes Ziel verbunden.
- **Support-Fähigkeit:** Es gibt keine dedizierte Support-Oberfläche/kein
  Ticket-System — Fehlerdiagnose für einen Piloten liefe über
  Log-/Audit-Einsicht durch die Betreiber:innen selbst. Für eine
  Handvoll Pilotnutzer:innen mit direktem Kontakt zum Entwicklungsteam
  ausreichend, für einen unbeaufsichtigten Betrieb nicht.
- **Incident-Response, Upgrade, Rollback:** Migrations-Rollback ist ein
  manueller, dokumentierter Prozess (Abschnitt 10/21); es gibt kein
  automatisiertes Deployment und daher auch keine automatisierte
  Rollback-Pipeline — für einen lokalen Piloten unkritisch (ein Entwickler
  kann jederzeit den vorherigen Commit auschecken), für eine echte
  Produktionsbereitstellung ein offener Punkt.
- **Produktionsbereitstellung:** Existiert nicht und wird von
  `DEPLOYMENT.md` selbst nicht behauptet — konsistent mit Abschnitt 3.

**Klare Trennung (wie vom Auftrag gefordert):** Alles oben Genannte
funktioniert **heute lokal real**; nichts davon wurde jemals gegen eine echte
externe Umgebung (Cloud-Bucket, echter SMTP-Empfänger ausserhalb eines
manuellen Einzeltests, öffentliches Hosting) verifiziert; die
Rollback-/Support-Lücken sind **vor einer Produktionsbereitstellung**, nicht
**vor einem lokalen Pilotbetrieb** zu schliessen.

---

## 23. Kommerzielle Glaubwürdigkeit

Aus Sicht eines kleinen unabhängigen Schweizer Fitnessstudios, ausschliesslich
auf Basis von in diesem Audit tatsächlich beobachtetem Verhalten (keine
unbelegten Marktaussagen):

- **Verständlich und professionell:** Ja — konsistente deutsche
  Beschriftung, klare Formulare, keine sichtbaren Platzhalter-/Debug-Texte in
  einem der 39 aufgezeichneten Bildschirme.
- **Sofort sichtbarer Wert:** Für Trainer:innen ja (Programm bauen,
  zuweisen, terminieren, Ergebnis sehen, Feedback geben — alles in einem
  Werkzeug statt verteilt über Excel/WhatsApp). Für Owner/Admin **nur
  eingeschränkt** — die Studio-Übersicht liefert keinen sofortigen
  Tagesüberblick (Abschnitt 19), was den ersten Eindruck einer
  betriebsführenden Person schwächt.
- **Zeitersparnis gegenüber Papier/WhatsApp/Excel:** Für den
  Trainingsplan-/Terminierungs-/Ergebnis-Workflow klar ja — ein vollständiger
  Coach-zu-Member-Zyklus lief in diesem Audit ohne einen einzigen manuellen
  Zwischenschritt ausserhalb der Anwendung.
- **Unterstützt den Trainer-Alltag:** Für die Ausführung einzelner
  betreuter Mitglieder ja; für einen Trainer mit vielen gleichzeitig
  betreuten Mitgliedern **nein** ohne Aggregatsicht (Abschnitt 14).
- **Unterstützt Mitgliederbindung:** Die Feedback-Funktion und der
  persönliche Kalender mit klaren Status liefern einen echten
  Bindungsmechanismus (sichtbare Trainer-Aufmerksamkeit); es fehlt jede Form
  von Erinnerung/Benachrichtigung ausserhalb der App selbst (bewusst
  ausserhalb des Funktionsumfangs, s. `FITTRACK_NEXT_PHASE_RECOMMENDATION.md`).
- **Fehlender operativer Wert, den ein Pilotstudio erwarten würde:** ein
  Tagesüberblick für Betreiber:innen (Abschnitt 19), eine erklärende
  Onboarding-Führung (Abschnitt 18).
- **Unnötige Funktionen vor wichtigeren Grundlagen:** keine gefunden — der
  Funktionsumfang wirkt bewusst schlank, nicht mit Nebenfunktionen
  überladen.

---

## 24. Bekannte Einschränkungen und bewusst offene Punkte

Unverändert und weiterhin bewusst ausserhalb des Scope (aus der Nachtrag-Kette
in `FITTRACK_NEXT_PHASE_RECOMMENDATION.md`, gegen aktuellen Code
stichprobenweise bestätigt): 2FA/Passkeys/Social-Login,
Passwort-vergessen/Reset-Selbstbedienung ohne Support, vollständige
Geräteverwaltung, Abrechnung/Payments, Chat/Reaktionen, KI-Feedback,
Analytics-Dashboard, Wearables, native Apps, Offline/PWA, White-Label,
Microservices/Kubernetes, E-Mail-Queues/Message-Broker. Zusätzlich: ein
echter externer Cloud-Bucket (Stage 2B2B, weiterhin „Deferred until first
customer / production deployment“), getrennte DB-Rollen, Backup-/Upload-
Scheduler und Schlüsselrotation. Diese Liste wird durch dieses Audit
**nicht** erweitert, ausser um die in Abschnitt 19 (Studio-Dashboard ohne
operative Sicht) und Abschnitt 27 (Audit-Log-Übersetzungslücke für neuere
Ereignistypen) neu dokumentierten Befunde.

---

## 25. Befundregister — Methodik und Übersicht

Jeder Befund erhält: ID, Kategorie, betroffene Rolle(n), betroffenen Ablauf,
Schweregrad (P0–P3), Pilot-Relevanz, Produktions-Relevanz,
Reproduktionsschritte, Erwartetes vs. tatsächliches Verhalten, Beleg,
Empfehlung, geschätzten Umfang und Abhängigkeiten. Schweregrade wie vom
Auftrag definiert: **P0 Blocker** (Pilot kann nicht sicher/sinnvoll
fortgesetzt werden), **P1** (vor Pilot erforderlich), **P2** (während des
Piloten nützlich), **P3** (später) — kleinere UI-Schönheitsfehler werden
bewusst **nicht** als P1 überklassifiziert.

**Ergebnis: 0 P0-Befunde, 1 P1-Befund, 3 P2-Befunde, 10 P3-Befunde.** Kein
einziger der in diesem Audit tatsächlich ausgeführten Abläufe (Regression,
E2E-Suite, Cross-Role-Szenario, Rollendurchläufe) schlug fehl oder war
blockiert — die Nulls bei P0 sind damit ein **erarbeitetes**, nicht
angenommenes Ergebnis.

---

## 26. Befunde P0 (Blocker)

**Keine.** Es wurde in diesem Audit keine Situation gefunden, in der ein
Datenverlust, ein Cross-Tenant-Leck, ein kritisches Auth-Versagen, ein
unmöglicher Kernablauf, unwiederherstellbare Daten oder ein wiederholt
fehlschlagender Kernablauf aufgetreten wäre. Alle 59 E2E-Tests, alle 508+254+32
Backend-Tests, alle 499 Frontend-Tests und das komplette 18-Schritte-
Cross-Role-Szenario liefen zweifach (bestehende Suite + eigenes
Zusatzskript) fehlerfrei.

---

## 27. Befunde P1 (vor Pilot erforderlich)

### P1-1: Kein Prozess für Löschung/Anonymisierung echter Personendaten

- **Kategorie:** Datenschutz/Compliance
- **Rolle(n):** alle (Owner, Trainer, Member)
- **Betroffener Ablauf:** Beendigung der Teilnahme eines echten Piloten-Mitglieds oder -Trainers
- **Schweregrad:** P1
- **Pilot-Relevanz:** Hoch — sobald echte, nicht rein interne Testpersonen
  (reale Trainer:innen/Members eines Pilotstudios) personenbezogene
  Trainings-/Gesundheitsdaten in FitTrack erfassen, gilt Schweizer
  Datenschutzrecht unabhängig vom „Pilot“-Status.
- **Produktions-Relevanz:** Hoch (unverändert)
- **Reproduktionsschritte:** Datenbankschema (Migrationen 001–012)
  vollständig nach `deleted_at`/Anonymisierungs-/Retention-Mechanismen
  durchsucht — keine Treffer (Abschnitt 6.5).
- **Erwartetes Verhalten:** Ein dokumentierter, und sei es rein manueller,
  Weg, eine reale Person auf Anfrage vollständig zu löschen oder zu
  anonymisieren.
- **Tatsächliches Verhalten:** Kein Lösch-Endpunkt, kein Anonymisierungs-Skript,
  keine Retention-Policy irgendwo im Schema oder Code gefunden.
- **Beleg:** Abschnitt 6.5 (Grep über alle Migrationen), bestätigt konsistent
  mit `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`, das dies seit Stage 3A als
  offen führt.
- **Empfohlene Massnahme:** Vor Aufnahme eines Piloten mit echten,
  nicht-anonymen Personen mindestens einen **manuellen** Prozess
  (dokumentiertes SQL-Skript plus Vier-Augen-Freigabe) definieren und den
  Teilnehmenden im Rahmen der Pilotvereinbarung/Einwilligung transparent
  kommunizieren; ein automatisierter Self-Service-Weg ist **nicht**
  Voraussetzung für den Pilotstart, wohl aber für eine spätere
  Produktionsphase.
- **Geschätzter Umfang:** Für den manuellen Prozess: gering (Dokumentation +
  ein Skript, kein neuer Code im Produkt). Für einen automatisierten
  Self-Service-Weg: mittel bis gross (neue Phase).
- **Abhängigkeiten:** Keine.

---

## 28. Befunde P2 (während des Pilots nützlich)

### P2-1: Studio-Dashboard liefert keine operative Tagesübersicht

- **Kategorie:** Produktvollständigkeit / Daily-Usability
- **Rolle(n):** Owner, Admin, Trainer
- **Betroffener Ablauf:** täglicher Betrieb eines Studios
- **Pilot-Relevanz:** Mittel — kein Ablauf ist blockiert (alle nötigen Daten
  sind über Einzelseiten erreichbar), aber die tägliche Effizienz für
  Betreiber:innen/Trainer:innen ist gering.
- **Produktions-Relevanz:** Mittel
- **Reproduktionsschritte:** `StudioDashboardView.vue` vollständig gelesen
  (194 Zeilen); Screenshot einer leeren Studio-Übersicht direkt nach
  Erstellung und einer nach vollständigem Durchlauf (5 Mitgliedschaften,
  Coaching, Programm, Zuweisung, 3 Terminierungsregeln, abgeschlossenes
  Workout, Feedback, 24 Audit-Ereignisse) verglichen.
- **Erwartetes Verhalten:** Sichtbare Kennzahlen/Hinweise zu heutigen/
  überfälligen Trainings, neuen Ergebnissen, inaktiven Mitgliedern, offenen
  Einladungen, fehlenden Coaching-Beziehungen, unterminierten Zuweisungen.
- **Tatsächliches Verhalten:** Beide Screenshots sind inhaltlich identisch —
  drei statische Navigationskacheln, unabhängig vom Studio-Zustand.
- **Beleg:** Abschnitte 14, 19; Screenshots `01-owner-studio-dashboard-empty.png`,
  `28-owner-studio-dashboard-with-activity.png`.
- **Empfohlene Massnahme:** siehe Abschnitt 32 (Empfehlung für die nächste Phase).
- **Geschätzter Umfang:** mittel (mehrere neue Read-Endpunkte/Aggregationsabfragen plus eine neue Dashboard-Sektion).
- **Abhängigkeiten:** keine — alle zugrundeliegenden Rohdaten existieren bereits.

### P2-2: Audit-Log zeigt neuere Ereignistypen nur als unübersetzten Fallback

- **Kategorie:** UX / Dokumentationskonsistenz
- **Rolle(n):** Owner, Admin
- **Betroffener Ablauf:** Audit-Log-Einsicht nach Kalender-/Terminierungsaktionen
- **Pilot-Relevanz:** Mittel — gerade weil ein Pilot sich stark auf die neue
  Kalender-/Terminierungsfunktion konzentrieren dürfte, werden Owner/Admin
  überproportional häufig unübersetzte Zeilen sehen.
- **Produktions-Relevanz:** Niedrig-mittel
- **Reproduktionsschritte:** Owner meldet sich an, öffnet nach einem
  vollständigen Terminierungs-/Kalender-Ablauf `/studios/:id/audit`.
- **Erwartetes Verhalten:** Wie bei allen anderen Ereignistypen ein lesbarer,
  übersetzter Text (entsprechend Stage 3C „vollständige Audit-Log-Übersetzung“).
- **Tatsächliches Verhalten:** Zeilen wie „Weiteres Ereignis
  (calendar.studio_worko…“ und „Weiteres Ereignis
  (assignment.schedule_r…“ — der sichere Fallback (kein roher Code, kein
  Absturz) funktioniert wie designed, ist aber keine echte Übersetzung.
  Bestätigt auch dadurch, dass die bestehende, grüne
  `adminPilotWalkthrough.spec.js`-Prüfung auf „keine rohen Ereigniscodes“ nur
  die ursprünglichen fünf Domänenpräfixe (`invitation`, `training_program`,
  `workout_session`, `workout_feedback`, `coaching_relationship`) abdeckt —
  `calendar`/`assignment_schedule_rule` fehlen in dieser Testliste ebenso wie
  im Übersetzungswörterbuch.
- **Beleg:** Abschnitt 5.9, 17, 19; Screenshot `26-owner-audit-log.png`.
- **Empfohlene Massnahme:** Übersetzungseinträge für die Stage-5A1/5A3-
  Ereignistypen ergänzen (analog zu den 15 in Stage 3C ergänzten Typen) und
  die bestehende Regex-Prüfung um die beiden neuen Präfixe erweitern.
- **Geschätzter Umfang:** klein.
- **Abhängigkeiten:** keine.

### P2-3: Onboarding ohne Fortschrittssignal, Vorlagen oder Rollen-Erklärung

- **Kategorie:** Onboarding/UX
- **Rolle(n):** Owner
- **Betroffener Ablauf:** Ersteinrichtung eines neuen Pilotstudios
- **Pilot-Relevanz:** Mittel — kein Schritt ist blockiert, aber ein Owner
  ohne Entwickler:innen-Hilfe muss die richtige Reihenfolge
  (Coaching-Beziehung vor Zuweisung vor Terminierung) selbst erschliessen und
  erhält nie eine „Studio ist startklar“-Rückmeldung.
- **Produktions-Relevanz:** Niedrig
- **Reproduktionsschritte:** vollständiger Owner-Ersteinrichtungs-Ablauf,
  Abschnitt 18.
- **Erwartetes Verhalten:** laut Auftrag zu bewerten: Setup-Assistent,
  Demodaten/Vorlagen, klares Bereitschaftssignal.
- **Tatsächliches Verhalten:** keines der drei vorhanden; Einzelschritte
  selbst sind aber jeweils klar beschriftet und fehlerresistent (klare
  Hinweistexte bei fehlenden Voraussetzungen).
- **Beleg:** Abschnitt 18.
- **Empfohlene Massnahme:** optionale Programmvorlage(n) beim ersten
  Programm-Erstellen anbieten; kurze Rollen-Erklärung im
  Einladungsdialog; siehe Abschnitt 32.
- **Geschätzter Umfang:** klein bis mittel.
- **Abhängigkeiten:** keine.

---

## 29. Befunde P3 (später)

| ID | Kategorie | Befund | Beleg | Pilot-Relevanz | Produktions-Relevanz | Empfehlung |
|---|---|---|---|---|---|---|
| P3-1 | UX | Terminierungsregeln: gestapelte Erfolgs-Toasts verdecken kurzzeitig Aktionsschaltflächen der zuletzt erstellten Zeile | Abschnitt 17, Screenshot `12` | gering (selbstauflösend) | gering | Toast-Stacking-Layout anpassen (z. B. Aktionsspalte nie verdecken) |
| P3-2 | UX-Konsistenz | `MyTrainingPlanView.vue`/`InvitationAcceptView.vue` ohne `reconcileStudioAccess()`-Selbstheilung bei 403 | Abschnitt 4.2 (Code, seit Stage 3A unverändert) | gering (Randfall: Zugriffsentzug während offener Seite) | gering | gleiches Reconcile-Muster wie die neun anderen Views ergänzen |
| P3-3 | Tech-Debt | `coachActionEligibility` weiterhin totes, irreführendes Bypass-Codestück | Abschnitt 5.15 | keine | mittel (Wartungsrisiko bei künftiger Wiederverwendung) | entfernen oder tatsächlich verdrahten |
| P3-4 | Entwicklungsumgebung | Git-Bash/Windows: `VITE_API_BASE_URL=/api` wird ohne `MSYS_NO_PATHCONV=1` in einen Windows-Pfad umgeschrieben | Abschnitt 9.2, bereits in `LOCAL_PILOT_RUNBOOK.md` §23 dokumentiert | keine | keine | keine Code-Änderung nötig, ggf. Hinweis prominenter platzieren |
| P3-5 | Dokumentation | `README.md` erwähnt Kalender/Coach-Terminierung nicht | Abschnitt 3 | keine | keine | Feature-Liste ergänzen |
| P3-6 | Dokumentation | `FITTRACK_API_CATALOG.md`/`FITTRACK_VIEW_CATALOG.md` stark veraltet (vor Stage 1B.2B2A/Kalender) | Abschnitt 3 | keine | keine | aktualisieren oder als „historisch, siehe Stage-Dokumente“ kennzeichnen |
| P3-7 | Dokumentation | `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`: Liste „Auffällige Lücken“ widerspricht eigenem Stage-3D-Nachtrag (CORS/Rate-Limiter) | Abschnitt 3 | keine | keine | betroffene Listenpunkte durchstreichen |
| P3-8 | Betrieb/Produktion | Eine einzige DB-Rolle für Runtime/Migration/Restore | Abschnitt 5/21 (unverändert seit Stage 3A) | keine (lokal) | mittel | vor Produktion getrennte Rollen einführen |
| P3-9 | Betrieb/Produktion | Kein automatisierter Migrations-Rollback, nur manueller Recovery-Prozess | Abschnitt 10, `MIGRATION_RECOVERY.md` | keine | mittel | bereits bewusst so dokumentiert; keine Änderung für den Piloten nötig |
| P3-10 | Betrieb/Produktion | Off-host-Backup nie gegen echten Cloud-Bucket verifiziert | Abschnitt 3/21/22 | keine (bereits als „Deferred until first customer“ eingestuft) | mittel | Stage 2B2B bei Bedarf eines echten Kunden nachholen |

---

## 30. Pilot Go/No-Go-Matrix

| Bereich | Status | Begründung | Bedingung(en) | Befund |
|---|---|---|---|---|
| Auth/Sitzungen | **GO** | vollständig getestet, real reproduziert | — | — |
| Tenant-Isolation | **GO** | 404-statt-403-Modell, real reproduziert | — | — |
| Owner-Onboarding | **GO WITH CONDITIONS** | funktional vollständig | kein Bereitschaftssignal, keine Rollen-Erklärung | P2-3 |
| Trainer-Onboarding | **GO WITH CONDITIONS** | funktional vollständig | keine Tagesübersicht über betreute Mitglieder | P2-1 |
| Member-Onboarding | **GO** | vollständig, inkl. Mobile | — | — |
| Einladungen | **GO** | inkl. Resend/Widerruf/Redaktion nach Annahme | — | — |
| Coaching-Beziehungen | **GO** | RBAC real reproduziert | — | — |
| Programme | **GO** | Entwurf/Veröffentlichung/Unveränderlichkeit real reproduziert | — | — |
| Zuweisungen | **GO** | — | — | — |
| Terminierung | **GO** | inkl. Verlaufskonsistenz nach Regeländerung, doppelt real reproduziert | Toast-Layout-Detail | P3-1 |
| Persönlicher Kalender | **GO** | Mobile real bestätigt | — | — |
| Workout-Ausführung | **GO** | inkl. Konfliktverhalten real reproduziert | — | — |
| Trainingshistorie | **GO** | — | — | — |
| Coach-Ergebnisse | **GO** | — | — | — |
| Feedback | **GO** | append-only real bestätigt | — | — |
| Konto-Selbstverwaltung | **GO** | — | — | — |
| Mobile | **GO** | 390×844 real und automatisiert geprüft | — | — |
| Barrierefreiheit | **GO** | 0 serious/critical Axe-Funde in 59 Tests | — | — |
| Backups | **GO WITH CONDITIONS** | lokale Verschlüsselung/Drill real verifiziert (frühere Stage) | nur lokal verlässlich, kein echter Off-host-Schutz | P3-10 |
| Restore | **GO WITH CONDITIONS** | Mechanik vorhanden und früher real verifiziert | kein automatisierter Migrations-Rollback | P3-9 |
| E-Mail | **GO** | Dev-Outbox funktional, echter SMTP-Versand laut Stage 2A manuell verifiziert | — | — |
| Logging | **GO WITH CONDITIONS** | strukturierte Logs vollständig | Audit-Log-UI mit Übersetzungslücke für neue Ereignistypen | P2-2 |
| Support-Fähigkeit | **GO WITH CONDITIONS** | — | kein Ticketsystem, direkter Entwicklungskontakt vorausgesetzt | Abschnitt 22 |
| Deployment | **GO WITH CONDITIONS** | für lokalen Betrieb vollständig | keine Produktionsbereitstellung vorhanden/beabsichtigt | Abschnitt 22 |
| Privatsphäre/Datenschutz | **GO WITH CONDITIONS** | Kernmechanismen technisch gelöst | kein Löschungs-/Anonymisierungsprozess vor Aufnahme echter Personen | P1-1 |
| **Gesamtprodukt** | **GO WITH CONDITIONS** | 0 P0, 1 P1, 3 P2 — kein Bereich ist NO-GO | P1-1 vor Pilotstart klären; P2-Punkte können während des Piloten parallel bearbeitet werden | — |

---

## 31. Zentrale Frage: Ist FitTrack pilotbereit? (17 Dimensionen)

1. **Technische Pilot-Bereitschaft:** Ja — vollständige, real ausgeführte
   Regression (Backend/Frontend/Migrationen/E2E) ohne einen einzigen
   Fehlschlag (Abschnitte 8–11).
2. **Produktvollständigkeit:** Ja für den Kern-Trainingszyklus
   (Programm→Zuweisung→Terminierung→Ausführung→Feedback); Lücke bei der
   operativen Tagesübersicht (P2-1).
3. **Owner-Workflow:** Ja, mit Onboarding-Reibung (P2-3).
4. **Admin-Workflow:** Ja, Grenze zu Owner real bestätigt.
5. **Trainer-Workflow:** Ja für Einzelbetreuung, eingeschränkt bei mehreren
   gleichzeitig betreuten Mitgliedern ohne Aggregatsicht (P2-1).
6. **Member-Workflow:** Ja, inkl. Mobile.
7. **Onboarding:** Grösstenteils ja, ohne Assistenten/Demodaten (P2-3).
8. **Alltagstauglichkeit:** Für Einzelaufgaben ja, für Betriebsüberblick nein (P2-1).
9. **Sicherheit/Datenschutz:** Für einen kontrollierten, informierten
   Pilotenkreis ja, **unter der Bedingung**, dass vor Aufnahme echter
   Personen ein — und sei es rein manueller — Löschprozess definiert wird (P1-1).
10. **Betrieb/Support:** Ja für einen eng begleiteten Piloten mit direktem
    Entwicklungskontakt, nein für unbeaufsichtigten Betrieb.
11. **Backup/Recovery:** Ja lokal, nein für echten Standortverlust (kein
    verbundener externer Bucket — bereits bewusst zurückgestellt).
12. **Datenqualität/Konsistenz:** Ja — alle elf geprüften Garantien halten (Abschnitt 20).
13. **UX/Barrierefreiheit:** Ja — durchgehend klar, 0 kritische Axe-Funde,
    ein kosmetischer Toast-Layout-Punkt (P3-1).
14. **Mobile:** Ja, real bei 390×844 bestätigt.
15. **Fehler-/Konfliktverhalten:** Ja — Revisionskonflikte, Fremdzugriffe,
    fehlende Coaching-Beziehungen liefern durchgängig klare, korrekte
    Fehlermeldungen statt stiller Fehlschläge oder Abstürze.
16. **Kommerzielle Glaubwürdigkeit:** Ja für den Trainingszyklus, gedämpft
    durch die fehlende Betriebsübersicht für Owner/Trainer (Abschnitt 23).
17. **Bekannte Grenzen:** Vollständig benannt und unverändert seit Stage 3A
    bewusst zurückgestellt (Abschnitt 24), keine neue kritische Grenze
    entdeckt.

**Antwort:** **Ja, mit einer Bedingung.** FitTrack ist bereit, mit einem
kleinen realen Pilotstudio getestet zu werden, **sofern** vor Aufnahme
echter, nicht-anonymer Trainer:innen/Members mindestens ein manueller
Löschprozess für Personendaten definiert und den Teilnehmenden transparent
gemacht wird (P1-1). Ohne diese eine Bedingung wäre die Antwort „ja, aber mit
einem offenen Compliance-Risiko“ — mit ihr ist sie ein uneingeschränktes
„ja“. Die drei P2-Befunde (fehlende Betriebsübersicht, Audit-Log-
Übersetzungslücke, Onboarding-Reibung) verringern die Effizienz, nicht die
Sicherheit oder Funktionsfähigkeit des Piloten, und können parallel zum
laufenden Pilotbetrieb bearbeitet werden.

---

## 32. Empfehlung für die nächste Entwicklungsphase

**P1-1 (Löschprozess) ist ausdrücklich keine Entwicklungsphase**, sondern
eine organisatorische Voraussetzung (Dokumentation + manueller Prozess +
Teilnehmer:innen-Kommunikation), die vor Pilotstart und unabhängig von jeder
Code-Änderung geklärt werden kann und sollte.

Für die nächste **Code**-Phase gibt es — anders als nach Stage 5A1/5A2, wo
jeweils der nächste Kalender-Baustein die offensichtliche Fortsetzung war —
diesmal **keinen offenen P0/P1-Funktionslücke**, die eine neue
Trainings-Funktion rechtfertigen würde. Die mit Abstand konsistenteste,
mehrfach unabhängig belegte Erkenntnis dieses Audits (Abschnitte 14, 17, 19,
23, P2-1) ist stattdessen eine **operative** Lücke: Owner/Admin/Trainer haben
keine aggregierte Sicht auf den tatsächlichen Zustand ihres Studios. Die
empfohlene nächste Phase ist daher — wie vom Auftrag ausdrücklich als
legitime Alternative zu einer weiteren Kalenderfunktion vorgesehen — eine
**Pilot-Operations-Dashboard-Phase**, nicht „Kalender-Feature Nr. 4“.

### Empfehlung: Stage 5C — Studio Operations Dashboard

**Begründung:** Löst P2-1 (keine Betriebsübersicht) vollständig und P2-3
(kein Bereitschaftssignal) teilweise; P2-2 (Audit-Log-Übersetzung) wird als
kleine, thematisch benachbarte Korrektur mitgeliefert, da sie dieselbe
Codestelle (Audit-Ereignis-Übersetzungswörterbuch) betrifft wie ohnehin für
die neuen Dashboard-Kennzahlen mitgelesen werden muss.

**In Scope:**
- Ein erweitertes `StudioDashboardView.vue` mit echten, aus bereits
  existierenden Tabellen abgeleiteten Kennzahlen: heutige/überfällige
  Trainings (aus `training_calendar_entries`, rollenabhängig — Trainer sehen
  nur eigene Coaching-Beziehungen, Owner/Admin studio-weit), neue,
  unkommentierte Ergebnisse (Sessions ohne Feedback seit N Tagen), offene
  Einladungen, Mitgliedschaften ohne Aktivität seit N Tagen, Zuweisungen ohne
  Terminierungsregel, Programme ohne veröffentlichte Version.
- Neue, rein lesende Backend-Aggregations-Endpunkte (kein neues Datenmodell,
  keine neue Migration — alle Rohdaten existieren bereits laut Abschnitt 6).
- Übersetzungseinträge für `calendar.*`/`assignment_schedule_rule.*`-
  Audit-Ereignistypen (P2-2) plus Erweiterung der bestehenden
  „keine rohen Ereigniscodes“-Testprüfung um diese Präfixe.
- Eine sehr kleine Onboarding-Ergänzung: eine statische Rollen-Kurzerklärung
  im Einladungsdialog (P2-3, Teilaspekt) — **kein** Setup-Assistent, **keine**
  Demodaten/Vorlagen (bewusst ausgeklammert, siehe „Out of Scope“).

**Out of Scope:**
- Setup-Assistent, Programmvorlagen/Demodaten (grösserer Aufwand, kein P1/P2-
  Blocker, kann als eigener, späterer Vorschlag behandelt werden).
- Jede neue Trainings-/Kalender-/Terminierungs-Funktion.
- P1-1 (Löschprozess) — organisatorisch, nicht Teil dieser Phase.
- Stage 2B2B (echter Cloud-Bucket), getrennte DB-Rollen, automatisierter
  Migrations-Rollback — alle unverändert „Deferred until first customer /
  production deployment“.
- `coachActionEligibility`-Bereinigung — unabhängiges, unzusammenhängendes
  Aufräum-Ticket.

**Erwartete Änderungen:** Backend: 3–5 neue schreibgeschützte
Aggregations-Endpunkte unter `/api/v1/studios/:studioId/dashboard/*`, keine
neue Migration. Frontend: Erweiterung von `StudioDashboardView.vue` um
Kennzahl-Kacheln (analog zur bereits bestehenden, gut bewerteten
„Auf einen Blick“-Sektion des persönlichen `HomeView.vue`, Abschnitt 17),
neue i18n-Einträge für Dashboard-Texte und die fehlenden Audit-Ereignistypen.

**Tests/E2E/Barrierefreiheit/Sicherheit:** Neue Backend-Unit-/Integrationstests
für jede Aggregationsabfrage (inkl. Rollen-Scoping-Test: ein Trainer sieht nur
eigene Coaching-Beziehungen in den Kennzahlen); ein neuer E2E-Test analog zu
`adminPilotWalkthrough.spec.js`, der die Dashboard-Kennzahlen nach einem
realistischen Ablauf gegen die tatsächlich erzeugten Daten prüft; Axe-Check
für die erweiterte Ansicht (Muster aus `accessibility.spec.js` übernehmbar).
Kein neues Sicherheitsrisiko zu erwarten, da ausschliesslich lesende
Aggregation über bereits existierende, RBAC-geschützte Daten — die
Rollen-Scoping-Tests sind trotzdem zwingend, um keinen versehentlichen
Cross-Coaching-Leak einzuführen.

**Risiken:** Aggregationsabfragen über mehrere Tabellen hinweg müssen bei
grösseren Studios performant bleiben (Indizes prüfen); Gefahr, dass ein
Trainer versehentlich Kennzahlen über nicht-eigene Coaching-Beziehungen sieht,
wenn die Aggregation nicht exakt dasselbe Scoping wie die bestehenden
Einzel-Endpunkte verwendet — muss explizit getestet werden (siehe oben).

**Akzeptanzkriterien (grob):** Owner/Admin sehen studio-weite Kennzahlen,
Trainer nur über eigene Coaching-Beziehungen; alle Kennzahlen stimmen mit den
bereits bestehenden Einzelansichten überein (kein widersprüchlicher
Doppel-Datensatz); 0 neue Axe-„serious“/„critical“-Funde; bestehende 59 E2E-
Tests bleiben grün; Migration Doctor bleibt bei `applied:12` (keine neue
Migration).

**Grobe Umsetzungsreihenfolge:** (1) Backend-Aggregationsendpunkte + Tests,
(2) Audit-Übersetzungs-Nachtrag, (3) Frontend-Dashboard-Erweiterung + Tests,
(4) Rollen-Kurzerklärung im Einladungsdialog, (5) volle Regression + neuer
E2E-Test, (6) Dokumentation (`STAGE_5C_STUDIO_OPERATIONS_DASHBOARD.md` nach
demselben Muster wie die vorherigen Stage-Dokumente).

---

## 33. Artefakt-Handhabung und Bereinigung

Alle für dieses Audit erzeugten Artefakte sind lokal, ausserhalb des
Repositories (`AppData/Local/Temp/...`) abgelegt und werden **nicht**
committet: Backend-/Frontend-Regressionslogs, der volle E2E-Lauf, die 39
Screenshots des Zusatzskripts inklusive dessen eigenem Log. Keines der
Artefakte enthält Klartext-Tokens oder Passwörter — alle im Zusatzskript
verwendeten Zugangsdaten sind zur Laufzeit generierte, ausschliesslich
lokale E2E-Testfixtures (`E2E_PASSWORD`-Konstante aus `helpers.js`, wie in
der gesamten bestehenden Suite üblich). `frontend/e2e/_stage5bAuditCapture.spec.js`
wurde nach Abschluss der Auswertung aus dem Arbeitsbaum entfernt (nie
committet, `git status` bestätigt einen sauberen Baum bezogen auf
Testdateien). Der `fittrack_minio`-Container (Profil `backup-test`) wurde
nach Abschluss der Backend-Regression gestoppt und entfernt. Der bereits vor
diesem Audit laufende `fittrack_mysql`-Container (reguläre lokale
Entwicklungsdatenbank) wurde unverändert weiterlaufen gelassen, da er kein
für dieses Audit erzeugtes Artefakt ist, sondern die bestehende
Projekt-Infrastruktur.

---

## 34. Abgrenzung — was dieses Audit nicht leistet

Dieses Audit ist keine Penetrationstest-Sicherheitsprüfung durch Dritte, kein
Lasttest, keine Prüfung gegen eine echte Produktionsumgebung, keine
rechtliche Datenschutz-Beratung (P1-1 ist eine Beobachtung, keine
Rechtsauskunft), und keine Entscheidung über eine Produktionsbereitstellung.
Es ersetzt nicht die in `docs/LOCAL_PILOT_RUNBOOK.md` beschriebene
tatsächliche Durchführung eines Backup-/Restore-Drills während dieses Audits
selbst — ein solcher Drill wurde in Stage 4A bereits real durchgeführt und
hier nicht destruktiv wiederholt, um keine bestehenden lokalen Artefakte zu
gefährden (Abschnitt 22). Es trifft keine Aussage über Mehrsprachigkeit
jenseits von DE/EN, über Skalierbarkeit bei vielen gleichzeitigen Studios,
oder über kommerzielle Preisgestaltung.

---

## 35. Schlussfolgerung

FitTrack ist, gemessen an tatsächlich ausgeführten Tests, echten
(wenn auch mangels interaktiver Browser-Fernsteuerung skriptgesteuerten)
Chromium-Abläufen über alle vier Rollen und einer detaillierten
Architektur- und Datenbankprüfung, **bereit für einen kleinen, kontrollierten
lokalen Pilotbetrieb mit einem realen Studio** — unter der einen im
Auditverlauf herausgearbeiteten Bedingung, vor Aufnahme echter Personen einen
Löschprozess für deren Daten zu definieren (P1-1). Es gibt **keine**
P0-Blocker: kein gefundener Datenverlust, kein Cross-Tenant-Leck, kein
kritisches Auth-Versagen, kein unmöglicher Kernablauf. Der komplette
Coach-zu-Member-Trainingszyklus — von der Studio-Gründung über Einladung,
Coaching-Beziehung, Programm, Terminierung, Kalender, Trainingsausführung bis
zu Feedback und Audit-Log — funktioniert nachweislich, mehrfach unabhängig
reproduziert, ohne einen einzigen fehlgeschlagenen Schritt. Die grösste real
belegte Schwäche ist keine fehlerhafte Funktion, sondern eine fehlende: eine
aggregierte Betriebssicht für Owner/Admin/Trainer, die in Abschnitt 32 als
konkrete, eng begrenzte nächste Phase vorgeschlagen wird. Dieses Audit
selbst hat **keine neue Produktfunktion implementiert, keine bestehenden
Fehler repariert, keine Migration angelegt, keine Cloud-Infrastruktur
eingerichtet und keine weitere Entwicklungsphase begonnen** — es liefert
ausschliesslich die hier dokumentierte, evidenzbasierte Grundlage für eine
explizite Entscheidung des Auftraggebers.
