import { describe, expect, it } from "vitest";
import { ago, compact, day, duration, hours, multiple, percentChange } from "../src/lib/format.ts";
import { auditAll, dominantTagWord } from "../src/lib/seo.ts";
import { bucket, change, fillDays, headline, libraryComplete, myTopics, splitPeriod, timeline, titleStats, totals } from "../src/lib/stats.ts";
import type { DailyRow, FormatDailyRow, Video } from "../src/lib/types.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const row = (date: string, views: number, extra: Partial<DailyRow> = {}): DailyRow => ({
  date, views, engaged_views: Math.round(views / 2), minutes_watched: views / 10, subs_gained: 0, subs_lost: 0,
  likes: 0, comments: 0, shares: 0, ...extra,
});
const days = (n: number, views: (i: number) => number): DailyRow[] =>
  Array.from({ length: n }, (_, i) => row(new Date(Date.UTC(2026, 7, 1) + i * 86_400_000).toISOString().slice(0, 10), views(i)));
const video = (over: Partial<Video>): Video => ({
  id: "v", title: "t", content_type: "long", privacy: "public", published_at: null, duration_s: 600, views: 100, likes: 1,
  comments: 0, shares: null, subs_gained: null, watch_hours: null, avg_view_duration_s: null, avg_view_pct: null,
  age_days: 1, views_per_day: 1, engagement_pct: 1, typical_views: null, vs_typical: null, search_pct: null,
  recommended_pct: null, discovery: null, url: "", thumbnail_url: null, tags: null, traffic: null,
  estimated_revenue: null, revenue_per_1000_views: null, ...over,
});

describe("formatting", () => {
  it("writes numbers the way a person would read them", () => {
    expect(compact(1284)).toBe("1,284");
    expect(compact(9999)).toBe("9,999");
    expect(compact(12_940)).toBe("12.9K");
    expect(compact(277_399)).toBe("277K");
    expect(compact(1_898_355)).toBe("1.9M");
    expect(compact(null)).toBe("–");
    expect(percentChange(-31.8)).toBe("−32%");
    expect(percentChange(4.26)).toBe("+4.3%");
    expect(percentChange(0)).toBe("0%");
    expect(multiple(14.2)).toBe("14x");
    expect(multiple(2.34)).toBe("2.3x");
    expect(multiple(null)).toBe("–");
    expect(hours(720)).toBe("12");
    expect(hours(95)).toBe("1.6");
    expect(duration(15)).toBe("15s");
    expect(duration(1276)).toBe("21:16");
    expect(duration(20038)).toBe("5:33:58");
    expect(duration(0)).toBe("–");
  });
  it("writes dates relative to today", () => {
    expect(day("2026-11-13", NOW)).toBe("Nov 13");
    expect(day("2024-02-27T10:00:00Z", NOW)).toBe("Feb 27, 2024");
    expect(ago("2026-09-04T16:00:25Z", NOW)).toBe("2 months ago");
    expect(ago("2026-11-15T12:00:00Z", NOW)).toBe("1 day ago");
    expect(ago("2026-11-16T09:00:00Z", NOW)).toBe("3 hours ago");
    expect(ago("2024-02-27T10:00:00Z", NOW)).toBe("3 years ago");
  });
});

describe("periods", () => {
  it("compares the latest days with the same number just before", () => {
    const p = splitPeriod(days(60, (i) => (i < 32 ? 100 : 50)), "28");
    expect(p.current).toHaveLength(28);
    expect(p.previous).toHaveLength(28);
    expect(totals(p.current).views).toBe(1400);
    expect(totals(p.previous!).views).toBe(2800);
    expect(change(totals(p.current).views, totals(p.previous!).views)).toBe(-50);
    expect(p.to).toBe("2026-09-29");
  });
  it("has no comparison without enough history, and none for all time", () => {
    expect(splitPeriod(days(40, () => 1), "28").previous).toBeNull();
    expect(splitPeriod(days(400, () => 1), "all").previous).toBeNull();
    expect(splitPeriod([], "28").current).toEqual([]);
    expect(change(5, 0)).toBeNull();
    expect(change(5, null)).toBeNull();
  });
  it("fills quiet days with zeros so a gap never shifts the window", () => {
    const sparse = [row("2026-08-01", 5), row("2026-08-04", 7)];
    expect(fillDays(sparse).map((d) => [d.date, d.views])).toEqual([["2026-08-01", 5], ["2026-08-02", 0], ["2026-08-03", 0], ["2026-08-04", 7]]);
  });
});

describe("timeline", () => {
  const period = [row("2026-08-01", 100), row("2026-08-02", 50)];
  const formats: FormatDailyRow[] = [
    { date: "2026-08-01", content_type: "short", views: 90, engaged_views: 40, minutes_watched: 60 },
    { date: "2026-08-01", content_type: "long", views: 10, engaged_views: 9, minutes_watched: 120 },
  ];
  it("splits a day by format and falls back to one series when the split is missing", () => {
    const points = timeline(period, formats, "views");
    expect(points[0]).toMatchObject({ short: 90, long: 10, live: 0, other: 0, total: 100 });
    expect(points[1]).toMatchObject({ short: 0, other: 50, total: 50 });
    expect(timeline(period, formats, "watch")[0]).toMatchObject({ short: 1, long: 2, total: 3 });
  });
  it("groups days into weeks counted back from the newest day", () => {
    const points = timeline(days(16, () => 10), [], "views");
    const weeks = bucket(points, 7);
    expect(weeks.map((w) => w.total)).toEqual([20, 70, 70]);
    expect(weeks.at(-1)).toMatchObject({ date: "2026-08-10", end: "2026-08-16" });
    expect(bucket(points, 1)).toBe(points);
  });
});

describe("headline", () => {
  const formats = (dates: DailyRow[], shortShare: number): FormatDailyRow[] => dates.flatMap((d) => [
    { date: d.date, content_type: "short" as const, views: d.views * shortShare, engaged_views: 0, minutes_watched: 0 },
    { date: d.date, content_type: "long" as const, views: d.views * (1 - shortShare), engaged_views: 0, minutes_watched: 0 },
  ]);
  it("says which way views moved, where they came from and how long since an upload", () => {
    const daily = days(56, (i) => (i < 28 ? 100 : 68));
    daily.at(-1)!.subs_gained = 3;
    daily.at(-1)!.subs_lost = 7;
    const h = headline(splitPeriod(daily, "28"), formats(daily, 0.99), [video({ published_at: "2026-09-04T16:00:25Z" })], NOW);
    expect(h.lead).toBe("Views are down 32% on the 28 days before.");
    expect(h.facts).toEqual(["Nearly all of them came from Shorts.", "Your last upload was 73 days ago.", "You gained 3 subscribers and lost 7."]);
  });
  it("handles growth, a flat month, recent uploads and no data", () => {
    const up = days(56, (i) => (i < 28 ? 100 : 150));
    expect(headline(splitPeriod(up, "28"), formats(up, 0.6), [video({ published_at: "2026-11-10T00:00:00Z" })], NOW))
      .toEqual({ lead: "Views are up 50% on the 28 days before.", facts: ["Shorts brought 60% of them.", "You posted 1 upload in the last 28 days."] });
    expect(headline(splitPeriod(days(56, () => 100), "28"), [], [], NOW).lead).toBe("Views are holding steady over the last 28 days.");
    expect(headline(splitPeriod(days(30, () => 100), "28"), [], [], NOW).lead).toBe("2,800 views in the last 28 days.");
    expect(headline(splitPeriod(days(400, () => 100), "all"), [], [], NOW).lead).toBe("40K views across 400 days on record.");
    expect(headline(splitPeriod([], "28"), [], [], NOW)).toEqual({ lead: "No numbers yet.", facts: [] });
  });
});

describe("comparisons", () => {
  it("summarises what a set of titles has in common", () => {
    const s = titleStats(["CAN YOU BEAT THIS BOSS? #a #b #c #d", "I Beat Elden Ring With 1 HP", "A quiet title"]);
    expect(s.n).toBe(3);
    expect(s.medianLength).toBe(23);
    expect(s.question).toBeCloseTo(1 / 3);
    expect(s.withNumber).toBeCloseTo(1 / 3);
    expect(s.allCaps).toBeCloseTo(1 / 3);
    expect(s.medianHashtags).toBe(0);
    expect(titleStats([]).medianLength).toBeNull();
  });
  it("offers the topics I post about most, without near-duplicates", () => {
    const vids = [
      video({ id: "a", tags: ["elden ring", "elden ring dlc", "cuphead"] }), video({ id: "b", tags: ["Elden Ring", "cuphead", "one-off"] }),
      video({ id: "c", tags: ["elden ring", "elden ring dlc"] }),
    ];
    expect(myTopics(vids)).toEqual(["elden ring", "cuphead"]);
  });
  it("knows when the stored library is only a sample", () => {
    expect(libraryComplete(new Array(94).fill(video({})), 515)).toBe(false);
    expect(libraryComplete(new Array(500).fill(video({})), 515)).toBe(true);
  });
});

describe("upload checks", () => {
  const cuphead = ["cuphead", "cuphead isle 2", "cuphead gameplay", "cuphead no hit", "cuphead bosses", "boss battles", "indie game challenge"];
  const bg3 = ["Baldur's Gate 3", "BG3", "BG3 Honour Mode", "BG3 Challenge Run", "BG3 Gameplay", "BG3 Builds", "Shadowheart"];
  it("finds the word a set of tags revolves around", () => {
    expect(dominantTagWord(cuphead)).toBe("cuphead");
    expect(dominantTagWord(bg3)).toBe("bg3");
    expect(dominantTagWord(["one", "two", "three", "four", "five"])).toBeNull();
    expect(dominantTagWord(["cuphead"])).toBeNull();
  });
  it("flags tags copied from another video, missing topics, repeats and crowded titles", () => {
    const vids = [
      video({ id: "wrong", title: "Can I Beat Honour Mode With Half a Party? | BG3 Challenge Run", tags: cuphead }),
      video({ id: "wrong2", title: "Can I Beat Honour Mode With Half a Party? | BG3 Challenge Run", tags: bg3 }),
      video({ id: "untitled-topic", title: "Honour Mode But I Only Use 2 Characters - Act 2", tags: bg3 }),
      video({ id: "short", content_type: "short", title: "500 HOURS IN BG3 AND HONOUR MODE STILL DID THIS!? #bg3 #baldursgate #baldursgate3 #gaming #shorts" }),
      video({ id: "long", title: "x".repeat(71) }),
      video({ id: "fine", title: "Can You Beat Cuphead With Only 1 HP?", tags: cuphead }),
      video({ id: "private", privacy: "private", title: "Can You Beat Cuphead With Only 1 HP?", tags: bg3 }),
    ];
    const audit = auditAll(vids);
    const keys = (id: string) => (audit.get(id) ?? []).map((c) => c.key);
    expect(keys("wrong")).toEqual(["tags_off_topic", "duplicate_title"]);
    expect(audit.get("wrong")![0].level).toBe("fix");
    expect(keys("wrong2")).toEqual(["duplicate_title"]);
    expect(keys("untitled-topic")).toEqual(["title_missing_topic"]);
    expect(keys("short")).toEqual(["hashtags"]);
    expect(keys("long")).toEqual(["title_long"]);
    expect(audit.has("fine")).toBe(false);
    expect(audit.has("private")).toBe(false);
  });
});
