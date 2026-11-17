import { useQueryClient } from "@tanstack/react-query";
import { IDEA_TABS, Tabs } from "./Growth.tsx";
import { ScoreChips, ScorePanel, TitleHelper, useFound, useIdeaScores } from "./Pulse.tsx";
import { scoreIdea } from "../lib/ideaScore.ts";
import { ImportIdeas, TemplateHint, TemplateScore } from "./Templates.tsx";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Drawer, ErrorNote, FormatTag, Icon, Loading, Mult, Segmented, useToast } from "../components/ui.tsx";
import { saveIdea, setIdeaTrashed } from "../lib/api.ts";
import { takePendingIdea } from "../lib/draft.ts";
import { compact, day } from "../lib/format.ts";
import { keys, useIdeas, useSavedVideos, useVideos } from "../lib/hooks.ts";
import { navigate, useRoute } from "../lib/router.ts";
import type { Idea, IdeaDraft, IdeaStatus } from "../lib/types.ts";

const STATUSES: { key: IdeaStatus; label: string }[] = [
  { key: "idea", label: "Ideas" },
  { key: "scripting", label: "Scripting" },
  { key: "filming", label: "Filming" },
  { key: "editing", label: "Editing" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];
const next = (status: IdeaStatus) => STATUSES[STATUSES.findIndex((s) => s.key === status) + 1] ?? null;

const blank = (format: "long" | "short"): IdeaDraft => ({ title: "", format, status: "idea", priority: 2, title_options: [], discovery: null });

export function Ideas() {
  const ideas = useIdeas();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "long" | "short">("all");
  const [quick, setQuick] = useState("");
  const [quickFormat, setQuickFormat] = useState<"long" | "short">("long");
  const [editing, setEditingDraft] = useState<IdeaDraft | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  // Every open gets a fresh editor, so one idea's half-typed text never leaks into the next.
  const setEditing = (draft: IdeaDraft | null) => {
    setEditorKey((k) => k + 1);
    setEditingDraft(draft);
  };

  // An idea started on another screen (research) opens straight in the editor.
  useEffect(() => {
    const pending = takePendingIdea();
    if (pending) setEditing({ ...blank(pending.format ?? "long"), ...pending });
  }, []);

  // The planner links straight to an idea.
  const route = useRoute();
  const editId = route.query.get("edit");
  useEffect(() => {
    const idea = editId ? ideas.data?.find((i) => i.id === editId) : undefined;
    if (!idea) return;
    setEditing(idea);
    navigate("/ideas", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, ideas.data]);

  const reload = () => queryClient.invalidateQueries({ queryKey: keys.ideas });
  const scores = useIdeaScores(ideas.data ?? []);
  const [order, setOrder] = useState<"priority" | "history" | "recommended">("priority");
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<"stage" | "game">(() => {
    try { return localStorage.getItem("yt-ideas-view") === "game" ? "game" : "stage"; } catch { return "stage"; }
  });
  const videos = useVideos();
  // Every game there is to file an idea under: the ones ideas already use, then the channel's own, most covered first.
  const games = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of videos.data ?? []) if (v.topic) counts.set(v.topic, (counts.get(v.topic) ?? 0) + 1);
    const mine = [...new Set((ideas.data ?? []).map((i) => i.topic).filter((t): t is string => Boolean(t)))];
    return [...mine, ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).filter((g) => !mine.includes(g))];
  }, [videos.data, ideas.data]);
  /** The section an idea sits under: the game it was filed under, else the one its wording points to. */
  const sectionOf = (idea: Idea) => idea.topic?.trim() || scores.get(idea.id)?.game || null;
  const list = useMemo(() => (ideas.data ?? []).filter((i) => filter === "all" || i.format === filter), [ideas.data, filter]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!quick.trim()) return;
    setBusy(true);
    try {
      await saveIdea({ ...blank(quickFormat), title: quick });
      setQuick("");
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add the idea.", { error: true });
    }
    setBusy(false);
  };

  const advance = async (idea: Idea) => {
    const to = next(idea.status);
    if (!to) return;
    try {
      await saveIdea({ id: idea.id, title: idea.title, status: to.key });
      await reload();
      toast(`Moved to ${to.label}.`, { action: { label: "Undo", run: () => void saveIdea({ id: idea.id, title: idea.title, status: idea.status }).then(reload) } });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not move the idea.", { error: true });
    }
  };

  const card = (idea: Idea, withStage: boolean) => {
    const to = next(idea.status);
    return (
                    <div className="idea" key={idea.id} onClick={() => setEditing(idea)}>
                      <button type="button" className="th-sort title" style={{ color: "var(--ink)", textAlign: "left" }} onClick={(e) => { e.stopPropagation(); setEditing(idea); }}>
                        {idea.title}
                      </button>
                      {idea.hook ? <div className="hook clip2">{idea.hook}</div> : null}
                      {idea.status !== "published" ? <ScoreChips scores={scores.get(idea.id)} templates={idea.template_check?.score ?? null} /> : null}
                      <div className="foot">
                        <FormatTag format={idea.format} />
                        {withStage ? <span className="tag">{STATUSES.find((x) => x.key === idea.status)?.label}</span> : null}
                        {!withStage && sectionOf(idea) ? <span className="tag">{sectionOf(idea)}</span> : null}
                        {idea.discovery === "search" ? <span className="tag">For search{idea.target_keyword ? `: ${idea.target_keyword}` : ""}</span> : null}
                        {idea.discovery === "recommended" ? <span className="tag">For the feed</span> : null}
                        {idea.priority === 1 ? <span className="tag" style={{ borderColor: "var(--note-line)", background: "var(--note-bg)", color: "var(--note-ink)" }}>High priority</span> : null}
                        {idea.target_date ? <span className="small muted">Due {day(idea.target_date)}</span> : null}
                      </div>
                      {to ? (
                        <div className="idea-move">
                          <button type="button" className="btn btn-quiet btn-small" style={{ paddingLeft: 0 }} onClick={(e) => { e.stopPropagation(); void advance(idea); }}>
                            Move to {to.label}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
  };
  const rank = (x: Idea) => (order === "priority" ? 0 : -(scores.get(x.id)?.[order].value ?? -1));
  const sorted = (cards: Idea[]) => [...cards].sort((a, b) => rank(a) - rank(b) || a.priority - b.priority || a.sort_order - b.sort_order);
  // By game: one section per game, the ones with the most open ideas first, unfiled ideas last.
  const stageOf = (i: Idea) => STATUSES.findIndex((x) => x.key === i.status);
  const sections = useMemo(() => {
    const groups = new Map<string, Idea[]>();
    for (const idea of list) {
      const key = sectionOf(idea) ?? "";
      groups.set(key, [...(groups.get(key) ?? []), idea]);
    }
    return [...groups.entries()].sort((x, y) => Number(x[0] === "") - Number(y[0] === "") || y[1].length - x[1].length || x[0].localeCompare(y[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, scores]);

  if (ideas.isLoading) return <Loading label="Loading your ideas" />;
  if (ideas.error) return <ErrorNote error={ideas.error} retry={() => void ideas.refetch()} />;

  return (
    <>
      <div className="page-head">
        <h1>Ideas</h1>
        <Segmented
          label="Format" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "long", label: "Long-form" }, { value: "short", label: "Shorts" }]}
        />
      </div>
      <Tabs label="Ideas" base="/ideas" current="" tabs={IDEA_TABS} />
      <div className="row-wrap" style={{ marginBottom: 12, gap: 10 }}>
        <span className="small muted">Group by</span>
        <Segmented
          label="Group ideas by" value={view} onChange={(v) => { setView(v); try { localStorage.setItem("yt-ideas-view", v); } catch { /* private mode */ } }}
          options={[{ value: "stage", label: "Stage" }, { value: "game", label: "Game" }]}
        />
      </div>
      {(ideas.data ?? []).length > 1 ? (
        <div className="row-wrap" style={{ marginBottom: 14, gap: 10 }}>
          <span className="small muted">Order by</span>
          <Segmented
            label="Order ideas by" value={order} onChange={setOrder}
            options={[{ value: "priority", label: "My priority" }, { value: "history", label: "Your history" }, { value: "recommended", label: "Recommended" }]}
          />
        </div>
      ) : null}

      <form className="quick-add" onSubmit={add} style={{ marginBottom: 22 }}>
        <input className="input" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="A video you could make" aria-label="New idea title" maxLength={200} />
        <Segmented
          label="Format of the new idea" value={quickFormat} onChange={setQuickFormat}
          options={[{ value: "long", label: "Long-form" }, { value: "short", label: "Short" }]}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !quick.trim()}><Icon name="plus" />Add idea</button>
        <button type="button" className="btn" onClick={() => setEditing(blank(quickFormat))}>Write one out in full</button>
        <button type="button" className="btn" onClick={() => setImporting(true)}>Import from Claude</button>
      </form>

      {(ideas.data ?? []).length === 0 ? (
        <div className="panel">
          <div className="empty">
            <h3>No ideas yet</h3>
            <p>Add one above, or go to Research and turn a video that broke out, or a search phrase worth chasing, into an idea.</p>
            <p style={{ marginTop: 10 }}><a href="#/research">Open Research</a></p>
          </div>
        </div>
      ) : view === "game" ? (
        <div className={`stack${ideas.isFetching ? " fade" : ""}`} style={{ gap: 22 }}>
          {sections.map(([game, cards]) => (
            <section key={game || "none"} aria-label={game || "No game yet"}>
              <div className="section-head">
                <h2>{game || "No game yet"}</h2>
                <span className="small muted">{cards.length} {cards.length === 1 ? "idea" : "ideas"}</span>
              </div>
              {game ? null : <p className="small muted" style={{ margin: "0 0 8px" }}>Open an idea and choose its game to file it under a section.</p>}
              <div className="game-ideas">
                {sorted(cards).sort((a, b) => (order === "priority" ? stageOf(a) - stageOf(b) : 0)).map((idea) => card(idea, true))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={`board${ideas.isFetching ? " fade" : ""}`}>
          {STATUSES.map((status) => {
            const cards = sorted(list.filter((i) => i.status === status.key));
            return (
              <section className="column" key={status.key} aria-label={status.label}>
                <div className="column-head"><h3>{status.label}</h3><span className="n">{cards.length}</span></div>
                {cards.map((idea) => card(idea, false))}
                {cards.length === 0 ? <p className="small muted" style={{ padding: "2px 2px 10px" }}>Nothing here.</p> : null}
              </section>
            );
          })}
        </div>
      )}

      {importing ? <ImportIdeas onClose={() => setImporting(false)} onAdded={() => void reload()} /> : null}
      {editing ? <IdeaEditor key={editorKey} draft={editing} games={games} onClose={() => setEditing(null)} onChanged={reload} onOpen={setEditing} /> : null}
    </>
  );
}

function IdeaEditor(props: { draft: IdeaDraft; games: string[]; onClose: () => void; onChanged: () => Promise<void>; onOpen: (draft: IdeaDraft) => void }) {
  const toast = useToast();
  const videos = useVideos();
  const saved = useSavedVideos();
  const [form, setForm] = useState<IdeaDraft>(props.draft);
  const [dirty, setDirty] = useState(!props.draft.id && Boolean(props.draft.title));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof IdeaDraft>(key: K, value: IdeaDraft[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };
  const text = (key: "hook" | "concept" | "outline" | "thumbnail_concept" | "target_keyword" | "inspiration_url" | "notes") =>
    ({ value: form[key] ?? "", onChange: (e: { target: { value: string } }) => set(key, e.target.value || null) });

  const close = () => {
    if (!dirty || window.confirm("Close without saving your changes?")) props.onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveIdea({ ...form, title_options: (form.title_options ?? []).map((t) => t.trim()).filter(Boolean) });
      await props.onChanged();
      toast("Idea saved.");
      props.onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save the idea.", { error: true });
    }
    setSaving(false);
  };

  const bin = async () => {
    if (!form.id) return;
    const id = form.id;
    await setIdeaTrashed(id, true);
    await props.onChanged();
    props.onClose();
    toast("Moved to the bin.", { action: { label: "Undo", run: () => void setIdeaTrashed(id, false).then(props.onChanged) } });
  };

  const title = form.title ?? "";
  const bare = title.replace(/\s*#\S+/g, "").trim();
  const hashtags = (title.match(/#\S+/g) ?? []).length;
  const inspiration = saved.data?.find((v) => v.id === form.inspiration_video_id);
  const options = form.title_options ?? [];
  const found = useFound();
  const game = useMemo(
    () => scoreIdea({ title, format: form.format ?? "long", target_keyword: form.target_keyword ?? null, concept: form.concept ?? null, hook: form.hook ?? null, topic: form.topic ?? null }, videos.data ?? [], found.data ?? [], "2000-01-01").game,
    [title, form.format, form.target_keyword, form.concept, form.hook, form.topic, videos.data, found.data],
  );
  // What the wording alone points to, offered when the idea has not been filed under a game yet.
  const guess = useMemo(
    () => scoreIdea({ title, format: form.format ?? "long", target_keyword: form.target_keyword ?? null, concept: form.concept ?? null, hook: form.hook ?? null }, videos.data ?? [], [], "2000-01-01").game,
    [title, form.format, form.target_keyword, form.concept, form.hook, videos.data],
  );

  return (
    <Drawer
      title={form.id ? "Edit idea" : "New idea"} onClose={close}
      footer={(
        <>
          <div className="row-wrap">
            {form.id ? <button type="button" className="btn btn-danger" onClick={() => void bin()}>Move to bin</button> : null}
            {form.id && form.format === "long" ? (
              <button
                type="button" className="btn"
                onClick={() => props.onOpen({ ...blank("short"), title: `${title} (Short)`, parent_id: form.id, discovery: "recommended" })}
              >
                Make a Short from this
              </button>
            ) : null}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !title.trim()}>
            {saving ? "Saving" : "Save idea"}
          </button>
        </>
      )}
    >
      <label className="field">
        <span>Title</span>
        <input className="input" value={title} onChange={(e) => set("title", e.target.value)} maxLength={200} autoFocus={!form.id} />
        <small>
          {bare.length} characters{bare.length > 70 ? ". YouTube cuts titles off after about 60 to 70, so the end may not show" : ""}
          {hashtags > 3 ? `. ${hashtags} hashtags: only three are shown` : ""}.
        </small>
        <TemplateHint kind="title" />
      </label>

      <label className="field">
        <span>Game or topic</span>
        <input className="input" list="idea-games" value={form.topic ?? ""} onChange={(e) => set("topic", e.target.value || null)} placeholder="Elden Ring" maxLength={80} />
        <datalist id="idea-games">{props.games.map((g) => <option key={g} value={g} />)}</datalist>
        <small>
          The section this idea sits under on the board. Pick one of your games or type a new one.
          {!form.topic && guess ? <> It reads like <button type="button" className="th-sort" style={{ textDecoration: "underline" }} onClick={() => set("topic", guess)}>{guess}</button>: tap to file it there.</> : null}
        </small>
      </label>

      <ScorePanel draft={form} />
      <TemplateScore
        idea={form} dirty={dirty}
        onChecked={(check, at) => { setForm((f) => ({ ...f, template_check: check, template_checked_at: at })); void props.onChanged(); }}
      />

      <div className="field-row">
        <div className="field">
          <span>Format</span>
          <Segmented label="Format" value={form.format ?? "long"} onChange={(v) => set("format", v)} options={[{ value: "long", label: "Long-form" }, { value: "short", label: "Short" }]} />
        </div>
        <label className="field">
          <span>Stage</span>
          <select className="select input" value={form.status ?? "idea"} onChange={(e) => set("status", e.target.value as IdeaStatus)}>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="field">
        <span>Made for</span>
        <Segmented
          label="Made for" value={form.discovery ?? "none"} onChange={(v) => set("discovery", v === "none" ? null : v)}
          options={[{ value: "none", label: "Not decided" }, { value: "recommended", label: "The feed" }, { value: "search", label: "Search" }]}
        />
        <small>
          {form.discovery === "search"
            ? "People typing a phrase into YouTube. The title has to match what they type."
            : form.discovery === "recommended"
              ? "The home page, suggested videos and the Shorts feed. It lives or dies on the hook and the thumbnail."
              : "Is this one meant to be recommended by YouTube, or found by people searching?"}
        </small>
      </div>

      {form.discovery === "search" ? (
        <label className="field">
          <span>Search phrase to rank for</span>
          <input className="input" {...text("target_keyword")} placeholder="elden ring challenge run" maxLength={80} />
          <small>
            {form.target_keyword
              ? <a href={`#/research/keywords?q=${encodeURIComponent(form.target_keyword)}`} onClick={(e) => { if (dirty && !window.confirm("Leave without saving your changes?")) e.preventDefault(); }}>Check this phrase in Research</a>
              : "Use the words someone would actually type."}
          </small>
        </label>
      ) : null}

      <label className="field">
        <span>Hook</span>
        <textarea className="textarea" style={{ minHeight: 60 }} {...text("hook")} placeholder="The first line, or the first five seconds" />
        <TemplateHint kind="intro" />
      </label>
      <label className="field">
        <span>What happens</span>
        <textarea className="textarea" {...text("concept")} placeholder="The challenge, the stakes, how it ends" />
      </label>
      <label className="field">
        <span>Outline or script notes</span>
        <textarea className="textarea" style={{ minHeight: 140 }} {...text("outline")} />
      </label>
      {form.format !== "short" ? (
        <label className="field">
          <span>Thumbnail idea</span>
          <input className="input" {...text("thumbnail_concept")} placeholder="What the picture shows, and the two or three words on it" />
          <TemplateHint kind="thumbnail" />
        </label>
      ) : null}

      <TitleHelper
        draft={form} game={game} kept={options}
        onUse={(t) => { if (title.trim() && !options.includes(title) && options.length < 5) set("title_options", [...options, title]); set("title", t); }}
        onKeep={(t) => set("title_options", [...options, t])}
      />

      <div className="field">
        <span>Other titles to try</span>
        {options.map((option, i) => (
          <div className="row" key={i}>
            <input className="input" value={option} aria-label={`Other title ${i + 1}`} onChange={(e) => set("title_options", options.map((o, j) => (j === i ? e.target.value : o)))} />
            <button type="button" className="btn btn-quiet btn-small" aria-label={`Remove other title ${i + 1}`} onClick={() => set("title_options", options.filter((_, j) => j !== i))}><Icon name="close" /></button>
          </div>
        ))}
        {options.length < 5 ? <div><button type="button" className="btn btn-small" onClick={() => set("title_options", [...options, ""])}><Icon name="plus" />Add a title</button></div> : null}
      </div>

      <div className="field-row">
        <label className="field">
          <span>Aim to post by</span>
          <input className="input" type="date" value={form.target_date ?? ""} onChange={(e) => set("target_date", e.target.value || null)} />
        </label>
        <label className="field">
          <span>Priority</span>
          <select className="select input" value={form.priority ?? 2} onChange={(e) => set("priority", Number(e.target.value))}>
            <option value={1}>High</option>
            <option value={2}>Normal</option>
            <option value={3}>Low</option>
          </select>
        </label>
      </div>

      {inspiration ? (
        <div className="notice plain" style={{ margin: 0 }}>
          <Mult value={inspiration.outlier_score} />
          <span className="grow small">
            Inspired by "{inspiration.title}" from {inspiration.channel_title}, {compact(inspiration.views)} views.
          </span>
        </div>
      ) : null}
      <label className="field">
        <span>Inspiration link</span>
        <input className="input" type="url" {...text("inspiration_url")} placeholder="https://www.youtube.com/watch?v=" />
      </label>

      {form.status === "published" ? (
        <label className="field">
          <span>Which upload did it become?</span>
          <select className="select input" style={{ width: "100%" }} value={form.video_id ?? ""} onChange={(e) => set("video_id", e.target.value || null)}>
            <option value="">Not linked</option>
            {(videos.data ?? []).slice(0, 60).map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
          {form.video_id ? <small><a href={`#/videos?v=${form.video_id}`} onClick={(e) => { e.preventDefault(); if (!dirty || window.confirm("Leave without saving your changes?")) navigate(`/videos?v=${form.video_id}`); }}>See how it did</a></small> : null}
        </label>
      ) : null}

      <label className="field">
        <span>Notes</span>
        <textarea className="textarea" {...text("notes")} />
      </label>
    </Drawer>
  );
}
