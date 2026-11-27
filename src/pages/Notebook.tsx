// The notebook (Ideas, the first tab): every video and every note the owner wrote, on a sheet of paper,
// one page at a time. Each video is a set of pages in the order it is made, its plan first: Plan, Title,
// Intro, Script, For my editor, Thumbnail (long-form only), Notes. Above the sheet: which video this is,
// then tabs for its pages (they stay in reach while the page scrolls). Under it: buttons named for the
// page they turn to, and the video before and after. Contents lists every chapter and video, with a box
// to find one. Tapping any part of a page writes on it there and then.
//
// Plain on purpose. The owner found a handwriting font hard to read ("especially in large text") and
// asked for it not to be fancy: everything is in the app's own font, and the ruled lines sit only under
// their own writing, where each line of text has its own rule.

import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, type TouchEvent, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NotesBox, RichNote } from "../components/notes.tsx";
import { Drawer, FormatTag, Icon, Loading, Mult, useToast } from "../components/ui.tsx";
import type { IntroCheck, PieceReading, TitleCheck } from "../lib/api.ts";
import { saveIdea } from "../lib/api.ts";
import { takePendingIdea } from "../lib/draft.ts";
import { lengthRule } from "../lib/emotions.ts";
import { compact, day } from "../lib/format.ts";
import { keys, useIdeas, useSavedVideos } from "../lib/hooks.ts";
import { buildNotebook, type Chapter, type Entry, findPage, type NotebookPage, PAGE_NAMES, type PageKind, pageKey, pageOfPlace, TAB_NAMES, tocMatches, videoPages, withNotePart } from "../lib/notebook.ts";
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
const keep = (key: string) => { try { localStorage.setItem(KEPT, key); } catch { /* private mode */ } };
const todayIso = () => new Date().toISOString().slice(0, 10);
const noCounts = { cuts: 0, thumbs: 0 };
const kindOf = (e: Entry) => (e.ideaId ? "video" : "note");
const many = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Writing open on the page and not saved yet, so turning the page asks first. */
const Unsaved = createContext<(id: string, on: boolean) => void>(() => {});

type Save = (patch: Partial<IdeaDraft>) => Promise<boolean>;
type Plan = ReturnType<typeof planSteps>;
interface PageProps {
  idea: Idea;
  plan: Plan;
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
  const [contents, setContents] = useState(false);
  const [editing, setEditing] = useState<IdeaDraft | null>(null);
  /** Just above the tabs: turning the page from further down comes back to here, never past it. */
  const sheetTop = useRef<HTMLDivElement>(null);
  const found = findPage(book.pages, pageKeyNow);
  const index = found >= 0 ? found : 0;
  const page = book.pages[index];
  const entry = page ? book.entries[page.entry] : undefined;
  const chapter = book.chapters.find((c) => index >= c.start && index < c.start + c.count);

  const unsaved = useRef(new Set<string>());
  const markUnsaved = useCallback((id: string, on: boolean) => {
    if (on) unsaved.current.add(id); else unsaved.current.delete(id);
  }, []);

  const show = (n: number) => {
    setPageKey(book.pages[n].key);
    keep(book.pages[n].key);
    setContents(false);
  };
  const go = (to: number) => {
    const n = Math.max(0, Math.min(book.pages.length - 1, to));
    if (n === index) { setContents(false); return; }
    if (unsaved.current.size && !window.confirm("You have writing on this page that is not saved yet. Turn the page anyway?")) return;
    unsaved.current.clear();
    show(n);
    // A page turned from part-way down starts at its top; one turned from the top stays put.
    const el = sheetTop.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  };
  const goPage = (kind: PageKind) => {
    if (page?.kind !== "idea") return;
    const at = findPage(book.pages, pageKey(page.idea.id, kind));
    if (at >= 0) go(at);
  };
  /** One page on or back. Back from a video's first page goes to the start of the one before, not its last page. */
  const turn = (by: 1 | -1) => {
    if (!page || !entry) return;
    const before = book.entries[page.entry - 1];
    if (by === -1 && index === entry.start) { if (before) go(before.start); } else go(index + by);
  };

  // A link from elsewhere (Making now, the planner, Find) opens that video on the page its step is done on.
  const route = useRoute();
  const editId = route.query.get("edit");
  const openPart = route.query.get("open");
  useEffect(() => {
    if (!editId || !ideas.data || notes.isLoading) return;
    const at = findPage(book.pages, pageKey(editId, pageOfPlace(openPart)));
    const plan = at >= 0 ? at : findPage(book.pages, `idea-${editId}`);
    if (plan >= 0) show(plan);
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
      if (editing || contents || (e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") turn(1);
      if (e.key === "ArrowLeft") turn(-1);
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
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
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
  const gameHere = page?.kind === "idea" ? page.idea.topic : null;
  const newIdea = () => setEditing({ ...blankIdea("long"), topic: gameHere });
  const editor = editing ? (
    <IdeaEditor
      draft={editing} games={games} onOpen={setEditing}
      onClose={() => setEditing(null)}
      onChanged={async () => { await queryClient.invalidateQueries({ queryKey: keys.ideas }); }}
      onSaved={(idea) => { if (!editing.id) { setPageKey(pageKey(idea.id, "plan")); keep(pageKey(idea.id, "plan")); } }}
    />
  ) : null;

  if (!page || !entry || !chapter) {
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
  const before = book.entries[page.entry - 1];
  const after = book.entries[page.entry + 1];
  const plan = page.kind === "idea" ? planSteps(page.idea, counts.data?.get(page.idea.id) ?? noCounts) : null;
  const pages = page.kind === "idea" ? videoPages(page.idea.format) : [];
  const place = `${chapter.name} · ${kindOf(entry) === "video" ? "Video" : "Note"} ${chapter.entries.indexOf(entry) + 1} of ${chapter.entries.length}`;
  // A single line is named by its first words in Contents; above its page, by where it came from, so the
  // page does not say the line twice.
  const single = page.kind === "note" && entry.count === 1;
  const name = page.kind === "note" && single ? page.heading : entry.label;
  // What the two page buttons say: the page they turn to.
  const back = inEntry === 0 ? null : page.kind === "idea" ? PAGE_NAMES[pages[inEntry - 1]] : "Previous page";
  const on = inEntry === entry.count - 1 ? null : page.kind === "idea" ? PAGE_NAMES[pages[inEntry + 1]] : "Next page";

  return (
    <Unsaved.Provider value={markUnsaved}>
      <div className="notebook">
        <header className="nb-cover">
          <div className="nb-cover-row">
            <p className="nb-place">{place}</p>
            <button type="button" className="btn" onClick={() => setContents(true)}>Contents</button>
          </div>
          <h2 className="nb-name">{name}</h2>
        </header>

        <div ref={sheetTop} className="nb-anchor" />
        {page.kind === "idea" && plan ? <Tabs pages={pages} current={page.page} plan={plan} onGo={goPage} /> : null}
        <article
          key={page.key} className={`nb-sheet${page.kind === "idea" ? " tabbed" : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
          aria-label={page.kind === "idea" ? `${entry.label}, ${PAGE_NAMES[page.page]}` : entry.label}
        >
          {page.kind === "idea" && plan ? (
            <VideoPage
              kind={page.page} idea={page.idea} plan={plan} scores={scores.get(page.idea.id)}
              save={saveTo(page.idea)} keep={keepOn(page.idea)} goto={goPage} onEditAll={() => setEditing(page.idea)}
            />
          ) : page.kind === "note" ? (
            <>
              <PaperText
                label={single ? "This line" : page.heading} heading={!single} bare={single} kind="note" value={page.body} empty="Tap to write"
                onSave={(v) => saveNote(page, v ?? "")} onTick={(t) => void saveNote(page, t)}
                under={entry.count > 1 ? <p className="nb-help" style={{ margin: "0 0 10px" }}>Page {inEntry + 1} of {entry.count}</p> : null}
              />
              <p className="nb-foot"><a href="#/playbook/lines">Open Lines to remember</a></p>
            </>
          ) : null}
        </article>

        <nav className="nb-turn" aria-label="Turn the page">
          {back || on ? (
            <div className="nb-turn-row">
              {back ? <button type="button" className="btn nb-turn-back" onClick={() => turn(-1)}>‹ {back}</button> : null}
              {on ? <button type="button" className="btn btn-primary nb-turn-on" onClick={() => turn(1)}>{on} ›</button> : null}
            </div>
          ) : null}
          <div className="nb-turn-row">
            {before ? <button type="button" className="btn btn-quiet" onClick={() => go(before.start)}>‹ Previous {kindOf(before)}</button> : null}
            {after ? <button type="button" className="btn btn-quiet nb-turn-on" onClick={() => go(after.start)}>Next {kindOf(after)} ›</button> : null}
          </div>
        </nav>
        {contents ? <Contents chapters={book.chapters} at={index} onGo={go} onClose={() => setContents(false)} onNew={() => { setContents(false); window.setTimeout(newIdea, 0); }} /> : null}
        {editor}
      </div>
    </Unsaved.Provider>
  );
}

/** Contents: every chapter, opening to its videos, and a box to find one by any of its words. */
function Contents({ chapters, at, onGo, onClose, onNew }: { chapters: Chapter[]; at: number; onGo: (index: number) => void; onClose: () => void; onNew: () => void }) {
  const here = chapters.find((c) => at >= c.start && at < c.start + c.count)?.name;
  const [open, setOpen] = useState<Set<string>>(() => new Set(here ? [here] : []));
  const [find, setFind] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const toggle = (name: string) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  // Opens with the video the owner is on in view.
  useEffect(() => {
    list.current?.querySelector('.nb-toc-entry[aria-current="true"]')?.scrollIntoView({ block: "center" });
  }, []);
  const hits = find.trim() ? tocMatches(chapters, find) : null;
  const row = (e: Entry, chapterName?: string) => (
    <button key={e.key} type="button" className="nb-toc-entry" aria-current={at >= e.start && at < e.start + e.count ? "true" : undefined} onClick={() => onGo(e.start)}>
      <span>{e.label}</span>
      {chapterName ? <span className="small muted">{chapterName}</span> : null}
    </button>
  );
  return (
    <Drawer title="Contents" onClose={onClose} footer={<button type="button" className="btn" onClick={onNew}><Icon name="plus" />New idea</button>}>
      <input className="input" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a video or note" aria-label="Find a video or note" />
      <div className="nb-toc" ref={list}>
        {hits ? (
          hits.length ? hits.map((h) => row(h.entry, h.chapter)) : <p className="muted" style={{ margin: 0 }}>Nothing in your notebook has those words.</p>
        ) : chapters.map((c) => (
          <section key={c.name}>
            <button type="button" className="nb-toc-chapter" aria-expanded={open.has(c.name)} onClick={() => toggle(c.name)}>
              <span className="grow">{c.name}</span>
              <span className="small muted">{many(c.entries.length, c.entries.some((e) => e.ideaId) ? "video" : "note")}</span>
              <svg className="fold-chev" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: open.has(c.name) ? "rotate(180deg)" : undefined }}>
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {open.has(c.name) ? <div className="nb-toc-list">{c.entries.map((e) => row(e))}</div> : null}
          </section>
        ))}
      </div>
    </Drawer>
  );
}

/** A page's name: the short one where room is tight (a phone), the full one elsewhere. */
function PageName({ page }: { page: PageKind }) {
  if (TAB_NAMES[page] === PAGE_NAMES[page]) return <>{PAGE_NAMES[page]}</>;
  return <><span className="nb-short">{TAB_NAMES[page]}</span><span className="nb-long">{PAGE_NAMES[page]}</span></>;
}

/** The tabs along the top of a video's sheet, one per page, in order. They stay in reach while the page scrolls. */
function Tabs({ pages, current, plan, onGo }: { pages: PageKind[]; current: PageKind; plan: Plan; onGo: (page: PageKind) => void }) {
  const done = (k: PageKind) => {
    const on = plan.steps.filter((s) => s.page === k);
    return on.length > 0 && on.every((s) => s.done);
  };
  return (
    <nav className="nb-tabs" aria-label="Pages of this video" style={{ ["--tabs" as string]: pages.length }}>
      {pages.map((k) => {
        const state = plan.here?.page === k ? "next" : done(k) ? "done" : "";
        return (
          <button
            key={k} type="button" className={`nb-tab ${state}`} aria-current={k === current ? "page" : undefined}
            aria-label={`${PAGE_NAMES[k]}${state === "next" ? ", your next step is here" : state === "done" ? ", done" : ""}`} onClick={() => onGo(k)}
          >
            <span className="nb-tab-mark" aria-hidden="true">{state === "done" ? "✓" : ""}</span>
            <PageName page={k} />
          </button>
        );
      })}
    </nav>
  );
}

function VideoPage(props: PageProps & { kind: PageKind }) {
  const { kind, idea, plan } = props;
  const here = plan.here?.page === kind && kind !== "plan" ? plan.here : null;
  const next = here ? <NextStep text={here.text} /> : null;
  // The notes page is one piece of writing, so its heading carries the Edit button.
  if (kind === "notes") return <NotesPage {...props} next={next} />;
  return (
    <>
      <h2 className="nb-h">{PAGE_NAMES[kind]}</h2>
      {next}
      {kind === "plan" ? <PlanPage {...props} />
        : kind === "title" ? <TitlePage {...props} />
        : kind === "intro" ? <IntroPage {...props} />
        : kind === "script" ? <ScriptPage {...props} />
        : kind === "editor" ? <div className="nb-plain"><EditorNotesBody ideaId={idea.id} title={idea.title} /></div>
        : <ThumbnailPage {...props} />}
    </>
  );
}

/** The one next step, set apart from everything else on the page. */
function NextStep({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <aside className="nb-next">
      <div className="nb-next-label">Next step</div>
      <div className="nb-next-text">{text}</div>
      {children ? <div className="nb-next-do">{children}</div> : null}
    </aside>
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
  const action = (step: PlanStep): ReactNode => {
    if (step.key === "pick") {
      return <button type="button" className="btn btn-primary" onClick={() => void save({ picked_at: new Date().toISOString() }).then((ok) => ok && toast("You're making it. It's under Making now."))}>Make this one</button>;
    }
    if (step.key === "film") {
      return idea.status === "filming"
        ? <button type="button" className="btn btn-primary" onClick={() => void move("editing")}>Filmed it: move to Editing</button>
        : <button type="button" className="btn btn-primary" onClick={() => void move("filming")}>Move to Filming</button>;
    }
    if (step.key === "date") return <button type="button" className="btn btn-primary" onClick={() => { dateBox.current?.focus(); dateBox.current?.showPicker?.(); }}>Pick the day</button>;
    if (step.key === "schedule") return <button type="button" className="btn btn-primary" onClick={() => void move("scheduled")}>Move to Scheduled</button>;
    if (step.page !== "plan") return <button type="button" className="btn btn-primary" onClick={() => goto(step.page)}>Go to {PAGE_NAMES[step.page]} ›</button>;
    return null;
  };
  const nothingLeft = idea.status === "published" ? "It's out. Nothing left to do." : idea.target_date ? `Goes up ${day(idea.target_date)}. Nothing left to do.` : "Nothing left to do.";

  return (
    <>
      <div className="nb-meta">
        <FormatTag format={idea.format} />
        {idea.topic ? <span className="tag">{idea.topic}</span> : null}
        <span className="tag">{making ? `Making it: ${stageLabel(idea.status)}` : "Just an idea"}</span>
        {due ? <span className="tag">{due}</span> : null}
      </div>
      {scored ? <ScoreChips scores={scores} /> : null}
      <NextStep text={plan.here ? plan.here.text : nothingLeft}>{plan.here ? action(plan.here) : null}</NextStep>
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
      ) : null}

      <section className="nb-section">
        <div className="nb-section-head">
          <h3>Steps</h3>
          <span className="small muted">{plan.done} of {plan.total} done</span>
        </div>
        {PLAN_STAGES.map((stage) => {
          const steps = plan.steps.filter((s) => s.stage === stage.key);
          if (!steps.length) return null;
          return (
            <div key={stage.key} className="nb-stage" role="group" aria-label={stage.label}>
              <div className="nb-stage-name">{stage.label}</div>
              {steps.map((s) => {
                const state = s.done ? "done" : s === plan.here ? "here" : s.passed ? "passed" : "todo";
                const body = (
                  <>
                    <span className="nb-box" aria-hidden="true">{s.done ? "✓" : ""}</span>
                    <span className="nb-step-text">{s.text}{s.passed ? <span className="nb-skipped"> (skipped)</span> : null}</span>
                    {s.page !== "plan" ? <span className="nb-step-page"><PageName page={s.page} /> ›</span> : null}
                  </>
                );
                const label = `${s.text}${s.done ? ", done" : s.passed ? ", skipped" : s === plan.here ? ", next" : ""}`;
                return s.page === "plan"
                  ? <div key={s.key} className={`nb-step ${state}`} aria-label={label}>{body}</div>
                  : <button key={s.key} type="button" className={`nb-step ${state}`} aria-label={`${label}. Go to ${PAGE_NAMES[s.page]}`} onClick={() => goto(s.page)}>{body}</button>;
              })}
            </div>
          );
        })}
        <p className="nb-help">The boxes tick themselves as you write and add things.</p>
      </section>
      <p className="nb-foot"><button type="button" className="btn btn-small" onClick={onEditAll}>Open the full editor</button></p>
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
        label="Your title" kind="line" strong value={idea.title} empty="Tap to write the title" required maxLength={200}
        below={(draft) => <small className="muted">{count(draft)}</small>} hint={<TemplateHint kind="title" />}
        onSave={(v) => save({ title: v ?? "" })}
      />
      <p className="nb-help">{count(idea.title)}</p>
      <PaperText
        label="Other titles to try" kind="lines" value={options.join("\n")} empty="Tap to write other titles, one per line"
        onSave={(v) => save({ title_options: (v ?? "").split("\n").map((t) => t.trim()).filter(Boolean) })}
        view={() => (
          <ul className="nb-options">
            {options.map((t) => (
              <li key={t}><span>{t}</span><button type="button" className="btn btn-small" onClick={() => use(t)}>Use this</button></li>
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
      <p className="nb-help">The first 5 seconds, one line at a time. Directions for your editor go in [brackets].</p>
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

function NotesPage({ idea, save, next }: PageProps & { next: ReactNode }) {
  const saved = useSavedVideos();
  const inspiration = saved.data?.find((v) => v.id === idea.inspiration_video_id);
  return (
    <>
      <PaperText
        label="Notes" heading kind="note" value={idea.notes} empty="Tap to write anything else about this video"
        onSave={(v) => save({ notes: v })} onTick={(t) => void save({ notes: t })}
        under={(
          <>
            {next}
            {inspiration ? (
              <div className="notice plain" style={{ margin: "12px 0" }}>
                <Mult value={inspiration.outlier_score} />
                <span className="grow small">Inspired by "{inspiration.title}" from {inspiration.channel_title}, {compact(inspiration.views)} views.</span>
              </div>
            ) : null}
          </>
        )}
      />
      <PaperText
        label="Inspiration link" kind="line" value={idea.inspiration_url} empty="Tap to add a link to a video that inspired it" inputType="url"
        onSave={(v) => save({ inspiration_url: v })}
        view={(v) => <a href={v} target="_blank" rel="noreferrer">{v}</a>}
      />
    </>
  );
}

/** A writing box as tall as what is in it, so a long hook is never read through a small window. */
function GrowingBox(props: { label: string; value: string; maxLength?: number; minHeight: number; onChange: (value: string) => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(props.minHeight, el.scrollHeight + 2)}px`;
  }, [props.value, props.minHeight]);
  return <textarea ref={box} className="textarea" autoFocus aria-label={props.label} value={props.value} maxLength={props.maxLength} onChange={(e) => props.onChange(e.target.value)} />;
}

/**
 * One part of a page. The owner's writing sits on ruled lines, one rule under each line of text; tap it
 * (or Write) and a box opens in its place, and Save keeps it. Boxes in a note tick without opening it.
 */
function PaperText(props: {
  label: string;
  value: string | null | undefined;
  empty: string;
  kind: "note" | "lines" | "line";
  onSave: (value: string | null) => Promise<boolean>;
  onTick?: (value: string) => void;
  hint?: ReactNode;
  /** Bigger and bold: the title. */
  strong?: boolean;
  /** This part is the whole page: its name is the page's heading. */
  heading?: boolean;
  /** Nothing above names this part: only its Edit button shows. */
  bare?: boolean;
  /** Shown between the name and the writing. */
  under?: ReactNode;
  required?: boolean;
  maxLength?: number;
  minHeight?: number;
  inputType?: string;
  below?: (draft: string) => ReactNode;
  /** The owner's writing shown another way (a list with buttons, a link), off the ruled lines. */
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
      toast(`Write ${props.label.toLowerCase()} first.`, { error: true });
      return;
    }
    setBusy(true);
    const ok = clean === value ? true : await props.onSave(clean || null);
    setBusy(false);
    if (ok) setDraft(null);
  };

  const what = props.label.toLowerCase();
  return (
    <section className={props.heading || props.bare ? "nb-section whole" : "nb-section"}>
      <div className="nb-section-head">
        {props.heading ? <h2 className="nb-h">{props.label}</h2> : <h3 className={props.bare ? "sr" : undefined}>{props.label}</h3>}
        {draft === null ? <button type="button" className="btn btn-small" onClick={open} aria-label={`${value ? "Edit" : "Write"} ${what}`}>{value ? "Edit" : "Write"}</button> : null}
      </div>
      {props.under}
      {draft !== null ? (
        <div className="nb-writing">
          {props.kind === "note" ? (
            <NotesBox label={props.label} value={draft} onChange={setDraft} alwaysEdit grow autoFocus minHeight={props.minHeight ?? 120} maxLength={props.maxLength} />
          ) : props.kind === "lines" ? (
            <GrowingBox label={props.label} value={draft} maxLength={props.maxLength} minHeight={props.minHeight ?? 140} onChange={setDraft} />
          ) : (
            <input className="input" autoFocus aria-label={props.label} type={props.inputType ?? "text"} value={draft} maxLength={props.maxLength} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          )}
          {props.below?.(draft)}
          {props.hint}
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Save"}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : value && props.view ? (
        <div className="nb-tap" onClick={onPaper}>{props.view(value)}</div>
      ) : (
        <div className={`nb-tap nb-lines${props.strong ? " strong" : ""}${value ? "" : props.kind === "line" ? " blank one" : " blank"}`} onClick={onPaper}>
          {!value ? <span className="nb-empty">{props.empty}</span>
            : props.kind === "note" ? <RichNote text={value} onChange={props.onTick} />
            : props.kind === "lines" ? value.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => (
              <div key={i} className={/^\[.*\]$/.test(l) ? "nb-direction" : undefined}>{l}</div>
            ))
            : value}
        </div>
      )}
    </section>
  );
}
