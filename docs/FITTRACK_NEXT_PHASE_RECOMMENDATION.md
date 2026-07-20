# Empfehlung für die nächste Entwicklungsphase

Basierend auf `FITTRACK_CURRENT_STATUS.md` (Stand PR #7) sowie den seither
integrierten Phasen Stage 1B.2B2A (PR #9), Stage 1B.2B2B (PR #10, Coach-
Ergebnisansicht/Feedback/Footer-Entfernung) und Stage 2A (produktionsfähiger
SMTP-Einladungsversand — siehe
`STAGE_2A_PRODUCTION_INVITATION_EMAIL.md`). Diese Empfehlung trifft keine
Entscheidung — sie liefert eine begründete Grundlage für eine explizite
Freigabe durch den Auftraggeber.

## Was diese Empfehlung ablöst

Die vorherige Version dieses Dokuments empfahl, zunächst die operativen
Pilot-Blocker zu schließen, beginnend mit einem Produktions-E-Mail-Provider
für Einladungen. Dieser erste Punkt ist mit Stage 2A erfüllt: Ein validierter,
providerneutraler SMTP-Adapter (Nodemailer, erzwungenes TLS, Fail-Closed ohne
Konfiguration, sichere Fehlerklassifikation, keine Secrets in Logs/Audit) ist
implementiert und automatisiert getestet. Einladungen sind damit — sobald ein
Operator echte SMTP-Zugangsdaten hinterlegt und den dokumentierten manuellen
Smoke-Test durchführt — produktiv nutzbar. Ein echter Versand wurde in dieser
Entwicklungsumgebung mangels Zugangsdaten nicht nachgewiesen; das bleibt ein
offener, aber rein operativer (nicht mehr programmiertechnischer) Schritt.

## Was als Nächstes gebaut werden sollte

**Die verbleibenden operativen Pilot-Blocker, in dieser Reihenfolge:**

1. **Backup-Verschlüsselung im Ruhezustand.** Betrifft am stärksten genau
   die sensibelsten Daten im System (P4: Satzresultate, Member-Notizen,
   Trainer-Feedback) — alle aktuell unverschlüsselt auf Platte.
2. **Off-host-Backup-Kopie.** Aktuell nur dokumentierte Absicht, kein
   Upload-Adapter — ein einzelner Host-Verlust ist nicht wiederherstellbar.
3. **Getrennte DB-Rolle für Runtime vs. Migration/Restore.** Aktuell eine
   einzige DB-Rolle für alles.

Diese drei sind bewusst als *eine* zusammenhängende „Backup-/DB-Härtung"-Phase
zu verstehen (nicht Gegenstand von Stage 2A, siehe dessen Abgrenzung), da sie
alle denselben operativen Bereich betreffen und gemeinsam die
Backup-/Restore-Infrastruktur absichern.

## Warum weiterhin operativ vor funktional

- Alle drei Punkte sind seit dem ursprünglichen Audit bekannt und wurden
  bewusst zurückgestellt; mit dem E-Mail-Provider ist der erste von vier
  operativen Blockern geschlossen — die Logik, jetzt konsequent
  weiterzumachen statt zurück zu Feature-Arbeit zu wechseln, bleibt
  bestehen.
- Alle drei sind weiterhin rollenunabhängig und betreffen die
  Betriebssicherheit für den gesamten Pilotbetrieb, nicht eine einzelne
  Nutzergruppe.
- Stage 2A hat zusätzliche, unverschlüsselt gespeicherte sensible Daten
  geschaffen (SMTP-Zugangsdaten selbst liegen nur in der Prozessumgebung,
  nicht in der DB — aber jede zusätzliche versendete Einladung ist ein
  weiterer Datenpunkt, dessen Absicherung von denselben Backup-/DB-Härtungs-
  Maßnahmen abhängt).

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
- **CORS-Konfiguration ungetestet.**
- **Login-Timing-Seitenkanal** (Konto-Enumeration über `bcrypt.compare`-
  Timing).
- **Rate Limiter pro Prozess** (Skalierungsgrenze bei mehreren Instanzen).
- **Kein Recht-auf-Löschung-/Anonymisierungspfad** für Benutzer-,
  Trainings- oder Feedbackdaten.
- **Kein Bounce-/Complaint-Handling und keine Zustell-Warteschlange** für
  den neuen SMTP-Versand (bewusst außerhalb des Stage-2A-Umfangs, siehe
  dessen „Bekannte Einschränkungen").

## Klare Grenze des nächsten Auftrags

Unabhängig davon, ob operativ oder funktional priorisiert wird, sollte der
nächste Auftrag ausdrücklich ausschließen:
- jede Änderung am bereits stabilen, getesteten Feedback-Datenmodell aus
  Stage 1B.2B2B und am SMTP-Adapter-Vertrag aus Stage 2A (beide bleiben
  außer bei expliziter neuer Freigabe unverändert),
- die in Stage 1B.2B2B Abschnitt „Klare Grenze zu späteren Phasen" sowie in
  Stage 2A Abschnitt „Nicht enthalten" aufgeführten Themen (Chat,
  Reaktionen, KI-Feedback, Analytics-Dashboard, Churn-Risk, Körpergewicht/
  Fotos, Check-ins, Zahlungen, Community, Wearables, native Apps, Offline/
  PWA, White Label, Microservices, Kubernetes, E-Mail-Queues, Message
  Broker, wiederkehrende Jobs) ohne explizite neue Freigabe.

Diese Empfehlung ersetzt keine explizite Freigabe. Eine neue Phase wird erst
nach ausdrücklicher Zustimmung des Auftraggebers begonnen.
