# FitTrack Deployment

Diese Checkliste trennt lokale Entwicklung von produktivem Betrieb.

## Backend

1. `backend/.env.example` zu `backend/.env` kopieren.
2. In Production zwingend setzen:
   - `NODE_ENV=production`
   - `JWT_SECRET` mit einem langen, zufaelligen Secret
   - `CORS_ORIGIN` mit der finalen Frontend-URL
   - `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`
3. Dependencies installieren:

```sh
npm install
```

4. Syntaxcheck ausfuehren:

```sh
npm test
```

5. Backend starten:

```sh
npm start
```

## Frontend

1. `frontend/.env.example` zu `frontend/.env` kopieren.
2. `VITE_API_BASE_URL` auf die produktive API setzen, zum Beispiel:

```env
VITE_API_BASE_URL=https://example.ch/api
```

3. Production-Build erstellen:

```sh
npm run build
```

4. Den Inhalt von `frontend/dist` beim Hoster ausliefern.

## Datenbank

`database/schema.sql` ist fuer lokale Neuinitialisierung gedacht. Die Datei droppt bestehende Tabellen und darf nicht unkontrolliert auf produktiven Daten ausgefuehrt werden.

Fuer Production gilt:

1. Datenbank und User beim Hoster anlegen.
2. Schema nur bei einer leeren Datenbank initialisieren.
3. Spaetere Schema-Aenderungen als explizite Migrationen ausfuehren und vorher ein Backup erstellen.
4. `database/seed.sql` nur verwenden, wenn die globalen Beispieluebungen in einer leeren Datenbank fehlen.

## Release-Pruefung

Vor dem Deployment:

- `npm.cmd test` im `backend`-Ordner
- `npm.cmd run build` im `frontend`-Ordner
- Login, Registrierung, Uebungen, Workouts, Fortschritt und Footer-Disclaimer manuell pruefen
- `/api/health` aufrufen
- Browser-Konsole auf Fehler pruefen
