# Reading Partner server

Account and device registration for the app (docs/platform/665). One Vercel Function, `POST /api/register`, backed by Neon Postgres, plus the static privacy policy and terms in `public/`.

## Deploy

1. In Vercel, import this repository as a new project. Set **Root Directory** to `server`. Framework preset: Other. No build command.
2. Under **Storage**, add a Neon Postgres database and connect it to the project. The integration injects `DATABASE_URL`.
3. Under **Settings > Environment Variables**, add `GOOGLE_DESKTOP_CLIENT_ID` with the desktop OAuth client ID (the app's `VITE_GOOGLE_CLIENT_ID`). The iOS and Android client IDs are in `lib/config.ts`.
4. Create the tables: open the Neon SQL editor (or `psql "$DATABASE_URL"`) and run `schema.sql`.
5. Deploy. Put the deployment URL (e.g. `https://<project>.vercel.app`) into `src/platform/account/endpoint.ts` in the app.

The pages are served at `/privacy` and `/terms`.

## API

`POST /api/register`, JSON body:

```json
{
  "idToken": "<Google id_token>",
  "device": { "id": "<uuid>", "platform": "ios", "osVersion": "18.1", "model": "iPad14,1", "appVersion": "0.26.2" }
}
```

The id_token is verified against Google's JWKS (signature, issuer, expiry, audience). Answers `200 {"ok":true}`, `400` for a malformed body, `401` for a token that does not verify. The server does not log request bodies and does not store IP addresses.

## Develop

```sh
cd server
bun install
bun test tests      # unit tests (also run by scripts/t.sh at the repo root)
bun run typecheck
```
