// Shapes the screens work with. Database rows are cast to these in api.ts.

import type {
  KeywordAnalysis, KeywordResultItem, KeywordSignals, OutlierItem, RecentUpload,
} from "../../supabase/functions/yt-api/scoring.ts";

export type { KeywordAnalysis, KeywordResultItem, KeywordSignals, OutlierItem, RecentUpload };

export type Format = "short" | "long" | "live";
export type Discovery = "search" | "recommended" | "mixed";

export interface Channel {
  id: string;
  title: string | null;
  handle: string | null;
  thumbnail_url: string | null;
  subscribers: number | null;
  views: number | null;
  videos: number | null;
  updated_at: string;
}

export interface DailyRow {
  date: string;
  views: number;
  engaged_views: number | null;
  minutes_watched: number;
  subs_gained: number;
  subs_lost: number;
  likes: number;
  comments: number;
  shares: number;
}

export interface FormatDailyRow {
  date: string;
  content_type: Format | "other";
  views: number;
  engaged_views: number | null;
  minutes_watched: number;
}

export type Traffic = Partial<Record<
  "search" | "suggested" | "browse" | "shorts_feed" | "channel_pages" | "playlists" | "notifications" | "external" | "other" | "total",
  number
>>;

export interface Video {
  id: string;
  title: string;
  content_type: Format | null;
  privacy: string | null;
  published_at: string | null;
  duration_s: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subs_gained: number | null;
  watch_hours: number | null;
  avg_view_duration_s: number | null;
  avg_view_pct: number | null;
  age_days: number | null;
  views_per_day: number | null;
  engagement_pct: number | null;
  typical_views: number | null;
  vs_typical: number | null;
  search_pct: number | null;
  recommended_pct: number | null;
  discovery: Discovery | null;
  url: string;
  thumbnail_url: string | null;
  tags: string[] | null;
  traffic: Traffic | null;
  estimated_revenue: number | null;
  revenue_per_1000_views: number | null;
  topic: string | null;
  feeders: { video_id: string; views: number }[] | null;
  /** Lifetime engaged views from YouTube Studio: views without the people who scrolled past in the first moment. */
  engaged_views: number | null;
}

export interface MyFormat {
  content_type: Format;
  public_videos: number;
  uploads_30d: number;
  uploads_90d: number;
  last_upload_at: string | null;
  typical_views: number | null;
}

export type IdeaStatus = "idea" | "scripting" | "filming" | "editing" | "scheduled" | "published";

export interface Idea {
  id: string;
  format: "long" | "short";
  status: IdeaStatus;
  discovery: "recommended" | "search" | null;
  title: string;
  /** The game or topic the idea sits under, chosen by the owner. */
  topic: string | null;
  /** When the owner decided to make it. Null = still just an idea, kept under its game and off the production board. */
  picked_at: string | null;
  /** The AI's reading of the idea against the owner's templates, and when it was made. */
  template_check: import("./api.ts").TemplateCheck | null;
  template_checked_at: string | null;
  /** The AI's score of the intro in the hook box, and when it was made (the hook may have changed since). */
  intro_check: import("./api.ts").IntroCheck | null;
  intro_checked_at: string | null;
  /** Two-way scores of the title and the other titles, and of the script (hook, what happens and outline). */
  title_check: import("./api.ts").TitleCheck | null;
  script_check: import("./api.ts").PieceReading | null;
  title_options: string[];
  target_keyword: string | null;
  hook: string | null;
  concept: string | null;
  outline: string | null;
  thumbnail_concept: string | null;
  priority: number;
  target_date: string | null;
  inspiration_url: string | null;
  inspiration_video_id: string | null;
  notes: string | null;
  video_id: string | null;
  parent_id: string | null;
  sort_order: number;
  source: string;
  created_at: string;
  updated_at: string;
  /** A suggestion still waiting in the Suggested tab: not on the board yet. */
  in_suggested: boolean;
  /** When the dashboard suggested it. Null = the owner's own idea. */
  suggested_at: string | null;
  suggestion: Suggestion | null;
}

/** Why the dashboard suggested an idea, and what it rests on. */
export interface Suggestion {
  kind: "follow_up" | "your_format" | "breakout" | "other_games" | "short_hint" | "comment";
  why: string;
  based_on?: string;
  basis?: { video_id?: string; title: string; channel?: string; views: number | null; times_usual: number | null; own: boolean }[];
  /** The upload this follows up. */
  follow_up_of?: string;
  made_by?: "batch" | "follow_up";
  batch?: string;
  /** What the title sparks, as the owner colour-codes titles: curiosity, desire, fear. */
  emotions?: import("./emotions.ts").Emotion[];
}

/** A thumbnail reference not yet saved with an idea (the idea itself is not saved yet). */
/** A thumbnail reference: a YouTube video, or a picture the owner added themselves (no video_id). */
export interface RefInput {
  video_id: string | null;
  title: string | null;
  channel_title: string | null;
  channel_subscribers: number | null;
  views: number | null;
  outlier_score: number | null;
  published_at: string | null;
  /** A picture not saved yet (on an idea that is not saved yet): the picture itself. */
  image?: string;
  image_small?: string;
}
export type IdeaDraft = Partial<Omit<Idea, "id" | "created_at" | "updated_at">> & { id?: string; title: string; pending_refs?: RefInput[] };

export interface ReportRow {
  [column: string]: string | number;
}

export interface Report {
  key: string;
  period_start: string | null;
  period_end: string | null;
  data: ReportRow[];
  fetched_at: string;
}

export interface SyncRun {
  id: number;
  source: string;
  status: "running" | "ok" | "partial" | "error" | "skipped";
  started_at: string;
  finished_at: string | null;
  summary: { steps?: Record<string, { ok: boolean; error?: string; [key: string]: unknown }>; note?: string } | null;
  error: string | null;
}

export interface Connection {
  google_configured: boolean;
  google_client_id: string | null;
  youtube_connected: boolean;
  connected_at: string | null;
  connection_error: string | null;
  owner_channel_id: string | null;
  earnings?: boolean;
  comments?: boolean;
  /** Google's permission to make Google Docs (only ones the dashboard creates). */
  docs?: boolean;
  ai?: boolean;
  ai_error?: string | null;
  /** When the last batch of suggested ideas was written, and when one started being written (empty when none is). */
  suggest_batch_at?: string | null;
  suggest_running_at?: string | null;
}

export interface OwnerRow {
  user_id: string;
  method: string;
  device: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface Quota {
  used_today: number;
  daily_budget: number;
}

export type OutlierResult = OutlierItem & { saved: boolean; english?: boolean };

export interface OutlierSearch {
  query: string;
  mode: "breakout" | "evergreen";
  format: "short" | "long";
  window_days: number;
  max_subs: number | null;
  min_views: number;
}

export interface OutlierResponse {
  run_id: string;
  items: OutlierResult[];
  next_page_token: string | null;
  summary: { searched: number; shown: number; hidden_live: number; below_min_views: number; channels_too_big: number; channels: number; units: number };
  quota: Quota;
}

export type KeywordResponse = KeywordAnalysis & { saved: boolean; quota: Quota };

export interface KeywordRow {
  keyword: string;
  volume_score: number | null;
  competition_score: number | null;
  overall_score: number | null;
  signals: KeywordSignals;
  results: KeywordResultItem[];
  my_rank: number | null;
  my_video_id: string | null;
  saved: boolean;
  analyzed_at: string;
}

export interface ResearchChannel {
  id: string;
  title: string | null;
  handle: string | null;
  thumbnail_url: string | null;
  subscribers: number | null;
  subscribers_hidden: boolean;
  views: number | null;
  videos: number | null;
  watched: boolean;
  typical_long: number | null;
  typical_short: number | null;
  uploads_30d_long: number | null;
  uploads_30d_short: number | null;
  recent_long: RecentUpload[];
  recent_short: RecentUpload[];
  baseline_long_at: string | null;
  baseline_short_at: string | null;
}

export interface SavedVideo {
  id: string;
  channel_id: string | null;
  channel_title: string | null;
  channel_subscribers: number | null;
  title: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  duration_s: number | null;
  format: Format | null;
  views: number | null;
  typical_views: number | null;
  outlier_score: number | null;
  views_per_day: number | null;
  saved_at: string | null;
}

export interface ResearchRun<T = unknown> {
  id: string;
  kind: "outliers" | "keyword" | "suggest";
  query: string;
  params: Record<string, unknown>;
  results: T;
  summary: Record<string, unknown>;
  created_at: string;
}
