# Running everything locally

Nothing in this folder is deployed. It lets you run and test the whole app on
one machine, with no Supabase project, no Google account and no network.

| File | What it is |
|---|---|
| `compare-deployed.py` | Compares the edge function Supabase is running (the saved answer of the connector's `get_edge_function`) with what is deployed, byte for byte: with `--bundle`, the one file `npm run bundle:fn` builds in `dev/deploy/yt-api` (how it is deployed now); without, `supabase/functions/yt-api` itself. |
| `reset-db.ts` | Rebuilds a local Postgres database: a small stand-in for Supabase's own schemas (`supabase-stub.sql`), then every migration in order. |
| `server.ts` | A stand-in for the hosted backend on port 54321: anonymous sign-in, the part of the REST interface the app uses (with row level security enforced), and the real `yt-api` code. |
| `mock-youtube.ts` | A made-up YouTube: sign-in, the Data API, the Analytics API and search suggestions, answering with invented channels and videos in the real response shapes. |
| `gen-types.ts` | Writes `src/lib/database.types.ts` from a local database. |

## One-time setup

You need PostgreSQL 15 or newer running locally and a superuser the scripts
can log in as:

```sql
create role ytdev login superuser password 'ytdev';
```

Use a different login by setting `YT_ADMIN_URL` (for `reset-db.ts`) and
`YT_DEV_DB` (for `server.ts`).

## Run the app

```bash
npx tsx dev/reset-db.ts ytdash                 # empty database with the schema
printf 'VITE_SUPABASE_URL=http://localhost:54321\nVITE_SUPABASE_KEY=local\n' > .env.development.local
npm run dev:local                               # the backend stand-in
npm run dev                                     # the app, on http://localhost:5173
```

Get a sign-in code from the local database and enter it in the app:

```bash
psql postgresql://ytdev:ytdev@localhost:5432/ytdash -Atc "select public.yt_create_access_code()"
```

Then open Settings, paste any client ID that ends in
`.apps.googleusercontent.com` and any secret, and press Sign in with Google.
The stand-in skips Google's screen, signs you in as the channel owner and
syncs from the made-up YouTube, so every screen has data and the research
tools work.

To see what happens when the wrong Google account signs in, start the backend
with `YT_DEV_GOOGLE_CHANNEL` set to another channel id from the mock.

## Tests

```bash
npm test
```

`tests/scoring.test.ts` and `tests/lib.test.ts` need nothing. `tests/handlers.test.ts`
rebuilds a database called `yttest` and runs the edge function's routes
against it and the made-up YouTube: sign-in, the first sync, repeat syncs,
every research action, the daily budget and the error paths. It is skipped
when no local Postgres answers.

## Checking the entry file

`supabase/functions/yt-api/index.ts` only runs on Deno, so the tests and
`npm run typecheck` leave it out. Before deploying a change to it, install
Deno somewhere outside the repository (`npm i deno` in a scratch folder
works) and run:

```bash
# from a copy outside the repository, so Deno fetches the function's own packages
cp -r supabase/functions/yt-api /tmp/yt-api-check && deno check /tmp/yt-api-check/index.ts

SUPABASE_URL=http://localhost:54321 \
SUPABASE_DB_URL=postgresql://ytdev:ytdev@localhost:5432/ytdash \
SUPABASE_PUBLISHABLE_KEYS='{"default":"local"}' \
  deno run -A /tmp/yt-api-check/index.ts
```

With `npm run dev:local` running beside it, the function answers on
`http://localhost:8000/yt-api/...` the way it does once deployed, with the
stand-in checking who is signed in. `/health` should say `{"ok":true}`, and
`/sync` with the `x-cron-secret` from `yt_private` should say YouTube is not
connected yet.
