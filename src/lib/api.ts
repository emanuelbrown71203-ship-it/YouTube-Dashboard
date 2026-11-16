// Every read and write the screens make. Table and column names are checked
// against the generated database types at compile time.

import { FUNCTION_URL, supabase, SUPABASE_KEY } from "./supabase.ts";
import type {
  Channel, Connection, DailyRow, FormatDailyRow, Idea, IdeaDraft, KeywordResponse, KeywordRow, MyFormat,
  OutlierResponse, OutlierSearch, OwnerRow, Quota, Report, ResearchChannel, ResearchRun, SavedVideo, SyncRun, Video,
} from "./types.ts";

/** An error whose message is already written for the person using the app. */
export class ApiError extends Error {
  constructor(message: string, public code = "error", public status = 0) {
    super(message);
  }
}

function fail(error: { message: string; code?: string } | null): void {
  if (!error) return;
  if (error.code === "42501" || /not allowed|permission denied/i.test(error.message)) {
    throw new ApiError("This browser is no longer signed in. Reload the page.", "not_owner", 403);
  }
  throw new ApiError(error.message, error.code);
}

const PAGE = 1000;
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    fail(error);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Each browser gets its own anonymous session; being let in is a separate step. */
let starting: Promise<void> | null = null;
export function ensureSession(): Promise<void> {
  starting ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw new ApiError("Could not reach the dashboard's database. Check your connection and reload.", "offline");
  })().catch((err) => {
    starting = null;
    throw err;
  });
  return starting;
}

export async function whoami(): Promise<{ owner: boolean; method?: string }> {
  const { data, error } = await supabase.rpc("yt_whoami");
  fail(error);
  return data as { owner: boolean; method?: string };
}

export async function publicStatus(): Promise<{ google_configured: boolean; youtube_connected: boolean }> {
  const { data, error } = await supabase.rpc("yt_public_status");
  fail(error);
  return data as { google_configured: boolean; youtube_connected: boolean };
}

export function describeDevice(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox"
    : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${device}, ${browser}`;
}

export async function redeemCode(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("yt_redeem_access_code", { p_code: code, p_device: describeDevice() });
  fail(error);
  return data === true;
}

export async function signOut(everywhere: boolean): Promise<void> {
  const { error } = await supabase.rpc("yt_sign_out", { p_everywhere: everywhere });
  fail(error);
}

export async function createAccessCode(): Promise<string> {
  const { data, error } = await supabase.rpc("yt_create_access_code", { p_note: `made on ${describeDevice()}` });
  fail(error);
  return data as string;
}

export async function getOwners(): Promise<OwnerRow[]> {
  const { data, error } = await supabase.from("yt_owners")
    .select("user_id, method, device, created_at, last_seen_at, revoked_at")
    .is("revoked_at", null).order("last_seen_at", { ascending: false });
  fail(error);
  return (data ?? []) as OwnerRow[];
}

export async function currentUserId(): Promise<string | null> {
  return (await supabase.auth.getSession()).data.session?.user.id ?? null;
}

// ---------------------------------------------------------------------------
// The yt-api edge function
// ---------------------------------------------------------------------------

async function callApi<T>(path: string, body: unknown = {}): Promise<T> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${FUNCTION_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY, authorization: `Bearer ${token ?? ""}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Could not reach the server. Check your connection and try again.", "offline");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? data?.message ?? "The server did not answer properly. Try again in a moment.", data?.code ?? "server_error", res.status);
  }
  return data as T;
}

export const startGoogleSignIn = () => callApi<{ url: string }>("/auth/start", { return_to: window.location.origin });
export const saveGoogleClient = (client_id: string, client_secret: string) =>
  callApi<{ ok: true; redirect_uri: string }>("/auth/setup", { client_id, client_secret });
export const disconnectYouTube = () => callApi<{ ok: true }>("/auth/disconnect");
export const syncNow = () => callApi<{ status: string; message?: string }>("/sync");

export const findOutliers = (search: OutlierSearch, page_token: string | null = null) =>
  callApi<OutlierResponse>("/research", { action: "outliers", ...search, page_token });
export const suggestKeywords = (seed: string) =>
  callApi<{ seed: string; suggestions: { phrase: string; top: boolean }[] }>("/research", { action: "suggest", seed });
export const checkKeyword = (keyword: string) => callApi<KeywordResponse>("/research", { action: "keyword", keyword });
export const lookupChannel = (input: string) =>
  callApi<{ channels: (Pick<ResearchChannel, "id" | "title" | "handle" | "thumbnail_url" | "subscribers" | "subscribers_hidden" | "videos" | "watched">)[]; quota: Quota }>(
    "/research", { action: "channel_lookup", input });
export const watchChannel = (channel_id: string) =>
  callApi<{ channel: ResearchChannel; quota: Quota }>("/research", { action: "channel_watch", channel_id });
export const refreshChannel = (channel_id: string) =>
  callApi<{ channel: ResearchChannel; quota: Quota }>("/research", { action: "channel_refresh", channel_id });

export async function getConnection(): Promise<Connection> {
  const { data, error } = await supabase.rpc("yt_connection");
  fail(error);
  return data as unknown as Connection;
}

// ---------------------------------------------------------------------------
// Channel stats
// ---------------------------------------------------------------------------

export async function getChannel(): Promise<Channel | null> {
  const { data, error } = await supabase.from("yt_channel")
    .select("id, title, handle, thumbnail_url, subscribers, views, videos, updated_at")
    .order("updated_at", { ascending: false }).limit(1);
  fail(error);
  return (data?.[0] as Channel | undefined) ?? null;
}

export const getDaily = () =>
  all<DailyRow>((from, to) => supabase.from("yt_analytics_daily")
    .select("date, views, engaged_views, minutes_watched, subs_gained, subs_lost, likes, comments, shares")
    .order("date").range(from, to));

export const getFormatDaily = () =>
  all<FormatDailyRow>((from, to) => supabase.from("yt_content_type_daily")
    .select("date, content_type, views, engaged_views, minutes_watched")
    .order("date").order("content_type").range(from, to));

export const getVideos = () =>
  all<Video>((from, to) => supabase.from("yt_v_videos")
    .select("id, title, content_type, privacy, published_at, duration_s, views, likes, comments, shares, subs_gained, watch_hours, avg_view_duration_s, avg_view_pct, age_days, views_per_day, engagement_pct, typical_views, vs_typical, search_pct, recommended_pct, discovery, url, thumbnail_url, tags, traffic")
    .order("published_at", { ascending: false, nullsFirst: false }).order("id").range(from, to));

export async function getMyFormats(): Promise<MyFormat[]> {
  const { data, error } = await supabase.from("yt_v_my_formats")
    .select("content_type, public_videos, uploads_30d, uploads_90d, last_upload_at, typical_views");
  fail(error);
  return (data ?? []) as unknown as MyFormat[];
}

export async function getReports(): Promise<Record<string, Report>> {
  const { data, error } = await supabase.from("yt_reports").select("key, period_start, period_end, data, fetched_at");
  fail(error);
  return Object.fromEntries(((data ?? []) as unknown as Report[]).map((r) => [r.key, r]));
}

export async function getSyncRuns(limit = 6): Promise<SyncRun[]> {
  const { data, error } = await supabase.from("yt_sync_runs")
    .select("id, source, status, started_at, finished_at, summary, error")
    .order("started_at", { ascending: false }).limit(limit);
  fail(error);
  return (data ?? []) as unknown as SyncRun[];
}

export async function setVideoType(id: string, type: "short" | "long" | "live"): Promise<void> {
  const { error } = await supabase.rpc("yt_set_video_type", { p_video_id: id, p_type: type });
  fail(error);
}

export async function getBriefing(): Promise<unknown> {
  const { data, error } = await supabase.rpc("yt_claude_context");
  fail(error);
  return data;
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

const IDEA_COLUMNS =
  "id, format, status, discovery, title, title_options, target_keyword, hook, concept, outline, thumbnail_concept, priority, target_date, inspiration_url, inspiration_video_id, notes, video_id, parent_id, sort_order, source, created_at, updated_at";

export async function getIdeas(): Promise<Idea[]> {
  const { data, error } = await supabase.from("yt_ideas").select(IDEA_COLUMNS)
    .is("trashed_at", null).eq("archived", false).order("sort_order").limit(1000);
  fail(error);
  return (data ?? []) as unknown as Idea[];
}

export async function saveIdea(draft: IdeaDraft): Promise<Idea> {
  const { id, ...fields } = draft;
  const clean = { ...fields, title: fields.title.trim() };
  if (!clean.title) throw new ApiError("Give the idea a title first.", "bad_request");
  const query = id
    ? supabase.from("yt_ideas").update(clean).eq("id", id).select(IDEA_COLUMNS)
    : supabase.from("yt_ideas").insert(clean).select(IDEA_COLUMNS);
  const { data, error } = await query;
  fail(error);
  if (!data?.[0]) throw new ApiError("That idea could not be saved. Reload and try again.", "not_saved");
  return data[0] as unknown as Idea;
}

export async function setIdeaTrashed(id: string, trashed: boolean): Promise<void> {
  const { error } = await supabase.from("yt_ideas")
    .update({ trashed_at: trashed ? new Date().toISOString() : null }).eq("id", id);
  fail(error);
}

// ---------------------------------------------------------------------------
// Research (reads; the lookups themselves go through the edge function)
// ---------------------------------------------------------------------------

export function pacificDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

export async function getQuotaUsed(): Promise<number> {
  const { data, error } = await supabase.from("yt_quota_usage").select("day, units").eq("day", pacificDay()).limit(1);
  fail(error);
  return data?.[0]?.units ?? 0;
}

export async function getResearchRuns<T>(kind: ResearchRun["kind"], limit = 8): Promise<ResearchRun<T>[]> {
  const { data, error } = await supabase.from("yt_research_runs")
    .select("id, kind, query, params, results, summary, created_at")
    .eq("kind", kind).order("created_at", { ascending: false }).limit(limit);
  fail(error);
  return (data ?? []) as unknown as ResearchRun<T>[];
}

export async function getSavedVideos(): Promise<SavedVideo[]> {
  const { data, error } = await supabase.from("yt_research_videos")
    .select("id, channel_id, channel_title, channel_subscribers, title, thumbnail_url, published_at, duration_s, format, views, typical_views, outlier_score, views_per_day, saved_at")
    .eq("saved", true).order("saved_at", { ascending: false }).limit(200);
  fail(error);
  return (data ?? []) as unknown as SavedVideo[];
}

export async function saveResearchVideo(id: string, saved: boolean): Promise<void> {
  const { error } = await supabase.rpc("yt_save_research_video", { p_video_id: id, p_saved: saved });
  fail(error);
}

export async function getKeywords(): Promise<KeywordRow[]> {
  const { data, error } = await supabase.from("yt_keywords")
    .select("keyword, volume_score, competition_score, overall_score, signals, results, my_rank, my_video_id, saved, analyzed_at")
    .order("analyzed_at", { ascending: false }).limit(200);
  fail(error);
  return (data ?? []) as unknown as KeywordRow[];
}

export async function saveKeyword(keyword: string, saved: boolean): Promise<void> {
  const { error } = await supabase.rpc("yt_save_keyword", { p_keyword: keyword, p_saved: saved });
  fail(error);
}

export async function getWatchedChannels(): Promise<ResearchChannel[]> {
  const { data, error } = await supabase.from("yt_research_channels")
    .select("id, title, handle, thumbnail_url, subscribers, subscribers_hidden, views, videos, watched, typical_long, typical_short, uploads_30d_long, uploads_30d_short, recent_long, recent_short, baseline_long_at, baseline_short_at")
    .eq("watched", true).order("subscribers", { ascending: false, nullsFirst: false });
  fail(error);
  return (data ?? []) as unknown as ResearchChannel[];
}

export async function stopWatchingChannel(id: string): Promise<void> {
  const { error } = await supabase.rpc("yt_watch_channel", { p_channel_id: id, p_watched: false });
  fail(error);
}
