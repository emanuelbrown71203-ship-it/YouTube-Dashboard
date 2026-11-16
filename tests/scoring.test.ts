import { describe, expect, it } from "vitest";
import {
  analyzeKeyword, classifyFormat, keywordWords, median, outlierScore, parseIsoDuration, type PublicVideo,
  scoreOutlier, sortOutliers, titleMatches, typicalViews, viewsPerDay,
} from "../supabase/functions/yt-api/scoring.ts";
import { contentType, trafficGroup, yearRanges } from "../supabase/functions/yt-api/sync.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function video(over: Partial<PublicVideo> = {}): PublicVideo {
  return {
    id: "vid00000001", channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa", channel_title: "Some Channel", title: "A title",
    description: "", thumbnail_url: null, published_at: daysAgo(10), duration_s: 900, views: 1000, likes: 40,
    comments: 5, tags: [], is_live: false, privacy: "public", ...over,
  };
}

describe("basics", () => {
  it("takes the median of odd and even lists and ignores junk", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([Number.NaN, 7])).toBe(7);
  });

  it("reads YouTube durations", () => {
    expect(parseIsoDuration("PT15S")).toBe(15);
    expect(parseIsoDuration("PT21M16S")).toBe(1276);
    expect(parseIsoDuration("PT5H33M58S")).toBe(20038);
    expect(parseIsoDuration("P1DT2H")).toBe(93600);
    expect(parseIsoDuration("P0D")).toBe(0);
    expect(parseIsoDuration(undefined)).toBe(0);
    expect(parseIsoDuration("nonsense")).toBe(0);
  });

  it("never divides by a tiny age", () => {
    expect(viewsPerDay(1000, daysAgo(10), NOW)).toBeCloseTo(100, 5);
    expect(viewsPerDay(1000, daysAgo(0), NOW)).toBe(2000);
  });
});

describe("format", () => {
  const base = { id: "a", duration_s: 45, is_live: false };
  it("trusts YouTube's own tabs first", () => {
    expect(classifyFormat({ ...base, duration_s: 900 }, { shorts: new Set(["a"]) })).toEqual({ format: "short", source: "playlist" });
    expect(classifyFormat(base, { long: new Set(["a"]) })).toEqual({ format: "long", source: "playlist" });
    expect(classifyFormat(base, { live: new Set(["a"]) }).format).toBe("live");
  });
  it("falls back to what the video says about itself", () => {
    expect(classifyFormat(base).format).toBe("short");
    expect(classifyFormat({ ...base, is_live: true, duration_s: 9000 }).format).toBe("live");
    expect(classifyFormat({ ...base, duration_s: 120, title: "clip #shorts" }).format).toBe("short");
    expect(classifyFormat({ ...base, duration_s: 120 }).format).toBe("long");
    expect(classifyFormat({ ...base, duration_s: 0 }).format).toBe("long");
  });
});

describe("outlier score", () => {
  const recent = [100, 200, 300, 400, 500, 600].map((views, i) => ({ id: `r${i}`, views, published_at: daysAgo(20 + i) }));

  it("is the multiple of the channel's usual views", () => {
    expect(typicalViews(recent, { now: NOW })).toBe(350);
    expect(outlierScore(3500, 350)).toBe(10);
    expect(outlierScore(3500, null)).toBeNull();
  });

  it("leaves out the judged video and uploads too new to have settled", () => {
    expect(typicalViews(recent, { now: NOW, excludeId: "r5" })).toBe(300);
    const withFresh = [...recent, { id: "new", views: 9, published_at: daysAgo(0.5) }];
    expect(typicalViews(withFresh, { now: NOW })).toBe(350);
  });

  it("refuses to call anything usual with too few uploads", () => {
    expect(typicalViews(recent.slice(0, 4), { now: NOW })).toBeNull();
    expect(typicalViews(recent.slice(0, 5), { now: NOW, excludeId: "r0" })).toBeNull();
  });

  it("scores a video against its channel", () => {
    const item = scoreOutlier(
      video({ id: "r5", views: 6000, likes: 300, comments: 60, published_at: daysAgo(30) }), "long",
      { id: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "Chan", subscribers: 2000, subscribers_hidden: false }, recent, NOW,
    );
    expect(item.typical_views).toBe(300);
    expect(item.outlier_score).toBe(20);
    expect(item.views_per_day).toBe(200);
    expect(item.reach).toBe(3);
    expect(item.engagement_pct).toBe(6);
    expect(item.channel_title).toBe("Chan");
  });

  it("hides a hidden subscriber count instead of guessing", () => {
    const item = scoreOutlier(video(), "long", { id: "c", title: "C", subscribers: null, subscribers_hidden: true }, recent, NOW);
    expect(item.channel_subscribers).toBeNull();
    expect(item.reach).toBeNull();
  });

  it("sorts the biggest multiples first and unscored videos last", () => {
    const mk = (id: string, score: number | null, views: number) => ({ ...scoreOutlier(video({ id, views }), "long", undefined, [], NOW), outlier_score: score });
    expect(sortOutliers([mk("a", 2, 10), mk("b", null, 999), mk("c", 9, 5), mk("d", null, 5)]).map((i) => i.video_id)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("keywords", () => {
  it("keeps the words that carry meaning", () => {
    expect(keywordWords("How to beat  the Elden Ring DLC")).toEqual(["how", "beat", "elden", "ring", "dlc"]);
    expect(keywordWords("to the")).toEqual(["to", "the"]);
  });

  it("matches titles on whole words, forgiving a plural", () => {
    const words = keywordWords("elden ring challenge run");
    expect(titleMatches("Can You Beat ELDEN RING? A Challenge Run!", words)).toBe(true);
    expect(titleMatches("Elden Ring challenge runs ranked", words)).toBe(true);
    expect(titleMatches("Elden Ring boss guide", words)).toBe(false);
    expect(titleMatches("Sprung a leak", keywordWords("run"))).toBe(false);
  });

  const ranked = (subs: number, views: number, age: number, n = 10) =>
    Array.from({ length: n }, (_, i) => ({
      video: video({ id: `k${i}`, channel_id: `UCchannel${i}`, title: "elden ring challenge run", views, published_at: daysAgo(age) }),
      channel: { subscribers: subs, subscribers_hidden: false },
    }));

  it("rates a busy phrase held by small channels as a strong opportunity", () => {
    const a = analyzeKeyword("Elden Ring  Challenge Run", ranked(3000, 200_000, 100), { myChannelId: null, mySubscribers: 3880, now: NOW });
    expect(a.keyword).toBe("elden ring challenge run");
    expect(a.volume_score).toBe(83);
    expect(a.competition_score).toBe(37);
    expect(a.overall_score).toBe(73);
    expect(a.verdict).toBe("strong");
    expect(a.signals.small_channel_cutoff).toBe(11640);
    expect(a.signals.small_channel_share).toBe(1);
  });

  it("rates the same phrase held by huge channels as tough", () => {
    const a = analyzeKeyword("elden ring challenge run", ranked(5_000_000, 3000, 900), { myChannelId: null, mySubscribers: 3880, now: NOW });
    expect(a.competition_score).toBe(100);
    expect(a.verdict).toBe("tough");
    expect(a.overall_score).toBeLessThan(45);
  });

  it("finds my own video in the results", () => {
    const list = ranked(50_000, 10_000, 200);
    list[3].video.channel_id = "UCme";
    const a = analyzeKeyword("elden ring challenge run", list, { myChannelId: "UCme", mySubscribers: 3880, now: NOW });
    expect(a.my_rank).toBe(4);
    expect(a.my_video_id).toBe("k3");
    expect(a.results[3].mine).toBe(true);
  });

  it("gives no score when there is too little to go on", () => {
    const a = analyzeKeyword("zzz", ranked(1000, 10, 5, 2), { myChannelId: null, mySubscribers: null, now: NOW });
    expect(a.overall_score).toBeNull();
    expect(a.verdict).toBe("unknown");
  });
});

describe("sync helpers", () => {
  it("splits long histories into ranges of a year or less with no gaps", () => {
    const ranges = yearRanges("2023-07-01", "2026-11-16");
    expect(ranges[0][0]).toBe("2023-07-01");
    expect(ranges.at(-1)![1]).toBe("2026-11-16");
    for (let i = 1; i < ranges.length; i++) {
      expect(Date.parse(ranges[i][0]) - Date.parse(ranges[i - 1][1])).toBe(86_400_000);
    }
    expect(ranges.every(([a, b]) => (Date.parse(b) - Date.parse(a)) / 86_400_000 <= 364)).toBe(true);
    expect(yearRanges("2026-11-16", "2026-11-16")).toEqual([["2026-11-16", "2026-11-16"]]);
    expect(yearRanges("2026-11-17", "2026-11-16")).toEqual([]);
  });

  it("groups traffic sources and formats the way the app shows them", () => {
    expect(trafficGroup("YT_SEARCH")).toBe("search");
    expect(trafficGroup("RELATED_VIDEO")).toBe("suggested");
    expect(trafficGroup("SUBSCRIBER")).toBe("browse");
    expect(trafficGroup("SHORTS")).toBe("shorts_feed");
    expect(trafficGroup("SOMETHING_NEW")).toBe("other");
    expect(contentType("shorts")).toBe("short");
    expect(contentType("videoOnDemand")).toBe("long");
    expect(contentType("liveStream")).toBe("live");
    expect(contentType("story")).toBe("other");
  });
});
