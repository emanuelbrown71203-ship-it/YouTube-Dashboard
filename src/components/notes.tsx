// A box for notes that can hold bullet points and checkboxes, and the same note shown with real
// bullets and boxes that can be ticked.

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { continueList, type Edit, hasList, type NoteItem, parseNote, toggleCheck, toggleMarker } from "../lib/notes.ts";

/** The note as it reads: paragraphs, bullets and checkboxes. With `onChange`, the boxes can be ticked. */
export function RichNote(props: { text: string; onChange?: (text: string) => void; className?: string }) {
  const blocks = parseNote(props.text);
  const item = (i: NoteItem): ReactNode => (
    <li key={i.line} className={i.check === null ? undefined : "check"} style={i.depth ? { marginLeft: i.depth * 18 } : undefined}>
      {i.check === null ? i.text : (
        <label>
          <input
            type="checkbox" checked={i.check} disabled={!props.onChange}
            onChange={() => props.onChange?.(toggleCheck(props.text, i.line))} onClick={(e) => e.stopPropagation()}
          />
          <span className={i.check ? "done" : undefined}>{i.text}</span>
        </label>
      )}
    </li>
  );
  return (
    <div className={`note${props.className ? ` ${props.className}` : ""}`}>
      {blocks.map((b, n) => (b.kind === "text" ? <p key={n}>{b.text}</p> : <ul key={n}>{b.items.map(item)}</ul>))}
    </div>
  );
}

/**
 * The box to write a note in. Two small buttons make the current line a bullet or a checkbox, and
 * Return carries the list on. A note that has a list is shown as it reads, with boxes to tick, until
 * it is tapped to edit.
 */
export function NotesBox(props: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  minHeight?: number;
  maxLength?: number;
  /** Open straight in the writing box even when the note has a list (an editor whose job is to edit). */
  alwaysEdit?: boolean;
  /** The box grows with what is written in it, so a long plan reads without scrolling inside the box. */
  grow?: boolean;
  /** Takes the cursor when it opens (tapped open on a notebook page). */
  autoFocus?: boolean;
}) {
  const [editing, setEditing] = useState(props.alwaysEdit || !hasList(props.value));
  const box = useRef<HTMLTextAreaElement>(null);
  // Where the cursor should be after a change this box made itself (a marker added, a list carried on).
  const place = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    if (place.current && box.current) {
      box.current.setSelectionRange(place.current.start, place.current.end);
      place.current = null;
    }
  });
  // Growing boxes fit their text: never shorter than their least height, never scrolling inside.
  useLayoutEffect(() => {
    const el = box.current;
    if (!props.grow || !el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(props.minHeight ?? 110, el.scrollHeight + 2)}px`;
  }, [props.grow, props.value, props.minHeight, editing]);
  const apply = (edit: Edit) => {
    place.current = { start: edit.start, end: edit.end };
    props.onChange(props.maxLength ? edit.value.slice(0, props.maxLength) : edit.value);
  };
  const mark = (kind: "bullet" | "check") => {
    const el = box.current;
    if (!el) return;
    el.focus();
    apply(toggleMarker(props.value, el.selectionStart, el.selectionEnd, kind));
  };

  if (!editing) {
    return (
      <div className="note-view" role="group" aria-label={props.label}>
        <div className="note-view-body" onClick={() => setEditing(true)}>
          <RichNote text={props.value} onChange={props.onChange} />
        </div>
        <div className="note-tools">
          <span className="small muted grow">Tap a box to tick it.</span>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setEditing(true)}>Edit</button>
        </div>
      </div>
    );
  }
  return (
    <div className="note-edit">
      <textarea
        ref={box} className="textarea" style={{ minHeight: props.minHeight ?? 110 }} value={props.value} aria-label={props.label} autoFocus={props.autoFocus}
        placeholder={props.placeholder} maxLength={props.maxLength}
        onChange={(e) => {
          const carried = continueList(props.value, e.target.value, e.target.selectionStart);
          if (carried) apply(carried);
          else props.onChange(e.target.value);
        }}
      />
      <div className="note-tools">
        {/* preventDefault on pointer down keeps the keyboard up and the cursor in the box. */}
        <button type="button" className="btn btn-quiet btn-small" onPointerDown={(e) => e.preventDefault()} onClick={() => mark("bullet")}>• Bullet</button>
        <button type="button" className="btn btn-quiet btn-small" onPointerDown={(e) => e.preventDefault()} onClick={() => mark("check")}>☐ Checkbox</button>
        <span className="grow" />
        {!props.alwaysEdit && hasList(props.value) ? <button type="button" className="btn btn-quiet btn-small" onClick={() => setEditing(false)}>Done</button> : null}
      </div>
    </div>
  );
}
