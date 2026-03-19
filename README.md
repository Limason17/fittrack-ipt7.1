# FitTrack

FitTrack ist eine Web-Applikation, mit der Nutzer ihre Workouts planen, Übungen verwalten und ihren Trainingsfortschritt verfolgen können.

## Funktionen
- Account erstellen und einloggen
- Übungen hinzufügen und verwalten
- Trainings planen
- Fortschritt verfolgen
- Trainings im Kalender anzeigen

## Projekt
Dieses Projekt wurde im Rahmen von IPT 7.1 erstellt.

## Team
- Liam Bruno
- Fabio Erculiani
- Noël Wenger

## Projekt starten

### Voraussetzungen
Bevor das Projekt gestartet werden kann, müssen diese Programme installiert sein:
- Node.js
- MySQL

### Installation
1. Repository klonen oder pullen
2. Im `backend`-Ordner `npm install` ausführen
3. Die Datei `.env.example` zu `.env` kopieren
4. Docker starten
5. Im Hauptordner `docker compose up -d` ausführen
6. Backend mit `node server.js` starten

## Umgebungsvariablen
In der `.env`-Datei müssen folgende Werte stehen:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=fittrack
DB_PORT=3306
PORT=3000
JWT_SECRET=fittracksecret