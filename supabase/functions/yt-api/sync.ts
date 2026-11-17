// Pulls the connected channel's numbers from YouTube into the yt_ tables.
// Each step is independent: one failing step makes the run "partial", not lost.

import {
  analytics, type Api, chunk, closeApi, type Deps, EARNINGS_SCOPE, fetchChannels, fetchPlaylistIds, fetchVideos, getConfig,
  HttpError, mapLimit, openApi, playlistFor, type Report, reportObjects, setConfig, type Sql,
} from "./google.ts";
import {
  logChanges, nameTopics, readComments, syncComments, syncFeeders, syncFirstDays, syncReach, syncTestDays, syncTopics, tickGoals,
} from "./growth.ts";
import { coverGames, refreshWatched } from "./research.ts";
import { classifyFormat } from "./scoring.ts";

type Params = Record<string, string | number | undefined>;
type StepInfo = Record<string, unknown>;

const DAILY_METRICS =
  "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares";
const VIDEO_METRICS =
  "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,shares";
const EARLIEST = "2006-01-01";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => isoDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));

/** Split [start, end] into ranges of at most a year, so each report stays small. */
export function yearRanges(start: string, end: string): [string, string][] {
  const out: [string, string][] = [];
  let from = start;
  while (from <= end) {
    const to = addDays(from, 364) < end ? addDays(from, 364) : end;
    out.push([from, to]);
    from = addDays(to, 1);
  }
  return out;
}

/** Where a view came from, grouped the way the app shows it. */
export function trafficGroup(sourceType: string): string {
  switch (sourceType) {
    case "YT_SEARCH": return "search";
    case "RELATED_VIDEO": return "suggested";
    case "SUBSCRIBER": return "browse";
    case "SHORTS": return "shorts_feed";
    case "YT_CHANNEL": return "channel_pages";
    case "PLAYLIST": return "playlists";
    case "NOTIFICATION": return "notifications";
    case "EXT_URL": return "external";
    default: return "other";
  }
}

export function contentType(creatorContentType: string): "short" | "long" | "live" | "other" {
  switch (creatorContentType) {
    case "shorts": return "short";
    case "videoOnDemand": return "long";
    case "liveStream": return "live";
    default: return "other";
  }
}

/** engagedViews is newer than the rest; if a report rejects it, ask again without it. */
async function report(api: Api, params: Params & { metrics: string }): Promise<Report> {
  try {
    return await analytics(api, params);
  } catch (err) {
    const metrics = params.metrics.split(",");
    if (err instanceof HttpError && err.detail?.startsWith("400") && metrics.includes("engagedViews")) {
      return await analytics(api, { ...params, metrics: metrics.filter((m) => m !== "engagedViews").join(",") });
    }
    throw err;
  }
}

/** Optional steps: trouble with them is noted without failing the sync. */
const soft = (fn: () => Promise<StepInfo>) => async () => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return { skipped: describe(err) };
    throw err;
  }
};

const describe = (err: unknown) => (err instanceof HttpError ? `${err.message}${err.detail ? ` [${err.detail}]` : ""}` : String(err));

export async function runSync(deps: Deps, source: string): Promise<{ status: string; run_id?: number; summary?: unknown; message?: string }> {
  const { sql } = deps;
  const cfg = await getConfig(sql, ["google_refresh_token", "owner_channel_id", "google_scopes"]);
  if (!cfg.google_refresh_token) return { status: "skipped", message: "YouTube is not connected yet." };

  const [busy] = await sql`
    select id from public.yt_sync_runs where status = 'running' and started_at > now() - interval '5 minutes' limit 1`;
  if (busy) return { status: "busy", message: "A sync is already running." };

  // A run that was cut off before it could finish should not sit there as "running" for ever.
  await sql`
    update public.yt_sync_runs set status = 'error', finished_at = now(), error = 'Stopped before it finished.'
    where status = 'running' and started_at < now() - interval '5 minutes'`;

  const [run] = await sql`insert into public.yt_sync_runs (source) values (${source}) returning id`;
  const steps: Record<string, StepInfo> = {};
  const today = isoDate(deps.now());
  let failed = false;
  let fatal: string | null = null;
  let api: Api | null = null;

  const step = async (name: string, fn: () => Promise<StepInfo | void>) => {
    const t0 = Date.now();
    try {
      steps[name] = { ok: true, ...((await fn()) ?? {}), ms: Date.now() - t0 };
    } catch (err) {
      failed = true;
      steps[name] = { ok: false, error: describe(err), ms: Date.now() - t0 };
      deps.log?.(`sync step ${name} failed:`, describe(err));
    }
  };

  let history = false;
  try {
    api = await openApi(deps);
    const session = api;

    // 1. The channel itself
    const [channel] = await fetchChannels(session, { mine: true });
    if (!channel) throw new HttpError(409, "no_channel", "That Google account has no YouTube channel.");
    if (cfg.owner_channel_id && channel.id !== cfg.owner_channel_id) {
      throw new HttpError(409, "wrong_channel", `The connected Google account is "${channel.title}", not the channel this dashboard is for.`);
    }
    await sql`
      insert into public.yt_channel
        (id, title, handle, thumbnail_url, country, published_at, uploads_playlist_id, subscribers, views, videos, updated_at)
      values (${channel.id}, ${channel.title}, ${channel.handle}, ${channel.thumbnail_url}, ${channel.country},
              ${channel.published_at}, ${channel.uploads_playlist_id}, ${channel.subscribers}, ${channel.views},
              ${channel.videos}, now())
      on conflict (id) do update set
        title = excluded.title, handle = excluded.handle, thumbnail_url = excluded.thumbnail_url,
        country = excluded.country, published_at = excluded.published_at,
        uploads_playlist_id = excluded.uploads_playlist_id, subscribers = excluded.subscribers,
        views = excluded.views, videos = excluded.videos, updated_at = now()`;
    await sql`
      insert into public.yt_channel_daily (date, subscribers, views, videos, captured_at)
      values (${today}, ${channel.subscribers}, ${channel.views}, ${channel.videos}, now())
      on conflict (date) do update set
        subscribers = excluded.subscribers, views = excluded.views, videos = excluded.videos, captured_at = now()`;
    steps.channel = { ok: true, subscribers: channel.subscribers, videos: channel.videos };

    // 2. Every upload with its public numbers and its format
    await step("videos", async () => {
      const [uploads, shorts, long, live] = await Promise.all([
        fetchPlaylistIds(session, channel.uploads_playlist_id ?? playlistFor(channel.id, "uploads"), 5000),
        fetchPlaylistIds(session, playlistFor(channel.id, "shorts"), 5000),
        fetchPlaylistIds(session, playlistFor(channel.id, "long"), 5000),
        fetchPlaylistIds(session, playlistFor(channel.id, "live"), 5000),
      ]);
      const sets = { shorts: new Set(shorts), long: new Set(long), live: new Set(live) };
      const videos = await fetchVideos(session, uploads);
      const changes = await logChanges(sql, videos);
      const rows = videos.map((v) => {
        const c = classifyFormat(v, sets);
        return {
          id: v.id, title: v.title, description: v.description.slice(0, 5000), published_at: v.published_at || null,
          duration_s: v.duration_s, content_type: c.format, content_type_source: c.source, privacy: v.privacy,
          thumbnail_url: v.thumbnail_url, tags: v.tags, views: v.views, likes: v.likes, comments: v.comments,
        };
      });
      for (const batch of chunk(rows, 200)) {
        await sql`
          insert into public.yt_videos
            (id, title, description, published_at, duration_s, content_type, content_type_source, privacy,
             thumbnail_url, tags, views, likes, comments, stats_updated_at)
          select x.id, x.title, x.description, x.published_at, x.duration_s, x.content_type, x.content_type_source,
                 x.privacy, x.thumbnail_url,
                 coalesce((select array_agg(t) from jsonb_array_elements_text(x.tags) t), '{}'),
                 x.views, x.likes, x.comments, now()
          from jsonb_to_recordset(${sql.json(batch)}) as x(
            id text, title text, description text, published_at timestamptz, duration_s integer, content_type text,
            content_type_source text, privacy text, thumbnail_url text, tags jsonb, views bigint, likes bigint,
            comments bigint)
          on conflict (id) do update set
            title = excluded.title, description = excluded.description, published_at = excluded.published_at,
            duration_s = excluded.duration_s, privacy = excluded.privacy, thumbnail_url = excluded.thumbnail_url,
            tags = excluded.tags, views = excluded.views, likes = excluded.likes, comments = excluded.comments,
            stats_updated_at = now(), removed_at = null,
            content_type = case when public.yt_videos.content_type_source = 'manual'
                                then public.yt_videos.content_type else excluded.content_type end,
            content_type_source = case when public.yt_videos.content_type_source = 'manual'
                                       then 'manual' else excluded.content_type_source end`;
      }
      if (uploads.length > 0 && videos.length > 0) {
        await sql`
          update public.yt_videos set removed_at = now()
           where removed_at is null and id not in ${sql(videos.map((v) => v.id))}`;
        await sql`
          insert into public.yt_video_daily (video_id, date, views, likes, comments)
          select id, ${today}, views, likes, comments from public.yt_videos where removed_at is null
          on conflict (video_id, date) do update
            set views = excluded.views, likes = excluded.likes, comments = excluded.comments`;
      }
      const count = (f: string) => rows.filter((r) => r.content_type === f).length;
      return { count: rows.length, shorts: count("short"), long: count("long"), live: count("live"), changes };
    });

    // 3 + 4. Channel-wide Studio numbers per day, in total and per format
    const [{ done: historyDone }] = await sql`
      select exists (
        select 1 from public.yt_sync_runs
        where status in ('ok', 'partial') and source <> 'seed' and coalesce((summary ->> 'history')::boolean, false)
      ) as done`;
    const start = historyDone ? addDays(today, -35) : (channel.published_at?.slice(0, 10) ?? EARLIEST);
    const ranges = yearRanges(start < EARLIEST ? EARLIEST : start, today);

    await step("daily", async () => {
      let days = 0;
      for (const [startDate, endDate] of ranges) {
        const rows = reportObjects(await report(session, { startDate, endDate, metrics: DAILY_METRICS, dimensions: "day", sort: "day" }));
        if (rows.length === 0) continue;
        days += rows.length;
        await sql`
          insert into public.yt_analytics_daily
            (date, views, engaged_views, minutes_watched, avg_view_duration_s, avg_view_pct, subs_gained, subs_lost,
             likes, comments, shares, updated_at)
          select x.day, x.views, x."engagedViews", x."estimatedMinutesWatched", x."averageViewDuration",
                 x."averageViewPercentage", x."subscribersGained", x."subscribersLost", x.likes, x.comments, x.shares, now()
          from jsonb_to_recordset(${sql.json(rows)}) as x(
            day date, views bigint, "engagedViews" bigint, "estimatedMinutesWatched" bigint, "averageViewDuration" numeric,
            "averageViewPercentage" numeric, "subscribersGained" integer, "subscribersLost" integer, likes integer,
            comments integer, shares integer)
          on conflict (date) do update set
            views = excluded.views, engaged_views = coalesce(excluded.engaged_views, public.yt_analytics_daily.engaged_views),
            minutes_watched = excluded.minutes_watched, avg_view_duration_s = excluded.avg_view_duration_s,
            avg_view_pct = excluded.avg_view_pct, subs_gained = excluded.subs_gained, subs_lost = excluded.subs_lost,
            likes = excluded.likes, comments = excluded.comments, shares = excluded.shares, updated_at = now()`;
      }
      return { days, from: ranges[0]?.[0] };
    });

    await step("formats", async () => {
      let count = 0;
      for (const [startDate, endDate] of ranges) {
        const raw = reportObjects(await report(session, {
          startDate, endDate, metrics: "views,engagedViews,estimatedMinutesWatched", dimensions: "day,creatorContentType",
        }));
        const merged = new Map<string, { date: string; content_type: string; views: number; engaged_views: number | null; minutes_watched: number }>();
        for (const r of raw) {
          const type = contentType(String(r.creatorContentType));
          const key = `${r.day}|${type}`;
          const row = merged.get(key) ?? { date: String(r.day), content_type: type, views: 0, engaged_views: null, minutes_watched: 0 };
          row.views += Number(r.views ?? 0);
          row.minutes_watched += Number(r.estimatedMinutesWatched ?? 0);
          if (r.engagedViews !== undefined) row.engaged_views = (row.engaged_views ?? 0) + Number(r.engagedViews);
          merged.set(key, row);
        }
        const rows = [...merged.values()];
        if (rows.length === 0) continue;
        count += rows.length;
        await sql`
          insert into public.yt_content_type_daily (date, content_type, views, engaged_views, minutes_watched, updated_at)
          select x.date, x.content_type, x.views, x.engaged_views, x.minutes_watched, now()
          from jsonb_to_recordset(${sql.json(rows)}) as x(
            date date, content_type text, views bigint, engaged_views bigint, minutes_watched bigint)
          on conflict (date, content_type) do update set
            views = excluded.views,
            engaged_views = coalesce(excluded.engaged_views, public.yt_content_type_daily.engaged_views),
            minutes_watched = excluded.minutes_watched, updated_at = now()`;
      }
      return { rows: count };
    });
    history = historyDone || (steps.daily?.ok === true && steps.formats?.ok === true);

    // 5. Lifetime Studio numbers per video
    await step("video_analytics", async () => {
      let updated = 0;
      // deno-lint-ignore no-explicit-any
      const save = async (rows: any[]) => {
        if (rows.length === 0) return;
        updated += rows.length;
        await sql`
          update public.yt_videos v set
            engaged_views = coalesce(x."engagedViews", v.engaged_views), minutes_watched = x."estimatedMinutesWatched",
            avg_view_duration_s = x."averageViewDuration", avg_view_pct = x."averageViewPercentage",
            subs_gained = x."subscribersGained", shares = x.shares, analytics_updated_at = now()
          from jsonb_to_recordset(${sql.json(rows)}) as x(
            video text, "engagedViews" bigint, "estimatedMinutesWatched" bigint, "averageViewDuration" numeric,
            "averageViewPercentage" numeric, "subscribersGained" integer, shares integer)
          where v.id = x.video`;
      };
      // YouTube lists only the 200 most viewed videos and will not page past them...
      const top = reportObjects(await report(session, {
        startDate: EARLIEST, endDate: today, metrics: VIDEO_METRICS, dimensions: "video", sort: "-views", maxResults: 200,
      }));
      await save(top);
      // ...so the rest are asked for by id, a batch at a time.
      const seen = new Set(top.map((r) => String(r.video)));
      const all = await sql`select id from public.yt_videos where removed_at is null`;
      // deno-lint-ignore no-explicit-any
      const rest = (all as any[]).map((r) => r.id as string).filter((id) => !seen.has(id));
      await mapLimit(chunk(rest, 100), 3, async (ids) => {
        await save(reportObjects(await report(session, {
          startDate: EARLIEST, endDate: today, metrics: VIDEO_METRICS, dimensions: "video", filters: `video==${ids.join(",")}`,
        })));
      });
      return { videos: updated };
    });

    // 5b. Estimated earnings, when the owner granted that permission. A channel that
    // is not earning yet is refused by YouTube; that is not a failed sync.
    if ((cfg.google_scopes ?? "").split(" ").includes(EARNINGS_SCOPE)) {
      await step("earnings", async () => {
        try {
          let days = 0;
          for (const [startDate, endDate] of ranges) {
            const rows = reportObjects(await analytics(session, { startDate, endDate, metrics: "estimatedRevenue", dimensions: "day" }));
            if (rows.length === 0) continue;
            days += rows.length;
            await sql`
              update public.yt_analytics_daily a set estimated_revenue = x."estimatedRevenue"
              from jsonb_to_recordset(${sql.json(rows)}) as x(day date, "estimatedRevenue" numeric)
              where a.date = x.day`;
          }
          let videos = 0;
          // deno-lint-ignore no-explicit-any
          const save = async (rows: any[]) => {
            if (rows.length === 0) return;
            videos += rows.length;
            await sql`
              update public.yt_videos v set estimated_revenue = x."estimatedRevenue"
              from jsonb_to_recordset(${sql.json(rows)}) as x(video text, "estimatedRevenue" numeric)
              where v.id = x.video`;
          };
          const top = reportObjects(await analytics(session, {
            startDate: EARLIEST, endDate: today, metrics: "views,estimatedRevenue", dimensions: "video", sort: "-views", maxResults: 200,
          }));
          await save(top);
          const seen = new Set(top.map((r) => String(r.video)));
          const all = await sql`select id from public.yt_videos where removed_at is null`;
          // deno-lint-ignore no-explicit-any
          const rest = (all as any[]).map((r) => r.id as string).filter((id) => !seen.has(id));
          await mapLimit(chunk(rest, 100), 3, async (ids) => {
            await save(reportObjects(await analytics(session, {
              startDate: EARLIEST, endDate: today, metrics: "estimatedRevenue", dimensions: "video", filters: `video==${ids.join(",")}`,
            })));
          });
          return { days, videos };
        } catch (err) {
          if (err instanceof HttpError) return { skipped: describe(err) };
          throw err;
        }
      });
    }

    // 6. How recent uploads built up day by day
    await step("recent_uploads", async () => {
      const recent = await sql`
        select id, published_at from public.yt_videos
        where removed_at is null and published_at > now() - interval '35 days'
        order by published_at desc limit 12`;
      // deno-lint-ignore no-explicit-any
      await mapLimit(recent as any[], 4, async (v) => {
        const rows = reportObjects(await report(session, {
          startDate: isoDate(new Date(v.published_at)), endDate: today, dimensions: "day", sort: "day",
          metrics: "views,engagedViews,estimatedMinutesWatched,subscribersGained", filters: `video==${v.id}`,
        }));
        if (rows.length === 0) return;
        await sql`
          insert into public.yt_video_analytics_daily (video_id, date, views, engaged_views, minutes_watched, subs_gained)
          select ${v.id}, x.day, x.views, x."engagedViews", x."estimatedMinutesWatched", x."subscribersGained"
          from jsonb_to_recordset(${sql.json(rows)}) as x(
            day date, views bigint, "engagedViews" bigint, "estimatedMinutesWatched" bigint, "subscribersGained" integer)
          on conflict (video_id, date) do update set
            views = excluded.views, engaged_views = excluded.engaged_views,
            minutes_watched = excluded.minutes_watched, subs_gained = excluded.subs_gained`;
      });
      return { videos: recent.length };
    });

    // 7. 28-day breakdowns
    await step("reports", async () => {
      const from = addDays(today, -28);
      const wanted: [string, Params & { metrics: string }][] = [
        ["traffic_sources_28d", { metrics: "views,estimatedMinutesWatched", dimensions: "insightTrafficSourceType", sort: "-views" }],
        ["geography_28d", { metrics: "views,estimatedMinutesWatched", dimensions: "country", sort: "-views", maxResults: 25 }],
        ["demographics_28d", { metrics: "viewerPercentage", dimensions: "ageGroup,gender" }],
        ["devices_28d", { metrics: "views,estimatedMinutesWatched", dimensions: "deviceType", sort: "-views" }],
        ["top_videos_28d", {
          metrics: "views,estimatedMinutesWatched,averageViewPercentage,subscribersGained", dimensions: "video",
          sort: "-views", maxResults: 25,
        }],
      ];
      const saved: string[] = [];
      const errors: string[] = [];
      await mapLimit(wanted, 3, async ([key, params]) => {
        try {
          const rows = reportObjects(await report(session, { startDate: from, endDate: today, ...params }));
          await sql`
            insert into public.yt_reports (key, period_start, period_end, data, fetched_at)
            values (${key}, ${from}, ${today}, ${sql.json(rows)}, now())
            on conflict (key) do update set
              period_start = excluded.period_start, period_end = excluded.period_end,
              data = excluded.data, fetched_at = now()`;
          saved.push(key);
        } catch (err) {
          errors.push(`${key}: ${describe(err)}`);
        }
      });
      if (saved.length === 0) throw new Error(errors.join("; "));
      return errors.length ? { saved, errors } : { saved };
    });

    // 8. Where each video's views came from (a batch per run; oldest answers first)
    await step("traffic", async () => {
      const targets = await sql`
        select id from public.yt_videos
        where removed_at is null and privacy = 'public'
          and (traffic_updated_at is null or traffic_updated_at < now() - interval '7 days')
        order by (traffic_updated_at is null) desc, (published_at > now() - interval '60 days') desc, views desc nulls last
        limit 25`;
      let done = 0;
      // deno-lint-ignore no-explicit-any
      await mapLimit(targets as any[], 5, async (v) => {
        const rows = reportObjects(await report(session, {
          startDate: EARLIEST, endDate: today, metrics: "views", dimensions: "insightTrafficSourceType",
          filters: `video==${v.id}`,
        }));
        const traffic: Record<string, number> = { total: 0 };
        for (const r of rows) {
          const group = trafficGroup(String(r.insightTrafficSourceType));
          const views = Number(r.views ?? 0);
          traffic[group] = (traffic[group] ?? 0) + views;
          traffic.total += views;
        }
        await sql`update public.yt_videos set traffic = ${sql.json(traffic)}, traffic_updated_at = now() where id = ${v.id}`;
        done++;
      });
      return { videos: done };
    });

    // 8a. Write down the live view count of uploads in their first days (see runPulse).
    await step("pulse", async () => ({ videos: await notePulse(sql) }));

    // 8b. Quick extras. The slow ones (what feeds the long videos, and everything the AI reads)
    // run afterwards in runExtras, so a sync never runs out of time.
    await step("tests", () => syncTestDays(session, today));
    await step("topics", () => syncTopics(deps));
    await step("comments", soft(() => syncComments(session, channel.id, cfg.google_scopes ?? "")));
    await step("reach", soft(() => syncReach(session)));
    await step("goals", async () => { await tickGoals(sql); });

    // 9. Channels on the watch list
    await step("watched_channels", async () => ({ refreshed: await refreshWatched(session, 10) }));
  } catch (err) {
    fatal = describe(err);
    deps.log?.("sync failed:", fatal);
  }

  const units = api ? api.units : 0;
  if (api) await closeApi(api).catch(() => undefined);
  const status = fatal ? "error" : failed ? "partial" : "ok";
  const summary = { steps, history, units };
  await sql`
    update public.yt_sync_runs
       set status = ${status}, finished_at = now(), summary = ${sql.json(summary)}, error = ${fatal}
     where id = ${run.id}`;
  if (!fatal) await queueExtras(deps, Number(run.id), 0);
  return { status, run_id: Number(run.id), summary, message: fatal ?? undefined };
}

// ---------------------------------------------------------------------------
// The slow extras, in their own request
// ---------------------------------------------------------------------------

const EXTRAS_MS = 45_000;
const EXTRAS_HOPS = 14;

/** Asks the database to call /sync/extras, so the work gets a fresh request with its own time limit. */
async function queueExtras(deps: Deps, runId: number, hop: number): Promise<void> {
  try {
    const { cron_secret } = await getConfig(deps.sql, ["cron_secret"]);
    if (!cron_secret) return;
    await deps.sql`
      select net.http_post(
        url := ${`${deps.functionUrl}/sync/extras`},
        headers := ${deps.sql.json({ "content-type": "application/json", "x-cron-secret": cron_secret })},
        body := ${deps.sql.json({ run_id: runId, hop })},
        timeout_milliseconds := 150000)`;
  } catch (err) {
    deps.log?.("could not queue the extras:", describe(err));
  }
}

/**
 * The slow parts of a sync: the AI naming each video's game and reading comments, and what feeds
 * the long videos. Works for under a minute, then asks for another turn while there is more to do.
 */
export async function runExtras(deps: Deps, runId: number, hop: number): Promise<{ status: string; steps?: Record<string, StepInfo>; more?: boolean }> {
  const { sql } = deps;
  const cfg = await getConfig(sql, ["google_refresh_token"]);
  if (!cfg.google_refresh_token) return { status: "skipped" };
  const until = Date.now() + EXTRAS_MS;
  const steps: Record<string, StepInfo> = {};
  const step = async (name: string, fn: () => Promise<StepInfo>) => {
    const t0 = Date.now();
    try {
      steps[name] = { ok: true, ...(await soft(fn)()), ms: Date.now() - t0 };
    } catch (err) {
      steps[name] = { ok: false, error: describe(err), ms: Date.now() - t0 };
      deps.log?.(`extras step ${name} failed:`, describe(err));
    }
  };

  await step("games", () => nameTopics(deps, until));
  await step("comments_read", () => readComments(deps, until));
  // Outlier searches for the games the owner has ideas under, so their scores never wait on a manual search.
  if (Date.now() < until) await step("idea_research", () => coverGames(deps, { limit: 2, until }));
  let api: Api | null = null;
  if (Date.now() < until) {
    try {
      api = await openApi(deps);
      const session = api;
      await step("first_days", () => syncFirstDays(session, until));
      await step("feeders", () => syncFeeders(session, isoDate(deps.now()), EARLIEST, until));
    } catch (err) {
      steps.feeders = { ok: false, error: describe(err) };
    }
  }
  if (api) await closeApi(api).catch(() => undefined);

  const progress = Number(steps.games?.named ?? 0) + Number(steps.comments_read?.read ?? 0) + Number(steps.feeders?.videos ?? 0)
    + Number(steps.first_days?.videos ?? 0) + (Array.isArray(steps.idea_research?.searched) ? steps.idea_research.searched.length : 0);
  const left = Number(steps.games?.left ?? 0) + Number(steps.comments_read?.left ?? 0) + Number(steps.feeders?.left ?? 0)
    + Number(steps.first_days?.left ?? 0) + (steps.idea_research?.skipped ? 0 : Number(steps.idea_research?.left ?? 0));
  const more = progress > 0 && left > 0 && hop + 1 < EXTRAS_HOPS;

  // Add this turn's results to the run that asked for them, summing the counts across turns.
  const [row] = await sql`select summary from public.yt_sync_runs where id = ${runId}`;
  if (row) {
    // deno-lint-ignore no-explicit-any
    const summary = (row.summary ?? {}) as any;
    const all = { ...(summary.steps ?? {}) } as Record<string, StepInfo>;
    for (const [name, now] of Object.entries(steps)) {
      const before = (all[name] ?? {}) as StepInfo;
      const merged: StepInfo = { ...before, ...now };
      for (const key of ["named", "read", "videos", "ms"]) {
        if (typeof now[key] === "number" && typeof before[key] === "number") merged[key] = (before[key] as number) + (now[key] as number);
      }
      if (now.ok && !("error" in now)) delete merged.error;
      if (!("skipped" in now)) delete merged.skipped;
      all[name] = merged;
    }
    await sql`update public.yt_sync_runs set summary = ${sql.json({ ...summary, steps: all })} where id = ${runId}`;
  }
  if (more) await queueExtras(deps, runId, hop + 1);
  return { status: "ok", steps, more };
}

// ---------------------------------------------------------------------------
// The hourly pulse: how a new upload is doing right now
// ---------------------------------------------------------------------------

const PULSE_HOURS = 72;

/** Writes down the stored view count of every upload in its first days. Returns how many. */
async function notePulse(sql: Sql): Promise<number> {
  const rows = await sql`
    insert into public.yt_video_pulse (video_id, captured_at, views, likes, comments)
    select id, now(), views, likes, comments from public.yt_videos
    where removed_at is null and views is not null
      and published_at > now() - make_interval(hours => ${PULSE_HOURS}) and published_at <= now()
    on conflict do nothing returning video_id`;
  return rows.length;
}

/**
 * Runs every hour. If something new went up, a full sync brings it in. Otherwise it refreshes the
 * live view count of uploads in their first three days and writes it down. Two lookups at most.
 */
export async function runPulse(deps: Deps): Promise<Record<string, unknown>> {
  const { sql } = deps;
  const cfg = await getConfig(sql, ["google_refresh_token"]);
  if (!cfg.google_refresh_token) return { status: "skipped" };
  const [channel] = await sql`select id, uploads_playlist_id from public.yt_channel order by updated_at desc limit 1`;
  if (!channel) return { status: "skipped" };
  const api = await openApi(deps);
  try {
    const newest = await fetchPlaylistIds(api, channel.uploads_playlist_id ?? playlistFor(channel.id, "uploads"), 10);
    const known = await sql`select id from public.yt_videos where id = any(${newest})`;
    const have = new Set((known as { id: string }[]).map((r) => r.id));
    const unknown = newest.filter((id) => !have.has(id)).sort().join(",");
    // An upload a sync could not bring in (deleted in between, say) is only tried once.
    const { pulse_tried } = await getConfig(sql, ["pulse_tried"]);
    if (unknown && unknown !== pulse_tried) {
      await setConfig(sql, { pulse_tried: unknown });
      await closeApi(api).catch(() => undefined);
      const run = await runSync(deps, "cron");
      return { status: "synced", new_upload: true, sync: run.status };
    }
    const fresh = await sql`
      select id from public.yt_videos
      where removed_at is null and published_at > now() - make_interval(hours => ${PULSE_HOURS}) limit 50`;
    if (fresh.length === 0) return { status: "ok", videos: 0 };
    const videos = await fetchVideos(api, (fresh as { id: string }[]).map((r) => r.id));
    for (const v of videos) {
      await sql`update public.yt_videos set views = ${v.views}, likes = ${v.likes}, comments = ${v.comments}, stats_updated_at = now() where id = ${v.id}`;
    }
    return { status: "ok", videos: await notePulse(sql) };
  } finally {
    await closeApi(api).catch(() => undefined);
  }
}
