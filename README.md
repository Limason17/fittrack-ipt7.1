# FitTrack

FitTrack ist eine mehrsprachige Web-Applikation, mit der Nutzer Übungen verwalten, Workouts planen und ihren Trainingsfortschritt verfolgen können.

## Funktionen

- Account erstellen und einloggen
- Deutsch/Englisch umschalten und pro Nutzer speichern
- Übungen anzeigen, filtern, hinzufügen, bearbeiten und löschen
- Workouts mit Datum, Notizen, Sätzen, Wiederholungen und Gewicht speichern
- Workouts im Kalender anzeigen
- Fortschritt automatisch aus Workouts und manuell erfassten Einträgen anzeigen

## Projekt

Dieses Projekt wurde im Rahmen von IPT 7.1 erstellt.

## Team

- Liam Bruno
- Fabio Erculiani
- Noël Wenger

## Voraussetzungen

- Node.js
- Docker oder eine lokale MySQL-Installation

## Installation

1. Im `backend`-Ordner `npm install` ausführen
2. Im `frontend`-Ordner `npm install` ausführen
3. `backend/.env.example` zu `backend/.env` kopieren
4. Optional `frontend/.env.example` zu `frontend/.env` kopieren
5. Im Hauptordner `docker compose up -d` ausführen
6. Backend starten: im `backend`-Ordner `npm run dev` oder `npm start`
7. Frontend starten: im `frontend`-Ordner `npm run dev`

Wenn bereits ein alter Docker-Volume mit einer früheren Datenbankstruktur existiert, muss die Datenbank neu initialisiert oder das Schema manuell aktualisiert werden. Für eine frische lokale Testdatenbank kann `docker compose down -v` und danach `docker compose up -d` verwendet werden.

## Umgebungsvariablen

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=fittrack
DB_PORT=3306
PORT=3001
JWT_SECRET=change-this-secret
CORS_ORIGIN=http://localhost:5173
```

Optional kann im Frontend eine eigene API-URL gesetzt werden:

```env
VITE_API_BASE_URL=http://localhost:3001/api
```

## Deployment

Die Deployment-Checkliste befindet sich in `docs/DEPLOYMENT.md`. Wichtig: `database/schema.sql` ist für lokale Neuinitialisierung gedacht und darf nicht unkontrolliert auf produktive Daten ausgeführt werden.
