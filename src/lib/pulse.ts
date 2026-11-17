// The first 48 hours of an upload, set against earlier uploads of the same format at the same age,
// and the short weekly note on the front page.

import { useQuery } from "@tanstack/react-query";
import { fail } from "./api.ts";
import type { GoalProgress, VideoDay } from "./growth.ts";
import { supabase } from "./supabase.ts";
import type { DailyRow, Idea, Video } from "./types.ts";

export interface PulseRow {
  video_id: string;
  captured_at: string;
  views: number;
}

export async function getPulse(): Promise<PulseRow[]> {
  const { data, error } = await supabase.from("yt_video_pulse").select("video_id, captured_at, views")
    .order("captured_at").limit(6000);
  fail(error);
  return (data ?? []) as unknown as PulseRow[];
}

/** First-week days of the uploads a new one is measured against. */
export async function getFirstDays(videoIds: string[]): Promise<VideoDay[]> {
  if (videoIds.length === 0) return [];
  const { data, error } = await supabase.from("yt_video_analytics_daily").select("video_id, date, views, minutes_watched, subs_gained")
    .in("video_id", videoIds).order("date").limit(4000);
  fail(error);
  return (data ?? []) as unknown as VideoDay[];
}

export const usePulse = () => useQuery({ queryKey: ["pulse"], queryFn: getPulse, refetchInterval: 10 * 60_000 });
export const useFirstDays = (ids: string[]) =>
  useQuery({ queryKey: ["first-days", ids.join(",")], queryFn: () => getFirstDays(ids), enabled: ids.length > 0 });

// ---------------------------------------------------------------------------
// Curves: views against hours since publishing
// ---------------------------------------------------------------------------

export interface Point { h: number; views: number }

const HOUR = 3_600_000;
/** YouTube changed how it counts a view on this day; older view counts run lower. */
export const VIEW_CHANGE = "2026-08-27";
export const TRACK_HOURS = 72;

const pacific = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
function pacificParts(iso: string): { date: string; hour: number } {
  const parts = Object.fromEntries(pacific.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) + Number(parts.minute) / 60 };
}

/** The live view counts written down each hour. */
export function curveFromPulse(video: Video, pulse: PulseRow[]): Point[] {
  if (!video.published_at) return [];
  const start = Date.parse(video.published_at);
  const points = pulse.filter((p) => p.video_id === video.id)
    .map((p) => ({ h: (Date.parse(p.captured_at) - start) / HOUR, views: p.views }))
    .filter((p) => p.h >= 0).sort((a, b) => a.h - b.h);
  return points.length ? [{ h: 0, views: 0 }, ...points] : [];
}

/**
 * The same curve for an older upload, from YouTube's daily numbers. Its days run on Pacific time, so
 * the first "day" is only what was left of the day the video went up: each day's total is pinned to
 * the hour that day ended.
 */
export function curveFromDays(video: Video, days: VideoDay[]): Point[] {
  if (!video.published_at) return [];
  const { date, hour } = pacificParts(video.published_at);
  const mine = days.filter((d) => d.video_id === video.id && d.date >= date).sort((a, b) => a.date.localeCompare(b.date));
  if (mine.length === 0) return [];
  const points: Point[] = [{ h: 0, views: 0 }];
  let total = 0;
  for (const d of mine) {
    const index = Math.round((Date.parse(d.date) - Date.parse(date)) / 86_400_000);
    total += d.views ?? 0;
    points.push({ h: 24 - hour + index * 24, views: total });
  }
  return points;
}

/** Views at an age, read off a curve. Null past the curve's last point. */
export function viewsAt(curve: Point[], h: number): number | null {
  if (curve.length < 2 || h < 0 || h > curve[curve.length - 1].h) return null;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (h <= b.h) return b.h === a.h ? b.views : a.views + ((b.views - a.views) * (h - a.h)) / (b.h - a.h);
  }
  return null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The uploads a video is measured against: the 20 before it in the same format, old enough to have their first days in. */
export function yardstickVideos(video: Video, videos: Video[]): Video[] {
  return videos
    .filter((v) => v.id !== video.id && v.content_type === video.content_type && v.privacy === "public" && v.published_at
      && v.published_at < (video.published_at ?? "") && (v.age_days ?? 0) >= 4)
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, 20);
}

export interface First48 {
  /** This upload's own curve. */
  mine: Point[];
  /** The usual curve for the format, every 6 hours. Empty when there is nothing to compare with. */
  usual: Point[];
  /** How many earlier uploads the usual curve is built from. */
  from: number;
  now: { h: number; views: number; usual: number | null; times: number | null } | null;
  /** The earlier uploads were counted the old, stricter way, so "usual" reads low and this upload reads high. */
  olderCounting: boolean;
}

export function first48(video: Video, videos: Video[], pulse: PulseRow[], days: VideoDay[]): First48 {
  const mine = curveFromPulse(video, pulse);
  const curves = yardstickVideos(video, videos)
    .map((v) => {
      const live = curveFromPulse(v, pulse);
      // An upload watched live from the start has the better curve; otherwise fall back on its days.
      return { v, curve: live.length > 4 && live[1].h < 6 ? live : curveFromDays(v, days) };
    })
    .filter((c) => c.curve.length >= 2);
  const usualAt = (h: number) => {
    const values = curves.map((c) => viewsAt(c.curve, h)).filter((n): n is number => n !== null);
    return values.length >= 3 ? median(values) : null;
  };
  const usual: Point[] = [];
  for (let h = 0; h <= TRACK_HOURS; h += 6) {
    const views = h === 0 ? 0 : usualAt(h);
    if (views !== null) usual.push({ h, views });
  }
  const last = mine[mine.length - 1];
  const at = last && last.h > 0 ? Math.min(last.h, TRACK_HOURS) : null;
  const nowViews = at === null ? null : viewsAt(mine, at);
  const nowUsual = at === null ? null : usualAt(at);
  return {
    mine: mine.filter((p) => p.h <= TRACK_HOURS),
    usual: usual.length >= 2 ? usual : [],
    from: curves.length,
    now: at === null || nowViews === null ? null : {
      h: at, views: Math.round(nowViews), usual: nowUsual === null ? null : Math.round(nowUsual),
      times: nowUsual ? Math.round((10 * nowViews) / nowUsual) / 10 : null,
    },
    olderCounting: (video.published_at ?? "") >= VIEW_CHANGE && curves.length > 0
      && curves.filter((c) => (c.v.published_at ?? "") < VIEW_CHANGE).length > curves.length / 2,
  };
}

/** The newest upload still inside its tracked hours, if there is one. Streams are left out. */
export function trackedUpload(videos: Video[], now: number): Video | null {
  return videos
    .filter((v) => v.privacy === "public" && v.content_type !== "live" && v.published_at
      && now - Date.parse(v.published_at) <= TRACK_HOURS * HOUR && now >= Date.parse(v.published_at))
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0] ?? null;
}

// ---------------------------------------------------------------------------
// The weekly note
// ---------------------------------------------------------------------------

export interface NoteLine { text: string; href?: string }

const KIND = { long: "long-form video", short: "Short", live: "stream" } as const;
const plural = (n: number, kind: keyof typeof KIND) => (kind === "short" ? `${n} Short${n === 1 ? "" : "s"}` : `${n} ${KIND[kind]}${n === 1 ? "" : "s"}`);
const whole = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Three or four lines on the last seven days: what went up, what is running ahead of its own kind,
 * how the channel moved, and what is next. Each format is weighed against itself only.
 */
export function weekNote(input: {
  videos: Video[]; daily: DailyRow[]; ideas: Idea[]; today: string;
  goals: { title: string; progress: GoalProgress }[];
  topIdea?: { title: string; id: string; score: number } | null;
}): NoteLine[] {
  const { videos, daily, ideas, today } = input;
  const lines: NoteLine[] = [];
  const dayMs = 86_400_000;
  const t = Date.parse(today);
  const open = videos.filter((v) => v.privacy === "public" && v.published_at);
  const week = open.filter((v) => t - Date.parse(v.published_at!.slice(0, 10)) < 7 * dayMs);

  // 1. What went up.
  const made = week.filter((v) => v.content_type !== "live");
  const streams = week.length - made.length;
  if (made.length === 0) {
    const last = open.filter((v) => v.content_type !== "live").sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
    const ago = last ? Math.round((t - Date.parse(last.published_at!.slice(0, 10))) / dayMs) : null;
    lines.push({
      text: `No video or Short went up in the last 7 days${streams ? `, though you streamed ${streams === 1 ? "once" : `${streams} times`}` : ""}.${ago !== null ? ` Your last one was ${ago} days ago.` : ""}`,
    });
  } else {
    const counts = (["long", "short"] as const).map((f) => [f, made.filter((v) => v.content_type === f).length] as const).filter(([, n]) => n > 0);
    lines.push({ text: `You posted ${counts.map(([f, n]) => plural(n, f)).join(" and ")} in the last 7 days${streams ? `, and streamed ${streams === 1 ? "once" : `${streams} times`}` : ""}.` });
  }

  // 2. What is ahead of its own kind, among the last four weeks' uploads.
  const ahead = open
    .filter((v) => v.content_type !== "live" && t - Date.parse(v.published_at!.slice(0, 10)) < 28 * dayMs && (v.vs_typical ?? 0) >= 1.5)
    .sort((a, b) => (b.vs_typical ?? 0) - (a.vs_typical ?? 0))[0];
  if (ahead) {
    lines.push({
      text: `"${ahead.title.replace(/\s*#\S+/g, "").trim()}" is running at ${ahead.vs_typical}x your usual ${KIND[ahead.content_type as "long" | "short"]}.`,
      href: `#/videos?v=${ahead.id}`,
    });
  }

  // 3. How the channel moved, on the days YouTube has numbers for.
  const rows = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length >= 14) {
    const sum = (list: DailyRow[]) => list.reduce((n, d) => n + d.views, 0);
    const now = rows.slice(-7), before = rows.slice(-14, -7);
    const subs = now.reduce((n, d) => n + d.subs_gained - d.subs_lost, 0);
    const a = sum(now), b = sum(before);
    const move = b > 0 ? Math.round((100 * (a - b)) / b) : null;
    lines.push({
      text: `${whole(a)} views in the newest 7 days of numbers${move === null ? "" : move === 0 ? ", level with the 7 before" : `, ${move > 0 ? "up" : "down"} ${Math.abs(move)}% on the 7 before`}, and ${subs >= 0 ? `${whole(subs)} subscribers gained` : `${whole(-subs)} subscribers lost`}.`,
    });
  }

  // 4. What is next: a planned idea, else the best-scoring one, and the goal closest to done.
  const next = ideas.filter((i) => i.target_date && i.target_date >= today && i.status !== "published")
    .sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? ""))[0];
  if (next) {
    const inDays = Math.round((Date.parse(next.target_date!) - t) / dayMs);
    lines.push({ text: `Next up: "${next.title}", ${inDays === 0 ? "due today" : inDays === 1 ? "due tomorrow" : `due in ${inDays} days`}.`, href: `#/ideas?edit=${next.id}` });
  } else if (input.topIdea) {
    lines.push({ text: `Nothing is planned. Your best-scoring idea is "${input.topIdea.title}" (${input.topIdea.score} out of 100).`, href: `#/ideas?edit=${input.topIdea.id}` });
  } else {
    lines.push({ text: "Nothing is planned. Add an idea and give it a date to see it here.", href: "#/ideas" });
  }
  const goal = input.goals.filter((g) => !g.progress.done && g.progress.share !== null && g.progress.left !== null)
    .sort((a, b) => (b.progress.share ?? 0) - (a.progress.share ?? 0))[0];
  if (goal) lines.push({ text: `Closest goal: ${goal.title}, ${whole(goal.progress.left!)} to go.`, href: "#/goals" });
  return lines;
}
