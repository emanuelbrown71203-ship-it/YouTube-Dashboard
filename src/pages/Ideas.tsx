import { useQueryClient } from "@tanstack/react-query";
import { IDEA_TABS, Tabs } from "./Growth.tsx";
import { ScoreChips, ScorePanel, TitleHelper, useAutoResearch, useCovered, useDraftScores, useFound, useIdeaChecking, useIdeaScores } from "./Pulse.tsx";
import { bareNote, checkCount } from "../lib/notes.ts";
import { scoreIdea } from "../lib/ideaScore.ts";
import { ImportIdeas, TemplateHint, TemplateScore } from "./Templates.tsx";
import { IdeaRefs, RefStrip, useIdeaRefs } from "./Thumbnails.tsx";
import { addIdeaRef } from "../lib/api.ts";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { NotesBox } from "../components/notes.tsx";
import { Drawer, ErrorNote, Fold, FormatTag, Icon, Loading, Mult, Segmented, useToast } from "../components/ui.tsx";
import { saveIdea, setIdeaTrashed } from "../lib/api.ts";
import { takePendingIdea } from "../lib/draft.ts";
import { compact, day } from "../lib/format.ts";
import { keys, useIdeas, useSavedVideos, useVideos } from "../lib/hooks.ts";
import { navigate, useRoute } from "../lib/router.ts";
import type { Idea, IdeaDraft, IdeaStatus } from "../lib/types.ts";

// The production board. An idea only gets here once the owner picks it ("Make this one"); until then it
// lives under its game. "To make" is a picked idea that has not been started.
const STATUSES: { key: IdeaStatus; label: string }[] = [
  { key: "idea", label: "To make" },
  { key: "scripting", label: "Scripting" },
  { key: "filming", label: "Filming" },
  { key: "editing", label: "Editing" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
];
/** How many ideas a game section shows before "Show more". */
const FIRST_IN_GAME = 5;
const next = (status: IdeaStatus) => STATUSES[STATUSES.findIndex((s) => s.key === status) + 1] ?? null;

/** Has the owner decided to make it? Anything past the first stage counts, whatever the flag says. */
const making = (idea: Pick<IdeaDraft, "picked_at" | "status">) => Boolean(idea.picked_at) || (idea.status ?? "idea") !== "idea";
const remembered = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

const blank = (format: "long" | "short"): IdeaDraft => ({ title: "", format, status: "idea", priority: 2, title_options: [], discovery: null });

export function Ideas() {
  const ideas = useIdeas();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "long" | "short">("all");
  const [quick, setQuick] = useState("");
  const [quickFormat, setQuickFormat] = useState<"long" | "short">("long");
  // The game the next quick idea is filed under. It stays on the last one used: ideas tend to come in runs.
  const [quickGame, setQuickGame] = useState(() => remembered("yt-ideas-game") ?? "");
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
  const refs = useIdeaRefs();
  const refsOf = useMemo(() => {
    const by = new Map<string, NonNullable<typeof refs.data>>();
    for (const r of refs.data ?? []) by.set(r.idea_id, [...(by.get(r.idea_id) ?? []), r]);
    return by;
  }, [refs.data]);
  const [order, setOrder] = useState<"priority" | "history" | "recommended">("priority");
  const [importing, setImporting] = useState(false);
  // Game sections show their first few ideas; the rest open on request.
  const [openGames, setOpenGames] = useState<Set<string>>(new Set());
  // Ideas added on this visit stay in view at the top of their game, even in a folded section.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const toggleGame = (game: string) => setOpenGames((open) => {
    const next = new Set(open);
    if (next.has(game)) next.delete(game); else next.add(game);
    return next;
  });
  // Games with open ideas and no fresh breakout search: the dashboard searches them itself, most ideas first.
  const covered = useCovered();
  const needs = useMemo(() => {
    if (!covered.data) return [];
    const counts = new Map<string, { game: string; format: "long" | "short"; n: number }>();
    for (const idea of ideas.data ?? []) {
      const game = idea.status === "published" ? null : scores.get(idea.id)?.search;
      if (!game) continue;
      const key = `${idea.format}:${game.toLowerCase()}`;
      counts.set(key, { game, format: idea.format, n: (counts.get(key)?.n ?? 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  }, [ideas.data, scores, covered.data]);
  const research = useAutoResearch(needs);
  // Each idea is also searched for by itself; the server does that a few at a time once it is asked.
  const checking = useIdeaChecking(ideas.data ?? []);
  const [view, setView] = useState<"stage" | "game">(() => (remembered("yt-ideas-view") === "stage" ? "stage" : "game"));
  const videos = useVideos();
  // The games offered when filing an idea: the ones the owner is working with now, not every game the
  // channel ever covered. That is the games open ideas already sit under, then the games uploaded in
  // the last year, newest first. Anything else can still be typed.
  const games = useMemo(() => {
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const last = new Map<string, string>();
    for (const v of videos.data ?? []) {
      if (!v.topic || v.privacy !== "public" || !v.published_at || v.published_at < yearAgo) continue;
      if ((last.get(v.topic) ?? "") < v.published_at) last.set(v.topic, v.published_at);
    }
    const mine = [...new Set((ideas.data ?? []).filter((i) => i.status !== "published").map((i) => i.topic?.trim()).filter((t): t is string => Boolean(t)))];
    const recent = [...last.entries()].sort((x, y) => y[1].localeCompare(x[1])).map(([g]) => g).filter((g) => !mine.includes(g));
    return [...mine, ...recent].slice(0, 8);
  }, [videos.data, ideas.data]);
  /** The section an idea sits under: the game it was filed under, else the one its wording points to. */
  const sectionOf = (idea: Idea) => idea.topic?.trim() || scores.get(idea.id)?.game || null;
  const list = useMemo(() => (ideas.data ?? []).filter((i) => filter === "all" || i.format === filter), [ideas.data, filter]);
  // Only the ideas the owner decided to make go on the production board.
  const inProduction = useMemo(() => list.filter((i) => making(i)), [list]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!quick.trim()) return;
    setBusy(true);
    try {
      const saved = await saveIdea({ ...blank(quickFormat), title: quick, topic: quickGame.trim() || null });
      setFresh((f) => new Set(f).add(saved.id));
      remember("yt-ideas-game", quickGame.trim());
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
      await saveIdea({ id: idea.id, title: idea.title, status: to.key, picked_at: idea.picked_at ?? new Date().toISOString() });
      await reload();
      toast(`Moved to ${to.label}.`, { action: { label: "Undo", run: () => void saveIdea({ id: idea.id, title: idea.title, status: idea.status, picked_at: idea.picked_at }).then(reload) } });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not move the idea.", { error: true });
    }
  };

  /** Puts an idea on the production board, or takes a not-yet-started one back off it. */
  const pick = async (idea: Idea, on: boolean) => {
    try {
      await saveIdea({ id: idea.id, title: idea.title, picked_at: on ? new Date().toISOString() : null });
      await reload();
      toast(on ? "On your production board, under To make." : "Back to just an idea.", { action: { label: "Undo", run: () => void saveIdea({ id: idea.id, title: idea.title, picked_at: idea.picked_at }).then(reload) } });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not change the idea.", { error: true });
    }
  };

  const card = (idea: Idea, withStage: boolean) => {
    const to = next(idea.status);
    const picked = making(idea);
    return (
                    <div className="idea" key={idea.id} onClick={() => setEditing(idea)}>
                      <button type="button" className="th-sort title" style={{ color: "var(--ink)", textAlign: "left" }} onClick={(e) => { e.stopPropagation(); setEditing(idea); }}>
                        {idea.title}
                      </button>
                      {idea.hook ? <div className="hook clip1">{idea.hook}</div> : null}
                      <RefStrip refs={refsOf.get(idea.id) ?? []} />
                      {idea.status !== "published" ? <ScoreChips scores={scores.get(idea.id)} templates={idea.template_check?.score ?? null} /> : null}
                      <div className="foot">
                        <FormatTag format={idea.format} />
                        {withStage && picked ? <span className="tag" style={{ borderColor: "var(--note-line)", background: "var(--note-bg)", color: "var(--note-ink)" }}>Making it: {STATUSES.find((x) => x.key === idea.status)?.label}</span> : null}
                        {!withStage && sectionOf(idea) ? <span className="tag">{sectionOf(idea)}</span> : null}
                        {idea.discovery === "search" ? <span className="tag">For search</span> : null}
                        {idea.priority === 1 ? <span className="tag" style={{ borderColor: "var(--note-line)", background: "var(--note-bg)", color: "var(--note-ink)" }}>High priority</span> : null}
                        {idea.target_date ? <span className="small muted">Due {day(idea.target_date)}</span> : null}
                      </div>
                      {!picked ? (
                        <div className="idea-move">
                          <button type="button" className="btn btn-small" onClick={(e) => { e.stopPropagation(); void pick(idea, true); }}>Make this one</button>
                        </div>
                      ) : to ? (
                        <div className="idea-move row-wrap" style={{ gap: 4 }}>
                          <button type="button" className="btn btn-quiet btn-small" style={{ paddingLeft: 0 }} onClick={(e) => { e.stopPropagation(); void advance(idea); }}>
                            Move to {to.label}
                          </button>
                          {idea.status === "idea" ? <button type="button" className="btn btn-quiet btn-small" onClick={(e) => { e.stopPropagation(); void pick(idea, false); }}>Not now</button> : null}
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
      // A finished video is no longer an idea to weigh up; it stays on the production board.
      if (idea.status === "published") continue;
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
      <div className="page-head"><h1>Ideas</h1></div>
      <Tabs label="Ideas" base="/ideas" current="" tabs={IDEA_TABS} />
      <form className="quick-idea" onSubmit={add}>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="A video you could make" aria-label="New idea title" maxLength={200} />
          <button type="submit" className="btn btn-primary" disabled={busy || !quick.trim()}><Icon name="plus" />Add</button>
        </div>
        {/* The game and format show once there is a title to file. */}
        {quick.trim() ? (
          <>
            <div className="row-wrap" style={{ gap: 6 }} role="group" aria-label="Game for the new idea">
              {games.map((g) => (
                <button key={g} type="button" className="chip" aria-pressed={quickGame === g} onClick={() => setQuickGame(quickGame === g ? "" : g)}>{g}</button>
              ))}
              <input
                className="input" style={{ width: 170, flex: "1 1 150px", maxWidth: 260 }} value={games.includes(quickGame) ? "" : quickGame}
                onChange={(e) => setQuickGame(e.target.value)} placeholder={games.length ? "Another game" : "Game or topic"} aria-label="Another game or topic" maxLength={80}
              />
            </div>
            <div className="row-wrap" style={{ gap: 10 }}>
              <Segmented
                label="Format of the new idea" value={quickFormat} onChange={setQuickFormat}
                options={[{ value: "long", label: "Long-form" }, { value: "short", label: "Short" }]}
              />
              <span className="small muted">{quickGame.trim() ? `Goes under ${quickGame.trim()}` : "No game picked"}</span>
            </div>
          </>
        ) : null}
        <div className="row-wrap small" style={{ gap: 14 }}>
          <button type="button" className="link-button" onClick={() => setEditing({ ...blank(quickFormat), title: quick, topic: quickGame.trim() || null })}>Write one out in full</button>
          <button type="button" className="link-button" onClick={() => setImporting(true)}>Import from Claude</button>
        </div>
      </form>

      {(ideas.data ?? []).length ? (
        <div className="idea-toolbar">
          <Segmented
            label="Group ideas by" value={view} onChange={(v) => { setView(v); remember("yt-ideas-view", v); }}
            options={[{ value: "game", label: `By game ${list.filter((i) => i.status !== "published").length}` }, { value: "stage", label: `Stage ${inProduction.length}` }]}
          />
          <select className="select input" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Format">
            <option value="all">All formats</option>
            <option value="long">Long-form</option>
            <option value="short">Shorts</option>
          </select>
          <select className="select input" value={order} onChange={(e) => setOrder(e.target.value as typeof order)} aria-label="Order ideas by">
            <option value="priority">My order</option>
            <option value="history">Best on your history</option>
            <option value="recommended">Best on recommended</option>
          </select>
        </div>
      ) : null}
      {checking.waiting > 0 || research.now || research.problem || checking.problem ? (
        <p className="small muted row" style={{ gap: 8, margin: "0 0 12px" }}>
          {checking.problem || research.problem ? null : <span className="spin" />}
          {checking.problem
            ? `${checking.waiting} ideas are not checked against YouTube yet: ${checking.problem}`
            : checking.waiting > 0
              ? `Checking ${checking.waiting} ${checking.waiting === 1 ? "idea" : "ideas"} against YouTube. Scores fill in as each lands.`
              : research.now ? `Checking what YouTube is pushing for ${research.now.game}.` : `A check could not run: ${research.problem}`}
        </p>
      ) : null}

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
          {sections.length === 0 ? <div className="panel"><div className="empty"><h3>No open ideas</h3><p>Everything here has been published. Add the next one above.</p></div></div> : null}
          {sections.map(([game, cards]) => {
            const all = sorted(cards).sort((a, b) => (order === "priority" ? stageOf(a) - stageOf(b) : 0));
            const rest = all.filter((i) => !fresh.has(i.id));
            const shown = openGames.has(game) ? all : [...all.filter((i) => fresh.has(i.id)), ...rest.slice(0, FIRST_IN_GAME)];
            return (
            <section key={game || "none"} aria-label={game || "No game yet"}>
              <div className="section-head">
                <h2>{game || "No game yet"}</h2>
                <span className="small muted">{cards.length} {cards.length === 1 ? "idea" : "ideas"}</span>
              </div>
              {game ? null : <p className="small muted" style={{ margin: "0 0 8px" }}>Open an idea and choose its game to file it under a section.</p>}
              <div className="game-ideas">{shown.map((idea) => card(idea, true))}</div>
              {rest.length > FIRST_IN_GAME ? (
                <button type="button" className="btn btn-quiet btn-small" style={{ marginTop: 8 }} onClick={() => toggleGame(game)}>
                  {openGames.has(game) ? "Show fewer" : `Show ${all.length - shown.length} more ${game || "ideas"}`}
                </button>
              ) : null}
            </section>
            );
          })}
        </div>
      ) : inProduction.length === 0 ? (
        <div className="panel">
          <div className="empty">
            <h3>Nothing in production yet</h3>
            <p>This board only holds the ideas you have decided to make. Switch to Game, find one you want to do, and tap Make this one.</p>
          </div>
        </div>
      ) : (
        <div className={`board${ideas.isFetching ? " fade" : ""}`}>
          {STATUSES.map((status) => {
            const cards = sorted(inProduction.filter((i) => i.status === status.key));
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
  const queryClient = useQueryClient();
  const refsAll = useIdeaRefs();
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
      const idea = await saveIdea({ ...form, title_options: (form.title_options ?? []).map((t) => t.trim()).filter(Boolean) });
      // References picked before the idea existed are kept now that it does.
      for (const ref of form.pending_refs ?? []) await addIdeaRef(idea.id, ref);
      if (form.pending_refs?.length) await queryClient.invalidateQueries({ queryKey: ["idea-refs"] });
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

  const scores = useDraftScores(form, dirty);
  const scoreSummary = [
    scores.history.value !== null ? `History ${scores.history.value}` : null,
    scores.recommended.value !== null ? `Recommended ${scores.recommended.value}` : null,
    form.template_check ? `Templates ${form.template_check.score}` : null,
  ].filter(Boolean).join(", ") || "Not enough to go on yet";
  const firstLine = (text: string | null | undefined) => bareNote(text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? null;
  const ticks = checkCount(form.outline ?? "");
  const scriptSummary = [form.hook ? "Hook" : null, form.concept ? "what happens" : null, form.outline ? (ticks.total ? `outline, ${ticks.done} of ${ticks.total} ticked` : "outline") : null]
    .filter(Boolean).join(", ").replace(/^./, (c) => c.toUpperCase()) || "Hook, what happens, outline";
  const refCount = (refsAll.data ?? []).filter((r) => form.id && r.idea_id === form.id).length + (form.pending_refs?.length ?? 0);
  const thumbSummary = [form.thumbnail_concept ? firstLine(form.thumbnail_concept) : null, refCount ? `${refCount} ${refCount === 1 ? "reference" : "references"}` : null].filter(Boolean).join(", ") || "Idea and references";
  const planSummary = [
    form.target_date ? `By ${day(form.target_date)}` : null, form.priority === 1 ? "High priority" : form.priority === 3 ? "Low priority" : null,
    form.discovery === "search" ? "For search" : form.discovery === "recommended" ? "For the feed" : null,
  ].filter(Boolean).join(", ") || "Date, priority, feed or search";
  const notesSummary = firstLine(form.notes) ?? (form.inspiration_url ? "Inspiration link" : "Notes and inspiration");

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

      <div className="field">
        <span>Game or topic</span>
        {props.games.length ? (
          <div className="row-wrap" style={{ gap: 6 }}>
            {props.games.map((g) => (
              <button key={g} type="button" className="chip" aria-pressed={form.topic === g} onClick={() => set("topic", form.topic === g ? null : g)}>{g}</button>
            ))}
          </div>
        ) : null}
        <input className="input" value={form.topic ?? ""} onChange={(e) => set("topic", e.target.value || null)} placeholder="Or type another game or topic" aria-label="Game or topic" maxLength={80} />
        {!form.topic && guess ? (
          <small>It reads like <button type="button" className="th-sort" style={{ textDecoration: "underline" }} onClick={() => set("topic", guess)}>{guess}</button>: tap to file it there.</small>
        ) : null}
      </div>

      <div className="field-row">
        <div className="field">
          <span>Format</span>
          <Segmented label="Format" value={form.format ?? "long"} onChange={(v) => set("format", v)} options={[{ value: "long", label: "Long-form" }, { value: "short", label: "Short" }]} />
        </div>
        <div className="field">
          <span>Am I making it?</span>
          <Segmented
            label="Am I making it?" value={making(form) ? "yes" : "no"}
            onChange={(v) => { setForm((f) => ({ ...f, picked_at: v === "yes" ? f.picked_at ?? new Date().toISOString() : null, status: v === "yes" ? f.status : "idea" })); setDirty(true); }}
            options={[{ value: "no", label: "Just an idea" }, { value: "yes", label: "Making it" }]}
          />
        </div>
      </div>
      {making(form) ? (
        <label className="field">
          <span>Stage</span>
          <select
            className="select input" value={form.status ?? "idea"}
            onChange={(e) => { setForm((f) => ({ ...f, status: e.target.value as IdeaStatus, picked_at: f.picked_at ?? new Date().toISOString() })); setDirty(true); }}
          >
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      ) : null}

      <Fold title="Scores" summary={scoreSummary}>
        <ScorePanel draft={form} dirty={dirty} />
        <TemplateScore
          idea={form} dirty={dirty}
          onChecked={(check, at) => { setForm((f) => ({ ...f, template_check: check, template_checked_at: at })); void props.onChanged(); }}
        />
      </Fold>

      <Fold title="Script" summary={scriptSummary} open={!form.id || Boolean(form.hook || form.concept || form.outline)}>
        <label className="field">
          <span>Hook</span>
          <textarea className="textarea" style={{ minHeight: 60 }} {...text("hook")} placeholder="The first line, or the first five seconds" />
          <TemplateHint kind="intro" />
        </label>
        <div className="field">
          <span>What happens</span>
          <NotesBox label="What happens" value={form.concept ?? ""} onChange={(v) => set("concept", v || null)} placeholder="The challenge, the stakes, how it ends" />
        </div>
        <div className="field">
          <span>Outline or script notes</span>
          <NotesBox label="Outline or script notes" value={form.outline ?? ""} onChange={(v) => set("outline", v || null)} minHeight={140} placeholder="Beats, lines, shots to get. Use bullets, or checkboxes to tick off as you go" />
        </div>
      </Fold>

      <Fold title="Thumbnail" summary={thumbSummary}>
        {form.format !== "short" ? (
          <label className="field">
            <span>Thumbnail idea</span>
            <input className="input" {...text("thumbnail_concept")} placeholder="What the picture shows, and the two or three words on it" />
            <TemplateHint kind="thumbnail" />
          </label>
        ) : null}
        <IdeaRefs idea={form} onPending={(refs) => set("pending_refs", refs)} />
      </Fold>

      <Fold title="Other titles" summary={options.filter((o) => o.trim()).length ? `${options.filter((o) => o.trim()).length} to try` : "Title helper"}>
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
      </Fold>

      <Fold title="Plan" summary={planSummary}>
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
      </Fold>

      <Fold title="Notes" summary={notesSummary} open={Boolean(form.notes)}>
        {inspiration ? (
          <div className="notice plain" style={{ margin: 0 }}>
            <Mult value={inspiration.outlier_score} />
            <span className="grow small">
              Inspired by "{inspiration.title}" from {inspiration.channel_title}, {compact(inspiration.views)} views.
            </span>
          </div>
        ) : null}
        <div className="field">
          <span>Notes</span>
          <NotesBox label="Notes" value={form.notes ?? ""} onChange={(v) => set("notes", v || null)} />
        </div>
        <label className="field">
          <span>Inspiration link</span>
          <input className="input" type="url" {...text("inspiration_url")} placeholder="https://www.youtube.com/watch?v=" />
        </label>
      </Fold>
    </Drawer>
  );
}
