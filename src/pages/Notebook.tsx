// The notebook (Ideas, the first tab): every video and every note the owner wrote, on ruled paper, one
// page at a time. Each video is a set of pages in the order it is made, its plan first: Plan, Title,
// Intro, Script, For my editor, Thumbnail (long-form only), Notes. Divider tabs jump between a video's
// pages; swipe or Next turns the page; Contents jumps to a chapter or a video. Tapping any part of a page
// writes on it there and then. The owner asked for "everything its own piece of paper" and "my plan for
// each video at the beginning".

import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, type TouchEvent, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { NotesBox, RichNote } from "../components/notes.tsx";
import { FormatTag, Loading, Mult, useToast } from "../components/ui.tsx";
import type { IntroCheck, PieceReading, TitleCheck } from "../lib/api.ts";
import { saveIdea } from "../lib/api.ts";
import { takePendingIdea } from "../lib/draft.ts";
import { lengthRule } from "../lib/emotions.ts";
import { compact, day } from "../lib/format.ts";
import { keys, useIdeas, useSavedVideos } from "../lib/hooks.ts";
import { buildNotebook, type Chapter, findPage, MAKING, NOTES, type NotebookPage, PAGE_NAMES, type PageKind, pageKey, pageOfPlace, TAB_NAMES, videoPages, withNotePart } from "../lib/notebook.ts";
import { dueWord, PLAN_STAGES, type PlanStep, planSteps, STAGES, stageLabel } from "../lib/nextStep.ts";
import { navigate, useRoute } from "../lib/router.ts";
import type { Idea, IdeaDraft, IdeaStatus } from "../lib/types.ts";
import { EditorNotesBody } from "./EditorNotes.tsx";
import { blankIdea, IdeaEditor } from "./Ideas.tsx";
import { IntroScore } from "./IntroScore.tsx";
import { inMaking, usePieceCounts } from "./MakingNow.tsx";
import { MyThumbnails } from "./MyThumbnails.tsx";
import { notesKey, patchNote, useNotes } from "./Notes.tsx";
import { ScriptScore, TitleScore } from "./PieceScores.tsx";
import { ScoreChips, TitleHelper, useIdeaScores } from "./Pulse.tsx";
import { ScriptStarter } from "./ScriptStarter.tsx";
import { TemplateHint, useTemplates } from "./Templates.tsx";
import { IdeaRefs } from "./Thumbnails.tsx";

const KEPT = "yt-notebook-page";
const remembered = () => { try { return localStorage.getItem(KEPT); } catch { return null; } };
const todayIso = () => new Date().toISOString().slice(0, 10);
const noCounts = { cuts: 0, thumbs: 0 };

/** Writing open on the page and not saved yet, so turning the page asks first. */
const Unsaved = createContext<(id: string, on: boolean) => void>(() => {});

type Save = (patch: Partial<IdeaDraft>) => Promise<boolean>;
interface PageProps {
  idea: Idea;
  plan: ReturnType<typeof planSteps>;
  scores: Parameters<typeof ScoreChips>[0]["scores"];
  save: Save;
  /** Keeps a reading the server just stored (a score) on the page at once. */
  keep: (patch: Partial<Idea>) => void;
  goto: (page: PageKind) => void;
  onEditAll: () => void;
}

export function Notebook() {
  const ideas = useIdeas();
  const notes = useNotes();
  const scores = useIdeaScores(ideas.data ?? []);
  const counts = usePieceCounts();
  const queryClient = useQueryClient();
  const toast = useToast();
  const book = useMemo(() => buildNotebook(ideas.data ?? [], notes.data ?? []), [ideas.data, notes.data]);
  // The page is kept by what is on it, so the notebook opens where the owner left it even after ideas move.
  const [pageKeyNow, setPageKey] = useState<string | null>(remembered);
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);
  const [contents, setContents] = useState(false);
  const [editing, setEditing] = useState<IdeaDraft | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const found = findPage(book.pages, pageKeyNow);
  const index = found >= 0 ? found : 0;
  const page = book.pages[index];
  const entry = page ? book.entries[page.entry] : undefined;
  const chapter = book.chapters.find((c) => index >= c.start && index < c.start + c.count);

  const unsaved = useRef(new Set<string>());
  const markUnsaved = useCallback((id: string, on: boolean) => {
    if (on) unsaved.current.add(id); else unsaved.current.delete(id);
  }, []);

  const show = (n: number, animate: "next" | "prev" | null) => {
    setTurn(animate);
    setPageKey(book.pages[n].key);
    try { localStorage.setItem(KEPT, book.pages[n].key); } catch { /* private mode */ }
    setContents(false);
  };
  const go = (to: number) => {
    const n = Math.max(0, Math.min(book.pages.length - 1, to));
    if (n === index) return;
    if (unsaved.current.size && !window.confirm("You have writing on this page that is not saved yet. Turn the page anyway?")) return;
    unsaved.current.clear();
    show(n, n > index ? "next" : "prev");
    top.current?.scrollIntoView({ block: "start" });
  };
  const goPage = (kind: PageKind) => {
    if (page?.kind !== "idea") return;
    const at = findPage(book.pages, pageKey(page.idea.id, kind));
    if (at >= 0) go(at);
  };

  // A link from elsewhere (Making now, the planner, Find) opens that video on the page its step is done on.
  const route = useRoute();
  const editId = route.query.get("edit");
  const openPart = route.query.get("open");
  useEffect(() => {
    if (!editId || !ideas.data || notes.isLoading) return;
    const at = findPage(book.pages, pageKey(editId, pageOfPlace(openPart)));
    const plan = at >= 0 ? at : findPage(book.pages, `idea-${editId}`);
    if (plan >= 0) show(plan, null);
    else {
      // Out already, so not in the notebook: open it in the editor instead.
      const idea = ideas.data.find((i) => i.id === editId);
      if (idea) setEditing(idea);
    }
    navigate("/ideas", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, ideas.data, notes.isLoading]);
  // An idea started on another screen (research) opens in the editor; once saved, the notebook turns to it.
  useEffect(() => {
    const pending = takePendingIdea();
    if (pending) setEditing({ ...blankIdea(pending.format ?? "long"), ...pending });
  }, []);

  // Arrow keys turn the page on a computer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // A sideways swipe turns the page; an up-and-down one just scrolls it. Never from inside a box being written in.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const inBox = (e.target as HTMLElement).closest("input, textarea, select, .nb-writing");
    start.current = inBox ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  };

  /** Writes part of an idea and shows it on the page straight away. */
  const saveTo = (idea: Idea): Save => async (patch) => {
    queryClient.setQueryData<Idea[]>(keys.ideas, (list) => list?.map((i) => (i.id === idea.id ? { ...i, ...patch } as Idea : i)));
    let ok = true;
    try {
      await saveIdea({ id: idea.id, title: idea.title, ...patch } as IdeaDraft);
    } catch (err) {
      ok = false;
      toast(err instanceof Error ? err.message : "Could not save that. Try again.", { error: true });
    }
    void queryClient.invalidateQueries({ queryKey: keys.ideas });
    return ok;
  };
  const keepOn = (idea: Idea) => (patch: Partial<Idea>) => {
    queryClient.setQueryData<Idea[]>(keys.ideas, (list) => list?.map((i) => (i.id === idea.id ? { ...i, ...patch } : i)));
    void queryClient.invalidateQueries({ queryKey: keys.ideas });
  };
  const saveNote = async (p: Extract<NotebookPage, { kind: "note" }>, body: string): Promise<boolean> => {
    const note = notes.data?.find((n) => n.id === p.noteId);
    if (!note) return false;
    const text = withNotePart(note.text, p.part, body);
    if (!text.trim()) {
      toast("A line can't be empty. Bin it in Lines to remember instead.", { error: true });
      return false;
    }
    queryClient.setQueryData<typeof notes.data>(notesKey, (list) => list?.map((n) => (n.id === note.id ? { ...n, text } : n)));
    let ok = true;
    try {
      await patchNote(note.id, { text });
    } catch (err) {
      ok = false;
      toast(err instanceof Error ? err.message : "Could not save that. Try again.", { error: true });
    }
    void queryClient.invalidateQueries({ queryKey: notesKey });
    return ok;
  };

  if (ideas.isLoading || notes.isLoading) return <Loading label="Opening your notebook" />;
  const games = [...new Set((ideas.data ?? []).map((i) => i.topic).filter((t): t is string => Boolean(t)))].slice(0, 8);
  const gameHere = chapter && chapter.name !== MAKING && chapter.name !== NOTES && chapter.name !== "No game yet" ? chapter.name : null;
  const newIdea = () => setEditing({ ...blankIdea("long"), topic: page?.kind === "idea" ? page.idea.topic : gameHere });
  const editor = editing ? (
    <IdeaEditor
      draft={editing} games={games} onOpen={setEditing}
      onClose={() => setEditing(null)}
      onChanged={async () => { await queryClient.invalidateQueries({ queryKey: keys.ideas }); }}
      onSaved={(idea) => { if (!editing.id) { setTurn(null); setPageKey(pageKey(idea.id, "plan")); try { localStorage.setItem(KEPT, pageKey(idea.id, "plan")); } catch { /* private mode */ } } }}
    />
  ) : null;

  if (!page || !entry) {
    return (
      <div className="panel">
        <div className="empty">
          <h3>Your notebook is empty</h3>
          <p>Write your first idea and it gets its own pages here, with a plan to make it.</p>
          <p style={{ marginTop: 10 }}><button type="button" className="btn btn-primary" onClick={newIdea}>New idea</button></p>
        </div>
        {editor}
      </div>
    );
  }
  const inEntry = index - entry.start;
  const lastOfEntry = inEntry === entry.count - 1;
  const nextEntry = book.entries[page.entry + 1];
  const plan = page.kind === "idea" ? planSteps(page.idea, counts.data?.get(page.idea.id) ?? noCounts) : null;

  return (
    <Unsaved.Provider value={markUnsaved}>
      <div className="notebook" ref={top}>
        <div className="nb-bar">
          <button type="button" className="btn btn-small" aria-expanded={contents} onClick={() => setContents((c) => !c)}>Contents</button>
          <span className="small muted grow" style={{ textAlign: "center" }}>
            {entry.count > 1 ? `Page ${inEntry + 1} of ${entry.count}` : null}
          </span>
          <button type="button" className="btn btn-small" onClick={newIdea}>New idea</button>
        </div>
        {contents ? <Contents chapters={book.chapters} at={index} onGo={(n) => go(n)} /> : null}

        <article key={page.key} className={`nb-page${turn ? ` turn-${turn}` : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-label={page.kind === "idea" ? `${entry.label}, ${PAGE_NAMES[page.page]}` : entry.label}>
          {page.kind === "idea" && plan ? <Tabs idea={page.idea} current={page.page} plan={plan} onGo={goPage} /> : null}
          <div className={`nb-paper${page.kind === "idea" ? " with-tabs" : ""}`}>
            <div className="nb-chapter nb-hand">{page.chapter}</div>
            {page.kind === "idea" && plan ? (
              <VideoPage
                kind={page.page} idea={page.idea} plan={plan} scores={scores.get(page.idea.id)}
                save={saveTo(page.idea)} keep={keepOn(page.idea)} goto={goPage} onEditAll={() => setEditing(page.idea)}
              />
            ) : page.kind === "note" ? (
              <>
                <h2 className="nb-title nb-hand">{page.heading}</h2>
                <PaperText
                  label={page.heading} kind="note" value={page.body} empty="Tap to write"
                  onSave={(v) => saveNote(page, v ?? "")} onTick={(t) => void saveNote(page, t)}
                />
                <a className="btn btn-quiet btn-small nb-edit" href="#/playbook/lines">Open Lines to remember</a>
              </>
            ) : null}
          </div>
        </article>

        <div className="nb-nav">
          <button type="button" className="btn" disabled={index === 0} onClick={() => go(index - 1)}>‹ Previous</button>
          {!lastOfEntry && nextEntry ? (
            <button type="button" className="btn btn-quiet btn-small" onClick={() => go(nextEntry.start)}>Skip to next {nextEntry.ideaId ? "video" : "note"}</button>
          ) : <span className="small muted">Swipe to turn the page</span>}
          <button type="button" className="btn btn-primary" disabled={index >= book.pages.length - 1} onClick={() => go(index + 1)}>
            {lastOfEntry && nextEntry ? `Next ${nextEntry.ideaId ? "video" : "note"} ›` : "Next ›"}
          </button>
        </div>
        {editor}
      </div>
    </Unsaved.Provider>
  );
}

/** Contents: each chapter, opening to its videos; the chapter the owner is in starts open. */
function Contents({ chapters, at, onGo }: { chapters: Chapter[]; at: number; onGo: (index: number) => void }) {
  const here = chapters.find((c) => at >= c.start && at < c.start + c.count)?.name;
  const [open, setOpen] = useState<Set<string>>(() => new Set(here ? [here] : []));
  const toggle = (name: string) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  return (
    <nav className="nb-contents" aria-label="Contents">
      {chapters.map((c) => {
        const videos = c.entries.some((e) => e.ideaId);
        return (
          <div key={c.name}>
            <button type="button" className="nb-contents-row" aria-expanded={open.has(c.name)} aria-current={here === c.name ? "true" : undefined} onClick={() => toggle(c.name)}>
              <span className="nb-hand">{c.name}</span>
              <span className="small muted">{c.entries.length} {videos ? (c.entries.length === 1 ? "video" : "videos") : (c.entries.length === 1 ? "note" : "notes")}</span>
            </button>
            {open.has(c.name) ? (
              <div className="nb-contents-list">
                {c.entries.map((e) => (
                  <button key={e.key} type="button" className="nb-contents-entry" aria-current={at >= e.start && at < e.start + e.count ? "true" : undefined} onClick={() => onGo(e.start)}>
                    {e.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

/** The divider tabs along the top of a video's pages. A tab whose steps are all done has a tick. */
function Tabs({ idea, current, plan, onGo }: { idea: Idea; current: PageKind; plan: ReturnType<typeof planSteps>; onGo: (page: PageKind) => void }) {
  const pages = videoPages(idea.format);
  const done = (k: PageKind) => {
    const on = plan.steps.filter((s) => s.page === k);
    return on.length > 0 && on.every((s) => s.done);
  };
  return (
    <nav className="nb-tabs" aria-label="Pages of this video" style={{ ["--tabs" as string]: pages.length }}>
      {pages.map((k) => (
        <button
          key={k} type="button" className={`nb-tab nb-hand${done(k) ? " done" : ""}${plan.here?.page === k ? " next" : ""}`}
          aria-current={k === current ? "page" : undefined} aria-label={`${PAGE_NAMES[k]}${done(k) ? ", done" : ""}`} onClick={() => onGo(k)}
        >
          {TAB_NAMES[k]}
        </button>
      ))}
    </nav>
  );
}

function VideoPage(props: PageProps & { kind: PageKind }) {
  const { kind, idea, plan } = props;
  const here = plan.here?.page === kind && kind !== "plan" ? plan.here : null;
  return (
    <>
      {kind === "plan" ? null : (
        <>
          {kind === "title" ? null : <div className="nb-video nb-hand">{idea.title}</div>}
          <h2 className="nb-title nb-hand">{PAGE_NAMES[kind]}</h2>
          {here ? <aside className="nb-sticky small-sticky"><span className="nb-hand">Next:</span> {here.text}</aside> : null}
        </>
      )}
      {kind === "plan" ? <PlanPage {...props} />
        : kind === "title" ? <TitlePage {...props} />
        : kind === "intro" ? <IntroPage {...props} />
        : kind === "script" ? <ScriptPage {...props} />
        : kind === "editor" ? <div className="nb-card"><EditorNotesBody ideaId={idea.id} title={idea.title} /></div>
        : kind === "thumbnail" ? <ThumbnailPage {...props} />
        : <NotesPage {...props} />}
    </>
  );
}

/** The first page of every video: where it stands, the one next step, and every step in order. */
function PlanPage({ idea, plan, scores, save, goto, onEditAll }: PageProps) {
  const making = inMaking(idea);
  const due = dueWord(idea.target_date, todayIso());
  const dateBox = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const scored = scores && (scores.history.value !== null || scores.recommended.value !== null);
  const move = async (status: IdeaStatus) => {
    if (await save({ status, picked_at: idea.picked_at ?? new Date().toISOString() })) toast(`Moved to ${stageLabel(status)}.`);
  };
  const action = (step: PlanStep | null): ReactNode => {
    if (!step) return null;
    if (step.key === "pick") {
      return <button type="button" className="btn btn-primary btn-small" onClick={() => void save({ picked_at: new Date().toISOString() }).then((ok) => ok && toast("You're making it. It's under Making now."))}>Make this one</button>;
    }
    if (step.key === "film") {
      return idea.status === "filming"
        ? <button type="button" className="btn btn-primary btn-small" onClick={() => void move("editing")}>Filmed it: move to Editing</button>
        : <button type="button" className="btn btn-primary btn-small" onClick={() => void move("filming")}>Move to Filming</button>;
    }
    if (step.key === "date") return <button type="button" className="btn btn-primary btn-small" onClick={() => { dateBox.current?.focus(); dateBox.current?.showPicker?.(); }}>Pick the day</button>;
    if (step.key === "schedule") return <button type="button" className="btn btn-primary btn-small" onClick={() => void move("scheduled")}>Move to Scheduled</button>;
    if (step.page !== "plan") return <button type="button" className="btn btn-primary btn-small" onClick={() => goto(step.page)}>Go to {PAGE_NAMES[step.page]} ›</button>;
    return null;
  };
  const nothingLeft = idea.status === "published" ? "It's out. Nothing left to do." : idea.target_date ? `Goes up ${day(idea.target_date)}. Nothing left to do.` : "Nothing left to do.";

  return (
    <>
      <h2 className="nb-title nb-hand">{idea.title}</h2>
      <div className="nb-meta">
        <FormatTag format={idea.format} />
        {idea.topic ? <span className="tag">{idea.topic}</span> : null}
        {making ? <span className="tag">Making it: {stageLabel(idea.status)}</span> : null}
        {due ? <span className="small">{due}</span> : null}
      </div>
      <aside className="nb-sticky">
        {scored ? <ScoreChips scores={scores} /> : null}
        <div className="nb-sticky-next"><span className="nb-hand">Next:</span> {plan.here ? plan.here.text : nothingLeft}</div>
        {plan.here ? <div style={{ marginTop: 8 }}>{action(plan.here)}</div> : null}
      </aside>
      {making ? (
        <div className="nb-controls">
          <label className="field">
            <span>Stage</span>
            <select className="select input" value={idea.status} onChange={(e) => void move(e.target.value as IdeaStatus)}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Goes up</span>
            <input ref={dateBox} className="input" type="date" value={idea.target_date ?? ""} onChange={(e) => void save({ target_date: e.target.value || null })} />
          </label>
        </div>
      ) : (
        <p className="nb-text">Just an idea for now. When you decide to make it, its plan starts here.</p>
      )}

      <h3 className="nb-label nb-hand">My plan</h3>
      <div className="nb-plan">
        {PLAN_STAGES.map((stage) => {
          const steps = plan.steps.filter((s) => s.stage === stage.key);
          if (!steps.length) return null;
          return (
            <section key={stage.key} aria-label={stage.label}>
              <div className="nb-stage nb-hand">{stage.label}</div>
              {steps.map((s) => {
                const state = s.done ? "done" : s === plan.here ? "here" : s.passed ? "passed" : "todo";
                const body = (
                  <>
                    <span className="nb-box" aria-hidden="true">{s.done ? "✓" : ""}</span>
                    <span className="nb-step-text">{s.text}{s.passed ? <span className="muted"> (skipped)</span> : null}</span>
                    {s.page !== "plan" ? <span className="nb-step-page">{TAB_NAMES[s.page]} ›</span> : null}
                  </>
                );
                const label = `${s.text}${s.done ? ", done" : s.passed ? ", skipped" : s === plan.here ? ", next" : ""}`;
                return s.page === "plan"
                  ? <div key={s.key} className={`nb-step ${state}`} aria-label={label}>{body}</div>
                  : <button key={s.key} type="button" className={`nb-step ${state}`} aria-label={`${label}. Go to ${PAGE_NAMES[s.page]}`} onClick={() => goto(s.page)}>{body}</button>;
              })}
            </section>
          );
        })}
      </div>
      <p className="nb-text muted">{plan.done} of {plan.total} done. The boxes tick themselves as you write and add things.</p>
      <button type="button" className="btn btn-quiet btn-small nb-edit" onClick={onEditAll}>Open the full editor</button>
    </>
  );
}

function TitlePage({ idea, scores, save, keep }: PageProps) {
  const templates = useTemplates();
  const lengthGoal = lengthRule((templates.data ?? []).filter((t) => t.kind === "title" && t.active).map((t) => t.body));
  const options = (idea.title_options ?? []).filter((t) => t.trim());
  const count = (text: string) => {
    const bare = text.replace(/\s*#\S+/g, "").trim();
    const goal = lengthGoal ? (bare.length < lengthGoal.min || bare.length > lengthGoal.max ? `. Your title rules say ${lengthGoal.min} to ${lengthGoal.max}` : `, inside your ${lengthGoal.min} to ${lengthGoal.max}`) : "";
    return `${bare.length} characters${goal}${bare.length > 70 ? ". YouTube cuts titles off after about 60 to 70" : ""}.`;
  };
  /** Swaps an option in as the title, keeping the old title as an option. */
  const use = (t: string) => void save({ title: t, title_options: [...options.filter((o) => o !== t), idea.title] });
  const game = idea.topic?.trim() || scores?.game || null;
  return (
    <>
      <PaperText
        label="Title" kind="line" big value={idea.title} empty="Tap to write the title" required maxLength={200}
        below={(draft) => <small className="muted">{count(draft)}</small>} hint={<TemplateHint kind="title" />}
        onSave={(v) => save({ title: v ?? "" })}
      />
      <p className="small muted" style={{ margin: 0 }}>{count(idea.title)}</p>
      <PaperText
        label="Other titles to try" kind="lines" value={options.join("\n")} empty="Tap to write other titles, one per line"
        onSave={(v) => save({ title_options: (v ?? "").split("\n").map((t) => t.trim()).filter(Boolean) })}
        view={() => (
          <ul className="nb-text nb-list nb-options">
            {options.map((t) => (
              <li key={t}><span>{t}</span> <button type="button" className="btn btn-quiet btn-small" onClick={() => use(t)}>Use this</button></li>
            ))}
          </ul>
        )}
      />
      <div className="nb-card">
        <TitleHelper
          draft={idea} game={game} kept={options}
          onUse={(t) => use(t)}
          onKeep={(t) => void save({ title_options: [...options, t] })}
        />
      </div>
      <div className="nb-card">
        <TitleScore
          form={idea} kept={[idea.title, ...options]}
          onScored={(check: TitleCheck) => keep({ title_check: check })}
          onKeep={(t) => void save({ title_options: [...options, t] })}
        />
      </div>
    </>
  );
}

function IntroPage({ idea, keep, save }: PageProps) {
  return (
    <>
      <p className="nb-text muted">The first 5 seconds, line by line. Directions for your editor go in [brackets].</p>
      <PaperText label="Hook" kind="lines" value={idea.hook} empty="Tap to write the hook" hint={<TemplateHint kind="intro" />} onSave={(v) => save({ hook: v })} />
      <div className="nb-card">
        <IntroScore form={idea} onScored={(check: IntroCheck, at: string) => keep({ intro_check: check, intro_checked_at: at })} />
      </div>
    </>
  );
}

function ScriptPage({ idea, save, keep }: PageProps) {
  return (
    <>
      <div className="nb-card"><ScriptStarter form={idea} onUse={(part, value) => void save({ [part]: value })} /></div>
      <PaperText label="What happens" kind="note" value={idea.concept} empty="Tap to write what happens: the challenge, the stakes, how it ends" onSave={(v) => save({ concept: v })} onTick={(t) => void save({ concept: t })} />
      <PaperText label="Outline" kind="note" value={idea.outline} empty="Tap to outline the beats, in the order they happen" minHeight={160} onSave={(v) => save({ outline: v })} onTick={(t) => void save({ outline: t })} />
      <div className="nb-card"><ScriptScore form={idea} onScored={(check: PieceReading) => keep({ script_check: check })} /></div>
    </>
  );
}

function ThumbnailPage({ idea, save }: PageProps) {
  return (
    <>
      <PaperText label="Thumbnail idea" kind="lines" value={idea.thumbnail_concept} empty="Tap to write what the picture shows, and the two or three words on it" hint={<TemplateHint kind="thumbnail" />} onSave={(v) => save({ thumbnail_concept: v })} />
      <div className="nb-card"><MyThumbnails idea={idea} /></div>
      <div className="nb-card"><IdeaRefs idea={idea} onPending={() => {}} /></div>
    </>
  );
}

function NotesPage({ idea, save }: PageProps) {
  const saved = useSavedVideos();
  const inspiration = saved.data?.find((v) => v.id === idea.inspiration_video_id);
  return (
    <>
      {inspiration ? (
        <div className="notice plain" style={{ margin: "8px 0 0" }}>
          <Mult value={inspiration.outlier_score} />
          <span className="grow small">Inspired by "{inspiration.title}" from {inspiration.channel_title}, {compact(inspiration.views)} views.</span>
        </div>
      ) : null}
      <PaperText label="Notes" kind="note" value={idea.notes} empty="Tap to write anything else about this video" onSave={(v) => save({ notes: v })} onTick={(t) => void save({ notes: t })} />
      <PaperText
        label="Inspiration link" kind="line" value={idea.inspiration_url} empty="Tap to add a link to a video that inspired it" inputType="url"
        onSave={(v) => save({ inspiration_url: v })}
        view={(v) => <a href={v} target="_blank" rel="noreferrer">{v}</a>}
      />
    </>
  );
}

/**
 * One part of a page, written on the paper. Tap it (or Write) to write there and then; Save keeps it.
 * Boxes in a note can be ticked without opening it.
 */
function PaperText(props: {
  label: string;
  value: string | null | undefined;
  empty: string;
  kind: "note" | "lines" | "line";
  onSave: (value: string | null) => Promise<boolean>;
  onTick?: (value: string) => void;
  hint?: ReactNode;
  big?: boolean;
  required?: boolean;
  maxLength?: number;
  minHeight?: number;
  inputType?: string;
  below?: (draft: string) => ReactNode;
  view?: (value: string) => ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const markUnsaved = useContext(Unsaved);
  const id = useId();
  const value = props.value ?? "";
  useEffect(() => {
    markUnsaved(id, draft !== null && draft !== value);
    return () => markUnsaved(id, false);
  }, [draft, value, id, markUnsaved]);
  const open = () => setDraft(value);
  const onPaper = (e: { target: EventTarget }) => {
    // A box being ticked, a link or a button on the page is not a tap to write.
    if ((e.target as HTMLElement).closest("label, input, a, button")) return;
    open();
  };
  const save = async () => {
    if (draft === null) return;
    const clean = props.kind === "line" ? draft.trim() : draft.replace(/\s+$/, "");
    if (props.required && !clean) {
      toast(`Write a ${props.label.toLowerCase()} first.`, { error: true });
      return;
    }
    setBusy(true);
    const ok = clean === value ? true : await props.onSave(clean || null);
    setBusy(false);
    if (ok) setDraft(null);
  };

  const heading = (
    <div className="nb-field-head">
      <h3 className={`nb-label nb-hand${props.big ? " sr-only" : ""}`}>{props.label}</h3>
      {draft === null ? <button type="button" className="btn btn-quiet btn-small nb-write" onClick={open} aria-label={`${value ? "Edit" : "Write"} ${props.label.toLowerCase()}`}>{value ? "Edit" : "Write"}</button> : null}
    </div>
  );
  if (draft !== null) {
    return (
      <section className={`nb-field${props.big ? " big" : ""}`}>
        {heading}
        <div className="nb-writing">
          {props.kind === "note" ? (
            <NotesBox label={props.label} value={draft} onChange={setDraft} alwaysEdit grow autoFocus minHeight={props.minHeight ?? 120} maxLength={props.maxLength} />
          ) : props.kind === "lines" ? (
            <textarea className="textarea" autoFocus aria-label={props.label} value={draft} maxLength={props.maxLength} style={{ minHeight: props.minHeight ?? 140 }} onChange={(e) => setDraft(e.target.value)} />
          ) : (
            <input className="input" autoFocus aria-label={props.label} type={props.inputType ?? "text"} value={draft} maxLength={props.maxLength} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          )}
          {props.below?.(draft)}
          {props.hint}
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Save"}</button>
            <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className={`nb-field${props.big ? " big" : ""}`}>
      {heading}
      <div className={`nb-tap${props.big ? " big" : ""}`} onClick={onPaper}>
        {!value ? <span className="nb-empty">{props.empty}</span>
          : props.view ? props.view(value)
          : props.kind === "note" ? <RichNote className="nb-text" text={value} onChange={props.onTick} />
          : props.kind === "lines" ? (
            <div className="nb-text">
              {value.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => (
                <div key={i} className={/^\[.*\]$/.test(l) ? "nb-direction" : undefined}>{l}</div>
              ))}
            </div>
          )
          : <div className={props.big ? "nb-big nb-hand" : "nb-text"}>{value}</div>}
      </div>
    </section>
  );
}
