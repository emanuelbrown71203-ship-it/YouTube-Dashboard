// Lines worth remembering: something heard in a podcast or a video that the owner wants to keep seeing.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { NotesBox, RichNote } from "../components/notes.tsx";
import { Drawer, ErrorNote, Icon, Loading, useToast } from "../components/ui.tsx";
import { ApiError, fail } from "../lib/api.ts";
import { ago } from "../lib/format.ts";
import { supabase } from "../lib/supabase.ts";

export interface Note {
  id: string;
  text: string;
  source: string | null;
  source_url: string | null;
  topic: string | null;
  on_front: boolean;
  created_at: string;
}
type NoteDraft = Partial<Note> & { text: string };

const COLUMNS = "id, text, source, source_url, topic, on_front, created_at";
const notesKey = ["notes"];

async function getNotes(): Promise<Note[]> {
  const { data, error } = await supabase.from("yt_notes").select(COLUMNS).is("trashed_at", null).order("created_at", { ascending: false }).limit(500);
  fail(error);
  return (data ?? []) as unknown as Note[];
}

async function saveNote(draft: NoteDraft): Promise<void> {
  const text = draft.text.trim();
  if (!text) throw new ApiError("Write the line first.", "bad_request");
  const url = draft.source_url?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) throw new ApiError("The link should start with https://", "bad_request");
  const fields = { text, source: draft.source?.trim() || null, source_url: url, topic: draft.topic?.trim() || null, on_front: draft.on_front ?? true };
  const { error } = draft.id
    ? await supabase.from("yt_notes").update(fields).eq("id", draft.id)
    : await supabase.from("yt_notes").insert(fields);
  fail(error);
}

async function patchNote(id: string, fields: { on_front?: boolean; trashed_at?: string | null; text?: string }): Promise<void> {
  const { error } = await supabase.from("yt_notes").update(fields).eq("id", id);
  fail(error);
}

export const useNotes = () => useQuery({ queryKey: notesKey, queryFn: getNotes });
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");

/** Ticking a box in a line shows at once and is saved behind it; if the save fails the tick is put back. */
function useRewriteLine() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return async (id: string, text: string) => {
    const before = queryClient.getQueryData<Note[]>(notesKey);
    queryClient.setQueryData<Note[]>(notesKey, (list) => (list ?? []).map((x) => (x.id === id ? { ...x, text } : x)));
    try {
      await patchNote(id, { text });
    } catch (err) {
      queryClient.setQueryData(notesKey, before);
      toast(message(err), { error: true });
    }
  };
}

function Line({ note, children }: { note: Note; children?: React.ReactNode }) {
  const rewrite = useRewriteLine();
  return (
    <div className="item line-note">
      <div className="grow" style={{ minWidth: 0 }}>
        <RichNote className="line-text" text={note.text} onChange={(text) => void rewrite(note.id, text)} />
        <div className="row-wrap small muted" style={{ marginTop: 6 }}>
          {note.source ? (note.source_url ? <a href={note.source_url} target="_blank" rel="noreferrer">{note.source}</a> : <span>{note.source}</span>) : null}
          {note.topic ? <span className="tag">{note.topic}</span> : null}
          <span>{ago(note.created_at)}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

/** One box to type a line into; the details can be added afterwards. */
function QuickLine({ onSaved }: { onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await saveNote({ text, source });
      setText("");
      setSource("");
      onSaved();
      toast("Line saved.");
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(false);
  };
  return (
    <form className="stack" style={{ gap: 8, marginBottom: 18 }} onSubmit={add}>
      <NotesBox alwaysEdit label="The line" value={text} onChange={setText} placeholder="A line you heard and want to remember" minHeight={70} maxLength={2000} />
      <div className="row-wrap">
        <input className="input grow" style={{ minWidth: 180 }} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Where it is from (optional)" aria-label="Where it is from" maxLength={200} />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}><Icon name="plus" />Save line</button>
      </div>
    </form>
  );
}

function NoteEditor({ note, onClose, onSaved }: { note: Note; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Note>(note);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Note>(key: K, value: Note[K]) => setForm((f) => ({ ...f, [key]: value }));
  const run = async (work: Promise<void>) => {
    setSaving(true);
    try {
      await work;
      onSaved();
      onClose();
    } catch (err) {
      toast(message(err), { error: true });
    }
    setSaving(false);
  };
  return (
    <Drawer
      title="Edit line" onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-danger" disabled={saving} onClick={() => void run(patchNote(note.id, { trashed_at: new Date().toISOString() }))}>Move to bin</button>
          <button type="button" className="btn btn-primary" disabled={saving || !form.text.trim()} onClick={() => void run(saveNote(form))}>{saving ? "Saving" : "Save line"}</button>
        </>
      )}
    >
      <div className="field"><span>The line</span><NotesBox alwaysEdit label="The line" value={form.text} onChange={(v) => set("text", v)} minHeight={120} maxLength={2000} /></div>
      <label className="field"><span>Where it is from</span><input className="input" value={form.source ?? ""} onChange={(e) => set("source", e.target.value)} placeholder="A podcast, a video, a person" maxLength={200} /></label>
      <label className="field"><span>Link (optional)</span><input className="input" value={form.source_url ?? ""} onChange={(e) => set("source_url", e.target.value)} placeholder="https://" inputMode="url" maxLength={500} /></label>
      <label className="field"><span>Game or subject (optional)</span><input className="input" value={form.topic ?? ""} onChange={(e) => set("topic", e.target.value)} placeholder="Titles, thumbnails, Elden Ring" maxLength={80} /></label>
      <label className="row" style={{ gap: 10 }}>
        <input type="checkbox" checked={form.on_front} onChange={(e) => set("on_front", e.target.checked)} />
        <span>Show on the front page</span>
      </label>
    </Drawer>
  );
}

/** The page that holds every line. */
export function Notes() {
  const notes = useNotes();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Note | null>(null);
  const reload = () => void queryClient.invalidateQueries({ queryKey: notesKey });
  const toggle = async (note: Note) => {
    try {
      await patchNote(note.id, { on_front: !note.on_front });
      reload();
      toast(note.on_front ? "Taken off your front page." : "Showing on your front page.");
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
  if (notes.isLoading) return <Loading label="Loading your lines" />;
  if (notes.error) return <ErrorNote error={notes.error} retry={() => void notes.refetch()} />;
  const list = notes.data ?? [];
  return (
    <>
      <p className="soft" style={{ maxWidth: "70ch", marginBottom: 14 }}>
        Lines from podcasts, videos or anywhere else that you want to keep in front of you. New ones show on your front page until you take them off.
      </p>
      <QuickLine onSaved={reload} />
      <div className="panel">
        {list.length === 0 ? (
          <div className="empty"><h3>No lines yet</h3><p>Type one above the next time something you hear is worth keeping.</p></div>
        ) : list.map((note) => (
          <Line key={note.id} note={note}>
            <div className="row" style={{ gap: 6, flex: "none" }}>
              <button type="button" className="btn btn-quiet btn-small" onClick={() => void toggle(note)}>{note.on_front ? "Take off front page" : "Show on front page"}</button>
              <button type="button" className="btn btn-small" onClick={() => setEditing(note)}>Edit</button>
            </div>
          </Line>
        ))}
      </div>
      {editing ? <NoteEditor note={editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </>
  );
}

/** On the front page: the lines the owner keeps there, with a way to add one on the spot. */
export function FrontLines() {
  const notes = useNotes();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  if (notes.isLoading || notes.error) return null;
  const shown = (notes.data ?? []).filter((n) => n.on_front);
  const reload = () => void queryClient.invalidateQueries({ queryKey: notesKey });
  return (
    <section className="section" style={{ marginTop: 0, marginBottom: 22 }}>
      <div className="section-head">
        <h2>Lines to remember</h2>
        <span className="row" style={{ gap: 12 }}>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "Add a line"}</button>
          <a className="small" href="#/playbook/lines">All lines</a>
        </span>
      </div>
      {adding ? <QuickLine onSaved={() => { reload(); setAdding(false); }} /> : null}
      {shown.length ? (
        <div className="panel">{shown.slice(0, 3).map((note) => <Line key={note.id} note={note} />)}</div>
      ) : adding ? null : (
        <div className="panel"><p className="small muted" style={{ padding: "14px 18px", margin: 0 }}>Heard a good line in a podcast or a video? Tap Add a line and it stays here where you will see it.</p></div>
      )}
      {shown.length > 3 ? <p className="small muted" style={{ marginTop: 8 }}><a href="#/playbook/lines">{shown.length - 3} more in Lines to remember</a></p> : null}
    </section>
  );
}
