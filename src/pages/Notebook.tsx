// The notebook (Ideas → Notebook): every video and every note the owner wrote, one page at a time, on
// ruled paper. Swipe (or tap Next) to turn the page; Contents jumps to a chapter. The owner asked for
// their ideas to feel like "scrolling through a notebook", with everything on one page at a time.

import { useQueryClient } from "@tanstack/react-query";
import { type TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { RichNote } from "../components/notes.tsx";
import { FormatTag, Loading, useToast } from "../components/ui.tsx";
import { saveIdea } from "../lib/api.ts";
import { keys, useIdeas } from "../lib/hooks.ts";
import { buildNotebook, type NotebookPage, withNotePart } from "../lib/notebook.ts";
import { dueWord, nextStep, stageLabel } from "../lib/nextStep.ts";
import type { Idea, IdeaDraft } from "../lib/types.ts";
import { IdeaEditor } from "./Ideas.tsx";
import { inMaking, usePieceCounts } from "./MakingNow.tsx";
import { notesKey, patchNote, useNotes } from "./Notes.tsx";
import { ScoreChips, useIdeaScores } from "./Pulse.tsx";

const KEPT = "yt-notebook-page";
const remembered = () => { try { return localStorage.getItem(KEPT); } catch { return null; } };
const todayIso = () => new Date().toISOString().slice(0, 10);

export function Notebook() {
  const ideas = useIdeas();
  const notes = useNotes();
  const scores = useIdeaScores(ideas.data ?? []);
  const counts = usePieceCounts();
  const queryClient = useQueryClient();
  const toast = useToast();
  const book = useMemo(() => buildNotebook(ideas.data ?? [], notes.data ?? []), [ideas.data, notes.data]);
  // The page is kept by what is on it, so the notebook opens where the owner left it even after ideas move.
  const [pageKey, setPageKey] = useState<string | null>(remembered);
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);
  const [contents, setContents] = useState(false);
  const [editing, setEditing] = useState<IdeaDraft | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const found = book.pages.findIndex((p) => p.key === pageKey);
  const index = found >= 0 ? found : 0;
  const page = book.pages[index];
  const chapter = book.chapters.find((c) => index >= c.start && index < c.start + c.count);

  const go = (to: number) => {
    const n = Math.max(0, Math.min(book.pages.length - 1, to));
    if (n === index) return;
    setTurn(n > index ? "next" : "prev");
    setPageKey(book.pages[n].key);
    try { localStorage.setItem(KEPT, book.pages[n].key); } catch { /* private mode */ }
    setContents(false);
    top.current?.scrollIntoView({ block: "start" });
  };
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
  // A sideways swipe turns the page; an up-and-down one just scrolls it.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: TouchEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  };

  /** A box ticked on a page is saved at once; the page shows it straight away. */
  const tickIdea = async (idea: Idea, field: "concept" | "outline" | "notes", text: string) => {
    queryClient.setQueryData<Idea[]>(keys.ideas, (list) => list?.map((i) => (i.id === idea.id ? { ...i, [field]: text } : i)));
    try {
      await saveIdea({ id: idea.id, title: idea.title, [field]: text });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save the tick. Try again.", { error: true });
    }
    void queryClient.invalidateQueries({ queryKey: keys.ideas });
  };
  const tickNote = async (p: Extract<NotebookPage, { kind: "note" }>, body: string) => {
    const note = notes.data?.find((n) => n.id === p.noteId);
    if (!note) return;
    const text = withNotePart(note.text, p.part, body);
    queryClient.setQueryData<typeof notes.data>(notesKey, (list) => list?.map((n) => (n.id === note.id ? { ...n, text } : n)));
    try {
      await patchNote(note.id, { text });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save the tick. Try again.", { error: true });
    }
    void queryClient.invalidateQueries({ queryKey: notesKey });
  };

  if (ideas.isLoading || notes.isLoading) return <Loading label="Opening your notebook" />;
  if (!page) {
    return <div className="panel"><div className="empty"><h3>Your notebook is empty</h3><p>Add an idea on the Board and it gets a page here.</p></div></div>;
  }
  const games = [...new Set((ideas.data ?? []).map((i) => i.topic).filter((t): t is string => Boolean(t)))].slice(0, 8);

  return (
    <div className="notebook" ref={top}>
      <div className="nb-bar">
        <button type="button" className="btn btn-small" aria-expanded={contents} onClick={() => setContents((c) => !c)}>Contents</button>
        <span className="small muted">Page {index + 1} of {book.pages.length}</span>
      </div>
      {contents ? (
        <nav className="nb-contents" aria-label="Chapters">
          {book.chapters.map((c) => (
            <button key={c.name} type="button" className="nb-contents-row" aria-current={chapter?.name === c.name ? "true" : undefined} onClick={() => go(c.start)}>
              <span className="nb-hand">{c.name}</span>
              <span className="small muted">{c.count} {c.count === 1 ? "page" : "pages"}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <article key={page.key} className={`nb-page${turn ? ` turn-${turn}` : ""}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-label={`Page ${index + 1}`}>
        <div className="nb-paper">
          <div className="nb-chapter nb-hand">{page.chapter}</div>
          {page.kind === "idea" ? (
            <IdeaPage idea={page.idea} scores={scores.get(page.idea.id)} counts={counts.data?.get(page.idea.id)} onTick={(f, t) => void tickIdea(page.idea, f, t)} onEdit={() => setEditing(page.idea)} />
          ) : (
            <>
              <h2 className="nb-title nb-hand">{page.heading}</h2>
              {page.body ? <RichNote className="nb-text" text={page.body} onChange={(t) => void tickNote(page, t)} /> : null}
              <a className="btn btn-quiet btn-small nb-edit" href="#/playbook/lines">Edit in Lines to remember</a>
            </>
          )}
        </div>
      </article>

      <div className="nb-nav">
        <button type="button" className="btn" disabled={index === 0} onClick={() => go(index - 1)}>‹ Previous</button>
        <span className="small muted">Swipe to turn the page</span>
        <button type="button" className="btn btn-primary" disabled={index >= book.pages.length - 1} onClick={() => go(index + 1)}>Next ›</button>
      </div>

      {editing ? (
        <IdeaEditor
          draft={editing} games={games} onOpen={setEditing}
          onClose={() => setEditing(null)}
          onChanged={async () => { await queryClient.invalidateQueries({ queryKey: keys.ideas }); }}
        />
      ) : null}
    </div>
  );
}

function IdeaPage(props: {
  idea: Idea;
  scores: Parameters<typeof ScoreChips>[0]["scores"];
  counts: { cuts: number; thumbs: number } | undefined;
  onTick: (field: "concept" | "outline" | "notes", text: string) => void;
  onEdit: () => void;
}) {
  const { idea } = props;
  const making = inMaking(idea);
  const step = making ? nextStep(idea, props.counts ?? { cuts: 0, thumbs: 0 }) : null;
  const due = dueWord(idea.target_date, todayIso());
  const others = (idea.title_options ?? []).filter((t) => t.trim() && t !== idea.title);
  const empty = !idea.hook && !idea.concept && !idea.outline && !idea.notes && !others.length;
  // Scores only once there is a number to show: two empty chips are just noise on the page.
  const scored = props.scores && (props.scores.history.value !== null || props.scores.recommended.value !== null);
  return (
    <>
      <h2 className="nb-title nb-hand">{idea.title}</h2>
      <div className="nb-meta">
        <FormatTag format={idea.format} />
        {making ? <span className="tag">Making it: {stageLabel(idea.status)}</span> : null}
        {due ? <span className="small">{due}</span> : null}
      </div>
      {(step || scored) ? (
        <aside className="nb-sticky">
          {scored ? <ScoreChips scores={props.scores} /> : null}
          {step ? <div className="nb-sticky-next"><span className="nb-hand">Next:</span> {step.text}</div> : null}
        </aside>
      ) : null}
      {idea.hook ? (
        <section>
          <h3 className="nb-label nb-hand">Hook</h3>
          <div className="nb-text">
            {idea.hook.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => (
              <div key={i} className={/^\[.*\]$/.test(l) ? "nb-direction" : undefined}>{l}</div>
            ))}
          </div>
        </section>
      ) : null}
      {idea.concept ? <section><h3 className="nb-label nb-hand">What happens</h3><RichNote className="nb-text" text={idea.concept} onChange={(t) => props.onTick("concept", t)} /></section> : null}
      {idea.outline ? <section><h3 className="nb-label nb-hand">Outline</h3><RichNote className="nb-text" text={idea.outline} onChange={(t) => props.onTick("outline", t)} /></section> : null}
      {idea.notes ? <section><h3 className="nb-label nb-hand">Notes</h3><RichNote className="nb-text" text={idea.notes} onChange={(t) => props.onTick("notes", t)} /></section> : null}
      {others.length ? (
        <section>
          <h3 className="nb-label nb-hand">Other titles</h3>
          <ul className="nb-text nb-list">{others.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      ) : null}
      {empty ? <p className="nb-text muted">Nothing written on this page yet.</p> : null}
      <button type="button" className="btn btn-small nb-edit" onClick={props.onEdit}>Edit this page</button>
    </>
  );
}
