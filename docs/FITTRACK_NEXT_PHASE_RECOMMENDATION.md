# Empfehlung für die nächste Entwicklungsphase

> **Nachtrag (2026-07-22, Stage 3A Local Pilot Readiness Audit, Commit `dc12b10`):**
> Ein vollständiges, evidenzbasiertes Audit des lokalen Produktzustands wurde
> durchgeführt — siehe `STAGE_3A_LOCAL_PILOT_READINESS_AUDIT.md`. Ergebnis:
> **keine P0-Befunde**, Gesamtklassifikation **lokal pilotfähig**. Die dort
> identifizierten P1-Befunde ergänzen und verfeinern die operativen Punkte
> dieses Dokuments um konkrete produktseitige Lücken: kein Passwort-/
> E-Mail-Selbstverwaltungs-UI, kein Einladungs-Resend, kein JWT-Refresh/
> Logout-Revocation, uneinheitliche Audit-Log-Übersetzung, Rate-Limiting
> weiterhin nur auf Login/Registrierung. Die dort vorgeschlagene, feiner
> geschnittene Blockreihenfolge (Stage 3B1 Konto-Selbstverwaltung, Stage 3B2
> Sitzungs-Härtung, Stage 3C UX-Politur, Stage 3D Rate-Limiting/CORS) ist als
> Ergänzung zur „Backup-/DB-Härtung"-Fortsetzung unten zu verstehen, nicht als
> Ersatz — beide Empfehlungen bestehen nebeneinander, bis der Auftraggeber
> explizit priorisiert. **Ausdrücklich bestätigt: Stage 2B2B (echter
> externer Off-host-Bucket) ist zurückgestellt, bis ein erster zahlender
> Kunde oder eine konkrete Produktions-Hosting-Entscheidung vorliegt — sie
> ist kein lokaler Pilot-Blocker und wurde in Stage 3A entsprechend nicht als
> P0/P1-Produktlücke, sondern als „Deferred until hosting" eingestuft.**
> Diese Empfehlung wurde durch Stage 3A **nicht** rückwirkend umgeschrieben.
>
> ---
>
> **Nachtrag (2026-07-22, Stage 3B1 Account Self-Service):** Stage 3B1
> (Konto-Selbstverwaltung, siehe `STAGE_3B1_ACCOUNT_SELF_SERVICE.md`) ist
> abgeschlossen: Passwortänderung, verifizierte E-Mail-Änderung und
> zuverlässige Token-Invalidierung (`auth_version`-Claim, Migration 009) sind
> implementiert und vollständig automatisiert getestet. Von den oben
> genannten Stage-3A-P1-Punkten sind damit **zwei geschlossen**
> (Passwort-/E-Mail-Selbstverwaltungs-UI, JWT-Invalidierung nach
> sicherheitsrelevanten Kontoänderungen). Weiterhin offen und nicht Teil
> dieser Phase: Einladungs-Resend, JWT-**Refresh** (nur die Invalidierung
> wurde adressiert, kein Refresh-Token-Mechanismus), Geräte-/
> Sitzungsübersicht, uneinheitliche Audit-Log-Übersetzung, Rate-Limiting
> weiterhin pro Prozess (jetzt zusätzlich für die drei neuen
> Konto-Endpunkte, mit denselben Grenzen wie Login/Registrierung). Die in
> Stage 3A vorgeschlagene Blockreihenfolge (3B1 → 3B2 Sitzungs-Härtung → 3C
> UX-Politur → 3D Rate-Limiting/CORS) bleibt unverändert; **Stage 3B2 wurde
> nicht begonnen.** Stage 2B2B bleibt weiterhin **Deferred until first
> customer / production deployment** — unverändert durch diese Phase.
>
> ---
>
> **Nachtrag (2026-07-25, Stage 3B2 Session Hardening):** Stage 3B2
> (Sitzungs-Härtung, siehe `STAGE_3B2_SESSION_HARDENING.md`) ist
> abgeschlossen: serverseitig widerrufbare Authentifizierungssitzungen,
> rotierende einmalig verwendbare Refresh Tokens, vollständiges
> Logout/Logout-All, CSRF-/Origin-Schutz für die Cookie-Endpunkte, sowie die
> Schließung des Login-Timing-Seitenkanals aus Stage 3A sind implementiert
> und vollständig automatisiert getestet (Backend- und Frontend-Suiten,
> zwei vollständige, saubere Chromium-E2E-Läufe). Von den in den
> vorherigen Nachträgen genannten offenen Punkten sind damit **zwei weitere
> geschlossen** (JWT-Refresh, Timing-Seitenkanal) und einer **teilweise**
> geschlossen (Geräte-/Sitzungsübersicht — Logout/Logout-All existieren,
> aber keine vollständige „meine Geräte"-Übersichtsseite). Die in Stage 3A
> vorgeschlagene Blockreihenfolge (3B1 → 3B2 → 3C UX-Politur → 3D
> Rate-Limiting/CORS) bleibt unverändert; **Stage 3C wurde nicht
> begonnen.** Weiterhin offen und explizit außerhalb des Scopes dieser
> Phase: uneinheitliche Audit-Log-Übersetzung, Rate-Limiting weiterhin
> pro Prozess (unverändert, kein Redis eingeführt), 2FA, Passkeys, Social
> Login, Passwort-vergessen/Reset, Kontolöschung, vollständige
> Geräteverwaltung. Stage 2B2B bleibt weiterhin **Deferred until first
> customer / production deployment** — unverändert durch diese Phase; es
> wurde keine Cloud-Infrastruktur eingerichtet.
>
> ---
>
> **Nachtrag (2026-07-25, Stage 3C Pilot-UX-Politur):** Stage 3C (siehe
> `STAGE_3C_PILOT_UX_POLISH.md`) ist abgeschlossen: sicherer
> Einladungs-Resend (Owner/Admin, Tokenrotation, In-Place-Erneuerung
> abgelaufener Einladungen, sichere Kompensation bei Zustellfehlern,
> eigener Rate-Limiter), vollständige Audit-Log-Übersetzung (15 zuvor rohe
> Event-Typen ergänzt, sicherer Fallback für unbekannte künftige Typen),
> Behebung des im Stage-3A-Audit konkret benannten
> Dropdown-Textabschneidungs-Fehlers (`StudioSwitcher.vue`), erweiterte
> Einladungsliste (erstellt am/gültig bis/eingeladen durch), sowie ein
> vollständiger, real gegen den lokalen Stack ausgeführter Admin-
> Live-Durchlauf (vorher nur per Code-Audit verifiziert). Die in Stage 3A
> vorgeschlagene Blockreihenfolge (3B1 → 3B2 → 3C UX-Politur → 3D
> Rate-Limiting/CORS) ist damit vollständig abgearbeitet; **Stage 3D wurde
> nicht begonnen.** Weiterhin offen und explizit außerhalb des Scopes
> dieser Phase: Rate-Limiting weiterhin pro Prozess und weiterhin nur auf
> Login/Registrierung/Account-Aktionen/Invitation-Resend beschränkt (keine
> generelle Ausweitung auf alle mutierenden Endpunkte), CORS-Same-Host-Regel
> weiterhin ungetestet gegen ein reales Ziel-Deployment, toter Policy-Code
> (`coachActionEligibility`) weiterhin unbereinigt, 2FA, Passkeys, Social
> Login, Passwort-vergessen/Reset, Kontolöschung, vollständige
> Geräteverwaltung. Stage 2B2B bleibt weiterhin **Deferred until first
> customer / production deployment** — unverändert durch diese Phase; es
> wurde keine Cloud-Infrastruktur eingerichtet.
>
> ---
>
> **Nachtrag (2026-07-26, Stage 3D Security Hardening):** Stage 3D (siehe
> `STAGE_3D_SECURITY_HARDENING.md`) ist abgeschlossen: ein gemeinsam
> nutzbarer, atomarer MySQL-Rate-Limit-Store (Migration 011) ersetzt den
> rein prozesslokalen In-Memory-Limiter und deckt neu auch Refresh,
> Logout-All, Einladung erstellen und Einladung annehmen ab (zuvor ganz
> ohne Limit); die CORS-Konfiguration ist jetzt vollständig validiert und
> sowohl per HTTP als auch echt im Browser getestet (`CORS_ALLOWED_ORIGINS`,
> Produktionsregeln, minimale Methoden/Header); Trust-Proxy-Konfiguration
> ist explizit und fail-closed; Security Header (HSTS produktionsseitig,
> `Cache-Control: no-store` auf Auth-/Account-Antworten), Request-Grössen-
> und Content-Type-Grenzen sowie eine gebündelte Startkonfigurationsprüfung
> sind implementiert. Von den in den vorherigen Nachträgen genannten offenen
> Punkten sind damit **zwei weitere geschlossen** ("Rate Limiter pro
> Prozess", "CORS-Konfiguration ungetestet" — beide unten aus „Weiterhin
> nicht blockierend" entfernt). Die in Stage 3A vorgeschlagene
> Blockreihenfolge (3B1 → 3B2 → 3C → 3D) ist damit vollständig abgearbeitet.
> Weiterhin offen und explizit ausserhalb des Scopes dieser Phase: toter
> Policy-Code (`coachActionEligibility`) weiterhin unbereinigt, 2FA,
> Passkeys, Social Login, Passwort-vergessen/Reset, Kontolöschung,
> vollständige Geräteverwaltung, Abrechnung, neue Trainingsfunktionen, eine
> Monitoring-Plattform. Stage 2B2B bleibt weiterhin **Deferred until first
> customer / production deployment** — unverändert durch diese Phase; es
> wurde keine Cloud-Infrastruktur eingerichtet. **Nach Stage 3D folgt
> ausschliesslich Stage 4A — Final Local Acceptance.**
>
> ---
>
> **Nachtrag (2026-07-26, Stage 4A Final Local Acceptance):** Stage 4A
> (siehe `STAGE_4A_FINAL_LOCAL_ACCEPTANCE.md`) ist abgeschlossen — eine
> reine Abnahme-/Stabilitätsphase ohne neue Funktion, Rolle, Migration oder
> Konfigurationsvariable. Clean-Room-Installation, frische und bestehende
> Datenbank, vollständige Rollen-/Tenant-/Auth-/Session-/Einladungs-/
> Programm-/Workout-/Account-/Rate-Limit-/CORS-Regression, ein realer
> Backup-/Restore-Drill, dreifacher Chromium-E2E-Lauf und ein 20-facher
> Cross-Tab-Zieltest liefen ohne offenen Blocker und ohne Flake. Ein
> während der Regression reproduzierter, bereits Ende Stage 3D behobener
> Lock-Order-Deadlock blieb stabil behoben — kein neuer Code-Fix nötig.
> `README.md` wurde aktualisiert (war seit dem frühen Stage-1B.2B1-Stand
> veraltet); ein neues `docs/LOCAL_PILOT_RUNBOOK.md` beschreibt einen
> vollständigen, tatsächlich ausgeführten lokalen Pilotablauf. **Damit gilt
> FitTrack als lokal vollständig abgeschlossen (local product development
> complete) — keine Aussage zu einem Produktions-Deployment, keine weitere
> lokale Entwicklungsphase folgt.** Alle in den vorherigen Nachträgen
> genannten offenen Punkte (toter Policy-Code, 2FA/Passkeys/Social
> Login/Passwort-Reset/Kontolöschung, Abrechnung, neue Trainingsfunktionen,
> Monitoring-Plattform) bleiben unverändert ausserhalb des Scopes. Stage
> 2B2B bleibt weiterhin **Deferred until first customer / production
> deployment**; es wurde auch für Stage 4A keine Cloud-Infrastruktur
> eingerichtet.
>
> ---
>
> **Nachtrag (2026-07-26, Stage 5A1 Unified Training Calendar — Backend
> Foundation):** Nach dem in Stage 4A erklärten "local product development
> complete" wurde eine neue, separat beauftragte Produktphase begonnen: ein
> vereinheitlichter persönlicher Trainingskalender. Stage 5A1 (siehe
> `STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md`) liefert ausschliesslich das
> Backend-Fundament — Datenmodell (Migration 012: `studio_assignment_schedule_rules`,
> `training_calendar_entries`), Domänenlogik, Terminierungsregeln für
> Coaches, Lese-/Mutations-APIs, Verknüpfung mit der bestehenden
> Workout-Session-Ausführung, vollständige Testabdeckung. **Es gibt noch
> keine Kalender-Oberfläche** — das ist ausdrücklich Stage 5A2 vorbehalten
> und wurde in dieser Phase bewusst nicht begonnen. Damit ist die
> Kalenderfunktion serverseitig vollständig, aber für Endnutzer noch nicht
> sichtbar/nutzbar. Empfehlung für die unmittelbar nächste Phase: **Stage
> 5A2 — Personal Calendar UI**, die dieses Backend an eine Vue-Ansicht
> anbindet. Alle in den vorherigen Nachträgen genannten offenen Punkte
> bleiben unverändert ausserhalb des Scopes dieser Phase. Stage 2B2B bleibt
> weiterhin **Deferred until first customer / production deployment**; es
> wurde für Stage 5A1 keine Cloud-Infrastruktur eingerichtet.
>
> ---
>
> **Nachtrag (2026-07-26, Stage 5A2 Personal Calendar UI):** Die in Stage
> 5A1 empfohlene unmittelbar nächste Phase ist jetzt abgeschlossen: eine
> persönliche Kalenderseite (siehe `STAGE_5A2_PERSONAL_CALENDAR_UI.md`)
> macht den in Stage 5A1 gebauten vereinheitlichten Trainingskalender für
> Endnutzer sichtbar und nutzbar — Monatsansicht, mobile Agenda,
> Statusfarben, Filter, persönliche Erstellung/Bearbeitung/Verschiebung,
> Bestätigen/Überspringen/Absagen, Studio-Workout-Start über den
> bestehenden Session-Vertrag, vollständige DE/EN-Übersetzung und
> Barrierefreiheit. **Es gibt weiterhin keine Coach-Planungsoberfläche** —
> das ist ausdrücklich Stage 5A3 vorbehalten und wurde in dieser Phase
> bewusst nicht begonnen. Empfehlung für die unmittelbar nächste Phase:
> **Stage 5A3 — Coach Scheduling UI**, die Owner/Admin/Trainer eine
> Oberfläche zum Verwalten der in Stage 5A1 bereits bestehenden
> Terminierungsregeln gibt (aktuell nur über die API erreichbar). Alle in
> den vorherigen Nachträgen genannten offenen Punkte bleiben unverändert
> ausserhalb des Scopes dieser Phase. Stage 2B2B bleibt weiterhin
> **Deferred until first customer / production deployment**; es wurde für
> Stage 5A2 keine Cloud-Infrastruktur eingerichtet.
>
> ---
>
> **Nachtrag (2026-07-27, Stage 5A3 Coach Scheduling UI):** Die in Stage
> 5A2 empfohlene unmittelbar nächste Phase ist jetzt abgeschlossen: eine
> Coach-/Admin-Oberfläche (siehe `STAGE_5A3_COACH_SCHEDULING_UI.md`) macht
> die in Stage 5A1 bereits bestehenden, zuvor nur über die API
> erreichbaren Terminierungsregeln nutzbar — Regelübersicht mit lesbarer
> Zusammenfassung, Erstellen/Bearbeiten/Deaktivieren, optionale
> Terminvorschau, vollständige DE/EN-Übersetzung und Barrierefreiheit,
> verbunden mit dem in Stage 5A2 gebauten persönlichen Kalender. Ein
> echter, von dieser Phase unabhängiger Zeitzonen-Blocker in der
> bestehenden Workout-Session-Kalenderverknüpfung wurde gefunden und
> minimal behoben (Details im Stage-5A3-Bericht). **Damit ist die in
> Stage 5A1 begonnene Trainingskalender-Linie (Backend → persönliche
> Oberfläche → Coach-Terminierung) inhaltlich vollständig.** Kein neuer,
> unmittelbar zwingender nächster Schritt wird von dieser Phase aus
> empfohlen; alle in den vorherigen Nachträgen genannten offenen Punkte
> (insbesondere Stage 2B2B, echter externer Cloud-Bucket) bleiben
> unverändert offen und ausserhalb des Scopes dieser Phase. Ein
> vorbestehender, von Stage 5A3 unabhängiger Flaky-Test im persönlichen
> Kalender-Verschiebe-Ablauf wurde entdeckt und dokumentiert (siehe
> Stage-5A3-Bericht Abschnitt 19) — dessen Behebung wäre ein sinnvoller,
> kleiner nächster Schritt, sofern eine weitere Phase gewünscht wird.
> Stage 2B2B bleibt weiterhin **Deferred until first customer / production
> deployment**; es wurde für Stage 5A3 keine Cloud-Infrastruktur
> eingerichtet.
>
> ---
>
> **Nachtrag (2026-07-27, Stage 5B Product & Pilot Readiness Audit):** Der
> oben zuletzt genannte Flaky-Test ist inzwischen behoben (siehe die
> Merge-Readiness-Nachbereitung von Stage 5A3) — diese konkrete
> Handlungsempfehlung ist damit gegenstandslos. Ein vollständiges,
> evidenzbasiertes Produkt- und Pilot-Readiness-Audit wurde auf einem
> eigenen, nicht gemergten Branch durchgeführt (siehe
> `STAGE_5B_PRODUCT_PILOT_READINESS_AUDIT.md`): **0 P0-Blocker**, ein
> P1-Befund (kein Lösch-/Anonymisierungsprozess für echte Personendaten —
> organisatorisch, keine Code-Phase) und drei P2-Befunde. **Diese Empfehlung
> wird durch Stage 5B wie folgt aktualisiert:** Anders als nach 5A1/5A2 gibt
> es diesmal keine offene P0/P1-Funktionslücke, die eine weitere
> Trainings-/Kalenderfunktion rechtfertigen würde. Die mit Abstand
> konsistenteste Erkenntnis des Audits ist eine **operative** Lücke: Die
> Studio-Übersicht liefert für Owner/Admin/Trainer keine aggregierte
> Tagessicht (keine überfälligen Trainings, keine neuen Ergebnisse, keine
> inaktiven Mitglieder, keine offenen Einladungen als Kennzahl) — durch
> Vergleich zweier Screenshots vor und nach vollständiger Studio-Nutzung als
> inhaltlich identisch belegt. **Empfehlung für die unmittelbar nächste
> Phase: Stage 5C — Studio Operations Dashboard** (rein lesende
> Aggregations-Endpunkte über bereits existierende Daten, keine neue
> Migration, plus eine kleine Audit-Log-Übersetzungsergänzung für die
> Stage-5A1/5A3-Ereignistypen und eine minimale Rollen-Kurzerklärung im
> Einladungsdialog). Details, Scope-Abgrenzung und Akzeptanzkriterien in
> Abschnitt 32 des Audit-Dokuments. Die weiterhin weiter oben in diesem
> Dokument gelisteten operativen Backup-/DB-Härtungspunkte (Stage 2B2B,
> getrennte DB-Rollen, Backup-Scheduler/Key-Rotation) bleiben unverändert
> offen und unabhängig von dieser Empfehlung. Stage 2B2B bleibt weiterhin
> **Deferred until first customer / production deployment**; es wurde für
> Stage 5B keine Cloud-Infrastruktur eingerichtet und keine neue
> Entwicklungsphase begonnen — dieses Audit selbst ist keine
> Implementierung.
>
> ---
>
> **Nachtrag (2026-07-28, Stage 5C1 Account Deletion Backend & Deletion
> Receipt Foundation):** Statt der oben empfohlenen unmittelbar nächsten
> Phase ("Stage 5C — Studio Operations Dashboard") wurde vom Auftraggeber der
> in Stage 5B als organisatorischer P1-Befund benannte Punkt priorisiert:
> der fehlende Lösch-/Anonymisierungsprozess für Personendaten. Ein
> separater Design-Vorlauf (`STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md`,
> ADR 004) legte die Architektur fest; diese Phase (Stage 5C1) liefert
> darauf aufbauend das vollständige **Backend**: Migration 013, Self-Service-
> Löschvorschau/-ausführung mit Sole-Owner-Blocker, hybride
> Anonymisierung/Hard-Delete-Strategie, atomare 17-Schritte-Löschtransaktion,
> Auth-Invalidierung, extern signierte Deletion Receipts, Receipt-Doctor und
> Restore-Reconciliation. Details in `STAGE_5C1_ACCOUNT_DELETION_BACKEND.md`.
> Der ursprüngliche P1-Befund aus Stage 5B gilt damit als **geschlossen**.
> **Empfehlung für die unmittelbar nächste Phase: Stage 5C2 — Frontend-UI
> für Kontolöschung** (Profil-Danger-Zone mit Vorschau/Bestätigungsdialog,
> Studio-Membership-Removal-UI) — ohne sie ist der neue Backend-Vertrag für
> Endbenutzer:innen nicht erreichbar. Die in Stage 5B empfohlene "Studio
> Operations Dashboard"-Phase bleibt als **danach** folgende, unverändert
> gültige Empfehlung bestehen, nicht verworfen — lediglich zeitlich
> zurückgestellt. Die weiterhin oben gelisteten operativen
> Backup-/DB-Härtungspunkte (Stage 2B2B, getrennte DB-Rollen,
> Backup-Scheduler/Key-Rotation) bleiben unverändert offen. Stage 2B2B
> bleibt weiterhin **Deferred until first customer / production
> deployment**; es wurde für Stage 5C1 keine Cloud-Infrastruktur
> eingerichtet, und Stage 5C2 (Frontend-UI) wurde nicht begonnen.
>
> ---
>
> **Nachtrag (2026-07-28, Stage 5C1 Merge-Gate-Review):** Ein Merge-Gate-
> Review fand fünf Befunde im oben beschriebenen Stand (Privat-zu-global-
> Übungsleck, unvollständiges Terminierungsregel-Scope, unbedingte statt
> `PLANNED`-only Löschung persönlicher Kalendereinträge, ungeklärte CSRF-
> Entscheidung, nicht fail-closed meldender Receipt Doctor) — alle behoben,
> siehe `STAGE_5C1_ACCOUNT_DELETION_BACKEND.md` Abschnitt 0. Die Empfehlung
> selbst ändert sich dadurch **nicht**: **Stage 5C2 — Frontend-UI für
> Kontolöschung** bleibt die unmittelbar nächste Phase, jetzt auf einem
> korrigierten, vollständig regressionsgetesteten Backend-Vertrag
> aufbauend.
>
> ---
>
> **Nachtrag (2026-07-28, Receipt-first-Commit-Protokoll — Merge-Blocker-Fix):**
> Ein weiterer, tieferliegender Merge-Blocker wurde danach gefunden und
> behoben: ein Receipt-Schreibfehler nach einem erfolgreichen Hard Delete
> hinterliess weder Kontenzeile noch Receipt — für den Doctor unsichtbar.
> Korrigiert durch ein Receipt-first-Commit-Protokoll (Receipt wird vor,
> nicht nach dem DB-Commit aufgelöst/publiziert), siehe
> `STAGE_5C1_ACCOUNT_DELETION_BACKEND.md` Abschnitt 0b. Die Empfehlung
> bleibt unverändert: **Stage 5C2 — Frontend-UI für Kontolöschung**.
>
> ---
>
> **Nachtrag (2026-08-09, Stage 5C2 Account Deletion UI / Profile Danger
> Zone):** Die empfohlene Phase wurde umgesetzt — Profil-Danger-Zone,
> Preview-Dialog, Sole-Owner-Blocker und zweistufige Bestätigung, vollständig
> auf dem bereits gemergten Stage-5C1-Vertrag aufbauend, keine neue
> Backend-Fachlogik. Details in `STAGE_5C2_ACCOUNT_DELETION_UI.md`. Dabei
> gefunden: ein echter, vorbestehender Stage-5C1-Backend-Defekt — der
> `account.deleteRequest`-Rate-Limiter liest `req.user?.id` für seinen
> Schlüssel, läuft in `accountRouter.js` aber **vor** `authenticate`, sodass
> `req.user` dabei immer `undefined` ist und alle Aufrufer einen einzigen
> geteilten Bucket teilen statt pro Benutzer isoliert zu sein (dasselbe
> Registrierungsmuster betrifft auch `change-password` und
> `email-change-requests`). Bewusst nicht in dieser reinen Frontend-Phase
> behoben, stattdessen mit einem minimalen Regressionstest dokumentiert
> (`backend/test/unit/rateLimiter.test.js`). **Empfehlung für die
> unmittelbar nächste Phase: eine kleine, gezielte Backend-Korrektur** —
> `authenticate` projektweit vor jeden benutzer-geschlüsselten Rate Limiter
> stellen (mindestens `deleteRequest`, `passwordChange`,
> `emailChangeRequest`), danach den bestehenden "pro Benutzer"-Unit-Test so
> erweitern, dass er die reale Middleware-Kette prüft statt `req.user`
> vorab zu setzen. Danach optional, jeweils als eigene kleine Phase: Studio-
> Membership-Removal-UI und/oder ein Datenexport-Feature ("Recht auf
> Datenübertragbarkeit"). Stage 2B2B bleibt weiterhin **Deferred until first
> customer / production deployment**; keine Cloud-Infrastruktur, keine
> echten Benutzerkonten gelöscht.
>
> ---

Basierend auf `FITTRACK_CURRENT_STATUS.md` (Stand PR #7) sowie den seither
integrierten Phasen Stage 1B.2B2A (PR #9), Stage 1B.2B2B (PR #10, Coach-
Ergebnisansicht/Feedback/Footer-Entfernung), Stage 2A (produktionsfähiger
SMTP-Einladungsversand — siehe `STAGE_2A_PRODUCTION_INVITATION_EMAIL.md`),
Stage 2B1 (verschlüsselte Datenbank-Backups mit verifiziertem Restore-Drill —
siehe `STAGE_2B1_ENCRYPTED_BACKUP_RESTORE.md`) und Stage 2B2A
(providerneutrale S3-kompatible Off-host-Speicherung, bislang ausschließlich
gegen eine lokale MinIO-Testinstanz verifiziert — siehe
`STAGE_2B2A_S3_OFFHOST_BACKUPS.md`). Diese Empfehlung trifft keine
Entscheidung — sie liefert eine begründete Grundlage für eine explizite
Freigabe durch den Auftraggeber.

## Was diese Empfehlung ablöst

Die vorherige Version dieses Dokuments empfahl, zunächst die operativen
Pilot-Blocker zu schließen, beginnend mit einem Produktions-E-Mail-Provider
für Einladungen, gefolgt von Backup-Verschlüsselung im Ruhezustand. Beide
Punkte sind inzwischen erfüllt:

- **Stage 2A:** Ein validierter, providerneutraler SMTP-Adapter (Nodemailer,
  erzwungenes TLS, Fail-Closed ohne Konfiguration, sichere
  Fehlerklassifikation, keine Secrets in Logs/Audit) ist implementiert und
  automatisiert getestet, seither zusätzlich manuell mit einem echten
  SMTP-Server verifiziert (echter Versand bestätigt angenommen).
- **Stage 2B1:** Ein klar versioniertes, authentifiziertes
  Verschlüsselungsformat (`.ftbackup`, AES-256-GCM über `node:crypto`) plus
  sichere Create-/Verify-/Restore-Befehle und ein automatisierter,
  end-to-end verifizierter Restore-Drill sind implementiert. Die
  sensibelsten Daten im System (P4: Satzresultate, Member-Notizen,
  Trainer-Feedback) sind damit in jedem erstellten Backup verschlüsselt,
  nicht mehr unverschlüsselt auf Platte. Eine anschließende
  Release-Gate-Härtung (Folge-Commit, gleicher Branch) hat den alten
  unverschlüsselten Pfad in Produktion vollständig gesperrt, das
  Restore-Freigabemodell von `NODE_ENV` entkoppelt (explizites
  `BACKUP_RESTORE_ENABLED` plus zielgebundene Bestätigung) und strikte,
  erzwungene Timeouts für alle externen Dump-/Restore-/Docker-Aufrufe
  eingeführt — Stage 2B1 gilt seither inklusive dieser Härtung als
  abgeschlossene, produktionsfähige Baseline.

## Was als Nächstes gebaut werden sollte

**Die verbleibenden operativen Pilot-Blocker, in dieser Reihenfolge:**

1. **Stage 2B2B: echten Off-host-Bucket einrichten und verifizieren.**
   **Status: Deferred until first customer / production deployment** (siehe
   Nachtrag oben und `STAGE_3A_LOCAL_PILOT_READINESS_AUDIT.md` Abschnitt 19) —
   kein lokaler Pilot-Blocker, da eine kontrollierte lokale Pilotierung keinen
   echten externen Bucket voraussetzt. Stage 2B2A liefert die vollständige, automatisiert getestete
   S3-kompatible Upload-/Download-/Verifikations-/Retention-Mechanik
   inklusive einer seit einer Release-Gate-Härtung nachweislich atomaren,
   race-sicheren Veröffentlichung (`IfNoneMatch`-bedingter `PutObject`,
   empirisch inklusive echter Nebenläufigkeit gegen MinIO bewiesen), aber
   ausschließlich gegen eine lokale MinIO-Testinstanz — es besteht keine
   Verbindung zu einem echten Cloud-Konto. Ein einzelner Host-Verlust ist
   weiterhin nicht wiederherstellbar, bis ein echter Bucket verbunden und
   ein realer Restore-Drill dagegen gefahren wurde.
2. **Getrennte DB-Rolle für Runtime vs. Migration/Restore.** Aktuell eine
   einzige DB-Rolle für alles.
3. **Backup-/Upload-Scheduler und Key-Rotation.** Weder Stage 2B1 noch
   Stage 2B2A liefern einen automatisierten Zeitplan oder eine
   Rotationsstrategie für `BACKUP_ENCRYPTION_KEY_B64`/`_KEY_ID` oder die
   S3-Zugangsdaten — beide Phasen liefern bewusst nur die jeweilige Mechanik
   (Create/Verify/Restore/Drill bzw. Upload/List/Download/Verify/Drill/Retention).

Diese Punkte sind bewusst als *eine* zusammenhängende „Backup-/DB-Härtung"-
Fortsetzung zu verstehen (nicht Gegenstand von Stage 2B1/2B2A, siehe deren
jeweilige Abgrenzung), da sie alle denselben operativen Bereich betreffen und
gemeinsam die Backup-/Restore-Infrastruktur produktionsreif machen.

## Warum weiterhin operativ vor funktional

- Alle drei Punkte sind seit dem ursprünglichen Audit bekannt und wurden
  bewusst zurückgestellt; mit E-Mail-Provider und Backup-Verschlüsselung
  sind zwei von vier ursprünglichen operativen Blockern geschlossen — die
  Logik, jetzt konsequent weiterzumachen statt zurück zu Feature-Arbeit zu
  wechseln, bleibt bestehen.
- Alle verbleibenden Punkte sind weiterhin rollenunabhängig und betreffen die
  Betriebssicherheit für den gesamten Pilotbetrieb, nicht eine einzelne
  Nutzergruppe.
- Ein verschlüsseltes, aber ausschließlich lokal gespeichertes Backup schützt
  nicht gegen den Verlust des Hosts selbst. Die Upload-/Download-Mechanik
  dafür ist seit Stage 2B2A fertig und automatisiert getestet — es fehlt nur
  noch die Verbindung zu einem echten Bucket (Stage 2B2B), was den
  verbleibenden Aufwand hier deutlich kleiner macht als die übrigen zwei
  Punkte, aber der Single-Point-of-Failure bleibt bis dahin real bestehen.

## Falls stattdessen funktional priorisiert werden soll

Die naheliegende funktionale Fortsetzung bleibt eine kontrollierte
Mitglieds-Antwort auf Coach-Feedback (einfacher Thread statt freiem Chat,
weiterhin ohne Bearbeiten/Löschen, weiterhin ohne Push-/E-Mail-
Benachrichtigungen) — die kleinste, konsistenteste Erweiterung des in Stage
1B.2B2B etablierten append-only-Modells. Diese Empfehlung rät weiterhin davon
ab, dies vor den verbleibenden operativen Punkten zu priorisieren.

## Weiterhin nicht blockierend, aber vormerken

- **Toter Policy-Code (`coachActionEligibility` in `studioPolicy.js`).**
  Weiterhin unverdrahtet.
- **Login-Timing-Seitenkanal** (Konto-Enumeration über `bcrypt.compare`-
  Timing).
- **Kein Recht-auf-Löschung-/Anonymisierungspfad** für Benutzer-,
  Trainings- oder Feedbackdaten.
- **Kein Bounce-/Complaint-Handling und keine Zustell-Warteschlange** für
  den neuen SMTP-Versand (bewusst außerhalb des Stage-2A-Umfangs, siehe
  dessen „Bekannte Einschränkungen").

## Klare Grenze des nächsten Auftrags

Unabhängig davon, ob operativ oder funktional priorisiert wird, sollte der
nächste Auftrag ausdrücklich ausschließen:
- jede Änderung am bereits stabilen, getesteten Feedback-Datenmodell aus
  Stage 1B.2B2B, am SMTP-Adapter-Vertrag aus Stage 2A und am
  `.ftbackup`-Containerformat/den Restore-Guards/dem
  `BACKUP_RESTORE_ENABLED`-Freigabemodell aus Stage 2B1 sowie am
  Objektpfad-/Metadaten-/Remote-Freigabemodell aus Stage 2B2A (alle bleiben
  außer bei expliziter neuer Freigabe unverändert),
- die in Stage 1B.2B2B Abschnitt „Klare Grenze zu späteren Phasen" sowie in
  Stage 2A Abschnitt „Nicht enthalten" aufgeführten Themen (Chat,
  Reaktionen, KI-Feedback, Analytics-Dashboard, Churn-Risk, Körpergewicht/
  Fotos, Check-ins, Zahlungen, Community, Wearables, native Apps, Offline/
  PWA, White Label, Microservices, Kubernetes, E-Mail-Queues, Message
  Broker, wiederkehrende Jobs) ohne explizite neue Freigabe.

Diese Empfehlung ersetzt keine explizite Freigabe. Eine neue Phase wird erst
nach ausdrücklicher Zustimmung des Auftraggebers begonnen.
