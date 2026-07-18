# FitTrack Frontend

Vue 3 + Vite Frontend für FitTrack.

## Setup

```sh
npm ci
```

## Entwicklung

```sh
npm run dev
```

Das Frontend verwendet standardmässig den gleichen Origin unter `/api`. In der lokalen
Entwicklung leitet Vite diesen Pfad an `http://localhost:3001` weiter. Beide Werte können
über `VITE_API_BASE_URL` und `API_PROXY_TARGET` angepasst werden; siehe `.env.example`.

## Build

```sh
npm run build
```

## Tests

```sh
npm run test:run
```

Für den lokalen Watch-Modus kann `npm test` verwendet werden.
