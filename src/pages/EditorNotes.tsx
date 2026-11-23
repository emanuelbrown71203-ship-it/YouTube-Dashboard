// Notes for the editor: the owner drops markers with comments on their cut in Premiere, exports them, and
// imports the file here, on the video idea it belongs to. The app turns it into a numbered list the editor
// can follow line by line, to copy, share or download. All of it stays with the idea.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Drawer, ErrorNote, Fold, Icon, Loading, useToast } from "../components/ui.tsx";
import { fail } from "../lib/api.ts";
import { ago } from "../lib/format.ts";
import { useIdeas } from "../lib/hooks.ts";
import { decodeFile, editorText, type Marker, markerWhen, noteLines, readMarkers } from "../lib/markers.ts";
import { supabase } from "../lib/supabase.ts";
import type { Json } from "../lib/database.types.ts";

export interface EditorNotes {
  id: string;
  idea_id: string;
  name: string;
  file_name: string | null;
  markers: Marker[];
  created_at: string;
}

const COLUMNS = "id, idea_id, name, file_name, markers, created_at";
const notesKey = ["editor-notes"];

async function getEditorNotes(): Promise<EditorNotes[]> {
  const { data, error } = await supabase.from("yt_editor_notes").select(COLUMNS).is("trashed_at", null).order("created_at", { ascending: false }).limit(300);
  fail(error);
  return (data ?? []) as unknown as EditorNotes[];
}

async function addEditorNotes(row: { idea_id: string; name: string; file_name: string; markers: Marker[] }): Promise<void> {
  const { error } = await supabase.from("yt_editor_notes").insert({ ...row, markers: row.markers as unknown as Json });
  fail(error);
}

async function binEditorNotes(id: string): Promise<void> {
  const { error } = await supabase.from("yt_editor_notes").update({ trashed_at: new Date().toISOString() }).eq("id", id);
  fail(error);
}

const useEditorNotes = () => useQuery({ queryKey: notesKey, queryFn: getEditorNotes });
const message = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");
const count = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;
const fileSafe = (text: string) => text.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Editor notes";

/** In the idea editor: the notes for the editor kept with this idea, and a way to bring in the next export. */
export function EditorNotesFold({ ideaId, title }: { ideaId?: string; title: string }) {
  const notes = useEditorNotes();
  const mine = (notes.data ?? []).filter((n) => n.idea_id === ideaId);
  const summary = !ideaId ? "Save the idea first" : mine.length ? `${count(mine[0].markers.length)} from ${mine[0].name}` : "Bring in your Premiere markers";
  return (
    <Fold title="For my editor" summary={summary}>
      {!ideaId ? (
        <p className="small muted" style={{ margin: 0 }}>Save the idea first, then bring in the markers from your cut here.</p>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <ImportMarkers ideaId={ideaId} nextName={`Cut ${mine.length + 1}`} />
          {notes.isLoading ? <Loading label="Loading your notes" /> : null}
          {mine.map((sheet, i) => (
            <EditorSheet key={sheet.id} sheet={sheet} title={title} open={i === 0} />
          ))}
        </div>
      )}
    </Fold>
  );
}

/** Picks the marker export, reads it on the spot and keeps it with the idea. */
function ImportMarkers({ ideaId, nextName }: { ideaId: string; nextName: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [read, setRead] = useState<{ file: string; markers: Marker[] } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      toast("That file is bigger than a marker export should be. Export only the markers from Premiere.", { error: true });
      return;
    }
    const { markers, problem } = readMarkers(decodeFile(new Uint8Array(await file.arrayBuffer())));
    if (problem) {
      toast(problem, { error: true });
      return;
    }
    setRead({ file: file.name, markers });
    setName(nextName);
  };
  const save = async () => {
    if (!read) return;
    setBusy(true);
    try {
      await addEditorNotes({ idea_id: ideaId, name: name.trim() || nextName, file_name: read.file, markers: read.markers });
      await queryClient.invalidateQueries({ queryKey: notesKey });
      setRead(null);
      toast(`${count(read.markers.length)} kept with this idea.`);
    } catch (err) {
      toast(message(err), { error: true });
    }
    setBusy(false);
  };
  return (
    <div className="marker-import">
      <input
        ref={input} type="file" hidden aria-label="Choose a marker export"
        accept=".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values"
        onChange={(e) => { void picked(e.target.files?.[0]); e.target.value = ""; }}
      />
      {read ? (
        <div className="stack" style={{ gap: 10 }}>
          <p className="small" style={{ margin: 0 }}>Found {count(read.markers.length)} in {read.file}.</p>
          <label className="field">
            <span>Which cut is this?</span>
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Rough cut 1" />
          </label>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>{busy ? "Saving" : "Keep these notes"}</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setRead(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn btn-small" onClick={() => input.current?.click()}><Icon name="plus" />Bring in markers</button>
          <small className="muted grow" style={{ minWidth: 0 }}>In Premiere: Markers panel, then File, Export, Markers. Pick that file here.</small>
        </div>
      )}
    </div>
  );
}

/** One export, as the editor will read it, with ways to send it. */
function EditorSheet({ sheet, title, open }: { sheet: EditorNotes; title: string; open?: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(Boolean(open));
  const text = editorText(title, sheet);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied. Paste it to your editor.");
    } catch {
      toast("This browser would not copy it. Use Download instead.", { error: true });
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: `Notes for the editor: ${title}`, text });
    } catch { /* closed without sharing */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileSafe(`${title} - ${sheet.name}`)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const bin = async () => {
    try {
      await binEditorNotes(sheet.id);
      await queryClient.invalidateQueries({ queryKey: notesKey });
      toast("Moved to the bin.");
    } catch (err) {
      toast(message(err), { error: true });
    }
  };
  return (
    <section className="editor-sheet">
      <button type="button" className="editor-sheet-head" aria-expanded={shown} onClick={() => setShown((s) => !s)}>
        <span className="grow" style={{ minWidth: 0, textAlign: "left" }}>
          <strong className="clip" style={{ display: "block" }}>{sheet.name}</strong>
          <span className="small muted">{count(sheet.markers.length)} · brought in {ago(sheet.created_at)}</span>
        </span>
        <svg className="fold-chev" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: shown ? "rotate(180deg)" : undefined }}>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {shown ? (
        <>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary btn-small" onClick={() => void copy()}>Copy for my editor</button>
            {typeof navigator !== "undefined" && "share" in navigator ? <button type="button" className="btn btn-small" onClick={() => void share()}>Share</button> : null}
            <button type="button" className="btn btn-small" onClick={download}>Download</button>
            <span className="grow" />
            <button type="button" className="btn btn-quiet btn-small" onClick={() => void bin()}>Move to bin</button>
          </div>
          <ol className="marker-list">
            {sheet.markers.map((m, i) => (
              <li key={`${m.at}-${i}`}>
                <div className="marker-when">
                  <span className="marker-n">{i + 1}</span>
                  <strong>{markerWhen(m)}</strong>
                  <span className="small muted">{m.at}{m.end ? ` to ${m.end}` : ""}</span>
                  {m.type && !/^comment$/i.test(m.type) ? <span className="tag">{m.type}</span> : null}
                </div>
                <div className="marker-note">
                  {m.name ? <div className="marker-name">{m.name}</div> : null}
                  {noteLines(m.note).map((line, j) => <div key={j}>{line}</div>)}
                  {!m.name && !m.note ? <div className="muted">No note on this marker.</div> : null}
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

/** Ideas, For my editor: every set of notes, grouped under the video idea it belongs to. */
export function EditorNotesPage() {
  const notes = useEditorNotes();
  const ideas = useIdeas();
  const [open, setOpen] = useState<{ sheet: EditorNotes; title: string } | null>(null);
  if (notes.isLoading || ideas.isLoading) return <Loading label="Loading your notes for the editor" />;
  if (notes.error) return <ErrorNote error={notes.error} retry={() => void notes.refetch()} />;
  const titleOf = new Map((ideas.data ?? []).map((i) => [i.id, i.title]));
  const groups = new Map<string, EditorNotes[]>();
  for (const n of notes.data ?? []) groups.set(n.idea_id, [...(groups.get(n.idea_id) ?? []), n]);
  return (
    <>
      <p className="soft" style={{ maxWidth: "70ch", margin: "0 0 14px" }}>
        Markers you left on your cuts in Premiere, as notes your editor can follow. Bring them in from the idea itself: open it, then For my editor.
      </p>
      {groups.size === 0 ? (
        <div className="panel"><div className="empty">
          <h3>No notes for your editor yet</h3>
          <p>In Premiere, leave markers with comments on your cut, then use File, Export, Markers. Open the video's idea here and bring the file in under For my editor.</p>
        </div></div>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          {[...groups.entries()].map(([ideaId, sheets]) => {
            const title = titleOf.get(ideaId) ?? "An idea in the bin";
            return (
              <section key={ideaId}>
                <div className="section-head"><h2 className="clip">{title}</h2><span className="small muted">{sheets.length} {sheets.length === 1 ? "cut" : "cuts"}</span></div>
                <div className="panel">
                  {sheets.map((s) => (
                    <button key={s.id} type="button" className="item script-row" onClick={() => setOpen({ sheet: s, title })}>
                      <span className="grow" style={{ minWidth: 0, textAlign: "left" }}>
                        <span className="title clip" style={{ display: "block", fontWeight: 600 }}>{s.name}</span>
                        <span className="meta small muted">{count(s.markers.length)} · brought in {ago(s.created_at)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {open ? (
        <Drawer title={`For my editor: ${open.title}`} onClose={() => setOpen(null)}>
          <EditorSheet sheet={open.sheet} title={open.title} open />
        </Drawer>
      ) : null}
    </>
  );
}
