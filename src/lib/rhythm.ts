// Upload rhythm: a target per format ("a long video every 14 days"), set against the owner's own
// uploads. Long-form, Shorts and streams each have their own: never one count across them.

import type { Format, Video } from "./types.ts";

export interface RhythmTarget { format: Format; every_days: number; active: boolean }

const DAY = 86_400_000;

/** Public uploads of one format, newest first. */
function uploads(videos: Video[], format: Format): number[] {
  return videos
    .filter((v) => v.content_type === format && v.privacy === "public" && v.published_at)
    .map((v) => Date.parse(v.published_at!))
    .sort((a, b) => b - a);
}

/** Days since the newest public upload of this format, or null when there is none. */
export function daysSince(videos: Video[], format: Format, now: number): number | null {
  const newest = uploads(videos, format)[0];
  return newest === undefined ? null : Math.max(0, Math.floor((now - newest) / DAY));
}

/**
 * The owner's usual pace over the last year: the middle gap between one upload of this format and
 * the next, in days. Null with fewer than three uploads in the year, where a pace means little.
 */
export function usualGap(videos: Video[], format: Format, now: number): number | null {
  const times = uploads(videos, format).filter((t) => t > now - 365 * DAY);
  if (times.length < 3) return null;
  const gaps = times.slice(1).map((t, i) => (times[i] - t) / DAY).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return Math.max(1, Math.round(gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2));
}

/** How one format stands against its target. */
export function rhythmStatus(target: RhythmTarget, videos: Video[], now: number) {
  const since = daysSince(videos, target.format, now);
  if (since === null) return { since, share: 1, late: true, words: "Nothing posted yet." };
  const left = target.every_days - since;
  return {
    since,
    share: Math.min(1, since / target.every_days),
    late: left < 0,
    words: left < 0 ? `${-left} ${-left === 1 ? "day" : "days"} past your target.` : left === 0 ? "Due today." : `Next one due in ${left} ${left === 1 ? "day" : "days"}.`,
  };
}

/** The choices offered for a target, with the owner's own pace among them. */
export function targetChoices(usual: number | null): number[] {
  const base = [3, 5, 7, 10, 14, 21, 30];
  return usual && usual <= 90 && !base.includes(usual) ? [...base, usual].sort((a, b) => a - b) : base;
}
