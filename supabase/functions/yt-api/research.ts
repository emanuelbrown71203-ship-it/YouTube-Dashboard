// The research tools: outlier finder, keyword analysis, search suggestions and
// the list of channels to watch. Public YouTube data only.

import {
  type Api, closeApi, DAILY_BUDGET, type Deps, ensureBudget, fetchChannels, fetchPlaylistIds, fetchVideos,
  HttpError, mapLimit, openApi, playlistFor, searchChannelIds, searchVideoIds, SEARCH_COST, type Sql,
} from "./google.ts";
import {
  ageDays, analyzeKeyword, isEnglish, normalizeKeyword, type OutlierItem, type PublicChannel, type PublicVideo,
  type RecentUpload, scoreOutlier, sortOutliers, typicalViews,
} from "./scoring.ts";

const BASELINE_SIZE = 30;
const BASELINE_TTL_MS = 7 * 86_400_000;
const MAX_CHANNELS_PER_RUN = 40;
export const MAX_WATCHED = 25;
const DAY_MS = 86_400_000;

type Format = "short" | "long";

// ---------------------------------------------------------------------------
// Channels and their baselines
// ---------------------------------------------------------------------------

export async function upsertChannelStats(sql: Sql, channels: PublicChannel[]): Promise<void> {
  if (channels.length === 0) return;
  await sql`
    insert into public.yt_research_channels
      (id, title, handle, thumbnail_url, country, published_at, subscribers, subscribers_hidden, views, videos, stats_at)
    select x.id, x.title, x.handle, x.thumbnail_url, x.country, x.published_at, x.subscribers,
           coalesce(x.subscribers_hidden, false), x.views, x.videos, now()
    from jsonb_to_recordset(${sql.json(channels)}) as x(
      id text, title text, handle text, thumbnail_url text, country text, published_at timestamptz,
      subscribers bigint, subscribers_hidden boolean, views bigint, videos integer)
    on conflict (id) do update set
      title = excluded.title, handle = excluded.handle, thumbnail_url = excluded.thumbnail_url,
      country = excluded.country, published_at = excluded.published_at, subscribers = excluded.subscribers,
      subscribers_hidden = excluded.subscribers_hidden, views = excluded.views, videos = excluded.videos,
      stats_at = now()`;
}

function toRecent(v: PublicVideo): RecentUpload {
  return {
    id: v.id, title: v.title, views: v.views, likes: v.likes, comments: v.comments,
    published_at: v.published_at, duration_s: v.duration_s,
  };
}

/** Fetch a channel's latest uploads in one format and store its "usual" views. */
export async function loadBaseline(api: Api, channelId: string, format: Format): Promise<RecentUpload[]> {
  const now = api.deps.now();
  const ids = await fetchPlaylistIds(api, playlistFor(channelId, format === "short" ? "shorts" : "long"), BASELINE_SIZE);
  const videos = ids.length ? await fetchVideos(api, ids) : [];
  const recent = videos
    .filter((v) => v.privacy === null || v.privacy === "public")
    .map(toRecent)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const typical = typicalViews(recent, { now });
  const uploads30 = recent.filter((r) => ageDays(r.published_at, now) <= 30).length;
  const sql = api.deps.sql;
  if (format === "short") {
    await sql`
      update public.yt_research_channels
         set recent_short = ${sql.json(recent)}, typical_short = ${typical}, uploads_30d_short = ${uploads30},
             baseline_short_at = now()
       where id = ${channelId}`;
  } else {
    await sql`
      update public.yt_research_channels
         set recent_long = ${sql.json(recent)}, typical_long = ${typical}, uploads_30d_long = ${uploads30},
             baseline_long_at = now()
       where id = ${channelId}`;
  }
  return recent;
}

/** Recent uploads per channel for one format, from the cache when it is fresh enough. */
async function ensureBaselines(api: Api, channelIds: string[], format: Format): Promise<Map<string, RecentUpload[]>> {
  const out = new Map<string, RecentUpload[]>();
  if (channelIds.length === 0) return out;
  const sql = api.deps.sql;
  const rows = await sql`
    select id, recent_long, recent_short, baseline_long_at, baseline_short_at
    from public.yt_research_channels where id in ${sql(channelIds)}`;
  const cutoff = api.deps.now().getTime() - BASELINE_TTL_MS;
  const stale: string[] = [];
  for (const id of channelIds) {
    // deno-lint-ignore no-explicit-any
    const row = rows.find((r: any) => r.id === id);
    const at = row ? (format === "short" ? row.baseline_short_at : row.baseline_long_at) : null;
    if (at && new Date(at).getTime() >= cutoff) {
      out.set(id, (format === "short" ? row.recent_short : row.recent_long) ?? []);
    } else {
      stale.push(id);
    }
  }
  await mapLimit(stale, 6, async (id) => {
    out.set(id, await loadBaseline(api, id, format));
  });
  return out;
}

async function snapshotChannel(sql: Sql, c: PublicChannel, now: Date): Promise<void> {
  await sql`
    insert into public.yt_research_channel_daily (channel_id, date, subscribers, views, videos)
    values (${c.id}, ${now.toISOString().slice(0, 10)}, ${c.subscribers}, ${c.views}, ${c.videos})
    on conflict (channel_id, date) do update
      set subscribers = excluded.subscribers, views = excluded.views, videos = excluded.videos`;
}

/** Refresh one channel completely: counters, both baselines and today's snapshot. */
export async function refreshChannel(api: Api, channelId: string): Promise<PublicChannel> {
  const [channel] = await fetchChannels(api, { ids: [channelId] });
  if (!channel) throw new HttpError(404, "channel_not_found", "YouTube could not find that channel.");
  await upsertChannelStats(api.deps.sql, [channel]);
  await loadBaseline(api, channel.id, "long");
  await loadBaseline(api, channel.id, "short");
  await snapshotChannel(api.deps.sql, channel, api.deps.now());
  return channel;
}

/** Called by the sync: keep the watched channels current, a few per run. */
export async function refreshWatched(api: Api, limit = 10): Promise<number> {
  const rows = await api.deps.sql`
    select id from public.yt_research_channels
    where watched
      and (baseline_long_at is null or baseline_short_at is null
           or least(baseline_long_at, baseline_short_at) < now() - interval '20 hours')
    order by least(baseline_long_at, baseline_short_at) nulls first
    limit ${limit}`;
  let done = 0;
  // deno-lint-ignore no-explicit-any
  await mapLimit(rows as any[], 3, async (r) => {
    try {
      await refreshChannel(api, r.id);
      done++;
    } catch (err) {
      api.deps.log?.("watched channel refresh failed", r.id, String(err));
    }
  });
  return done;
}

async function channelRow(sql: Sql, id: string) {
  const [row] = await sql`
    select id, title, handle, thumbnail_url, country, published_at, subscribers, subscribers_hidden, views, videos,
           watched, watched_at, typical_long, typical_short, uploads_30d_long, uploads_30d_short,
           recent_long, recent_short, baseline_long_at, baseline_short_at, stats_at
    from public.yt_research_channels where id = ${id}`;
  return row ?? null;
}

function parseChannelInput(input: string): { id?: string; handle?: string; query?: string } {
  const text = input.trim();
  const id = /(UC[\w-]{22})/.exec(text);
  if (id) return { id: id[1] };
  const handle = /(?:youtube\.com\/|^)@([\w.-]{2,60})/i.exec(text);
  if (handle) return { handle: `@${handle[1]}` };
  return { query: text };
}

async function channelLookup(api: Api, input: string) {
  const parsed = parseChannelInput(input);
  if (!parsed.id && !parsed.handle && (parsed.query ?? "").length < 2) {
    throw new HttpError(400, "bad_request", "Type a channel name, @handle or link.");
  }
  let channels: PublicChannel[];
  if (parsed.id) channels = await fetchChannels(api, { ids: [parsed.id] });
  else if (parsed.handle) channels = await fetchChannels(api, { handle: parsed.handle });
  else {
    await ensureBudget(api, SEARCH_COST + 1);
    const ids = await searchChannelIds(api, parsed.query!, 6);
    const found = ids.length ? await fetchChannels(api, { ids }) : [];
    channels = ids.map((id) => found.find((c) => c.id === id)).filter((c): c is PublicChannel => Boolean(c));
  }
  const sql = api.deps.sql;
  await upsertChannelStats(sql, channels);
  const watched = channels.length
    ? await sql`select id from public.yt_research_channels where watched and id in ${sql(channels.map((c) => c.id))}`
    : [];
  // deno-lint-ignore no-explicit-any
  const watchedIds = new Set((watched as any[]).map((r) => r.id));
  const usedToday = await closeApi(api);
  return {
    channels: channels.map((c) => ({ ...c, watched: watchedIds.has(c.id) })),
    quota: { used_today: usedToday, daily_budget: DAILY_BUDGET },
  };
}

async function channelWatch(api: Api, channelId: string) {
  const sql = api.deps.sql;
  if (!/^UC[\w-]{22}$/.test(channelId)) throw new HttpError(400, "bad_request", "That is not a YouTube channel id.");
  const [{ n }] = await sql`select count(*)::int as n from public.yt_research_channels where watched and id <> ${channelId}`;
  if (n >= MAX_WATCHED) {
    throw new HttpError(400, "too_many", `You can watch up to ${MAX_WATCHED} channels. Stop watching one first.`);
  }
  await refreshChannel(api, channelId);
  await sql`
    update public.yt_research_channels
       set watched = true, watched_at = coalesce(watched_at, now())
     where id = ${channelId}`;
  const usedToday = await closeApi(api);
  return { channel: await channelRow(sql, channelId), quota: { used_today: usedToday, daily_budget: DAILY_BUDGET } };
}

async function channelRefresh(api: Api, channelId: string) {
  await refreshChannel(api, channelId);
  const usedToday = await closeApi(api);
  return { channel: await channelRow(api.deps.sql, channelId), quota: { used_today: usedToday, daily_budget: DAILY_BUDGET } };
}

// ---------------------------------------------------------------------------
// Outlier finder
// ---------------------------------------------------------------------------

export interface OutlierParams {
  query: string;
  /** breakout = recent videos the feed pushed; evergreen = older videos that still rank in search. */
  mode: "breakout" | "evergreen";
  format: Format;
  window_days: number;
  max_subs: number | null;
  min_views: number;
  page_token: string | null;
}

type Bucket = "short" | "medium" | "long";
type Tokens = Partial<Record<Bucket, string | null>>;

function decodeTokens(token: string | null): Tokens {
  if (!token) return {};
  try {
    return JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    throw new HttpError(400, "bad_request", "That page of results is no longer available. Run the search again.");
  }
}

function encodeTokens(tokens: Tokens): string | null {
  if (!Object.values(tokens).some((t) => typeof t === "string")) return null;
  return btoa(JSON.stringify(tokens)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// deno-lint-ignore no-explicit-any
function readOutlierParams(body: any): OutlierParams {
  const query = String(body.query ?? "").replace(/\s+/g, " ").trim();
  if (query.length < 2 || query.length > 100) {
    throw new HttpError(400, "bad_request", "Type a topic between 2 and 100 characters.");
  }
  const window = Number(body.window_days ?? 30);
  const maxSubs = body.max_subs === null || body.max_subs === undefined || body.max_subs === "" ? null : Number(body.max_subs);
  const minViews = Number(body.min_views ?? 1000);
  return {
    query,
    mode: body.mode === "evergreen" ? "evergreen" : "breakout",
    format: body.format === "short" ? "short" : "long",
    window_days: [7, 30, 90, 365].includes(window) ? window : 30,
    max_subs: maxSubs !== null && Number.isFinite(maxSubs) && maxSubs > 0 ? maxSubs : null,
    min_views: Number.isFinite(minViews) && minViews >= 0 ? minViews : 1000,
    page_token: typeof body.page_token === "string" && body.page_token ? body.page_token : null,
  };
}

async function findOutliers(api: Api, params: OutlierParams) {
  const { sql } = api.deps;
  const now = api.deps.now();
  const buckets: Bucket[] = params.format === "short" ? ["short"] : ["medium", "long"];
  const tokens = decodeTokens(params.page_token);
  const active = buckets.filter((b) => tokens[b] !== null);
  await ensureBudget(api, active.length * SEARCH_COST + 100);

  const window = params.mode === "breakout"
    ? { order: "viewCount" as const, publishedAfter: new Date(now.getTime() - params.window_days * DAY_MS).toISOString() }
    : { order: "relevance" as const, publishedBefore: new Date(now.getTime() - 180 * DAY_MS).toISOString() };

  const pages = await Promise.all(active.map((bucket) =>
    searchVideoIds(api, { q: params.query, ...window, videoDuration: bucket, pageToken: tokens[bucket] ?? undefined })));
  const nextTokens: Tokens = {};
  buckets.forEach((b) => (nextTokens[b] = null));
  active.forEach((b, i) => (nextTokens[b] = pages[i].nextPageToken));

  const ids = [...new Set(pages.flatMap((p) => p.ids))];
  const videos = ids.length ? await fetchVideos(api, ids) : [];
  const hiddenLive = videos.filter((v) => v.is_live).length;
  const english = videos.filter((v) => v.is_live || isEnglish(v));
  const notEnglish = videos.length - english.length;
  const rightLength = english.filter((v) =>
    !v.is_live && (params.format === "short" ? v.duration_s > 0 && v.duration_s <= 180 : v.duration_s > 180));
  const belowMinViews = rightLength.filter((v) => v.views < params.min_views).length;
  let candidates = rightLength.filter((v) => v.views >= params.min_views).sort((a, b) => b.views - a.views);

  const channels = candidates.length ? await fetchChannels(api, { ids: candidates.map((v) => v.channel_id) }) : [];
  await upsertChannelStats(sql, channels);
  const channelById = new Map(channels.map((c) => [c.id, c]));

  let tooBig = 0;
  if (params.max_subs !== null) {
    const max = params.max_subs;
    const before = candidates.length;
    candidates = candidates.filter((v) => {
      const c = channelById.get(v.channel_id);
      return c !== undefined && c.subscribers !== null && c.subscribers <= max;
    });
    tooBig = before - candidates.length;
  }

  const keepChannels: string[] = [];
  for (const v of candidates) {
    if (!keepChannels.includes(v.channel_id) && keepChannels.length < MAX_CHANNELS_PER_RUN) keepChannels.push(v.channel_id);
  }
  candidates = candidates.filter((v) => keepChannels.includes(v.channel_id));

  const baselines = await ensureBaselines(api, keepChannels, params.format);
  if (params.format === "short") {
    // Between one and three minutes a video is only a Short if YouTube lists it as one.
    candidates = candidates.filter((v) =>
      v.duration_s <= 60 || (baselines.get(v.channel_id) ?? []).some((r) => r.id === v.id));
  }

  const scored = sortOutliers(candidates.map((v) =>
    scoreOutlier(v, params.format, channelById.get(v.channel_id), baselines.get(v.channel_id) ?? [], now)));

  if (scored.length) {
    await sql`
      insert into public.yt_research_videos
        (id, channel_id, channel_title, channel_subscribers, title, thumbnail_url, published_at, duration_s, format,
         views, likes, comments, tags, typical_views, outlier_score, views_per_day, fetched_at)
      select x.video_id, x.channel_id, x.channel_title, x.channel_subscribers, x.title, x.thumbnail_url, x.published_at,
             x.duration_s, x.format, x.views, x.likes, x.comments,
             coalesce((select array_agg(t) from jsonb_array_elements_text(x.tags) t), '{}'),
             x.typical_views, x.outlier_score, x.views_per_day, now()
      from jsonb_to_recordset(${sql.json(scored)}) as x(
        video_id text, channel_id text, channel_title text, channel_subscribers bigint, title text, thumbnail_url text,
        published_at timestamptz, duration_s integer, format text, views bigint, likes bigint, comments bigint,
        tags jsonb, typical_views numeric, outlier_score numeric, views_per_day numeric)
      on conflict (id) do update set
        channel_title = excluded.channel_title, channel_subscribers = excluded.channel_subscribers,
        title = excluded.title, thumbnail_url = excluded.thumbnail_url, duration_s = excluded.duration_s,
        format = excluded.format, views = excluded.views, likes = excluded.likes, comments = excluded.comments,
        tags = excluded.tags, typical_views = excluded.typical_views, outlier_score = excluded.outlier_score,
        views_per_day = excluded.views_per_day, fetched_at = now()`;
  }
  const savedRows = scored.length
    ? await sql`select id from public.yt_research_videos where saved and id in ${sql(scored.map((s) => s.video_id))}`
    : [];
  // deno-lint-ignore no-explicit-any
  const savedIds = new Set((savedRows as any[]).map((r) => r.id));
  const items: (OutlierItem & { saved: boolean })[] = scored.map((s) => ({ ...s, saved: savedIds.has(s.video_id) }));

  const units = api.units;
  const summary = {
    searched: videos.length,
    shown: items.length,
    hidden_live: hiddenLive,
    not_english: notEnglish,
    below_min_views: belowMinViews,
    channels_too_big: tooBig,
    channels: keepChannels.length,
    units,
  };
  const { page_token: _ignored, ...stored } = params;
  const [run] = await sql`
    insert into public.yt_research_runs (kind, query, params, results, summary, quota_units)
    values ('outliers', ${params.query}, ${sql.json(stored)}, ${sql.json(items)}, ${sql.json(summary)}, ${units})
    returning id`;
  const usedToday = await closeApi(api);
  return {
    run_id: run.id,
    items,
    next_page_token: encodeTokens(nextTokens),
    summary,
    quota: { used_today: usedToday, daily_budget: DAILY_BUDGET },
  };
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

function readKeyword(input: unknown): string {
  const keyword = normalizeKeyword(String(input ?? ""));
  if (keyword.length < 2 || keyword.length > 80) {
    throw new HttpError(400, "bad_request", "Type a search phrase between 2 and 80 characters.");
  }
  return keyword;
}

async function fetchSuggestions(deps: Deps, q: string): Promise<string[]> {
  const url = "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=en&gl=us&ie=utf8&oe=utf8&q=" +
    encodeURIComponent(q);
  const res = await deps.fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`suggest ${res.status}`);
  const body = JSON.parse(await res.text());
  return Array.isArray(body?.[1]) ? body[1].filter((s: unknown): s is string => typeof s === "string") : [];
}

/** Phrases people type into YouTube search that start with the seed. Costs no API budget. */
export async function suggest(deps: Deps, input: unknown) {
  const seed = readKeyword(input);
  const variants = [seed, ..."abcdefghijklmnopqrstuvwxyz".split("").map((letter) => `${seed} ${letter}`)];
  let failures = 0;
  const lists = await mapLimit(variants, 9, (q) =>
    fetchSuggestions(deps, q).catch(() => {
      failures++;
      return [] as string[];
    }));
  if (failures === variants.length) {
    throw new HttpError(
      502,
      "suggest_unavailable",
      "YouTube's search suggestions are not answering right now. You can still type a phrase and check it.",
    );
  }
  const seen = new Set<string>([seed]);
  const suggestions: { phrase: string; top: boolean }[] = [];
  lists.forEach((list, i) => {
    for (const raw of list) {
      const phrase = normalizeKeyword(raw);
      if (phrase.length < 2 || phrase.length > 80 || seen.has(phrase)) continue;
      seen.add(phrase);
      suggestions.push({ phrase, top: i === 0 });
    }
  });
  const results = suggestions.slice(0, 150);
  await deps.sql`
    insert into public.yt_research_runs (kind, query, results, summary)
    values ('suggest', ${seed}, ${deps.sql.json(results)}, ${deps.sql.json({ found: results.length })})`;
  return { seed, suggestions: results };
}

async function keyword(api: Api, input: unknown) {
  const { sql } = api.deps;
  const kw = readKeyword(input);
  await ensureBudget(api, SEARCH_COST + 2);
  const { ids } = await searchVideoIds(api, { q: kw, order: "relevance", maxResults: 25 });
  const videos = ids.length ? await fetchVideos(api, ids) : [];
  const byId = new Map(videos.map((v) => [v.id, v]));
  const ranked = ids.map((id) => byId.get(id)).filter((v): v is PublicVideo => Boolean(v));
  const channels = ranked.length ? await fetchChannels(api, { ids: ranked.map((v) => v.channel_id) }) : [];
  await upsertChannelStats(sql, channels);
  const channelById = new Map(channels.map((c) => [c.id, c]));
  const [me] = await sql`select id, subscribers from public.yt_channel order by updated_at desc limit 1`;

  const analysis = analyzeKeyword(
    kw,
    ranked.map((video) => ({ video, channel: channelById.get(video.channel_id) })),
    { myChannelId: me?.id ?? null, mySubscribers: me?.subscribers == null ? null : Number(me.subscribers), now: api.deps.now() },
  );

  const [row] = await sql`
    insert into public.yt_keywords
      (keyword, volume_score, competition_score, overall_score, signals, results, my_rank, my_video_id, analyzed_at)
    values (${analysis.keyword}, ${analysis.volume_score}, ${analysis.competition_score}, ${analysis.overall_score},
            ${sql.json(analysis.signals)}, ${sql.json(analysis.results)}, ${analysis.my_rank}, ${analysis.my_video_id}, now())
    on conflict (keyword) do update set
      volume_score = excluded.volume_score, competition_score = excluded.competition_score,
      overall_score = excluded.overall_score, signals = excluded.signals, results = excluded.results,
      my_rank = excluded.my_rank, my_video_id = excluded.my_video_id, analyzed_at = now()
    returning saved`;
  const units = api.units;
  await sql`
    insert into public.yt_research_runs (kind, query, results, summary, quota_units)
    values ('keyword', ${analysis.keyword}, ${sql.json(analysis.results)},
            ${sql.json({ overall_score: analysis.overall_score, verdict: analysis.verdict, units })}, ${units})`;
  const usedToday = await closeApi(api);
  return { ...analysis, saved: Boolean(row?.saved), quota: { used_today: usedToday, daily_budget: DAILY_BUDGET } };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export async function research(deps: Deps, body: any): Promise<unknown> {
  const action = String(body?.action ?? "");
  if (action === "suggest") return suggest(deps, body.seed);
  if (!["outliers", "keyword", "channel_lookup", "channel_watch", "channel_refresh"].includes(action)) {
    throw new HttpError(400, "bad_request", "Unknown research action.");
  }
  const api = await openApi(deps);
  try {
    switch (action) {
      case "outliers":
        return await findOutliers(api, readOutlierParams(body));
      case "keyword":
        return await keyword(api, body.keyword);
      case "channel_lookup":
        return await channelLookup(api, String(body.input ?? ""));
      case "channel_watch":
        return await channelWatch(api, String(body.channel_id ?? ""));
      default:
        return await channelRefresh(api, String(body.channel_id ?? ""));
    }
  } finally {
    // Whatever happened, record what was spent (a no-op when already recorded).
    await closeApi(api).catch(() => undefined);
  }
}
