// Goals, tests, comments, the monthly recap, the by-game table, what feeds the
// long videos, and the planner: the reads, the writes and the sums behind them.

import { useQuery } from "@tanstack/react-query";
import { ApiError, fail } from "./api.ts";
import { parseNote } from "./notes.ts";
import { median } from "./stats.ts";
import { supabase } from "./supabase.ts";
import type { DailyRow, Idea, Video } from "./types.ts";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface Goal {
  id: string;
  kind: "subscribers" | "video_views" | "personal";
  title: string;
  target: number | null;
  start_value: number | null;
  video_id: string | null;
  /** For a views goal with no video picked: the kind of video that counts. Formats are never mixed. */
  format: "short" | "long" | "live" | null;
  due_on: string | null;
  /** Why it matters. */
  notes: string | null;
  /** How to get there: steps written as checkboxes, under plain heading lines. */
  plan: string | null;
  done_at: string | null;
  created_at: string;
}
export type GoalDraft = Partial<Goal> & { kind: Goal["kind"]; title: string };

export interface Test {
  id: string;
  video_id: string;
  kind: "thumbnail" | "title" | "both" | "other";
  what: string;
  why: string | null;
  started_on: string;
  ended_on: string | null;
  ctr_before: number | null;
  ctr_after: number | null;
  verdict: "better" | "worse" | "same" | null;
  learned: string | null;
  created_at: string;
}
export type TestDraft = Partial<Test> & { video_id: string; what: string };

export interface Change {
  id: number;
  video_id: string;
  field: "title" | "thumbnail";
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export interface Comment {
  id: string;
  video_id: string | null;
  author: string | null;
  text: string;
  likes: number;
  published_at: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  theme: string | null;
  is_question: boolean | null;
  pinned: boolean;
  hidden: boolean;
}

export interface VideoDay {
  video_id: string;
  date: string;
  views: number | null;
  minutes_watched: number | null;
  subs_gained: number | null;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

const GOAL = "id, kind, title, target, start_value, video_id, format, due_on, notes, plan, done_at, created_at";
const TEST = "id, video_id, kind, what, why, started_on, ended_on, ctr_before, ctr_after, verdict, learned, created_at";

export async function getGoals(): Promise<Goal[]> {
  const { data, error } = await supabase.from("yt_goals").select(GOAL).is("trashed_at", null).order("created_at").limit(200);
  fail(error);
  return (data ?? []) as unknown as Goal[];
}

export async function saveGoal(draft: GoalDraft): Promise<void> {
  const { id, created_at: _created, ...fields } = draft;
  if (!fields.title.trim()) throw new ApiError("Give the goal a name first.", "bad_request");
  const clean = { ...fields, title: fields.title.trim() };
  const { error } = id
    ? await supabase.from("yt_goals").update(clean).eq("id", id)
    : await supabase.from("yt_goals").insert(clean);
  fail(error);
}

export async function patchGoal(id: string, fields: { done_at?: string | null; trashed_at?: string | null; notes?: string | null; plan?: string | null }): Promise<void> {
  const { error } = await supabase.from("yt_goals").update(fields).eq("id", id);
  fail(error);
}

export async function getTests(): Promise<Test[]> {
  const { data, error } = await supabase.from("yt_tests").select(TEST).is("trashed_at", null).order("started_on", { ascending: false }).limit(300);
  fail(error);
  return (data ?? []) as unknown as Test[];
}

export async function saveTest(draft: TestDraft): Promise<void> {
  const { id, created_at: _created, ...fields } = draft;
  if (!fields.what.trim()) throw new ApiError("Say what you are testing first.", "bad_request");
  const clean = { ...fields, what: fields.what.trim() };
  const { error } = id
    ? await supabase.from("yt_tests").update(clean).eq("id", id)
    : await supabase.from("yt_tests").insert(clean);
  fail(error);
}

export async function trashTest(id: string): Promise<void> {
  const { error } = await supabase.from("yt_tests").update({ trashed_at: new Date().toISOString() }).eq("id", id);
  fail(error);
}

export async function getChanges(): Promise<Change[]> {
  const { data, error } = await supabase.from("yt_video_changes").select("id, video_id, field, old_value, new_value, changed_at")
    .order("changed_at", { ascending: false }).limit(200);
  fail(error);
  // Signed thumbnail links rotate without the picture changing; those are not changes.
  const key = (url: string | null) => {
    try {
      const u = new URL(url ?? "");
      return `${u.pathname}?v=${u.searchParams.get("v") ?? ""}`;
    } catch {
      return url;
    }
  };
  return ((data ?? []) as unknown as Change[]).filter((c) => c.field !== "thumbnail" || key(c.old_value) !== key(c.new_value));
}

export async function getVideoDays(videoIds: string[]): Promise<VideoDay[]> {
  if (videoIds.length === 0) return [];
  const { data, error } = await supabase.from("yt_video_analytics_daily").select("video_id, date, views, minutes_watched, subs_gained")
    .in("video_id", videoIds).order("date").limit(5000);
  fail(error);
  return (data ?? []) as unknown as VideoDay[];
}

export async function getComments(): Promise<Comment[]> {
  const { data, error } = await supabase.from("yt_comments")
    .select("id, video_id, author, text, likes, published_at, sentiment, theme, is_question, pinned, hidden")
    .order("published_at", { ascending: false }).limit(600);
  fail(error);
  return (data ?? []) as unknown as Comment[];
}

export async function markComment(id: string, change: { pinned?: boolean; hidden?: boolean }): Promise<void> {
  const { error } = await supabase.rpc("yt_mark_comment", {
    p_comment_id: id, p_pinned: change.pinned ?? (null as unknown as boolean), p_hidden: change.hidden ?? (null as unknown as boolean),
  });
  fail(error);
}

export async function setVideoTopic(id: string, topic: string): Promise<void> {
  const { error } = await supabase.rpc("yt_set_video_topic", { p_video_id: id, p_topic: topic });
  fail(error);
}

export interface Reach { video_id: string; impressions_28d: number; ctr_28d: number | null }
export interface ReachDay { video_id: string; date: string; impressions: number; ctr: number | null }

/** Impressions and click-through rate per video over the newest 28 days YouTube has reported. */
export async function getReach(): Promise<Reach[]> {
  const { data, error } = await supabase.from("yt_v_video_reach").select("video_id, impressions_28d, ctr_28d").limit(5000);
  fail(error);
  return (data ?? []) as unknown as Reach[];
}

export async function getReachDays(videoIds: string[]): Promise<ReachDay[]> {
  if (videoIds.length === 0) return [];
  const { data, error } = await supabase.from("yt_video_reach_daily").select("video_id, date, impressions, ctr")
    .in("video_id", videoIds).order("date").limit(5000);
  fail(error);
  return (data ?? []) as unknown as ReachDay[];
}

/** Click-through rate over a stretch of days, weighted by how often the thumbnail was shown. Null when YouTube reported nothing. */
export function ctrBetween(days: ReachDay[], videoId: string, from: string, to: string): number | null {
  const rows = days.filter((d) => d.video_id === videoId && d.date >= from && d.date <= to && d.ctr !== null);
  const shown = rows.reduce((t, d) => t + d.impressions, 0);
  return shown > 0 ? Math.round((100 * rows.reduce((t, d) => t + d.impressions * (d.ctr ?? 0), 0)) / shown) / 100 : null;
}

/** The measured click-through rate before and after a test started, over the same windows as the views. */
export function testCtr(test: Test, days: ReachDay[], today: string): { before: number | null; after: number | null } {
  const end = test.ended_on && test.ended_on < today ? test.ended_on : today;
  const last = addDays(test.started_on, 27) < end ? addDays(test.started_on, 27) : end;
  return {
    before: ctrBetween(days, test.video_id, addDays(test.started_on, -28), addDays(test.started_on, -1)),
    after: ctrBetween(days, test.video_id, test.started_on, last),
  };
}

export const growthKeys = {
  goals: ["goals"], tests: ["tests"], changes: ["changes"], comments: ["comments"],
  videoDays: (ids: string[]) => ["video-days", ids.join(",")],
  reach: ["reach"], reachDays: (ids: string[]) => ["reach-days", ids.join(",")],
} as const;

export const useGoals = () => useQuery({ queryKey: growthKeys.goals, queryFn: getGoals });
export const useTests = () => useQuery({ queryKey: growthKeys.tests, queryFn: getTests });
export const useChanges = () => useQuery({ queryKey: growthKeys.changes, queryFn: getChanges });
export const useComments = () => useQuery({ queryKey: growthKeys.comments, queryFn: getComments });
export const useReach = () => useQuery({ queryKey: growthKeys.reach, queryFn: getReach });
export const useReachDays = (ids: string[]) => useQuery({ queryKey: growthKeys.reachDays(ids), queryFn: () => getReachDays(ids) });
export const useVideoDays = (ids: string[]) => useQuery({ queryKey: growthKeys.videoDays(ids), queryFn: () => getVideoDays(ids) });

// ---------------------------------------------------------------------------
// By game
// ---------------------------------------------------------------------------

export interface TopicRow {
  topic: string;
  videos: number;
  views: number;
  typicalViews: number | null;
  retention: number | null;
  avgViewS: number | null;
  watchHours: number;
  subs: number;
  earned: number | null;
  lastUpload: string | null;
}

/** One row per game. Retention is the middle video's, so one freak upload cannot carry a game. */
/** One kind of video at a time: a game's usual views or retention mean nothing across formats. */
export function byTopic(videos: Video[], format: "short" | "long" | "live"): TopicRow[] {
  const groups = new Map<string, Video[]>();
  for (const v of videos) {
    if (v.privacy !== "public" || !v.topic) continue;
    if (v.content_type !== format) continue;
    groups.set(v.topic, [...(groups.get(v.topic) ?? []), v]);
  }
  const nums = (list: Video[], pick: (v: Video) => number | null) => list.map(pick).filter((n): n is number => n !== null);
  return [...groups.entries()].map(([topic, list]) => {
    const earned = nums(list, (v) => v.estimated_revenue);
    return {
      topic,
      videos: list.length,
      views: list.reduce((sum, v) => sum + (v.views ?? 0), 0),
      typicalViews: median(nums(list, (v) => v.views)),
      retention: median(nums(list, (v) => v.avg_view_pct)),
      avgViewS: median(nums(list, (v) => v.avg_view_duration_s)),
      watchHours: list.reduce((sum, v) => sum + (v.watch_hours ?? 0), 0),
      subs: list.reduce((sum, v) => sum + (v.subs_gained ?? 0), 0),
      earned: earned.length ? earned.reduce((a, b) => a + b, 0) : null,
      lastUpload: list.map((v) => v.published_at ?? "").sort().at(-1) || null,
    };
  }).sort((a, b) => b.views - a.views);
}

// ---------------------------------------------------------------------------
// Shorts to long
// ---------------------------------------------------------------------------

export interface FeederRow {
  short: Video;
  sent: number;
  to: { video: Video; views: number }[];
}

/** For each Short, how many viewers YouTube sent on from it to the long videos, and to which. */
export function shortsFunnel(videos: Video[]): { rows: FeederRow[]; measured: number; longTotal: number; fromShorts: number; fromOthers: number } {
  const byId = new Map(videos.map((v) => [v.id, v]));
  const rows = new Map<string, FeederRow>();
  let measured = 0, fromShorts = 0, fromOthers = 0, longTotal = 0;
  for (const long of videos) {
    if (long.content_type !== "long" || !long.feeders) continue;
    measured++;
    longTotal += long.views ?? 0;
    for (const f of long.feeders) {
      const source = byId.get(f.video_id);
      if (source?.content_type === "short") {
        fromShorts += f.views;
        const row = rows.get(source.id) ?? { short: source, sent: 0, to: [] };
        row.sent += f.views;
        row.to.push({ video: long, views: f.views });
        rows.set(source.id, row);
      } else {
        fromOthers += f.views;
      }
    }
  }
  return { rows: [...rows.values()].sort((a, b) => b.sent - a.sent), measured, longTotal, fromShorts, fromOthers };
}

/**
 * Shorts that did far better than the owner's usual Short. A Short's views cannot be compared with a
 * long video's, but a Short that beat the other Shorts is a fair hint that the idea has pull.
 * `covered` says whether a long video about the same game went up after it.
 */
export function shortsWorthAVideo(videos: Video[], limit = 8): { short: Video; covered: Video | null }[] {
  const longs = videos.filter((v) => v.content_type === "long" && v.privacy === "public");
  return videos
    .filter((v) => v.content_type === "short" && v.privacy === "public" && (v.vs_typical ?? 0) >= 2)
    .sort((a, b) => (b.vs_typical ?? 0) - (a.vs_typical ?? 0))
    .slice(0, limit)
    .map((short) => ({
      short,
      covered: longs.filter((l) => short.topic && l.topic === short.topic && (l.published_at ?? "") > (short.published_at ?? ""))
        .sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""))[0] ?? null,
    }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export interface Window {
  days: number;
  viewsPerDay: number | null;
  watchMinPerDay: number | null;
  subsPerDay: number | null;
}
export interface TestResult {
  before: Window;
  after: Window;
  viewsChange: number | null;
  running: boolean;
}


/** Compare up to four weeks before the change with the days since (up to four weeks, or until the test ended). */
export function testResult(test: Test, days: VideoDay[], today: string): TestResult {
  const mine = days.filter((d) => d.video_id === test.video_id);
  const end = test.ended_on && test.ended_on < today ? test.ended_on : today;
  const window = (from: string, to: string): Window => {
    const rows = mine.filter((d) => d.date >= from && d.date <= to);
    const span = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
    if (rows.length === 0 || span === 0) return { days: 0, viewsPerDay: null, watchMinPerDay: null, subsPerDay: null };
    const sum = (pick: (d: VideoDay) => number | null) => rows.reduce((total, d) => total + (pick(d) ?? 0), 0);
    return { days: span, viewsPerDay: sum((d) => d.views) / span, watchMinPerDay: sum((d) => d.minutes_watched) / span, subsPerDay: sum((d) => d.subs_gained) / span };
  };
  const before = window(addDays(test.started_on, -28), addDays(test.started_on, -1));
  const lastAfter = addDays(test.started_on, 27) < end ? addDays(test.started_on, 27) : end;
  // YouTube's numbers run two to three days behind, so the newest days are not in yet.
  const settled = addDays(today, -3) < lastAfter ? addDays(today, -3) : lastAfter;
  const after = settled >= test.started_on ? window(test.started_on, settled) : { days: 0, viewsPerDay: null, watchMinPerDay: null, subsPerDay: null };
  const viewsChange = before.viewsPerDay && after.viewsPerDay !== null ? (after.viewsPerDay - before.viewsPerDay) / before.viewsPerDay : null;
  return { before, after, viewsChange, running: !test.ended_on || test.ended_on >= today };
}

// ---------------------------------------------------------------------------
// Monthly recap
// ---------------------------------------------------------------------------

export interface Recap {
  month: string;
  label: string;
  complete: boolean;
  views: number;
  watchHours: number;
  subsNet: number;
  earned: number | null;
  previous: { views: number; watchHours: number; subsNet: number } | null;
  uploads: Video[];
  best: Video | null;
  bestDay: { date: string; views: number } | null;
  topTopic: { topic: string; views: number } | null;
  lines: string[];
}

export function monthsWithData(daily: DailyRow[]): string[] {
  return [...new Set(daily.map((d) => d.date.slice(0, 7)))].sort().reverse();
}

const pct = (now: number, then: number) => (then > 0 ? Math.round((100 * (now - then)) / then) : null);
const upDown = (n: number | null) => (n === null ? "" : n === 0 ? ", level with the month before" : `, ${n > 0 ? "up" : "down"} ${Math.abs(n)}% on the month before`);

export function recap(month: string, daily: (DailyRow & { estimated_revenue?: number | null })[], videos: Video[], today: string): Recap {
  const sumMonth = (m: string) => {
    const rows = daily.filter((d) => d.date.startsWith(m));
    return rows.length === 0 ? null : {
      views: rows.reduce((t, d) => t + d.views, 0),
      watchHours: rows.reduce((t, d) => t + d.minutes_watched, 0) / 60,
      subsNet: rows.reduce((t, d) => t + d.subs_gained - d.subs_lost, 0),
      earned: rows.some((d) => d.estimated_revenue != null) ? rows.reduce((t, d) => t + (d.estimated_revenue ?? 0), 0) : null,
      bestDay: rows.reduce((best, d) => (d.views > best.views ? { date: d.date, views: d.views } : best), { date: rows[0].date, views: -1 }),
    };
  };
  const [y, m] = month.split("-").map(Number);
  const prevMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const now = sumMonth(month);
  const prev = sumMonth(prevMonth);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const complete = month < today.slice(0, 7);
  const uploads = videos.filter((v) => v.published_at?.startsWith(month) && v.privacy === "public")
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  // The headline upload is the best long-form video, then the best Short, then a stream.
  const best = uploads.find((v) => v.content_type === "long") ?? uploads.find((v) => v.content_type === "short") ?? uploads[0] ?? null;
  const topics = new Map<string, number>();
  for (const v of uploads) if (v.topic) topics.set(v.topic, (topics.get(v.topic) ?? 0) + (v.views ?? 0));
  const top = [...topics.entries()].sort((a, b) => b[1] - a[1])[0];

  const lines: string[] = [];
  if (now) {
    // A month still in progress cannot be fairly compared with a whole one.
    lines.push(`${Math.round(now.views).toLocaleString("en-US")} views${complete && prev ? upDown(pct(now.views, prev.views)) : ""}.`);
    lines.push(`${now.subsNet >= 0 ? "Gained" : "Lost"} ${Math.abs(now.subsNet).toLocaleString("en-US")} subscribers${complete && prev ? ` (${prev.subsNet >= 0 ? "+" : ""}${prev.subsNet.toLocaleString("en-US")} the month before)` : ""}.`);
  }
  lines.push(uploads.length === 0 ? "No public uploads this month." : `${uploads.length} public upload${uploads.length === 1 ? "" : "s"}: ${
    ["short", "long", "live"].map((f) => [f, uploads.filter((v) => v.content_type === f).length] as const).filter(([, n]) => n > 0)
      .map(([f, n]) => `${n} ${f === "short" ? (n === 1 ? "Short" : "Shorts") : f === "long" ? "long-form" : "live"}`).join(", ")}.`);
  // One best per kind of video: a Short's views say nothing about how a long video did.
  for (const [f, name] of [["long", "long-form video"], ["short", "Short"], ["live", "stream"]] as const) {
    const first = uploads.find((v) => v.content_type === f);
    if (first) lines.push(`Best ${name}: "${first.title}" with ${(first.views ?? 0).toLocaleString("en-US")} views${first.vs_typical ? `, ${first.vs_typical}x your usual for ${f === "long" ? "long-form" : f === "short" ? "Shorts" : "streams"}` : ""}.`);
  }
  if (top && topics.size > 1) lines.push(`${top[0]} brought the most views of anything you posted.`);

  return {
    month, label, complete,
    views: now?.views ?? 0, watchHours: now?.watchHours ?? 0, subsNet: now?.subsNet ?? 0, earned: now?.earned ?? null,
    previous: prev ? { views: prev.views, watchHours: prev.watchHours, subsNet: prev.subsNet } : null,
    uploads, best, bestDay: now && now.bestDay.views >= 0 ? now.bestDay : null,
    topTopic: top ? { topic: top[0], views: top[1] } : null, lines,
  };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalProgress {
  current: number | null;
  share: number | null;
  left: number | null;
  /** Projected date at the recent pace, when there is a pace to go on. */
  eta: string | null;
  done: boolean;
}

/**
 * The public video with the most views among one kind of video. Shorts, long-form videos and
 * streams are never ranked against each other: their view counts are not comparable.
 */
export function bestVideo(videos: Video[], format?: "short" | "long" | "live" | null): Video | undefined {
  return videos.filter((v) => v.privacy === "public" && v.views !== null && (!format || v.content_type === format))
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0];
}

/** How far along a goal's plan is: its checkbox steps, how many are ticked, and the first one still to do. */
export function planStatus(plan: string | null | undefined): { done: number; total: number; next: string | null } {
  const steps = parseNote(plan ?? "").flatMap((b) => (b.kind === "list" ? b.items : [])).filter((i) => i.check !== null);
  return { done: steps.filter((s) => s.check).length, total: steps.length, next: steps.find((s) => !s.check)?.text.trim() || null };
}

export function goalProgress(goal: Goal, ctx: { subscribers: number | null; videos: Video[]; daily: DailyRow[]; today: string }): GoalProgress {
  if (goal.kind === "personal" || goal.target === null) {
    return { current: null, share: null, left: null, eta: null, done: Boolean(goal.done_at) };
  }
  // A views goal with no video picked is for any video of its kind: it follows whichever one is furthest along.
  const video = goal.kind === "video_views" ? (goal.video_id ? ctx.videos.find((v) => v.id === goal.video_id) : bestVideo(ctx.videos, goal.format)) : undefined;
  const current = goal.kind === "subscribers" ? ctx.subscribers : video?.views ?? null;
  if (current === null) return { current: null, share: null, left: null, eta: null, done: Boolean(goal.done_at) };
  const start = Math.min(goal.start_value ?? 0, current);
  const share = goal.target > start ? Math.max(0, Math.min(1, (current - start) / (goal.target - start))) : 1;
  const left = Math.max(0, goal.target - current);
  let perDay: number | null = null;
  if (goal.kind === "subscribers") {
    const recent = ctx.daily.slice(-28);
    perDay = recent.length ? recent.reduce((t, d) => t + d.subs_gained - d.subs_lost, 0) / recent.length : null;
  } else if (video && goal.video_id) {
    // Only a picked video has a pace to project; "any video" could be met by one not posted yet.
    perDay = video.views_per_day;
  }
  const eta = left > 0 && perDay && perDay > 0 && left / perDay < 3650 ? addDays(ctx.today, Math.ceil(left / perDay)) : null;
  return { current, share, left, eta, done: Boolean(goal.done_at) || left === 0 };
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export function themes(comments: Comment[]): { theme: string; count: number; positive: number; negative: number; questions: number; sample: Comment }[] {
  const groups = new Map<string, Comment[]>();
  for (const c of comments) if (c.theme) groups.set(c.theme, [...(groups.get(c.theme) ?? []), c]);
  return [...groups.entries()].map(([theme, list]) => ({
    theme, count: list.length,
    positive: list.filter((c) => c.sentiment === "positive").length,
    negative: list.filter((c) => c.sentiment === "negative").length,
    questions: list.filter((c) => c.is_question).length,
    sample: [...list].sort((a, b) => b.likes - a.likes)[0],
  })).sort((a, b) => b.count - a.count);
}

/** What goes on the front page: the ones the owner pinned, then the best-liked recent positive ones. Never a hidden or negative one. */
/** The comments the owner pinned to the front page, newest first. Nothing else is shown there. */
export function kindWords(comments: Comment[]): Comment[] {
  return comments.filter((c) => c.pinned && !c.hidden).sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export interface PlanDay {
  date: string;
  inMonth: boolean;
  ideas: Idea[];
  uploads: Video[];
  /** How many streams went out that day; they are counted, not listed. */
  streams: number;
}

/** A month as whole weeks, Sunday first, with what is planned and what went up on each day. */
export function planMonth(month: string, ideas: Idea[], videos: Video[]): PlanDay[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  const weeks: PlanDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: PlanDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86_400_000).toISOString().slice(0, 10);
      week.push({
        date, inMonth: date.startsWith(month),
        ideas: ideas.filter((i) => i.target_date === date && i.status !== "published"),
        uploads: videos.filter((v) => v.privacy === "public" && v.content_type !== "live" && v.published_at?.slice(0, 10) === date),
        streams: videos.filter((v) => v.privacy === "public" && v.content_type === "live" && v.published_at?.slice(0, 10) === date).length,
      });
    }
    if (w > 3 && week.every((day) => !day.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

/** Weeks ahead (Sunday to Saturday) with nothing planned in them. */
export function emptyWeeks(ideas: Idea[], today: string, ahead = 6): string[] {
  const t = new Date(`${today}T00:00:00Z`);
  const sunday = new Date(t.getTime() - t.getUTCDay() * 86_400_000);
  const out: string[] = [];
  for (let w = 0; w < ahead; w++) {
    const from = new Date(sunday.getTime() + w * 7 * 86_400_000).toISOString().slice(0, 10);
    const to = addDays(from, 6);
    if (!ideas.some((i) => i.target_date && i.target_date >= from && i.target_date <= to)) out.push(from);
  }
  return out;
}
