// Every read and write the screens make. Table and column names are checked
// against the generated database types at compile time.

import { FUNCTION_URL, supabase, SUPABASE_KEY } from "./supabase.ts";
import type {
  Channel, Connection, DailyRow, FormatDailyRow, Idea, IdeaDraft, KeywordResponse, KeywordRow, MyFormat,
  OutlierResponse, OutlierSearch, OwnerRow, Quota, RefInput, Report, ResearchChannel, ResearchRun, SavedVideo, SyncRun, Video,
} from "./types.ts";

/** An error whose message is already written for the person using the app. */
export class ApiError extends Error {
  constructor(message: string, public code = "error", public status = 0) {
    super(message);
  }
}

export function fail(error: { message: string; code?: string } | null): void {
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

const VERIFIER_KEY = "yt-google-verifier";
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Starts Google sign-in. A secret stays in this browser and only its hash is
 * sent, so the sign-in can only be finished from here, never from a link
 * someone else started.
 */
export async function startGoogleSignIn(): Promise<{ url: string }> {
  const verifier = hex(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  localStorage.setItem(VERIFIER_KEY, verifier);
  return callApi<{ url: string }>("/auth/start", { return_to: window.location.origin, challenge });
}

/** Google sent the browser back with a one-time grant: prove this is the browser that asked. */
export async function finishGoogleSignIn(grant: string): Promise<void> {
  const verifier = localStorage.getItem(VERIFIER_KEY) ?? "";
  localStorage.removeItem(VERIFIER_KEY);
  await callApi("/auth/finish", { grant, verifier, device: describeDevice() });
}
export const saveGoogleClient = (client_id: string, client_secret: string) =>
  callApi<{ ok: true; redirect_uri: string }>("/auth/setup", { client_id, client_secret });
export const disconnectYouTube = () => callApi<{ ok: true }>("/auth/disconnect");
export const saveAiKey = (api_key: string) => callApi<{ ok: true; ai: boolean }>("/ai/setup", { api_key });
export interface Explanation {
  title_en: string;
  what_happens: string;
  why_it_worked: string;
  your_version: string;
  confidence: "high" | "medium" | "low";
}
export const explainVideo = (video_id: string) =>
  callApi<{ video_id: string; explanation: Explanation }>("/research", { action: "explain", video_id });
export interface TitleIdea { title: string; why: string; emotions?: import("./emotions.ts").Emotion[] }
export const suggestTitles = (idea: { title: string; concept: string; format: "long" | "short"; game: string | null }) =>
  callApi<{ titles: TitleIdea[] }>("/ai/titles", idea);
export interface TemplateCheck {
  score: number;
  checks: { template_id: string; name: string; kind: string; score: number; met: string[]; missing: string[]; fix: string }[];
}
export const checkIdea = (idea_id: string) => callApi<TemplateCheck & { idea_id: string }>("/ai/check", { idea_id });
export interface PastedIdea {
  title: string;
  format: "long" | "short";
  topic: string | null;
  hook: string | null;
  concept: string | null;
  thumbnail_concept: string | null;
  title_options: string[];
}
export const readPastedIdeas = (text: string) => callApi<{ ideas: PastedIdea[] }>("/ai/import", { text });
export const connector = (action: "status" | "create" | "remove") =>
  callApi<{ connected: boolean; url?: string; created_at?: string | null; used_at?: string | null }>("/mcp/setup", { action });
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
    .select("id, title, content_type, privacy, published_at, duration_s, views, likes, comments, shares, subs_gained, watch_hours, avg_view_duration_s, avg_view_pct, age_days, views_per_day, engagement_pct, typical_views, vs_typical, search_pct, recommended_pct, discovery, url, thumbnail_url, tags, traffic, estimated_revenue, revenue_per_1000_views, topic, feeders")
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
  "id, format, status, discovery, title, title_options, target_keyword, hook, concept, outline, thumbnail_concept, priority, target_date, inspiration_url, inspiration_video_id, notes, video_id, parent_id, sort_order, source, created_at, updated_at, topic, template_check, template_checked_at, picked_at, in_suggested, suggested_at, suggestion";

export async function getIdeas(): Promise<Idea[]> {
  const { data, error } = await supabase.from("yt_ideas").select(IDEA_COLUMNS)
    .is("trashed_at", null).eq("archived", false).eq("in_suggested", false).order("sort_order").limit(1000);
  fail(error);
  return (data ?? []) as unknown as Idea[];
}

/** Ideas the dashboard wrote that are waiting in the Suggested tab, newest first. */
export async function getSuggestions(): Promise<Idea[]> {
  const { data, error } = await supabase.from("yt_ideas").select(IDEA_COLUMNS)
    .eq("in_suggested", true).is("trashed_at", null).order("suggested_at", { ascending: false }).limit(200);
  fail(error);
  return (data ?? []) as unknown as Idea[];
}

/** Keeps a suggestion: it joins the board under its game, with the title the owner picked. */
export async function keepSuggestion(id: string, titles?: { title: string; title_options: string[] }): Promise<void> {
  const { error } = await supabase.from("yt_ideas").update({ in_suggested: false, ...(titles ?? {}) }).eq("id", id);
  fail(error);
}

/** "Not for me": the suggestion goes in the bin, and the next batch stays away from ideas like it. */
export async function dismissSuggestion(id: string): Promise<void> {
  const { error } = await supabase.from("yt_ideas").update({ trashed_at: new Date().toISOString() }).eq("id", id);
  fail(error);
}

/** Has the dashboard write a batch of suggestions now. Takes about a minute. */
export const askForSuggestions = () =>
  callApi<{ made: "batch" | "follow_up" | "nothing"; added: { id: string; title: string }[]; dropped?: number; running?: boolean; checking?: boolean }>("/ideas/suggest", {});

/** A first draft of an idea's hook, what happens and beats. */
export const draftScript = (body: { idea_id?: string; title: string; game: string | null; format: string; hook?: string | null; concept?: string | null; outline?: string | null }) =>
  callApi<{ hook: string; concept: string; outline: string }>("/ai/script", body);

export async function saveIdea(draft: IdeaDraft): Promise<Idea> {
  // The AI's reading against the templates is written by the server only, never from here, and
  // references waiting for the idea to be saved go in their own table once it is.
  const { id, template_check: _check, template_checked_at: _checkedAt, pending_refs: _refs, in_suggested: _waiting, suggested_at: _suggested, suggestion: _why, ...fields } = draft;
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
    // The checks the dashboard runs on each idea are kept in the same table; they are not searches to browse.
    .eq("kind", kind).not("params", "cs", '{"mode":"idea"}').order("created_at", { ascending: false }).limit(limit);
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

/** Every video the outlier searches have turned up, light enough to score ideas against. */
export async function getFoundVideos() {
  const { data, error } = await supabase.from("yt_research_videos")
    .select("id, title, tags, format, views, outlier_score, channel_subscribers, published_at")
    .order("published_at", { ascending: false }).limit(2000);
  fail(error);
  return (data ?? []) as unknown as import("./ideaScore.ts").FoundVideo[];
}

/** Which games the outlier searches have covered lately, and in which format: `game` is the phrase searched. */
export async function getCoveredGames() {
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("yt_research_runs").select("query, params, created_at")
    .eq("kind", "outliers").gte("created_at", since).order("created_at", { ascending: false }).limit(400);
  fail(error);
  return ((data ?? []) as unknown as { query: string; params: { format?: string; mode?: string } | null; created_at: string }[])
    .filter((r) => (r.params?.mode ?? "breakout") === "breakout")
    .map((r) => ({ game: r.query, format: r.params?.format === "short" ? "short" as const : "long" as const, at: r.created_at }));
}
/** The newest finished check on each idea: what a YouTube search for that exact video found. */
export async function getIdeaChecks() {
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("yt_research_runs").select("params, summary, created_at")
    .eq("kind", "outliers").contains("params", { mode: "idea" }).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(600);
  fail(error);
  type Row = { params: { idea_id?: string; title?: string; game?: string }; summary: Record<string, unknown>; created_at: string };
  const out: { idea_id: string; title: string; game: string; market: import("./ideaScore.ts").Market }[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const id = row.params?.idea_id;
    // A check still running, or one that failed, is not an answer.
    if (!id || seen.has(id) || !row.summary || "pending" in row.summary || "failed" in row.summary || !row.summary.same) continue;
    seen.add(id);
    out.push({ idea_id: id, title: row.params.title ?? "", game: row.params.game ?? "", market: { ...(row.summary as unknown as import("./ideaScore.ts").Market), at: row.created_at } });
  }
  return out;
}
// ---------------------------------------------------------------------------
// Thumbnail references
// ---------------------------------------------------------------------------

/** A long-form video from another channel that beat its channel's usual, for its thumbnail. */
export interface FoundThumb {
  id: string;
  channel_id: string | null;
  channel_title: string | null;
  channel_subscribers: number | null;
  title: string | null;
  published_at: string | null;
  views: number | null;
  outlier_score: number | null;
  tags: string[] | null;
  /** YouTube's category: "20" is Gaming. Null for videos found before it was recorded. */
  category: string | null;
}

/** Every long-form video found in the last year that did at least twice its channel's usual. */
export async function getThumbGallery(): Promise<FoundThumb[]> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("yt_research_videos")
    .select("id, channel_id, channel_title, channel_subscribers, title, published_at, views, outlier_score, tags, category")
    .eq("format", "long").gte("outlier_score", 2).gte("published_at", since)
    .order("outlier_score", { ascending: false }).limit(800);
  fail(error);
  return (data ?? []) as unknown as FoundThumb[];
}

export interface IdeaRef extends RefInput {
  id: string;
  idea_id: string;
  note: string | null;
  created_at: string;
}

export async function getIdeaRefs(): Promise<IdeaRef[]> {
  const { data, error } = await supabase.from("yt_idea_refs")
    .select("id, idea_id, video_id, title, channel_title, channel_subscribers, views, outlier_score, published_at, note, created_at")
    .is("trashed_at", null).order("created_at").limit(2000);
  fail(error);
  return (data ?? []) as unknown as IdeaRef[];
}

/** Keeps a reference with an idea. Returns its id, or null when that video was already there. */
export async function addIdeaRef(ideaId: string, ref: RefInput): Promise<string | null> {
  // Only the table's own columns: the pickers carry labels of their own (which list a video came from).
  const row = {
    idea_id: ideaId, video_id: ref.video_id, title: ref.title, channel_title: ref.channel_title, channel_subscribers: ref.channel_subscribers,
    views: ref.views, outlier_score: ref.outlier_score, published_at: ref.published_at,
    ...(ref.image ? { image: ref.image, image_small: ref.image_small ?? null } : {}),
  };
  const { data, error } = await supabase.from("yt_idea_refs").insert(row).select("id");
  // Already on this idea: nothing to do.
  if (error && (error as { code?: string }).code === "23505") return null;
  if (error && /check constraint "yt_idea_refs_image/.test(error.message)) throw new ApiError("That picture is too large to keep. Try framing a smaller part of it.", "too_large");
  fail(error);
  return (data?.[0] as { id: string } | undefined)?.id ?? null;
}

/** A picture the owner added as a reference, small (for cards) or large. Read one at a time: lists leave it out. */
export async function getRefPicture(id: string, size: "small" | "large"): Promise<string | null> {
  const column = size === "large" ? "image" : "image_small";
  const { data, error } = await supabase.from("yt_idea_refs").select(column).eq("id", id).limit(1);
  fail(error);
  return ((data ?? [])[0] as Record<string, string | null> | undefined)?.[column] ?? null;
}

export async function patchIdeaRef(id: string, fields: { note?: string | null; trashed_at?: string | null }): Promise<void> {
  const { error } = await supabase.from("yt_idea_refs").update(fields).eq("id", id);
  fail(error);
}

/** The videos one idea's check found, with how each did against its channel's usual. */
export async function getIdeaCheckVideos(ideaId: string) {
  const { data, error } = await supabase.from("yt_research_runs").select("results, summary")
    .eq("kind", "outliers").contains("params", { mode: "idea", idea_id: ideaId })
    .order("created_at", { ascending: false }).limit(1);
  fail(error);
  const row = (data ?? [])[0] as unknown as { results: import("./ideaScore.ts").MarketVideo[]; summary: Record<string, unknown> } | undefined;
  return row && !("pending" in (row.summary ?? {})) ? row.results ?? [] : [];
}

export interface LookedUp {
  item: { video_id: string; title: string; channel_title: string; channel_subscribers: number | null; views: number; outlier_score: number | null; published_at: string; format: string };
}
/** One video from a pasted link, set against its channel's usual. Costs a few lookups. */
export const lookupVideo = (url: string) => callApi<LookedUp>("/research", { action: "video_lookup", url });
/** Has the dashboard search one more kind of video outside the owner's games, for thumbnails. */
export const findOutsideThumbs = () =>
  callApi<{ searched: { query: string; found: number; breakouts: number }[]; left: number; skipped?: string }>("/research", { action: "thumbs" });

/** Starts the dashboard checking every idea that has not been set against YouTube yet. */
export const startIdeaChecks = () => callApi<{ waiting: number; started: boolean; problem: string | null }>("/ideas/check");
/** Has the dashboard search a game's breakouts now, if it has no fresh search stored. */
export const coverGame = (game: string, format: "long" | "short") =>
  callApi<{ searched: { game: string; format: string; found: number; breakouts: number }[]; left: number; skipped?: string }>("/research", { action: "cover", game, format });

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

// ---------------------------------------------------------------------------
// Upload rhythm
// ---------------------------------------------------------------------------

export async function getRhythm(): Promise<import("./rhythm.ts").RhythmTarget[]> {
  const { data, error } = await supabase.from("yt_rhythm").select("format, every_days, active");
  fail(error);
  return (data ?? []) as unknown as import("./rhythm.ts").RhythmTarget[];
}

/** Sets a format's target (every so many days), or switches it off with null. */
export async function setRhythm(format: string, everyDays: number | null): Promise<void> {
  const fields = everyDays === null ? { active: false } : { every_days: everyDays, active: true };
  const { data, error } = await supabase.from("yt_rhythm").update(fields).eq("format", format).select("format");
  fail(error);
  if ((data ?? []).length || everyDays === null) return;
  const added = await supabase.from("yt_rhythm").insert({ format, every_days: everyDays, active: true });
  fail(added.error);
}
