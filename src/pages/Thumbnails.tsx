// Thumbnail references: other people's thumbnails that are working, inside the owner's games and
// outside them, and the ones the owner keeps with an idea while making their own.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Drawer, ErrorNote, Icon, Loading, Mult, Segmented, useNear, useToast } from "../components/ui.tsx";
import {
  addIdeaRef, findOutsideThumbs, getIdeaCheckVideos, getIdeaRefs, getThumbGallery, type IdeaRef, lookupVideo, patchIdeaRef,
} from "../lib/api.ts";
import { setPendingIdea } from "../lib/draft.ts";
import { ago, compact, multiple } from "../lib/format.ts";
import { useChannel, useIdeas, useVideos } from "../lib/hooks.ts";
import { navigate } from "../lib/router.ts";
import { currentGames, type GalleryFilter, galleryItems, type GalleryItem, gameOfThumb, ytThumb } from "../lib/thumbs.ts";
import type { Idea, IdeaDraft, RefInput } from "../lib/types.ts";

const todayIso = () => new Date().toISOString().slice(0, 10);
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");
export const refsKey = ["idea-refs"];
const galleryKey = ["thumb-gallery"];

export const useThumbGallery = () => useQuery({ queryKey: galleryKey, queryFn: getThumbGallery, staleTime: 5 * 60_000 });
export const useIdeaRefs = () => useQuery({ queryKey: refsKey, queryFn: getIdeaRefs, staleTime: 60_000 });

/** A found video in the shape an idea keeps. */
export const refFrom = (v: { id?: string; video_id?: string; title: string | null; channel_title?: string | null; channel?: string | null; channel_subscribers?: number | null; subscribers?: number | null; views: number | null; outlier_score?: number | null; score?: number | null; published_at?: string | null; published?: string | null }): RefInput => ({
  video_id: (v.video_id ?? v.id)!,
  title: v.title,
  channel_title: v.channel_title ?? v.channel ?? null,
  channel_subscribers: v.channel_subscribers ?? v.subscribers ?? null,
  views: v.views,
  outlier_score: v.outlier_score ?? v.score ?? null,
  published_at: v.published_at ?? v.published ?? null,
});

/**
 * A thumbnail, loaded only while it is on or near the screen. A large one tries YouTube's sharpest
 * picture first; a missing one comes back as a small grey placeholder, which counts as missing.
 */
export function WideThumb({ id, size = "small", className }: { id: string; size?: "small" | "medium" | "large"; className?: string }) {
  const [ref, near] = useNear<HTMLSpanElement>();
  const [failed, setFailed] = useState(0);
  const sources = ytThumb(id, size);
  const src = sources[Math.min(failed, sources.length - 1)];
  return (
    <span ref={ref} className={`wide-thumb${className ? ` ${className}` : ""}`}>
      {near || size === "large" ? (
        <img
          key={src} src={src} alt="" decoding="async"
          onError={() => setFailed((n) => Math.min(n + 1, sources.length - 1))}
          onLoad={(e) => { if (e.currentTarget.naturalWidth <= 120 && failed < sources.length - 1) setFailed((n) => n + 1); }}
        />
      ) : null}
    </span>
  );
}

const subs = (n: number | null) => (n === null ? null : `${compact(n)} subscribers`);

function ThumbCard({ item, onOpen, onIdeas }: { item: GalleryItem; onOpen: () => void; onIdeas: number }) {
  return (
    <button type="button" className="thumb-card" onClick={onOpen}>
      <span className="thumb-card-pic">
        <WideThumb id={item.id} />
        <span className="thumb-card-mult"><Mult value={item.outlier_score} title={`${multiple(item.outlier_score)} the usual views on its channel`} /></span>
      </span>
      <span className="thumb-card-title clip2">{item.title}</span>
      <span className="small muted clip">{item.channel_title}{item.channel_subscribers !== null ? `, ${compact(item.channel_subscribers)}` : ""}</span>
      <span className="small muted">
        {compact(item.views)} views, {ago(item.published_at)}
        {onIdeas ? <span className="tag" style={{ marginLeft: 6 }}>On {onIdeas === 1 ? "an idea" : `${onIdeas} ideas`}</span> : null}
      </span>
    </button>
  );
}

/** A big look at one thumbnail, with a way to keep it on an idea or start one from it. */
function ThumbDetail({ item, games, onClose }: { item: GalleryItem; games: string[]; onClose: () => void }) {
  const ideas = useIdeas();
  const refs = useIdeaRefs();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const open = (ideas.data ?? []).filter((i) => i.status !== "published");
  const onIdea = new Set((refs.data ?? []).filter((r) => r.video_id === item.id).map((r) => r.idea_id));
  // The ideas on this video's game first: that is where a reference is most likely to go.
  const same = item.game ? open.filter((i) => i.topic?.trim() === item.game) : [];
  const rest = open.filter((i) => !same.includes(i));
  const add = async (idea: Idea) => {
    setBusy(idea.id);
    try {
      await addIdeaRef(idea.id, refFrom(item));
      await queryClient.invalidateQueries({ queryKey: refsKey });
      toast(`Added to "${idea.title}".`);
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(null);
  };
  const start = () => {
    setPendingIdea({ title: "", format: "long", status: "idea", priority: 2, title_options: [], discovery: null, topic: item.game ?? games[0] ?? null, pending_refs: [refFrom(item)] } as IdeaDraft);
    navigate("/ideas");
  };
  const row = (idea: Idea) => (
    <div key={idea.id} className="row between" style={{ gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="clip grow" style={{ minWidth: 0 }}>{idea.title}</span>
      {onIdea.has(idea.id)
        ? <span className="small muted" style={{ flex: "none" }}>Added</span>
        : <button type="button" className="btn btn-small" style={{ flex: "none" }} disabled={busy !== null} onClick={() => void add(idea)}>{busy === idea.id ? "Adding" : "Add"}</button>}
    </div>
  );
  return (
    <Drawer
      title="Thumbnail" onClose={onClose}
      footer={(
        <>
          <a className="btn" href={`https://www.youtube.com/watch?v=${item.id}`} target="_blank" rel="noreferrer"><Icon name="external" />Open on YouTube</a>
          <button type="button" className="btn btn-primary" onClick={start}><Icon name="plus" />New idea from it</button>
        </>
      )}
    >
      <WideThumb id={item.id} size="large" className="thumb-large" />
      <div>
        <h3 style={{ margin: "0 0 4px" }}>{item.title}</h3>
        <div className="small muted">{[item.channel_title, subs(item.channel_subscribers)].filter(Boolean).join(", ")}</div>
      </div>
      <div className="kv">
        <div><div className="k">Against its channel's usual</div><div className="v fig">{multiple(item.outlier_score)}</div></div>
        <div><div className="k">Views</div><div className="v fig">{compact(item.views)}</div></div>
        <div><div className="k">Posted</div><div className="v">{ago(item.published_at)}</div></div>
        <div><div className="k">Game</div><div className="v">{item.game ?? "Outside your games"}</div></div>
      </div>
      <div className="field">
        <span>Keep it with an idea</span>
        {open.length === 0 ? <small>You have no open ideas. Start one from this thumbnail with the button below.</small> : null}
        {same.length ? <><small>Your {item.game} ideas</small>{same.map(row)}</> : null}
        {rest.length ? (
          showAll || same.length === 0 ? <>{same.length ? <small style={{ marginTop: 8 }}>Other ideas</small> : null}{rest.map(row)}</>
            : <div><button type="button" className="btn btn-quiet btn-small" onClick={() => setShowAll(true)}>Show your other {rest.length} ideas</button></div>
        ) : null}
      </div>
    </Drawer>
  );
}

let askedOutside = false;

/** The Thumbnails tab in Research. */
export function Thumbnails({ connected }: { connected: boolean }) {
  const gallery = useThumbGallery();
  const videos = useVideos();
  const ideas = useIdeas();
  const channel = useChannel();
  const refs = useIdeaRefs();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<GalleryFilter>({ where: "mine", game: null, days: 90, small: false, sort: "jump" });
  const [open, setOpen] = useState<GalleryItem | null>(null);
  const [shown, setShown] = useState(40);
  const [looking, setLooking] = useState<string | null>(null);
  const today = todayIso();
  const games = useMemo(() => currentGames(videos.data ?? [], ideas.data ?? [], today), [videos.data, ideas.data, today]);
  const items = useMemo(() => galleryItems(gallery.data ?? [], games, filter, today, channel.data?.id ?? null), [gallery.data, games, filter, today, channel.data?.id]);
  const outsideCount = useMemo(
    () => galleryItems(gallery.data ?? [], games, { ...filter, where: "outside", game: null, small: false, days: 90 }, today, channel.data?.id ?? null).length,
    [gallery.data, games, filter, today, channel.data?.id],
  );
  const onIdeas = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of refs.data ?? []) n.set(r.video_id, (n.get(r.video_id) ?? 0) + 1);
    return n;
  }, [refs.data]);
  // Little from outside the owner's games yet: search one more kind of video now. The sync does the rest over the next days.
  useEffect(() => {
    if (!connected || !gallery.data || askedOutside || outsideCount >= 12) return;
    askedOutside = true;
    setLooking("Looking for thumbnails that are working outside your games.");
    findOutsideThumbs().then(
      (out) => {
        setLooking(out.skipped ? `The search outside your games could not run: ${out.skipped}` : null);
        void queryClient.invalidateQueries({ queryKey: galleryKey });
      },
      (err) => setLooking(`The search outside your games could not run: ${message(err)}`),
    );
  }, [connected, gallery.data, outsideCount, queryClient]);

  if (gallery.isLoading) return <Loading label="Loading thumbnails" />;
  if (gallery.error) return <ErrorNote error={gallery.error} retry={() => void gallery.refetch()} />;
  const set = (change: Partial<GalleryFilter>) => { setFilter((f) => ({ ...f, ...change })); setShown(40); };
  return (
    <>
      <div className="stack" style={{ gap: 10, marginBottom: 16 }}>
        <Segmented
          label="Whose thumbnails" value={filter.where} onChange={(where) => set({ where, game: null })}
          options={[{ value: "mine", label: "Your games" }, { value: "outside", label: "Other games" }, { value: "all", label: "All" }]}
        />
        <div className="toolbar">
          {filter.where === "mine" && games.length > 1 ? (
            <select className="select input" value={filter.game ?? ""} onChange={(e) => set({ game: e.target.value || null })} aria-label="Game">
              <option value="">All your games</option>
              {games.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          ) : null}
          <select className="select input" value={String(filter.days)} onChange={(e) => set({ days: Number(e.target.value) })} aria-label="Posted in the last">
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
          <select className="select input" value={filter.sort} onChange={(e) => set({ sort: e.target.value as GalleryFilter["sort"] })} aria-label="Order">
            <option value="jump">Biggest jump</option>
            <option value="newest">Newest</option>
          </select>
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={filter.small} onChange={(e) => set({ small: e.target.checked })} />
            Channels under 50K
          </label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Long-form videos that did at least 3x their channel's usual. The dashboard finds them by itself. Shorts are left out.
        </p>
        {looking ? <p className="small muted row" style={{ gap: 8, margin: 0 }}>{looking.startsWith("Looking") ? <span className="spin" /> : null}{looking}</p> : null}
      </div>
      {items.length === 0 ? (
        <div className="panel"><div className="empty">
          <h3>Nothing here yet</h3>
          <p>{filter.where === "outside" ? "Thumbnails from outside your games fill in over the next few syncs." : "Try a longer time span, or turn off the channel size filter. More fill in after each sync."}</p>
        </div></div>
      ) : (
        <>
          <div className="thumb-grid">
            {items.slice(0, shown).map((item) => <ThumbCard key={item.id} item={item} onOpen={() => setOpen(item)} onIdeas={onIdeas.get(item.id) ?? 0} />)}
          </div>
          {items.length > shown ? <div style={{ marginTop: 16 }}><button type="button" className="btn" onClick={() => setShown((n) => n + 40)}>Show more ({items.length - shown} left)</button></div> : null}
        </>
      )}
      {open ? <ThumbDetail item={open} games={games} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// In an idea
// ---------------------------------------------------------------------------

/** Small references on an idea's card on the board. */
export function RefStrip({ refs }: { refs: IdeaRef[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="ref-strip" aria-label={`${refs.length} thumbnail ${refs.length === 1 ? "reference" : "references"}`}>
      {refs.slice(0, 3).map((r) => <WideThumb key={r.id} id={r.video_id} />)}
      {refs.length > 3 ? <span className="small muted">+{refs.length - 3}</span> : null}
    </div>
  );
}

type Tile = RefInput & { note?: string; match?: string };

/** Picks references for an idea: from its own check, from its game, from outside the niche, or a pasted link. */
function RefPicker(props: { idea: IdeaDraft; have: Set<string>; onAdd: (ref: RefInput) => Promise<void>; onClose: () => void }) {
  const gallery = useThumbGallery();
  const videos = useVideos();
  const ideas = useIdeas();
  const channel = useChannel();
  const toast = useToast();
  const game = props.idea.topic?.trim() || null;
  const check = useQuery({ queryKey: ["idea-check-videos", props.idea.id], queryFn: () => getIdeaCheckVideos(props.idea.id!), enabled: Boolean(props.idea.id) });
  // Open on the idea's own search results when it has them, else on its game, else outside the niche.
  const [chosen, setChosen] = useState<"check" | "game" | "outside" | null>(null);
  const hasCheck = (check.data ?? []).length > 0;
  const tab = chosen ?? (hasCheck ? "check" : game ? "game" : "outside");
  const setTab = (v: "check" | "game" | "outside") => setChosen(v);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState(12);
  const today = todayIso();
  const games = useMemo(() => currentGames(videos.data ?? [], ideas.data ?? [], today), [videos.data, ideas.data, today]);
  const base: GalleryFilter = { where: "all", game: null, days: 365, small: false, sort: "jump" };
  const tiles: Tile[] = useMemo(() => {
    if (tab === "check") {
      return [...(check.data ?? [])].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        .map((v) => ({ ...refFrom(v), match: v.match === "same" ? "Same idea" : "Same kind of video" }));
    }
    const rows = (gallery.data ?? []).filter((r) => r.channel_id !== (channel.data?.id ?? null));
    const pool = galleryItems(rows, games, base, today, channel.data?.id ?? null);
    return (tab === "game" ? pool.filter((r) => game && gameOfThumb(r, [game]) === game) : pool.filter((r) => r.game === null)).map((r) => refFrom(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, check.data, gallery.data, games, game, today, channel.data?.id]);
  const add = async (ref: RefInput) => {
    setBusy(ref.video_id);
    try {
      await props.onAdd(ref);
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(null);
  };
  const paste = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("link");
    try {
      const { item } = await lookupVideo(link.trim());
      await props.onAdd(refFrom(item));
      setLink("");
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(null);
  };
  const tabs = [
    ...(hasCheck ? [{ value: "check" as const, label: "This idea on YouTube" }] : []),
    ...(game ? [{ value: "game" as const, label: game }] : []),
    { value: "outside" as const, label: "Outside your games" },
  ];
  return (
    <div className="ref-picker">
      <div className="row between" style={{ gap: 8 }}>
        <strong>Add references</strong>
        <button type="button" className="btn btn-quiet btn-small" onClick={props.onClose}>Close</button>
      </div>
      <Segmented label="Where from" value={tab} onChange={(v) => { setTab(v); setShown(12); }} options={tabs} />
      <small className="muted">
        {tab === "check" ? "The videos the dashboard found when it searched YouTube for this idea, best against their channel's usual first."
          : tab === "game" ? `Long-form ${game} videos that did at least 3x their channel's usual.`
          : "Challenge videos on other games that did at least 3x their channel's usual."}
      </small>
      {tab === "check" && check.isLoading ? <Loading label="Loading" /> : null}
      {tiles.length === 0 && !(tab === "check" && check.isLoading) ? (
        <small>{tab === "check" ? "This idea has not been checked against YouTube yet. It fills in by itself within a few minutes of saving." : "Nothing here yet. More fill in after each sync."}</small>
      ) : (
        <div className="thumb-grid compact">
          {tiles.slice(0, shown).map((t) => (
            <div key={t.video_id} className="thumb-card as-tile">
              <a className="thumb-card-pic" href={`https://www.youtube.com/watch?v=${t.video_id}`} target="_blank" rel="noreferrer" aria-label={`Open "${t.title}" on YouTube`}>
                <WideThumb id={t.video_id} />
                {t.outlier_score !== null ? <span className="thumb-card-mult"><Mult value={t.outlier_score} /></span> : null}
              </a>
              <span className="thumb-card-title clip2">{t.title}</span>
              <span className="small muted clip">{t.match ? `${t.match}, ` : ""}{t.channel_title}</span>
              {props.have.has(t.video_id)
                ? <span className="small muted">Added</span>
                : <button type="button" className="btn btn-small" disabled={busy !== null} onClick={() => void add(t)}>{busy === t.video_id ? "Adding" : "Add"}</button>}
            </div>
          ))}
        </div>
      )}
      {tiles.length > shown ? <div><button type="button" className="btn btn-quiet btn-small" onClick={() => setShown((n) => n + 12)}>Show more</button></div> : null}
      <form className="row-wrap" style={{ gap: 6 }} onSubmit={paste}>
        <input className="input grow" style={{ minWidth: 180 }} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Or paste a YouTube link" aria-label="YouTube link" inputMode="url" />
        <button type="submit" className="btn btn-small" disabled={busy !== null || !link.trim()}>{busy === "link" ? "Adding" : "Add"}</button>
      </form>
    </div>
  );
}

/**
 * The thumbnail references inside the idea editor. A saved idea keeps them straight away; a new
 * one holds them until it is saved.
 */
export function IdeaRefs(props: { idea: IdeaDraft; onPending: (refs: RefInput[]) => void }) {
  const refs = useIdeaRefs();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [big, setBig] = useState<string | null>(null);
  const saved = props.idea.id ? (refs.data ?? []).filter((r) => r.idea_id === props.idea.id) : [];
  const pending = props.idea.pending_refs ?? [];
  const list: (RefInput & { id?: string; note?: string | null })[] = [...saved, ...pending];
  const have = new Set(list.map((r) => r.video_id));
  const reload = () => queryClient.invalidateQueries({ queryKey: refsKey });
  const add = async (ref: RefInput) => {
    if (have.has(ref.video_id)) return;
    if (props.idea.id) {
      await addIdeaRef(props.idea.id, ref);
      await reload();
    } else props.onPending([...pending, ref]);
  };
  const remove = async (r: RefInput & { id?: string }) => {
    if (!r.id) return props.onPending(pending.filter((p) => p.video_id !== r.video_id));
    try {
      await patchIdeaRef(r.id, { trashed_at: new Date().toISOString() });
      await reload();
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
  const note = async (id: string, value: string, before: string | null) => {
    if ((value.trim() || null) === (before ?? null)) return;
    try {
      await patchIdeaRef(id, { note: value.trim() || null });
      await reload();
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
  return (
    <div className="field">
      <span>Thumbnail references</span>
      {list.length === 0 && !picking ? <small>Other people's thumbnails to look at while you make yours. Tap Add references to pick some.</small> : null}
      {list.length ? (
        <div className="ref-list">
          {list.map((r) => (
            <div key={r.video_id} className={`ref-item${big === r.video_id ? " open" : ""}`}>
              <button type="button" className="ref-pic" onClick={() => setBig(big === r.video_id ? null : r.video_id)} aria-label={big === r.video_id ? "Show smaller" : "Show larger"}>
                <WideThumb id={r.video_id} size={big === r.video_id ? "large" : "small"} />
              </button>
              <div className="ref-info">
                <div className="clip2" style={{ fontWeight: 600, lineHeight: 1.3 }}>{r.title}</div>
                <div className="small muted clip">
                  {r.channel_title}{r.outlier_score !== null ? `, ${multiple(r.outlier_score)} its channel's usual` : ""}{r.id ? "" : ". Kept when the idea is saved"}
                </div>
                {r.id ? (
                  <input
                    className="input ref-note" defaultValue={r.note ?? ""} placeholder="What to take from it" aria-label={`What to take from "${r.title}"`} maxLength={300}
                    onBlur={(e) => void note(r.id!, e.target.value, r.note ?? null)}
                  />
                ) : null}
                <div className="row" style={{ gap: 4 }}>
                  <a className="btn btn-quiet btn-small" href={`https://www.youtube.com/watch?v=${r.video_id}`} target="_blank" rel="noreferrer">Open</a>
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => void remove(r)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {picking
        ? <RefPicker idea={props.idea} have={have} onAdd={add} onClose={() => setPicking(false)} />
        : <div><button type="button" className="btn btn-small" onClick={() => setPicking(true)}><Icon name="plus" />Add references</button></div>}
    </div>
  );
}

