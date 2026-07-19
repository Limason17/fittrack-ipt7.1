# Empfehlung für die nächste Entwicklungsphase

Basierend auf `FITTRACK_CURRENT_STATUS.md`, geprüfter Stand `main`@`8a8da30`. Diese Empfehlung trifft keine Entscheidung — sie liefert eine begründete Grundlage für eine explizite Freigabe durch den Auftraggeber.

## Was als Nächstes gebaut werden sollte

**Stage 1B.2B2 — Studio-Workout-Ausführung: Member-Oberfläche.** Das ist die naheliegende, bereits im Stage-1B.2B1-Abschlussbericht angekündigte Fortsetzung, und dieser Audit bestätigt unabhängig, dass es der größte einzelne Hebel ist: ein vollständig fertiges, getestetes Backend (10 Endpunkte, 68 im Gesamtsystem, alle mit Unit- und Integrationstests) hat aktuell keinen einzigen Aufrufer im Frontend.

## Warum

- Es ist die einzige Funktion in der gesamten Funktionsmatrix (Abschnitt 4 des Statusberichts), die als "nur Backend" statt "vollständig" markiert ist, obwohl die Backend-Seite bereits denselben Reifegrad wie jede andere Stage hat.
- Ohne sie hat ein Studio-Mitglied — die zahlenmäßig größte Zielrolle des Systems — praktisch keinen Mehrwert aus der gesamten Stage-1B-Linie: Es kann sich einen zugewiesenen Trainingsplan ansehen (`MyTrainingPlanView.vue`), aber nirgends ein tatsächliches Training protokollieren.
- Sie ist der einzige der drei identifizierten kritischen Pilot-Blocker, der rein im Verantwortungsbereich der Produktentwicklung liegt (im Gegensatz zu Produktions-E-Mail-Provider und Off-host-Backup, die Infrastrukturentscheidungen sind, keine Programmierarbeit).

## Bereits erfüllte Voraussetzungen

- API-Client (`frontend/src/utils/workoutSessionApi.js`) ist fertig und deckt alle 10 Endpunkte ab.
- Backend-Verhalten ist vollständig spezifiziert und getestet: Idempotenz, Optimistic Concurrency, Statusübergänge, Fehlercodes — die UI muss sich nur an ein bereits stabiles Vertrag halten, nicht gleichzeitig Backend-Verhalten mitentwerfen.
- Das Design-System und die Views-Konventionen aus Stage 1B.2A (Loading/Empty/Error-States, `ConfirmDialog`, Statustabs, `reconcileStudioAccess()`-Muster) sind etabliert und wiederverwendbar.
- ADR 003 dokumentiert bereits explizit, was Stage 1B.2B2 NICHT umfasst (Coach-Feedback-UI, Live-Timer, Offline-Sync) — der Zuschnitt ist bereits vorentschieden.

## Altlasten, die vorher (oder im selben Zuge) korrigiert werden sollten

Keine davon blockiert den Start von Stage 1B.2B2 technisch, aber zwei sollten mit geringem Zusatzaufwand mitgenommen werden, weil sie dieselben Codepfade berühren:

1. **Uneinheitliche Frontend-403-Behandlung.** `MyTrainingPlanView.vue` hat (im Unterschied zu den Owner/Admin/Trainer-Management-Views) kein `reconcileStudioAccess()`. Eine neue Session-UI für Mitglieder sollte dieses Muster von Anfang an konsistent übernehmen, statt eine dritte Variante einzuführen.
2. **Toter Policy-Code (`coachActionEligibility`).** Sollte entweder entfernt oder tatsächlich verdrahtet werden, bevor weitere Coach-bezogene UI-Logik (z. B. eine künftige Coach-Feedback-Funktion) darauf aufbaut und die Drift vergrößert.

Explizit NICHT als Vorbedingung empfohlen (können parallel oder danach laufen, ohne Stage 1B.2B2 zu blockieren):
- Backup-Verschlüsselung, Off-host-Kopie, DB-Rollentrennung — reine Betriebsthemen ohne Berührungspunkt zum Frontend-Code.
- Produktions-E-Mail-Provider — betrifft Einladungen, nicht Workout-Sessions.
- Login-Timing-Seitenkanal — betrifft Auth, nicht die Session-UI.

## Empfohlene Aufteilung der nächsten Phase

Passend zum in den Vorphasen etablierten Muster (Backend-Grundlage getrennt von UI-Grundlage, siehe Stage 1A → Stage-1A-UI und Stage 1B.1 → Stage 1B.2A):

1. **Member-Session-Flow**: Zuweisung → Session starten → Übungen/Sätze durchgehen → Satzresultate erfassen → abschließen/abbrechen. Das ist der Kern; ohne ihn ist nichts nutzbar.
2. **Member-Session-Historie**: eigene abgeschlossene/abgebrochene Sessions einsehen (Liste + Detail), auf Basis der bereits vorhandenen `GET .../workout-sessions/me`-Endpunkte.
3. Bewusst NICHT in diese Phase: Coach-seitige Ergebnisansicht (`GET .../coached-members/...`) — das ist ein eigener Verwaltungs-Screen mit eigenen Rollenfragen und sollte, konsistent mit dem bisherigen Muster, eine eigene, spätere Phase sein (z. B. Stage 1B.2B3), nicht in derselben Phase wie die Member-Erfassung mitgezogen werden.

## Klare Grenze des nächsten Auftrags

Der nächste Auftrag sollte sich ausdrücklich auf **Member-seitige Session-Ausführung und -Historie** beschränken (Punkte 1–2 oben) und explizit ausschließen:
- Coach-Resultatansicht/-Dashboard (eigener späterer Auftrag),
- jede Änderung am bereits stabilen, getesteten Backend-Vertrag aus Stage 1B.2B1 (nur konsumieren, nicht ändern),
- Betriebs-/Infrastrukturthemen (Backup, E-Mail-Provider, DB-Rollen) — diese sind unabhängige, nicht-blockierende Stränge, die separat beauftragt werden sollten.

Diese Empfehlung ersetzt keine explizite Freigabe. Eine neue Phase — einschließlich Stage 1B.2B2 — wird erst nach ausdrücklicher Zustimmung des Auftraggebers begonnen.
