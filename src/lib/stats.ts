// Turns stored rows into what the screens show: periods, totals, chart series,
// the opening sentence and the "you vs. them" comparisons.

import { compact, count, FORMAT_PLURAL, percentChange } from "./format.ts";
import type { DailyRow, FormatDailyRow, Video } from "./types.ts";

export type RangeKey = "28" | "90" | "all";
export type Metric = "views" | "watch" | "engaged" | "subs";
export type SeriesKey = "short" | "long" | "live" | "other";

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const EMPTY: Omit<DailyRow, "date"> = {
  views: 0, engaged_views: 0, minutes_watched: 0, subs_gained: 0, subs_lost: 0, likes: 0, comments: 0, shares: 0,
};

/** Every calendar day between the first and last row, with quiet days filled in as zero. */
export function fillDays(daily: DailyRow[]): DailyRow[] {
  if (daily.length === 0) return [];
  const byDate = new Map(daily.map((r) => [r.date, r]));
  const out: DailyRow[] = [];
  for (let t = toTime(daily[0].date); t <= toTime(daily[daily.length - 1].date); t += DAY) {
    const date = toDate(t);
    out.push(byDate.get(date) ?? { date, ...EMPTY });
  }
  return out;
}

export interface Period {
  range: RangeKey;
  current: DailyRow[];
  /** The same number of days just before, or null when there is not enough history. */
  previous: DailyRow[] | null;
  from: string | null;
  to: string | null;
}

/** Periods end at the latest day that has data, because YouTube's numbers trail by a few days. */
export function splitPeriod(daily: DailyRow[], range: RangeKey): Period {
  const days = fillDays(daily);
  if (range === "all" || days.length === 0) {
    return { range, current: days, previous: null, from: days[0]?.date ?? null, to: days.at(-1)?.date ?? null };
  }
  const n = Number(range);
  const current = days.slice(-n);
  const previous = days.length >= 2 * n ? days.slice(-2 * n, -n) : null;
  return { range, current, previous, from: current[0].date, to: current.at(-1)!.date };
}

export interface Totals {
  views: number;
  engaged: number | null;
  minutes: number;
  gained: number;
  lost: number;
  net: number;
}

export function totals(rows: DailyRow[]): Totals {
  const sum = (pick: (r: DailyRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const gained = sum((r) => r.subs_gained ?? 0);
  const lost = sum((r) => r.subs_lost ?? 0);
  return {
    views: sum((r) => r.views ?? 0),
    engaged: rows.some((r) => r.engaged_views !== null) ? sum((r) => r.engaged_views ?? 0) : null,
    minutes: sum((r) => r.minutes_watched ?? 0),
    gained, lost, net: gained - lost,
  };
}

/** Percentage change, or null when there is nothing to compare with. */
export function change(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined || previous <= 0) return null;
  return (100 * (current - previous)) / previous;
}

export interface TimelinePoint {
  date: string;
  /** Last day of the bucket when days are grouped into weeks. */
  end: string;
  short: number;
  long: number;
  live: number;
  other: number;
  total: number;
  gained: number;
  lost: number;
}

/** One point per day, split by format where the split is known. */
export function timeline(period: DailyRow[], formats: FormatDailyRow[], metric: Metric): TimelinePoint[] {
  const pick = (r: { views: number; engaged_views: number | null; minutes_watched: number }) =>
    metric === "watch" ? (r.minutes_watched ?? 0) / 60 : metric === "engaged" ? r.engaged_views ?? 0 : r.views ?? 0;
  const byDate = new Map<string, FormatDailyRow[]>();
  for (const f of formats) {
    const list = byDate.get(f.date);
    if (list) list.push(f);
    else byDate.set(f.date, [f]);
  }
  return period.map((day) => {
    const point: TimelinePoint = {
      date: day.date, end: day.date, short: 0, long: 0, live: 0, other: 0, total: 0,
      gained: day.subs_gained ?? 0, lost: day.subs_lost ?? 0,
    };
    const parts = byDate.get(day.date);
    if (parts?.length) for (const p of parts) point[p.content_type] += pick(p);
    else point.other = pick(day);
    point.total = point.short + point.long + point.live + point.other;
    return point;
  });
}

/** Group days into runs of `size`, counted back from the newest day so the latest bucket is complete. */
export function bucket(points: TimelinePoint[], size: number): TimelinePoint[] {
  if (size <= 1) return points;
  const out: TimelinePoint[] = [];
  for (let end = points.length; end > 0; end -= size) {
    const group = points.slice(Math.max(0, end - size), end);
    const merged: TimelinePoint = { ...group[0], end: group.at(-1)!.date };
    for (const p of group.slice(1)) {
      for (const k of ["short", "long", "live", "other", "total", "gained", "lost"] as const) merged[k] += p[k];
    }
    out.unshift(merged);
  }
  return out;
}

export function activeSeries(points: TimelinePoint[]): SeriesKey[] {
  return (["short", "long", "live", "other"] as const).filter((k) => points.some((p) => p[k] > 0));
}

export interface Headline {
  lead: string;
  facts: string[];
}

/** The sentence the overview opens with, built from the numbers on screen. */
export function headline(period: Period, formats: FormatDailyRow[], videos: Video[], now = new Date()): Headline {
  const cur = totals(period.current);
  const days = period.current.length;
  if (days === 0) return { lead: "No numbers yet.", facts: [] };

  let lead: string;
  const delta = period.previous ? change(cur.views, totals(period.previous).views) : null;
  if (period.range === "all") lead = `${compact(cur.views)} views across ${count(days, "day")} on record.`;
  else if (delta === null) lead = `${compact(cur.views)} views in the last ${days} days.`;
  else if (Math.abs(delta) < 5) lead = `Views are holding steady over the last ${days} days.`;
  else lead = `Views are ${delta > 0 ? "up" : "down"} ${percentChange(Math.abs(delta)).replace("+", "")} on the ${days} days before.`;

  const facts: string[] = [];
  const dates = new Set(period.current.map((d) => d.date));
  const byFormat = new Map<string, number>();
  for (const f of formats) if (dates.has(f.date)) byFormat.set(f.content_type, (byFormat.get(f.content_type) ?? 0) + (f.views ?? 0));
  const formatTotal = [...byFormat.values()].reduce((a, b) => a + b, 0);
  const top = [...byFormat.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && formatTotal > 0) {
    const share = Math.round((100 * top[1]) / formatTotal);
    facts.push(share >= 99 ? `Nearly all of them came from ${FORMAT_PLURAL[top[0]]}.` : `${FORMAT_PLURAL[top[0]]} brought ${share}% of them.`);
  }

  const uploads = videos.filter((v) => v.privacy === "public" && v.published_at);
  const latest = uploads.map((v) => Date.parse(v.published_at!)).sort((a, b) => b - a)[0];
  if (latest) {
    // Calendar days, the way a person counts: posted on the 4th, today is the 6th, that is 2 days ago.
    const since = Math.round((toTime(toDate(now.getTime())) - toTime(toDate(latest))) / DAY);
    const recent = uploads.filter((v) => now.getTime() - Date.parse(v.published_at!) <= 28 * DAY).length;
    facts.push(since > 14 ? `Your last upload was ${count(since, "day")} ago.` : `You posted ${count(recent, "upload")} in the last 28 days.`);
  }
  if (cur.gained || cur.lost) {
    facts.push(`You gained ${count(cur.gained, "subscriber")} and lost ${cur.lost}.`);
  }
  return { lead, facts };
}

export interface TitleStats {
  n: number;
  medianLength: number | null;
  /** Shares from 0 to 1. */
  withNumber: number;
  question: number;
  allCaps: number;
  medianHashtags: number | null;
}

/** What a set of titles has in common, for comparing mine with someone else's. */
export function titleStats(titles: string[]): TitleStats {
  const list = titles.filter((t) => t && t.trim());
  const share = (test: (t: string) => boolean) => (list.length ? list.filter(test).length / list.length : 0);
  const capsHeavy = (t: string) => {
    const letters = t.replace(/#\S+/g, "").replace(/[^\p{L}]/gu, "");
    return letters.length >= 8 && letters.replace(/[^\p{Lu}]/gu, "").length / letters.length >= 0.7;
  };
  return {
    n: list.length,
    medianLength: median(list.map((t) => t.replace(/\s*#\S+/g, "").trim().length)),
    withNumber: share((t) => /\d/.test(t.replace(/#\S+/g, ""))),
    question: share((t) => t.includes("?")),
    allCaps: share(capsHeavy),
    medianHashtags: median(list.map((t) => (t.match(/#\S+/g) ?? []).length)),
  };
}

/** Topics I post about most, to offer as one-tap searches. */
export function myTopics(videos: Video[], limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const v of videos) {
    for (const tag of new Set((v.tags ?? []).map((t) => t.toLowerCase().trim()))) {
      const words = tag.split(/\s+/).length;
      if (words >= 1 && words <= 4 && tag.length >= 4 && tag.length <= 32) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  const picked: string[] = [];
  for (const [tag] of ranked) {
    if (picked.some((p) => p.includes(tag) || tag.includes(p))) continue;
    picked.push(tag);
    if (picked.length === limit) break;
  }
  return picked;
}

/** True when the stored library covers (nearly) the whole channel, so "typical" numbers can be trusted. */
export function libraryComplete(videos: Video[], channelVideos: number | null | undefined): boolean {
  if (!channelVideos) return videos.length > 0;
  return videos.length >= 0.9 * channelVideos;
}
