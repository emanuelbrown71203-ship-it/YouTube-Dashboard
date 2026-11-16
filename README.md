# YouTube Dashboard

A private dashboard for one YouTube channel. It keeps the channel's numbers,
holds a board of long-form and Shorts ideas, and has its own research tools
for finding what is working elsewhere on YouTube. Claude can read all of it,
so questions about the channel get answered from the real numbers.

## What is in it

| Screen | What it does |
|---|---|
| **Overview** | Opens with a sentence built from the numbers ("Views are down 32% on the 28 days before"), then views, watch time, engaged views and subscribers over time, split by Shorts, long-form and live, with a pin on every day something was uploaded. |
| **Videos** | Every upload with its stats, how it compares with the channel's usual, where its views came from (search or recommendations), and plain checks worth fixing: tags copied from another video, repeated titles, crowded titles. |
| **Ideas** | A board for video ideas, from first thought to published. Each idea is long-form or a Short, and is marked as made for the feed or for search. |
| **Research: Outliers** | Videos on a topic that beat their own channel's usual views by a wide margin, either breaking out right now or still being found in search months later. Results are compared with the channel's own uploads. |
| **Research: Search phrases** | What people type into YouTube search, and for any phrase how much demand there is and how hard it is to rank for at this channel's size. |
| **Research: Channels** | A watch list of other channels, measured the same way as this one, with their recent breakouts. |
| **Settings** | Connect YouTube, sync now, sign in other devices, copy the numbers for a Claude chat. |

## How it works

```
Browser (Vite + React, src/)
   |  reads tables and views, row level security lets only the owner in
   v
Supabase Postgres (supabase/migrations, everything prefixed yt_)
   ^
   |  writes stats and research results
Edge function "yt-api" (supabase/functions/yt-api)
   |  Google sign-in, sync every 6 hours, research lookups
   v
YouTube Data API + YouTube Analytics API (read-only)
```

- **Who gets in.** Each browser signs in anonymously and can read nothing
  until it is put on the owners list, either by signing in with the Google
  account that owns the channel or by entering a one-time code. Stats tables
  are written only by the edge function.
- **Sync.** Once YouTube is connected, a scheduled job pulls the channel,
  every upload, daily Studio numbers, 28-day breakdowns and per-video traffic
  sources every six hours. Nothing is ever written back to YouTube: the app
  asks Google for read-only access.
- **Nothing is hard-removed by the app.** Ideas go to a bin, signed-out
  browsers are switched off, used codes are marked used.

## How the research numbers are worked out

YouTube does not publish search volumes or outlier scores, so the app computes
its own from public data and says so on screen.

- **Usual views** for a channel and format: the middle value (median) of its
  last 30 uploads in that format, leaving out anything under two days old.
- **Outlier score**: a video's views divided by its channel's usual views.
  5x means five times what that channel normally gets. Channels with fewer
  than five uploads in the format get no score.
- **Search phrase scores** come from the videos that rank for the phrase
  today (0 to 100 each):
  - *Demand*: how many views a day the top ten results earn.
  - *Competition*: how big the ranking channels are, how many already use the
    phrase in their title, and how few small channels made it in.
  - *Opening*: half demand, half lack of competition.

The exact formulas live in `supabase/functions/yt-api/scoring.ts` and are
covered by `tests/scoring.test.ts`.

Google gives each account 10,000 free lookups a day. A search costs 100, so
the app keeps count, shows the meter on the Research screen, and stops
research at 9,000 so the automatic sync always has room.

## Setting it up from scratch

1. **Database.** Apply the files in `supabase/migrations` in order to a
   Supabase project with anonymous sign-ins enabled.
2. **Edge function.** Deploy `supabase/functions/yt-api` (all six files) with
   JWT verification off; the function checks its callers itself.
3. **Frontend.** Put the project URL and publishable key in `.env`, then host
   the static build (`npm run build`, output in `dist`). `vercel.json` has the
   settings and security headers for Vercel.
4. **Allowed addresses.** Add the site's address to the `allowed_origins`
   list in `yt_private`, so Google sign-in may return there.
5. **First sign-in.** Run `select public.yt_create_access_code();` in the SQL
   editor and enter the code on the site.
6. **Connect YouTube.** Follow the steps on the Settings screen. It needs a
   free Google Cloud project with the YouTube Data API v3 and YouTube
   Analytics API switched on, and a web OAuth client whose redirect address
   is the one the screen shows.

## Working on it

```bash
npm install
npm test            # unit tests, plus backend tests when a local Postgres is reachable
npm run typecheck
npm run build
```

To run the whole app on your machine with no cloud services, see
[`dev/README.md`](dev/README.md). It uses a local Postgres, a small stand-in
for the hosted backend, and a made-up YouTube that answers like the real API.

## Where things are

```
src/                      the app
  pages/                  one file per screen
  components/             charts and shared pieces
  lib/                    data access, number formatting, stats, upload checks
supabase/migrations/      the database, in six small files
supabase/functions/yt-api the edge function (auth, sync, research, scoring)
dev/                      local stand-ins for the backend and for YouTube
tests/                    scoring, stats and end-to-end backend tests
CLAUDE.md                 how Claude reads and works with this dashboard
```
