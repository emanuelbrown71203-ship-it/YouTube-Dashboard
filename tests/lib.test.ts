import { describe, expect, it } from "vitest";
import { ago, compact, day, duration, hours, multiple, percentChange } from "../src/lib/format.ts";
import { splitByBatch } from "../src/lib/suggestions.ts";
import { lengthRule } from "../src/lib/emotions.ts";
import { byNewest, orderSections } from "../src/lib/ideaOrder.ts";
import { daysSince, rhythmStatus, targetChoices, usualGap } from "../src/lib/rhythm.ts";
import { cleanTitle, isRepeat, likeness, matchGame, pickTitle, titleProblems } from "../supabase/functions/yt-api/ideas.ts";
import { lineByLine, sentences } from "../supabase/functions/yt-api/growth.ts";
import { centreOn, clampCrop, defaultCrop, fitWithin, pictureFiles, resizeCrop, widestFrame } from "../src/lib/pictures.ts";
import { auditAll, dominantTagWord } from "../src/lib/seo.ts";
import { bucket, change, fillDays, headline, libraryComplete, myTopics, splitPeriod, timeline, titleStats, totals } from "../src/lib/stats.ts";
import type { DailyRow, FormatDailyRow, Idea, Video } from "../src/lib/types.ts";

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
  estimated_revenue: null, revenue_per_1000_views: null, topic: null, feeders: null, ...over,
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

describe("growth", () => {
  it("guesses the game from tags and hashtags, and ignores generic ones", async () => {
    const { guessTopic } = await import("../supabase/functions/yt-api/growth.ts");
    expect(guessTopic("Elden Ring But EVERY Weapon I GET I MUST USE!", ["elden ring", "elden ring dlc", "gaming"])).toBe("Elden Ring");
    expect(guessTopic("HOW I BECAME GOD IN BG3! #baldursgate #bg3 #shorts", [])).toBe("Baldursgate");
    expect(guessTopic("THIS BOSS TOOK ME 6 HOURS TO BEAT! #shorts #gaming", ["gaming"])).toBeNull();
  });

  it("compares the weeks before a test with the days after, leaving out days YouTube has not reported", async () => {
    const { testResult } = await import("../src/lib/growth.ts");
    const dayAt = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * 86_400_000).toISOString().slice(0, 10);
    const days = Array.from({ length: 60 }, (_, i) => ({ video_id: "v", date: dayAt(i), views: i < 30 ? 100 : 150, minutes_watched: 10, subs_gained: 0 }));
    const test = { id: "t", video_id: "v", kind: "thumbnail" as const, what: "x", why: null, started_on: dayAt(30), ended_on: null, ctr_before: null, ctr_after: null, verdict: null, learned: null, created_at: "" };
    const r = testResult(test, days, dayAt(45));
    expect(r.before.viewsPerDay).toBe(100);
    expect(r.after.viewsPerDay).toBe(150);
    expect(r.after.days).toBe(13); // day 30 to day 42: the last three days are not in yet
    expect(Math.round((r.viewsChange ?? 0) * 100)).toBe(50);
    expect(r.running).toBe(true);
  });

  it("measures a goal from where it started and projects when it lands", async () => {
    const { goalProgress } = await import("../src/lib/growth.ts");
    const daily = days(28, () => 100).map((d) => ({ ...d, subs_gained: 12, subs_lost: 2 }));
    const goal = { id: "g", kind: "subscribers" as const, title: "5K", target: 5000, start_value: 3000, video_id: null, format: null, due_on: null, notes: null, plan: null, done_at: null, created_at: "" };
    const p = goalProgress(goal, { subscribers: 4000, videos: [], daily, today: "2026-11-16" });
    expect(p.share).toBe(0.5);
    expect(p.left).toBe(1000);
    expect(p.eta).toBe("2027-02-24"); // 1,000 to go at 10 a day
    expect(goalProgress({ ...goal, target: 4000 }, { subscribers: 4000, videos: [], daily, today: "2026-11-16" }).done).toBe(true);
  });

  it("never lets a Short count towards a long-form views goal", async () => {
    const { goalProgress, bestVideo, byTopic, shortsWorthAVideo } = await import("../src/lib/growth.ts");
    const v = (id: string, content_type: string, views: number, over: object = {}) => ({ id, title: id, content_type, views, privacy: "public", topic: "Elden Ring", published_at: "2026-10-01", views_per_day: 1, vs_typical: 1, avg_view_pct: 40, ...over }) as never;
    const videos = [v("s1", "short", 90000, { vs_typical: 6 }), v("s2", "short", 500), v("l1", "long", 2600), v("l2", "long", 300, { published_at: "2026-09-01" }), v("x", "live", 400)];
    expect(bestVideo(videos, "long")?.id).toBe("l1");
    expect(bestVideo(videos, "short")?.id).toBe("s1");
    const goal = { id: "g", kind: "video_views" as const, title: "t", target: 10000, start_value: 2600, video_id: null, format: "long" as const, due_on: null, notes: null, plan: null, done_at: null, created_at: "2026-11-01" };
    const p = goalProgress(goal, { subscribers: 1, videos, daily: [], today: "2026-11-16" });
    expect(p.current).toBe(2600);
    expect(p.done).toBe(false);
    expect(goalProgress({ ...goal, format: "short" }, { subscribers: 1, videos, daily: [], today: "2026-11-16" }).done).toBe(true);
    // A game's numbers are per format too.
    expect(byTopic(videos, "long")[0]).toMatchObject({ videos: 2, views: 2900 });
    expect(byTopic(videos, "short")[0].views).toBe(90500);
    // The Short that beat the other Shorts is the hint; a long video on the game came after it, so it is covered.
    const hints = shortsWorthAVideo(videos);
    expect(hints.map((h) => h.short.id)).toEqual(["s1"]);
    expect(hints[0].covered).toBeNull();
    expect(shortsWorthAVideo([...videos, v("l3", "long", 100, { published_at: "2026-10-20" })])[0].covered?.id).toBe("l3");
  });

  it("scores an idea against one format only, and says when there is too little to go on", async () => {
    const { scoreIdea, ideaGame, titleLifts } = await import("../src/lib/ideaScore.ts");
    const v = (id: string, content_type: string, title: string, x: number, over: object = {}) =>
      ({ id, title, content_type, privacy: "public", topic: "Baldur's Gate 3", vs_typical: x, age_days: 60, views: 100, published_at: "2026-09-01", recommended_pct: 90, ...over }) as never;
    const videos = [
      // Long-form: questions beat plain playthroughs.
      ...[4, 5, 6, 3].map((x, i) => v(`q${i}`, "long", `Can I Beat Honour Mode With Rule ${i}?`, x)),
      ...[0.5, 0.6, 0.4, 0.7].map((x, i) => v(`p${i}`, "long", `Baldur's Gate 3 Playthrough (Pt. ${i})`, x, { topic: "Baldur's Gate 3" })),
      // Shorts on another game that did brilliantly must not lift a long-form idea on that game.
      ...[9, 8, 7, 10].map((x, i) => v(`s${i}`, "short", `ELDEN RING BOSS DID WHAT ${i} #shorts`, x, { topic: "Elden Ring" })),
    ];
    expect(ideaGame({ title: "bg3 with one rule", target_keyword: null, concept: null, hook: null }, ["Elden Ring", "Baldur's Gate 3"])).toBe("Baldur's Gate 3");
    expect(ideaGame({ title: "A cooking video", target_keyword: null, concept: null, hook: null }, ["Elden Ring"])).toBeNull();
    const question = titleLifts(videos, "long").find((l) => l.key === "question")!;
    expect(question.lift).toBeGreaterThan(5);
    expect(titleLifts(videos, "short")).toEqual([]);

    const idea = { title: "Can I Beat Baldur's Gate 3 With One Spell?", format: "long" as const, target_keyword: null, concept: null, hook: null };
    const good = scoreIdea(idea, videos, [], "2026-11-17");
    const plain = scoreIdea({ ...idea, title: "Baldur's Gate 3 Playthrough (Pt. 9)" }, videos, [], "2026-11-17");
    expect(good.game).toBe("Baldur's Gate 3");
    expect(good.history.value!).toBeGreaterThan(plain.history.value!);
    expect(good.search).toBe("Baldur's Gate 3");
    const gamePart = (x: ReturnType<typeof scoreIdea>) => x.recommended.parts.find((p) => p.label === "The game right now")!;
    expect(gamePart(good).points).toBeNull();

    // What the game-wide search found counts for the game as a whole, as a small part of the score. Shorts found do not count for a long video.
    const found = (format: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${format}${i}`, title: "Baldur's Gate 3 honour mode run", tags: [], format, views: 90000, outlier_score: 8, channel_subscribers: 9000, published_at: "2026-10-20" }));
    const withResearch = scoreIdea(idea, videos, found("long", 4), "2026-11-17");
    expect(gamePart(withResearch)).toMatchObject({ points: 2, max: 10 });
    expect(gamePart(scoreIdea(idea, videos, found("long", 30), "2026-11-17")).points).toBe(10);
    expect(withResearch.search).toBe("Baldur's Gate 3");
    expect(gamePart(scoreIdea(idea, videos, found("short", 4), "2026-11-17")).points).toBeNull();

    // A search that ran and found nothing is an answer, not a gap; a stale or missing one asks for a new search.
    const empty = scoreIdea(idea, videos, [], "2026-11-17", [{ game: "baldur's gate 3", format: "long", at: "2026-11-10T08:00:00Z" }]);
    expect(gamePart(empty).points).toBe(1);
    expect(empty.search).toBeNull();
    expect(scoreIdea(idea, videos, [], "2026-11-17", [{ game: "Baldur's Gate 3", format: "short", at: "2026-11-10T08:00:00Z" }]).search).toBe("Baldur's Gate 3");
    expect(scoreIdea(idea, videos, found("long", 4), "2026-11-17", [{ game: "Baldur's Gate 3", format: "long", at: "2026-10-01T08:00:00Z" }]).search).toBe("Baldur's Gate 3");
    expect(scoreIdea(idea, videos, found("long", 4), "2026-11-17", [{ game: "Baldur's Gate 3", format: "long", at: "2026-11-16T08:00:00Z" }]).search).toBeNull();
    // A long-form idea on a game only ever covered in Shorts gets a hint, not a track record.
    const elden = scoreIdea({ ...idea, title: "Elden Ring but I can only roll" }, videos, [], "2026-11-17");
    expect(elden.history.parts[0].points).toBeNull();
    expect(elden.history.parts.find((p) => p.label.startsWith("A hint"))!.points).toBe(15);
    // Filing the idea under a game by hand wins over what the wording says.
    expect(scoreIdea({ ...idea, title: "My next challenge run", topic: "Baldur's Gate 3" }, videos, [], "2026-11-17").game).toBe("Baldur's Gate 3");
    expect(scoreIdea({ ...idea, topic: "Elden Ring" }, videos, [], "2026-11-17").game).toBe("Elden Ring");
    // No game named: no number at all.
    expect(scoreIdea({ ...idea, title: "My setup tour" }, [], [], "2026-11-17").history.value).toBeNull();
  });

  it("scores an idea from the check on that exact video, not from the game as a whole", async () => {
    const { scoreIdea } = await import("../src/lib/ideaScore.ts");
    const idea = { title: "Elden Ring Using Only Summons", format: "long" as const, target_keyword: null, concept: null, hook: null, topic: "Elden Ring" };
    const group = (n: number, median: number | null, broke_out = 0) => ({ n, scored: median === null ? 0 : n, broke_out, median, newest: n ? "2026-08-01" : null });
    const check = (same: ReturnType<typeof group>, close = group(0, null)) => ({
      searched: 30, same, close, at: "2026-11-17T10:00:00Z",
      examples: same.n ? [{ video_id: "abc12345678", title: "Only summons", channel: "Someone", subscribers: 9000, views: 1_250_000, score: 6.2, published: "2026-08-01T00:00:00Z", match: "same" as const }] : [],
    });
    const part = (market: Parameters<typeof scoreIdea>[5]) => scoreIdea(idea, [], [], "2026-11-17", [], market).recommended.parts[0];

    // Not saved, or not checked yet: nothing is counted, and it says which.
    expect(part(undefined)).toMatchObject({ label: "This exact video on YouTube", points: null, max: 40 });
    expect(part(undefined).why).toContain("Save the idea");
    expect(part(null).points).toBeNull();
    expect(part(null).why).toContain("searching YouTube");
    // The same idea did well for the channels that made it: nearly full marks, with a video to open.
    const hit = part(check(group(5, 6, 4)));
    expect(hit.points).toBeGreaterThanOrEqual(38);
    expect(hit.why).toContain("5 videos of this exact idea");
    expect(hit.examples?.[0]).toMatchObject({ href: "https://www.youtube.com/watch?v=abc12345678", note: "Someone, 1.3M views, 6.2x its channel's usual" });
    // It was made and fell flat: below even. One lone video moves the score less than a pattern does.
    expect(part(check(group(5, 0.4))).points!).toBeLessThan(15);
    expect(part(check(group(1, 6, 1))).points!).toBeLessThan(hit.points!);
    expect(part(check(group(1, 6, 1))).points!).toBeGreaterThan(20);
    // Nobody made it, but the same kind of video does well: a weaker lift. Nothing like it at all: even, and untested.
    const open = part(check(group(0, null), group(6, 5, 4)));
    expect(open.points!).toBeGreaterThan(20);
    expect(open.points!).toBeLessThan(hit.points!);
    expect(open.why).toContain("the idea is open");
    expect(part(check(group(0, null))).points).toBe(20);
    expect(part(check(group(0, null))).why).toContain("untested");
    // Two ideas on the same game now get different scores, which the game-wide search could not do.
    const a = scoreIdea(idea, [], [], "2026-11-17", [], check(group(5, 6, 4))).recommended.parts[0].points;
    const b = scoreIdea({ ...idea, title: "Elden Ring Using Only Faith" }, [], [], "2026-11-17", [], check(group(4, 0.5))).recommended.parts[0].points;
    expect(a).not.toBe(b);
  });

  it("reads bullets and checkboxes out of a note, and ticks them", async () => {
    const { parseNote, toggleCheck, untickAll, checkCount, plainNote, bareNote, hasList } = await import("../src/lib/notes.ts");
    const note = "Before I film:\n- [ ] Write the hook\n- [x] Pick the build\n  - [ ] Test it once\n\nThings to say\n- The rule\n* The stakes\nA last line";
    const blocks = parseNote(note);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "list", "text", "list", "text"]);
    expect(blocks[1]).toEqual({ kind: "list", items: [
      { line: 1, check: false, text: "Write the hook", depth: 0 }, { line: 2, check: true, text: "Pick the build", depth: 0 },
      { line: 3, check: false, text: "Test it once", depth: 1 },
    ] });
    expect(blocks[3]).toMatchObject({ items: [{ check: null, text: "The rule" }, { check: null, text: "The stakes" }] });
    expect(blocks[4]).toEqual({ kind: "text", text: "A last line" });
    expect(checkCount(note)).toEqual({ done: 1, total: 3 });
    // Ticking changes that one line and nothing else; it can be unticked again.
    const ticked = toggleCheck(note, 1);
    expect(ticked.split("\n")[1]).toBe("- [x] Write the hook");
    expect(ticked.split("\n").filter((_, i) => i !== 1)).toEqual(note.split("\n").filter((_, i) => i !== 1));
    expect(toggleCheck(ticked, 1)).toBe(note);
    expect(toggleCheck(note, 0)).toBe(note);
    expect(checkCount(untickAll(ticked))).toEqual({ done: 0, total: 3 });
    expect(plainNote("- [ ] One\n- [x] Two\n- Three\nFour")).toBe("☐ One\n☑ Two\n• Three\nFour");
    expect(bareNote("- [ ] One\n- [x] Two\n- Three\nFour")).toBe("One\nTwo\nThree\nFour");
    // Ordinary writing is left alone: a dash in a sentence, a negative number, an empty note.
    expect(hasList("The run went well - mostly.\n-5 on the last boss")).toBe(false);
    expect(parseNote("")).toEqual([]);
    expect(parseNote("Just a sentence.")).toEqual([{ kind: "text", text: "Just a sentence." }]);
  });

  it("carries a list on when Return is pressed, and turns lines into bullets or checkboxes", async () => {
    const { continueList, toggleMarker } = await import("../src/lib/notes.ts");
    // Return at the end of a bullet starts the next bullet; after a ticked box, an empty box.
    const typed = (before: string, cursor = before.length) => continueList(before, `${before.slice(0, cursor)}\n${before.slice(cursor)}`, cursor + 1);
    expect(typed("- Hook")).toEqual({ value: "- Hook\n- ", start: 9, end: 9 });
    expect(typed("Plan\n- [x] Hook")).toEqual({ value: "Plan\n- [x] Hook\n- [ ] ", start: 22, end: 22 });
    expect(typed("  - Sub")).toMatchObject({ value: "  - Sub\n  - " });
    // In the middle of an item, the rest moves to a new item.
    expect(typed("- Hook and stakes", 6)).toMatchObject({ value: "- Hook\n-  and stakes" });
    // Return on an empty bullet ends the list.
    expect(typed("- Hook\n- ")).toEqual({ value: "- Hook\n", start: 7, end: 7 });
    expect(typed("- [ ] ")).toEqual({ value: "", start: 0, end: 0 });
    // Not a list, or not a Return: nothing to do.
    expect(typed("A sentence")).toBeNull();
    expect(continueList("- Hook", "- Hooks", 7)).toBeNull();
    expect(continueList("- Hook", "- Hook\npasted\ntext", 18)).toBeNull();

    // The buttons: a plain line becomes a bullet, a bullet a checkbox, and pressing the same one again takes it off.
    expect(toggleMarker("Hook", 2, 2, "bullet")).toEqual({ value: "- Hook", start: 4, end: 4 });
    expect(toggleMarker("- Hook", 4, 4, "check")).toEqual({ value: "- [ ] Hook", start: 8, end: 8 });
    expect(toggleMarker("- [x] Hook", 8, 8, "check")).toEqual({ value: "Hook", start: 2, end: 2 });
    expect(toggleMarker("- [ ] Hook", 8, 8, "bullet").value).toBe("- Hook");
    expect(toggleMarker("", 0, 0, "check")).toEqual({ value: "- [ ] ", start: 6, end: 6 });
    // Only the line the cursor is on changes; a selection changes every line in it and skips blank ones.
    expect(toggleMarker("One\nTwo\nThree", 5, 5, "bullet").value).toBe("One\n- Two\nThree");
    expect(toggleMarker("One\n\nTwo\nThree", 0, 8, "check").value).toBe("- [ ] One\n\n- [ ] Two\nThree");
    expect(toggleMarker("- One\nTwo", 0, 9, "bullet").value).toBe("- One\n- Two");
    expect(toggleMarker("- One\n- Two", 0, 11, "bullet").value).toBe("One\nTwo");
  });

  it("sorts found thumbnails into the owner's games and outside them", async () => {
    const { currentGames, gameOfThumb, galleryItems } = await import("../src/lib/thumbs.ts");
    const videos = [
      { topic: "Cuphead", privacy: "public", published_at: "2026-06-01T00:00:00Z" },
      { topic: "Poppy Playtime", privacy: "public", published_at: "2024-01-01T00:00:00Z" },
      { topic: "Sekiro", privacy: "private", published_at: "2026-10-01T00:00:00Z" },
    ] as never[];
    const ideas = [{ topic: "Elden Ring", status: "idea" }, { topic: " Baldur's Gate 3 ", status: "filming" }, { topic: "Hollow Knight", status: "published" }] as never[];
    // The niche is what the owner is working on now: open ideas, then what they posted in the last year.
    const games = currentGames(videos, ideas, "2026-11-18");
    expect(games).toEqual(["Elden Ring", "Baldur's Gate 3", "Cuphead"]);
    expect(gameOfThumb({ title: "I Beat Elden Ring With Only Kicks", tags: [] }, games)).toBe("Elden Ring");
    expect(gameOfThumb({ title: "This run broke me", tags: ["bg3", "honour mode"] }, games)).toBe("Baldur's Gate 3");
    expect(gameOfThumb({ title: "Minecraft But Every Block Is TNT", tags: ["minecraft"] }, games)).toBeNull();

    const row = (id: string, title: string, over: object = {}) => ({ id, title, channel_id: "UCother", channel_title: "c", channel_subscribers: 20_000, published_at: "2026-11-01T00:00:00Z", views: 1000, outlier_score: 5, tags: [], category: "20", ...over });
    const rows = [
      row("a", "Elden Ring But I Can Only Roll", { outlier_score: 9 }),
      row("b", "Cuphead Without Shooting", { outlier_score: 4, published_at: "2026-11-15T00:00:00Z" }),
      row("c", "Minecraft But Gravity Is Off", { outlier_score: 12, channel_subscribers: 900_000 }),
      row("d", "Elden Ring lore explained", { outlier_score: 2.5 }),
      row("e", "Elden Ring at level 1", { published_at: "2026-01-01T00:00:00Z" }),
      row("f", "My own Elden Ring run", { channel_id: "UCme" }),
      // Outside the niche only gaming counts: a broad search also finds dance videos, and older finds have no category.
      row("g", "KATSEYE DANCE CHALLENGE", { outlier_score: 600, category: "24" }),
      row("h", "Using only the wall, day 1", { outlier_score: 200, category: null }),
      row("i", "Elden Ring castle as Venom Snake", { outlier_score: 40, category: null, published_at: "2026-10-20T00:00:00Z" }),
    ];
    const pick = (over: object) => galleryItems(rows, games, { where: "mine", game: null, days: 90, small: false, sort: "jump", ...over }, "2026-11-18", "UCme").map((r) => r.id);
    // At least 3x the channel's usual, within the time span, never the owner's own video.
    expect(pick({})).toEqual(["i", "a", "b"]);
    expect(pick({ where: "outside" })).toEqual(["c"]);
    expect(pick({ where: "all" })).toEqual(["i", "c", "a", "b"]);
    expect(pick({ game: "Cuphead" })).toEqual(["b"]);
    expect(pick({ sort: "newest" })).toEqual(["b", "a", "i"]);
    expect(pick({ where: "all", small: true })).toEqual(["i", "a", "b"]);
    expect(pick({ days: 365 })).toEqual(["i", "a", "e", "b"]);
  });

  it("reads an upload's first hours against earlier uploads of the same format", async () => {
    const { first48, curveFromDays, viewsAt, trackedUpload, weekNote } = await import("../src/lib/pulse.ts");
    const v = (id: string, content_type: string, published_at: string, age_days: number) => ({ id, title: id, content_type, privacy: "public", published_at, age_days, vs_typical: 1 }) as never;
    // Published at noon Pacific (20:00 UTC in November): half of the first Pacific day is left.
    const old = ["2026-10-01", "2026-10-08", "2026-10-15"].map((d, i) => v(`o${i}`, "long", `${d}T20:00:00Z`, 30));
    const days = old.flatMap((o: { id: string; published_at: string }) => [100, 300, 200].map((views, i) => ({ video_id: o.id, date: new Date(Date.parse(o.published_at.slice(0, 10)) + i * 86_400_000).toISOString().slice(0, 10), views, minutes_watched: 0, subs_gained: 0 })));
    const curve = curveFromDays(old[0], days);
    expect(curve.map((p) => [Math.round(p.h), p.views])).toEqual([[0, 0], [11, 100], [35, 400], [59, 600]]);
    expect(Math.round(viewsAt(curve, 23)!)).toBe(250);
    const fresh = v("new", "long", "2026-11-16T20:00:00Z", 0);
    const shortHit = v("s", "short", "2026-11-01T20:00:00Z", 16);
    const pulse = [6, 12, 23].map((h) => ({ video_id: "new", captured_at: new Date(Date.parse("2026-11-16T20:00:00Z") + h * 3_600_000).toISOString(), views: h * 25 }));
    const read = first48(fresh, [...old, fresh, shortHit], pulse, [...days, { video_id: "s", date: "2026-11-01", views: 90000, minutes_watched: 0, subs_gained: 0 }]);
    expect(read.from).toBe(3);
    expect(read.now).toMatchObject({ views: 575, usual: 250, times: 2.3 });
    expect(read.olderCounting).toBe(false);
    expect(trackedUpload([...old, fresh], Date.parse("2026-11-17T20:00:00Z"))?.id).toBe("new");
    expect(trackedUpload([...old, fresh], Date.parse("2026-11-21T20:00:00Z"))).toBeNull();

    const note = weekNote({ videos: [...old, fresh], daily: [], ideas: [], goals: [], today: "2026-11-17", topIdea: { title: "Run", id: "i", score: 71 } });
    expect(note[0].text).toBe("You posted 1 long-form video in the last 7 days.");
    expect(note.at(-1)!.text).toContain("71 out of 100");
    expect(weekNote({ videos: old, daily: [], ideas: [], goals: [], today: "2026-11-17" })[0].text).toContain("Your last one was 33 days ago");
    // The rhythm rows in the same card already say how long it has been, and goals have their own block.
    const goal = { title: "50K views", progress: { done: false, share: 0.7, left: 15000 } } as never;
    const withRhythm = weekNote({ videos: old, daily: [], ideas: [], goals: [goal], today: "2026-11-17", rhythmShown: true });
    expect(withRhythm.some((l) => l.text.includes("days ago"))).toBe(false);
    expect(withRhythm.some((l) => l.text.includes("goal"))).toBe(false);
  });

  it("reads how far a goal's plan is, and its next step", async () => {
    const { planStatus } = await import("../src/lib/growth.ts");
    const plan = "First\n- [x] Turn on memberships\n- [ ] Make 3 emoji\n\nEvery month\n- [ ] Members' poll\n- A note, not a step";
    expect(planStatus(plan)).toEqual({ done: 1, total: 3, next: "Make 3 emoji" });
    expect(planStatus("- [x] Done")).toEqual({ done: 1, total: 1, next: null });
    expect(planStatus(null)).toEqual({ done: 0, total: 0, next: null });
  });

  it("shows one saved line or comment a day, each in turn", async () => {
    const { ofTheDay } = await import("../src/lib/daily.ts");
    const day = 86_400_000;
    expect([0, 1, 2, 3].map((d) => ofTheDay(["a", "b", "c"], d * day + 5))).toEqual(["a", "b", "c", "a"]);
    expect(ofTheDay([], 0)).toBeUndefined();
  });

  it("shows only the comments the owner pinned on the front page", async () => {
    const { kindWords } = await import("../src/lib/growth.ts");
    const c = (id: string, over: object) => ({ id, video_id: null, author: null, text: "This video was great fun", likes: 1, published_at: "2026-11-01", sentiment: "positive" as const, theme: null, is_question: false, pinned: false, hidden: false, ...over });
    const picked = kindWords([c("a", { likes: 9 }), c("b", { sentiment: "negative", likes: 99 }), c("c", { hidden: true, likes: 50 }), c("d", { pinned: true, sentiment: null }), c("e", { sentiment: null })]);
    expect(picked.map((x) => x.id)).toEqual(["d"]);
  });

  it("lays a month out as whole weeks with plans and uploads on their days", async () => {
    const { planMonth, emptyWeeks } = await import("../src/lib/growth.ts");
    const idea = { id: "i", title: "Run", format: "long", status: "idea", target_date: "2026-11-30" } as never;
    const weeks = planMonth("2026-11", [idea], [video({ id: "u", published_at: "2026-11-04T18:00:00Z" })]);
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0].date).toBe("2026-11-01");
    expect(weeks.flat().find((d) => d.date === "2026-11-30")?.ideas).toHaveLength(1);
    expect(weeks.flat().find((d) => d.date === "2026-11-04")?.uploads).toHaveLength(1);
    expect(emptyWeeks([idea], "2026-11-16", 3)).toEqual(["2026-11-15", "2026-11-22"]);
  });
});

describe("thumbnail links", () => {
  it("ignores the rotating signature on private videos but sees a new picture", async () => {
    const { thumbKey } = await import("../supabase/functions/yt-api/growth.ts");
    const a = "https://i9.ytimg.com/vi/_8C_h-U_ZUA/mqdefault.jpg?sqp=COSf7NcG&rs=AOn4CLDw";
    const b = "https://i.ytimg.com/vi/_8C_h-U_ZUA/mqdefault.jpg?sqp=CMCr7NcG&rs=AOn4CLB0";
    expect(thumbKey(a)).toBe(thumbKey(b));
    expect(thumbKey("https://i.ytimg.com/vi/x/mqdefault.jpg?v=6a738609")).not.toBe(thumbKey("https://i.ytimg.com/vi/x/mqdefault.jpg?v=7b000000"));
  });
});

describe("reach report", () => {
  it("adds finer rows up to one row per video and day, with the rate in percent", async () => {
    const { parseReach } = await import("../supabase/functions/yt-api/growth.ts");
    const csv = "date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n20261110,UC1,vidA,1000,0.05\n20261110,UC1,vidA,3000,0.03\n20261111,UC1,vidB,0,0\n";
    expect(parseReach(csv)).toEqual([
      { video_id: "vidA", date: "2026-11-10", impressions: 4000, ctr: 3.5 },
      { video_id: "vidB", date: "2026-11-11", impressions: 0, ctr: null },
    ]);
    expect(parseReach("nothing useful")).toEqual([]);
  });
});

describe("framing a screenshot", () => {
  it("starts with the widest 16:9 box in the middle", () => {
    // An iPhone screenshot: the box spans the width.
    expect(defaultCrop(1179, 2556)).toEqual({ x: 0, y: (2556 - 1179 * 9 / 16) / 2, w: 1179, h: 1179 * 9 / 16 });
    // A thumbnail-shaped picture: the box is the whole picture.
    expect(defaultCrop(1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    // A wider picture: the box is as tall as the picture.
    expect(widestFrame(2000, 720)).toEqual({ w: 1280, h: 720 });
  });

  it("keeps the box inside the picture when it is dragged or brought to a touch", () => {
    const box = defaultCrop(1179, 2556);
    expect(clampCrop({ ...box, x: -50, y: -10 }, 1179, 2556)).toMatchObject({ x: 0, y: 0 });
    expect(clampCrop({ ...box, y: 9999 }, 1179, 2556).y).toBeCloseTo(2556 - box.h);
    expect(centreOn(box, 600, 1000, 1179, 2556).y).toBeCloseTo(1000 - box.h / 2);
    expect(centreOn(box, 600, 10, 1179, 2556).y).toBe(0);
  });

  it("makes the box smaller around its middle, never below a fifth", () => {
    const box = defaultCrop(1179, 2556);
    const half = resizeCrop(box, 0.5, 1179, 2556);
    expect(half.w).toBeCloseTo(589.5);
    expect(half.w / half.h).toBeCloseTo(16 / 9);
    expect(half.x + half.w / 2).toBeCloseTo(box.x + box.w / 2);
    expect(half.y + half.h / 2).toBeCloseTo(box.y + box.h / 2);
    expect(resizeCrop(box, 0.01, 1179, 2556).w).toBeCloseTo(1179 * 0.2);
  });

  it("shrinks what is kept to its size limit and never enlarges it", () => {
    expect(fitWithin(1179, 663, 1280)).toEqual({ w: 1179, h: 663 });
    expect(fitWithin(1179, 2556, 1280)).toEqual({ w: 590, h: 1280 });
    expect(fitWithin(1920, 1080, 320)).toEqual({ w: 320, h: 180 });
  });

  it("takes only pictures from what was chosen or pasted", () => {
    const file = (name: string, type: string) => ({ name, type }) as File;
    expect(pictureFiles([file("a.png", "image/png"), file("notes.txt", "text/plain"), file("IMG_1.HEIC", "")]).map((f) => f.name)).toEqual(["a.png", "IMG_1.HEIC"]);
    expect(pictureFiles(null)).toEqual([]);
  });
});

describe("suggested idea titles", () => {
  it("keeps only titles that say plainly what the video is", () => {
    expect(titleProblems("Can You Beat Elden Ring Using Only Merchant Items?", "Elden Ring")).toEqual([]);
    expect(titleProblems("Honour Mode With Only 2 Characters in BG3 - Act 3", "Baldur's Gate 3")).toEqual([]);
    expect(titleProblems("This Changed Everything", "Elden Ring")).toContain("does not name the game");
    expect(titleProblems("I Tried Something INSANE in Elden Ring", "Elden Ring")).toEqual(["hides the challenge behind hype"]);
    // One word in capitals for emphasis is the owner's style; two or more shout.
    expect(titleProblems('Can Someone With "0 Hours" Get EVERY Achievement in Elden Ring?', "Elden Ring")).toEqual([]);
    expect(titleProblems("These NEWBIES Couldn't Handle RADAHN in Elden Ring", "Elden Ring")).toEqual(["shouts"]);
    expect(titleProblems("Elden Ring", "Elden Ring")).toContain("too short to say what the video is");
  });

  it("cleans titles and falls back to a clear alternative", () => {
    expect(cleanTitle(' "Can You Beat Cuphead With 1 HP? \u{1F525} #shorts #cuphead" ')).toBe("Can You Beat Cuphead With 1 HP?");
    expect(pickTitle(["This Changed Everything", "Elden Ring But Every Boss Is Doubled", "Elden Ring Bosses Doubled, Can I Win?"], "Elden Ring"))
      .toEqual({ title: "Elden Ring But Every Boss Is Doubled", others: ["Elden Ring Bosses Doubled, Can I Win?"] });
    expect(pickTitle(["This Changed Everything"], "Elden Ring")).toBeNull();
  });

  it("knows a repeat however it is worded, but not the next part of a series", () => {
    expect(isRepeat("Can You Beat Elden Ring Using Only Merchant Items", ["Can You Beat Elden Ring Using Only Merchant Items?"])).toBe(true);
    expect(isRepeat("Elden Ring But I Only Use Merchant Items", ["Can You Beat Elden Ring Using Only Merchant Items?"])).toBe(true);
    expect(isRepeat("Honour Mode But I Only Use 2 Characters - Act 3", ["Honour Mode But I Only Use 2 Characters - Act 2"])).toBe(false);
    expect(likeness("Cuphead With Only 1 HP", "Elden Ring Without Dodging")).toBe(0);
  });

  it("spells the game the way the owner does", () => {
    expect(matchGame("elden ring", ["Elden Ring", "Cuphead"])).toBe("Elden Ring");
    expect(matchGame("Baldur's Gate", ["Baldur's Gate 3"])).toBe("Baldur's Gate 3");
    expect(matchGame("Minecraft", ["Elden Ring"])).toBeNull();
  });
});

describe("upload rhythm", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const at = (daysAgo: number, content_type: "long" | "short" | "live", privacy = "public") =>
    ({ id: `${content_type}-${daysAgo}`, content_type, privacy, published_at: new Date(now - daysAgo * 86_400_000).toISOString() }) as unknown as Video;
  const videos = [at(76, "long"), at(90, "long"), at(110, "long"), at(130, "long"), at(3, "long", "private"), at(200, "short"), at(5, "live")];

  it("counts each format on its own, public uploads only", () => {
    expect(daysSince(videos, "long", now)).toBe(76);
    expect(daysSince(videos, "short", now)).toBe(200);
    expect(daysSince(videos, "live", now)).toBe(5);
    expect(daysSince([], "long", now)).toBeNull();
  });

  it("finds the usual gap from the last year, and none from too few uploads", () => {
    expect(usualGap(videos, "long", now)).toBe(20);
    expect(usualGap(videos, "short", now)).toBeNull();
  });

  it("says how a format stands against its target", () => {
    expect(rhythmStatus({ format: "long", every_days: 14, active: true }, videos, now)).toMatchObject({ since: 76, late: true, share: 1, words: "62 days past your target." });
    expect(rhythmStatus({ format: "live", every_days: 7, active: true }, videos, now)).toMatchObject({ since: 5, late: false, words: "Next one due in 2 days." });
    expect(targetChoices(20)).toEqual([3, 5, 7, 10, 14, 20, 21, 30]);
    expect(targetChoices(null)).toEqual([3, 5, 7, 10, 14, 21, 30]);
  });
});

describe("suggested ideas order", () => {
  const idea = (title: string, batch: string, made_by: "batch" | "follow_up" = "batch") =>
    ({ id: title, title, created_at: batch, suggested_at: batch, suggestion: { kind: "your_format", why: "", made_by, batch } }) as unknown as Idea;
  it("puts the newest batch on top and earlier ones below, newest first", () => {
    const week1 = [idea("a", "2026-11-05T10:00:00Z"), idea("b", "2026-11-05T10:00:00Z")];
    const week2 = [idea("c", "2026-11-12T10:00:00Z")];
    const latest = [idea("d", "2026-11-19T10:00:00Z"), idea("e", "2026-11-19T10:00:00Z")];
    const { fresh, earlier } = splitByBatch([...week1, ...latest, ...week2]);
    expect(fresh.map((i) => i.title)).toEqual(["d", "e"]);
    expect(earlier.map((i) => i.title)).toEqual(["c", "a", "b"]);
  });

  it("keeps follow-ups that came after the newest batch on top, and older ones below", () => {
    const { fresh, earlier } = splitByBatch([
      idea("old follow-up", "2026-11-10T10:00:00Z", "follow_up"), idea("batch", "2026-11-12T10:00:00Z"), idea("new follow-up", "2026-11-14T10:00:00Z", "follow_up"),
    ]);
    expect(fresh.map((i) => i.title)).toEqual(["batch", "new follow-up"]);
    expect(earlier.map((i) => i.title)).toEqual(["old follow-up"]);
  });

  it("counts follow-ups written the same day as the newest batch as new", () => {
    const { fresh, earlier } = splitByBatch([idea("act 3", "2026-11-19T09:50:00Z", "follow_up"), idea("batch", "2026-11-19T10:00:00Z")]);
    expect(fresh.map((i) => i.title)).toEqual(["act 3", "batch"]);
    expect(earlier).toEqual([]);
  });

  it("shows only the batch just written when Give me more was tapped several times in a row", () => {
    const { fresh, earlier } = splitByBatch([
      idea("10:47", "2026-11-19T10:47:00Z"), idea("11:01", "2026-11-19T11:01:00Z"), idea("12:32 a", "2026-11-19T12:32:00Z"),
      idea("11:29", "2026-11-19T11:29:00Z"), idea("12:32 b", "2026-11-19T12:32:00Z"),
    ]);
    expect(fresh.map((i) => i.title)).toEqual(["12:32 a", "12:32 b"]);
    expect(earlier.map((i) => i.title)).toEqual(["11:29", "11:01", "10:47"]);
  });

  it("shows everything as new before the first batch", () => {
    expect(splitByBatch([idea("f", "2026-11-14T10:00:00Z", "follow_up")]).earlier).toEqual([]);
  });
});

describe("the owner's title length rule", () => {
  it("reads it from their own words", () => {
    expect(lengthRule(["- [ ] 45-55 characters"])).toEqual({ min: 45, max: 55 });
    expect(lengthRule(["One subject", "Keep it 45 to 55 characters long"])).toEqual({ min: 45, max: 55 });
    expect(lengthRule(["No rule about length here"])).toBeNull();
    expect(lengthRule(["90 to 20 characters"])).toBeNull();
  });
});

describe("ideas board order", () => {
  const idea = (sort_order: number, more: Partial<{ priority: number; picked_at: string | null; status: string }> = {}) =>
    ({ sort_order, priority: 2, picked_at: null, status: "idea", ...more });

  it("puts the newest idea first, after the ones being made and the owner's priority", () => {
    const old = idea(100), newer = idea(300), newest = idea(500), making = idea(50, { picked_at: "2026-11-01" }), low = idea(900, { priority: 3 });
    expect([old, low, newest, making, newer].sort(byNewest)).toEqual([making, newest, newer, old, low]);
  });

  it("keeps games in their usual order, most ideas first, ideas with no game last", () => {
    const groups = new Map([["Valheim", [idea(400)]], ["", [idea(999), idea(998), idea(997)]], ["Elden Ring", [idea(100), idea(200), idea(150)]]]);
    expect(orderSections(groups).map(([game]) => game)).toEqual(["Elden Ring", "Valheim", ""]);
  });
});

describe("side panel width", () => {
  it("grows the text with the panel, from 1x at the usual width up to 1.5x", async () => {
    const { drawerScale, DRAWER_DEFAULT } = await import("../src/components/ui.tsx");
    expect(drawerScale(DRAWER_DEFAULT)).toBe(1);
    expect(drawerScale(420)).toBe(1);
    expect(drawerScale(760)).toBe(1.25);
    expect(drawerScale(960)).toBe(1.5);
    expect(drawerScale(1600)).toBe(1.5);
  });
});

describe("line by line", () => {
  it("puts each sentence, and each shot direction in square brackets, on a line of its own", () => {
    expect(lineByLine("[First frame: Margit] This whole build came out of a shop. Every weapon. [Quick cuts.] Can a shopping list beat Elden Ring?"))
      .toBe("[First frame: Margit]\nThis whole build came out of a shop.\nEvery weapon.\n[Quick cuts.]\nCan a shopping list beat Elden Ring?");
  });

  it("keeps abbreviations, numbers and list items whole", () => {
    expect(sentences("Every bite from Mr. X stays. It is 1.5x harder vs. Bayle! Is it?")).toEqual(["Every bite from Mr. X stays.", "It is 1.5x harder vs. Bayle!", "Is it?"]);
    expect(lineByLine("- 0:00 Already a list. Two sentences.\n\nOne. Two.")).toBe("- 0:00 Already a list. Two sentences.\n\nOne.\nTwo.");
    expect(lineByLine("")).toBe("");
  });
});
