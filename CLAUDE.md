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
| `yt_v_ideas` | The ideas board (ideas in the bin, and suggestions still waiting in the Suggested tab, are left out). |
| `yt_research_videos`, `yt_keywords`, `yt_research_channels`, `yt_research_runs` | Outliers found, phrases scored, channels watched, and every research run with what it returned. |
| `yt_sync_runs` | Sync history. Check the newest row before trusting freshness. |
| `yt_goals`, `yt_tests`, `yt_video_changes` | The owner's goals (each with a `plan`: steps as checkboxes), their title and thumbnail tests (what they changed, what they expected, how it went), and every title or thumbnail change the sync noticed. |
| `yt_video_reach_daily`, `yt_v_video_reach` | Impressions and click-through rate per video, per day and over the newest 28 days. From YouTube's bulk reach report, a day or two behind; empty until the YouTube Reporting API is on in Google Cloud. |
| `yt_video_pulse` | The live public view count of each upload, noted about once an hour in its first 3 days. With `yt_videos.published_at` it gives views by hours since publishing: the first 48 hours tracker. Only exists for uploads after 2026-11-17; older uploads are compared through their first days in `yt_video_analytics_daily`. |
| `yt_templates` | The owner's own templates: what a title, a thumbnail or an intro of theirs should have, plus `other` ones (storytelling, retention, Shorts, their checklists) (`kind`, `name`, `body`, usually one point per line). `active` ones are used: ideas are checked against the title, thumbnail and intro ones (the AI's reading is kept in `yt_ideas.template_check`), and the AI helpers follow all of them. Follow these when you suggest titles, thumbnails, openings or scripts. |
| `yt_idea_refs` | Thumbnail references kept with an idea: other people's videos (`video_id`, with title, channel, views and `outlier_score` copied in), or a screenshot the owner added (no `video_id`; `image` and `image_small` hold it as JPEG data, framed to the thumbnail in the browser by `src/lib/pictures.ts`), and the owner's `note` on what to take from each. A video's picture is `https://i.ytimg.com/vi/<video_id>/mqdefault.jpg`. Lists never select the two image columns: read one row's picture at a time. |
| `yt_notes` | Lines the owner wants to remember (from a podcast, a video, anywhere): `text`, `source`, `source_url`, `topic`. `on_front` ones show on the front page. |
| `yt_comments` | Recent comments with the AI's reading: `sentiment`, `theme`, `is_question`. `pinned` ones sit on the front page. |
| `yt_idea_thumbs` | The owner's own thumbnails for an idea, one row per version to compare (`image`, `image_small` as JPEG data, framed in the browser; lists never select them), each with its two-way `score`. |
| `yt_scripts` | Scripts the owner wrote for past videos (`title`, `topic`, `body`, `source_url`, and `video_id`: the upload it was for, which the owner picks on My scripts, so how that video did counts in their track record): their intros, the beats they hand their editor with directions in brackets, and voiceover written against the cut. Playbook → My scripts. The script starter reads the two closest (same game first) to write in their voice. |
| `yt_editor_notes` | Notes for the owner's editor, read from markers they export from Premiere Pro, kept per video idea (`idea_id`, `name` = which cut, `markers` = `{at, end, name, note, type}`). Idea editor → For my editor, and Ideas → For my editor. |
| `yt_editor_docs` | The Google Doc each video's notes for the editor went into (`idea_id`, `doc_id`, `doc_url`, `pushed_at`). Written only by the server. |
| `yt_swings` | Daily idea swings done (`day` = the owner's own date, `kind` = full, segment, short or upgrade, `idea_id` = the idea it wrote or upgraded, `levers` ticked on an upgrade). Ideas a swing wrote have `source = 'swing'`. |
| `yt_rhythm` | The owner's upload rhythm: one target per format (`long`, `short`, `live`), "post at least every `every_days` days". `active = false` switches one off. Home shows the days since the last upload of that format against it. |

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
- An outlier has to have reached a real audience, not only beaten its
  channel's usual: at least 10,000 views on long-form and 100,000 on Shorts
  (`MIN_OUTLIER_VIEWS`, `isBreakout` in `scoring.ts`). The owner aims at
  50,000 views, and a tiny channel's 7x on 504 views was "a horrible
  starting point". Breakouts, idea check examples and scores, thumbnail
  references, the suggestion and script helpers and the Outliers search all
  use the floor. Never offer a video under it as a reference or a model.

Do not spend the owner's vidIQ credits unless they ask you to. The research
tools here exist so that is not needed. The dashboard's own YouTube lookups are
free and the owner has said to use them whenever a score needs them.

## Changing things for the owner

- **Add or edit an idea**: insert into or update `public.yt_ideas`
  (`source = 'claude'`). Fields: `title`, `format` (`long` | `short`),
  `status` (`idea` > `scripting` > `filming` > `editing` > `scheduled` >
  `published`), `discovery` (`recommended` | `search`), `target_keyword`,
  `hook`, `concept`, `outline`, `thumbnail_concept`, `title_options`,
  `priority` (1 high to 3 low), `target_date`, `notes`, and `topic`: the
  game the idea sits under, spelled like `yt_videos.topic` ("Elden Ring").
  Always set it; the board groups by it.
  The owner writes an idea most days, so a new idea is only an idea and sits
  under its game. Set `picked_at = now()` only when they say they have
  decided to make it: that puts it on the production board (Group by Stage),
  where `status` says how far along it is (`idea` = picked, not started).
  Never set `status` past `idea` without `picked_at`.
  Rows with `in_suggested = true` are suggestions the dashboard wrote that
  wait in the Suggested tab; they are not the owner's ideas until kept
  (`in_suggested = false`). `suggestion` says why each was suggested.
- **Save a template for them**: insert into `public.yt_templates` (`kind`:
  `title` | `thumbnail` | `intro` | `other`, `name`, `body`).
- **Save a line for them**: insert into `public.yt_notes` (`text`, and
  where it came from in `source`). Bin with `trashed_at`.
- **Bullets and checkboxes**: the note-style fields (an idea's `concept`,
  `outline` and `notes`, a goal's `notes`, a test's `learned`, a line's
  `text`, a template's `body`) are plain text where a line starting with
  `- ` shows as a bullet and `- [ ] ` or `- [x] ` as a checkbox the owner
  can tick in the app. Write steps and checklists that way. Ticking only
  rewrites that marker (`src/lib/notes.ts`, `src/components/notes.tsx`).
  When a template goes to the AI the markers are taken off, so a tick is
  never read as "this point is met".
- **Line by line, always.** Anything written for the owner (templates,
  hooks, what happens, outlines, scripts, plans, idea challenges) goes one
  short thought per line, never a paragraph, with shot directions in
  [square brackets] on their own lines: their words, it is "a lot easier to
  digest". The backend enforces it on everything the AI writes
  (`lineByLine` and `sentences` in `growth.ts`; script beats put each
  sentence under the beat as a sub-bullet), and the connector is told to.
- **Never hard-remove rows.** To bin an idea set `trashed_at = now()`. Browsers
  are switched off with `revoked_at`, codes with `used_at`.
- **Never write the stats tables by hand.** They belong to the sync.
- **Add a goal or a test**: insert into `public.yt_goals` (`kind`:
  `subscribers` | `video_views` | `personal`, with `target`, `start_value`,
  `video_id`; a `video_views` goal with no `video_id` is met by any video of
  its `format`: `short` | `long` | `live`; `notes` = why it matters; `plan` =
  the steps to get there as `- [ ] ` checkboxes under plain heading lines.
  Every goal should have a plan, the owner's words: write one with it) or `public.yt_tests` (`video_id`, `kind`, `what`, `why`,
  `started_on`). Bin either with `trashed_at`.
- **Let a new device in**: `select public.yt_create_access_code('note');`
  returns a one-time code that works for 24 hours (up to 7 days with a second
  argument). Give the code to the owner in the chat.
- **Run research for them**: call the deployed function's `/research` route
  from the app, or read what earlier runs found in `yt_research_runs`.

## How it is built

- `src/`: Vite + React + TypeScript. Reads go straight to Supabase with the
  publishable key; row level security lets only owners in.
- `supabase/migrations/`: twenty-five files, all `yt_` objects. No statement in them
  removes a table, a column or a row (017 only lets `yt_idea_refs.video_id` be
  empty, for screenshots).
- `supabase/functions/yt-api/`: one edge function, deployed with JWT
  verification off because it checks callers itself. Routes: `/auth/setup`,
  `/auth/start`, `/auth/callback`, `/auth/finish`, `/auth/disconnect`, `/sync`,
  `/sync/extras`, `/sync/pulse`, `/research`, `/ai/setup`, `/ai/titles`,
  `/ai/check`, `/ai/import`, `/ai/script`, `/ai/plan`, `/ai/score`, `/ai/intro`, `/editor/doc`, `/ideas/check`, `/ideas/suggest`,
  `/mcp/setup`, `/mcp/<secret>`, `/health`. `/sync/pulse` runs every hour (cron job `yt-pulse`, scheduler
  secret only): it spots a new upload and starts a sync, or notes the live
  view counts of uploads in their first 3 days; two lookups each time. A sync does the quick
  work, then has the database call `/sync/extras` (scheduler secret only) for
  the slow work: the AI naming games and reading comments, and what feeds the
  long videos. Extras work for under a minute and ask for another turn while
  anything is left, so no request runs out of time; their results are added
  to the same `yt_sync_runs` row under `games`, `comments_read`, `feeders`. Google sign-in only lets a browser in when the same
  browser that started it comes back with the secret it kept (`/auth/finish`);
  do not weaken that. `index.ts` is the only Deno-specific file (eleven files in the folder); the rest take their
  database client, `fetch` and clock as arguments so tests can replace them.
  Supabase stops accepting the older `anon` key at the end of 2026, so the app
  sends the publishable key from `.env` and `index.ts` reads the function's
  `SUPABASE_PUBLISHABLE_KEYS`; do not go back to `SUPABASE_ANON_KEY`.
- The AI helper (`growth.ts`, called through `deps.claude` in `index.ts`) uses
  the owner's own Claude API key from `yt_private` and the official SDK. It
  describes outliers, sorts comments into themes and names the game each
  video is about. It reads text, and looks at pictures only to score a thumbnail the owner
  added (with their past thumbnails and breakout ones beside it, `pieces.ts`). It never
  sees video, and the screens say so.
  Earnings and comments each need an optional Google permission, recorded in
  `google_scopes`; the sync skips what was not granted.
- Claude's connector (`mcp.ts`) is a Model Context Protocol server at
  `/mcp/<secret>`, for the owner's Claude app: it reads the briefing and
  adds or edits ideas, lines and templates. The secret is made in Settings,
  shown once and stored only as a hash (`mcp_token_hash` in `yt_private`).
  Whoever holds the address can use the tools, so keep them to reading the
  briefing and writing the owner's own notes: nothing that removes a row,
  touches the stats, or returns anything from `yt_private`.
- Idea scores (`src/lib/ideaScore.ts`) are worked out in the browser, not
  stored: "Your history" (the game's track record in that format, which
  kinds of title have beaten the owner's usual, a hint from the other
  format, momentum) and "Recommended" (how this exact video did for the
  channels that made it, the game as a whole, the share of views YouTube's
  recommendations brought, the title). A part with too little evidence is
  left out and said so; under half the evidence gives no number. They are
  estimates: say so.
  The biggest part of "Recommended" is the check on the idea itself
  (`coverIdeas` in `research.ts`): one YouTube search for the idea
  ("Elden Ring using only summons"), the results sorted into the same idea,
  the same kind of video, or neither (by the AI when its key is set, else
  by the idea's own words), and the ones that count set against their own
  channel's usual. It is stored as a `yt_research_runs` row of kind
  `outliers` with `params.mode = 'idea'` and `params.idea_id`; `summary`
  holds `same` and `close` (`n`, `scored`, `broke_out`, `median`, `newest`,
  `small`: only videos over the views floor are scored and counted, `small`
  says how many were left out) and a few `examples`, all over the floor
  (`min_views`). Checks stored before the floor are summed up again from
  their `results` at the start of the next pass (`resummariseChecks`), with
  no new lookups. A check lasts 30 days or until the idea's title or
  game changes, costs about 100 to 130 lookups, and identical ideas share
  one. To tell the owner how an idea looks, read that row. A search on the
  game alone cannot tell two ideas on the same game apart: it is only a
  small part of the score.
  The owner never has to search for a score to work: when a game with open
  ideas has no breakout search newer than 14 days, the dashboard runs one
  itself (`coverGames` in `research.ts`; the Ideas page asks for it through
  `/research` action `cover`, and `/sync/extras` does two more after each
  sync), and every idea filed under a game gets its own check the same way
  (`/sync/extras` does up to four a turn; opening the Ideas page starts a
  pass through `/ideas/check`). These spend the day's free lookups like any
  search, up to the same ceiling, and are stored with `params.auto = true`.
- Suggested ideas (Ideas, Suggested tab; `ideas.ts`, `src/pages/Suggested.tsx`):
  the dashboard writes ideas itself, as idea rows with `in_suggested = true`,
  so each gets the same YouTube check and scores as any idea before the
  owner sees it. A batch of 10 (8 long-form, 2 Shorts) comes every 7 days
  and whenever the owner taps Give me more; follow-ups (3) come when an
  upload beats its usual by 2x or more (the next part of a series first,
  then the same challenge on another of their games). The hourly pulse
  sees what is due and has the database call `/ideas/suggest` with the
  scheduler secret. The AI is given the owner's winners and flops, what is
  breaking out in their games and on other games, Shorts that did well,
  comment requests, their title templates, everything they already have or
  made, and the suggestions they kept and turned down. **Titles matter most
  to the owner**: a title must name the game and state the challenge
  plainly; `titleProblems` in `ideas.ts` throws out vague, shouting (two or
  more words in capitals; one for emphasis, like "EVERY", is the owner's
  style) or hype titles whatever the AI wrote, falling back to a clear alternative, and
  `isRepeat` drops the same video however it is worded (titles that differ
  in a number, like "Act 2" and "Act 3", are different videos). Keep sends
  one to the board; Not for me bins it and rules out only that video (the
  AI is told not to read it as that kind of challenge, title or format failing);
  ones left alone for 21 days are retired (`suggestion.expired`), which does
  not count as turned down. The tab shows only the newest batch on top (with
  follow-ups from the day before it or since) and folds every earlier batch,
  even one from minutes before, into "Earlier suggestions"
  (`src/lib/suggestions.ts`): after Give me more the owner sees just what
  was written, and never has to turn ideas down just to clear them.
- The owner's rules are a guide, not a law (their words: "there is always an
  exception to the rule"). Every AI helper gets their active templates and
  lines to remember with `OWN_RULES` (`growth.ts`): follow them by default,
  but where the evidence of what is working says otherwise, go with the
  evidence and say so. Do the same when you advise them. Titles carry the
  emotions they spark (curiosity, desire, fear: the owner colour-codes titles
  that way), and the title box in the editor counts against the length their
  own title template gives (`lengthRule` in `src/lib/emotions.ts`).
- Goals carry a plan (`yt_goals.plan`): steps the owner ticks off, counted by
  `planStatus` in `src/lib/growth.ts`. A goal row shows "Next step" and how
  many steps are done (on Home only that line, never the whole plan); a goal
  of their own, with no number to reach, shows its steps as its progress bar.
  "Draft a plan" in the goal editor (`/ai/plan`, `draftGoalPlan` in
  `growth.ts`) writes a first plan for a goal with none yet, from the
  channel's numbers, one kind of video at a time, with the owner's templates
  and lines, and says in one sentence how realistic the goal is.
- The script starter (Script fold in the idea editor; `/ai/script`) drafts
  a hook, what happens and timed beats with a shots checklist, from the
  idea, the owner's intro templates, the idea's YouTube check, their best
  titles, their lines to remember, and the two closest of their own past
  scripts (`pastScripts` in `ideas.ts`: same game first, then newest; the
  opening and the ending of each), so the draft takes their voice and habits:
  short spoken lines, a viewer's doubt in quotes answered straight after,
  callbacks, named threats, and directions for the editor in brackets. It fills empty parts and only offers
  the rest: it never overwrites what the owner wrote. Once the idea has cuts
  brought in from Premiere (`cutNotes` in `ideas.ts`), the button reads
  "Draft from Cut N": the beats follow the newest cut's own timeline, every
  note left on it becomes a direction for the editor or the voiceover for
  that stretch, and earlier cuts count only where the newest repeats them.
- Piece scores (`/ai/score`, `pieces.ts`; `src/pages/PieceScore.tsx`,
  `PieceScores.tsx`, `IntroScore.tsx`, `MyThumbnails.tsx`): a title (with the
  other titles, all at once), the intro, the script (hook, what happens and
  outline together) and the owner's own thumbnails are each scored two
  ways, like ideas: "Your history" (their own templates, and how their past
  titles, thumbnails and scripts did) and "Recommended" (next to the videos
  that broke out on the same idea, from its YouTube check, and in its game,
  only over the views floor, plus how a new viewer would react). The parts
  and what each is worth are `PIECE_PARTS` in `scoring.ts`; the AI scores
  each part 0 to 100 and `pieceSide` adds them up. A part with nothing to go
  on (no templates of that kind, no past script tied to its video, no idea
  check, no breakout pictures) is left out and says how to fix it, and a
  side with under half its evidence shows no number. The intro's "Your
  history" includes the intro formula: premise 20, problem 20, plug 5,
  payoff 15, emotions 20 (curiosity, desire or fear on each spoken line,
  like their titles: "just like a title it should hook with emotions"),
  hooks 10 and show it 10 (`INTRO_PARTS`), spoken lines numbered without the
  [directions] (`introLayout`). For thumbnails the AI is shown the owner's
  picture, up to 6 of their past thumbnails (best and weakest) and up to 5
  breakout ones from YouTube; any that will not load is left out. For
  intros and scripts it cannot see other people's videos, so "Recommended"
  there is its judgement against what the breakouts promised; say so. Each
  reading says what is missing, what could be better, and offers things to
  try (titles can be kept as options; nothing is rewritten for the owner).
  Readings are kept in `yt_ideas.title_check`, `intro_check`,
  `script_check` and `yt_idea_thumbs.score`, with `textKey` of what was
  scored so the editor says when it changed since. When the owner asks you
  to rate a title, intro, script or thumbnail, use the same parts and
  weights, and say they are estimates.
- The notebook (Ideas, the first tab at `#/ideas`; the board moved to
  `#/ideas/board`, and `#/ideas/notebook` still lands here;
  `src/pages/Notebook.tsx`, `src/lib/notebook.ts`): everything the owner
  wrote on ruled paper (margin line, punched holes, Caveat for headings,
  light and dark), one page at a time: the videos being made, then each game
  as a chapter in the board's order, then their lines to remember, a page per
  heading when a note is written in parts (`notePages`). Each video is its
  own set of pages in the order it is made (`videoPages`): Plan, Title,
  Intro (the hook and its score), Script (script starter, what happens,
  outline, script score), For my editor, Thumbnail (long-form only) and
  Notes, with divider tabs along the top (a tick when a page's steps are
  done, a mark on the one with the next step). The Plan page comes first:
  stage and date, a sticky note with the scores and the one next step with
  its button, and every step in order under Decide, Write it, Film it, Edit
  it and Post it (`planSteps` in `src/lib/nextStep.ts`). Steps tick
  themselves from what is written and added, never by hand; one the video
  moved past is "skipped", not done; the order inside each part matches
  `nextStep`, so the plan and Making now agree. Tapping any part of a page
  (or its Write button) writes on it there and saves with Save (`PaperText`);
  boxes tick and save without opening it; turning the page with unsaved
  writing asks first. Swipe or Next turns the page (onto the next video's
  plan at the end), "Skip to next video" jumps, Contents opens a chapter to
  its videos, and it reopens on the page they left (kept by its key, in
  this browser). Links in (`#/ideas?edit=<id>&open=<place>`, from Making
  now, the planner, Find, swings) open that video on its step's page
  (`pageOfPlace`); a published idea opens in the editor instead. New idea,
  and an idea started in Research, open the idea editor, then turn to the new
  idea's plan. "Open the full editor" keeps priority, made for, search
  phrase, the upload link and the bin. The owner asked for "everything its
  own piece of paper" and "my plan for each video at the beginning".
- Daily idea swings (Ideas → Daily swings; `src/pages/Swings.tsx`,
  `src/lib/swings.ts`): the owner's 15-minute routine, read from their own
  active template with "swing" in its name (`parseSwings`: each heading's
  minutes and points, and the score levers), so what they change there the
  app follows. One swing at a time with its own countdown (it only nudges,
  never stops a save): full game, segmented and Short swings each write a
  new idea under its game (`source = 'swing'`; a Short swing makes a Short);
  the upgrade swing takes one idea whose best score is in the 70s (plain
  ideas before ones being made, a different one each day, "Pick another"
  swaps it; `pickUpgrade`), ticks the levers, and saves a better title,
  keeping the old one in Other titles and noting the lever in the idea's
  notes. Each swing done is a `yt_swings` row, so "2 of 4 today" and "days
  in a row" are the same on every device.
- Notes for the editor (idea editor → For my editor; Ideas → For my editor;
  `src/pages/EditorNotes.tsx`, `src/lib/markers.ts`): the owner leaves
  markers with comments on a cut in Premiere, exports them (Markers panel,
  File, Export, Markers) and brings the file in on the video's idea. It is
  read in the browser (Premiere writes tab-separated UTF-16; comma-separated
  UTF-8 from other editors works too), kept in `yt_editor_notes`, and shown as
  a numbered list in time order: readable time ("1:05 to 1:20") with the
  exact timecode, the marker's name, and its note one sentence per line.
  Put in Google Docs (`/editor/doc`, `docs.ts`) makes one Google Doc per
  video in the owner's Drive with every cut in order, and rewrites that same
  doc on the next send, so the editor keeps one link (`yt_editor_docs`).
  It needs Google's optional `drive.file` permission (`DOCS_SCOPE`, asked
  for at sign-in; Settings → Google permissions → Turn on Google Docs asks
  again without disconnecting), which only reaches docs the dashboard made,
  and the Google Drive API switched on in the owner's Google Cloud project.
  Copy and Share give the same list as plain text.
  Cuts show in the order they were made (Cut 1 above Cut 2), the newest
  open, and the next one is brought in under the last.
- Thumbnail references (Research, Thumbnails tab; `src/pages/Thumbnails.tsx`)
  are long-form videos in `yt_research_videos` from the last year that did
  at least 3x their channel's usual with 10,000 views or more, split into the owner's games (open
  ideas plus what they posted in the last year) and everything else. They
  fill in by themselves: the game searches, every idea check (which keeps
  what it found there), and `coverOutside` in `research.ts`, which searches
  challenge formats on any game (`OUTSIDE_QUERIES`, each every 7 days, at
  most 3 a day; stored with `params.thumbs = true`). Those searches are
  limited to YouTube's Gaming category (`videoCategoryId=20`): broad words
  like "challenge run" otherwise return dance, fitness and drama videos.
  `yt_research_videos.category` keeps the category, and outside the
  owner's games only `category = '20'` is shown. A pasted link goes
  through `/research` action `video_lookup`. Shorts are left out on purpose.
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
- **Shorts, long-form videos and streams are three separate worlds.** Their
  view counts are not comparable, so never rank, total, average or set a
  target across them: goals, By game, "best of the month" and the Videos
  list each work on one format at a time (`vs_typical` already does). The
  one allowed bridge is a hint, said as a hint: a Short that beat the other
  Shorts suggests the idea could carry a long video (`shortsWorthAVideo`).
  The same goes when answering the owner's questions from the data.
- **Sections** (`NAV` in `src/App.tsx`): Home, Videos (all videos, title
  and thumbnail tests), Ideas (notebook, board, daily swings, suggested, planner, for my editor), Research (outliers,
  thumbnails, search phrases, channels), Stats (charts,
  monthly recap, by game, Shorts to long), Goals, Comments, Playbook
  (templates, lines to remember, my scripts), Settings. A phone shows the first four
  and a More menu. Put a new page in the section it belongs to; when it
  fits none of them, give it a section of its own. Never tuck it under
  whichever section is handy.
- **Show what's next, fold the rest.** The owner has ADHD and said the app
  was "a bit much"; they asked it to "show me what's next". Home opens on
  "Making now" (`src/pages/MakingNow.tsx`): each video in production (picked,
  not out yet), due soonest first, with ONE next step (`nextStep` in
  `src/lib/nextStep.ts`: from its stage and what is written, the first
  unticked box on their own list when there is one) and one button ("Do it"
  opens the idea editor on that part, or "Move to <stage>"). Under it, one
  line for the daily idea swings until today's four are done, then one
  Find box (`src/pages/Find.tsx`: every word, across ideas, lines, templates,
  scripts and goals). Everything else (the new upload, follow-ups, the "This
  week" card, a saved line and a pinned comment, up to 2 goals, 3 latest
  uploads) sits in one closed "Everything else" fold, remembered per browser.
  Never say a thing twice, leave out a block with nothing in it, and put
  charts and breakdowns in the Stats section (`#/stats`), not on Home. New
  things go behind a tap unless they are the next step.
- Keep screens short on a phone. Detail that is not needed every time goes
  in a `Fold` (`src/components/ui.tsx`): a closed heading with a one-line
  summary. The idea editor keeps title, game, format and "Am I making it?"
  open and folds scores, script, thumbnail, other titles, plan and notes;
  Settings folds every part. The idea editor of a video being made shows its
  next step under the stage, with "Go" opening that part (`Fold`'s
  `openSignal`). Score advice shows the one thing most missing and the
  biggest win, the rest under "Show N more"; Suggested shows the strongest 3
  of the newest batch first. The Ideas board opens on a compact Making now,
  then each game as one line until tapped (remembered per browser; adding an
  idea opens its game), and never makes the owner clear old ideas
  (`src/lib/ideaOrder.ts`): games keep their order (most ideas first), and
  an open game shows its 5 newest ideas, with older ones folded under "Show
  N older ideas". `sort_order` is when an idea joined the
  board; keeping a suggestion resets it to that moment. Filters are dropdowns, not rows of
  chips.
- On a wider screen the side panel (`Drawer`: the idea editor and every
  other editor) can be dragged wider by the bar on its left edge, or with
  the arrow keys; double-tap resets it. Its text grows with it (`drawerScale`
  in `src/components/ui.tsx`: 1x at 560px, up to 1.5x at 960px), and the
  width is remembered in that browser. A phone shows it full screen, at the
  usual size, with no bar.
- On a phone nothing may be wider than the screen, the idea editor
  included: it only ever moves up and down. Switches (`Segmented`) side by
  side in a `.field-row` go one under the other on a phone. Every text box
  is 16px on a touch screen, because an iPhone zooms into a smaller one when
  it is tapped. Pulling down at the top of any page reloads the app
  (`src/components/pull.tsx`); the browser's own pull is switched off so
  there is only one, and a pull inside the editor or a box does nothing.
- Live streams are many and small. "Latest uploads", the planner and the
  upload markers leave them out; they have their own Streams tab.
- Thumbnails load only while on or near the screen (`Thumb` in
  `src/components/ui.tsx`). An upright Short picture comes from YouTube at
  full size, and a phone showing dozens at once turns them black.
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
made-up YouTube; drive it in a browser before calling a screen done. Type into
forms one key at a time (`page.keyboard.type`), not by setting the whole value
at once: that is how a cursor that jumps out of a box after one character got
through.

## Shipping changes

- **Database**: add a new numbered file in `supabase/migrations`, prove it on
  the local database, then apply it with the Supabase connector's
  `apply_migration`. The owner has said to always allow it (and `execute_sql`
  and Vercel's `create_deployment`): `.claude/settings.json` lets them run
  without a permission prompt. If Supabase still asks the owner to confirm,
  it waits only 60 seconds: tell them a prompt is coming. Regenerate
  `src/lib/database.types.ts` with `npx tsx dev/gen-types.ts`.
- **Edge function**: deployed as one bundled file. The source grew past
  what one `deploy_edge_function` call can carry (about 270,000 characters
  went through; 303,000 did not), so `npm run bundle:fn` builds
  `dev/deploy/yt-api/index.js` from `supabase/functions/yt-api` with the
  pinned esbuild (the same code, without comments and types; never
  committed). The type check and the tests skip `index.ts`; check it with
  Deno first, from a copy of the folder outside the repository (see
  `dev/README.md`), and run the bundle once in Deno against the local
  database (`/health` answers). Then `deploy_edge_function` with that one
  file (entry `index.js`, `verify_jwt` false). Afterwards confirm the live
  function answers (next section) and that `get_edge_function` returns the
  bundle: `python3 -I dev/compare-deployed.py --bundle <saved result>` must
  end with `MATCH`.
  The whole release, in order, is the `ship` skill (`.claude/skills/ship`).
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

The owner's `youtube-dashboard` cloud environment allows the live backend
(`nivsnjvrsqekyocvtema.supabase.co`) and the site
(`youtube-dashboard-ashen-six.vercel.app`), so `curl` and a browser reach
them directly there. Other environments block both: then ask the database to
make the request and read the answer back:

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
