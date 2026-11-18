// Notes with bullet points and checkboxes.
//
// The text is kept as plain text, so it stays readable anywhere (in the database, in a message, to
// Claude): a line that starts with "- " is a bullet, and "- [ ] " or "- [x] " is a checkbox.

export interface NoteItem {
  /** Which line of the text this is, counted from 0. */
  line: number;
  /** null = a bullet; false or true = a checkbox, unticked or ticked. */
  check: boolean | null;
  text: string;
  /** How far it is indented, in steps. */
  depth: number;
}
export type NoteBlock = { kind: "text"; text: string } | { kind: "list"; items: NoteItem[] };

const ITEM = /^(\s*)(?:[-*•]\s+)(?:\[( |x|X)\]\s+)?(.*)$/;
const MARKER = /^(\s*)(- \[[ xX]\] |[-*•] )/;

/** Splits a note into runs of plain text and lists. */
export function parseNote(text: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  text.replace(/\r\n?/g, "\n").split("\n").forEach((raw, line) => {
    const m = ITEM.exec(raw);
    const last = blocks[blocks.length - 1];
    if (m) {
      const item: NoteItem = { line, check: m[2] === undefined ? null : m[2] !== " ", text: m[3], depth: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)) };
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else if (last?.kind === "text") last.text += `\n${raw}`;
    else blocks.push({ kind: "text", text: raw });
  });
  // Blank lines around lists are spacing, not content.
  return blocks.map((b) => (b.kind === "text" ? { ...b, text: b.text.replace(/^\n+|\n+$/g, "") } : b)).filter((b) => b.kind === "list" || b.text.trim() !== "");
}

export const hasList = (text: string) => text.split("\n").some((line) => ITEM.test(line));
export const hasChecks = (text: string) => /^\s*[-*•]\s+\[( |x|X)\]\s/m.test(text);

/** Ticks or unticks the checkbox on one line. */
export function toggleCheck(text: string, line: number): string {
  const lines = text.split("\n");
  const raw = lines[line] ?? "";
  if (/^(\s*[-*•]\s+)\[ \]/.test(raw)) lines[line] = raw.replace(/^(\s*[-*•]\s+)\[ \]/, "$1[x]");
  else lines[line] = raw.replace(/^(\s*[-*•]\s+)\[[xX]\]/, "$1[ ]");
  return lines.join("\n");
}

/** Every checkbox unticked, to start a checklist over. */
export const untickAll = (text: string) => text.replace(/^(\s*[-*•]\s+)\[[xX]\]/gm, "$1[ ]");

/** How many checkboxes there are and how many are ticked. */
export function checkCount(text: string): { done: number; total: number } {
  const items = parseNote(text).flatMap((b) => (b.kind === "list" ? b.items : [])).filter((i) => i.check !== null);
  return { done: items.filter((i) => i.check).length, total: items.length };
}

/** The note as text to send to someone: real bullets and boxes in place of the markers. */
export function plainNote(text: string): string {
  return text.split("\n").map((raw) => {
    const m = ITEM.exec(raw);
    return m ? `${m[1]}${m[2] === undefined ? "•" : m[2] === " " ? "☐" : "☑"} ${m[3]}` : raw;
  }).join("\n");
}

/** The note with its markers taken off: for one-line previews, and for handing to the AI. */
export const bareNote = (text: string) => text.replace(/^(\s*)[-*•]\s+(?:\[[ xX]\]\s+)?/gm, "$1");

export interface Edit { value: string; start: number; end: number }

/**
 * Called after every keystroke. When Return was just pressed at the end of a list line, the next line
 * starts with the same marker; pressed on an empty item, it ends the list. Returns null otherwise.
 */
export function continueList(before: string, after: string, cursor: number): Edit | null {
  if (after.length !== before.length + 1 || after[cursor - 1] !== "\n") return null;
  const lineStart = after.lastIndexOf("\n", cursor - 2) + 1;
  const line = after.slice(lineStart, cursor - 1);
  const m = MARKER.exec(line);
  if (!m) return null;
  if (line.slice(m[0].length).trim() === "") {
    // Return on an empty bullet: the bullet goes, the cursor stays on that line.
    const value = after.slice(0, lineStart) + after.slice(cursor);
    return { value, start: lineStart, end: lineStart };
  }
  const marker = m[2].startsWith("- [") ? "- [ ] " : m[2];
  const at = cursor + m[1].length + marker.length;
  return { value: after.slice(0, cursor) + m[1] + marker + after.slice(cursor), start: at, end: at };
}

/**
 * Turns the lines under the selection into bullets or checkboxes, or back into plain lines when they
 * all are that already.
 */
export function toggleMarker(value: string, start: number, end: number, kind: "bullet" | "check"): Edit {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", Math.max(end, from));
  const to = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(from, to).split("\n");
  const is = (line: string) => {
    const m = ITEM.exec(line);
    return Boolean(m) && (kind === "check" ? m![2] !== undefined : m![2] === undefined);
  };
  // Blank lines inside a selection are skipped, unless the selection is one blank line: that starts a list.
  const targets = lines.map((line) => lines.length === 1 || line.trim() !== "");
  const allAlready = lines.every((line, i) => !targets[i] || is(line));
  const marker = kind === "check" ? "- [ ] " : "- ";
  const changed = lines.map((line, i) => {
    if (!targets[i]) return line;
    const m = MARKER.exec(line);
    const indent = m ? m[1] : /^\s*/.exec(line)![0];
    const rest = m ? line.slice(m[0].length) : line.slice(indent.length);
    return allAlready ? `${indent}${rest}` : `${indent}${marker}${rest}`;
  });
  const out = value.slice(0, from) + changed.join("\n") + value.slice(to);
  if (start === end) {
    // One line: keep the cursor where it was in the words, moved by what was added or taken in front of it.
    const shift = changed[0].length - lines[0].length;
    const at = Math.max(from, start + shift);
    return { value: out, start: at, end: at };
  }
  return { value: out, start: from, end: from + changed.join("\n").length };
}
