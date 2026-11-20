// Pure scoring logic for the research tools. No I/O, no runtime-specific APIs,
// so the same file runs in the edge function and in the unit tests.

export type VideoFormat = "short" | "long" | "live";

export interface PublicVideo {
  id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  description: string;
  thumbnail_url: string | null;
  published_at: string;
  duration_s: number;
  views: number;
  likes: number | null;
  comments: number | null;
  tags: string[];
  is_live: boolean;
  privacy: string | null;
  /** The language the uploader declared ("en", "es-419"...), when they declared one. */
  language?: string | null;
  /** YouTube's category id, as the uploader set it: "20" is Gaming. */
  category?: string | null;
}

export interface PublicChannel {
  id: string;
  title: string;
  handle: string | null;
  thumbnail_url: string | null;
  country: string | null;
  published_at: string | null;
  subscribers: number | null;
  subscribers_hidden: boolean;
  views: number;
  videos: number;
  uploads_playlist_id: string | null;
}

export interface RecentUpload {
  id: string;
  title: string;
  views: number;
  likes: number | null;
  comments: number | null;
  published_at: string;
  duration_s: number;
}

export interface OutlierItem {
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  published_at: string;
  age_days: number;
  duration_s: number;
  format: VideoFormat;
  views: number;
  likes: number | null;
  comments: number | null;
  tags: string[];
  channel_id: string;
  channel_title: string;
  channel_subscribers: number | null;
  typical_views: number | null;
  outlier_score: number | null;
  views_per_day: number;
  reach: number | null;
  engagement_pct: number | null;
  category?: string | null;
}

const DAY_MS = 86_400_000;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** ISO 8601 duration ("PT1H2M3S", "P1DT2H", "P0D") to seconds. Unknown input is 0. */
export function parseIsoDuration(iso: string | null | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [d, h, min, s] = m.slice(1).map((x) => (x ? Number(x) : 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

export function ageDays(publishedAt: string, now: Date): number {
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now.getTime() - t) / DAY_MS);
}

/** Lifetime views per day. Videos younger than half a day count as half a day. */
export function viewsPerDay(views: number, publishedAt: string, now: Date): number {
  return views / Math.max(0.5, ageDays(publishedAt, now));
}

/**
 * Decide a video's format. Playlist membership (YouTube's own Shorts / Videos /
 * Live tabs) wins; otherwise fall back to what the video itself tells us.
 */
export function classifyFormat(v: {
  id: string;
  duration_s: number;
  is_live: boolean;
  title?: string;
  description?: string;
}, sets?: { shorts?: Set<string>; long?: Set<string>; live?: Set<string> }): { format: VideoFormat; source: string } {
  if (sets?.shorts?.has(v.id)) return { format: "short", source: "playlist" };
  if (sets?.live?.has(v.id)) return { format: "live", source: "playlist" };
  if (sets?.long?.has(v.id)) return { format: "long", source: "playlist" };
  if (v.is_live) return { format: "live", source: "live_details" };
  if (v.duration_s > 0 && v.duration_s <= 60) return { format: "short", source: "duration" };
  const text = `${v.title ?? ""} ${v.description ?? ""}`.toLowerCase();
  if (v.duration_s > 0 && v.duration_s <= 180 && text.includes("#shorts")) return { format: "short", source: "duration" };
  return { format: "long", source: "duration" };
}

/**
 * Is this video in English? The uploader's declared language decides when there
 * is one. Otherwise the title has to be written in plain Latin letters, without
 * the accents and marks other European languages use. A guess, not a certainty.
 */
export function isEnglish(v: { title: string; language?: string | null }): boolean {
  if (v.language) return v.language.toLowerCase().startsWith("en");
  const letters = v.title.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return true;
  const plain = letters.filter((ch) => /[a-z]/i.test(ch)).length;
  return plain / letters.length >= 0.95 && !/[¿¡ñßçãõåøæœ]/i.test(v.title);
}

export const MIN_BASELINE_VIDEOS = 5;

/**
 * A channel's "usual" views for one format: the median of its recent uploads,
 * leaving out the video being judged and anything too new to have settled.
 * Null when there are too few uploads to call anything usual.
 */
export function typicalViews(
  recent: Pick<RecentUpload, "id" | "views" | "published_at">[],
  opts: { excludeId?: string; now: Date; minAgeDays?: number },
): number | null {
  const minAge = opts.minAgeDays ?? 2;
  const pool = recent.filter((r) => r.id !== opts.excludeId && ageDays(r.published_at, opts.now) >= minAge);
  if (pool.length < MIN_BASELINE_VIDEOS) return null;
  return median(pool.map((r) => r.views));
}

export function outlierScore(views: number, typical: number | null): number | null {
  if (typical === null) return null;
  return round(views / Math.max(typical, 1), 2);
}

export function scoreOutlier(
  video: PublicVideo,
  format: VideoFormat,
  channel: Pick<PublicChannel, "id" | "title" | "subscribers" | "subscribers_hidden"> | undefined,
  recent: Pick<RecentUpload, "id" | "views" | "published_at">[],
  now: Date,
): OutlierItem {
  const typical = typicalViews(recent, { excludeId: video.id, now });
  const subs = channel && !channel.subscribers_hidden ? channel.subscribers : null;
  const interactions = (video.likes ?? 0) + (video.comments ?? 0);
  return {
    video_id: video.id,
    title: video.title,
    thumbnail_url: video.thumbnail_url,
    published_at: video.published_at,
    age_days: round(ageDays(video.published_at, now), 1),
    duration_s: video.duration_s,
    format,
    views: video.views,
    likes: video.likes,
    comments: video.comments,
    tags: video.tags.slice(0, 30),
    channel_id: video.channel_id,
    channel_title: channel?.title ?? video.channel_title,
    channel_subscribers: subs,
    typical_views: typical === null ? null : round(typical),
    outlier_score: outlierScore(video.views, typical),
    views_per_day: round(viewsPerDay(video.views, video.published_at, now), 1),
    reach: subs && subs > 0 ? round(video.views / subs, 2) : null,
    engagement_pct: video.views > 0 && video.likes !== null ? round((100 * interactions) / video.views, 2) : null,
    category: video.category ?? null,
  };
}

/** Best first: biggest multiple of the channel's usual, unscored videos last (by views). */
export function sortOutliers(items: OutlierItem[]): OutlierItem[] {
  return [...items].sort((a, b) => {
    if (a.outlier_score === null && b.outlier_score === null) return b.views - a.views;
    if (a.outlier_score === null) return 1;
    if (b.outlier_score === null) return -1;
    return b.outlier_score - a.outlier_score || b.views - a.views;
  });
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "from", "is", "it", "vs",
]);

export function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().replace(/\s+/g, " ").trim();
}

/** The words of a phrase that carry meaning, lower-cased. */
export function keywordWords(keyword: string): string[] {
  const words = normalizeKeyword(keyword)
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  return meaningful.length ? meaningful : words;
}

/** True when every meaningful word of the phrase appears in the title. */
export function titleMatches(title: string, words: string[]): boolean {
  if (words.length === 0) return false;
  const hay = ` ${title.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ")} `;
  return words.every((w) => hay.includes(` ${w} `) || hay.includes(` ${w}s `) || (w.endsWith("s") && hay.includes(` ${w.slice(0, -1)} `)));
}

export interface KeywordResultItem {
  rank: number;
  video_id: string;
  title: string;
  thumbnail_url: string | null;
  channel_id: string;
  channel_title: string;
  channel_subscribers: number | null;
  views: number;
  published_at: string;
  age_days: number;
  views_per_day: number;
  duration_s: number;
  title_match: boolean;
  mine: boolean;
}

export interface KeywordSignals {
  results: number;
  top_n: number;
  median_views: number | null;
  median_views_per_day: number | null;
  median_subscribers: number | null;
  title_match_share: number | null;
  small_channel_share: number | null;
  small_channel_cutoff: number;
  fresh_share: number | null;
}

export type KeywordVerdict = "strong" | "decent" | "tough" | "unknown";

export interface KeywordAnalysis {
  keyword: string;
  volume_score: number | null;
  competition_score: number | null;
  overall_score: number | null;
  verdict: KeywordVerdict;
  signals: KeywordSignals;
  results: KeywordResultItem[];
  my_rank: number | null;
  my_video_id: string | null;
}

export const KEYWORD_TOP_N = 10;

/**
 * Score a search phrase from the videos that rank for it.
 *
 * YouTube publishes no search volumes, so these are estimates:
 *  - volume: how many views a day the top results earn (log scale; 10/day = 26, 100 = 50, 1,000 = 75).
 *  - competition: how big the ranking channels are (50%), how many already use
 *    the phrase in their title (30%) and how few small channels made it in (20%).
 *  - overall: the opportunity, half volume and half lack of competition.
 */
export function analyzeKeyword(
  keyword: string,
  ranked: { video: PublicVideo; channel?: Pick<PublicChannel, "subscribers" | "subscribers_hidden"> }[],
  opts: { myChannelId: string | null; mySubscribers: number | null; now: Date },
): KeywordAnalysis {
  const normalized = normalizeKeyword(keyword);
  const words = keywordWords(normalized);
  const cutoff = Math.max(10_000, 3 * (opts.mySubscribers ?? 0));

  const results: KeywordResultItem[] = ranked.map(({ video, channel }, i) => ({
    rank: i + 1,
    video_id: video.id,
    title: video.title,
    thumbnail_url: video.thumbnail_url,
    channel_id: video.channel_id,
    channel_title: video.channel_title,
    channel_subscribers: channel && !channel.subscribers_hidden ? channel.subscribers : null,
    views: video.views,
    published_at: video.published_at,
    age_days: round(ageDays(video.published_at, opts.now), 1),
    views_per_day: round(viewsPerDay(video.views, video.published_at, opts.now), 1),
    duration_s: video.duration_s,
    title_match: titleMatches(video.title, words),
    mine: opts.myChannelId !== null && video.channel_id === opts.myChannelId,
  }));

  const top = results.slice(0, KEYWORD_TOP_N);
  const mine = results.find((r) => r.mine) ?? null;
  const share = (pred: (r: KeywordResultItem) => boolean) => (top.length ? round(top.filter(pred).length / top.length, 2) : null);
  const knownSubs = top.map((r) => r.channel_subscribers).filter((n): n is number => n !== null);

  const signals: KeywordSignals = {
    results: results.length,
    top_n: top.length,
    median_views: median(top.map((r) => r.views)),
    median_views_per_day: (() => {
      const m = median(top.map((r) => r.views_per_day));
      return m === null ? null : round(m, 1);
    })(),
    median_subscribers: median(knownSubs),
    title_match_share: share((r) => r.title_match),
    small_channel_share: share((r) => r.channel_subscribers !== null && r.channel_subscribers <= cutoff),
    small_channel_cutoff: cutoff,
    fresh_share: share((r) => r.age_days <= 365),
  };

  const base = { keyword: normalized, signals, results, my_rank: mine?.rank ?? null, my_video_id: mine?.video_id ?? null };
  if (top.length < 3 || signals.median_views_per_day === null) {
    return { ...base, volume_score: null, competition_score: null, overall_score: null, verdict: "unknown" };
  }

  const volume = clamp(Math.round(25 * Math.log10(signals.median_views_per_day + 1)), 0, 100);
  const size = signals.median_subscribers === null ? 0.5 : clamp((Math.log10(signals.median_subscribers + 1) - 3) / 3.5, 0, 1);
  const competition = Math.round(
    100 * (0.5 * size + 0.3 * (signals.title_match_share ?? 0) + 0.2 * (1 - (signals.small_channel_share ?? 0))),
  );
  const overall = Math.round(0.5 * volume + 0.5 * (100 - competition));
  return {
    ...base,
    volume_score: volume,
    competition_score: competition,
    overall_score: overall,
    verdict: overall >= 65 ? "strong" : overall >= 45 ? "decent" : "tough",
  };
}

// ---------------------------------------------------------------------------
// Checking one idea against YouTube: has this exact video been made, and how did it do?
// ---------------------------------------------------------------------------

const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "Baldur's Gate 3" is also written "BG3"; "Elden Ring" is "ER". */
export function gameInitials(game: string): string | null {
  const words = game.replace(/[^A-Za-z0-9 ]+/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join("").toLowerCase();
}

/** The idea's own words: its title without hashtags, the game's name or the game's initials. */
function titleWithoutGame(title: string, game: string): string[] {
  const gameWords = new Set(game.split(/\s+/).map(bare).filter((w) => w.length >= 3));
  const short = gameInitials(game);
  return title.replace(/#\S+/g, " ").split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}'’-]+/gu, ""))
    .filter((word) => {
      const b = bare(word);
      return b.length > 0 && !gameWords.has(b) && !gameWords.has(b.replace(/s$/, "")) && b !== short;
    });
}

/** What to type into YouTube to find videos of this idea: the game's full name, then the rest of the title. */
export function ideaQuery(title: string, game: string): string {
  return `${game.trim()} ${titleWithoutGame(title, game).join(" ")}`.replace(/\s+/g, " ").trim().slice(0, 100);
}

// Words that say what kind of video it is, not what it is about. They are in nearly every challenge
// title, so sharing them says nothing about two videos being the same idea.
const FILLER = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "without", "is", "are", "was", "be", "it", "its", "this",
  "that", "i", "im", "ive", "me", "my", "we", "our", "you", "your", "can", "could", "will", "would", "do", "does", "did", "how", "what",
  "why", "when", "who", "not", "no", "so", "if", "than", "as", "at", "by", "from", "into", "up", "out", "only", "using", "use", "used",
  "every", "all", "any", "more", "most", "very", "really", "ever", "never", "still", "just", "beat", "beating", "beaten", "made", "make",
  "making", "turned", "accidentally", "have", "has", "had", "there", "them", "they", "vs", "video", "game", "games", "run", "challenge",
  "full", "new", "time", "times", "then", "while", "until", "after", "before", "get", "got", "playing", "play", "played", "win",
]);
const stem = (word: string) => (word.length > 4 ? word.replace(/(ies)$/, "y").replace(/(es|s)$/, "") : word);

/** The words that make the idea this idea: "Elden Ring Using Only Chest Items" is about chest and item. */
export function ideaAngle(title: string, game: string): string[] {
  const words = titleWithoutGame(title, game).map(bare).filter((w) => w.length >= 2 && !FILLER.has(w) && !/^\d+$/.test(w)).map(stem);
  return [...new Set(words)];
}

export type Match = "same" | "close" | "no";
const CHALLENGE = /\b(only|without|but|can (you|i|we) beat|challenge|no[- ]hit|no damage|randomi[sz]|every time|impossible|hardest)\b/i;

/**
 * Without the AI: a video is the same idea when its title has every one of the idea's own words, and
 * the same kind of video when it is a challenge on the same game. Rough, and English only.
 */
export function judgeByWords(idea: { title: string; game: string }, videoTitle: string): Match {
  const key = bare(idea.game), short = gameInitials(idea.game);
  const flat = bare(videoTitle);
  const words = new Set(videoTitle.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem));
  const onGame = flat.includes(key) || Boolean(short && words.has(short));
  if (!onGame) return "no";
  const angle = ideaAngle(idea.title, idea.game);
  if (angle.length && angle.every((w) => words.has(w))) return "same";
  const shared = angle.filter((w) => words.has(w)).length;
  return (angle.length >= 2 && shared >= Math.ceil(angle.length / 2)) || CHALLENGE.test(videoTitle) ? "close" : "no";
}

export interface MarketVideo {
  video_id: string;
  title: string;
  channel: string;
  subscribers: number | null;
  views: number;
  /** Views against the channel's usual video, when that could be worked out. */
  score: number | null;
  published: string;
  match: Match;
}

export interface MarketGroup {
  n: number;
  /** How many of them could be set against their channel's usual. */
  scored: number;
  /** How many did 3x their channel's usual or more. */
  broke_out: number;
  /** The middle one, against its channel's usual. A tiny channel's freak 900x counts as 20x here. */
  median: number | null;
  newest: string | null;
}

export interface MarketSummary {
  searched: number;
  same: MarketGroup;
  close: MarketGroup;
  examples: MarketVideo[];
}

const SCORE_CAP = 20;
function group(videos: MarketVideo[]): MarketGroup {
  const scores = videos.map((v) => v.score).filter((s): s is number => s !== null).map((s) => Math.min(s, SCORE_CAP)).sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  const median = scores.length === 0 ? null : scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2;
  return {
    n: videos.length, scored: scores.length, broke_out: scores.filter((s) => s >= 3).length,
    median: median === null ? null : Math.round(median * 10) / 10,
    newest: videos.map((v) => v.published.slice(0, 10)).sort().at(-1) ?? null,
  };
}

/** What the search for one idea found, boiled down: the same idea, the same kind of video, and a few to look at. */
export function summariseMarket(searched: number, judged: MarketVideo[]): MarketSummary {
  const same = judged.filter((v) => v.match === "same"), close = judged.filter((v) => v.match === "close");
  const best = (list: MarketVideo[]) => [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.views - a.views);
  return { searched, same: group(same), close: group(close), examples: [...best(same), ...best(close)].slice(0, 4) };
}
