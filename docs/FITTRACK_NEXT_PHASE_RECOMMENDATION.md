# Empfehlung für die nächste Entwicklungsphase

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
   Stage 2B2A liefert die vollständige, automatisiert getestete
   S3-kompatible Upload-/Download-/Verifikations-/Retention-Mechanik, aber
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
