// How numbers, dates and durations are written everywhere in the app.

const full = new Intl.NumberFormat("en-US");

/** 1,284 stays whole; from ten thousand up it shortens to 12.9K, 1.2M. */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs < 10_000) return full.format(Math.round(n));
  if (abs < 1_000_000) return `${trim(n / 1000, abs < 100_000 ? 1 : 0)}K`;
  if (abs < 1_000_000_000) return `${trim(n / 1_000_000, abs < 100_000_000 ? 1 : 0)}M`;
  return `${trim(n / 1_000_000_000, 1)}B`;
}

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.0$/, "");
}

export function whole(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "–" : full.format(Math.round(n));
}

export function signed(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${whole(Math.abs(n))}`;
}

/** A change as a percentage: +12%, −32%, 0%. */
export function percentChange(change: number): string {
  const rounded = Math.abs(change) >= 10 ? Math.round(change) : Math.round(change * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}%`;
}

/** A multiple of the usual: 14x, 2.4x, 0.3x. */
export function multiple(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  return `${n >= 10 ? Math.round(n) : trim(n, 1)}x`;
}

export function hours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "–";
  const h = minutes / 60;
  return h >= 100 ? compact(h) : trim(h, 1);
}

/** 15s, 21:16, 5:33:58 */
export function duration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "–";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A calendar day ("2026-11-13") or a timestamp, as "Nov 13" (with the year when it is not this year). */
export function day(value: string | null | undefined, now = new Date()): string {
  if (!value) return "–";
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "–";
  return d.getUTCFullYear() === now.getUTCFullYear() ? monthDay.format(d) : monthDayYear.format(d);
}

export function ago(value: string | null | undefined, now = new Date()): string {
  if (!value) return "–";
  const days = (now.getTime() - new Date(value).getTime()) / 86_400_000;
  if (days < 1 / 24) return "just now";
  if (days < 1) return plural(Math.max(1, Math.round(days * 24)), "hour");
  if (days < 14) return plural(Math.round(days), "day");
  if (days < 60) return plural(Math.round(days / 7), "week");
  if (days < 730) return plural(Math.round(days / 30.4), "month");
  return plural(Math.round(days / 365), "year");
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

export function count(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${whole(n)} ${n === 1 ? singular : pluralForm}`;
}

export const FORMAT_LABEL: Record<string, string> = { short: "Short", long: "Long-form", live: "Live", other: "Other" };
export const FORMAT_PLURAL: Record<string, string> = { short: "Shorts", long: "Long-form", live: "Live", other: "Other" };
