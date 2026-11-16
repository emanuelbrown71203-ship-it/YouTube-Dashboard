# Running everything locally

Nothing in this folder is deployed. It lets you run and test the whole app on
one machine, with no Supabase project, no Google account and no network.

| File | What it is |
|---|---|
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
