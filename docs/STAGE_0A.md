# Stufe 0A – Betriebs- und Qualitätsbasis

Stand: 18.07.2026

Stufe 0A schafft eine reproduzierbare, testbare Ausgangsbasis für FitTrack. Sie ist kein Nachweis vollständiger Produktionsreife und erweitert das Produkt nicht um neue Markt- oder Studiofunktionen.

## Abnahmekriterien

| Bereich | Gate | Erwartetes Ergebnis |
| --- | --- | --- |
| Toolchain | `.nvmrc`, CI | Node 22.17.0; npm 10 |
| Installation | `npm ci` in beiden Paketen | Lockfiles sind reproduzierbar installierbar |
| Backend-Syntax | `npm run test:syntax` | Alle Projekt-JavaScript-Dateien sind syntaktisch gültig |
| Backend-Unit | `npm run test:unit` | Konfiguration, Auth, Validation, Fehler, Rate Limit, Logging, Metriken und Startup-Health bestehen |
| API/DB | `npm run test:integration` | Reale MySQL-Flows, zwei Nutzer, Isolation und konsistenter Fortschritt bestehen |
| Migrationen | `npm run test:migrations` | Reale Empty-/Legacy- und zweite No-op-Läufe bestehen |
| Coverage | `npm run test:coverage` | Coverage-Bericht für DB-unabhängige Kernlogik wird erzeugt |
| Frontend | `npm run test:run` | Kritische Unit-/Komponentenflüsse bestehen |
| Build | `npm run build` | Produktionsbundle wird ohne localhost-API erstellt |
| Dependencies | Audit ab `high` | Kein Befund mit Schweregrad high oder critical |
| Repository | GitHub Actions | Backend- und Frontend-Job sind grün |

## Datenbankvertrag

Die Dateien in `database/migrations` sind die einzige aktive, versionierte Schemaquelle. `database/schema.sql` und `database/seed.sql` bleiben Legacy-/lokale Hilfsdateien und dürfen nicht als Produktionsupgrade ausgeführt werden.

Der Migrationsrunner muss folgende Invarianten einhalten:

- sortierte, eindeutige IDs;
- unveränderliche, für CRLF/LF normalisierte SHA-256-Prüfsummen;
- Ledger `schema_migrations`;
- keine parallelen Läufe ohne Advisory Lock;
- sichtbarer failed/dirty-Zustand statt stiller Fortsetzung;
- read-only Statusprüfung ohne Ledger-DDL;
- vollständig angewendete Registry als No-op;
- keine automatische Löschung fachlicher Daten bei nicht sicher migrierbaren Legacy-Fällen.

### Geprüfte reale Szenarien

**Leere Datenbank**

- Migrationen 001 bis 004 werden in Reihenfolge angewendet.
- Tabellen, Indizes, Constraints und 14 globale Übungen entstehen.
- Das Ledger enthält vier erfolgreiche Einträge.
- Ein zweiter Lauf ändert weder Ledger noch Schema.

**Unterstütztes unversioniertes Legacy-Schema**

- Bestehende Benutzer, Übungen, Workouts und Fortschrittseinträge bleiben erhalten.
- Workout-Fortschritt wird eindeutig mit `workout_exercises` verknüpft.
- Historische Name-/Kategorie-/Muskelgruppen-Snapshots werden befüllt.
- Ein zweiter Lauf ist ein No-op.

**API-Wegwerf-Datenbank**

- Pro Testprozess wird eine zufällige `fittrack_api_test_<...>`-Datenbank erstellt.
- Zwei Nutzer werden registriert und angemeldet.
- Fremde Workouts und Fortschrittseinträge bleiben unsichtbar beziehungsweise nicht änderbar.
- Abgeleiteter Workout-Fortschritt bleibt eindeutig und ist nicht als manueller Eintrag löschbar.
- Cleanup droppt nur den zuvor validierten Wegwerf-Namen.

### Trainings- und Einheitenvertrag

- `workouts` und `workout_exercises` sind die fachliche Wahrheit; automatisch erzeugte `progress_entries` sind eindeutig verknüpfte, unveränderliche Ableitungen.
- Manuelle Fortschrittseinträge tragen `source_type=manual` und keine Workout-Verknüpfung.
- Gewicht wird kanonisch in kg mit der vorhandenen Datenbankpräzision von `DECIMAL(6,2)` gespeichert; offene Formulare halten für driftarme kg/lb-Wechsel vier Nachkommastellen.
- Bestehende Workout-Zeilen liefern ihre Child-ID als `exercises[].id`. Das Frontend sendet sie bei `PUT /api/workouts/:id` als `workout_exercise_id`; neue oder bewusst ersetzte Zeilen senden `null`. Dadurch bleiben auch doppelte Übungen eindeutig an ihrem historischen Snapshot.
- Fortschritts-Summaries und Charts gruppieren nach der vollständigen historischen Snapshot-Variante. Eine später geänderte Übung kann daher getrennte historische und aktuelle Karten erzeugen, statt Metrikarten zu vermischen.

## Startup- und Health-Vertrag

Das Backend darf den Listen-Socket erst öffnen, wenn:

1. die DB-Verbindung erfolgreich geprüft wurde;
2. Migrationen erfolgreich angewendet wurden;
3. kein pending, dirty, drift oder unknown Migrationszustand vorliegt;
4. Readiness auf `ready` gesetzt wurde.

Bei einem Fehler bleibt die Instanz nicht bereit, der DB-Pool wird geschlossen und der Prozess meldet einen Fehlerstatus.

- `/api/health/live` ist nur eine Prozess-Liveness.
- `/api/health/ready` und `/api/health` prüfen Lifecycle, DB und Migrationen.
- Nichtbereitschaft ist HTTP 503 mit maschinenlesbarem Grund.

## Sicherheits- und Fehlervertrag

Stufe 0A umfasst insbesondere:

- validiertes Produktions-JWT-Secret;
- Authentifizierung und Nutzerisolation;
- normalisierte Validierungsfehler;
- stabiles Fehler-Envelope ohne SQL-, Stack- oder Pfadleaks;
- Request-ID in Response und Fehlerantwort;
- grundlegende Security-Header;
- begrenzte JSON-Body-Größe;
- In-Memory-Rate-Limit für sensible Routen;
- Audit-Gate ab `high` für beide npm-Pakete.

Diese Maßnahmen ersetzen keinen externen Security-Test.

## Frontend-Vertrag

- `/api` ist der sichere Default für Entwicklung und Produktion.
- Der lokale Vite-Proxy ist separat über `API_PROXY_TARGET` konfigurierbar.
- Produktionsbuilds mit localhost-API werden abgelehnt.
- 401 beendet die lokale Sitzung; 403 nicht.
- Backend-Fehler im neuen `error.message`-Format und das Legacy-Format werden verstanden.
- Gewichtseingaben und 1RM-Anzeige dürfen bei kg/lb-Wechsel nicht doppelt konvertiert werden oder driften.

## CI-Vertrag

`.github/workflows/ci.yml` verwendet zwei unabhängige Jobs:

1. Backend mit kurzlebigem MySQL-8-Service, geschütztem Reset, Migration-No-op, Zwei-Nutzer-API-Test, Empty-/Legacy-Migrationen, Syntax, Coverage und Audit.
2. Frontend mit Tests, Produktionsbuild und Audit.

Der Workflow besitzt ausschließlich Leserechte auf Repository-Inhalte, verwendet `npm ci` und bricht parallele ältere Läufe desselben Branches ab.

## Bewusst nicht Bestandteil

- Browser-E2E mit Playwright/Cypress und echtem Backend
- Mobile-App, Social Features oder Trainingsvideos
- B2B-Mandanten, Studios, Rollenverwaltung, Abrechnung oder White-Labeling
- Performance-/Lasttest und verbindliche SLOs
- zentraler verteilter Rate Limiter
- automatisierte Backups, Restore-Tests und Disaster Recovery
- Hochverfügbarkeit, MySQL-Replikation und Multi-Region-Betrieb
- Down-Migrationen oder automatischer Datenbank-Rollback
- Container-Images, IaC und vollautomatisches Produktionsdeployment
- Coverage-Mindestwert als CI-Gate
- Accessibility-Audit mit realem Browser und Screenreader

Diese Grenzen müssen vor einer externen Pilotierung oder produktiven Vermarktung priorisiert und risikobasiert geschlossen werden.
