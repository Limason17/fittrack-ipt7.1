# Empfehlung für die nächste Entwicklungsphase

Basierend auf `FITTRACK_CURRENT_STATUS.md` (Stand PR #7) sowie den seither
integrierten Phasen Stage 1B.2B2A (PR #9, Member-Workout-Ausführungs-UI) und
Stage 1B.2B2B (Coach-Ergebnisansicht, kontrollierter Feedback-Flow,
vollständige Footer-Entfernung — siehe
`STAGE_1B2B2B_COACH_RESULTS_FEEDBACK.md`). Diese Empfehlung trifft keine
Entscheidung — sie liefert eine begründete Grundlage für eine explizite
Freigabe durch den Auftraggeber.

## Was diese Empfehlung ablöst

Die vorherige Version dieses Dokuments empfahl Stage 1B.2B2 (Member-Session-
Ausführung). Diese Empfehlung ist erfüllt: Stage 1B.2B2A lieferte die
Member-seitige Ausführungs-/Historien-UI, Stage 1B.2B2B lieferte darauf
aufbauend die Coach-Ergebnisansicht mit kontrolliertem, append-only
Feedback-Flow. Mit Stage 1B.2B2B ist die zentrale funktionale Lücke aus dem
ursprünglichen Audit — „Workout-Ausführung ohne jede Oberfläche" — für beide
beteiligten Rollen (Mitglied und Coach) geschlossen.

## Was als Nächstes gebaut werden sollte

**Betriebs-/Produktionsreife statt weiterer Coach-Feedback-Funktionen.**
Stage 1B.2B2B hat den Feedback-Flow bewusst minimal und append-only
gehalten (kein Antworten, keine Threads, keine Benachrichtigungen — siehe
„Klare Grenze zu späteren Phasen" im Stage-Dokument). Die naheliegende
Versuchung wäre, als Nächstes eine dieser ausgeschlossenen Funktionen
(insbesondere Mitglieds-Antworten auf Feedback) zu bauen. Diese Empfehlung
rät stattdessen dazu, zuerst die bereits mehrfach über Phasen hinweg
dokumentierten **operativen Pilot-Blocker** zu schließen, weil sie — anders
als eine weitere UI-Funktion — jede Rolle und jede bisher gebaute Funktion
gleichermaßen betreffen und ohne sie kein echter Pilotbetrieb mit realen
Nutzerdaten vertretbar ist:

1. **Produktions-E-Mail-Provider für Einladungen.** Ohne verdrahteten
   Zustellprovider verweigert das System jede Einladungserstellung in
   Produktion fail-closed (503) — Studios können in der Praxis aktuell
   niemanden einladen.
2. **Backup-Verschlüsselung im Ruhezustand.** Betrifft am stärksten genau
   die sensibelsten Daten im System (P4: Satzresultate, Member-Notizen,
   jetzt auch Trainer-Feedback) — alle unverschlüsselt auf Platte.
3. **Off-host-Backup-Kopie.** Aktuell nur dokumentierte Absicht, kein
   Upload-Adapter — ein einzelner Host-Verlust ist nicht wiederherstellbar.
4. **Getrennte DB-Rolle für Runtime vs. Migration/Restore.** Aktuell eine
   einzige DB-Rolle für alles.

## Warum operativ vor funktional

- Alle vier Punkte sind seit mindestens dem in `FITTRACK_CURRENT_STATUS.md`
  dokumentierten Audit bekannt und wurden über mehrere Feature-Phasen hinweg
  bewusst zurückgestellt, weil sie „keine Programmierarbeit im engeren Sinn,
  sondern Infrastrukturentscheidungen" sind — das bleibt richtig, ändert
  aber nichts daran, dass sie inzwischen der limitierende Faktor für einen
  echten Pilotbetrieb sind, nicht mehr fehlende Coach-Funktionalität.
- Jede weitere Feature-Phase (Antworten auf Feedback, Benachrichtigungen
  etc.) vergrößert die Menge an P2/P4-Daten, die von den bestehenden Lücken
  betroffen ist, ohne die Lücken selbst zu schließen — technische Schuld
  wächst schneller als sie durch neue Features sichtbar würde.
- Diese Punkte sind rollenunabhängig: Sie verbessern nicht eine einzelne
  Nutzergruppe (wie die letzten beiden Phasen: erst Mitglieder, dann
  Coaches), sondern die Betriebssicherheit für alle Rollen gleichzeitig.

## Falls stattdessen funktional priorisiert werden soll

Sollte der Auftraggeber trotzdem zuerst mit einer weiteren Funktion
fortfahren wollen, ist die naheliegende, bereits im Stage-1B.2B2B-Dokument
vorgezeichnete Fortsetzung eine **kontrollierte Mitglieds-Antwort auf
Feedback** (einfacher Thread statt freiem Chat, weiterhin ohne Bearbeiten/
Löschen, weiterhin ohne Push-/E-Mail-Benachrichtigungen) — das ist die
kleinste, konsistenteste Erweiterung des in Stage 1B.2B2B etablierten
append-only-Modells. Diese Empfehlung rät jedoch aus den oben genannten
Gründen davon ab, dies vor den operativen Punkten zu priorisieren.

## Weiterhin nicht blockierend, aber vormerken

- **Toter Policy-Code (`coachActionEligibility` in `studioPolicy.js`).**
  Weiterhin unverdrahtet; sollte bereinigt oder tatsächlich verwendet
  werden, bevor weitere Coach-Logik entsteht, die die Drift vergrößert.
- **CORS-Konfiguration ungetestet.**
- **Login-Timing-Seitenkanal** (Konto-Enumeration über `bcrypt.compare`-
  Timing).
- **Rate Limiter pro Prozess** (Skalierungsgrenze bei mehreren Instanzen).
- **Kein Recht-auf-Löschung-/Anonymisierungspfad** für Benutzer- oder
  Trainingsdaten — inzwischen zusätzlich relevant für Trainer-Feedback
  (Stage 1B.2B2B), das dauerhaft beim Mitglied verbleibt.

## Klare Grenze des nächsten Auftrags

Unabhängig davon, ob operativ oder funktional priorisiert wird, sollte der
nächste Auftrag ausdrücklich ausschließen:
- jede Änderung am bereits stabilen, getesteten Feedback-Datenmodell aus
  Stage 1B.2B2B (append-only bleibt append-only, außer explizit neu
  beauftragt),
- die in Stage 1B.2B2B Abschnitt „Klare Grenze zu späteren Phasen"
  aufgeführten Themen (Chat, Reaktionen, KI-Feedback, Analytics-Dashboard,
  Churn-Risk, Körpergewicht/Fotos, Check-ins, Zahlungen, Community,
  Wearables, native Apps, Offline/PWA, White Label, Microservices,
  Kubernetes) ohne explizite neue Freigabe.

Diese Empfehlung ersetzt keine explizite Freigabe. Eine neue Phase wird erst
nach ausdrücklicher Zustimmung des Auftraggebers begonnen.
