# Working on the YouTube Dashboard

This repo is a private dashboard for one YouTube channel (TheRealZay2K,
channel id `UChsuiSVwIF3O23DdjL907jg`). The owner uses it to track stats, plan
long-form and Shorts ideas, and research what works elsewhere on YouTube. They
want Claude to already know their numbers when they ask a question.

The owner is a creator, not a developer. Write to them in plain language, give
answers from the data, and keep technical detail out unless they ask.

## Answering questions about the channel

Everything lives in the Supabase project **zay-apps** (ref
`nivsnjvrsqekyocvtema`), in tables prefixed `yt_`. The project is shared with
other apps (`pa_*`, `households`...): never touch anything without the `yt_`
prefix.

Start with the one-call briefing, then query deeper only if needed:

```sql
select public.yt_claude_context();
```

It returns the channel, the last 28 days against the 28 before, the split by
format, recent and top uploads, 28-day breakdowns, the ideas board, saved
research and the last sync. Every table and view has a comment explaining it;
`list_tables` shows them. The ones you will use most:

| Table or view | What it holds |
|---|---|
| `yt_v_videos` | One row per upload with derived numbers: `views_per_day`, `vs_typical` (views against the 20 uploads before it in the same format; this is the channel's own outlier score), `search_pct`, `recommended_pct`, `discovery`. Prefer this over `yt_videos`. |
| `yt_analytics_daily` | Channel-wide Studio numbers per day: views, engaged views, minutes watched, subscribers gained and lost. |
| `yt_content_type_daily` | The same per day and format (`short`, `long`, `live`). |
| `yt_video_analytics_daily` | Day-by-day numbers for uploads in their first weeks. |
| `yt_reports` | Latest 28-day breakdowns as JSON: traffic sources, countries, age and gender, devices, top videos. |
| `yt_v_my_formats` | Usual views and upload pace per format. |
| `yt_v_ideas` | The ideas board (ideas in the bin are left out). |
| `yt_research_videos`, `yt_keywords`, `yt_research_channels`, `yt_research_runs` | Outliers found, phrases scored, channels watched, and every research run with what it returned. |
| `yt_sync_runs` | Sync history. Check the newest row before trusting freshness. |
| `yt_goals`, `yt_tests`, `yt_video_changes` | The owner's goals, their title and thumbnail tests (what they changed, what they expected, how it went), and every title or thumbnail change the sync noticed. |
| `yt_comments` | Recent comments with the AI's reading: `sentiment`, `theme`, `is_question`. `pinned` ones sit on the front page. |

`yt_v_videos` also carries `topic` (the game), `estimated_revenue` and `feeders`
(which videos sent viewers to a long video). `yt_research_videos.explanation`
holds the AI's plain-English notes on an outlier.

Things to keep in mind when reading the numbers:

- YouTube's analytics trail by two to three days. "Last 28 days" ends at the
  newest day that has data, not today.
- Since 2026-08-27 YouTube counts a view from the first frame, which raised
  view counts (about 1.7 to 1.9 times on long-form). Compare `engaged_views`
  across that date, not `views`.
- `avg_view_pct` can exceed 100 on Shorts because they loop.
- Until YouTube is connected the tables hold a partial snapshot (the newest
  uploads and the all-time top videos). `vs_typical` and "usual views" are not
  meaningful on a partial library; say so rather than quote them.
- Keyword scores are estimates from the videos that rank today, not search
  volumes. Say "estimate" when you quote one.

Do not spend the owner's vidIQ credits unless they ask you to. The research
tools here exist so that is not needed.

## Changing things for the owner

- **Add or edit an idea**: insert into or update `public.yt_ideas`
  (`source = 'claude'`). Fields: `title`, `format` (`long` | `short`),
  `status` (`idea` > `scripting` > `filming` > `editing` > `scheduled` >
  `published`), `discovery` (`recommended` | `search`), `target_keyword`,
  `hook`, `concept`, `outline`, `thumbnail_concept`, `title_options`,
  `priority` (1 high to 3 low), `target_date`, `notes`.
- **Never hard-remove rows.** To bin an idea set `trashed_at = now()`. Browsers
  are switched off with `revoked_at`, codes with `used_at`.
- **Never write the stats tables by hand.** They belong to the sync.
- **Add a goal or a test**: insert into `public.yt_goals` (`kind`:
  `subscribers` | `video_views` | `personal`, with `target`, `start_value`,
  `video_id`) or `public.yt_tests` (`video_id`, `kind`, `what`, `why`,
  `started_on`). Bin either with `trashed_at`.
- **Let a new device in**: `select public.yt_create_access_code('note');`
  returns a one-time code that works for 24 hours (up to 7 days with a second
  argument). Give the code to the owner in the chat.
- **Run research for them**: call the deployed function's `/research` route
  from the app, or read what earlier runs found in `yt_research_runs`.

## How it is built

- `src/`: Vite + React + TypeScript. Reads go straight to Supabase with the
  publishable key; row level security lets only owners in.
- `supabase/migrations/`: eight files, all `yt_` objects. No statement in them
  removes anything.
- `supabase/functions/yt-api/`: one edge function, deployed with JWT
  verification off because it checks callers itself. Routes: `/auth/setup`,
  `/auth/start`, `/auth/callback`, `/auth/finish`, `/auth/disconnect`, `/sync`,
  `/research`, `/ai/setup`, `/health`. Google sign-in only lets a browser in when the same
  browser that started it comes back with the secret it kept (`/auth/finish`);
  do not weaken that. `index.ts` is the only Deno-specific file; the rest take their
  database client, `fetch` and clock as arguments so tests can replace them.
  Supabase stops accepting the older `anon` key at the end of 2026, so the app
  sends the publishable key from `.env` and `index.ts` reads the function's
  `SUPABASE_PUBLISHABLE_KEYS`; do not go back to `SUPABASE_ANON_KEY`.
- The AI helper (`growth.ts`, called through `deps.claude` in `index.ts`) uses
  the owner's own Claude API key from `yt_private` and the official SDK. It
  describes outliers, sorts comments into themes and names the game each
  video is about. It only ever sees text, never video, and the screens say so.
  Earnings and comments each need an optional Google permission, recorded in
  `google_scopes`; the sync skips what was not granted.
- `dev/`: a local stand-in for the hosted backend (`server.ts`), a made-up
  YouTube (`mock-youtube.ts`) and a database reset script.

## Rules for this repo

- **The repository is public.** Never commit the owner's stats, a database
  dump, a seed with real numbers, or any secret. The Supabase URL and the
  publishable key in `.env` are public by design.
- Google's client secret and refresh token live only in `yt_private`, which
  no browser can read. Never ask the owner to paste a secret into a chat; the
  Settings screen has a form for it.
- Write copy the way the app already does: plain words, sentence case, no
  jargon, errors that say what happened and what to do.
- Charts follow the palette in `src/styles/app.css`: blue for Shorts, orange
  for long-form, green for live, one blue ramp for "how many times the
  usual". Text never takes a series colour.

## Before you say something works

```bash
npx tsx dev/reset-db.ts yttest   # needs a local Postgres, see dev/README.md
npm test                         # scoring, stats, and the backend end to end
npm run typecheck && npm run build
```

`npm run dev:local` plus `npm run dev` runs the whole app locally against the
made-up YouTube; drive it in a browser before calling a screen done.

## Shipping changes

- **Database**: add a new numbered file in `supabase/migrations`, prove it on
  the local database, then apply it with the Supabase connector's
  `apply_migration`. Supabase asks the owner to confirm and waits only 60
  seconds, so make that call the first thing you do after they reply, and
  tell them a prompt is coming. Regenerate `src/lib/database.types.ts` with
  `npx tsx dev/gen-types.ts`.
- **Edge function**: `deploy_edge_function` with every file in
  `supabase/functions/yt-api` (entry `index.ts`, `verify_jwt` false). The
  type check and the tests skip `index.ts`; check it with Deno first, from a
  copy of the folder outside the repository (see `dev/README.md`). Afterwards confirm the live function answers (next
  section) and that `get_edge_function` returns the files you sent.
- **Site**: the Vercel project `youtube-dashboard`, built from this
  repository with the settings in `vercel.json`. Vercel's production branch
  is `main`, which holds only a README until the work is merged, so a push
  to the working branch makes a preview and nothing more. To put a change
  live, start a production deployment of the branch with the Vercel
  connector (`create_deployment`, target `production`). The site's public
  address is the first entry of the `allowed_origins` JSON list in
  `yt_private`; the project's other Vercel addresses sit behind Vercel's own
  login. If the address changes, update that list or Google sign-in will
  refuse to return there.
- Do not create hosting projects, publish the site, or open a pull request
  unless the owner asks.

## Checking the live app from a cloud session

Cloud sessions cannot reach `supabase.co` or `vercel.app`, so neither `curl`
nor a browser here can open the live app. Ask the database to make the
request and read the answer back:

```sql
select net.http_get(url := 'https://nivsnjvrsqekyocvtema.supabase.co/functions/v1/yt-api/health');
select status_code, left(content, 300) from net._http_response where id = 123;  -- the id the first line returned
```

Answers are kept for about six hours. Read only the rows for requests you
made: that table is shared with the other apps. To see what a signed-in
browser sees, sign up an anonymous user (`POST /auth/v1/signup` with the
publishable key in the `apikey` header), redeem a code minted for the check,
call the routes with that session, and switch the test browser off again
with `revoked_at` when you are done. Build the headers inside SQL so the
session token never leaves the database.
