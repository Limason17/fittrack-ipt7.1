# Stage 5C: Personal Data Deletion & Retention — Design Gate

> **Stand:** 2026-07-27 (Revision 2 — vier Designblocker aufgelöst) · Branch
> `design/stage-5c-personal-data-lifecycle` · Basis: `main`
> Merge-Commit `f87d0b6` (PR #24, Stage 5B Product & Pilot Readiness Audit).
>
> **Diese Phase ist ausschliesslich Analyse, Architektur und Dokumentation.**
> Es wurde in dieser Phase **nichts implementiert**: kein Produktionscode
> geändert, keine Migration erstellt, keine Testdatei geändert, keine
> realen oder Entwicklungsdaten gelöscht/anonymisiert, keine
> Cloud-Infrastruktur eingerichtet. Alle in diesem Dokument beschriebenen
> API-, UI-, Migrations- und Testentwürfe sind **Entwürfe für eine spätere
> Implementierungsphase**, keine bereits vorhandene Funktionalität.
>
> **Keine rechtliche Garantie.** Dieses Dokument beschreibt eine technische
> Produktpolicy auf Basis des tatsächlichen Codes und Schemas. Es ersetzt
> keine externe rechtliche Prüfung (Schweizer Datenschutzrecht, ggf. DSGVO
> bei EU-Bezug) vor einem echten Produktionsbetrieb mit echten
> Endkund:innen.
>
> **Nachtrag (2026-07-28, Stage 5C1 Merge-Gate-Review):** Die Backend-
> Implementierung (`docs/STAGE_5C1_ACCOUNT_DELETION_BACKEND.md`) wich vor
> dem Merge in vier Punkten von diesem Dokument bzw. von ADR 004 ab — drei
> waren Implementierungsfehler (Terminierungsregel-Scope unvollständig;
> persönliche Übungen konnten via `ON DELETE SET NULL` global sichtbar
> werden; persönliche Kalendereinträge wurden entgegen der hier bereits
> korrekt spezifizierten `PLANNED`-only-Regel unbedingt gelöscht), einer war
> eine explizit zu treffende, hier nicht vorweggenommene Entscheidung
> (kein dediziertes CSRF-Mittel für den Löschendpunkt). Alle vier sind
> behoben bzw. entschieden und getestet — vollständige Details in ADR 004s
> Abschnitt „Amendment" und im genannten Backend-Dokument. Dieses Dokument
> selbst wird **nicht** rückwirkend umgeschrieben.

## Aufgelöste Designblocker (Revision 2)

Die erste Fassung dieses Design Gates enthielt vier offene Designblocker,
die vor einem Merge eindeutig aufgelöst werden mussten. Diese Revision löst
alle vier auf:

1. **Restore-Reconciliation war unzureichend spezifiziert** (reines
   strukturiertes Log als einzige Quelle). **Aufgelöst:** Kombination aus
   dem bestehenden `users.lifecycle_status` (schnelle, transaktionale
   Quelle für den laufenden Betrieb) **und** einem neuen, externen,
   integritätsgeschützten „Deletion Receipt" pro Löschvorgang — als Datei
   ausserhalb des Repositories und ausserhalb des Datenbank-Backup-
   Verzeichnisses gespeichert, damit ein Restore diese Information nicht
   miterfasst. Siehe Abschnitt 21 (vollständig neu) und Abschnitt 15.5.
2. **Laufende Workout Sessions blieben unentschieden** (`in_progress`
   unverändert lassen war nicht akzeptabel). **Aufgelöst:** Laufende
   Sessions werden innerhalb derselben Löschtransaktion atomar auf
   `aborted` gesetzt — unter Wiederverwendung der bereits bestehenden,
   präzedenzlosen `in_progress → aborted`-Transition (ADR 003), die exakt
   für „Session sofort beenden, Zustand einfrieren" existiert. Siehe
   Abschnitt 12/18.
3. **Aktive Assignments/Termine waren inkonsistent** (Coaching-Beziehung
   endet, Termine deaktiviert, Zuweisung bleibt `active`). **Aufgelöst:**
   ein konsistenter, exakt definierter Satz terminaler Zustände — aktive
   Zuweisungen des zu löschenden Mitglieds werden `cancelled`,
   Terminierungsregeln des zu löschenden Erstellers werden `disabled`
   (unabhängig davon, für wen), zukünftige Studio-Kalendereinträge des
   Kontos werden `CANCELLED`, zukünftige persönliche Einträge weiterhin
   hart gelöscht, abgeschlossene/historische Einträge bleiben unverändert.
   Siehe Abschnitt 7/12/18.
4. **Freitext-Aussagen widersprachen sich** (Freitext bleibt unverändert,
   gleichzeitig „keine PII in Historie"). **Aufgelöst:** ehrliche Policy —
   fachhistorischer Freitext (`member_note`, Feedback-`body`) bleibt
   **vollständig unverändert** (nicht geleert), kann weiterhin
   personenbezogene Inhalte enthalten, Zugriff bleibt streng tenant-/
   rollenbegrenzt; das Abnahmekriterium wurde entsprechend korrigiert.
   Siehe Abschnitt 13/30.

Als direkte Folge wurde zusätzlich **Migration-013-Entwurf verkleinert**
(`deletion_reason` entfernt, Abschnitt 19) und die **API-Preview erweitert**
(Abschnitt 15.1) sowie das **Transaktionsmodell neu strukturiert**
(Abschnitt 18) inklusive eines expliziten Cross-Resource-Ausfallsicherheits-
Protokolls für die Datenbank-Transaktion und das externe Receipt
(Abschnitt 18.3).

## Inhaltsverzeichnis

1. Executive Summary
2. Auditbezug
3. Systemgrenzen
4. Dateninventar
5. Personenbezogene Daten
6. Studio-Mitgliedschaft entfernen
7. Globales Konto löschen
8. Löschung versus Anonymisierung
9. Empfohlene Hybridstrategie
10. User Lifecycle
11. Owner-Schutz
12. Aktive Vorgänge
13. Historische Daten
14. Auth und Sessions
15. API-Entwurf
16. UI-Entwurf
17. Audit Events
18. Transaktionsmodell
19. Migration-013-Entwurf
20. Backup-Retention
21. Restore-Reconciliation
22. Logs
23. Externe Systeme
24. Sicherheitsanalyse
25. Teststrategie
26. E2E-Strategie
27. Accessibility
28. DE/EN
29. Risiken
30. Abnahmekriterien
31. Implementierungsreihenfolge
32. In Scope
33. Out of Scope
34. Offene Annahmen
35. Endgültige Designentscheidung

---

## 1. Executive Summary

Stage 5B identifizierte als einzigen P1-Befund, dass FitTrack keinen Prozess
zur Löschung oder Anonymisierung personenbezogener Daten besitzt. Dieses
Dokument entwirft diesen Prozess vollständig, implementiert ihn aber
**nicht**.

Die zentrale technische Erkenntnis dieses Design Gates: **Ein harter
`DELETE` der `users`-Zeile ist für praktisch jeden Nutzer mit Studio-Historie
durch das bestehende Datenbankschema selbst unmöglich.** Acht
Fremdschlüssel aus dem Studio-Bereich (`studios.created_by_user_id`,
`studio_memberships.user_id`, `studio_coaching_relationships.created_by_user_id`,
`studio_training_programs.created_by_user_id`,
`studio_training_program_versions.created_by_user_id`,
`studio_program_assignments.assigned_by_user_id`,
`studio_workout_session_feedback.author_user_id`,
`studio_assignment_schedule_rules.created_by_user_id`,
`training_calendar_entries.created_by_user_id`) referenzieren `users(id)`
mit `ON DELETE RESTRICT` beziehungsweise ohne explizite Aktion (MySQL-Default,
faktisch identisch mit `RESTRICT`) — bewusst so entworfen in ADR 001–003, um
Studio-Historie und Audit-Nachvollziehbarkeit nie durch eine Fremdaktion
verlieren zu können. Ein Nutzer, der jemals ein Studio erstellt, ihm
beigetreten ist, ein Programm angelegt, eine Coaching-Beziehung begründet,
eine Zuweisung vorgenommen oder Feedback gegeben hat, kann seine `users`-Zeile
schlicht nicht mehr per `DELETE` entfernen, ohne entweder die Operation
scheitern zu lassen oder fremde Studio-Daten anderer Nutzer:innen mit zu
zerstören.

**Empfohlene Strategie: Hybrid.** Ein globales Konto wird **irreversibel
anonymisiert, nicht physisch entfernt** — die `users`-Zeile bleibt bestehen
(referentielle Stabilität), direkte Identifikatoren (E-Mail, Benutzername,
Passwort-Hash) werden durch nicht-ableitbare Platzhalter ersetzt, alle
Sitzungen und Tokens werden sofort invalidiert. Eine Ausnahme: ein Konto ohne
jede Studio-Berührung (nie Mitglied, nie Ersteller) kann tatsächlich hart
gelöscht werden — für dieses Konto laufen die entsprechenden Fremdschlüssel
(`workouts.user_id`, `progress_entries.user_id` → `CASCADE`,
`exercises.user_id` → `SET NULL`) bereits heute korrekt. Studio-Mitgliedschaften
werden **nie** hart gelöscht, sondern — wie bereits heute für den
Statuswert `left` implementiert — auf Status geändert; abgeschlossene
Studio-Historie (Programme, Zuweisungen, Workout-Ergebnisse, Feedback,
Audit-Ereignisse) bleibt vollständig erhalten, aber ohne direkten
Identifikator zur gelöschten Person rückführbar.

Migration 013 (Entwurf, **nicht erstellt**) benötigt dafür lediglich **zwei**
neue Spalten auf `users` (`lifecycle_status`, `deleted_at` — `deletion_reason`
wurde nach kritischer Prüfung aus dem Entwurf entfernt, Abschnitt 19) — keine
neue Tabelle. Die Restore-Sicherheit dieser Anonymisierung wird durch ein
zusätzliches, externes, dateibasiertes „Deletion Receipt" ergänzt
(Abschnitt 21) — ebenfalls keine neue Datenbanktabelle.

---

## 2. Auditbezug

Stage 5B (`docs/STAGE_5B_PRODUCT_PILOT_READINESS_AUDIT.md`, Abschnitt 27,
Befund P1-1) — wörtlich:

> Kein Lösch-Endpunkt, kein Anonymisierungs-Skript, keine Retention-Policy
> irgendwo im Schema oder Code gefunden. […] Empfohlene Massnahme: Vor
> Aufnahme eines Piloten mit echten Personen mindestens einen — und sei es
> rein manuellen — Löschprozess (dokumentiertes SQL-Skript plus
> Vier-Augen-Freigabe) definieren.

Der Stage-5B-Audit selbst empfahl als **nächste Code-Phase** ein „Studio
Operations Dashboard“ (P2-1, operative Betriebssicht), **nicht** eine
Lösch-/Retention-Funktion — letztere wurde dort ausdrücklich als
organisatorischer, nicht zwingend codierter Punkt behandelt. Der
Auftraggeber hat mit dieser Stage-5C-Anfrage explizit entschieden, den
P1-Befund stattdessen **jetzt** als eigene Design-Phase anzugehen. Dieses
Dokument ersetzt damit nicht die Stage-5B-Empfehlung für das
Operations-Dashboard, sondern behandelt einen zweiten, unabhängigen
Auftrag parallel dazu.

`docs/FITTRACK_SECURITY_AND_PRIVACY_STATUS.md` (Datenschutzklassifikation
und „Auffällige Lücken" Punkt 10) bestätigt konsistent: kein
`deleted_at`, keine Anonymisierungsroutine, kein Datenexport — seit Stage 5B
explizit als **P1 vor Pilotstart mit echten Personen** eingestuft.

---

## 3. Systemgrenzen

FitTrack besteht aus zwei Datenbereichen mit unterschiedlicher
Löschsemantik:

1. **Rein persönlicher Bereich** (Stage 0A/0B/0C, vor jeder Studio-Funktion):
   `exercises` (bei `user_id IS NOT NULL`), `workouts`, `workout_exercises`,
   `progress_entries`. Vollständig `user_id`-isoliert, keine Studio-Bezüge,
   heute bereits grösstenteils `CASCADE`/`SET NULL` auf Nutzerlöschung
   ausgelegt.
2. **Studio-Bereich** (Stage 1A ff.): alles unter `studio_*` plus
   `training_calendar_entries` (die den persönlichen und den
   Studio-Kalender vereint). Hier gilt seit ADR 001/002 der Grundsatz
   „Historie und Audit-Nachvollziehbarkeit gehen nie durch eine
   Fremdaktion verloren" — durchgesetzt über `RESTRICT`-Fremdschlüssel auf
   `users(id)` von praktisch jeder „wer hat das gemacht"-Spalte.

Das globale Benutzerkonto (`users`) ist laut ADR 001 die **einzige**
Identitätsgrenze; Studio-Mitgliedschaft ist eine davon getrennte, pro
Studio existierende Zeile. Diese Trennung ist die Grundlage für die in
Abschnitt 6/7 geforderte Trennung zweier Vorgänge.

---

## 4. Dateninventar

Vollständige Tabelle aller 25 Tabellen aus den Migrationen 001–012 (keine
ausgelassen), plus die Migrations-Ledger-Tabelle der Runner-Infrastruktur.
Spalten wie vom Auftrag gefordert. FK-Verhalten ist gegen die tatsächlichen
Migrationsdateien verifiziert (nicht aus einer früheren Zusammenfassung
übernommen).

| Tabelle | Zweck | Tenant | Personenbezug | Direkte Identifikatoren | Indirekte Identifikatoren | Besitzer/Rolle | Relevante FKs | ON DELETE | Historische Bedeutung | Löschstrategie | Retention | Sicherheitsrisiko | Offene Entscheidung |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `users` | Globale Identität | keiner (global) | Ja | `username`, `email`, `password_hash` | Spracheinstellung, Einheiten | jede Person selbst | referenziert von fast allen `*_by_user_id`-Spalten | (Ziel der Aktion) | — | **Anonymisierung** (Ausnahme: hart löschbar bei 0 Studio-Historie) | unbegrenzt bis Löschanfrage | hoch (P1-Klasse) | Ausnahmeerkennung „0 Studio-Historie" muss exakt sein |
| `exercises` | Übungskatalog (global + persönlich) | keiner | teilweise (`user_id` nullable) | keine direkten (Name ist Übungsname, kein PII) | keine | Ersteller:in oder global | `user_id → users` `SET NULL` | bereits korrekt | gering | keine Aktion nötig (FK bereits `SET NULL`) | unbegrenzt | gering | keine |
| `workouts` | Persönliches Workout-Log | keiner | Ja | Titel/Notizen können PII enthalten | Datum, Muster | Ersteller:in | `user_id → users` `CASCADE` | bereits korrekt | mittel (persönliche Historie) | hart löschen bei Kontolöschung (bereits automatisch via CASCADE) | bis Kontolöschung | gering (nur eigene Daten) | keine |
| `workout_exercises` | Übungen je Workout | keiner | indirekt über `workouts` | keine eigenen | Metrikwerte | — | `workout_id → workouts` `CASCADE` | bereits korrekt | mittel | folgt `workouts` | folgt `workouts` | gering | keine |
| `progress_entries` | Fortschrittsverlauf | keiner | Ja | wie `workouts` | Metrikwerte über Zeit | Ersteller:in | `user_id → users` `CASCADE`; `workout_exercise_id → workout_exercises` `CASCADE` | bereits korrekt | mittel–hoch (Trainingsverlauf) | folgt `users` | bis Kontolöschung | gering | keine |
| `studios` | Studio-Stammdaten | ist Tenant | nein (Geschäftsdaten) | Name/Slug sind Geschäfts-, keine Personendaten | `created_by_user_id` | Owner | `created_by_user_id → users` `RESTRICT` | Studio-Löschung kaskadiert vollständig auf Kinder | hoch (Tenant-Wurzel) | nie löschen im Rahmen einer Kontolöschung | unbegrenzt | mittel (verwaistes Studio) | Eigentumsübertragung siehe Abschnitt 11 |
| `studio_memberships` | Rolle einer Person in einem Studio | ja | Ja (verknüpft Person↔Studio) | keine eigenen (verweist auf `users`) | Rolle, Beitrittsdatum | die Person selbst | `user_id → users` `RESTRICT`; `studio_id → studios` `CASCADE` | Nutzer nicht hart löschbar solange Mitgliedschaft existiert | hoch (wer war je im Studio) | **Statusänderung** (`left`), nie Hard-Delete | bleibt als Statuszeile bestehen | mittel | Selbstentfernung für Trainer/Member aktuell nicht möglich (Abschnitt 6.4) |
| `studio_invitations` | Einladungs-Workflow | ja | Ja (E-Mail-Adresse) | `email_normalized` | Rolle, Zeitstempel | Eingeladene:r | `invited_by_user_id`/`accepted_by_user_id → users` `SET NULL` | bereits korrekt | gering nach Ablauf | E-Mail-Feld anonymisieren bei Kontolöschung des noch nicht angenommenen Einladenden/Eingeladenen (siehe 5) | 7 Tage TTL, danach `expired`, kein Hard-Delete | mittel (E-Mail im Klartext) | ob abgelaufene Einladungen aktiv bereinigt werden sollen |
| `studio_audit_events` | Sicherheitsrelevantes Ereignisprotokoll | ja | indirekt (`actor_user_id`) | keine eigenen | `details_json` (bereits redigiert) | Studio (Owner/Admin einsehbar) | `actor_user_id → users` `SET NULL` | bereits korrekt | sehr hoch (Compliance-Nachweis) | **nie löschen/anonymisieren** — `actor_user_id` fällt bei Kontolöschung bereits automatisch auf `NULL` | unbegrenzt (kein Mechanismus im Code) | gering (bereits redigiert) | keine |
| `studio_coaching_relationships` | Coach↔Member-Zuordnung | ja | Ja | keine eigenen | Rollenzuordnung | Coach und Member | `coach_membership_id`/`member_membership_id → studio_memberships` `RESTRICT`; `created_by_user_id → users` `RESTRICT` | Beziehung bleibt bestehen solange Mitgliedschaften bestehen | hoch (wer betreute wen) | **Statusänderung** (`ended`), nie Hard-Delete | bleibt bestehen | mittel | keine |
| `studio_training_programs` | Trainingsprogramm | ja | nein (Geschäftsinhalt) | keine | `created_by_user_id` | Ersteller:in | `created_by_user_id → users` `RESTRICT`; `studio_id → studios` `CASCADE` | bleibt bei Kontolöschung des Erstellers vollständig erhalten | hoch | nie löschen | unbegrenzt | gering | keine |
| `studio_training_program_versions` | Versionierter Programminhalt | ja | nein | keine | `created_by_user_id` | Ersteller:in | `created_by_user_id → users` `RESTRICT`; `program_id → studio_training_programs` `CASCADE` | veröffentlichte Version unveränderlich (Produktinvariante) | hoch | nie löschen | unbegrenzt | gering | keine |
| `studio_training_program_days` | Trainingstag je Version | ja | nein | keine | keine | — | `program_version_id → …` `CASCADE` | folgt Version | hoch | nie löschen | unbegrenzt | gering | keine |
| `studio_training_program_exercises` | Übung je Trainingstag | ja | nein | keine | keine | — | `program_day_id → …` `CASCADE` | folgt Tag | hoch | nie löschen | unbegrenzt | gering | keine |
| `studio_program_assignments` | Zuweisung Version↔Mitglied | ja | Ja | keine eigenen | Zeitraum, Status | Mitglied, Ersteller:in | `member_membership_id → studio_memberships` `RESTRICT`; `assigned_by_user_id → users` `RESTRICT`; `coaching_relationship_id → …` `CASCADE` | bleibt bestehen | hoch (wer wurde wann was zugewiesen) | **Aktive Zuweisungen des zu löschenden Mitglieds werden `cancelled`** (Blocker 3, Abschnitt 7.5/12); bereits `completed`/`cancelled` bleiben unverändert; nie Hard-Delete | bleibt bestehen | mittel (P2/P3-Klasse) | keine (aufgelöst) |
| `studio_workout_sessions` | Trainingsausführung | ja | Ja (P4, höchste Schutzklasse) | keine eigenen (Notiz kann PII enthalten) | Zeitstempel, Ergebniswerte | Mitglied | `member_membership_id → studio_memberships` **`CASCADE`**; `studio_id`/`assignment_id`/`program_version_id`/`program_day_id`/`coaching_relationship_id → …` `CASCADE` | **Achtung:** würde bei Hard-Delete der Mitgliedschaft mitgelöscht — genau deshalb darf die Mitgliedschaft nie hart gelöscht werden | sehr hoch (Trainingsergebnisse) | **`in_progress` wird atomar `aborted`** (bestehende, präzedenzlose Transition, Blocker 2, Abschnitt 12/18); `completed`/bereits `aborted` bleiben inhaltlich unverändert; `member_note` bleibt **unverändert** (Blocker 4, Abschnitt 13) | unbegrenzt | hoch (P4) | keine (aufgelöst) |
| `studio_workout_session_exercises` | Übung je Ausführung | ja | Ja (P4) | keine eigenen | Ergebniswerte | — | `workout_session_id → …` `CASCADE` | folgt Session | sehr hoch | folgt Session (unverändert, auch bei Abbruch — ADR 003: Abbruch lässt jede Zeile exakt wie sie war) | unbegrenzt | hoch (P4) | keine |
| `studio_workout_session_sets` | Satzergebnis | ja | Ja (P4) | keine eigenen | `member_note`, Ist-Werte | — | `session_exercise_id → …` `CASCADE` | folgt Session | sehr hoch | **`member_note` bleibt unverändert** (Blocker 4 — keine Anonymisierung von Freitext in dieser Phase, siehe Abschnitt 13) | unbegrenzt | hoch (P4) | keine (aufgelöst) |
| `studio_workout_session_feedback` | Coach-Feedback (append-only) | ja | Ja (P4, beide Seiten) | `body` (Freitext, kann PII enthalten) | `author_user_id` | Coach (Autor), Mitglied (Adressat) | `author_user_id → users` `RESTRICT`; `coach_membership_id → studio_memberships` `CASCADE`; `workout_session_id → …` `CASCADE` | append-only, kein UPDATE/DELETE-Endpunkt existiert | sehr hoch (vertraulich, historisch) | **nie löschen, nie den Body verändern** — nur der Autorenbezug wird durch die Anonymisierung des `users`-Kontos indirekt entpersonalisiert (kein Name mehr auflösbar) | unbegrenzt | hoch (P4) | keine |
| `user_email_change_requests` | Offene E-Mail-Änderung | keiner | Ja | `new_email_normalized` | Token-Hash | Kontoinhaber:in | `user_id → users` `CASCADE` | bereits korrekt | keine (operativ) | Hard-Delete bereits automatisch bei Kontolöschung | 60 Min TTL ohnehin | mittel | keine |
| `user_auth_sessions` | Server-Sitzungen | keiner | Ja (mittelbar) | keine (nur `status`/Zeitstempel) | — | Kontoinhaber:in | `user_id → users` `CASCADE` | bereits korrekt | keine | alle aktiven Sitzungen bei Löschung sofort widerrufen | 7 Tage TTL ohnehin | mittel (Session-Hijack-Fenster) | keine |
| `user_refresh_tokens` | Rotierende Refresh-Tokens | keiner | Ja (mittelbar) | `token_hash` (kein Klartext) | — | Kontoinhaber:in | `session_id → user_auth_sessions` `CASCADE` | bereits korrekt | keine | folgt Session | 7 Tage TTL ohnehin | mittel | keine |
| `security_rate_limit_buckets` | Rate-Limit-Zustand | keiner | nein (nur HMAC-Hash) | keine (Schlüssel bereits HMAC-gehasht, nicht reversibel) | — | — | keine FK auf `users` | — | keine | keine Aktion nötig — enthält bereits keine reversiblen Identifikatoren | eigene TTL/Cleanup-Skript (`security:rate-limits:cleanup`) | gering | keine |
| `studio_assignment_schedule_rules` | Wiederkehrende Terminierungsregel | ja | Ja (mittelbar) | keine eigenen | `created_by_user_id` | Ersteller:in (Coach) | `created_by_user_id → users` (kein explizites `ON DELETE`, MySQL-Default = faktisch `RESTRICT`); `assignment_id`/`studio_id`/`program_day_id → …` `CASCADE` | bleibt bestehen, Deaktivieren ist reiner Status-Flip | mittel | **Alle vom zu löschenden Konto erstellten aktiven Regeln werden `disabled`** — bewusst nach Ersteller:in, nicht nach betroffenem Mitglied gescopt (Blocker 3, Abschnitt 7.6: verhindert, dass ein Mitglied nach Löschung seines Coaches weiterhin unbeaufsichtigt neue Termine materialisiert bekommt — die Materialisierung prüft die Coaching-Beziehung nicht) | bleibt bestehen | gering | keine (aufgelöst) |
| `training_calendar_entries` | Vereinheitlichter Kalender | ja (nullable) | Ja | keine eigenen | `title_snapshot`, Datum | Kontoinhaber:in (`user_id`) | `user_id → users` **`CASCADE`**; `created_by_user_id → users` (Default = `RESTRICT`); `studio_id`/`program_assignment_id`/`program_day_id`/`schedule_rule_id → …` `CASCADE`; `personal_workout_id`/`studio_workout_session_id → …` `SET NULL` | **Achtung:** `user_id`-Cascade greift nur, wenn die `users`-Zeile hart gelöscht wird — bei Anonymisierung (empfohlener Regelfall) bleibt die Zeile und damit der Kalendereintrag automatisch erhalten | hoch (wer hat wann trainiert) | **`PLANNED`-Studio-Einträge des Kontos werden `CANCELLED`; `COMPLETED`/`SKIPPED`/bereits `CANCELLED` bleiben unverändert; persönliche `PLANNED`-Einträge werden hart gelöscht** (Blocker 3, Abschnitt 12/18 — inkl. der Sonderregel, dass ein per Session-Abbruch von `IN_PROGRESS` auf `PLANNED` zurückgesetzter Eintrag anschliessend von derselben `CANCELLED`-Regel erfasst wird) | unbegrenzt | mittel | keine (aufgelöst) |
| `schema_migrations` (Runner-Ledger, kein eigenes Migrationsfile) | Migrations-Nachvollziehbarkeit | keiner | nein | keine | keine | — | keine FK auf `users` | — | Betriebsinfrastruktur, keine Personendaten | keine Aktion nötig | unbegrenzt | keine | keine |
| *(Backup-Metadaten)* | — | — | — | — | — | — | — | — | — | — | — | — | **Es existiert keine Backup-Metadaten-Tabelle in der Datenbank** — Backups sind externe `.ftbackup`-Dateien, siehe Abschnitt 20 |
| *(Development-E-Mail-Outbox)* | — | — | — | — | — | — | — | — | — | — | — | — | **Nicht persistent** — der Dev-Modus liefert den Annahme-/Bestätigungslink direkt in der HTTP-Antwort zurück, es existiert keine Outbox-Tabelle/-Datei, siehe Abschnitt 22 |

**Ergebnis:** 24 tatsächliche Tabellen aus den Migrationen 001–012, plus die
Runner-eigene `schema_migrations`-Ledger-Tabelle (25 inventarisiert), plus
zwei explizit geprüfte, nicht-existente Kategorien (Backup-Metadaten,
persistente Dev-Outbox) korrekt als „nicht vorhanden" dokumentiert statt
ausgelassen.

### 4.1 Daten ausserhalb der Datenbank

| Fläche | Mögliche Personendaten | Heutige Retention | Gewünschte Retention | Technisch löschbar? | Pilotbedingung | Produktionsbedingung |
|---|---|---|---|---|---|---|
| Strukturierte Backend-Logs | Nein direkt — rekursive Redaktion (`startup/logger.js`) entfernt Tokens/Secrets; `X-Request-ID` und Ereignisnamen enthalten keine E-Mail/Namen | betreiberabhängig (lokal: Konsole/Datei ohne definierte Rotation) | zeitlich begrenzt (z. B. 30–90 Tage), betreiberdefiniert | Ja (Log-Rotation/-Löschung ist Betriebssache, kein Produktcode) | dokumentieren, dass Logs keine PII enthalten dürfen (bereits der Fall) | Log-Retention-Policy vor Produktion festlegen |
| Request-IDs | Nein (zufällige UUID oder client-geliefert, kein Rückschluss ohne Log-Korrelation) | folgt Logs | folgt Logs | Ja | keine | keine |
| Rate-Limit-Schlüssel (`security_rate_limit_buckets.key_hash`) | Nein (HMAC-SHA-256, nicht reversibel) | eigene TTL/Cleanup-Skript | unverändert | bereits gelöst | keine | keine |
| SMTP-Nachrichten (echter Versand) | Ja (E-Mail-Inhalt, Empfängeradresse) | liegt beim SMTP-Provider/Postfach, ausserhalb von FitTrack | betreiberabhängig | Nein (ausserhalb der Anwendung) | im Pilot-Consent erwähnen, dass Einladungs-/Bestätigungsmails beim Provider verbleiben | Provider-seitige Retention vor Produktion klären |
| Development-E-Mail-Outbox | — | **nicht persistent** (Link direkt in der API-Antwort, nie gespeichert) | entfällt | entfällt | keine | keine |
| Lokale unverschlüsselte Backups (Legacy-Pfad) | Ja (vollständiger DB-Dump) | seit Stage 2B1 in Produktion vollständig gesperrt | entfällt in Produktion | Ja (Datei löschen) | nur für lokale Entwicklung relevant | in Produktion bereits gesperrt |
| Verschlüsselte `.ftbackup`-Dateien | Ja (vollständiger, aber AES-256-GCM-verschlüsselter Dump) | siehe Abschnitt 20 (GFS-Retention) | unverändert für diese Phase | Nein bis Ablauf der Retention (siehe Abschnitt 20/21) | Retention-Fenster im Pilot-Consent nennen | vor Produktion: Retention-Dauer und Schlüsselverwaltung final festlegen |
| Remote-Backup-Code (Stage 2B2A) | Ja (wie oben, extern gespiegelt) | Mechanik vorhanden, **kein echter externer Bucket verbunden** (Stage 5B Abschnitt 3/21) | unverändert | entfällt (kein echtes Ziel) | keine (nicht aktiv) | vor echtem Bucket-Anschluss: Retention/Zugriffskontrolle klären |
| Tatsächlicher externer Bucketstatus | — | **nicht verbunden** | — | — | keine | Stage 2B2B (weiterhin „Deferred until first customer") |
| Browsercookies (Access/Refresh/CSRF) | Ja (mittelbar, Session-Bezug) | folgt Sitzungs-TTL (15 Min/7 Tage) | unverändert | Ja (Logout/Logout-All bereits vorhanden) | keine | keine |
| Access Tokens | Ja (mittelbar) | 15 Min TTL, nur im Speicher | unverändert | Ja (läuft ohnehin ab, zusätzlich `auth_version`-Invalidierung) | keine | keine |
| Refresh Tokens | Ja (mittelbar, Hash) | 7 Tage TTL | unverändert | Ja (Widerruf bereits vorhanden) | keine | keine |
| CSRF Tokens | Nein (kein Personenbezug an sich) | folgt Refresh-Token | unverändert | Ja | keine | keine |
| Screenshots/Traces/E2E-Artefakte | Möglich (Testfixture-E-Mails, nie echte Personendaten) | lokal, nie committet (siehe Stage 5B Abschnitt 33) | unverändert | Ja | bereits Praxis: nie committen | keine |
| Temporäre Restore-Datenbanken | Ja (vollständiger Dump während eines Drills) | nur für die Dauer eines Restore-Drills, danach verworfen | unverändert | Ja | keine | keine |
| GitHub-Actions-Logs | Nein direkt (CI nutzt synthetische Testdaten, nie echte Personendaten) | GitHub-Standard-Retention | unverändert | betreiberabhängig (GitHub-Repo-Einstellung) | keine | vor Produktion: Repo-Log-Retention prüfen |
| Lokale `.env`-Dateien | Nein (nur Konfiguration/Secrets, keine Personendaten) | lokal, nie committet | unverändert | Ja | keine | keine |

**Einordnung (wie vom Auftrag gefordert):** Aktiv löschbar sind alle
DB-internen Tabellen (Abschnitt 4) sowie Cookies/Tokens/temporäre
Restore-DBs. Nur durch Retention auslaufend sind Rate-Limit-Buckets
(bereits gelöst), Backups (Abschnitt 20/21) und SMTP-Provider-seitige Kopien.
Nicht rückwirkend veränderbar sind bereits erstellte `.ftbackup`-Dateien und
extern beim SMTP-Provider verbleibende Nachrichten. Keine Fläche enthält
heute PII, die dort nicht enthalten sein dürfte — die grösste bekannte
Lücke ist, dass ein Restore aus einem `.ftbackup` eine bereits gelöschte
Person technisch wieder einführen kann (Abschnitt 21).

---

## 5. Personenbezogene Daten

**Direkte Identifikatoren** (identifizieren eine Person ohne weiteren
Kontext): `users.username`, `users.email`, `studio_invitations.email_normalized`,
`user_email_change_requests.new_email_normalized`.

**Indirekte Identifikatoren** (identifizieren eine Person nur in Kombination
mit Kontext, z. B. „welches Mitglied dieses Studios"): `studio_memberships.user_id`
(in Kombination mit `studio_id`), Freitextfelder mit möglichem Namensbezug
(`workouts.notes`, `studio_workout_sessions.member_note`,
`studio_workout_session_sets.member_note`,
`studio_workout_session_feedback.body`), sowie jede `*_by_user_id`-Spalte in
Kombination mit der jeweiligen Studio-Mitgliederliste (aus der Rolle plus
Zeitpunkt lässt sich in einem kleinen Studio oft auf eine Person schliessen).

**Besonders schützenswert (P4-Klasse, siehe `FITTRACK_SECURITY_AND_PRIVACY_STATUS.md`):**
Trainingsergebnisse (`studio_workout_session_sets`, `_exercises`, `_sessions`)
und Coach-Feedback (`studio_workout_session_feedback`) — beide ohne
Owner/Admin-Bypass zugreifbar, beide sensibler als reine Kontaktdaten, da sie
faktisch Leistungs- respektive gesundheitsnahe Daten sind.

---

## 6. Studio-Mitgliedschaft entfernen

Ein Owner oder Admin entfernt eine Person aus einem bestimmten Studio, **ohne**
das globale Konto zu berühren.

**6.1 Bestehender Mechanismus (bereits implementiert, kein neuer Code
nötig für den Admin/Owner-Pfad).** `PATCH /api/v1/studios/:studioId/memberships/:membershipId`
mit `{status: 'left'}`, geschützt durch `PERMISSIONS.MEMBERSHIP_MANAGE`
(nur `owner`/`admin`), ausgewertet durch `membershipChangeDecision()`
(`backend/domain/studioPolicy.js:110-147`). Diese Funktion prüft bereits
korrekt: Zielstatus nicht `invited`/`left` (sonst `REJOIN_REQUIRES_INVITATION`),
keine Selbst-Beförderung, Admin darf nur `trainer`/`member` als Ziel
(`ADMIN_TARGET_FORBIDDEN` sonst), und — zentral für Abschnitt 11 — ein
Owner kann nicht entfernt/degradiert werden, wenn er der letzte aktive
Owner ist (`LAST_ACTIVE_OWNER` → `LastOwnerRequiredError`, 409
`LAST_OWNER_REQUIRED`).

**6.2 Was bei `status: 'left'` bereits korrekt passiert (kein neuer Code
nötig).** Die Mitgliedschaftszeile selbst bleibt bestehen (kein Hard-Delete
— `RESTRICT`-Fremdschlüssel von Coaching-Beziehungen/Zuweisungen würden das
ohnehin verhindern, siehe Abschnitt 4). Bestehende Coaching-Beziehungen,
Zuweisungen, Terminierungsregeln, künftige Kalendereinträge, laufende und
abgeschlossene Workout-Sessions sowie Feedback bleiben unverändert in der
Datenbank — sie werden nicht kaskadierend gelöscht (kein FK erzwingt das).
Zugriff nach Entfernung: Die entfernte Person verliert beim nächsten
Request sofort den Studio-Zugriff, da `studioContext`-Middleware
`status='active'` voraussetzt (Stage 5B Abschnitt 5.5) — bestehende
Auth-Sitzungen bleiben aber technisch gültig für andere Studios/den
persönlichen Bereich, was korrekt ist (die Person wurde nicht aus FitTrack
entfernt, nur aus diesem einen Studio). Eine spätere Wiedereinladung ist
möglich (neue `studio_invitations`-Zeile, neue Annahme) — die alte
`left`-Zeile mit derselben `(studio_id, user_id)`-Kombination verhindert
das nicht, da `updateMembership` beim erneuten Beitritt eine neue
Mitgliedschaftszeile über den bestehenden Einladungs-Workflow anlegt
(separat von der `UNIQUE (studio_id, user_id)`-Altzeile — dies ist
bestehendes, ungeändertes Verhalten und **nicht** Teil dieses Designs, da
es bereits korrekt funktioniert).

**6.3 Aktive Vorgänge bei Entfernung.** Siehe Abschnitt 12 für die
vollständige Tabelle — zusammengefasst: nichts wird automatisch beendet;
eine laufende Workout-Session, eine aktive Coaching-Beziehung, eine aktive
Zuweisung bleiben bestehen und werden beim nächsten Zugriffsversuch der
entfernten Person korrekt mit 403/404 abgewiesen (bestehendes RBAC-Modell),
nicht durch diese Aktion selbst verändert. Dies ist eine bewusste
Design-Entscheidung: das Entfernen einer Mitgliedschaft ist eine reine
Zugriffsänderung, keine Datenbereinigung.

**6.4 Lücke: Selbstentfernung ist heute für Trainer/Member nicht möglich.**
`ROLE_PERMISSIONS` (`backend/domain/studioPolicy.js:30-79`) gewährt
`MEMBERSHIP_MANAGE` ausschliesslich `owner` und `admin` — ein Trainer oder
ein Member hat heute **keine** Möglichkeit, sich selbst aus einem Studio zu
entfernen; nur ein Owner/Admin kann das für sie tun. Dies ist eine reale,
bereits heute bestehende Lücke, unabhängig von Kontolöschung. Empfehlung
(Abschnitt 32, Implementierungsscope): `membershipChangeDecision()` um
einen zusätzlichen, sehr eng gefassten Zweig erweitern, der `sameUser &&
changes.status === 'left'` unabhängig von `actor.role` erlaubt — geprüft an
derselben Stelle wie die bestehende `SELF_PROMOTION_FORBIDDEN`-Prüfung
(Zeile 121-129), **vor** der rollenbasierten Einschränkung. Der bestehende
`LAST_ACTIVE_OWNER`-Schutz greift dabei unverändert weiter, da er nach der
Rollenprüfung ausgewertet wird und nicht von ihr abhängt.

**6.5 Empfehlung: Statusänderung, keine harte Löschung.** Wie bereits heute
implementiert. Kein neuer Statuswert nötig (`left` deckt sowohl
administrative Entfernung als auch Selbstentfernung ab — beide bedeuten
„nicht mehr Mitglied, Wiedereintritt nur über neue Einladung").

---

## 7. Globales Konto löschen

Der Benutzer löscht sein gesamtes FitTrack-Konto.

**7.1 Mitgliedschaften in mehreren Studios.** Jede aktive/suspendierte
Mitgliedschaft des Kontos wird im Rahmen der Kontolöschungs-Transaktion
(Abschnitt 18) auf `status='left'` gesetzt — exakt der in Abschnitt 6
beschriebene, bereits bestehende Mechanismus, nur systemweit statt pro
Studio einzeln ausgelöst.

**7.2 Owner-Rollen / Sole Owner.** Für jedes Studio, in dem das zu löschende
Konto der **einzige aktive Owner** ist, muss die Löschung **vor** Ausführung
blockiert werden — siehe Abschnitt 11 für die vollständige Analyse und
Abschnitt 9 für die Entscheidung (Blockieren statt automatischer
Eigentumsübertragung).

**7.3 Admin-/Trainer-/Member-Rollen.** Keine Sonderbehandlung nötig — diese
Rollen haben keine Alleinverantwortung, die ein Studio verwaist zurücklässt;
Statusänderung wie in 7.1 genügt.

**7.4 Aktive Coaching-Beziehungen.** Werden auf `status='ended'` gesetzt
(bestehender Mechanismus, `endCoachingRelationship`), unabhängig davon, ob
das zu löschende Konto Coach oder Member der Beziehung ist. Bestehende
Zuweisungen, die über diese Beziehung liefen, bleiben unverändert bestehen
(ADR 002: Zuweisungen sind historische Fakten, keine live-abhängige
Berechtigung).

**7.5 Aktive Zuweisungen — REVIDIERT (Blocker 3).** Die ursprüngliche
Entscheidung (Zuweisung bleibt `active`, während die zugehörige
Coaching-Beziehung bereits `ended` ist und Terminierungsregeln bereits
`disabled` sind) erzeugte einen inkonsistenten Zwischenzustand: eine
„aktive" Zuweisung ohne aktive Beziehung und ohne laufende Terminierung ist
weder eindeutig „läuft weiter" noch eindeutig „beendet". **Neue,
verbindliche Regel:** Jede **aktive** Zuweisung, bei der das zu löschende
Konto das **Mitglied** ist (`member_membership_id` gehört zum Konto), wird
in derselben Transaktion atomar auf `status='cancelled'`, `cancelled_at=NOW()`
gesetzt — unter Wiederverwendung des bereits bestehenden
`active→cancelled`-Übergangs (Migration 006: `chk_program_assignments_status
CHECK (status IN ('active','completed','cancelled'))`, bereits heute über
den bestehenden Zuweisungs-Aktualisierungs-Endpunkt erreichbar, z. B. der
in `ProgramAssignmentsView.vue` bereits vorhandene „Abschliessen"/
„Stornieren"-Mechanismus). Bereits `completed` oder bereits `cancelled`
Zuweisungen bleiben **unverändert** (Update-Guard `WHERE status='active'`
macht dies idempotent). **Wichtige Abgrenzung:** Diese Regel betrifft
ausschliesslich Zuweisungen, bei denen das gelöschte Konto **Mitglied** ist
— nicht Zuweisungen, die das gelöschte Konto als Trainer:in **erstellt**
hat (`assigned_by_user_id`) für ein anderes, nicht zu löschendes Mitglied.
Der Trainingsplan eines fremden, weiterhin aktiven Mitglieds wird durch die
Löschung des ursprünglich zuweisenden Coaches **nicht** storniert — das
wäre ein unangemessener, überraschender Nebeneffekt für eine Person, deren
eigenes Konto gar nicht gelöscht wird.

**7.6 Aktive Terminierungsregeln — REVIDIERT (Blocker 3).** Jede aktive
Terminierungsregel, die das zu löschende Konto **erstellt** hat
(`created_by_user_id`), wird auf `status='disabled'` gesetzt — **unabhängig
davon, für welches Mitglied die Regel gilt**, bewusst anders gescopt als
7.5. Grund: `backend/services/trainingCalendarService.js` prüft beim
Materialisieren künftiger Kalendertermine **nicht** den Live-Status der
zugrundeliegenden Coaching-Beziehung (verifiziert: kein Verweis auf
`coaching_relationship` in dieser Datei) — würde die Regel eines
gelöschten Coaches aktiv bleiben, generierte sie für ein fremdes, weiterhin
aktives Mitglied unbeaufsichtigt neue Trainingstage, ohne dass irgendein
Coach diese je betreut. Das Deaktivieren verhindert genau dieses „Phantom-
Coach"-Szenario. Bereits abgeschlossene/materialisierte Kalendereinträge
bleiben davon unberührt (bestehendes Prinzip: Deaktivieren ist ein reiner
Status-Flip, kein Löschen, Abschnitt 6.4/8).

**7.7 Zukünftige Kalendereinträge — REVIDIERT (Blocker 3).** Der
tatsächliche Statusübergangs-Vertrag
(`backend/domain/trainingCalendarDomain.js`, `ALLOWED_TRANSITIONS`) wurde
gegen den Code verifiziert: `PLANNED → CANCELLED` ist ein bestehender,
erlaubter Übergang; `IN_PROGRESS → CANCELLED` ist es **nicht**
(`IN_PROGRESS` erlaubt nur `→ COMPLETED` oder `→ PLANNED`). Die neue,
konsistente Regel:

- **Zukünftige Studio-Kalendereinträge** (`source_type='studio'`,
  `status='PLANNED'`, `user_id`=Konto): werden auf `status='CANCELLED'`
  gesetzt.
- **`IN_PROGRESS`-Studio-Kalendereinträge:** werden **nicht** direkt
  „cancelled" — sie folgen der Session-Regel (Abschnitt 7.8/12): das
  Abbrechen der zugehörigen `in_progress`-Workout-Session löst — über die
  bereits bestehende, in `trainingCalendarDomain.js` dokumentierte
  Integration („IN_PROGRESS → PLANNED modelliert einen Session-Abbruch, der
  ein Vorkommnis wieder plangültig macht") — automatisch den bestehenden
  Übergang `IN_PROGRESS → PLANNED` aus. Der so entstandene `PLANNED`-Eintrag
  wird danach, in derselben Transaktion, von der obigen
  `PLANNED → CANCELLED`-Regel mit erfasst. Kein neuer, bisher nicht
  existierender Übergang wird eingeführt.
- **`COMPLETED`/`SKIPPED`/bereits `CANCELLED`-Einträge:** bleiben
  unverändert (kein erlaubter Übergang existiert dafür, und keiner wäre
  fachlich gewollt — historische Tatsache).
- **Zukünftige persönliche Kalendereinträge** (`source_type='personal'`):
  weiterhin hart gelöscht, unverändert gegenüber der ursprünglichen
  Fassung (Abschnitt 7.9).

**7.8 Laufende Workout-Sessions — NEU (Blocker 2).** Verbindliche
Entscheidung zwischen „Löschung blockieren, solange eine Session
`in_progress` ist" und „Session atomar als `aborted` beenden": **Session
atomar beenden.** Geprüft gegen ADR 003 (`docs/adr/003-studio-workout-execution-and-results.md`):
der Übergang `in_progress → aborted` ist bereits heute **präzedenzlos**
(„abort exists precisely for 'I'm stopping now, whatever state this is
in,'" — keine Vorbedingungen, im Gegensatz zu `in_progress → completed",
das ein vollständiges Ausfüllen aller Sätze voraussetzt) und lässt „jede
Zeile exakt wie sie war" — Migration 007 bestätigt dies schema-seitig
(`chk_workout_sessions_aborted_at CHECK ((status='aborted' AND aborted_at
IS NOT NULL) OR (status<>'aborted' AND aborted_at IS NULL))`). Jede
`in_progress`-Session, bei der `member_membership_id` zum zu löschenden
Konto gehört, wird daher in derselben Transaktion auf `status='aborted'`,
`aborted_at=NOW()` gesetzt — unter Wiederverwendung genau dieser
bestehenden, bereits vollständig spezifizierten Transition, kein neuer
Übergang. Die verknüpften `studio_workout_session_exercises`/`_sets`
bleiben dabei unverändert (ADR 003: Abbruch verändert keine bereits
protokollierten Werte). Der bereits bestehende, in
`trainingCalendarDomain.js` dokumentierte Integrationseffekt
(`IN_PROGRESS → PLANNED` auf dem verknüpften Kalendereintrag) tritt
automatisch ein und wird in Abschnitt 7.7 weiterverarbeitet. Bereits
`completed` oder bereits `aborted` Sessions bleiben unverändert
(Update-Guard `WHERE status='in_progress'`). Ein eigener, stabiler
Lösch-Blocker-Fehlercode ist damit **nicht** erforderlich — die Preview
(Abschnitt 15.1) weist die betroffene Anzahl trotzdem transparent als
Auswirkung aus, nicht als Blocker.

**7.9 Persönliche Workouts/Progress-Daten.** Werden **hart gelöscht** als
Teil derselben Transaktion — hierfür ist keine Anonymisierung nötig oder
sinnvoll, da diese Daten laut ADR-Philosophie ausschliesslich der Person
selbst gehören und keine Drittinteressen (anderer Studio-Mitglieder,
Audit-Pflichten) daran bestehen. Technisch bereits korrekt vorbereitet:
`workouts.user_id`/`progress_entries.user_id` sind `ON DELETE CASCADE` —
sobald die `users`-Zeile selbst gelöscht würde, verschwänden sie automatisch;
da die empfohlene Strategie aber **Anonymisierung, nicht Hard-Delete** der
`users`-Zeile ist, muss die Löschung dieser beiden Tabellen **explizit** als
eigener Schritt der Löschtransaktion erfolgen (nicht implizit über einen
`users`-`DELETE`, der ja gerade nicht stattfindet).

**7.10 Abgeschlossene Studiohistorie.** Bleibt vollständig erhalten, aber
ohne direkten Identifikator zur Person (siehe Abschnitt 13).

**7.11 Feedback.** Bleibt unverändert im Wortlaut bestehen (append-only,
kein Schreibzugriff auf `body` vorgesehen) — sowohl als Autor:in als auch
als Adressat:in eines Feedbacks entpersonalisiert sich der Bezug indirekt
durch die Anonymisierung der `users`-Zeile des Autors/Adressaten, nicht
durch eine Änderung an der Feedback-Zeile selbst. **Enthält weiterhin
möglicherweise personenbezogenen Freitext** (Blocker 4, Abschnitt 13) — das
wird hier bewusst nicht relativiert.

**7.12 Audit Events.** Bleiben vollständig erhalten (`actor_user_id` fällt
bei einer etwaigen zukünftigen Hard-Delete-Situation ohnehin auf `NULL`,
bei der empfohlenen Anonymisierung bleibt die Referenz sogar technisch
gültig, zeigt aber auf eine anonymisierte Zeile). Neu hinzu kommen, pro
betroffener Zeile, die bereits bestehenden Ereignistypen
`training_program_assignment.cancelled` (7.5) und
`assignment.schedule_rule.disabled` (7.6) sowie `workout_session.aborted`
(7.8) — alle drei existieren bereits im Ereigniskatalog, keine
Erweiterung nötig (Abschnitt 17).

**7.13 Einladungen.** Offene, noch nicht angenommene Einladungen, die das zu
löschende Konto ausgesprochen hat (`invited_by_user_id`), bleiben bestehen
(`SET NULL` bereits vorbereitet, aber bei Anonymisierung nicht nötig — die
Einladung bleibt funktional gültig, der Einladende ist nur nicht mehr
identifizierbar). Eine offene Einladung **an** die E-Mail-Adresse des zu
löschenden Kontos (`studio_invitations.email_normalized`) wird beim
Anonymisieren der E-Mail-Adresse funktional verwaist (niemand kann sie mehr
annehmen) — dies ist unkritisch, da sie ohnehin nach 7 Tagen abläuft.

**7.14 Sessions.** Alle aktiven `user_auth_sessions`/`user_refresh_tokens`
werden in derselben Transaktion widerrufen (Abschnitt 14).

**7.15 E-Mail-Änderungen.** Ein offener `user_email_change_requests`-Eintrag
wird hart gelöscht (`CASCADE` von `user_id`, funktional bereits korrekt
vorbereitet — muss aber wie 7.9 explizit ausgeführt werden, da kein
`users`-`DELETE` stattfindet).

**7.16 Wiederverwendung der bisherigen E-Mail-Adresse.** Wird durch die
Anonymisierung automatisch möglich: Sobald `users.email` auf einen
Platzhalterwert überschrieben ist, ist die ursprüngliche Adresse im
bestehenden `UNIQUE`-Index frei — ohne zusätzlichen Mechanismus. Empfehlung:
**sofortige** Freigabe, kein Sperrfenster (siehe Abschnitt 9 Begründung).

**7.17 Wiederregistrierung nach Löschung.** Ist damit ab dem Moment der
Löschung technisch identisch zu einer Erstregistrierung mit dieser E-Mail —
es entsteht ein komplett neues `users`-Konto ohne jede Verbindung zum
anonymisierten alten Konto (kein gemeinsamer Schlüssel, kein
Wieder-Anknüpfen an alte Historie). Dies ist beabsichtigt und entspricht
dem Zweck der Löschung.

---

## 8. Löschung versus Anonymisierung

### 8.1 Harter Delete — geeignet für

- `user_auth_sessions`, `user_refresh_tokens` (bereits `CASCADE`, ohnehin
  kurzlebig).
- `user_email_change_requests` (bereits `CASCADE`, rein operativ).
- `workouts`, `workout_exercises`, `progress_entries` (rein persönlich, kein
  Drittinteresse, `exercises.user_id` fällt korrekt auf `NULL`).
- Die `users`-Zeile selbst — **nur** in der Ausnahme „nie irgendeine
  `studio_memberships`-Zeile besessen" (siehe 8.4).

### 8.2 Irreversible Anonymisierung — geeignet für

- `users` (Regelfall: Konto mit Studio-Historie) — Zeile bleibt, direkte
  Identifikatoren werden ersetzt (Abschnitt 10).
- Indirekt (ohne eigene Datenänderung, nur durch die `users`-Anonymisierung
  entpersonalisiert): abgeschlossene Studio-Workout-Historie, historische
  Zuweisungen, Coach-Feedback, Audit-Ereignisse, Terminierungsregeln,
  Kalendereinträge — **keine dieser Zeilen wird selbst verändert**, ihr
  Personenbezug verschwindet ausschliesslich dadurch, dass die
  referenzierte `users`-Zeile keinen Klarnamen/keine E-Mail mehr trägt.

### 8.3 Retention bis Fristablauf — relevant für

- Verschlüsselte `.ftbackup`-Dateien (GFS-Retention, Abschnitt 20).
- Rate-Limit-Daten (eigene TTL, bereits gelöst).
- GitHub-Actions-Artefakte (GitHub-Standard-Retention, ausserhalb der
  Anwendung).
- Temporäre Testartefakte (bereits Praxis: nie committet, lokal
  ephemer).

### 8.4 Die Ausnahme: Konto ohne jede Studio-Berührung

Ein Konto, das **zu keinem Zeitpunkt** eine `studio_memberships`-Zeile
besass (nie ein Studio erstellt, nie eine Einladung angenommen), hat keine
`RESTRICT`-Referenz, die einen `DELETE FROM users WHERE id=?` verhindern
würde — `workouts`/`progress_entries` kaskadieren korrekt,
`exercises.user_id` fällt auf `NULL`. **Für dieses eine, klar abgrenzbare
Szenario ist ein echter Hard-Delete der `users`-Zeile möglich und sollte
bevorzugt werden** (einfacher, kein Anonymisierungs-Overhead nötig, keine
verbleibende Zeile). Die Prüfung dafür ist trivial und exakt:
`SELECT COUNT(*) FROM studio_memberships WHERE user_id = ?` — ist das
Ergebnis 0, ist Hard-Delete zulässig; andernfalls ist Anonymisierung
zwingend (Abschnitt 4 RESTRICT-Kette). Diese Prüfung muss **exakt** sein
(auch eine einzige `left`-Zeile aus der Vergangenheit zählt — die
Mitgliedschaft besteht ja weiterhin als Zeile, `RESTRICT` block bleibt
bestehen).

---

## 9. Empfohlene Hybridstrategie

**Kernentscheidung:** Globale Kontolöschung = **irreversible Anonymisierung
in-place** als Regelfall, mit einer einzigen, exakt geprüften Ausnahme
(Hard-Delete für Konten ohne jede Studio-Historie, Abschnitt 8.4). Dies ist
keine Präferenz, sondern eine **durch das bestehende Schema erzwungene**
Entscheidung — acht `RESTRICT`-Fremdschlüssel (Abschnitt 1/4) machen einen
generischen Hard-Delete für jedes Konto mit Studio-Berührung schlicht
unmöglich, ohne entweder die Transaktion abzubrechen oder fremde
Studio-Daten anderer Nutzer:innen zu zerstören (z. B. würde das Löschen
eines Trainingsprogramm-Erstellers ohne Anonymisierung `RESTRICT` auslösen
und scheitern — ein kaskadierendes Löschen des Programms wäre die einzige
Alternative und würde die Zuweisungen und Trainingsergebnisse anderer,
unbeteiligter Mitglieder mit vernichten).

Studio-Mitgliedschaftsentfernung bleibt **immer** eine reine Statusänderung
(`left`), nie eine Löschung — unverändert gegenüber dem bestehenden
Verhalten, nur um Selbstentfernung für Trainer/Member erweitert
(Abschnitt 6.4).

Diese Empfehlung ist keine mehrdeutige Option unter mehreren
gleichwertigen — sie ist die einzige mit dem bestehenden Schema und den
ADR-001-bis-003-Prinzipien konsistente Lösung.

---

## 10. User Lifecycle

Neuer Zustand auf `users`, entworfen (nicht implementiert) in Migration 013
(Abschnitt 19). **Revidiert (Blocker 5):** `deletion_reason` wurde nach
kritischer Prüfung aus dem Entwurf entfernt — siehe Abschnitt 19 für die
Begründung (in dieser Phase gibt es genau einen Auslöser für
`lifecycle_status='deleted'`, sodass eine dritte Spalte für einen stets
konstanten Wert keinen Zweck erfüllt; kein freier Löschgrund wurde je
vorgesehen).

```
lifecycle_status: 'active' | 'deleted'   (VARCHAR(16) NOT NULL DEFAULT 'active', CHECK)
deleted_at:       TIMESTAMP(3) NULL
```

Übergang ist **einmalig und irreversibel**: `active → deleted`. Kein
Rückweg (`deleted → active`) ist vorgesehen — eine Wiederherstellung würde
bedeuten, gelöschte direkte Identifikatoren wiederherzustellen, was dem
Zweck der Funktion widerspricht. Ein bereits anonymisiertes Konto, das
erneut einen Löschantrag stellen könnte, existiert nicht (kein Login mehr
möglich, siehe Abschnitt 14) — Idempotenz wird stattdessen auf
Transaktionsebene sichergestellt (Abschnitt 16: zweiter Löschversuch auf
ein bereits `deleted`-Konto ist eine no-op/409, kein Fehlerzustand).

`lifecycle_status='deleted'` wird an folgenden Stellen ausgewertet (Entwurf
für die Implementierung, nicht Teil dieser Phase):

- Login (`POST /api/users/login`): identisch zur bestehenden
  „unbekanntes Konto"-Behandlung — derselbe Dummy-Hash-Vergleich, dieselbe
  generische Fehlermeldung, um nicht zu verraten, ob ein Konto je existierte
  oder gelöscht wurde (Enumeration-Schutz, Abschnitt 24).
- Auth-Middleware (`authMiddleware.js`): analog zur bestehenden
  `auth_version`-Prüfung zusätzlich `lifecycle_status='active'` fordern —
  ein Token, das vor der Löschung ausgestellt wurde, aber technisch noch
  nicht abgelaufen ist, wird trotzdem als `AUTH_SESSION_INVALIDATED`
  abgelehnt (siehe Abschnitt 14, überflüssig relativ zur ohnehin
  garantierten Sitzungswiderrufung, aber als zweite, unabhängige
  Verteidigungslinie empfohlen).

---

## 11. Owner-Schutz

Ein Benutzerkonto darf **nie** gelöscht werden, wenn dadurch ein aktives
Studio ohne aktiven Owner verbleibt.

**11.1 Bestehende Owner-Schutzregeln (wiederverwendbar).** Der exakte
Mechanismus existiert bereits für die Mitgliedschaftsänderung
(`membershipChangeDecision`, Abschnitt 6.1): pro Studio wird
`SELECT COUNT(*) FROM studio_memberships WHERE studio_id=? AND role='owner'
AND status='active' FOR UPDATE` gebildet; ist der zu ändernde Owner der
letzte, wird die Aktion mit `LastOwnerRequiredError` (409
`LAST_OWNER_REQUIRED`) verweigert.

**11.2 Erweiterung für Kontolöschung.** Vor Ausführung einer Kontolöschung
wird — innerhalb derselben Transaktion, mit denselben `FOR UPDATE`-Sperren
— für **jedes** Studio geprüft, in dem das Konto eine aktive
`owner`-Mitgliedschaft hat, ob es der einzige aktive Owner ist:

```sql
SELECT sm.studio_id, s.name,
       (SELECT COUNT(*) FROM studio_memberships sm2
        WHERE sm2.studio_id = sm.studio_id
          AND sm2.role = 'owner' AND sm2.status = 'active') AS active_owner_count
FROM studio_memberships sm
JOIN studios s ON s.id = sm.studio_id
WHERE sm.user_id = ? AND sm.role = 'owner' AND sm.status = 'active'
FOR UPDATE
```

Ist für irgendeine Zeile `active_owner_count = 1` (das zu löschende Konto
selbst), wird die **gesamte** Löschung abgelehnt, **bevor** irgendeine
Änderung geschrieben wird (Abschnitt 16: Prüfung ist der erste Schritt der
Transaktion, vor jeder Mutation).

**11.3 Studios mit mehreren Ownern.** Unkritisch — die Löschung setzt die
Mitgliedschaft des zu löschenden Kontos auf `left`, das Studio behält seine
übrigen aktiven Owner.

**11.4 Inaktive/archivierte Studios.** Es gibt heute keinen
„archiviert"-Zustand für Studios (nur `active`/`suspended`, Migration 005) —
ein `suspended`-Studio wird identisch behandelt wie ein aktives für diese
Prüfung, da `suspended` keine Aussage über Owner-Bedarf trifft.

**11.5 Entscheidung: Blockieren, nicht automatisch übertragen.** Der
Auftrag nennt drei Optionen: Löschung blockieren, Ownership-Transfer
verlangen, oder Studio vorab archivieren. **Empfehlung: Blockieren.** Eine
automatische Eigentumsübertragung ohne explizite Zustimmung einer zweiten
Person wäre eine impliziter, potenziell überraschender
Berechtigungswechsel für eine dritte Partei — das widerspricht dem
gesamten bisherigen RBAC-Prinzip des Produkts (jede Rollenänderung ist eine
bewusste Aktion einer berechtigten Person, nie ein Nebeneffekt). Ein
automatisches Vorab-Archivieren des Studios wäre für die verbleibenden
Mitglieder (Trainer, Members mit laufenden Programmen) ein einschneidender,
ebenfalls nicht in ihrem Sinne herbeigeführter Zustand. **Blockieren mit
einer klaren, umsetzbaren Fehlermeldung ist die einzige Option, die keine
Nebenwirkung für Dritte erzeugt** — der Nutzer muss selbst vorher entweder
einen weiteren Owner ernennen (bestehender Mechanismus:
`PATCH .../memberships/:id {role:'owner'}`) oder das Studio einer anderen
Person überlassen, bevor die Kontolöschung möglich wird.

**11.6 Fehlervertrag (Entwurf, Benennung nach Analyse der bestehenden
Konventionen — siehe `LastOwnerRequiredError`/`LAST_OWNER_REQUIRED` als
direktes Vorbild):**

```
Status: 409
Code:   ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED
Message: "Delete your account only after appointing another owner in every
          studio you currently own alone."
Fields (nicht sensibel, nur Studio-Namen + IDs des Nutzers selbst, keine
        Daten Dritter): { studios: [{ studioId, studioName }] }
```

Keine automatische Owner-Zuweisung an eine dritte Person wird je
vorgenommen.

---

## 12. Aktive Vorgänge

| Zustand | Verhalten bei Kontolöschung | Begründung |
|---|---|---|
| Laufende Workout Session (`in_progress`, Konto ist Mitglied) | **REVIDIERT (Blocker 2): wird atomar auf `aborted` gesetzt** (`aborted_at=NOW()`), verknüpfte Sätze/Übungen bleiben unverändert | Bereits bestehende, präzedenzlose `in_progress→aborted`-Transition (ADR 003) — keine Vorbedingungen, verändert keine protokollierten Werte. Löst zusätzlich den bestehenden Kalender-Integrationseffekt `IN_PROGRESS→PLANNED` aus. Siehe 7.8. |
| Bereits `completed`/bereits `aborted` Session | **bleibt unverändert** | Terminal, historische Tatsache |
| Aktive Programmzuweisung (Konto ist Mitglied) | **REVIDIERT (Blocker 3): wird atomar auf `cancelled` gesetzt** (`cancelled_at=NOW()`) | Bestehender `active→cancelled`-Übergang (Migration 006); vermeidet den inkonsistenten Zwischenzustand „aktive Zuweisung ohne aktive Beziehung/Terminierung". Siehe 7.5. |
| Bereits `completed`/bereits `cancelled` Zuweisung | **bleibt unverändert** | Terminal, historische Tatsache |
| Zuweisung, die das Konto als Trainer:in für ein **anderes** Mitglied erstellt hat | **bleibt unverändert** (`active` bleibt `active`) | Das fremde Mitglied ist nicht Gegenstand dieser Löschung; ein Nebeneffekt auf dessen Trainingsplan wäre unangemessen (Abschnitt 7.5) |
| Aktive Coaching-Beziehung | **automatisch auf `ended` gesetzt** | Eine Beziehung setzt zwei aktive Parteien voraus — mit einer gelöschten Partei ist sie fachlich nicht mehr „aktiv" führbar; bestehender Mechanismus (`endCoachingRelationship`) wird innerhalb der Löschtransaktion aufgerufen |
| Aktive Terminierungsregel, vom Konto **erstellt** (unabhängig vom betroffenen Mitglied) | **automatisch auf `disabled` gesetzt** | Verhindert, dass ein fremdes Mitglied nach Löschung seines Coaches unbeaufsichtigt weiter neue Termine materialisiert bekommt — die Materialisierung prüft die Coaching-Beziehung nicht (verifiziert gegen `trainingCalendarService.js`). Siehe 7.6. |
| Zukünftiger Studio-Kalendereintrag (`PLANNED`, Konto ist `user_id`) | **REVIDIERT (Blocker 3): wird auf `CANCELLED` gesetzt** | Bestehender `PLANNED→CANCELLED`-Übergang (`trainingCalendarDomain.js`); konsistent mit terminalisierter Zuweisung/Regel. Siehe 7.7. |
| Studio-Kalendereintrag, der durch Session-Abbruch von `IN_PROGRESS` auf `PLANNED` zurückfällt | **wird danach ebenfalls `CANCELLED`** (von derselben Regel erfasst) | Kein neuer Übergang nötig — `IN_PROGRESS→CANCELLED` existiert nicht, `IN_PROGRESS→PLANNED→CANCELLED` nutzt zwei bestehende Übergänge nacheinander |
| `COMPLETED`/`SKIPPED`/bereits `CANCELLED` Kalendereintrag | **bleibt unverändert** | Terminal, historische Tatsache, kein Übergang dafür vorgesehen |
| Zukünftiger persönlicher Kalendereintrag | **wird gelöscht** (Teil der harten Löschung persönlicher Daten, Abschnitt 7.9 — ein persönlicher Kalendereintrag ist konzeptionell wie ein persönliches Workout zu behandeln) | Rein persönlich, kein Drittinteresse |
| Offene Einladung (ausgesprochen vom zu löschenden Konto) | **bleibt bestehen**, `invited_by_user_id` bleibt technisch gültig (zeigt auf anonymisiertes Konto) | Kein fachlicher Grund, eine bereits verschickte Einladung ungültig zu machen; läuft ohnehin nach 7 Tagen ab |
| Offene E-Mail-Änderung | **wird hart gelöscht** | Rein operativ, kein historischer Wert (Abschnitt 7.15) |
| Aktive Auth-Sitzung | **sofort widerrufen** | Zwingend, Abschnitt 14 |
| Ausstehender Refresh Token | **sofort widerrufen** | Zwingend, Abschnitt 14 |
| Rate-Limit-Zustand | **unverändert belassen** | Enthält keinen reversiblen Personenbezug (HMAC-Hash), läuft über eigene TTL aus; ein Zurücksetzen wäre sogar unerwünscht (könnte als Umgehung eines Limits missbraucht werden) |

---

## 13. Historische Daten

Bestehende Garantien (Stage 5B Abschnitt 20, ADR 002/003) bleiben durch
dieses Design **unverändert und werden durch keine hier vorgeschlagene
Aktion verletzt**:

- Abgeschlossene Workouts/Ergebnisse (`studio_workout_sessions`,
  `_exercises`, `_sets`) werden **inhaltlich nicht verändert** —
  Zielwerte, Ist-Werte, Zeitstempel, Status bleiben exakt wie protokolliert.
  Eine abgebrochene Session (Abschnitt 7.8) ist ebenfalls ein terminaler,
  historisch korrekter Zustand, keine Verfälschung.
- Programm-Snapshots (`studio_training_program_*`) werden nicht berührt —
  sie gehören dem Studio, nicht der gelöschten Person (ADR 002).
- Regeländerungen betreffen weiterhin nie abgeschlossene Historie (bereits
  garantiert durch die Materialisierungslogik, unverändert durch dieses
  Design).
- Feedback (`studio_workout_session_feedback.body`) bleibt **wortwörtlich
  unverändert** — es gibt heute keinen UPDATE/DELETE-Pfad für diese Tabelle,
  und dieses Design fügt keinen hinzu. Der Personenbezug zum Autor
  verschwindet ausschliesslich indirekt über die Anonymisierung von
  `users`.
- Audit-Ereignisse bleiben vollständig nachvollziehbar (Ereignistyp,
  Zeitstempel, Zielobjekt) — nur der `actor_user_id`-Bezug zeigt nach
  Anonymisierung auf ein Konto ohne Klarnamen.
- Keine Cross-Tenant-Verknüpfung entsteht — die Anonymisierung berührt
  ausschliesslich die eine `users`-Zeile, nie eine andere Person oder ein
  anderes Studio.
- Keine neue Zuordnung zu einem anderen Benutzer wird je vorgenommen — die
  `id`/PK bleibt stabil, es findet keine Umschreibung von Fremdschlüsseln
  auf eine andere Zeile statt (im Unterschied zu einem hypothetischen
  „Ownership-Transfer", der hier explizit **nicht** automatisch geschieht,
  Abschnitt 11.5).

### 13.1 Freitext-Policy — REVIDIERT (Blocker 4)

Die ursprüngliche Fassung dieses Dokuments enthielt einen inneren
Widerspruch: Abschnitt 5 stufte `member_note` und Feedback-`body` explizit
als mögliche **indirekte Identifikatoren** ein, behauptete an anderer
Stelle aber gleichzeitig, Freitext bleibe „wortwörtlich unverändert" **und**
es bleibe „keine PII in der Historie". Beides gleichzeitig ist nicht
haltbar, sobald Freitext personenbezogene Inhalte tragen kann.

**Ehrliche, verbindliche Policy für Stage 5C:**

- Strukturierte **direkte** Account-Identifikatoren (`users.username`,
  `users.email`, `users.password_hash`) werden irreversibel anonymisiert
  — unverändert gegenüber der ursprünglichen Fassung.
- **Fachhistorischer Freitext** (`studio_workout_sessions.member_note`,
  `studio_workout_session_sets.member_note`,
  `studio_workout_session_feedback.body`, `workouts.notes` — Letzteres
  ohnehin Teil der harten Löschung persönlicher Daten, Abschnitt 7.9)
  bleibt **vollständig unverändert** — er wird **nicht** geleert, **nicht**
  überschrieben, **nicht** durchsucht oder automatisch bereinigt. Dies ist
  eine bewusste Umkehr der ursprünglichen Fassung (die `member_note` bei
  Workout-Sessions/-Sets leeren wollte).
- Dieser Freitext **kann weiterhin personenbezogene Inhalte enthalten**
  (z. B. wenn ein Mitglied den eigenen Namen in einer Notiz erwähnt, oder
  ein Coach im Feedback auf eine gesundheitliche Einschränkung eingeht).
  Dieses Dokument behauptet das **nicht** als gelöst.
- Zugriff auf diesen Freitext bleibt **unverändert streng tenant- und
  rollenbegrenzt** — dieselben Regeln wie heute (ADR 003: kein
  Owner/Admin-Bypass auf Ergebnisse/Feedback, nur die eigene aktive
  Coaching-Beziehung berechtigt zum Lesen; das Mitglied selbst sieht immer
  nur die eigenen Daten). Die Anonymisierung des Autor:innen-Kontos ändert
  an diesem Zugriffsmodell nichts.
- Eine spätere, weitergehende manuelle oder automatisierte
  Freitextbereinigung (z. B. eine Anfrage „bitte entferne meinen Namen auch
  aus meinen historischen Notizen") ist **ausdrücklich Out of Scope**
  dieser Phase (Abschnitt 33) — sie wäre ein eigenständiges, deutlich
  aufwändigeres Feature (Freitext-Erkennung/-Redaktion) ohne den
  RESTRICT-erzwungenen Charakter der übrigen Entscheidungen dieses
  Dokuments.
- Die Dokumentation behauptet **nicht**, dass sämtliche historische Inhalte
  nach einer Kontolöschung PII-frei sind — nur, dass keine **strukturierten
  direkten Account-Identifikatoren** mehr über die anonymisierte
  `users`-Projektion auflösbar sind (korrigiertes Abnahmekriterium,
  Abschnitt 30).

**Felder, die anonymisiert werden dürfen, ohne fachhistorische Inhalte zu
verändern:** ausschliesslich `users.username`, `users.email`,
`users.password_hash`. **Nichts sonst** — insbesondere keine Zeitstempel,
keine Ergebniswerte, keine Statuswerte, kein Feedback-`body`, kein
`member_note`, keine Programminhalte.

---

## 14. Authentifizierung und Sessions

Vollständiger Ablauf (Entwurf, wiederverwendet exakt die in Stage 3B1/3B2
etablierten Mechanismen):

1. **Aktuelle Access Tokens:** laufen technisch weiter bis zu ihrem 15-Minuten-Ablauf,
   werden aber durch die `auth_version`-Prüfung in der Auth-Middleware sofort
   ungültig, da die Löschtransaktion `users.auth_version` erhöht (identisch
   zum bestehenden Passwortänderungs-/Logout-All-Mechanismus).
2. **Refresh Tokens:** alle aktiven Tokens werden per
   `revokeAllSessionsInTransaction(connection, userId, 'account_deletion')`
   (bestehende Funktion, `sessionService.js:374-393`, hier mit einem neuen
   `revocation_reason`-Wert `account_deletion` — Erweiterung der bestehenden
   CHECK-Wertemenge in `user_auth_sessions.revocation_reason`, kein neues
   Schema-Feld, nur ein zusätzlicher erlaubter Wert) sofort auf `revoked`
   gesetzt.
3. **CSRF Tokens:** an Refresh-Tokens gebunden, verlieren mit deren Widerruf
   automatisch ihre Gültigkeit.
4. **Aktive Sessions (auch andere Browser/Geräte):** alle, nicht nur die
   aktuelle — `revokeAllSessionsInTransaction` widerruft nutzerweit, nicht
   sitzungsspezifisch (identisches Verhalten zu Logout-All).
5. **Passwortänderung/E-Mail-Änderungstokens:** ein offener
   `user_email_change_requests`-Eintrag wird gelöscht (Abschnitt 7.14); eine
   zukünftige Passwortänderung ist nicht mehr möglich (Login gesperrt).
6. **Auth-Version:** wird erhöht (identisch zum bestehenden Muster), **zusätzlich**
   zur neuen `lifecycle_status`-Prüfung — zwei unabhängige Sperrmechanismen
   statt einem, bewusst redundant für diese als besonders kritisch
   eingestufte Aktion.
7. **Cookie-Löschung:** die Refresh-/CSRF-Cookies im aufrufenden Browser
   werden wie beim bestehenden Logout explizit über `Set-Cookie` mit
   Ablaufdatum in der Vergangenheit gelöscht, unmittelbar in der
   HTTP-Antwort auf den Löschantrag.
8. **Login mit alter E-Mail:** schlägt fehl — die alte E-Mail existiert im
   `users`-Datensatz nicht mehr (überschrieben), ein Login-Versuch verhält
   sich identisch zu „unbekanntes Konto" (derselbe Dummy-Hash-Pfad,
   Enumeration-Schutz bleibt gewahrt).
9. **Login mit anonymisierter E-Mail:** ist nicht möglich, ohne den
   internen Zufallswert zu kennen — der Platzhalter wird nie
   kommuniziert; selbst bei Kenntnis schlägt Login zusätzlich an der
   `lifecycle_status`-Prüfung fehl.
10. **Bereits ausgestellte Tokens nach Abschluss:** garantiert ungültig durch
    die Kombination aus (a) sofortigem Sitzungswiderruf, (b)
    `auth_version`-Erhöhung, (c) neuer `lifecycle_status`-Prüfung — drei
    unabhängige, sich überlappende Sperren.

**Erforderliche Eigenschaft (erfüllt durch das Vorstehende):** Nach
erfolgreicher Kontolöschung ermöglicht kein bestehendes Token mehr Zugriff.

---

## 15. API-Entwurf

**Nicht implementiert — reiner Vertragsentwurf für eine spätere Phase.**
Mount-Punkt konsistent mit dem bestehenden `/api/account/*`-Router
(`accountRouter.js`, Abschnitt 2 der Recherche), nicht unter `/api/v1`
(folgt der bestehenden Konvention: Konto-Selbstverwaltung ist unversioniert
und global, nicht studio-spezifisch).

### 15.1 `GET /api/account/deletion-preview` — ERWEITERT (Blocker 6)

Liefert dem Benutzer vor der Bestätigung eine Vorschau, **ohne** etwas zu
verändern. **Preview und Execute teilen sich dieselbe serverseitige
Planungsfunktion** — entworfen als `planAccountDeletion(connection, userId)`
(Abschnitt 18.1) —, sodass die angezeigte Vorschau nie von der tatsächlichen
Ausführung abweichen kann: Beide Endpunkte rufen exakt dieselbe Funktion für
Blocker-Erkennung und Auswirkungs-Zählung auf; der einzige Unterschied ist,
dass die Preview sie schreibgeschützt (ohne `FOR UPDATE`) und die Ausführung
sie als ersten Teil der mutierenden Transaktion (mit `FOR UPDATE`) aufruft.

```
Auth: erforderlich (bestehende authenticate-Middleware)
Rate-Limit: keiner nötig (rein lesend, kein destruktiver Nebeneffekt)

200 OK
{
  "deletionPreview": {
    "studios": [
      { "studioId": "<public_id>", "studioName": "…", "role": "owner"|"admin"|"trainer"|"member",
        "isSoleActiveOwner": true|false }
    ],
    "blockers": [
      { "code": "ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED", "studioIds": ["…"] }
    ],
    "impact": {
      "runningWorkoutSessions": 1,
      "activeAssignments": 2,
      "activeCoachingRelationships": 1,
      "activeScheduleRules": 3,
      "futurePersonalCalendarEntries": 4,
      "futureStudioCalendarEntries": 6
    },
    "personalDataCounts": { "workouts": 12, "progressEntries": 48, "personalExercises": 3 },
    "preservedHistoryCounts": { "studioWorkoutSessions": 20, "programAssignments": 4,
                                  "coachFeedbackReceived": 6, "coachFeedbackAuthored": 0 },
    "activeSessionCount": 2,
    "notices": {
      "freeTextRetention": "Free-text notes and coach feedback tied to your historical training
                             records are not deleted or altered — only your account's own name and
                             e-mail address become unidentifiable. See Abschnitt 13.1.",
      "backupRetention": "Encrypted backups created before this request may retain your data
                          for up to the documented retention window; see Abschnitt 20."
    }
  }
}
```

`impact` ist neu (Blocker 6) und macht alle in Abschnitt 12 tabellierten
Auswirkungen für den Benutzer sichtbar, **bevor** er bestätigt — nicht nur
harte Blocker, sondern auch nicht-blockierende, aber wirksame Änderungen
(Session-Abbruch, Zuweisungs-/Regel-Terminalisierung, Kalender-Stornierung).
`notices.freeTextRetention` ist neu (Blocker 4) und macht die in Abschnitt
13.1 festgelegte, ehrliche Freitext-Policy für den Benutzer transparent,
statt sie zu verschweigen. Keine internen IDs (Auto-Increment-`id`), keine
SQL-Details, keine Daten Dritter (z. B. keine Namen von Mitgliedern, denen
ein zu löschender Coach Feedback gab).

### 15.2 `POST /api/account/deletion-request`

```
Auth: erforderlich
Rate-Limit: neue Policy "account.deleteRequest" (Vorschlag: 3 Versuche / 60 Min,
            geschlüsselt per Nutzer-ID — analog zu account.passwordChange,
            grosszügiger bemessen, da ein Fehlversuch durch Blocker-Analyse
            legitim mehrfach vorkommen kann)
Body: {
  "currentPassword": "…",
  "confirmationPhrase": "<exakter Benutzername>"
}

Erfolgsfall: 200 OK, sofortiger Abschluss (kein zweistufiger, verzögerter
Ablauf — Begründung Abschnitt 9/23), Antwort:
{ "accountDeletion": { "completedAt": "…", "studiosAffected": <n> } }
plus Cookie-Löschung wie in Abschnitt 14. Serverseitig läuft nach dem
`COMMIT` zusätzlich die Erzeugung des externen Deletion Receipts
(Abschnitt 18.3, 21) — ein Fehlschlag **dieses** Schritts allein lässt die
HTTP-Antwort nicht scheitern (die Löschung selbst ist bereits wirksam),
löst aber ein gesondertes, lautes Fehler-Log aus.

Fehlerfälle:
401 CURRENT_PASSWORD_INVALID          (bestehender Fehlercode, wiederverwendet)
400 ACCOUNT_DELETION_PHRASE_MISMATCH  (neu, analog PASSWORD_CONFIRMATION_MISMATCH)
409 ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED  (Abschnitt 11.6, mit `fields.studios`)
409 ACCOUNT_ALREADY_DELETED           (neu — zweiter Aufruf auf ein bereits
                                        `deleted`-Konto; praktisch nie erreichbar,
                                        da Login/Auth bereits vorher scheitert,
                                        aber definiert für Idempotenz-Klarheit)
```

**Zweistufig vs. sofort:** Sofortige, bestätigte Ausführung (kein
Zwei-Phasen-Ablauf mit Wartezeit) — siehe Abschnitt 23 für die vollständige
Begründung; zusammengefasst: ein verzögerter Ablauf würde eine
wiederkehrende Hintergrundaufgabe (Scheduler/Queue) erfordern, die im
gesamten Projekt heute nicht existiert und laut
`FITTRACK_NEXT_PHASE_RECOMMENDATION.md` explizit ausserhalb jeden Scopes
liegt („wiederkehrende Jobs" ist dort namentlich als Nicht-Ziel gelistet).

### 15.3 Studio Membership Removal

**Bestehenden Endpunkt erweitern, keinen neuen Vertrag nötig.**
`PATCH /api/v1/studios/:studioId/memberships/:membershipId {status:'left'}`
bleibt für den Owner/Admin-Pfad exakt wie heute. Einzige Änderung (Entwurf,
Abschnitt 6.4): `membershipChangeDecision()` erlaubt zusätzlich
`sameUser && changes.status === 'left'` unabhängig von `actor.role`.
Methode, Pfad, Statuscodes, Fehlercodes bleiben identisch zum Bestand;
Konkurrenzverhalten bereits durch das bestehende `FOR UPDATE` auf
`studio_memberships`/`studio_memberships (owner count)` abgedeckt.
Revisions-Feld nicht nötig (Mitgliedschaften tragen keine `revision`-Spalte,
Konflikt wird bereits heute durch `FOR UPDATE` seriealisiert). Ein neues
Audit-Ereignis `membership.removed` ergänzt (nicht ersetzt) die bestehenden
`membership.suspended`/`membership.reactivated`/`membership.left` –
Auswertung: da `left` bereits ein bestehender Zielstatus mit eigenem
Audit-Event (`membership.left`) ist, wird **kein neues Ereignis** benötigt,
wenn die Selbstentfernung denselben Statuswert nutzt — die bestehende
`membershipChangeAuditEvents()`-Zuordnung deckt das automatisch ab.

### 15.4 Konkurrenzverhalten (übergreifend)

Ein zweiter, paralleler Löschversuch auf dasselbe Konto wird durch
`SELECT ... FROM users WHERE id=? FOR UPDATE` am Anfang der Transaktion
serialisiert — der zweite Aufrufer wartet auf die Sperre und sieht danach
entweder das bereits `deleted`-Ergebnis (idempotent, `409
ACCOUNT_ALREADY_DELETED`) oder führt (bei einem Rennen mit einem
zwischenzeitlich neu entstandenen Blocker) die Prüfung erneut korrekt aus.
Ein paralleler Login/Refresh während der Löschung sieht entweder den
Alt-Zustand (Sitzung noch gültig, Löschung noch nicht committet) oder den
Neu-Zustand (Sitzung widerrufen) — nie einen Mischzustand, da beides
dieselbe Transaktion und dieselben Zeilen sperrt.

### 15.5 „Deletion Receipt Doctor“ — NEU (Blocker 1, Betriebswerkzeug)

Kein Benutzer-API-Endpunkt, sondern ein Betriebs-/Operator-Werkzeug (Entwurf,
analog zu `npm run db:migrate:doctor`, s. Abschnitt 21.3): ein
schreibgeschützter Konsistenz-Check, der bei jedem Anwendungsstart **und**
zwingend nach jedem Restore läuft, und in beide Richtungen prüft:

1. Jede `users`-Zeile mit `lifecycle_status='deleted'`, für die **kein**
   gültiges Deletion Receipt existiert → Receipt aus der bereits
   anonymisierten Zeile selbst deterministisch neu erzeugen (Absturz-
   Wiederherstellung, Abschnitt 18.3) — unkritisch, da die Zeile schon
   korrekt anonymisiert ist.
2. Jedes gültige Deletion Receipt, dessen `accountRef` auf eine `users`-Zeile
   mit `lifecycle_status='active'` zeigt → Inkonsistenz (ein Restore hat
   einen Vor-Löschungs-Stand zurückgebracht) → Löschtransaktion erneut,
   idempotent, gegen diese Zeile ausführen (Reconciliation, Abschnitt 21.2).
3. Jedes Receipt, dessen Integritätsprüfung (HMAC) fehlschlägt → **fail-closed**,
   kein automatisches Verhalten, Anwendung meldet sich nicht als `ready`
   (Erweiterung des bestehenden `/api/health/ready`-Verhaltens, das schon
   heute Migrationsstatus mitprüft), manuelle Untersuchung zwingend
   erforderlich (Abschnitt 21.4).

---

## 16. UI-Entwurf

**Nicht implementiert — reiner Entwurf.**

### 16.1 Profil — Danger Zone

Neuer Abschnitt am Ende von `ProfileView.vue`, klar optisch abgesetzt
(Warnfarbe, wie bereits für destruktive Aktionen an anderer Stelle im
Produkt üblich — z. B. „Widerrufen“/„Deaktivieren“-Buttons in
`StudioInvitationsView.vue`/`ScheduleRulesView.vue`). Ablauf:

1. Button „Konto löschen“ öffnet den bestehenden `ConfirmDialog`-Baustein
   (wiederverwendet, kein neuer Dialog-Typ), erweitert um die
   Vorschau-Daten aus 15.1 (betroffene Studios, Blocker, Datenanzahl).
2. Sind Blocker vorhanden (Sole-Owner), wird die Bestätigungsaktion
   **deaktiviert** dargestellt, mit derselben Fehlermeldung wie 11.6 plus
   einem direkten Link zur jeweiligen Studio-Mitgliederseite, um dort einen
   weiteren Owner zu ernennen.
3. Ohne Blocker: Passwortfeld (identisches Muster zu
   `AccountSelfService`/Passwortänderung) plus ein Textfeld „Tippe deinen
   Benutzernamen zur Bestätigung“ — eine **bewusste, punktuelle Abweichung**
   vom sonstigen „ein Klick genügt“-Bestätigungsmuster des Produkts, da
   Kontolöschung die einzige wirklich irreversible, kontoweite Aktion im
   gesamten Produkt ist (im Unterschied zu z. B. „Regel deaktivieren“, das
   jederzeit durch eine neue Regel funktional nachgebildet werden kann).
4. Nach Bestätigung: sofortige Ausführung, Erfolgsmeldung, automatischer
   Logout und Weiterleitung zu `/login` (identisch zum bestehenden
   Logout-Flow).
5. Fokus-Management: Dialog nutzt den bestehenden `useModalFocus()`-Baustein
   (Fokus-Trap, Escape schliesst, Fokus kehrt zum auslösenden Button
   zurück) — keine neue Accessibility-Logik nötig.
6. DE/EN: neue Schlüssel unter einem neuen `profile.dangerZone.*`-Zweig in
   `utils/i18n.js`, exakt demselben Muster wie alle bestehenden Einträge.

### 16.2 Studio-Mitgliederverwaltung

- Bestehender „Entfernen“-Button (sofern noch nicht vorhanden, sonst
  Erweiterung des bestehenden Rollenwechsel-UI) nutzt denselben
  `ConfirmDialog` wie andere destruktive Studio-Aktionen, mit derselben
  „was bleibt, was ändert sich“-Formulierung wie beim
  Terminierungsregel-Deaktivieren (Stage 5A3-Vorbild, Abschnitt 13 der
  Recherche: „Bereits abgeschlossene Trainings bleiben erhalten…“).
- Klar textlich unterschieden von einer Kontolöschung: „Diese Person wird
  aus diesem Studio entfernt. Ihr FitTrack-Konto und ihre Daten in anderen
  Studios bleiben unverändert.“
- Owner-Schutz: der bestehende `LAST_OWNER_REQUIRED`-Fehler wird identisch
  zum bestehenden Rollenänderungs-Fehlerpfad dargestellt (bereits
  vorhandenes UI-Muster, keine neue Komponente).
- Auswirkungen auf Assignments/Coaching werden **nicht** im Dialog im
  Detail aufgelistet (anders als bei der Kontolöschungs-Preview) — da bei
  reiner Studio-Entfernung nichts davon verändert wird (Abschnitt 6.3), gibt
  es nichts Zusätzliches anzuzeigen ausser dem Statuswechsel selbst.
- Kein manipulatives Dark Pattern: der „Entfernen“/„Löschen“-Button ist
  nie vorausgewählt, nie optisch als primäre Aktion hervorgehoben, nie ohne
  expliziten zweiten Bestätigungsschritt erreichbar.

---

## 17. Audit Events

**Kein neues globales Audit-System.** `studio_audit_events` ist strukturell
studio-gebunden (`studio_id NOT NULL`) — eine globale, studio-übergreifende
Kontolöschung passt dort nur **pro betroffenem Studio**, nicht als ein
einzelnes globales Ereignis.

**Entwurf:**

- Für **jedes** Studio, aus dem eine Mitgliedschaft im Zuge der Löschung
  auf `left` gesetzt wird: ein normales `studio_audit_events`-Ereignis
  `membership.left` (bestehender Typ, keine Erweiterung nötig) mit
  `actor_user_id` = die betroffene Person selbst (Selbstauslösung durch
  Kontolöschung) — konsistent mit dem bestehenden Muster, dass
  `membershipChangeAuditEvents()` bereits pro Statuswechsel ein Ereignis
  erzeugt.
- **Neu (Blocker 2/3):** für jede in derselben Transaktion terminalisierte
  Zeile je ein bereits bestehendes, unverändertes Audit-Ereignis:
  `workout_session.aborted` (pro abgebrochener Session, Abschnitt 7.8),
  `training_program_assignment.cancelled` (pro stornierter Zuweisung,
  Abschnitt 7.5), `assignment.schedule_rule.disabled` (pro deaktivierter
  Regel, Abschnitt 7.6) — alle drei existieren bereits im
  `SAFE_DETAIL_KEYS`-Katalog (`studioAudit.js`), keine Erweiterung des
  Ereigniskatalogs nötig. Kalender-Stornierungen selbst erzeugen bewusst
  **kein** eigenes Ereignis — sie sind eine reine Folge der
  Zuweisungs-/Regel-Terminalisierung, kein eigenständiger fachlicher
  Vorgang, und ein zusätzliches Ereignis pro Kalendertag wäre
  unverhältnismässig granular gegenüber dem bestehenden Ereigniskatalog.
- Für die **globale** Kontolöschung selbst (nicht studio-gebunden): **kein**
  neuer DB-Datensatz. **Revidiert (Blocker 1):** Statt eines reinen
  strukturierten Log-Ereignisses als einzige Quelle entsteht jetzt ein
  externes, integritätsgeschütztes **Deletion Receipt** (Abschnitt 21) —
  die eigentliche, restore-sichere Quelle. Ein strukturiertes Log-Ereignis
  (`event: "account_deletion_completed"`, Felder ausschliesslich
  `{ userId (intern), requestId, studiosAffected }`, **keine** E-Mail,
  **kein** Benutzername) wird zusätzlich weiterhin emittiert — als
  operative Sichtbarkeit/Alarmierung im laufenden Betrieb, **nicht** mehr
  als alleinige Restore-Sicherheitsquelle (die frühere Begründung „ein Log
  allein genügt" war unzureichend, s. Abschnitt 21).
- `account.deletion_blocked` wird **nicht** als Audit-/Log-Ereignis
  benötigt — ein abgelehnter Versuch (Sole-Owner-Blocker) verändert nichts
  und ist über die normale API-Fehlerantwort bereits für den Nutzer selbst
  sichtbar; ein zusätzliches Protokoll dafür wäre Datensparsamkeit
  zuwiderlaufend ohne erkennbaren Nutzen.

**Auditdetails enthalten nie:** E-Mail-Adresse, Benutzername, Passwort,
Token, IP-Adresse, freie Löschbegründung im Klartext, vollständige
Datenkopien — exakt dieselbe Disziplin wie die bestehende
`SAFE_DETAIL_KEYS`-Allowlist (`studioAudit.js:20-54`) bereits für alle
anderen Ereignistypen durchsetzt.

**Referenzierbarkeit nach Selbstlöschung:** Der `actor_user_id`-Fremdschlüssel
auf `studio_audit_events` bleibt technisch gültig (zeigt auf die
anonymisierte `users`-Zeile) — ein Audit-Log-Eintrag „Mitgliedschaft
entfernt, ausgeführt von [anonymisierter Platzhalter]“ bleibt für
Owner/Admin einsehbar und nachvollziehbar, ohne die gelöschte Person zu
identifizieren.

---

## 18. Transaktionsmodell — REVIDIERT (Blocker 1/2/3/5)

### 18.1 Geteilte Planungsfunktion

`planAccountDeletion(connection, userId, { forUpdate })` (Entwurf) kapselt
Schritte 1–4 unten (Laden + Blocker-Erkennung + Auswirkungs-Zählung) als
**eine** Funktion, die sowohl von `GET .../deletion-preview` (`forUpdate:
false`, keine Sperren, nur lesen) als auch von `POST .../deletion-request`
(`forUpdate: true`, Sperren wie unten) aufgerufen wird — siehe Abschnitt
15.1/15.2. Dies ist die Antwort auf Blocker 6: Es gibt keinen zweiten,
unabhängig gepflegten Codepfad, der von der Vorschau abweichen könnte.

### 18.2 Vollständige Sperr- und Mutationsreihenfolge (17 Schritte)

```
BEGIN
  1. SELECT users WHERE id=? FOR UPDATE
  2. Lifecycle-Zustand prüfen
     -> wenn lifecycle_status='deleted': ROLLBACK (no-op), 409 ACCOUNT_ALREADY_DELETED
  3. SELECT alle studio_memberships WHERE user_id=? FOR UPDATE
     (sperrt zugleich implizit gegen einen parallelen zweiten
      Löschversuch, der dieselben Zeilen anfassen würde)
  4. Sole-Owner-Prüfung (Abschnitt 11) über die geladenen Mitgliedschaften
     + je Studio ein SELECT active_owner_count ... FOR UPDATE
     -> bei Blocker: ROLLBACK, 409 ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED
     (Passwort-/Bestätigungsphrasen-Prüfung erfolgt bereits vor
     Transaktionsbeginn, kein DB-Zugriff nötig — Reihenfolge:
     Validierung vor Sperren, um Sperrzeit zu minimieren)
  5. Laufende Workout-Sessions (member_membership_id ∈ Konto, status='in_progress')
     sperren (FOR UPDATE) und atomar auf status='aborted', aborted_at=NOW()
     setzen (Blocker 2, Abschnitt 7.8) — löst den bestehenden
     IN_PROGRESS→PLANNED-Kalender-Integrationseffekt aus
  6. Assignments terminalisieren: UPDATE studio_program_assignments
     SET status='cancelled', cancelled_at=NOW()
     WHERE member_membership_id ∈ Konto AND status='active'
     (Blocker 3, Abschnitt 7.5 — NICHT für Zuweisungen, die das Konto nur
     als Trainer:in für andere erstellt hat)
  7. Coaching Relationships beenden: UPDATE studio_coaching_relationships
     SET status='ended', ended_at=NOW()
     WHERE (coach_membership_id ∈ Konto OR member_membership_id ∈ Konto)
       AND status='active'
  8. Schedule Rules deaktivieren: UPDATE studio_assignment_schedule_rules
     SET status='disabled'
     WHERE created_by_user_id=? AND status='active'
     (Blocker 3, Abschnitt 7.6 — nach Ersteller:in gescopt, nicht nach
     Mitglied)
  9. Zukünftige Calendar Entries behandeln:
     9a. UPDATE training_calendar_entries SET status='CANCELLED'
         WHERE user_id=? AND source_type='studio' AND status='PLANNED'
         (erfasst auch die durch Schritt 5 von IN_PROGRESS auf PLANNED
         zurückgefallenen Einträge, da diese Abfrage NACH Schritt 5 läuft)
     9b. DELETE FROM training_calendar_entries
         WHERE user_id=? AND source_type='personal'
 10. Persönliche Daten löschen:
     DELETE FROM progress_entries WHERE user_id=?
     DELETE FROM workouts WHERE user_id=?  (workout_exercises kaskadiert)
 11. Auth Sessions und E-Mail-Änderungen löschen/widerrufen:
     DELETE FROM user_email_change_requests WHERE user_id=?
     revokeAllSessionsInTransaction(connection, userId, 'account_deletion')
     (bestehende Funktion, Abschnitt 14)
 12. Direkte Account-Identifikatoren anonymisieren:
     UPDATE users SET
       lifecycle_status='deleted', deleted_at=NOW(),
       username=<neuer Zufallsplatzhalter>,
       email=<neuer Zufallsplatzhalter>,
       password_hash=<neuer, nie kommunizierter Zufallshash>
     WHERE id=? AND lifecycle_status='active'
     -- WHERE-Klausel als zusätzliche CAS-Absicherung gegen ein Rennen,
        das Schritt 1 theoretisch überholt haben könnte
 13. auth_version erhöhen: Teil derselben UPDATE-Anweisung wie Schritt 12
     (auth_version = auth_version + 1) — kein separater Schritt nötig,
     hier nur zur expliziten Nachvollziehbarkeit gegenüber dem Auftrag
     eigens aufgeführt
 14. Audit Events erzeugen (Abschnitt 17): je ein 'membership.left' pro
     Studio, 'workout_session.aborted' pro Schritt-5-Session,
     'training_program_assignment.cancelled' pro Schritt-6-Zuweisung,
     'assignment.schedule_rule.disabled' pro Schritt-8-Regel
 15. Deletion Receipt vorbereiten (NICHT schreiben): receiptId (neue UUID),
     accountRef=users.id, lifecycleAction='deleted', deletedAt=NOW() werden
     bereits jetzt als in-memory-Werte festgelegt (deterministisch,
     unabhängig vom Transaktionsausgang danach) — siehe Abschnitt 18.3
COMMIT
 16. (nach erfolgreichem COMMIT) strukturiertes Log-Ereignis
     account_deletion_completed emittieren (Abschnitt 17) — nie davor
 17. Externes Deletion Receipt atomar finalisieren (Abschnitt 18.3, 21) —
     bestes Bemühen, mit Selbstheilung bei Fehlschlag
```

### 18.3 Cross-Resource-Ausfallsicherheit: DB-Transaktion und externes Receipt sind KEINE gemeinsame atomare Ressource — NEU (Blocker 1/7)

Die Datenbanktransaktion (Schritte 1–13) und das externe Deletion-Receipt-
Dateisystem (Schritt 17) sind zwei getrennte Ressourcen ohne
Zwei-Phasen-Commit zwischen ihnen. **Dieses Dokument behauptet an keiner
Stelle vollständige Atomizität über beide Ressourcen hinweg** — stattdessen
wird das Problem durch eine Eigenschaft der Daten selbst gelöst, nicht durch
verteilte Transaktionslogik:

- **Der Receipt-Inhalt ist eine reine, deterministische Funktion des
  bereits committeten `users`-Zustands** (`accountRef=users.id`,
  `deletedAt=users.deleted_at`) — er enthält keine Information, die nicht
  auch aus der anonymisierten Zeile selbst rekonstruierbar wäre.
- **Absturzfenster A — Absturz zwischen COMMIT (Schritt 13) und
  Receipt-Schreiben (Schritt 17):** Zu diesem Zeitpunkt ist die Löschung
  bereits vollständig und korrekt wirksam (die `users`-Zeile ist bereits
  anonymisiert) — nur das externe Receipt fehlt noch. **Selbstheilung:**
  Der „Deletion Receipt Doctor" (Abschnitt 15.5/21.3), der bei jedem
  Anwendungsstart läuft, erkennt jede `lifecycle_status='deleted'`-Zeile
  ohne zugehöriges Receipt und **erzeugt das fehlende Receipt aus dem
  bereits korrekten DB-Zustand neu** — unkritisch, da keine Deletion
  erneut ausgeführt werden muss, nur ihre externe Bestätigung nachgeholt
  wird.
- **Absturzfenster B — Restore eines Backups von vor der Löschung:** Hier
  hilft Fenster-A-Selbstheilung **nicht**, weil die `users`-Zeile nach dem
  Restore wieder `active` zeigt. Dies ist der eigentliche Fall, für den das
  externe Receipt überhaupt existiert — siehe Abschnitt 21 (Reconciliation:
  Receipt vorhanden, aber DB zeigt `active` → Löschung erneut ausführen).
- **Wenn das synchrone Receipt-Schreiben in Schritt 17 fehlschlägt** (z. B.
  Datenträger voll), **schlägt die HTTP-Antwort an den Benutzer NICHT
  fehl** — die Löschung ist bereits wirksam und korrekt; stattdessen wird
  ein gesondertes, hochprioritäres Fehler-Log emittiert (`event:
  "account_deletion_receipt_write_failed"`), das einen Operator zum
  manuellen Ausführen des Deletion Receipt Doctor auffordert, statt auf den
  nächsten normalen Anwendungsstart zu warten.

**Sperrreihenfolge (unverändert von der Vorgängerfassung):** `users`-Zeile
zuerst, dann `studio_memberships`-Zeilen, dann pro Studio die
Owner-Zähl-Abfrage, dann `studio_workout_sessions` — exakt dieselbe
Grundreihenfolge, die `updateMembership()` bereits heute für die
Einzel-Studio-Variante verwendet (Abschnitt 6.1), hier über alle Studios
und zusätzlich über laufende Sessions des Kontos hinweg erweitert. Dies
vermeidet die Art von Lock-Order-Deadlock, die in Stage 3B2/4A bereits
einmal real auftrat und behoben wurde.

**Kein Teilzustand innerhalb der DB-Transaktion möglich:** Jeder Fehler in
Schritt 3–15 führt zu einem vollständigen `ROLLBACK`. Ein paralleler
zweiter Löschaufruf wartet in Schritt 1 auf die `FOR UPDATE`-Sperre und
sieht danach entweder den bereits abgeschlossenen Zustand (No-op) oder —
falls der erste Versuch zurückgerollt wurde — den unveränderten
Ausgangszustand. Eine parallele Workout-Mutation auf eine der betroffenen
`member_membership_id`-Zeilen wird durch die bestehende Zeilensperrung auf
`studio_workout_sessions`/`studio_program_assignments` serialisiert
(bestehendes `revision`-CAS-Muster bzw. `FOR UPDATE` bleibt unverändert
wirksam). Eine parallele Studio-Rollenänderung wird durch dieselbe
`studio_memberships FOR UPDATE`-Sperre serialisiert wie zwei konkurrierende
`updateMembership()`-Aufrufe es heute bereits sind.

---

## 19. Migration-013-Entwurf — REVIDIERT (Blocker 5)

**Nicht erstellt — reiner Entwurf für eine spätere Implementierungsphase.**
Bevorzugt das kleinste belastbare Schema: **eine** Tabellenänderung, **keine**
neue Tabelle.

**Kritische Prüfung von `deletion_reason` (Auftrag Abschnitt 5):** Die
ursprüngliche Fassung sah eine dritte Spalte `deletion_reason` mit den
Werten `'self_service'`/`'admin_initiated'` vor. Bei kritischer Prüfung:
Diese Phase entwirft **ausschliesslich** den Selbstlöschungs-Ablauf
(Abschnitt 33, Out of Scope: „Eine Admin-/Support-initiierte
Zwangslöschung... wird in dieser Phase nicht entworfen"). Für jede Zeile,
die in dieser Phase je `lifecycle_status='deleted'` erreicht, wäre der Wert
von `deletion_reason` **immer und ausschliesslich** `'self_service'` — eine
Spalte, die für jede existierende Zeile denselben konstanten Wert trägt,
erfüllt keinen Zweck und ist reine spekulative Vorratsschema-Erweiterung
für ein Feature, das noch nicht entworfen ist. **Entscheidung: entfernt.**
Eine künftige Phase, die tatsächlich eine Admin-/Support-Löschung entwirft,
soll zu diesem Zeitpunkt selbst entscheiden, welche Information sie dafür
tatsächlich braucht (möglicherweise mehr als ein einzelnes Enum-Feld, z. B.
ein Support-Ticket-Verweis) — nicht heute, ohne konkrete Anforderung,
vorweggenommen werden.

| Spalte | Zweck | Typ | Nullable | Default | Index | Constraint | Backfill | Bestehende Daten | Rollback-Risiko | Datenschutzwirkung |
|---|---|---|---|---|---|---|---|---|---|---|
| `users.lifecycle_status` | Unterscheidet aktive von gelöschten Konten | `VARCHAR(16)` | `NOT NULL` | `'active'` | `INDEX idx_users_lifecycle_status (lifecycle_status)` (für künftige Bereinigungs-/Reporting-Abfragen, auch vom Deletion Receipt Doctor genutzt, Abschnitt 15.5) | `CHECK (lifecycle_status IN ('active','deleted'))` | alle bestehenden Zeilen erhalten automatisch `'active'` über den Spalten-Default, kein UPDATE nötig | unverändert (Default deckt alle ab) | gering — additive Spalte, kein bestehender Code liest sie, Entfernen in einem Rollback ist verlustfrei möglich, solange keine Zeile bereits `'deleted'` trägt | keine (Statuswert selbst ist kein Personenbezug) |
| `users.deleted_at` | Zeitpunkt der Löschung, für Retention-Reporting **und** als Inhalt des externen Deletion Receipts (Abschnitt 21) | `TIMESTAMP(3)` | `NULL` | kein Default | kein eigener Index nötig (immer in Kombination mit `lifecycle_status` abgefragt) | `CHECK ((lifecycle_status='deleted' AND deleted_at IS NOT NULL) OR (lifecycle_status='active' AND deleted_at IS NULL))` — exakt demselben Muster wie die bestehenden `chk_*_completed_at`-Constraints (z. B. Migration 007) folgend | `NULL` für alle bestehenden Zeilen | unverändert | gering | gering (Zeitstempel allein re-identifiziert niemanden) |

**Zusätzlich (kein Schema, reine Code-Konvention):** die bestehende
`CHECK`-Wertemenge auf `user_auth_sessions.revocation_reason` müsste um den
Wert `account_deletion` erweitert werden (`ALTER TABLE ... DROP CHECK ...,
ADD CONSTRAINT ... CHECK (revocation_reason IN (…, 'account_deletion'))`) —
dies gehört technisch ebenfalls in Migration 013, ist aber keine neue
Spalte, sondern eine Erweiterung einer bestehenden Wertemenge.

**Bewusst nicht vorgeschlagen:** keine neue `account_deletion_receipts`-
oder Retention-Ledger-**Datenbanktabelle** — das externe Deletion Receipt
(Abschnitt 21) ist bewusst **kein** Datenbankobjekt, sondern eine Datei
ausserhalb der Datenbank, gerade weil ein DB-internes Ledger dem
Restore-Problem nicht standhält (Abschnitt 21.1); keine neue Spalte auf
`studio_memberships` (`left`-Status und bestehendes `updated_at` genügen,
Abschnitt 6.5); kein neuer Statuswert auf irgendeiner anderen Tabelle
ausser den bereits bestehenden, wiederverwendeten Übergängen
(`studio_program_assignments.status='cancelled'`,
`studio_assignment_schedule_rules.status='disabled'`,
`training_calendar_entries.status='CANCELLED'`,
`studio_workout_sessions.status='aborted'` — alle vier existieren bereits
heute).

**Rollback-Gesamtrisiko:** gering. Beide neuen Spalten sind additiv mit
Default/`NULL`, keine bestehende Abfrage liest sie vor der eigentlichen
Implementierung. Ein Rollback dieser Migration wäre nur dann riskant, wenn
zwischen ihrer Anwendung und einem Rollback bereits ein echtes
`lifecycle_status='deleted'`-Konto entstanden wäre — dieses Risiko besteht
identisch zu jeder anderen Migration, die neue, bereits genutzte Spalten
einführt, und ist kein Spezifikum dieses Entwurfs.

---

## 20. Backup-Retention

Bestehende Fakten (`docs/BACKUP_RESTORE.md`, ungeändert durch dieses
Design): verschlüsselte `.ftbackup`-Dateien folgen einer GFS-Rotation
(Generationen-Prinzip: mehrere tägliche, mehrere wöchentliche, einige
monatliche Generationen plus stets die jüngste Sicherung) — die exakte
Anzahl der Generationen ist Betriebskonfiguration, nicht Gegenstand dieses
Designs. Zentral für diese Phase:

- **Bestehende Backups werden durch eine Kontolöschung nicht rückwirkend
  verändert.** Es gibt keinen Mechanismus (und dieses Design schlägt keinen
  vor), bereits erstellte `.ftbackup`-Dateien nachträglich zu durchsuchen
  und einzelne Personendaten daraus zu entfernen — das widerspräche dem
  authentifizierten, integritätsgeschützten Containerformat (jede
  nachträgliche Veränderung würde die AES-256-GCM-Authentifizierung
  brechen und das Backup als Ganzes unbrauchbar machen).
- **Gelöschte Daten können bis zum Ablauf der Backup-Retention in
  verschlüsselten Backups enthalten sein.** Dies ist eine reale, im
  Pilot-Consent zu kommunizierende Tatsache, keine Design-Lücke — sie ist
  aus dem GFS-Prinzip selbst inhärent unvermeidbar, ohne die
  Wiederherstellbarkeit älterer Backups komplett aufzugeben.
- **Restore kann alte Daten technisch wieder einführen.** Siehe Abschnitt 21
  — **REVIDIERT (Blocker 1):** ein reines strukturiertes Log genügt dafür
  **nicht** als alleinige Quelle (Begründung unten); die tatsächliche
  Lösung ist das externe Deletion Receipt.

---

## 21. Restore-Reconciliation — VOLLSTÄNDIG NEU (Blocker 1)

### 21.0 Warum ein reines strukturiertes Log nicht genügt

Die ursprüngliche Fassung dieses Dokuments schlug vor, ein strukturiertes
Log-Ereignis als alleinige Restore-Sicherheitsquelle zu verwenden. Das ist
unzureichend, aus genau den Gründen, die der Auftrag benennt:

- **Nicht transaktional:** ein Log-Schreibvorgang ist nicht an den
  Datenbank-Commit gekoppelt — es gibt kein eingebautes Verfahren, das
  beide Ressourcen atomar zusammenhält.
- **Möglicherweise abgelaufen:** Log-Retention (Abschnitt 22, empfohlen
  30–90 Tage) ist typischerweise **kürzer** als Backup-Retention (GFS mit
  monatlichen Generationen) — ein Log-Ereignis kann längst rotiert/gelöscht
  sein, während das zugehörige, viel ältere Backup noch existiert und
  restauriert werden könnte.
- **Möglicherweise unvollständig:** Logging-Infrastruktur ist typischerweise
  auf Durchsatz/Verfügbarkeit optimiert, nicht auf garantierte Zustellung
  (z. B. gepufferte Log-Shipper, die bei einem Absturz Zeilen verlieren
  können).
- **Nicht garantiert nach Restore verfügbar:** ein Log-System ist oft eine
  eigene, separate Infrastruktur mit eigenem Backup-/Verfügbarkeitsmodell
  — es gibt keine bestehende Garantie, dass es zum Zeitpunkt einer
  Datenbank-Wiederherstellung überhaupt erreichbar oder konsistent ist.
- **Ungeeignet als alleinige Quelle für irreversible Löschungen:** die
  Konsequenz eines fehlenden/verlorenen Log-Eintrags wäre, dass eine
  bereits gelöschte Person nach einem Restore dauerhaft reaktiviert bleibt,
  ohne dass irgendein Mechanismus das je erkennt.

### 21.1 Bewertung der vier vorgeschlagenen Optionen

- **A — separate Deletion-Receipt-Datei ausserhalb des Repositorys und
  ausserhalb des Backup-Verzeichnisses:** Einfach, keine neue
  Infrastruktur (kein neuer Serverprozess, keine neue Datenbank), durch
  freie Verzeichniswahl trivial vom DB-Backup-Zyklus entkoppelbar, für
  einen lokalen Piloten (wenige Löschungen, kleine Dateien) uneingeschränkt
  praktikabel.
- **B — separate operative Deletion-Ledger-Datenbank:** Verworfen. Eine
  zweite Datenbank ist echte neue Infrastruktur (Installation, Konfiguration,
  eigener Betrieb) — unverhältnismässig für einen lokalen Piloten. Ausserdem
  löst sie das Grundproblem nicht wirklich: eine zweite Datenbank braucht
  **ihrerseits** eine Backup-/Restore-Strategie, und ohne besondere Sorgfalt
  entsteht exakt dasselbe Restore-Kopplungsproblem eine Ebene tiefer.
- **C — append-only/signierte Receipts:** Keine eigenständige
  Speicherort-Alternative, sondern eine **Eigenschaft**, die auf Option A
  angewendet wird (siehe unten: eine Datei pro Ereignis, einmal geschrieben,
  nie verändert, mit Integritätsschutz).
- **D — Kombination aus DB-Status und externem Receipt:** **Gewählt.**
  `users.lifecycle_status` bleibt die schnelle, transaktionale Quelle für
  den laufenden Betrieb (Login, Auth-Middleware, Abschnitt 10/14) — das
  externe Receipt ist **kein Ersatz** dafür, sondern eine zusätzliche,
  restore-unabhängige Bestätigung, die ausschliesslich für die
  Reconciliation nach einem Restore konsultiert wird.

**Designentscheidung: D, umgesetzt mit den Speichermechaniken aus A und den
Integritätseigenschaften aus C.**

### 21.2 Deletion-Receipt-Format

Eine Datei pro Löschereignis (Entwurf, JSON, einmal geschrieben, nie
verändert):

```json
{
  “schemaVersion”: 1,
  “receiptId”: “<UUID v4, frisch pro Receipt erzeugt>”,
  “accountRef”: <interne users.id, Ganzzahl>,
  “lifecycleAction”: “deleted”,
  “deletedAt”: “<ISO-8601 UTC, identisch zu users.deleted_at>”,
  “integrity”: {
    “algorithm”: “HMAC-SHA256”,
    “keyId”: “<Schlüssel-Kennung, analog zur bestehenden
               BACKUP_ENCRYPTION_KEY_ID-Konvention>”,
    “signature”: “<Hex, HMAC über die kanonische JSON-Repräsentation
                   der obigen Felder>”
  }
}
```

- **Receipt-ID:** frische, zufällige UUID v4 — dient ausschliesslich der
  Dateibenennung/Eindeutigkeit, nicht der Zuordnung.
- **Pseudonyme Account-Referenz (`accountRef`):** die interne, ohnehin
  niemals extern über die API exponierte `users.id` — bewusst **kein**
  neuer öffentlicher Identifikator. Sie ist die einzige stabile, in jedem
  Backup/Restore unveränderte Grösse, gegen die eine Reconciliation
  matchen kann; sie ist kein „direkter Identifikator” im Sinne des
  Auftrags (keine E-Mail, kein Benutzername) und für sich genommen ohne
  Datenbankzugriff bedeutungslos — genau wie jede andere interne
  Fremdschlüsselreferenz in diesem Schema bereits heute.
- **Löschzeitpunkt:** identisch zu `users.deleted_at`.
- **Lifecycle-Aktion:** `'deleted'` (durch die Löschtransaktion) oder
  `'reconciliation_reapplied'` (durch den Deletion Receipt Doctor bei einer
  erneuten Anwendung nach einem Restore, Abschnitt 21.3) — letzteres macht
  den Reconciliation-Vorgang selbst nachvollziehbar.
- **Integritätsschutz:** HMAC-SHA256 über die kanonische (schlüsselsortierte)
  JSON-Repräsentation der Inhaltsfelder, mit einem dedizierten Schlüssel
  (`DELETION_RECEIPT_HMAC_KEY`, analog zur bestehenden Konvention, dass
  `RATE_LIMIT_KEY_SECRET` nie `JWT_SECRET` wiederverwendet — auch dieser
  Schlüssel darf keinen anderen Zweck teilen). Ein symmetrisches HMAC statt
  einer asymmetrischen Signatur ist für den Bedrohungsrahmen dieser Phase
  (Schutz vor Zufall/Beschädigung/versehentlicher Veränderung, nicht vor
  einem raffinierten Innentäter mit Schlüsselzugriff) proportional und
  ohne neue kryptografische Abhängigkeit umsetzbar — als Restrisiko in
  Abschnitt 29 vermerkt.

### 21.3 Speicherort, Retention, eigenes Backup

- **Speicherort:** ein neues, dediziertes Verzeichnis, konfigurierbar über
  eine neue Umgebungsvariable (Vorschlag: `DELETION_RECEIPT_DIR`, analog zur
  bestehenden `FITTRACK_BACKUP_DIR`-Konvention) — **explizit ausserhalb**
  sowohl des Git-Repositorys als auch von `FITTRACK_BACKUP_DIR`. Für einen
  lokalen Piloten genügt ein einfaches lokales Verzeichnis auf demselben
  Host, aber ausserhalb des Datenbank-Backup-Pfads.
- **Retention:** Receipts werden **nicht** vor Ablauf der längsten
  bestehenden Backup-Retention-Generation gelöscht — praktikabel, da jede
  Datei nur wenige hundert Byte umfasst; einfachste sichere Policy:
  Receipts werden gar nicht aktiv gelöscht (unbegrenzte Aufbewahrung).
- **Backup des Receipt-Speicherorts selbst:** **muss unabhängig** von der
  Datenbank-Backup-Pipeline erfolgen — würde man Receipts in denselben
  `.ftbackup`-Zyklus einschliessen, entstünde exakt dasselbe
  Restore-Kopplungsproblem, das dieser Mechanismus lösen soll. Für den
  Piloten genügt eine einfache, unabhängige Kopie/Synchronisation an einen
  zweiten Ort; für Produktion: Replikation über denselben S3-kompatiblen
  Mechanismus wie Stage 2B2A, aber unter einem separaten Prefix/Ziel,
  entkoppelt vom DB-Backup-Zeitplan.
- **Produktionsübertragbarkeit:** identischer Mechanismus, zusätzlich mit
  Schlüsselverwaltung/-rotation nach demselben Muster wie
  `BACKUP_ENCRYPTION_KEY_B64`/`_KEY_ID`.

### 21.4 Restore-Reconciliation-Ablauf (Runbook-Entwurf, analog zur
Struktur von `docs/MIGRATION_RECOVERY.md`)

1. Ein Restore erfolgt — wie bereits heute etabliert — nie direkt gegen
   eine produktiv bediente Datenbank, sondern zunächst gegen eine
   disposable Test-/Restore-Datenbank.
2. **Bevor** eine wiederhergestellte Datenbank für den regulären Betrieb
   freigegeben wird, läuft der „Deletion Receipt Doctor” (Abschnitt 15.5)
   — automatisiert **und** als zwingender, dokumentierter Operator-Schritt:
   - Für jedes Receipt: HMAC-Integrität prüfen. **Bei Fehlschlag:
     fail-closed** — Freigabe blockieren, manuelle Untersuchung zwingend
     (Abschnitt 21.5).
   - Für jedes integritätsgeprüfte Receipt mit `lifecycleAction='deleted'`:
     den aktuellen `lifecycle_status` der Zeile mit `id=accountRef` in der
     wiederhergestellten Datenbank lesen.
     - Zeigt sie `'deleted'`: konsistent, nichts zu tun.
     - Zeigt sie `'active'` (der Restore hat einen Vor-Löschungs-Stand
       zurückgebracht): **die vollständige Löschtransaktion (Abschnitt 18)
       erneut, idempotent, gegen diese Zeile ausführen** — dieselbe
       Funktion, kein separater „Reparaturpfad”. Zusätzlich ein neues
       Receipt mit `lifecycleAction='reconciliation_reapplied'` erzeugen.
3. Erst nach vollständiger, fehlerfreier Reconciliation aller betroffenen
   Konten wird die wiederhergestellte Datenbank für den regulären Betrieb
   freigegeben — manueller, dokumentierter Schritt, kein rein
   automatisierter Mechanismus (konsistent mit dem bewusst manuellen
   Charakter von `MIGRATION_RECOVERY.md`).
4. Derselbe Check läuft **zusätzlich bei jedem normalen
   Anwendungsstart** (nicht nur nach einem Restore) als
   Verteidigung-in-der-Tiefe — güngstig, da die Anzahl der Receipts klein
   bleibt, und deckt auch andere Ursachen für eine Inkonsistenz ab, nicht
   nur einen Restore.
5. Ein Restore in eine disposable Test-/Restore-Datenbank, die nie in
   Betrieb genommen wird, benötigt keine Reconciliation.

### 21.5 Verhalten bei fehlendem oder beschädigtem Receipt

- **Fehlendes Receipt für eine bereits `deleted`-Zeile:** kein
  Fail-Closed-Fall in dieser Richtung — die Zeile ist bereits korrekt
  anonymisiert; dies wird als **Warnung** protokolliert („Receipt-Hygiene”-
  Hinweis) und durch Selbstheilung (Abschnitt 18.3, Absturzfenster A)
  automatisch behoben (Receipt wird aus dem bereits korrekten DB-Zustand
  neu erzeugt).
- **Beschädigtes/manipuliertes Receipt (HMAC ungültig):** **fail-closed** —
  die Anwendung meldet sich nicht als betriebsbereit
  (`/api/health/ready`-Erweiterung, analog zum bestehenden
  Migration-Doctor-Verhalten, das schon heute bei Drift/unbekanntem Zustand
  nicht „ready” meldet), bis ein Operator das Receipt manuell untersucht
  hat. Es wird **nie** automatisch gelöscht, ignoriert oder als „wohl in
  Ordnung” angenommen.

### 21.6 Operator-Runbook (Kurzfassung)

1. Restore nie direkt gegen eine produktiv bediente Datenbank.
2. Vor Freigabe: Deletion Receipt Doctor laufen lassen.
3. Jede Inkonsistenz (Receipt sagt gelöscht, DB zeigt aktiv): Löschung
   erneut anwenden (automatisiert durch den Doctor, protokolliert).
4. Jedes beschädigte Receipt: Freigabe stoppen, manuell untersuchen (ggf.
   unbeschädigte Kopie aus der unabhängigen Receipt-Sicherung heranziehen).
5. Erst nach 0 offenen Inkonsistenzen und 0 ungeklärten beschädigten
   Receipts freigeben.

### 21.7 Pilot- und Produktionsanforderungen

- **Pilot:** lokales Verzeichnis ausserhalb von Repository und
  Backup-Pfad genügt; manueller Operator-Schritt akzeptabel; geringes
  Volumen (wenige Löschungen während eines kleinen Piloten) macht dies
  trivial praktikabel.
- **Produktion:** derselbe Mechanismus, zusätzlich: unabhängige Replikation
  des Receipt-Speicherorts, automatisierter Check wird zu einem harten,
  nicht umgehbaren Gate, Schlüsselverwaltung folgt derselben Disziplin wie
  andere Produktionsgeheimnisse.

**Lokale und künftige Remote-Retention:** Dieselbe Reconciliation-Pflicht
gilt unverändert, sobald ein echter Off-host-Bucket (Stage 2B2B, weiterhin
„Deferred until first customer”) angebunden wird — das Runbook ist
retention-Ziel-unabhängig formuliert.

---

## 22. Logs

| Fläche | Mögliche Personendaten | heutige Retention | gewünschte Retention | technisch löschbar | Pilotbedingung | Produktionsbedingung |
|---|---|---|---|---|---|---|
| Backend-Logs | Nein (Redaktion bereits vorhanden) | betreiberabhängig | 30–90 Tage empfohlen | Ja (Betriebssache) | keine zusätzliche | Log-Retention-Policy festlegen |
| GitHub Actions | Nein (synthetische CI-Testdaten) | GitHub-Standard | unverändert | betreiberabhängig | keine | Repo-Einstellung vor Produktion prüfen |
| SMTP | Ja (Empfängeradresse, Inhalt) | providerabhängig, ausserhalb FitTracks | unverändert für diese Phase | Nein (extern) | im Consent nennen | Provider-Retention vor Produktion klären |
| Development-Outbox | — | nicht persistent | entfällt | entfällt | keine | keine |
| Browserstorage | Nein (Access-Token nur im Speicher, kein `localStorage` seit Stage 3B2) | flüchtig | unverändert | ja (Browser-Lebenszyklus) | keine | keine |
| Supportexporte | derzeit **nicht existent** (kein Datenexport-Feature, s. `STAGE_3B1_ACCOUNT_SELF_SERVICE.md` „Verbleibende Grenzen“) | — | — | — | keine (Feature existiert nicht) | falls künftig eingeführt: eigene Retention-Policy nötig |
| Screenshots/Traces | nur Testfixture-Daten, nie echte Personen | lokal, nie committet | unverändert | ja | bereits Praxis | keine |

---

## 23. Externe Systeme

Bezogen auf die konkreten, vom Auftrag genannten Flächen — Details bereits
in Abschnitt 4.1/22 tabellarisch erfasst, hier die für die
Designentscheidung zentrale Zusammenfassung:

**Warum sofortige, einstufige Ausführung statt eines verzögerten,
zweistufigen Ablaufs mit Wartezeit:** Ein Zwei-Phasen-Ablauf
(„Löschung angefordert, wird in N Tagen wirksam, in der Zwischenzeit
stornierbar") würde eine wiederkehrende Hintergrundaufgabe (Scheduler,
Cron, Message-Queue) voraussetzen, um die Löschung nach Ablauf der
Wartefrist tatsächlich auszuführen. **Keine solche Infrastruktur existiert
heute irgendwo in FitTrack** — es gibt keinen Job-Runner, keine
Message-Queue, keinen Cron-Mechanismus im Produktcode (nur der
projekteigene Migrations-Runner, der ausschliesslich manuell/CI-getriggert
läuft). `docs/FITTRACK_NEXT_PHASE_RECOMMENDATION.md` listet
„wiederkehrende Jobs“ zudem explizit unter den ohne neue, ausdrückliche
Freigabe ausgeschlossenen Themen. Ein verzögerter Ablauf für Stage 5C würde
diese Grenze verletzen und wäre unverhältnismässig aufwändig relativ zum
Nutzen — die Kombination aus Preview-Bildschirm, Passwortbestätigung und
getippter Bestätigungsphrase (Abschnitt 16.1) bietet bereits ausreichend
Schutz vor einer versehentlichen Löschung, ohne eine neue
Infrastrukturkategorie einzuführen.

---

## 24. Sicherheitsanalyse

| Bedrohung | Analyse | Erforderlicher Schutz |
|---|---|---|
| Benutzer löscht fremdes Konto | Löschendpunkt operiert ausschliesslich auf `req.user.id` aus dem authentifizierten JWT, nimmt **keine** Ziel-ID aus URL/Body entgegen — strukturell unmöglich, ein fremdes Konto zu adressieren | kein zusätzlicher Code nötig, Design selbst schliesst es aus |
| Owner entfernt fremdes Studio-Mitglied ohne Berechtigung | bereits durch bestehende `PERMISSIONS.MEMBERSHIP_MANAGE`-Prüfung abgedeckt, unverändert | bestehender Test-Bestand ausreichend, keine neue Prüfung nötig |
| Trainer entfernt Member | nicht möglich (`MEMBERSHIP_MANAGE` nur `owner`/`admin`) — unverändert durch dieses Design; die vorgeschlagene Selbstentfernungs-Erweiterung (6.4) erlaubt einem Trainer **nur**, sich selbst zu entfernen, nie ein anderes Mitglied | Unit-Test: `membershipChangeDecision({actor: trainer, target: otherMember, ...})` bleibt `MEMBERSHIP_MANAGEMENT_FORBIDDEN` |
| Member entfernt Owner | nicht möglich (Member hat nie `MEMBERSHIP_MANAGE`, die Selbstentfernungs-Erweiterung erlaubt nur `sameUser`) | Unit-Test: Member kann `changes.status='left'` nur auf die eigene Mitgliedschaft anwenden |
| Manipulierte öffentliche IDs | Löschendpunkt akzeptiert keine ID (siehe oben); Mitgliedschafts-Entfernung nutzt bereits die bestehende, geprüfte `membershipPublicId`-Validierung | unverändert |
| Cross-Tenant-Zugriff | Owner-Schutzprüfung (Abschnitt 11) liest ausschliesslich Studios, in denen der **eigene** `user_id` Mitglied ist — kein Zugriff auf fremde Studio-Daten | Integrationstest: Löschung eines Kontos verändert keine Zeile eines Studios, dem es nie angehörte |
| Replay eines Löschrequests | Idempotent durch `lifecycle_status`-Prüfung (Schritt 1 der Transaktion) — ein wiederholter Request nach erfolgreicher Löschung schlägt am Login/Auth ohnehin bereits vorher fehl | Integrationstest: zweiter Aufruf mit demselben (jetzt ungültigen) Token liefert `401 AUTH_SESSION_INVALIDATED` |
| Parallele doppelte Löschung | durch `FOR UPDATE` auf `users` in Schritt 1 serialisiert (Abschnitt 18) | Integrationstest mit zwei echten parallelen Aufrufen (Muster: bestehender `rateLimitMultiInstance`/Einladungs-Resend-Konkurrenztest) |
| Session-Refresh während Löschung | durch dieselbe Transaktion serialisiert; ein Refresh, der die `FOR UPDATE`-Sperre auf `user_auth_sessions` gewinnt, bevor die Löschtransaktion committet, sieht noch eine aktive Sitzung — harmlos, da die Löschung danach ohnehin alle Sitzungen widerruft | Integrationstest: Refresh unmittelbar vor/nach Löschcommit, beide Reihenfolgen korrekt |
| Datenleak in Preview | Preview (15.1) liefert nur eigene Daten und Studio-Namen des Nutzers selbst, keine Daten Dritter (keine Namen anderer Mitglieder) | Unit-Test auf die Preview-Zusammenstellung |
| Enumeration gelöschter Accounts | Login-Verhalten für ein gelöschtes Konto ist identisch zu „unbekanntes Konto“ (derselbe Dummy-Hash-Pfad, dieselbe generische Fehlermeldung) | Integrationstest: Timing/Antwort für gelöschtes vs. nie existierendes Konto ununterscheidbar (Erweiterung des bestehenden Timing-Tests aus Stage 3B2) |
| Login Timing | wird durch die bestehende, bereits gehärtete Dummy-Hash-Logik automatisch mitabgedeckt, keine neue Sonderbehandlung nötig | — |
| Audit-Leak | `SAFE_DETAIL_KEYS`-Allowlist verhindert PII in `membership.left`-Ereignissen unverändert | bestehender Mechanismus ausreichend |
| Log-Leak | rekursive Redaktion (`startup/logger.js`) deckt auch das neue `account_deletion_completed`-Ereignis ab, da es ohnehin nur interne IDs enthält | Unit-Test: Log-Payload enthält nachweislich weder E-Mail noch Benutzername |
| SQL-Fehler während Teilprozess | führt zu vollständigem `ROLLBACK` (Abschnitt 18) — keine Teillöschung möglich | Integrationstest: erzwungener Fehler in Schritt N lässt Schritt N-1 unwirksam werden (Transaktions-Rollback-Test, Muster bereits im Bestand für andere mehrschrittige Services) |
| Restore nach Löschung | **REVIDIERT (Blocker 1):** gelöst über das externe Deletion Receipt + Deletion Receipt Doctor (Abschnitt 21), nicht mehr über ein reines Log | Operative Prüfliste **plus** automatisierter Konsistenz-Check bei jedem Start; Integrationstest: Restore-Simulation (Zeile künstlich auf `active` zurückgesetzt, gültiges Receipt vorhanden) löst korrekte Re-Anwendung der Löschung aus |
| Manipuliertes Deletion Receipt | HMAC-Integritätsprüfung schlägt fehl → fail-closed, kein automatisches Vertrauen (Abschnitt 21.5) | Unit-Test: veränderter Receipt-Inhalt liefert ungültige Signatur; Integrationstest: Deletion Receipt Doctor meldet die Anwendung bei ungültigem Receipt nicht als `ready` |
| Fehlendes Deletion Receipt für ein bereits gelöschtes Konto | Selbstheilung: Receipt wird deterministisch aus dem bereits korrekten DB-Zustand neu erzeugt (Abschnitt 18.3/21.5) — kein Sicherheitsrisiko, da die zugrundeliegende Zeile bereits korrekt anonymisiert ist | Integrationstest: Start ohne vorhandenes Receipt für eine `deleted`-Zeile erzeugt genau ein neues, gültiges Receipt |
| Löschung eines Sole Owners | vollständig blockiert vor jeder Mutation (Abschnitt 11) | Integrationstest: Sole-Owner-Löschversuch verändert **keine** Zeile (verifiziert per Vorher/Nachher-Snapshot) |
| Zu weit gefasste Zuweisungs-/Regel-Terminalisierung (Blocker 3) | Zuweisungs-Cancel ist strikt auf `member_membership_id ∈ Konto` gescopt (nie auf `assigned_by_user_id`); Regel-Disable ist strikt auf `created_by_user_id=Konto` gescopt, unabhängig vom betroffenen Mitglied — beide Scopes bewusst unterschiedlich und in Abschnitt 7.5/7.6 begründet | Integrationstest: Löschung eines Trainer-Kontos verändert **nicht** die Zuweisungen fremder, weiterhin aktiver Mitglieder, deaktiviert aber deren vom Trainer erstellte Terminierungsregeln |
| Unautorisierter Abbruch fremder Sessions über die Löschfunktion | Session-Abbruch ist strikt auf `member_membership_id ∈ Konto` gescopt — strukturell unmöglich, eine fremde Session zu treffen (dieselbe Argumentation wie „Benutzer löscht fremdes Konto" oben) | Integrationstest: Löschung verändert keine Session eines anderen Mitglieds |

---

## 25. Teststrategie

**Nicht implementiert — Entwurf für die spätere Phase.**

### 25.1 Unit

- Lifecycle-Domain: Statusübergang `active→deleted` erlaubt, `deleted→active`
  nicht definiert/nicht vorhanden.
- Anonymisierungs-Funktion: erzeugt nie eine aus E-Mail/Benutzername
  ableitbare Zeichenkette (Eigenschaftstest: Ausgabe unabhängig vom Input);
  erzeugt nie eine Kollision mit einem bestehenden `username`/`email`
  (Retry-Schleife bei einer — praktisch nie eintretenden — Kollision).
- Owner-Blocker-Logik (Erweiterung von `membershipChangeDecision`-Familie
  auf Konto-Ebene): korrekt für 0, 1, mehrere betroffene Studios.
- Statusübergänge für Coaching-Beziehungen/Terminierungsregeln im
  Löschkontext.
- Retention-Klassifikation (Abschnitt 8) als reine Funktion:
  `classifyDeletionStrategy(table) → 'hard_delete'|'anonymize'|'retain_unchanged'`.
- Fehlercodes: jede neue `AppError`-Subklasse liefert den in Abschnitt 15
  spezifizierten `status`/`code`.
- Preview-Mapping: Rohdaten → Preview-DTO ohne interne IDs/Drittdaten,
  inklusive der neuen `impact`/`notices`-Felder (Abschnitt 15.1).
- Audit-Sanitizer: `membership.left`/`workout_session.aborted`/
  `training_program_assignment.cancelled`/`assignment.schedule_rule.disabled`
  im Löschkontext bleiben innerhalb der bestehenden `SAFE_DETAIL_KEYS`.
- Idempotenz: zweiter Aufruf der Löschfunktion auf ein bereits
  `deleted`-Konto ist ein No-op, kein Fehler im Sinne einer
  Datenveränderung.
- **Neu (Blocker 2):** Session-Abbruch-Auswahl trifft nur `in_progress`-
  Sessions des Kontos, lässt `completed`/`aborted` unverändert.
- **Neu (Blocker 3):** Zuweisungs-Terminalisierung trifft nur Zuweisungen
  mit `member_membership_id ∈ Konto`, nie Zuweisungen, die das Konto nur
  für andere erstellt hat; Regel-Deaktivierung trifft nur
  `created_by_user_id = Konto`, unabhängig vom betroffenen Mitglied.
- **Neu (Blocker 1):** Deletion-Receipt-Erzeugung — deterministischer
  Inhalt aus `{accountRef, deletedAt}`; HMAC-Signatur reproduzierbar bei
  gleichem Schlüssel, ungültig bei jeder Inhaltsänderung; Receipt-Doctor-
  Logik für beide Richtungen (fehlendes Receipt selbstheilend,
  Inkonsistenz-Erkennung bei vorhandenem Receipt + `active`-Zeile).

### 25.2 Integration

- Erfolgreiche Kontolöschung (Konto ohne Studio-Bezug — Hard-Delete-Pfad,
  Abschnitt 8.4).
- Erfolgreiche Kontolöschung (Konto mit Studio-Historie —
  Anonymisierungs-Pfad).
- Falsches Passwort → `401 CURRENT_PASSWORD_INVALID`, keine Änderung.
- Falsche Bestätigungsphrase → `400 ACCOUNT_DELETION_PHRASE_MISMATCH`,
  keine Änderung.
- Sole Owner blockiert → `409 ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED`,
  keine Änderung (Vorher/Nachher-Snapshot-Vergleich).
- Mehrerer Owner erlaubt → Löschung erfolgreich, verbleibender Owner
  unverändert aktiv.
- Mehrere Studio-Mitgliedschaften → alle korrekt auf `left`.
- **Laufende Workout-Session (Blocker 2)** → korrekt auf `aborted`,
  `aborted_at` gesetzt, verknüpfte Sätze/Übungen unverändert, verknüpfter
  Kalendereintrag korrekt `IN_PROGRESS→PLANNED→CANCELLED`.
- Aktive Coaching-Beziehung → korrekt auf `ended`.
- **Aktives Assignment des Mitglieds (Blocker 3)** → korrekt auf
  `cancelled`, `cancelled_at` gesetzt.
- **Assignment, das das Konto nur für ein anderes Mitglied erstellt hat
  (Blocker 3)** → bleibt **unverändert** `active` (Negativtest).
- **Schedule Rules, vom Konto erstellt (Blocker 3)** → korrekt auf
  `disabled`, unabhängig vom betroffenen Mitglied.
- **Zukünftige Calendar Entries (Studio, `PLANNED`, Blocker 3)** → korrekt
  auf `CANCELLED`.
- **Zukünftige Calendar Entries (Studio, bereits `COMPLETED`/`SKIPPED`)** →
  bleiben unverändert (Negativtest).
- Zukünftige Calendar Entries (persönlich) → werden gelöscht.
- Persönliche Daten (`workouts`/`progress_entries`/`exercises`) → korrekt
  gelöscht/`SET NULL`.
- **Abgeschlossene Historie (Sessions/Sets/Exercises, Blocker 4)** → Werte
  **und** `member_note` bleiben vollständig unverändert (Negativtest: kein
  Feld wird geleert/überschrieben).
- Feedback → `body` unverändert, Autorenbezug nur indirekt entpersonalisiert.
- Auth Sessions → alle widerrufen, `auth_version` erhöht.
- E-Mail-Änderung (offen zum Löschzeitpunkt) → gelöscht.
- Parallele Löschung (zwei gleichzeitige Aufrufe) → genau eine erfolgreich,
  die zweite idempotent/409.
- Paralleler Refresh während Löschung → beide Reihenfolgen korrekt
  (Abschnitt 24).
- Tenant-Isolation → Löschung eines Kontos verändert nachweislich keine
  Zeile eines fremden Studios.
- Erneute Registrierung mit der alten E-Mail-Adresse → erfolgreich, neues,
  unabhängiges Konto.
- **Deletion Receipt (Blocker 1)** → nach Ausführung existiert genau eine
  gültige Receipt-Datei mit korrektem `accountRef`/`deletedAt` und gültiger
  HMAC-Signatur.
- **Reconciliation-Simulation (Blocker 1)** → `users`-Zeile künstlich auf
  `active` zurückgesetzt (simuliert einen Restore), gültiges Receipt
  vorhanden → Deletion Receipt Doctor wendet die Löschung erneut an,
  erzeugt ein `reconciliation_reapplied`-Receipt.
- **Beschädigtes Receipt (Blocker 1)** → Deletion Receipt Doctor meldet
  die Anwendung nicht als `ready`.
- Migration Doctor → nach Anwendung von Migration 013 (nur zwei Spalten,
  Blocker 5):
  `ready:true, applied:13, pending:0, dirty:0, drift:0, unknown:0,
  schemaIssues:0, ledgerIssues:0`.

### 25.3 Frontend

- Deletion-Preview korrekt gerendert (Studios, Blocker, Zähler).
- Blocker deaktiviert die Bestätigungsaktion, zeigt Link zur
  Mitgliederseite.
- Passwortfeld-Validierung (leer, falsch).
- Bestätigungsphrase-Validierung (leer, falsch, korrekt).
- Doppel-Submit-Schutz (Button deaktiviert nach erstem Klick, kein
  Doppelaufruf).
- Erfolgsfall → automatischer Logout, Weiterleitung.
- Fehlerfall → verständliche, übersetzte Meldung, kein technischer Code
  sichtbar.
- Sitzungsende in anderen Tabs (bestehender `BroadcastChannel`-Mechanismus,
  Wiederverwendung, kein neuer Test-Typ nötig ausser der Zusicherung, dass
  er auch für diesen neuen Auslöser feuert).
- Studio-Membership-Removal-Dialog: Text, Owner-Schutz-Anzeige,
  Erfolg/Fehler.
- Accessibility (Abschnitt 27), DE/EN (Abschnitt 28), Mobile 390×844
  (Layout des Danger-Zone-Bereichs, keine horizontale Überlappung).

### 25.4 E2E

- Member löscht eigenes Konto → danach Login mit alter E-Mail schlägt fehl,
  keine aktive Sitzung mehr funktionsfähig.
- Trainer löscht eigenes Konto → Coaching-Beziehungen der betreuten
  Mitglieder korrekt auf `ended`, deren Zuweisungen/Historie unverändert
  sichtbar für die Mitglieder selbst.
- Sole Owner wird blockiert → Fehlermeldung mit Studio-Namen, keine
  Zustandsänderung, Owner kann danach normal weiterarbeiten.
- Owner ernennt einen zweiten Owner, danach erfolgreiche Löschung des
  ersten → Studio bleibt für den zweiten Owner vollständig funktionsfähig.
- Historische Daten erscheinen nach Löschung eines Coaches weiterhin
  korrekt bei den Mitgliedern (Programme, Zuweisungen, Feedback), ohne dass
  der ursprüngliche Name/die E-Mail des Coaches irgendwo im UI auftaucht.
- Alter Login funktioniert nicht (negative Prüfung, exakt derselbe
  Fehlerpfad wie ein nie existierendes Konto).
- Alte Sessions funktionieren nicht (ein vor der Löschung offener zweiter
  Browser-Tab wird beim nächsten Request abgemeldet).
- Alte E-Mail-Adresse kann sofort erneut registriert werden.
- Keine fremden Daten sichtbar (Fremdstudio-Isolationsprobe wie in Stage
  5B, hier zusätzlich nach einer Kontolöschung wiederholt).

---

## 26. E2E-Strategie

Siehe 25.4 — ergänzend zur bestehenden Suite (`frontend/e2e/*.spec.js`),
keine Änderung an bestehenden Spezifikationen nötig, ein neues
`accountDeletion.spec.js` (Entwurf, nicht erstellt) nach demselben Muster
wie `accountSelfService.spec.js`/`authSession.spec.js`. Serielles
`test.describe.configure({ mode: 'serial' })` wie im Bestand üblich, da
mehrere Tests denselben Studio-/Rollen-Aufbau teilen.

---

## 27. Accessibility

Keine neue Interaktionslogik nötig — vollständige Wiederverwendung
bestehender, bereits axe-geprüfter Bausteine: `ConfirmDialog` (Fokus-Trap
via `useModalFocus()`, Escape schliesst, Fokus kehrt zurück), `ToastHost`
(`aria-live="polite"`) für die Erfolgsmeldung, `role="alert"` für
Fehlermeldungen (bestehendes Muster). Neu zu prüfen (Entwurf für den
späteren Axe-Testfall, analog zu `accessibility.spec.js`): der erweiterte
Danger-Zone-Bereich in `ProfileView.vue` bei 1440/390px ohne
schwere/kritische Axe-Funde, das Bestätigungsphrase-Feld mit einem klaren,
programmatisch verknüpften Label (kein reiner Platzhaltertext als einzige
Beschriftung — bestehende Konvention im Produkt, z. B. Login-/
Registrierungsformulare, konsequent fortzusetzen).

---

## 28. DE/EN

Neue Schlüssel unter einem neuen `profile.dangerZone.*`-Zweig sowie
Erweiterung der bestehenden Fehlercode-Übersetzungstabelle um
`ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED`,
`ACCOUNT_DELETION_PHRASE_MISMATCH`, `ACCOUNT_ALREADY_DELETED` — exakt
demselben Muster wie alle bestehenden Fehlercode-Übersetzungen in
`utils/i18n.js` folgend, vollständige DE- und EN-Einträge parallel (kein
Nachziehen einer Sprache), analog zur in Stage 5B bereits als vollständig
verifizierten Abdeckung neuerer Views.

---

## 29. Risiken

- **Anonymisierungs-Kollisionen:** verschwindend gering bei kryptografisch
  zufälligem Platzhalter, aber nicht exakt null — Empfehlung: Retry-Schleife
  mit erneuter Zufallsziehung bei einem (praktisch nie eintretenden)
  `Duplicate entry`-Fehler auf den `UNIQUE`-Indizes.
- **Owner-Schutz-Umgehung durch Rennen:** durch die in Abschnitt 18
  beschriebene Sperrreihenfolge ausgeschlossen, aber die Implementierung
  muss exakt diese Reihenfolge einhalten — Abweichungen (z. B. Prüfung vor
  statt nach dem Sperren) würden ein TOCTOU-Fenster öffnen.
- **Vergessene Tabelle bei künftiger Schema-Erweiterung:** Jede neue
  Tabelle mit einem `user_id`/`*_by_user_id`-Bezug, die nach dieser Phase
  hinzugefügt wird, muss explizit in die Retention-Klassifikation
  (Abschnitt 4/8) aufgenommen werden — kein automatischer Mechanismus
  erzwingt das; Empfehlung: ein Migrations-Review-Checklistenpunkt „hat
  diese Tabelle einen Personenbezug, und wenn ja, welche
  Löschstrategie greift?" für jede künftige Migration.
- **Restore-Reconciliation wird operativ vergessen:** der in Abschnitt 21
  beschriebene Prozess ist manuell — ein Operator, der ihn nach einem
  Restore übersieht, lässt gelöschte Daten wieder aktiv werden, ohne dass
  das System selbst dies erkennt. Kein technischer Schutz dagegen in dieser
  Phase vorgesehen; Risiko wird durch klare Runbook-Dokumentation
  minimiert, nicht eliminiert.
- **Backup-Retention-Fenster wird im Pilot nicht kommuniziert:** rein
  organisatorisches Risiko, keine technische Lösung möglich (Abschnitt 20).
- **Selbstentfernungs-Erweiterung (6.4) als unbeabsichtigter Nebeneffekt:**
  die vorgeschlagene Erweiterung von `membershipChangeDecision()` muss
  exakt auf `sameUser && changes.status === 'left'` beschränkt bleiben —
  eine zu weit gefasste Implementierung könnte versehentlich weitere
  Selbstwirkungen (z. B. Selbst-Downgrade auf eine andere Rolle) freigeben,
  die nicht Teil dieses Entwurfs sind.
- **Symmetrischer HMAC-Schlüssel für Deletion Receipts (Blocker 1):** schützt
  gegen Zufall/Beschädigung/versehentliche Veränderung, aber nicht gegen
  eine Person mit Zugriff auf sowohl den Receipt-Speicherort als auch den
  HMAC-Schlüssel — Restrisiko, mitigiert durch getrennte Aufbewahrung von
  Schlüssel und Receipts (wie andere Produktionsgeheimnisse), nicht durch
  dieses Design vollständig eliminiert. Eine asymmetrische Signatur wäre
  eine mögliche spätere Härtung, nicht für den Piloten erforderlich.
- **Zu eng gefasster Terminalisierungs-Scope (Blocker 3):** die bewusst
  unterschiedliche Scopeing-Regel (Zuweisungen nach Mitglied, Regeln nach
  Ersteller:in) ist erklärungsbedürftig und muss in der Implementierung
  exakt wie in Abschnitt 7.5/7.6 begründet umgesetzt werden — eine
  versehentliche Vertauschung der beiden Scopes würde entweder fremde
  Mitgliederdaten stornieren oder das „Phantom-Coach"-Szenario nicht
  verhindern.
- **Materialisierungsverhalten bei beendeter Coaching-Beziehung, aber
  weiterhin aktiver Zuweisung:** aus dem Code verifiziert, dass
  `trainingCalendarService.js` die Coaching-Beziehung beim Materialisieren
  nicht prüft (Grundlage für die Regel-Deaktivierungs-Scope-Entscheidung in
  7.6) — dieses bereits bestehende, von diesem Design nicht veränderte
  Verhalten sollte in der Implementierungsphase durch einen eigenen Test
  erneut bestätigt werden, um sicherzustellen, dass sich daran zwischen
  Design und Implementierung nichts ändert.

---

## 30. Abnahmekriterien

Für die **spätere** Implementierungsphase (nicht für dieses Design Gate
selbst, das keinen Code liefert):

- Kein P0-/P1-Befund aus Stage 5B bleibt durch diese Funktion unadressiert
  offen (P1-1 gilt als gelöst, sobald diese Funktion produktiv nutzbar ist).
- **Korrigiert (Blocker 4).** Nicht: „keine PII in Historie" — sondern:
  **„Keine strukturierten direkten Account-Identifikatoren (E-Mail,
  Benutzername) bleiben über die anonymisierte User-Projektion zugänglich;
  fachhistorische Freitexte (`member_note`, Coach-Feedback) unterliegen der
  in Abschnitt 13.1 dokumentierten Retention- und Zugriffspolicy und werden
  nicht als PII-frei behauptet."**
- Keine aktiven Tokens (Access/Refresh/CSRF) nach abgeschlossener Löschung
  gültig.
- Keine verwaisten Studios (jedes aktive Studio hat nach jeder Löschung
  weiterhin mindestens einen aktiven Owner).
- Keine Teillöschung möglich (jeder Fehlerpfad führt zu vollständigem
  Rollback, verifiziert per erzwungenem Fehlertest).
- Keine Veränderung abgeschlossener/terminaler Trainingsdaten (Zielwerte,
  Ist-Werte, Zeitstempel, Status, Freitext) — **korrigiert (Blocker 4):
  keine Ausnahme mehr für `member_note`**, dieses Feld bleibt ebenfalls
  unverändert.
- **Neu (Blocker 2/3):** Jede `in_progress`-Session des zu löschenden
  Mitglieds erreicht nach der Löschung den terminalen Status `aborted`;
  jede aktive Zuweisung des Mitglieds erreicht `cancelled`; jede vom Konto
  erstellte aktive Regel erreicht `disabled`; jeder zukünftige,
  `PLANNED`-Studio-Kalendereintrag des Kontos erreicht `CANCELLED` —
  jeweils ohne Zuweisungen/Regeln fremder, nicht zu löschender Mitglieder
  zu verändern (ausser der Regel-Deaktivierung, die bewusst nach
  Ersteller:in gescopt ist, Abschnitt 7.6).
- Keine Cross-Tenant-Leaks (Löschung eines Kontos verändert nachweislich
  keine Zeile eines Studios, dem es nie angehörte).
- Preview (15.1) entspricht exakt der tatsächlichen Ausführung — garantiert
  dadurch, dass beide dieselbe Planungsfunktion aufrufen (Abschnitt 18.1,
  Blocker 6).
- Alle Löschaktionen sind auditiert (pro Studio/Session/Zuweisung/Regel ein
  bestehender Audit-Event-Typ, global zusätzlich ein Log-Ereignis).
- **Neu (Blocker 1):** Nach jeder Löschung existiert genau ein gültiges,
  integritätsgeschütztes externes Deletion Receipt; der Deletion Receipt
  Doctor meldet nach einer simulierten Restore-Reconciliation 0 offene
  Inkonsistenzen.
- Backups und Restore-Verhalten dokumentiert (dieses Dokument, Abschnitt
  20/21) und im Betriebs-Runbook nachgezogen.
- Vollständige Regression grün (Backend Unit/Integration/Migrations,
  Frontend, E2E) — exakt die in Stage 5B etablierten Zielwerte, erweitert
  um die neuen Tests aus Abschnitt 25.
- Keine neuen Critical-/Serious-Axe-Funde.
- Beide `npm audit`-Läufe (Backend/Frontend) weiterhin 0 Funde ≥ high.
- Migration Doctor nach Migration 013 (zwei Spalten, Blocker 5):
  `ready:true, applied:13, pending:0, dirty:0, drift:0, unknown:0,
  schemaIssues:0, ledgerIssues:0`.

---

## 31. Implementierungsreihenfolge

Für die **spätere** Phase (grobe Reihenfolge, kein Zeitplan):

1. Migration 013 (Abschnitt 19, **zwei** Spalten) erstellen und gegen eine
   Kopie der Entwicklungsdatenbank verifizieren (Migration Doctor `ready`).
2. Domänenlogik: Anonymisierungsfunktion, Owner-Blocker-Prüfung über
   mehrere Studios, Session-Abbruch-/Zuweisungs-/Regel-Terminalisierungs-
   Auswahl (Blocker 2/3), Retention-Klassifikation als reine Funktionen mit
   Unit-Tests (Abschnitt 25.1).
3. **Neu:** Deletion-Receipt-Modul (Erzeugen, HMAC-Signieren/-Verifizieren,
   Lesen/Schreiben im konfigurierten Verzeichnis) und der Deletion Receipt
   Doctor (Abschnitt 15.5/21) — unabhängig von 1–2 entwickelbar und früh
   testbar, da er nur eine deterministische Funktion des `users`-Zustands
   ist.
4. `planAccountDeletion()` (Abschnitt 18.1) und der vollständige
   17-Schritte-Transaktionsservice (Abschnitt 18.2) inklusive
   `revokeAllSessionsInTransaction`-Wiederverwendung, mit
   Integrationstests (Abschnitt 25.2).
5. API-Endpunkte (Abschnitt 15): zuerst `GET .../deletion-preview` (rein
   lesend, risikoarm, ruft `planAccountDeletion()` schreibgeschützt auf),
   danach `POST .../deletion-request`.
6. Erweiterung von `membershipChangeDecision()` um die
   Selbstentfernungs-Ausnahme (Abschnitt 6.4) — unabhängig von 1–5,
   parallelisierbar.
7. Frontend: Danger-Zone-UI mit der erweiterten Preview (Abschnitt 16.1),
   danach Erweiterung der Studio-Mitgliederverwaltung (16.2).
8. Neues `accountDeletion.spec.js` (Abschnitt 26) plus die neuen
   Sicherheits-/Reconciliation-Integrationstests (Abschnitt 25.2) — keine
   neuen Audit-Ereignistypen zu übersetzen, da alle vier verwendeten Typen
   bereits existieren.
9. Vollständige Regression, Migration Doctor, Deletion-Receipt-Doctor-
   Selbsttest, zwei unabhängige Chromium-E2E-Läufe (Muster aus Stage
   5A3/5B übernommen).
10. Dokumentation: `STAGE_5C_...`-Umsetzungsbericht (analog zu allen
    bisherigen Stage-Dokumenten) sowie Aktualisierung der drei
    Statusdokumente — **nicht** Teil dieses Design Gates.
11. Restore-Reconciliation-Runbook (Abschnitt 21.4/21.6) in
    `docs/MIGRATION_RECOVERY.md` oder einem neuen, verwandten
    Betriebsdokument ergänzen.

---

## 32. In Scope

- Design und Dokumentation der globalen Kontolöschung (Anonymisierung,
  Ausnahme-Hard-Delete).
- Design und Dokumentation der Studio-Mitgliedschaftsentfernung
  (bestehender Mechanismus plus Selbstentfernungs-Erweiterung).
- Vollständiger API-, UI-, Transaktions-, Migrations- und Testentwurf.
- Backup-/Restore-/Reconciliation-Prozessdesign.
- Sicherheitsanalyse.
- Ein neues ADR.

## 33. Out of Scope

- Jede tatsächliche Implementierung (Code, Migration, Tests, UI).
- Ein automatisierter, verzögerter/zweistufiger Löschablauf (Abschnitt 23).
- Ein Datenexport-Feature (weiterhin explizit ausserhalb, unverändert seit
  Stage 3B1).
- Eine Admin-/Support-initiierte Zwangslöschung eines fremden Kontos —
  **REVIDIERT (Blocker 5):** das Migrationsschema trägt dafür bewusst
  **keine** Reserve-Spalte mehr (`deletion_reason` wurde nach kritischer
  Prüfung entfernt, Abschnitt 19); eine künftige Phase entwirft die dafür
  nötige Datenstruktur bei Bedarf eigenständig.
- Automatische Eigentumsübertragung eines Studios.
- Ein generisches, globales (studio-übergreifendes) Audit-Log-System.
- Eine neue Retention-Ledger-**Datenbanktabelle** (bewusst durch ein
  dateibasiertes, ausserhalb der Datenbank liegendes Deletion Receipt
  ersetzt, Abschnitt 21 — ein reines strukturiertes Log allein wurde als
  unzureichend verworfen, Abschnitt 21.0).
- Eine weitergehende, eigenständige Freitext-Redaktion/-Anonymisierung für
  `member_note`/Feedback-Inhalte (Blocker 4, Abschnitt 13.1).
- Echte Cloud-Infrastruktur, echter externer Bucket (Stage 2B2B,
  unverändert „Deferred until first customer").
- Jede der in `FITTRACK_NEXT_PHASE_RECOMMENDATION.md` „Klare Grenze des
  nächsten Auftrags" genannten Themen (Chat, Zahlungen, Analytics, native
  Apps usw.).
- Das von Stage 5B empfohlene „Studio Operations Dashboard“ — unverändert
  ein eigenständiger, separater Vorschlag, nicht Teil dieser Phase.

---

## 34. Offene Annahmen

Explizit markiert, nicht stillschweigend entschieden:

1. **Anonymisierungs-Platzhalterformat** (`deleted-user-<hex>`,
   `deleted-<hex>@deleted.fittrack.invalid`) ist ein in diesem Dokument
   begründeter Vorschlag, keine endgültig fixierte Spezifikation — die
   Implementierungsphase kann ein abweichendes, ebenso nicht-ableitbares
   Format wählen, solange die in Abschnitt 8 genannten Eigenschaften
   (nicht aus E-Mail ableitbar, kein Login möglich, keine Kollision)
   erhalten bleiben.
2. **Bestätigungsphrase-Inhalt:** dieses Dokument empfiehlt den eigenen
   Benutzernamen; ein fester Text (z. B. „LÖSCHEN“) wäre ebenfalls
   vertretbar und international einfacher zu lokalisieren — offen für die
   Implementierungsphase.
3. **Rate-Limit-Werte** für `account.deleteRequest` (Vorschlag 3/60min)
   sind eine Analogie zu bestehenden Policies, keine endgültig festgelegte
   Zahl.
4. **Eine künftige Admin-/Support-initiierte Löschung** (z. B. für einen
   Support-Fall, in dem eine Person keinen Kontozugriff mehr hat, aber
   Löschung verlangt) ist in dieser Phase nicht entworfen — nach Blocker 5
   trägt das Schema dafür bewusst **keine** Reserve-Spalte mehr; eine
   künftige Phase entwirft die dafür nötige Datenstruktur bei Bedarf
   eigenständig, nicht vorab spekulativ.
5. **Retention-Dauer der Backups** (Anzahl Generationen) ist eine
   bestehende Betriebskonfiguration ausserhalb dieses Dokuments — die
   Reconciliation-Pflicht (Abschnitt 21) gilt unabhängig von der
   konkreten Dauer, aber die konkrete Zahl sollte vor einem echten Piloten
   im Betriebs-Runbook explizit genannt werden.
6. **Ob eine künftige Phase einen echten Datenexport** (das Gegenstück zur
   Löschung, „Recht auf Datenübertragbarkeit") benötigt, ist nicht
   Gegenstand dieses Designs und bewusst offen gelassen.
7. **Symmetrisches vs. asymmetrisches Signaturverfahren für Deletion
   Receipts** (Abschnitt 21.2/29): dieses Dokument empfiehlt HMAC-SHA256
   als proportionale Lösung für einen Piloten; ob eine spätere
   Produktionsphase eine asymmetrische Signatur (z. B. Ed25519) für ein
   stärkeres Bedrohungsmodell benötigt, ist offen.
8. **Materialisierungsverhalten bei beendeter Coaching-Beziehung**
   (Abschnitt 7.6/29): durch einen gezielten Code-Grep bestätigt, dass
   `trainingCalendarService.js` die Coaching-Beziehung beim Materialisieren
   nicht prüft — dies stützt die Scope-Entscheidung für die
   Regel-Deaktivierung, sollte aber in der Implementierungsphase durch
   einen dedizierten Test erneut, tiefergehend bestätigt werden.
9. **Exaktes Format/Verzeichniskonvention von `DELETION_RECEIPT_DIR`**
   (Abschnitt 21.3) ist ein in diesem Dokument begründeter Vorschlag,
   keine endgültig fixierte Spezifikation.

---

## 35. Endgültige Designentscheidung

**Harte Löschung, Anonymisierung oder Hybrid:** **Hybrid** — Anonymisierung
als Regelfall für jedes Konto mit Studio-Historie (durch das bestehende
`RESTRICT`-Schema erzwungen, nicht nur empfohlen), echter Hard-Delete
ausschliesslich für die exakt geprüfte Ausnahme eines Kontos ohne jede
Studio-Berührung.

**Kontolöschungsablauf:** einstufig, sofort wirksam nach Passwort- und
Bestätigungsphrasen-Prüfung, eine einzige atomare Transaktion
(Abschnitt 18), kein Zwei-Phasen-/Wartefrist-Mechanismus.

**Studio-Mitgliedschaftsentfernung:** bestehender
`PATCH .../memberships/:membershipId {status:'left'}`-Mechanismus,
erweitert um Selbstentfernung für Trainer/Member (Abschnitt 6.4) — kein
neuer Endpunkt.

**Sole-Owner-Verhalten:** Löschung wird **blockiert**, keine automatische
Eigentumsübertragung, keine automatische Archivierung — Nutzer muss selbst
vorher einen weiteren Owner ernennen.

**Aktive Sessions:** sofortiger, vollständiger Widerruf über die bestehende
`revokeAllSessionsInTransaction`-Funktion plus `auth_version`-Erhöhung plus
neue `lifecycle_status`-Prüfung — dreifach redundant abgesichert.

**Laufende Workout-Sessions (Blocker 2 — REVIDIERT):** werden atomar auf
`aborted` gesetzt, unter Wiederverwendung der bestehenden, präzedenzlosen
`in_progress→aborted`-Transition (ADR 003) — kein Löschblocker nötig.

**Aktive Assignments (Blocker 3 — REVIDIERT):** Zuweisungen des zu
löschenden **Mitglieds** werden atomar `cancelled`; Zuweisungen, die das
Konto nur für andere Mitglieder erstellt hat, bleiben unverändert.

**Coaching Relationships:** automatisch auf `ended`.

**Schedule Rules (Blocker 3 — präzisiert):** automatisch auf `disabled`,
gescopt nach **Ersteller:in** (nicht nach betroffenem Mitglied) — verhindert
unbeaufsichtigte Weiter-Materialisierung nach Verlust des Coaches.

**Calendar Entries (Blocker 3 — REVIDIERT):** zukünftige `PLANNED`-Studio-
Einträge werden `CANCELLED` (inklusive der durch einen Session-Abbruch von
`IN_PROGRESS` auf `PLANNED` zurückgefallenen Einträge); `COMPLETED`/
`SKIPPED`/bereits `CANCELLED` bleiben unverändert; persönliche Einträge
werden weiterhin gelöscht.

**Persönliche Workouts:** hart gelöscht (bereits korrekt kaskadierend
vorbereitet).

**Studiohistorie:** vollständig erhalten, Personenbezug nur indirekt über
die `users`-Anonymisierung entfernt — **keine** Zeile in
Programmen/Versionen/Zuweisungen/Sessions/Sets wird selbst verändert.

**Freitext-Retention (Blocker 4 — REVIDIERT):** `member_note` und
Feedback-`body` bleiben **vollständig unverändert**, nicht geleert. Dieses
Dokument behauptet **nicht**, dass historische Freitexte PII-frei sind —
nur, dass keine strukturierten direkten Account-Identifikatoren mehr über
die anonymisierte `users`-Projektion auflösbar sind. Zugriff bleibt streng
tenant-/rollenbegrenzt.

**Feedback:** wortwörtlich unverändert (append-only, kein neuer
Schreibpfad).

**Audit Events:** unverändert, `actor_user_id` bleibt gültig, zeigt aber auf
ein anonymisiertes Konto; zusätzlich drei bereits bestehende Ereignistypen
für Session-Abbruch/Zuweisungs-/Regel-Terminalisierung wiederverwendet.

**E-Mail-Wiederverwendung:** sofort möglich, kein Sperrfenster — automatische
Folge der Anonymisierung selbst.

**Backup-Retention:** unverändert (bestehende GFS-Rotation), keine
rückwirkende Bereinigung von Backup-Dateien; Kommunikationspflicht im
Pilot-Consent.

**Restore-Reconciliation (Blocker 1 — VOLLSTÄNDIG NEU):** ein reines
strukturiertes Log genügt **nicht**. Gewählter Mechanismus: Kombination (D)
aus `users.lifecycle_status` (schnelle, transaktionale Quelle für den
laufenden Betrieb) und einem externen, HMAC-integritätsgeschützten,
append-only Deletion Receipt pro Löschvorgang (A+C), gespeichert ausserhalb
von Repository und Datenbank-Backup-Verzeichnis, geprüft durch einen
automatisierten „Deletion Receipt Doctor" bei jedem Start und zwingend nach
jedem Restore, mit explizit definiertem, fail-closed Verhalten bei
Beschädigung und Selbstheilung bei einem reinen Schreib-Absturz zwischen
DB-Commit und Receipt-Erzeugung (Abschnitt 18.3, 21) — **keine** Behauptung
vollständiger Zwei-Ressourcen-Atomizität.

**Migration 013 (Blocker 5 — REVIDIERT):** **zwei** neue, additive Spalten
auf `users` (`lifecycle_status`, `deleted_at` — `deletion_reason` nach
kritischer Prüfung entfernt) plus eine erweiterte CHECK-Wertemenge auf
`user_auth_sessions.revocation_reason` — keine neue Tabelle, auch nicht für
das Deletion Receipt (das bewusst dateibasiert, nicht in der Datenbank
liegt).

**Implementierungsreihenfolge:** siehe Abschnitt 31.

**Offene Unsicherheiten:** siehe Abschnitt 34 — explizit als offen markiert,
nicht als entschieden ausgegeben.

**Design-Mergebereitschaft:** Alle vier in der vorherigen Fassung offenen
Designblocker sind in dieser Revision eindeutig, mit genau einer
Entscheidung je Blocker (keine offen gelassenen Alternativen), aufgelöst —
siehe die Übersicht direkt nach der Kopfzeile dieses Dokuments.

Dieses Design Gate selbst endet hier. Es wurde **keine Implementierung
begonnen**, keine Migration erstellt, keine Zeile Produktions- oder
Testcode verändert, keine realen oder Entwicklungsdaten gelöscht oder
anonymisiert, keine Cloud-Infrastruktur eingerichtet.