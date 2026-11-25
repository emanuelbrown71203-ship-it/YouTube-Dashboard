// Everything that talks to Google: sign-in tokens, the YouTube Data API,
// the YouTube Analytics API and the daily budget. Runtime-agnostic: the
// database client, fetch and the clock are injected so tests can replace them.

import { parseIsoDuration, type PublicChannel, type PublicVideo } from "./scoring.ts";

// deno-lint-ignore no-explicit-any
export type Sql = any; // a postgres.js client

export interface Deps {
  sql: Sql;
  fetch: typeof fetch;
  /** Resolves a Supabase access token to its user id, or null if it is not valid. */
  verifyUser: (accessToken: string) => Promise<string | null>;
  now: () => Date;
  /** Public base URL of this function, e.g. https://<ref>.supabase.co/functions/v1/yt-api */
  functionUrl: string;
  /** Keeps work running after the response has been sent (edge runtime only). */
  background?: (work: Promise<unknown>) => void;
  /** Asks the AI for a JSON answer that follows a schema (edge runtime, or a stand-in in tests). */
  claude?: (apiKey: string, req: {
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    effort?: string;
    /** Pictures to look at before the prompt, each with a line saying what it is (base64 JPEG or PNG). */
    images?: { label: string; media_type: "image/jpeg" | "image/png"; data: string }[];
  }) => Promise<unknown>;
  log?: (...args: unknown[]) => void;
}

/** An error whose message is written for the person using the app. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: string) {
    super(message);
  }
}

export const DAILY_BUDGET = 10_000;
/** Research stops here so the automatic sync always has room left. */
export const RESEARCH_CEILING = 9_000;
export const SEARCH_COST = 100;

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
/** Asked for as well, but optional: without it everything works except estimated earnings. */
export const EARNINGS_SCOPE = "https://www.googleapis.com/auth/yt-analytics-monetary.readonly";
/**
 * Also optional. YouTube only lets an app read comments under this wider permission,
 * which Google words as managing the account; this app never writes with it.
 */
export const COMMENTS_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
/**
 * Also optional: lets the dashboard make Google Docs of the owner's notes for their editor. It only
 * reaches files the dashboard itself created, never the rest of the owner's Drive.
 */
export const DOCS_SCOPE = "https://www.googleapis.com/auth/drive.file";

// ---------------------------------------------------------------------------
// Server-only settings (public.yt_private)
// ---------------------------------------------------------------------------

export async function getConfig(sql: Sql, keys: string[]): Promise<Record<string, string>> {
  const rows = await sql`select key, value from public.yt_private where key in ${sql(keys)}`;
  const out: Record<string, string> = {};
  for (const r of rows) if (r.value !== "") out[r.key] = r.value;
  return out;
}

export async function setConfig(sql: Sql, values: Record<string, string>): Promise<void> {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value }));
  if (rows.length === 0) return;
  await sql`
    insert into public.yt_private (key, value, updated_at)
    select x.key, x.value, now() from jsonb_to_recordset(${sql.json(rows)}) as x(key text, value text)
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
}

// ---------------------------------------------------------------------------
// Google sign-in tokens
// ---------------------------------------------------------------------------

export async function exchangeToken(deps: Deps, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await deps.fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new HttpError(
      502,
      String(body.error ?? "google_error"),
      `Google did not accept the sign-in (${String(body.error_description ?? body.error ?? res.status)}).`,
    );
  }
  return body;
}

/** A valid access token for the connected channel, refreshed when needed. */
export async function getAccessToken(deps: Deps): Promise<string> {
  const c = await getConfig(deps.sql, [
    "google_client_id", "google_client_secret", "google_refresh_token", "google_access_token", "google_access_expires",
  ]);
  if (!c.google_client_id || !c.google_client_secret) {
    throw new HttpError(409, "not_configured", "Google is not set up yet. Finish the Connect YouTube steps in Settings.");
  }
  if (!c.google_refresh_token) {
    throw new HttpError(409, "not_connected", "YouTube is not connected yet. Connect it in Settings.");
  }
  if (c.google_access_token && Number(c.google_access_expires) - 60_000 > deps.now().getTime()) {
    return c.google_access_token;
  }
  let body: Record<string, unknown>;
  try {
    body = await exchangeToken(deps, {
      client_id: c.google_client_id,
      client_secret: c.google_client_secret,
      refresh_token: c.google_refresh_token,
      grant_type: "refresh_token",
    });
  } catch (err) {
    if (err instanceof HttpError && err.code === "invalid_grant") {
      const message = "Google sign-in expired or was removed. Connect YouTube again in Settings.";
      await setConfig(deps.sql, { google_error: message, google_refresh_token: "", google_access_token: "" });
      throw new HttpError(409, "reconnect", message);
    }
    throw err;
  }
  const token = String(body.access_token ?? "");
  if (!token) throw new HttpError(502, "google_error", "Google returned no access token.");
  await setConfig(deps.sql, {
    google_access_token: token,
    google_access_expires: String(deps.now().getTime() + Number(body.expires_in ?? 3600) * 1000),
    google_error: "",
  });
  return token;
}

// ---------------------------------------------------------------------------
// API session: one per request, counts what it spends
// ---------------------------------------------------------------------------

export interface Api {
  deps: Deps;
  token: string;
  units: number;
  calls: number;
}

export async function openApi(deps: Deps): Promise<Api> {
  return { deps, token: await getAccessToken(deps), units: 0, calls: 0 };
}

/** Record what this request spent. Safe to call more than once. */
export async function closeApi(api: Api): Promise<number> {
  const { units, calls } = api;
  api.units = 0;
  api.calls = 0;
  if (calls === 0) return quotaUsedToday(api.deps.sql);
  const [row] = await api.deps.sql`select public.yt_quota_add(${units}, ${calls}) as total`;
  return Number(row.total);
}

export async function quotaUsedToday(sql: Sql): Promise<number> {
  const [row] = await sql`select coalesce((select units from public.yt_quota_usage where day = public.yt_quota_day()), 0) as units`;
  return Number(row.units);
}

export async function ensureBudget(api: Api, cost: number): Promise<void> {
  const used = (await quotaUsedToday(api.deps.sql)) + api.units;
  if (used + cost > RESEARCH_CEILING) {
    throw new HttpError(
      429,
      "quota",
      "Today's free YouTube lookups are used up. They reset at midnight Pacific time.",
    );
  }
}

async function googleError(res: Response): Promise<HttpError> {
  // deno-lint-ignore no-explicit-any
  const body: any = await res.json().catch(() => ({}));
  const err = body?.error ?? {};
  const reason: string = err.errors?.[0]?.reason ?? err.status ?? "";
  const detail = `${res.status} ${reason} ${err.message ?? ""}`.trim();
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded|RESOURCE_EXHAUSTED/i.test(reason)) {
    return new HttpError(429, "quota", "Today's free YouTube lookups are used up. They reset at midnight Pacific time.", detail);
  }
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used in project|is disabled/i.test(err.message ?? "")) {
    return new HttpError(
      409,
      "api_disabled",
      "A YouTube API is switched off in your Google project. Turn on both \"YouTube Data API v3\" and \"YouTube Analytics API\", wait a minute, then try again.",
      detail,
    );
  }
  if (res.status === 401) {
    return new HttpError(409, "reconnect", "Google sign-in is no longer valid. Connect YouTube again in Settings.", detail);
  }
  if (res.status === 404) return new HttpError(404, reason || "not_found", "YouTube could not find that.", detail);
  return new HttpError(502, reason || "google_error", `YouTube returned an error (${err.message ?? res.status}).`, detail);
}

type Params = Record<string, string | number | boolean | undefined | null>;

function withParams(base: string, params: Params): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** One YouTube Data API call. cost = quota units (a search is 100, most calls 1). */
// deno-lint-ignore no-explicit-any
export async function ytGet(api: Api, path: string, params: Params, cost = 1): Promise<any> {
  const res = await api.deps.fetch(withParams(`https://www.googleapis.com/youtube/v3/${path}`, params), {
    headers: { authorization: `Bearer ${api.token}`, accept: "application/json" },
  });
  api.units += cost;
  api.calls += 1;
  if (!res.ok) throw await googleError(res);
  return res.json();
}

export interface Report {
  columns: string[];
  rows: (string | number)[][];
}

/** One YouTube Analytics report for the connected channel. */
export async function analytics(api: Api, params: Params): Promise<Report> {
  const res = await api.deps.fetch(
    withParams("https://youtubeanalytics.googleapis.com/v2/reports", { ids: "channel==MINE", ...params }),
    { headers: { authorization: `Bearer ${api.token}`, accept: "application/json" } },
  );
  if (!res.ok) throw await googleError(res);
  // deno-lint-ignore no-explicit-any
  const body: any = await res.json();
  return {
    // deno-lint-ignore no-explicit-any
    columns: (body.columnHeaders ?? []).map((h: any) => String(h.name)),
    rows: body.rows ?? [],
  };
}

export function reportObjects(report: Report): Record<string, string | number>[] {
  return report.rows.map((row) => Object.fromEntries(report.columns.map((c, i) => [c, row[i]])));
}

// ---------------------------------------------------------------------------
// Typed helpers over the Data API
// ---------------------------------------------------------------------------

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** YouTube keeps a hidden playlist per channel tab: all uploads, Shorts only, videos only, live only. */
export function playlistFor(channelId: string, kind: "uploads" | "shorts" | "long" | "live"): string {
  const prefix = { uploads: "UU", shorts: "UUSH", long: "UULF", live: "UULV" }[kind];
  return prefix + channelId.slice(2);
}

// deno-lint-ignore no-explicit-any
function thumbnail(snippet: any): string | null {
  const t = snippet?.thumbnails ?? {};
  return t.medium?.url ?? t.high?.url ?? t.default?.url ?? null;
}

// deno-lint-ignore no-explicit-any
function num(value: any): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// deno-lint-ignore no-explicit-any
export function toChannel(item: any): PublicChannel {
  const s = item.snippet ?? {};
  const st = item.statistics ?? {};
  return {
    id: item.id,
    title: s.title ?? "",
    handle: s.customUrl ?? null,
    thumbnail_url: thumbnail(s),
    country: s.country ?? null,
    published_at: s.publishedAt ?? null,
    subscribers: st.hiddenSubscriberCount ? null : num(st.subscriberCount),
    subscribers_hidden: Boolean(st.hiddenSubscriberCount),
    views: num(st.viewCount) ?? 0,
    videos: num(st.videoCount) ?? 0,
    uploads_playlist_id: item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

export async function fetchChannels(
  api: Api,
  by: { mine: true } | { ids: string[] } | { handle: string },
): Promise<PublicChannel[]> {
  const part = "snippet,statistics,contentDetails";
  if ("mine" in by) return ((await ytGet(api, "channels", { part, mine: true })).items ?? []).map(toChannel);
  if ("handle" in by) {
    return ((await ytGet(api, "channels", { part, forHandle: by.handle })).items ?? []).map(toChannel);
  }
  const unique = [...new Set(by.ids)];
  const pages = await mapLimit(chunk(unique, 50), 4, (ids) => ytGet(api, "channels", { part, id: ids.join(","), maxResults: 50 }));
  return pages.flatMap((p) => (p.items ?? []).map(toChannel));
}

/** Video ids in a playlist, newest first. A playlist that does not exist is empty. */
export async function fetchPlaylistIds(api: Api, playlistId: string, max: number): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const page = await ytGet(api, "playlistItems", {
        part: "contentDetails", playlistId, maxResults: Math.min(50, max - ids.length), pageToken,
      });
      // deno-lint-ignore no-explicit-any
      for (const item of page.items ?? []) ids.push((item as any).contentDetails.videoId);
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return ids;
    throw err;
  }
  return ids;
}

// deno-lint-ignore no-explicit-any
export function toVideo(item: any): PublicVideo {
  const s = item.snippet ?? {};
  const st = item.statistics ?? {};
  return {
    id: item.id,
    channel_id: s.channelId ?? "",
    channel_title: s.channelTitle ?? "",
    title: s.title ?? "",
    description: s.description ?? "",
    thumbnail_url: thumbnail(s),
    published_at: s.publishedAt ?? "",
    duration_s: parseIsoDuration(item.contentDetails?.duration),
    views: num(st.viewCount) ?? 0,
    likes: num(st.likeCount),
    comments: num(st.commentCount),
    tags: Array.isArray(s.tags) ? s.tags : [],
    is_live: Boolean(item.liveStreamingDetails) || s.liveBroadcastContent === "live" || s.liveBroadcastContent === "upcoming",
    privacy: item.status?.privacyStatus ?? null,
    language: s.defaultAudioLanguage ?? s.defaultLanguage ?? null,
    category: s.categoryId ?? null,
  };
}

export async function fetchVideos(api: Api, ids: string[]): Promise<PublicVideo[]> {
  const unique = [...new Set(ids)];
  const pages = await mapLimit(chunk(unique, 50), 5, (batch) =>
    ytGet(api, "videos", {
      part: "snippet,statistics,contentDetails,status,liveStreamingDetails", id: batch.join(","), maxResults: 50,
    }));
  return pages.flatMap((p) => (p.items ?? []).map(toVideo));
}

export interface VideoSearch {
  q: string;
  order: "viewCount" | "relevance" | "date";
  publishedAfter?: string;
  publishedBefore?: string;
  videoDuration?: "short" | "medium" | "long";
  /** YouTube's category, such as "20" for Gaming. */
  videoCategoryId?: string;
  pageToken?: string;
  maxResults?: number;
}

export async function searchVideoIds(api: Api, p: VideoSearch): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const page = await ytGet(api, "search", {
    part: "id", type: "video", q: p.q, order: p.order, maxResults: p.maxResults ?? 50,
    publishedAfter: p.publishedAfter, publishedBefore: p.publishedBefore, videoDuration: p.videoDuration, videoCategoryId: p.videoCategoryId,
    pageToken: p.pageToken, safeSearch: "none", regionCode: "US", relevanceLanguage: "en",
  }, SEARCH_COST);
  return {
    // deno-lint-ignore no-explicit-any
    ids: (page.items ?? []).map((i: any) => i.id?.videoId).filter(Boolean),
    nextPageToken: page.nextPageToken ?? null,
  };
}

export async function searchChannelIds(api: Api, q: string, maxResults = 8): Promise<string[]> {
  const page = await ytGet(api, "search", { part: "id", type: "channel", q, maxResults }, SEARCH_COST);
  // deno-lint-ignore no-explicit-any
  return (page.items ?? []).map((i: any) => i.id?.channelId).filter(Boolean);
}
