import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, Fragment, useMemo, useState } from "react";
import { ErrorNote, FormatTag, Icon, Mult, Thumb, useToast } from "../components/ui.tsx";
import { lookupChannel, refreshChannel, stopWatchingChannel, watchChannel } from "../lib/api.ts";
import { setPendingIdea } from "../lib/draft.ts";
import { ago, compact, whole } from "../lib/format.ts";
import { keys, useChannel, useMyFormats, useVideos, useWatched } from "../lib/hooks.ts";
import { navigate } from "../lib/router.ts";
import { libraryComplete } from "../lib/stats.ts";
import type { RecentUpload, ResearchChannel } from "../lib/types.ts";

type Found = Awaited<ReturnType<typeof lookupChannel>>["channels"][number];

interface Breakout extends RecentUpload {
  channel: string;
  format: "long" | "short";
  score: number;
}

const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
const link = (id: string, format: string) => `https://www.youtube.com/${format === "short" ? "shorts/" : "watch?v="}${id}`;
const DAY = 86_400_000;

function scored(channel: ResearchChannel, format: "long" | "short"): Breakout[] {
  const typical = format === "long" ? channel.typical_long : channel.typical_short;
  const recent = format === "long" ? channel.recent_long : channel.recent_short;
  if (!typical || typical <= 0) return [];
  return (recent ?? []).map((r) => ({ ...r, channel: channel.title ?? "", format, score: Math.round((100 * r.views) / typical) / 100 }));
}

export function ResearchChannels({ connected }: { connected: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const watched = useWatched();
  const me = useChannel();
  const myFormats = useMyFormats();
  const videos = useVideos();
  const [input, setInput] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);

  const complete = libraryComplete(videos.data ?? [], me.data?.videos);
  const mine = (format: "long" | "short") => myFormats.data?.find((f) => f.content_type === format);
  const channels = watched.data ?? [];

  const breakouts = useMemo(
    () => channels.flatMap((c) => [...scored(c, "long"), ...scored(c, "short")])
      .filter((u) => u.score >= 2 && Date.now() - Date.parse(u.published_at) <= 90 * DAY)
      .sort((a, b) => b.score - a.score).slice(0, 15),
    [channels],
  );

  const act = async (name: string, work: () => Promise<{ quota?: { used_today: number } } | void>, done?: string) => {
    setBusy(name);
    setError(null);
    try {
      const res = await work();
      if (res && res.quota) queryClient.setQueryData(keys.quota, res.quota.used_today);
      await queryClient.invalidateQueries({ queryKey: keys.watched });
      if (done) toast(done);
    } catch (err) {
      setError(err);
    }
    setBusy(null);
  };

  const find = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim().length < 2) return;
    void act("find", async () => {
      const res = await lookupChannel(input.trim());
      setFound(res.channels);
      return res;
    });
  };

  const isLink = /@|youtube\.com|UC[\w-]{22}/.test(input);

  return (
    <>
      <form className="panel panel-pad stack" onSubmit={find}>
        <div className="quick-add">
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Channel name, @handle or link" aria-label="Channel to find" maxLength={200} />
          <button type="submit" className="btn btn-primary" disabled={!connected || busy !== null || input.trim().length < 2}>{busy === "find" ? "Looking" : "Find channel"}</button>
        </div>
        <p className="small muted">
          {isLink ? "A handle or link costs next to nothing." : "A handle or link costs next to nothing. Searching by name uses 1% of today's free lookups."}
          {" "}You can watch up to 25 channels; they refresh with every sync.
        </p>
        {found ? (
          found.length === 0 ? <p className="soft">YouTube found no channel for that. Try the @handle from the channel's page.</p> : (
            <div>
              {found.map((c) => (
                <div key={c.id} className="row" style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <div className="grow">
                    <div className="clip" style={{ fontWeight: 600 }}>{c.title}</div>
                    <div className="small muted clip">{c.handle ?? ""} {c.subscribers_hidden ? "Subscribers hidden" : `${compact(c.subscribers)} subscribers`}, {whole(c.videos)} uploads</div>
                  </div>
                  {c.watched || channels.some((w) => w.id === c.id)
                    ? <span className="small muted">Watching</span>
                    : <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void act(c.id, () => watchChannel(c.id), `Now watching ${c.title}.`)}>{busy === c.id ? "Adding" : "Watch"}</button>}
                </div>
              ))}
            </div>
          )
        ) : null}
      </form>

      {error ? <div style={{ marginTop: 16 }}><ErrorNote error={error} /></div> : null}

      <section className="section">
        <div className="section-head"><h2>You and the channels you watch</h2></div>
        <div className={`panel${watched.isFetching ? " fade" : ""}`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="num">Subscribers</th>
                  <th className="num">Usual views, long-form</th>
                  <th className="num">Usual views, Shorts</th>
                  <th className="num wide">Long-form in 30 days</th>
                  <th className="num wide">Shorts in 30 days</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: "var(--accent-soft)" }}>
                  <td><strong>{me.data?.title ?? "Your channel"}</strong> <span className="tag">You</span></td>
                  <td className="num fig" style={{ fontSize: 16 }}>{compact(me.data?.subscribers)}</td>
                  <td className="num">{complete ? compact(mine("long")?.typical_views) : "–"}</td>
                  <td className="num">{complete ? compact(mine("short")?.typical_views) : "–"}</td>
                  <td className="num wide">{whole(mine("long")?.uploads_30d ?? 0)}</td>
                  <td className="num wide">{whole(mine("short")?.uploads_30d ?? 0)}</td>
                </tr>
                {channels.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="clickable" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td>
                        <button type="button" className="th-sort" aria-expanded={open === c.id} style={{ fontWeight: 600, color: "var(--ink)" }} onClick={(e) => { e.stopPropagation(); setOpen(open === c.id ? null : c.id); }}>
                          {c.title}
                        </button>
                        <div className="small muted">{c.handle}</div>
                      </td>
                      <td className="num fig" style={{ fontSize: 16 }}>{c.subscribers_hidden ? "Hidden" : compact(c.subscribers)}</td>
                      <td className="num">{compact(c.typical_long)}</td>
                      <td className="num">{compact(c.typical_short)}</td>
                      <td className="num wide">{whole(c.uploads_30d_long ?? 0)}</td>
                      <td className="num wide">{whole(c.uploads_30d_short ?? 0)}</td>
                    </tr>
                    {open === c.id ? (
                      <tr>
                        <td colSpan={6} style={{ background: "var(--surface-2)" }}>
                          <div className="stack">
                            <div className="row-wrap">
                              <a className="btn btn-small" href={`https://www.youtube.com/channel/${c.id}`} target="_blank" rel="noreferrer"><Icon name="external" />Open channel</a>
                              <button type="button" className="btn btn-small" disabled={!connected || busy !== null} onClick={() => void act(`r${c.id}`, () => refreshChannel(c.id), "Refreshed.")}><Icon name="refresh" />{busy === `r${c.id}` ? "Refreshing" : "Refresh now"}</button>
                              <button type="button" className="btn btn-small btn-danger" disabled={busy !== null} onClick={() => void act(`s${c.id}`, () => stopWatchingChannel(c.id), `Stopped watching ${c.title}.`)}>Stop watching</button>
                              <span className="small muted">Updated {ago(c.baseline_long_at ?? c.baseline_short_at)}</span>
                            </div>
                            <RecentList title="Their best recent uploads" items={[...scored(c, "long"), ...scored(c, "short")].sort((a, b) => b.score - a.score).slice(0, 6)} />
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {channels.length === 0 ? (
            <div className="empty">
              <h3>No channels yet</h3>
              <p>Add channels that make what you make, ideally a few near your size and a few bigger. Each one is measured like yours, so you can see whose uploads are beating their usual.</p>
            </div>
          ) : null}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Usual views is the middle value of a channel's last 30 uploads in that format.
          {!complete ? " Yours show once YouTube has loaded every upload." : ""}
        </p>
      </section>

      {breakouts.length ? (
        <section className="section">
          <div className="section-head"><h2>Breaking out on channels you watch</h2><span className="small muted">Last 90 days, at least twice their usual</span></div>
          <div className="panel"><RecentList items={breakouts} showChannel /></div>
        </section>
      ) : null}
    </>
  );
}

function RecentList({ title, items, showChannel = false }: { title?: string; items: Breakout[]; showChannel?: boolean }) {
  if (items.length === 0) return title ? <p className="soft small">No recent uploads stored for this channel yet.</p> : null;
  return (
    <div>
      {title ? <h3 style={{ marginBottom: 4 }}>{title}</h3> : null}
      {items.map((u) => (
        <div className="item" key={u.id} style={showChannel ? undefined : { paddingLeft: 0, paddingRight: 0 }}>
          <a href={link(u.id, u.format)} target="_blank" rel="noreferrer" aria-label={`Open "${u.title}" on YouTube`}><Thumb src={thumb(u.id)} seconds={u.duration_s} small /></a>
          <div className="grow">
            <a className="title clip2" href={link(u.id, u.format)} target="_blank" rel="noreferrer" style={{ color: "var(--ink)", textDecoration: "none" }}>{u.title}</a>
            <div className="meta row-wrap">
              <FormatTag format={u.format} />
              <span>{showChannel ? `${u.channel}, ` : ""}{compact(u.views)} views, {ago(u.published_at)}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                type="button" className="btn btn-small"
                onClick={() => {
                  setPendingIdea({
                    title: u.title, format: u.format, discovery: "recommended", inspiration_url: link(u.id, u.format), source: "research",
                    notes: `Inspired by ${u.channel}: ${compact(u.views)} views, ${u.score}x their usual. Make it yours: new angle, your own title.`,
                  });
                  navigate("/ideas");
                }}
              >
                Make it an idea
              </button>
            </div>
          </div>
          <Mult value={u.score} />
        </div>
      ))}
    </div>
  );
}
