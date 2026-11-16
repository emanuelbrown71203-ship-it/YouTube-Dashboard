import { useQueryClient } from "@tanstack/react-query";
import { setVideoTopic, useReach } from "../lib/growth.ts";
import { Tabs, VIDEO_TABS } from "./Growth.tsx";
import { useMemo, useState } from "react";
import { BarList } from "../components/Timeline.tsx";
import { Drawer, ErrorNote, FormatTag, Icon, Loading, Mult, Thumb, useToast } from "../components/ui.tsx";
import { setVideoType } from "../lib/api.ts";
import { ago, compact, count, day, duration, FORMAT_LABEL, FORMAT_PLURAL, money, multiple, percent, whole } from "../lib/format.ts";
import { keys, useChannel, useVideos } from "../lib/hooks.ts";
import { navigate, useRoute } from "../lib/router.ts";
import { auditAll, type Check, CHECK_LABEL, type CheckKey } from "../lib/seo.ts";
import { libraryComplete } from "../lib/stats.ts";
import type { Format, Traffic, Video } from "../lib/types.ts";

type SortKey = "newest" | "views" | "per_day" | "vs_usual" | "watched" | "ctr" | "avg_view" | "watch_hours" | "earned";

const TRAFFIC_GROUP: Record<string, string> = {
  search: "YouTube search",
  suggested: "Suggested videos",
  browse: "Home and subscriptions",
  shorts_feed: "Shorts feed",
  channel_pages: "Channel pages",
  playlists: "Playlists",
  notifications: "Notifications",
  external: "Other websites",
  other: "Everything else",
};

const DISCOVERY_TEXT: Record<string, string> = {
  search: "Mostly found through search.",
  recommended: "Mostly recommended by YouTube (home, suggested, Shorts feed).",
  mixed: "A mix of search and recommendations.",
};

export function Videos() {
  const videos = useVideos();
  const channel = useChannel();
  const route = useRoute();
  // Opens on long-form: each kind of video is its own list, because their views are not comparable.
  const [format, setFormat] = useState<"all" | Format>("long");
  const [sort, setSort] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");
  const [issue, setIssue] = useState<CheckKey | null>(null);
  const [shown, setShown] = useState(60);

  const all = useMemo(() => videos.data ?? [], [videos.data]);
  const audit = useMemo(() => auditAll(all), [all]);
  const complete = libraryComplete(all, channel.data?.videos);
  const earning = all.some((v) => v.estimated_revenue !== null);
  const reach = useReach();
  const reachById = useMemo(() => new Map((reach.data ?? []).map((r) => [r.video_id, r])), [reach.data]);
  const clicks = reachById.size > 0;
  const ctrOf = (id: string) => { const r = reachById.get(id); return r?.ctr_28d == null ? "–" : `${r.ctr_28d}%`; };

  const issues = useMemo(() => {
    const counts = new Map<CheckKey, { n: number; fix: boolean }>();
    for (const checks of audit.values()) {
      for (const c of checks) {
        const entry = counts.get(c.key) ?? { n: 0, fix: c.level === "fix" };
        entry.n++;
        counts.set(c.key, entry);
      }
    }
    return [...counts.entries()].sort((a, b) => Number(b[1].fix) - Number(a[1].fix) || b[1].n - a[1].n);
  }, [audit]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = all.filter((v) =>
      (format === "all" || v.content_type === format)
      && (!needle || v.title.toLowerCase().includes(needle))
      && (!issue || (audit.get(v.id) ?? []).some((c) => c.key === issue)));
    const by: Record<SortKey, (v: Video) => number> = {
      newest: (v) => (v.published_at ? Date.parse(v.published_at) : 0),
      views: (v) => v.views ?? -1,
      per_day: (v) => v.views_per_day ?? -1,
      vs_usual: (v) => v.vs_typical ?? -1,
      watched: (v) => v.avg_view_pct ?? -1,
      ctr: (v) => reachById.get(v.id)?.ctr_28d ?? -1,
      avg_view: (v) => v.avg_view_duration_s ?? -1,
      watch_hours: (v) => v.watch_hours ?? -1,
      earned: (v) => v.estimated_revenue ?? -1,
    };
    return [...list].sort((a, b) => by[sort](b) - by[sort](a));
  }, [all, format, search, issue, sort, audit, reachById]);

  if (videos.isLoading) return <Loading label="Loading your videos" />;
  if (videos.error) return <ErrorNote error={videos.error} retry={() => void videos.refetch()} />;

  const open = all.find((v) => v.id === route.query.get("v")) ?? null;
  const countOf = (f: Format) => all.filter((v) => v.content_type === f).length;

  return (
    <>
      <div className="page-head">
        <h1>Videos</h1>
        <span className="soft">
          {complete ? count(all.length, "upload") : `${whole(all.length)} of ${whole(channel.data?.videos ?? 0)} uploads stored`}
        </span>
      </div>
      <Tabs label="Videos" base="/videos" current="" tabs={VIDEO_TABS} />

      {!complete && all.length ? (
        <div className="notice">
          <span className="grow">
            This is a sample: your newest uploads and your all-time top videos. Connect YouTube to load every upload and see how each compares with your usual.
          </span>
          <a className="btn btn-small" href="#/settings">Connect YouTube</a>
        </div>
      ) : null}

      {issues.length ? (
        <section className="panel panel-pad" style={{ marginBottom: 20 }}>
          <h2>Worth fixing</h2>
          <p className="soft small" style={{ margin: "2px 0 10px" }}>Quick things to tidy up on your uploads. Pick one to see the videos.</p>
          <div className="row-wrap">
            {issues.map(([key, info]) => (
              <button key={key} type="button" className="chip" aria-pressed={issue === key} onClick={() => { setIssue(issue === key ? null : key); setShown(60); }}>
                {CHECK_LABEL[key]}
                <span className="fig">{info.n}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <div className="row-wrap" style={{ flex: "1 1 320px" }}>
          {([["long", `Long-form ${countOf("long")}`], ["short", `Shorts ${countOf("short")}`], ["live", `Streams ${countOf("live")}`], ["all", `Everything ${all.length}`]] as const).map(([value, label]) => (
            <button key={value} type="button" className="chip" aria-pressed={format === value} onClick={() => { setFormat(value); setShown(60); }}>{label}</button>
          ))}
        </div>
        <input className="input" style={{ width: 200 }} type="search" placeholder="Search titles" value={search} onChange={(e) => { setSearch(e.target.value); setShown(60); }} aria-label="Search titles" />
        <select className="select input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
          <option value="newest">Newest first</option>
          <option value="views">Most views</option>
          <option value="per_day">Most views per day</option>
          {complete ? <option value="vs_usual">Furthest above your usual</option> : null}
          <option value="watched">Highest retention</option>
          {clicks ? <option value="ctr">Highest click-through rate</option> : null}
          <option value="avg_view">Longest average view</option>
          <option value="watch_hours">Most watch hours</option>
          {earning ? <option value="earned">Most earned</option> : null}
        </select>
      </div>
      {earning ? null : (
        <p className="small muted" style={{ margin: "0 0 12px" }}>
          Estimated earnings need one more permission from Google. In Settings, press Disconnect, then sign in with Google again and leave all three boxes ticked.
        </p>
      )}

      <div className={`panel${videos.isFetching ? " fade" : ""}`}>
        {rows.length === 0 ? (
          <div className="empty"><h3>No videos match</h3><p>Clear the search or pick a different format.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th className="num">Views</th>
                  {complete ? <th className="num">Against usual</th> : null}
                  <th className="num wide">Per day</th>
                  <th className="num wide">Watch hours</th>
                  <th className="num wide">Retention</th>
                  <th className="num wide">Average view</th>
                  {clicks ? <th className="num wide">Click-through</th> : null}
                  {earning ? <th className="num wide">Earned</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((v) => {
                  const checks = audit.get(v.id) ?? [];
                  return (
                    <tr key={v.id} className="clickable" onClick={() => navigate(`/videos?v=${v.id}`)}>
                      <td>
                        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                          <Thumb src={v.thumbnail_url} seconds={v.duration_s} small short={v.content_type === "short"} />
                          <div className="grow">
                            <button type="button" className="th-sort clip2" style={{ fontWeight: 600, color: "var(--ink)", textAlign: "left", lineHeight: 1.3 }} onClick={(e) => { e.stopPropagation(); navigate(`/videos?v=${v.id}`); }}>
                              {v.title}
                            </button>
                            <div className="row-wrap small muted" style={{ marginTop: 4 }}>
                              <FormatTag format={v.content_type} />
                              {v.privacy && v.privacy !== "public" ? <span className="tag">{v.privacy === "private" ? "Private" : "Unlisted"}</span> : null}
                              <span>{ago(v.published_at)}</span>
                              {checks.length ? <span className="tag" style={{ borderColor: "var(--note-line)", background: "var(--note-bg)", color: "var(--note-ink)" }}>{count(checks.length, "thing")} to fix</span> : null}
                            </div>
                          </div>
                        </div>
                        <div className="small narrow-only">
                          <span><span className="muted">Retention</span> {percent(v.avg_view_pct)}</span>
                          <span><span className="muted">Avg view</span> {duration(v.avg_view_duration_s)}</span>
                          <span><span className="muted">Watch hrs</span> {v.watch_hours === null ? "–" : compact(v.watch_hours)}</span>
                          {clicks ? <span><span className="muted">Click-through</span> {ctrOf(v.id)}</span> : null}
                          {earning ? <span><span className="muted">Earned</span> {money(v.estimated_revenue)}</span> : null}
                        </div>
                      </td>
                      <td className="num fig" style={{ fontSize: 16 }}>{compact(v.views)}</td>
                      {complete ? <td className="num"><Mult value={v.vs_typical} /></td> : null}
                      <td className="num wide">{compact(v.views_per_day)}</td>
                      <td className="num wide">{v.watch_hours === null ? "–" : compact(v.watch_hours)}</td>
                      <td className="num wide">{percent(v.avg_view_pct)}</td>
                      <td className="num wide">{duration(v.avg_view_duration_s)}</td>
                      {clicks ? <td className="num wide">{ctrOf(v.id)}</td> : null}
                      {earning ? <td className="num wide">{money(v.estimated_revenue)}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rows.length > shown ? (
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={() => setShown((n) => n + 100)}>Show more ({whole(rows.length - shown)} left)</button>
        </div>
      ) : null}

      {open ? <VideoDetail video={open} checks={audit.get(open.id) ?? []} complete={complete} onClose={() => navigate("/videos")} /> : null}
    </>
  );
}

function trafficRows(traffic: Traffic) {
  const total = traffic.total ?? 0;
  return Object.entries(traffic)
    .filter(([key, value]) => key !== "total" && (value ?? 0) > 0)
    .map(([key, value]) => ({ label: TRAFFIC_GROUP[key] ?? key, value: value ?? 0, hint: total ? `${Math.round((100 * (value ?? 0)) / total)}%` : undefined }))
    .sort((a, b) => b.value - a.value);
}

function VideoDetail({ video: v, checks, complete, onClose }: { video: Video; checks: Check[]; complete: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [topic, setTopic] = useState(v.topic ?? "");
  const stats: [string, string][] = [
    ["Views", whole(v.views)],
    ["Per day", compact(v.views_per_day)],
    ["Likes", whole(v.likes)],
    ["Comments", whole(v.comments)],
    ["Watch hours", v.watch_hours === null ? "–" : compact(v.watch_hours)],
    ["Retention", percent(v.avg_view_pct)],
    ["Average view", duration(v.avg_view_duration_s)],
    ["Subscribers gained", whole(v.subs_gained)],
    ...(v.estimated_revenue === null ? [] : [
      ["Estimated earnings", money(v.estimated_revenue)],
      ["Earned per 1,000 views", money(v.revenue_per_1000_views)],
    ] as [string, string][]),
  ];

  const changeFormat = async (type: Format) => {
    setSaving(true);
    try {
      await setVideoType(v.id, type);
      await queryClient.invalidateQueries({ queryKey: keys.videos });
      toast(`Marked as ${FORMAT_LABEL[type]}. Syncs will keep your choice.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change the format.", { error: true });
    }
    setSaving(false);
  };

  return (
    <Drawer
      title="Video" onClose={onClose}
      footer={<a className="btn" href={v.url} target="_blank" rel="noreferrer"><Icon name="external" />Open on YouTube</a>}
    >
      <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
        <Thumb src={v.thumbnail_url} seconds={v.duration_s} short={v.content_type === "short"} />
        <div className="grow">
          <h3>{v.title}</h3>
          <div className="row-wrap small muted" style={{ marginTop: 6 }}>
            <FormatTag format={v.content_type} />
            {v.privacy && v.privacy !== "public" ? <span className="tag">{v.privacy === "private" ? "Private" : "Unlisted"}</span> : null}
            <span>Posted {day(v.published_at)}, {ago(v.published_at)}</span>
          </div>
        </div>
      </div>

      <div className="kv">
        {stats.map(([k, val]) => (
          <div key={k}><div className="k">{k}</div><div className="v fig">{val}</div></div>
        ))}
      </div>

      <form
        className="row-wrap" style={{ alignItems: "flex-end" }}
        onSubmit={(e) => {
          e.preventDefault();
          void setVideoTopic(v.id, topic).then(
            () => { toast(topic.trim() ? `Filed under ${topic.trim()}.` : "Game cleared."); void queryClient.invalidateQueries({ queryKey: keys.videos }); },
            (err) => toast(err instanceof Error ? err.message : "That did not save. Try again.", { error: true }),
          );
        }}
      >
        <label className="field grow">
          <span>Game</span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} placeholder="Elden Ring" />
        </label>
        <button type="submit" className="btn" disabled={topic.trim() === (v.topic ?? "")}>Save</button>
        <a className="btn btn-quiet" href="#/videos/tests">Tests</a>
      </form>

      {complete && v.vs_typical !== null && v.typical_views !== null ? (
        <div className="row" style={{ gap: 12 }}>
          <Mult value={v.vs_typical} />
          <p className="soft">
            {multiple(v.vs_typical)} your usual. The 20 {FORMAT_PLURAL[v.content_type ?? "long"].toLowerCase()} uploads before it typically reached {compact(v.typical_views)} views.
          </p>
        </div>
      ) : null}

      <section>
        <h3 style={{ marginBottom: 8 }}>Where its views came from</h3>
        {v.traffic && (v.traffic.total ?? 0) > 0 ? (
          <div className="stack">
            {v.discovery ? <p className="soft">{DISCOVERY_TEXT[v.discovery]}</p> : null}
            <BarList rows={trafficRows(v.traffic)} value={compact} />
          </div>
        ) : (
          <p className="soft">Private to your channel. It appears a little after YouTube is connected.</p>
        )}
      </section>

      <section>
        <h3 style={{ marginBottom: 8 }}>Worth fixing</h3>
        {checks.length ? (
          <ul className="checks">
            {checks.map((c) => (
              <li key={c.key} className={c.level}>
                <span className="mark" aria-hidden="true">!</span>
                <span><strong>{CHECK_LABEL[c.key]}.</strong> {c.detail}</span>
              </li>
            ))}
          </ul>
        ) : <p className="soft">Nothing stands out on this one.</p>}
      </section>

      <label className="field">
        <span>Format</span>
        <select className="select input" value={v.content_type ?? "long"} disabled={saving} onChange={(e) => void changeFormat(e.target.value as Format)}>
          <option value="short">Short</option>
          <option value="long">Long-form</option>
          <option value="live">Live</option>
        </select>
        <small>Change it if the label is wrong. Your choice sticks.</small>
      </label>
    </Drawer>
  );
}
