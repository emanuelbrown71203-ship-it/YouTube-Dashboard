import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { ErrorNote, Icon, Mult, Segmented, Thumb, useToast } from "../components/ui.tsx";
import { findOutliers, saveResearchVideo, watchChannel } from "../lib/api.ts";
import { setPendingIdea } from "../lib/draft.ts";
import { ago, compact, count, duration, multiple, whole } from "../lib/format.ts";
import { keys, useChannel, useMyFormats, useResearchRuns, useSavedVideos, useVideos, useWatched } from "../lib/hooks.ts";
import { navigate } from "../lib/router.ts";
import { libraryComplete, median, myTopics, titleStats } from "../lib/stats.ts";
import type { OutlierResponse, OutlierResult, OutlierSearch, SavedVideo } from "../lib/types.ts";

type Sort = "outlier" | "views" | "per_day" | "newest";

const pct = (share: number) => `${Math.round(share * 100)}%`;
const youtubeUrl = (id: string, format: string | null) => `https://www.youtube.com/${format === "short" ? "shorts/" : "watch?v="}${id}`;

export function ResearchOutliers({ connected }: { connected: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const videos = useVideos();
  const channel = useChannel();
  const myFormats = useMyFormats();
  const runs = useResearchRuns<OutlierResult[]>("outliers");
  const saved = useSavedVideos();
  const watched = useWatched();

  const [search, setSearch] = useState<OutlierSearch>({ query: "", mode: "breakout", format: "long", window_days: 30, max_subs: null, min_views: 1000 });
  const [result, setResult] = useState<{ search: OutlierSearch; items: OutlierResult[]; next: string | null; summary: OutlierResponse["summary"] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sort, setSort] = useState<Sort>("outlier");
  const [visible, setVisible] = useState(20);
  const set = <K extends keyof OutlierSearch>(key: K, value: OutlierSearch[K]) => setSearch((s) => ({ ...s, [key]: value }));
  const topics = useMemo(() => myTopics(videos.data ?? []), [videos.data]);
  const watchedIds = new Set((watched.data ?? []).map((c) => c.id));

  const run = async (params: OutlierSearch, pageToken: string | null = null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await findOutliers(params, pageToken);
      queryClient.setQueryData(keys.quota, res.quota.used_today);
      if (!pageToken) setVisible(20);
      setResult((prev) => ({
        search: params,
        items: pageToken && prev ? [...prev.items, ...res.items.filter((i) => !prev.items.some((p) => p.video_id === i.video_id))] : res.items,
        next: res.next_page_token,
        summary: res.summary,
      }));
      void queryClient.invalidateQueries({ queryKey: keys.research("outliers") });
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (search.query.trim().length >= 2) void run({ ...search, query: search.query.trim() });
  };

  const toggleSaved = async (item: { video_id: string; saved: boolean }) => {
    try {
      await saveResearchVideo(item.video_id, !item.saved);
      setResult((r) => (r ? { ...r, items: r.items.map((i) => (i.video_id === item.video_id ? { ...i, saved: !item.saved } : i)) } : r));
      void queryClient.invalidateQueries({ queryKey: keys.saved });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save that video.", { error: true });
    }
  };

  const makeIdea = (item: { video_id: string; title: string; format: string | null; channel_title: string | null; views: number | null; outlier_score: number | null }, mode: "breakout" | "evergreen") => {
    setPendingIdea({
      title: item.title,
      format: item.format === "short" ? "short" : "long",
      discovery: mode === "evergreen" ? "search" : "recommended",
      inspiration_url: youtubeUrl(item.video_id, item.format),
      inspiration_video_id: item.video_id,
      notes: `Inspired by ${item.channel_title ?? "another channel"}: ${compact(item.views)} views${item.outlier_score !== null ? `, ${multiple(item.outlier_score)} their usual` : ""}. Make it yours: new angle, your own title.`,
      source: "research",
    });
    navigate("/ideas");
  };

  const watch = async (item: OutlierResult) => {
    try {
      const res = await watchChannel(item.channel_id);
      queryClient.setQueryData(keys.quota, res.quota.used_today);
      void queryClient.invalidateQueries({ queryKey: keys.watched });
      toast(`Now watching ${item.channel_title}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not watch that channel.", { error: true });
    }
  };

  const items = useMemo(() => {
    const list = [...(result?.items ?? [])];
    const by: Record<Sort, (i: OutlierResult) => number> = {
      outlier: (i) => i.outlier_score ?? -1,
      views: (i) => i.views,
      per_day: (i) => i.views_per_day,
      newest: (i) => -i.age_days,
    };
    return list.sort((a, b) => by[sort](b) - by[sort](a));
  }, [result, sort]);

  const format = result?.search.format ?? search.format;
  const mine = (videos.data ?? []).filter((v) => v.privacy === "public" && v.content_type === format);
  const complete = libraryComplete(videos.data ?? [], channel.data?.videos);
  const myTitles = titleStats(mine.slice(0, 30).map((v) => v.title));
  const theirTitles = titleStats(items.map((i) => i.title));
  const myTypical = myFormats.data?.find((f) => f.content_type === format)?.typical_views ?? null;
  const compare: [string, string, string][] = items.length ? [
    ["Usual views per upload", complete && myTypical !== null ? compact(myTypical) : "–", compact(median(items.map((i) => i.typical_views ?? Number.NaN)))],
    ["Channel size", compact(channel.data?.subscribers), compact(median(items.map((i) => i.channel_subscribers ?? Number.NaN)))],
    ["Video length", duration(median(mine.slice(0, 30).map((v) => v.duration_s ?? Number.NaN))), duration(median(items.map((i) => i.duration_s)))],
    ["Title length", myTitles.medianLength === null ? "–" : `${Math.round(myTitles.medianLength)} characters`, theirTitles.medianLength === null ? "–" : `${Math.round(theirTitles.medianLength)} characters`],
    ["Titles in capitals", myTitles.n ? pct(myTitles.allCaps) : "–", pct(theirTitles.allCaps)],
    ["Titles with a number", myTitles.n ? pct(myTitles.withNumber) : "–", pct(theirTitles.withNumber)],
    ["Titles that ask a question", myTitles.n ? pct(myTitles.question) : "–", pct(theirTitles.question)],
    ["Hashtags in the title", myTitles.medianHashtags === null ? "–" : String(myTitles.medianHashtags), String(theirTitles.medianHashtags ?? 0)],
  ] : [];

  return (
    <>
      <form className="panel panel-pad stack" onSubmit={submit}>
        <div className="quick-add">
          <input className="input" value={search.query} onChange={(e) => set("query", e.target.value)} placeholder="A topic, game or kind of video" aria-label="Topic" maxLength={100} />
          <button type="submit" className="btn btn-primary" disabled={busy || !connected || search.query.trim().length < 2}>
            {busy ? "Searching YouTube" : "Find outliers"}
          </button>
        </div>
        {topics.length ? (
          <div className="row-wrap">
            <span className="small muted">Your topics</span>
            {topics.map((t) => <button key={t} type="button" className="chip" onClick={() => set("query", t)}>{t}</button>)}
          </div>
        ) : null}
        <div className="field-row">
          <div className="field">
            <span>Format</span>
            <Segmented label="Format" value={search.format} onChange={(v) => set("format", v)} options={[{ value: "long", label: "Long-form" }, { value: "short", label: "Shorts" }]} />
          </div>
          <div className="field">
            <span>Look for</span>
            <Segmented label="Look for" value={search.mode} onChange={(v) => set("mode", v)} options={[{ value: "breakout", label: "Breaking out now" }, { value: "evergreen", label: "Still found in search" }]} />
          </div>
        </div>
        <div className="field-row">
          {search.mode === "breakout" ? (
            <label className="field">
              <span>Posted in the last</span>
              <select className="select input" value={search.window_days} onChange={(e) => set("window_days", Number(e.target.value))}>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>Year</option>
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>Channel size</span>
            <select className="select input" value={search.max_subs ?? ""} onChange={(e) => set("max_subs", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Any size</option>
              <option value={10000}>Up to 10K subscribers</option>
              <option value={100000}>Up to 100K subscribers</option>
              <option value={1000000}>Up to 1M subscribers</option>
            </select>
          </label>
          <label className="field">
            <span>With at least</span>
            <select className="select input" value={search.min_views} onChange={(e) => set("min_views", Number(e.target.value))}>
              <option value={0}>Any views</option>
              <option value={1000}>1,000 views</option>
              <option value={10000}>10,000 views</option>
              <option value={100000}>100,000 views</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          {search.mode === "breakout"
            ? "Recent videos with the most views on this topic, each compared with what its own channel usually gets. A high multiple from a small channel means YouTube pushed it."
            : "Videos at least six months old that still come up for this search. These are the ones earning from search long after posting."}
          {" "}One search uses about {search.format === "long" ? 3 : 2}% of today's free lookups.
        </p>
      </form>

      {error ? <div style={{ marginTop: 16 }}><ErrorNote error={error} /></div> : null}

      {result ? (
        <section className="section">
          <div className="section-head">
            <h2>{count(items.length, "video")} for "{result.search.query}"</h2>
            <select className="select input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort results">
              <option value="outlier">Biggest outliers first</option>
              <option value="views">Most views first</option>
              <option value="per_day">Most views per day first</option>
              <option value="newest">Newest first</option>
            </select>
          </div>
          {result.summary ? (
            <p className="small muted" style={{ marginBottom: 10 }}>
              From {count(result.summary.channels, "channel")}.
              {result.summary.below_min_views ? ` Left out: ${count(result.summary.below_min_views, "video")} under ${whole(result.search.min_views)} views.` : ""}
              {result.summary.channels_too_big ? ` ${count(result.summary.channels_too_big, "video")} from bigger channels.` : ""}
              {result.summary.hidden_live ? ` ${count(result.summary.hidden_live, "live stream")}.` : ""}
              {result.summary.not_english ? ` ${count(result.summary.not_english, "video")} not in English.` : ""}
            </p>
          ) : null}

          {items.length === 0 ? (
            <div className="panel"><div className="empty"><h3>Nothing matched</h3><p>Try a broader topic, a longer time window, or lower the minimum views.</p></div></div>
          ) : (
            <div className="two-col">
              <div className={`panel${busy ? " fade" : ""}`}>
                {items.slice(0, visible).map((item) => (
                  <div className="item result" key={item.video_id}>
                    <a href={youtubeUrl(item.video_id, item.format)} target="_blank" rel="noreferrer" aria-label={`Open "${item.title}" on YouTube`}>
                      <Thumb src={item.thumbnail_url} seconds={item.duration_s} small short={item.format === "short"} />
                    </a>
                    <div className="grow">
                      <a className="title clip2" href={youtubeUrl(item.video_id, item.format)} target="_blank" rel="noreferrer" style={{ color: "var(--ink)", textDecoration: "none" }}>{item.title}</a>
                      <div className="meta">
                        {item.channel_title}, {item.channel_subscribers === null ? "subscribers hidden" : `${compact(item.channel_subscribers)} subscribers`}. Posted {ago(item.published_at)}.
                      </div>
                      <div className="row-wrap" style={{ marginTop: 8 }}>
                        <button type="button" className="btn btn-small" aria-pressed={item.saved} onClick={() => void toggleSaved(item)}>
                          <Icon name="bookmark" filled={item.saved} />{item.saved ? "Saved" : "Save"}
                        </button>
                        <button type="button" className="btn btn-small" onClick={() => makeIdea(item, result.search.mode)}>Make it an idea</button>
                        {item.channel_id === channel.data?.id
                          ? <span className="tag">Your video</span>
                          : watchedIds.has(item.channel_id)
                            ? <span className="small muted">Watching this channel</span>
                            : <button type="button" className="btn btn-quiet btn-small" onClick={() => void watch(item)}>Watch channel</button>}
                      </div>
                    </div>
                    <div className="result-stats" style={{ textAlign: "right", flex: "none" }}>
                      <Mult value={item.outlier_score} title={item.typical_views !== null ? `${multiple(item.outlier_score)} this channel's usual ${compact(item.typical_views)} views` : undefined} />
                      <div><span className="fig" style={{ fontSize: 18 }}>{compact(item.views)}</span> <span className="small muted">views</span></div>
                      <div className="small muted">{compact(item.views_per_day)} a day</div>
                    </div>
                  </div>
                ))}
              </div>
              <aside>
                <div className="panel panel-pad">
                  <h3 style={{ marginBottom: 8 }}>How you compare</h3>
                  <table className="compare">
                    <thead><tr><th /><th>You</th><th>These videos</th></tr></thead>
                    <tbody>
                      {compare.map(([label, you, them]) => (
                        <tr key={label}><td>{label}</td><td className="v">{you}</td><td className="v">{them}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="small muted" style={{ marginTop: 10 }}>
                    "You" is your last {Math.min(30, mine.length)} {format === "short" ? "Shorts" : "long-form uploads"}.
                    {!complete ? " Your usual views show once YouTube has loaded every upload." : ""}
                  </p>
                </div>
              </aside>
            </div>
          )}
          <div className="row-wrap" style={{ marginTop: 12 }}>
            {items.length > visible ? (
              <button type="button" className="btn" onClick={() => setVisible((n) => n + 20)}>Show 20 more ({whole(items.length - visible)} left)</button>
            ) : null}
            {result.next ? (
              <button type="button" className="btn" disabled={busy} onClick={() => void run(result.search, result.next)}>
                {busy ? "Searching YouTube" : "Search further down YouTube's results"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {(saved.data ?? []).length ? (
        <section className="section">
          <div className="section-head"><h2>Saved videos</h2></div>
          <div className="panel">
            {(saved.data ?? []).map((v: SavedVideo) => (
              <div className="item" key={v.id}>
                <a href={youtubeUrl(v.id, v.format)} target="_blank" rel="noreferrer" aria-label={`Open "${v.title}" on YouTube`}><Thumb src={v.thumbnail_url} seconds={v.duration_s} small /></a>
                <div className="grow">
                  <div className="title clip2">{v.title}</div>
                  <div className="meta">{v.channel_title}, {compact(v.views)} views</div>
                  <div className="row-wrap" style={{ marginTop: 8 }}>
                    <button type="button" className="btn btn-small" onClick={() => makeIdea({ video_id: v.id, title: v.title ?? "", format: v.format, channel_title: v.channel_title, views: v.views, outlier_score: v.outlier_score }, "breakout")}>Make it an idea</button>
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => void saveResearchVideo(v.id, false).then(() => queryClient.invalidateQueries({ queryKey: keys.saved }))}>Remove</button>
                  </div>
                </div>
                <Mult value={v.outlier_score} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {(runs.data ?? []).length ? (
        <section className="section">
          <div className="section-head"><h2>Earlier searches</h2><span className="small muted">Opening one costs nothing</span></div>
          <div className="row-wrap">
            {(runs.data ?? []).map((r) => (
              <button
                key={r.id} type="button" className="chip"
                onClick={() => {
                  const params = { ...search, ...(r.params as Partial<OutlierSearch>), query: r.query };
                  setSearch(params);
                  setVisible(20);
                  setResult({ search: params, items: r.results, next: null, summary: null });
                  setError(null);
                }}
              >
                {r.query}
                <span className="muted" style={{ fontWeight: 500 }}>{(r.params as Partial<OutlierSearch>).format === "short" ? "Shorts" : "long-form"}, {ago(r.created_at)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
