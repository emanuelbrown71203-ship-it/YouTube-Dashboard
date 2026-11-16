// End-to-end tests of the edge function's logic against a real local Postgres
// (the repo's own migrations) and a made-up YouTube. Skipped when no local
// Postgres is reachable; see dev/README.md.

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockGoogle, MY_CHANNEL_ID, type MockOptions } from "../dev/mock-youtube.ts";
import { resetDatabase } from "../dev/reset-db.ts";
import { handle, postgresTypes, sha256Hex } from "../supabase/functions/yt-api/app.ts";
import type { Deps } from "../supabase/functions/yt-api/google.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const NEWCOMER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const BASE = "https://project.supabase.co/functions/v1/yt-api";
const APP = "http://localhost:5173";

let dbUrl: string | null = null;
try {
  dbUrl = await resetDatabase("yttest");
} catch {
  dbUrl = null;
}

describe.skipIf(!dbUrl)("yt-api against a local database", () => {
  // deno-lint-ignore no-explicit-any
  let sql: any;

  function setup(options: Partial<MockOptions> = {}) {
    const now = () => new Date();
    const mock = createMockGoogle({ now, ...options });
    const background: Promise<unknown>[] = [];
    const deps: Deps = {
      sql,
      fetch: mock.fetch,
      now,
      functionUrl: BASE,
      verifyUser: async (token) => (token.startsWith("user:") ? token.slice(5) : null),
      background: (work) => void background.push(work),
      log: () => {},
    };
    const call = async (method: string, path: string, opts: { user?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
      const res = await handle(
        new Request(`${BASE}${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            ...(opts.user ? { authorization: `Bearer user:${opts.user}` } : {}),
            ...opts.headers,
          },
          body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
        }),
        deps,
      );
      const text = await res.text();
      // deno-lint-ignore no-explicit-any
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data, location: res.headers.get("location") };
    };
    return { deps, mock, background, call };
  }

  const startBody = async (secret: string, returnTo = APP) => ({ return_to: returnTo, challenge: await sha256Hex(secret) });

  beforeAll(async () => {
    sql = postgres(dbUrl!, { max: 4, prepare: false, types: postgresTypes, onnotice: () => {} });
    await sql`insert into public.yt_owners (user_id, method) values (${OWNER}, 'access_code')`;
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("answers the health check and unknown routes", async () => {
    const { call } = setup();
    expect((await call("GET", "/health")).data).toEqual({ ok: true });
    expect((await call("GET", "/nope")).status).toBe(404);
    expect((await call("POST", "/nope", { user: OWNER })).status).toBe(404);
  });

  it("keeps strangers and signed-out callers away from everything", async () => {
    const { call } = setup();
    for (const path of ["/research", "/sync", "/auth/setup", "/auth/disconnect"]) {
      expect((await call("POST", path)).status, path).toBe(401);
      expect((await call("POST", path, { user: STRANGER })).status, path).toBe(403);
    }
    expect((await call("POST", "/sync", { headers: { "x-cron-secret": "wrong" } })).status).toBe(401);
  });

  it("refuses research and sync until YouTube is connected", async () => {
    const { call } = setup();
    const res = await call("POST", "/research", { user: OWNER, body: { action: "outliers", query: "elden ring" } });
    expect(res.status).toBe(409);
    expect(res.data.code).toBe("not_configured");
    expect((await call("POST", "/sync", { user: OWNER })).data.status).toBe("skipped");
    expect((await call("POST", "/auth/start", { user: NEWCOMER, body: { return_to: APP } })).data.code).toBe("not_configured");
  });

  it("validates the Google client details", async () => {
    const { call } = setup();
    const bad = await call("POST", "/auth/setup", { user: OWNER, body: { client_id: "nope", client_secret: "GOCSPX-abcdefghijkl" } });
    expect(bad.status).toBe(400);
    expect(bad.data.code).toBe("bad_client_id");
    const short = await call("POST", "/auth/setup", { user: OWNER, body: { client_id: "1-a.apps.googleusercontent.com", client_secret: "x" } });
    expect(short.data.code).toBe("bad_client_secret");
    const ok = await call("POST", "/auth/setup", {
      user: OWNER, body: { client_id: " 123-abc.apps.googleusercontent.com ", client_secret: "GOCSPX-abcdefghijkl" },
    });
    expect(ok.data).toEqual({ ok: true, redirect_uri: `${BASE}/auth/callback` });
  });

  it("only starts sign-in for web addresses on the allowed list, from a browser holding a secret", async () => {
    const { call } = setup();
    const evil = await call("POST", "/auth/start", { user: NEWCOMER, body: await startBody("s", "https://evil.example/app") });
    expect(evil.status).toBe(400);
    expect(evil.data.code).toBe("origin_not_allowed");
    expect((await call("POST", "/auth/start", { user: NEWCOMER, body: { return_to: APP } })).status).toBe(400);
    expect((await call("POST", "/auth/start", { user: NEWCOMER, body: { return_to: APP, challenge: "short" } })).status).toBe(400);
    const ok = await call("POST", "/auth/start", { user: NEWCOMER, body: await startBody("s", `${APP}/#/settings`) });
    const url = new URL(ok.data.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/auth/callback`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("yt-analytics.readonly");
    expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("turns away a Google account that owns a different channel", async () => {
    const other = setup();
    const impostor = setup({ signedInChannelId: other.mock.universe[3].id });
    const start = await impostor.call("POST", "/auth/start", { user: STRANGER, body: await startBody("impostor") });
    const state = new URL(start.data.url).searchParams.get("state");
    const res = await impostor.call("GET", `/auth/callback?state=${state}&code=good-code`);
    expect(res.status).toBe(302);
    expect(res.location).toContain(`${APP}/#/?google=wrong`);
    const [row] = await sql`select 1 as ok from public.yt_owners where user_id = ${STRANGER}`;
    expect(row).toBeUndefined();
    const [token] = await sql`select value from public.yt_private where key = 'google_refresh_token'`;
    expect(token).toBeUndefined();
  });

  it("requires both YouTube permissions to be ticked", async () => {
    const partial = setup({ grantedScopes: ["https://www.googleapis.com/auth/youtube.readonly"] });
    const start = await partial.call("POST", "/auth/start", { user: STRANGER, body: await startBody("partial") });
    const state = new URL(start.data.url).searchParams.get("state");
    expect((await partial.call("GET", `/auth/callback?state=${state}&code=good-code`)).location).toContain("google=scopes");
  });

  it("cannot be used to sign in a browser other than the one the owner is sitting at", async () => {
    // A stranger starts a sign-in and tricks the real owner into approving it at Google.
    const { call, background } = setup();
    const start = await call("POST", "/auth/start", { user: STRANGER, body: await startBody("stranger-secret") });
    const state = new URL(start.data.url).searchParams.get("state");
    const res = await call("GET", `/auth/callback?state=${state}&code=good-code`);
    const grant = new URL(res.location!.replace("/#/?", "/?")).searchParams.get("grant")!;
    expect(grant).toMatch(/^[0-9a-f]{64}$/);

    // Google approving is not enough: nobody is an owner yet.
    const [afterGoogle] = await sql`select 1 as ok from public.yt_owners where user_id = ${STRANGER}`;
    expect(afterGoogle).toBeUndefined();
    // The grant lands in the owner's browser, which never had the stranger's secret...
    expect((await call("POST", "/auth/finish", { user: NEWCOMER, body: { grant, verifier: "stranger-secret" } })).status).toBe(403);
    expect((await call("POST", "/auth/finish", { user: NEWCOMER, body: { grant, verifier: "a-guess" } })).status).toBe(403);
    // ...and the stranger has the secret but never sees the grant.
    const guess = await call("POST", "/auth/finish", { user: STRANGER, body: { grant: "0".repeat(64), verifier: "stranger-secret" } });
    expect(guess.status).toBe(403);
    expect(guess.data.code).toBe("not_this_browser");
    expect((await call("POST", "/auth/finish", { user: STRANGER, body: {} })).status).toBe(403);
    expect((await call("POST", "/auth/finish", { body: { grant, verifier: "stranger-secret" } })).status).toBe(401);
    const [{ n }] = await sql`select count(*)::int as n from public.yt_owners where method = 'google'`;
    expect(n).toBe(0);
    // The owner did approve, so the channel is now connected and syncing, but only for people already let in.
    await background[0];
    expect((await call("POST", "/research", { user: STRANGER, body: { action: "outliers", query: "elden ring" } })).status).toBe(403);
    expect((await call("POST", "/sync", { user: STRANGER })).status).toBe(403);
  });

  it("lets the channel owner in through Google, once per sign-in link, and runs the first sync", async () => {
    const { call, background } = setup();
    const start = await call("POST", "/auth/start", { user: NEWCOMER, body: await startBody("owner-secret") });
    const state = new URL(start.data.url).searchParams.get("state");

    const denied = setup();
    const startDenied = await denied.call("POST", "/auth/start", { user: NEWCOMER, body: await startBody("other") });
    const deniedState = new URL(startDenied.data.url).searchParams.get("state");
    expect((await denied.call("GET", `/auth/callback?state=${deniedState}&error=access_denied`)).location).toContain("google=denied");

    const res = await call("GET", `/auth/callback?state=${state}&code=good-code`);
    expect(res.status).toBe(302);
    expect(res.location).toMatch(new RegExp(`^${APP}/#/\\?google=verify&grant=[0-9a-f]{64}$`));
    const grant = res.location!.split("grant=")[1];
    expect((await call("GET", `/auth/callback?state=${state}&code=good-code`)).status).toBe(400);
    expect((await call("GET", "/auth/callback?state=made-up&code=x")).status).toBe(400);

    expect((await call("POST", "/auth/finish", { user: NEWCOMER, body: { grant, verifier: "wrong-secret" } })).status).toBe(403);
    const finish = await call("POST", "/auth/finish", { user: NEWCOMER, body: { grant, verifier: "owner-secret", device: "Test phone" } });
    expect(finish.data).toEqual({ ok: true });
    expect((await call("POST", "/auth/finish", { user: NEWCOMER, body: { grant, verifier: "owner-secret" } })).status).toBe(403);
    const [owner] = await sql`select method, device, revoked_at from public.yt_owners where user_id = ${NEWCOMER}`;
    expect(owner).toMatchObject({ method: "google", device: "Test phone", revoked_at: null });

    expect(background).toHaveLength(1);
    await background[0];
    const [run] = await sql`select source, status, summary, error from public.yt_sync_runs order by id desc limit 1`;
    expect(run.error).toBeNull();
    expect(run.summary.steps).toMatchObject({
      channel: { ok: true }, videos: { ok: true }, daily: { ok: true }, formats: { ok: true }, video_analytics: { ok: true },
      recent_uploads: { ok: true }, reports: { ok: true }, traffic: { ok: true }, watched_channels: { ok: true },
    });
    expect(run).toMatchObject({ source: "connect", status: "ok" });
    expect(run.summary.history).toBe(true);
  });

  it("stores the channel, every upload with the right format, and the Studio numbers", async () => {
    const { mock } = setup();
    const me = mock.universe.find((c) => c.id === MY_CHANNEL_ID)!;
    const [channel] = await sql`select id, title, handle, subscribers, videos, uploads_playlist_id from public.yt_channel`;
    expect(channel).toMatchObject({ id: MY_CHANNEL_ID, title: "TheRealZay2K", handle: "@therealzay2k", subscribers: 3880, videos: me.videos.length });

    const formats = await sql`select content_type, count(*)::int as n from public.yt_videos group by 1 order by 1`;
    const expected = (kind: string) => me.videos.filter((v) => v.kind === kind).length;
    expect(formats).toEqual([
      { content_type: "live", n: expected("live") }, { content_type: "long", n: expected("long") }, { content_type: "short", n: expected("short") },
    ]);
    const [sources] = await sql`select count(*) filter (where content_type_source = 'playlist')::int as by_tab, count(*)::int as total from public.yt_videos`;
    expect(sources.by_tab).toBe(sources.total);

    const [sample] = await sql`
      select v.views, v.tags, v.minutes_watched, v.avg_view_pct, v.traffic, v.duration_s
      from public.yt_videos v where content_type = 'long' and traffic is not null limit 1`;
    expect(sample.views).toBeGreaterThan(0);
    expect(sample.tags).toContain("challenge run");
    expect(sample.minutes_watched).toBeGreaterThanOrEqual(0);
    expect(sample.traffic.total).toBe(Object.entries(sample.traffic).filter(([k]) => k !== "total").reduce((n, [, v]) => n + Number(v), 0));

    const [daily] = await sql`select count(*)::int as days, min(date) as first, sum(views) as views, count(engaged_views)::int as engaged from public.yt_analytics_daily`;
    expect(daily.days).toBeGreaterThan(800);
    expect(daily.engaged).toBe(daily.days);
    const [types] = await sql`select count(distinct content_type)::int as n from public.yt_content_type_daily`;
    expect(types.n).toBe(3);
    const reports = await sql`select key, jsonb_array_length(data) as n from public.yt_reports order by key`;
    // deno-lint-ignore no-explicit-any
    expect(reports.map((r: any) => r.key)).toEqual(["demographics_28d", "devices_28d", "geography_28d", "top_videos_28d", "traffic_sources_28d"]);
    // deno-lint-ignore no-explicit-any
    expect(reports.every((r: any) => r.n > 0)).toBe(true);
    const [snap] = await sql`select count(*)::int as n from public.yt_video_daily`;
    expect(snap.n).toBe(me.videos.length);
    const [view] = await sql`select count(*)::int as n, count(discovery)::int as labelled from public.yt_v_videos`;
    expect(view.n).toBe(me.videos.length);
    expect(view.labelled).toBeGreaterThan(0);
  });

  it("syncs again on the scheduler's secret, keeps a manual format, and copes without engagedViews", async () => {
    const [{ id: manual }] = await sql`
      update public.yt_videos set content_type = 'long', content_type_source = 'manual'
       where id = (select id from public.yt_videos where content_type = 'short' limit 1) returning id`;
    const [{ value: secret }] = await sql`select value from public.yt_private where key = 'cron_secret'`;
    const { call, mock } = setup({ rejectEngagedViews: true });
    const res = await call("POST", "/sync", { headers: { "x-cron-secret": secret } });
    expect(res.data.status).toBe("ok");
    expect(res.data.summary.steps.daily.days).toBeLessThan(40);
    const [run] = await sql`select source from public.yt_sync_runs order by id desc limit 1`;
    expect(run.source).toBe("cron");
    const [kept] = await sql`select content_type, content_type_source from public.yt_videos where id = ${manual}`;
    expect(kept).toEqual({ content_type: "long", content_type_source: "manual" });
    const [daily] = await sql`select count(*)::int as days, count(engaged_views)::int as engaged from public.yt_analytics_daily`;
    expect(daily.engaged).toBe(daily.days);
    expect(mock.calls.filter((c) => c.includes("oauth2.googleapis.com/token"))).toHaveLength(0);
  });

  it("does the slow extras in a follow-up call that only the scheduler can make", async () => {
    const [{ value: secret }] = await sql`select value from public.yt_private where key = 'cron_secret'`;
    const [{ id: runId }] = await sql`select id from public.yt_sync_runs order by id desc limit 1`;
    const { call, deps } = setup();
    expect((await call("POST", "/sync/extras", { user: "user:nobody", body: { run_id: runId, hop: 0 } })).status).toBe(403);

    // Without an AI key the AI steps are skipped and only the feeders are fetched.
    const plain = await call("POST", "/sync/extras", { headers: { "x-cron-secret": secret }, body: { run_id: runId, hop: 0 } });
    expect(plain.data.status).toBe("ok");
    expect(plain.data.steps.games.skipped).toBeTruthy();
    expect(plain.data.steps.feeders.ok).toBe(true);

    // With a key, every video is put to the AI once: named ones change, the rest keep their guess.
    await sql`insert into public.yt_private (key, value) values ('anthropic_api_key', 'sk-ant-test') on conflict (key) do update set value = excluded.value`;
    deps.claude = async (_key, req) => {
      const list = JSON.parse(req.prompt.slice(req.prompt.indexOf("Videos:") + 7)) as { id: string }[];
      return { videos: list.map((v, i) => ({ id: v.id, topic: i % 2 ? "Elden Ring" : null })) };
    };
    const [{ n: before }] = await sql`select count(*)::int as n from public.yt_videos where coalesce(topic_source, 'guess') = 'guess'`;
    expect(before).toBeGreaterThan(0);
    const named = await call("POST", "/sync/extras", { headers: { "x-cron-secret": secret }, body: { run_id: runId, hop: 0 } });
    expect(named.data.steps.games.named).toBeGreaterThan(0);
    expect(named.data.steps.games.left).toBe(0);
    const [{ n: after }] = await sql`select count(*)::int as n from public.yt_videos where coalesce(topic_source, 'guess') = 'guess'`;
    expect(after).toBe(0);
    const [{ summary }] = await sql`select summary from public.yt_sync_runs where id = ${runId}`;
    expect(summary.steps.games.named).toBe(named.data.steps.games.named);
    expect(summary.steps.daily.ok).toBe(true);
    await sql`update public.yt_private set value = '' where key = 'anthropic_api_key'`;
  });

  it("ticks off a best-video goal when any video gets there", async () => {
    const [{ top }] = await sql`select max(views)::int as top from public.yt_videos where removed_at is null and privacy = 'public'`;
    const [reach] = await sql`insert into public.yt_goals (kind, title, target) values ('video_views', 'reachable', ${top}) returning id`;
    const [far] = await sql`insert into public.yt_goals (kind, title, target) values ('video_views', 'far', ${top * 10}) returning id`;
    // A goal for one kind of video ignores the others, however many views they have.
    const [{ kind, best }] = await sql`
      select content_type as kind, max(views)::int as best from public.yt_videos where removed_at is null and privacy = 'public'
      group by content_type order by 2 limit 1`;
    const [own] = await sql`insert into public.yt_goals (kind, title, target, format) values ('video_views', 'own kind', ${best + 1}, ${kind}) returning id`;
    const [{ value: secret }] = await sql`select value from public.yt_private where key = 'cron_secret'`;
    const { call } = setup();
    await sql`update public.yt_sync_runs set started_at = started_at - interval '10 minutes'`;
    expect((await call("POST", "/sync", { headers: { "x-cron-secret": secret } })).data.status).toBe("ok");
    const rows = await sql`select id, done_at from public.yt_goals where id in (${reach.id}, ${far.id}) order by target`;
    expect(rows[0].done_at).not.toBeNull();
    expect(rows[1].done_at).toBeNull();
    expect(top).toBeGreaterThan(best);
    const [mine] = await sql`select done_at from public.yt_goals where id = ${own.id}`;
    expect(mine.done_at).toBeNull();
    await sql`update public.yt_goals set trashed_at = now() where id = ${own.id}`;
    await sql`update public.yt_goals set trashed_at = now() where id in (${reach.id}, ${far.id})`;
  });

  it("marks uploads that vanished from the channel instead of losing them", async () => {
    await sql`insert into public.yt_videos (id, title, privacy, content_type, views) values ('goneVideo01', 'Old upload', 'public', 'long', 5)`;
    const { call } = setup();
    expect((await call("POST", "/sync", { user: OWNER })).data.status).toBe("ok");
    const [gone] = await sql`select removed_at from public.yt_videos where id = 'goneVideo01'`;
    expect(gone.removed_at).not.toBeNull();
    const [visible] = await sql`select count(*)::int as n from public.yt_v_videos where id = 'goneVideo01'`;
    expect(visible.n).toBe(0);
  });

  it("finds outliers, scores them against each channel's usual, and records the spend", async () => {
    const [{ units: before }] = await sql`select coalesce(sum(units), 0)::int as units from public.yt_quota_usage`;
    const { call } = setup();
    const res = await call("POST", "/research", {
      user: OWNER, body: { action: "outliers", query: "elden ring", format: "long", mode: "breakout", window_days: 365, min_views: 500 },
    });
    expect(res.status).toBe(200);
    const { items, summary, quota, run_id } = res.data;
    expect(items.length).toBeGreaterThan(5);
    // deno-lint-ignore no-explicit-any
    const scores = items.map((i: any) => i.outlier_score).filter((s: number | null) => s !== null);
    expect(scores.length).toBeGreaterThan(3);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // deno-lint-ignore no-explicit-any
    for (const item of items as any[]) {
      expect(item.format).toBe("long");
      expect(item.duration_s).toBeGreaterThan(180);
      expect(item.views).toBeGreaterThanOrEqual(500);
      expect(item.title.toLowerCase()).toMatch(/elden|ring/);
      if (item.outlier_score !== null) expect(item.outlier_score).toBeCloseTo(item.views / Math.max(item.typical_views, 1), 0);
    }
    expect(summary.units).toBeGreaterThanOrEqual(200);
    expect(quota.used_today).toBe(before + summary.units);
    const [{ units: after }] = await sql`select coalesce(sum(units), 0)::int as units from public.yt_quota_usage`;
    expect(after).toBe(quota.used_today);

    const [run] = await sql`select kind, query, params, jsonb_array_length(results) as n, quota_units from public.yt_research_runs where id = ${run_id}`;
    expect(run).toMatchObject({ kind: "outliers", query: "elden ring", n: items.length, quota_units: summary.units });
    expect(run.params.page_token).toBeUndefined();
    const [stored] = await sql`select count(*)::int as n from public.yt_research_videos`;
    expect(stored.n).toBe(items.length);

    // The same search again reuses the cached channel baselines, so it costs far less.
    const again = await call("POST", "/research", {
      user: OWNER, body: { action: "outliers", query: "elden ring", format: "long", mode: "breakout", window_days: 365, min_views: 500 },
    });
    expect(again.data.summary.units).toBeLessThan(summary.units);
    // deno-lint-ignore no-explicit-any
    expect(again.data.items.map((i: any) => i.video_id)).toEqual(items.map((i: any) => i.video_id));
  });

  it("finds Shorts outliers, filters by channel size, and remembers saved videos", async () => {
    const { call } = setup();
    const res = await call("POST", "/research", {
      user: OWNER, body: { action: "outliers", query: "boss", format: "short", window_days: 365, max_subs: 100000, min_views: 0 },
    });
    expect(res.status).toBe(200);
    expect(res.data.items.length).toBeGreaterThan(0);
    // deno-lint-ignore no-explicit-any
    for (const item of res.data.items as any[]) {
      expect(item.format).toBe("short");
      expect(item.duration_s).toBeLessThanOrEqual(180);
      expect(item.channel_subscribers).not.toBeNull();
      expect(item.channel_subscribers).toBeLessThanOrEqual(100000);
      expect(item.saved).toBe(false);
    }
    const first = res.data.items[0].video_id;
    await sql`update public.yt_research_videos set saved = true, saved_at = now() where id = ${first}`;
    const again = await call("POST", "/research", {
      user: OWNER, body: { action: "outliers", query: "boss", format: "short", window_days: 365, max_subs: 100000, min_views: 0 },
    });
    // deno-lint-ignore no-explicit-any
    expect(again.data.items.find((i: any) => i.video_id === first).saved).toBe(true);
    const [kept] = await sql`select saved from public.yt_research_videos where id = ${first}`;
    expect(kept.saved).toBe(true);
  });

  it("pages through older search results and rejects bad input", async () => {
    const { call } = setup();
    const body = { action: "outliers", query: "you", format: "long", mode: "evergreen", min_views: 0 };
    const first = await call("POST", "/research", { user: OWNER, body });
    expect(first.status).toBe(200);
    // deno-lint-ignore no-explicit-any
    for (const item of first.data.items as any[]) expect(item.age_days).toBeGreaterThanOrEqual(180);
    if (first.data.next_page_token) {
      const second = await call("POST", "/research", { user: OWNER, body: { ...body, page_token: first.data.next_page_token } });
      expect(second.status).toBe(200);
      // deno-lint-ignore no-explicit-any
      const ids = new Set(first.data.items.map((i: any) => i.video_id));
      // deno-lint-ignore no-explicit-any
      expect(second.data.items.some((i: any) => ids.has(i.video_id))).toBe(false);
    }
    expect((await call("POST", "/research", { user: OWNER, body: { action: "outliers", query: "x" } })).status).toBe(400);
    expect((await call("POST", "/research", { user: OWNER, body: { ...body, page_token: "garbage!" } })).status).toBe(400);
    expect((await call("POST", "/research", { user: OWNER, body: { action: "mystery" } })).status).toBe(400);
  });

  it("stops research before the daily budget runs out, leaving room for the sync", async () => {
    const [{ day }] = await sql`select public.yt_quota_day() as day`;
    const [{ units: real }] = await sql`select units from public.yt_quota_usage where day = ${day}`;
    await sql`update public.yt_quota_usage set units = 8950 where day = ${day}`;
    const { call } = setup();
    const res = await call("POST", "/research", { user: OWNER, body: { action: "keyword", keyword: "elden ring challenge run" } });
    expect(res.status).toBe(429);
    expect(res.data.code).toBe("quota");
    expect((await call("POST", "/sync", { user: OWNER })).data.status).toBe("ok");
    await sql`update public.yt_quota_usage set units = ${real} where day = ${day}`;
  });

  it("analyses a search phrase and keeps my saved flag across re-checks", async () => {
    const { call } = setup();
    const res = await call("POST", "/research", { user: OWNER, body: { action: "keyword", keyword: "  Elden Ring   Challenge Run " } });
    expect(res.status).toBe(200);
    const a = res.data;
    expect(a.keyword).toBe("elden ring challenge run");
    expect(a.results.length).toBeGreaterThan(5);
    expect(a.results.length).toBeLessThanOrEqual(25);
    for (const score of [a.volume_score, a.competition_score, a.overall_score]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(["strong", "decent", "tough"]).toContain(a.verdict);
    expect(a.saved).toBe(false);
    // deno-lint-ignore no-explicit-any
    expect(a.results.map((r: any) => r.rank)).toEqual(a.results.map((_: unknown, i: number) => i + 1));

    await sql`update public.yt_keywords set saved = true, saved_at = now() where keyword = ${a.keyword}`;
    const again = await call("POST", "/research", { user: OWNER, body: { action: "keyword", keyword: "elden ring challenge run" } });
    expect(again.data.saved).toBe(true);
    const [row] = await sql`select overall_score, my_rank, saved, signals from public.yt_keywords where keyword = ${a.keyword}`;
    expect(row.overall_score).toBe(again.data.overall_score);
    expect(row.saved).toBe(true);
    expect(row.signals.top_n).toBe(10);
    const [{ n }] = await sql`select count(*)::int as n from public.yt_keywords`;
    expect(n).toBe(1);
  });

  it("lists what people type into search, without spending budget or needing Google", async () => {
    const [{ units: before }] = await sql`select coalesce(sum(units), 0)::int as units from public.yt_quota_usage`;
    const { call, mock } = setup();
    const res = await call("POST", "/research", { user: OWNER, body: { action: "suggest", seed: "Elden Ring" } });
    expect(res.status).toBe(200);
    // deno-lint-ignore no-explicit-any
    const phrases = res.data.suggestions.map((s: any) => s.phrase);
    expect(phrases).toContain("elden ring challenge run");
    expect(phrases).toContain("elden ring randomizer");
    expect(new Set(phrases).size).toBe(phrases.length);
    expect(phrases).not.toContain("elden ring");
    // deno-lint-ignore no-explicit-any
    expect(res.data.suggestions.filter((s: any) => s.top).length).toBe(6);
    expect(mock.calls.every((c) => c.includes("suggestqueries.google.com"))).toBe(true);
    const [{ units: after }] = await sql`select coalesce(sum(units), 0)::int as units from public.yt_quota_usage`;
    expect(after).toBe(before);

    const down = setup({ suggestDown: true });
    const failed = await down.call("POST", "/research", { user: OWNER, body: { action: "suggest", seed: "elden ring" } });
    expect(failed.status).toBe(502);
    expect(failed.data.code).toBe("suggest_unavailable");
  });

  it("looks channels up by handle, link or name and puts them on the watch list", async () => {
    const { call, mock } = setup();
    const target = mock.universe[5];
    const byHandle = await call("POST", "/research", { user: OWNER, body: { action: "channel_lookup", input: `https://www.youtube.com/${target.handle}/videos` } });
    expect(byHandle.data.channels).toHaveLength(1);
    expect(byHandle.data.channels[0]).toMatchObject({ id: target.id, title: target.title, watched: false, subscribers: target.subscribers });
    const byId = await call("POST", "/research", { user: OWNER, body: { action: "channel_lookup", input: target.id } });
    expect(byId.data.channels[0].id).toBe(target.id);
    const byName = await call("POST", "/research", { user: OWNER, body: { action: "channel_lookup", input: target.title.split(" ")[0] } });
    // deno-lint-ignore no-explicit-any
    expect(byName.data.channels.map((c: any) => c.id)).toContain(target.id);
    expect((await call("POST", "/research", { user: OWNER, body: { action: "channel_lookup", input: " " } })).status).toBe(400);

    const watch = await call("POST", "/research", { user: OWNER, body: { action: "channel_watch", channel_id: target.id } });
    expect(watch.status).toBe(200);
    const row = watch.data.channel;
    expect(row.watched).toBe(true);
    expect(row.typical_long).toBeGreaterThan(0);
    expect(row.recent_long.length).toBeGreaterThan(4);
    expect(row.recent_long.length).toBeLessThanOrEqual(30);
    expect(row.recent_short.length).toBeGreaterThan(0);
    expect(row.baseline_long_at).not.toBeNull();
    const [snap] = await sql`select count(*)::int as n from public.yt_research_channel_daily where channel_id = ${target.id}`;
    expect(snap.n).toBe(1);
    expect((await call("POST", "/research", { user: OWNER, body: { action: "channel_watch", channel_id: "not-an-id" } })).status).toBe(400);
    expect((await call("POST", "/research", { user: OWNER, body: { action: "channel_watch", channel_id: "UCxxxxxxxxxxxxxxxxxxxxxx" } })).status).toBe(404);
    const hidden = await call("POST", "/research", { user: OWNER, body: { action: "channel_lookup", input: mock.universe[6].id } });
    expect(hidden.data.channels[0]).toMatchObject({ subscribers: null, subscribers_hidden: true });
  });

  it("refreshes stale watched channels during a sync", async () => {
    const [{ id }] = await sql`
      update public.yt_research_channels set baseline_long_at = now() - interval '2 days', typical_long = -1
       where watched returning id`;
    const { call } = setup();
    const res = await call("POST", "/sync", { user: OWNER });
    expect(res.data.summary.steps.watched_channels).toMatchObject({ ok: true, refreshed: 1 });
    const [row] = await sql`select typical_long, baseline_long_at > now() - interval '1 minute' as fresh from public.yt_research_channels where id = ${id}`;
    expect(row.typical_long).toBeGreaterThan(0);
    expect(row.fresh).toBe(true);
  });

  it("puts all of it in the one-call briefing for Claude", async () => {
    const [{ ctx }] = await sql`select public.yt_claude_context() as ctx`;
    expect(ctx.channel).toMatchObject({ id: MY_CHANNEL_ID, subscribers: 3880 });
    expect(ctx.last_28_days.days).toBeGreaterThan(20);
    expect(ctx.recent_uploads.length).toBe(10);
    expect(ctx.my_formats.length).toBe(3);
    expect(ctx.research.channels_i_watch).toHaveLength(1);
    expect(ctx.research.saved_keywords[0].keyword).toBe("elden ring challenge run");
    expect(ctx.research.saved_outlier_videos).toHaveLength(1);
    expect(ctx.research.recent_runs.length).toBeGreaterThan(3);
    expect(Object.keys(ctx.reports)).toContain("traffic_sources_28d");
    expect(ctx.last_sync.status).toBe("ok");
  });

  it("asks to reconnect when Google has withdrawn access, and disconnects cleanly", async () => {
    await sql`update public.yt_private set value = 'revoked' where key = 'google_refresh_token'`;
    await sql`update public.yt_private set value = '0' where key = 'google_access_expires'`;
    const { call } = setup();
    const res = await call("POST", "/research", { user: OWNER, body: { action: "keyword", keyword: "cuphead" } });
    expect(res.status).toBe(409);
    expect(res.data.code).toBe("reconnect");
    const [status] = await sql`select public.yt_public_status() as s`;
    expect(status.s).toEqual({ google_configured: true, youtube_connected: false });
    const [error] = await sql`select value from public.yt_private where key = 'google_error'`;
    expect(error.value).toContain("Connect YouTube again");
    const sync = await call("POST", "/sync", { user: OWNER });
    expect(sync.data.status).toBe("skipped");

    expect((await call("POST", "/auth/disconnect", { user: OWNER })).data).toEqual({ ok: true });
    const [cleared] = await sql`select value from public.yt_private where key = 'google_error'`;
    expect(cleared.value).toBe("");
  });
});
