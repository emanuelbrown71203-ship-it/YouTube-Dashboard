---
name: ship
description: Put a change to the YouTube dashboard live, in the right order, and prove each step landed. Use whenever the owner wants a change live, after it works locally.
---

# Ship a change to the YouTube dashboard

Live is three parts that go up in this order, so each one only ever meets a version of the
next that it understands: the **database**, then the **backend** (edge function `yt-api`),
then the **site**. Skip a part that did not change. Never put a key, a password or the
owner's numbers in the repository: it is public.

## 0. Before anything goes live

```bash
service postgresql start            # the setup script leaves it stopped
npx tsx dev/reset-db.ts yttest && npm test
npm run typecheck && npm run build
```

Then run the app locally (`npm run dev:local` and `npm run dev`) and drive every changed
screen at phone size with Playwright, typing into boxes one key at a time. Nothing may be
wider than the screen. Commit and push to the working branch.

## 1. Database (when there is a new file in `supabase/migrations`)

1. Prove it locally: `npx tsx dev/reset-db.ts yttest` runs every migration; apply the new
   file to `ytdash` with `psql -v ON_ERROR_STOP=1 -f`; run `npx tsx dev/gen-types.ts`.
2. If it replaces a function or view, read the live definition first
   (`pg_get_functiondef`) and make sure nothing in it is lost.
3. Apply it with the Supabase connector's `apply_migration`, the file's exact contents,
   named like the file (`yt_018_...`).
4. Check it landed: query `information_schema` or the function for what changed.

## 2. Backend (when `supabase/functions/yt-api` changed)

1. Check `index.ts` with Deno from a copy outside the repository:
   `cp -r supabase/functions/yt-api <scratch>/fn && deno check --node-modules-dir=none <scratch>/fn/index.ts`.
2. Bundle it: `npm run bundle:fn` writes `dev/deploy/yt-api/index.js` (one file, the same
   code without comments and types; the source is too big for one deploy call). Run the
   bundle once in Deno from a copy outside the repository, with `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEYS='{}'` and `SUPABASE_DB_URL` pointing at the local database, and
   check `curl localhost:8000/functions/v1/yt-api/health` gives `{"ok":true}`.
3. Deploy with the connector's `deploy_edge_function`: project `nivsnjvrsqekyocvtema`,
   name `yt-api`, entry `index.js`, `verify_jwt` false, the one file `index.js`, byte for
   byte. It is large, so hand this to one helper agent with exactly that instruction and
   nothing else to do, and change no source or bundle file while it reads.
4. Prove it: call `get_edge_function` (its long answer is saved to a file), then
   `python3 -I dev/compare-deployed.py --bundle <that file>`. It must end with `MATCH`.
5. Check it answers: `curl https://nivsnjvrsqekyocvtema.supabase.co/functions/v1/yt-api/health`
   should give `{"ok":true}`. (Where the session's network does not allow that address, use
   `net.http_get` from SQL as CLAUDE.md describes.)

## 3. Site

1. `create_deployment` with the Vercel connector, for the project `youtube-dashboard` (find
   its team and project ids with `list_teams` and `list_projects`), target `production`, gitSource
   `{type: "github", org: "emanuelbrown71203-ship-it", repo: "YouTube-Dashboard", ref: <branch>, sha: <pushed commit>}`.
2. Wait for `READY` with `get_deployment`.
3. Prove it: the script named in `dist/index.html` of your build must be the one the live
   site serves (`curl -s https://youtube-dashboard-ashen-six.vercel.app/ | grep -o 'assets/index-[^"]*\.js'`).

## 4. Tell the owner

In plain words: what changed, what they will see, that they may need to close and reopen
the app once, and anything that did not go as planned.

## Things that must stay true

- The scheduler's secret never leaves the database: build any call that needs it inside SQL.
- No step removes a table, a column or a row; bin things with `trashed_at`.
- Only `yt_` objects: the database is shared with the owner's other apps.
