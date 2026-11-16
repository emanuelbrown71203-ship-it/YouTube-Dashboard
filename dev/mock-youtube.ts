// A stand-in for Google's APIs (sign-in, YouTube Data, YouTube Analytics and
// search suggestions) that answers with made-up but realistically shaped data.
// Used by the test suite and by `npm run dev:local`; never deployed.
//
// Every channel and video here is invented. Numbers come from a seeded
// generator, so the same request always gets the same answer.

export const MY_CHANNEL_ID = "UChsuiSVwIF3O23DdjL907jg";

export interface MockOptions {
  now: () => Date;
  /** Which channel the "signed-in Google account" owns. */
  signedInChannelId?: string;
  /** Pretend the Analytics API does not know the engagedViews metric yet. */
  rejectEngagedViews?: boolean;
  /** Pretend the search-suggestion service is down. */
  suggestDown?: boolean;
  /** Scopes Google reports as granted. */
  grantedScopes?: string[];
}

interface MockVideo {
  id: string;
  channelId: string;
  title: string;
  publishedAt: string;
  durationS: number;
  kind: "short" | "long" | "live";
  views: number;
  likes: number;
  comments: number;
  tags: string[];
}

interface MockChannel {
  id: string;
  title: string;
  handle: string;
  subscribers: number;
  hidden?: boolean;
  country: string;
  publishedAt: string;
  videos: MockVideo[];
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function makeId(rand: () => number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

const GAMES = ["Elden Ring", "Cuphead", "Baldur's Gate 3", "Hollow Knight", "Dark Souls 3", "Sekiro"];
const LONG_TITLES = [
  "Can You Beat {g} With Only {x}?", "I Beat {g} Without {y}", "{g} But Every Boss Is Randomised",
  "Can You Beat {g} At Level 1?", "{g} Challenge Run: No Healing Allowed", "I Tried The Hardest {g} Challenge",
  "How I Broke {g} In 37 Minutes", "{g} But I Can't Dodge",
];
const SHORT_TITLES = [
  "This {g} boss did WHAT?!", "POV: first time playing {g}", "{g} players know this pain",
  "The worst way to lose in {g}", "I was NOT ready for this {g} boss",
];
const XS = ["Kicks", "A Shield", "Starting Gear", "Parries", "Magic", "One Weapon"];
const YS = ["Taking Damage", "Levelling Up", "Dodging", "Dying", "Armor"];
const NAMES = [
  "Hollow Tarnished", "NoHit Nyx", "Parry Pilgrim", "Bonfire Bard", "Glass Cannon Gus", "Deathless Dee", "Mug Runner",
  "Critical Miss Club", "Lore And Order", "Estus Break", "Souls On Toast", "Half Party Heroes", "Soft Lock Sam",
  "Frame Perfect Flo",
];

export function buildUniverse(now: Date): MockChannel[] {
  const rand = rng(20261116);
  const day = 86_400_000;
  const channels: MockChannel[] = [];
  const sizes = [3880, 1200, 4300, 8900, 15400, 22000, 38000, 61000, 97000, 152000, 240000, 510000, 890000, 1700000, 2600000];
  sizes.forEach((subs, index) => {
    const mine = index === 0;
    const id = mine ? MY_CHANNEL_ID : `UC${makeId(rand, 22)}`;
    const title = mine ? "TheRealZay2K" : NAMES[index - 1];
    const base = Math.max(120, subs * (0.04 + rand() * 0.18));
    const videos: MockVideo[] = [];
    const make = (kind: MockVideo["kind"], count: number, typical: number, everyDays: number) => {
      for (let i = 0; i < count; i++) {
        const game = GAMES[Math.floor(rand() * GAMES.length)];
        const template = kind === "short"
          ? SHORT_TITLES[Math.floor(rand() * SHORT_TITLES.length)]
          : LONG_TITLES[Math.floor(rand() * LONG_TITLES.length)];
        const name = template.replace("{g}", game).replace("{x}", XS[Math.floor(rand() * XS.length)]).replace("{y}", YS[Math.floor(rand() * YS.length)]);
        const age = 3 + i * everyDays + rand() * everyDays * 0.6;
        const breakout = rand() < 0.09 ? 5 + rand() * 30 : 1;
        const views = Math.round(typical * (0.35 + rand() * 1.4) * breakout);
        videos.push({
          id: makeId(rand, 11),
          channelId: id,
          title: kind === "live" ? `LIVE: ${name}` : name,
          publishedAt: new Date(now.getTime() - age * day).toISOString(),
          durationS: kind === "short" ? 12 + Math.floor(rand() * 45) : kind === "live" ? 5400 + Math.floor(rand() * 9000) : 600 + Math.floor(rand() * 2400),
          kind,
          views,
          likes: Math.round(views * (0.02 + rand() * 0.04)),
          comments: Math.round(views * (0.001 + rand() * 0.004)),
          tags: kind === "short" ? [] : [game.toLowerCase(), `${game.toLowerCase()} challenge run`, "challenge run"],
        });
      }
    };
    make("long", mine ? 14 : 18 + Math.floor(rand() * 20), base, mine ? 21 : 9);
    make("short", mine ? 40 : 10 + Math.floor(rand() * 30), base * 2.2, mine ? 6 : 5);
    make("live", mine ? 12 : Math.floor(rand() * 5), base * 0.25, 30);
    channels.push({
      id, title, handle: mine ? "@therealzay2k" : `@${title.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      subscribers: subs, hidden: index === 6, country: "US",
      publishedAt: new Date(now.getTime() - (900 + index * 120) * day).toISOString(), videos,
    });
  });
  return channels;
}

function isoDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function apiError(status: number, reason: string, message: string): Response {
  return json({ error: { code: status, message, errors: [{ reason, message, domain: "youtube" }] } }, status);
}

export function createMockGoogle(options: MockOptions): { fetch: typeof fetch; universe: MockChannel[]; calls: string[] } {
  const universe = buildUniverse(options.now());
  const allVideos = universe.flatMap((c) => c.videos);
  const videoById = new Map(allVideos.map((v) => [v.id, v]));
  const channelById = new Map(universe.map((c) => [c.id, c]));
  const calls: string[] = [];
  const signedIn = () => options.signedInChannelId ?? MY_CHANNEL_ID;

  const channelResource = (c: MockChannel) => ({
    kind: "youtube#channel",
    id: c.id,
    snippet: {
      title: c.title, description: "", customUrl: c.handle, publishedAt: c.publishedAt, country: c.country,
      thumbnails: { default: { url: `https://example.invalid/avatar/${c.id}.jpg` } },
    },
    statistics: {
      viewCount: String(c.videos.reduce((n, v) => n + v.views, 0)),
      subscriberCount: c.hidden ? undefined : String(c.subscribers),
      hiddenSubscriberCount: Boolean(c.hidden),
      videoCount: String(c.videos.length),
    },
    contentDetails: { relatedPlaylists: { uploads: `UU${c.id.slice(2)}` } },
  });

  const videoResource = (v: MockVideo) => ({
    kind: "youtube#video",
    id: v.id,
    snippet: {
      title: v.title, description: v.kind === "short" ? "#shorts" : "Made-up description for local testing.",
      publishedAt: v.publishedAt, channelId: v.channelId, channelTitle: channelById.get(v.channelId)!.title,
      tags: v.tags.length ? v.tags : undefined, liveBroadcastContent: "none",
      thumbnails: { medium: { url: `https://example.invalid/thumb/${v.id}.jpg` } },
    },
    statistics: { viewCount: String(v.views), likeCount: String(v.likes), commentCount: String(v.comments) },
    contentDetails: { duration: isoDuration(v.durationS) },
    status: { privacyStatus: "public", uploadStatus: "processed" },
    ...(v.kind === "live" ? { liveStreamingDetails: { actualStartTime: v.publishedAt } } : {}),
  });

  function dataApi(path: string, q: URLSearchParams): Response {
    if (path === "channels") {
      let found: MockChannel[] = [];
      if (q.get("mine") === "true") found = [channelById.get(signedIn())].filter((c): c is MockChannel => Boolean(c));
      else if (q.get("forHandle")) {
        const handle = q.get("forHandle")!.replace(/^@?/, "@").toLowerCase();
        found = universe.filter((c) => c.handle === handle);
      } else found = (q.get("id") ?? "").split(",").map((id) => channelById.get(id)).filter((c): c is MockChannel => Boolean(c));
      return json({ kind: "youtube#channelListResponse", items: found.map(channelResource) });
    }
    if (path === "playlistItems") {
      const playlist = q.get("playlistId") ?? "";
      const match = /^(UUSH|UULF|UULV|UU)(.{22})$/.exec(playlist);
      const channel = match ? channelById.get(`UC${match[2]}`) : undefined;
      if (!match || !channel) return apiError(404, "playlistNotFound", "The playlist identified with the request's playlistId parameter cannot be found.");
      const kind = { UUSH: "short", UULF: "long", UULV: "live", UU: null }[match[1]];
      const list = channel.videos.filter((v) => !kind || v.kind === kind).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
      if (kind && list.length === 0) return apiError(404, "playlistNotFound", "The playlist cannot be found.");
      const offset = Number(q.get("pageToken") ?? 0);
      const size = Number(q.get("maxResults") ?? 5);
      const page = list.slice(offset, offset + size);
      return json({
        items: page.map((v) => ({ contentDetails: { videoId: v.id, videoPublishedAt: v.publishedAt } })),
        nextPageToken: offset + size < list.length ? String(offset + size) : undefined,
      });
    }
    if (path === "videos") {
      const ids = (q.get("id") ?? "").split(",");
      return json({ items: ids.map((id) => videoById.get(id)).filter((v): v is MockVideo => Boolean(v)).map(videoResource) });
    }
    if (path === "search") {
      const words = (q.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      if (q.get("type") === "channel") {
        const hits = universe.filter((c) => words.some((w) => c.title.toLowerCase().includes(w)));
        return json({ items: hits.slice(0, Number(q.get("maxResults") ?? 5)).map((c) => ({ id: { kind: "youtube#channel", channelId: c.id } })) });
      }
      const score = (v: MockVideo) => words.filter((w) => v.title.toLowerCase().includes(w)).length;
      let hits = allVideos.filter((v) => score(v) > 0);
      const after = q.get("publishedAfter"), before = q.get("publishedBefore"), length = q.get("videoDuration");
      if (after) hits = hits.filter((v) => v.publishedAt >= after);
      if (before) hits = hits.filter((v) => v.publishedAt <= before);
      if (length === "short") hits = hits.filter((v) => v.durationS < 240);
      if (length === "medium") hits = hits.filter((v) => v.durationS >= 240 && v.durationS <= 1200);
      if (length === "long") hits = hits.filter((v) => v.durationS > 1200);
      const order = q.get("order") ?? "relevance";
      hits.sort((a, b) =>
        order === "viewCount" ? b.views - a.views
          : order === "date" ? b.publishedAt.localeCompare(a.publishedAt)
          : score(b) - score(a) || b.views - a.views);
      const offset = Number(q.get("pageToken") ?? 0);
      const size = Number(q.get("maxResults") ?? 5);
      return json({
        items: hits.slice(offset, offset + size).map((v) => ({ id: { kind: "youtube#video", videoId: v.id } })),
        nextPageToken: offset + size < hits.length ? String(offset + size) : undefined,
        pageInfo: { totalResults: hits.length },
      });
    }
    return apiError(404, "notFound", "Unknown mock endpoint.");
  }

  function analyticsApi(q: URLSearchParams): Response {
    const metrics = (q.get("metrics") ?? "").split(",");
    const dims = (q.get("dimensions") ?? "").split(",").filter(Boolean);
    if (options.rejectEngagedViews && metrics.includes("engagedViews")) {
      return apiError(400, "badRequest", "Unknown identifier (engagedViews) given in field parameters.metrics.");
    }
    const me = channelById.get(signedIn());
    if (!me) return apiError(403, "forbidden", "Forbidden");
    const headers = [...dims, ...metrics].map((name) => ({ name }));
    const videoFilter = /video==([\w-]{11})/.exec(q.get("filters") ?? "")?.[1];
    const lastDay = new Date(options.now().getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    const start = q.get("startDate") ?? lastDay;
    const end = (q.get("endDate") ?? lastDay) < lastDay ? q.get("endDate")! : lastDay;
    const days: string[] = [];
    for (let d = start; d <= end; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) days.push(d);
    const value = (seed: string, metric: string, scale: number): number => {
      let h = 2166136261;
      for (const ch of seed + metric) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      const unit = ((h >>> 0) % 1000) / 1000;
      switch (metric) {
        case "views": return Math.round(scale * (0.6 + unit));
        case "engagedViews": return Math.round(scale * (0.25 + unit * 0.3));
        case "estimatedMinutesWatched": return Math.round(scale * (0.1 + unit * 0.2));
        case "averageViewDuration": return Math.round(15 + unit * 60);
        case "averageViewPercentage": return Math.round((20 + unit * 90) * 100) / 100;
        case "subscribersGained": return Math.round(unit * 3);
        case "subscribersLost": return Math.round(unit * 1.4);
        case "viewerPercentage": return Math.round(unit * 2000) / 100;
        case "estimatedRevenue": return Math.round(scale * (0.2 + unit) * 0.3) / 100;
        default: return Math.round(unit * 6);
      }
    };
    let rows: (string | number)[][] = [];
    const key = dims.join(",");
    if (key === "day") {
      rows = days.map((d) => [d, ...metrics.map((m) => value(d + (videoFilter ?? ""), m, videoFilter ? 40 : 300))]);
    } else if (key === "day,creatorContentType") {
      rows = days.flatMap((d) => [
        [d, "shorts", ...metrics.map((m) => value(d + "s", m, 280))],
        ...(value(d, "x", 1) > 2 ? [[d, "videoOnDemand", ...metrics.map((m) => value(d + "v", m, 18))]] : []),
        ...(value(d, "y", 1) > 4 ? [[d, "liveStream", ...metrics.map((m) => value(d + "l", m, 4))]] : []),
      ]);
    } else if (key === "video") {
      // Like the real API: the "top videos" list stops at 200 and cannot be paged;
      // anything past it has to be asked for by id.
      const wanted = /video==([\w,-]+)/.exec(q.get("filters") ?? "")?.[1]?.split(",");
      if (!wanted && Number(q.get("startIndex") ?? 1) > 1) {
        return apiError(400, "badRequest", "The query is not supported.");
      }
      const sorted = [...me.videos].sort((a, b) => b.views - a.views);
      const picked = wanted
        ? sorted.filter((v) => wanted.includes(v.id))
        : sorted.slice(0, Math.min(200, Number(q.get("maxResults") ?? 10)));
      rows = picked.map((v) => [
        v.id, ...metrics.map((m) => (m === "views" ? v.views : value(v.id, m, v.views))),
      ]);
    } else if (key === "insightTrafficSourceType") {
      const types = ["SHORTS", "SUBSCRIBER", "RELATED_VIDEO", "YT_SEARCH", "YT_CHANNEL", "EXT_URL", "NO_LINK_OTHER", "PLAYLIST"];
      const searchLed = videoFilter ? value(videoFilter, "lead", 1) > 3 : false;
      rows = types.map((t) => [t, ...metrics.map((m) => value((videoFilter ?? "") + t, m, t === "YT_SEARCH" && searchLed ? 4000 : t === "SHORTS" ? 900 : 120))]);
      rows.sort((a, b) => Number(b[1]) - Number(a[1]));
    } else if (key === "country") {
      rows = ["US", "GB", "CA", "AU", "DE", "BR", "PH"].map((c, i) => [c, ...metrics.map((m) => value(c, m, 2400 / (i + 1)))]);
    } else if (key === "ageGroup,gender") {
      rows = ["age13-17", "age18-24", "age25-34", "age35-44"].flatMap((a) => ["male", "female"].map((g) => [a, g, value(a + g, "viewerPercentage", 1)]));
    } else if (key === "deviceType") {
      rows = ["MOBILE", "DESKTOP", "TV", "TABLET"].map((d, i) => [d, ...metrics.map((m) => value(d, m, 3000 / (i + 1)))]);
    } else {
      return apiError(400, "badRequest", `The mock does not know the report "${key}".`);
    }
    return json({ kind: "youtubeAnalytics#resultTable", columnHeaders: headers, rows });
  }

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
      const body = new URLSearchParams(String(init?.body ?? ""));
      if (body.get("refresh_token") === "revoked" || body.get("code") === "bad-code") {
        return json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      }
      return json({
        access_token: `mock-access-${Date.now()}`, expires_in: 3599, token_type: "Bearer",
        scope: (options.grantedScopes ?? [
          "https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly",
          "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
        ]).join(" "),
        ...(body.get("grant_type") === "authorization_code" ? { refresh_token: "mock-refresh-token" } : {}),
      });
    }
    if (url.host === "oauth2.googleapis.com" && url.pathname === "/revoke") return json({});
    if (url.host === "www.googleapis.com" && url.pathname.startsWith("/youtube/v3/")) {
      return dataApi(url.pathname.slice("/youtube/v3/".length), url.searchParams);
    }
    if (url.host === "youtubeanalytics.googleapis.com") return analyticsApi(url.searchParams);
    if (url.host === "suggestqueries.google.com") {
      if (options.suggestDown) return new Response("unavailable", { status: 503 });
      const q = url.searchParams.get("q") ?? "";
      const tails = ["challenge run", "no hit run", "level 1", "all bosses", "speedrun", "dlc", "randomizer", "tips"];
      const last = q.split(" ").pop() ?? "";
      const list = q.includes(" ") && last.length === 1
        ? tails.filter((t) => t.startsWith(last)).map((t) => `${q.slice(0, -2)} ${t}`)
        : tails.slice(0, 6).map((t) => `${q} ${t}`);
      return json([q, list]);
    }
    return new Response("not mocked", { status: 404 });
  };

  return { fetch: mockFetch as typeof fetch, universe, calls };
}
