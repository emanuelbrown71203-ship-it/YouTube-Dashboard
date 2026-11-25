import { useMemo, useState } from "react";
import { GoalsStrip, KindWords, RunBand, STATS_TABS, Tabs } from "./Growth.tsx";
import { FrontLines } from "./Notes.tsx";
import { NewUpload, WeekCard } from "./Pulse.tsx";
import { FollowUpsWaiting } from "./Suggested.tsx";
import { FindBox } from "./Find.tsx";
import { MakingNow } from "./MakingNow.tsx";
import { SwingsLine } from "./Swings.tsx";
import { BarList, Sparkline, Timeline, type UploadPin } from "../components/Timeline.tsx";
import { Delta, ErrorNote, Fold, FormatTag, Loading, Mult, Segmented, Thumb } from "../components/ui.tsx";
import { ago, compact, day, FORMAT_PLURAL, hours, signed, whole } from "../lib/format.ts";
import { useChannel, useConnection, useDaily, useFormatDaily, useReports, useSyncRuns, useVideos } from "../lib/hooks.ts";
import {
  activeSeries, bucket, change, headline, libraryComplete, type Metric, type RangeKey, splitPeriod, timeline, totals,
} from "../lib/stats.ts";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "28", label: "28 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
];

export const TRAFFIC_LABEL: Record<string, string> = {
  YT_SEARCH: "YouTube search",
  RELATED_VIDEO: "Suggested videos",
  SUBSCRIBER: "Home and subscriptions",
  SHORTS: "Shorts feed",
  YT_CHANNEL: "Channel pages",
  PLAYLIST: "Playlists",
  NOTIFICATION: "Notifications",
  EXT_URL: "Other websites",
  NO_LINK_OTHER: "Direct or unknown",
  NO_LINK_EMBEDDED: "Embedded players",
  YT_OTHER_PAGE: "Other YouTube pages",
  END_SCREEN: "End screens",
  HASHTAGS: "Hashtag pages",
  SOUND_PAGE: "Sound pages",
  ADVERTISING: "Ads",
};
const RECOMMENDED = new Set(["SUBSCRIBER", "RELATED_VIDEO", "SHORTS"]);

/**
 * The front page (`home`) keeps to what the owner acts on; the charts and breakdowns live on the
 * Stats tab (`stats`), so the front page is not buried under them.
 */
export function Overview({ view }: { view: "home" | "stats" }) {
  const home = view === "home";
  const [range, setRange] = useState<RangeKey>("28");
  const [metric, setMetric] = useState<Metric>("views");
  const daily = useDaily();
  const formats = useFormatDaily();
  const videos = useVideos();
  const channel = useChannel();
  const reports = useReports();
  const connection = useConnection();
  const runs = useSyncRuns();

  const period = useMemo(() => splitPeriod(daily.data ?? [], range), [daily.data, range]);
  const cur = useMemo(() => totals(period.current), [period]);
  const prev = useMemo(() => (period.previous ? totals(period.previous) : null), [period]);
  const lead = useMemo(() => headline(period, formats.data ?? [], videos.data ?? []), [period, formats.data, videos.data]);

  const chart = useMemo(() => {
    const dates = new Set(period.current.map((d) => d.date));
    const daysOfFormat = (formats.data ?? []).filter((f) => dates.has(f.date));
    const points = timeline(period.current, daysOfFormat, metric);
    const weekly = points.length > 120;
    return { points: weekly ? bucket(points, 7) : points, weekly, series: activeSeries(points) };
  }, [period, formats.data, metric]);

  const pins: UploadPin[] = useMemo(
    () => (videos.data ?? [])
      .filter((v) => v.privacy === "public" && v.content_type !== "live" && v.published_at && period.from && v.published_at.slice(0, 10) >= period.from)
      .map((v) => ({ date: v.published_at!.slice(0, 10), title: v.title, format: v.content_type })),
    [videos.data, period.from],
  );

  if (daily.isLoading || videos.isLoading) return <Loading label="Loading your numbers" />;
  if (daily.error) return <ErrorNote error={daily.error} retry={() => void daily.refetch()} />;

  const complete = libraryComplete(videos.data ?? [], channel.data?.videos);
  // Streams are left out here: there are many of them and they would push the videos off the list.
  const latest = (videos.data ?? []).filter((v) => v.privacy === "public" && v.content_type !== "live").slice(0, 3);
  const lastOk = runs.data?.find((r) => r.status === "ok" || r.status === "partial");
  const traffic = reports.data?.traffic_sources_28d;
  const trafficRows = (traffic?.data ?? [])
    .map((r) => ({ type: String(r.insightTrafficSourceType), views: Number(r.views ?? 0) }))
    .filter((r) => r.views > 0)
    .sort((a, b) => b.views - a.views);
  const trafficTotal = trafficRows.reduce((n, r) => n + r.views, 0);
  const share = (test: (type: string) => boolean) =>
    trafficTotal ? Math.round((100 * trafficRows.filter((r) => test(r.type)).reduce((n, r) => n + r.views, 0)) / trafficTotal) : 0;
  const spark = (pick: (p: (typeof period.current)[number]) => number) => period.current.slice(-Math.min(period.current.length, 90)).map(pick);
  const unit = metric === "watch" ? "hours" : metric === "engaged" ? "engaged views" : metric === "subs" ? "subscribers" : "views";

  return (
    <>
      <div className="page-head">
        <h1>{home ? "Home" : "Stats"}</h1>
        {home ? null : <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />}
      </div>
      {home ? null : <Tabs label="Stats" base="/stats" current="" tabs={STATS_TABS} />}
      {home ? <><RunBand /><MakingNow where="home" /><SwingsLine /><div style={{ marginBottom: 18 }}><FindBox /></div></> : null}

      {connection.data?.connection_error ? (
        <div className="notice error" role="alert">
          <span className="grow">{connection.data.connection_error}</span>
          <a className="btn btn-small" href="#/settings">Open settings</a>
        </div>
      ) : connection.data && !connection.data.youtube_connected ? (
        <div className="notice">
          <span className="grow">
            These numbers are a one-time snapshot{lastOk ? ` from ${day(lastOk.started_at)}` : ""}. Connect YouTube and they update on their own.
          </span>
          <a className="btn btn-small" href="#/settings">Connect YouTube</a>
        </div>
      ) : null}

      {home ? null : <div className="row-wrap between" style={{ alignItems: "flex-end", marginBottom: 22 }}>
        <div>
          <p className="lead">{lead.lead}</p>
          {lead.facts.length ? <p className="lead-facts">{lead.facts.join(" ")}</p> : null}
        </div>
        {channel.data ? (
          <div className="kv" style={{ gridTemplateColumns: "repeat(3, auto)", gap: "4px 26px" }}>
            <div><div className="k">Subscribers</div><div className="v fig">{compact(channel.data.subscribers)}</div></div>
            <div><div className="k">Views, all time</div><div className="v fig">{compact(channel.data.views)}</div></div>
            <div><div className="k">Uploads</div><div className="v fig">{whole(channel.data.videos)}</div></div>
          </div>
        ) : null}
      </div>}

      {home ? (
        // Everything that is not the next step waits here, closed, until the owner asks for it.
        <Fold title="Everything else" summary="Your latest upload, this week, goals and more" rememberAs="yt-home-more">
          <NewUpload /><FollowUpsWaiting /><WeekCard />
          <FrontLines />
          <div style={{ marginBottom: 22 }}>
            <KindWords />
            <GoalsStrip />
          </div>
          <section className="section">
          <div className="section-head">
            <h2>Latest uploads</h2>
            <a href="#/videos">All videos</a>
          </div>
          <div className="panel">
            {latest.length === 0 ? <div className="empty"><h3>No uploads stored yet</h3><p>They appear after the first sync.</p></div> : null}
            {latest.map((v) => (
              <a key={v.id} className="item" href={`#/videos?v=${v.id}`}>
                <Thumb src={v.thumbnail_url} seconds={v.duration_s} small short={v.content_type === "short"} />
                <span className="grow">
                  <span className="title clip2">{v.title}</span>
                  <span className="meta row-wrap">
                    <FormatTag format={v.content_type} />
                    <span>{ago(v.published_at)}</span>
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <span className="fig" style={{ fontSize: 18, display: "block" }}>{compact(v.views)}</span>
                  <span className="small muted">views</span>
                  {complete && v.vs_typical !== null ? <span style={{ display: "block", marginTop: 4 }}><Mult value={v.vs_typical} /></span> : null}
                </span>
              </a>
            ))}
          </div>
          {!complete && latest.length ? (
            <p className="small muted" style={{ marginTop: 8 }}>
              {whole(videos.data?.length ?? 0)} of {whole(channel.data?.videos ?? 0)} uploads are stored so far. How each one compares with your usual shows once YouTube is connected.
            </p>
          ) : null}
          </section>
        </Fold>
      ) : null}

      {home ? null : <div className={`panel${daily.isFetching ? " fade" : ""}`}>
        <div className="stat-strip" role="group" aria-label="Choose what the chart shows">
          <button type="button" className="stat" aria-pressed={metric === "views"} onClick={() => setMetric("views")}>
            <span className="label">Views</span>
            <span className="value fig">{compact(cur.views)}</span>
            <span className="foot"><Delta value={prev ? change(cur.views, prev.views) : null} /><Sparkline values={spark((d) => d.views)} /></span>
          </button>
          <button type="button" className="stat" aria-pressed={metric === "watch"} onClick={() => setMetric("watch")}>
            <span className="label">Watch time, hours</span>
            <span className="value fig">{hours(cur.minutes)}</span>
            <span className="foot"><Delta value={prev ? change(cur.minutes, prev.minutes) : null} /><Sparkline values={spark((d) => d.minutes_watched)} /></span>
          </button>
          <button type="button" className="stat" aria-pressed={metric === "engaged"} onClick={() => setMetric("engaged")}>
            <span className="label">Engaged views</span>
            <span className="value fig">{compact(cur.engaged)}</span>
            <span className="foot"><Delta value={prev ? change(cur.engaged, prev.engaged) : null} /><Sparkline values={spark((d) => d.engaged_views ?? 0)} /></span>
          </button>
          <button type="button" className="stat" aria-pressed={metric === "subs"} onClick={() => setMetric("subs")}>
            <span className="label">Subscribers</span>
            <span className="value fig">{signed(cur.net)}</span>
            <span className="foot">{whole(cur.gained)} gained, {whole(cur.lost)} lost</span>
          </button>
        </div>
        <Timeline
          points={chart.points} mode={metric === "subs" ? "subs" : "stack"} series={chart.series} unit={unit}
          uploads={pins} weekly={chart.weekly}
          value={(n) => (metric === "watch" ? (n >= 100 ? compact(n) : (Math.round(n * 10) / 10).toString()) : compact(n))}
        />
        <p className="small muted" style={{ padding: "0 18px 14px" }}>
          {period.from && period.to ? `${day(period.from)} to ${day(period.to)}. ` : ""}
          YouTube's numbers arrive two to three days late, so the latest days are missing.
          {metric === "engaged" ? " Engaged views leave out people who swiped past in the first moment." : ""}
        </p>
      </div>}

      {home ? null : <div className="two-col section">
        <section>
          <div className="section-head"><h2>Where views come from</h2></div>
          <div className="panel panel-pad">
            {trafficRows.length ? (
              <div className="stack">
                <p>
                  <span className="fig" style={{ fontSize: 22 }}>{share((t) => RECOMMENDED.has(t))}%</span> from recommendations
                  (home, suggested, Shorts feed) and <span className="fig" style={{ fontSize: 22 }}>{share((t) => t === "YT_SEARCH")}%</span> from search.
                </p>
                <BarList
                  rows={trafficRows.slice(0, 7).map((r) => ({ label: TRAFFIC_LABEL[r.type] ?? r.type.replace(/_/g, " ").toLowerCase(), value: r.views, hint: `${Math.round((100 * r.views) / trafficTotal)}%` }))}
                  value={compact}
                />
                <p className="small muted">{day(traffic?.period_start)} to {day(traffic?.period_end)}</p>
              </div>
            ) : (
              <div className="empty" style={{ padding: 0 }}>
                <h3>Not known yet</h3>
                <p>How much comes from search and how much from recommendations is private to your channel. It shows here once YouTube is connected.</p>
              </div>
            )}
          </div>
          <FormatSplit period={period} formats={formats.data ?? []} />
        </section>
      </div>}
    </>
  );
}

/** A share of a whole that never rounds a real slice down to nothing or up to everything. */
function shareText(part: number, total: number): string {
  const pct = (100 * part) / total;
  return pct > 0 && pct < 1 ? "under 1%" : pct > 99 && pct < 100 ? "over 99%" : `${Math.round(pct)}%`;
}

/** How the period's views divide between formats: a thin bar above the figures. */
function FormatSplit({ period, formats }: { period: ReturnType<typeof splitPeriod>; formats: NonNullable<ReturnType<typeof useFormatDaily>["data"]> }) {
  const dates = new Set(period.current.map((d) => d.date));
  const sums = new Map<string, { views: number; minutes: number }>();
  for (const f of formats) {
    if (!dates.has(f.date)) continue;
    const s = sums.get(f.content_type) ?? { views: 0, minutes: 0 };
    s.views += f.views ?? 0;
    s.minutes += f.minutes_watched ?? 0;
    sums.set(f.content_type, s);
  }
  const rows = [...sums.entries()].filter(([, s]) => s.views > 0).sort((a, b) => b[1].views - a[1].views);
  const total = rows.reduce((n, [, s]) => n + s.views, 0);
  if (!total) return null;
  return (
    <div className="section" style={{ marginTop: 20 }}>
      <div className="section-head"><h2>By format</h2></div>
      <div className="panel panel-pad stack">
        <div className="split" role="img" aria-label={rows.map(([k, s]) => `${FORMAT_PLURAL[k]} ${shareText(s.views, total)}`).join(", ")}>
          {rows.map(([k, s]) => <i key={k} style={{ width: `${(100 * s.views) / total}%`, background: `var(--s-${k})`, minWidth: 3 }} />)}
        </div>
        <table className="compare">
          <thead><tr><th>Format</th><th>Views</th><th>Share</th><th>Watch hours</th></tr></thead>
          <tbody>
            {rows.map(([k, s]) => (
              <tr key={k}>
                <td><span className="row"><span className="tag" style={{ padding: 0, border: 0, background: "none" }}><span className="dot" style={{ background: `var(--s-${k})` }} /></span>{FORMAT_PLURAL[k]}</span></td>
                <td className="v">{compact(s.views)}</td>
                <td className="v">{shareText(s.views, total)}</td>
                <td className="v">{hours(s.minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
